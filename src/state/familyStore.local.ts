/**
 * FamilyStore on localStorage: the store without a Firebase config (forks, tests, Playwright) — "Kun på denne
 * enheten". Same documents and rules as the Firestore store (familyStore.ts header): conflict guard, soft delete with
 * the 30-day Papirkurv, automatic revisions (≤ 1 per 5 min, ≤ 20).
 *
 * Keys
 *  - `hytte-planlegger:proposals`           `{ v: 1, docs: { [id]: ProposalDoc } }`, each `project` lz-compressed
 *                                            (`compressToUTF16`, flag `z`) so 20 revisions of many proposals fit.
 *  - `hytte-planlegger:proposal-revisions`  `{ v: 1, byId: { [proposalId]: { [revisionId]: RevisionDoc } } }` (same).
 *
 * Other tabs: a `storage` event on the proposals key re-reads it and reports the new list (the sync's conflict guard
 * then handles a proposal changed in two tabs). Every save re-reads the key first, so a tab never writes over
 * another tab's newer save without the guard seeing it. Every storage access is guarded; a failed write (quota)
 * drops the oldest revisions once and tries again, else it is reported as `error`.
 */
import LZString from 'lz-string';
import { createForslagD, SEED_REVISION } from '../model/seed/forslagD';
import type { Id, Variant } from '../model/types';
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

export const LOCAL_KEYS = {
  proposals: 'hytte-planlegger:proposals',
  revisions: 'hytte-planlegger:proposal-revisions',
} as const;

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface LocalFamilyStoreOptions {
  storage: KV | null;
  /** Window-like target for `storage` events (other tabs); omit in tests without a DOM. */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  now?: () => number;
  /** Site and seed revision written into each stored proposal (default: the bundled seed's). */
  context?: () => EncodeContext;
}

const READY: FamilyStoreStatus = { phase: 'ready', pending: 0, online: true, error: null };

let defaultContext: EncodeContext | null = null;
function seedContext(): EncodeContext {
  defaultContext ??= { site: createForslagD().site, seedRevision: SEED_REVISION };
  return defaultContext;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Stored form of a document: `project` compressed. */
function pack<T extends { project: string }>(doc: T): T & { z: true } {
  return { ...doc, project: LZString.compressToUTF16(doc.project), z: true };
}

function unpack(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.z !== true || typeof raw.project !== 'string') return raw;
  const text = LZString.decompressFromUTF16(raw.project);
  return { ...raw, project: typeof text === 'string' ? text : '' };
}

