import { describe, expect, it } from 'vitest';
import { migrateProject, migrations, ProjectValidationError, rawSchemaVersion, SchemaTooNewError } from './migrate';
import { CURRENT_SCHEMA_VERSION } from './types';

/** Minimal v1 document as a user might have stored it: required fields only, optional collections missing. */
const V1_MINIMAL = {
  schemaVersion: 1,
  id: 'p-1',
  name: 'Testhytte',
  site: {
    originLatLon: { lat: 68.61305, lon: 14.968157 },
    planNorthBearing: 106,
    floorElevation: 161,
    terrainId: 'merkesvatnet-2026-10',
  },
  variants: [
    {
      id: 'v-1',
      name: 'Forslag D',
      levels: [{ id: 'main', name: 'Hovedplan', storeyId: 'ground', elevation: 0, floorThickness: 0 }],
      blocks: [
        {
          id: 'blk',
          name: 'Hytta',
          polygon: [
            { id: 'a', p: [0, 0] },
            { id: 'b', p: [6, 0] },
            { id: 'c', p: [6, 4] },
            { id: 'd', p: [0, 4] },
          ],
          levelId: 'main',
          isNew: false,
          wall: { thickness: 0.27, outerOffset: 0.11 },
          eaveHeight: 2.22,
          roof: { type: 'gable', ridgeAxis: 'x', drive: 'pitch', pitchDeg: 28, ridgeHeight: 3.87, thickness: 0.31, overhangEave: 0.51, overhangGable: 0.35, material: 'turf' },
        },
      ],
      rooms: [{ id: 'r-1', name: 'Stue', type: 'stue', levelId: 'main', anchor: [3, 2] }],
    },
  ],
  activeVariantId: 'v-1',
};

/** The same document fully populated, as the app writes it. */
const V1_FULL = {
  ...V1_MINIMAL,
  createdAt: '2026-10-11T10:00:00.000Z',
  updatedAt: '2026-10-11T11:00:00.000Z',
  seedRevision: 1,
  basedOnProjectId: 'p-0',
  site: { ...V1_MINIMAL.site, waterLevel: 152, timezone: 'Europe/Oslo', groundWorks: [], trees: [{ id: 't1', position: [-4, 4], height: 5, kind: 'bjork' }] },
  variants: [
    {
      ...V1_MINIMAL.variants[0],
      createdAt: '2026-10-11T10:00:00.000Z',
      blocks: [{ ...V1_MINIMAL.variants[0].blocks[0], floorZones: [], parts: [], junctions: [] }],
      walls: [],
      openings: [],
      furniture: [],
      structure: [],
      outdoor: { decks: [], railings: [], hotTubs: [] },
      settings: { defaultExteriorWall: { thickness: 0.27, outerOffset: 0.11 }, defaultInteriorThickness: 0.12, areaLimit: null },
    },
  ],
};

