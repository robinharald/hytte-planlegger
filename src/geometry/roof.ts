/**
 * Roofs (docs/architecture.md "Roof rules"): parameters, automatic ridge extension, slabs split at part boundaries,
 * ridge, trims, outline, and the underside queries used by walls, openings, chimney, areas and walk mode.
 * Plan frame, metres; every z is absolute (relative to the main floor). Pure functions, no React/three.
 *
 * Model
 *  - Gable: ridge along `ridgeAxis` (default 'x'), centred across the block's axis-line bbox. Underside = eaveZ at
 *    the axis line, ridgeZ at the ridge (drive 'pitch': ridge from pitchDeg; drive 'height': pitch from ridgeHeight
 *    over the half width). Two planar slopes; overhangEave beyond the eave axis lines.
 *  - Mono: slopes down towards `slopeTo` (default 'S'); its "ridge" is the high axis line (ridgeAxis = 'x' for slopeTo
 *    N/S, 'y' for E/W), the rise runs over the full width (`halfWidth` is still half the width). overhangEave on the
 *    low and high sides, gable overhang / extension on the ends.
 *  - Flat: underside = eaveZ, overhangEave on all four sides, no ridge, no extension (`extend` ignored), `facing` 'S'.
 *  - Top surface = underside + thickness (vertical). Slope polygons are top-surface outlines, CCW seen from above.
 *
 * Automatic ridge extension (per ridge-axis end, two passes)
 *  1. Base roofs of all blocks: no automatic extension (overhangGable, or the `Roof.extend` override at that end).
 *  2. An end is ADJACENT when the midpoint of the block's end edge (the ridge-axis end of its bbox, at mid-width) lies
 *     within 1 cm of an edge of another block's polygon. Then walk from the end edge along the ridge line in 1 cm
 *     steps up to 30 m and stop at the first step where the upper envelope of the OTHER base roofs' undersides
 *     reaches the own ridge underside; the crossing inside that step is refined by bisection. A roof whose ridge is
 *     within 1 cm of the own ridge counts as "equal" (it triggers at ridge − 1 cm) and the meeting point is then its
 *     ridge line. The extended region beyond the axis line is clipped in plan to the union of the other roofed
 *     blocks' polygons (their axis lines, i.e. inside their walls — not their roof outlines: a lower roof running in
 *     under a higher roof would otherwise poke out of the other block's gable under its overhang) and gets no barge
 *     board. Not found within 30 m → free gable (overhangGable) + `roof-no-meet`, unless every block at that end is a
     placed unit (`Block.template`: a shed, bod, … standing against a gable end is not meant to carry the ridge on;
     the gable simply rises above it, so no warning).
 *  3. `Roof.extend.start/end` replaces the distance at that end. If the end is adjacent, the region beyond the axis
 *     line is still clipped to the other blocks and carries no barge board; otherwise it is a free gable.
 *
 * Slabs never hang inside another block (review finding "roof slabs inside rooms")
 *  - Overhang strips (eave and gable overhangs: the slope region beyond the block's own bbox, extensions excluded)
 *    that fall inside another roofed block's axis polygon are dropped.
 *  - Valleys: every slope region then keeps only where its roof is the upper envelope, i.e. where its underside is
 *    ≥ the other roofs' undersides − ENVELOPE_TOL (1 cm). For planar slopes "another slope is higher" is a
 *    half-plane bounded by the line where the two planes meet, so each slope region loses exactly
 *    ∪ (other slope region ∩ that half-plane); both sides of a valley are cut along it (the extension slab and the
 *    receiving roof alike). Points under several roofs keep the highest one, so `combinedUndersideAt` is unchanged
 *    (up to the tolerance band) while no slab lies below another roof inside a room. Outlines follow the cut slabs.
 *
 * Robustness: every boolean operation has a local fallback (`withClipFallback`): unclipped other-block region,
 * no extension strip, no dropped overhang, no valley cut, unsplit slope (part splits), largest ring as outline.
 *
 * Decisions where the architecture is silent
 *  - The roof covers the block's axis-line BOUNDING BOX (+ overhangs/extensions); non-rectangular blocks get a
 *    rectangular roof (model L-shapes as two blocks).
 *  - Pitch is clamped to [0°, 85°]; the ridge is never below the eave (drive 'height' with a lower ridge → pitch 0).
 *    Degenerate blocks (< 3 points, zero area) give an empty roof (no slopes, no outline).
 *  - Parts: each part polygon (clipped to the block; the uncovered remainder is an implicit part that is new)
 *    is grown by pushing its edges that lie on the block boundary 100 m outwards (mitre joins), so overhangs and
 *    extensions belong to the part they continue. Earlier parts win where grown regions overlap; leftovers take
 *    `block.isNew`. Pieces with the same isNew are merged (existing pieces first, then new). Polygons with holes are
 *    cut into hole-free pieces along vertical lines through the holes.
 *  - Trims: a fascia along every eave line (mono: low and high edge; flat: all four sides) where it lies on the own
 *    outline and outside every other roof's final outline; barge boards along both slope edges of free gable ends.
 *  - The `blocks` argument of buildRoof/buildRoofs is accepted for the contract; everything is computed from
 *    `variant` (blocks, levels). Warnings: `roofWarnings(variant)` or `buildRoofsWithWarnings(variant)`.
 */
