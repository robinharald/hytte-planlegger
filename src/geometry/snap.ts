/**
 * Snapping (docs/phase2-plan.md §3.3). Pure; plan metres. A `SnapContext` is built once per drag / tool session from
 * the derived model (`buildSnapContext`); the snap functions take a radius in plan metres (the UI converts 12 px /
 * 24 px on a coarse pointer at the current zoom).
 *
 * Targets
 *  - points: stored wall endpoints and midpoints, block axis vertices and edge midpoints, deck vertices;
 *  - lines: stored wall reference lines, block AXIS edges (never cladding faces), deck edges; each line also offers its
 *    collinear extension beyond its ends and the perpendiculars through its ends (within EXTENSION_REACH of the end);
 *  - with `from` (Vegg / Mål / a wall endpoint drag): the horizontal and vertical lines through `from` (ortho);
 *  - grid 0.10 m (0.01 m with `fine`, i.e. Alt).
 * Priority: a point within the radius > an intersection of two candidate lines within the radius > the nearest
 * candidate line (the point slides along it; on an axis-parallel line the free coordinate snaps to the grid) > grid.
 * Ghost walls (status 'removed') are never targets. Walls of other storeys are not targets; blocks and decks are.
 *
 * Other snaps
 *  - `snapLineOffset`: a line dragged across itself (wall move, block / deck edge move): its perpendicular position
 *    snaps to parallel target lines within the radius whose extent lies within EXTENSION_REACH, else to the grid
 *    (the absolute coordinate when the line is axis-parallel).
 *  - `snapPolygon`: a polygon moved as a whole (unit placement, block move) snaps axis to axis: each of its edges to
 *    parallel block axis edges / deck edges that overlap it along the line (within the radius); the best snap and the
 *    best snap in a non-parallel direction are combined; directions without a snap use the grid (vertex 0).
 *  - `snapFootprint`: furniture back-to-wall (0 gap against a wall face it faces) and edge-to-edge with other
 *    furniture, combined the same way.
 *  - `snapCircle`: a hot tub touches deck edges from the inside (rim tangent to the edge) within the radius.
 * Dimension chips: `chipsAcross` (both faces of a moved wall to the nearest wall on each side), `chipsAt` (from a
 * point to the nearest walls along the axis with the smaller span), and the length chip from `from`.
 */
import type { DerivedVariant } from '../model/derived';
import type { Id, Vec2 } from '../model/types';
import { distancePointSegment, lineIntersection, projectPointOnSegment, segmentIntersection } from './polygon';

export const GRID_STEP = 0.1;
export const GRID_STEP_FINE = 0.01;
/** Extensions / perpendiculars / parallel alignments reach this far (m) beyond a target's ends. */
export const EXTENSION_REACH = 6;
/** Rays for dimension chips stop here (m). */
export const CHIP_REACH = 20;
/** Lines closer than this (sin of the angle) to parallel are parallel. */
const PARALLEL_SIN = Math.sin((0.5 * Math.PI) / 180);
const TINY = 1e-9;

export type SnapPointKind = 'endpoint' | 'midpoint' | 'vertex' | 'deckVertex';
export type SnapLineKind = 'wall' | 'blockEdge' | 'deckEdge';

export interface SnapPointTarget {
  p: Vec2;
  kind: SnapPointKind;
  /** Element id: stored wall id, `${blockId}/${vertexId}`, deck vertex id. */
  id: Id;
}

export interface SnapLineTarget {
  a: Vec2;
  b: Vec2;
  kind: SnapLineKind;
  /** Stored wall id, `${blockId}/${edgeId}`, `${deckId}/${edgeId}`. */
  id: Id;
}

/** A wall face line; `n` points away from the wall body (into the room). */
export interface SnapFace {
  a: Vec2;
  b: Vec2;
  n: Vec2;
  wallId: Id;
}

export interface SnapObstacle {
  id: Id;
  polygon: Vec2[];
}

export interface SnapContext {
  storeyId: Id;
  points: SnapPointTarget[];
  /** Wall reference lines, block axis edges, deck edges. */
  lines: SnapLineTarget[];
  /** Block axis edges and deck edges only (units and blocks snap axis to axis). */
  axisLines: SnapLineTarget[];
  faces: SnapFace[];
  /** Wall footprints (dimension chips). */
  walls: SnapObstacle[];
  furniture: SnapObstacle[];
}

