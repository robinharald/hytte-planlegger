/**
 * Persistence (architecture.md "State"): UI preferences, the legacy whole-project autosave (read once and turned into
 * proposals), named versions (read for "Eldre versjoner"), JSON export/import and share links. Everything here is
 * defensive: every storage access is wrapped in try/catch and every document read from outside (storage, file, link)
 * goes through `migrateProject`. The proposals themselves are saved by the family store (state/familyStore*.ts,
 * docs/phase2-plan.md §5): Forslag D is the bundled, locked base and is never stored.
 *
 * Storage keys
 *  - `hytte-planlegger:project`   the whole-project autosave of phase 1 / 2a (no longer written). At start-up its
 *                                 unlocked variants become proposals (`legacyProposals`); once they are stored the
 *                                 key is retired: copied to `hytte-planlegger:project.before-2b` and removed.
 *  - `hytte-planlegger:ui`        UI preferences (toggles, sun, preset …, the view only when the user chose it,
 *                                 `v` = PREFS_VERSION) plus `dismissedSeedRevision`; saved by `startPrefsAutosave`.
 *  - `hytte-planlegger:versions`  `StoredVersion[]` (any project); listed per projectId newest first, at most
 *                                 `VERSION_LIMIT` per project (the oldest of that project is dropped first).
 *  - `hytte-planlegger:project.bak` copy of an autosave that could not be read, so it is never silently lost.
 *  - `hytte-planlegger:project.backup-v1` copy of a phase-1 autosave kept by phase 2a (left alone).
 *
 * Share link: `#d=` + lz-string `compressToEncodedURIComponent(JSON.stringify(payload))`. The payload is a DELTA
 * against the bundled Forslag D seed (`DeltaSharePayload`: per variant the changed top-level fields and, per
 * collection, the added and changed entities in full plus the removed ids) whenever that is smaller than the full
 * `{ v, project }` (whatever the project's own seed revision: the delta records it in `project.seedRevision`).
 * Timestamps are never sent. `v` is the schema version (lets a decoder reject a too-new link before reading it).
 * Only the active variant is included unless `allVariants`. The terrain is never part of a project, so never part of
 * a link. Decoding: a delta of an older schema (`v` < CURRENT_SCHEMA_VERSION, made by phase 1) is applied to the
 * FROZEN schema-1 seed (model/seed/frozenSeed.ts) and then migrated; a current one to the current seed. A delta made
 * against an older seed revision than its base is applied to that base (`rebased`); one from a newer revision than
 * the bundled seed is 'too-new'. Outdoor collections are keyed `outdoor.<name>` (schema 2: decks, hotTubs; the frozen
 * base also knows `outdoor.railings`). Since phase 2b an opened `#d=` link is imported as new proposals
 * (`linkProposals`: ids derived from the link, so opening the same link twice adds nothing twice).
 */
import LZString from 'lz-string';
import { nanoid } from 'nanoid';
import { migrateProject, SchemaTooNewError } from '../model/migrate';
import { createForslagD, createForslagDVariant, SEED_REVISION, SEED_VARIANT_ID } from '../model/seed/forslagD';
import { FROZEN_SEED_REVISION, frozenSchema1Project, frozenSchema1Variant } from '../model/seed/frozenSeed';
/** The phase-1 Forslag D of SEED_REVISION 2 (schema 1), frozen from commit 0d37025: never edit it. */
import frozenSeedRevision2 from '../model/seed/frozen/forslagD.schema1.rev2.json';
import { CURRENT_SCHEMA_VERSION } from '../model/types';
import type { Id, Project, Site, Variant } from '../model/types';
import { nb } from '../i18n/nb';
import { cleanVariant, isValidProposalId, sameContent } from './familyStore';
import { CAMERA_PRESET_KEYS } from './store';
import type { ActiveView, AppStore, UiState } from './store';

