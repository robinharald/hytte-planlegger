import { describe, expect, it } from 'vitest';
import type { DerivedOpening, DerivedRailing, DerivedWall, RoofSlope } from '../model/derived';
import type { Vec2, Vec3 } from '../model/types';
import { FIXTURE_DERIVED, fixtureWall } from './fixture';
import {
  appendBox,
  appendDeckSkirt,
  appendPolygon,
  appendPrism,
  buildDeck,
  buildFloor,
  buildFoundation,
  buildHorizontalRect,
  buildOpening,
  buildRailing,
  buildRoofSlope,
  buildRoofTrims,
  buildSteps,
  buildStructure,
  buildTerrainGrid,
  buildWallPieces,
  createMeshData,
  DECK_MAT,
  DOUBLE_LEAF_GAP,
  FLOOR_MAT,
  gridExtent,
  isEmpty,
  meshBounds,
  OPENING_MAT,
  profileZAt,
  ROOF_MAT,
  ROOF_TRIM_MAT,
  signedVolume,
  sliceFootprint,
  STRUCT_MAT,
  swapUVs,
  TERRAIN_PATCH_MAX_VERTICES,
  terrainPatch,
  toBufferGeometry,
  triangleCentroids,
  triangleCount,
  triangleNormal,
  vertexCount,
  WALL_MAT,
  wallSliceBoundaries,
} from './geometryBuilders';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

function allNormalsOutward(d: ReturnType<typeof createMeshData>): boolean {
  // for a convex-ish closed solid: every face normal points away from the mesh centre
  const { min, max } = meshBounds(d);
  const c: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  return d.indices.every((_, slot) =>
    triangleCentroids(d, slot).every((p, i) => {
      const n = triangleNormal(d, slot, i);
      return n[0] * (p[0] - c[0]) + n[1] * (p[1] - c[1]) + n[2] * (p[2] - c[2]) > -1e-9;
    }),
  );
}

describe('primitives', () => {
  it('a box has 24 vertices, 12 outward triangles and the right volume', () => {
    const d = createMeshData();
    appendBox(d, [0, 0, 0], [2, 3, 4], 0);
    expect(vertexCount(d)).toBe(24);
    expect(triangleCount(d)).toBe(12);
    expect(signedVolume(d)).toBeCloseTo(24, 9);
    expect(allNormalsOutward(d)).toBe(true);
  });

  it('a prism gives the same solid for CW and CCW rings', () => {
    const ring: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 3],
      [0, 3],
    ];
    const a = createMeshData();
    const b = createMeshData();
    appendPrism(a, { ring, bottomZ: 0, topZ: 2, topSlot: 0, bottomSlot: 0, sideSlot: 0 });
    appendPrism(b, { ring: [...ring].reverse(), bottomZ: 0, topZ: 2, topSlot: 0, bottomSlot: 0, sideSlot: 0 });
    expect(signedVolume(a)).toBeCloseTo(12, 9);
    expect(signedVolume(b)).toBeCloseTo(12, 9);
    expect(triangleCount(a)).toBe(triangleCount(b));
  });

  it('skips degenerate rings and duplicate closing points', () => {
    const d = createMeshData();
    appendPrism(d, { ring: [[0, 0], [1, 1], [2, 2]], bottomZ: 0, topZ: 1, topSlot: 0, bottomSlot: 0, sideSlot: 0 });
    appendPrism(d, { ring: [[0, 0]], bottomZ: 0, topZ: 1, topSlot: 0, bottomSlot: 0, sideSlot: 0 });
    expect(isEmpty(d)).toBe(true);
    appendPolygon(d, [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]], [], 0);
    expect(triangleCount(d)).toBe(2);
    expect(vertexCount(d)).toBe(4);
  });

  it('triangulates holes and keeps the face normal', () => {
    const d = createMeshData();
    appendPolygon(
      d,
      [[0, 0, 1], [4, 0, 1], [4, 4, 1], [0, 4, 1]],
      [[[1, 1, 1], [1, 2, 1], [2, 2, 1], [2, 1, 1]]],
      0,
    );
    expect(triangleCount(d)).toBe(8);
    for (let i = 0; i < 8; i++) expect(triangleNormal(d, 0, i)[2]).toBeCloseTo(1, 9);
    for (const c of triangleCentroids(d, 0)) expect(c[0] > 1 && c[0] < 2 && c[1] > 1 && c[1] < 2).toBe(false);
  });

  it('swapUVs swaps the coordinates of one slot only', () => {
    const d = createMeshData(2);
    appendBox(d, [0, 0, 0], [1, 2, 3], 0);
    appendBox(d, [5, 5, 5], [6, 6, 6], 1);
    const before = [...d.uvs];
    swapUVs(d, 0);
    const v0 = d.indices[0][0];
    expect(d.uvs[v0 * 2]).toBe(before[v0 * 2 + 1]);
    const v1 = d.indices[1][0];
    expect(d.uvs[v1 * 2]).toBe(before[v1 * 2]);
  });
});