import type { Block, Cardinal, Roof, Variant, Vec2, Vec3, Level } from '../model/types';
import type { DerivedBlock, DerivedRoof, ModelWarning, RoofSlope } from '../model/derived';
import {
  EPS,
  area,
  bbox,
  differencePolygons,
  distancePointSegment,
  ensureCCW,
  intersectPolygons,
  lineIntersection,
  offsetPolygonPerEdge,
  pointInPolygon,
  projectPointOnSegment,
  segmentIntersection,
  simplifyCollinear,
  unionPolygons,
  withClipFallback,
} from './polygon';

const DEG = Math.PI / 180;
/** Max distance (m) of an end-edge midpoint from another block's edge to count as adjacent. */
const ADJ_TOL = 0.01;
/** Walk step and range (m) of the automatic extension. */
const WALK_STEP = 0.01;
const WALK_MAX = 30;
/** Ridges within this (m) count as equal. */
const EQUAL_RIDGE_TOL = 0.01;
const MAX_PITCH_DEG = 85;
/** How far (m) part edges on the block boundary are pushed out to cover overhangs and extensions. */
const PART_REACH = 100;
/** Slope pieces smaller than this (m²) are dropped (clipping slivers). */
const MIN_PIECE_AREA = 1e-4;
/** Trims shorter than this (m) are dropped. */
const MIN_TRIM_LEN = 1e-3;
/** Tolerance (m) for "a part edge lies on the block boundary". */
const ON_EDGE_TOL = 1e-5;
/** A slab is kept where its underside is at least the other roofs' undersides minus this (m). */
export const ENVELOPE_TOL = 0.01;

type Axis = 'x' | 'y';
type End = 'start' | 'end';

/** Underside plane z = a·x + b·y + c (plan coordinates, absolute z). */
interface Plane {
  a: number;
  b: number;
  c: number;
}

