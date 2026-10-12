/**
 * Where a new furniture item goes (docs/phase2-plan.md §3.2 "items are tapped to place (centre of the selected room,
 * else the visible plan centre, pushed to the nearest free wall) or dragged in"; §3.3 "furniture back-to-wall (0 gap)
 * and edge-to-edge"). Pure: the plan's drop preview and the library's tap use the same functions, so the preview
 * shows exactly where the item will land.
 *
 * Item frame as in furnitureSymbols.ts: `w` along the local x, `d` along the local y, the FRONT on the local −y side;
 * `rotationDeg` turns it CCW. "Back to the wall" = the local +y edge on a wall's inner face, the front facing into
 * the room: for a wall edge whose inward normal is n, rotationDeg = atan2(n.x, −n.y).
 *
 * Modes (from the catalogue's `snap`, `catalogPlacementSpec`):
 *  - 'wall'   (beds, sofas, cabinets, WC, sink, …): back against a wall;
 *  - 'corner' (showers): back against a wall, pushed into a corner of it when one is free;
 *  - 'free'   (tables, rugs, the kitchen island, chairs, outdoor furniture): where it is put, turned with the room.
 *
 * Tap (`tapPlacement`): start point = the room's label point (a selected room), else the given point (the visible plan
 * centre; its room, if it is in one). 'wall' / 'corner': among back-to-wall spots along every wall edge of the room
 * (the room's inner polygon edges that lie on a wall face: not dividers or floor steps), every 5 cm, the FREE one
 * nearest the start point; 'free': the start point, else the nearest free spot on rings of 10 cm around it. A spot is
 * free when the footprint lies inside the room (and out of its holes) and overlaps (by more than OVERLAP_TOL) no
 * other item whose height range meets its own (rugs and other flat things never count), no wall, no stair / chimney /
 * post, and no door zone (a door, glass / sliding / sauna door or frameless opening, its width plus 5 cm each side,
 * as deep as the leaf on both sides of the wall, at least DOOR_CLEAR_M). With no free spot it goes to the nearest
 * spot inside the room (the collision outline shows the conflict), else to the start point.
 *
 * Drop (`dropPlacement`, the pointer released over the plan, or the plan's Møbler tool): 'wall' / 'corner' items
 * dropped within DROP_WALL_REACH_M (plus half their depth) of a wall edge of the room under the pointer turn their
 * back to it and stand against it at the pointer's place along it ('corner': into the corner when within
 * CORNER_PULL_M of it); anything else stays at the pointer, unturned, snapped back-to-wall / edge-to-edge within
 * `reach` (geometry/snap.ts `snapFootprint`). A drop never searches elsewhere: the user chose the spot.
 */
import type { DerivedRoom, DerivedVariant, DerivedWall } from '../model/derived';
import type { Id, Vec2 } from '../model/types';
import { catalogItem, presetOf } from '../furniture/catalog';
import type { FurnitureSnap } from '../furniture/catalog';
import { pointInPolygon } from '../geometry/polygon';
import { buildSnapContext, snapFootprint, LINE_SNAP_MAX_M } from '../geometry/snap';
import type { SnapContext } from '../geometry/snap';
import { structureFootprint } from './storeyData';
import { storeyContext, structureOnStorey } from './visibility';

export type PlacementMode = 'wall' | 'corner' | 'free';

export interface PlacementSpec {
  size: { w: number; d: number; h: number };
  /** Bottom above the floor (m), e.g. a wall cabinet. Default 0. */
  elevation?: number;
  mode: PlacementMode;
  /** Never blocks nor is blocked by other furniture or doors (rugs, drains: the catalogue's mount 'flat'). */
  flat?: boolean;
  /** The preset written with the item (`FurnitureItem.sizeVariant`). */
  sizeVariant?: string;
}

const MODES: Record<FurnitureSnap, PlacementMode> = { 'back-to-wall': 'wall', corner: 'corner', free: 'free' };

/**
 * How the catalogue entry is placed: its preset `sizeVariant` (else the default), its snap as the mode, its elevation,
 * flat for mount 'flat'. Unknown ids: a 1 × 1 × 1 m box placed freely.
 */
