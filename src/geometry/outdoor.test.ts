import { describe, expect, it } from 'vitest';
import type { Block, Deck, DeckSteps, Level, Site, StructureElement, TerrainAsset, Variant, Vec2, Vec3 } from '../model/types';
import type { DerivedBlock, DerivedStructure } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import terrainJson from '../model/seed/terrain-merkesvatnet.json';
import { area, bbox, isCCW, multiPolygonArea } from './polygon';
import { buildRoofs } from './roof';
import { deriveOutdoor, deriveOutdoorWithWarnings, deriveStructure } from './outdoor';
import type { TerrainZFn } from './outdoor';
import { deriveBlocks } from './walls';

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
    outdoor: { decks: [], hotTubs: [] },
    structure: [],
    settings: { defaultExteriorWall: { thickness: 0.27, outerOffset: 0.11 }, defaultInteriorThickness: 0.12, areaLimit: null },
    ...extra,
  };
}

/** A deck with vertex ids `d-v<i>` (edge i = vertex i → i + 1); edge 0 of the default deck is the south edge y = 0. */
function deck(polygon: Vec2[] = rect(0, 0, 6, 3), extra: Partial<Deck> = {}): Deck {
  return {
    id: 'd',
    polygon: polygon.map((p, i) => ({ id: `d-v${i}`, p })),
    topHeight: 0,
    isNew: true,
    noRailingEdges: [],
    steps: [],
    ...extra,
  };
}

const steps = (edgeId: string, offset: number, width = 1, id = 's'): DeckSteps => ({ id, edgeId, offset, width });

/** Only what deriveOutdoor reads from a derived block: its outer outline (and axis). */
const building = (outer: Vec2[]): DerivedBlock => ({ outer, axis: outer }) as unknown as DerivedBlock;

const flatTerrain =
  (z: number): TerrainZFn =>
  () =>
    z;

function outdoorOf(v: Variant, terrainZ: TerrainZFn = flatTerrain(-0.9), blocks: DerivedBlock[] = []) {
  return deriveOutdoorWithWarnings(v, SITE, null, { terrainZ, blocks });
}

const withDecks = (...decks: Deck[]) => mkVariant({ outdoor: { decks, hotTubs: [] } });

function expectPts(actual: Vec2[] | Vec3[], expected: Vec2[], digits = 9): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(expected[i][0], digits);
    expect(p[1]).toBeCloseTo(expected[i][1], digits);
  });
}

const panelEnds = (panels: { a: Vec3; b: Vec3 }[]): [Vec2, Vec2][] =>
  panels.map((p) => [
    [+p.a[0].toFixed(9), +p.a[1].toFixed(9)],
    [+p.b[0].toFixed(9), +p.b[1].toFixed(9)],
  ]);

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