export const KEYS = {
  project: 'hytte-planlegger:project',
  ui: 'hytte-planlegger:ui',
  versions: 'hytte-planlegger:versions',
  projectBackup: 'hytte-planlegger:project.bak',
  projectBackupV1: 'hytte-planlegger:project.backup-v1',
  /** The legacy autosave after its proposals were moved into the family store. */
  projectBeforeFamily: 'hytte-planlegger:project.before-2b',
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
// The legacy whole-project autosave
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

/** What the one-time move of a legacy autosave into the family store brings. */
export interface LegacyImport {
  /** Its proposals (`legacyProposals`). */
  variants: Variant[];
  /** The proposal (its id after the move) the autosave had on screen; null for Forslag D or a dropped untouched copy. */
  activeId: Id | null;
  /** The autosave's own last save time: its proposals keep it as «sist endret» (null when it is not a valid time). */
  updatedAt: string | null;
}

let frozenBases: Variant[] | null = null;

/**
 * The Forslag D an autosave's copies were made from: the bundled one for an autosave of the current seed revision,
 * else the phase-1 Forslag D — the frozen schema-1 seed of revision 3 and the one of revision 2 (the live site served
 * revision 2 for 11 minutes on 11 Oct 2026, and an autosave from then keeps that copy also after «Hent ny Forslag D»;
 * model/seed/frozen/forslagD.schema1.rev2.json), migrated. Phase 1 wrote its working copy of Forslag D on a plain
 * visit, so an untouched phase-1 copy equals one of these — never the current, furnished one.
 */
function legacyBasesFor(saved: Project, base: Variant): Variant[] {
  if (saved.seedRevision >= SEED_REVISION) return [base];
  if (!frozenBases) {
    frozenBases = [];
    for (const raw of [frozenSchema1Project(), structuredClone(frozenSeedRevision2) as unknown]) {
      try {
        const v = migrateProject(raw).variants[0];
        if (v) frozenBases.push(v);
      } catch {
        // not readable: compared with the others only
      }
    }
  }
  return frozenBases.length > 0 ? frozenBases : [base];
}

/**
 * Forslag D itself as an autosave holds it: `forslag-d` with its seed name, or the copy phase 1's «Hent ny Forslag D»
 * added (`forslag-d-r<n>-…`, «Forslag D (revisjon <n>)»). Any other copy has a name the user gave it or chose.
 */
function isSeedItself(v: Variant, base: Variant): boolean {
  if (v.id === base.id) return v.name === base.name;
  const m = /-r(\d+)-[A-Za-z0-9_-]+$/.exec(v.id);
  return m !== null && v.id.startsWith(`${base.id}-r`) && (v.name === base.name || v.name === nb.seed.variantName(Number(m[1])));
}

/**
 * The legacy autosave moved into the family store: its unlocked variants, except Forslag D itself when it is untouched
 * (`isSeedItself`, equal to the Forslag D it was made from, `legacyBasesFor`). A copy with a name of its own is kept
 * even when nothing in it was changed («Urørt kopi», «Mammas utkast»). The ids are kept (so importing twice adds
 * nothing twice) unless they are not valid proposal ids or clash with the base: a working copy of Forslag D gets
 * `forslag-d-eget-<hash of the autosave's own project id and time>`, unique per device (phase 1 gave every device its
 * own project id) and the same on every import. A name equal to the base's gets " (eget)" ("Forslag D (eget)").
 */
export function legacyImport(saved: Project, base: Variant): LegacyImport {
  const refs = legacyBasesFor(saved, base);
  const ids = new Set<Id>([base.id]);
  const names = new Set<string>([base.name]);
  const variants: Variant[] = [];
  let activeId: Id | null = null;
  for (const v of saved.variants) {
    if (v.locked) continue;
    if (isSeedItself(v, base) && refs.some((ref) => sameContent({ ...v, id: ref.id, name: ref.name, createdAt: ref.createdAt, basedOnId: ref.basedOnId }, ref))) continue;
    let id = isValidProposalId(v.id) ? v.id : v.id.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 60) || 'forslag';
    if (ids.has(id)) id = `${id}-eget-${fnv36(`${saved.id}|${saved.createdAt}|${v.createdAt}|${v.id}`)}`;
    for (let n = 2; ids.has(id); n++) id = `${v.id}-eget-${n}`;
    ids.add(id);
    let name = v.name;
    for (let n = 1; names.has(name); n++) name = nb.family.ownCopyName(v.name, n);
    names.add(name);
    variants.push(cleanVariant(v, id, name));
    if (v.id === saved.activeVariantId) activeId = id;
  }
  const updatedAt = Number.isFinite(Date.parse(saved.updatedAt)) ? saved.updatedAt : null;
  return { variants, activeId, updatedAt };
}

/** The proposals of a legacy autosave (`legacyImport`). */
export function legacyProposals(saved: Project, base: Variant): Variant[] {
  return legacyImport(saved, base).variants;
}