export interface SnapIndicator {
  /** 'endpoint' | 'midpoint' | 'vertex' | 'deckVertex' | 'intersection' | 'line' | 'extension' | 'perpendicular' | 'align' | 'grid' */
  kind: string;
  /** A marker point … */
  p?: Vec2;
  /** … or a guide line. */
  a?: Vec2;
  b?: Vec2;
}

export interface DimensionChip {
  a: Vec2;
  b: Vec2;
  /** Metres (the UI formats "1,20 m"). */
  length: number;
}

export interface SnapResult {
  point: Vec2;
  /** What the point snapped to: a point target, an intersection, a line, or only the grid ('none' with grid off). */
  kind: 'point' | 'intersection' | 'line' | 'grid' | 'none';
  indicators: SnapIndicator[];
  chips: DimensionChip[];
}

export interface SnapContextOptions {
  storeyId: Id;
  /** Ids left out: stored wall ids, block ids, `${blockId}/${vertexId}`, deck ids, deck vertex ids, furniture ids. */
  exclude?: Iterable<Id>;
}

export interface SnapOptions {
  /** Snap radius in plan metres. */
  radius: number;
  /** Alt: 0.01 m grid. */
  fine?: boolean;
  /** Snap to the grid when nothing else is near (default true). */
  grid?: boolean;
  /** First point of a two-point gesture: ortho guides through it and a length chip. */
  from?: Vec2;
  /** Leave out point targets / line targets (default: both used). */
  points?: boolean;
  lines?: boolean;
}

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a: Vec2): Vec2 => {
  const l = len(a);
  return l < TINY ? [1, 0] : [a[0] / l, a[1] / l];
};
const leftNormal = (u: Vec2): Vec2 => [-u[1], u[0]];
const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Round to a step without float noise ("-0" → 0). */
export function roundTo(v: number, step: number): number {
  const r = Math.round(v / step) * step;
  const c = Math.round(r * 1e6) / 1e6;
  return c === 0 ? 0 : c;
}

export function gridStep(fine?: boolean): number {
  return fine ? GRID_STEP_FINE : GRID_STEP;
}

export function gridPoint(p: Vec2, fine?: boolean): Vec2 {
  const step = gridStep(fine);
  return [roundTo(p[0], step), roundTo(p[1], step)];
}

function parallel(u: Vec2, v: Vec2): boolean {
  return Math.abs(cross(unit(u), unit(v))) <= PARALLEL_SIN;
}

