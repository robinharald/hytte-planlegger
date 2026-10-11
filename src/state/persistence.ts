/**
 * Persistence (architecture.md "State"): autosave, UI preferences, named versions, JSON export/import and share
 * links. Everything here is defensive: every storage access is wrapped in try/catch and every document read from
 * outside (storage, file, link) goes through `migrateProject`.
 *
 * Storage keys
 *  - `hytte-planlegger:project`   the autosaved Project (debounced 500 ms; never while `ui.readOnly`). Written once
 *                                 at start-up when there is none, so a fresh project keeps its id across reloads.
 *  - `hytte-planlegger:ui`        UI preferences (toggles, sun, preset …, the view only when the user chose it,
 *                                 `v` = PREFS_VERSION) plus `dismissedSeedRevision`.
 *  - `hytte-planlegger:versions`  `StoredVersion[]` (any project); listed per projectId newest first, at most
 *                                 `VERSION_LIMIT` per project (the oldest of that project is dropped first).
 *  - `hytte-planlegger:project.bak` copy of an autosave that could not be read, so it is never silently lost.
 *
 * Share link: `#d=` + lz-string `compressToEncodedURIComponent(JSON.stringify(payload))`. The payload is a DELTA
 * against the bundled Forslag D seed (`DeltaSharePayload`: per variant the changed top-level fields and, per
 * collection, the added and changed entities in full plus the removed ids) when the project is at the bundled
 * `SEED_REVISION`, else the full `{ v, project }`. Timestamps are never sent. `v` is the schema version (lets a
 * decoder reject a too-new link before reading it). Only the active variant is included unless `allVariants`.
 * The terrain is never part of a project, so never part of a link. A delta made against an older seed revision is
 * applied to the current seed (`rebased`); one from a newer revision is 'too-new'.
 *
 * Multi-tab: a saved document is identified by `projectKey` = `id@updatedAt` (the store gives the project a fresh
 * `updatedAt` on every change, undo and restore included). Autosave remembers the key it last wrote (or found and
 * adopted); a stored document with any other key was written by another tab, so it is reported
 * (`onExternalChange`) and not overwritten until the app either loads it or calls `adopt()` ("Behold mine").
 */
import LZString from 'lz-string';
import { nanoid } from 'nanoid';
import { migrateProject, SchemaTooNewError } from '../model/migrate';
import { createForslagD, createForslagDVariant, SEED_REVISION, SEED_VARIANT_ID } from '../model/seed/forslagD';
import { CURRENT_SCHEMA_VERSION } from '../model/types';
import type { Id, Project, Site, Variant } from '../model/types';
import { CAMERA_PRESET_KEYS } from './store';
import type { ActiveView, AppStore, UiState } from './store';

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
  /** `rebased`: a share link made against an older Forslag D was applied to the current one. */
  | { status: 'ok'; project: Project; rebased?: boolean }
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

/** Identity of a saved document: `id@updatedAt`. */
export function projectKey(p: { id?: unknown; updatedAt?: unknown }): string {
  return `${String(p.id)}@${String(p.updatedAt)}`;
}

