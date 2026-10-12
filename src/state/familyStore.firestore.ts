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
 *    the status pill shows as "Lagret her – sendes når du er på nett" while offline. Writes queued before this page
 *    was loaded (an offline reload) or by another tab count too: the listener flags every document with writes the
 *    server does not have yet (`AdapterDoc.pending`), and `flush` waits for those as well (`waitForPendingWrites`).
 *  - Soft delete, restore and `keepRevision` are field updates (`ProposalPatch`, Firestore `update` with
 *    `arrayUnion` / `arrayRemove`): applied to the server's version, so a delete made offline from an old view never
 *    writes old content over a newer save.
 *  - A content save over a stored proposal is a `set` with merge that leaves `revisions` / `lastRevisionAt` out (its
 *    own revision id is added with `arrayUnion`): a save queued offline from an old view never drops revision ids.
 *  - The conflict guard checks against the newest version this device knows (the live listener's cache view), so it
 *    works offline too; last write wins otherwise.
 *  - A write the server refuses (e.g. rules) is reported as `error` in the status (and through `onWriteError`).
 */
import type { FirebaseOptions } from 'firebase/app';
import {
  applyPatch,
  buildList,
  cleanName,
  createDecoder,
  createMyName,
  createStamper,
  decodeProposalProject,
  metaOf,
  newProposalId,
  planDeleted,
  planKeepRevision,
  planSave,
  readProposalDoc,
  readRevisionDoc,
  revisionInfoOf,
  TRASH_MS,
} from './familyStore';
import type {
  EncodeContext,
  FamilyStore,
  FamilyStoreStatus,
  Proposal,
  ProposalDoc,
  ProposalList,
  ProposalPatch,
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
  /** This device has writes of the document the server has not confirmed (also from an earlier page or another tab). */
  pending?: boolean;
}

export interface SnapshotMeta {
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export type WriteOp =
  /** `merge`: only the fields in `data` are written, the others stay what the server has (Firestore `set` with merge). */
  | { kind: 'set'; path: string; data: Record<string, unknown>; merge?: boolean }
  /**
   * Field update of an existing document (the batch fails when it does not exist): `data` replaces those fields,
   * `arrayUnion` / `arrayRemove` add / remove array values. Applied to the server's version when it arrives there.
   */
  | { kind: 'update'; path: string; data: Record<string, unknown>; arrayUnion?: Record<string, string[]>; arrayRemove?: Record<string, string[]> }
  | { kind: 'delete'; path: string };

/** What an `update` op does to a document (the fake Firestore uses it). */
export function applyUpdate(doc: Record<string, unknown>, op: Extract<WriteOp, { kind: 'update' }>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...doc, ...op.data };
  for (const [key, values] of Object.entries(op.arrayUnion ?? {})) {
    const arr = Array.isArray(next[key]) ? [...(next[key] as unknown[])] : [];
    for (const v of values) if (!arr.includes(v)) arr.push(v);
    next[key] = arr;
  }
  for (const [key, values] of Object.entries(op.arrayRemove ?? {})) {
    next[key] = (Array.isArray(next[key]) ? (next[key] as unknown[]) : []).filter((v) => !values.includes(v as string));
  }
  return next;
}

/** The update op(s) of a ProposalPatch (`arrayUnion` and `arrayRemove` of one field cannot share an op). */
export function patchOps(path: string, patch: ProposalPatch): WriteOp[] {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch.set)) if (v !== undefined) data[k] = v;
  const arrayUnion: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(patch.add ?? {})) if (v && v.length > 0) arrayUnion[k] = v;
  const ops: WriteOp[] = [];
  if (Object.keys(data).length > 0 || Object.keys(arrayUnion).length > 0) {
    ops.push({ kind: 'update', path, data, ...(Object.keys(arrayUnion).length > 0 ? { arrayUnion } : {}) });
  }
  const removed = patch.remove?.revisions;
  if (removed && removed.length > 0) ops.push({ kind: 'update', path, data: {}, arrayRemove: { revisions: removed } });
  return ops;
}