/** Axis index (0 = x, 1 = y) a unit vector runs along, or null when it is slanted. */
function axisOf(u: Vec2): 0 | 1 | null {
  if (Math.abs(u[1]) <= PARALLEL_SIN) return 0;
  if (Math.abs(u[0]) <= PARALLEL_SIN) return 1;
  return null;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** Snap targets of one storey of the derived model (ghosts and excluded ids left out). */
export function buildSnapContext(derived: DerivedVariant, opts: SnapContextOptions): SnapContext {
  const exclude = new Set(opts.exclude ?? []);
  const ctx: SnapContext = { storeyId: opts.storeyId, points: [], lines: [], axisLines: [], faces: [], walls: [], furniture: [] };
  const storeyOfLevel = new Map(derived.levels.map((l) => [l.id, l.storeyId]));

  for (const w of derived.walls) {
    if (w.isGhost || !w.storeyIds.includes(opts.storeyId)) continue;
    const ownerIds = w.source.kind === 'wall' ? [w.source.wallId] : [w.source.blockId, `${w.source.blockId}/${w.source.edgeId}`];
    if (ownerIds.some((id) => exclude.has(id)) || exclude.has(w.id)) continue;
    if (w.source.kind === 'wall') {
      const id = w.source.wallId;
      ctx.points.push({ p: w.a, kind: 'endpoint', id }, { p: w.b, kind: 'endpoint', id }, { p: mid(w.a, w.b), kind: 'midpoint', id });
      ctx.lines.push({ a: w.a, b: w.b, kind: 'wall', id });
    }
    if (!w.isDivider && w.footprint.length >= 3) {
      ctx.walls.push({ id: w.id, polygon: w.footprint });
      const u = unit(sub(w.b, w.a));
      const nL = leftNormal(u);
      ctx.faces.push({ a: add(w.a, scale(nL, w.faceLeft)), b: add(w.b, scale(nL, w.faceLeft)), n: nL, wallId: w.id });
      ctx.faces.push({ a: add(w.a, scale(nL, -w.faceRight)), b: add(w.b, scale(nL, -w.faceRight)), n: scale(nL, -1), wallId: w.id });
    }
  }

  for (const db of derived.blocks) {
    const blockId = db.block.id;
    if (exclude.has(blockId)) continue;
    db.block.polygon.forEach((v) => {
      if (!exclude.has(`${blockId}/${v.id}`) && !exclude.has(v.id)) ctx.points.push({ p: v.p, kind: 'vertex', id: `${blockId}/${v.id}` });
    });
    for (const e of db.edges) {
      const id = `${blockId}/${e.edgeId}`;
      if (exclude.has(id)) continue;
      const line: SnapLineTarget = { a: e.a, b: e.b, kind: 'blockEdge', id };
      ctx.lines.push(line);
      ctx.axisLines.push(line);
      ctx.points.push({ p: mid(e.a, e.b), kind: 'midpoint', id });
    }
  }

  for (const deck of derived.outdoor.decks) {
    if (exclude.has(deck.id)) continue;
    const n = deck.polygon.length;
    for (let i = 0; i < n; i++) {
      const id = deck.vertexIds[i];
      if (!exclude.has(id)) ctx.points.push({ p: deck.polygon[i], kind: 'deckVertex', id });
      const line: SnapLineTarget = { a: deck.polygon[i], b: deck.polygon[(i + 1) % n], kind: 'deckEdge', id: `${deck.id}/${id}` };
      if (exclude.has(line.id)) continue;
      ctx.lines.push(line);
      ctx.axisLines.push(line);
    }
  }

  for (const f of derived.furniture) {
    if (exclude.has(f.id) || storeyOfLevel.get(f.levelId) !== opts.storeyId) continue;
    ctx.furniture.push({ id: f.id, polygon: f.footprint });
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Point snap
// ---------------------------------------------------------------------------

/** A candidate infinite line near the pointer. */
interface LineCand {
  /** Point on the line and unit direction. */
  o: Vec2;
  u: Vec2;
  kind: 'line' | 'extension' | 'perpendicular' | 'align';
  /** Distance of the pointer from the line. */
  d: number;
  /** Guide drawn when used: from the target's relevant point to the snapped point. */
  anchor: Vec2;
}

function lineCandidates(ctx: SnapContext, p: Vec2, opts: SnapOptions): LineCand[] {
  const out: LineCand[] = [];
  const r = opts.radius;
  if (opts.lines !== false) {
    for (const t of ctx.lines) {
      const d = sub(t.b, t.a);
      const L = len(d);
      if (L < TINY) continue;
      const u = scale(d, 1 / L);
      const s = dot(sub(p, t.a), u);
      const off = Math.abs(cross(u, sub(p, t.a)));
      if (s >= -TINY && s <= L + TINY) {
        if (off <= r) out.push({ o: t.a, u, kind: 'line', d: off, anchor: s < L / 2 ? t.a : t.b });
      } else if (off <= r && (s < 0 ? -s : s - L) <= EXTENSION_REACH) {
        out.push({ o: t.a, u, kind: 'extension', d: off, anchor: s < 0 ? t.a : t.b });
      }
      // Perpendiculars through both ends.
      for (const end of [t.a, t.b]) {
        const along = dot(sub(p, end), u);
        const across = Math.abs(cross(u, sub(p, end)));
        if (Math.abs(along) <= r && across <= EXTENSION_REACH && across > r) {
          out.push({ o: end, u: leftNormal(u), kind: 'perpendicular', d: Math.abs(along), anchor: end });
        }
      }
    }
  }
  if (opts.from) {
    const f = opts.from;
    const dx = Math.abs(p[0] - f[0]);
    const dy = Math.abs(p[1] - f[1]);
    if (dy <= r) out.push({ o: f, u: [1, 0], kind: 'align', d: dy, anchor: f });
    if (dx <= r) out.push({ o: f, u: [0, 1], kind: 'align', d: dx, anchor: f });
  }
  return out;
}

const projectOnLine = (p: Vec2, o: Vec2, u: Vec2): Vec2 => add(o, scale(u, dot(sub(p, o), u)));

function lengthChip(from: Vec2 | undefined, point: Vec2): DimensionChip[] {
  if (!from) return [];
  const l = dist(from, point);
  return l > 1e-6 ? [{ a: from, b: point, length: l }] : [];
}

/**
 * Snap a point (see the header). The result always carries the indicators to draw and the chips (the length from
 * `from`, else the distances to the nearest walls on both sides along one axis).
 */
export function snap(ctx: SnapContext, p: Vec2, opts: SnapOptions): SnapResult {
  const r = opts.radius;
  const chipsFor = (point: Vec2) => (opts.from ? lengthChip(opts.from, point) : chipsAt(ctx, point));

  if (opts.points !== false) {
    // Nearest; on a tie the first listed (wall ends, then block vertices, midpoints, deck vertices).
    let best: SnapPointTarget | null = null;
    let bestD = r;
    for (const t of ctx.points) {
      const d = dist(t.p, p);
      if (best === null ? d <= bestD : d < bestD - 1e-12) {
        best = t;
        bestD = d;
      }
    }
    if (best) {
      const point: Vec2 = [best.p[0], best.p[1]];
      return { point, kind: 'point', indicators: [{ kind: best.kind, p: point }], chips: chipsFor(point) };
    }
  }

  const cands = lineCandidates(ctx, p, opts);
  // Intersections of two non-parallel candidates near the pointer.
  let bestX: { point: Vec2; c1: LineCand; c2: LineCand } | null = null;
  let bestXD = r;
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const c1 = cands[i];
      const c2 = cands[j];
      if (parallel(c1.u, c2.u)) continue;
      const x = lineIntersection(c1.o, c1.u, c2.o, c2.u);
      if (!x) continue;
      const d = dist(x, p);
      if (d <= bestXD) {
        bestX = { point: x, c1, c2 };
        bestXD = d;
      }
    }
  }
  if (bestX) {
    const { point, c1, c2 } = bestX;
    const indicators: SnapIndicator[] = [{ kind: 'intersection', p: point }];
    for (const c of [c1, c2]) if (c.kind !== 'line') indicators.push({ kind: c.kind, a: c.anchor, b: point });
    return { point, kind: 'intersection', indicators, chips: chipsFor(point) };
  }

  if (cands.length > 0) {
    const c = cands.reduce((m, x) => (x.d < m.d ? x : m));
    let point = projectOnLine(p, c.o, c.u);
    if (opts.grid !== false) {
      const ax = axisOf(c.u);
      const step = gridStep(opts.fine);
      if (ax === 0) point = [roundTo(point[0], step), point[1]];
      else if (ax === 1) point = [point[0], roundTo(point[1], step)];
    }
    const indicators: SnapIndicator[] = [{ kind: c.kind, a: c.anchor, b: point }];
    return { point, kind: 'line', indicators, chips: chipsFor(point) };
  }

  if (opts.grid === false) return { point: [p[0], p[1]], kind: 'none', indicators: [], chips: chipsFor(p) };
  const point = gridPoint(p, opts.fine);
  return { point, kind: 'grid', indicators: [{ kind: 'grid', p: point }], chips: chipsFor(point) };
}

// ---------------------------------------------------------------------------
// Line offset snap (wall / edge moves)
// ---------------------------------------------------------------------------

export interface OffsetSnap {
  /** Perpendicular offset along the line's LEFT normal (rotate a→b by +90°). */
  offset: number;
  indicators: SnapIndicator[];
}

/** Extent along u of a segment, relative to o. */
function extentAlong(o: Vec2, u: Vec2, a: Vec2, b: Vec2): [number, number] {
  const s0 = dot(sub(a, o), u);
  const s1 = dot(sub(b, o), u);
  return s0 <= s1 ? [s0, s1] : [s1, s0];
}

/**
 * Snap the perpendicular position of the segment a–b moved by `offset` along its left normal: to parallel lines
 * (ctx.lines, or ctx.axisLines with `axisOnly`) within the radius, else to the grid. `excludeIds` are target ids
 * left out (the moved element itself).
 */
export function snapLineOffset(
  ctx: SnapContext,
  a: Vec2,
  b: Vec2,
  offset: number,
  opts: { radius: number; fine?: boolean; grid?: boolean; excludeIds?: ReadonlySet<Id>; axisOnly?: boolean },
): OffsetSnap {
  const d = sub(b, a);
  if (len(d) < TINY) return { offset, indicators: [] };
  const u = unit(d);
  const n = leftNormal(u);
  const [e0, e1] = [0, len(d)];
  let best: { c: number; t: SnapLineTarget } | null = null;
  let bestD = opts.radius;
  for (const t of opts.axisOnly ? ctx.axisLines : ctx.lines) {
    if (opts.excludeIds?.has(t.id)) continue;
    const td = sub(t.b, t.a);
    if (len(td) < TINY || !parallel(u, td)) continue;
    const [t0, t1] = extentAlong(a, u, t.a, t.b);
    if (t1 < e0 - EXTENSION_REACH || t0 > e1 + EXTENSION_REACH) continue;
    const c = dot(sub(t.a, a), n);
    const dd = Math.abs(c - offset);
    if (dd <= bestD) {
      best = { c, t };
      bestD = dd;
    }
  }
  if (best) {
    const shift = scale(n, best.c);
    const ma = add(a, shift);
    const mb = add(b, shift);
    // Guide along the common line from the target to the moved segment.
    const pts = [best.t.a, best.t.b, ma, mb].map((p) => ({ p, s: dot(sub(p, a), u) }));
    pts.sort((x, y) => x.s - y.s);
    return { offset: best.c, indicators: [{ kind: 'align', a: pts[0].p, b: pts[pts.length - 1].p }] };
  }
  if (opts.grid === false) return { offset, indicators: [] };
  const step = gridStep(opts.fine);
  const ax = axisOf(n);
  if (ax !== null) {
    const base = a[ax] * Math.sign(n[ax]);
    const abs = base + offset;
    return { offset: roundTo(abs, step) - base, indicators: [] };
  }
  return { offset: roundTo(offset, step), indicators: [] };
}

// ---------------------------------------------------------------------------
// Polygon snaps (units, blocks, furniture)
// ---------------------------------------------------------------------------

interface DirSnap {
  n: Vec2;
  g: number;
  guide: [Vec2, Vec2];
}

/** Translation satisfying up to two directional snaps (non-parallel), grid elsewhere when `gridRef` is given. */
function combine(snaps: DirSnap[], radius: number, gridRef: Vec2 | null, fine: boolean | undefined): { delta: Vec2; indicators: SnapIndicator[] } {
  const ok = snaps.filter((s) => Math.abs(s.g) <= radius).sort((x, y) => Math.abs(x.g) - Math.abs(y.g));
  const first = ok[0];
  const second = first ? ok.find((s) => !parallel(s.n, first.n)) : undefined;
  const indicators: SnapIndicator[] = [];
  const step = gridStep(fine);
  if (first && second) {
    // Solve dot(delta, n1) = g1, dot(delta, n2) = g2.
    const det = cross(first.n, second.n);
    const delta: Vec2 = [(first.g * second.n[1] - second.g * first.n[1]) / det, (first.n[0] * second.g - second.n[0] * first.g) / det];
    indicators.push({ kind: 'align', a: first.guide[0], b: first.guide[1] }, { kind: 'align', a: second.guide[0], b: second.guide[1] });
    return { delta, indicators };
  }
  if (first) {
    let delta = scale(first.n, first.g);
    indicators.push({ kind: 'align', a: first.guide[0], b: first.guide[1] });
    if (gridRef) {
      const t = leftNormal(first.n);
      const ax = axisOf(t);
      if (ax !== null) {
        const moved = add(gridRef, delta);
        const extra = roundTo(moved[ax], step) - moved[ax];
        delta = ax === 0 ? [delta[0] + extra, delta[1]] : [delta[0], delta[1] + extra];
      }
    }
    return { delta, indicators };
  }
  if (gridRef) {
    const g = gridPoint(gridRef, fine);
    return { delta: sub(g, gridRef), indicators };
  }
  return { delta: [0, 0], indicators };
}

/** Outward normal of edge a→b of a CCW polygon. */
const outwardOf = (a: Vec2, b: Vec2): Vec2 => {
  const u = unit(sub(b, a));
  return [u[1], -u[0]];
};

const signedAreaOf = (poly: Vec2[]): number => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length]);
  return s / 2;
};