describe('deriveOutdoor: decks', () => {
  it('derives thickness, skirt bottoms from the terrain, the board direction and keeps the stored outline', () => {
    const v = withDecks(deck(), { ...deck(rect(10, 0, 12, 5)), id: 'tall', topHeight: -0.02, isNew: false });
    const { decks } = outdoorOf(v, (x, y) => -0.5 - 0.1 * x - y * 0.01).outdoor;
    expect(decks[0]).toMatchObject({ id: 'd', topZ: 0, thickness: 0.15, boardDirection: 'x', isNew: true });
    expect(decks[0].skirtBottomZ.map((ring) => ring.map((z) => +z.toFixed(9)))).toEqual([[-0.55, -1.15, -1.18, -0.58]]);
    expect(decks[1]).toMatchObject({ topZ: -0.02, boardDirection: 'y', isNew: false });
    expectPts(decks[0].polygon, rect(0, 0, 6, 3));
    expect(decks[0].vertexIds).toEqual(['d-v0', 'd-v1', 'd-v2', 'd-v3']);
    // Nothing to trim: the outline is the one piece, and every edge is free.
    expect(decks[0].pieces).toHaveLength(1);
    expectPts(decks[0].pieces[0][0], rect(0, 0, 6, 3));
    expect(decks[0].freeRuns.map((r) => [r.edgeId, r.s0, r.s1])).toEqual([
      ['d-v0', 0, 6],
      ['d-v1', 0, 3],
      ['d-v2', 0, 6],
      ['d-v3', 0, 3],
    ]);
  });

  it('uses terrainZAt by default (no terrain asset → fallback −0.5)', () => {
    const { decks } = deriveOutdoor(withDecks(deck()), SITE, null);
    expect(decks[0].skirtBottomZ).toEqual([[-0.55, -0.55, -0.55, -0.55]]);
  });

  it('makes a clockwise outline CCW in its pieces and keeps the outward side of its edges', () => {
    const cw = [...rect(0, 0, 6, 3)].reverse();
    const { decks, steps: s } = outdoorOf(withDecks(deck(cw, { steps: [steps('d-v0', 1.5)] }))).outdoor;
    expect(isCCW(decks[0].pieces[0][0])).toBe(true);
    // Edge 0 of the reversed outline runs (0, 3) → (6, 3): its outside is +y.
    expectPts([s[0].at, s[0].outward], [
      [1.5, 3],
      [0, 1],
    ]);
  });

  it('is trimmed by the outer outlines of the buildings; edges along or inside a building are not free', () => {
    // A building on the deck's north side (cladding face at y = 2.89 … 5) and one standing on it (a hole).
    const north = building(rect(-1, 2.89, 7, 5));
    const unit = building(rect(1, 1, 2, 2));
    const { decks } = outdoorOf(withDecks(deck()), flatTerrain(-0.9), [north, unit]).outdoor;
    const d = decks[0];
    expect(d.pieces).toHaveLength(1);
    expect(d.pieces[0]).toHaveLength(2); // outer ring + the unit as a hole
    expect(isCCW(d.pieces[0][0])).toBe(true);
    expect(isCCW(d.pieces[0][1])).toBe(false);
    expect(multiPolygonArea(d.pieces)).toBeCloseTo(6 * 2.89 - 1, 9);
    expect(d.skirtBottomZ[0]).toHaveLength(d.pieces[0][0].length);
    // Free: the south edge, and the east / west edges up to the cladding; the north edge runs inside the building.
    expect(d.freeRuns.map((r) => [r.edgeId, +r.s0.toFixed(9), +r.s1.toFixed(9)])).toEqual([
      ['d-v0', 0, 6],
      ['d-v1', 0, 2.89],
      ['d-v3', 0.11, 3],
    ]);
    expectPts([d.freeRuns[2].a, d.freeRuns[2].b], [
      [0, 2.89],
      [0, 0],
    ]);
  });

  it('treats an edge running along a cladding face (within 1 mm) as not free, and corner touches as free', () => {
    const along = building(rect(-2, 3.0005, 8, 6)); // 0.5 mm above the north edge
    const corner = building(rect(6, -2, 8, 0)); // touches the deck at its south-east corner only
    const { decks } = outdoorOf(withDecks(deck()), flatTerrain(-0.9), [along, corner]).outdoor;
    expect(decks[0].freeRuns.map((r) => [r.edgeId, +r.s0.toFixed(6), +r.s1.toFixed(6)])).toEqual([
      ['d-v0', 0, 6],
      ['d-v1', 0, 3],
      ['d-v3', 0, 3],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Railings and steps
// ---------------------------------------------------------------------------

describe('deriveOutdoor: railings and steps', () => {
  it('a railing round a free deck closes; a step gap splits it and the steps go down outward', () => {
    const v = withDecks(deck(rect(0, 0, 6, 3), { railing: { style: 'glass', height: 1.05 }, steps: [steps('d-v0', 2.5)] }));
    const { outdoor, warnings } = outdoorOf(v);
    expect(warnings).toEqual([]);
    const [r] = outdoor.railings;
    expect(r).toMatchObject({ id: 'd/railing', deckId: 'd', baseZ: 0, height: 1.05, style: 'glass', isNew: true });
    // One chain from the end of the gap round the deck to its start.
    expect(panelEnds(r.panels)).toEqual([
      [
        [3, 0],
        [6, 0],
      ],
      [
        [6, 0],
        [6, 3],
      ],
      [
        [6, 3],
        [0, 3],
      ],
      [
        [0, 3],
        [0, 0],
      ],
      [
        [0, 0],
        [2, 0],
      ],
    ]);
    expectPts(
      r.posts.map((p): Vec2 => [p[0], p[1]]),
      [
        [3, 0],
        [4.5, 0],
        [6, 0],
        [6, 1.5],
        [6, 3],
        [4.5, 3],
        [3, 3],
        [1.5, 3],
        [0, 3],
        [0, 1.5],
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    );
    expect(r.posts.every((p) => p[2] === 0)).toBe(true);

    expect(outdoor.steps).toHaveLength(1);
    const s = outdoor.steps[0];
    expect(s).toMatchObject({ id: 's', deckId: 'd', edgeId: 'd-v0', width: 1, topZ: 0, bottomZ: -0.9, risers: 5, going: 0.3, blocked: false });
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

  it('leaves out noRailingEdges and edges along buildings; runs that do not meet stay separate chains', () => {
    const v = withDecks(deck(rect(0, 0, 6, 3), { railing: { style: 'boards', height: 1 }, noRailingEdges: ['d-v1'] }));
    const north = building(rect(-1, 2.89, 7, 5));
    const [r] = outdoorOf(v, flatTerrain(-0.9), [north]).outdoor.railings;
    expect(r.style).toBe('boards');
    // West run (0, 2.89) → (0, 0) chains into the south edge; the east edge is switched off.
    expect(panelEnds(r.panels)).toEqual([
      [
        [0, 2.89],
        [0, 0],
      ],
      [
        [0, 0],
        [6, 0],
      ],
    ]);
    expect(r.posts[0][1]).toBeCloseTo(2.89, 9);
    expect(r.posts[r.posts.length - 1][0]).toBeCloseTo(6, 9);
  });

  it('a deck without `railing` gets no railing but still its steps', () => {
    const { outdoor } = outdoorOf(withDecks(deck(rect(0, 0, 6, 3), { steps: [steps('d-v1', 1.5)] })));
    expect(outdoor.railings).toEqual([]);
    expect(outdoor.steps).toHaveLength(1);
    expectPts([outdoor.steps[0].at, outdoor.steps[0].outward], [
      [6, 1.5],
      [1, 0],
    ]);
  });

  it('steps not on a free run are blocked: warning, no railing gap; steps on an unknown edge only warn', () => {
    const v = withDecks(
      deck(rect(0, 0, 6, 3), {
        railing: { style: 'glass', height: 1.05 },
        steps: [steps('d-v2', 3, 1, 'under-building'), steps('nope', 1, 1, 'lost'), steps('d-v0', 7, 1, 'past-the-end')],
      }),
    );
    const north = building(rect(-1, 2.89, 7, 5));
    const { outdoor, warnings } = outdoorOf(v, flatTerrain(-0.9), [north]);
    expect(warnings).toEqual([
      { kind: 'deck-steps-blocked', stepsId: 'under-building', deckId: 'd' },
      { kind: 'deck-steps-blocked', stepsId: 'lost', deckId: 'd' },
      { kind: 'deck-steps-blocked', stepsId: 'past-the-end', deckId: 'd' },
    ]);
    expect(outdoor.steps.map((s) => [s.id, s.blocked])).toEqual([
      ['under-building', true],
      ['past-the-end', true],
    ]);
    // The south edge has no gap.
    expect(panelEnds(outdoor.railings[0].panels)).toContainEqual([
      [0, 0],
      [6, 0],
    ]);
  });

  it('steps vanish when there is no drop and round the riser count up with a tolerance', () => {
    const risers = (z: number) => outdoorOf(withDecks(deck(rect(0, 0, 6, 3), { steps: [steps('d-v0', 2.5)] })), flatTerrain(z)).outdoor.steps[0];
    expect(risers(0.1)).toMatchObject({ risers: 0, riserHeight: 0, treads: [] });
    expect(risers(-1.0).risers).toBe(6);
    expect(risers(-0.18).risers).toBe(1);
    expect(risers(-0.18).treads).toEqual([]);
    expect(risers(-0.19).risers).toBe(2);
  });

  it('a step gap covering a whole edge leaves no panels there, and posts merge at shared corners', () => {
    const v = withDecks(deck(rect(0, 0, 6, 3), { railing: { style: 'glass', height: 1.05 }, steps: [steps('d-v1', 1.5, 3)] }));
    const [r] = outdoorOf(v).outdoor.railings;
    expect(panelEnds(r.panels)).not.toContainEqual([
      [6, 0],
      [6, 3],
    ]);
    const keys = r.posts.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// Hot tubs
// ---------------------------------------------------------------------------

describe('deriveOutdoor: hot tubs', () => {
  it('stands on the deck piece containing its centre, else on the terrain (also in a hole of the deck)', () => {
    const v = mkVariant({
      outdoor: {
        decks: [deck(rect(0, 0, 6, 3), { topHeight: -0.02 })],
        hotTubs: [
          { id: 'on', centre: [3, 1.5], diameter: 2, isNew: true },
          { id: 'off', centre: [10, 1.5], diameter: 1.8, isNew: false },
          { id: 'in-hole', centre: [5, 1], diameter: 1, isNew: true },
        ],
      },
    });
    const [on, off, inHole] = outdoorOf(v, flatTerrain(-0.6), [building(rect(4.5, 0.5, 5.5, 1.5))]).outdoor.hotTubs;
    expect(on).toMatchObject({ id: 'on', diameter: 2, baseZ: -0.02, isNew: true });
    expect(on.rimZ).toBeCloseTo(1.03, 12);
    expect(off).toMatchObject({ baseZ: -0.6, isNew: false });
    expect(off.rimZ).toBeCloseTo(0.45, 12);
    expect(inHole.baseZ).toBe(-0.6);
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
  const blocks = deriveBlocks(variant, project.site, terrain);

  it('trims the terrace by the buildings: free runs from (9; −2,11) round to the bod wing cladding (9,11; 12,1)', () => {
    const { outdoor: out, warnings } = deriveOutdoorWithWarnings(variant, project.site, terrain, { blocks });
    expect(warnings).toEqual([]);
    expect(out.decks).toHaveLength(1);
    const d = out.decks[0];
    expect(d.pieces).toHaveLength(1);
    expect(d.skirtBottomZ[0]).toHaveLength(d.pieces[0][0].length);
    // The stored outline overlaps the cladding of the glass bump, main house, wing and bod wing.
    expect(multiPolygonArea(d.pieces)).toBeLessThan(area(d.polygon) - 1);
    expect(d.freeRuns.map((r) => [r.edgeId, +r.s0.toFixed(6), +r.s1.toFixed(6)])).toEqual([
      ['deck-terrasse-v0', 0, 14.2],
      ['deck-terrasse-v1', 0, 16.7],
      ['deck-terrasse-v2', 0, 14.09],
      ['deck-terrasse-v9', 2.11, 4.6],
    ]);
  });

  it('keeps the glass railing with three stairs (same gaps as phase 1) and the hot tub on the deck', () => {
    const out = deriveOutdoor(variant, project.site, terrain, { blocks });
    const [r] = out.railings;
    expect(out.railings).toHaveLength(1);
    expect(r).toMatchObject({ id: 'deck-terrasse/railing', deckId: 'deck-terrasse', baseZ: -0.02, style: 'glass', height: 1.05, isNew: true });
    expect(panelEnds(r.panels)).toEqual([
      [
        [9, -2.11],
        [9, -4.6],
      ],
      [
        [9, -4.6],
        [11.6, -4.6],
      ],
      [
        [13, -4.6],
        [23.2, -4.6],
      ],
      [
        [23.2, -4.6],
        [23.2, 2.1],
      ],
      [
        [23.2, 3.5],
        [23.2, 8.4],
      ],
      [
        [23.2, 9.8],
        [23.2, 12.1],
      ],
      [
        [23.2, 12.1],
        [9.11, 12.1],
      ],
    ]);
    expect(out.steps.map((s) => s.id)).toEqual(['rail-terrasse/steps/0', 'rail-terrasse/steps/1', 'rail-terrasse/steps/2']);
    expectPts(
      out.steps.map((s) => s.at),
      [
        [12.3, -4.6],
        [23.2, 2.8],
        [23.2, 9.1],
      ],
    );
    expectPts(
      out.steps.map((s) => s.outward),
      [
        [0, -1],
        [1, 0],
        [1, 0],
      ],
    );
    for (const s of out.steps) {
      expect(s.blocked).toBe(false);
      expect(s.risers).toBe(Math.ceil((s.topZ - s.bottomZ) / 0.18 - 1e-9));
      expect(s.width).toBeCloseTo(1.4, 9);
    }
    for (let i = 1; i < r.posts.length; i++) {
      const d = Math.hypot(r.posts[i][0] - r.posts[i - 1][0], r.posts[i][1] - r.posts[i - 1][1]);
      expect(d).toBeLessThanOrEqual(1.5 + 1e-9); // posts every ≤ 1.5 m; a stair gap (1.4 m) is shorter than that
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
