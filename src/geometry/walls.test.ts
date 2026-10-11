import { describe, expect, it } from 'vitest';
import type { Block, Level, Opening, OpeningHost, Site, TerrainAsset, Variant, Vec2, Wall } from '../model/types';
import type { DerivedRoof, DerivedWall, ModelWarning } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import terrainJson from '../model/seed/terrain-merkesvatnet.json';
import { area, unionArea, unionPolygons } from './polygon';
import { buildRoofs } from './roof';
import {
  blockGroundZ,
  capProfile,
  deriveBlockWarnings,
  deriveBlocks,
  deriveWalls,
  envelopeProfile,
  openingHints,
  patchMinusOpenings,
  profileAt,
  resolveJunctions,
  roofEvents,
} from './walls';
import type { UndersideFn } from './walls';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ISO = '2026-10-11T12:00:00.000Z';

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

function mkBlock(id: string, poly: Vec2[], extra: Partial<Block> = {}): Block {
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
    roof: {
      type: 'gable',
      ridgeAxis: 'x',
      drive: 'pitch',
      pitchDeg: 28,
      ridgeHeight: 3.87,
      thickness: 0.31,
      overhangEave: 0.51,
      overhangGable: 0.35,
      material: 'turf',
    },
    junctions: [],
    ...extra,
  };
}

function mkVariant(extra: Partial<Variant>): Variant {
  return {
    id: 'v',
    name: 'Test',
    createdAt: ISO,
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

function mkWall(id: string, a: Vec2, b: Vec2, extra: Partial<Wall> = {}): Wall {
  return { id, a, b, thickness: 0.12, levelId: 'main', status: 'existing', kind: 'interior', heightMode: 'auto', ...extra };
}

const edge = (blockId: string, i: number): OpeningHost => ({ kind: 'blockEdge', blockId, edgeId: `${blockId}-v${i}` });
const onWall = (wallId: string): OpeningHost => ({ kind: 'wall', wallId });

function mkOpening(id: string, host: OpeningHost, offset: number, extra: Partial<Opening> = {}): Opening {
  return {
    id,
    type: 'window',
    host,
    offset,
    width: 1,
    height: 1.2,
    sill: 0.8,
    levelId: 'main',
    style: { frameColour: 'white', mullions: [2, 2] },
    status: 'existing',
    ...extra,
  };
}

const flat =
  (z: number): UndersideFn =>
  () =>
    z;

function derive(v: Variant, env: UndersideFn = flat(3), roofs: DerivedRoof[] = []) {
  const blocks = deriveBlocks(v, SITE, null, { terrainZ: () => -0.5 });
  return { blocks, ...deriveWalls(v, blocks, roofs, { undersideAt: env }) };
}

function expectPts(actual: Vec2[], expected: Vec2[], digits = 9): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(expected[i][0], digits);
    expect(p[1]).toBeCloseTo(expected[i][1], digits);
  });
}

function byId(walls: DerivedWall[], id: string): DerivedWall {
  const w = walls.find((x) => x.id === id);
  if (!w) throw new Error(`no wall ${id}; have ${walls.map((x) => x.id).join(', ')}`);
  return w;
}

const exterior = (walls: DerivedWall[]) => walls.filter((w) => w.isExterior);
const kinds = (ws: ModelWarning[]) => ws.map((w) => w.kind);

// ---------------------------------------------------------------------------
// deriveBlocks
// ---------------------------------------------------------------------------

describe('deriveBlocks', () => {
  it('derives outlines, edges, implicit part and heights of a single square block', () => {
    const v = mkVariant({ blocks: [mkBlock('b', rect(0, 0, 4, 4))] });
    const [db] = deriveBlocks(v, SITE, null, { terrainZ: (x) => -0.1 * x });
    expectPts(db.axis, rect(0, 0, 4, 4));
    expect(area(db.outer)).toBeCloseTo(4.22 * 4.22, 9);
    expect(area(db.inner)).toBeCloseTo(3.68 * 3.68, 9);
    expect(db.edges.map((e) => e.edgeId)).toEqual(['b-v0', 'b-v1', 'b-v2', 'b-v3']);
    expectPts(
      db.edges.map((e) => e.outward),
      [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ],
    );
    expect(db.edges[0].length).toBe(4);
    expect(db.axisDims).toEqual({ w: 4, h: 4 });
    expect(db.parts).toHaveLength(1);
    expect(db.parts[0].isImplicit).toBe(true);
    expect(db.parts[0].part).toMatchObject({ id: 'b-implicit', name: 'b', isNew: false });
    expect(area(db.parts[0].outer)).toBeCloseTo(4.22 * 4.22, 9);
    expect(db.eaveZ).toBeCloseTo(2.22, 12);
    expect(db.ridgeZ).toBeCloseTo(2.22 + 2 * Math.tan((28 * Math.PI) / 180), 9);
    expect(db.pitchDeg).toBeCloseTo(28, 9);
    expect(db.lowestFloorZ).toBe(0);
    // Sloping terrain z = -0.1·x: lowest under the outer outline at x = 4.11.
    expect(db.groundZ).toBeCloseTo(-0.411, 9);
  });

  it('clips parts to the block, adds the implicit remainder and offsets only along the block boundary', () => {
    const b = mkBlock('b', rect(0, 0, 4, 4), {
      parts: [{ id: 'p-new', name: 'Ny', polygon: rect(-1, -1, 2, 5), isNew: true }],
    });
    const [db] = deriveBlocks(mkVariant({ blocks: [b] }), SITE, null, { terrainZ: () => 0 });
    expect(db.parts.map((p) => [p.part.id, p.isImplicit, p.part.isNew])).toEqual([
      ['p-new', false, true],
      ['b-implicit', true, false],
    ]);
    expect(area(db.parts[0].part.polygon)).toBeCloseTo(8, 9);
    expect(db.parts[1].part.name).toBe('b (resten)');
    expect(area(db.parts[1].part.polygon)).toBeCloseTo(8, 9);
    // Outer: west, south and north grow 0.11, the internal edge x = 2 stays.
    expect(area(db.parts[0].outer)).toBeCloseTo(2.11 * 4.22, 9);
    expect(area(db.parts[0].inner)).toBeCloseTo(1.84 * 3.68, 9);
    expect(area(db.parts[1].outer)).toBeCloseTo(2.11 * 4.22, 9);
  });

  it('clips zones and reports the lowest floor', () => {
    const b = mkBlock('b', rect(0, 0, 10, 6), {
      floorZones: [
        { id: 'z-low', levelId: 'lower', kind: 'replace', polygon: rect(-2, -2, 4, 8) },
        { id: 'z-loft', levelId: 'loft', kind: 'add', polygon: rect(0, 0, 4, 6) },
      ],
    });
    const [db] = deriveBlocks(mkVariant({ blocks: [b] }), SITE, null, { terrainZ: () => 0 });
    expect(db.zones.map((z) => [z.zoneId, z.levelId, z.kind])).toEqual([
      ['z-low', 'lower', 'replace'],
      ['z-loft', 'loft', 'add'],
    ]);
    expect(area(db.zones[0].polygon)).toBeCloseTo(24, 9);
    expect(db.lowestFloorZ).toBe(-1);
  });

  it('uses 0 offsets along an open junction and the owner wall build-up along a wall junction', () => {
    const A = mkBlock('A', rect(0, 0, 10, 6), {
      junctions: [
        { otherBlockId: 'G', policy: 'open' },
        { otherBlockId: 'B', policy: 'wall' },
      ],
    });
    const G = mkBlock('G', rect(4, -2, 8, 0));
    const B = mkBlock('B', rect(4, 6, 8, 9));
    const [dA, dG, dB] = deriveBlocks(mkVariant({ blocks: [A, G, B] }), SITE, null, { terrainZ: () => 0 });
    expectPts(dA.outer, [
      [-0.11, -0.11],
      [4, -0.11],
      [4, 0],
      [8, 0],
      [8, -0.11],
      [10.11, -0.11],
      [10.11, 6.11],
      [8, 6.11],
      [8, 6],
      [4, 6],
      [4, 6.11],
      [-0.11, 6.11],
    ]);
    expectPts(dA.inner, [
      [0.16, 0.16],
      [4, 0.16],
      [4, 0],
      [8, 0],
      [8, 0.16],
      [9.84, 0.16],
      [9.84, 5.84],
      [0.16, 5.84],
    ]);
    expectPts(dG.outer, [
      [3.89, -2.11],
      [8.11, -2.11],
      [8.11, 0],
      [3.89, 0],
    ]);
    expectPts(dG.inner, [
      [4.16, -1.84],
      [7.84, -1.84],
      [7.84, 0],
      [4.16, 0],
    ]);
    // B's south edge belongs to A's wall: inner face 0.11 (A's outer offset) inside B.
    expectPts(dB.inner, [
      [4.16, 6.11],
      [7.84, 6.11],
      [7.84, 8.84],
      [4.16, 8.84],
    ]);
    expectPts(dB.outer, [
      [3.89, 6],
      [8.11, 6],
      [8.11, 9.11],
      [3.89, 9.11],
    ]);
  });

  it('survives degenerate blocks', () => {
    const b = mkBlock('b', [
      [0, 0],
      [1, 0],
    ]);
    const [db] = deriveBlocks(mkVariant({ blocks: [b] }), SITE, null, { terrainZ: () => -0.3 });
    expect(db.outer).toEqual([]);
    expect(db.parts).toEqual([]);
    expect(db.groundZ).toBe(-0.3);
    const { walls, warnings } = deriveWalls(mkVariant({ blocks: [b] }), [db], [], { undersideAt: flat(3) });
    expect(warnings).toEqual([]);
    expect(walls.every((w) => w.footprint.length === 4 || w.footprint.length === 0)).toBe(true);
  });

  it('uses terrainZAt by default (fallback height without a terrain asset)', () => {
    const [db] = deriveBlocks(mkVariant({ blocks: [mkBlock('b', rect(0, 0, 2, 2))] }), SITE, null);
    expect(db.groundZ).toBe(-0.5);
  });
});