export function catalogPlacementSpec(catalogId: string, sizeVariant?: string): PlacementSpec {
  const item = catalogItem(catalogId);
  if (!item) return { size: { w: 1, d: 1, h: 1 }, mode: 'free' };
  const p = presetOf(item, sizeVariant);
  const spec: PlacementSpec = { size: { w: p.w, d: p.d, h: p.h }, mode: MODES[item.snap] ?? 'free', sizeVariant: p.key };
  if (item.elevation) spec.elevation = item.elevation;
  if (item.mount === 'flat') spec.flat = true;
  return spec;
}

export interface FurniturePlacement {
  position: Vec2;
  rotationDeg: number;
  /** The level of the room the item went into (undefined: the action finds it with levelAt). */
  levelId?: Id;
  /** Derived id of that room. */
  roomId?: Id;
  footprint: Vec2[];
  /** The wall edge (inner face, a → b) the back stands against. */
  wall?: { a: Vec2; b: Vec2 };
  /** No conflict found (see the header). */
  free: boolean;
}

/** Steps (m) along a wall edge for tap candidates. */
export const WALL_STEP_M = 0.05;
/** Ring step (m) of the free-spot search. */
export const RING_STEP_M = 0.1;
/** Overlaps up to this depth (m) are touching, not overlapping. */
export const OVERLAP_TOL = 0.005;
/** Minimum depth (m) kept clear on each side of a door. */
export const DOOR_CLEAR_M = 0.6;
/** A wall-mode drop this far (m) beyond half the item's depth from a wall edge turns its back to it. */
export const DROP_WALL_REACH_M = 0.5;
/** A corner-mode item within this distance (m) of an edge end goes into the corner. */
export const CORNER_PULL_M = 0.3;
/** Items lower than this (m) are flat (rugs): they never block nor are blocked. */
export const FLAT_H = 0.05;
/** Search radius cap (m) of the free-spot rings, and of the spots tried. */
const MAX_RING_M = 8;
const MAX_FREE_CHECKS = 3000;

const DOOR_TYPES = new Set(['door', 'glassDoor', 'slidingDoor', 'saunaDoor', 'opening']);

// ---------------------------------------------------------------------------
// Small vector helpers
// ---------------------------------------------------------------------------

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const r6 = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};
const roundTo = (v: number, step: number) => r6(Math.round(v / step) * step);

/** Degrees in [0, 360), rounded to 1e-6. */
export function normDeg(deg: number): number {
  const v = r6(((deg % 360) + 360) % 360);
  return v >= 360 ? 0 : v;
}

/** The item's footprint: the size rectangle turned CCW by rotationDeg about the position (as derive does). */
export function rectFootprint(position: Vec2, rotationDeg: number, w: number, d: number): Vec2[] {
  const t = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const corners: Vec2[] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
  return corners.map(([u, v]): Vec2 => [position[0] + u * c - v * s, position[1] + u * s + v * c]);
}

/** rotationDeg that turns the item's front towards the unit vector n (its back away from it). */
export function rotationFacing(n: Vec2): number {
  return normDeg((Math.atan2(n[0], -n[1]) * 180) / Math.PI);
}

// ---------------------------------------------------------------------------
// Overlap (separating axes, convex polygons)
// ---------------------------------------------------------------------------

function project(poly: readonly Vec2[], axis: Vec2): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    const v = dot(p, axis);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

function axesOf(poly: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const e = sub(poly[(i + 1) % poly.length], poly[i]);
    const l = Math.hypot(e[0], e[1]);
    if (l > 1e-12) out.push([-e[1] / l, e[0] / l]);
  }
  return out;
}

/** Do two convex polygons overlap by more than `tol` (m) along every separating-axis candidate? */
export function convexOverlap(a: readonly Vec2[], b: readonly Vec2[], tol = OVERLAP_TOL): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (const axis of [...axesOf(a), ...axesOf(b)]) {
    const [a0, a1] = project(a, axis);
    const [b0, b1] = project(b, axis);
    if (Math.min(a1, b1) - Math.max(a0, b0) <= tol) return false;
  }
  return true;
}

function boxOf(poly: readonly Vec2[]): { min: Vec2; max: Vec2 } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  return { min: [x0, y0], max: [x1, y1] };
}