describe('profiles and slicing', () => {
  it('profileZAt interpolates and extrapolates', () => {
    const p = [
      { t: 0, z: 2.2 },
      { t: 0.5, z: 3.2 },
      { t: 1, z: 2.2 },
    ];
    expect(profileZAt(p, 0.25)).toBeCloseTo(2.7, 12);
    expect(profileZAt(p, -0.1)).toBeCloseTo(2.0, 12);
    expect(profileZAt(p, 1.1)).toBeCloseTo(2.0, 12);
    expect(profileZAt([], 0.3, 7)).toBe(7);
    expect(profileZAt([{ t: 0.2, z: 1.5 }], 0.9)).toBe(1.5);
  });

  it('sliceFootprint clips a mitred footprint and returns [] outside', () => {
    const w = fixtureWall('v-s');
    const mid = sliceFootprint(w.footprint, w.a, [1, 0], 6, 0.25, 0.5);
    const xs = mid.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(1.5, 9);
    expect(Math.max(...xs)).toBeCloseTo(3, 9);
    expect(sliceFootprint(w.footprint, w.a, [1, 0], 6, 1.2, 1.5)).toEqual([]);
    const open = sliceFootprint(w.footprint, w.a, [1, 0], 6, -Infinity, 0.1);
    expect(Math.min(...open.map((p) => p[0]))).toBeCloseTo(-0.11, 9);
  });

  it('slice boundaries include jambs, profile breakpoints and cut crossings', () => {
    const s = fixtureWall('v-s');
    const b = wallSliceBoundaries(s, null).map((t) => t * 6);
    expect(b.length).toBe(6);
    [0, 1.4, 2.6, 4.05, 4.95, 6].forEach((x, i) => expect(b[i]).toBeCloseTo(x, 9));
    const e = fixtureWall('v-e');
    expect(wallSliceBoundaries(e, null)).toEqual([0, 0.5, 1]);
    const cut = wallSliceBoundaries(e, 2.7);
    expect(cut.length).toBe(5);
    expect(cut[1]).toBeCloseTo(0.25, 9);
    expect(cut[3]).toBeCloseTo(0.75, 9);
  });
});

