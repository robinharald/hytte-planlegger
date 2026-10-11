import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../model/types';
import {
  EPS,
  area,
  bbox,
  centroid,
  collinearOverlap,
  differencePolygons,
  distancePointSegment,
  ensureCCW,
  fnv1a,
  intersectPolygons,
  isCCW,
  labelPoint,
  lineIntersection,
  multiPolygonArea,
  offsetPolygon,
  offsetPolygonPerEdge,
  pointInPolygon,
  projectPointOnSegment,
  rectDims,
  segmentIntersection,
  signedArea,
  simplifyCollinear,
  unionArea,
  unionPolygons,
} from './polygon';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const square = rect(0, 0, 2, 2);
const squareCW: Vec2[] = [...square].reverse();
/** 4×4 square with the top-right 2×2 notch removed: area 12, perimeter 16, 5 convex + 1 reflex corner. */
const lShape: Vec2[] = [
  [0, 0],
  [4, 0],
  [4, 2],
  [2, 2],
  [2, 4],
  [0, 4],
];
/** U-shape (6×4 with a 2×3 slot from the top): the bbox centre (3, 2) is outside. */
const uShape: Vec2[] = [
  [0, 0],
  [6, 0],
  [6, 4],
  [4, 4],
  [4, 1],
  [2, 1],
  [2, 4],
  [0, 4],
];

const closeTo = (p: Vec2, q: Vec2, tol = 1e-9) => {
  expect(p[0]).toBeCloseTo(q[0], -Math.log10(tol));
  expect(p[1]).toBeCloseTo(q[1], -Math.log10(tol));
};
const allFinite = (poly: Vec2[]) => poly.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
const noDuplicates = (poly: Vec2[]) =>
  poly.every((p, i) => Math.hypot(p[0] - poly[(i + 1) % poly.length][0], p[1] - poly[(i + 1) % poly.length][1]) > EPS);

// ---------------------------------------------------------------------------
// Area, orientation, centroid, bbox
// ---------------------------------------------------------------------------

describe('signedArea / area / isCCW / ensureCCW', () => {
  it('signs by orientation', () => {
    expect(signedArea(square)).toBe(4);
    expect(signedArea(squareCW)).toBe(-4);
    expect(area(squareCW)).toBe(4);
    expect(isCCW(square)).toBe(true);
    expect(isCCW(squareCW)).toBe(false);
    expect(area(lShape)).toBe(12);
    expect(area(uShape)).toBe(18);
  });

  it('is 0 for degenerate input', () => {
    expect(signedArea([])).toBe(0);
    expect(signedArea([[1, 1]])).toBe(0);
    expect(signedArea([[0, 0], [1, 1]])).toBe(0);
    expect(isCCW([[0, 0], [1, 0], [2, 0]])).toBe(false);
  });

  it('ensureCCW returns the same array for CCW input and a reversed copy for CW input', () => {
    expect(ensureCCW(square)).toBe(square);
    const fixed = ensureCCW(squareCW);
    expect(fixed).not.toBe(squareCW);
    expect(isCCW(fixed)).toBe(true);
    expect(fixed).toEqual(square);
    expect(squareCW[0]).toEqual([0, 2]); // input untouched
  });
});

describe('centroid', () => {
  it('finds the centre of symmetric shapes', () => {
    closeTo(centroid(square), [1, 1]);
    closeTo(centroid(squareCW), [1, 1]);
    closeTo(centroid(rect(1, 2, 4, 4)), [2.5, 3]);
    closeTo(centroid([[0, 0], [3, 0], [0, 3]]), [1, 1]);
  });

  it('falls back to the vertex mean for degenerate input', () => {
    closeTo(centroid([[0, 0], [2, 0], [4, 0]]), [2, 0]);
    expect(centroid([])).toEqual([0, 0]);
    expect(centroid([[3, 4]])).toEqual([3, 4]);
  });
});

describe('bbox', () => {
  it('spans the extremes', () => {
    expect(bbox(lShape)).toEqual({ min: [0, 0], max: [4, 4] });
    expect(bbox([[-1, 5], [3, -2]])).toEqual({ min: [-1, -2], max: [3, 5] });
  });
  it('is zero for no points', () => {
    expect(bbox([])).toEqual({ min: [0, 0], max: [0, 0] });
  });
});

// ---------------------------------------------------------------------------
// pointInPolygon
// ---------------------------------------------------------------------------

