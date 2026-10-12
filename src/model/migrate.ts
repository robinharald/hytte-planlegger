/**
 * Schema migrations for the stored Project document.
 *
 * `migrateProject(raw)` accepts anything parsed from JSON (autosave, versions, imports, share links) and returns a
 * valid `Project` at `CURRENT_SCHEMA_VERSION`, or throws:
 *  - `SchemaTooNewError` when `raw.schemaVersion > CURRENT_SCHEMA_VERSION` (the UI says "Last siden på nytt");
 *  - `ProjectValidationError` when a required field is missing or of the wrong type.
 *
 * Table contract: `migrations[v]` takes a document at version v−1 OR v and returns a valid document at version v
 * (so each step is idempotent for its own version). `migrateProject` runs `migrations[v]` for
 * v = max(1, raw.schemaVersion) … CURRENT. A missing `schemaVersion` means 1. The input is never mutated.
 *
 * v1 = validate the required fields and fill defaults for optional collections (empty arrays, default settings,
 * timestamps, seedRevision 0). Geometry is NOT validated here; that is the derivation pipeline's job (warnings).
 *
 * v2 (docs/phase2-plan.md §2) = the v1 rules (re-applied to a document that already claims v2, so a v2 document gets
 * the same defaults), then, field-wise idempotent — a field that is present is never overwritten:
 *  - deck vertices: plain `[x, y]` points become `{ id: \`${deckId}-v${i}\`, p }`; vertices that already have an id keep it;
 *  - `outdoor.railings`, only when it is a non-empty array: per deck, `deck.railing` from the FIRST railing on that deck
 *    (style, height); every gap with `steps: true` becomes a `DeckSteps { id: \`${railingId}/steps/${gapIndex}\`, edgeId,
 *    offset, width }` on the stored deck edge nearest to the gap centre (offset = the centre projected on that edge,
 *    width = the gap length, both rounded to the millimetre); a gap without steps that covers a whole deck edge
 *    lying on the railing path puts that edge into `noRailingEdges` (other step-less gaps cannot be represented and
 *    are dropped). `deck.steps` / `deck.noRailingEdges` / `deck.railing` are only filled when absent. A railing
 *    whose deck does not exist is dropped. Deck edges that were not on any railing path get a railing in v2 where
 *    they are free (for Forslag D they all run along buildings, so nothing changes there);
 *  - then `railings` is deleted and `deck.noRailingEdges` / `deck.steps` default to [];
 *  - furniture items without a valid `size` get the catalogue preset (`furnitureSizeFallback`; phase 1 never stored
 *    furniture, so this only matters for hand-made files).
 * The variant fields `notes`, `locked`, `meta`, `ghosts` and the block fields `template`, `templateFrontEdgeId`,
 * `floorMaterial` are optional and get no defaults; in particular a migrated variant is NOT locked (only the bundled
 * Forslag D carries `locked: true`; a user's old copy stays editable).
 */
import { CURRENT_SCHEMA_VERSION, type Project } from './types';
import { placementSize } from '../furniture/catalog';

export class SchemaTooNewError extends Error {
  readonly schemaVersion: number;
  readonly supported: number;
  constructor(schemaVersion: number, supported: number) {
    super(`Project schemaVersion ${schemaVersion} is newer than the supported ${supported}`);
    this.name = 'SchemaTooNewError';
    this.schemaVersion = schemaVersion;
    this.supported = supported;
  }
}

export class ProjectValidationError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ProjectValidationError';
    this.path = path;
  }
}

type Doc = Record<string, unknown>;
export type Migration = (doc: Doc) => Doc;

// ---------------------------------------------------------------------------
// Small validation helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Doc {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireRecord(v: unknown, path: string): Doc {
  if (!isRecord(v)) throw new ProjectValidationError(path, 'expected an object');
  return v;
}

function requireString(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new ProjectValidationError(path, 'expected a non-empty string');
  return v;
}

function requireNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ProjectValidationError(path, 'expected a number');
  return v;
}

function arrayOrEmpty(v: unknown, path: string): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ProjectValidationError(path, 'expected an array');
  return v;
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function isoNow(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// v1
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  defaultExteriorWall: { thickness: 0.27, outerOffset: 0.11 },
  defaultInteriorThickness: 0.12,
  areaLimit: null,
};