describe('buildWallPieces', () => {
  it('builds a gable wall as two piers split at the ridge, with the exact volume', () => {
    const { data, prisms } = buildWallPieces(fixtureWall('v-e'));
    expect(prisms.map((p) => p.kind)).toEqual(['pier', 'pier']);
    expect(vertexCount(data)).toBe(48);
    expect(triangleCount(data)).toBe(24);
    const b = meshBounds(data);
    expect(b.max[2]).toBeCloseTo(3.2, 9);
    expect(b.min[2]).toBeCloseTo(0, 9);
    // mitred corner: top extrapolated along the profile to 2.2 − 2·0.0275
    expect(b.min[0]).toBeCloseTo(5.84, 9);
    expect(signedVolume(data)).toBeCloseTo(2.8853955, 6);
  });

  it('splits around a window (sill + lintel) and a door (lintel only)', () => {
    const { data, prisms } = buildWallPieces(fixtureWall('v-s'));
    expect(prisms.map((p) => p.kind)).toEqual(['pier', 'sill', 'lintel', 'pier', 'lintel', 'pier']);
    expect(prisms[1].openingId).toBe('win-s');
    expect(prisms[4].openingId).toBe('door-s');
    expect(vertexCount(data)).toBe(6 * 24);
    // nothing inside the window hole or the door hole
    for (let slot = 0; slot < 4; slot++) {
      for (const c of triangleCentroids(data, slot)) {
        if (c[0] > 1.41 && c[0] < 2.59) expect(c[2] < 0.9 + 1e-9 || c[2] > 2.1 - 1e-9).toBe(true);
        if (c[0] > 4.06 && c[0] < 4.94) expect(c[2] > 2 - 1e-9).toBe(true);
      }
    }
    // full wall minus the two holes
    const full = 0.27 * ((6.22 + 5.68) / 2) * 2.2;
    expect(signedVolume(data)).toBeCloseTo(full - 1.2 * 1.2 * 0.27 - 0.9 * 2 * 0.27, 6);
  });

  it('puts the outside (right) and inside (left) faces in their slots', () => {
    const { data } = buildWallPieces(fixtureWall('v-s'));
    for (const c of triangleCentroids(data, WALL_MAT.outside)) expect(c[1]).toBeCloseTo(-0.11, 9);
    for (const c of triangleCentroids(data, WALL_MAT.inside)) expect(c[1] > -0.11 + 1e-6).toBe(true);
    expect(triangleCount(data, WALL_MAT.reveal)).toBeGreaterThan(0);
    expect(triangleCount(data, WALL_MAT.cap)).toBe(0);
  });

  it('ignores removed openings (the patch is plain wall)', () => {
    const { prisms } = buildWallPieces(fixtureWall('v-n'));
    expect(prisms.map((p) => p.kind)).toEqual(['pier']);
  });

  it('cuts the top at the cut plane with a cap', () => {
    const low = buildWallPieces(fixtureWall('v-e'), 1.6);
    expect(low.prisms.every((p) => p.capped)).toBe(true);
    expect(meshBounds(low.data).max[2]).toBeCloseTo(1.6, 9);
    expect(signedVolume(low.data)).toBeCloseTo(0.27 * ((4.22 + 3.68) / 2) * 1.6, 6);
    expect(triangleCount(low.data, WALL_MAT.cap)).toBeGreaterThan(0);

    const mid = buildWallPieces(fixtureWall('v-e'), 2.7);
    expect(mid.prisms.map((p) => p.capped)).toEqual([false, true, true, false]);
    expect(meshBounds(mid.data).max[2]).toBeCloseTo(2.7, 9);

    const high = buildWallPieces(fixtureWall('v-e'), 10);
    expect(signedVolume(high.data)).toBeCloseTo(signedVolume(buildWallPieces(fixtureWall('v-e')).data), 9);
    expect(triangleCount(high.data, WALL_MAT.cap)).toBe(0);
  });

  it('drops the lintels and the door above a low cut', () => {
    const { prisms, data } = buildWallPieces(fixtureWall('v-s'), 1.5);
    expect(prisms.map((p) => p.kind)).toEqual(['pier', 'sill', 'pier', 'pier']);
    expect(meshBounds(data).max[2]).toBeCloseTo(1.5, 9);
  });

  it('returns nothing for dividers, zero-length walls and cuts below the base', () => {
    expect(isEmpty(buildWallPieces(fixtureWall('w-div')).data)).toBe(true);
    expect(isEmpty(buildWallPieces(fixtureWall('v-e'), 0).data)).toBe(true);
    const zero: DerivedWall = { ...fixtureWall('w-int'), b: fixtureWall('w-int').a };
    expect(isEmpty(buildWallPieces(zero).data)).toBe(true);
    const noFootprint: DerivedWall = { ...fixtureWall('w-int'), footprint: [] };
    expect(isEmpty(buildWallPieces(noFootprint).data)).toBe(true);
  });

  it('builds an interior wall with a door: two piers and a lintel', () => {
    const { prisms } = buildWallPieces(fixtureWall('w-int'));
    expect(prisms.map((p) => p.kind)).toEqual(['pier', 'lintel', 'pier', 'pier']);
  });

  it('cuts stacked openings that share a stretch of wall: wall below, between and above them', () => {
    const w = fixtureWall('v-s');
    const win = w.openings[0];
    const low: DerivedOpening = { ...win, id: 'low', offset: win.offset + 0.3, sillZ: 0.2, headZ: win.sillZ - 0.3 };
    const { prisms, data } = buildWallPieces({ ...w, openings: [...w.openings, low] });
    const t = (win.offset + 0.4) / 6; // inside both openings
    const at = prisms.filter((p) => p.t0 <= t && p.t1 >= t).sort((p, q) => p.bottomZ - q.bottomZ);
    expect(at.map((p) => [p.kind, p.openingId, p.bottomZ])).toEqual([
      ['sill', 'low', w.baseZ],
      ['lintel', 'low', low.headZ],
      ['lintel', win.id, win.headZ],
    ]);
    expect(signedVolume(data)).toBeGreaterThan(0);
  });
});