/** Block bbox in roof coordinates: u along the ridge axis, v across it. */
interface Frame {
  axis: Axis;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

interface SlopeDef {
  /** Across range of the slope including the eave overhang. */
  vLo: number;
  vHi: number;
  plane: Plane;
  facing: Cardinal;
  /** v of the slope edges that carry fascias. */
  fasciaV: number[];
}

export interface RoofParams {
  eaveZ: number;
  ridgeZ: number;
  pitchDeg: number;
  pitchRad: number;
  ridgeLine: { a: Vec2; b: Vec2 };
  halfWidth: number;
}

/** Distances (m) beyond the axis line at the low (start) and high (end) ridge-axis ends. */
export interface RidgeExtension {
  start: number;
  end: number;
  /** Free gable end: no adjacent block (barge board, no clipping). */
  startFree: boolean;
  endFree: boolean;
  /** Adjacent end whose ridge never met another roof within 30 m (warning `roof-no-meet`). */
  startNoMeet: boolean;
  endNoMeet: boolean;
}

interface RoofModel {
  block: Block;
  roof: Roof;
  points: Vec2[];
  frame: Frame;
  params: RoofParams;
  /** v of the extended line: gable ridge, mono high line, flat centre line. */
  ridgeV: number;
  overhang: number;
  slopes: SlopeDef[];
  degenerate: boolean;
}

/** A roof without automatic extension, for the extension walk and the clipping of extended regions. */
interface BaseShape {
  outline: Vec2[];
  planes: Plane[];
  ridgeZ: number;
  ridge: { a: Vec2; b: Vec2 } | null;
}

interface RoofContext {
  models: RoofModel[];
  base: (BaseShape | null)[];
  ext: RidgeExtension[];
}

interface SlabContext extends RoofContext {
  /** Per model, per slope def: hole-free CCW plan rings. */
  regions: Vec2[][][][];
  outlines: Vec2[][];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function fin(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function toPlan(axis: Axis, u: number, v: number): Vec2 {
  return axis === 'x' ? [u, v] : [v, u];
}

function alongDir(axis: Axis, sign: number): Vec2 {
  return axis === 'x' ? [sign, 0] : [0, sign];
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function rectRing(axis: Axis, u0: number, u1: number, v0: number, v1: number): Vec2[] {
  return ensureCCW([toPlan(axis, u0, v0), toPlan(axis, u1, v0), toPlan(axis, u1, v1), toPlan(axis, u0, v1)]);
}

function axisOf(roof: Roof): Axis {
  if (roof.type === 'mono') {
    const s = roof.slopeTo ?? 'S';
    return s === 'N' || s === 'S' ? 'x' : 'y';
  }
  return roof.type === 'gable' ? (roof.ridgeAxis ?? 'x') : 'x';
}

/** Mono roofs: is the low (eave) side at vMin? */
function monoLowAtMin(roof: Roof): boolean {
  const s = roof.slopeTo ?? 'S';
  return s === 'S' || s === 'W';
}

function frameOf(points: Vec2[], axis: Axis): Frame {
  const { min, max } = bbox(points);
  return axis === 'x'
    ? { axis, uMin: min[0], uMax: max[0], vMin: min[1], vMax: max[1] }
    : { axis, uMin: min[1], uMax: max[1], vMin: min[0], vMax: max[0] };
}

/** Plane z = k·v + c expressed in plan coordinates. */
function planeV(axis: Axis, k: number, c: number): Plane {
  return axis === 'x' ? { a: 0, b: k, c } : { a: k, b: 0, c };
}

function evalPlane(pl: Plane, p: Vec2): number {
  return pl.a * p[0] + pl.b * p[1] + pl.c;
}

/** Unit normal of the plane, pointing up. */
function planeNormal(pl: Plane): Vec3 {
  const l = Math.hypot(pl.a, pl.b, 1);
  return [pl.a === 0 ? 0 : -pl.a / l, pl.b === 0 ? 0 : -pl.b / l, 1 / l];
}

function levelElevation(levels: Level[], id: string): number {
  return fin(levels.find((l) => l.id === id)?.elevation, 0);
}

function nearPolygon(p: Vec2, poly: Vec2[], tol: number): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    if (distancePointSegment(p, poly[i], poly[(i + 1) % n]) <= tol) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Parameters and slope definitions
// ---------------------------------------------------------------------------

function paramsOf(block: Block, elevation: number): RoofParams & { ridgeV: number } {
  const roof = block.roof;
  const axis = axisOf(roof);
  const fr = frameOf(block.polygon.map((v) => v.p), axis);
  const eaveZ = elevation + fin(block.eaveHeight, 0);
  const halfWidth = (fr.vMax - fr.vMin) / 2;
  let ridgeV = (fr.vMin + fr.vMax) / 2;
  let ridgeZ = eaveZ;
  let pitchRad = 0;
  if (roof.type !== 'flat') {
    const run = roof.type === 'mono' ? 2 * halfWidth : halfWidth;
    if (roof.drive === 'height') {
      const rise = Math.max(0, elevation + fin(roof.ridgeHeight, 0) - eaveZ);
      ridgeZ = eaveZ + rise;
      pitchRad = run > 0 ? Math.atan2(rise, run) : 0;
    } else {
      pitchRad = clamp(fin(roof.pitchDeg, 0), 0, MAX_PITCH_DEG) * DEG;
      ridgeZ = eaveZ + Math.max(0, run) * Math.tan(pitchRad);
    }
    if (roof.type === 'mono') ridgeV = monoLowAtMin(roof) ? fr.vMax : fr.vMin;
  }
  return {
    eaveZ,
    ridgeZ,
    pitchDeg: pitchRad / DEG,
    pitchRad,
    ridgeLine: { a: toPlan(axis, fr.uMin, ridgeV), b: toPlan(axis, fr.uMax, ridgeV) },
    halfWidth,
    ridgeV,
  };
}

/**
 * Roof parameters of a block on its level: absolute eave/ridge underside z, effective pitch, ridge line over the
 * block's bbox (mono: the high axis line; flat: the centre line along x) and the half width across the ridge axis.
 */
export function roofParams(block: Block, level: Level): RoofParams {
  const { ridgeV: _ridgeV, ...params } = paramsOf(block, fin(level.elevation, 0));
  return params;
}

function slopeDefs(roof: Roof, fr: Frame, eaveZ: number, ridgeZ: number, o: number): SlopeDef[] {
  const { axis, vMin, vMax } = fr;
  if (roof.type === 'gable') {
    const half = (vMax - vMin) / 2;
    const k = half > 0 ? (ridgeZ - eaveZ) / half : 0;
    const [low, high]: Cardinal[] = axis === 'x' ? ['S', 'N'] : ['W', 'E'];
    return [
      { vLo: vMin - o, vHi: vMin + half, plane: planeV(axis, k, eaveZ - k * vMin), facing: low, fasciaV: [vMin - o] },
      { vLo: vMin + half, vHi: vMax + o, plane: planeV(axis, -k, eaveZ + k * vMax), facing: high, fasciaV: [vMax + o] },
    ];
  }
  const fascias = [vMin - o, vMax + o];
  if (roof.type === 'mono') {
    const w = vMax - vMin;
    const k = w > 0 ? (ridgeZ - eaveZ) / w : 0;
    const plane = monoLowAtMin(roof) ? planeV(axis, k, eaveZ - k * vMin) : planeV(axis, -k, eaveZ + k * vMax);
    return [{ vLo: vMin - o, vHi: vMax + o, plane, facing: roof.slopeTo ?? 'S', fasciaV: fascias }];
  }
  return [{ vLo: vMin - o, vHi: vMax + o, plane: planeV(axis, 0, eaveZ), facing: 'S', fasciaV: fascias }];
}

function modelOf(block: Block, elevation: number): RoofModel {
  const roof = block.roof;
  const points = block.polygon.map((v) => v.p);
  const frame = frameOf(points, axisOf(roof));
  const { ridgeV, ...params } = paramsOf(block, elevation);
  const overhang = fin(roof.overhangEave, 0);
  const degenerate =
    points.length < 3 ||
    area(points) < EPS ||
    frame.uMax - frame.uMin < EPS ||
    frame.vMax - frame.vMin + 2 * overhang < EPS;
  const slopes = slopeDefs(roof, frame, params.eaveZ, params.ridgeZ, overhang);
  return { block, roof, points, frame, params, ridgeV, overhang, slopes, degenerate };
}

// ---------------------------------------------------------------------------
// Base roofs and the automatic extension
// ---------------------------------------------------------------------------

function baseExtension(m: RoofModel): { start: number; end: number } {
  if (m.roof.type === 'flat') return { start: m.overhang, end: m.overhang };
  const g = fin(m.roof.overhangGable, 0);
  return { start: fin(m.roof.extend?.start, g), end: fin(m.roof.extend?.end, g) };
}

function baseShape(m: RoofModel): BaseShape | null {
  if (m.degenerate) return null;
  const { axis, uMin, uMax, vMin, vMax } = m.frame;
  const e = baseExtension(m);
  const u0 = uMin - e.start;
  const u1 = uMax + e.end;
  if (u1 - u0 < EPS) return null;
  return {
    outline: rectRing(axis, u0, u1, vMin - m.overhang, vMax + m.overhang),
    planes: m.slopes.map((s) => s.plane),
    ridgeZ: m.params.ridgeZ,
    ridge: m.roof.type === 'flat' ? null : { a: toPlan(axis, u0, m.ridgeV), b: toPlan(axis, u1, m.ridgeV) },
  };
}

/** Underside of a roof made of planes meeting at a convex ridge: the lowest plane is the one on the point's side. */
function lowestPlane(planes: Plane[], p: Vec2): number {
  let z = Infinity;
  for (const pl of planes) z = Math.min(z, evalPlane(pl, p));
  return z;
}

function shapeUnderside(s: BaseShape, p: Vec2): number | null {
  return pointInPolygon(p, s.outline) ? lowestPlane(s.planes, p) : null;
}

/** First shape whose underside at p reaches the ridge (equal ridges: ridge − 1 cm), highest first; or null. */
function meetingShape(others: BaseShape[], p: Vec2, ridgeZ: number): BaseShape | null {
  let best: BaseShape | null = null;
  let bestZ = -Infinity;
  for (const s of others) {
    const z = shapeUnderside(s, p);
    if (z === null) continue;
    const tol = Math.abs(s.ridgeZ - ridgeZ) <= EQUAL_RIDGE_TOL ? EQUAL_RIDGE_TOL : 0;
    if (z >= ridgeZ - tol && z > bestZ) {
      best = s;
      bestZ = z;
    }
  }
  return best;
}

/** Parameter range [t0, t1] of the ray start + t·dir inside the outline's bbox, or null when it misses. */
function bboxRange(start: Vec2, dir: Vec2, outline: Vec2[]): [number, number] | null {
  const { min, max } = bbox(outline);
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const k of [0, 1]) {
    if (Math.abs(dir[k]) < 1e-12) {
      if (start[k] < min[k] - EPS || start[k] > max[k] + EPS) return null;
      continue;
    }
    const a = (min[k] - start[k]) / dir[k];
    const b = (max[k] - start[k]) / dir[k];
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1 + EPS ? [t0, t1] : null;
}

/** Distance along `dir` from `start` where the other roofs meet the ridge, or null within WALK_MAX. */
function walkToMeet(start: Vec2, dir: Vec2, ridgeZ: number, shapes: BaseShape[]): number | null {
  const at = (d: number): Vec2 => [start[0] + dir[0] * d, start[1] + dir[1] * d];
  // Only roofs the walk line crosses can meet it, and only within their bbox range.
  const candidates = shapes.flatMap((shape) => {
    const r = bboxRange(start, dir, shape.outline);
    return r !== null && r[1] >= 0 && r[0] <= WALK_MAX ? [{ shape, t0: r[0] - EPS, t1: r[1] + EPS }] : [];
  });
  if (candidates.length === 0) return null;
  const others = (d: number): BaseShape[] => candidates.filter((c) => d >= c.t0 && d <= c.t1).map((c) => c.shape);
  const lastT = Math.min(WALK_MAX, Math.max(...candidates.map((c) => c.t1)));
  const steps = Math.min(Math.round(WALK_MAX / WALK_STEP), Math.ceil(lastT / WALK_STEP));
  for (let k = 0; k <= steps; k++) {
    const d = k * WALK_STEP;
    const hit = meetingShape(others(d), at(d), ridgeZ);
    if (hit === null) continue;
    const prev = Math.max(0, d - WALK_STEP);
    if (hit.ridge !== null && Math.abs(hit.ridgeZ - ridgeZ) <= EQUAL_RIDGE_TOL) {
      const r = hit.ridge;
      const x = lineIntersection(start, dir, r.a, [r.b[0] - r.a[0], r.b[1] - r.a[1]]);
      if (x !== null) {
        const t = (x[0] - start[0]) * dir[0] + (x[1] - start[1]) * dir[1];
        if (t >= prev - EPS && t <= WALK_MAX) return Math.max(0, t);
      }
    }
    if (k === 0) return 0;
    let lo = prev;
    let hi = d;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (meetingShape(others(mid), at(mid), ridgeZ) !== null) hi = mid;
      else lo = mid;
    }
    return hi;
  }
  return null;
}

function extensionOf(m: RoofModel, others: Neighbour[]): RidgeExtension {
  if (m.degenerate || m.roof.type === 'flat') {
    return { start: m.overhang, end: m.overhang, startFree: true, endFree: true, startNoMeet: false, endNoMeet: false };
  }
  const { axis, uMin, uMax, vMin, vMax } = m.frame;
  const shapes = others.flatMap((o) => (o.shape === null ? [] : [o.shape]));
  const gable = fin(m.roof.overhangGable, 0);
  const endResult = (end: End): { dist: number; free: boolean; noMeet: boolean } => {
    const u0 = end === 'start' ? uMin : uMax;
    const mid = toPlan(axis, u0, (vMin + vMax) / 2);
    const near = others.filter((o) => nearPolygon(mid, o.polygon, ADJ_TOL));
    const adjacent = near.length > 0;
    const override = m.roof.extend?.[end];
    if (typeof override === 'number' && Number.isFinite(override)) return { dist: override, free: !adjacent, noMeet: false };
    if (!adjacent) return { dist: gable, free: true, noMeet: false };
    const d = walkToMeet(toPlan(axis, u0, m.ridgeV), alongDir(axis, end === 'start' ? -1 : 1), m.params.ridgeZ, shapes);
    // No meeting: the same free gable as a lone end; the warning only when a drawn block stands there.
    return d === null ? { dist: gable, free: true, noMeet: near.some((o) => !o.unit) } : { dist: d, free: false, noMeet: false };
  };
  const s = endResult('start');
  const e = endResult('end');
  return { start: s.dist, end: e.dist, startFree: s.free, endFree: e.free, startNoMeet: s.noMeet, endNoMeet: e.noMeet };
}

/** Another block as the extension walk sees it; `unit`: placed from a unit template (Nytt bygg). */
interface Neighbour {
  polygon: Vec2[];
  shape: BaseShape | null;
  unit: boolean;
}

function othersOf(ctx: { models: RoofModel[]; base: (BaseShape | null)[] }, i: number): Neighbour[] {
  return ctx.models.flatMap((o, j) => (j === i ? [] : [{ polygon: o.points, shape: ctx.base[j], unit: typeof o.block.template === 'string' && o.block.template !== '' }]));
}

function roofContext(blocks: Block[], levels: Level[]): RoofContext {
  const models = blocks.map((b) => modelOf(b, levelElevation(levels, b.levelId)));
  const base = models.map(baseShape);
  const ext = models.map((m, i) => extensionOf(m, othersOf({ models, base }, i)));
  return { models, base, ext };
}

/** `variant.blocks` with `block` replacing the block of the same id (or appended), and its index. */
function withBlock(variant: Variant, block: Block): { blocks: Block[]; index: number } {
  const i = variant.blocks.findIndex((b) => b.id === block.id);
  if (i < 0) return { blocks: [...variant.blocks, block], index: variant.blocks.length };
  const blocks = [...variant.blocks];
  blocks[i] = block;
  return { blocks, index: i };
}

/**
 * Distances beyond the axis line at both ridge-axis ends of the block's roof (automatic extension, overrides,
 * overhangGable) and whether each end is a free gable. Flat roofs: overhangEave at both ends, free.
 */
export function ridgeExtension(block: Block, variant: Variant): RidgeExtension {
  const { blocks, index } = withBlock(variant, block);
  const models = blocks.map((b) => modelOf(b, levelElevation(variant.levels, b.levelId)));
  const base = models.map(baseShape);
  return extensionOf(models[index], othersOf({ models, base }, index));
}

// ---------------------------------------------------------------------------
// Slab regions in plan
// ---------------------------------------------------------------------------

/** Cuts polygons with holes into hole-free pieces along vertical lines through the holes. Outer rings only out. */
function splitHoles(mp: Vec2[][][], depth = 0): Vec2[][] {
  const out: Vec2[][] = [];
  for (const poly of mp) {
    const outer = poly[0];
    if (outer === undefined || outer.length < 3) continue;
    if (poly.length === 1 || depth >= 16) {
      out.push(outer);
      continue;
    }
    const holes = poly.slice(1);
    const hb = bbox(holes[0]);
    const cut = (hb.min[0] + hb.max[0]) / 2;
    const { min, max } = bbox(outer);
    const halves: Vec2[][] = [
      [[min[0] - 1, min[1] - 1], [cut, min[1] - 1], [cut, max[1] + 1], [min[0] - 1, max[1] + 1]],
      [[cut, min[1] - 1], [max[0] + 1, min[1] - 1], [max[0] + 1, max[1] + 1], [cut, max[1] + 1]],
    ];
    const split = withClipFallback(
      'roof slab with a hole',
      () =>
        halves.flatMap((half) => {
          const pieces = intersectPolygons([outer], [half]).map((p) => p[0]);
          return pieces.length > 0 ? splitHoles(differencePolygons(pieces, holes), depth + 1) : [];
        }),
      () => [outer],
    );
    out.push(...split);
  }
  return out;
}

/** Simplified CCW rings with a usable area. */
function cleanRings(rings: Vec2[][]): Vec2[][] {
  const out: Vec2[][] = [];
  for (const r of rings) {
    const s = simplifyCollinear(r);
    if (s.length >= 3 && area(s) >= MIN_PIECE_AREA) out.push(ensureCCW(s));
  }
  return out;
}

/**
 * Plan regions of each slope: the body over the block (overhang strips inside other blocks dropped) plus extension
 * strips clipped to the other blocks. Not yet cut at valleys (`clipToEnvelope`).
 */
function slabRegions(m: RoofModel, e: RidgeExtension, otherFootprints: Vec2[][]): Vec2[][][] {
  if (m.degenerate) return m.slopes.map(() => []);
  const { axis, uMin, uMax, vMin, vMax } = m.frame;
  const clipStart = !e.startFree && e.start > 0;
  const clipEnd = !e.endFree && e.end > 0;
  const bodyLo = clipStart ? uMin : uMin - e.start;
  const bodyHi = clipEnd ? uMax : uMax + e.end;
  let clip: Vec2[][] | null = null;
  const clipRegion = (): Vec2[][] =>
    (clip ??=
      otherFootprints.length === 0
        ? []
        : withClipFallback('roof: union of the other blocks', () => splitHoles(unionPolygons(otherFootprints)), () => otherFootprints));
  const strip = (u0: number, u1: number, s: SlopeDef): Vec2[][] => {
    const region = clipRegion();
    if (region.length === 0) return [];
    return withClipFallback('roof extension strip', () => splitHoles(intersectPolygons([rectRing(axis, u0, u1, s.vLo, s.vHi)], region)), () => []);
  };
  /** Body rectangle of a slope; its overhang strips (outside the block's bbox) lose what lies inside other blocks. */
  const body = (s: SlopeDef): Vec2[][] => {
    const rect = rectRing(axis, bodyLo, bodyHi, s.vLo, s.vHi);
    const region = clipRegion();
    const c0 = Math.max(bodyLo, uMin);
    const c1 = Math.min(bodyHi, uMax);
    const v0 = Math.max(s.vLo, vMin);
    const v1 = Math.min(s.vHi, vMax);
    if (region.length === 0) return [rect];
    const core = c1 - c0 >= EPS && v1 - v0 >= EPS ? [rectRing(axis, c0, c1, v0, v1)] : [];
    return withClipFallback(
      'roof overhang inside another block',
      () => [...core, ...splitHoles(differencePolygons([rect], [...core, ...region]))],
      () => [rect],
    );
  };
  return m.slopes.map((s) => {
    if (s.vHi - s.vLo < EPS) return [];
    const pieces: Vec2[][] = [];
    if (bodyHi - bodyLo >= EPS) pieces.push(...body(s));
    if (clipStart) pieces.push(...strip(uMin - e.start, uMin, s));
    if (clipEnd) pieces.push(...strip(uMax, uMax + e.end, s));
    if (pieces.length <= 1) return cleanRings(pieces);
    return withClipFallback('roof slab union', () => cleanRings(splitHoles(unionPolygons(pieces))), () => cleanRings(pieces));
  });
}

/** Plan rectangle around both boxes, grown by 1 m. */
function boxRing(a: { min: Vec2; max: Vec2 }, b: { min: Vec2; max: Vec2 }): Vec2[] {
  const x0 = Math.min(a.min[0], b.min[0]) - 1;
  const y0 = Math.min(a.min[1], b.min[1]) - 1;
  const x1 = Math.max(a.max[0], b.max[0]) + 1;
  const y1 = Math.max(a.max[1], b.max[1]) + 1;
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** Part of the convex ring where plane `p` is higher than plane `q` by more than `tol`; null when nowhere. */
function aboveRegion(ring: Vec2[], p: Plane, q: Plane, tol: number): Vec2[] | null {
  const f = (pt: Vec2): number => (p.a - q.a) * pt[0] + (p.b - q.b) * pt[1] + (p.c - q.c) - tol;
  const out: Vec2[] = [];
  for (let k = 0; k < ring.length; k++) {
    const cur = ring[k];
    const prev = ring[(k + ring.length - 1) % ring.length];
    const fc = f(cur);
    const fp = f(prev);
    if (fc > 0 !== fp > 0) {
      const t = fp / (fp - fc);
      out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
    }
    if (fc > 0) out.push(cur);
  }
  return out.length >= 3 && area(out) > MIN_PIECE_AREA ? out : null;
}

function boxesOverlap(a: { min: Vec2; max: Vec2 }, b: { min: Vec2; max: Vec2 }): boolean {
  return a.min[0] <= b.max[0] + EPS && b.min[0] <= a.max[0] + EPS && a.min[1] <= b.max[1] + EPS && b.min[1] <= a.max[1] + EPS;
}

/**
 * Valleys (see the header): each slope region minus the parts of the other roofs' slope regions whose underside
 * plane lies more than ENVELOPE_TOL above its own plane there. All comparisons use the uncut regions.
 */
function clipToEnvelope(models: RoofModel[], regions: Vec2[][][][]): Vec2[][][][] {
  const boxes = regions.map((slopes) => slopes.map((rings) => (rings.length === 0 ? null : bbox(rings.flat()))));
  return regions.map((slopes, i) =>
    slopes.map((rings, k) => {
      const box = boxes[i][k];
      if (box === null) return rings;
      const own = models[i].slopes[k].plane;
      const above: Vec2[][] = [];
      regions.forEach((otherSlopes, j) => {
        if (j === i) return;
        otherSlopes.forEach((otherRings, l) => {
          const ob = boxes[j][l];
          if (ob === null || !boxesOverlap(box, ob)) return;
          const half = aboveRegion(boxRing(box, ob), models[j].slopes[l].plane, own, ENVELOPE_TOL);
          if (half === null) return;
          above.push(...withClipFallback('roof valley', () => splitHoles(intersectPolygons(otherRings, [half])), () => []));
        });
      });
      if (above.length === 0) return rings;
      return withClipFallback('roof valley', () => cleanRings(splitHoles(differencePolygons(rings, above))), () => rings);
    }),
  );
}

/** Outer ring of the largest polygon of the union of all slope regions. */
function outlineOf(regions: Vec2[][][]): Vec2[] {
  const rings = regions.flat();
  if (rings.length === 0) return [];
  let best: Vec2[] = [];
  let bestArea = 0;
  const union = withClipFallback('roof outline', () => unionPolygons(rings), () => rings.map((r) => [r]));
  for (const poly of union) {
    const a = area(poly[0]);
    if (a > bestArea) {
      best = poly[0];
      bestArea = a;
    }
  }
  return best.length >= 3 ? ensureCCW(simplifyCollinear(best)) : [];
}

function slabContext(blocks: Block[], levels: Level[]): SlabContext {
  const ctx = roofContext(blocks, levels);
  const footprints = blocks.map((b) => (b.polygon.length >= 3 ? ensureCCW(b.polygon.map((v): Vec2 => [v.p[0], v.p[1]])) : null));
  const uncut = ctx.models.map((m, i) =>
    slabRegions(
      m,
      ctx.ext[i],
      footprints.flatMap((f, j) => (j === i || f === null || ctx.base[j] === null ? [] : [f])),
    ),
  );
  const regions = clipToEnvelope(ctx.models, uncut);
  return { ...ctx, regions, outlines: regions.map(outlineOf) };
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

interface PartRegion {
  poly: Vec2[];
  isNew: boolean;
}

function onBoundary(a: Vec2, b: Vec2, poly: Vec2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const c = poly[i];
    const d = poly[(i + 1) % n];
    if (distancePointSegment(a, c, d) <= ON_EDGE_TOL && distancePointSegment(b, c, d) <= ON_EDGE_TOL) return true;
  }
  return false;
}

/** A clipped part grown outwards across the block boundary (interior edges stay). */
function growPart(ring: Vec2[], blockPoly: Vec2[]): Vec2[] {
  const out = ring.map((p, i) => (onBoundary(p, ring[(i + 1) % ring.length], blockPoly) ? PART_REACH : 0));
  const grown = offsetPolygonPerEdge(ring, out);
  return grown.length >= 3 ? grown : ring;
}

/** Grown part regions in priority order (explicit parts, then the implicit remainder); null = no parts. */
function partRegions(block: Block, points: Vec2[]): PartRegion[] | null {
  if (block.parts.length === 0) return null;
  const blockPoly = ensureCCW(points);
  return withClipFallback(
    'roof parts',
    () => {
      const regions: PartRegion[] = [];
      for (const part of block.parts) {
        for (const poly of intersectPolygons([part.polygon], [blockPoly])) {
          regions.push({ poly: growPart(poly[0], blockPoly), isNew: part.isNew });
        }
      }
      for (const poly of differencePolygons([blockPoly], block.parts.map((p) => p.polygon))) {
        // The implicit remainder of a block with explicit parts is new work (docs/phase2-plan.md §3.4).
        regions.push({ poly: growPart(poly[0], blockPoly), isNew: true });
      }
      return regions;
    },
    () => null,
  );
}

/** Splits a slope region by part regions into hole-free pieces, merged per isNew (existing first). */
function splitByParts(rings: Vec2[][], regions: PartRegion[] | null, blockIsNew: boolean): { ring: Vec2[]; isNew: boolean }[] {
  if (rings.length === 0) return [];
  const unsplit = () => rings.map((ring) => ({ ring, isNew: blockIsNew }));
  if (regions === null) return unsplit();
  return withClipFallback('roof slope split by parts', () => splitRingsByParts(rings, regions, blockIsNew), unsplit);
}

function splitRingsByParts(rings: Vec2[][], regions: PartRegion[], blockIsNew: boolean): { ring: Vec2[]; isNew: boolean }[] {
  const byFlag: Record<'old' | 'new', Vec2[][]> = { old: [], new: [] };
  const claimed: Vec2[][] = [];
  for (const r of regions) {
    const inside = splitHoles(intersectPolygons(rings, [r.poly]));
    const piece = claimed.length === 0 || inside.length === 0 ? inside : splitHoles(differencePolygons(inside, claimed));
    byFlag[r.isNew ? 'new' : 'old'].push(...piece);
    claimed.push(r.poly);
  }
  byFlag[blockIsNew ? 'new' : 'old'].push(...splitHoles(differencePolygons(rings, claimed)));
  const out: { ring: Vec2[]; isNew: boolean }[] = [];
  for (const key of ['old', 'new'] as const) {
    const list = byFlag[key];
    if (list.length === 0) continue;
    for (const ring of cleanRings(splitHoles(unionPolygons(list)))) out.push({ ring, isNew: key === 'new' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trims
// ---------------------------------------------------------------------------

/** Parameter intervals of segment a→b inside `poly` (boundary inclusive), merged and sorted. */
function insideIntervals(a: Vec2, b: Vec2, poly: Vec2[]): [number, number][] {
  const n = poly.length;
  if (n < 3) return [];
  const ts = [0, 1];
  for (let i = 0; i < n; i++) {
    const c = poly[i];
    const hit = segmentIntersection(a, b, c, poly[(i + 1) % n]);
    if (hit !== null) ts.push(hit.ta);
    const pr = projectPointOnSegment(c, a, b);
    if (Math.hypot(pr.point[0] - c[0], pr.point[1] - c[1]) <= 1e-9) ts.push(pr.t);
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i];
    const t1 = ts[i + 1];
    if (t1 - t0 < 1e-12 || !pointInPolygon(lerp(a, b, (t0 + t1) / 2), poly)) continue;
    const last = out[out.length - 1];
    if (last !== undefined && t0 - last[1] < 1e-12) last[1] = t1;
    else out.push([t0, t1]);
  }
  return out;
}

function subtractIntervals(keep: [number, number][], cut: [number, number][]): [number, number][] {
  let out = keep;
  for (const [c0, c1] of cut) {
    const next: [number, number][] = [];
    for (const [k0, k1] of out) {
      if (c1 <= k0 || c0 >= k1) next.push([k0, k1]);
      else {
        if (c0 > k0) next.push([k0, c0]);
        if (c1 < k1) next.push([c1, k1]);
      }
    }
    out = next;
  }
  return out;
}

function trimsOf(
  m: RoofModel,
  e: RidgeExtension,
  outline: Vec2[],
  otherOutlines: Vec2[][],
  thickness: number,
): DerivedRoof['trims'] {
  const trims: DerivedRoof['trims'] = [];
  const { axis, uMin, uMax } = m.frame;
  const u0 = uMin - e.start;
  const u1 = uMax + e.end;
  if (u1 - u0 < EPS || outline.length < 3) return trims;
  const top = (pl: Plane, p: Vec2): Vec3 => [p[0], p[1], evalPlane(pl, p) + thickness];
  const fascia = (a: Vec2, b: Vec2, pl: Plane): void => {
    let iv = insideIntervals(a, b, outline);
    for (const o of otherOutlines) iv = subtractIntervals(iv, insideIntervals(a, b, o));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (const [t0, t1] of iv) {
      if ((t1 - t0) * len >= MIN_TRIM_LEN) trims.push({ a: top(pl, lerp(a, b, t0)), b: top(pl, lerp(a, b, t1)), kind: 'fascia' });
    }
  };
  for (const s of m.slopes) {
    for (const v of s.fasciaV) fascia(toPlan(axis, u0, v), toPlan(axis, u1, v), s.plane);
  }
  const ends: [number, boolean][] = [
    [u0, e.startFree],
    [u1, e.endFree],
  ];
  for (const [u, free] of ends) {
    for (const s of m.slopes) {
      const a = toPlan(axis, u, s.vLo);
      const b = toPlan(axis, u, s.vHi);
      if (m.roof.type === 'flat') fascia(a, b, s.plane);
      else if (free) trims.push({ a: top(s.plane, a), b: top(s.plane, b), kind: 'barge' });
    }
  }
  return trims;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function assembleRoof(ctx: SlabContext, i: number): DerivedRoof {
  const m = ctx.models[i];
  const block = m.block;
  const thickness = fin(m.roof.thickness, 0);
  const roof: DerivedRoof = { blockId: block.id, material: m.roof.material, thickness, slopes: [], trims: [], outline: [] };
  const outline = ctx.outlines[i];
  if (m.degenerate || outline.length < 3) return roof;
  const parts = partRegions(block, m.points);
  m.slopes.forEach((s, k) => {
    const normal = planeNormal(s.plane);
    for (const piece of splitByParts(ctx.regions[i][k], parts, block.isNew)) {
      const polygon = piece.ring.map((p): Vec3 => [p[0], p[1], evalPlane(s.plane, p) + thickness]);
      const slope: RoofSlope = { polygon, normal: [...normal], facing: s.facing, isNew: piece.isNew };
      roof.slopes.push(slope);
    }
  });
  roof.outline = outline;
  const e = ctx.ext[i];
  if (m.roof.type === 'gable') {
    const { axis, uMin, uMax } = m.frame;
    const a = toPlan(axis, uMin - e.start, m.ridgeV);
    const b = toPlan(axis, uMax + e.end, m.ridgeV);
    roof.ridge = { a: [a[0], a[1], m.params.ridgeZ], b: [b[0], b[1], m.params.ridgeZ] };
  }
  const others = ctx.outlines.filter((o, j) => j !== i && o.length >= 3);
  roof.trims = trimsOf(m, e, outline, others, thickness);
  return roof;
}

/** The derived roof of one block (computed against the other blocks of the variant). */
export function buildRoof(block: Block, variant: Variant, _blocks?: DerivedBlock[]): DerivedRoof {
  const { blocks, index } = withBlock(variant, block);
  return assembleRoof(slabContext(blocks, variant.levels), index);
}

/** All roofs (in `variant.blocks` order) plus `roof-no-meet` warnings, from one shared computation. */
export function buildRoofsWithWarnings(variant: Variant): { roofs: DerivedRoof[]; warnings: ModelWarning[] } {
  const ctx = slabContext(variant.blocks, variant.levels);
  return { roofs: ctx.models.map((_, i) => assembleRoof(ctx, i)), warnings: noMeetWarnings(ctx) };
}

/** All roofs, in `variant.blocks` order. */
export function buildRoofs(variant: Variant, _blocks?: DerivedBlock[]): DerivedRoof[] {
  return buildRoofsWithWarnings(variant).roofs;
}

function noMeetWarnings(ctx: RoofContext): ModelWarning[] {
  const out: ModelWarning[] = [];
  ctx.models.forEach((m, i) => {
    const e = ctx.ext[i];
    if (e.startNoMeet) out.push({ kind: 'roof-no-meet', blockId: m.block.id, end: 'start' });
    if (e.endNoMeet) out.push({ kind: 'roof-no-meet', blockId: m.block.id, end: 'end' });
  });
  return out;
}

/** `roof-no-meet` warnings: ends adjacent to another block whose ridge never meets another roof within 30 m. */
export function roofWarnings(variant: Variant): ModelWarning[] {
  return noMeetWarnings(roofContext(variant.blocks, variant.levels));
}

// ---------------------------------------------------------------------------
// Underside queries
// ---------------------------------------------------------------------------

const planeCache = new WeakMap<DerivedRoof, Plane[]>();

/** Underside planes of a derived roof, recovered from its slopes (top surface − thickness). */
function roofPlanes(roof: DerivedRoof): Plane[] {
  let planes = planeCache.get(roof);
  if (planes === undefined) {
    planes = [];
    for (const s of roof.slopes) {
      const p0 = s.polygon[0];
      const [nx, ny, nz] = s.normal;
      if (p0 === undefined || !(nz > 1e-9)) continue;
      const a = -nx / nz;
      const b = -ny / nz;
      planes.push({ a, b, c: p0[2] - roof.thickness - a * p0[0] - b * p0[1] });
    }
    planeCache.set(roof, planes);
  }
  return planes;
}

/**
 * Underside z of the roof at plan point (x, y), or null outside its outline. For a gable the slope on the point's
 * side of the ridge is the lower of the two slope planes, so the minimum over the planes is taken.
 */
export function roofUndersideAt(roof: DerivedRoof, x: number, y: number): number | null {
  if (roof.outline.length < 3 || !pointInPolygon([x, y], roof.outline)) return null;
  const planes = roofPlanes(roof);
  return planes.length === 0 ? null : lowestPlane(planes, [x, y]);
}

/** Upper envelope of the roof undersides at (x, y): max over the roofs whose outline contains the point, else null. */
export function combinedUndersideAt(roofs: DerivedRoof[], x: number, y: number): number | null {
  let best: number | null = null;
  for (const r of roofs) {
    const z = roofUndersideAt(r, x, y);
    if (z !== null && (best === null || z > best)) best = z;
  }
  return best;
}