const boxesMeet = (a: { min: Vec2; max: Vec2 }, b: { min: Vec2; max: Vec2 }) => a.min[0] < b.max[0] && b.min[0] < a.max[0] && a.min[1] < b.max[1] && b.min[1] < a.max[1];

// ---------------------------------------------------------------------------
// Rooms and their walls
// ---------------------------------------------------------------------------

/** The room of the storey whose inner polygon holds p (not in a hole), or null. */
export function roomAt(derived: Pick<DerivedVariant, 'rooms'>, storeyId: Id, p: Vec2): DerivedRoom | null {
  for (const r of derived.rooms) {
    if (r.storeyId !== storeyId || r.polygon.length < 3) continue;
    if (pointInPolygon(p, r.polygon) && !r.holes.some((h) => h.length >= 3 && pointInPolygon(p, h))) return r;
  }
  return null;
}

export interface WallEdge {
  a: Vec2;
  b: Vec2;
  /** Unit direction a → b. */
  u: Vec2;
  /** Unit normal into the room. */
  n: Vec2;
  length: number;
}

const solidWalls = (derived: Pick<DerivedVariant, 'walls'>, storeyId: Id): DerivedWall[] =>
  derived.walls.filter((w) => !w.isGhost && !w.isDivider && w.footprint.length >= 3 && w.storeyIds.includes(storeyId));

/** Probe distance (m) outside a room edge that must be inside a wall's footprint for the edge to be a wall face. */
const WALL_PROBE_M = 0.02;

const roomWallCache = new WeakMap<object, Map<string, WallEdge[]>>();

/** The edges of the room's inner polygon that lie on a wall's face (not dividers, floor steps or open junctions). */
export function roomWallEdges(derived: Pick<DerivedVariant, 'walls'>, room: DerivedRoom, storeyId: Id = room.storeyId): WallEdge[] {
  let byRoom = roomWallCache.get(derived);
  if (!byRoom) {
    byRoom = new Map();
    roomWallCache.set(derived, byRoom);
  }
  const key = `${room.id}|${room.levelId}|${storeyId}`;
  const hit = byRoom.get(key);
  if (hit) return hit;
  const walls = solidWalls(derived, storeyId);
  const poly = room.polygon;
  let area2 = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    area2 += p[0] * q[1] - p[1] * q[0];
  }
  const ccw = area2 >= 0 ? 1 : -1;
  const out: WallEdge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const length = dist(a, b);
    if (length < 0.05) continue;
    const u = mul(sub(b, a), 1 / length);
    const n: Vec2 = mul([-u[1], u[0]], ccw);
    const probes = [0.25, 0.5, 0.75].map((t) => add(add(a, mul(u, length * t)), mul(n, -WALL_PROBE_M)));
    const onWall = probes.filter((pr) => walls.some((w) => pointInPolygon(pr, w.footprint))).length >= 2;
    if (onWall) out.push({ a, b, u, n, length });
  }
  byRoom.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Obstacles
// ---------------------------------------------------------------------------

export interface Obstacle {
  id: string;
  polygon: Vec2[];
  box: { min: Vec2; max: Vec2 };
}

/** Door zones of the storey (see the header). */
export function doorZones(derived: Pick<DerivedVariant, 'walls'>, storeyId: Id): Obstacle[] {
  const out: Obstacle[] = [];
  for (const w of derived.walls) {
    if (w.isGhost || !w.storeyIds.includes(storeyId)) continue;
    const L = dist(w.a, w.b);
    if (L < 1e-9) continue;
    const u = mul(sub(w.b, w.a), 1 / L);
    const n: Vec2 = [-u[1], u[0]];
    for (const o of w.openings) {
      if (o.isGhost || !DOOR_TYPES.has(o.type)) continue;
      const leaf = o.opening.leaves === 2 ? o.width / 2 : o.width;
      const clear = Math.max(DOOR_CLEAR_M, leaf);
      const c = add(w.a, mul(u, o.offset));
      const hl = o.width / 2 + 0.05;
      const left = w.faceLeft + clear;
      const right = w.faceRight + clear;
      const polygon: Vec2[] = [add(add(c, mul(u, -hl)), mul(n, -right)), add(add(c, mul(u, hl)), mul(n, -right)), add(add(c, mul(u, hl)), mul(n, left)), add(add(c, mul(u, -hl)), mul(n, left))];
      out.push({ id: `door:${o.id}`, polygon, box: boxOf(polygon) });
    }
  }
  return out;
}