describe('migrateProject v1', () => {
  it('fills defaults for a minimal v1 document', () => {
    const p = migrateProject(V1_MINIMAL);
    expect(p.schemaVersion).toBe(1);
    expect(p.id).toBe('p-1');
    expect(p.seedRevision).toBe(0);
    expect(typeof p.createdAt).toBe('string');
    expect(typeof p.updatedAt).toBe('string');
    expect(p.site.timezone).toBe('Europe/Oslo');
    expect(p.site.groundWorks).toEqual([]);
    expect(p.site.trees).toEqual([]);
    const v = p.variants[0];
    expect(v.walls).toEqual([]);
    expect(v.openings).toEqual([]);
    expect(v.furniture).toEqual([]);
    expect(v.structure).toEqual([]);
    expect(v.outdoor).toEqual({ decks: [], railings: [], hotTubs: [] });
    expect(v.settings).toEqual({ defaultExteriorWall: { thickness: 0.27, outerOffset: 0.11 }, defaultInteriorThickness: 0.12, areaLimit: null });
    expect(v.blocks[0].floorZones).toEqual([]);
    expect(v.blocks[0].parts).toEqual([]);
    expect(v.blocks[0].junctions).toEqual([]);
    expect(v.rooms).toHaveLength(1);
    expect('basedOnProjectId' in p).toBe(false);
  });

  it('is a no-op for a fully populated document and does not mutate the input', () => {
    const frozen = structuredClone(V1_FULL);
    const before = JSON.stringify(frozen);
    const p = migrateProject(frozen);
    expect(JSON.stringify(frozen)).toBe(before);
    expect(p).toEqual(V1_FULL);
    expect(p).not.toBe(frozen);
    expect(p.variants[0]).not.toBe(frozen.variants[0]);
  });

  it('is idempotent', () => {
    const once = migrateProject(V1_MINIMAL);
    const twice = migrateProject(once);
    expect(twice).toEqual(once);
  });

  it('treats a missing schemaVersion as 1', () => {
    const { schemaVersion: _drop, ...noVersion } = V1_MINIMAL;
    void _drop;
    expect(rawSchemaVersion(noVersion)).toBe(1);
    expect(migrateProject(noVersion).schemaVersion).toBe(1);
  });

  it('falls back to the first variant when activeVariantId is unknown', () => {
    const p = migrateProject({ ...V1_MINIMAL, activeVariantId: 'nope' });
    expect(p.activeVariantId).toBe('v-1');
  });

  it('merges partial settings with the defaults', () => {
    const doc = structuredClone(V1_MINIMAL) as Record<string, unknown>;
    (doc.variants as Record<string, unknown>[])[0].settings = { defaultInteriorThickness: 0.1 };
    const p = migrateProject(doc);
    expect(p.variants[0].settings.defaultInteriorThickness).toBe(0.1);
    expect(p.variants[0].settings.defaultExteriorWall.thickness).toBe(0.27);
    expect(p.variants[0].settings.areaLimit).toBeNull();
  });
});

describe('migrateProject errors', () => {
  it('throws SchemaTooNewError for a newer schema', () => {
    const tooNew = { ...V1_MINIMAL, schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    expect(() => migrateProject(tooNew)).toThrow(SchemaTooNewError);
    try {
      migrateProject(tooNew);
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaTooNewError);
      expect((e as SchemaTooNewError).schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 1);
      expect((e as SchemaTooNewError).supported).toBe(CURRENT_SCHEMA_VERSION);
    }
  });

  it('rejects non-objects and missing required fields', () => {
    expect(() => migrateProject(null)).toThrow(ProjectValidationError);
    expect(() => migrateProject('x')).toThrow(ProjectValidationError);
    expect(() => migrateProject([])).toThrow(ProjectValidationError);
    expect(() => migrateProject({ ...V1_MINIMAL, id: '' })).toThrow(/id/);
    expect(() => migrateProject({ ...V1_MINIMAL, variants: [] })).toThrow(/variants/);
    expect(() => migrateProject({ ...V1_MINIMAL, site: { originLatLon: { lat: 1 } } })).toThrow(/originLatLon\.lon/);
    expect(() => migrateProject({ ...V1_MINIMAL, variants: [{ name: 'no id' }] })).toThrow(/variants\[0\]\.id/);
  });

  it('rejects duplicate variant ids and non-array collections', () => {
    const dup = { ...V1_MINIMAL, variants: [V1_MINIMAL.variants[0], V1_MINIMAL.variants[0]] };
    expect(() => migrateProject(dup)).toThrow(/unique/);
    const badWalls = structuredClone(V1_MINIMAL) as Record<string, unknown>;
    (badWalls.variants as Record<string, unknown>[])[0].walls = {};
    expect(() => migrateProject(badWalls)).toThrow(/walls/);
  });
});

describe('migrations table', () => {
  it('has one entry per schema version up to the current one', () => {
    for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      expect(typeof migrations[v]).toBe('function');
    }
  });
});
