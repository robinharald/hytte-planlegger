/**
 * The family's proposals ("Forslag") behind one interface (docs/phase2-plan.md §5).
 *
 * One family space, identified by an unguessable id in the link (`#f=<24–64 chars>`), holds the proposals. The bundled
 * Forslag D is NOT stored here: it is the app's own locked base, always the current bundled one. Every proposal is a
 * whole `Variant` (trees and ghosts included). Two implementations share the document format of this file:
 *
 *  - familyStore.local.ts      localStorage (no Firebase config, tests, forks): "Kun på denne enheten".
 *  - familyStore.firestore.ts  Firestore with anonymous auth and the IndexedDB cache, loaded with `import()` only when
 *                              a config exists, so the bundle without one never loads Firebase.
 *
 * familyStore.sync.ts keeps the app store and a FamilyStore in step (debounced autosave, live merge, conflict guard).
 *
 * Data layout (fits firestore.rules: anything below /families/{familyId}/ when the id is 24–64 characters):
 *   families/{familyId}/proposals/{proposalId}                    ProposalDoc
 *   families/{familyId}/proposals/{proposalId}/revisions/{revId}  RevisionDoc
 * `project` is the JSON TEXT of a one-variant Project (Firestore has no nested arrays, and `[x, y]` points are
 * arrays in arrays). Privacy: a document holds the proposal, the display name the user typed ("Mamma") and
 * timestamps — nothing else (no e-mail, device, user agent or place).
 *
 * Rules every implementation follows:
 *  - `saveProposal(variant, { base })` is the conflict guard: `base` is the `updatedAt` the caller's copy is based on
 *    (null for a new proposal). When the stored proposal has another `updatedAt` (someone saved in between), nothing
 *    is written and the result is `conflict` with the stored version (or `remote: null` when it was deleted). `force`
 *    writes anyway ("Lagre over"). A soft-deleted proposal saved with `base: null` is restored and overwritten (undo
 *    of a delete).
 *  - Revisions: a save that replaces content whose last revision is older than REVISION_INTERVAL_MS (or that has none)
 *    first keeps the replaced content as a revision ("one per save burst, at most one per 5 minutes"); at most
 *    REVISION_LIMIT per proposal, the oldest go first. `restoreRevision` always keeps the current content first. A
 *    content save adds its own revision id to the stored list and never writes the list itself (Firestore: merge +
 *    arrayUnion), so a save from an old view keeps the revisions others added.
 *  - Delete is soft (`deletedAt`): the proposal sits in the Papirkurv for TRASH_DAYS days and can be restored; older
 *    ones are purged (with their revisions) by `purgeTrash`. Delete, restore and `keepRevision` are FIELD UPDATES
 *    (`ProposalPatch`): they never write the content, so a delete made from an out-of-date view (an offline device)
 *    lands on the newest version and keeps it. A delete / restore adds the version it was made from to `lineage`, so
 *    the device that saved a newer version can tell it was deleted unseen. Writing over a proposal in the Papirkurv
 *    with other content keeps the content that was there as a revision first.
 *  - `listProposals` is a live subscription: the callback gets the whole list right away (or as soon as it is known)
 *    and again after every change, own writes included.
 */
import { nanoid } from 'nanoid';
import { migrateProject, SchemaTooNewError } from '../model/migrate';
import { CURRENT_SCHEMA_VERSION } from '../model/types';
import type { Id, Project, Site, Variant } from '../model/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FAMILY_ID_MIN = 24;
export const FAMILY_ID_MAX = 64;
/** firestore.rules allow 24–64 characters; generated ids use nanoid's URL-safe alphabet. */
const FAMILY_ID_RE = /^[A-Za-z0-9_-]{24,64}$/;
export const FAMILY_ID_LENGTH = 32;

export const TRASH_DAYS = 30;
export const TRASH_MS = TRASH_DAYS * 24 * 60 * 60 * 1000;
export const REVISION_LIMIT = 20;
export const REVISION_INTERVAL_MS = 5 * 60 * 1000;
/** How many ancestor versions a proposal document remembers (`ProposalDoc.lineage`). */
export const LINEAGE_LIMIT = 12;
/** Longest display name kept ("Hva heter du?"). */
export const NAME_MAX = 40;