/** Everything a new item of height range [z0, z1] (above its floor) must not overlap on the storey (see the header). */
export function placementObstacles(derived: DerivedVariant, storeyId: Id, z: [number, number], exclude: ReadonlySet<Id> = new Set(), flatItem = false): Obstacle[] {
  const out: Obstacle[] = [];
  const flat = flatItem || z[1] - z[0] < FLAT_H;
  const ctx = storeyContext(derived, storeyId);
  const levelIds = new Set(ctx?.levelIds ?? []);
  if (!flat) {
    for (const f of derived.furniture) {
      if (exclude.has(f.id) || f.footprint.length < 3) continue;
      if (levelIds.size > 0 && !levelIds.has(f.levelId)) continue;
      const h = f.item.size?.h ?? 1;
      if (h < FLAT_H || catalogItem(f.item.catalogId)?.mount === 'flat') continue;
      const bottom = f.z - f.floorZ;
      if (bottom >= z[1] - 1e-9 || bottom + h <= z[0] + 1e-9) continue;
      out.push({ id: f.id, polygon: f.footprint, box: boxOf(f.footprint) });
    }
  }
  for (const w of solidWalls(derived, storeyId)) out.push({ id: `wall:${w.id}`, polygon: w.footprint, box: boxOf(w.footprint) });
  if (ctx) {
    for (const s of derived.structure) {
      if (!structureOnStorey(s, ctx)) continue;
      const fp = structureFootprint(s);
      if (fp) out.push({ id: `structure:${s.id}`, polygon: fp, box: boxOf(fp) });
    }
  }
  if (!flat) out.push(...doorZones(derived, storeyId));
  return out;
}

/** Wall footprints can be concave only at their mitred ends; the separating-axis test treats them as convex hulls. */
function overlapsAny(fp: Vec2[], obstacles: readonly Obstacle[]): boolean {
  const box = boxOf(fp);
  for (const o of obstacles) {
    if (!boxesMeet(box, o.box)) continue;
    if (convexOverlap(fp, o.polygon)) return true;
  }
  return false;
}

/** Is the footprint inside the room (corners pulled 5 mm in), out of its holes, with no room corner poking into it? */
export function insideRoom(fp: Vec2[], room: DerivedRoom): boolean {
  const c = mul(fp.reduce((s, p) => add(s, p), [0, 0] as Vec2), 1 / fp.length);
  const shrunk = fp.map((p) => {
    const v = sub(c, p);
    const l = Math.hypot(v[0], v[1]);
    return l < 1e-9 ? p : add(p, mul(v, OVERLAP_TOL / l));
  });
  if (!shrunk.every((p) => pointInPolygon(p, room.polygon))) return false;
  for (const h of room.holes) {
    if (h.length < 3) continue;
    if (shrunk.some((p) => pointInPolygon(p, h)) || convexOverlap(fp, h)) return false;
  }
  // A concave room corner inside the rectangle (an L-shaped room).
  for (const q of room.polygon) {
    if (pointInConvex(q, shrunk)) return false;
  }
  return true;
}

function pointInConvex(p: Vec2, poly: Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(cr) < 1e-12) return false;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Tap placement
// ---------------------------------------------------------------------------

interface Candidate {
  position: Vec2;
  rotationDeg: number;
  footprint: Vec2[];
  wall?: { a: Vec2; b: Vec2 };
  score: number;
}