/** The legacy autosave has done its job: keep it under KEYS.projectBeforeFamily, then remove it. */
export function retireLegacyAutosave(storage: KeyValueStorage | null): void {
  const text = readRaw(storage, KEYS.project);
  if (text === null) return;
  if (readRaw(storage, KEYS.projectBeforeFamily) === null && !writeRaw(storage, KEYS.projectBeforeFamily, text)) return;
  removeRaw(storage, KEYS.project);
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
 * Version 3 (phase 2): "Vis hva som er nytt" became on by default; older prefs saved the old default `false` whether
 * or not the user chose it, so their `highlightNew` is not read (`HIGHLIGHT_NEW_PREFS_VERSION`).
 * Version 4 (fix round after 2a): the 3D view has its own switch, `highlightNew3d` (off by default); `highlightNew` now
 * colours the plan only. Older prefs have no `highlightNew3d`, so 3D starts in natural colours.
 */
export const PREFS_VERSION = 4;

/** Prefs from this version on hold a `highlightNew` the user meant (before it, it was the old default `false`). */
export const HIGHLIGHT_NEW_PREFS_VERSION = 3;

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
  'highlightNew3d',
  'showTrees',
  'showTerrain',
  'showClearances',
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

const BOOL_PREFS = ['showLabels', 'showDims', 'showGrid', 'showRoofPlan', 'highlightNew', 'highlightNew3d', 'showTrees', 'showTerrain', 'showClearances'] as const;

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
  const version = typeof raw.v === 'number' ? raw.v : 0;
  for (const k of BOOL_PREFS) {
    if (k === 'highlightNew' && version < HIGHLIGHT_NEW_PREFS_VERSION) continue;
    if (typeof raw[k] === 'boolean') out[k] = raw[k];
  }
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
export const OUTDOOR_COLLECTIONS = ['decks', 'hotTubs'] as const;
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

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

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
  // OUTDOOR_COLLECTIONS plus any other outdoor array either side has (a schema-1 document's `railings`).
  const outdoor = variant.outdoor as unknown as Record<string, unknown>;
  const seedOutdoor = seed.outdoor as unknown as Record<string, unknown>;
  for (const key of new Set<string>([...OUTDOOR_COLLECTIONS, ...Object.keys(outdoor), ...Object.keys(seedOutdoor)])) {
    const d = diffCollection(asArray(outdoor[key]), asArray(seedOutdoor[key]));
    if (d) changes[`outdoor.${key}`] = d;
  }
  const out: VariantDelta = { id: variant.id, set };
  if (unset.length > 0) out.unset = unset;
  if (Object.keys(changes).length > 0) out.changes = changes;
  return out;
}

/**
 * Rebuild a variant document (not yet migrated) from a delta and a fresh seed variant: the current `Variant`, or the
 * raw frozen schema-1 variant for a phase-1 link (its outdoor collections, `railings` included, are rebuilt too).
 */
