import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../model/types';
import {
  arrowHead,
  bandRect,
  dimensionGeometry,
  domId,
  gridPath,
  gridSteps,
  hatchSegments,
  jambLine,
  labelDensity,
  multiPolygonPath,
  niceScaleLength,
  northInPlan,
  northOnScreen,
  num,
  openingFrame,
  polygonPath,
  polylinePath,
  ringPath,
  segmentsPath,
  slidingLines,
  sweptAngle,
  swingArcPath,
  textAngleAlong,
  windowLines,
} from './svg';

const close = (a: Vec2, b: Vec2, eps = 1e-9) => {
  expect(a[0]).toBeCloseTo(b[0], 9);
  expect(a[1]).toBeCloseTo(b[1], 9);
  expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(eps + 1e-9);
};
const len = (s: [Vec2, Vec2]) => Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]);
const dir = (s: [Vec2, Vec2]): Vec2 => {
  const l = len(s);
  return [(s[1][0] - s[0][0]) / l, (s[1][1] - s[0][1]) / l];
};
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];

/**
 * Centre of an SVG arc command (rx = ry = r, no rotation) from its endpoints and flags, following the SVG
 * implementation notes (F.6.5). Used to check that swing arcs are centred on the hinge.
 */
function arcCentre(p1: Vec2, p2: Vec2, r: number, large: number, sweep: number): Vec2 {
  const x1 = (p1[0] - p2[0]) / 2;
  const y1 = (p1[1] - p2[1]) / 2;
  const sign = large !== sweep ? 1 : -1;
  const sq = Math.max(0, (r * r * r * r - r * r * y1 * y1 - r * r * x1 * x1) / (r * r * y1 * y1 + r * r * x1 * x1));
  const coef = sign * Math.sqrt(sq);
  return [coef * y1 + (p1[0] + p2[0]) / 2, -coef * x1 + (p1[1] + p2[1]) / 2];
}

function parseArc(d: string) {
  const m = /^M(-?[\d.]+) (-?[\d.]+)A(-?[\d.]+) (-?[\d.]+) 0 ([01]) ([01]) (-?[\d.]+) (-?[\d.]+)$/.exec(d);
  if (!m) throw new Error(`not an arc path: ${d}`);
  const n = m.slice(1).map(Number);
  return { start: [n[0], n[1]] as Vec2, r: n[2], large: n[4], sweep: n[5], end: [n[6], n[7]] as Vec2 };
}

describe('path strings', () => {
  it('formats numbers compactly without -0', () => {
    expect(num(-0)).toBe('0');
    expect(num(-0.00001)).toBe('0');
    expect(num(1.23456789)).toBe('1.2346');
    expect(num(10)).toBe('10');
  });

  it('builds closed rings, polygons with holes and multipolygons', () => {
    expect(ringPath([[0, 0], [1, 0], [1, 1]])).toBe('M0 0L1 0L1 1Z');
    expect(ringPath([[0, 0]])).toBe('');
    expect(ringPath([])).toBe('');
    expect(polygonPath([[0, 0], [2, 0], [2, 2]], [[[0.5, 0.5], [1, 0.5], [1, 1]]])).toBe('M0 0L2 0L2 2ZM0.5 0.5L1 0.5L1 1Z');
    expect(multiPolygonPath([[[[0, 0], [1, 0], [1, 1]]], [[[5, 5], [6, 5], [6, 6]]]])).toBe('M0 0L1 0L1 1ZM5 5L6 5L6 6Z');
    expect(multiPolygonPath([])).toBe('');
  });

  it('builds open polylines and segment lists', () => {
    expect(polylinePath([[0, 0], [1, 2], [3, 4]])).toBe('M0 0L1 2L3 4');
    expect(polylinePath([[0, 0]])).toBe('');
    expect(segmentsPath([[[0, 0], [1, 1]], [[2, 2], [3, 3]]])).toBe('M0 0L1 1M2 2L3 3');
    expect(segmentsPath([])).toBe('');
  });

  it('makes ids safe for url(#…)', () => {
    expect(domId('wall-cut', ':r1:')).toBe('wall-cut-r1');
    expect(domId('deck', '«r12»')).toBe('deck-r12');
    expect(domId('x', '_r_3_')).toBe('x-_r_3_');
  });
});