function wallCandidates(edges: readonly WallEdge[], w: number, d: number, from: Vec2, cornersOnly: boolean): Candidate[] {
  const out: Candidate[] = [];
  for (const e of edges) {
    if (e.length + 1e-9 < w) continue;
    const rotationDeg = rotationFacing(e.n);
    const lo = w / 2;
    const hi = e.length - w / 2;
    const ss: number[] = [];
    if (cornersOnly) ss.push(lo, hi);
    else {
      for (let s = lo; s <= hi + 1e-9; s += WALL_STEP_M) ss.push(s);
      if (ss.length === 0 || Math.abs(ss[ss.length - 1] - hi) > 1e-6) ss.push(hi);
    }
    for (const s of ss) {
      const position: Vec2 = [r6(e.a[0] + e.u[0] * s + e.n[0] * (d / 2)), r6(e.a[1] + e.u[1] * s + e.n[1] * (d / 2))];
      out.push({ position, rotationDeg, footprint: rectFootprint(position, rotationDeg, w, d), wall: { a: e.a, b: e.b }, score: dist(position, from) });
    }
  }
  return out.sort((x, y) => x.score - y.score);
}

/** Free-mode turn: the item's long side along the room's long side. */
function freeRotation(room: DerivedRoom | null, w: number, d: number): number {
  if (!room) return 0;
  const bw = room.bbox.max[0] - room.bbox.min[0];
  const bh = room.bbox.max[1] - room.bbox.min[1];
  return bh > bw * 1.15 && w > d * 1.15 ? 90 : 0;
}

/** Points on square rings of RING_STEP_M around `c` (nearest first), up to `maxR`. */
function ringPoints(c: Vec2, maxR: number): Vec2[] {
  const pts: Vec2[] = [c];
  const n = Math.ceil(maxR / RING_STEP_M);
  for (let k = 1; k <= n; k++) {
    const r = k * RING_STEP_M;
    const ring: Vec2[] = [];
    for (let i = -k; i <= k; i++) {
      ring.push([c[0] + i * RING_STEP_M, c[1] - r], [c[0] + i * RING_STEP_M, c[1] + r]);
      if (i !== -k && i !== k) ring.push([c[0] - r, c[1] + i * RING_STEP_M], [c[0] + r, c[1] + i * RING_STEP_M]);
    }
    ring.sort((p, q) => dist(p, c) - dist(q, c));
    pts.push(...ring.map((p): Vec2 => [r6(p[0]), r6(p[1])]));
  }
  return pts;
}

function result(c: Candidate, room: DerivedRoom | null, free: boolean): FurniturePlacement {
  const out: FurniturePlacement = { position: c.position, rotationDeg: c.rotationDeg, footprint: c.footprint, free };
  if (room) {
    out.levelId = room.levelId;
    out.roomId = room.id;
  }
  if (c.wall) out.wall = c.wall;
  return out;
}

/**
 * Tap-to-place (see the header): in `room` when given, else in the room under `at` (on `storeyId`), else at `at`.
 * `exclude`: item ids that are no obstacle.
 */
export function tapPlacement(derived: DerivedVariant, storeyId: Id, spec: PlacementSpec, at: Vec2, room?: DerivedRoom | null, exclude?: ReadonlySet<Id>): FurniturePlacement {
  const { w, d, h } = spec.size;
  const z0 = spec.elevation ?? 0;
  const target = room ?? roomAt(derived, storeyId, at);
  const from = target ? target.labelPoint : at;
  const obstacles = placementObstacles(derived, target?.storeyId ?? storeyId, [z0, z0 + h], exclude, spec.flat);
  const ok = (fp: Vec2[]) => (!target || insideRoom(fp, target)) && !overlapsAny(fp, obstacles);

  if (spec.mode !== 'free' && target) {
    const edges = roomWallEdges(derived, target, target.storeyId);
    const tries = spec.mode === 'corner' ? [true, false] : [false];
    let inside: Candidate | null = null;
    for (const cornersOnly of tries) {
      const cands = wallCandidates(edges, w, d, from, cornersOnly);
      for (const c of cands) {
        if (ok(c.footprint)) return result(c, target, true);
        if (!inside && insideRoom(c.footprint, target)) inside = c;
      }
    }
    if (inside) return result(inside, target, false);
  }

  // Free spot near the start point (also the fallback of wall items in a room without a wall that fits).
  const rotationDeg = freeRotation(target, w, d);
  const start: Vec2 = [roundTo(from[0], RING_STEP_M), roundTo(from[1], RING_STEP_M)];
  const maxR = target ? Math.min(MAX_RING_M, Math.hypot(target.bbox.max[0] - target.bbox.min[0], target.bbox.max[1] - target.bbox.min[1])) : 3;
  let checks = 0;
  for (const p of ringPoints(start, maxR)) {
    if (target && !pointInPolygon(p, target.polygon)) continue;
    if (++checks > MAX_FREE_CHECKS) break;
    const fp = rectFootprint(p, rotationDeg, w, d);
    if (ok(fp)) return result({ position: p, rotationDeg, footprint: fp, score: 0 }, target, true);
  }
  return result({ position: start, rotationDeg, footprint: rectFootprint(start, rotationDeg, w, d), score: 0 }, target, false);
}

