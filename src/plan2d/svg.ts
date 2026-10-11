/**
 * Pure SVG helpers for the plan: path strings, door-swing arcs, opening symbols, dimension ticks, label
 * density, grid paths, scale bar and north arrow. No React, no DOM — unit-tested (svg.test.ts).
 *
 * All geometry is in plan metres (the flipped root group maps it to the screen); anything that must have a
 * constant size on screen takes the current scale (px/m) and divides.
 */
import type { Vec2 } from '../model/types';
import type { DerivedDimension, DerivedOpening, DerivedWall } from '../model/derived';
import type { Rect } from './viewport';

/** Compact number for path data (0.1 mm precision, no "-0"). */
export const num = (v: number): string => {
  const r = Math.round(v * 1e4) / 1e4;
  return Math.abs(r) < 1e-9 ? '0' : String(r);
};

const off = (p: Vec2, n: Vec2, d: number): Vec2 => [p[0] + n[0] * d, p[1] + n[1] * d];

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Closed subpath for one ring (a repeated closing point is tolerated). Empty for fewer than 2 points. */
export function ringPath(ring: Vec2[]): string {
  if (ring.length < 2) return '';
  let d = `M${num(ring[0][0])} ${num(ring[0][1])}`;
  for (let i = 1; i < ring.length; i++) d += `L${num(ring[i][0])} ${num(ring[i][1])}`;
  return d + 'Z';
}

/** Polygon with optional holes as one path (render with fill-rule evenodd). */
export function polygonPath(outer: Vec2[], holes: Vec2[][] = []): string {
  let d = ringPath(outer);
  for (const h of holes) d += ringPath(h);
  return d;
}

/** MultiPolygon [poly][ring][pt] (ring 0 = outer) as one path. */
export function multiPolygonPath(mp: Vec2[][][]): string {
  let d = '';
  for (const poly of mp) for (const ring of poly) d += ringPath(ring);
  return d;
}

