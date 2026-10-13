/**
 * How well the IFC overlay lines up with the model's walls (align.real.test.ts on the architect's file; pure, so it
 * could also back a later «sjekk plasseringen» readout). Works on IFC wall sections already mapped to the plan frame.
 *
 * - `measureFaces`: along each wall's outer (cladding) and inner (gypsum) face, every `step` metres and `endMargin`
 *   clear of the ends, the IFC wall section edges parallel to the face, over the sample and within `window` of it,
 *   after merging collinear pieces into runs and keeping runs of at least `minRun` (so the end faces of partitions
 *   that meet the wall and the reveals of doors through it do not count). The offset is the outermost run (outer face:
 *   the cladding; the wall's other layers lie inside it) or the one furthest into the room (inner face), positive
 *   outwards / into the room. Skipped: samples in a door or other opening down to the floor (± 0.1 m, removed ones
 *   included — the building still has them; windows are not skipped, the caller cuts the walls above or below them)
 *   and samples within 0.1 m of another wall's footprint (`obstacles`: where a partition or another block's wall meets
 *   the face, the face is interrupted). Samples with no run there count as unmatched.
 * - `strayEdges`: IFC wall edges outside every block's axis polygon (the cladding zone around the house) and how far
 *   they stick out of the given wall footprints.
 */
import type { DerivedBlock, DerivedWall } from '../model/derived';
import type { Vec2 } from '../model/types';
import { distancePointSegment, pointInPolygon } from '../geometry/polygon';
import { ifcToPlan } from './transform';
import type { IfcTransform } from './transform';

export interface FaceFit {
  wallId: string;
  face: 'outer' | 'inner';
  /** Face line in the plan. */
  a: Vec2;
  b: Vec2;
  samples: number;
  matched: number;
  /** Median of the matched samples' signed offsets (m). */
  median: number;
  maxAbs: number;
}

export interface StrayEdge {
  a: Vec2;
  b: Vec2;
  /** Distance of the edge's farther end from the nearest footprint (0 inside). */
  distance: number;
}

/** IFC section segments [u0, v0, u1, v1, …] mapped to the plan. */
export function segmentsToPlan(t: IfcTransform, segs: ArrayLike<number>): Float64Array {
  const out = new Float64Array(segs.length);
  for (let i = 0; i + 3 < segs.length; i += 4) {
    const p = ifcToPlan(t, segs[i], segs[i + 1]);
    const q = ifcToPlan(t, segs[i + 2], segs[i + 3]);
    out[i] = p[0];
    out[i + 1] = p[1];
    out[i + 2] = q[0];
    out[i + 3] = q[1];
  }
  return out;
}

/** Samples this close to a door's jambs or to another wall are skipped. */
const SKIP_MARGIN = 0.1;

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Collinear segments merged into maximal runs: grouped by direction (0.1°) and line offset (1 mm), overlapping or
 * touching pieces (gap ≤ `tol`) joined.
 */
