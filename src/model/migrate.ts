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
 */
import { CURRENT_SCHEMA_VERSION, type Project } from './types';

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
// Table and entry point
// ---------------------------------------------------------------------------

export const migrations: Record<number, Migration> = {
  1: toV1,
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