export function createLocalFamilyStore(opts: LocalFamilyStoreOptions): FamilyStore {
  const { storage, target } = opts;
  const now = opts.now ?? Date.now;
  const context = opts.context ?? seedContext;
  const stamp = createStamper(now);
  const decode = createDecoder();
  const listeners = new Set<(list: ProposalList) => void>();
  let docs = new Map<Id, ProposalDoc>();
  /** Compressed text per doc version, so a save does not recompress every other proposal. */
  const packed = new Map<Id, { project: string; z: string }>();
  let list: ProposalList = { proposals: [], trash: [], tooNew: [] };
  let lastRaw: string | null = null;
  const names = createMyName(storage);
  let disposed = false;

  const readKey = (key: string): string | null => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const writeKey = (key: string, value: string): boolean => {
    if (!storage) return false;
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };

  /** Re-read the proposals key; returns whether it changed. */
  const reload = (): boolean => {
    const raw = readKey(LOCAL_KEYS.proposals);
    if (raw === lastRaw) return false;
    lastRaw = raw;
    const next = new Map<Id, ProposalDoc>();
    let parsed: unknown;
    try {
      parsed = raw === null ? null : (JSON.parse(raw) as unknown);
    } catch {
      parsed = null;
    }
    const stored = isRecord(parsed) && isRecord(parsed.docs) ? parsed.docs : {};
    for (const [id, value] of Object.entries(stored)) {
      if (!isRecord(value)) continue;
      const hit = packed.get(id);
      const doc =
        hit && value.z === true && value.project === hit.z
          ? readProposalDoc({ ...value, project: hit.project })
          : readProposalDoc(unpack(value));
      if (!doc) continue;
      next.set(id, doc);
      if (value.z === true && typeof value.project === 'string') packed.set(id, { project: doc.project, z: value.project });
    }
    docs = next;
    return true;
  };

  const rebuild = () => {
    list = buildList(docs.entries(), now(), decode);
  };

  const emit = () => {
    rebuild();
    const snapshot = list;
    queueMicrotask(() => {
      if (disposed) return;
      for (const l of listeners) l(snapshot);
    });
  };

  const serialize = (): string => {
    const out: Record<string, unknown> = {};
    for (const [id, doc] of docs) {
      let hit = packed.get(id);
      if (!hit || hit.project !== doc.project) {
        hit = { project: doc.project, z: LZString.compressToUTF16(doc.project) };
        packed.set(id, hit);
      }
      out[id] = { ...doc, project: hit.z, z: true };
    }
    return JSON.stringify({ v: 1, docs: out });
  };

  // --- revisions --------------------------------------------------------------------------------------------

  type RevisionStore = Record<Id, Record<string, Record<string, unknown>>>;
  const readRevisions = (): RevisionStore => {
    try {
      const raw = readKey(LOCAL_KEYS.revisions);
      const parsed = raw === null ? null : (JSON.parse(raw) as unknown);
      return isRecord(parsed) && isRecord(parsed.byId) ? (parsed.byId as RevisionStore) : {};
    } catch {
      return {};
    }
  };
  const writeRevisions = (byId: RevisionStore): boolean => writeKey(LOCAL_KEYS.revisions, JSON.stringify({ v: 1, byId }));

  /** Drop the oldest half of every proposal's revisions (quota relief). */
  const shrinkRevisions = (): void => {
    const byId = readRevisions();
    for (const [pid, revs] of Object.entries(byId)) {
      const ids = Object.keys(revs).sort();
      for (const id of ids.slice(0, Math.ceil(ids.length / 2))) delete revs[id];
      const doc = docs.get(pid);
      if (doc) doc.revisions = doc.revisions.filter((r) => r in revs);
    }
    writeRevisions(byId);
  };

  /** Persist `docs`; on a quota failure shrink the revisions once and retry. */
  const persist = (): boolean => {
    let text = serialize();
    if (!writeKey(LOCAL_KEYS.proposals, text)) {
      shrinkRevisions();
      text = serialize();
      if (!writeKey(LOCAL_KEYS.proposals, text)) return false;
    }
    lastRaw = text;
    return true;
  };

  const proposalOf = (id: Id, doc: ProposalDoc): Proposal | null => {
    const d = decode(id, doc);
    return d.status === 'ok' ? { ...metaOf(id, doc), variant: d.variant } : null;
  };

  const byOf = (by: string | null | undefined): string | null => (by === undefined ? cleanName(names.get()) : cleanName(by));

  // --- the store --------------------------------------------------------------------------------------------

  const saveProposal = async (variant: Variant, o: SaveOptions): Promise<SaveResult> => {
    reload();
    const id = variant.id;
    const cur = docs.get(id);
    const at = o.at ?? stamp(cur?.updatedAt);
    const plan = planSave(cur, variant, { ...o, at, by: byOf(o.by) }, context());
    if (plan.kind === 'conflict') return { status: 'conflict', remote: plan.remote === 'current' && cur ? proposalOf(id, cur) : null };
    const next = plan.doc;
    if (plan.revision) {
      const byId = readRevisions();
      const mine = (byId[id] ??= {});
      mine[plan.revision.id] = { ...pack(plan.revision.doc) };
      for (const old of plan.pruned) delete mine[old];
      // No room for the revision: the proposal itself is still saved, without it.
      if (!writeRevisions(byId)) {
        next.revisions = cur?.revisions ?? [];
        next.lastRevisionAt = cur?.lastRevisionAt ?? null;
      }
    }
    docs.set(id, next);
    if (!persist()) {
      if (cur) docs.set(id, cur);
      else docs.delete(id);
      rebuild();
      return { status: 'error', error: 'quota' };
    }
    emit();
    const saved = proposalOf(id, next);
    return saved ? { status: 'saved', proposal: saved } : { status: 'error', error: 'decode' };
  };

  const store: FamilyStore = {
    mode: 'local',
    familyId: null,

    listProposals(onChange) {
      listeners.add(onChange);
      if (reload()) rebuild();
      queueMicrotask(() => {
        if (!disposed && listeners.has(onChange)) onChange(list);
      });
      return () => listeners.delete(onChange);
    },

    currentList: () => list,

    async getProposal(id) {
      reload();
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
      reload();
      const doc = docs.get(id);
      const p = doc && doc.deletedAt === null ? proposalOf(id, doc) : null;
      const clean = cleanName(name);
      if (!p || !doc || !clean) return { status: 'conflict', remote: p };
      return saveProposal({ ...p.variant, name: clean }, { base: o.base === undefined ? doc.updatedAt : o.base, at: o.at, by: o.by });
    },

    async deleteProposal(id, o = {}) {
      reload();
      const doc = docs.get(id);
      if (!doc || doc.deletedAt !== null) return;
      const at = o.at ?? stamp(doc.updatedAt);
      docs.set(id, { ...doc, deletedAt: at, updatedAt: at, updatedBy: byOf(o.by) });
      if (!persist()) {
        docs.set(id, doc);
        rebuild();
        return;
      }
      emit();
    },

    async restoreProposal(id, o = {}) {
      reload();
      const doc = docs.get(id);
      if (!doc) return null;
      if (doc.deletedAt === null) return proposalOf(id, doc);
      const at = o.at ?? stamp(doc.updatedAt);
      const next: ProposalDoc = { ...doc, deletedAt: null, updatedAt: at, updatedBy: byOf(o.by) };
      docs.set(id, next);
      if (!persist()) {
        docs.set(id, doc);
        rebuild();
        return null;
      }
      emit();
      return proposalOf(id, next);
    },

    async listTrash() {
      if (reload()) rebuild();
      return list.trash;
    },

    async purgeTrash(at = new Date(now())) {
      reload();
      const limit = at.getTime() - TRASH_MS;
      const gone: Id[] = [];
      for (const [id, doc] of docs) {
        const t = doc.deletedAt === null ? NaN : Date.parse(doc.deletedAt);
        if (Number.isFinite(t) && t < limit) gone.push(id);
      }
      if (gone.length === 0) return 0;
      const before = new Map(docs);
      for (const id of gone) docs.delete(id);
      if (!persist()) {
        docs = before;
        return 0;
      }
      const byId = readRevisions();
      for (const id of gone) delete byId[id];
      writeRevisions(byId);
      emit();
      return gone.length;
    },

    async listRevisions(id) {
      const revs = readRevisions()[id] ?? {};
      const out: RevisionInfo[] = [];
      for (const [revId, raw] of Object.entries(revs)) {
        const doc = isRecord(raw) ? readRevisionDoc(unpack(raw)) : null;
        if (doc) out.push({ id: revId, proposalId: id, name: doc.name, savedAt: doc.savedAt, savedBy: doc.savedBy });
      }
      return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || b.id.localeCompare(a.id));
    },

    async restoreRevision(id, revisionId, o = {}) {
      reload();
      const cur = docs.get(id);
      const raw = readRevisions()[id]?.[revisionId];
      const rev = isRecord(raw) ? readRevisionDoc(unpack(raw)) : null;
      if (!cur || cur.deletedAt !== null || !rev) return { status: 'error', error: 'missing' };
      const decoded = decodeProposalProject(rev.project, id, cur.name);
      if (decoded.status !== 'ok') return { status: 'error', error: decoded.status };
      return saveProposal(decoded.variant, { base: cur.updatedAt, force: true, forceRevision: true, at: o.at, by: o.by });
    },

    async keepRevision(id, variant, saved) {
      reload();
      const cur = docs.get(id);
      if (!cur) return false;
      const plan = planKeepRevision(cur, variant, saved, context());
      const byId = readRevisions();
      const mine = (byId[id] ??= {});
      mine[plan.revision.id] = { ...pack(plan.revision.doc) };
      for (const old of plan.pruned) delete mine[old];
      if (!writeRevisions(byId)) return false;
      docs.set(id, plan.doc);
      if (!persist()) {
        docs.set(id, cur);
        return false;
      }
      emit();
      return true;
    },

    whoAmI: () => names.get(),
    setMyName: (name) => names.set(name),

    status: () => READY,
    onStatus: () => () => {},
    onWriteError: () => () => {},
    flush: async () => {},

    dispose() {
      disposed = true;
      listeners.clear();
      target?.removeEventListener('storage', onStorage);
    },
  };

  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== LOCAL_KEYS.proposals) return;
    if (reload()) emit();
  };
  target?.addEventListener('storage', onStorage);

  reload();
  rebuild();
  return store;
}
