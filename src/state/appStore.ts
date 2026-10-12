/**
 * The app-wide store singleton, its bootstrap and the session actions that combine the store with persistence and
 * the family's proposals (docs/phase2-plan.md §5). Components import `useAppStore` from here; tests use
 * `createAppStore` (store.ts) with a fixture instead.
 *
 * The project on screen = the bundled Forslag D (locked, never stored, always the current bundled one) + the family's
 * proposals. Where the proposals live depends on the mode (`familyMode`, familyStore.ts `resolveFamilyMode`):
 *  - 'shared': src/state/firebaseConfig.ts holds a config (and this is not a test / browser automation): Firestore, in
 *    the family space `#f=<id>` (from the link, else the id stored on this device, else a new one made once). The
 *    Firebase code is loaded with `import()` by `startPersistence`, so a bundle without a config never loads it. The
 *    address bar keeps `#f=<id>&p=<proposal>` so a bookmark or a home-screen icon (iOS keeps its own storage) opens
 *    the same family. On a device that has a family, a link to ANY other space (a new one, an old tab, a bookmark; at
 *    start-up or pasted into the tab) is no switch: the device stays and asks, saying what each space holds
 *    («Denne lenken går til en annen delt plass. Plassen i lenken har N forslag (…); plassen du bruker nå har M.
 *    [Bytt dit] [Bli her]»). Only «Bytt dit» switches: the old id is remembered (`family.previous`), and once the new
 *    space answers, the proposals this device created in the old one are offered («Hent forslagene fra den forrige
 *    plassen»: copied here, put in the old space's Papirkurv; copies brought in are never offered again). A link to one
 *    proposal in another space (`&p=`) never switches: «Hent «…» som en kopi hit» copies it into this space. On a
 *    device without a family the link's space is used, and stored once it shows proposals, a proposal is made in it,
 *    or the user starts it («Denne plassen er tom. Er lenken hel?» [Begynn her]). When another tab switches this device
 *    to another space (`storage` event), this tab stops saving and asks for a reload. A
 *    `#f=` whose id is not whole (cut off) never starts a new family: the stored one is used, or — on a device without
 *    one — the proposals are kept on this device (`noFamily`) until a whole link is opened; a banner says so.
 *  - 'local': the proposals are stored in this browser (familyStore.local.ts) — "Kun på denne enheten".
 * familyStore.sync.ts keeps the store and the family store in step (autosave, live merge, conflict guard); its state
 * (status pill, "sist endret av …", Papirkurv, conflicts) is mirrored into `familyUiStore` (`useFamily`).
 *
 * Bootstrap (module load, synchronous): the old whole-project autosave of phase 1 / 2a becomes proposals (local: at
 * once; shared: after the first list, then the old key is retired), keeping its own time as «sist endret» and
 * showing the proposal it had on screen; a `#d=` link is imported as new proposal(s)
 * (ids derived from the link, so opening it twice adds nothing twice) and shown; `#p=<id>` (or the proposal shown
 * last on this device) is activated as soon as it is there. `startPersistence()` (main.tsx, once) starts the sync,
 * the UI-prefs autosave, `navigator.storage.persist()` and the `hashchange` handler.
 *
 * Kept for the existing UI: the read-only link view ("Lag min egen kopi" / "Tilbake til mitt prosjekt") still works
 * when something puts the store into it (`showReadOnly`), named versions can be read and added as proposals, and the
 * seed-update banner never shows (Forslag D is always current).
 */
import { create, useStore } from 'zustand';
import { nanoid } from 'nanoid';
import { nb } from '../i18n/nb';
import { createForslagD, SEED_REVISION, SEED_VARIANT_ID } from '../model/seed/forslagD';
import type { Id, Project, Variant } from '../model/types';
import { firebaseConfig } from './firebaseConfig';
import {
  cleanName,
  cleanVariant,
  createMyName,
  FAMILY_KEYS,
  familyHash,
  familyLink,
  hashHasFamily,
  isValidFamilyId,
  newFamilyId,
  newProposalId,
  parseHash,
  resolveFamilyMode,
} from './familyStore';
import type { EncodeContext, FamilyMode, FamilyStore, ProposalList, RevisionInfo } from './familyStore';
import { createLocalFamilyStore, LOCAL_KEYS } from './familyStore.local';
import { createProposalSync } from './familyStore.sync';
import type { ProposalSync, SyncState } from './familyStore.sync';
import {
  AUTOSAVE_DELAY_MS,
  backupInvalidAutosave,
  decodeShare,
  downloadProject,
  downloadText,
  fnv36,
  getStorage,
  legacyImport,
  linkProposals,
  loadAutosave,
  loadDismissedSeedRevision,
  loadUiPrefs,
  loadVersion,
  makeOwnCopy,
  makeShareLink,
  projectFileName,
  readProjectFile,
  readRaw,
  retireLegacyAutosave,
  saveDismissedSeedRevision,
  saveVersion,
  serializeProject,
  startPrefsAutosave,
  writeRaw,
} from './persistence';
import type { LoadResult, Notice, PrefsAutosave, SaveVersionResult, ShareLink } from './persistence';
import { createAppStore, selectActiveVariant } from './store';
import type { AppState, HistorySnapshot } from './store';

// ---------------------------------------------------------------------------
// Mode, family id
// ---------------------------------------------------------------------------

const hasWindow = typeof window !== 'undefined';
export const storage = getStorage();

function nowISO(): string {
  return new Date().toISOString();
}

const startHash = hasWindow ? window.location.hash : '';
const startParams = parseHash(startHash);

export const familyMode: FamilyMode = resolveFamilyMode({
  hasConfig: firebaseConfig !== null,
  testMode: import.meta.env.MODE === 'test',
  buildOverride: typeof import.meta.env.VITE_FAMILY_STORE === 'string' ? import.meta.env.VITE_FAMILY_STORE : null,
  storedOverride: readRaw(storage, FAMILY_KEYS.modeOverride),
  webdriver: hasWindow && typeof navigator !== 'undefined' && navigator.webdriver === true,
});

function readJson(key: string): unknown {
  try {
    return JSON.parse(readRaw(storage, key) ?? 'null') as unknown;
  } catch {
    return null;
  }
}

/** Family ids this device used before (`FAMILY_KEYS.previousFamilies`, oldest first). */
function previousFamilies(): string[] {
  const parsed = readJson(FAMILY_KEYS.previousFamilies);
  return Array.isArray(parsed) ? parsed.filter(isValidFamilyId) : [];
}

function removeKey(key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // storage blocked
  }
}

/**
 * Leaving family `old` for `to` («Bytt dit»): remember the old id (nothing is lost; it can be opened again with its
 * link). With `offer`, also that the proposals this device created in `old` before the switch are to be offered in
 * `to` (`offerCarryOver`; never copies it brought into `old`).
 */
function rememberPreviousFamily(old: string, opts: { to: string; offer: boolean }): void {
  writeRaw(storage, FAMILY_KEYS.previousFamilies, JSON.stringify([...previousFamilies().filter((x) => x !== old && x !== opts.to), old].slice(-10)));
  if (opts.offer) {
    writeRaw(storage, FAMILY_KEYS.switchedFrom, old);
    writeRaw(storage, FAMILY_KEYS.switchOffer, JSON.stringify({ from: old, ids: offerableIn(old) }));
  } else {
    removeKey(FAMILY_KEYS.switchedFrom);
    removeKey(FAMILY_KEYS.switchOffer);
  }
}