function v1Site(raw: unknown): Doc {
  const site = requireRecord(raw, 'site');
  const origin = requireRecord(site.originLatLon, 'site.originLatLon');
  requireNumber(origin.lat, 'site.originLatLon.lat');
  requireNumber(origin.lon, 'site.originLatLon.lon');
  requireNumber(site.planNorthBearing, 'site.planNorthBearing');
  requireNumber(site.floorElevation, 'site.floorElevation');
  return {
    ...site,
    terrainId: stringOr(site.terrainId, ''),
    timezone: stringOr(site.timezone, 'Europe/Oslo'),
    groundWorks: arrayOrEmpty(site.groundWorks, 'site.groundWorks'),
    trees: arrayOrEmpty(site.trees, 'site.trees'),
  };
}

function v1Block(raw: unknown, path: string): Doc {
  const block = requireRecord(raw, path);
  requireString(block.id, `${path}.id`);
  if (!Array.isArray(block.polygon)) throw new ProjectValidationError(`${path}.polygon`, 'expected an array');
  return {
    ...block,
    name: stringOr(block.name, String(block.id)),
    floorZones: arrayOrEmpty(block.floorZones, `${path}.floorZones`),
    parts: arrayOrEmpty(block.parts, `${path}.parts`),
    junctions: arrayOrEmpty(block.junctions, `${path}.junctions`),
    isNew: Boolean(block.isNew),
  };
}

function v1Variant(raw: unknown, path: string, now: string): Doc {
  const v = requireRecord(raw, path);
  requireString(v.id, `${path}.id`);
  const outdoorRaw = v.outdoor === undefined || v.outdoor === null ? {} : requireRecord(v.outdoor, `${path}.outdoor`);
  const settingsRaw = v.settings === undefined || v.settings === null ? {} : requireRecord(v.settings, `${path}.settings`);
  return {
    ...v,
    name: stringOr(v.name, String(v.id)),
    createdAt: stringOr(v.createdAt, now),
    levels: arrayOrEmpty(v.levels, `${path}.levels`),
    blocks: arrayOrEmpty(v.blocks, `${path}.blocks`).map((b, i) => v1Block(b, `${path}.blocks[${i}]`)),
    walls: arrayOrEmpty(v.walls, `${path}.walls`),
    openings: arrayOrEmpty(v.openings, `${path}.openings`),
    rooms: arrayOrEmpty(v.rooms, `${path}.rooms`),
    furniture: arrayOrEmpty(v.furniture, `${path}.furniture`),
    structure: arrayOrEmpty(v.structure, `${path}.structure`),
    outdoor: {
      decks: arrayOrEmpty(outdoorRaw.decks, `${path}.outdoor.decks`),
      railings: arrayOrEmpty(outdoorRaw.railings, `${path}.outdoor.railings`),
      hotTubs: arrayOrEmpty(outdoorRaw.hotTubs, `${path}.outdoor.hotTubs`),
    },
    settings: {
      ...DEFAULT_SETTINGS,
      ...settingsRaw,
      defaultExteriorWall: isRecord(settingsRaw.defaultExteriorWall)
        ? { ...DEFAULT_SETTINGS.defaultExteriorWall, ...settingsRaw.defaultExteriorWall }
        : DEFAULT_SETTINGS.defaultExteriorWall,
      areaLimit: typeof settingsRaw.areaLimit === 'number' ? settingsRaw.areaLimit : null,
    },
  };
}

/** v1: validate required fields and fill defaults. Idempotent. */
const toV1: Migration = (doc) => {
  const now = isoNow();
  requireString(doc.id, 'id');
  requireString(doc.name, 'name');
  const variantsRaw = doc.variants;
  if (!Array.isArray(variantsRaw) || variantsRaw.length === 0) {
    throw new ProjectValidationError('variants', 'expected a non-empty array');
  }
  const variants = variantsRaw.map((v, i) => v1Variant(v, `variants[${i}]`, now));
  const ids = new Set(variants.map((v) => v.id as string));
  if (ids.size !== variants.length) throw new ProjectValidationError('variants', 'variant ids must be unique');
  const active = typeof doc.activeVariantId === 'string' && ids.has(doc.activeVariantId) ? doc.activeVariantId : (variants[0].id as string);
  const out: Doc = {
    ...doc,
    schemaVersion: 1,
    createdAt: stringOr(doc.createdAt, now),
    updatedAt: stringOr(doc.updatedAt, now),
    seedRevision: typeof doc.seedRevision === 'number' ? doc.seedRevision : 0,
    site: v1Site(doc.site),
    variants,
    activeVariantId: active,
  };
  if (typeof doc.basedOnProjectId !== 'string') delete out.basedOnProjectId;
  return out;
};

// ---------------------------------------------------------------------------
// v2
// ---------------------------------------------------------------------------

type Pt = [number, number];

const isPt = (v: unknown): v is Pt => Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
const mm = (v: number): number => Math.round(v * 1000) / 1000;
const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Points within this distance (m) count as lying on a railing path. */
const ON_PATH = 0.001;