export function applyVariantDelta(seed: Variant | Record<string, unknown>, d: VariantDelta, createdAt: string): Record<string, unknown> {
  const base = seed as Record<string, unknown>;
  const doc: Record<string, unknown> = { ...base };
  for (const k of Array.isArray(d.unset) ? d.unset : []) delete doc[k];
  if (isRecord(d.set)) for (const [k, value] of Object.entries(d.set)) if (!VARIANT_SPECIAL.has(k)) doc[k] = value;
  const changes = isRecord(d.changes) ? (d.changes as Record<string, CollectionDelta>) : {};
  for (const key of VARIANT_COLLECTIONS) doc[key] = applyCollection(asArray(base[key]), changes[key]);
  const baseOutdoor = isRecord(base.outdoor) ? base.outdoor : {};
  const outdoor: Record<string, unknown> = { ...baseOutdoor };
  for (const key of new Set([...Object.keys(baseOutdoor), ...OUTDOOR_COLLECTIONS])) {
    outdoor[key] = applyCollection(asArray(baseOutdoor[key]), changes[`outdoor.${key}`]);
  }
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
 * JSON of the share payload: the delta against the current seed when it is the smaller of the two (also for a project
 * of an older seed revision: the delta keeps that revision in `project.seedRevision`), else the full project. No
 * timestamps either way.
 */
export function sharePayloadJson(project: Project, opts: { allVariants: boolean }): string {
  const p = sharedProject(project, opts.allVariants);
  const full: SharePayload = { v: p.schemaVersion, project: withoutTimestamps(p) };
  const fullJson = JSON.stringify(full);
  const deltaJson = JSON.stringify(deltaPayload(p));
  return deltaJson.length < fullJson.length ? deltaJson : fullJson;
}

export function encodeShare(project: Project, opts: { allVariants: boolean }): string {
  return LZString.compressToEncodedURIComponent(sharePayloadJson(project, opts));
}

/**
 * Rebuild the project of a delta payload from the bundled seed — the frozen schema-1 seed (revision 3) when the
 * payload's schema `v` is older than the current one (a phase-1 link), else the current seed — then migrate it.
 * `rebased` when the payload was made against an older seed revision than the base it is applied to. Never throws.
 */
export function decodeDeltaPayload(raw: Record<string, unknown>, now: Date = new Date()): LoadResult {
  if (typeof raw.v === 'number' && raw.v > CURRENT_SCHEMA_VERSION) return { status: 'too-new', version: raw.v };
  const seedRevision = typeof raw.seedRevision === 'number' ? raw.seedRevision : 0;
  if (seedRevision > SEED_REVISION) return { status: 'too-new', version: typeof raw.v === 'number' ? raw.v : CURRENT_SCHEMA_VERSION };
  if (!isRecord(raw.project) || !Array.isArray(raw.variants)) return { status: 'invalid', error: 'not a delta payload' };
  const iso = now.toISOString();
  const meta = raw.project;
  const legacy = typeof raw.v === 'number' && raw.v < CURRENT_SCHEMA_VERSION;
  const baseRevision = legacy ? FROZEN_SEED_REVISION : SEED_REVISION;
  try {
    const seedProject: Record<string, unknown> = legacy ? frozenSchema1Project(iso) : (createForslagD(iso) as unknown as Record<string, unknown>);
    const variants = raw.variants.map((d) => {
      if (!isRecord(d) || typeof d.id !== 'string') throw new Error('variant delta without id');
      return applyVariantDelta(legacy ? frozenSchema1Variant(iso) : createForslagDVariant(iso), d as unknown as VariantDelta, iso);
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
    return result.status === 'ok' && seedRevision < baseRevision ? { ...result, rebased: true } : result;
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
// Opening a #d= link: its proposals are imported
// ---------------------------------------------------------------------------

/** FNV-1a (32 bit) in base 36: short, stable ids derived from a link. */
function fnv36(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * The variants of a decoded `#d=` link as new proposals: ids derived from the link (`d<hash>`, one per variant), so
 * the same link opened twice is recognised; unlocked; `basedOnId` = the shared id; a name already in use gets
 * " (delt)" / " (delt 2)". `activeId` = the copy of the link's active variant.
 */
export function linkProposals(shared: Project, encoded: string, existingNames: Iterable<string>, now: string): { variants: Variant[]; activeId: Id } {
  const names = new Set(existingNames);
  const base = fnv36(encoded);
  let activeId = '';
  const variants = shared.variants.map((v, i) => {
    const id = `d${base}${shared.variants.length > 1 ? `-${i + 1}` : ''}`;
    let name = v.name;
    for (let n = 1; names.has(name); n++) name = nb.share.sharedName(v.name, n);
    names.add(name);
    if (v.id === shared.activeVariantId) activeId = id;
    return { ...cleanVariant(structuredClone(v), id, name), createdAt: now, basedOnId: v.id };
  });
  return { variants, activeId: activeId || variants[0]?.id || '' };
}

// ---------------------------------------------------------------------------
// UI preferences autosave
// ---------------------------------------------------------------------------

export interface PrefsAutosave {
  flush(): void;
  stop(): void;
}

/**
 * Save the UI prefs (debounced, AUTOSAVE_DELAY_MS) whenever they change, on `pagehide`, and when `doc` (the document)
 * becomes hidden (iOS: leaving the app fires only that, and the timers stop right after). Without storage it does
 * nothing (the start-up notice 'storage-unavailable' says so).
 */
export function startPrefsAutosave(
  store: AppStore,
  opts: {
    storage: KeyValueStorage | null;
    delayMs?: number;
    target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
    doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | null;
  },
): PrefsAutosave {
  const { storage, target, doc } = opts;
  if (!storage) return { flush: () => {}, stop: () => {} };
  const delay = opts.delayMs ?? AUTOSAVE_DELAY_MS;
  let last = JSON.stringify(pickUiPrefs(store.getState().ui));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const ui = store.getState().ui;
    const json = JSON.stringify(pickUiPrefs(ui));
    if (json !== last && saveUiPrefs(storage, ui)) last = json;
  };
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.ui === prev.ui) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, delay);
  });
  const onVisibility = () => {
    if (doc?.visibilityState === 'hidden') flush();
  };
  target?.addEventListener('pagehide', flush);
  doc?.addEventListener('visibilitychange', onVisibility);
  return {
    flush,
    stop: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      unsubscribe();
      target?.removeEventListener('pagehide', flush);
      doc?.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

/** Forget the stored legacy autosave (tests). */
export function clearAutosave(storage: KeyValueStorage | null): void {
  removeRaw(storage, KEYS.project);
}

export type Notice = 'link-invalid' | 'link-too-new' | 'link-rebased' | 'autosave-invalid' | 'schema-too-new' | 'storage-unavailable';