describe('resolveJunctions', () => {
  const A = (policy?: 'open' | 'wall') => mkBlock('A', rect(0, 0, 10, 6), { junctions: policy ? [{ otherBlockId: 'B', policy }] : [] });
  const B = (policy?: 'open' | 'wall') => mkBlock('B', rect(4, 6, 8, 9), { junctions: policy ? [{ otherBlockId: 'A', policy }] : [] });
  const roles = (a?: 'open' | 'wall', b?: 'open' | 'wall') => {
    const j = resolveJunctions(mkVariant({ blocks: [A(a), B(b)] }));
    return [j.get('A')?.[2][0]?.role, j.get('B')?.[0][0]?.role];
  };

  it('finds the shared segment on both blocks', () => {
    const j = resolveJunctions(mkVariant({ blocks: [A('wall'), B()] }));
    const onA = j.get('A')?.[2] ?? [];
    expect(onA).toHaveLength(1);
    expect(onA[0].s0).toBeCloseTo(2, 12);
    expect(onA[0].s1).toBeCloseTo(6, 12);
    expect(onA[0]).toMatchObject({ otherBlockId: 'B', role: 'own', otherOuterOffset: 0.11 });
    const onB = j.get('B')?.[0] ?? [];
    expect(onB[0].s0).toBeCloseTo(0, 12);
    expect(onB[0].s1).toBeCloseTo(4, 12);
    expect(onB[0].role).toBe('other');
  });

  it('applies the ownership rules', () => {
    expect(roles('wall', undefined)).toEqual(['own', 'other']);
    expect(roles(undefined, 'wall')).toEqual(['other', 'own']);
    expect(roles('wall', 'wall')).toEqual(['own', 'other']); // both: first listed
    expect(roles(undefined, undefined)).toEqual(['own', 'other']); // neither: first listed
    expect(roles('wall', 'open')).toEqual(['open', 'open']); // open wins
    expect(roles('open', undefined)).toEqual(['open', 'open']);
  });

  it('ignores same-direction overlaps, tiny overlaps and distant edges', () => {
    const overlapping = mkBlock('B', rect(4, 0, 8, 3)); // shares the south line in the SAME direction
    const touching = mkBlock('C', rect(10, 6, 12, 8)); // corner contact only
    const nearly = mkBlock('D', rect(-3, 6.005, 0.005, 8)); // 5 mm overlap along y = 6
    const j = resolveJunctions(mkVariant({ blocks: [A(), overlapping, touching, nearly] }));
    expect(j.get('A')?.flat()).toEqual([]);
  });
});

describe('blockGroundZ', () => {
  it('is the minimum terrain under the outer outline', () => {
    const [db] = deriveBlocks(mkVariant({ blocks: [mkBlock('b', rect(0, 0, 4, 4))] }), SITE, null, { terrainZ: () => 0 });
    expect(blockGroundZ(db, (x) => -x)).toBeCloseTo(-4.11, 9);
    expect(blockGroundZ(db, () => -0.3)).toBe(-0.3);
  });
});