/** Key of the stored autosave without migrating it (null when missing or not a JSON object). */
export function storedProjectKey(storage: KeyValueStorage | null): string | null {
  const raw = parseJson(readRaw(storage, KEYS.project));
  return isRecord(raw) ? projectKey(raw) : null;
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

/**
 * Version of the stored prefs. Prefs without it (or older) were written before 2026-10-12: their `activeView` was
 * saved whether or not the user chose it, so it is never read (the chosen view is `chosenView`, from version 2).
 * Prefs of version 2 may still hold `cutHeight` / `cutHeightBeforePreset` from the removed cut-height slider: they
 * are ignored and dropped on the next save (the cut height follows the camera preset, see `cutHeightFor`).
 */
export const PREFS_VERSION = 2;

/** Fields of older prefs that are no longer read; `saveUiPrefs` removes them from the stored object. */
const STALE_PREF_KEYS = ['activeView', 'cutHeight', 'cutHeightBeforePreset'] as const;

/** Persisted fields; `activeView` is stored separately as `chosenView`, and only once the user picked it. */
export const UI_PREF_KEYS = [
  'planStorey',
  'activeStoreyId',
  'mode3d',
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

export type UiPrefs = Pick<UiState, (typeof UI_PREF_KEYS)[number]> & { v: number; chosenView?: ActiveView };

export function pickUiPrefs(ui: UiState): UiPrefs {
  const out: Record<string, unknown> = { v: PREFS_VERSION };
  for (const k of UI_PREF_KEYS) out[k] = ui[k];
  if (ui.activeViewChosen) out.chosenView = ui.activeView;
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
  if (oneOf(raw.chosenView, ['plan', '3d', 'split'] as const)) {
    out.activeView = raw.chosenView;
    out.activeViewChosen = true;
  }
  if (oneOf(raw.planStorey, ['ground', 'loft'] as const)) out.planStorey = raw.planStorey;
  if (typeof raw.activeStoreyId === 'string' && raw.activeStoreyId) out.activeStoreyId = raw.activeStoreyId;
  if (oneOf(raw.mode3d, ['ute', 'inne'] as const)) out.mode3d = raw.mode3d;
  if (oneOf(raw.preset, CAMERA_PRESET_KEYS)) out.preset = raw.preset;
  for (const k of BOOL_PREFS) if (typeof raw[k] === 'boolean') out[k] = raw[k];
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
  const base: Record<string, unknown> = isRecord(existing) ? { ...existing } : {};
  for (const k of STALE_PREF_KEYS) delete base[k];
  if (!ui.activeViewChosen) delete base.chosenView;
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
 * Parse an imported file. Accepts a Project, a share payload (`{ v, project }` or a delta against the seed) or a
 * stored version `{ project, … }`. Returns a LoadResult (never throws).
 */
export function parseProjectText(text: string): LoadResult {
  const raw = parseJson(text);
  if (raw === undefined) return { status: 'invalid', error: 'not JSON' };
  if (isRecord(raw) && raw.base === SEED_VARIANT_ID) return decodeDeltaPayload(raw);
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

/** Full payload: the whole project (timestamps stripped). Used when the project is not at the bundled seed revision. */
export interface SharePayload {
  v: number;
  project: Omit<Project, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string };
}

type Entity = Record<string, unknown> & { id: Id };

/**
 * Changes of one entity collection against the seed's collection with the same key. Rebuilt as: the seed's
 * entities minus `remove`, `change` replacing the entity with the same id in place, then `add` appended; `order`
 * (all ids) only when the result's order would differ; `all` replaces the collection (ids not unique).
 */
export interface CollectionDelta {
  add?: Entity[];
  change?: Entity[];
  remove?: Id[];
  order?: Id[];
  all?: unknown[];
}

export interface VariantDelta {
  id: Id;
  /** Top-level fields that differ from the seed variant (`name` always; never `createdAt`). */
  set: Record<string, unknown>;
  /** Optional top-level fields the seed variant has and this one lacks. */
  unset?: string[];
  /** Per collection key (`walls`, `rooms`, …, `outdoor.decks`): only collections that differ. */
  changes?: Record<string, CollectionDelta>;
}

/** Delta payload: the variants as changes against the bundled seed variant `base` at `seedRevision`. */
export interface DeltaSharePayload {
  v: number;
  seedRevision: number;
  base: typeof SEED_VARIANT_ID;
  project: { id: Id; activeVariantId: Id; name?: string; basedOnProjectId?: Id; seedRevision?: number };
  /** Only when it differs from the seed's site. */
  site?: Site;
  variants: VariantDelta[];
}

/** Array collections of a Variant; the outdoor ones are keyed `outdoor.<name>`. */
const VARIANT_COLLECTIONS = ['levels', 'blocks', 'walls', 'openings', 'rooms', 'furniture', 'structure'] as const;
const OUTDOOR_COLLECTIONS = ['decks', 'railings', 'hotTubs'] as const;
/** Top-level variant fields that are not diffed as plain values. */
const VARIANT_SPECIAL = new Set<string>(['id', 'createdAt', 'outdoor', ...VARIANT_COLLECTIONS]);

/** Structural equality of JSON-like values; object key order is ignored and `undefined` equals a missing key. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => jsonEqual(x, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of keys) if (!jsonEqual(ra[k], rb[k])) return false;
  return true;
}

function hasUniqueIds(items: readonly unknown[]): items is Entity[] {
  const ids = new Set<string>();
  for (const e of items) {
    if (!isRecord(e) || typeof e.id !== 'string' || ids.has(e.id)) return false;
    ids.add(e.id);
  }
  return true;
}

export function diffCollection(items: readonly unknown[], base: readonly unknown[]): CollectionDelta | null {
  if (!hasUniqueIds(items) || !hasUniqueIds(base)) return jsonEqual(items, base) ? null : { all: [...items] };
  const baseById = new Map(base.map((e) => [e.id, e]));
  const ids = new Set(items.map((e) => e.id));
  const add: Entity[] = [];
  const change: Entity[] = [];
  for (const e of items) {
    const b = baseById.get(e.id);
    if (!b) add.push(e);
    else if (!jsonEqual(e, b)) change.push(e);
  }
  const remove = base.filter((b) => !ids.has(b.id)).map((b) => b.id);
  const expected = [...base.filter((b) => ids.has(b.id)).map((b) => b.id), ...add.map((e) => e.id)];
  const actual = items.map((e) => e.id);
  const d: CollectionDelta = {};
  if (add.length > 0) d.add = add;
  if (change.length > 0) d.change = change;
  if (remove.length > 0) d.remove = remove;
  if (expected.some((id, i) => id !== actual[i])) d.order = actual;
  return Object.keys(d).length > 0 ? d : null;
}

/** Inverse of `diffCollection`; tolerant of a different base (rebased link): unknown ids are appended. */
export function applyCollection(base: readonly unknown[], d: CollectionDelta | undefined): unknown[] {
  if (!d) return [...base];
  if (Array.isArray(d.all)) return [...d.all];
  if (!hasUniqueIds(base)) return [...base, ...(d.add ?? [])];
  const removed = new Set(d.remove ?? []);
  const changed = new Map((d.change ?? []).filter((e) => isRecord(e)).map((e) => [e.id, e]));
  const out: Entity[] = [];
  for (const e of base) {
    if (removed.has(e.id)) continue;
    out.push(changed.get(e.id) ?? e);
    changed.delete(e.id);
  }
  out.push(...changed.values(), ...(d.add ?? []).filter((e) => isRecord(e)));
  if (!Array.isArray(d.order)) return out;
  const byId = new Map(out.map((e) => [e.id, e]));
  const ordered: Entity[] = [];
  for (const id of d.order) {
    const e = byId.get(id);
    if (e) {
      ordered.push(e);
      byId.delete(id);
    }
  }
  return [...ordered, ...byId.values()];
}

export function diffVariant(variant: Variant, seed: Variant): VariantDelta {
  const v = variant as unknown as Record<string, unknown>;
  const b = seed as unknown as Record<string, unknown>;
  const set: Record<string, unknown> = { name: variant.name };
  const unset: string[] = [];
  for (const k of new Set([...Object.keys(v), ...Object.keys(b)])) {
    if (VARIANT_SPECIAL.has(k) || k === 'name') continue;
    if (v[k] === undefined) {
      if (b[k] !== undefined) unset.push(k);
    } else if (!jsonEqual(v[k], b[k])) {
      set[k] = v[k];
    }
  }
  const changes: Record<string, CollectionDelta> = {};
  for (const key of VARIANT_COLLECTIONS) {
    const d = diffCollection(variant[key], seed[key]);
    if (d) changes[key] = d;
  }
  for (const key of OUTDOOR_COLLECTIONS) {
    const d = diffCollection(variant.outdoor[key], seed.outdoor[key]);
    if (d) changes[`outdoor.${key}`] = d;
  }
  const out: VariantDelta = { id: variant.id, set };
  if (unset.length > 0) out.unset = unset;
  if (Object.keys(changes).length > 0) out.changes = changes;
  return out;
}

/** Rebuild a variant document (not yet migrated) from a delta and a fresh seed variant. */
export function applyVariantDelta(seed: Variant, d: VariantDelta, createdAt: string): Record<string, unknown> {
  const doc: Record<string, unknown> = { ...(seed as unknown as Record<string, unknown>) };
  for (const k of Array.isArray(d.unset) ? d.unset : []) delete doc[k];
  if (isRecord(d.set)) for (const [k, value] of Object.entries(d.set)) if (!VARIANT_SPECIAL.has(k)) doc[k] = value;
  const changes = isRecord(d.changes) ? (d.changes as Record<string, CollectionDelta>) : {};
  for (const key of VARIANT_COLLECTIONS) doc[key] = applyCollection(seed[key], changes[key]);
  const outdoor: Record<string, unknown> = { ...seed.outdoor };
  for (const key of OUTDOOR_COLLECTIONS) outdoor[key] = applyCollection(seed.outdoor[key], changes[`outdoor.${key}`]);
  doc.outdoor = outdoor;
  doc.id = d.id;
  doc.createdAt = createdAt;
  return doc;
}

/** The project without createdAt/updatedAt (project and variants); a decoder fills in its own time. */
function withoutTimestamps(project: Project): SharePayload['project'] {
  const out: Record<string, unknown> = { ...project };
  delete out.createdAt;
  delete out.updatedAt;
  out.variants = project.variants.map((v) => {
    const copy: Record<string, unknown> = { ...v };
    delete copy.createdAt;
    return copy;
  });
  return out as unknown as SharePayload['project'];
}

/** The project as shared: only the active variant unless `allVariants`. */
export function sharedProject(project: Project, allVariants: boolean): Project {
  if (allVariants) return project;
  const active = project.variants.find((v) => v.id === project.activeVariantId) ?? project.variants[0];
  return { ...project, variants: [active], activeVariantId: active.id };
}

/** Delta payload of `project` against the bundled seed (all of its variants). */
export function deltaPayload(project: Project): DeltaSharePayload {
  const seedProject = createForslagD();
  const seed = seedProject.variants[0];
  const meta: DeltaSharePayload['project'] = { id: project.id, activeVariantId: project.activeVariantId };
  if (project.name !== seedProject.name) meta.name = project.name;
  if (project.basedOnProjectId) meta.basedOnProjectId = project.basedOnProjectId;
  if (project.seedRevision !== SEED_REVISION) meta.seedRevision = project.seedRevision;
  const payload: DeltaSharePayload = {
    v: project.schemaVersion,
    seedRevision: SEED_REVISION,
    base: SEED_VARIANT_ID,
    project: meta,
    variants: project.variants.map((v) => diffVariant(v, seed)),
  };
  if (!jsonEqual(project.site, seedProject.site)) payload.site = project.site;
  return payload;
}

/**
 * JSON of the share payload: the delta against the seed when the project is at the bundled seed revision (and the
 * delta is the smaller of the two), else the full project. No timestamps either way.
 */
export function sharePayloadJson(project: Project, opts: { allVariants: boolean }): string {
  const p = sharedProject(project, opts.allVariants);
  const full: SharePayload = { v: p.schemaVersion, project: withoutTimestamps(p) };
  const fullJson = JSON.stringify(full);
  if (p.seedRevision !== SEED_REVISION) return fullJson;
  const deltaJson = JSON.stringify(deltaPayload(p));
  return deltaJson.length < fullJson.length ? deltaJson : fullJson;
}

export function encodeShare(project: Project, opts: { allVariants: boolean }): string {
  return LZString.compressToEncodedURIComponent(sharePayloadJson(project, opts));
}

/** Rebuild the project of a delta payload from the bundled seed. Never throws. */
export function decodeDeltaPayload(raw: Record<string, unknown>, now: Date = new Date()): LoadResult {
  if (typeof raw.v === 'number' && raw.v > CURRENT_SCHEMA_VERSION) return { status: 'too-new', version: raw.v };
  const seedRevision = typeof raw.seedRevision === 'number' ? raw.seedRevision : 0;
  if (seedRevision > SEED_REVISION) return { status: 'too-new', version: typeof raw.v === 'number' ? raw.v : CURRENT_SCHEMA_VERSION };
  if (!isRecord(raw.project) || !Array.isArray(raw.variants)) return { status: 'invalid', error: 'not a delta payload' };
  const iso = now.toISOString();
  const meta = raw.project;
  try {
    const seedProject = createForslagD(iso);
    const variants = raw.variants.map((d) => {
      if (!isRecord(d) || typeof d.id !== 'string') throw new Error('variant delta without id');
      return applyVariantDelta(createForslagDVariant(iso), d as unknown as VariantDelta, iso);
    });
    const doc: Record<string, unknown> = {
      schemaVersion: typeof raw.v === 'number' ? raw.v : CURRENT_SCHEMA_VERSION,
      id: meta.id,
      name: typeof meta.name === 'string' ? meta.name : seedProject.name,
      createdAt: iso,
      updatedAt: iso,
      seedRevision: typeof meta.seedRevision === 'number' ? meta.seedRevision : seedRevision,
      site: isRecord(raw.site) ? raw.site : seedProject.site,
      variants,
      activeVariantId: meta.activeVariantId,
    };
    if (typeof meta.basedOnProjectId === 'string') doc.basedOnProjectId = meta.basedOnProjectId;
    const result = migrateRaw(doc);
    return result.status === 'ok' && seedRevision < SEED_REVISION ? { ...result, rebased: true } : result;
  } catch (e) {
    return { status: 'invalid', error: errorMessage(e) };
  }
}

/** Decode the `d` parameter of a share link (delta or full payload). Never throws. */
export function decodeShare(encoded: string, now: Date = new Date()): LoadResult {
  let text: string | null;
  try {
    text = LZString.decompressFromEncodedURIComponent(encoded);
  } catch (e) {
    return { status: 'invalid', error: errorMessage(e) };
  }
  if (!text) return { status: 'invalid', error: 'could not decompress' };
  const raw = parseJson(text);
  if (isRecord(raw) && raw.base === SEED_VARIANT_ID) return decodeDeltaPayload(raw, now);
  if (!isRecord(raw) || !isRecord(raw.project)) return { status: 'invalid', error: 'not a share payload' };
  if (typeof raw.v === 'number' && raw.v > CURRENT_SCHEMA_VERSION) return { status: 'too-new', version: raw.v };
  return migrateRaw(withTimesIfMissing(raw.project, now.toISOString()));
}

/** Timestamps a link does not carry are set to the time it is opened (project and variants). */
function withTimesIfMissing(project: Record<string, unknown>, iso: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...project };
  if (typeof out.createdAt !== 'string') out.createdAt = iso;
  if (typeof out.updatedAt !== 'string') out.updatedAt = iso;
  if (Array.isArray(out.variants)) {
    out.variants = out.variants.map((v) => (isRecord(v) && typeof v.createdAt !== 'string' ? { ...v, createdAt: iso } : v));
  }
  return out;
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

export type Notice = 'link-invalid' | 'link-too-new' | 'link-rebased' | 'autosave-invalid' | 'schema-too-new' | 'storage-unavailable';

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
    if (shared.status === 'ok') {
      if (shared.rebased) notices.push('link-rebased');
      return { project: shared.project, ui: { ...prefs, readOnly: true, source: 'link' }, notices };
    }
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
  /** Write the project now even when nothing changed since the last write (unless another tab owns the save). */
  saveNow(): boolean;
  /**
   * Take whatever is stored now as this tab's own: the next save overwrites it. Used after the app has merged the
   * stored project into its own ("Lag min egen kopi") and for "Behold mine endringer" over another tab's save.
   */
  adopt(): void;
  stop(): void;
}

/**
 * Subscribe to the store and autosave `project` (debounced) and the UI prefs. Skips while `ui.readOnly`.
 * At start the stored document counts as this tab's own; when there is none the project is written right away
 * (so its id survives a reload). A stored document with another key than the one this tab last wrote or adopted
 * belongs to another tab: it is reported once (`onExternalChange`) and never overwritten (see `adopt`).
 * Without storage (localStorage blocked) it does nothing and never calls `onSaveError`: the start-up notice
 * 'storage-unavailable' already says that nothing is saved, so edits must not add a "lite plass?" banner on top.
 */
export function startAutosave(store: AppStore, opts: AutosaveOptions): AutosaveController {
  const { storage, target } = opts;
  if (!storage) return { flush: () => {}, saveNow: () => false, adopt: () => {}, stop: () => {} };
  const delay = opts.delayMs ?? AUTOSAVE_DELAY_MS;
  let lastWritten: string | null = storedProjectKey(storage);
  let lastSaved: Project | null = null;
  let lastPrefs = JSON.stringify(pickUiPrefs(store.getState().ui));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reportedExternal: string | null = null;

  const reportExternal = (p: Project) => {
    const key = projectKey(p);
    if (key === reportedExternal) return;
    reportedExternal = key;
    opts.onExternalChange?.(p);
  };

  /** Returns true when the project is in storage afterwards. */
  const saveProject = (force = false): boolean => {
    const { project, ui } = store.getState();
    if (ui.readOnly) return false;
    if (project === lastSaved && !force) return true;
    const key = projectKey(project);
    const stored = storedProjectKey(storage);
    if (stored !== null && stored === key) {
      // Already there (loaded from storage, taken over from another tab, or written before).
      lastSaved = project;
      lastWritten = key;
      return true;
    }
    if (stored !== null && stored !== lastWritten) {
      const other = loadAutosave(storage);
      if (other.status === 'ok') reportExternal(other.project);
      return false;
    }
    if (saveAutosave(storage, project)) {
      lastSaved = project;
      lastWritten = key;
      return true;
    }
    opts.onSaveError?.();
    return false;
  };

  if (lastWritten === null && !store.getState().ui.readOnly) saveProject();

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
    const raw = parseJson(e.newValue);
    if (!isRecord(raw)) return;
    const key = projectKey(raw);
    if (key === lastWritten || key === projectKey(project)) return;
    const result = migrateRaw(raw);
    if (result.status === 'ok') reportExternal(result.project);
  };
  const onLeave = () => flush();

  target?.addEventListener('storage', onStorage);
  target?.addEventListener('pagehide', onLeave);
  target?.addEventListener('beforeunload', onLeave);

  return {
    flush,
    saveNow: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      savePrefs();
      return saveProject(true);
    },
    adopt: () => {
      lastWritten = storedProjectKey(storage);
      lastSaved = null;
      reportedExternal = null;
    },
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