/** `{ [familyId]: proposalId[] }` under `key` (`FAMILY_KEYS.createdHere` / `carriedIn`). */
function idsByFamily(key: string): Record<string, string[]> {
  const parsed = readJson(key);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, string[]> = {};
  for (const [f, ids] of Object.entries(parsed as Record<string, unknown>)) {
    if (isValidFamilyId(f) && Array.isArray(ids)) out[f] = ids.filter((x): x is string => typeof x === 'string');
  }
  return out;
}

function recordIds(key: string, family: string, add: Id[]): void {
  const all = idsByFamily(key);
  const ids = all[family] ?? [];
  const fresh = add.filter((id) => !ids.includes(id));
  if (fresh.length === 0) return;
  all[family] = [...ids, ...fresh].slice(-200);
  writeRaw(storage, key, JSON.stringify(all));
}

/** Proposals this device created in `family` that are not copies brought in from another space. */
function offerableIn(family: string): Id[] {
  const carried = new Set(idsByFamily(FAMILY_KEYS.carriedIn)[family] ?? []);
  return (idsByFamily(FAMILY_KEYS.createdHere)[family] ?? []).filter((id) => !carried.has(id));
}

const storedFamily = readRaw(storage, FAMILY_KEYS.familyId);
const knownFamily = isValidFamilyId(storedFamily) ? storedFamily : null;
/** The start link has `#f=` but its id is not whole (cut off when copied or sent): never a new family for it. */
const badFamilyLink = familyMode === 'shared' && hashHasFamily(startHash) && !startParams.family;

/** What the space of a link to another space holds (once it answered), for the banner. */
export interface LinkedFamilyInfo {
  /** Proposals there (not deleted), and the names of the people who made them. */
  count: number;
  names: string[];
  /** Some of them were made on other devices (not made here, not brought in from here). */
  others: boolean;
  /** The same for the space this device uses. */
  hereCount: number;
  hereOthers: boolean;
  /** A `&p=` link: that proposal's name there (null when it is not there). */
  proposalName: string | null;
}

/** A `#f=` link to another space than this device's: shown in a banner until the user answers. */
export interface OtherFamilyLink {
  id: string;
  /** `&p=<proposal>` of the link: a copy is offered, never a switch. */
  proposal: Id | null;
  /** null until the link's space has answered (never, when Firebase could not be loaded). */
  info: LinkedFamilyInfo | null;
}

/**
 * The start link goes to another family space than the one this device uses (a new link, an old tab, a bookmark, a
 * session-restored tab): never a switch at start-up. The device stays in its family and asks.
 */
const otherFamilyLink: OtherFamilyLink | null =
  familyMode === 'shared' && startParams.family !== null && knownFamily !== null && startParams.family !== knownFamily
    ? { id: startParams.family, proposal: startParams.proposal, info: null }
    : null;

/**
 * A `#f=` link on a device without a family: that space is used, but stored on this device only once it shows
 * proposals, a proposal is made in it, or the user starts it (`confirmFamily`) — a link to an empty space may be
 * one that was not copied whole («Denne plassen er tom. Er lenken hel?»).
 */
let unconfirmedFamily = familyMode === 'shared' && startParams.family !== null && knownFamily === null;

/**
 * Shared mode: the family stored here, else the one of a `#f=` link (stored once confirmed), else a new one (made
 * once) — but not for a broken `#f=` on a device without a family: null (the proposals stay on this device until a
 * whole link). A link to another space than the stored one changes nothing here (`otherFamilyLink`).
 */
function chooseFamilyId(): string | null {
  if (knownFamily) return knownFamily;
  if (startParams.family) return startParams.family;
  if (badFamilyLink) return null;
  const id = newFamilyId();
  writeRaw(storage, FAMILY_KEYS.familyId, id);
  return id;
}

/** The family space (shared mode), null in local mode (and in shared mode without a family, `noFamily`). */
export const familyId: string | null = familyMode === 'shared' ? chooseFamilyId() : null;
/** Shared mode, but a broken `#f=` link on a device without a family: kept on this device (the local store) meanwhile. */
const noFamily = familyMode === 'shared' && familyId === null;
/** The `#f=…` part of a broken start link, kept in the address bar while `noFamily` (a reload must not start a family). */
const brokenFamilyHash = noFamily ? `#${startHash.replace(/^#/, '').split('&').find((x) => x.startsWith('f=')) ?? ''}` : '';
const activeKey = `${FAMILY_KEYS.activeProposal}:${familyId ?? 'local'}`;

// ---------------------------------------------------------------------------
// The bundled base and the initial project
// ---------------------------------------------------------------------------

/** A fresh Forslag D project: current timestamps and its own project id. */
export function freshSeedProject(): Project {
  return { ...createForslagD(nowISO()), id: nanoid(12) };
}

const seedProject = freshSeedProject();
const baseVariant: Variant = seedProject.variants[0];
const encodeContext = (): EncodeContext => ({ site: seedProject.site, seedRevision: SEED_REVISION });

/** The local store (local mode, or shared mode without a family); the shared one is created by `startPersistence`. */
const localFamily: FamilyStore | null =
  familyMode === 'local' || noFamily ? createLocalFamilyStore({ storage, target: hasWindow ? window : null, context: encodeContext }) : null;

const startNotices: Notice[] = [];
if (!storage) startNotices.push('storage-unavailable');

/** Notices of the family layer (shown by the top bar). 'family-link-invalid': a `#f=` whose id is not whole. */
export type FamilyNotice = 'family-unavailable' | 'family-link-invalid';
const startFamilyNotices: FamilyNotice[] = [];
if (familyMode === 'local' && hashHasFamily(startHash)) startFamilyNotices.push('family-unavailable');
if (badFamilyLink) startFamilyNotices.push('family-link-invalid');

/** Toasts to show once the store exists. */
const startToasts: string[] = [];

// 1. The old whole-project autosave → proposals (keeping its own time; the one it had on screen is shown).
let legacyPending: Variant[] = [];
let legacyActive: Id | null = null;
let legacyAt: string | undefined;
{
  const legacy = loadAutosave(storage);
  if (legacy.status === 'ok') {
    const moved = legacyImport(legacy.project, baseVariant);
    legacyPending = moved.variants;
    legacyActive = moved.activeId;
    legacyAt = moved.updatedAt ?? undefined;
    // Nothing to bring (a phase-1 plain visit: an untouched copy of Forslag D): retired right away.
    if (legacyPending.length === 0) retireLegacyAutosave(storage);
  } else if (legacy.status === 'invalid') {
    backupInvalidAutosave(storage);
    startNotices.push('autosave-invalid');
    retireLegacyAutosave(storage);
  }
}

// 2. A `#d=` link → new proposal(s).
let linkPending: { variants: Variant[]; activeId: Id } | null = null;
if (startParams.delta) {
  const r = decodeShare(startParams.delta);
  if (r.status === 'ok') {
    if (r.rebased) startNotices.push('link-rebased');
    linkPending = linkProposals(r.project, startParams.delta, [], nowISO());
  } else {
    startNotices.push(r.status === 'too-new' ? 'link-too-new' : 'link-invalid');
  }
}

