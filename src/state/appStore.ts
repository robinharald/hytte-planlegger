/**
 * The app-wide store singleton, its bootstrap and the session actions that combine the store with persistence
 * (share links, versions, import, seed updates, other tabs). Components import `useAppStore` from here; tests
 * use `createAppStore` (store.ts) with a fixture instead.
 *
 * Bootstrap (module load): share link `#d=` (read-only) → autosave → fresh Forslag D seed with a new project id
 * (see persistence.loadInitialState). `startPersistence()` (called once from main.tsx) starts the autosave, the
 * other-tab detection and the `hashchange` handler for links pasted into an open tab.
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
  readProjectFile,
  removeShareHash,
  saveDismissedSeedRevision,
  saveVersion,
  shareParamFromHash,
  startAutosave,
} from './persistence';
import type { AutosaveController, LoadResult, Notice, SaveVersionResult, ShareLink } from './persistence';
import { createAppStore } from './store';
import type { AppState } from './store';
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
// Notices (banners)
// ---------------------------------------------------------------------------

export type AppNotice = Notice | 'other-tab' | 'save-failed' | 'import-failed' | 'import-too-new' | 'version-failed';

interface NoticeState {
  notices: AppNotice[];
  /** Newer project saved by another tab, offered by the 'other-tab' banner. */
  external: Project | null;
  /** Seed revision the user dismissed the "Forslag D er oppdatert" banner for. */
  dismissedSeedRevision: number;
}

export const noticeStore = create<NoticeState>()(() => ({
  notices: [...initial.notices],
  external: null,
  dismissedSeedRevision: loadDismissedSeedRevision(storage),
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

/** Show a decoded share link read-only (autosave of the current project is flushed first). */
export function openSharedLink(encoded: string): void {
  const result = decodeShare(encoded);
  if (result.status !== 'ok') {
    pushNotice(result.status === 'too-new' ? 'link-too-new' : 'link-invalid');
    return;
  }
  flushAutosave();
  appStore.getState().replaceProject(result.project, { readOnly: true, source: 'link' });
}

/**
 * "Lag min egen kopi": the shared project becomes the user's own (new id, basedOnProjectId), the hash is removed.
 * The project that was autosaved before is kept as a named version first, so nothing is lost.
 */
export function makeMyOwnCopy(): void {
  const { project } = appStore.getState();
  const previous = loadAutosave(storage);
  if (previous.status === 'too-new') {
    // A newer app version owns the autosave; never overwrite it from a stale page.
    pushNotice('schema-too-new');
    return;
  }
  if (previous.status === 'ok') saveVersion(storage, previous.project, nb.versions.backupBeforeCopy);
  appStore.getState().replaceProject(makeOwnCopy(project), { readOnly: false, source: 'local' });
  if (hasWindow) removeShareHash(window);
  flushAutosave();
}

/** Leave a shared link without copying it: back to the autosaved project (or a fresh seed). */
export function leaveSharedView(): void {
  if (hasWindow) removeShareHash(window);
  const saved = loadAutosave(storage);
  if (saved.status === 'invalid') backupInvalidAutosave(storage);
  const project = saved.status === 'ok' ? saved.project : freshSeedProject();
  appStore.getState().replaceProject(project, { readOnly: saved.status === 'too-new', source: 'local' });
}

/** Take over the newer project another tab saved. */
export function acceptExternalChange(): void {
  const { external } = noticeStore.getState();
  if (external) appStore.getState().replaceProject(external, { readOnly: false, source: 'local' });
  noticeStore.setState({ external: null });
  dismissNotice('other-tab');
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

export function saveNamedVersion(name: string): SaveVersionResult {
  flushAutosave();
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
