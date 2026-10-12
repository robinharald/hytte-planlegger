import { describe, expect, it } from 'vitest';
import { furnitureSizeFallback, migrateProject, migrations, ProjectValidationError, rawSchemaVersion, SchemaTooNewError } from './migrate';
import { createForslagD } from './seed/forslagD';
import { FROZEN_SCHEMA_VERSION, FROZEN_SEED_REVISION, frozenSchema1Project } from './seed/frozenSeed';
import { CURRENT_SCHEMA_VERSION } from './types';
import type { Deck } from './types';

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

const SETTINGS = { defaultExteriorWall: { thickness: 0.27, outerOffset: 0.11 }, defaultInteriorThickness: 0.12, areaLimit: null };

/** The same document fully populated, as the phase-1 app wrote it (schema 1: railings in `outdoor`). */
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
      settings: SETTINGS,
    },
  ],
};

/** The fully populated document at schema 2, as the app writes it now. */
const V2_FULL = {
  ...V1_FULL,
  schemaVersion: 2,
  variants: [
    {
      ...V1_FULL.variants[0],
      notes: 'Merknad',
      locked: false,
      ghosts: [{ id: 'g-1', a: [0, 0], b: [1, 0] }],
      furniture: [{ id: 'f-1', catalogId: 'seng-150', position: [3, 2], rotationDeg: 90, levelId: 'main', size: { w: 1.5, d: 2, h: 0.5 }, isNew: true }],
      outdoor: {
        decks: [
          {
            id: 'deck',
            polygon: [
              { id: 'k0', p: [0, -3] },
              { id: 'k1', p: [6, -3] },
              { id: 'k2', p: [6, 0] },
              { id: 'k3', p: [0, 0] },
            ],
            topHeight: 0,
            isNew: true,
            railing: { style: 'boards', height: 1 },
            noRailingEdges: ['k2'],
            steps: [{ id: 's-1', edgeId: 'k0', offset: 3, width: 1.2 }],
          },
        ],
        hotTubs: [{ id: 'tub', centre: [2, -1.5], diameter: 2, isNew: true }],
      },
    },
  ],
};

type AnyDoc = Record<string, unknown>;

/** A v1 document with one deck rect(0, −3, 6, 0) (edge 0 = the south edge) and the given railings. */
function v1WithDeck(railings: unknown[], deckExtra: AnyDoc = {}): AnyDoc {
  const doc = structuredClone(V1_FULL) as unknown as AnyDoc;
  const variant = (doc.variants as AnyDoc[])[0];
  variant.outdoor = {
    decks: [
      {
        id: 'deck',
        polygon: [
          [0, -3],
          [6, -3],
          [6, 0],
          [0, 0],
        ],
        topHeight: 0,
        isNew: true,
        ...deckExtra,
      },
    ],
    railings,
    hotTubs: [],
  };
  return doc;
}

/** A v1 railing on 'deck' along the west edge down, the south edge and the east edge up: (0, 0) → (0, −3) → (6, −3) → (6, 0). */
const rail = (id: string, gaps: { from: number; to: number; steps: boolean }[], extra: AnyDoc = {}) => ({
  id,
  deckId: 'deck',
  path: [
    [0, 0],
    [0, -3],
    [6, -3],
    [6, 0],
  ],
  height: 1.05,
  style: 'glass',
  gaps,
  isNew: true,
  ...extra,
});

const deckOf = (p: { variants: { outdoor: { decks: Deck[] } }[] }): Deck => p.variants[0].outdoor.decks[0];