/** Edges of a polygon with outward normals (any orientation). */
function edgesOf(poly: Vec2[]): { a: Vec2; b: Vec2; n: Vec2 }[] {
  const flip = signedAreaOf(poly) < 0 ? -1 : 1;
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return { a, b, n: scale(outwardOf(a, b), flip) };
  });
}

function overlapAlong(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2, slack: number): boolean {
  const u = unit(sub(a1, a0));
  const [s0, s1] = extentAlong(a0, u, a0, a1);
  const [t0, t1] = extentAlong(a0, u, b0, b1);
  return t1 >= s0 - slack && t0 <= s1 + slack;
}

/**
 * Snap a polygon moved as a whole, axis to axis: each edge to parallel block axis edges / deck edges overlapping it
 * along the line (both directions combined, grid for the rest). Returns the translation to add.
 */
export function snapPolygon(
  ctx: SnapContext,
  poly: Vec2[],
  opts: { radius: number; fine?: boolean; grid?: boolean; excludeIds?: ReadonlySet<Id> },
): { delta: Vec2; indicators: SnapIndicator[] } {
  if (poly.length < 3) return { delta: [0, 0], indicators: [] };
  const snaps: DirSnap[] = [];
  for (const e of edgesOf(poly)) {
    for (const t of ctx.axisLines) {
      if (opts.excludeIds?.has(t.id)) continue;
      if (!parallel(sub(e.b, e.a), sub(t.b, t.a))) continue;
      if (!overlapAlong(e.a, e.b, t.a, t.b, opts.radius)) continue;
      const g = dot(sub(t.a, e.a), e.n);
      snaps.push({ n: e.n, g, guide: [t.a, t.b] });
    }
  }
  return combine(snaps, opts.radius, opts.grid === false ? null : poly[0], opts.fine);
}