/** Names of link proposals made unique against `taken` (the link's own ids are kept). */
function nameAgainst(variants: Variant[], taken: Iterable<string>): Variant[] {
  const names = new Set(taken);
  return variants.map((v) => {
    let name = v.name;
    for (let n = 1; names.has(name); n++) name = nb.share.sharedName(v.name, n);
    names.add(name);
    return name === v.name ? v : { ...v, name };
  });
}

/**
 * Write proposals into the local store right away (local mode); returns the ids now stored (or in the Papirkurv).
 * `at`: the time to stamp them with (1 ms later for each next one, so they keep their order).
 */
function storeLocally(family: FamilyStore, variants: Variant[], at?: string): Set<Id> {
  const list = () => family.currentList();
  const present = (id: Id) => list().proposals.some((p) => p.id === id);
  const t = at ? Date.parse(at) : NaN;
  variants.forEach((v, i) => {
    if (!present(v.id)) void family.saveProposal(v, { base: null, by: null, at: Number.isFinite(t) ? new Date(t + i).toISOString() : undefined });
  });
  return new Set([...list().proposals, ...list().trash].map((p) => p.id));
}

if (localFamily) {
  if (legacyPending.length > 0) {
    const stored = storeLocally(localFamily, legacyPending, legacyAt);
    if (legacyPending.every((v) => stored.has(v.id))) retireLegacyAutosave(storage);
    legacyPending = [];
  }
  if (linkPending) {
    const proposals = localFamily.currentList().proposals;
    const existing = new Set(proposals.map((p) => p.id));
    const fresh = nameAgainst(
      linkPending.variants.filter((v) => !existing.has(v.id)),
      [baseVariant.name, ...proposals.map((p) => p.name)],
    );
    storeLocally(localFamily, fresh);
    const shown = localFamily.currentList().proposals.find((p) => p.id === linkPending?.activeId);
    if (shown) startToasts.push(fresh.some((v) => v.id === shown.id) ? nb.family.linkImported(shown.name) : nb.family.linkKnown(shown.name));
  }
}

const remembered = readRaw(storage, activeKey);
// A `&p=` of a link to another space names a proposal there, not here.
const wantedActive: Id | null = linkPending?.activeId ?? (otherFamilyLink ? null : startParams.proposal) ?? legacyActive ?? remembered;
const startProposals = localFamily ? localFamily.currentList().proposals.map((p) => p.variant) : [];
const initialProject: Project = {
  ...seedProject,
  variants: [baseVariant, ...startProposals],
  activeVariantId: wantedActive && startProposals.some((v) => v.id === wantedActive) ? wantedActive : baseVariant.id,
};
// Local mode: the proposal shown first (the old autosave's, a link's) is remembered now, so a reload shows it again
// (`startPersistence` remembers only changes of the shown proposal, and here it is shown from the start).
if (localFamily && initialProject.activeVariantId !== baseVariant.id && initialProject.activeVariantId !== remembered) {
  writeRaw(storage, activeKey, initialProject.activeVariantId);
}
/** Shared mode: the proposal to show once the first list has it (unless the user picked another meanwhile). */
let pendingActivate: Id | null = !localFamily && wantedActive && wantedActive !== baseVariant.id ? wantedActive : null;

export const appStore = createAppStore(initialProject, { ...loadUiPrefs(storage), readOnly: false, source: 'local' });
for (const text of startToasts) appStore.getState().showToast({ text });

export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}

// ---------------------------------------------------------------------------
// Family UI state (status pill, menu metadata, Papirkurv, conflicts, name prompt)
// ---------------------------------------------------------------------------

export interface FamilyUiState extends SyncState {
  /** Show "Hva heter du?" (shared mode, the first save on a device without a name). */
  askName: boolean;
  /**
   * Shared mode, but Firebase could not be loaded: the proposals are kept on this device (the local store) until the
   * family space can be reached; the pill says «Kun på denne enheten (familiens plass kan ikke nås nå)».
   */
  fallback: boolean;
  /** Shared mode, but a broken `#f=` link on a device without a family: kept here until a whole link is opened. */
  noFamily: boolean;
  /** After a family switch: the proposals this device created in the previous space, offered to bring along. */
  carryOver: { from: string; names: string[] } | null;
  /**
   * A `#f=` link (at start-up or pasted into the tab) to another space than this device's: the device stays in its
   * family until the user picks «Bytt dit» (`switchToLinkedFamily`), «Bli her» (`stayInFamily`) or, for a link to one
   * proposal, «Hent … som en kopi hit» (`copyLinkedProposal`).
   */
  otherFamily: OtherFamilyLink | null;
  /** The start link's space has no proposals and this device has no family yet: «Begynn her» (`startEmptyFamily`). */
  emptyFamily: boolean;
  /** Another tab on this device switched to another space: this tab saves nothing until it is reloaded. */
  elsewhere: boolean;
  notices: FamilyNotice[];
}

function initialSyncState(): SyncState {
  const list: ProposalList = localFamily?.currentList() ?? { proposals: [], trash: [], tooNew: [] };
  const meta: SyncState['meta'] = Object.fromEntries(list.proposals.map(({ variant: _v, ...m }) => [m.id, m]));
  return {
    mode: localFamily ? 'local' : familyMode,
    familyId,
    phase: localFamily ? 'ready' : 'connecting',
    saving: false,
    pending: 0,
    online: hasWindow && typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
    failed: false,
    meta,
    trash: list.trash,
    tooNew: list.tooNew,
    conflicts: [],
    overwritten: [],
  };
}

export const familyUiStore = create<FamilyUiState>()(() => ({
  ...initialSyncState(),
  askName: false,
  fallback: false,
  noFamily,
  carryOver: null,
  otherFamily: otherFamilyLink,
  emptyFamily: false,
  elsewhere: false,
  notices: [...startFamilyNotices],
}));

export function useFamily<T>(selector: (s: FamilyUiState) => T): T {
  return useStore(familyUiStore, selector);
}

export function dismissFamilyNotice(n: FamilyNotice): void {
  familyUiStore.setState((s) => ({ notices: s.notices.filter((x) => x !== n) }));
}

function pushFamilyNotice(n: FamilyNotice): void {
  familyUiStore.setState((s) => (s.notices.includes(n) ? s : { notices: [...s.notices, n] }));
}

// ---------------------------------------------------------------------------
// The user's own project while a (legacy) read-only view is shown
// ---------------------------------------------------------------------------

/** The own project (and its undo history) that was on screen when a read-only view replaced it. */
let stash: { project: Project; history: HistorySnapshot } | null = null;

// ---------------------------------------------------------------------------
// Notices (banners)
// ---------------------------------------------------------------------------

export type AppNotice = Notice | 'other-tab' | 'save-failed' | 'import-failed' | 'import-too-new' | 'version-failed';

interface NoticeState {
  notices: AppNotice[];
  /** Kept for the banner API; the family store's conflict guard replaced the other-tab banner. */
  external: Project | null;
  /** Seed revision the user dismissed the "Forslag D er oppdatert" banner for. */
  dismissedSeedRevision: number;
  /** While a read-only view is shown: an own project is kept aside. */
  sharedHasOwn: boolean;
}

export const noticeStore = create<NoticeState>()(() => ({
  notices: [...startNotices],
  external: null,
  dismissedSeedRevision: loadDismissedSeedRevision(storage),
  sharedHasOwn: false,
}));

export function useNotices<T>(selector: (s: NoticeState) => T): T {
  return useStore(noticeStore, selector);
}

