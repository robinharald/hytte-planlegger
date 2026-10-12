/**
 * FamilyStore on Firestore (the family's shared space, docs/phase2-plan.md §5; layout and rules in familyStore.ts).
 *
 * Loaded only with `import()` from state/appStore.ts when src/state/firebaseConfig.ts holds a config, so a bundle
 * without one never loads Firebase; this module itself imports the Firebase SDK lazily too (`loadFirebaseAdapter`),
 * so unit tests run it on a fake `FirestoreAdapter` without Firebase.
 *
 *  - Anonymous auth: an invisible id per device, no passwords. Reads and writes start after the sign-in (or after it
 *    failed while offline: the IndexedDB cache still answers). A listener refused by the server (no auth yet) signs in
 *    again and re-subscribes when the device is online.
 *  - Offline: the IndexedDB cache (`persistentLocalCache`, multi-tab) keeps everything opened, and writes queue there
 *    until the device is online. A write counts as pending until the server confirms it (`status().pending`), which
 *    the status pill shows as "Lagret her – sendes når du er på nett" while offline.
 *  - The conflict guard checks against the newest version this device knows (the live listener's cache view), so it
 *    works offline too; last write wins otherwise.
 *  - A write the server refuses (e.g. rules) is reported as `error` in the status (and through `onWriteError`).
 */
import type { FirebaseOptions } from 'firebase/app';
import {
  buildList,
  cleanName,
  createDecoder,
  createMyName,
  createStamper,
  decodeProposalProject,
  metaOf,
  newProposalId,
  planKeepRevision,
  planSave,
  readProposalDoc,
  readRevisionDoc,
  TRASH_MS,
} from './familyStore';
import type {
  EncodeContext,
  FamilyStore,
  FamilyStoreStatus,
  Proposal,
  ProposalDoc,
  ProposalList,
  RevisionInfo,
  SaveOptions,
  SaveResult,
} from './familyStore';
import type { Id, Variant } from '../model/types';

// ---------------------------------------------------------------------------
// Adapter (the few Firestore calls the store needs)
// ---------------------------------------------------------------------------

export interface AdapterDoc {
  id: string;
  data: Record<string, unknown>;
}

