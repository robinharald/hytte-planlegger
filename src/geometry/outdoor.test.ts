import { describe, expect, it } from 'vitest';
import type { Block, Deck, Level, Railing, Site, StructureElement, TerrainAsset, Variant, Vec2 } from '../model/types';
import type { DerivedStructure } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import terrainJson from '../model/seed/terrain-merkesvatnet.json';
import { area, bbox, isCCW } from './polygon';
import { buildRoofs } from './roof';
import { deriveOutdoor, deriveStructure } from './outdoor';
import type { TerrainZFn } from './outdoor';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LEVELS: Level[] = [
  { id: 'lower', name: 'Underetasje', storeyId: 'ground', elevation: -1.0, ceilingHeight: 2.3, floorThickness: 0 },
  { id: 'main', name: 'Hovedplan', storeyId: 'ground', elevation: 0, floorThickness: 0 },
  { id: 'loft', name: 'Hems', storeyId: 'loft', elevation: 1.47, floorThickness: 0.17 },
];

const SITE: Site = {
  originLatLon: { lat: 68.6, lon: 15 },
  planNorthBearing: 106,
  floorElevation: 161,
  terrainId: 'none',
  groundWorks: [],
  timezone: 'Europe/Oslo',
  trees: [],
};

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

function mkVariant(extra: Partial<Variant>): Variant {
  return {
    id: 'v',
    name: 'Test',
    createdAt: '2026-10-11T12:00:00.000Z',
    levels: LEVELS,
    blocks: [],
    walls: [],
    openings: [],
    rooms: [],
    furniture: [],
    outdoor: { decks: [], railings: [], hotTubs: [] },
    structure: [],
    settings: { defaultExteriorWall: { thickness: 0.27, outerOffset: 0.11 }, defaultInteriorThickness: 0.12, areaLimit: null },
    ...extra,
  };
}

const deck = (polygon: Vec2[] = rect(0, 0, 6, 3), topHeight = 0): Deck => ({ id: 'deck', polygon, topHeight, isNew: true });

function railing(gaps: Railing['gaps'], path: Vec2[] = [[0, 0], [6, 0], [6, 3]], deckId = 'deck'): Railing {
  return { id: 'r', deckId, path, height: 1.05, style: 'glass', gaps, isNew: true };
}

const flatTerrain =
  (z: number): TerrainZFn =>
  () =>
    z;

function outdoorOf(v: Variant, terrainZ: TerrainZFn = flatTerrain(-0.9)) {
  return deriveOutdoor(v, SITE, null, { terrainZ });
}

function expectPts(actual: Vec2[], expected: Vec2[], digits = 9): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(expected[i][0], digits);
    expect(p[1]).toBeCloseTo(expected[i][1], digits);
  });
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

describe('deriveOutdoor: decks', () => {
  it('derives thickness, skirt bottoms from the terrain and the board direction', () => {
    const v = mkVariant({ outdoor: { decks: [deck(), { ...deck(rect(10, 0, 12, 5), -0.02), id: 'tall', isNew: false }], railings: [], hotTubs: [] } });
    const { decks } = outdoorOf(v, (x, y) => -0.5 - 0.1 * x - y * 0.01);
    expect(decks[0]).toMatchObject({ id: 'deck', topZ: 0, thickness: 0.15, boardDirection: 'x', isNew: true });
    expect(decks[0].skirtBottomZ.map((z) => +z.toFixed(9))).toEqual([-0.55, -1.15, -1.18, -0.58]);
    expect(decks[1]).toMatchObject({ topZ: -0.02, boardDirection: 'y', isNew: false });
    expectPts(decks[0].polygon, rect(0, 0, 6, 3));
  });

  it('uses terrainZAt by default (no terrain asset → fallback −0.5)', () => {
    const { decks } = deriveOutdoor(mkVariant({ outdoor: { decks: [deck()], railings: [], hotTubs: [] } }), SITE, null);
    expect(decks[0].skirtBottomZ).toEqual([-0.55, -0.55, -0.55, -0.55]);
  });
});

// ---------------------------------------------------------------------------
// Railings and steps
// ---------------------------------------------------------------------------

