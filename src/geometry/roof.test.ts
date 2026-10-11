import { describe, expect, it } from 'vitest';
import type { Block, BlockPart, Level, Roof, Variant, Vec2, Vec3 } from '../model/types';
import type { DerivedRoof } from '../model/derived';
import { createForslagDVariant } from '../model/seed/forslagD';
import { area, bbox, isCCW, pointInPolygon, unionArea } from './polygon';
import {
  buildRoof,
  buildRoofs,
  buildRoofsWithWarnings,
  combinedUndersideAt,
  ridgeExtension,
  roofParams,
  roofUndersideAt,
  roofWarnings,
} from './roof';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TAN28 = Math.tan((28 * Math.PI) / 180);

const LEVELS: Level[] = [
  { id: 'lower', name: 'Underetasje', storeyId: 'ground', elevation: -1, ceilingHeight: 2.3, floorThickness: 0 },
  { id: 'main', name: 'Hovedplan', storeyId: 'ground', elevation: 0, floorThickness: 0 },
];
const MAIN_LEVEL = LEVELS[1];

type Rect = [number, number, number, number];

function rect([x0, y0, x1, y1]: Rect): Vec2[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

function gable(over: Partial<Roof> = {}): Roof {
  return {
    type: 'gable',
    ridgeAxis: 'x',
    drive: 'pitch',
    pitchDeg: 28,
    ridgeHeight: 3.87,
    thickness: 0.31,
    overhangEave: 0.51,
    overhangGable: 0.35,
    material: 'turf',
    ...over,
  };
}

function part(id: string, r: Rect, isNew: boolean): BlockPart {
  return { id, name: id, polygon: rect(r), isNew };
}

function block(id: string, r: Rect, roof: Roof, extra: Partial<Block> = {}): Block {
  return {
    id,
    name: id,
    polygon: rect(r).map((p, i) => ({ id: `${id}-v${i}`, p })),
    levelId: 'main',
    floorZones: [],
    parts: [],
    isNew: false,
    wall: { thickness: 0.27, outerOffset: 0.11 },
    eaveHeight: 2.22,
    roof,
    junctions: [],
    ...extra,
  };
}

function variantOf(blocks: Block[]): Variant {
  return {
    id: 'v',
    name: 'test',
    createdAt: '2026-10-11T12:00:00.000Z',
    levels: LEVELS,
    blocks,
    walls: [],
    openings: [],
    rooms: [],
    furniture: [],
    outdoor: { decks: [], railings: [], hotTubs: [] },
    structure: [],
    settings: { defaultExteriorWall: { thickness: 0.27, outerOffset: 0.11 }, defaultInteriorThickness: 0.12, areaLimit: null },
  };
}

/** Forslag D blocks with the calibrated roofs (same numbers as the seed brief). */
function forslagD(): { main: Block; glass: Block; bod: Block; wing: Block; variant: Variant } {
  const main = block('main', [0, 0, 16, 6.2], gable({ ridgeAxis: 'x' }), {
    parts: [part('old', [0, 0, 12, 6.2], false), part('ext', [12, 0, 16, 6.2], true)],
  });
  const glass = block('glass', [5, -2, 9, 0], gable({ ridgeAxis: 'y', ridgeHeight: 3.28 }));
  const bod = block('bod', [5, 6.2, 9, 12.1], gable({ ridgeAxis: 'y', ridgeHeight: 3.28 }), {
    parts: [part('bod-old', [5, 6.2, 9, 10.1], false), part('bod-new', [5, 10.1, 9, 12.1], true)],
  });
  const wing = block('wing', [16, -2, 20.8, 6.2], gable({ ridgeAxis: 'y', drive: 'height', ridgeHeight: 3.87, pitchDeg: 34.5 }), {
    isNew: true,
  });
  return { main, glass, bod, wing, variant: variantOf([main, glass, bod, wing]) };
}

function plan(poly: Vec3[]): Vec2[] {
  return poly.map((p): Vec2 => [p[0], p[1]]);
}

function roofOf(roofs: DerivedRoof[], id: string): DerivedRoof {
  const r = roofs.find((x) => x.blockId === id);
  if (r === undefined) throw new Error(`no roof ${id}`);
  return r;
}

/** Every slope vertex lies on the roof's top surface (underside + thickness), within 1e-9. */
function expectOnTopSurface(roof: DerivedRoof): void {
  for (const s of roof.slopes) {
    const [nx, ny, nz] = s.normal;
    const [x0, y0, z0] = s.polygon[0];
    for (const [x, y, z] of s.polygon) {
      expect(z).toBeCloseTo(z0 - (nx * (x - x0) + ny * (y - y0)) / nz, 9);
    }
  }
}

function trimsOfKind(roof: DerivedRoof, kind: 'barge' | 'fascia'): DerivedRoof['trims'] {
  return roof.trims.filter((t) => t.kind === kind);
}

/** Fascia x-intervals (sorted) along the horizontal eave line y = yLine. */
function fasciaXs(roof: DerivedRoof, yLine: number): [number, number][] {
  return trimsOfKind(roof, 'fascia')
    .filter((t) => Math.abs(t.a[1] - yLine) < 1e-9 && Math.abs(t.b[1] - yLine) < 1e-9)
    .map((t): [number, number] => [Math.min(t.a[0], t.b[0]), Math.max(t.a[0], t.b[0])])
    .sort((p, q) => p[0] - q[0]);
}

/** Fascia y-intervals (sorted) along the vertical eave line x = xLine. */
function fasciaYs(roof: DerivedRoof, xLine: number): [number, number][] {
  return trimsOfKind(roof, 'fascia')
    .filter((t) => Math.abs(t.a[0] - xLine) < 1e-9 && Math.abs(t.b[0] - xLine) < 1e-9)
    .map((t): [number, number] => [Math.min(t.a[1], t.b[1]), Math.max(t.a[1], t.b[1])])
    .sort((p, q) => p[0] - q[0]);
}

function expectIntervals(actual: [number, number][], expected: [number, number][]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach(([a, b], i) => {
    expect(a).toBeCloseTo(expected[i][0], 6);
    expect(b).toBeCloseTo(expected[i][1], 6);
  });
}

// ---------------------------------------------------------------------------
// roofParams
// ---------------------------------------------------------------------------

describe('roofParams', () => {
  it('main block: eave 2.22, pitch 28 → ridge 3.87 at y = 3.1', () => {
    const { main } = forslagD();
    const p = roofParams(main, MAIN_LEVEL);
    expect(p.eaveZ).toBeCloseTo(2.22, 12);
    expect(p.ridgeZ).toBeCloseTo(2.22 + 3.1 * TAN28, 12);
    expect(p.ridgeZ).toBeCloseTo(3.87, 2);
    expect(p.pitchDeg).toBeCloseTo(28, 12);
    expect(p.pitchRad).toBeCloseTo((28 * Math.PI) / 180, 12);
    expect(p.halfWidth).toBeCloseTo(3.1, 12);
    expect(p.ridgeLine).toEqual({ a: [0, 3.1], b: [16, 3.1] });
  });

  it('glass bump and bod wing: ridge 3.28 from the pitch', () => {
    const { glass, bod } = forslagD();
    for (const b of [glass, bod]) {
      const p = roofParams(b, MAIN_LEVEL);
      expect(p.ridgeZ).toBeCloseTo(2.22 + 2 * TAN28, 12);
      expect(p.ridgeZ).toBeCloseTo(3.28, 2);
      expect(p.ridgeLine.a[0]).toBeCloseTo(7, 12);
      expect(p.ridgeLine.b[0]).toBeCloseTo(7, 12);
    }
  });

  it("new wing (drive 'height', ridge 3.87): pitch follows from the 4.8 m width ≈ 34.5°", () => {
    const { wing } = forslagD();
    const p = roofParams(wing, MAIN_LEVEL);
    expect(p.ridgeZ).toBeCloseTo(3.87, 12);
    expect(p.pitchDeg).toBeCloseTo((Math.atan(1.65 / 2.4) * 180) / Math.PI, 9);
    expect(p.pitchDeg).toBeCloseTo(34.5, 1);
    expect(p.ridgeLine).toEqual({ a: [18.4, -2], b: [18.4, 6.2] });
  });

  it('heights are absolute: a block on the lower level (-1.0)', () => {
    const b = block('b', [0, 0, 4, 4], gable(), { levelId: 'lower' });
    const p = roofParams(b, LEVELS[0]);
    expect(p.eaveZ).toBeCloseTo(1.22, 12);
    expect(p.ridgeZ).toBeCloseTo(1.22 + 2 * TAN28, 12);
    const h = roofParams(block('h', [0, 0, 4, 4], gable({ drive: 'height', ridgeHeight: 3.22 }), { levelId: 'lower' }), LEVELS[0]);
    expect(h.ridgeZ).toBeCloseTo(2.22, 12);
    expect(h.pitchDeg).toBeCloseTo(26.565, 2); // atan(1 / 2)
  });

  it('mono: rise over the full width, ridge line = high axis line', () => {
    const tan20 = Math.tan((20 * Math.PI) / 180);
    const s = roofParams(block('m', [0, 0, 4, 3], { ...gable(), type: 'mono', slopeTo: 'S', pitchDeg: 20 }), MAIN_LEVEL);
    expect(s.ridgeZ).toBeCloseTo(2.22 + 3 * tan20, 12);
    expect(s.halfWidth).toBeCloseTo(1.5, 12);
    expect(s.ridgeLine).toEqual({ a: [0, 3], b: [4, 3] });
    const e = roofParams(block('m', [0, 0, 4, 3], { ...gable(), type: 'mono', slopeTo: 'E', pitchDeg: 20 }), MAIN_LEVEL);
    expect(e.ridgeZ).toBeCloseTo(2.22 + 4 * tan20, 12);
    expect(e.ridgeLine).toEqual({ a: [0, 0], b: [0, 3] });
    const h = roofParams(block('m', [0, 0, 4, 3], { ...gable(), type: 'mono', slopeTo: 'N', drive: 'height', ridgeHeight: 3.72 }), MAIN_LEVEL);
    expect(h.pitchDeg).toBeCloseTo(26.565, 2); // atan(1.5 / 3)
    expect(h.ridgeLine).toEqual({ a: [0, 0], b: [4, 0] });
  });

  it('flat: ridge = eave, pitch 0', () => {
    const p = roofParams(block('f', [0, 0, 4, 3], { ...gable(), type: 'flat' }), MAIN_LEVEL);
    expect(p.ridgeZ).toBe(p.eaveZ);
    expect(p.pitchDeg).toBe(0);
  });

  it('clamps the pitch to 85° and never puts the ridge below the eave', () => {
    const steep = roofParams(block('s', [0, 0, 4, 4], gable({ pitchDeg: 120 })), MAIN_LEVEL);
    expect(steep.pitchDeg).toBeCloseTo(85, 9);
    const low = roofParams(block('l', [0, 0, 4, 4], gable({ drive: 'height', ridgeHeight: 1 })), MAIN_LEVEL);
    expect(low.ridgeZ).toBeCloseTo(2.22, 12);
    expect(low.pitchDeg).toBe(0);
    const nan = roofParams(block('n', [0, 0, 4, 4], gable({ pitchDeg: Number.NaN })), MAIN_LEVEL);
    expect(nan.pitchDeg).toBe(0);
    expect(nan.ridgeZ).toBeCloseTo(2.22, 12);
  });

  it('does not throw on a degenerate block', () => {
    const b = block('d', [0, 0, 4, 4], gable());
    b.polygon = b.polygon.slice(0, 2);
    expect(() => roofParams(b, MAIN_LEVEL)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ridgeExtension
// ---------------------------------------------------------------------------

describe('ridgeExtension (Forslag D)', () => {
  const d = forslagD();

  it('glass bump (ridge 3.28) runs north into the main roof to y ≈ 1.99', () => {
    const e = ridgeExtension(d.glass, d.variant);
    expect(Math.abs(0 + e.end - 1.99)).toBeLessThanOrEqual(0.02);
    expect(e.end).toBeCloseTo(2.0, 6); // exact: 3.1 − (3.868 − 3.283) / tan 28°
    expect(e.endFree).toBe(false);
    expect(e.start).toBe(0.35);
    expect(e.startFree).toBe(true);
    expect(e.startNoMeet || e.endNoMeet).toBe(false);
  });

  it('bod wing runs south into the main roof to y ≈ 4.21', () => {
    const e = ridgeExtension(d.bod, d.variant);
    expect(Math.abs(6.2 - e.start - 4.21)).toBeLessThanOrEqual(0.02);
    expect(e.startFree).toBe(false);
    expect(e.end).toBe(0.35);
    expect(e.endFree).toBe(true);
  });

  it("main roof (3.87) runs east to the new wing's ridge at x ≈ 18.4 (equal ridges)", () => {
    const e = ridgeExtension(d.main, d.variant);
    expect(Math.abs(16 + e.end - 18.4)).toBeLessThanOrEqual(0.02);
    expect(e.end).toBeCloseTo(2.4, 9); // snapped to the wing's ridge line
    expect(e.endFree).toBe(false);
    expect(e.start).toBe(0.35);
    expect(e.startFree).toBe(true);
  });

  it('new wing: both gable ends are free', () => {
    expect(ridgeExtension(d.wing, d.variant)).toEqual({
      start: 0.35,
      end: 0.35,
      startFree: true,
      endFree: true,
      startNoMeet: false,
      endNoMeet: false,
    });
  });

  it('matches the bundled seed (createForslagDVariant)', () => {
    const seed = createForslagDVariant();
    const byId = (id: string): Block => seed.blocks.find((b) => b.id === id)!;
    expect(Math.abs(ridgeExtension(byId('blk-glass'), seed).end - 1.99)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(6.2 - ridgeExtension(byId('blk-bod'), seed).start - 4.21)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(16 + ridgeExtension(byId('blk-main'), seed).end - 18.4)).toBeLessThanOrEqual(0.02);
    expect(roofParams(byId('blk-wing'), seed.levels[1]).pitchDeg).toBeCloseTo(34.5, 1);
    expect(roofWarnings(seed)).toEqual([]);
  });
});

describe('ridgeExtension (rules and degenerate cases)', () => {
  it('a lone block has free gables with overhangGable', () => {
    const b = block('b', [0, 0, 8, 6], gable());
    expect(ridgeExtension(b, variantOf([b]))).toMatchObject({ start: 0.35, end: 0.35, startFree: true, endFree: true });
  });

  it('honours Roof.extend overrides; an adjacent overridden end stays non-free', () => {
    const d = forslagD();
    const main = { ...d.main, roof: gable({ extend: { start: 0.8, end: 1 } }) };
    const e = ridgeExtension(main, d.variant);
    expect(e).toMatchObject({ start: 0.8, end: 1, startFree: true, endFree: false });
    const glass = { ...d.glass, roof: gable({ ridgeAxis: 'y', ridgeHeight: 3.28, extend: { end: 0 } }) };
    expect(ridgeExtension(glass, d.variant)).toMatchObject({ start: 0.35, end: 0, endFree: false });
  });

  it('adjacent but the other roof never reaches the ridge → free gable + roof-no-meet', () => {
    const high = block('high', [0, 0, 4, 8], gable({ ridgeAxis: 'y', pitchDeg: 45 })); // ridge 4.22
    const low = block('low', [4, 2, 8, 6], gable({ ridgeAxis: 'x', pitchDeg: 5 }), { eaveHeight: 1 }); // lower everywhere
    const v = variantOf([high, low]);
    const e = ridgeExtension(high, v);
    expect(e).toMatchObject({ start: 0.35, end: 0.35, startFree: true, endFree: true, startNoMeet: false, endNoMeet: false });
    // `high` runs along y; its ends are not adjacent to `low`. Turn it around so its east end touches `low`.
    const highX = block('highX', [0, 2, 4, 6], gable({ ridgeAxis: 'x', pitchDeg: 45 }));
    const v2 = variantOf([highX, low]);
    const e2 = ridgeExtension(highX, v2);
    expect(e2).toMatchObject({ end: 0.35, endFree: true, endNoMeet: true, startNoMeet: false });
    expect(roofWarnings(v2)).toEqual([{ kind: 'roof-no-meet', blockId: 'highX', end: 'end' }]);
    expect(buildRoofsWithWarnings(v2).warnings).toEqual(roofWarnings(v2));
  });

  it('collinear blocks with equal ridges meet at the shared edge (extension 0)', () => {
    const a = block('a', [0, 0, 5, 6], gable());
    const b = block('b', [5, 0, 10, 6], gable());
    const v = variantOf([a, b]);
    expect(ridgeExtension(a, v)).toMatchObject({ start: 0.35, end: 0, endFree: false, startFree: true });
    expect(ridgeExtension(b, v)).toMatchObject({ start: 0, end: 0.35, startFree: false, endFree: true });
    const roofs = buildRoofs(v);
    expect(bbox(roofOf(roofs, 'a').outline).max[0]).toBeCloseTo(5, 9);
    expect(bbox(roofOf(roofs, 'b').outline).min[0]).toBeCloseTo(5, 9);
    expect(trimsOfKind(roofOf(roofs, 'a'), 'barge')).toHaveLength(2);
  });

  it('a higher adjacent roof covers the end from the start (extension 0)', () => {
    const tall = block('tall', [0, 0, 10, 10], gable({ ridgeAxis: 'x' }), { eaveHeight: 5 });
    const small = block('small', [3, -3, 7, 0], gable({ ridgeAxis: 'y' }));
    const e = ridgeExtension(small, variantOf([tall, small]));
    expect(e).toMatchObject({ end: 0, endFree: false });
  });

  it('flat roofs: overhangEave at both ends, free; degenerate blocks do not throw', () => {
    const f = block('f', [0, 0, 4, 3], { ...gable(), type: 'flat', overhangEave: 0.4 });
    expect(ridgeExtension(f, variantOf([f]))).toMatchObject({ start: 0.4, end: 0.4, startFree: true, endFree: true });
    const deg = block('deg', [0, 0, 4, 3], gable());
    deg.polygon = [];
    expect(() => ridgeExtension(deg, variantOf([deg, f]))).not.toThrow();
  });

  it('stays fast when many adjacent ends walk the full 30 m without meeting', () => {
    // 30 one-metre blocks in a row, each roof lower than the previous one: every east end walks to the limit.
    const blocks = Array.from({ length: 30 }, (_, i) =>
      block(`b${i}`, [i, 0, i + 1, 6], gable({ pitchDeg: 40 - i }), { eaveHeight: 2.22 - 0.01 * i }),
    );
    const v = variantOf(blocks);
    const t0 = performance.now();
    const { roofs, warnings } = buildRoofsWithWarnings(v);
    const ms = performance.now() - t0;
    expect(roofs).toHaveLength(30);
    expect(warnings.filter((w) => w.kind === 'roof-no-meet')).toHaveLength(29);
    expect(ms).toBeLessThan(3000);
    // West ends walk into the higher neighbour and meet it.
    expect(ridgeExtension(blocks[5], v).startFree).toBe(false);
  });

  it('works for a block that is not (yet) in the variant', () => {
    const d = forslagD();
    const others = variantOf([d.main, d.bod, d.wing]);
    expect(ridgeExtension(d.glass, others).end).toBeCloseTo(2.0, 6);
  });
});

// ---------------------------------------------------------------------------
// buildRoofs — Forslag D
// ---------------------------------------------------------------------------

describe('buildRoofs (Forslag D)', () => {
  const d = forslagD();
  const roofs = buildRoofs(d.variant);
  const main = roofOf(roofs, 'main');
  const glass = roofOf(roofs, 'glass');
  const bod = roofOf(roofs, 'bod');
  const wing = roofOf(roofs, 'wing');

  it('returns one roof per block in block order with material and thickness', () => {
    expect(roofs.map((r) => r.blockId)).toEqual(['main', 'glass', 'bod', 'wing']);
    for (const r of roofs) {
      expect(r.material).toBe('turf');
      expect(r.thickness).toBe(0.31);
    }
  });

  it('combinedUndersideAt(16, 3.1) = 3.87 and (7, 6.2) = 3.26–3.28', () => {
    expect(combinedUndersideAt(roofs, 16, 3.1)).toBeCloseTo(3.87, 2);
    const z = combinedUndersideAt(roofs, 7, 6.2)!;
    const rounded = Math.round(z * 100) / 100;
    expect(rounded).toBeGreaterThanOrEqual(3.26);
    expect(rounded).toBeLessThanOrEqual(3.28);
  });

  it('roofUndersideAt: eave, overhang edge, ridge, correct side of the ridge, null outside', () => {
    expect(roofUndersideAt(main, 8, 0)).toBeCloseTo(2.22, 9);
    expect(roofUndersideAt(main, 8, -0.51)).toBeCloseTo(2.22 - 0.51 * TAN28, 9); // ≈ 1.95 (IFC: 1.96)
    expect(roofUndersideAt(main, 8, 3.1)).toBeCloseTo(2.22 + 3.1 * TAN28, 9);
    expect(roofUndersideAt(main, 8, 4.65)).toBeCloseTo(2.22 + 1.55 * TAN28, 9);
    expect(roofUndersideAt(main, 8, 1.55)).toBeCloseTo(2.22 + 1.55 * TAN28, 9);
    expect(roofUndersideAt(main, 8, -0.6)).toBeNull();
    expect(roofUndersideAt(main, -0.5, 3)).toBeNull();
    expect(roofUndersideAt(main, 17, 6.3)).toBeNull(); // extension clipped to the wing block (y ≤ 6.2), not its roof
    expect(roofUndersideAt(main, 17, 6.1)).toBeCloseTo(2.22 + (6.2 - 6.1) * TAN28, 9);
    expect(roofUndersideAt(wing, 18.4, 3.1)).toBeCloseTo(3.87, 9);
    expect(roofUndersideAt(glass, 7, 1.9)).toBeCloseTo(2.22 + 2 * TAN28, 9);
    expect(combinedUndersideAt(roofs, 50, 50)).toBeNull();
    expect(combinedUndersideAt([], 8, 3)).toBeNull();
  });

  it('main roof: outline with the extension clipped to the wing block (inside its walls)', () => {
    const bb = bbox(main.outline);
    expect(bb.min[0]).toBeCloseTo(-0.35, 9);
    expect(bb.max[0]).toBeCloseTo(18.4, 9);
    expect(bb.min[1]).toBeCloseTo(-0.51, 9);
    expect(bb.max[1]).toBeCloseTo(6.71, 9);
    expect(isCCW(main.outline)).toBe(true);
    expect(main.outline).toHaveLength(6);
    expect(area(main.outline)).toBeCloseTo(16.35 * 7.22 + 2.4 * 6.71, 6);
    expect(pointInPolygon([17, 6.55], main.outline)).toBe(false); // under the wing's gable overhang, outside its wall
    expect(pointInPolygon([17, 6.15], main.outline)).toBe(true);
  });

  it('main roof: slopes split at x = 12 (existing / new), > 4 points where clipped, on the top surface', () => {
    expect(main.slopes.map((s) => [s.facing, s.isNew])).toEqual([
      ['S', false],
      ['S', true],
      ['N', false],
      ['N', true],
    ]);
    const [sOld, sNew, nOld, nNew] = main.slopes.map((s) => plan(s.polygon));
    expect(bbox(sOld)).toEqual({ min: [-0.35, -0.51], max: [12, 3.1] });
    expect(bbox(sNew).min[0]).toBeCloseTo(12, 9);
    expect(bbox(sNew).max[0]).toBeCloseTo(18.4, 9);
    expect(bbox(nOld).max[1]).toBeCloseTo(6.71, 9);
    expect(nNew.length).toBeGreaterThan(4);
    for (const s of main.slopes) expect(isCCW(plan(s.polygon))).toBe(true);
    const slopeArea = main.slopes.reduce((acc, s) => acc + area(plan(s.polygon)), 0);
    expect(slopeArea).toBeCloseTo(area(main.outline), 6);
    expectOnTopSurface(main);
    const eaveCorner = main.slopes[0].polygon.find((p) => Math.abs(p[1] + 0.51) < 1e-9)!;
    expect(eaveCorner[2]).toBeCloseTo(2.22 - 0.51 * TAN28 + 0.31, 9);
  });

  it('slope normals point up and down-slope', () => {
    const s = main.slopes[0].normal;
    expect(s[0]).toBeCloseTo(0, 12);
    expect(s[1]).toBeCloseTo(-Math.sin((28 * Math.PI) / 180), 9);
    expect(s[2]).toBeCloseTo(Math.cos((28 * Math.PI) / 180), 9);
    expect(main.slopes[2].normal[1]).toBeGreaterThan(0);
    expect(glass.slopes.map((x) => x.facing)).toEqual(['W', 'E']);
    expect(glass.slopes[0].normal[0]).toBeLessThan(0);
    expect(wing.slopes[1].normal[0]).toBeCloseTo(Math.sin(Math.atan(1.65 / 2.4)), 9);
  });

  it('ridge lines at the underside, including the extensions', () => {
    expect(main.ridge!.a).toEqual([-0.35, 3.1, expect.closeTo(2.22 + 3.1 * TAN28, 9)]);
    expect(main.ridge!.b[0]).toBeCloseTo(18.4, 9);
    expect(glass.ridge!.b[1]).toBeCloseTo(2.0, 6);
    expect(glass.ridge!.a[1]).toBeCloseTo(-2.35, 9);
    expect(bod.ridge!.a[1]).toBeCloseTo(4.2, 6);
    expect(wing.ridge!.a).toEqual([18.4, -2.35, 3.87]);
  });

  it('glass bump and bod wing: extended slabs inside the main roof, bod split at y = 10.1', () => {
    expect(bbox(glass.outline)).toEqual({ min: [4.49, -2.35], max: [9.51, expect.closeTo(2.0, 6)] });
    expect(glass.slopes).toHaveLength(2);
    expect(glass.slopes.every((s) => !s.isNew)).toBe(true);
    expect(bbox(bod.outline).min[1]).toBeCloseTo(4.2, 6);
    expect(bbox(bod.outline).max[1]).toBeCloseTo(12.45, 9);
    expect(bod.slopes.map((s) => [s.facing, s.isNew])).toEqual([
      ['W', false],
      ['W', true],
      ['E', false],
      ['E', true],
    ]);
    expect(bbox(plan(bod.slopes[1].polygon)).min[1]).toBeCloseTo(10.1, 9);
    expect(wing.slopes.every((s) => s.isNew)).toBe(true);
    for (const r of roofs) expectOnTopSurface(r);
  });

  it('barge boards on free gable ends only', () => {
    const barges = (r: DerivedRoof): DerivedRoof['trims'] => trimsOfKind(r, 'barge');
    expect(barges(main)).toHaveLength(2);
    expect(barges(main).every((t) => t.a[0] === -0.35 && t.b[0] === -0.35)).toBe(true);
    expect(barges(glass)).toHaveLength(2);
    expect(barges(glass).every((t) => t.a[1] === -2.35)).toBe(true);
    expect(barges(bod)).toHaveLength(2);
    expect(barges(bod).every((t) => Math.abs(t.a[1] - 12.45) < 1e-9)).toBe(true);
    expect(barges(wing)).toHaveLength(4);
    const b = barges(main)[0];
    expect(Math.max(b.a[2], b.b[2])).toBeCloseTo(2.22 + 3.1 * TAN28 + 0.31, 9);
    expect(Math.min(b.a[2], b.b[2])).toBeCloseTo(2.22 - 0.51 * TAN28 + 0.31, 9);
  });

  it('fascias only on eave segments outside the other roofs', () => {
    expectIntervals(fasciaXs(main, -0.51), [
      [-0.35, 4.49],
      [9.51, 15.49],
    ]);
    expectIntervals(fasciaXs(main, 6.71), [
      [-0.35, 4.49],
      [9.51, 16],
    ]);
    expectIntervals(fasciaYs(glass, 4.49), [[-2.35, -0.51]]);
    expectIntervals(fasciaYs(glass, 9.51), [[-2.35, -0.51]]);
    expectIntervals(fasciaYs(bod, 4.49), [[6.71, 12.45]]);
    expectIntervals(fasciaYs(wing, 15.49), [[-2.35, -0.51]]);
    expectIntervals(fasciaYs(wing, 21.31), [[-2.35, 6.55]]);
    const f = fasciaXs(main, -0.51);
    expect(f).toHaveLength(2);
    const t = trimsOfKind(main, 'fascia')[0];
    expect(t.a[2]).toBeCloseTo(2.22 - 0.51 * TAN28 + 0.31, 9);
    expect(t.b[2]).toBeCloseTo(t.a[2], 12);
  });

  it('buildRoof for one block equals its entry in buildRoofs', () => {
    expect(buildRoof(d.glass, d.variant, [])).toEqual(glass);
    expect(buildRoof(d.main, d.variant, [])).toEqual(main);
  });

  it('the seed variant builds the same roofs', () => {
    const seed = createForslagDVariant();
    const seedRoofs = buildRoofs(seed, []);
    expect(seedRoofs).toHaveLength(4);
    expect(combinedUndersideAt(seedRoofs, 16, 3.1)).toBeCloseTo(3.87, 2);
    expect(Math.round(combinedUndersideAt(seedRoofs, 7, 6.2)! * 100) / 100).toBeLessThanOrEqual(3.28);
    expect(bbox(roofOf(seedRoofs, 'blk-main').outline).max[0]).toBeCloseTo(18.4, 9);
  });
});

// ---------------------------------------------------------------------------
// buildRoof — other roof types and degenerate input
// ---------------------------------------------------------------------------

describe('buildRoof (types and edge cases)', () => {
  it('a lone gable: two 4-point slopes, 4 barge boards, 2 fascias, rectangular outline', () => {
    const b = block('b', [0, 0, 8, 6], gable());
    const r = buildRoof(b, variantOf([b]), []);
    expect(r.slopes).toHaveLength(2);
    expect(r.slopes.every((s) => s.polygon.length === 4 && !s.isNew)).toBe(true);
    expect(trimsOfKind(r, 'barge')).toHaveLength(4);
    expect(trimsOfKind(r, 'fascia')).toHaveLength(2);
    expect(area(r.outline)).toBeCloseTo(8.7 * 7.02, 9);
    expect(r.ridge!.a[2]).toBeCloseTo(2.22 + 3 * TAN28, 9);
  });

  it('ridgeAxis y, isNew block', () => {
    const b = block('b', [0, 0, 6, 8], gable({ ridgeAxis: 'y' }), { isNew: true });
    const r = buildRoof(b, variantOf([b]), []);
    expect(r.slopes.map((s) => s.facing)).toEqual(['W', 'E']);
    expect(r.slopes.every((s) => s.isNew)).toBe(true);
    expect(r.ridge!.a).toEqual([3, -0.35, expect.closeTo(2.22 + 3 * TAN28, 9)]);
    expect(roofUndersideAt(r, 1, 4)).toBeCloseTo(2.22 + TAN28, 9);
    expect(roofUndersideAt(r, 5, 4)).toBeCloseTo(2.22 + TAN28, 9);
  });

  it('mono roof: one slope down to slopeTo, fascias on the low and high edges', () => {
    const tan20 = Math.tan((20 * Math.PI) / 180);
    const b = block('m', [0, 0, 4, 3], { ...gable(), type: 'mono', slopeTo: 'S', pitchDeg: 20 });
    const r = buildRoof(b, variantOf([b]), []);
    expect(r.slopes).toHaveLength(1);
    expect(r.slopes[0].facing).toBe('S');
    expect(r.slopes[0].normal[1]).toBeLessThan(0);
    expect(r.ridge).toBeUndefined();
    expect(roofUndersideAt(r, 2, 0)).toBeCloseTo(2.22, 9);
    expect(roofUndersideAt(r, 2, 3)).toBeCloseTo(2.22 + 3 * tan20, 9);
    expect(trimsOfKind(r, 'fascia')).toHaveLength(2);
    expect(trimsOfKind(r, 'barge')).toHaveLength(2);
    expectOnTopSurface(r);
    const w = buildRoof(block('w', [0, 0, 4, 3], { ...gable(), type: 'mono', slopeTo: 'W', pitchDeg: 20 }), variantOf([]), []);
    expect(w.slopes[0].facing).toBe('W');
    expect(roofUndersideAt(w, 0, 1)).toBeCloseTo(2.22, 9);
    expect(roofUndersideAt(w, 4, 1)).toBeCloseTo(2.22 + 4 * tan20, 9);
  });

  it('flat roof: constant underside, overhangEave all round, fascias on all sides', () => {
    const b = block('f', [0, 0, 4, 3], { ...gable(), type: 'flat', overhangEave: 0.3 });
    const r = buildRoof(b, variantOf([b]), []);
    expect(r.slopes).toHaveLength(1);
    expect(r.slopes[0].normal).toEqual([0, 0, 1]);
    expect(bbox(r.outline)).toEqual({ min: [-0.3, -0.3], max: [4.3, 3.3] });
    expect(roofUndersideAt(r, 1, 1)).toBeCloseTo(2.22, 12);
    expect(roofUndersideAt(r, 4.3, 3.3)).toBeCloseTo(2.22, 12);
    expect(trimsOfKind(r, 'fascia')).toHaveLength(4);
    expect(trimsOfKind(r, 'barge')).toHaveLength(0);
    expect(r.slopes[0].polygon.every((p) => Math.abs(p[2] - 2.53) < 1e-12)).toBe(true);
  });

  it('degenerate blocks give an empty roof and never throw', () => {
    const d = block('d', [0, 0, 4, 3], gable());
    d.polygon = d.polygon.slice(0, 2);
    const flatLine = block('l', [0, 0, 4, 0], gable());
    const ok = block('ok', [10, 0, 14, 3], gable());
    const roofs = buildRoofs(variantOf([d, flatLine, ok]));
    expect(roofs).toHaveLength(3);
    expect(roofs[0]).toEqual({ blockId: 'd', material: 'turf', thickness: 0.31, slopes: [], trims: [], outline: [] });
    expect(roofs[1].slopes).toEqual([]);
    expect(roofUndersideAt(roofs[0], 0, 0)).toBeNull();
    expect(roofs[2].slopes).toHaveLength(2);
  });

  it('override on an adjacent end: strip clipped to the other block, no barge board there', () => {
    const big = block('big', [0, 0, 10, 10], gable({ ridgeAxis: 'x' }));
    const bump = block('bump', [3, -3, 7, 0], gable({ ridgeAxis: 'y', extend: { end: 20 } }));
    const r = roofOf(buildRoofs(variantOf([big, bump])), 'bump');
    expect(bbox(r.outline).max[1]).toBeCloseTo(10, 9); // clipped at the big block's north wall line
    expect(trimsOfKind(r, 'barge')).toHaveLength(2); // only the free south end
  });

  it('parts: a part inside the block splits the slopes into hole-free pieces without overlap', () => {
    const b = block('b', [0, 0, 10, 6], gable(), { parts: [part('mid', [4, 1, 6, 2], true)] });
    const r = buildRoof(b, variantOf([b]), []);
    const south = r.slopes.filter((s) => s.facing === 'S');
    const southArea = 10.7 * (3 + 0.51);
    const pieces = south.map((s) => plan(s.polygon));
    expect(pieces.reduce((acc, p) => acc + area(p), 0)).toBeCloseTo(southArea, 6);
    expect(unionArea(pieces)).toBeCloseTo(southArea, 6);
    const newArea = south.filter((s) => s.isNew).reduce((acc, s) => acc + area(plan(s.polygon)), 0);
    expect(newArea).toBeCloseTo(2, 6);
    expect(south.filter((s) => !s.isNew).length).toBeGreaterThanOrEqual(2); // cut around the hole
    expect(r.slopes.filter((s) => s.facing === 'N').every((s) => !s.isNew)).toBe(true);
  });

  it('parts: overhangs follow the part they continue; overlapping parts and the remainder never double-cover', () => {
    const b = block('b', [0, 0, 10, 6], gable(), {
      isNew: true,
      parts: [part('a', [0, 0, 6, 6], false), part('b', [4, 0, 8, 6], false)],
    });
    const r = buildRoof(b, variantOf([b]), []);
    const all = r.slopes.map((s) => plan(s.polygon));
    const total = all.reduce((acc, p) => acc + area(p), 0);
    expect(total).toBeCloseTo(area(r.outline), 6);
    expect(unionArea(all)).toBeCloseTo(total, 6);
    const newPieces = r.slopes.filter((s) => s.isNew).map((s) => bbox(plan(s.polygon)));
    expect(newPieces).toHaveLength(2);
    for (const bb of newPieces) {
      expect(bb.min[0]).toBeCloseTo(8, 9);
      expect(bb.max[0]).toBeCloseTo(10.35, 9);
    }
    const oldPieces = r.slopes.filter((s) => !s.isNew).map((s) => bbox(plan(s.polygon)));
    for (const bb of oldPieces) expect(bb.min[0]).toBeCloseTo(-0.35, 9);
  });
});