describe('deriveBlockWarnings', () => {
  it('warns about overlapping blocks and parts, not about adjacent ones', () => {
    const A = mkBlock('A', rect(0, 0, 10, 6), {
      parts: [
        { id: 'p1', name: 'p1', polygon: rect(0, 0, 6, 6), isNew: false },
        { id: 'p2', name: 'p2', polygon: rect(5, 0, 10, 6), isNew: true },
      ],
    });
    const B = mkBlock('B', rect(4, 6, 8, 9));
    const C = mkBlock('C', rect(9, 5, 12, 8));
    const blocks = deriveBlocks(mkVariant({ blocks: [A, B, C] }), SITE, null, { terrainZ: () => 0 });
    expect(deriveBlockWarnings(blocks)).toEqual([
      { kind: 'block-overlap', blockIds: ['A', 'C'] },
      { kind: 'parts-overlap', blockId: 'A' },
    ]);
  });

  it('warns about a self-intersecting block (two vertices swapped) and derives it without throwing', () => {
    const bow = mkBlock('X', [
      [0, 0],
      [6, 0],
      [0, 4],
      [6, 4],
    ]);
    const ok = mkBlock('ok', rect(10, 0, 14, 4));
    const v = mkVariant({ blocks: [bow, ok] });
    const blocks = deriveBlocks(v, SITE, null, { terrainZ: () => 0 });
    expect(deriveBlockWarnings(blocks)).toEqual([{ kind: 'block-self-intersecting', blockId: 'X' }]);
    expect(() => deriveWalls(v, blocks, buildRoofs(v), {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Exterior pieces
// ---------------------------------------------------------------------------

describe('deriveWalls: exterior pieces', () => {
  it('a single square block gives 4 mitred pieces with exact footprints, faces and ids', () => {
    const { walls, warnings } = derive(mkVariant({ blocks: [mkBlock('b', rect(0, 0, 4, 4))] }));
    expect(warnings).toEqual([]);
    expect(walls.map((w) => w.id)).toEqual([
      'b/b-v0/b-implicit/base',
      'b/b-v1/b-implicit/base',
      'b/b-v2/b-implicit/base',
      'b/b-v3/b-implicit/base',
    ]);
    const s = walls[0];
    expect(s.source).toEqual({ kind: 'blockEdge', blockId: 'b', edgeId: 'b-v0', partId: 'b-implicit', zoneId: null });
    expectPts([s.a, s.b], [
      [0, 0],
      [4, 0],
    ]);
    expectPts(s.footprint, [
      [-0.11, -0.11],
      [4.11, -0.11],
      [3.84, 0.16],
      [0.16, 0.16],
    ]);
    expectPts(walls[1].footprint, [
      [4.11, -0.11],
      [4.11, 4.11],
      [3.84, 3.84],
      [3.84, 0.16],
    ]);
    for (const w of walls) {
      expect(w.faceLeft).toBeCloseTo(0.16, 12);
      expect(w).toMatchObject({
        thickness: 0.27,
        faceRight: 0.11,
        ends: { start: 'miter', end: 'miter' },
        isExterior: true,
        isDivider: false,
        status: 'existing',
        isNew: false,
        levelId: 'main',
        levelIds: ['main'],
        storeyIds: ['ground'],
        baseZ: 0,
        topZ: 3,
        openings: [],
        patches: [],
      });
      expect(w.topProfile).toEqual([
        { t: 0, z: 3 },
        { t: 1, z: 3 },
      ]);
      expect(area(w.footprint)).toBeCloseTo(((4.22 + 3.68) / 2) * 0.27, 9);
    }
    const ring = unionPolygons(walls.map((w) => w.footprint));
    expect(ring).toHaveLength(1);
    expect(ring[0]).toHaveLength(2); // outer ring + hole
    expect(unionArea(walls.map((w) => w.footprint))).toBeCloseTo(4.22 ** 2 - 3.68 ** 2, 9);
  });

  it('a block with two parts splits the long edges with isNew per piece and butt ends at the split', () => {
    const b = mkBlock('m', rect(0, 0, 16, 6.2), {
      parts: [
        { id: 'p-old', name: 'Eksisterende', polygon: rect(0, 0, 12, 6.2), isNew: false },
        { id: 'p-new', name: 'Forlenget', polygon: rect(12, 0, 16, 6.2), isNew: true },
      ],
    });
    const { walls } = derive(mkVariant({ blocks: [b] }));
    expect(walls.map((w) => [w.id, w.isNew, w.status])).toEqual([
      ['m/m-v0/p-old/base', false, 'existing'],
      ['m/m-v0/p-new/base', true, 'new'],
      ['m/m-v1/p-new/base', true, 'new'],
      ['m/m-v2/p-new/base', true, 'new'],
      ['m/m-v2/p-old/base', false, 'existing'],
      ['m/m-v3/p-old/base', false, 'existing'],
    ]);
    const [sOld, sNew] = walls;
    expect(sOld.ends).toEqual({ start: 'miter', end: 'butt' });
    expect(sNew.ends).toEqual({ start: 'butt', end: 'miter' });
    expectPts(sOld.footprint, [
      [-0.11, -0.11],
      [12, -0.11],
      [12, 0.16],
      [0.16, 0.16],
    ]);
    expectPts(sNew.footprint, [
      [12, -0.11],
      [16.11, -0.11],
      [15.84, 0.16],
      [12, 0.16],
    ]);
    expectPts([walls[3].a, walls[3].b, walls[4].a, walls[4].b], [
      [16, 6.2],
      [12, 6.2],
      [12, 6.2],
      [0, 6.2],
    ]);
    expect(unionArea(walls.map((w) => w.footprint))).toBeCloseTo(16.22 * 6.42 - 15.68 * 5.88, 9);
  });

  it('splits at a lower floor zone: baseZ -1.0 there, still up to the roof', () => {
    const b = mkBlock('m', rect(0, 0, 16, 6.2), {
      floorZones: [
        { id: 'z-low', levelId: 'lower', kind: 'replace', polygon: rect(0, 0, 5.1, 6.2) },
        { id: 'z-loft', levelId: 'loft', kind: 'add', polygon: rect(0, 0, 5.1, 6.2) },
      ],
    });
    const { walls } = derive(mkVariant({ blocks: [b] }), flat(3.0));
    expect(walls.map((w) => [w.id, w.levelId, w.baseZ])).toEqual([
      ['m/m-v0/m-implicit/z-low', 'lower', -1],
      ['m/m-v0/m-implicit/base', 'main', 0],
      ['m/m-v1/m-implicit/base', 'main', 0],
      ['m/m-v2/m-implicit/base', 'main', 0],
      ['m/m-v2/m-implicit/z-low', 'lower', -1],
      ['m/m-v3/m-implicit/z-low', 'lower', -1],
    ]);
    const low = walls[0];
    expect(low.source).toMatchObject({ zoneId: 'z-low' });
    expect(low.b[0]).toBeCloseTo(5.1, 12);
    expect(low.ends).toEqual({ start: 'miter', end: 'butt' });
    // Exterior walls ignore the lower level's ceiling (1.3) and run to the roof.
    expect(low.topProfile).toEqual([
      { t: 0, z: 3 },
      { t: 1, z: 3 },
    ]);
    // Pieces along the zones take part in the zones' levels too (ground + loft through the 'add' zone); the rest
    // of the block's walls only in its base level, so they never dangle in the loft's room graph.
    for (const w of walls) {
      const alongZones = w.levelId === 'lower';
      expect(w.levelIds, w.id).toEqual(alongZones ? ['lower', 'main', 'loft'] : ['main']);
      expect(w.storeyIds, w.id).toEqual(alongZones ? ['ground', 'loft'] : ['ground']);
    }
  });

  it("'open' junction: the shared segment is removed on both blocks and the corners close cleanly", () => {
    const A = mkBlock('A', rect(0, 0, 10, 6), { junctions: [{ otherBlockId: 'B', policy: 'open' }] });
    const B = mkBlock('B', rect(4, -2, 8, 0));
    const { walls } = derive(mkVariant({ blocks: [A, B] }));
    expect(walls.map((w) => w.id)).toEqual([
      'A/A-v0/A-implicit/base',
      'A/A-v0/A-implicit/base/2',
      'A/A-v1/A-implicit/base',
      'A/A-v2/A-implicit/base',
      'A/A-v3/A-implicit/base',
      'B/B-v0/B-implicit/base',
      'B/B-v1/B-implicit/base',
      'B/B-v3/B-implicit/base',
    ]);
    const [s1, s2] = walls;
    expectPts([s1.a, s1.b, s2.a, s2.b], [
      [0, 0],
      [4, 0],
      [8, 0],
      [10, 0],
    ]);
    // Junction corner: mitred against B's west wall like a block corner.
    expect(s1.ends).toEqual({ start: 'miter', end: 'miter' });
    expectPts(s1.footprint, [
      [-0.11, -0.11],
      [3.89, -0.11],
      [4.16, 0.16],
      [0.16, 0.16],
    ]);
    const bw = byId(walls, 'B/B-v3/B-implicit/base');
    expectPts(bw.footprint, [
      [3.89, -0.11],
      [3.89, -2.11],
      [4.16, -1.84],
      [4.16, 0.16],
    ]);
    const u = unionPolygons(walls.map((w) => w.footprint));
    expect(u).toHaveLength(1);
    expect(u[0]).toHaveLength(2);
    const sum = walls.reduce((acc, w) => acc + area(w.footprint), 0);
    expect(unionArea(walls.map((w) => w.footprint))).toBeCloseTo(sum, 9); // no overlaps
    expect(sum).toBeCloseTo(10.22 * 6.22 + 4.22 * 2 - (9.68 * 5.68 + 3.68 * 2), 9);
  });

  it("'wall' junction keeps only the owner's piece; its base is the lower of both floors", () => {
    const A = mkBlock('A', rect(0, 0, 10, 6), { junctions: [{ otherBlockId: 'B', policy: 'wall' }] });
    const B = mkBlock('B', rect(4, 6, 8, 9), { levelId: 'lower' });
    const { walls } = derive(mkVariant({ blocks: [A, B] }));
    const north = walls.filter((w) => w.source.kind === 'blockEdge' && w.source.edgeId === 'A-v2');
    expect(north.map((w) => [w.id, w.baseZ])).toEqual([
      ['A/A-v2/A-implicit/base', 0],
      ['A/A-v2/A-implicit/base/2', -1],
      ['A/A-v2/A-implicit/base/3', 0],
    ]);
    expect(north.map((w) => w.ends)).toEqual([
      { start: 'miter', end: 'butt' },
      { start: 'butt', end: 'butt' },
      { start: 'butt', end: 'miter' },
    ]);
    expect(walls.some((w) => w.source.kind === 'blockEdge' && w.source.edgeId === 'B-v0')).toBe(false);
    // B's east wall starts at the removed edge: cut along the owner's outer face (y = 6.11), no overlap.
    const be = byId(walls, 'B/B-v1/B-implicit/base');
    expect(be.ends.start).toBe('miter');
    expectPts([be.footprint[0], be.footprint[3]], [
      [8.11, 6.11],
      [7.84, 6.11],
    ]);
    const sum = walls.reduce((acc, w) => acc + area(w.footprint), 0);
    expect(unionArea(walls.map((w) => w.footprint))).toBeCloseTo(sum, 9);
    expect(be.levelId).toBe('lower');
    expect(be.baseZ).toBe(-1);
  });

  it('an L-shaped block mitres its reflex corner without gaps or overlaps', () => {
    const L: Vec2[] = [
      [0, 0],
      [6, 0],
      [6, 3],
      [3, 3],
      [3, 6],
      [0, 6],
    ];
    const { walls, blocks } = derive(mkVariant({ blocks: [mkBlock('L', L)] }));
    expect(walls).toHaveLength(6);
    expect(walls.every((w) => w.ends.start === 'miter' && w.ends.end === 'miter')).toBe(true);
    const sum = walls.reduce((acc, w) => acc + area(w.footprint), 0);
    expect(unionArea(walls.map((w) => w.footprint))).toBeCloseTo(sum, 9);
    expect(sum).toBeCloseTo(area(blocks[0].outer) - area(blocks[0].inner), 9);
  });

  it('a clockwise block still puts the cladding outside', () => {
    const cw = rect(0, 0, 4, 4).reverse();
    const { walls, blocks } = derive(mkVariant({ blocks: [mkBlock('c', cw)] }));
    expect(area(blocks[0].outer)).toBeCloseTo(4.22 ** 2, 9);
    expectPts([blocks[0].edges[0].outward], [[0, 1]]); // edge (0,4) → (4,4) faces north
    for (const w of walls) {
      expect(w.faceLeft).toBeCloseTo(0.11, 12);
      expect(w.faceRight).toBeCloseTo(0.16, 12);
    }
    expect(unionArea(walls.map((w) => w.footprint))).toBeCloseTo(4.22 ** 2 - 3.68 ** 2, 9);
  });

  it("the other block owns the wall when only its entry says 'wall'", () => {
    const A = mkBlock('A', rect(0, 0, 10, 6));
    const B = mkBlock('B', rect(4, 6, 8, 9), { junctions: [{ otherBlockId: 'A', policy: 'wall' }] });
    const { walls } = derive(mkVariant({ blocks: [A, B] }));
    expect(walls.filter((w) => w.id.startsWith('A/A-v2/')).map((w) => [w.a[0], w.b[0]])).toEqual([
      [10, 8],
      [4, 0],
    ]);
    expect(walls.some((w) => w.id === 'B/B-v0/B-implicit/base')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

describe('deriveWalls: openings', () => {
  const square = () => mkBlock('b', rect(0, 0, 4, 4));

  it('resolves a window on an exterior edge', () => {
    const v = mkVariant({ blocks: [square()], openings: [mkOpening('win', edge('b', 0), 2)] });
    const { walls, warnings } = derive(v);
    expect(warnings).toEqual([]);
    const [o] = walls[0].openings;
    expect(o).toMatchObject({
      id: 'win',
      type: 'window',
      status: 'existing',
      isNew: false,
      offset: 2,
      width: 1,
      glazed: true,
      leaf: 'glass',
      frameColour: 'white',
      leafColour: 'glass',
      panes: [2, 2],
      frameDepth: 0.1,
    });
    expect(o.sillZ).toBeCloseTo(0.8, 12);
    expect(o.headZ).toBeCloseTo(2.0, 12);
    expect(o.glassPlane).toBeCloseTo(0.025, 12);
    expectPts(o.footprint, [
      [1.5, -0.11],
      [2.5, -0.11],
      [2.5, 0.16],
      [1.5, 0.16],
    ]);
    expectPts([o.outward ?? [9, 9]], [[0, -1]]);
    expect(o.swing).toBeUndefined();
  });

  it('an out-swinging exterior door opens outside (side right), an in-swinging one inside', () => {
    const door = (id: string, side: 'left' | 'right') =>
      mkOpening(id, edge('b', 0), 1, { type: 'door', width: 0.9, height: 2.0, sill: 0, swing: { hinge: 'start', side }, style: { frameColour: 'green' } });
    const { walls, warnings } = derive(mkVariant({ blocks: [square()], openings: [door('out', 'right')] }));
    expect(warnings).toEqual([]);
    const [o] = walls[0].openings;
    expect(o.sillZ).toBe(0);
    expect(o.headZ).toBeCloseTo(2.0, 12);
    expect(o).toMatchObject({ glazed: false, leaf: 'solid', leafColour: 'white', frameColour: 'green', panes: [1, 1] });
    const sw = o.swing;
    if (!sw) throw new Error('no swing');
    expectPts([sw.hinge, sw.closed, sw.open], [
      [0.55, -0.11],
      [1.45, -0.11],
      [0.55, -1.01],
    ]);
    expect(sw.sweep).toBe(-1);

    const inner = derive(mkVariant({ blocks: [square()], openings: [door('in', 'left')] })).walls[0].openings[0].swing;
    if (!inner) throw new Error('no swing');
    expectPts([inner.hinge, inner.closed, inner.open], [
      [0.55, 0.16],
      [1.45, 0.16],
      [0.55, 1.06],
    ]);
    expect(inner.sweep).toBe(1);
  });

  it('a double door (leaves 2): two half-width leaves hinged at both jambs, opening to the same side', () => {
    const door = mkOpening('dd', edge('b', 0), 2, {
      type: 'glassDoor',
      width: 1.6,
      height: 2.05,
      sill: 0,
      leaves: 2,
      swing: { hinge: 'start', side: 'right' },
    });
    const [o] = derive(mkVariant({ blocks: [square()], openings: [door] })).walls[0].openings;
    const a = o.swing;
    const b = o.swing2;
    if (!a || !b) throw new Error('missing leaf');
    expectPts([a.hinge, a.closed, a.open], [
      [1.2, -0.11],
      [2, -0.11],
      [1.2, -0.91],
    ]);
    expectPts([b.hinge, b.closed, b.open], [
      [2.8, -0.11],
      [2, -0.11],
      [2.8, -0.91],
    ]);
    expect([a.sweep, b.sweep]).toEqual([-1, 1]);
    // hinge 'end' only swaps which leaf is `swing`.
    const [e] = derive(mkVariant({ blocks: [square()], openings: [{ ...door, swing: { hinge: 'end', side: 'right' } }] })).walls[0].openings;
    expectPts([e.swing!.hinge, e.swing2!.hinge], [
      [2.8, -0.11],
      [1.2, -0.11],
    ]);
    // A single leaf has no swing2.
    const [single] = derive(mkVariant({ blocks: [square()], openings: [{ ...door, leaves: 1 }] })).walls[0].openings;
    expect(single.swing2).toBeUndefined();
    expect(single.swing!.open).toEqual([1.2, expect.closeTo(-1.71, 9)]);
  });

  it("a door on an interior wall with side 'left' and hinge 'end'", () => {
    const v = mkVariant({
      blocks: [square()],
      walls: [mkWall('w1', [1, 1], [1, 3])],
      openings: [mkOpening('d', onWall('w1'), 1.0, { type: 'door', width: 0.8, height: 2.0, sill: 0, swing: { hinge: 'end', side: 'left' } })],
    });
    const { walls, warnings } = derive(v);
    expect(warnings).toEqual([]);
    const [o] = byId(walls, 'w1').openings;
    expect(o.offset).toBe(1);
    expect(o.outward).toBeUndefined();
    expect(o.glassPlane).toBeCloseTo(0, 12);
    expectPts(o.footprint, [
      [1.06, 1.6],
      [1.06, 2.4],
      [0.94, 2.4],
      [0.94, 1.6],
    ]);
    const sw = o.swing;
    if (!sw) throw new Error('no swing');
    expectPts([sw.hinge, sw.closed, sw.open], [
      [0.94, 2.4],
      [0.94, 1.6],
      [0.14, 2.4],
    ]);
    expect(sw.sweep).toBe(-1);
  });

  it('allows an opening to touch the host end (1 mm) and warns beyond that', () => {
    const at = (offset: number) => kinds(derive(mkVariant({ blocks: [square()], openings: [mkOpening('w', edge('b', 0), offset)] })).warnings);
    expect(at(3.5)).toEqual([]);
    expect(at(3.5009)).toEqual([]);
    expect(at(0.4995)).toEqual([]);
    expect(at(3.502)).toEqual(['opening-outside-host']);
    expect(at(0.495)).toEqual(['opening-outside-host']);
    // Still attached (to the nearest piece) so it can be seen and fixed.
    const { walls } = derive(mkVariant({ blocks: [square()], openings: [mkOpening('w', edge('b', 0), 4.6)] }));
    expect(walls[0].openings.map((o) => o.id)).toEqual(['w']);
  });

  it('a fullHeight opening reaches the top profile at its centre', () => {
    const gable: UndersideFn = (x) => 3 - 0.5 * Math.abs(x - 2);
    const v = mkVariant({
      blocks: [square()],
      openings: [
        mkOpening('o1', edge('b', 0), 2, { type: 'opening', fullHeight: true, height: 99, sill: 0, width: 1 }),
        mkOpening('o2', edge('b', 0), 0.5, { type: 'opening', fullHeight: true, height: 99, sill: 0, width: 1 }),
      ],
    });
    const { walls, warnings } = derive(v, gable);
    expect(warnings).toEqual([]);
    const [o1, o2] = walls[0].openings;
    expect(o1.headZ).toBeCloseTo(3.0, 9);
    expect(o2.headZ).toBeCloseTo(2.25, 9);
    expect(o1).toMatchObject({ glazed: false, leaf: 'none' });
  });

  it('warns about openings reaching into the roof', () => {
    const v = mkVariant({ blocks: [square()], openings: [mkOpening('w', edge('b', 0), 2, { sill: 1.0, height: 1.2 })] });
    expect(derive(v, flat(2.3)).warnings).toEqual([]);
    const { warnings } = derive(v, flat(2.22));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'opening-above-roof', openingId: 'w', roofZ: 2.22 });
    // The lowest roof point over the opening span counts (a window near a sloping eave).
    const slope: UndersideFn = (x) => 2.0 + 0.2 * x;
    expect(kinds(derive(mkVariant({ blocks: [square()], openings: [mkOpening('w', edge('b', 0), 2, { sill: 0.5, height: 1.8 })] }), slope).warnings)).toEqual([
      'opening-above-roof',
    ]);
  });

  it('warns about overlapping openings, but not about openings stacked in height', () => {
    const v = (sill2: number) =>
      mkVariant({
        blocks: [square()],
        openings: [mkOpening('a', edge('b', 0), 1.0), mkOpening('b', edge('b', 0), 1.5, { sill: sill2, height: 0.7 })],
      });
    expect(derive(v(0.8), flat(5)).warnings).toEqual([{ kind: 'opening-overlap', openingIds: ['a', 'b'] }]);
    expect(derive(v(2.2), flat(5)).warnings).toEqual([]);
    // Touching side by side is fine.
    const side = mkVariant({ blocks: [square()], openings: [mkOpening('a', edge('b', 0), 1.0), mkOpening('b', edge('b', 0), 2.0)] });
    expect(derive(side).warnings).toEqual([]);
  });

  it('warns about openings whose centre is on a removed edge segment and does not attach them', () => {
    const A = mkBlock('A', rect(0, 0, 10, 6), { junctions: [{ otherBlockId: 'B', policy: 'open' }] });
    const B = mkBlock('B', rect(4, -2, 8, 0));
    const v = mkVariant({
      blocks: [A, B],
      openings: [mkOpening('onB', edge('B', 2), 2), mkOpening('onA', edge('A', 0), 6), mkOpening('gone', edge('A', 0), 6, { status: 'removed' })],
    });
    const { walls, warnings } = derive(v);
    expect(warnings).toEqual([
      { kind: 'opening-on-removed-edge', openingId: 'onB' },
      { kind: 'opening-on-removed-edge', openingId: 'onA' },
    ]);
    expect(walls.flatMap((w) => w.openings)).toEqual([]);
  });

  it('maps the edge offset onto the piece of a split edge', () => {
    const b = mkBlock('m', rect(0, 0, 16, 6.2), {
      parts: [
        { id: 'p-old', name: 'Gammel', polygon: rect(0, 0, 12, 6.2), isNew: false },
        { id: 'p-new', name: 'Ny', polygon: rect(12, 0, 16, 6.2), isNew: true },
      ],
    });
    const v = mkVariant({ blocks: [b], openings: [mkOpening('s', edge('m', 0), 13), mkOpening('n', edge('m', 2), 5)] });
    const { walls, warnings } = derive(v);
    expect(warnings).toEqual([]);
    const s = byId(walls, 'm/m-v0/p-new/base').openings[0];
    expect(s.offset).toBeCloseTo(1, 12);
    expectPts([s.footprint[0]], [[12.5, -0.11]]);
    const n = byId(walls, 'm/m-v2/p-old/base').openings[0];
    expect(n.offset).toBeCloseTo(1, 12);
    expectPts([n.footprint[0]], [[11.5, 6.31]]);
  });

  it('keeps removed openings for the plan and adds an infill patch, without validation', () => {
    const v = mkVariant({
      blocks: [square()],
      openings: [mkOpening('old', edge('b', 0), 2, { status: 'removed' }), mkOpening('far', edge('b', 0), 9, { status: 'removed' })],
    });
    const { walls, warnings } = derive(v, flat(1.0));
    expect(warnings).toEqual([]);
    expect(walls[0].openings.map((o) => [o.id, o.status])).toEqual([
      ['old', 'removed'],
      ['far', 'removed'],
    ]);
    expect(walls[0].patches[0]).toEqual({ offset: 2, width: 1, sillZ: 0.8, headZ: 2.0 });
  });

  it('infill patches leave out the openings that stay or are new in the same piece', () => {
    const v = mkVariant({
      blocks: [square()],
      openings: [
        // Removed door 1.5 .. 2.5 × 0 .. 2.0 with a new window 1.4 .. 2.6 × 0.8 .. 2.0 in its place.
        mkOpening('old-door', edge('b', 0), 2, { type: 'door', width: 1, height: 2.0, sill: 0, status: 'removed' }),
        mkOpening('new-win', edge('b', 0), 2, { width: 1.2, height: 1.2, sill: 0.8, status: 'new' }),
        // Removed window fully inside a new glass door: no patch left.
        mkOpening('old-win', edge('b', 1), 1, { width: 0.8, status: 'removed' }),
        mkOpening('new-door', edge('b', 1), 1, { type: 'glassDoor', width: 1.6, height: 2.05, sill: 0, status: 'new' }),
      ],
    });
    const { walls } = derive(v);
    const south = walls.find((w) => w.openings.some((o) => o.id === 'old-door'))!;
    expect(south.patches).toHaveLength(1);
    expect(south.patches[0].offset).toBeCloseTo(2, 9);
    expect(south.patches[0].width).toBeCloseTo(1, 9);
    expect(south.patches[0].sillZ).toBeCloseTo(0, 9);
    expect(south.patches[0].headZ).toBeCloseTo(0.8, 9);
    const east = walls.find((w) => w.openings.some((o) => o.id === 'old-win'))!;
    expect(east.patches).toEqual([]);
  });

  it('patchMinusOpenings: rectangle difference in (offset, z)', () => {
    const patch = { offset: 2, width: 2, sillZ: 0, headZ: 2 };
    expect(patchMinusOpenings(patch, [])).toEqual([patch]);
    expect(patchMinusOpenings(patch, [{ offset: 5, width: 1, sillZ: 0, headZ: 2 }])).toEqual([patch]);
    const pieces = patchMinusOpenings(patch, [{ offset: 2, width: 1, sillZ: 0.5, headZ: 1.5 }]);
    const sorted = pieces.map((p) => [p.offset, p.width, p.sillZ, p.headZ].map((x) => Math.round(x * 1000) / 1000));
    expect(sorted).toEqual([
      [1.25, 0.5, 0, 2],
      [2.75, 0.5, 0, 2],
      [2, 1, 0, 0.5],
      [2, 1, 1.5, 2],
    ]);
    const area = pieces.reduce((acc, p) => acc + p.width * (p.headZ - p.sillZ), 0);
    expect(area).toBeCloseTo(4 - 1, 9);
    expect(patchMinusOpenings(patch, [{ offset: 2, width: 3, sillZ: -1, headZ: 3 }])).toEqual([]);
  });

  it('measures the sill from the replace zone 0.2 m inside the host by default', () => {
    const b = mkBlock('m', rect(0, 0, 10, 6), { floorZones: [{ id: 'z', levelId: 'lower', kind: 'replace', polygon: rect(0, 0, 5, 6) }] });
    const { levelId: _drop, ...noLevel } = mkOpening('x', edge('m', 0), 2);
    const v = mkVariant({
      blocks: [b],
      walls: [mkWall('w', [6, 1], [6, 5])],
      openings: [noLevel, { ...noLevel, id: 'y', offset: 7 }, mkOpening('z', edge('m', 0), 3, { levelId: 'loft', sill: 0.53 }), { ...noLevel, id: 'onw', host: onWall('w') }],
    });
    const { walls } = derive(v, flat(5));
    const all = walls.flatMap((w) => w.openings);
    const sill = (id: string) => all.find((o) => o.id === id)?.sillZ;
    expect(sill('x')).toBeCloseTo(-0.2, 12);
    expect(sill('y')).toBeCloseTo(0.8, 12);
    expect(sill('z')).toBeCloseTo(2.0, 12);
    expect(sill('onw')).toBeCloseTo(0.8, 12);
  });

  it('rejects unknown hosts and dividers as hosts', () => {
    const v = mkVariant({
      blocks: [square()],
      walls: [mkWall('dv', [0, 2], [4, 2], { kind: 'divider', thickness: 0 })],
      openings: [
        mkOpening('a', { kind: 'blockEdge', blockId: 'b', edgeId: 'nope' }, 1),
        mkOpening('b', { kind: 'blockEdge', blockId: 'nope', edgeId: 'b-v0' }, 1),
        mkOpening('c', onWall('nope'), 1),
        mkOpening('d', onWall('dv'), 1),
      ],
    });
    const { walls, warnings } = derive(v);
    expect(warnings.map((w) => (w.kind === 'opening-outside-host' ? w.openingId : w.kind))).toEqual(['a', 'b', 'c', 'd']);
    expect(walls.flatMap((w) => w.openings)).toEqual([]);
  });

  it('resolves rendering hints from type and style', () => {
    const o = (type: Opening['type'], leaf?: Opening['style']['leaf']) =>
      openingHints(mkOpening('x', edge('b', 0), 1, { type, style: leaf ? { frameColour: 'wood', leaf } : { frameColour: 'wood' } }));
    expect(o('glassDoor')).toMatchObject({ glazed: true, leaf: 'glass', leafColour: 'glass' });
    expect(o('slidingDoor')).toMatchObject({ glazed: true, leaf: 'glass' });
    expect(o('saunaDoor')).toMatchObject({ glazed: true, leaf: 'glass', leafColour: 'glass' });
    expect(o('saunaDoor', 'wood')).toMatchObject({ glazed: false, leaf: 'solid', leafColour: 'wood' });
    expect(o('door', 'glass')).toMatchObject({ glazed: true, leaf: 'glass' });
    expect(o('door', 'green')).toMatchObject({ glazed: false, leaf: 'solid', leafColour: 'green', frameColour: 'wood' });
    expect(o('opening')).toMatchObject({ glazed: false, leaf: 'none', panes: [1, 1], frameDepth: 0.1 });
  });
});

// ---------------------------------------------------------------------------
// Stored walls
// ---------------------------------------------------------------------------

describe('deriveWalls: stored walls', () => {
  const block = mkBlock('b', rect(0, 0, 10, 6), {
    floorZones: [
      { id: 'z-low', levelId: 'lower', kind: 'replace', polygon: rect(0, 0, 4, 6) },
      { id: 'z-loft', levelId: 'loft', kind: 'add', polygon: rect(0, 0, 4, 6) },
    ],
  });
  const stored = (walls: Wall[], env: UndersideFn = flat(3)) => derive(mkVariant({ blocks: [block], walls }), env).walls.filter((w) => !w.isExterior);

  it('interior walls: centred butt footprint, status, levels', () => {
    const [w] = stored([mkWall('w', [6, 1], [6, 3], { status: 'new', heightMode: 'fixed', height: 2.4 })]);
    expect(w).toMatchObject({
      id: 'w',
      source: { kind: 'wall', wallId: 'w' },
      thickness: 0.12,
      faceLeft: 0.06,
      faceRight: 0.06,
      ends: { start: 'butt', end: 'butt' },
      isExterior: false,
      isDivider: false,
      status: 'new',
      isNew: true,
      levelId: 'main',
      levelIds: ['main'],
      storeyIds: ['ground'],
      baseZ: 0,
      topZ: 2.4,
    });
    expectPts(w.footprint, [
      [6.06, 1],
      [6.06, 3],
      [5.94, 3],
      [5.94, 1],
    ]);
  });

  it('asymmetric faces and removed status', () => {
    const [w] = stored([mkWall('g', [5, 10.1], [9, 10.1], { kind: 'exterior-old', thickness: 0.27, faceLeft: 0.11, faceRight: 0.16, status: 'removed' })]);
    expect(w).toMatchObject({ faceLeft: 0.11, faceRight: 0.16, status: 'removed', isNew: false, isExterior: false });
    expectPts(w.footprint, [
      [5, 9.94],
      [9, 9.94],
      [9, 10.21],
      [5, 10.21],
    ]);
  });

  it('dividers have no footprint, no thickness and only their own level', () => {
    const [d] = stored([mkWall('dv', [6, 0], [6, 6], { kind: 'divider', thickness: 0.12 })]);
    expect(d).toMatchObject({ thickness: 0, faceLeft: 0, faceRight: 0, footprint: [], isDivider: true, levelIds: ['main'], storeyIds: ['ground'] });
  });

  it('height modes: auto stops at the level ceiling, roof follows the envelope, fixed is clipped by it', () => {
    const gable: UndersideFn = (x) => 3 - 0.5 * Math.abs(x - 2);
    const [auto, roof, fixed] = stored(
      [
        mkWall('auto', [1, 1], [1, 5], { levelId: 'lower' }),
        mkWall('roof', [1, 3], [3, 3], { levelId: 'lower', heightMode: 'roof' }),
        mkWall('fixed', [0, 1], [4, 1], { heightMode: 'fixed', height: 2.4 }),
      ],
      gable,
    );
    expect(auto.baseZ).toBe(-1);
    expect(auto.topProfile.map((p) => p.t)).toEqual([0, 1]);
    for (const p of auto.topProfile) expect(p.z).toBeCloseTo(1.3, 12);
    expect(roof.topProfile.map((p) => [p.t, p.z])).toEqual([
      [0, 2.5],
      [0.5, 3],
      [1, 2.5],
    ]);
    expect(fixed.topProfile).toHaveLength(4);
    const expected = [
      [0, 2.0],
      [0.2, 2.4],
      [0.8, 2.4],
      [1, 2.0],
    ];
    fixed.topProfile.forEach((p, i) => {
      expect(p.t).toBeCloseTo(expected[i][0], 9);
      expect(p.z).toBeCloseTo(expected[i][1], 9);
    });
    expect(fixed.topZ).toBeCloseTo(2.4, 12);
  });

  it('levelIds: z range covers level + 1.0 where that level exists', () => {
    const ws = stored([
      mkWall('low-auto', [1, 1], [1, 5], { levelId: 'lower' }), // top 1.3
      mkWall('low-roof', [1, 3], [3, 3], { levelId: 'lower', heightMode: 'roof' }), // top 3.0, under the loft zone
      mkWall('main-roof', [7, 1], [7, 5], { heightMode: 'roof' }), // top 3.0, no loft here
      mkWall('loft', [1, 2], [3, 2], { levelId: 'loft' }),
      mkWall('outside', [20, 0], [20, 2], { heightMode: 'roof' }),
    ]);
    expect(ws.map((w) => [w.id, w.levelIds, w.storeyIds])).toEqual([
      ['low-auto', ['lower', 'main'], ['ground']],
      ['low-roof', ['lower', 'main', 'loft'], ['ground', 'loft']],
      ['main-roof', ['main'], ['ground']],
      ['loft', ['loft'], ['loft']],
      ['outside', ['main'], ['ground']],
    ]);
  });

  it('uses fallbacks where no roof covers the wall', () => {
    const none: UndersideFn = () => null;
    const [auto, fixed, low] = stored(
      [mkWall('a', [6, 1], [6, 3]), mkWall('f', [6, 1], [6, 3], { heightMode: 'fixed', height: 2.1 }), mkWall('l', [1, 1], [1, 3], { levelId: 'lower' })],
      none,
    );
    expect(auto.topZ).toBeCloseTo(2.4, 12);
    expect(fixed.topZ).toBeCloseTo(2.1, 12);
    expect(low.topZ).toBeCloseTo(1.3, 12);
    const ext = derive(mkVariant({ blocks: [block] }), none).walls[0];
    expect(ext.topZ).toBeCloseTo(2.22, 12); // block eaveZ
  });

  it("block ceilings: 'auto' walls inside a block with ceilingHeight stop there; roof, fixed and other blocks do not", () => {
    const wing = mkBlock('wing', rect(20, 0, 25, 8), { ceilingHeight: 2.4 });
    const v = mkVariant({
      blocks: [block, wing],
      walls: [
        mkWall('in-auto', [21, 1], [21, 5]),
        mkWall('in-roof', [22, 1], [22, 5], { heightMode: 'roof' }),
        mkWall('in-fixed', [23, 1], [23, 5], { heightMode: 'fixed', height: 2.1 }),
        mkWall('out-auto', [7, 1], [7, 5]),
        mkWall('in-low', [21, 6], [24, 6], { levelId: 'lower' }), // the level ceiling (1.3) is lower: it wins
      ],
    });
    const ws = derive(v, flat(3.5)).walls.filter((w) => !w.isExterior);
    const top = (id: string) => byId(ws, id).topZ;
    expect(top('in-auto')).toBeCloseTo(2.4, 12);
    expect(top('in-roof')).toBeCloseTo(3.5, 12);
    expect(top('in-fixed')).toBeCloseTo(2.1, 12);
    expect(top('out-auto')).toBeCloseTo(3.5, 12);
    expect(top('in-low')).toBeCloseTo(1.3, 12);
    // A wall standing above the ceiling (loft level) is not capped by it.
    const loftWing = mkBlock('lw', rect(20, 0, 25, 8), { ceilingHeight: 1.0 });
    const [high] = derive(mkVariant({ blocks: [loftWing], walls: [mkWall('h', [21, 1], [21, 5], { levelId: 'loft' })] }), flat(3.5)).walls.filter(
      (w) => !w.isExterior,
    );
    expect(high.topZ).toBeCloseTo(3.5, 12);
  });

  it('zero-length walls do not break anything', () => {
    const [w] = stored([mkWall('p', [6, 1], [6, 1])]);
    expect(w.footprint).toEqual([]);
    expect(w.topProfile).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

describe('envelopeProfile', () => {
  it('finds a kink between samples exactly', () => {
    const env: UndersideFn = (x) => 3 - 0.5 * Math.abs(x - 1.234);
    const p = envelopeProfile([0, 0], [4, 0], env, 0);
    expect(p).toHaveLength(3);
    expect(p[1].t * 4).toBeCloseTo(1.234, 9);
    expect(p[1].z).toBeCloseTo(3, 9);
    expect(p[0].z).toBeCloseTo(3 - 0.617, 12);
    expect(p[2].z).toBeCloseTo(3 - 0.5 * 2.766, 12);
  });

  it('captures a step (roof outline) within a micrometre', () => {
    const env: UndersideFn = (x) => (x < 2.345 ? 2.5 : 3.0);
    const p = envelopeProfile([0, 0], [4, 0], env, 0);
    expect(p).toHaveLength(4);
    expect(p[1].z).toBe(2.5);
    expect(p[2].z).toBe(3.0);
    expect(Math.abs(p[1].t * 4 - 2.345)).toBeLessThan(1e-6);
    expect(Math.abs(p[2].t * 4 - 2.345)).toBeLessThan(1e-6);
    expect(profileAt(p, 0.5)).toBe(2.5);
    expect(profileAt(p, 0.6)).toBe(3.0);
  });

  it('uses the fallback where no roof covers the line', () => {
    const env: UndersideFn = (x) => (x < 1 ? null : 3);
    const p = envelopeProfile([0, 0], [4, 0], env, 2.22);
    expect(p[0].z).toBe(2.22);
    expect(p[p.length - 1].z).toBe(3);
  });

  it('roof events catch features narrower than the sampling step', () => {
    const strip: DerivedRoof = {
      blockId: 'x',
      material: 'turf',
      thickness: 0.3,
      slopes: [
        {
          polygon: [
            [1.02, -1, 3.8],
            [1.07, -1, 3.8],
            [1.07, 1, 3.8],
            [1.02, 1, 3.8],
          ],
          normal: [0, 0, 1],
          facing: 'S',
          isNew: false,
        },
      ],
      trims: [],
      outline: [
        [1.02, -1],
        [1.07, -1],
        [1.07, 1],
        [1.02, 1],
      ],
    };
    const env: UndersideFn = (x, y) => (x >= 1.02 && x <= 1.07 && Math.abs(y) <= 1 ? 3.5 : 3.0);
    const events = roofEvents([strip]);
    expect(events.planes).toHaveLength(1);
    expect(events.planes[0].c).toBeCloseTo(3.5, 12);
    const withEvents = envelopeProfile([0, 0], [4, 0], env, 0, events);
    expect(Math.max(...withEvents.map((q) => q.z))).toBe(3.5);
    expect(profileAt(withEvents, 1.045 / 4)).toBeCloseTo(3.5, 9);
    expect(Math.max(...envelopeProfile([0, 0], [4, 0], env, 0).map((q) => q.z))).toBe(3.0);
  });

  it('includes pairwise plane intersections of sloped roofs', () => {
    // Two mono planes z = 2 + 0.1·x and z = 3 − 0.2·x cross at x = 10/3; the envelope is their maximum.
    const slope = (gx: number, c: number): DerivedRoof['slopes'][number] => {
      const n = Math.hypot(gx, 1);
      return {
        polygon: [
          [-10, -10, c - 10 * gx + 0.2],
          [10, -10, c + 10 * gx + 0.2],
          [10, 10, c + 10 * gx + 0.2],
        ],
        normal: [-gx / n, 0, 1 / n],
        facing: 'S',
        isNew: false,
      };
    };
    const roof = (gx: number, c: number): DerivedRoof => ({ blockId: 'r', material: 'metal', thickness: 0.2, slopes: [slope(gx, c)], trims: [], outline: rect(-10, -10, 10, 10) });
    const events = roofEvents([roof(0.1, 2), roof(-0.2, 3)]);
    const env: UndersideFn = (x) => Math.max(2 + 0.1 * x, 3 - 0.2 * x);
    const p = envelopeProfile([0, 0], [5, 0], env, 0, events);
    expect(p).toHaveLength(3);
    expect(p[1].t * 5).toBeCloseTo(10 / 3, 9);
  });

  it('capProfile inserts the exact crossings', () => {
    const p = capProfile(
      [
        { t: 0, z: 2 },
        { t: 0.5, z: 3 },
        { t: 1, z: 2 },
      ],
      2.5,
    );
    expect(p).toEqual([
      { t: 0, z: 2 },
      { t: 0.25, z: 2.5 },
      { t: 0.75, z: 2.5 },
      { t: 1, z: 2 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Forslag D (integration with roof.ts)
// ---------------------------------------------------------------------------

describe('Forslag D', () => {
  const project = createForslagD();
  const variant = project.variants[0];
  const blocks = deriveBlocks(variant, project.site, terrainJson as TerrainAsset);
  const roofs = buildRoofs(variant, blocks);
  const { walls, warnings } = deriveWalls(variant, blocks, roofs);

  it('derives without warnings and with unique ids', () => {
    expect(warnings).toEqual([]);
    expect(deriveBlockWarnings(blocks)).toEqual([]);
    expect(new Set(walls.map((w) => w.id)).size).toBe(walls.length);
    expect(walls.filter((w) => !w.isExterior)).toHaveLength(variant.walls.length);
  });

  it('cuts the exterior walls at the junctions, parts and the lower zone', () => {
    const ids = exterior(walls).map((w) => w.id);
    expect(ids).toHaveLength(19);
    expect(ids).toContain('blk-main/v-main-sw/part-main-old/zone-lower');
    expect(ids).toContain('blk-main/v-main-sw/part-stue-ext/base');
    expect(ids).toContain('blk-bod/v-bod-se/part-bod-new/base');
    expect(ids).toContain('blk-wing/v-wing-nw/blk-wing-implicit/base');
    expect(ids.some((id) => id.startsWith('blk-main/v-main-se/'))).toBe(false); // open to the new wing
    expect(ids.some((id) => id.startsWith('blk-glass/v-glass-ne/'))).toBe(false); // open to the living room
    expect(ids.some((id) => id.startsWith('blk-bod/v-bod-sw/'))).toBe(false); // owned by the main house
  });

  it('closes every corner: the exterior walls form one outline with two holes', () => {
    const u = unionPolygons(exterior(walls).map((w) => w.footprint));
    expect(u).toHaveLength(1);
    expect(u[0]).toHaveLength(3);
    const sum = exterior(walls).reduce((acc, w) => acc + area(w.footprint), 0);
    expect(unionArea(exterior(walls).map((w) => w.footprint))).toBeCloseTo(sum, 6);
  });

  it('runs the west gable up to the main ridge and keeps the bod wing out of the loft', () => {
    const gable = byId(walls, 'blk-main/v-main-nw/part-main-old/zone-lower');
    expect(gable.baseZ).toBe(-1);
    expect(gable.topZ).toBeCloseTo(2.22 + 3.1 * Math.tan((28 * Math.PI) / 180), 6);
    expect(gable.topProfile).toHaveLength(3);
    expect(gable.openings.map((o) => o.id)).toEqual(['win-104-w', 'win-hems-w1', 'win-hems-w2']);
    expect(byId(walls, 'w-mellom-boder').storeyIds).toEqual(['ground']);
    expect(byId(walls, 'w-106-korr').storeyIds).toEqual(['ground', 'loft']);
    expect(byId(walls, 'w-104-diag').topZ).toBeCloseTo(1.3, 12);
  });

  it('attaches every stored opening exactly once', () => {
    const attached = walls.flatMap((w) => w.openings.map((o) => o.id)).sort();
    expect(attached).toEqual(variant.openings.map((o) => o.id).sort());
    expect(walls.flatMap((w) => w.patches)).toHaveLength(2);
  });
});