/**
 * Furniture: back-to-wall (an edge against a wall face that faces it, 0 gap) and edge-to-edge with other furniture
 * (`excludeIds` = the moved item). Directions without a snap stay free (no grid).
 */
export function snapFootprint(
  ctx: SnapContext,
  poly: Vec2[],
  opts: { radius: number; excludeIds?: ReadonlySet<Id> },
): { delta: Vec2; indicators: SnapIndicator[] } {
  if (poly.length < 3) return { delta: [0, 0], indicators: [] };
  const snaps: DirSnap[] = [];
  for (const e of edgesOf(poly)) {
    for (const f of ctx.faces) {
      if (dot(f.n, e.n) > -1 + PARALLEL_SIN) continue; // must face the edge
      if (!overlapAlong(e.a, e.b, f.a, f.b, 0)) continue;
      snaps.push({ n: e.n, g: dot(sub(f.a, e.a), e.n), guide: [f.a, f.b] });
    }
    for (const o of ctx.furniture) {
      if (opts.excludeIds?.has(o.id)) continue;
      for (const oe of edgesOf(o.polygon)) {
        if (dot(oe.n, e.n) > -1 + PARALLEL_SIN) continue;
        if (!overlapAlong(e.a, e.b, oe.a, oe.b, 0)) continue;
        snaps.push({ n: e.n, g: dot(sub(oe.a, e.a), e.n), guide: [oe.a, oe.b] });
      }
    }
  }
  return combine(snaps, opts.radius, null, false);
}

