/**
 * Persistence (architecture.md "State"): autosave, UI preferences, named versions, JSON export/import and share
 * links. Everything here is defensive: every storage access is wrapped in try/catch and every document read from
 * outside (storage, file, link) goes through `migrateProject`.
 *
 * Storage keys
 *  - `hytte-planlegger:project`   the autosaved Project (debounced 500 ms; never while `ui.readOnly`).
 *  - `hytte-planlegger:ui`        UI preferences (view, toggles, sun, preset …) plus `dismissedSeedRevision`.
 *  - `hytte-planlegger:versions`  `StoredVersion[]` (any project); listed per projectId newest first, at most
 *                                 `VERSION_LIMIT` per project (the oldest of that project is dropped first).
 *  - `hytte-planlegger:project.bak` copy of an autosave that could not be read, so it is never silently lost.
 *
 * Share link: `#d=` + lz-string `compressToEncodedURIComponent(JSON.stringify({ v, project }))` where `v` is the
 * schema version of `project` (lets a decoder reject a too-new link before reading it). Only the active variant
 * is included unless `allVariants`. The terrain is never part of a project, so never part of a link.
 *
 * Multi-tab: the `storage` event reports a project saved by another tab; when it is newer (`updatedAt`) than
 * ours the app is told (`onExternalChange`) instead of overwriting it, and autosave never overwrites a stored
 * project whose `updatedAt` is newer than the one being saved.
 */
import LZString from 'lz-string';
import { nanoid } from 'nanoid';
import { migrateProject, SchemaTooNewError } from '../model/migrate';
import { CURRENT_SCHEMA_VERSION } from '../model/types';
import type { Id, Project } from '../model/types';
import { CAMERA_PRESET_KEYS, CUT_HEIGHT_MAX, CUT_HEIGHT_MIN } from './store';
import type { AppStore, UiState } from './store';

export const KEYS = {
  project: 'hytte-planlegger:project',
  ui: 'hytte-planlegger:ui',
  versions: 'hytte-planlegger:versions',
  projectBackup: 'hytte-planlegger:project.bak',
} as const;

export const AUTOSAVE_DELAY_MS = 500;
export const VERSION_LIMIT = 30;
/** Links longer than this get the "send som JSON-fil" warning. */
export const SHARE_WARN_BYTES = 8 * 1024;
export const SHARE_PARAM = 'd';

/** Minimal Storage surface used here (localStorage in the app, a Map-backed fake in tests). */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// ---------------------------------------------------------------------------
// Low-level storage helpers
// ---------------------------------------------------------------------------

/** localStorage if it exists and accepts writes (private mode / disabled storage → null). */
export function getStorage(): KeyValueStorage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = 'hytte-planlegger:probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function readRaw(storage: KeyValueStorage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Returns false when the write failed (quota, disabled storage). */
export function writeRaw(storage: KeyValueStorage | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeRaw(storage: KeyValueStorage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

function parseJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** UTF-8 byte length (what a file or a link "weighs"). */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

export type LoadResult =
  | { status: 'ok'; project: Project }
  | { status: 'missing' }
  | { status: 'too-new'; version: number }
  | { status: 'invalid'; error: string };

/** Migrate anything parsed from outside into a Project, classifying the failure. */
export function migrateRaw(raw: unknown): LoadResult {
  try {
    return { status: 'ok', project: migrateProject(raw) };
  } catch (e) {
    if (e instanceof SchemaTooNewError) return { status: 'too-new', version: e.schemaVersion };
    return { status: 'invalid', error: errorMessage(e) };
  }
}

export function loadAutosave(storage: KeyValueStorage | null): LoadResult {
  const text = readRaw(storage, KEYS.project);
  if (text === null) return { status: 'missing' };
  const raw = parseJson(text);
  if (raw === undefined) return { status: 'invalid', error: 'not JSON' };
  return migrateRaw(raw);
}

export function saveAutosave(storage: KeyValueStorage | null, project: Project): boolean {
  return writeRaw(storage, KEYS.project, JSON.stringify(project));
}

/** Keep an unreadable autosave under KEYS.projectBackup before anything overwrites it. */
export function backupInvalidAutosave(storage: KeyValueStorage | null): void {
  const text = readRaw(storage, KEYS.project);
  if (text !== null) writeRaw(storage, KEYS.projectBackup, text);
}

/** `updatedAt` of the stored autosave without migrating it (null when missing or unreadable). */
function storedUpdatedAt(storage: KeyValueStorage | null): string | null {
  const raw = parseJson(readRaw(storage, KEYS.project));
  return isRecord(raw) && typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
}

/** ISO 8601 comparison (both from toISOString, so lexical order = time order; falls back to Date parsing). */
export function isNewer(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta > tb;
  return a > b;
}

// ---------------------------------------------------------------------------
// UI preferences
// ---------------------------------------------------------------------------

export const UI_PREF_KEYS = [
  'activeView',
  'planStorey',
  'activeStoreyId',
  'mode3d',
  'cutHeight',
  'showLabels',
  'showDims',
  'showGrid',
  'showRoofPlan',
  'highlightNew',
  'showTrees',
  'showTerrain',
  'preset',
  'sun',
] as const satisfies readonly (keyof UiState)[];

export type UiPrefs = Pick<UiState, (typeof UI_PREF_KEYS)[number]>;

export function pickUiPrefs(ui: UiState): UiPrefs {
  const out: Record<string, unknown> = {};
  for (const k of UI_PREF_KEYS) out[k] = ui[k];
  return out as UiPrefs;
}

const BOOL_PREFS = ['showLabels', 'showDims', 'showGrid', 'showRoofPlan', 'highlightNew', 'showTrees', 'showTerrain'] as const;

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v);
}