describe('door swing arcs', () => {
  it('measures swept angles in both directions', () => {
    expect(sweptAngle([0, 0], [1, 0], [0, 1], 1)).toBeCloseTo(Math.PI / 2, 12);
    expect(sweptAngle([0, 0], [1, 0], [0, 1], -1)).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(sweptAngle([0, 0], [1, 0], [-1, 0], 1)).toBeCloseTo(Math.PI, 12);
    expect(sweptAngle([0, 0], [1, 0], [1, 0], 1)).toBe(0);
    expect(sweptAngle([2, 3], [2, 4], [1, 3], 1)).toBeCloseTo(Math.PI / 2, 12);
  });

  it('draws a CW quarter swing (outward entrance door) centred on the hinge', () => {
    const swing = { hinge: [-0.11, 3.45] as Vec2, closed: [-0.11, 2.55] as Vec2, open: [-1.01, 3.45] as Vec2, sweep: -1 as const };
    const d = swingArcPath(swing);
    expect(d).toBe('M-0.11 2.55A0.9 0.9 0 0 0 -1.01 3.45');
    const a = parseArc(d);
    close(arcCentre(a.start, a.end, a.r, a.large, a.sweep), swing.hinge, 1e-6);
  });

  it('draws a CCW quarter swing with sweep-flag 1 centred on the hinge', () => {
    const swing = { hinge: [12.95, -0.11] as Vec2, closed: [12.05, -0.11] as Vec2, open: [12.95, -1.01] as Vec2, sweep: 1 as const };
    expect(sweptAngle(swing.hinge, swing.closed, swing.open, 1)).toBeCloseTo(Math.PI / 2, 9);
    const a = parseArc(swingArcPath(swing));
    expect(a.sweep).toBe(1);
    expect(a.large).toBe(0);
    close(a.start, swing.closed);
    close(a.end, swing.open);
    close(arcCentre(a.start, a.end, a.r, a.large, a.sweep), swing.hinge, 1e-6);
  });

  it('sets the large-arc flag for swings over 180°', () => {
    const a = parseArc(swingArcPath({ hinge: [0, 0], closed: [1, 0], open: [0, -1], sweep: 1 }));
    expect(a.large).toBe(1);
    expect(a.sweep).toBe(1);
    close(arcCentre(a.start, a.end, a.r, a.large, a.sweep), [0, 0], 1e-6);
  });

  it('returns an empty path for degenerate swings', () => {
    expect(swingArcPath({ hinge: [1, 1], closed: [1, 1], open: [2, 1], sweep: 1 })).toBe('');
    expect(swingArcPath({ hinge: [1, 1], closed: [2, 1], open: [1, 1], sweep: 1 })).toBe('');
    expect(swingArcPath({ hinge: [0, 0], closed: [1, 0], open: [1, 0], sweep: -1 })).toBe('');
  });
});