describe('buildOpening', () => {
  const south = fixtureWall('v-s');
  const win = south.openings[0];
  const door = south.openings[1];

  it('builds a window: frame, glass on the glass plane, mullions and an exterior surround', () => {
    const { solid, glass } = buildOpening(win, south);
    expect(triangleCount(glass)).toBe(2);
    for (const c of triangleCentroids(glass, 0)) expect(c[1]).toBeCloseTo(0.025, 9);
    // 4 frame members + 1 vertical + 2 horizontal mullion pieces = 7 boxes
    expect(triangleCount(solid, OPENING_MAT.frame)).toBe(7 * 12);
    expect(triangleCount(solid, OPENING_MAT.trim)).toBe(4 * 12);
    for (const c of triangleCentroids(solid, OPENING_MAT.trim)) expect(c[1] <= -0.11 + 1e-9 && c[1] >= -0.135 - 1e-9).toBe(true);
    const b = meshBounds(solid);
    expect(b.min[2]).toBeCloseTo(0.9 - 0.07, 9);
    expect(b.max[2]).toBeCloseTo(2.1 + 0.07, 9);
  });

  it('builds a door with a closed solid leaf and no sill member', () => {
    const { solid, glass } = buildOpening(door, south);
    expect(isEmpty(glass)).toBe(true);
    expect(triangleCount(solid, OPENING_MAT.leaf)).toBe(12);
    expect(triangleCount(solid, OPENING_MAT.frame)).toBe(3 * 12);
    expect(triangleCount(solid, OPENING_MAT.trim)).toBe(3 * 12);
    expect(meshBounds(solid).min[2]).toBeCloseTo(0, 9);
  });

  // only its presence matters to the 3D builder (doors are drawn closed)
  const swing2: DerivedOpening['swing2'] = { hinge: [0, 0], closed: [1, 0], open: [0, 1], sweep: 1 };

  it('builds two closed leaves for a double door', () => {
    const { solid, glass } = buildOpening({ ...door, swing2 }, south);
    expect(isEmpty(glass)).toBe(true);
    expect(triangleCount(solid, OPENING_MAT.leaf)).toBe(2 * 12);
    expect(triangleCount(solid, OPENING_MAT.frame)).toBe(3 * 12);
    // two leaves either side of the centre, together the clear width minus the seam
    const single = buildOpening(door, south).solid;
    const leafOnly = (d: typeof solid) => ({ ...d, indices: d.indices.map((list, slot) => (slot === OPENING_MAT.leaf ? list : [])) });
    const xs = triangleCentroids(solid, OPENING_MAT.leaf).map((c) => c[0]);
    const centre = south.a[0] + door.offset; // the south wall runs along +x
    expect(xs.some((x) => x < centre - 0.1) && xs.some((x) => x > centre + 0.1)).toBe(true);
    expect(xs.some((x) => Math.abs(x - centre) < DOUBLE_LEAF_GAP / 2)).toBe(false);
    const clear = door.width - 2 * Math.min(0.06, door.width / 6, (door.headZ - door.sillZ) / 6);
    expect(signedVolume(leafOnly(solid)) / signedVolume(leafOnly(single))).toBeCloseTo((clear - DOUBLE_LEAF_GAP) / clear, 9);
  });

  it('splits a glazed double door with a meeting stile and panes per leaf', () => {
    const glazedDoor: DerivedOpening = { ...door, leaf: 'glass', leafColour: 'glass', glazed: true, panes: [1, 1] };
    const one = buildOpening(glazedDoor, south);
    const two = buildOpening({ ...glazedDoor, swing2 }, south);
    expect(triangleCount(one.glass)).toBe(2);
    expect(triangleCount(two.glass)).toBe(4);
    expect(triangleCount(two.solid, OPENING_MAT.frame)).toBe(triangleCount(one.solid, OPENING_MAT.frame) + 12);
    const withBars = buildOpening({ ...glazedDoor, swing2, panes: [2, 1] }, south);
    // one vertical bar per leaf on top of the stile
    expect(triangleCount(withBars.solid, OPENING_MAT.frame)).toBe(triangleCount(two.solid, OPENING_MAT.frame) + 2 * 12);
  });

  it('gives interior openings no surround', () => {
    const w = fixtureWall('w-int');
    const { solid } = buildOpening(w.openings[0], w);
    expect(triangleCount(solid, OPENING_MAT.trim)).toBe(0);
    expect(triangleCount(solid, OPENING_MAT.leaf)).toBe(12);
  });

  it('clips at the cut plane and drops frameless or removed openings', () => {
    const cut = buildOpening(win, south, 1.5);
    expect(meshBounds(cut.solid).max[2]).toBeCloseTo(1.5, 9);
    expect(meshBounds(cut.glass).max[2]).toBeCloseTo(1.5, 9);
    expect(isEmpty(buildOpening(win, south, 0.5).solid)).toBe(true);
    expect(isEmpty(buildOpening({ ...win, type: 'opening', glazed: false }, south).solid)).toBe(true);
    expect(isEmpty(buildOpening(fixtureWall('v-n').openings[0], fixtureWall('v-n')).solid)).toBe(true);
  });

  it('puts the surround on the left side when the outward normal says so', () => {
    const flipped = { ...south, a: south.b, b: south.a };
    const { solid } = buildOpening({ ...win, offset: 6 - win.offset, outward: [0, -1] }, { ...flipped, faceLeft: 0.11, faceRight: 0.16 });
    for (const c of triangleCentroids(solid, OPENING_MAT.trim)) expect(c[1] < -0.11 + 1e-9).toBe(true);
  });
});