/** Hot tub: the rim touches deck edges from the inside (up to two edges), else the grid. */
export function snapCircle(
  ctx: SnapContext,
  centre: Vec2,
  r: number,
  opts: { radius: number; fine?: boolean; grid?: boolean },
): { point: Vec2; indicators: SnapIndicator[] } {
  const snaps: DirSnap[] = [];
  for (const t of ctx.axisLines) {
    if (t.kind !== 'deckEdge') continue;
    const d = sub(t.b, t.a);
    const L = len(d);
    if (L < TINY) continue;
    const u = scale(d, 1 / L);
    const s = dot(sub(centre, t.a), u);
    if (s < 0 || s > L) continue;
    const signed = cross(u, sub(centre, t.a)); // > 0: left of the edge
    const side = signed >= 0 ? 1 : -1;
    const n = scale(leftNormal(u), side); // from the edge towards the centre
    const g = r - Math.abs(signed); // move along n by g
    snaps.push({ n, g, guide: [t.a, t.b] });
  }
  const res = combine(snaps, opts.radius, opts.grid === false ? null : centre, opts.fine);
  return { point: add(centre, res.delta), indicators: res.indicators };
}

// ---------------------------------------------------------------------------
// Dimension chips
// ---------------------------------------------------------------------------

/** Nearest hit of the ray p + t·dir (t in (0, max]) with the wall footprints (excluded ids left out). */
export function rayToWall(ctx: SnapContext, p: Vec2, dir: Vec2, opts: { exclude?: ReadonlySet<Id>; max?: number } = {}): { t: number; hit: Vec2; id: Id } | null {
  const u = unit(dir);
  const max = opts.max ?? CHIP_REACH;
  const end = add(p, scale(u, max));
  let best: { t: number; hit: Vec2; id: Id } | null = null;
  for (const w of ctx.walls) {
    if (opts.exclude?.has(w.id)) continue;
    const poly = w.polygon;
    for (let i = 0; i < poly.length; i++) {
      const x = segmentIntersection(p, end, poly[i], poly[(i + 1) % poly.length]);
      if (!x) continue;
      const t = x.ta * max;
      if (t <= 1e-6) continue;
      if (!best || t < best.t) best = { t, hit: x.point, id: w.id };
    }
  }
  return best;
}