describe('opening symbols', () => {
  const wall = { a: [0, 0] as Vec2, b: [10, 0] as Vec2, faceLeft: 0.16, faceRight: 0.11 };

  it('places the jambs on the reference line', () => {
    const f = openingFrame(wall, { offset: 2, width: 1.2 });
    close(f.start, [1.4, 0]);
    close(f.end, [2.6, 0]);
    close(f.along, [1, 0]);
    close(f.normal, [0, 1]);
    expect(jambLine(f, 'start')).toEqual([
      [1.4, -0.11],
      [1.4, 0.16],
    ]);
  });

  it('draws a window as three parallel lines across the wall plus two jambs', () => {
    const lines = windowLines(openingFrame(wall, { offset: 2, width: 1.2 }), 0.025);
    expect(lines).toHaveLength(5);
    const [left, right, glass, j0, j1] = lines;
    for (const l of [left, right, glass]) {
      expect(len(l)).toBeCloseTo(1.2, 9);
      close(dir(l), [1, 0]);
    }
    expect(left[0][1]).toBeCloseTo(0.16, 9);
    expect(right[0][1]).toBeCloseTo(-0.11, 9);
    expect(glass[0][1]).toBeCloseTo(0.025, 9);
    expect(len(j0)).toBeCloseTo(0.27, 9);
    expect(len(j1)).toBeCloseTo(0.27, 9);
    expect(dot(dir(j0), [1, 0])).toBeCloseTo(0, 9);
  });

  it('works on a wall running in -y (left normal +x)', () => {
    const f = openingFrame({ a: [0, 6], b: [0, 0], faceLeft: 0.16, faceRight: 0.11 }, { offset: 3, width: 0.9 });
    close(f.start, [0, 3.45]);
    close(f.end, [0, 2.55]);
    close(f.normal, [1, 0]);
    expect(jambLine(f, 'end')).toEqual([
      [-0.11, 2.55],
      [0.16, 2.55],
    ]);
  });

  it('falls back to +x for a zero-length wall', () => {
    const f = openingFrame({ a: [3, 3], b: [3, 3], faceLeft: 0.05, faceRight: 0.05 }, { offset: 0, width: 1 });
    close(f.along, [1, 0]);
    close(f.start, [2.5, 3]);
  });

  it('draws sliding doors as two overlapping leaves either side of the glass plane', () => {
    const [a, b, j0, j1] = slidingLines(openingFrame(wall, { offset: 5, width: 2 }), 0);
    expect(a[0][1]).toBeCloseTo(0.03, 9);
    expect(b[0][1]).toBeCloseTo(-0.03, 9);
    expect(a[1][0]).toBeGreaterThan(b[0][0]);
    expect(a[0][0]).toBeCloseTo(4, 9);
    expect(b[1][0]).toBeCloseTo(6, 9);
    expect(len(j0)).toBeCloseTo(0.27, 9);
    expect(len(j1)).toBeCloseTo(0.27, 9);
  });

  it('builds a band (double line) around a segment', () => {
    const r = bandRect([0, 0, 1], [2, 0, 1], 0.03);
    expect(r).toEqual([
      [0, -0.03],
      [2, -0.03],
      [2, 0.03],
      [0, 0.03],
    ]);
    expect(bandRect([1, 1], [1, 1], 0.03)).toEqual([]);
  });
});

describe('label density', () => {
  it('follows the 20 / 8 px per metre thresholds', () => {
    expect(labelDensity(80)).toBe('full');
    expect(labelDensity(24.7)).toBe('full'); // Plan only at 1400 × 900
    expect(labelDensity(20)).toBe('full');
    expect(labelDensity(19.99)).toBe('name');
    expect(labelDensity(11.25)).toBe('name'); // Begge at 1400 × 900
    expect(labelDensity(8)).toBe('name');
    expect(labelDensity(7.99)).toBe('none');
    expect(labelDensity(0)).toBe('none');
    expect(labelDensity(Number.NaN)).toBe('none');
  });
});