export interface FirestoreAdapter {
  /** Anonymous sign-in (reuses the persisted session). */
  signIn(): Promise<void>;
  /** Live listener on a collection (also delivers this device's own pending writes, flagged per document and in `meta`). */
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
  /** Resolves when every write this device has queued (this page's, an earlier page's, another tab's) is on the server. */
  waitForPendingWrites(): Promise<void>;
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

/** An own write of a proposal document not confirmed yet: the whole document (null = deleted) or a field update. */
type PendingChange = { doc: ProposalDoc | null } | { patch: ProposalPatch };

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
  /** Documents of the last snapshot with writes the server does not have yet (also queued by an earlier page). */
  let snapshotPending = 0;
  /**
   * Own writes the server has not confirmed yet, in order: a whole document (null = deleted) or a field update. They
   * are applied over the listener's view meanwhile (a field update to whatever version is shown).
   */
  const mine = new Map<Id, PendingChange[]>();
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
    for (const [id, doc] of refused) {
      if (doc) next.set(id, doc);
      else next.delete(id);
    }
    for (const [id, changes] of mine) {
      for (const c of changes) {
        if ('patch' in c) {
          const cur = next.get(id);
          if (cur) next.set(id, applyPatch(cur, c.patch));
        } else if (c.doc) next.set(id, c.doc);
        else next.delete(id);
      }
    }
    docs = next;
  };

  /** Pending = own writes not confirmed yet, or documents the listener flags (writes queued before this page). */
  const pendingCount = () => Math.max(acks.size, snapshotPending);

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

  const onSnapshot = (items: AdapterDoc[], meta: SnapshotMeta) => {
    const next = new Map<Id, ProposalDoc>();
    let flagged = 0;
    for (const item of items) {
      const doc = readProposalDoc(item.data);
      if (doc) next.set(item.id, doc);
      if (item.pending) flagged++;
    }
    server = next;
    snapshotPending = flagged > 0 ? flagged : meta.hasPendingWrites ? 1 : 0;
    setStatus({ phase: 'ready', pending: pendingCount(), error: status.error === 'listen' ? null : status.error });
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
      (items, meta) => onSnapshot(items, meta),
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
   * Write ops; `changes` = what they do to proposal documents (a whole document, null = deleted, or a field update).
   * This device shows them right away and until the server confirmed or refused them; the confirmation is tracked as
   * pending.
   */
  const write = (ops: WriteOp[], changes: Map<Id, PendingChange>) => {
    const { acked } = adapter.write(ops);
    for (const [id, change] of changes) mine.set(id, [...(mine.get(id) ?? []), change]);
    const settle = (id: Id, change: PendingChange) => {
      const rest = (mine.get(id) ?? []).filter((c) => c !== change);
      if (rest.length > 0) mine.set(id, rest);
      else mine.delete(id);
    };
    const tracked = acked.then(
      () => {
        for (const [id, change] of changes) {
          settle(id, change);
          refused.delete(id);
        }
        if (status.error === 'write' && refused.size === 0) setStatus({ error: null });
        emit();
      },
      (e: unknown) => {
        for (const [id, change] of changes) {
          // Keep showing what this device wrote (the edit is not lost): the document as it looks with the change.
          const shown = 'patch' in change ? (docs.get(id) ?? null) : change.doc;
          settle(id, change);
          refused.set(id, shown);
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
    setStatus({ pending: pendingCount() });
    void tracked.finally(() => {
      acks.delete(tracked);
      setStatus({ pending: pendingCount() });
    });
  };

  const saveProposal = async (variant: Variant, o: SaveOptions): Promise<SaveResult> => {
    await ready;
    const id = variant.id;
    const cur = docs.get(id);
    const at = o.at ?? stamp(cur?.updatedAt);
    const plan = planSave(cur, variant, { ...o, at, by: byOf(o.by) }, context());
    if (plan.kind === 'conflict') return { status: 'conflict', remote: plan.remote === 'current' && cur ? proposalOf(id, cur) : null };
    // Over a stored proposal the content is written with merge, without the revision list and its time: a save queued
    // offline from an old view never drops revision ids another device added (their documents would be orphans). The
    // new revision's id is added (arrayUnion), the pruned ones removed (arrayRemove), so the list stays the union of
    // what everyone kept. A new proposal is written whole.
    const { revisions: _revisions, lastRevisionAt, ...content } = docData(plan.doc);
    const path = proposalPath(id);
    const data = !cur ? docData(plan.doc) : plan.revision ? { ...content, lastRevisionAt } : content;
    const ops: WriteOp[] = [{ kind: 'set', path, data, merge: true }];
    if (plan.revision) {
      ops.push({ kind: 'update', path, data: {}, arrayUnion: { revisions: [plan.revision.id] } });
      ops.push({ kind: 'set', path: `${revisionsPath(id)}/${plan.revision.id}`, data: { ...plan.revision.doc } });
    }
    if (plan.pruned.length > 0) ops.push({ kind: 'update', path, data: {}, arrayRemove: { revisions: plan.pruned } });
    for (const old of plan.pruned) ops.push({ kind: 'delete', path: `${revisionsPath(id)}/${old}` });
    try {
      write(ops, new Map([[id, { doc: plan.doc }]]));
    } catch (e) {
      return { status: 'error', error: errorCode(e) };
    }
    emit();
    const saved = proposalOf(id, plan.doc);
    return saved ? { status: 'saved', proposal: saved } : { status: 'error', error: 'decode' };
  };

  /** Soft delete / restore: a field update (deletedAt, updatedAt, updatedBy, lineage), never the content. */
  const setDeleted = async (id: Id, deleted: boolean, o: { at?: string; by?: string | null }): Promise<ProposalDoc | null> => {
    await ready;
    const doc = docs.get(id);
    if (!doc || (doc.deletedAt !== null) === deleted) return doc ?? null;
    const at = o.at ?? stamp(doc.updatedAt);
    const patch = planDeleted(doc, deleted, at, byOf(o.by));
    write(patchOps(proposalPath(id), patch), new Map([[id, { patch }]]));
    emit();
    return docs.get(id) ?? applyPatch(doc, patch);
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
        write([...revisionIds.map((r): WriteOp => ({ kind: 'delete', path: `${revisionsPath(id)}/${r}` })), { kind: 'delete', path: proposalPath(id) }], new Map([[id, { doc: null }]]));
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
        if (doc) out.push(revisionInfoOf(item.id, id, doc));
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
      // Only the revision ids change (arrayUnion / arrayRemove): the content stays whatever the server has.
      write(
        [
          ...patchOps(proposalPath(id), plan.patch),
          { kind: 'set', path: `${revisionsPath(id)}/${plan.revision.id}`, data: { ...plan.revision.doc } },
          ...plan.pruned.map((r): WriteOp => ({ kind: 'delete', path: `${revisionsPath(id)}/${r}` })),
        ],
        new Map([[id, { patch: plan.patch }]]),
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
      // Writes queued before this page (an offline reload) or by another tab: the SDK knows them, this page does not.
      await adapter.waitForPendingWrites().catch(() => {});
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
  // Anonymous sign-in only: no popup / redirect resolver, so no Google scripts or auth iframe are loaded (getAuth
  // installs `browserPopupRedirectResolver`, which loads apis.google.com and firebaseapp.com/__/auth/iframe on
  // phones). getAuth only when this app's auth is already initialised (hot reload).
  let auth: import('firebase/auth').Auth;
  try {
    auth = authMod.initializeAuth(app, { persistence: [authMod.indexedDBLocalPersistence, authMod.browserLocalPersistence] });
  } catch {
    auth = authMod.getAuth(app);
  }
  const toDocs = (snap: import('firebase/firestore').QuerySnapshot): AdapterDoc[] =>
    snap.docs.map((d) => ({ id: d.id, data: d.data(), pending: d.metadata.hasPendingWrites }));
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
        if (op.kind === 'set') {
          if (op.merge) batch.set(fs.doc(db, op.path), op.data, { merge: true });
          else batch.set(fs.doc(db, op.path), op.data);
        } else if (op.kind === 'update') {
          const data: Record<string, unknown> = { ...op.data };
          for (const [k, v] of Object.entries(op.arrayUnion ?? {})) data[k] = fs.arrayUnion(...v);
          for (const [k, v] of Object.entries(op.arrayRemove ?? {})) data[k] = fs.arrayRemove(...v);
          batch.update(fs.doc(db, op.path), data);
        } else batch.delete(fs.doc(db, op.path));
      }
      return { acked: batch.commit() };
    },
    waitForPendingWrites() {
      return fs.waitForPendingWrites(db);
    },
    dispose() {
      void fs.terminate(db).catch(() => {});
    },
  };
}