describe('roofs', () => {
  const slope = FIXTURE_DERIVED.roofs[0].slopes[0];

  it('builds a 4-point slope as a closed prism with the slope normal on top', () => {
    const d = buildRoofSlope(slope, 0.31);
    expect(triangleCount(d)).toBe(12);
    expect(vertexCount(d)).toBe(24);
    expect(triangleCount(d, ROOF_MAT.underside)).toBe(2);
    const n = triangleNormal(d, ROOF_MAT.turf, 0);
    expect(n[1]).toBeCloseTo(slope.normal[1], 6);
    expect(n[2]).toBeCloseTo(slope.normal[2], 6);
    const b = meshBounds(d);
    expect(b.min[2]).toBeCloseTo(2.255 - 0.31, 9);
    expect(b.max[2]).toBeCloseTo(3.51, 9);
    expect(signedVolume(d)).toBeCloseTo(6.7 * 2.51 * 0.31, 6);
  });

  it('accepts a clockwise polygon and rejects degenerate ones', () => {
    const cw: RoofSlope = { ...slope, polygon: [...slope.polygon].reverse() };
    expect(signedVolume(buildRoofSlope(cw, 0.31))).toBeCloseTo(6.7 * 2.51 * 0.31, 6);
    const flat: RoofSlope = { ...slope, polygon: [[0, 0, 1], [1, 0, 1], [2, 0, 1]] };
    expect(isEmpty(buildRoofSlope(flat, 0.31))).toBe(true);
    expect(triangleCount(buildRoofSlope(slope, 0))).toBe(2);
  });

  it('builds a 5-point clipped slope', () => {
    const five: RoofSlope = {
      ...slope,
      polygon: [
        [0, 0, 2],
        [4, 0, 2],
        [4, 1, 2.5],
        [2, 2, 3],
        [0, 2, 3],
      ],
    };
    const d = buildRoofSlope(five, 0.3);
    expect(triangleCount(d, ROOF_MAT.turf)).toBe(3 + 5 * 2);
  });

  it('shifts trims outwards and adds a ridge cap', () => {
    const d = buildRoofTrims(FIXTURE_DERIVED.roofs[0]);
    expect(triangleCount(d, ROOF_TRIM_MAT.trim)).toBe(6 * 12);
    expect(triangleCount(d, ROOF_TRIM_MAT.cap)).toBe(12);
    const cs = triangleCentroids(d, ROOF_TRIM_MAT.trim);
    const west = cs.filter((c) => c[0] < 0);
    expect(west.length).toBeGreaterThan(0);
    for (const c of west) expect(c[0] <= -0.35 + 1e-9).toBe(true);
    const capTop = meshBounds({ ...d, indices: [[], d.indices[ROOF_TRIM_MAT.cap]] });
    expect(capTop.max[2]).toBeGreaterThan(3.51);
  });
});