/** Validate stored prefs field by field; anything malformed is dropped (the default applies). */
export function sanitizeUiPrefs(raw: unknown): Partial<UiState> {
  if (!isRecord(raw)) return {};
  const out: Partial<UiState> = {};
  if (oneOf(raw.activeView, ['plan', '3d', 'split'] as const)) out.activeView = raw.activeView;
  if (oneOf(raw.planStorey, ['ground', 'loft'] as const)) out.planStorey = raw.planStorey;
  if (typeof raw.activeStoreyId === 'string' && raw.activeStoreyId) out.activeStoreyId = raw.activeStoreyId;
  if (oneOf(raw.mode3d, ['ute', 'inne'] as const)) out.mode3d = raw.mode3d;
  if (typeof raw.cutHeight === 'number' && Number.isFinite(raw.cutHeight)) {
    out.cutHeight = Math.min(CUT_HEIGHT_MAX, Math.max(CUT_HEIGHT_MIN, raw.cutHeight));
  }
  for (const k of BOOL_PREFS) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  if (oneOf(raw.preset, CAMERA_PRESET_KEYS)) out.preset = raw.preset;
  const sun = raw.sun;
  if (
    isRecord(sun) &&
    typeof sun.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(sun.date) &&
    typeof sun.minutes === 'number' &&
    sun.minutes >= 0 &&
    sun.minutes < 24 * 60
  ) {
    out.sun = { date: sun.date, minutes: Math.round(sun.minutes) };
  }
  return out;
}

export function loadUiPrefs(storage: KeyValueStorage | null): Partial<UiState> {
  return sanitizeUiPrefs(parseJson(readRaw(storage, KEYS.ui)));
}

/** Writes the prefs, keeping other fields of the stored object (e.g. dismissedSeedRevision). */
export function saveUiPrefs(storage: KeyValueStorage | null, ui: UiState): boolean {
  const existing = parseJson(readRaw(storage, KEYS.ui));
  const base = isRecord(existing) ? existing : {};
  return writeRaw(storage, KEYS.ui, JSON.stringify({ ...base, ...pickUiPrefs(ui) }));
}

export function loadDismissedSeedRevision(storage: KeyValueStorage | null): number {
  const raw = parseJson(readRaw(storage, KEYS.ui));
  return isRecord(raw) && typeof raw.dismissedSeedRevision === 'number' ? raw.dismissedSeedRevision : 0;
}

export function saveDismissedSeedRevision(storage: KeyValueStorage | null, revision: number): boolean {
  const existing = parseJson(readRaw(storage, KEYS.ui));
  const base = isRecord(existing) ? existing : {};
  return writeRaw(storage, KEYS.ui, JSON.stringify({ ...base, dismissedSeedRevision: revision }));
}

// ---------------------------------------------------------------------------
// Named versions
// ---------------------------------------------------------------------------

export interface StoredVersion {
  id: Id;
  name: string;
  savedAt: string;
  projectId: Id;
  schemaVersion: number;
  /** Stored as written; migrated when loaded. */
  project: Project;
}

