/**
 * The app-wide store singleton, its bootstrap and the session actions that combine the store with persistence
 * (share links, versions, import, seed updates, other tabs). Components import `useAppStore` from here; tests
 * use `createAppStore` (store.ts) with a fixture instead.
 *
 * Bootstrap (module load): share link `#d=` (read-only) → autosave → fresh Forslag D seed with a new project id
 * (see persistence.loadInitialState). The view defaults to the plan (DEFAULT_UI) unless the user chose one before. `startPersistence()` (called once from main.tsx) starts the autosave (which writes a fresh
 * project right away, so its id survives a reload), the other-tab detection and the `hashchange` handler for links
 * pasted into an open tab.
 *
 * Shared links: opening one in a tab that shows the user's own project keeps that project and its undo history
 * aside (`stash`). "Lag min egen kopi" ADDS the shared variant(s) to the user's own project (new variant ids, names
 * suffixed " (delt)" on a clash, one undo step) and only creates a project from the link when the user has none.
 * "Tilbake til mitt prosjekt" returns to the stash or the autosave ("Vis Forslag D" when there is none).
 *
 * Notices (banners) live in a small separate store so they never touch the undo history.
 */
import { create, useStore } from 'zustand';
import { nanoid } from 'nanoid';
import { createForslagD, SEED_REVISION } from '../model/seed/forslagD';
import type { Id, Project, Variant } from '../model/types';
import {
  backupInvalidAutosave,
  decodeShare,
  downloadProject,
  getStorage,
  loadAutosave,
  loadDismissedSeedRevision,
  loadInitialState,
  loadVersion,
  makeOwnCopy,
  makeShareLink,
  projectKey,
  readProjectFile,
  removeShareHash,
  saveDismissedSeedRevision,
  saveVersion,
  shareParamFromHash,
  startAutosave,
} from './persistence';
import type { AutosaveController, LoadResult, Notice, SaveVersionResult, ShareLink } from './persistence';
import { createAppStore, EMPTY_HISTORY } from './store';
import type { AppState, HistorySnapshot } from './store';
import { nb } from '../i18n/nb';

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const hasWindow = typeof window !== 'undefined';
export const storage = getStorage();

function nowISO(): string {
  return new Date().toISOString();
}

/** A fresh Forslag D project for a new user: current timestamps and its own project id. */
export function freshSeedProject(): Project {
  return { ...createForslagD(nowISO()), id: nanoid(12) };
}

const initial = loadInitialState({
  storage,
  hash: hasWindow ? window.location.hash : '',
  createSeed: freshSeedProject,
});

export const appStore = createAppStore(initial.project, initial.ui);

export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}

// ---------------------------------------------------------------------------
// The user's own project while a shared link is shown
// ---------------------------------------------------------------------------

/** The own project (and its undo history) that was on screen when a link was opened in this tab. */
let stash: { project: Project; history: HistorySnapshot } | null = null;

/** Does the user have a project of their own to go back to (or to add a shared variant to)? */
function hasOwnProject(): boolean {
  if (stash) return true;
  const status = loadAutosave(storage).status;
  return status === 'ok' || status === 'too-new';
}

/**
 * The project "Lag min egen kopi" / "Tilbake til mitt prosjekt" go back to: the stash when it is still what is
 * stored (another tab may have saved since), else the autosave; null when there is none, 'too-new' when the
 * autosave belongs to a newer app version.
 */
function ownProject(): { project: Project; history: HistorySnapshot } | 'too-new' | null {
  const saved = loadAutosave(storage);
  if (saved.status === 'too-new') return 'too-new';
  if (saved.status === 'ok') {
    return stash && projectKey(stash.project) === projectKey(saved.project) ? stash : { project: saved.project, history: EMPTY_HISTORY };
  }
  if (saved.status === 'invalid') backupInvalidAutosave(storage);
  return stash;
}

// ---------------------------------------------------------------------------
// Notices (banners)
// ---------------------------------------------------------------------------

export type AppNotice = Notice | 'other-tab' | 'save-failed' | 'import-failed' | 'import-too-new' | 'version-failed';