describe('floors, decks, railings, steps', () => {
  it('builds a ground floor as a single cap and a slab with a hole as an extrusion', () => {
    const floor = FIXTURE_DERIVED.floors[0];
    const d = buildFloor(floor, { lift: 0.006 });
    expect(triangleCount(d)).toBe(2);
    expect(meshBounds(d).max[2]).toBeCloseTo(0.006, 9);
    expect(triangleNormal(d, FLOOR_MAT.top, 0)[2]).toBeCloseTo(1, 9);

    const slab = FIXTURE_DERIVED.floors.find((f) => f.kind === 'slab')!;
    const s = buildFloor(slab);
    const area = (5.84 - 3.56) * 3.68 - 0.8 * 0.9;
    expect(signedVolume(s)).toBeCloseTo(area * 0.17, 6);
    for (const c of triangleCentroids(s, FLOOR_MAT.top)) expect(c[0] > 4 && c[0] < 4.8 && c[1] > 0.3 && c[1] < 1.2).toBe(false);
    const inset = buildFloor(slab, { lift: 0.006, bottomInset: 0.01 });
    expect(meshBounds(inset).min[2]).toBeCloseTo(1.47 - 0.17 + 0.01, 9);
  });

  it('fills a zero-thickness floor down to the plinth top (riser at a level step)', () => {
    const floor = FIXTURE_DERIVED.floors[0];
    const filled = buildFloor(floor, { lift: 0.006, fillTo: -1 });
    expect(triangleCount(filled, FLOOR_MAT.top)).toBe(2);
    expect(triangleCount(filled, FLOOR_MAT.under)).toBe(8);
    expect(meshBounds(filled).min[2]).toBeCloseTo(-1, 9);
    expect(triangleCount(buildFloor(floor, { fillTo: 0 }))).toBe(2);
    expect(triangleCount(buildFloor(FIXTURE_DERIVED.floors[3], { fillTo: -1 }), FLOOR_MAT.under)).toBe(10);
  });

  it('builds a deck with its skirt down to the per-vertex bottoms', () => {
    const deck = FIXTURE_DERIVED.outdoor.decks[0];
    const d = buildDeck(deck);
    expect(triangleCount(d, DECK_MAT.top)).toBe(2);
    expect(triangleCount(d, DECK_MAT.side)).toBe(8 + 8);
    expect(meshBounds(d).min[2]).toBeCloseTo(-0.75, 9);
    // the skirt quad along the south edge faces south
    const south = triangleCentroids(d, DECK_MAT.side)
      .map((c, i) => ({ c, n: triangleNormal(d, DECK_MAT.side, i) }))
      .filter(({ c }) => c[1] < -2.999 && c[2] < -0.15);
    expect(south.length).toBe(2);
    for (const { n } of south) expect(n[1]).toBeCloseTo(-1, 9);
  });

  it('keeps skirt bottoms on their vertices for clockwise decks', () => {
    const deck = FIXTURE_DERIVED.outdoor.decks[0];
    const cw = { ...deck, polygon: [...deck.polygon].reverse(), skirtBottomZ: [...deck.skirtBottomZ].reverse() };
    const d = createMeshData(1);
    expect(appendDeckSkirt(d, cw.polygon, -0.15, cw.skirtBottomZ, 0)).toBe(4);
    let zAtSW = Infinity;
    for (let i = 0; i < d.positions.length; i += 3) {
      if (near(d.positions[i], -0.11) && near(d.positions[i + 1], -3)) zAtSW = Math.min(zAtSW, d.positions[i + 2]);
    }
    expect(zAtSW).toBeCloseTo(-0.75, 9);
  });

  it('skips skirt quads where the terrain is at the deck underside', () => {
    const d = createMeshData(1);
    expect(appendDeckSkirt(d, [[0, 0], [1, 0], [1, 1]], -0.15, [-0.15, -0.1, 0], 0)).toBe(0);
    expect(isEmpty(buildDeck({ ...FIXTURE_DERIVED.outdoor.decks[0], polygon: [[0, 0], [1, 0]] }))).toBe(true);
  });

  it('rotates deck boards along y by swapping the top UVs', () => {
    const deck = FIXTURE_DERIVED.outdoor.decks[0];
    const x = buildDeck(deck);
    const y = buildDeck({ ...deck, boardDirection: 'y' });
    const v = x.indices[DECK_MAT.top][0];
    expect(y.uvs[v * 2]).toBe(x.uvs[v * 2 + 1]);
  });

  it('builds a glass railing: posts, caps, bottom rails and glass panels', () => {
    const r = FIXTURE_DERIVED.outdoor.railings[0];
    const { solid, glass } = buildRailing(r);
    expect(triangleCount(solid)).toBe((5 + 2 + 2) * 12);
    expect(triangleCount(glass)).toBe(4);
    expect(meshBounds(solid).max[2]).toBeCloseTo(1.05, 9);
  });

  it('builds a board railing with slats and no glass', () => {
    const r: DerivedRailing = { ...FIXTURE_DERIVED.outdoor.railings[0], style: 'boards' };
    const { solid, glass } = buildRailing(r);
    expect(isEmpty(glass)).toBe(true);
    // panel lengths 2.11 and 3.11 with a 0.125 m pitch
    const slats = Math.floor((2.11 - 0.035) / 0.125) + Math.floor((3.11 - 0.035) / 0.125);
    expect(triangleCount(solid)).toBe((5 + 2 + slats) * 12);
  });

  it('builds steps as solid blocks', () => {
    const s = FIXTURE_DERIVED.outdoor.railings[0].steps[0];
    const d = buildSteps(s);
    expect(triangleCount(d)).toBe(3 * 10);
    expect(meshBounds(d).min[2]).toBeCloseTo(-0.75, 9);
  });
});