export function pushNotice(n: AppNotice): void {
  noticeStore.setState((s) => (s.notices.includes(n) ? s : { notices: [...s.notices, n] }));
}

export function dismissNotice(n: AppNotice): void {
  noticeStore.setState((s) => ({ notices: s.notices.filter((x) => x !== n) }));
}

// ---------------------------------------------------------------------------
// Persistence wiring
// ---------------------------------------------------------------------------

let family: FamilyStore | null = localFamily;
let sync: ProposalSync | null = null;
let prefs: PrefsAutosave | null = null;
let started = false;
const names = createMyName(storage);

/** Shared mode: ids of the old autosave's proposals not stored yet (the old key is retired when none is left). */
const legacyIds = new Set<Id>(legacyPending.map((v) => v.id));

/**
 * Shared mode: the local store this device fell back to while Firebase could not be loaded (`connectShared`), and the
 * ids of the proposals kept there that the family space does not have yet. Once the family space answers (later in
 * the session, or at the next start) they are saved there, and the local copy is removed when all of them are.
 */
let fallbackStore: FamilyStore | null = null;
const leftoverIds = new Set<Id>();

function clearLeftoversWhenStored(): void {
  if (leftoverIds.size > 0) return;
  for (const key of [LOCAL_KEYS.proposals, LOCAL_KEYS.revisions]) {
    try {
      storage?.removeItem(key);
    } catch {
      // storage blocked: nothing to clear
    }
  }
}

/** Shared mode, first list of the family space: proposals kept on this device while it was unreachable go there. */
function importLeftovers(list: ProposalList): void {
  if (familyMode !== 'shared' || !sync || family?.mode !== 'shared') return;
  const local = createLocalFamilyStore({ storage, context: encodeContext });
  const kept = local.currentList().proposals.map((p) => p.variant);
  local.dispose();
  if (kept.length === 0) return;
  const stored = new Set([...list.proposals, ...list.trash].map((p) => p.id));
  const present = new Set(appStore.getState().project.variants.map((v) => v.id));
  const missing = kept.filter((v) => !stored.has(v.id));
  for (const v of missing) leftoverIds.add(v.id);
  // Those still on screen (the fallback ran in this session) are new to this sync and saved by its first flush.
  sync.addVariants(missing.filter((v) => !present.has(v.id)));
  clearLeftoversWhenStored();
}

function retireLegacyWhenStored(): void {
  if (legacyIds.size === 0 && loadAutosave(storage).status !== 'missing') retireLegacyAutosave(storage);
}

/** The first list waits (`unconfirmedFamily` and the space is empty) until the space is started. */
let firstListWaits = false;

/**
 * After the first list. A link's space on a device without a family: stored when it has proposals; when it is empty,
 * nothing is moved into it (old autosave, proposals kept on this device) until the user starts it.
 */
function onFirstList(list: ProposalList): void {
  if (!sync || !family) return;
  if (family.mode === 'shared' && unconfirmedFamily) {
    if (list.proposals.length + list.trash.length + list.tooNew.length === 0) {
      firstListWaits = true;
      familyUiStore.setState({ emptyFamily: true });
      return;
    }
    confirmFamily();
  }
  runFirstList(list);
}

/** The space of the start link becomes this device's family (stored); what waited for it runs now. */
function confirmFamily(): void {
  if (!unconfirmedFamily || !familyId) return;
  unconfirmedFamily = false;
  writeRaw(storage, FAMILY_KEYS.familyId, familyId);
  familyUiStore.setState({ emptyFamily: false });
  if (firstListWaits && sync) {
    firstListWaits = false;
    runFirstList(sync.lastList());
  }
}

/** «Begynn her» on «Denne plassen er tom. Er lenken hel?». */
export function startEmptyFamily(): void {
  confirmFamily();
}

/** «Lukk» on that banner: nothing is stored (the question comes again at the next start). */
export function dismissEmptyFamily(): void {
  familyUiStore.setState({ emptyFamily: false });
}

/** Legacy and link proposals (shared mode), the proposal to show, the Papirkurv's old ones, the offers. */
function runFirstList(list: ProposalList): void {
  if (!sync || !family) return;
  importLeftovers(list);
  const stored = new Set([...list.proposals, ...list.trash].map((p) => p.id));
  if (legacyPending.length > 0) {
    for (const v of legacyPending) if (stored.has(v.id)) legacyIds.delete(v.id);
    sync.addVariants(
      legacyPending.filter((v) => !stored.has(v.id)),
      undefined,
      { at: legacyAt },
    );
    legacyPending = [];
    retireLegacyWhenStored();
  }
  if (linkPending && !localFamily) {
    const fresh = nameAgainst(
      linkPending.variants.filter((v) => !stored.has(v.id)),
      [baseVariant.name, ...list.proposals.map((p) => p.name)],
    );
    sync.addVariants(fresh, linkPending.activeId);
    const shown = appStore.getState().project.variants.find((v) => v.id === linkPending?.activeId);
    if (shown) appStore.getState().showToast({ text: fresh.some((v) => v.id === shown.id) ? nb.family.linkImported(shown.name) : nb.family.linkKnown(shown.name) });
    pendingActivate = null;
  }
  linkPending = null;
  if (pendingActivate && appStore.getState().project.activeVariantId === baseVariant.id) sync.activate(pendingActivate);
  pendingActivate = null;
  void family.purgeTrash().catch(() => 0);
  if (family.mode === 'shared') {
    offerCarryOver(list);
    watchLinked();
  }
}

// ---------------------------------------------------------------------------
// After a family switch: bring along the proposals this device created in the previous space
// ---------------------------------------------------------------------------

/** Opens another family space on the loaded Firebase (set by `loadShared`). */
let openFamily: ((id: string) => FamilyStore) | null = null;
/** The open offer: the previous space's store and the proposals offered from it. */
let carry: { from: string; store: FamilyStore; offered: Variant[]; stop: () => void } | null = null;
/** How long the previous space may take to answer before the offer is given up (it stays on this device's list). */
const CARRY_WAIT_MS = 10_000;

function endCarryOver(forget: boolean): void {
  carry?.stop();
  carry?.store.dispose();
  carry = null;
  if (forget) {
    removeKey(FAMILY_KEYS.switchedFrom);
    removeKey(FAMILY_KEYS.switchOffer);
  }
  familyUiStore.setState({ carryOver: null });
}

/** What the switch from `from` offers: the proposals created there before the switch, minus copies carried in. */
function switchOffer(from: string): Id[] {
  const snap = readJson(FAMILY_KEYS.switchOffer) as { from?: unknown; ids?: unknown } | null;
  const ids =
    snap && snap.from === from && Array.isArray(snap.ids) ? snap.ids.filter((x): x is string => typeof x === 'string') : (idsByFamily(FAMILY_KEYS.createdHere)[from] ?? []);
  const carried = new Set(idsByFamily(FAMILY_KEYS.carriedIn)[from] ?? []);
  return ids.filter((id) => !carried.has(id));
}

/**
 * The device switched to a space it had never used (`FAMILY_KEYS.switchedFrom`): read the previous space and offer
 * the proposals this device created there before the switch (`switchOffer`; never copies it brought in from yet
 * another space) that are still there (not deleted) and not here yet. Nothing to offer once the previous space
 * answered online: the switch is forgotten; offline it is tried again at the next start.
 */
