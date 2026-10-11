/**
 * Shared 2D polygon toolkit (plan frame, metres). Pure functions: no React, no three.
 *
 * Conventions
 *  - A polygon is an OPEN ring `Vec2[]` (the closing point is not repeated). Every function tolerates a repeated
 *    closing point and zero-length edges. The model's polygons are CCW; "outward" of an edge is its right side
 *    (dy, -dx) for a CCW polygon.
 *  - `Vec2[][]` arguments of the boolean operations are LISTS OF SIMPLE POLYGONS (one outer ring each, no holes;
 *    they may overlap or touch). Results are MultiPolygons `[poly][ring][pt]` with open rings, ring 0 = outer
 *    (CCW), further rings = holes (CW) — polygon-clipping's shape minus the closing points.
 *
 * Decisions where docs/architecture.md is silent
 *  - Offsets use mitre joins. A join is bevelled (the two offset endpoints are inserted instead of the mitre tip)
 *    when the adjacent edges are parallel (|sin| < 1e-6) or when the tip would lie farther than MITRE_LIMIT (4,
 *    the SVG default) × max|d| from the vertex, i.e. for interior angles below ~29° with a uniform offset. For
 *    collinear edges with different per-edge distances this yields the "step" of the two offset endpoints.
 *    No self-intersection clean-up is done for large inward offsets. Fewer than 3 distinct vertices → [].
 *  - `offsetPolygonPerEdge` keeps the input orientation and the vertex order; for CW input the normals are mirrored
 *    so "outward" stays outward. Missing / non-finite distances count as 0. Zero-length edges are skipped (their
 *    distance is ignored); the other edges keep their index.
 *  - `collinearOverlap` defaults: eps = 0.01 m (max distance of b's endpoints from a's line AND minimum overlap
 *    length), angleEps = 0.5 degrees. Direction-agnostic; the result lies on a's line, ordered along a.
 *  - `labelPoint` is polylabel (Mapbox) with precision 0.05 m; polygons thinner than 0.05 m return the centroid.
 *  - `simplifyCollinear` measures the distance to the infinite line through the neighbours (spikes go too) and
 *    may return fewer than 3 points for degenerate input.
 *  - polygon-clipping only has a default export at runtime (its .d.ts declares named exports), hence the default
 *    import below. This module is the ONLY caller of polygon-clipping: every input coordinate is snapped to a 1e-7 m
 *    grid first, a failing operation is retried on coarser grids (1e-6 … 1e-4 m) and then throws `ClipError`, which
 *    the derive pipeline catches with a local fallback (`withClipFallback`), so one bad operation never blanks the
 *    whole model. `unionMulti` / `intersectMulti` / `differenceMulti` take MultiPolygons with holes.
 */
import polygonClipping from 'polygon-clipping';
import type { MultiPolygon } from 'polygon-clipping';
import type { Vec2 } from '../model/types';

export const EPS = 1e-6;

/** Tolerance for "point on the boundary" in pointInPolygon. */
const BOUNDARY_EPS = 1e-9;
/** A mitre tip farther than this × max|d| from the vertex is replaced by a bevel. */
const MITRE_LIMIT = 4;
/** |sin(angle)| below which two consecutive edges count as parallel in the offset functions. */
const PARALLEL_SIN = 1e-6;
/** Relative |sin(angle)| below which two lines count as parallel in the intersection functions. */
const LINE_PARALLEL_SIN = 1e-9;
/** polylabel precision (m). */
const LABEL_PRECISION = 0.05;

// ---------------------------------------------------------------------------
// Vector helpers (internal)
// ---------------------------------------------------------------------------

function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

function addScaled(a: Vec2, v: Vec2, s: number): Vec2 {
  return [a[0] + v[0] * s, a[1] + v[1] * s];
}

function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

function cross(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}

function length(v: Vec2): number {
  return Math.hypot(v[0], v[1]);
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Drops consecutive duplicates (within EPS) and a repeated closing point. May return fewer than 3 points. */
function cleanRing(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last === undefined || distance(last, p) > EPS) out.push(p);
  }
  while (out.length > 1 && distance(out[0], out[out.length - 1]) <= EPS) out.pop();
  return out;
}

// ---------------------------------------------------------------------------
// Area, orientation, centroid, bbox
// ---------------------------------------------------------------------------