describe('foundations and structure', () => {
  it('builds the plinth and skirts under raised wall pieces', () => {
    const f = FIXTURE_DERIVED.foundations[0];
    const plain = buildFoundation(f);
    expect(triangleCount(plain)).toBe(8 + 2);
    const skirted = buildFoundation({ ...f, topZ: -1, bottomZ: -1.5 }, [{ footprint: fixtureWall('v-s').footprint, baseZ: 0 }, { footprint: fixtureWall('v-e').footprint, baseZ: -1 }]);
    expect(triangleCount(skirted)).toBe(8 + 2 + 8);
    expect(isEmpty(buildFoundation({ ...f, topZ: f.bottomZ }))).toBe(true);
  });

  it('builds a chimney with a cap, clipped at the cut', () => {
    const chim = FIXTURE_DERIVED.structure.find((s) => s.kind === 'chimney')!;
    const d = buildStructure(chim);
    expect(triangleCount(d, STRUCT_MAT.chimney)).toBe(12);
    expect(triangleCount(d, STRUCT_MAT.chimneyCap)).toBe(12);
    const cut = buildStructure(chim, 2);
    expect(triangleCount(cut, STRUCT_MAT.chimneyCap)).toBe(0);
    expect(meshBounds(cut).max[2]).toBeCloseTo(2, 9);
  });

  it('builds stair treads and drops those above the cut', () => {
    const stair = FIXTURE_DERIVED.structure.find((s) => s.kind === 'stair')!;
    expect(triangleCount(buildStructure(stair))).toBe(8 * 12);
    expect(triangleCount(buildStructure(stair, 0.5))).toBe(3 * 12);
  });

  it('builds posts and beams, empty when entirely above the cut', () => {
    const post = FIXTURE_DERIVED.structure.find((s) => s.kind === 'post')!;
    const beam = FIXTURE_DERIVED.structure.find((s) => s.kind === 'beam')!;
    expect(triangleCount(buildStructure(post))).toBe(12);
    expect(signedVolume(buildStructure(beam))).toBeCloseTo(5.68 * 0.12 * 0.2, 9);
    expect(isEmpty(buildStructure(beam, 1.6))).toBe(true);
  });
});