function offerCarryOver(here: ProposalList): void {
  const from = readRaw(storage, FAMILY_KEYS.switchedFrom);
  if (carry || !openFamily || !familyId || !isValidFamilyId(from) || from === familyId) return;
  const mine = new Set(switchOffer(from));
  if (mine.size === 0) {
    endCarryOver(true);
    return;
  }
  const hereIds = new Set([...here.proposals, ...here.trash].map((p) => p.id));
  const store = openFamily(from);
  const timer = setTimeout(() => {
    if (carry?.store === store && carry.offered.length === 0) endCarryOver(hasWindow && navigator.onLine !== false);
  }, CARRY_WAIT_MS);
  const unsubscribe = store.listProposals((list) => {
    if (carry?.store !== store) return;
    const offered = list.proposals.filter((p) => mine.has(p.id) && !hereIds.has(p.id)).map((p) => p.variant);
    carry.offered = offered;
    familyUiStore.setState({ carryOver: offered.length > 0 ? { from, names: offered.map((v) => v.name) } : null });
  });
  carry = {
    from,
    store,
    offered: [],
    stop: () => {
      clearTimeout(timer);
      unsubscribe();
    },
  };
}

/**
 * «Hent forslagene fra den forrige plassen»: the offered proposals are added here (saved as new proposals, names
 * made unique), then put in the previous space's Papirkurv (kept there 30 days). Returns how many were brought.
 */
export async function acceptCarryOver(): Promise<number> {
  const c = carry;
  if (!c || !sync) return 0;
  const project = appStore.getState().project;
  const ids = new Set(project.variants.map((v) => v.id));
  const copies = nameAgainst(
    c.offered.map((v) => (ids.has(v.id) ? { ...v, id: newProposalId() } : v)),
    project.variants.map((v) => v.name),
  );
  // Copies brought in are not "made here": a later switch never offers to move them out of this space again.
  if (familyId) recordIds(FAMILY_KEYS.carriedIn, familyId, copies.map((v) => v.id));
  sync.addVariants(copies);
  await sync.flush();
  for (const v of c.offered) await c.store.deleteProposal(v.id);
  endCarryOver(true);
  if (copies.length > 0) appStore.getState().showToast({ text: nb.family.carryOver.done(copies.length) });
  return copies.length;
}

/** «Nei takk»: not offered again (the previous space keeps them; its id stays under `family.previous`). */
export function declineCarryOver(): void {
  endCarryOver(true);
}

// ---------------------------------------------------------------------------
// A link to another space: asked, never a switch on its own
// ---------------------------------------------------------------------------

/** The space of the open link to another space, read for the banner (its store and its last list). */
let linked: { id: string; store: FamilyStore; list: ProposalList | null; stop: () => void } | null = null;

function endLinked(): void {
  linked?.stop();
  linked?.store.dispose();
  linked = null;
}

/** Proposals this device made in `family` or brought into it; the others were made on other devices. */
function madeHere(family: string): Set<Id> {
  return new Set([...(idsByFamily(FAMILY_KEYS.createdHere)[family] ?? []), ...(idsByFamily(FAMILY_KEYS.carriedIn)[family] ?? [])]);
}

function updateLinkedInfo(): void {
  const other = familyUiStore.getState().otherFamily;
  const list = linked?.list;
  if (!other || !list || linked?.id !== other.id || !familyId) return;
  const there = madeHere(other.id);
  const here = madeHere(familyId);
  const hereList = sync?.lastList().proposals ?? [];
  const p = other.proposal ? list.proposals.find((x) => x.id === other.proposal) : undefined;
  familyUiStore.setState({
    otherFamily: {
      ...other,
      info: {
        count: list.proposals.length,
        names: [...new Set(list.proposals.map((x) => cleanName(x.createdBy)).filter((x): x is string => x !== null))],
        others: list.proposals.some((x) => !there.has(x.id)),
        hereCount: hereList.length,
        hereOthers: hereList.some((x) => !here.has(x.id)),
        proposalName: p?.name ?? null,
      },
    },
  });
}

/** Read the space of the open link to another space (once Firebase is loaded: at the first list, or when it comes). */
function watchLinked(): void {
  const other = familyUiStore.getState().otherFamily;
  if (!other) {
    endLinked();
    return;
  }
  if (linked?.id === other.id) {
    updateLinkedInfo();
    return;
  }
  endLinked();
  if (!openFamily) return;
  const store = openFamily(other.id);
  const stop = store.listProposals((list) => {
    if (linked?.store !== store) return;
    linked.list = list;
    updateLinkedInfo();
  });
  linked = { id: other.id, store, list: null, stop };
}

function showOtherFamily(id: string, proposal: Id | null): void {
  familyUiStore.setState({ otherFamily: { id, proposal, info: null } });
  watchLinked();
}

/** «Bli her» on a link to another space: nothing changes, the address bar shows this space again. */
export function stayInFamily(): void {
  endLinked();
  familyUiStore.setState({ otherFamily: null });
  syncHash();
}

/**
 * «Bytt dit»: the device goes to the space of that link (after saving what is pending, a reload). The space left is
 * remembered, and the new space offers the proposals this device created in it (never a link to one proposal: that
 * offers a copy, `copyLinkedProposal`).
 */
export function switchToLinkedFamily(): void {
  const other = familyUiStore.getState().otherFamily;
  if (!other || other.proposal || !familyId) return;
  rememberPreviousFamily(familyId, { to: other.id, offer: true });
  writeRaw(storage, FAMILY_KEYS.familyId, other.id);
  endLinked();
  setHash(familyHash(other.id));
  void flushProposals().finally(reloadPage);
}

/**
 * «Hent «…» som en kopi hit» on a link to one proposal in another space: a copy is added to this space (its id derived
 * from the link, so the same link twice adds nothing twice) and shown; the other space is not touched. False when the
 * proposal is not known there (yet).
 */
export function copyLinkedProposal(): boolean {
  const other = familyUiStore.getState().otherFamily;
  const p = other?.proposal && linked?.id === other.id ? linked.list?.proposals.find((x) => x.id === other.proposal) : undefined;
  if (!other || !p || !sync || !familyId) return false;
  const id = `${p.id.slice(0, 60)}-k${fnv36(`${other.id}|${p.id}`)}`;
  const project = appStore.getState().project;
  const known = project.variants.find((v) => v.id === id);
  let name = known?.name ?? p.name;
  if (!known) {
    const [copy] = nameAgainst([{ ...cleanVariant(p.variant, id), basedOnId: p.id, createdAt: nowISO() }], project.variants.map((v) => v.name));
    name = copy.name;
    // Brought in from another space: a later switch never offers to move it out of this one.
    recordIds(FAMILY_KEYS.carriedIn, familyId, [id]);
    sync.addVariants([copy]);
  }
  endLinked();
  familyUiStore.setState({ otherFamily: null });
  sync.activate(id);
  syncHash();
  appStore.getState().showToast({ text: known ? nb.family.linkKnown(name) : nb.family.otherFamily.copied(name) });
  return true;
}

// ---------------------------------------------------------------------------
// Another tab switched this device to another space
// ---------------------------------------------------------------------------

/** This tab stops saving: what was edited here before is saved (in this space), nothing after. */
function stopForOtherTab(): void {
  if (familyUiStore.getState().elsewhere) return;
  endLinked();
  endCarryOver(false);
  familyUiStore.setState({ elsewhere: true, otherFamily: null, emptyFamily: false });
  if (connectTimer !== null) clearTimeout(connectTimer);
  connectTimer = null;
  const s = sync;
  void (s ? s.flush() : Promise.resolve()).finally(() => s?.stop());
}