/**
 * Size of a furniture item without a stored size: the catalogue preset (`sizeVariant`, else the entry's default), or
 * a neutral 1 × 1 × 1 m box for an id the catalogue does not know.
 */
export function furnitureSizeFallback(catalogId: string, sizeVariant?: string): { w: number; d: number; h: number } {
  return placementSize(catalogId, sizeVariant)?.size ?? { w: 1, d: 1, h: 1 };
}

function isSize(v: unknown): v is { w: number; d: number; h: number } {
  return isRecord(v) && [v.w, v.d, v.h].every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0);
}

/** Closest point of segment a–b to p: distance along the segment and the distance to it. */
function project(p: Pt, a: Pt, b: Pt): { s: number; d: number; len: number } {
  const len = dist(a, b);
  if (len < 1e-12) return { s: 0, d: dist(p, a), len };
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const s = Math.max(0, Math.min(len, (p[0] - a[0]) * ux + (p[1] - a[1]) * uy));
  return { s, d: dist(p, [a[0] + ux * s, a[1] + uy * s]), len };
}

interface Path {
  pts: Pt[];
  cum: number[];
  total: number;
}

function pathOf(raw: unknown): Path {
  const pts = Array.isArray(raw) ? raw.filter(isPt).map((p): Pt => [p[0], p[1]]) : [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return { pts, cum, total: cum[cum.length - 1] ?? 0 };
}

/** Point at distance s along the path (clamped). */
function pathPoint(path: Path, s: number): Pt {
  const { pts, cum, total } = path;
  if (pts.length === 0) return [0, 0];
  const d = Math.min(Math.max(s, 0), total);
  for (let i = 0; i + 1 < pts.length; i++) {
    const len = cum[i + 1] - cum[i];
    if (d <= cum[i + 1] + 1e-12 && len > 1e-12) {
      const t = (d - cum[i]) / len;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
  }
  return pts[pts.length - 1];
}

/** Distance along the path to a point lying on it (≤ 1 mm), or null. */
function alongPath(path: Path, p: Pt): number | null {
  for (let i = 0; i + 1 < path.pts.length; i++) {
    const hit = project(p, path.pts[i], path.pts[i + 1]);
    if (hit.d <= ON_PATH) return path.cum[i] + hit.s;
  }
  return null;
}

/** A deck vertex list with ids: plain points get `${deckId}-v${i}`, vertices with an id keep it. */
function v2DeckPolygon(raw: unknown, deckId: string, path: string): Doc[] {
  return arrayOrEmpty(raw, path).map((v, i) => {
    if (isPt(v)) return { id: `${deckId}-v${i}`, p: [v[0], v[1]] };
    if (isRecord(v) && isPt(v.p)) return { ...v, id: typeof v.id === 'string' && v.id.length > 0 ? v.id : `${deckId}-v${i}` };
    throw new ProjectValidationError(`${path}[${i}]`, 'expected a point or a deck vertex');
  });
}

interface DeckWork {
  doc: Doc;
  /** Fields the stored deck already had (never overwritten). */
  had: { railing: boolean; steps: boolean; noRailingEdges: boolean };
  steps: Doc[];
  noRailingEdges: string[];
}

/** Stored edges of a deck: id = start vertex id, a → b. */
function deckEdges(polygon: Doc[]): { id: string; a: Pt; b: Pt }[] {
  return polygon.map((v, i) => ({ id: String(v.id), a: v.p as Pt, b: polygon[(i + 1) % polygon.length].p as Pt }));
}

/** Folds one v1 railing into its deck (see the header). */
function foldRailing(railing: Doc, deck: DeckWork): void {
  if (!deck.had.railing && deck.doc.railing === undefined) {
    deck.doc.railing = {
      style: railing.style === 'boards' ? 'boards' : 'glass',
      height: typeof railing.height === 'number' && Number.isFinite(railing.height) ? railing.height : 1.05,
    };
  }
  const path = pathOf(railing.path);
  const edges = deckEdges(deck.doc.polygon as Doc[]);
  if (path.pts.length < 2 || edges.length < 2) return;
  const railingId = typeof railing.id === 'string' ? railing.id : String(deck.doc.id);
  const gaps = Array.isArray(railing.gaps) ? railing.gaps : [];
  gaps.forEach((g, gapIndex) => {
    if (!isRecord(g) || typeof g.from !== 'number' || typeof g.to !== 'number') return;
    const from = Math.max(0, Math.min(g.from, g.to, path.total));
    const to = Math.min(path.total, Math.max(g.from, g.to, 0));
    if (to - from <= 1e-9) return;
    if (g.steps === true) {
      const centre = pathPoint(path, (from + to) / 2);
      let best: { id: string; s: number; d: number } | null = null;
      for (const e of edges) {
        const hit = project(centre, e.a, e.b);
        if (hit.len > 1e-9 && (best === null || hit.d < best.d - 1e-12)) best = { id: e.id, s: hit.s, d: hit.d };
      }
      if (best) deck.steps.push({ id: `${railingId}/steps/${gapIndex}`, edgeId: best.id, offset: mm(best.s), width: mm(to - from) });
      return;
    }
    for (const e of edges) {
      const da = alongPath(path, e.a);
      const db = alongPath(path, e.b);
      if (da === null || db === null || Math.abs(Math.abs(db - da) - dist(e.a, e.b)) > ON_PATH) continue;
      if (Math.min(da, db) >= from - ON_PATH && Math.max(da, db) <= to + ON_PATH && !deck.noRailingEdges.includes(e.id)) deck.noRailingEdges.push(e.id);
    }
  });
}

function v2Variant(raw: unknown, path: string): Doc {
  const v = requireRecord(raw, path);
  const outdoorRaw = isRecord(v.outdoor) ? v.outdoor : {};
  const decks: DeckWork[] = arrayOrEmpty(outdoorRaw.decks, `${path}.outdoor.decks`).map((d, i) => {
    const deckPath = `${path}.outdoor.decks[${i}]`;
    const deck = requireRecord(d, deckPath);
    const id = requireString(deck.id, `${deckPath}.id`);
    return {
      doc: { ...deck, polygon: v2DeckPolygon(deck.polygon, id, `${deckPath}.polygon`) },
      had: { railing: deck.railing !== undefined, steps: Array.isArray(deck.steps), noRailingEdges: Array.isArray(deck.noRailingEdges) },
      steps: [],
      noRailingEdges: [],
    };
  });
  const railings = Array.isArray(outdoorRaw.railings) ? outdoorRaw.railings : [];
  for (const r of railings) {
    if (!isRecord(r)) continue;
    const deck = decks.find((d) => d.doc.id === r.deckId);
    if (deck) foldRailing(r, deck);
  }
  for (const d of decks) {
    if (!d.had.steps) d.doc.steps = d.steps;
    if (!d.had.noRailingEdges) d.doc.noRailingEdges = d.noRailingEdges;
  }
  const outdoor: Doc = { ...outdoorRaw, decks: decks.map((d) => d.doc), hotTubs: arrayOrEmpty(outdoorRaw.hotTubs, `${path}.outdoor.hotTubs`) };
  delete outdoor.railings;
  const furniture = arrayOrEmpty(v.furniture, `${path}.furniture`).map((f, i) => {
    const item = requireRecord(f, `${path}.furniture[${i}]`);
    if (isSize(item.size)) return item;
    const catalogId = typeof item.catalogId === 'string' ? item.catalogId : '';
    return { ...item, size: furnitureSizeFallback(catalogId, typeof item.sizeVariant === 'string' ? item.sizeVariant : undefined) };
  });
  return { ...v, outdoor, furniture };
}

/** v2: the v1 rules, then decks with vertex ids, railing and steps; furniture sizes. Idempotent. */
const toV2: Migration = (doc) => {
  const v1 = doc.schemaVersion === 1 ? doc : toV1(doc);
  const variants = (v1.variants as unknown[]).map((v, i) => v2Variant(v, `variants[${i}]`));
  return { ...v1, schemaVersion: 2, variants };
};

// ---------------------------------------------------------------------------
// Table and entry point
// ---------------------------------------------------------------------------

export const migrations: Record<number, Migration> = {
  1: toV1,
  2: toV2,
};

/** Version a raw document claims. Missing or invalid → 1. */
export function rawSchemaVersion(raw: unknown): number {
  if (!isRecord(raw)) return 1;
  const v = raw.schemaVersion;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 1;
}

export function migrateProject(raw: unknown): Project {
  if (!isRecord(raw)) throw new ProjectValidationError('', 'expected an object');
  const version = rawSchemaVersion(raw);
  if (version > CURRENT_SCHEMA_VERSION) throw new SchemaTooNewError(version, CURRENT_SCHEMA_VERSION);
  let doc: Doc = structuredClone(raw);
  for (let v = version; v <= CURRENT_SCHEMA_VERSION; v++) {
    const step = migrations[v];
    if (!step) throw new ProjectValidationError('schemaVersion', `no migration for version ${v}`);
    doc = step(doc);
  }
  return doc as unknown as Project;
}