describe('pointInPolygon', () => {
  it('classifies interior and exterior points', () => {
    expect(pointInPolygon([1, 1], square)).toBe(true);
    expect(pointInPolygon([1, 1], squareCW)).toBe(true);
    expect(pointInPolygon([3, 1], square)).toBe(false);
    expect(pointInPolygon([-1, 0], square)).toBe(false); // at a vertex height, outside
    expect(pointInPolygon([3, 2], square)).toBe(false);
    expect(pointInPolygon([3, 3], lShape)).toBe(false); // in the notch
    expect(pointInPolygon([1, 3], lShape)).toBe(true);
    expect(pointInPolygon([3, 2], uShape)).toBe(false); // in the slot
    expect(pointInPolygon([3, 0.5], uShape)).toBe(true);
    expect(pointInPolygon([5, 3], uShape)).toBe(true);
  });

  it('counts the boundary as inside', () => {
    expect(pointInPolygon([2, 1], square)).toBe(true); // on an edge
    expect(pointInPolygon([0, 0], square)).toBe(true); // on a vertex
    expect(pointInPolygon([2, 2], square)).toBe(true);
    expect(pointInPolygon([1, 0], square)).toBe(true); // on the bottom edge (ray through a vertex row)
    expect(pointInPolygon([2, 2], lShape)).toBe(true); // reflex vertex
    expect(pointInPolygon([2 + 5e-10, 1], square)).toBe(true); // within tolerance
    expect(pointInPolygon([2 + 1e-6, 1], square)).toBe(false); // outside the tolerance
  });

  it('handles a repeated closing point and degenerate input', () => {
    expect(pointInPolygon([1, 1], [...square, [0, 0]])).toBe(true);
    expect(pointInPolygon([0, 0], [])).toBe(false);
    expect(pointInPolygon([0.5, 0], [[0, 0], [1, 0]])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// offsetPolygon
// ---------------------------------------------------------------------------

describe('offsetPolygon', () => {
  it('grows a 2×3 CCW rectangle by 0.1 to 2.2×3.2', () => {
    const out = offsetPolygon(rect(0, 0, 2, 3), 0.1);
    expect(out).toHaveLength(4);
    expect(isCCW(out)).toBe(true);
    expect(area(out)).toBeCloseTo(2.2 * 3.2, 9);
    expect(bbox(out).min).toEqual([-0.1, -0.1]);
    expect(bbox(out).max).toEqual([2.1, 3.1]);
  });

  it('shrinks with a negative distance', () => {
    const out = offsetPolygon(rect(0, 0, 2, 3), -0.1);
    expect(area(out)).toBeCloseTo(1.8 * 2.8, 9);
    closeTo(bbox(out).min, [0.1, 0.1]);
    closeTo(bbox(out).max, [1.9, 2.9]);
  });

  it('treats d > 0 as outward for CW input too and returns CCW', () => {
    const out = offsetPolygon([...rect(0, 0, 2, 3)].reverse(), 0.1);
    expect(isCCW(out)).toBe(true);
    expect(area(out)).toBeCloseTo(7.04, 9);
  });

  it('mitres convex and reflex corners of an L-shape', () => {
    // A + P·d + (convex − reflex)·d² for mitred right angles.
    const d = 0.1;
    const out = offsetPolygon(lShape, d);
    expect(out).toHaveLength(6);
    expect(area(out)).toBeCloseTo(12 + 16 * d + 4 * d * d, 9);
    expect(out).toContainEqual([-0.1, -0.1]);
    closeTo(out[3], [2.1, 2.1]); // reflex corner moves diagonally into the notch
    const inward = offsetPolygon(lShape, -d);
    expect(area(inward)).toBeCloseTo(12 - 16 * d + 4 * d * d, 9);
    closeTo(inward[3], [1.9, 1.9]);
  });

  it('mitres a right isosceles triangle (45° corners stay below the mitre limit)', () => {
    const d = 0.1;
    const out = offsetPolygon([[0, 0], [1, 0], [0, 1]], d);
    expect(out).toHaveLength(3);
    const perimeter = 2 + Math.SQRT2;
    const cornerSum = 1 + 2 / Math.tan(Math.PI / 8); // Σ cot(θ/2)
    expect(area(out)).toBeCloseTo(0.5 + perimeter * d + cornerSum * d * d, 9);
  });

  it('bevels a very sharp corner instead of a far mitre tip', () => {
    const d = 0.1;
    const sharp: Vec2[] = [[0, 0], [10, 0], [0, 0.5]]; // ~2.9° at (10, 0)
    const out = offsetPolygon(sharp, d);
    expect(out).toHaveLength(4);
    expect(isCCW(out)).toBe(true);
    const nearTip = out.filter((p) => p[0] > 9);
    expect(nearTip).toHaveLength(2); // the two offset endpoints, not one far mitre tip
    const far = Math.max(...nearTip.map((p) => Math.hypot(p[0] - 10, p[1])));
    expect(far).toBeLessThanOrEqual(4 * d + 1e-9);
    expect(far).toBeGreaterThan(d); // but still outside the original vertex
    for (const p of sharp) expect(pointInPolygon(p, out)).toBe(true);
  });

  it('keeps collinear vertices and ignores duplicates and a closing point', () => {
    const withMid: Vec2[] = [[0, 0], [1, 0], [2, 0], [2, 2], [0, 2]];
    const out = offsetPolygon(withMid, 0.1);
    expect(out).toHaveLength(5);
    expect(area(out)).toBeCloseTo(2.2 * 2.2, 9);
    expect(noDuplicates(out)).toBe(true);

    const dup: Vec2[] = [[0, 0], [2, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
    const out2 = offsetPolygon(dup, 0.1);
    expect(out2).toHaveLength(4);
    expect(area(out2)).toBeCloseTo(4.84, 9);
  });

  it('is the identity for d = 0 and empty for degenerate input', () => {
    expect(offsetPolygon(square, 0)).toEqual(square);
    expect(offsetPolygon([], 0.1)).toEqual([]);
    expect(offsetPolygon([[0, 0], [1, 0]], 0.1)).toEqual([]);
    expect(offsetPolygon([[0, 0], [1, 0], [1, 0]], 0.1)).toEqual([]);
  });

  it('never produces NaN for a polygon with a spike (180° turn)', () => {
    const spike: Vec2[] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [2, 2], [0, 2]];
    const out = offsetPolygon(spike, 0.1);
    expect(allFinite(out)).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// offsetPolygonPerEdge
// ---------------------------------------------------------------------------

describe('offsetPolygonPerEdge', () => {
  it('keeps vertex correspondence for a rectilinear block with one zero edge', () => {
    const block = rect(0, 0, 16, 6.2);
    const out = offsetPolygonPerEdge(block, [0.11, 0.11, 0.11, 0]);
    expect(out).toHaveLength(4);
    closeTo(out[0], [0, -0.11]);
    closeTo(out[1], [16.11, -0.11]);
    closeTo(out[2], [16.11, 6.31]);
    closeTo(out[3], [0, 6.31]);
    expect(isCCW(out)).toBe(true);
  });

  it('offsets inward with negative distances', () => {
    const out = offsetPolygonPerEdge(rect(0, 0, 16, 6.2), [-0.16, -0.16, -0.16, -0.16]);
    closeTo(out[0], [0.16, 0.16]);
    closeTo(out[2], [15.84, 6.04]);
    expect(area(out)).toBeCloseTo((16 - 0.32) * (6.2 - 0.32), 9);
  });

  it('inserts a step between collinear edges with different distances', () => {
    const poly: Vec2[] = [[0, 0], [8, 0], [16, 0], [16, 6], [0, 6]];
    const out = offsetPolygonPerEdge(poly, [0.11, 0, 0.11, 0.11, 0.11]);
    expect(allFinite(out)).toBe(true);
    expect(out).toHaveLength(6);
    closeTo(out[0], [-0.11, -0.11]);
    closeTo(out[1], [8, -0.11]);
    closeTo(out[2], [8, 0]);
    closeTo(out[3], [16.11, 0]);
    closeTo(out[4], [16.11, 6.11]);
    closeTo(out[5], [-0.11, 6.11]);
    // full offset rectangle minus the strip under the zero-offset edge (x from 8 to 16.11)
    expect(area(out)).toBeCloseTo(16.22 * 6.22 - 8.11 * 0.11, 9);
  });

  it('merges collinear edges with equal distances into one offset vertex', () => {
    const poly: Vec2[] = [[0, 0], [8, 0], [16, 0], [16, 6], [0, 6]];
    const out = offsetPolygonPerEdge(poly, [0.1, 0.1, 0.1, 0.1, 0.1]);
    expect(out).toHaveLength(5);
    closeTo(out[1], [8, -0.1]);
    expect(area(out)).toBeCloseTo(16.2 * 6.2, 9);
  });

  it('handles opposite-direction (spike) edges without NaN', () => {
    const spike: Vec2[] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [2, 2], [0, 2]];
    const out = offsetPolygonPerEdge(spike, [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
    expect(allFinite(out)).toBe(true);
    expect(out.length).toBeGreaterThan(spike.length);
    // the spike tip (2, 4) gets both offset endpoints: (2.1, 4) and (1.9, 4)
    expect(out.some((p) => Math.abs(p[0] - 2.1) < 1e-9 && Math.abs(p[1] - 4) < 1e-9)).toBe(true);
    expect(out.some((p) => Math.abs(p[0] - 1.9) < 1e-9 && Math.abs(p[1] - 4) < 1e-9)).toBe(true);
  });

  it('bevels an extreme spike with differing distances (no far mitre tip)', () => {
    const sharp: Vec2[] = [[0, 0], [10, 0], [0, 0.5]];
    const out = offsetPolygonPerEdge(sharp, [0.11, 0, 0.11]);
    expect(allFinite(out)).toBe(true);
    for (const p of out) expect(Math.hypot(p[0] - 10, p[1])).toBeLessThan(11);
  });

  it('keeps "outward" outward for CW input and keeps its orientation', () => {
    const out = offsetPolygonPerEdge(squareCW, [0.1, 0.1, 0.1, 0.1]);
    expect(isCCW(out)).toBe(false);
    expect(area(out)).toBeCloseTo(2.2 * 2.2, 9);
    expect(bbox(out).min[0]).toBeCloseTo(-0.1, 9);
  });

  it('treats missing or non-finite distances as 0 and skips zero-length edges', () => {
    const out = offsetPolygonPerEdge(square, [0.1]);
    closeTo(out[0], [0, -0.1]);
    closeTo(out[1], [2, -0.1]);
    closeTo(out[2], [2, 2]);
    closeTo(out[3], [0, 2]);
    const nan = offsetPolygonPerEdge(square, [Number.NaN, 0.1, Number.POSITIVE_INFINITY, 0.1]);
    expect(allFinite(nan)).toBe(true);
    expect(area(nan)).toBeCloseTo(2 * 2.2, 9);
    // zero-length edge at index 1 keeps the later indices aligned
    const dup: Vec2[] = [[0, 0], [2, 0], [2, 0], [2, 2], [0, 2]];
    const out2 = offsetPolygonPerEdge(dup, [0.1, 99, 0, 0, 0]);
    expect(area(out2)).toBeCloseTo(2 * 2.1, 9);
  });

  it('returns [] for fewer than 3 distinct vertices', () => {
    expect(offsetPolygonPerEdge([], [])).toEqual([]);
    expect(offsetPolygonPerEdge([[0, 0], [1, 0]], [0.1, 0.1])).toEqual([]);
    expect(offsetPolygonPerEdge([[0, 0], [1, 0], [1, 0], [0, 0]], [0.1, 0.1, 0.1, 0.1])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Boolean operations
// ---------------------------------------------------------------------------

describe('unionPolygons / unionArea', () => {
  it('merges overlapping squares', () => {
    const mp = unionPolygons([square, rect(1, 1, 3, 3)]);
    expect(mp).toHaveLength(1);
    expect(mp[0]).toHaveLength(1);
    expect(isCCW(mp[0][0])).toBe(true);
    expect(mp[0][0]).toHaveLength(8);
    expect(unionArea([square, rect(1, 1, 3, 3)])).toBeCloseTo(7, 9);
  });

  it('merges adjacent squares into one polygon', () => {
    const mp = unionPolygons([square, rect(2, 0, 4, 2)]);
    expect(mp).toHaveLength(1);
    expect(multiPolygonArea(mp)).toBeCloseTo(8, 9);
    expect(unionArea([square, rect(2, 0, 4, 2)])).toBeCloseTo(8, 9);
  });

  it('keeps disjoint squares apart', () => {
    const mp = unionPolygons([square, rect(5, 5, 7, 7)]);
    expect(mp).toHaveLength(2);
    expect(unionArea([square, rect(5, 5, 7, 7)])).toBeCloseTo(8, 9);
  });

  it('produces a hole from a frame of rectangles', () => {
    const frame = [rect(0, 0, 6, 1), rect(5, 0, 6, 6), rect(0, 5, 6, 6), rect(0, 0, 1, 6)];
    const mp = unionPolygons(frame);
    expect(mp).toHaveLength(1);
    expect(mp[0]).toHaveLength(2); // outer + hole
    expect(isCCW(mp[0][0])).toBe(true);
    expect(isCCW(mp[0][1])).toBe(false);
    expect(area(mp[0][1])).toBeCloseTo(16, 9);
    expect(unionArea(frame)).toBeCloseTo(36 - 16, 9);
  });

  it('rings are open (no repeated closing point)', () => {
    const [[ring]] = unionPolygons([square]);
    expect(ring).toHaveLength(4);
    expect(ring[0]).not.toEqual(ring[ring.length - 1]);
    expect(area(ring)).toBe(4);
  });

  it('never throws on empty or degenerate input', () => {
    expect(unionPolygons([])).toEqual([]);
    expect(unionArea([])).toBe(0);
    expect(unionPolygons([[], [[0, 0]], [[0, 0], [1, 1]]])).toEqual([]);
    expect(unionArea([[[0, 0], [1, 0], [1, 0]]])).toBe(0);
  });

  it('accepts a CW input polygon', () => {
    expect(unionArea([squareCW])).toBe(4);
  });
});

describe('intersectPolygons', () => {
  it('clips overlapping squares', () => {
    const mp = intersectPolygons([square], [rect(1, 1, 3, 3)]);
    expect(mp).toHaveLength(1);
    expect(multiPolygonArea(mp)).toBeCloseTo(1, 9);
    expect(bbox(mp[0][0])).toEqual({ min: [1, 1], max: [2, 2] });
  });

  it('treats each side as the union of its polygons', () => {
    const mp = intersectPolygons([square, rect(1, 1, 3, 3)], [rect(0, 0, 10, 10)]);
    expect(multiPolygonArea(mp)).toBeCloseTo(7, 9);
  });

  it('is empty for disjoint or empty input', () => {
    expect(intersectPolygons([square], [rect(5, 5, 6, 6)])).toEqual([]);
    expect(intersectPolygons([], [square])).toEqual([]);
    expect(intersectPolygons([square], [])).toEqual([]);
    expect(intersectPolygons([[[0, 0], [1, 0]]], [square])).toEqual([]);
  });

  it('clips a part polygon to a block (the derive use case)', () => {
    const block = rect(0, 0, 16, 6.2);
    const part = rect(12, -1, 20, 7);
    const mp = intersectPolygons([part], [block]);
    expect(multiPolygonArea(mp)).toBeCloseTo(4 * 6.2, 9);
  });
});

describe('differencePolygons', () => {
  it('cuts a hole', () => {
    const mp = differencePolygons([square], [rect(0.5, 0.5, 1.5, 1.5)]);
    expect(mp).toHaveLength(1);
    expect(mp[0]).toHaveLength(2);
    expect(multiPolygonArea(mp)).toBeCloseTo(3, 9);
  });

  it('subtracts the union of several clips (wall footprints around a face)', () => {
    const face = rect(0, 0, 4, 3);
    const walls = [rect(-0.1, -0.1, 4.1, 0.1), rect(3.9, -0.1, 4.1, 3.1), rect(-0.1, 2.9, 4.1, 3.1), rect(-0.1, -0.1, 0.1, 3.1)];
    const mp = differencePolygons([face], walls);
    expect(mp).toHaveLength(1);
    expect(multiPolygonArea(mp)).toBeCloseTo(3.8 * 2.8, 9);
    expect(bbox(mp[0][0])).toEqual({ min: [0.1, 0.1], max: [3.9, 2.9] });
  });

  it('returns the normalised subject when b is empty, [] when a is empty or fully covered', () => {
    const mp = differencePolygons([squareCW, [[0, 0], [1, 0]]], []);
    expect(mp).toHaveLength(1);
    expect(isCCW(mp[0][0])).toBe(true);
    expect(multiPolygonArea(mp)).toBe(4);
    expect(differencePolygons([], [square])).toEqual([]);
    expect(differencePolygons([square], [rect(-1, -1, 5, 5)])).toEqual([]);
  });

  it('can split a polygon into two', () => {
    const mp = differencePolygons([rect(0, 0, 6, 2)], [rect(2, -1, 4, 3)]);
    expect(mp).toHaveLength(2);
    expect(multiPolygonArea(mp)).toBeCloseTo(8, 9);
  });
});

describe('multiPolygonArea', () => {
  it('subtracts holes regardless of ring orientation', () => {
    const hole = rect(1, 1, 2, 2);
    expect(multiPolygonArea([[rect(0, 0, 4, 4), hole]])).toBe(15);
    expect(multiPolygonArea([[rect(0, 0, 4, 4), [...hole].reverse()]])).toBe(15);
    expect(multiPolygonArea([[square], [rect(5, 5, 6, 6)]])).toBe(5);
    expect(multiPolygonArea([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Segments and lines
// ---------------------------------------------------------------------------

describe('segmentIntersection', () => {
  it('finds a crossing with parameters', () => {
    const r = segmentIntersection([0, 0], [2, 2], [0, 2], [2, 0]);
    expect(r).not.toBeNull();
    closeTo(r!.point, [1, 1]);
    expect(r!.ta).toBeCloseTo(0.5, 12);
    expect(r!.tb).toBeCloseTo(0.5, 12);
  });

  it('returns null for parallel, collinear and zero-length segments', () => {
    expect(segmentIntersection([0, 0], [2, 0], [0, 1], [2, 1])).toBeNull();
    expect(segmentIntersection([0, 0], [2, 0], [1, 0], [3, 0])).toBeNull();
    expect(segmentIntersection([0, 0], [0, 0], [-1, 1], [1, -1])).toBeNull();
    expect(segmentIntersection([0, 0], [1, 1], [2, 2], [2, 2])).toBeNull();
  });

  it('returns null when the segments would only meet if extended', () => {
    expect(segmentIntersection([0, 0], [1, 0], [2, -1], [2, 1])).toBeNull();
    expect(segmentIntersection([0, 0], [2, 0], [1, 1], [1, 3])).toBeNull();
  });

  it('accepts touching endpoints (T-junction) and tiny overshoots within EPS', () => {
    const t = segmentIntersection([0, 0], [2, 0], [1, 0], [1, 1]);
    expect(t).not.toBeNull();
    closeTo(t!.point, [1, 0]);
    expect(t!.ta).toBeCloseTo(0.5, 12);
    expect(t!.tb).toBe(0);
    const end = segmentIntersection([0, 0], [2, 0], [2, -1], [2, 1]);
    expect(end!.ta).toBe(1);
    expect(end!.tb).toBeCloseTo(0.5, 12);
    const near = segmentIntersection([0, 0], [2, 0], [2 + 1e-7, -1], [2 + 1e-7, 1]);
    expect(near).not.toBeNull();
    expect(near!.ta).toBe(1);
    expect(segmentIntersection([0, 0], [2, 0], [2 + 1e-5, -1], [2 + 1e-5, 1])).toBeNull();
  });
});

describe('lineIntersection', () => {
  it('intersects infinite lines whatever the direction length', () => {
    closeTo(lineIntersection([0, 0], [1, 0], [5, -3], [0, 2])!, [5, 0]);
    closeTo(lineIntersection([0, 0], [3, 3], [0, 4], [1, -1])!, [2, 2]);
    closeTo(lineIntersection([10, 10], [-1, 0], [1, 2], [0, 1])!, [1, 10]);
  });
  it('returns null for parallel or zero directions', () => {
    expect(lineIntersection([0, 0], [1, 0], [0, 1], [2, 0])).toBeNull();
    expect(lineIntersection([0, 0], [1, 1], [0, 1], [-2, -2])).toBeNull();
    expect(lineIntersection([0, 0], [0, 0], [0, 1], [1, 0])).toBeNull();
    expect(lineIntersection([0, 0], [1, 0], [0, 1], [1, 1e-12])).toBeNull();
  });
});

describe('projectPointOnSegment / distancePointSegment', () => {
  it('projects onto the interior and clamps to the ends', () => {
    expect(projectPointOnSegment([1, 5], [0, 0], [4, 0])).toEqual({ t: 0.25, point: [1, 0] });
    expect(projectPointOnSegment([-3, 2], [0, 0], [4, 0])).toEqual({ t: 0, point: [0, 0] });
    expect(projectPointOnSegment([9, 2], [0, 0], [4, 0])).toEqual({ t: 1, point: [4, 0] });
    expect(distancePointSegment([1, 5], [0, 0], [4, 0])).toBe(5);
    expect(distancePointSegment([7, 4], [0, 0], [4, 0])).toBe(5);
    expect(distancePointSegment([2, 0], [0, 0], [4, 0])).toBe(0);
  });
  it('handles a degenerate segment', () => {
    expect(projectPointOnSegment([3, 4], [0, 0], [0, 0])).toEqual({ t: 0, point: [0, 0] });
    expect(distancePointSegment([3, 4], [1, 1], [1, 1])).toBeCloseTo(Math.hypot(2, 3), 12);
  });
});

describe('collinearOverlap', () => {
  it('returns the shared part of partially overlapping collinear segments', () => {
    const r = collinearOverlap([0, 0], [10, 0], [6, 0], [14, 0]);
    expect(r).not.toBeNull();
    closeTo(r![0], [6, 0]);
    closeTo(r![1], [10, 0]);
  });

  it('is direction-agnostic and orders the result along a', () => {
    // Two CCW blocks sharing an edge run in opposite directions.
    const r = collinearOverlap([5, 6.2], [9, 6.2], [12, 6.2], [0, 6.2]);
    expect(r).not.toBeNull();
    closeTo(r![0], [5, 6.2]);
    closeTo(r![1], [9, 6.2]);
    const r2 = collinearOverlap([9, 6.2], [5, 6.2], [0, 6.2], [12, 6.2]);
    closeTo(r2![0], [9, 6.2]);
    closeTo(r2![1], [5, 6.2]);
  });

  it('returns null when there is no overlap or only a touching point', () => {
    expect(collinearOverlap([0, 0], [4, 0], [5, 0], [9, 0])).toBeNull();
    expect(collinearOverlap([0, 0], [4, 0], [4, 0], [9, 0])).toBeNull();
    expect(collinearOverlap([0, 0], [4, 0], [4.005, 0], [9, 0])).toBeNull(); // overlap ≤ eps
  });

  it('returns null for parallel-but-offset or angled segments', () => {
    expect(collinearOverlap([0, 0], [4, 0], [1, 0.05], [3, 0.05])).toBeNull();
    expect(collinearOverlap([0, 0], [4, 0], [1, 0], [3, 0.2])).toBeNull(); // ~5.7°
    expect(collinearOverlap([0, 0], [4, 0], [1, 0], [3, 0.0001], 0.01, 0.001)).toBeNull(); // tighter angle
  });

  it('accepts offsets and angles within the tolerances (1 cm / 0.5°)', () => {
    const r = collinearOverlap([0, 0], [4, 0], [1, 0.005], [3, 0.008]);
    expect(r).not.toBeNull();
    closeTo(r![0], [1, 0]);
    closeTo(r![1], [3, 0]);
    // custom tolerances
    expect(collinearOverlap([0, 0], [4, 0], [1, 0.05], [3, 0.05], 0.1)).not.toBeNull();
  });

  it('handles containment and diagonal segments', () => {
    const r = collinearOverlap([0, 0], [10, 10], [2, 2], [3, 3]);
    closeTo(r![0], [2, 2]);
    closeTo(r![1], [3, 3]);
    const r2 = collinearOverlap([2, 2], [3, 3], [0, 0], [10, 10]);
    closeTo(r2![0], [2, 2]);
    closeTo(r2![1], [3, 3]);
  });

  it('returns null for zero-length segments', () => {
    expect(collinearOverlap([1, 1], [1, 1], [0, 0], [2, 2])).toBeNull();
    expect(collinearOverlap([0, 0], [2, 2], [1, 1], [1, 1])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// labelPoint
// ---------------------------------------------------------------------------

const minBoundaryDistance = (p: Vec2, rings: Vec2[][]) =>
  Math.min(...rings.flatMap((ring) => ring.map((a, i) => distancePointSegment(p, a, ring[(i + 1) % ring.length]))));

describe('labelPoint', () => {
  it('finds the centre of a square and a rectangle', () => {
    closeTo(labelPoint(square), [1, 1], 0.05);
    closeTo(labelPoint(rect(0, 0, 10, 1)), [5, 0.5], 0.06);
    expect(labelPoint(rect(0, 0, 10, 1))[1]).toBeCloseTo(0.5, 1);
  });

  it('stays inside a U-shape (never in the slot)', () => {
    const p = labelPoint(uShape);
    expect(pointInPolygon(p, uShape)).toBe(true);
    expect(minBoundaryDistance(p, [uShape])).toBeGreaterThan(0.9); // best possible is 1.0 (arms and base are 2 wide)
    expect(p[1] < 1 || p[0] < 2 || p[0] > 4).toBe(true);
  });

  it('avoids a hole', () => {
    const outer = rect(0, 0, 6, 6);
    const hole = rect(2, 2, 4, 4);
    const p = labelPoint(outer, [hole]);
    expect(pointInPolygon(p, outer)).toBe(true);
    expect(pointInPolygon(p, hole)).toBe(false);
    expect(minBoundaryDistance(p, [outer, hole])).toBeGreaterThan(0.95); // best possible: 1.0 in the 2 m ring
  });

  it('handles a hole given in either orientation and ignores degenerate holes', () => {
    const outer = rect(0, 0, 6, 6);
    const hole = [...rect(2, 2, 4, 4)].reverse();
    const p = labelPoint(outer, [hole, [], [[1, 1]]]);
    expect(pointInPolygon(p, rect(2, 2, 4, 4))).toBe(false);
  });

  it('works for an L-shape', () => {
    const p = labelPoint(lShape);
    expect(pointInPolygon(p, lShape)).toBe(true);
    expect(minBoundaryDistance(p, [lShape])).toBeGreaterThan(0.95);
  });

  it('falls back to the centroid for degenerate input', () => {
    expect(labelPoint([])).toEqual([0, 0]);
    expect(labelPoint([[1, 2], [3, 4]])).toEqual([2, 3]);
    closeTo(labelPoint([[0, 0], [4, 0], [4, 0.01], [0, 0.01]]), [2, 0.005]);
    closeTo(labelPoint([[0, 0], [2, 0], [4, 0]]), [2, 0]);
  });
});

// ---------------------------------------------------------------------------
// rectDims, simplifyCollinear, fnv1a
// ---------------------------------------------------------------------------

describe('rectDims', () => {
  it('reports exact rectangles and approximate others', () => {
    expect(rectDims(rect(1, 1, 3.2, 5.2))).toEqual({ w: expect.closeTo(2.2, 9), h: expect.closeTo(4.2, 9), approx: false });
    expect(rectDims(lShape)).toEqual({ w: 4, h: 4, approx: true });
    // 1 % notch → still a rectangle for the label
    const nearly: Vec2[] = [[0, 0], [10, 0], [10, 10], [1, 10], [1, 9], [0, 9]];
    expect(rectDims(nearly).approx).toBe(false);
    // 2.5 % notch → approx
    const notQuite: Vec2[] = [[0, 0], [10, 0], [10, 10], [2.5, 10], [2.5, 9], [0, 9]];
    expect(rectDims(notQuite).approx).toBe(true);
  });
  it('is zero and not approx for degenerate input', () => {
    expect(rectDims([])).toEqual({ w: 0, h: 0, approx: false });
    expect(rectDims([[0, 0], [3, 0]])).toEqual({ w: 3, h: 0, approx: false });
  });
});

describe('simplifyCollinear', () => {
  it('removes mid-edge vertices, including at the wrap-around', () => {
    const poly: Vec2[] = [[1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1], [0, 0]];
    expect(simplifyCollinear(poly)).toEqual([[2, 0], [2, 2], [0, 2], [0, 0]]);
  });

  it('removes runs of collinear vertices and duplicates', () => {
    const poly: Vec2[] = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
    expect(simplifyCollinear(poly)).toEqual([[0, 0], [4, 0], [4, 4], [0, 4]]);
  });

  it('respects eps', () => {
    const poly: Vec2[] = [[0, 0], [2, 1e-7], [4, 0], [4, 4], [0, 4]];
    expect(simplifyCollinear(poly)).toHaveLength(4);
    const bent: Vec2[] = [[0, 0], [2, 1e-3], [4, 0], [4, 4], [0, 4]];
    expect(simplifyCollinear(bent)).toHaveLength(5);
    expect(simplifyCollinear(bent, 0.01)).toHaveLength(4);
  });

  it('removes a zero-width spike (collinear beyond the neighbours)', () => {
    const spike: Vec2[] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [2, 2], [0, 2]];
    const out = simplifyCollinear(spike);
    expect(out).toEqual([[0, 0], [4, 0], [4, 2], [0, 2]]);
    // spike tip with a near-coincident return point, custom eps
    const near: Vec2[] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [2.004, 2], [0, 2]];
    expect(simplifyCollinear(near, 0.01)).toEqual([[0, 0], [4, 0], [4, 2], [0, 2]]);
  });

  it('leaves a clean polygon alone and copes with degenerate input', () => {
    expect(simplifyCollinear(lShape)).toEqual(lShape);
    expect(simplifyCollinear([])).toEqual([]);
    expect(simplifyCollinear([[0, 0], [1, 0]])).toEqual([[0, 0], [1, 0]]);
    expect(simplifyCollinear([[0, 0], [1, 0], [2, 0]]).length).toBeLessThan(3);
  });
});

describe('fnv1a', () => {
  it('matches the reference FNV-1a 32-bit values as base-36 strings', () => {
    expect(fnv1a('')).toBe((0x811c9dc5).toString(36));
    expect(fnv1a('a')).toBe((0xe40c292c).toString(36));
    expect(fnv1a('foobar')).toBe((0xbf9cf968).toString(36));
  });
  it('is stable, compact and distinguishes inputs', () => {
    const h = fnv1a('blk-main/e1,blk-bod/e3');
    expect(h).toBe(fnv1a('blk-main/e1,blk-bod/e3'));
    expect(h).toMatch(/^[0-9a-z]{1,7}$/);
    expect(h).not.toBe(fnv1a('blk-main/e1,blk-bod/e2'));
    expect(fnv1a('æøå')).toMatch(/^[0-9a-z]{1,7}$/);
  });
});