describe('terrain and conversion', () => {
  const grid = { x0: -20, y0: -20, dx: 20, dy: 20, nx: 3, ny: 3 };

  it('builds a displaced grid with upward CCW triangles', () => {
    const d = buildTerrainGrid(grid, (x, y) => 0.01 * x + 0.02 * y);
    expect(vertexCount(d)).toBe(9);
    expect(triangleCount(d)).toBe(8);
    for (let i = 0; i < 8; i++) expect(triangleNormal(d, 0, i)[2]).toBeGreaterThan(0);
    expect(meshBounds(d).max[2]).toBeCloseTo(0.6, 9);
  });

  it('skips cells inside the hole and handles negative spacing', () => {
    expect(triangleCount(buildTerrainGrid(grid, () => 0, { min: [-20, -20], max: [0, 0] }))).toBe(6);
    expect(triangleCount(buildTerrainGrid(grid, () => 0, gridExtent(grid)))).toBe(0);
    const flipped = buildTerrainGrid({ ...grid, y0: 20, dy: -20 }, () => 0);
    for (let i = 0; i < 8; i++) expect(triangleNormal(flipped, 0, i)[2]).toBeGreaterThan(0);
    expect(gridExtent({ ...grid, y0: 20, dy: -20 })).toEqual({ min: [-20, -20], max: [20, 20] });
    expect(isEmpty(buildTerrainGrid({ ...grid, nx: 1 }, () => 0))).toBe(true);
  });

  it('refines the terrain over the ground works with a patch aligned to the grid lines', () => {
    const asset = { x0: -100, y0: -100, dx: 2, dy: 2, nx: 111, ny: 101 };
    const p = terrainPatch(asset, [[[4.5, -5.1], [23.7, -5.1], [23.7, 12.6], [4.5, 12.6]], [[-0.11, -0.11], [16.11, -0.11], [16.11, 6.31], [-0.11, 6.31]]])!;
    expect(p.extent).toEqual({ min: [-2, -6], max: [24, 14] });
    expect(p.grid).toEqual({ x0: -2, y0: -6, dx: 0.25, dy: 0.25, nx: 105, ny: 81 });
    // a cut lying exactly on a grid line still gets a cut-free border one cell further out
    expect(terrainPatch(asset, [[[0, 0], [2, 0], [2, 2]]])!.extent).toEqual({ min: [-2, -2], max: [4, 4] });
    // the coarse grid skips exactly the patch's cells
    const coarse = buildTerrainGrid(asset, () => 0, p.extent);
    expect(triangleCount(coarse)).toBe(110 * 100 * 2 - 13 * 10 * 2);
  });

  it('keeps the patch within the grid and its vertex budget, and skips it when there is nothing to refine', () => {
    const asset = { x0: 0, y0: 0, dx: 2, dy: 2, nx: 11, ny: 11 };
    expect(terrainPatch(asset, [[[-50, -50], [-40, -50], [-40, -40]]])).toBeNull(); // outside the grid
    expect(terrainPatch(asset, [])).toBeNull();
    expect(terrainPatch({ ...asset, dx: -2 }, [[[1, 1], [3, 1], [3, 3]]])).toBeNull();
    expect(terrainPatch({ ...asset, dx: 0.2, dy: 0.2 }, [[[1, 1], [1.5, 1], [1.5, 1.5]]])).toBeNull(); // already fine
    const clamped = terrainPatch(asset, [[[-5, -5], [25, -5], [25, 25], [-5, 25]]])!;
    expect(clamped.extent).toEqual({ min: [0, 0], max: [20, 20] });
    const big = terrainPatch({ x0: -500, y0: -500, dx: 2, dy: 2, nx: 501, ny: 501 }, [[[-100, -100], [100, -100], [100, 100]]])!;
    expect(big.grid.nx * big.grid.ny).toBeLessThanOrEqual(TERRAIN_PATCH_MAX_VERTICES);
    expect(big.grid.dx).toBeGreaterThan(0.25);
    expect(big.grid.dx).toBeLessThan(2);
    // so big that even the asset's own cells exceed the budget: no patch
    expect(terrainPatch({ x0: -500, y0: -500, dx: 2, dy: 2, nx: 501, ny: 501 }, [[[-300, -300], [300, -300], [300, 300]]])).toBeNull();
  });

  it('builds a water rectangle facing up', () => {
    const d = buildHorizontalRect({ min: [-10, -10], max: [10, 10] }, -2.5);
    expect(triangleCount(d)).toBe(2);
    expect(triangleNormal(d, 0, 0)[2]).toBeCloseTo(1, 9);
    expect(isEmpty(buildHorizontalRect({ min: [0, 0], max: [0, 10] }, 0))).toBe(true);
  });

  it('maps to the world frame with one group per used slot', () => {
    const { data } = buildWallPieces(fixtureWall('v-s'));
    const g = toBufferGeometry(data);
    const pos = g.getAttribute('position');
    expect(pos.count).toBe(vertexCount(data));
    expect(pos.getX(0)).toBeCloseTo(data.positions[0], 6);
    expect(pos.getY(0)).toBeCloseTo(data.positions[2], 6);
    expect(pos.getZ(0)).toBeCloseTo(-data.positions[1], 6);
    expect(g.groups.map((gr) => gr.materialIndex)).toEqual([0, 1, 2]);
    expect(g.index!.count).toBe(triangleCount(data) * 3);
    g.dispose();
  });

  it('uses 32-bit indices for big meshes', () => {
    const big = buildTerrainGrid({ x0: 0, y0: 0, dx: 1, dy: 1, nx: 300, ny: 300 }, () => 0);
    const g = toBufferGeometry(big);
    expect(g.index!.array).toBeInstanceOf(Uint32Array);
    expect(g.index!.count).toBe(299 * 299 * 6);
    g.dispose();
  });
});