describe('migrateProject: v1 rules', () => {
  it('fills defaults for a minimal v1 document and migrates it to the current schema', () => {
    const p = migrateProject(V1_MINIMAL);
    expect(p.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
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
    expect(v.outdoor).toEqual({ decks: [], hotTubs: [] });
    expect(v.settings).toEqual(SETTINGS);
    expect(v.blocks[0].floorZones).toEqual([]);
    expect(v.blocks[0].parts).toEqual([]);
    expect(v.blocks[0].junctions).toEqual([]);
    expect(v.rooms).toHaveLength(1);
    expect('basedOnProjectId' in p).toBe(false);
    expect('locked' in v).toBe(false);
  });

  it('applies the v1 defaults to a document that already claims schema 2', () => {
    const p = migrateProject({ ...V1_MINIMAL, schemaVersion: 2 });
    expect(p.schemaVersion).toBe(2);
    expect(p.variants[0].walls).toEqual([]);
    expect(p.variants[0].outdoor).toEqual({ decks: [], hotTubs: [] });
    expect(p.variants[0].settings).toEqual(SETTINGS);
  });

  it('treats a missing schemaVersion as 1', () => {
    const { schemaVersion: _drop, ...noVersion } = V1_MINIMAL;
    void _drop;
    expect(rawSchemaVersion(noVersion)).toBe(1);
    expect(migrateProject(noVersion).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
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

describe('migrateProject: v1 → v2', () => {
  it('a fully populated v1 document only changes where schema 2 differs; the input is not mutated', () => {
    const input = structuredClone(V1_FULL);
    const before = JSON.stringify(input);
    const p = migrateProject(input);
    expect(JSON.stringify(input)).toBe(before);
    const expected = { ...V1_FULL, schemaVersion: 2, variants: [{ ...V1_FULL.variants[0], outdoor: { decks: [], hotTubs: [] } }] };
    expect(p).toEqual(expected);
    expect(p.variants[0]).not.toBe(input.variants[0]);
  });

  it('a fully populated v2 document is a no-op', () => {
    const input = structuredClone(V2_FULL);
    const p = migrateProject(input);
    expect(p).toEqual(V2_FULL);
    expect(p).not.toBe(input);
  });

  it('is idempotent, field by field', () => {
    for (const doc of [V1_MINIMAL, V1_FULL, V2_FULL, v1WithDeck([rail('r', [{ from: 1, to: 2, steps: true }])])]) {
      const once = migrateProject(doc);
      expect(migrateProject(once)).toEqual(once);
    }
  });

  it('gives deck vertices ids and folds a railing into its deck: style, height, steps under the gap centres', () => {
    const p = migrateProject(v1WithDeck([rail('rail', [{ from: 4, to: 5.4, steps: true }, { from: 10.4, to: 11.6, steps: true }])]));
    const deck = deckOf(p);
    expect(deck.polygon.map((v) => v.id)).toEqual(['deck-v0', 'deck-v1', 'deck-v2', 'deck-v3']);
    expect(deck.polygon[1].p).toEqual([6, -3]);
    expect(deck.railing).toEqual({ style: 'glass', height: 1.05 });
    expect(deck.noRailingEdges).toEqual([]);
    // Gap 0: centre 4.7 along the path = (1.7, −3) on the south edge (deck-v0); gap 1: centre 11.0 = (6, −1) on the
    // east edge (deck-v1, offset 2).
    expect(deck.steps).toEqual([
      { id: 'rail/steps/0', edgeId: 'deck-v0', offset: 1.7, width: 1.4 },
      { id: 'rail/steps/1', edgeId: 'deck-v1', offset: 2, width: 1.2 },
    ]);
    expect('railings' in p.variants[0].outdoor).toBe(false);
  });

  it('a step-less gap over a whole deck edge becomes noRailingEdges; a partial one is dropped', () => {
    // 0 … 3 is the whole west edge (deck-v3, (0, 0) → (0, −3)); 4 … 5 is part of the south edge.
    const p = migrateProject(v1WithDeck([rail('rail', [{ from: 0, to: 3, steps: false }, { from: 4, to: 5, steps: false }])]));
    expect(deckOf(p).noRailingEdges).toEqual(['deck-v3']);
    expect(deckOf(p).steps).toEqual([]);
  });

  it('takes the railing style from the first railing on a deck, the steps from all of them; drops railings without a deck', () => {
    const p = migrateProject(
      v1WithDeck([
        rail('a', [{ from: 4, to: 5, steps: true }], { style: 'boards', height: 0.9 }),
        rail('b', [{ from: 7.5, to: 8.5, steps: true }]),
        rail('lost', [{ from: 1, to: 2, steps: true }], { deckId: 'nope' }),
      ]),
    );
    const deck = deckOf(p);
    expect(deck.railing).toEqual({ style: 'boards', height: 0.9 });
    expect(deck.steps.map((s) => s.id)).toEqual(['a/steps/0', 'b/steps/0']);
    expect(p.variants[0].outdoor.decks).toHaveLength(1);
  });

  it('never overwrites railing, steps, noRailingEdges or vertex ids that are present', () => {
    const doc = v1WithDeck([rail('rail', [{ from: 0, to: 3, steps: false }, { from: 4, to: 5, steps: true }])], {
      polygon: [{ id: 'k0', p: [0, -3] }, [6, -3], { id: 'k2', p: [6, 0] }, { p: [0, 0] }],
      railing: { style: 'boards', height: 0.8 },
      steps: [{ id: 'mine', edgeId: 'k0', offset: 1, width: 1 }],
      noRailingEdges: [],
    });
    const deck = deckOf(migrateProject(doc));
    expect(deck.polygon.map((v) => v.id)).toEqual(['k0', 'deck-v1', 'k2', 'deck-v3']);
    expect(deck.railing).toEqual({ style: 'boards', height: 0.8 });
    expect(deck.steps).toEqual([{ id: 'mine', edgeId: 'k0', offset: 1, width: 1 }]);
    expect(deck.noRailingEdges).toEqual([]);
  });

  it('furniture items get their size from the catalogue preset when they have none; a stored size stays', () => {
    const doc = structuredClone(V1_FULL) as unknown as AnyDoc;
    (doc.variants as AnyDoc[])[0].furniture = [
      { id: 'f-1', catalogId: 'sofa-3', position: [1, 1], rotationDeg: 0, levelId: 'main', isNew: true },
      { id: 'f-2', catalogId: 'seng-150', position: [2, 2], rotationDeg: 0, levelId: 'main', size: { w: 1.5, d: 2, h: 0.5 }, isNew: true },
    ];
    const [a, b] = migrateProject(doc).variants[0].furniture;
    expect(a.size).toEqual(furnitureSizeFallback('sofa-3'));
    expect(b.size).toEqual({ w: 1.5, d: 2, h: 0.5 });
  });

  it('the frozen phase-1 Forslag D migrates to exactly the current seed variant, except the lock, the glass part and the furniture', () => {
    expect(FROZEN_SCHEMA_VERSION).toBe(1);
    expect(FROZEN_SEED_REVISION).toBe(3);
    const p = migrateProject(frozenSchema1Project());
    expect(p.schemaVersion).toBe(2);
    expect(p.seedRevision).toBe(3);
    const seed = createForslagD();
    expect(p.variants[0].outdoor).toEqual(seed.variants[0].outdoor);
    const { locked, ...rest } = seed.variants[0];
    expect(locked).toBe(true);
    // Revision 5 gave the glass bump its existing part; the frozen revision-3 seed has none (a part-less existing
    // block gets one from its outline on its first edit, edit.ts todayPart). Revision 6 furnished the seed; the
    // revision-3 seed had no furniture.
    expect(p.variants[0].furniture).toEqual([]);
    expect(p.variants[0]).toEqual({ ...rest, furniture: [], blocks: rest.blocks.map((b) => (b.id === 'blk-glass' ? { ...b, parts: [] } : b)) });
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

  it('rejects duplicate variant ids, non-array collections and decks without an id or with broken vertices', () => {
    const dup = { ...V1_MINIMAL, variants: [V1_MINIMAL.variants[0], V1_MINIMAL.variants[0]] };
    expect(() => migrateProject(dup)).toThrow(/unique/);
    const badWalls = structuredClone(V1_MINIMAL) as Record<string, unknown>;
    (badWalls.variants as Record<string, unknown>[])[0].walls = {};
    expect(() => migrateProject(badWalls)).toThrow(/walls/);
    expect(() => migrateProject(v1WithDeck([], { id: undefined }))).toThrow(/decks\[0\]\.id/);
    expect(() => migrateProject(v1WithDeck([], { polygon: [[0, 0], 'x'] }))).toThrow(/polygon\[1\]/);
  });
});

describe('migrations table', () => {
  it('has one entry per schema version up to the current one', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
    for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      expect(typeof migrations[v]).toBe('function');
    }
  });
});