export function mergeCollinear(plan: ArrayLike<number>, tol = 1e-3): Float64Array {
  const groups = new Map<string, { c: number; s: number; off: number; spans: [number, number][] }>();
  for (let i = 0; i + 3 < plan.length; i += 4) {
    const ex = plan[i + 2] - plan[i];
    const ey = plan[i + 3] - plan[i + 1];
    if (Math.hypot(ex, ey) < 1e-9) continue;
    let ang = Math.atan2(ey, ex);
    if (ang < 0) ang += Math.PI;
    if (ang >= Math.PI - 1e-9) ang -= Math.PI;
    const deg = Math.round((ang * 1800) / Math.PI);
    const a = ((deg % 1800) * Math.PI) / 1800;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const off = Math.round((-sn * plan[i] + c * plan[i + 1]) * 1000) / 1000;
    const key = `${deg % 1800}|${off}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { c, s: sn, off, spans: [] }));
    const t0 = c * plan[i] + sn * plan[i + 1];
    const t1 = c * plan[i + 2] + sn * plan[i + 3];
    g.spans.push(t0 < t1 ? [t0, t1] : [t1, t0]);
  }
  const out: number[] = [];
  for (const g of groups.values()) {
    g.spans.sort((p, q) => p[0] - q[0]);
    let [lo, hi] = g.spans[0];
    const emit = () => out.push(g.c * lo - g.s * g.off, g.s * lo + g.c * g.off, g.c * hi - g.s * g.off, g.s * hi + g.c * g.off);
    for (let k = 1; k < g.spans.length; k++) {
      const [p, q] = g.spans[k];
      if (p <= hi + tol) hi = Math.max(hi, q);
      else {
        emit();
        [lo, hi] = [p, q];
      }
    }
    emit();
  }
  return Float64Array.from(out);
}

export function measureFaces(
  plan: ArrayLike<number>,
  walls: DerivedWall[],
  opts: { step?: number; endMargin?: number; window?: number; maxAngleDeg?: number; minRun?: number; obstacles?: Vec2[][] } = {},
): FaceFit[] {
  const step = opts.step ?? 0.2;
  const endMargin = opts.endMargin ?? 0.3;
  const window = opts.window ?? 0.25;
  const minRun = opts.minRun ?? 0.3;
  const sinMax = Math.sin(((opts.maxAngleDeg ?? 2) * Math.PI) / 180);
  const merged = mergeCollinear(plan);
  const runs: number[] = [];
  for (let i = 0; i + 3 < merged.length; i += 4) {
    if (Math.hypot(merged[i + 2] - merged[i], merged[i + 3] - merged[i + 1]) >= minRun) runs.push(merged[i], merged[i + 1], merged[i + 2], merged[i + 3]);
  }
  const out: FaceFit[] = [];
  for (const w of walls) {
    const dx = w.b[0] - w.a[0];
    const dy = w.b[1] - w.a[1];
    const len = Math.hypot(dx, dy);
    if (len < 2 * endMargin + 1e-9) continue;
    const d: Vec2 = [dx / len, dy / len];
    const left: Vec2 = [-d[1], d[0]];
    const right: Vec2 = [d[1], -d[0]];
    // Exterior pieces: the right side is outside (faceRight = the cladding), the left side inside (faceLeft = gypsum).
    for (const face of ['outer', 'inner'] as const) {
      const n = face === 'outer' ? right : left;
      const off = face === 'outer' ? w.faceRight : w.faceLeft;
      const a: Vec2 = [w.a[0] + n[0] * off, w.a[1] + n[1] * off];
      const b: Vec2 = [w.b[0] + n[0] * off, w.b[1] + n[1] * off];
      const offsets: number[] = [];
      let samples = 0;
      for (let s = endMargin; s <= len - endMargin + 1e-9; s += step) {
        if (w.openings.some((o) => o.type !== 'window' && Math.abs(s - o.offset) < o.width / 2 + SKIP_MARGIN)) continue;
        const p: Vec2 = [a[0] + d[0] * s, a[1] + d[1] * s];
        if (opts.obstacles?.some((f) => f !== w.footprint && distanceToPolygon(p, f) <= SKIP_MARGIN)) continue;
        samples++;
        let best = -Infinity;
        for (let i = 0; i + 3 < runs.length; i += 4) {
          const ex = runs[i + 2] - runs[i];
          const ey = runs[i + 3] - runs[i + 1];
          const el = Math.hypot(ex, ey);
          if (Math.abs((ex * d[1] - ey * d[0]) / el) > sinMax) continue;
          const t = ((p[0] - runs[i]) * ex + (p[1] - runs[i + 1]) * ey) / el;
          if (t < -0.005 || t > el + 0.005) continue;
          const delta = (runs[i] - p[0]) * n[0] + (runs[i + 1] - p[1]) * n[1];
          if (Math.abs(delta) <= window && delta > best) best = delta;
        }
        if (best > -Infinity) offsets.push(best);
      }
      out.push({
        wallId: w.id,
        face,
        a,
        b,
        samples,
        matched: offsets.length,
        median: median(offsets),
        maxAbs: offsets.reduce((m, o) => Math.max(m, Math.abs(o)), 0),
      });
    }
  }
  return out;
}

function distanceToPolygon(p: Vec2, poly: Vec2[]): number {
  if (poly.length < 3) return Infinity;
  if (pointInPolygon(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distancePointSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

export function strayEdges(plan: ArrayLike<number>, blocks: DerivedBlock[], footprints: Vec2[][], minLength = 0.2): StrayEdge[] {
  const out: StrayEdge[] = [];
  const dist = (p: Vec2) => footprints.reduce((m, f) => Math.min(m, distanceToPolygon(p, f)), Infinity);
  for (let i = 0; i + 3 < plan.length; i += 4) {
    const a: Vec2 = [plan[i], plan[i + 1]];
    const b: Vec2 = [plan[i + 2], plan[i + 3]];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minLength) continue;
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (blocks.some((bl) => pointInPolygon(mid, bl.axis))) continue;
    out.push({ a, b, distance: Math.max(dist(a), dist(b)) });
  }
  return out;
}