/** «Last på nytt» after another tab switched: reloads in the space this device uses now. */
export function reloadInCurrentFamily(): void {
  const stored = readRaw(storage, FAMILY_KEYS.familyId);
  if (isValidFamilyId(stored)) setHash(familyHash(stored));
  reloadPage();
}

function attachSync(store: FamilyStore): void {
  family = store;
  sync = createProposalSync({
    store: appStore,
    family: store,
    delayMs: familyMode === 'shared' ? 1000 : AUTOSAVE_DELAY_MS,
    target: hasWindow ? window : null,
    doc: hasWindow && typeof document !== 'undefined' ? document : null,
    storage,
    onNeedsName: () => familyUiStore.setState({ askName: true }),
    onSaved: (id) => {
      if (legacyIds.delete(id)) retireLegacyWhenStored();
      if (store.mode === 'shared' && leftoverIds.delete(id)) clearLeftoversWhenStored();
    },
    onCreated: (id) => {
      const fid = store.mode === 'shared' ? store.familyId : null;
      if (fid && !(idsByFamily(FAMILY_KEYS.carriedIn)[fid] ?? []).includes(id)) recordIds(FAMILY_KEYS.createdHere, fid, [id]);
      // A proposal made in the space of a start link: it is this device's family now.
      if (fid) confirmFamily();
    },
    onFirstList,
  });
  sync.subscribe((s) => familyUiStore.setState(s));
  familyUiStore.setState(sync.getState());
}

let connectTimer: ReturnType<typeof setTimeout> | null = null;

/** Retry delay (ms) while Firebase cannot be loaded. */
const CONNECT_RETRY_MS = 15_000;

/** Load Firebase (familyStore.firestore.ts, a lazy chunk) and make the family's shared store. */
async function loadShared(): Promise<{ store: FamilyStore; dispose: () => void }> {
  if (!firebaseConfig || !familyId) throw new Error('no family space');
  const mod = await import('./familyStore.firestore');
  const adapter = await mod.loadFirebaseAdapter(firebaseConfig);
  // Another family space on the same Firebase (the previous one after a switch); its dispose leaves Firebase running.
  openFamily = (id) => mod.createFirestoreFamilyStore({ adapter: { ...adapter, dispose: () => {} }, familyId: id, storage, context: encodeContext });
  return { store: mod.createFirestoreFamilyStore({ adapter, familyId, storage, context: encodeContext }), dispose: () => adapter.dispose() };
}

/** While the fallback runs: the device came online, so try the family space again right away. */
function retryNow(): void {
  if (connectTimer !== null) clearTimeout(connectTimer);
  connectTimer = null;
  void connectShared();
}

/** Firebase could not be loaded: keep the proposals on this device (the local store) meanwhile. */
function startFallback(): void {
  fallbackStore = createLocalFamilyStore({ storage, target: hasWindow ? window : null, context: encodeContext });
  attachSync(fallbackStore);
  familyUiStore.setState({ fallback: true });
  if (hasWindow) window.addEventListener('online', retryNow);
}

/** The family space answers: save what the fallback holds and hand over (its proposals become leftovers). */
async function leaveFallback(): Promise<void> {
  const s = sync;
  const f = fallbackStore;
  await s?.flush();
  for (const p of f?.currentList().proposals ?? []) leftoverIds.add(p.id);
  s?.stop();
  f?.dispose();
  sync = null;
  family = null;
  fallbackStore = null;
  if (hasWindow) window.removeEventListener('online', retryNow);
  familyUiStore.setState({ fallback: false });
}

/**
 * Load Firebase (lazily) and attach the shared store. When that fails (Firebase blocked, a broken cache), the app
 * keeps working on this device (`startFallback`) and tries again every CONNECT_RETRY_MS and whenever the device comes
 * online; once it connects, the
 * proposals kept here are saved in the family space. (Offline with Firebase loaded is not a failure: Firestore's
 * own cache answers and queues the writes — "Lagret her – sendes når du er på nett".)
 */
async function connectShared(): Promise<void> {
  if (familyMode !== 'shared' || familyUiStore.getState().elsewhere) return;
  try {
    const loaded = await loadShared();
    if (!started || familyUiStore.getState().elsewhere) {
      loaded.dispose();
      return;
    }
    if (fallbackStore) await leaveFallback();
    attachSync(loaded.store);
  } catch {
    if (!started) return;
    if (!sync) startFallback();
    connectTimer = setTimeout(() => {
      connectTimer = null;
      void connectShared();
    }, CONNECT_RETRY_MS);
  }
}

/** Ask the browser to keep this site's storage (proposals, the offline cache) when space runs low. */
function requestPersistentStorage(): void {
  try {
    const s = navigator.storage;
    if (!s?.persist) return;
    void s
      .persisted()
      .then((already) => (already ? true : s.persist()))
      .catch(() => false);
  } catch {
    // not supported
  }
}

function setHash(hash: string): void {
  if (!hasWindow) return;
  try {
    const { pathname, search } = window.location;
    if (window.location.hash === hash) return;
    window.history.replaceState(window.history.state, '', `${pathname}${search}${hash}`);
  } catch {
    // sandboxed iframes
  }
}

/**
 * The address bar: `#f=<family>&p=<proposal>` in shared mode (bookmarks, home-screen icons), nothing locally — and
 * the broken `#f=…` while `noFamily` (so a reload does not start a new family either).
 */
function syncHash(): void {
  // The link to another space stays in the address bar until the user answers the banner; a tab whose device switched
  // in another tab keeps the address it had (its banner reloads in the current space).
  if (familyUiStore.getState().otherFamily || familyUiStore.getState().elsewhere) return;
  const { project } = appStore.getState();
  if (familyId) setHash(familyHash(familyId, project.activeVariantId === baseVariant.id ? null : project.activeVariantId));
  else setHash(brokenFamilyHash);
}