// ---------------------------------------------------------------------------
// Drop placement
// ---------------------------------------------------------------------------

const snapCache = new WeakMap<object, Map<Id, SnapContext>>();

function snapContextFor(derived: DerivedVariant, storeyId: Id): SnapContext {
  let m = snapCache.get(derived);
  if (!m) {
    m = new Map();
    snapCache.set(derived, m);
  }
  let ctx = m.get(storeyId);
  if (!ctx) {
    ctx = buildSnapContext(derived, { storeyId });
    m.set(storeyId, ctx);
  }
  return ctx;
}

/**
 * Drop at plan point `at` (see the header). `reach`: the snap reach in metres (the plan's snap radius at its zoom,
 * capped at LINE_SNAP_MAX_M by the snapper).
 */
export function dropPlacement(derived: DerivedVariant, storeyId: Id, spec: PlacementSpec, at: Vec2, opts: { reach?: number; exclude?: ReadonlySet<Id> } = {}): FurniturePlacement {
  const { w, d, h } = spec.size;
  const z0 = spec.elevation ?? 0;
  const room = roomAt(derived, storeyId, at);
  const obstacles = placementObstacles(derived, storeyId, [z0, z0 + h], opts.exclude, spec.flat);
  const isFree = (fp: Vec2[]) => (!room || insideRoom(fp, room)) && !overlapsAny(fp, obstacles);

  if (spec.mode !== 'free' && room) {
    let best: { e: WallEdge; gap: number } | null = null;
    for (const e of roomWallEdges(derived, room, storeyId)) {
      const s = dot(sub(at, e.a), e.u);
      const off = dot(sub(at, e.a), e.n);
      const along = s < 0 ? -s : s > e.length ? s - e.length : 0;
      const gap = Math.hypot(along, Math.max(0, off));
      if (off < -0.05 || gap > d / 2 + DROP_WALL_REACH_M) continue;
      if (!best || gap < best.gap) best = { e, gap };
    }
    if (best) {
      const e = best.e;
      const rotationDeg = rotationFacing(e.n);
      const lo = w / 2;
      const hi = e.length - w / 2;
      let s = lo > hi ? e.length / 2 : Math.min(hi, Math.max(lo, dot(sub(at, e.a), e.u)));
      if (spec.mode === 'corner' && lo <= hi) {
        if (s - lo <= CORNER_PULL_M) s = lo;
        else if (hi - s <= CORNER_PULL_M) s = hi;
      }
      const position: Vec2 = [r6(e.a[0] + e.u[0] * s + e.n[0] * (d / 2)), r6(e.a[1] + e.u[1] * s + e.n[1] * (d / 2))];
      const footprint = rectFootprint(position, rotationDeg, w, d);
      return result({ position, rotationDeg, footprint, wall: { a: e.a, b: e.b }, score: 0 }, room, isFree(footprint));
    }
  }

  const rotationDeg = spec.mode === 'free' ? freeRotation(room, w, d) : 0;
  const raw = rectFootprint(at, rotationDeg, w, d);
  const reach = Math.min(opts.reach ?? LINE_SNAP_MAX_M, LINE_SNAP_MAX_M);
  const snapped = snapFootprint(snapContextFor(derived, storeyId), raw, { radius: reach, excludeIds: opts.exclude ? new Set(opts.exclude) : undefined });
  const position: Vec2 = [r6(at[0] + snapped.delta[0]), r6(at[1] + snapped.delta[1])];
  const footprint = rectFootprint(position, rotationDeg, w, d);
  return result({ position, rotationDeg, footprint, score: 0 }, room, isFree(footprint));
}