describe('deriveOutdoor: railings', () => {
  it('a railing with one gap: panels, posts and steps', () => {
    const v = mkVariant({ outdoor: { decks: [deck()], railings: [railing([{ from: 2, to: 3, steps: true }])], hotTubs: [] } });
    const [r] = outdoorOf(v).railings;
    expect(r).toMatchObject({ id: 'r', deckId: 'deck', baseZ: 0, height: 1.05, style: 'glass', isNew: true });
    expect(r.panels.map((p) => [p.a, p.b])).toEqual([
      [
        [0, 0, 0],
        [2, 0, 0],
      ],
      [
        [3, 0, 0],
        [6, 0, 0],
      ],
      [
        [6, 0, 0],
        [6, 3, 0],
      ],
    ]);
    expectPts(
      r.posts.map((p) => [p[0], p[1]]),
      [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [4.5, 0],
        [6, 0],
        [6, 1.5],
        [6, 3],
      ],
    );
    expect(r.posts.every((p) => p[2] === 0)).toBe(true);

    expect(r.steps).toHaveLength(1);
    const s = r.steps[0];
    expect(s).toMatchObject({ id: 'r/steps/0', width: 1, topZ: 0, bottomZ: -0.9, risers: 5, going: 0.3 });
    expectPts([s.at, s.outward], [
      [2.5, 0],
      [0, -1],
    ]);
    expect(s.riserHeight).toBeCloseTo(0.18, 12);
    expect(s.treads).toHaveLength(4);
    s.treads.forEach((t, i) => {
      expect(t.z).toBeCloseTo(-0.18 * (i + 1), 12);
      expect(isCCW(t.polygon)).toBe(true);
      const b = bbox(t.polygon);
      expectPts([b.min, b.max], [
        [2, -0.3 * (i + 1)],
        [3, -0.3 * i],
      ]);
    });
  });

  it('keeps the gap index in the step id, merges overlapping gaps and skips gaps without steps', () => {
    const gaps = [
      { from: 0.5, to: 1, steps: false },
      { from: 3, to: 2, steps: true }, // reversed
      { from: 2.5, to: 3.5, steps: false }, // overlaps the previous one
    ];
    const [r] = outdoorOf(mkVariant({ outdoor: { decks: [deck()], railings: [railing(gaps)], hotTubs: [] } })).railings;
    expect(r.steps.map((s) => s.id)).toEqual(['r/steps/1']);
    expect(r.panels.map((p) => [p.a[0], p.b[0]])).toEqual([
      [0, 0.5],
      [1, 2],
      [3.5, 6],
      [6, 6],
    ]);
  });

  it('steps point away from the deck on either side of the path and vanish when there is no drop', () => {
    // Path running the other way round (deck on the right-hand side).
    const reversed = railing([{ from: 3, to: 4, steps: true }], [[6, 3], [6, 0], [0, 0]]);
    const [r] = outdoorOf(mkVariant({ outdoor: { decks: [deck()], railings: [reversed], hotTubs: [] } })).railings;
    // Distance 3.5 along (6,3) → (6,0) → (0,0) is (5.5, 0); the deck lies to the right of the path there.
    expectPts([r.steps[0].at, r.steps[0].outward], [
      [5.5, 0],
      [0, -1],
    ]);
    const [flat] = outdoorOf(mkVariant({ outdoor: { decks: [deck()], railings: [railing([{ from: 2, to: 3, steps: true }])], hotTubs: [] } }), flatTerrain(0.1))
      .railings;
    expect(flat.steps[0]).toMatchObject({ risers: 0, riserHeight: 0, treads: [] });
  });

  it('rounds the riser count up with a tolerance (drop 1.0 → 6, drop 0.18 → 1)', () => {
    const risers = (z: number) =>
      outdoorOf(mkVariant({ outdoor: { decks: [deck()], railings: [railing([{ from: 2, to: 3, steps: true }])], hotTubs: [] } }), flatTerrain(z)).railings[0]
        .steps[0];
    expect(risers(-1.0).risers).toBe(6);
    expect(risers(-0.18).risers).toBe(1);
    expect(risers(-0.18).treads).toEqual([]);
    expect(risers(-0.19).risers).toBe(2);
  });

  it('stands on the terrain when its deck is missing', () => {
    const [r] = outdoorOf(mkVariant({ outdoor: { decks: [], railings: [railing([], undefined, 'nope')], hotTubs: [] } }), flatTerrain(-0.7)).railings;
    expect(r.baseZ).toBe(-0.7);
    expect(r.panels).toHaveLength(2);
    expect(r.posts).toHaveLength(7);
  });

  it('a gap covering the whole path leaves no panels or posts', () => {
    const [r] = outdoorOf(mkVariant({ outdoor: { decks: [deck()], railings: [railing([{ from: -1, to: 20, steps: false }])], hotTubs: [] } })).railings;
    expect(r.panels).toEqual([]);
    expect(r.posts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Hot tubs
// ---------------------------------------------------------------------------

describe('deriveOutdoor: hot tubs', () => {
  it('stands on the deck containing its centre, else on the terrain', () => {
    const v = mkVariant({
      outdoor: {
        decks: [deck(rect(0, 0, 6, 3), -0.02)],
        railings: [],
        hotTubs: [
          { id: 'on', centre: [3, 1.5], diameter: 2, isNew: true },
          { id: 'off', centre: [10, 1.5], diameter: 1.8, isNew: false },
        ],
      },
    });
    const [on, off] = outdoorOf(v, flatTerrain(-0.6)).hotTubs;
    expect(on).toMatchObject({ id: 'on', diameter: 2, baseZ: -0.02, isNew: true });
    expect(on.rimZ).toBeCloseTo(1.03, 12);
    expect(off).toMatchObject({ baseZ: -0.6, isNew: false });
    expect(off.rimZ).toBeCloseTo(0.45, 12);
  });
});

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

function mkBlock(id: string, poly: Vec2[], thickness = 0.31): Block {
  return {
    id,
    name: id,
    polygon: poly.map((p, i) => ({ id: `${id}-v${i}`, p })),
    levelId: 'main',
    floorZones: [],
    parts: [],
    isNew: false,
    wall: { thickness: 0.27, outerOffset: 0.11 },
    eaveHeight: 2.22,
    roof: { type: 'gable', ridgeAxis: 'x', drive: 'pitch', pitchDeg: 28, ridgeHeight: 3.87, thickness, overhangEave: 0.51, overhangGable: 0.35, material: 'turf' },
    junctions: [],
  };
}

function stair(id: string, min: Vec2, max: Vec2, from: string, to: string, up: 'N' | 'S' | 'E' | 'W'): StructureElement {
  return { id, kind: 'stair', min, max, fromLevelId: from, toLevelId: to, upDirection: up, isNew: false };
}

type Stair = Extract<DerivedStructure, { kind: 'stair' }>;

function asStair(s: DerivedStructure | undefined): Stair {
  if (s?.kind !== 'stair') throw new Error('not a stair');
  return s;
}

describe('deriveStructure', () => {
  it('passes posts and beams through with absolute z', () => {
    const v = mkVariant({
      structure: [
        { id: 'p', kind: 'post', position: [1, 2], size: 0.11, bottom: 0, top: 3.5, isNew: false },
        { id: 'b', kind: 'beam', a: [0, 3.1], b: [12, 3.1], width: 0.12, bottom: 3.5, top: 3.86, isNew: true },
      ],
    });
    const [p, b] = deriveStructure(v, [], { undersideAt: () => null });
    expect(p).toMatchObject({ id: 'p', kind: 'post', position: [1, 2], size: 0.11, bottomZ: 0, topZ: 3.5, isNew: false });
    expect(p.kind === 'post' && p.element).toBe(v.structure[0]);
    expect(b).toMatchObject({ id: 'b', kind: 'beam', a: [0, 3.1], b: [12, 3.1], width: 0.12, bottomZ: 3.5, topZ: 3.86, isNew: true });
  });

  it('a chimney exits the roof at the underside + the roof thickness of its block', () => {
    const chimney = (id: string, x: number): StructureElement => ({ id, kind: 'chimney', min: [x, 2], max: [x + 0.5, 2.5], bottom: 0, top: 5.2, isNew: false });
    const v = mkVariant({ blocks: [mkBlock('b', rect(0, 0, 10, 6))], structure: [chimney('in', 7), chimney('out', 20)] });
    const [inside, outside] = deriveStructure(v, [], { undersideAt: () => 3.5 });
    expect(inside.kind === 'chimney' && inside.roofExitZ).toBeCloseTo(3.81, 12);
    expect(outside).toMatchObject({ kind: 'chimney', roofExitZ: null, bottomZ: 0, topZ: 5.2 });
    const [noRoof] = deriveStructure(v, [], { undersideAt: () => null });
    expect(noRoof).toMatchObject({ roofExitZ: null });
  });

  it('stair lower → main (dz 1.0, up E): 6 treads', () => {
    const v = mkVariant({ structure: [stair('s', [4.3, 3.17], [5.55, 4.17], 'lower', 'main', 'E')] });
    const s = asStair(deriveStructure(v, [])[0]);
    expect(s).toMatchObject({ fromZ: -1, toZ: 0, upDirection: 'E' });
    expect(s.treads).toHaveLength(6);
    expect(s.riser).toBeCloseTo(1 / 6, 12);
    expect(s.going).toBeCloseTo(1.25 / 6, 12);
    expectPts(s.footprint, rect(4.3, 3.17, 5.55, 4.17));
    const first = bbox(s.treads[0].polygon);
    expect(first.min[0]).toBeCloseTo(4.3, 12);
    expect(first.max[0]).toBeCloseTo(4.3 + 1.25 / 6, 12);
    expect(s.treads[0].z).toBeCloseTo(-1 + 1 / 6, 12);
    expect(s.treads[5].z).toBeCloseTo(0, 12);
    expect(bbox(s.treads[5].polygon).max[0]).toBeCloseTo(5.55, 12);
    expect(s.treads.every((t) => isCCW(t.polygon) && Math.abs(area(t.polygon) - (1.25 / 6) * 1.0) < 1e-9)).toBe(true);
    expectPts([s.arrow.a, s.arrow.b], [
      [4.3 + 1.25 / 12, 3.67],
      [5.55 - 1.25 / 12, 3.67],
    ]);
  });

  it('stair main → loft (dz 1.47, up W): 9 treads from the east end', () => {
    const v = mkVariant({ structure: [stair('s', [3.85, 2.24], [6.1, 3.04], 'main', 'loft', 'W')] });
    const s = asStair(deriveStructure(v, [])[0]);
    expect(s.treads).toHaveLength(9);
    expect(s.riser).toBeCloseTo(1.47 / 9, 12);
    expect(s.going).toBeCloseTo(0.25, 12);
    const first = bbox(s.treads[0].polygon);
    expect(first.min[0]).toBeCloseTo(5.85, 12);
    expect(first.max[0]).toBeCloseTo(6.1, 12);
    expect(s.treads[8].z).toBeCloseTo(1.47, 12);
    expectPts([s.arrow.a, s.arrow.b], [
      [5.975, 2.64],
      [3.975, 2.64],
    ]);
  });

  it('stairs up N and S start at the matching end', () => {
    const v = mkVariant({
      structure: [stair('n', [0, 0], [1, 2], 'main', 'loft', 'N'), stair('s', [0, 0], [1, 2], 'main', 'loft', 'S')],
    });
    const [n, s] = deriveStructure(v, []).map(asStair);
    expect(bbox(n.treads[0].polygon).min[1]).toBeCloseTo(0, 12);
    expect(bbox(s.treads[0].polygon).max[1]).toBeCloseTo(2, 12);
    expect(n.arrow.a[1]).toBeLessThan(n.arrow.b[1]);
    expect(s.arrow.a[1]).toBeGreaterThan(s.arrow.b[1]);
  });

  it('a stair between equal levels still has one tread', () => {
    const s = asStair(deriveStructure(mkVariant({ structure: [stair('s', [0, 0], [1, 1], 'main', 'main', 'E')] }), [])[0]);
    expect(s.treads).toHaveLength(1);
    expect(s.riser).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Forslag D
// ---------------------------------------------------------------------------

describe('Forslag D', () => {
  const project = createForslagD();
  const variant = project.variants[0];
  const terrain = terrainJson as TerrainAsset;

  it('derives the terrace, its railing with three stairs and the hot tub on the deck', () => {
    const out = deriveOutdoor(variant, project.site, terrain);
    expect(out.decks).toHaveLength(1);
    expect(out.decks[0].skirtBottomZ).toHaveLength(10); // one per deck vertex (the deck starts at the glass bump's east wall)
    const [r] = out.railings;
    expect(r.baseZ).toBe(-0.02);
    expect(r.steps.map((s) => s.id)).toEqual(['rail-terrasse/steps/0', 'rail-terrasse/steps/1', 'rail-terrasse/steps/2']);
    expectPts(
      r.steps.map((s) => s.outward),
      [
        [0, -1],
        [1, 0],
        [1, 0],
      ],
    );
    for (const s of r.steps) {
      expect(s.risers).toBe(Math.ceil((s.topZ - s.bottomZ) / 0.18 - 1e-9));
      expect(s.width).toBeCloseTo(1.4, 9);
    }
    for (let i = 1; i < r.posts.length; i++) {
      const d = Math.hypot(r.posts[i][0] - r.posts[i - 1][0], r.posts[i][1] - r.posts[i - 1][1]);
      expect(d).toBeLessThanOrEqual(5); // never more than a gap or a 1.5 m span apart along the path
    }
    expect(out.hotTubs[0]).toMatchObject({ baseZ: -0.02 });
  });

  it('derives the chimney exit through the main roof and both stairs', () => {
    const roofs = buildRoofs(variant);
    const structure = deriveStructure(variant, roofs);
    const chimney = structure.find((s) => s.id === 'chimney-1');
    expect(chimney?.kind === 'chimney' && chimney.roofExitZ).toBeCloseTo(3.87 - 0.345 * Math.tan((28 * Math.PI) / 180) + 0.31, 2);
    expect(asStair(structure.find((s) => s.id === 'stair-level')).treads).toHaveLength(6);
    expect(asStair(structure.find((s) => s.id === 'stair-loft')).treads).toHaveLength(9);
  });
});