/** Start the family sync, the UI-prefs autosave and link handling. Idempotent; returns a stop function. */
export function startPersistence(): () => void {
  if (started || !hasWindow) return () => {};
  started = true;
  prefs = startPrefsAutosave(appStore, { storage, target: window, doc: typeof document !== 'undefined' ? document : null });
  requestPersistentStorage();
  if (localFamily) attachSync(localFamily);
  else void connectShared();

  syncHash();
  const unsubscribeActive = appStore.subscribe((s, prev) => {
    if (s.project.activeVariantId === prev.project.activeVariantId) return;
    pendingActivate = null;
    writeRaw(storage, activeKey, s.project.activeVariantId);
    syncHash();
  });

  const onHash = () => {
    const params = parseHash(window.location.hash);
    if (params.delta) {
      openSharedLink(params.delta);
      return;
    }
    if (hashHasFamily(window.location.hash)) {
      if (familyMode === 'shared' && params.family && params.family !== familyId && familyId && !unconfirmedFamily) {
        // Another space: never a switch until the user picks «Bytt dit» (a link to one proposal offers a copy).
        showOtherFamily(params.family, params.proposal);
        return;
      }
      if (familyMode === 'shared' && params.family && params.family !== familyId) {
        // No family on this device yet (a broken link before, or a link's space not started): start over in the
        // link's space (the reload stores it once it is confirmed).
        void flushProposals().finally(reloadPage);
        return;
      }
      if (familyMode === 'shared' && params.family && params.family === familyId && familyUiStore.getState().otherFamily) {
        endLinked();
        familyUiStore.setState({ otherFamily: null });
      }
      if (familyMode === 'shared' && !params.family) {
        // A broken link: stay where we are and say so.
        pushFamilyNotice('family-link-invalid');
        syncHash();
      }
      if (familyMode === 'local') pushFamilyNotice('family-unavailable');
    }
    if (params.proposal) activateProposal(params.proposal);
  };
  window.addEventListener('hashchange', onHash);
  // Another tab of this device changed the family it uses («Bytt dit», a new device's first space): this one stops.
  const onStorage = (e: StorageEvent) => {
    if (familyMode !== 'shared' || e.key !== FAMILY_KEYS.familyId || !isValidFamilyId(e.newValue)) return;
    if (e.newValue !== familyId) {
      stopForOtherTab();
      return;
    }
    // Another tab started this tab's space (a link's space not stored yet): nothing to ask any more; what waited for
    // it was done there.
    if (unconfirmedFamily) {
      unconfirmedFamily = false;
      firstListWaits = false;
      familyUiStore.setState({ emptyFamily: false });
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('hashchange', onHash);
    window.removeEventListener('storage', onStorage);
    endLinked();
    unsubscribeActive();
    prefs?.stop();
    prefs = null;
    sync?.stop();
    sync = null;
    endCarryOver(false);
    if (family !== localFamily) family?.dispose();
    if (connectTimer !== null) clearTimeout(connectTimer);
    connectTimer = null;
    family = localFamily;
    fallbackStore = null;
    window.removeEventListener('online', retryNow);
    started = false;
  };
}

// ---------------------------------------------------------------------------
// Family session actions
// ---------------------------------------------------------------------------

/** Save pending edits now (e.g. before a reload). */
export async function flushProposals(): Promise<void> {
  prefs?.flush();
  await sync?.flush();
}

/** Save pending edits and wait (at most `timeoutMs`) until the server has them — before "Oppdater" reloads. */
export async function flushProposalsAll(timeoutMs = 4000): Promise<void> {
  prefs?.flush();
  await sync?.flushAll(timeoutMs);
}

/** "Hent endringene" / "Lagre over". */
export function resolveConflict(id: Id, choice: 'fetch' | 'overwrite'): Promise<void> {
  return sync?.resolveConflict(id, choice) ?? Promise.resolve();
}

export function dismissOverwritten(id: Id): void {
  sync?.dismissOverwritten(id);
}

/** Show a proposal (no undo step when the sync runs). */
export function activateProposal(id: Id): boolean {
  if (sync) return sync.activate(id);
  if (!appStore.getState().project.variants.some((v) => v.id === id)) return false;
  appStore.getState().setActiveVariant(id);
  return true;
}

/** Delete a proposal (after the two confirmations): into the Papirkurv; Angre in the toast brings it back. */
export function deleteProposal(id: Id): void {
  const state = appStore.getState();
  const v = state.project.variants.find((x) => x.id === id);
  if (!v || v.locked || state.ui.readOnly) return;
  state.deleteVariant(id);
  if (!appStore.getState().project.variants.some((x) => x.id === id)) state.showToast({ text: nb.family.delete.done(v.name), undo: true });
}

/** From the Papirkurv back into the list, and shown. */
export async function restoreFromTrash(id: Id): Promise<boolean> {
  if (!sync) return false;
  const ok = await sync.restoreFromTrash(id);
  if (ok) {
    sync.activate(id);
    const v = appStore.getState().project.variants.find((x) => x.id === id);
    if (v) appStore.getState().showToast({ text: nb.family.restoredFromTrash(v.name) });
  }
  return ok;
}

/** Tidligere versjoner, newest first; `own` marks the versions this device saved (its own stamps, or its name). */
export async function listRevisions(id: Id): Promise<RevisionInfo[]> {
  if (!family) return [];
  const revisions = await family.listRevisions(id);
  const me = cleanName(myName());
  return revisions.map((r) => (sync?.isOwnVersion(id, r.savedAt) || (me !== null && r.savedBy === me) ? { ...r, own: true } : r));
}

export async function restoreRevision(id: Id, revisionId: string): Promise<boolean> {
  if (!sync) return false;
  const ok = await sync.restoreRevision(id, revisionId);
  const v = appStore.getState().project.variants.find((x) => x.id === id);
  if (ok && v) appStore.getState().showToast({ text: nb.family.revisionRestored(v.name) });
  return ok;
}

/** "Hva heter du?" — '' declines (never asked again). */
export function setMyName(name: string): void {
  if (family) family.setMyName(name);
  else names.set(name);
  familyUiStore.setState({ askName: false });
}

export function myName(): string | null {
  return family ? family.whoAmI() : names.get();
}

export function askForName(): void {
  familyUiStore.setState({ askName: true });
}

/** The links of "Send forslaget" in shared mode: the family link and the proposal's deep link (null locally). */
export function familyShareLinks(proposalId: Id): { family: string; proposal: string } | null {
  if (!familyId || !hasWindow) return null;
  const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  return { family: familyLink(base, familyId), proposal: familyLink(base, familyId, proposalId) };
}

// ---------------------------------------------------------------------------
// Links, files and versions (imported as proposals)
// ---------------------------------------------------------------------------

/**
 * A `#d=` link (pasted into an open tab): its proposal(s) are added (no undo step while the sync runs) and shown.
 * The same link twice shows the proposal it added before.
 */
export function openSharedLink(encoded: string): void {
  const result = decodeShare(encoded);
  setHash(familyId ? familyHash(familyId) : brokenFamilyHash);
  if (result.status !== 'ok') {
    pushNotice(result.status === 'too-new' ? 'link-too-new' : 'link-invalid');
    return;
  }
  if (result.rebased) pushNotice('link-rebased');
  const project = appStore.getState().project;
  const { variants, activeId } = linkProposals(result.project, encoded, [], nowISO());
  const present = new Set(project.variants.map((v) => v.id));
  const fresh = nameAgainst(
    variants.filter((v) => !present.has(v.id)),
    project.variants.map((v) => v.name),
  );
  if (sync) {
    sync.addVariants(fresh, activeId);
    sync.activate(activeId);
  } else {
    appStore.getState().addVariants(fresh, { activeId });
    if (appStore.getState().project.activeVariantId !== activeId) appStore.getState().setActiveVariant(activeId);
  }
  const shown = appStore.getState().project.variants.find((v) => v.id === activeId);
  if (shown) appStore.getState().showToast({ text: fresh.length > 0 ? nb.family.linkImported(shown.name) : nb.family.linkKnown(shown.name) });
  syncHash();
}

/**
 * The shared project's variants as new variants of `own`: fresh ids, `basedOnId` = the shared id, the name
 * suffixed " (delt)" (" (delt 2)" …) when `own` already has a variant with that name. `activeId` is the copy of
 * the shared project's active variant.
 */
export function sharedVariantsFor(own: Project, shared: Project, now: string = nowISO()): { variants: Variant[]; activeId: Id } {
  const taken = new Set(own.variants.map((v) => v.name));
  const ids = new Set(own.variants.map((v) => v.id));
  let activeId = '';
  const variants = shared.variants.map((v) => {
    let id = nanoid(10);
    while (ids.has(id)) id = nanoid(10);
    ids.add(id);
    let name = v.name;
    for (let n = 1; taken.has(name); n++) name = nb.share.sharedName(v.name, n);
    taken.add(name);
    if (v.id === shared.activeVariantId) activeId = id;
    return { ...structuredClone(v), id, name, createdAt: now, basedOnId: v.id };
  });
  return { variants, activeId: activeId || variants[0]?.id || '' };
}

/**
 * A file's (or a version's) proposals added as new, unlocked proposals; the first is shown. (One undo step without the
 * family sync; with it, making a proposal is no undo step: familyStore.sync.ts.)
 */
export function importProjectAsProposals(project: Project): number {
  const own = appStore.getState().project;
  const unlocked = project.variants.filter((v) => !v.locked);
  if (unlocked.length === 0) return 0;
  const { variants, activeId } = sharedVariantsFor(own, { ...project, variants: unlocked });
  appStore.getState().addVariants(
    variants.map((v) => cleanVariant(v)),
    { activeId },
  );
  return variants.length;
}

/** "Åpne fil": parse; the caller confirms and then calls `applyImportedProject`. */
export async function readImportFile(file: Blob): Promise<LoadResult> {
  const result = await readProjectFile(file);
  if (result.status === 'too-new') pushNotice('import-too-new');
  else if (result.status !== 'ok') pushNotice('import-failed');
  return result;
}

/** Add the file's proposals (the locked base in it is skipped). */
export function applyImportedProject(project: Project): void {
  const n = importProjectAsProposals(project);
  if (n > 0) appStore.getState().showToast({ text: nb.family.fileImported(n) });
}

/** "Eksporter JSON": every proposal with Forslag D as one project file. */
export function exportProjectFile(): void {
  downloadProject(appStore.getState().project);
}

/** "Lagre som fil": the proposal on screen as a project file of its own (opens again with "Åpne fil"). */
export function downloadActiveProposal(): void {
  const project = appStore.getState().project;
  const v = selectActiveVariant({ project });
  const single: Project = { ...project, name: v.name, variants: [v], activeVariantId: v.id };
  downloadText(projectFileName(single), serializeProject(single), 'application/json');
}

/** Save a named version of the whole project (kept for the old Versjoner dialog). */
export function saveNamedVersion(name: string): SaveVersionResult {
  return saveVersion(storage, appStore.getState().project, name);
}

/** A stored named version: its proposals are added as new proposals. Returns false when it could not be read. */
export function restoreVersion(id: Id): boolean {
  const result = loadVersion(storage, id);
  if (result.status !== 'ok') {
    pushNotice('version-failed');
    return false;
  }
  applyImportedProject(result.project);
  return true;
}

/** `#d=` link for `project` based on the current page address (local mode's "Send forslaget"). */
export function shareLinkFor(project: Project, allVariants: boolean): ShareLink {
  const base = hasWindow ? `${window.location.origin}${window.location.pathname}${window.location.search}` : '';
  return makeShareLink(project, { allVariants }, base);
}

export function reloadPage(): void {
  if (hasWindow) window.location.reload();
}

// ---------------------------------------------------------------------------
// Kept for the banners: the read-only view, other tabs, seed updates
// ---------------------------------------------------------------------------

/** Show a project read-only, keeping the own one (and its history) aside (links import as proposals now). */
export function showReadOnly(project: Project): void {
  const state = appStore.getState();
  if (!state.ui.readOnly) stash = { project: state.project, history: state.history() };
  state.replaceProject(project, { readOnly: true, source: 'link' });
  noticeStore.setState({ sharedHasOwn: stash !== null });
}

/**
 * "Lag min egen kopi" in a read-only view: the shared variant(s) are added to the own project kept aside (one undo
 * step) and become active; without one the shared project becomes the user's (new id, basedOnProjectId).
 */
export function makeMyOwnCopy(): void {
  const shared = appStore.getState().project;
  if (stash) {
    const { variants, activeId } = sharedVariantsFor(stash.project, shared);
    appStore.getState().replaceProject(stash.project, { readOnly: false, source: 'local' }, stash.history);
    appStore.getState().addVariants(variants, { activeId });
  } else {
    appStore.getState().replaceProject(makeOwnCopy(shared), { readOnly: false, source: 'local' });
  }
  stash = null;
  noticeStore.setState({ sharedHasOwn: false });
  syncHash();
}

/** Forslag D + the proposals the family store holds now. */
function composedProject(): Project {
  const list = family?.currentList() ?? { proposals: [] };
  return { ...seedProject, variants: [baseVariant, ...list.proposals.map((p) => p.variant)], activeVariantId: baseVariant.id };
}

/** Leave a read-only view: back to the own project (with its history), or Forslag D and the family's proposals. */
export function leaveSharedView(): void {
  if (stash) appStore.getState().replaceProject(stash.project, { readOnly: false, source: 'local' }, stash.history);
  else if (appStore.getState().ui.readOnly) appStore.getState().replaceProject(composedProject(), { readOnly: false, source: 'local' });
  stash = null;
  noticeStore.setState({ sharedHasOwn: false });
}

/** The old other-tab banner's "Hent endringene": every open conflict takes the stored version. */
export function acceptExternalChange(): void {
  for (const c of familyUiStore.getState().conflicts) void resolveConflict(c.id, 'fetch');
  noticeStore.setState({ external: null });
  dismissNotice('other-tab');
}

/** The old other-tab banner's "Behold mine endringer": every open conflict is saved over. */
export function keepOwnChanges(): void {
  for (const c of familyUiStore.getState().conflicts) void resolveConflict(c.id, 'overwrite');
  noticeStore.setState({ external: null });
  dismissNotice('other-tab');
}

/** Is a newer bundled Forslag D available (and not dismissed)? Never for the composed project (always current). */
export function seedUpdateAvailable(project: Project, dismissedRevision: number): boolean {
  return project.seedRevision < SEED_REVISION && dismissedRevision < SEED_REVISION;
}

export function dismissSeedUpdate(): void {
  saveDismissedSeedRevision(storage, SEED_REVISION);
  noticeStore.setState({ dismissedSeedRevision: SEED_REVISION });
}

/** A copy of the bundled seed variant whose id and name do not clash with the project's variants. */
export function seedVariantFor(project: Project): Variant {
  const variant = createForslagD(nowISO()).variants[0];
  const ids = new Set(project.variants.map((v) => v.id));
  const taken = new Set(project.variants.map((v) => v.name));
  const id = ids.has(variant.id) ? `${variant.id}-r${SEED_REVISION}-${nanoid(4)}` : variant.id;
  const name = taken.has(variant.name) ? nb.seed.variantName(SEED_REVISION) : variant.name;
  return { ...variant, id, name };
}

/** "Hent ny Forslag D": the bundled one is always current — show it. */
export function fetchNewSeed(): void {
  resetToSeed();
}

/** "Tilbakestill til Forslag D" / the error box: show Forslag D (no proposal is touched). */
export function resetToSeed(): void {
  const state = appStore.getState();
  if (state.ui.readOnly) return;
  const base = state.project.variants.find((v) => v.id === SEED_VARIANT_ID && v.locked) ?? state.project.variants.find((v) => v.locked);
  if (base) activateProposal(base.id);
  else state.setProject({ ...createForslagD(nowISO()), id: state.project.id });
  appStore.getState().select(null);
}