describe('dimension geometry', () => {
  it('offsets a horizontal dimension below the line (negative = right of a→b)', () => {
    const g = dimensionGeometry({ a: [0, 0], b: [10, 0], offset: -2 }, 0.2, 0.1)!;
    expect(g.line).toEqual([
      [0, -2],
      [10, -2],
    ]);
    close(g.outward, [0, -1]);
    close(g.mid, [5, -2]);
    expect(g.length).toBe(10);
    close(g.ext[0][0], [0, 0]);
    close(g.ext[0][1], [0, -2.1]);
    close(g.ext[1][1], [10, -2.1]);
  });

  it('centres 45° ticks of the given length on both ends of the dimension line', () => {
    const g = dimensionGeometry({ a: [0, 0], b: [10, 0], offset: 1 }, 0.2, 0.1)!;
    for (const [i, end] of [[0, [0, 1]], [1, [10, 1]]] as const) {
      const t = g.ticks[i];
      expect(len(t)).toBeCloseTo(0.2, 9);
      close([(t[0][0] + t[1][0]) / 2, (t[0][1] + t[1][1]) / 2], end as unknown as Vec2);
      expect(Math.abs(dot(dir(t), [1, 0]))).toBeCloseTo(Math.SQRT1_2, 9);
    }
    close(dir(g.ticks[0]), [Math.SQRT1_2, Math.SQRT1_2]);
  });

  it('keeps ticks at 45° to diagonal lines and puts positive offsets on the left', () => {
    const g = dimensionGeometry({ a: [1, 1], b: [4, 5], offset: 0.5 }, 0.3, 0)!;
    const along: Vec2 = [0.6, 0.8];
    expect(g.length).toBeCloseTo(5, 12);
    close(g.outward, [-0.8, 0.6]);
    close(g.line[0], [1 - 0.4, 1 + 0.3]);
    expect(Math.abs(dot(dir(g.ticks[1]), along))).toBeCloseTo(Math.SQRT1_2, 9);
    expect(len(g.ext[0])).toBeCloseTo(0.5, 9);
  });

  it('handles a zero offset and rejects a zero-length dimension', () => {
    const g = dimensionGeometry({ a: [0, 0], b: [0, 3], offset: 0 }, 0.2, 0.1)!;
    close(g.line[0], [0, 0]);
    close(g.outward, [-1, 0]);
    expect(len(g.ext[1])).toBeCloseTo(0.1, 9);
    expect(dimensionGeometry({ a: [2, 2], b: [2, 2], offset: 1 }, 0.2, 0.1)).toBeNull();
  });
});

describe('text angle along a plan direction', () => {
  it('keeps text readable left→right or bottom→top', () => {
    expect(textAngleAlong(1, 0)).toBe(0);
    expect(textAngleAlong(-1, 0)).toBe(0);
    expect(textAngleAlong(-1, -0)).toBe(0);
    expect(textAngleAlong(0, 1)).toBe(-90);
    expect(textAngleAlong(0, -1)).toBe(-90);
    expect(textAngleAlong(1, 1)).toBeCloseTo(-45, 9);
    expect(textAngleAlong(-1, -1)).toBeCloseTo(-45, 9);
    expect(textAngleAlong(1, -1)).toBeCloseTo(45, 9);
    expect(textAngleAlong(-1, 1)).toBeCloseTo(45, 9);
    expect(textAngleAlong(0, 0)).toBe(0);
  });
});

describe('grid', () => {
  const count = (d: string) => (d.match(/M/g) ?? []).length;

  it('draws 1 m lines without the 5 m multiples, and 5 m lines', () => {
    const rect = { min: [0, 0] as Vec2, max: [10, 5] as Vec2 };
    expect(count(gridPath(rect, 1, 5))).toBe(8 + 4);
    expect(count(gridPath(rect, 5))).toBe(3 + 2);
    expect(gridPath(rect, 5)).toContain('M5 0V5');
  });

  it('handles negative coordinates and non-aligned rectangles', () => {
    expect(count(gridPath({ min: [-2.5, -2.5], max: [2.5, 2.5] }, 1))).toBe(10);
    expect(count(gridPath({ min: [-2.5, -2.5], max: [2.5, 2.5] }, 1, 5))).toBe(8);
  });

  it('returns nothing for degenerate steps, inverted or huge rectangles', () => {
    expect(gridPath({ min: [0, 0], max: [10, 10] }, 0)).toBe('');
    expect(gridPath({ min: [0, 0], max: [10, 10] }, -1)).toBe('');
    expect(gridPath({ min: [10, 10], max: [0, 0] }, 1)).toBe('');
    expect(gridPath({ min: [0, 0], max: [1e6, 1e6] }, 1)).toBe('');
  });

  it('hides fine lines when zoomed out', () => {
    expect(gridSteps(40)).toEqual({ fine: true, coarse: true });
    expect(gridSteps(5)).toEqual({ fine: false, coarse: true });
    expect(gridSteps(1)).toEqual({ fine: false, coarse: false });
  });
});