export interface VersionInfo {
  id: Id;
  name: string;
  savedAt: string;
  projectId: Id;
  projectName: string;
  schemaVersion: number;
  /** Size of this version's JSON (UTF-8 bytes). */
  bytes: number;
}

function isStoredVersion(v: unknown): v is StoredVersion {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.savedAt === 'string' &&
    typeof v.projectId === 'string' &&
    typeof v.schemaVersion === 'number' &&
    isRecord(v.project)
  );
}

/** All well-formed stored versions (malformed entries are skipped). */
export function readVersions(storage: KeyValueStorage | null): StoredVersion[] {
  const raw = parseJson(readRaw(storage, KEYS.versions));
  return Array.isArray(raw) ? raw.filter(isStoredVersion) : [];
}

function writeVersions(storage: KeyValueStorage | null, versions: StoredVersion[]): boolean {
  return writeRaw(storage, KEYS.versions, JSON.stringify(versions));
}

function toInfo(v: StoredVersion): VersionInfo {
  const projectName = typeof v.project.name === 'string' ? v.project.name : '';
  return {
    id: v.id,
    name: v.name,
    savedAt: v.savedAt,
    projectId: v.projectId,
    projectName,
    schemaVersion: v.schemaVersion,
    bytes: byteLength(JSON.stringify(v)),
  };
}

function newestFirst(a: { savedAt: string }, b: { savedAt: string }): number {
  return Date.parse(b.savedAt) - Date.parse(a.savedAt);
}

/** Versions of `projectId` (or of every OTHER project when `others` is true), newest first. */
export function listVersions(storage: KeyValueStorage | null, projectId: Id, opts: { others?: boolean } = {}): VersionInfo[] {
  return readVersions(storage)
    .filter((v) => (opts.others ? v.projectId !== projectId : v.projectId === projectId))
    .sort(newestFirst)
    .map(toInfo);
}

/** Size of the whole versions entry in storage (UTF-8 bytes). */
export function versionsBytes(storage: KeyValueStorage | null): number {
  const text = readRaw(storage, KEYS.versions);
  return text === null ? 0 : byteLength(text);
}

export type SaveVersionResult = { ok: true; version: VersionInfo } | { ok: false; reason: 'unavailable' | 'quota' };

/** Save a named snapshot; keeps at most VERSION_LIMIT per project (drops that project's oldest). */
export function saveVersion(storage: KeyValueStorage | null, project: Project, name: string, now: Date = new Date()): SaveVersionResult {
  if (!storage) return { ok: false, reason: 'unavailable' };
  const version: StoredVersion = {
    id: nanoid(10),
    name: name.trim() || project.name,
    savedAt: now.toISOString(),
    projectId: project.id,
    schemaVersion: project.schemaVersion,
    project,
  };
  const all = [...readVersions(storage), version];
  const mine = all.filter((v) => v.projectId === project.id).sort(newestFirst);
  const drop = new Set(mine.slice(VERSION_LIMIT).map((v) => v.id));
  const kept = all.filter((v) => !drop.has(v.id));
  if (!writeVersions(storage, kept)) return { ok: false, reason: 'quota' };
  return { ok: true, version: toInfo(version) };
}

export function deleteVersion(storage: KeyValueStorage | null, id: Id): boolean {
  const all = readVersions(storage);
  const kept = all.filter((v) => v.id !== id);
  if (kept.length === all.length) return false;
  return writeVersions(storage, kept);
}

/** The migrated project of a stored version, or a failed LoadResult. */
export function loadVersion(storage: KeyValueStorage | null, id: Id): LoadResult {
  const v = readVersions(storage).find((x) => x.id === id);
  if (!v) return { status: 'missing' };
  return migrateRaw(v.project);
}

// ---------------------------------------------------------------------------
// JSON export / import
// ---------------------------------------------------------------------------

/** "hytta-ved-merkesvatnet-2026-10-11.json" */
export function projectFileName(project: Project, now: Date = new Date()): string {
  const slug =
    project.name
      .toLowerCase()
      .replace(/æ/g, 'ae')
      .replace(/ø/g, 'o')
      .replace(/å/g, 'a')
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'hytte';
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `${slug}-${d}.json`;
}