interface NoticeState {
  notices: AppNotice[];
  /** Newer project saved by another tab, offered by the 'other-tab' banner. */
  external: Project | null;
  /** Seed revision the user dismissed the "Forslag D er oppdatert" banner for. */
  dismissedSeedRevision: number;
  /** While a shared link is shown: the user has an own project (banner texts, "Tilbake til mitt prosjekt"). */
  sharedHasOwn: boolean;
}

export const noticeStore = create<NoticeState>()(() => ({
  notices: [...initial.notices],
  external: null,
  dismissedSeedRevision: loadDismissedSeedRevision(storage),
  sharedHasOwn: initial.ui.source === 'link' ? hasOwnProject() : false,
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

let autosave: AutosaveController | null = null;

/** Start autosave, other-tab detection and link handling. Idempotent; returns a stop function. */
export function startPersistence(): () => void {
  if (autosave || !hasWindow) return () => {};
  autosave = startAutosave(appStore, {
    storage,
    target: window,
    onExternalChange: (project) => {
      noticeStore.setState({ external: project });
      pushNotice('other-tab');
    },
    onSaveError: () => pushNotice('save-failed'),
  });
  const onHash = () => {
    const encoded = shareParamFromHash(window.location.hash);
    if (encoded) openSharedLink(encoded);
  };
  window.addEventListener('hashchange', onHash);
  return () => {
    window.removeEventListener('hashchange', onHash);
    autosave?.stop();
    autosave = null;
  };
}

function flushAutosave(): void {
  autosave?.flush();
}

// ---------------------------------------------------------------------------
// Session actions
// ---------------------------------------------------------------------------

/** Show a decoded share link read-only; the own project on screen is saved and kept aside with its history. */
export function openSharedLink(encoded: string): void {
  const result = decodeShare(encoded);
  if (result.status !== 'ok') {
    pushNotice(result.status === 'too-new' ? 'link-too-new' : 'link-invalid');
    return;
  }
  flushAutosave();
  const state = appStore.getState();
  if (!state.ui.readOnly) stash = { project: state.project, history: state.history() };
  state.replaceProject(result.project, { readOnly: true, source: 'link' });
  noticeStore.setState({ sharedHasOwn: hasOwnProject() });
  if (result.rebased) pushNotice('link-rebased');
}

/**
 * The shared project's variants as new variants of `own`: fresh ids, `basedOnId` = the shared id, the name
 * suffixed " (delt)" (" (delt 2)" …) when `own` already has a variant with that name. `activeId` is the copy of
 * the shared project's active variant.
 */
export function sharedVariantsFor(own: Project, shared: Project, now: string = nowISO()): { variants: Variant[]; activeId: Id } {
  const names = new Set(own.variants.map((v) => v.name));
  const ids = new Set(own.variants.map((v) => v.id));
  let activeId = '';
  const variants = shared.variants.map((v) => {
    let id = nanoid(10);
    while (ids.has(id)) id = nanoid(10);
    ids.add(id);
    let name = v.name;
    for (let n = 1; names.has(name); n++) name = nb.share.sharedName(v.name, n);
    names.add(name);
    if (v.id === shared.activeVariantId) activeId = id;
    return { ...structuredClone(v), id, name, createdAt: now, basedOnId: v.id };
  });
  return { variants, activeId: activeId || variants[0]?.id || '' };
}

/**
 * "Lag min egen kopi": the shared variant(s) are added to the user's own project (kept with its undo history;
 * adding is one undo step) and become active. Without an own project the shared project becomes the user's
 * (new id, basedOnProjectId). The hash is removed.
 */
export function makeMyOwnCopy(): void {
  const shared = appStore.getState().project;
  const own = ownProject();
  if (own === 'too-new') {
    // A newer app version owns the autosave; never overwrite it from a stale page.
    pushNotice('schema-too-new');
    return;
  }
  // From here on, what is stored is ours to overwrite (it is merged below, or there is none).
  autosave?.adopt();
  if (own) {
    const { variants, activeId } = sharedVariantsFor(own.project, shared);
    appStore.getState().replaceProject(own.project, { readOnly: false, source: 'local' }, own.history);
    appStore.getState().addVariants(variants, { activeId });
  } else {
    appStore.getState().replaceProject(makeOwnCopy(shared), { readOnly: false, source: 'local' });
  }
  stash = null;
  noticeStore.setState({ sharedHasOwn: false });
  if (hasWindow) removeShareHash(window);
  flushAutosave();
}

/** Leave a shared link without copying it: back to the own project (with its history), or a fresh Forslag D. */
export function leaveSharedView(): void {
  if (hasWindow) removeShareHash(window);
  const own = ownProject();
  if (own === 'too-new') appStore.getState().replaceProject(freshSeedProject(), { readOnly: true, source: 'local' });
  else if (own) appStore.getState().replaceProject(own.project, { readOnly: false, source: 'local' }, own.history);
  else appStore.getState().replaceProject(freshSeedProject(), { readOnly: false, source: 'local' });
  stash = null;
  noticeStore.setState({ sharedHasOwn: false });
}

/** Take over the newer project another tab saved. */
export function acceptExternalChange(): void {
  const { external } = noticeStore.getState();
  if (external) appStore.getState().replaceProject(external, { readOnly: false, source: 'local' });
  noticeStore.setState({ external: null });
  dismissNotice('other-tab');
}

/** "Behold mine endringer": this tab's project overwrites what the other tab saved. */
export function keepOwnChanges(): void {
  autosave?.adopt();
  noticeStore.setState({ external: null });
  dismissNotice('other-tab');
  autosave?.saveNow();
}

/** Is a newer bundled Forslag D available (and not dismissed)? */
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
  const names = new Set(project.variants.map((v) => v.name));
  const id = ids.has(variant.id) ? `${variant.id}-r${SEED_REVISION}-${nanoid(4)}` : variant.id;
  const name = names.has(variant.name) ? nb.seed.variantName(SEED_REVISION) : variant.name;
  return { ...variant, id, name };
}

/** "Hent ny Forslag D": add the bundled seed as a new variant, keep the user's variants. Undoable. */
export function fetchNewSeed(): void {
  const { project, addVariant } = appStore.getState();
  addVariant(seedVariantFor(project), { activate: true, seedRevision: SEED_REVISION });
}

/** "Tilbakestill til Forslag D": the whole project becomes the bundled seed (same project id). Undoable. */
export function resetToSeed(): void {
  const state = appStore.getState();
  const seed = createForslagD(nowISO());
  if (state.ui.readOnly) return;
  state.setProject({ ...seed, id: state.project.id });
}

/** Save a named version; the project itself is autosaved first, so the version is listed after a reload. */
export function saveNamedVersion(name: string): SaveVersionResult {
  autosave?.saveNow();
  return saveVersion(storage, appStore.getState().project, name);
}

/** Replace the project by a stored version (undoable). Returns false when it could not be read. */
export function restoreVersion(id: Id): boolean {
  const result = loadVersion(storage, id);
  if (result.status !== 'ok') {
    pushNotice('version-failed');
    return false;
  }
  appStore.getState().setProject(result.project);
  appStore.getState().setUi({ source: 'version' });
  return true;
}

/** Parse a JSON file; the caller confirms and then calls `applyImportedProject`. */
export async function readImportFile(file: Blob): Promise<LoadResult> {
  const result = await readProjectFile(file);
  if (result.status === 'too-new') pushNotice('import-too-new');
  else if (result.status !== 'ok') pushNotice('import-failed');
  return result;
}

export function applyImportedProject(project: Project): void {
  appStore.getState().setProject(project);
  appStore.getState().setUi({ source: 'local' });
}

export function exportProjectFile(): void {
  downloadProject(appStore.getState().project);
}

/** Share link for `project` based on the current page address (without its hash). */
export function shareLinkFor(project: Project, allVariants: boolean): ShareLink {
  const base = hasWindow ? `${window.location.origin}${window.location.pathname}${window.location.search}` : '';
  return makeShareLink(project, { allVariants }, base);
}

export function reloadPage(): void {
  if (hasWindow) window.location.reload();
}