describe('scale bar', () => {
  it('picks the largest nice length that fits', () => {
    expect(niceScaleLength(40)).toBe(2);
    expect(niceScaleLength(10)).toBe(10);
    expect(niceScaleLength(7)).toBe(20);
    expect(niceScaleLength(1000)).toBe(0.1);
    expect(niceScaleLength(500)).toBe(0.2);
  });

  it('degrades gracefully at the extremes', () => {
    expect(niceScaleLength(2000)).toBe(0.1);
    expect(niceScaleLength(0.01)).toBe(1000);
    expect(niceScaleLength(0)).toBe(1);
    expect(niceScaleLength(Number.NaN)).toBe(1);
  });
});

describe('north arrow', () => {
  it('uses planDirOfBearing(0) = (sin(−B), cos(−B))', () => {
    const n = northInPlan(106);
    expect(n[0]).toBeCloseTo(-0.9613, 4);
    expect(n[1]).toBeCloseTo(-0.2756, 4);
    close(northInPlan(0), [0, 1]);
    close(northInPlan(90), [-1, 0]);
    expect(Math.hypot(...northInPlan(237))).toBeCloseTo(1, 12);
  });

  it('points down-left on screen for Merkesvatnet', () => {
    const s = northOnScreen(106);
    expect(s[0]).toBeLessThan(0);
    expect(s[1]).toBeGreaterThan(0);
  });
});

describe('hatching', () => {
  it('fills a rectangle with 45° segments at the given spacing, all inside', () => {
    const segs = hatchSegments([0, 0], [1, 1], 0.1);
    expect(segs.length).toBeGreaterThanOrEqual(13);
    expect(segs.length).toBeLessThanOrEqual(15);
    for (const [a, b] of segs) {
      for (const p of [a, b]) {
        expect(p[0]).toBeGreaterThanOrEqual(-1e-9);
        expect(p[0]).toBeLessThanOrEqual(1 + 1e-9);
        expect(p[1]).toBeGreaterThanOrEqual(-1e-9);
        expect(p[1]).toBeLessThanOrEqual(1 + 1e-9);
      }
      expect(b[0] - a[0]).toBeCloseTo(b[1] - a[1], 9);
    }
    // Perpendicular distance between neighbouring lines (x − y = c) is the spacing.
    const c0 = segs[0][0][0] - segs[0][0][1];
    const c1 = segs[1][0][0] - segs[1][0][1];
    expect(Math.abs(c1 - c0) / Math.SQRT2).toBeCloseTo(0.1, 9);
  });

  it('works on offset, thin rectangles and rejects degenerate input', () => {
    const segs = hatchSegments([5, 1.2], [5.55, 1.3], 0.08);
    expect(segs.length).toBeGreaterThan(0);
    for (const [a, b] of segs) for (const p of [a, b]) expect(p[1]).toBeGreaterThanOrEqual(1.2 - 1e-9);
    expect(hatchSegments([0, 0], [0, 1], 0.1)).toEqual([]);
    expect(hatchSegments([0, 0], [1, 1], 0)).toEqual([]);
    expect(hatchSegments([1, 1], [0, 0], 0.1)).toEqual([]);
  });
});

describe('arrow head', () => {
  it('puts the tip on b with the base behind it', () => {
    const h = arrowHead([0, 0], [2, 0], 0.5);
    expect(h).toHaveLength(3);
    close(h[0], [2, 0]);
    close(h[1], [1.5, 0.225]);
    close(h[2], [1.5, -0.225]);
  });

  it('is empty for degenerate input', () => {
    expect(arrowHead([1, 1], [1, 1], 0.5)).toEqual([]);
    expect(arrowHead([0, 0], [1, 1], 0)).toEqual([]);
  });
});