export interface SnapshotMeta {
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export type WriteOp = { kind: 'set'; path: string; data: Record<string, unknown> } | { kind: 'delete'; path: string };

export interface FirestoreAdapter {
  /** Anonymous sign-in (reuses the persisted session). */
  signIn(): Promise<void>;
  /** Live listener on a collection (also delivers this device's own pending writes, flagged in `meta`). */
  watch(collectionPath: string, onNext: (docs: AdapterDoc[], meta: SnapshotMeta) => void, onError: (e: unknown) => void): () => void;
  /** Read a collection (the server when reachable, else the cache). */
  read(collectionPath: string): Promise<AdapterDoc[]>;
  /** Read one document (null when it does not exist). */
  get(docPath: string): Promise<Record<string, unknown> | null>;
  /**
   * Apply the writes atomically. The local cache (and every listener) has them when this returns; `acked` settles when
   * the server has confirmed (or refused) them — while offline, not before the device is online again.
   */
  write(ops: WriteOp[]): { acked: Promise<void> };
  dispose(): void;
}

/** Online / offline of the device (navigator.onLine and its events by default). */
export interface Connectivity {
  online(): boolean;
  subscribe(cb: (online: boolean) => void): () => void;
}

export function browserConnectivity(win: (Pick<Window, 'addEventListener' | 'removeEventListener'> & { navigator?: Navigator }) | null = typeof window === 'undefined' ? null : window): Connectivity {
  return {
    online: () => (win?.navigator ? win.navigator.onLine !== false : true),
    subscribe(cb) {
      if (!win) return () => {};
      const on = () => cb(true);
      const off = () => cb(false);
      win.addEventListener('online', on);
      win.addEventListener('offline', off);
      return () => {
        win.removeEventListener('online', on);
        win.removeEventListener('offline', off);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface FirestoreFamilyStoreOptions {
  adapter: FirestoreAdapter;
  familyId: string;
  /** For the display name (localStorage). */
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  context: () => EncodeContext;
  now?: () => number;
  connectivity?: Connectivity;
  /** A write of this proposal was refused by the server. */
  onWriteError?: (id: Id, error: unknown) => void;
  /** Retry delay after a failed sign-in or a refused listener while online (ms). */
  retryMs?: number;
}

function errorCode(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'code' in e && typeof (e as { code: unknown }).code === 'string') return (e as { code: string }).code;
  return e instanceof Error ? e.message : String(e);
}

/** The document as written to Firestore (no undefined anywhere). */
function docData(doc: ProposalDoc): Record<string, unknown> {
  return { ...doc };
}

export function createFirestoreFamilyStore(opts: FirestoreFamilyStoreOptions): FamilyStore {
  const { adapter, familyId, context } = opts;
  const now = opts.now ?? Date.now;
  const connectivity = opts.connectivity ?? browserConnectivity();
  const retryMs = opts.retryMs ?? 15_000;
  const stamp = createStamper(now);
  const decode = createDecoder();
  const names = createMyName(opts.storage);
  const proposalsPath = `families/${familyId}/proposals`;
  const proposalPath = (id: Id) => `${proposalsPath}/${id}`;
  const revisionsPath = (id: Id) => `${proposalPath(id)}/revisions`;

  const listeners = new Set<(list: ProposalList) => void>();
  const statusListeners = new Set<(s: FamilyStoreStatus) => void>();
  /** The listener's view (server + the SDK's own latency compensation). */
  let server = new Map<Id, ProposalDoc>();
  /** Own writes the server has not confirmed yet (null = deleted): they win over the listener's view meanwhile. */
  const mine = new Map<Id, { doc: ProposalDoc | null; count: number }>();
  /** Own writes the server refused: still shown here (the edit is not lost) until a later write of the id succeeds. */
  const refused = new Map<Id, ProposalDoc | null>();
  const writeErrorListeners = new Set<(id: Id) => void>();
  /** What this device shows: server, then refused, then pending own writes. */
  let docs = new Map<Id, ProposalDoc>();
  let list: ProposalList = { proposals: [], trash: [], tooNew: [] };
  let status: FamilyStoreStatus = { phase: 'connecting', pending: 0, online: connectivity.online(), error: null };
  const acks = new Set<Promise<void>>();
  let unwatch: (() => void) | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => {
    resolveReady = r;
  });

  const setStatus = (patch: Partial<FamilyStoreStatus>) => {
    const next = { ...status, ...patch };
    if (next.phase === status.phase && next.pending === status.pending && next.online === status.online && next.error === status.error) return;
    status = next;
    for (const l of statusListeners) l(status);
  };

  const recompute = () => {
    const next = new Map(server);
    const pending = new Map([...mine].map(([id, m]) => [id, m.doc] as const));
    for (const overlay of [refused, pending]) {
      for (const [id, doc] of overlay) {
        if (doc) next.set(id, doc);
        else next.delete(id);
      }
    }
    docs = next;
  };

  const emit = () => {
    recompute();
    list = buildList(docs.entries(), now(), decode);
    for (const l of listeners) l(list);
  };

  const proposalOf = (id: Id, doc: ProposalDoc): Proposal | null => {
    const d = decode(id, doc);
    return d.status === 'ok' ? { ...metaOf(id, doc), variant: d.variant } : null;
  };
  const byOf = (by: string | null | undefined): string | null => (by === undefined ? cleanName(names.get()) : cleanName(by));

  const onSnapshot = (items: { id: string; data: Record<string, unknown> }[]) => {
    const next = new Map<Id, ProposalDoc>();
    for (const item of items) {
      const doc = readProposalDoc(item.data);
      if (doc) next.set(item.id, doc);
    }
    server = next;
    setStatus({ phase: 'ready', error: status.error === 'listen' ? null : status.error });
    resolveReady();
    emit();
  };

  const scheduleRetry = () => {
    if (disposed || retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (connectivity.online()) void connect();
    }, retryMs);
  };

  const subscribe = () => {
    unwatch?.();
    unwatch = adapter.watch(
      proposalsPath,
      (items) => onSnapshot(items),
      () => {
        // Refused (not signed in yet) or broken: sign in again and listen again (once online).
        unwatch = null;
        setStatus({ phase: status.phase === 'ready' ? 'ready' : 'error', error: 'listen' });
        scheduleRetry();
      },
    );
  };

  let connecting: Promise<void> | null = null;
  const connect = (): Promise<void> => {
    connecting ??= (async () => {
      try {
        await adapter.signIn();
        if (status.error === 'auth') setStatus({ error: null });
      } catch {
        // Offline on the very first start, or anonymous sign-in switched off: the cache still answers.
        setStatus({ error: 'auth' });
        scheduleRetry();
      }
      if (!disposed) subscribe();
    })().finally(() => {
      connecting = null;
    });
    return connecting;
  };

  const stopConnectivity = connectivity.subscribe((online) => {
    setStatus({ online });
    if (online && (status.error === 'auth' || status.error === 'listen' || unwatch === null)) void connect();
  });

  /**
   * Write ops; `changes` = the proposal documents they set (null = deleted). This device shows them right away and
   * until the server confirmed or refused them; the confirmation is tracked as pending.
   */
  const write = (ops: Parameters<FirestoreAdapter['write']>[0], changes: Map<Id, ProposalDoc | null>) => {
    const { acked } = adapter.write(ops);
    for (const [id, doc] of changes) mine.set(id, { doc, count: (mine.get(id)?.count ?? 0) + 1 });
    const settle = (id: Id) => {
      const m = mine.get(id);
      if (m && --m.count <= 0) mine.delete(id);
    };
    const tracked = acked.then(
      () => {
        for (const id of changes.keys()) {
          settle(id);
          refused.delete(id);
        }
        if (status.error === 'write' && refused.size === 0) setStatus({ error: null });
        emit();
      },
      (e: unknown) => {
        for (const [id, doc] of changes) {
          settle(id);
          refused.set(id, doc);
        }
        setStatus({ error: 'write' });
        emit();
        for (const id of changes.keys()) {
          opts.onWriteError?.(id, e);
          for (const l of writeErrorListeners) l(id);
        }
      },
    );
    acks.add(tracked);
    setStatus({ pending: acks.size });
    void tracked.finally(() => {
      acks.delete(tracked);
      setStatus({ pending: acks.size });
    });
  };

  const saveProposal = async (variant: Variant, o: SaveOptions): Promise<SaveResult> => {
    await ready;
    const id = variant.id;
    const cur = docs.get(id);
    const at = o.at ?? stamp(cur?.updatedAt);
    const plan = planSave(cur, variant, { ...o, at, by: byOf(o.by) }, context());
    if (plan.kind === 'conflict') return { status: 'conflict', remote: plan.remote === 'current' && cur ? proposalOf(id, cur) : null };
    const ops: Parameters<FirestoreAdapter['write']>[0] = [{ kind: 'set', path: proposalPath(id), data: docData(plan.doc) }];
    if (plan.revision) ops.push({ kind: 'set', path: `${revisionsPath(id)}/${plan.revision.id}`, data: { ...plan.revision.doc } });
    for (const old of plan.pruned) ops.push({ kind: 'delete', path: `${revisionsPath(id)}/${old}` });
    try {
      write(ops, new Map([[id, plan.doc]]));
    } catch (e) {
      return { status: 'error', error: errorCode(e) };
    }
    emit();
    const saved = proposalOf(id, plan.doc);
    return saved ? { status: 'saved', proposal: saved } : { status: 'error', error: 'decode' };
  };

  const setDeleted = async (id: Id, deleted: boolean, o: { at?: string; by?: string | null }): Promise<ProposalDoc | null> => {
    await ready;
    const doc = docs.get(id);
    if (!doc || (doc.deletedAt !== null) === deleted) return doc ?? null;
    const at = o.at ?? stamp(doc.updatedAt);
    const next: ProposalDoc = { ...doc, deletedAt: deleted ? at : null, updatedAt: at, updatedBy: byOf(o.by) };
    write([{ kind: 'set', path: proposalPath(id), data: docData(next) }], new Map([[id, next]]));
    emit();
    return next;
  };

  const store: FamilyStore = {
    mode: 'shared',
    familyId,

    listProposals(onChange) {
      listeners.add(onChange);
      if (status.phase === 'ready') queueMicrotask(() => listeners.has(onChange) && onChange(list));
      return () => listeners.delete(onChange);
    },

    currentList: () => list,

    async getProposal(id) {
      await ready;
      const doc = docs.get(id);
      return doc && doc.deletedAt === null ? proposalOf(id, doc) : null;
    },

    saveProposal,

    async createProposal(from, name, o = {}) {
      const at = o.at ?? stamp();
      const id = o.id ?? newProposalId();
      const copy: Variant = { ...structuredClone(from), id, name: cleanName(name) ?? from.name, createdAt: at, basedOnId: from.id };
      const r = await saveProposal(copy, { base: null, at, by: o.by });
      if (r.status !== 'saved') throw new Error(r.status === 'error' ? r.error : 'conflict');
      return r.proposal;
    },

    async renameProposal(id, name, o = {}) {
      await ready;
      const doc = docs.get(id);
      const p = doc && doc.deletedAt === null ? proposalOf(id, doc) : null;
      const clean = cleanName(name);
      if (!p || !doc || !clean) return { status: 'conflict', remote: p };
      return saveProposal({ ...p.variant, name: clean }, { base: o.base === undefined ? doc.updatedAt : o.base, at: o.at, by: o.by });
    },

    async deleteProposal(id, o = {}) {
      await setDeleted(id, true, o);
    },

    async restoreProposal(id, o = {}) {
      const doc = await setDeleted(id, false, o);
      return doc && doc.deletedAt === null ? proposalOf(id, doc) : null;
    },

    async listTrash() {
      await ready;
      return list.trash;
    },

    async purgeTrash(at = new Date(now())) {
      await ready;
      const limit = at.getTime() - TRASH_MS;
      let count = 0;
      for (const [id, doc] of [...docs]) {
        const t = doc.deletedAt === null ? NaN : Date.parse(doc.deletedAt);
        if (!Number.isFinite(t) || t >= limit) continue;
        let revisionIds = doc.revisions;
        try {
          revisionIds = [...new Set([...doc.revisions, ...(await adapter.read(revisionsPath(id))).map((r) => r.id)])];
        } catch {
          // offline: the ids the document lists
        }
        write([...revisionIds.map((r): WriteOp => ({ kind: 'delete', path: `${revisionsPath(id)}/${r}` })), { kind: 'delete', path: proposalPath(id) }], new Map([[id, null]]));
        count++;
      }
      if (count > 0) emit();
      return count;
    },

    async listRevisions(id) {
      await ready;
      const items = await adapter.read(revisionsPath(id));
      const out: RevisionInfo[] = [];
      for (const item of items) {
        const doc = readRevisionDoc(item.data);
        if (doc) out.push({ id: item.id, proposalId: id, name: doc.name, savedAt: doc.savedAt, savedBy: doc.savedBy });
      }
      return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || b.id.localeCompare(a.id));
    },

    async restoreRevision(id, revisionId, o = {}) {
      await ready;
      const cur = docs.get(id);
      const rev = readRevisionDoc(await adapter.get(`${revisionsPath(id)}/${revisionId}`));
      if (!cur || cur.deletedAt !== null || !rev) return { status: 'error', error: 'missing' };
      const decoded = decodeProposalProject(rev.project, id, cur.name);
      if (decoded.status !== 'ok') return { status: 'error', error: decoded.status };
      return saveProposal(decoded.variant, { base: cur.updatedAt, force: true, forceRevision: true, at: o.at, by: o.by });
    },

    async keepRevision(id, variant, saved) {
      await ready;
      const cur = docs.get(id);
      if (!cur) return false;
      const plan = planKeepRevision(cur, variant, saved, context());
      write(
        [
          { kind: 'set', path: proposalPath(id), data: docData(plan.doc) },
          { kind: 'set', path: `${revisionsPath(id)}/${plan.revision.id}`, data: { ...plan.revision.doc } },
          ...plan.pruned.map((r): WriteOp => ({ kind: 'delete', path: `${revisionsPath(id)}/${r}` })),
        ],
        new Map([[id, plan.doc]]),
      );
      emit();
      return true;
    },

    whoAmI: () => names.get(),
    setMyName: (name) => names.set(name),

    status: () => status,
    onWriteError(cb) {
      writeErrorListeners.add(cb);
      return () => writeErrorListeners.delete(cb);
    },
    onStatus(cb) {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },

    async flush() {
      await Promise.allSettled([...acks]);
    },

    dispose() {
      disposed = true;
      unwatch?.();
      unwatch = null;
      stopConnectivity();
      if (retryTimer !== null) clearTimeout(retryTimer);
      listeners.clear();
      statusListeners.clear();
      writeErrorListeners.clear();
      adapter.dispose();
    },
  };

  void connect();
  return store;
}

// ---------------------------------------------------------------------------
// The real adapter (Firebase SDK, loaded on demand)
// ---------------------------------------------------------------------------

/** Name of the Firebase app instance (a named app survives hot reloads without "already exists"). */
const APP_NAME = 'hytte-planlegger';

/**
 * The Firebase adapter: app, anonymous auth and Firestore with the IndexedDB cache (`persistentLocalCache` with the
 * multi-tab manager; `persistence: false` for Node probes). Everything Firebase is imported here, on demand.
 */
export async function loadFirebaseAdapter(config: FirebaseOptions, o: { persistence?: boolean } = {}): Promise<FirestoreAdapter> {
  const [appMod, authMod, fs] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
  const app = appMod.getApps().find((a) => a.name === APP_NAME) ?? appMod.initializeApp(config, APP_NAME);
  let db: import('firebase/firestore').Firestore;
  try {
    db =
      o.persistence === false
        ? fs.initializeFirestore(app, {})
        : fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch {
    db = fs.getFirestore(app); // already initialised (hot reload)
  }
  const auth = authMod.getAuth(app);
  const toDocs = (snap: import('firebase/firestore').QuerySnapshot): AdapterDoc[] => snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  return {
    async signIn() {
      await auth.authStateReady();
      if (!auth.currentUser) await authMod.signInAnonymously(auth);
    },
    watch(path, onNext, onError) {
      return fs.onSnapshot(
        fs.collection(db, path),
        { includeMetadataChanges: true },
        (snap) => onNext(toDocs(snap), { fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites }),
        onError,
      );
    },
    async read(path) {
      return toDocs(await fs.getDocs(fs.collection(db, path)));
    },
    async get(path) {
      const snap = await fs.getDoc(fs.doc(db, path));
      return snap.exists() ? snap.data() : null;
    },
    write(ops) {
      const batch = fs.writeBatch(db);
      for (const op of ops) {
        if (op.kind === 'set') batch.set(fs.doc(db, op.path), op.data);
        else batch.delete(fs.doc(db, op.path));
      }
      return { acked: batch.commit() };
    },
    dispose() {
      void fs.terminate(db).catch(() => {});
    },
  };
}