/** Shoelace area; > 0 for CCW. 0 for fewer than 3 points. */
export function signedArea(poly: Vec2[]): number {
  const n = poly.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return s / 2;
}

export function area(poly: Vec2[]): number {
  return Math.abs(signedArea(poly));
}

export function isCCW(poly: Vec2[]): boolean {
  return signedArea(poly) > 0;
}

/** Returns the SAME array when it is already CCW (or degenerate), otherwise a reversed copy. */
export function ensureCCW(poly: Vec2[]): Vec2[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

/** Area-weighted centroid; mean of the vertices for degenerate (zero-area) input; [0, 0] for no points. */
export function centroid(poly: Vec2[]): Vec2 {
  const n = poly.length;
  if (n === 0) return [0, 0];
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p[0];
      sy += p[1];
    }
    return [sx / n, sy / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    cx += (poly[j][0] + poly[i][0]) * f;
    cy += (poly[j][1] + poly[i][1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** Axis-aligned bounding box; { min: [0,0], max: [0,0] } for no points. */
export function bbox(poly: Vec2[]): { min: Vec2; max: Vec2 } {
  if (poly.length === 0) return { min: [0, 0], max: [0, 0] };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of poly) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { min: [x0, y0], max: [x1, y1] };
}

// ---------------------------------------------------------------------------
// Point in polygon
// ---------------------------------------------------------------------------

/** Even-odd test with an inclusive boundary (points within 1e-9 of an edge count as inside). Any orientation. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if (distancePointSegment(p, poly[j], poly[i]) <= BOUNDARY_EPS) return true;
  }
  return rayCast(p, poly);
}

/** Even-odd ray cast towards +x (boundary behaviour unspecified; callers handle the boundary first). */
function rayCast(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < xi + ((p[1] - yi) * (xj - xi)) / (yj - yi)) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Offsets
// ---------------------------------------------------------------------------

interface OffsetEdge {
  a: Vec2;
  b: Vec2;
  /** Unit direction a → b. */
  u: Vec2;
  /** Unit outward normal (right side for CCW input). */
  n: Vec2;
  /** Signed offset distance along `n`. */
  d: number;
}

/** Builds the non-degenerate edges of `poly` with their offset distances (edge i = vertex i → i+1). */
function offsetEdges(poly: Vec2[], distanceOf: (edgeIndex: number) => number): OffsetEdge[] {
  const n = poly.length;
  const sign = signedArea(poly) < 0 ? -1 : 1;
  const edges: OffsetEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const v = sub(b, a);
    const len = length(v);
    if (len < EPS) continue;
    const u: Vec2 = [v[0] / len, v[1] / len];
    const d = distanceOf(i);
    edges.push({ a, b, u, n: [sign * u[1], -sign * u[0]], d: Number.isFinite(d) ? d : 0 });
  }
  return edges;
}

/** Mitre tip of the two offset lines, or null when the join must be bevelled (parallel edges or tip too far). */
function mitrePoint(prev: OffsetEdge, cur: OffsetEdge, prevEnd: Vec2, curStart: Vec2): Vec2 | null {
  if (Math.abs(cross(prev.u, cur.u)) < PARALLEL_SIN) return null;
  const tip = lineIntersection(prevEnd, prev.u, curStart, cur.u);
  if (tip === null) return null;
  const maxAbs = Math.max(Math.abs(prev.d), Math.abs(cur.d));
  return distance(tip, cur.a) <= MITRE_LIMIT * maxAbs + EPS ? tip : null;
}

/** Joins consecutive offset edges (mitre or bevel). Fewer than 3 edges → []. */
function joinOffsetEdges(edges: OffsetEdge[]): Vec2[] {
  const m = edges.length;
  if (m < 3) return [];
  const out: Vec2[] = [];
  for (let i = 0; i < m; i++) {
    const prev = edges[(i + m - 1) % m];
    const cur = edges[i];
    const prevEnd = addScaled(prev.b, prev.n, prev.d);
    const curStart = addScaled(cur.a, cur.n, cur.d);
    const tip = mitrePoint(prev, cur, prevEnd, curStart);
    if (tip !== null) out.push(tip);
    else out.push(prevEnd, curStart);
  }
  const ring = cleanRing(out);
  return ring.length < 3 ? [] : ring;
}

/**
 * Uniform offset with mitre joins (bevel for very sharp corners). d > 0 grows the polygon, d < 0 shrinks it,
 * whatever the input orientation; the result is CCW. Fewer than 3 distinct vertices → [].
 */
export function offsetPolygon(poly: Vec2[], d: number): Vec2[] {
  const ring = ensureCCW(cleanRing(poly));
  if (ring.length < 3) return [];
  return ensureCCW(joinOffsetEdges(offsetEdges(ring, () => d)));
}

/**
 * Per-edge offset: `outward[i]` is the outward distance of edge i (vertex i → i+1), negative = inward.
 * Non-parallel neighbours meet at the mitre (vertex i of the result corresponds to vertex i of the input);
 * parallel / collinear neighbours (and extreme spikes) insert the two offset endpoints instead. Never NaN.
 */
export function offsetPolygonPerEdge(poly: Vec2[], outward: number[]): Vec2[] {
  return joinOffsetEdges(offsetEdges(poly, (i) => (i < outward.length ? outward[i] : 0)));
}

// ---------------------------------------------------------------------------
// Boolean operations (polygon-clipping) — the only module that calls polygon-clipping
// ---------------------------------------------------------------------------

/** MultiPolygon `[poly][ring][pt]` with open rings, ring 0 = outer, further rings = holes. */
export type MultiPoly = Vec2[][][];

/**
 * Snap grids (m) tried in order. Every input coordinate is rounded to the grid before polygon-clipping sees it, so
 * nearly coincident vertices and edges from rounding noise (rotated or dragged geometry) become exactly coincident;
 * polygon-clipping 0.15 throws on such near-misses ("Unable to complete output ring…"). When an operation still
 * throws it is retried on the next, coarser grid (at most 0.1 mm of change), then a `ClipError` is thrown.
 */
const SNAP_GRIDS = [1e-7, 1e-6, 1e-5, 1e-4];

/** A boolean operation that failed on every snap grid. Callers catch it and fall back (never out of derive). */
export class ClipError extends Error {
  constructor(op: string, cause: unknown) {
    super(`polygon-clipping ${op} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'ClipError';
  }
}

type ClipOp = 'union' | 'intersection' | 'difference';

/** Ring rounded to the grid 1 / inv, consecutive duplicates and the closing point removed; null when degenerate. */
function snapRing(ring: Vec2[], inv: number): Vec2[] | null {
  const out: Vec2[] = [];
  for (const p of cleanRing(ring)) {
    const x = Math.round(p[0] * inv) / inv;
    const y = Math.round(p[1] * inv) / inv;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const last = out[out.length - 1];
    if (last === undefined || last[0] !== x || last[1] !== y) out.push([x === 0 ? 0 : x, y === 0 ? 0 : y]);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out.length >= 3 && signedArea(out) !== 0 ? out : null;
}

function snapGeom(mp: MultiPoly, inv: number): MultiPolygon {
  const geom: MultiPolygon = [];
  for (const poly of mp) {
    const outer = poly.length > 0 ? snapRing(poly[0], inv) : null;
    if (outer === null) continue;
    const holes: Vec2[][] = [];
    for (const h of poly.slice(1)) {
      const r = snapRing(h, inv);
      if (r !== null) holes.push(r);
    }
    geom.push([outer, ...holes]);
  }
  return geom;
}

/** polygon-clipping output (closed rings) → open rings. */
function fromGeom(mp: MultiPolygon): MultiPoly {
  return mp.map((poly) => poly.map((ring) => cleanRing(ring.map((p): Vec2 => [p[0], p[1]]))));
}

/** One attempt on one grid; null = nothing to compute (empty result). */
function clipOnce(op: ClipOp, subject: MultiPoly, others: MultiPoly[], inv: number): MultiPoly {
  const s = snapGeom(subject, inv);
  const o = others.map((g) => snapGeom(g, inv));
  if (op === 'union') {
    const all = [s, ...o].filter((g) => g.length > 0);
    if (all.length === 0) return [];
    return fromGeom(polygonClipping.union(all[0], ...all.slice(1)));
  }
  if (s.length === 0) return [];
  if (op === 'intersection') {
    if (o.length === 0 || o.some((g) => g.length === 0)) return [];
    return fromGeom(polygonClipping.intersection(s, ...o));
  }
  const cut = o.filter((g) => g.length > 0);
  return fromGeom(cut.length === 0 ? polygonClipping.union(s) : polygonClipping.difference(s, ...cut));
}

/** Runs a boolean operation on snapped input, retrying on coarser grids; throws `ClipError` when all fail. */
function clip(op: ClipOp, subject: MultiPoly, others: MultiPoly[]): MultiPoly {
  let last: unknown;
  for (const grid of SNAP_GRIDS) {
    try {
      return clipOnce(op, subject, others, Math.round(1 / grid));
    } catch (e) {
      last = e;
    }
  }
  throw new ClipError(op, last);
}

/** Union of MultiPolygons (holes respected). [] for no usable input. Throws `ClipError` only when every grid fails. */
export function unionMulti(...mps: MultiPoly[]): MultiPoly {
  if (mps.length === 0) return [];
  return clip('union', mps[0], mps.slice(1));
}

/** Intersection of MultiPolygons (holes respected). [] when any side is empty. */
export function intersectMulti(a: MultiPoly, ...b: MultiPoly[]): MultiPoly {
  return clip('intersection', a, b);
}

/** a minus the others (holes respected). [] when a is empty; the normalised union of a when nothing is subtracted. */
export function differenceMulti(a: MultiPoly, ...b: MultiPoly[]): MultiPoly {
  return clip('difference', a, b);
}

/** Lists of simple polygons → one MultiPolygon. */
const asMulti = (polys: Vec2[][]): MultiPoly => polys.map((p) => [p]);

/** Union of simple polygons as a MultiPolygon (holes respected). [] for no usable input. Never throws on empty input. */
export function unionPolygons(polys: Vec2[][]): Vec2[][][] {
  return clip('union', asMulti(polys), []);
}

/** Area of the union of simple polygons (overlaps counted once). */
export function unionArea(polys: Vec2[][]): number {
  return multiPolygonArea(unionPolygons(polys));
}

/** Intersection of two lists of simple polygons. [] when either side is empty. */
export function intersectPolygons(a: Vec2[][], b: Vec2[][]): Vec2[][][] {
  return clip('intersection', asMulti(a), [asMulti(b)]);
}

/** a minus b for two lists of simple polygons. [] when a is empty; the normalised union of a when b is empty. */
export function differencePolygons(a: Vec2[][], b: Vec2[][]): Vec2[][][] {
  return clip('difference', asMulti(a), [asMulti(b)]);
}

/** Where fallbacks taken by `withClipFallback` are reported while `collectClipFallbacks` runs (synchronous scope). */
let fallbackSink: ((where: string, error: ClipError) => void) | null = null;

/**
 * `fn()`, or `fallback(error)` when a boolean operation inside it failed on every grid (`ClipError`; other errors
 * propagate). `where` names the step for the fallback report (see `collectClipFallbacks`).
 */
export function withClipFallback<T>(where: string, fn: () => T, fallback: (error: ClipError) => T): T {
  try {
    return fn();
  } catch (e) {
    if (!(e instanceof ClipError)) throw e;
    fallbackSink?.(where, e);
    return fallback(e);
  }
}

/** Runs `fn` and returns its result with every `withClipFallback` fallback taken meanwhile (in order, nested scopes too). */
export function collectClipFallbacks<T>(fn: () => T): { result: T; fallbacks: { where: string; message: string }[] } {
  const previous = fallbackSink;
  const fallbacks: { where: string; message: string }[] = [];
  fallbackSink = (where, error) => {
    fallbacks.push({ where, message: error.message });
    previous?.(where, error);
  };
  try {
    return { result: fn(), fallbacks };
  } finally {
    fallbackSink = previous;
  }
}

/** Area of a MultiPolygon: outer rings minus holes (orientation-agnostic). */
export function multiPolygonArea(mp: Vec2[][][]): number {
  let total = 0;
  for (const poly of mp) {
    for (let r = 0; r < poly.length; r++) total += r === 0 ? area(poly[r]) : -area(poly[r]);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Segments and lines
// ---------------------------------------------------------------------------

/**
 * Proper intersection of two segments, inclusive of the endpoints (tolerance EPS in metres). Parallel and
 * collinear segments give null; `ta`/`tb` are clamped to [0, 1] and `point` lies on segment a.
 */
export function segmentIntersection(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
): { point: Vec2; ta: number; tb: number } | null {
  const da = sub(a2, a1);
  const db = sub(b2, b1);
  const la = length(da);
  const lb = length(db);
  if (la < EPS || lb < EPS) return null;
  const denom = cross(da, db);
  if (Math.abs(denom) <= LINE_PARALLEL_SIN * la * lb) return null;
  const w = sub(b1, a1);
  const ta = cross(w, db) / denom;
  const tb = cross(w, da) / denom;
  const tolA = EPS / la;
  const tolB = EPS / lb;
  if (ta < -tolA || ta > 1 + tolA || tb < -tolB || tb > 1 + tolB) return null;
  const sa = clamp01(ta);
  return { point: addScaled(a1, da, sa), ta: sa, tb: clamp01(tb) };
}

/** Intersection of the infinite lines p1 + t·d1 and p2 + s·d2; null when parallel or a direction is zero. */
export function lineIntersection(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const denom = cross(d1, d2);
  if (Math.abs(denom) <= LINE_PARALLEL_SIN * length(d1) * length(d2)) return null;
  const t = cross(sub(p2, p1), d2) / denom;
  return addScaled(p1, d1, t);
}

/** Closest point on segment a–b to p, with its parameter t in [0, 1]. A degenerate segment gives a (t = 0). */
export function projectPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; point: Vec2 } {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 < EPS * EPS) return { t: 0, point: [a[0], a[1]] };
  const t = clamp01(dot(sub(p, a), d) / l2);
  return { t, point: addScaled(a, d, t) };
}

export function distancePointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return distance(p, projectPointOnSegment(p, a, b).point);
}

/**
 * Shared sub-segment of two (nearly) collinear segments, or null. Collinear = both endpoints of b within `eps`
 * (m) of a's line and the directions within `angleEps` (degrees) modulo 180°; overlaps of length ≤ eps give null.
 * The result lies on a's line, ordered along a1 → a2, whatever b's direction.
 */
export function collinearOverlap(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
  eps = 0.01,
  angleEps = 0.5,
): [Vec2, Vec2] | null {
  const da = sub(a2, a1);
  const db = sub(b2, b1);
  const la = length(da);
  const lb = length(db);
  if (la < EPS || lb < EPS) return null;
  const ua: Vec2 = [da[0] / la, da[1] / la];
  const ub: Vec2 = [db[0] / lb, db[1] / lb];
  const angle = Math.atan2(Math.abs(cross(ua, ub)), Math.abs(dot(ua, ub)));
  if (angle > (angleEps * Math.PI) / 180) return null;
  const w1 = sub(b1, a1);
  const w2 = sub(b2, a1);
  if (Math.abs(cross(ua, w1)) > eps || Math.abs(cross(ua, w2)) > eps) return null;
  const s1 = dot(ua, w1);
  const s2 = dot(ua, w2);
  const lo = Math.max(0, Math.min(s1, s2));
  const hi = Math.min(la, Math.max(s1, s2));
  if (hi - lo <= eps) return null;
  return [addScaled(a1, ua, lo), addScaled(a1, ua, hi)];
}

/**
 * Whether the boundary of a closed polygon crosses or touches itself: two non-adjacent edges intersect (endpoints
 * inclusive, EPS) or overlap, or two adjacent edges fold back onto each other. Consecutive duplicate vertices are
 * ignored. Fewer than 4 distinct vertices → false.
 */
export function isSelfIntersecting(poly: Vec2[]): boolean {
  const ring = cleanRing(poly);
  const n = ring.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const c = ring[j];
      const d = ring[(j + 1) % n];
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (collinearOverlap(a, b, c, d, EPS, 1e-3) !== null) return true;
      if (!adjacent && segmentIntersection(a, b, c, d) !== null) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Label point (polylabel)
// ---------------------------------------------------------------------------

interface Cell {
  x: number;
  y: number;
  /** Half size. */
  h: number;
  /** Signed distance from the centre to the polygon boundary. */
  d: number;
  /** Upper bound of the distance inside the cell. */
  max: number;
}

/** Binary max-heap on `max`. */
class CellHeap {
  private readonly items: Cell[] = [];

  push(c: Cell): void {
    const items = this.items;
    items.push(c);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].max >= c.max) break;
      items[i] = items[parent];
      i = parent;
    }
    items[i] = c;
  }

  pop(): Cell | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (last === undefined || items.length === 0) return top;
    let i = 0;
    const n = items.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = -1;
      if (l < n && items[l].max > last.max) m = l;
      if (r < n && items[r].max > (m === -1 ? last.max : items[m].max)) m = r;
      if (m === -1) break;
      items[i] = items[m];
      i = m;
    }
    items[i] = last;
    return top;
  }
}

/** Signed distance from p to the boundary of the polygon with holes: > 0 inside, < 0 outside. */
function signedDistance(p: Vec2, rings: Vec2[][]): number {
  let inside = false;
  let minD = Infinity;
  for (const ring of rings) {
    if (rayCast(p, ring)) inside = !inside;
    const n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const d = distancePointSegment(p, ring[j], ring[i]);
      if (d < minD) minD = d;
    }
  }
  return (inside ? 1 : -1) * minD;
}

function makeCell(x: number, y: number, h: number, rings: Vec2[][]): Cell {
  const d = signedDistance([x, y], rings);
  return { x, y, h, d, max: d + h * Math.SQRT2 };
}

/**
 * Pole of inaccessibility (polylabel: grid + cell halving, precision 0.05 m) of a polygon with optional holes.
 * Degenerate input (fewer than 3 points, or thinner than 0.05 m) returns the centroid.
 */
export function labelPoint(poly: Vec2[], holes: Vec2[][] = []): Vec2 {
  const outer = cleanRing(poly);
  if (outer.length < 3) return centroid(poly);
  const rings = [outer, ...holes.map(cleanRing).filter((h) => h.length >= 3)];
  const { min, max } = bbox(outer);
  const w = max[0] - min[0];
  const h = max[1] - min[1];
  const cellSize = Math.min(w, h);
  if (cellSize < LABEL_PRECISION) return centroid(outer);

  const heap = new CellHeap();
  const half = cellSize / 2;
  for (let x = min[0]; x < max[0]; x += cellSize) {
    for (let y = min[1]; y < max[1]; y += cellSize) heap.push(makeCell(x + half, y + half, half, rings));
  }
  const c = centroid(outer);
  let best = makeCell(c[0], c[1], 0, rings);
  const boxCentre = makeCell(min[0] + w / 2, min[1] + h / 2, 0, rings);
  if (boxCentre.d > best.d) best = boxCentre;

  for (let cell = heap.pop(); cell !== undefined; cell = heap.pop()) {
    if (cell.d > best.d) best = cell;
    // The heap is ordered by `max`: nothing left can beat `best` by more than the precision.
    if (cell.max - best.d <= LABEL_PRECISION) break;
    const q = cell.h / 2;
    heap.push(makeCell(cell.x - q, cell.y - q, q, rings));
    heap.push(makeCell(cell.x + q, cell.y - q, q, rings));
    heap.push(makeCell(cell.x - q, cell.y + q, q, rings));
    heap.push(makeCell(cell.x + q, cell.y + q, q, rings));
  }
  return [best.x, best.y];
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Bounding-box dimensions; `approx` when the polygon area differs from the box area by more than 2 %. */
export function rectDims(poly: Vec2[]): { w: number; h: number; approx: boolean } {
  const { min, max } = bbox(poly);
  const w = max[0] - min[0];
  const h = max[1] - min[1];
  const boxArea = w * h;
  const approx = boxArea > 0 && Math.abs(area(poly) - boxArea) / boxArea > 0.02;
  return { w, h, approx };
}

/** Distance from p to the infinite line through a and b (distance to a when a ≈ b). */
function distancePointLine(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const len = length(d);
  if (len < EPS) return distance(p, a);
  return Math.abs(cross(d, sub(p, a))) / len;
}

/**
 * Removes duplicate vertices and vertices within `eps` of the line through their neighbours (iterated until
 * stable). A spike tip whose neighbours coincide (within eps) is removed as well, together with the duplicate it
 * leaves behind. Degenerate input may yield fewer than 3 points.
 */
export function simplifyCollinear(poly: Vec2[], eps = EPS): Vec2[] {
  let pts = cleanRing(poly);
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    const next: Vec2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = next.length > 0 ? next[next.length - 1] : pts[pts.length - 1];
      const cur = pts[i];
      const nxt = pts[(i + 1) % pts.length];
      const redundant =
        distance(prev, cur) <= eps || distance(prev, nxt) <= eps || distancePointLine(cur, prev, nxt) <= eps;
      if (redundant) {
        changed = true;
        continue;
      }
      next.push(cur);
    }
    pts = next;
  }
  return pts;
}

/** 32-bit FNV-1a hash of the UTF-16 code units, as a base-36 string. Stable across runs and platforms. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