/** Open polyline. Empty for fewer than 2 points. */
export function polylinePath(pts: Vec2[]): string {
  if (pts.length < 2) return '';
  let d = `M${num(pts[0][0])} ${num(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += `L${num(pts[i][0])} ${num(pts[i][1])}`;
  return d;
}

/** Straight segments as one path ("M a L b" per segment). */
export function segmentsPath(segs: [Vec2, Vec2][]): string {
  let d = '';
  for (const [a, b] of segs) d += `M${num(a[0])} ${num(a[1])}L${num(b[0])} ${num(b[1])}`;
  return d;
}

// ---------------------------------------------------------------------------
// Doors and openings
// ---------------------------------------------------------------------------

/** Angle (radians, in [0, 2π)) swept from `from` to `to` around `centre` in the direction `sweep` (+1 = CCW). */
export function sweptAngle(centre: Vec2, from: Vec2, to: Vec2, sweep: 1 | -1): number {
  const a0 = Math.atan2(from[1] - centre[1], from[0] - centre[0]);
  const a1 = Math.atan2(to[1] - centre[1], to[0] - centre[0]);
  const twoPi = 2 * Math.PI;
  const d = sweep === 1 ? a1 - a0 : a0 - a1;
  const m = ((d % twoPi) + twoPi) % twoPi;
  return m > twoPi - 1e-12 ? 0 : m;
}

/**
 * Door swing arc from the closed leaf tip to the open leaf tip around the hinge, as SVG path data in plan
 * coordinates. In the plan frame (y up) sweep +1 = CCW = SVG sweep-flag 1 (the positive-angle direction of the
 * user space); the flipped root group mirrors the result consistently on screen. The large-arc flag follows the
 * swept angle. Returns '' for a degenerate swing (zero radius or zero swept angle).
 */
export function swingArcPath(swing: { hinge: Vec2; closed: Vec2; open: Vec2; sweep: 1 | -1 }): string {
  const { hinge, closed, open, sweep } = swing;
  const r = Math.hypot(closed[0] - hinge[0], closed[1] - hinge[1]);
  const rOpen = Math.hypot(open[0] - hinge[0], open[1] - hinge[1]);
  if (r < 1e-6 || rOpen < 1e-6) return '';
  const swept = sweptAngle(hinge, closed, open, sweep);
  if (swept < 1e-9) return '';
  const large = swept > Math.PI ? 1 : 0;
  const flag = sweep === 1 ? 1 : 0;
  return `M${num(closed[0])} ${num(closed[1])}A${num(r)} ${num(r)} 0 ${large} ${flag} ${num(open[0])} ${num(open[1])}`;
}

export interface OpeningFrame {
  /** Jamb positions on the reference line. */
  start: Vec2;
  end: Vec2;
  /** Unit direction along the wall and its left normal. */
  along: Vec2;
  normal: Vec2;
  /** Face distances from the reference line (left = +normal). */
  left: number;
  right: number;
}

/** Jambs and axes of an opening on its wall's reference line. Zero-length walls fall back to the +x direction. */
export function openingFrame(
  wall: Pick<DerivedWall, 'a' | 'b' | 'faceLeft' | 'faceRight'>,
  o: Pick<DerivedOpening, 'offset' | 'width'>,
): OpeningFrame {
  const dx = wall.b[0] - wall.a[0];
  const dy = wall.b[1] - wall.a[1];
  const len = Math.hypot(dx, dy);
  const along: Vec2 = len > 1e-9 ? [dx / len, dy / len] : [1, 0];
  const normal: Vec2 = [-along[1], along[0]];
  return {
    start: off(wall.a, along, o.offset - o.width / 2),
    end: off(wall.a, along, o.offset + o.width / 2),
    along,
    normal,
    left: wall.faceLeft,
    right: wall.faceRight,
  };
}

/** Line across the wall thickness at a jamb (from the right face to the left face). */
export function jambLine(f: OpeningFrame, which: 'start' | 'end'): [Vec2, Vec2] {
  const p = which === 'start' ? f.start : f.end;
  return [off(p, f.normal, -f.right), off(p, f.normal, f.left)];
}

/** Line parallel to the wall at signed distance `d` along the left normal, between the jambs. */
export function faceLine(f: OpeningFrame, d: number): [Vec2, Vec2] {
  return [off(f.start, f.normal, d), off(f.end, f.normal, d)];
}

/** Window symbol: the two wall faces and the glass plane (the triple line), then both jambs. */
export function windowLines(f: OpeningFrame, glassPlane: number): [Vec2, Vec2][] {
  return [faceLine(f, f.left), faceLine(f, -f.right), faceLine(f, glassPlane), jambLine(f, 'start'), jambLine(f, 'end')];
}

/** Sliding door: two leaves either side of the glass plane overlapping 0.1 m at the middle, then both jambs. */
export function slidingLines(f: OpeningFrame, glassPlane: number): [Vec2, Vec2][] {
  const half = 0.03;
  const overlap = 0.05;
  const mid: Vec2 = [(f.start[0] + f.end[0]) / 2, (f.start[1] + f.end[1]) / 2];
  const a: [Vec2, Vec2] = [off(f.start, f.normal, glassPlane + half), off(off(mid, f.along, overlap), f.normal, glassPlane + half)];
  const b: [Vec2, Vec2] = [off(off(mid, f.along, -overlap), f.normal, glassPlane - half), off(f.end, f.normal, glassPlane - half)];
  return [a, b, jambLine(f, 'start'), jambLine(f, 'end')];
}

// ---------------------------------------------------------------------------
// Labels and dimensions
// ---------------------------------------------------------------------------

export type LabelDensity = 'full' | 'name' | 'none';

/** architecture.md: ≥ 25 px/m full label, 12–25 px/m name only, < 12 px/m none. */
export function labelDensity(pxPerM: number): LabelDensity {
  if (pxPerM >= 25) return 'full';
  if (pxPerM >= 12) return 'name';
  return 'none';
}

export interface DimensionGeometry {
  /** The dimension line itself (a–b moved by `offset`). */
  line: [Vec2, Vec2];
  /** Extension lines from each measured point to just past the dimension line. */
  ext: [[Vec2, Vec2], [Vec2, Vec2]];
  /** 45° ticks centred on both ends of the dimension line. */
  ticks: [[Vec2, Vec2], [Vec2, Vec2]];
  /** Midpoint of the dimension line. */
  mid: Vec2;
  /** Unit normal pointing to the offset side (left of a→b when offset ≥ 0). */
  outward: Vec2;
  /** Length of a–b (metres). */
  length: number;
}

/**
 * Geometry of a dimension line. `offset` is positive to the LEFT of a→b (derived.ts). Tick length and the
 * extension-line overshoot are in metres (callers pass px / scale for a constant screen size). Ticks lean
 * 45° forward (along + left normal), the architect's slash. Returns null when a ≈ b.
 */
export function dimensionGeometry(
  dim: Pick<DerivedDimension, 'a' | 'b' | 'offset'>,
  tickLen: number,
  overshoot: number,
): DimensionGeometry | null {
  const dx = dim.b[0] - dim.a[0];
  const dy = dim.b[1] - dim.a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const along: Vec2 = [dx / len, dy / len];
  const n: Vec2 = [-along[1], along[0]];
  const a1 = off(dim.a, n, dim.offset);
  const b1 = off(dim.b, n, dim.offset);
  const sign = dim.offset >= 0 ? 1 : -1;
  const outward: Vec2 = [n[0] * sign, n[1] * sign];
  const reach = Math.abs(dim.offset) + overshoot;
  const ext: [[Vec2, Vec2], [Vec2, Vec2]] = [
    [dim.a, off(dim.a, outward, reach)],
    [dim.b, off(dim.b, outward, reach)],
  ];
  const h = tickLen / 2;
  const t: Vec2 = [(along[0] + n[0]) * Math.SQRT1_2, (along[1] + n[1]) * Math.SQRT1_2];
  const ticks: [[Vec2, Vec2], [Vec2, Vec2]] = [
    [off(a1, t, -h), off(a1, t, h)],
    [off(b1, t, -h), off(b1, t, h)],
  ];
  return { line: [a1, b1], ext, ticks, mid: [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2], outward, length: len };
}

/**
 * Screen rotation (degrees, SVG sense, y down) for text that runs along plan direction (dx, dy), kept readable:
 * left→right, or bottom→top for vertical lines (architect convention). Result in [−90, 90).
 */
export function textAngleAlong(dx: number, dy: number): number {
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return 0;
  let a = (Math.atan2(-dy, dx) * 180) / Math.PI;
  if (a >= 90 - 1e-9) a -= 180;
  else if (a < -90 - 1e-9) a += 180;
  return Math.abs(a) < 1e-9 ? 0 : a;
}

// ---------------------------------------------------------------------------
// Grid, scale bar, north arrow, hatching, arrows
// ---------------------------------------------------------------------------

/** Upper bound on lines per grid path, so an extreme zoom-out never builds a huge string. */
const MAX_GRID_LINES = 4000;

/** Grid lines at multiples of `step` covering `rect`, as one path. Lines at multiples of `skip` are left out. */
export function gridPath(rect: Rect, step: number, skip?: number): string {
  if (!(step > 0)) return '';
  const nx = (rect.max[0] - rect.min[0]) / step;
  const ny = (rect.max[1] - rect.min[1]) / step;
  if (!(nx >= 0) || !(ny >= 0) || nx + ny > MAX_GRID_LINES) return '';
  const isSkipped = (v: number) => skip !== undefined && skip > 0 && Math.abs(v / skip - Math.round(v / skip)) < 1e-9;
  let d = '';
  const i0 = Math.ceil(rect.min[0] / step - 1e-9);
  const i1 = Math.floor(rect.max[0] / step + 1e-9);
  for (let i = i0; i <= i1; i++) {
    const x = i * step;
    if (!isSkipped(x)) d += `M${num(x)} ${num(rect.min[1])}V${num(rect.max[1])}`;
  }
  const j0 = Math.ceil(rect.min[1] / step - 1e-9);
  const j1 = Math.floor(rect.max[1] / step + 1e-9);
  for (let j = j0; j <= j1; j++) {
    const y = j * step;
    if (!isSkipped(y)) d += `M${num(rect.min[0])} ${num(y)}H${num(rect.max[0])}`;
  }
  return d;
}

/** Which grid steps to draw at a given zoom: 1 m lines need ≥ 8 px/m, 5 m lines ≥ 2 px/m. */
export function gridSteps(pxPerM: number): { fine: boolean; coarse: boolean } {
  return { fine: pxPerM >= 8, coarse: pxPerM >= 2 };
}

const NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/** Scale bar length in metres: the largest "nice" value not longer than `maxPx`, bumped up once if below `minPx`. */
export function niceScaleLength(pxPerM: number, minPx = 60, maxPx = 180): number {
  if (!(pxPerM > 0)) return 1;
  let i = 0;
  while (i + 1 < NICE.length && NICE[i + 1] * pxPerM <= maxPx) i++;
  if (NICE[i] * pxPerM < minPx && i + 1 < NICE.length) i++;
  return NICE[i];
}

/**
 * True north as a unit vector in the plan frame: planDirOfBearing(0) = (sin(0 − B), cos(0 − B)) with
 * B = Site.planNorthBearing (docs/architecture.md). For B = 106 it is (−0.961, −0.276): down-left on screen.
 */
export function northInPlan(planNorthBearing: number): Vec2 {
  const r = (-planNorthBearing * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}

/** The same vector on screen (y down). */
export function northOnScreen(planNorthBearing: number): Vec2 {
  const [x, y] = northInPlan(planNorthBearing);
  return [x, -y];
}

/**
 * 45° hatch segments (SW→NE in plan) clipped to the axis-aligned rectangle [min, max], `spacing` metres apart
 * (perpendicular distance). Empty for a degenerate rectangle or spacing.
 */
export function hatchSegments(min: Vec2, max: Vec2, spacing: number): [Vec2, Vec2][] {
  const w = max[0] - min[0];
  const h = max[1] - min[1];
  const out: [Vec2, Vec2][] = [];
  if (!(w > 0) || !(h > 0) || !(spacing > 0)) return out;
  // Local lines y = x − c; c runs over (−h, w) in steps of spacing·√2 (horizontal distance between lines).
  const step = spacing * Math.SQRT2;
  for (let c = -h + step / 2; c < w; c += step) {
    const lo = Math.max(0, c);
    const hi = Math.min(w, h + c);
    if (hi - lo < 1e-9) continue;
    out.push([
      [min[0] + lo, min[1] + lo - c],
      [min[0] + hi, min[1] + hi - c],
    ]);
  }
  return out;
}

/** Arrow head (filled triangle, tip first) at `b` pointing along a→b, `size` long. Empty when a ≈ b. */
export function arrowHead(a: Vec2, b: Vec2, size: number): Vec2[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9 || !(size > 0)) return [];
  const ux = dx / len;
  const uy = dy / len;
  const w = size * 0.45;
  return [b, [b[0] - ux * size - uy * w, b[1] - uy * size + ux * w], [b[0] - ux * size + uy * w, b[1] - uy * size - ux * w]];
}

/** A string usable as an SVG/XML id and inside url(#…): `prefix-` + `raw` with every other character dropped. */
export function domId(prefix: string, raw: string): string {
  return `${prefix}-${raw.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

/**
 * Thin rectangle (CCW for a→b) of half-width `half` around the segment a–b; stroked it draws as a double line
 * with closed ends (railings). Empty when a ≈ b. Accepts 3D points (z ignored).
 */
export function bandRect(a: readonly number[], b: readonly number[], half: number): Vec2[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [];
  const nx = (-dy / len) * half;
  const ny = (dx / len) * half;
  return [
    [a[0] - nx, a[1] - ny],
    [b[0] - nx, b[1] - ny],
    [b[0] + nx, b[1] + ny],
    [a[0] + nx, a[1] + ny],
  ];
}