export function serializeProject(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

/**
 * Parse an imported file. Accepts a Project, a share payload `{ v, project }` or a stored version
 * `{ project, … }`. Returns a LoadResult (never throws).
 */
export function parseProjectText(text: string): LoadResult {
  const raw = parseJson(text);
  if (raw === undefined) return { status: 'invalid', error: 'not JSON' };
  if (isRecord(raw) && !('variants' in raw) && isRecord(raw.project)) {
    if (typeof raw.v === 'number' && raw.v > CURRENT_SCHEMA_VERSION) return { status: 'too-new', version: raw.v };
    return migrateRaw(raw.project);
  }
  return migrateRaw(raw);
}

/** Triggers a browser download of the project as JSON. */
export function downloadProject(project: Project, doc: Document = document): void {
  downloadText(projectFileName(project), serializeProject(project), 'application/json', doc);
}

export function downloadText(fileName: string, text: string, mime: string, doc: Document = document): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function readProjectFile(file: Blob): Promise<LoadResult> {
  try {
    return parseProjectText(await file.text());
  } catch (e) {
    return { status: 'invalid', error: errorMessage(e) };
  }
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

export interface SharePayload {
  v: number;
  project: Project;
}

/** The project as shared: only the active variant unless `allVariants`. */
export function sharedProject(project: Project, allVariants: boolean): Project {
  if (allVariants) return project;
  const active = project.variants.find((v) => v.id === project.activeVariantId) ?? project.variants[0];
  return { ...project, variants: [active], activeVariantId: active.id };
}

export function encodeShare(project: Project, opts: { allVariants: boolean }): string {
  const p = sharedProject(project, opts.allVariants);
  const payload: SharePayload = { v: p.schemaVersion, project: p };
  return LZString.compressToEncodedURIComponent(JSON.stringify(payload));
}

/** Decode the `d` parameter of a share link. Never throws. */
export function decodeShare(encoded: string): LoadResult {
  let text: string | null;
  try {
    text = LZString.decompressFromEncodedURIComponent(encoded);
  } catch (e) {
    return { status: 'invalid', error: errorMessage(e) };
  }
  if (!text) return { status: 'invalid', error: 'could not decompress' };
  const raw = parseJson(text);
  if (!isRecord(raw) || !isRecord(raw.project)) return { status: 'invalid', error: 'not a share payload' };
  if (typeof raw.v === 'number' && raw.v > CURRENT_SCHEMA_VERSION) return { status: 'too-new', version: raw.v };
  return migrateRaw(raw.project);
}

/** `#d=…` (also `#x=1&d=…`) → the encoded part, else null. */
export function shareParamFromHash(hash: string): string | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of body.split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === SHARE_PARAM) {
      const value = part.slice(eq + 1);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

export interface ShareLink {
  url: string;
  /** Length of the whole URL (ASCII, so characters = bytes). */
  bytes: number;
  tooBig: boolean;
}

/** `baseUrl` = the page URL without hash (origin + path + query). */
export function makeShareLink(project: Project, opts: { allVariants: boolean }, baseUrl: string): ShareLink {
  const url = `${baseUrl.split('#')[0]}#${SHARE_PARAM}=${encodeShare(project, opts)}`;
  return { url, bytes: url.length, tooBig: url.length > SHARE_WARN_BYTES };
}

/** Remove the share hash from the address bar without a navigation. */
export function removeShareHash(win: Window = window): void {
  try {
    const { pathname, search } = win.location;
    win.history.replaceState(win.history.state, '', `${pathname}${search}`);
  } catch {
    // ignore (sandboxed iframes)
  }
}

/** "Lag min egen kopi": same content, new project id, remembers where it came from. */
export function makeOwnCopy(project: Project, now: Date = new Date()): Project {
  const iso = now.toISOString();
  return { ...structuredClone(project), id: nanoid(12), basedOnProjectId: project.id, createdAt: iso, updatedAt: iso };
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

export type Notice = 'link-invalid' | 'link-too-new' | 'autosave-invalid' | 'schema-too-new' | 'storage-unavailable';

export interface InitialState {
  project: Project;
  ui: Partial<UiState>;
  notices: Notice[];
}

/**
 * Decide what the app starts with: a share link (read-only) → the autosave → a fresh seed.
 * A too-new autosave is left untouched: the seed is shown read-only with "Last siden på nytt".
 */
export function loadInitialState(env: { storage: KeyValueStorage | null; hash: string; createSeed: () => Project }): InitialState {
  const { storage, hash, createSeed } = env;
  const notices: Notice[] = [];
  const prefs = loadUiPrefs(storage);
  if (!storage) notices.push('storage-unavailable');

  const encoded = shareParamFromHash(hash);
  if (encoded) {
    const shared = decodeShare(encoded);
    if (shared.status === 'ok') return { project: shared.project, ui: { ...prefs, readOnly: true, source: 'link' }, notices };
    notices.push(shared.status === 'too-new' ? 'link-too-new' : 'link-invalid');
  }

  const saved = loadAutosave(storage);
  switch (saved.status) {
    case 'ok':
      return { project: saved.project, ui: { ...prefs, readOnly: false, source: 'local' }, notices };
    case 'too-new':
      notices.push('schema-too-new');
      return { project: createSeed(), ui: { ...prefs, readOnly: true, source: 'local' }, notices };
    case 'invalid':
      backupInvalidAutosave(storage);
      notices.push('autosave-invalid');
      return { project: createSeed(), ui: { ...prefs, readOnly: false, source: 'local' }, notices };
    default:
      return { project: createSeed(), ui: { ...prefs, readOnly: false, source: 'local' }, notices };
  }
}

// ---------------------------------------------------------------------------
// Autosave controller
// ---------------------------------------------------------------------------

export interface AutosaveOptions {
  storage: KeyValueStorage | null;
  delayMs?: number;
  /** Window-like target for `storage`, `pagehide` and `beforeunload` (omit in tests without a DOM). */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  /** Another tab saved a newer project (from a storage event, or found when saving). */
  onExternalChange?: (project: Project) => void;
  /** A write failed (quota / storage disabled). */
  onSaveError?: () => void;
}

export interface AutosaveController {
  /** Write pending changes now. */
  flush(): void;
  stop(): void;
}

/**
 * Subscribe to the store and autosave `project` (debounced) and the UI prefs. Skips while `ui.readOnly`.
 * The project the store starts with counts as saved (nothing is written until it changes).
 */
export function startAutosave(store: AppStore, opts: AutosaveOptions): AutosaveController {
  const { storage, target } = opts;
  const delay = opts.delayMs ?? AUTOSAVE_DELAY_MS;
  let lastSaved: Project | null = store.getState().project;
  let lastPrefs = JSON.stringify(pickUiPrefs(store.getState().ui));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reportedExternal: string | null = null;

  const reportExternal = (p: Project) => {
    const key = `${p.id}@${p.updatedAt}`;
    if (key === reportedExternal) return;
    reportedExternal = key;
    opts.onExternalChange?.(p);
  };

  const saveProject = () => {
    const { project, ui } = store.getState();
    if (ui.readOnly || project === lastSaved) return;
    const stored = storedUpdatedAt(storage);
    if (stored !== null && isNewer(stored, project.updatedAt)) {
      const other = loadAutosave(storage);
      if (other.status === 'ok') reportExternal(other.project);
      return;
    }
    if (saveAutosave(storage, project)) lastSaved = project;
    else opts.onSaveError?.();
  };

  const savePrefs = () => {
    const ui = store.getState().ui;
    const json = JSON.stringify(pickUiPrefs(ui));
    if (json === lastPrefs) return;
    if (saveUiPrefs(storage, ui)) lastPrefs = json;
  };

  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    saveProject();
    savePrefs();
  };

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, delay);
  };

  const unsubscribe = store.subscribe((state, prev) => {
    if (state.project !== prev.project || state.ui !== prev.ui) schedule();
  });

  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEYS.project || e.newValue === null) return;
    const { project, ui } = store.getState();
    if (ui.readOnly) return;
    const result = migrateRaw(parseJson(e.newValue));
    if (result.status !== 'ok') return;
    if (isNewer(result.project.updatedAt, project.updatedAt)) reportExternal(result.project);
  };
  const onLeave = () => flush();

  target?.addEventListener('storage', onStorage);
  target?.addEventListener('pagehide', onLeave);
  target?.addEventListener('beforeunload', onLeave);

  return {
    flush,
    stop: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      unsubscribe();
      target?.removeEventListener('storage', onStorage);
      target?.removeEventListener('pagehide', onLeave);
      target?.removeEventListener('beforeunload', onLeave);
    },
  };
}

/** Forget the stored autosave (used by tests and "start fresh"). */
export function clearAutosave(storage: KeyValueStorage | null): void {
  removeRaw(storage, KEYS.project);
}