/** Chips from p to the nearest walls along ±x or ±y (the axis whose two hits are closer together). */
export function chipsAt(ctx: SnapContext, p: Vec2, opts: { exclude?: ReadonlySet<Id> } = {}): DimensionChip[] {
  let best: DimensionChip[] = [];
  let bestSpan = Infinity;
  for (const axis of [
    [1, 0],
    [0, 1],
  ] as Vec2[]) {
    const plus = rayToWall(ctx, p, axis, opts);
    const minus = rayToWall(ctx, p, scale(axis, -1), opts);
    if (!plus || !minus) continue;
    const span = plus.t + minus.t;
    if (span < bestSpan) {
      bestSpan = span;
      best = [
        { a: p, b: minus.hit, length: minus.t },
        { a: p, b: plus.hit, length: plus.t },
      ];
    }
  }
  return best;
}

/**
 * Chips across a wall line a–b at its middle: from the left face (faceLeft along the left normal) to the nearest wall
 * on that side, and from the right face to the nearest wall on the other side. `exclude` = the moved wall's ids.
 */
export function chipsAcross(
  ctx: SnapContext,
  a: Vec2,
  b: Vec2,
  faceLeft: number,
  faceRight: number,
  opts: { exclude?: ReadonlySet<Id> } = {},
): DimensionChip[] {
  const d = sub(b, a);
  if (len(d) < TINY) return [];
  const n = leftNormal(unit(d));
  const m = mid(a, b);
  const out: DimensionChip[] = [];
  const left = add(m, scale(n, faceLeft));
  const right = add(m, scale(n, -faceRight));
  const hl = rayToWall(ctx, left, n, opts);
  if (hl) out.push({ a: left, b: hl.hit, length: hl.t });
  const hr = rayToWall(ctx, right, scale(n, -1), opts);
  if (hr) out.push({ a: right, b: hr.hit, length: hr.t });
  return out;
}

/** Distance from p to a segment target (re-exported for callers that pick targets themselves). */
export function distanceToTarget(p: Vec2, t: { a: Vec2; b: Vec2 }): number {
  return distancePointSegment(p, t.a, t.b);
}

/** Closest point on a segment target. */
export function closestOnTarget(p: Vec2, t: { a: Vec2; b: Vec2 }): Vec2 {
  return projectPointOnSegment(p, t.a, t.b).point;
}