/** localStorage keys of the family layer (the local store's own data keys are in familyStore.local.ts). */
export const FAMILY_KEYS = {
  /** The family id this device uses (from a `#f=` link, or generated once). */
  familyId: 'hytte-planlegger:family',
  /** Family ids used before a `#f=` link switched to another one (nothing is lost). */
  previousFamilies: 'hytte-planlegger:family.previous',
  /** The family this device switched away from, until its proposals were offered («Hent forslagene …») or declined. */
  switchedFrom: 'hytte-planlegger:family.switched-from',
  /** `{ [familyId]: proposalId[] }`: proposals this device created in each family (what a switch can bring along). */
  createdHere: 'hytte-planlegger:family.created',
  /** `{ [familyId]: proposalId[] }`: copies brought into each family from a previous one («Hent forslagene …»): never offered again. */
  carriedIn: 'hytte-planlegger:family.carried-in',
  /** `{ from, ids }`: what a switch offers — the proposals created in `from` before the switch (not carried-in copies). */
  switchOffer: 'hytte-planlegger:family.switch-offer',
  /** `…:<familyId | 'local'>` → `{ [proposalId]: updatedAt[] }`: the last versions this device saved (the sync's notices). */
  ownVersions: 'hytte-planlegger:own-versions',
  /** The display name ("Hva heter du?"); '' = the user declined. */
  myName: 'hytte-planlegger:my-name',
  /** 'local' | 'shared': overrides the automatic choice (tests, debugging). */
  modeOverride: 'hytte-planlegger:family-mode',
  /** The proposal on screen when the app was last used (per family / 'local'). */
  activeProposal: 'hytte-planlegger:active-proposal',
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FamilyMode = 'local' | 'shared';

/** What the UI shows about a proposal without reading it. */
export interface ProposalMeta {
  id: Id;
  name: string;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  /** Papirkurv: when it was deleted (ISO), null when it is not deleted. */
  deletedAt: string | null;
  /** `updatedAt` of the versions this one descends from, newest last (at most LINEAGE_LIMIT). */
  lineage: string[];
  /** This version was written with «Lagre over» over the version stamped so (kept as a revision): its writer is told. */
  overwrote?: string;
}

/**
 * A field update of a stored proposal (soft delete / restore, an extra revision): only these fields change, the content
 * stays what the server has (Firestore `update` with `arrayUnion` / `arrayRemove`), so nothing another device saved
 * meanwhile is written over.
 */
export interface ProposalPatch {
  set: Partial<Pick<ProposalDoc, 'deletedAt' | 'updatedAt' | 'updatedBy'>>;
  /** Values added to these arrays when they are not there yet (arrayUnion). */
  add?: Partial<Record<'lineage' | 'revisions', string[]>>;
  /** Values removed from these arrays (arrayRemove), after `add`. */
  remove?: Partial<Record<'revisions', string[]>>;
}

export interface Proposal extends ProposalMeta {
  /** The proposal, migrated to the current schema; never `locked`, no `meta`; `variant.id` = the proposal id. */
  variant: Variant;
}

/** Stored document of a proposal (both implementations). */
export interface ProposalDoc {
  name: string;
  /** JSON text of a Project with exactly this proposal (`variants: [variant]`, `activeVariantId` = its id). */
  project: string;
  schemaVersion: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  deletedAt: string | null;
  /**
   * `updatedAt` of the versions this one descends from (the writer's view), newest last, at most LINEAGE_LIMIT. A
   * device whose own last save is not in the lineage of a newer version knows it was overwritten unseen (an offline
   * device's queued save: last write wins) and keeps its version as a revision (familyStore.sync.ts).
   */
  lineage: string[];
  /** When the newest revision was taken (null: none yet). */
  lastRevisionAt: string | null;
  /** Revision ids, oldest first (at most REVISION_LIMIT): pruning needs no query, also offline. */
  revisions: string[];
  /**
   * Set by «Lagre over» (`SaveOptions.overwrite`): the `updatedAt` of the version it wrote over (kept as a revision), so
   * the device that saved that version can say so; written as null by the next content save (absent on older documents).
   */
  overwrote?: string | null;
}

/** Stored document of a revision ("Tidligere versjoner"): the proposal as it was saved at `savedAt` by `savedBy`. */
export interface RevisionDoc {
  name: string;
  project: string;
  schemaVersion: number;
  savedAt: string;
  savedBy: string | null;
  /** 'saveOver': the version a «Lagre over» put aside (absent for the other revisions). */
  reason?: 'saveOver';
}

export interface RevisionInfo {
  id: string;
  proposalId: Id;
  name: string;
  savedAt: string;
  savedBy: string | null;
  /** 'saveOver': put aside by «Lagre over» (Tidligere versjoner tags it). */
  reason?: 'saveOver';
  /** A version this device saved (set by appStore.ts `listRevisions`; Tidligere versjoner tags it «din»). */
  own?: boolean;
}

export interface ProposalList {
  /** Proposals that are not deleted, oldest first (createdAt). */
  proposals: Proposal[];
  /** The Papirkurv: deleted within TRASH_DAYS, newest deletion first. */
  trash: ProposalMeta[];
  /** Stored by a newer app version (schema too new): never shown, never written. */
  tooNew: ProposalMeta[];
  /**
   * Shared: only this device's cache answered, not the server (a slow or blocked connection, offline). An empty list
   * then says nothing about the space. Absent once the server answered (and always in the local store).
   */
  fromCache?: boolean;
}

export type SaveResult =
  | { status: 'saved'; proposal: Proposal }
  /** `remote` = the stored version that is newer than `base`; null when it was deleted meanwhile. */
  | { status: 'conflict'; remote: Proposal | null }
  | { status: 'error'; error: string };

export interface SaveOptions {
  /** `updatedAt` of the stored version the caller's copy is based on; null for a new proposal. */
  base: string | null;
  /** Write even when the stored version is newer ("Lagre over"). */
  force?: boolean;
  /** Timestamp to write (the sync passes its own so it recognises the echo of its write); default now. */
  at?: string;
  /** Display name to tag the save with; default `whoAmI()`. */
  by?: string | null;
  /** Keep the replaced content as a revision even within REVISION_INTERVAL_MS. */
  forceRevision?: boolean;
  /**
   * «Lagre over»: the version written over is kept as a revision tagged 'saveOver', and the document names it
   * (`overwrote`), so the device that saved it is told.
   */
  overwrite?: boolean;
}

/** Connection state for the status pill. */
export interface FamilyStoreStatus {
  /** 'connecting' until the first list is known; 'error' when signing in or reading failed. */
  phase: 'connecting' | 'ready' | 'error';
  /**
   * Writes on this device that the server has not confirmed yet — also those queued before this page was loaded (an
   * offline reload) or by another tab (always 0 for the local store).
   */
  pending: number;
  online: boolean;
  error: string | null;
}

export interface FamilyStore {
  readonly mode: FamilyMode;
  /** The family id (shared), null in local mode. */
  readonly familyId: string | null;
  /** Live list (see the header); returns the unsubscribe function. */
  listProposals(onChange: (list: ProposalList) => void): () => void;
  /** The latest list known (empty before the first one). */
  currentList(): ProposalList;
  getProposal(id: Id): Promise<Proposal | null>;
  saveProposal(variant: Variant, opts: SaveOptions): Promise<SaveResult>;
  /** A new proposal: a copy of `from` (Forslag D or another proposal) named `name`, unlocked, with a new id. */
  createProposal(from: Variant, name: string, opts?: { id?: Id; at?: string; by?: string | null }): Promise<Proposal>;
  renameProposal(id: Id, name: string, opts?: { base?: string | null; at?: string; by?: string | null }): Promise<SaveResult>;
  /** Soft delete: into the Papirkurv. */
  deleteProposal(id: Id, opts?: { at?: string; by?: string | null }): Promise<void>;
  /** Back from the Papirkurv; null when it is not there (purged). */
  restoreProposal(id: Id, opts?: { at?: string; by?: string | null }): Promise<Proposal | null>;
  listTrash(): Promise<ProposalMeta[]>;
  /** Delete proposals that have been in the Papirkurv longer than TRASH_DAYS (and their revisions). */
  purgeTrash(now?: Date): Promise<number>;
  /** Newest first. */
  listRevisions(id: Id): Promise<RevisionInfo[]>;
  /** The revision becomes the current content (the current content is kept as a revision first); the name stays. */
  restoreRevision(id: Id, revisionId: string, opts?: { at?: string; by?: string | null }): Promise<SaveResult>;
  /** Keep `variant` as a revision of the proposal (the current content stays); false when the proposal is gone. */
  keepRevision(id: Id, variant: Variant, saved: { savedAt: string; savedBy: string | null }): Promise<boolean>;
  /** The display name of this device ("Hva heter du?"), null when never asked, '' when declined. */
  whoAmI(): string | null;
  setMyName(name: string): void;
  status(): FamilyStoreStatus;
  onStatus(cb: (s: FamilyStoreStatus) => void): () => void;
  /** A write of this proposal was refused (shared; the store keeps showing it, the caller should write it again). */
  onWriteError(cb: (id: Id) => void): () => void;
  /** Resolves when the writes made so far are stored for everyone (shared) / right away (local). */
  flush(): Promise<void>;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Ids and names
// ---------------------------------------------------------------------------

export function isValidFamilyId(id: unknown): id is string {
  return typeof id === 'string' && FAMILY_ID_RE.test(id);
}

export function newFamilyId(): string {
  return nanoid(FAMILY_ID_LENGTH);
}

export function newProposalId(): string {
  return nanoid(10);
}

/** A proposal id that is also a valid Firestore document id (no '/', not '.' / '..', no `__x__`, ≤ 200 chars). */
export function isValidProposalId(id: string): boolean {
  return /^[A-Za-z0-9_.-]{1,200}$/.test(id) && id !== '.' && id !== '..' && !/^__.*__$/.test(id);
}

/** Trimmed, at most NAME_MAX characters, null when empty. */
export function cleanName(name: string | null | undefined): string | null {
  const t = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return t.length > 0 ? t : null;
}

/** Stored display name: null when never asked, '' when declined. Every storage access is guarded. */
export function readMyName(storage: Pick<Storage, 'getItem'> | null): string | null {
  try {
    const v = storage?.getItem(FAMILY_KEYS.myName);
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function writeMyName(storage: Pick<Storage, 'setItem'> | null, name: string): void {
  try {
    storage?.setItem(FAMILY_KEYS.myName, cleanName(name) ?? '');
  } catch {
    // storage blocked: the name lasts for this page only (the caller keeps it in memory)
  }
}

/** The display name of this device, in storage with an in-memory fallback (storage blocked). */
export function createMyName(storage: Pick<Storage, 'getItem' | 'setItem'> | null): { get(): string | null; set(name: string): void } {
  let memory: string | null = null;
  return {
    get: () => readMyName(storage) ?? memory,
    set: (name) => {
      memory = cleanName(name) ?? '';
      writeMyName(storage, name);
    },
  };
}

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

/**
 * Local or shared (Firestore): shared only with a Firebase config, outside tests, and not under browser automation
 * (Playwright: `navigator.webdriver`), so tests never touch the real family space. An explicit override wins over
 * the automation rule: the build-time `VITE_FAMILY_STORE` ('local' | 'shared'), then the stored
 * `hytte-planlegger:family-mode` (set from a test's init script). Without a config it is always local.
 */
export function resolveFamilyMode(env: {
  hasConfig: boolean;
  testMode?: boolean;
  buildOverride?: string | null;
  storedOverride?: string | null;
  webdriver?: boolean;
}): FamilyMode {
  if (!env.hasConfig) return 'local';
  if (env.buildOverride === 'local' || env.buildOverride === 'shared') return env.buildOverride;
  if (env.testMode) return 'local';
  if (env.storedOverride === 'local' || env.storedOverride === 'shared') return env.storedOverride;
  return env.webdriver ? 'local' : 'shared';
}

// ---------------------------------------------------------------------------
// Links: #f=<family>&p=<proposal>&d=<shared copy>
// ---------------------------------------------------------------------------

export interface HashParams {
  family: string | null;
  proposal: string | null;
  delta: string | null;
}

/**
 * The family id of a `f=` value: percent-decoded, and without what a message or a sentence adds after a link
 * («#f=<id>.», «(#f=<id>)», «#f=<id>,»): ids never contain anything but [A-Za-z0-9_-], so trailing other characters go.
 */
function familyIdOf(value: string): string {
  let v = value;
  try {
    v = decodeURIComponent(value);
  } catch {
    // keep the raw value
  }
  v = v.replace(/[^A-Za-z0-9_-]+$/, '');
  // Generated ids are exactly FAMILY_ID_LENGTH characters: one more ending in `_` or `-` is a link copied with the
  // underscore or hyphen of the message around it (chat italics `_…_`).
  return v.length === FAMILY_ID_LENGTH + 1 && /[_-]$/.test(v) ? v.slice(0, -1) : v;
}

/** Parse `#f=…&p=…&d=…` (any order; unknown parts ignored; an invalid family id counts as absent). */
export function parseHash(hash: string): HashParams {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const out: HashParams = { family: null, proposal: null, delta: null };
  for (const part of body.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (!value) continue;
    if (key === 'f') {
      const id = familyIdOf(value);
      out.family = isValidFamilyId(id) ? id : null;
    }
    else if (key === 'p') {
      let id = value;
      try {
        id = decodeURIComponent(value);
      } catch {
        // keep the raw value
      }
      out.proposal = isValidProposalId(id) ? id : null;
    } else if (key === 'd') out.delta = value;
  }
  return out;
}

/** Did the hash name a family (valid or not)? */
export function hashHasFamily(hash: string): boolean {
  return /(^#?|&)f=/.test(hash);
}

/** `#f=<family>` (+ `&p=<proposal>`); `#p=<proposal>` without a family; '' for neither. */
export function familyHash(familyId: string | null, proposalId?: string | null): string {
  const parts: string[] = [];
  if (familyId) parts.push(`f=${familyId}`);
  if (proposalId) parts.push(`p=${encodeURIComponent(proposalId)}`);
  return parts.length > 0 ? `#${parts.join('&')}` : '';
}

/** The family link ("Familielenke") or a proposal's deep link, on `baseUrl` (page URL without hash). */
export function familyLink(baseUrl: string, familyId: string, proposalId?: string | null): string {
  return `${baseUrl.split('#')[0]}${familyHash(familyId, proposalId)}`;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** The variant as stored: never locked, no shared-store `meta` (metadata lives in the document), id = proposal id. */
export function cleanVariant(variant: Variant, id: Id = variant.id, name: string = variant.name): Variant {
  const copy: Variant = { ...variant, id, name };
  delete copy.locked;
  delete copy.meta;
  return copy;
}

/** What a stored proposal carries besides the variant (a valid Project needs a site; the seed revision is informative). */
export interface EncodeContext {
  site: Site;
  seedRevision: number;
}

/**
 * JSON text of the one-variant Project stored for a proposal. Deterministic for the same content (no save time in
 * it), so equal text means equal content.
 */
export function encodeProposalProject(variant: Variant, ctx: EncodeContext): string {
  const v = cleanVariant(variant);
  const project: Project = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: v.id,
    name: v.name,
    createdAt: v.createdAt,
    updatedAt: v.createdAt,
    seedRevision: ctx.seedRevision,
    site: ctx.site,
    variants: [v],
    activeVariantId: v.id,
  };
  return JSON.stringify(project);
}

export type DecodedProject = { status: 'ok'; variant: Variant } | { status: 'too-new'; version: number } | { status: 'invalid'; error: string };

/** The proposal's variant from the stored JSON text (migrated; never throws). */
export function decodeProposalProject(text: string, id: Id, name: string): DecodedProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { status: 'invalid', error: 'not JSON' };
  }
  try {
    const project = migrateProject(raw);
    const variant = project.variants.find((v) => v.id === project.activeVariantId) ?? project.variants[0];
    if (!variant) return { status: 'invalid', error: 'no variant' };
    return { status: 'ok', variant: cleanVariant(variant, id, name) };
  } catch (e) {
    if (e instanceof SchemaTooNewError) return { status: 'too-new', version: e.schemaVersion };
    return { status: 'invalid', error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * `decodeProposalProject` memoised per stored version (`id`, `updatedAt`, name and text): an unchanged proposal keeps
 * the SAME variant object across list updates (cheap, and the app's derive memo stays warm).
 */
export function createDecoder(): (id: Id, doc: ProposalDoc) => DecodedProject {
  const cache = new Map<Id, { key: string; project: string; result: DecodedProject }>();
  return (id, doc) => {
    const key = `${doc.updatedAt}\u0000${doc.name}`;
    const hit = cache.get(id);
    if (hit && hit.key === key && hit.project === doc.project) return hit.result;
    const result = decodeProposalProject(doc.project, id, doc.name);
    cache.set(id, { key, project: doc.project, result });
    return result;
  };
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** A stored document checked field by field (anything malformed → null; the proposal is then skipped, never deleted). */
export function readProposalDoc(raw: unknown): ProposalDoc | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name);
  const project = str(r.project);
  const createdAt = str(r.createdAt);
  const updatedAt = str(r.updatedAt);
  if (name === null || project === null || createdAt === null || updatedAt === null) return null;
  return {
    name,
    project,
    schemaVersion: typeof r.schemaVersion === 'number' ? r.schemaVersion : 1,
    createdAt,
    createdBy: str(r.createdBy),
    updatedAt,
    updatedBy: str(r.updatedBy),
    deletedAt: str(r.deletedAt),
    lineage: Array.isArray(r.lineage) ? r.lineage.filter((x): x is string => typeof x === 'string') : [],
    lastRevisionAt: str(r.lastRevisionAt),
    revisions: Array.isArray(r.revisions) ? r.revisions.filter((x): x is string => typeof x === 'string') : [],
    ...(typeof r.overwrote === 'string' ? { overwrote: r.overwrote } : {}),
  };
}

export function readRevisionDoc(raw: unknown): RevisionDoc | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name);
  const project = str(r.project);
  const savedAt = str(r.savedAt);
  if (name === null || project === null || savedAt === null) return null;
  return {
    name,
    project,
    schemaVersion: typeof r.schemaVersion === 'number' ? r.schemaVersion : 1,
    savedAt,
    savedBy: str(r.savedBy),
    ...(r.reason === 'saveOver' ? { reason: 'saveOver' as const } : {}),
  };
}

/** What Tidligere versjoner lists of a stored revision. */
export function revisionInfoOf(id: string, proposalId: Id, doc: RevisionDoc): RevisionInfo {
  return { id, proposalId, name: doc.name, savedAt: doc.savedAt, savedBy: doc.savedBy, ...(doc.reason ? { reason: doc.reason } : {}) };
}

export function metaOf(id: Id, doc: ProposalDoc): ProposalMeta {
  return {
    id,
    name: doc.name,
    createdAt: doc.createdAt,
    createdBy: doc.createdBy,
    updatedAt: doc.updatedAt,
    updatedBy: doc.updatedBy,
    deletedAt: doc.deletedAt,
    lineage: doc.lineage,
    ...(typeof doc.overwrote === 'string' ? { overwrote: doc.overwrote } : {}),
  };
}

/** Sort and split stored documents into the list every implementation reports. */
export function buildList(docs: Iterable<[Id, ProposalDoc]>, now: number, decode: (id: Id, doc: ProposalDoc) => DecodedProject): ProposalList {
  const proposals: Proposal[] = [];
  const trash: ProposalMeta[] = [];
  const tooNew: ProposalMeta[] = [];
  for (const [id, doc] of docs) {
    if (doc.deletedAt !== null) {
      const t = Date.parse(doc.deletedAt);
      if (!Number.isFinite(t) || now - t <= TRASH_MS) trash.push(metaOf(id, doc));
      continue;
    }
    if (doc.schemaVersion > CURRENT_SCHEMA_VERSION) {
      tooNew.push(metaOf(id, doc));
      continue;
    }
    const d = decode(id, doc);
    if (d.status === 'ok') proposals.push({ ...metaOf(id, doc), variant: d.variant });
    else if (d.status === 'too-new') tooNew.push(metaOf(id, doc));
  }
  proposals.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  trash.sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
  return { proposals, trash, tooNew };
}

/** Should a save that replaces `doc` keep its content as a revision first? */
export function wantsRevision(doc: ProposalDoc, at: string, force = false): boolean {
  if (force || doc.lastRevisionAt === null) return true;
  const last = Date.parse(doc.lastRevisionAt);
  const now = Date.parse(at);
  return !Number.isFinite(last) || !Number.isFinite(now) || now - last >= REVISION_INTERVAL_MS;
}

/** The stored text with the names blanked: a rename alone is not new content (no revision for it). */
function contentText(text: string): string {
  try {
    const p = JSON.parse(text) as { name?: string; variants?: { name?: string }[] };
    p.name = '';
    for (const v of p.variants ?? []) v.name = '';
    return JSON.stringify(p);
  } catch {
    return text;
  }
}

function sameStoredContent(a: string, b: string): boolean {
  return a === b || contentText(a) === contentText(b);
}

export type SavePlan =
  | { kind: 'conflict'; remote: 'current' | 'deleted' }
  | {
      kind: 'write';
      doc: ProposalDoc;
      /** The replaced content, kept as a revision. */
      revision: { id: string; doc: RevisionDoc } | null;
      /** Revision ids to delete (beyond REVISION_LIMIT). */
      pruned: string[];
    };

/**
 * The save rules of every FamilyStore (header): the conflict guard, the new document and the revision to keep. Pure:
 * `cur` is the stored document (undefined when there is none), `at` / `by` the stamp and name to write.
 */
export function planSave(cur: ProposalDoc | undefined, variant: Variant, o: SaveOptions & { at: string; by: string | null }, ctx: EncodeContext): SavePlan {
  if (!o.force) {
    if (cur && cur.deletedAt === null && o.base !== cur.updatedAt) return { kind: 'conflict', remote: 'current' };
    if (cur && cur.deletedAt !== null && o.base !== null) return { kind: 'conflict', remote: 'deleted' };
    if (!cur && o.base !== null) return { kind: 'conflict', remote: 'deleted' };
  }
  const clean = cleanVariant(variant);
  const project = encodeProposalProject(clean, ctx);
  const doc: ProposalDoc = {
    name: clean.name,
    project,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: cur?.createdAt ?? o.at,
    createdBy: cur ? cur.createdBy : o.by,
    updatedAt: o.at,
    updatedBy: o.by,
    deletedAt: null,
    lineage: cur ? [...cur.lineage, cur.updatedAt].slice(-LINEAGE_LIMIT) : [],
    lastRevisionAt: cur?.lastRevisionAt ?? null,
    revisions: cur?.revisions ?? [],
    // A «Lagre over» marker of an earlier save is cleared by this one (merge writes keep fields they leave out).
    ...(typeof cur?.overwrote === 'string' ? { overwrote: null } : {}),
  };
  // A proposal in the Papirkurv written over with other content (Angre of a delete that landed on a newer version,
  // "Lagre over" of a deleted one): what was there is kept as a revision, whatever the interval.
  const trashed = cur !== undefined && cur.deletedAt !== null;
  if (!cur || sameStoredContent(cur.project, project) || (!trashed && !wantsRevision(cur, o.at, o.forceRevision))) {
    return { kind: 'write', doc, revision: null, pruned: [] };
  }
  const id = newRevisionId(cur.updatedAt);
  const ids = [...cur.revisions, id];
  const keep = ids.slice(-REVISION_LIMIT);
  // «Lagre over» over a version that was not in the Papirkurv: the document and the revision say so.
  const savedOver = o.overwrite === true && !trashed;
  const revision: RevisionDoc = { name: cur.name, project: cur.project, schemaVersion: cur.schemaVersion, savedAt: cur.updatedAt, savedBy: cur.updatedBy };
  return {
    kind: 'write',
    doc: { ...doc, revisions: keep, lastRevisionAt: o.at, ...(savedOver ? { overwrote: cur.updatedAt } : {}) },
    revision: { id, doc: savedOver ? { ...revision, reason: 'saveOver' } : revision },
    pruned: ids.slice(0, ids.length - keep.length),
  };
}

/**
 * Keeping `variant` as an extra revision (`keepRevision`): the content stays, only the revision ids change (`patch`:
 * the new id added, the ones beyond REVISION_LIMIT removed); `doc` is `cur` with the patch applied.
 */
export function planKeepRevision(cur: ProposalDoc, variant: Variant, saved: { savedAt: string; savedBy: string | null }, ctx: EncodeContext): {
  doc: ProposalDoc;
  patch: ProposalPatch;
  revision: { id: string; doc: RevisionDoc };
  pruned: string[];
} {
  const id = newRevisionId(saved.savedAt);
  const ids = [...cur.revisions, id].sort();
  const keep = ids.slice(-REVISION_LIMIT);
  const v = cleanVariant(variant);
  const pruned = ids.filter((r) => !keep.includes(r));
  const patch: ProposalPatch = { set: {}, add: { revisions: [id] }, ...(pruned.length > 0 ? { remove: { revisions: pruned } } : {}) };
  return {
    doc: applyPatch(cur, patch),
    patch,
    revision: { id, doc: { name: v.name, project: encodeProposalProject(v, ctx), schemaVersion: CURRENT_SCHEMA_VERSION, savedAt: saved.savedAt, savedBy: saved.savedBy } },
    pruned,
  };
}

/**
 * Soft delete (`deleted`) or restore of `cur` as a field update stamped `at` / `by`: the content is not touched, and
 * the version it was made from (`cur.updatedAt`) joins the lineage, so the device whose newer version the delete
 * landed on can tell it was deleted unseen (familyStore.sync.ts).
 */
export function planDeleted(cur: ProposalDoc, deleted: boolean, at: string, by: string | null): ProposalPatch {
  return { set: { deletedAt: deleted ? at : null, updatedAt: at, updatedBy: by }, add: { lineage: [cur.updatedAt] } };
}

/** `doc` with `patch` applied (what the server does with the field update). */
export function applyPatch(doc: ProposalDoc, patch: ProposalPatch): ProposalDoc {
  const next: ProposalDoc = { ...doc, ...patch.set };
  for (const key of ['lineage', 'revisions'] as const) {
    const add = patch.add?.[key];
    if (!add || add.length === 0) continue;
    const values = [...next[key]];
    for (const x of add) if (!values.includes(x)) values.push(x);
    next[key] = values;
  }
  const remove = patch.remove?.revisions;
  if (remove && remove.length > 0) next.revisions = next.revisions.filter((r) => !remove.includes(r));
  return next;
}

/** A sortable revision id: time in base 36 (fixed width) + a random tail. */
export function newRevisionId(at: string): string {
  const t = Date.parse(at);
  const stamp = (Number.isFinite(t) ? t : Date.now()).toString(36).padStart(9, '0');
  return `r${stamp}-${nanoid(4)}`;
}

/** Monotonic ISO stamps per store: never the same twice, never backwards (the conflict guard compares them). */
export function createStamper(now: () => number = Date.now): (...after: (string | null | undefined)[]) => string {
  let last = 0;
  return (...after) => {
    let t = Math.max(now(), last + 1);
    for (const a of after) {
      const ms = a ? Date.parse(a) : NaN;
      if (Number.isFinite(ms) && ms >= t) t = ms + 1;
    }
    last = t;
    return new Date(t).toISOString();
  };
}

/** Content equality of two proposals' variants (ignores `locked` / `meta`, key order and undefined fields). */
export function sameContent(a: Variant, b: Variant): boolean {
  return jsonEqualLoose(cleanVariant(a), cleanVariant(b));
}

function jsonEqualLoose(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b || (Number.isNaN(a) && Number.isNaN(b));
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqualLoose(a[i], b[i])) return false;
    return true;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const k of Object.keys(ra)) if (ra[k] !== undefined && !jsonEqualLoose(ra[k], rb[k])) return false;
  for (const k of Object.keys(rb)) if (rb[k] !== undefined && ra[k] === undefined) return false;
  return true;
}
