/**
 * First-person walk mode ("Gå rundt"): the pure kinematics (no three.js, no React), so they can be unit-tested.
 *
 * The walker is a vertical capsule seen from above as a circle (`WALK_RADIUS`) with its feet on a surface:
 *  - Surfaces (`WalkWorld.surfaces`): the derived floors (rooms, thresholds, slabs; flat ceilings only for headroom),
 *    stair treads, deck pieces (minus their holes) and deck-step treads, plus the terrain (`ground`). A point closer
 *    than `EDGE_TOLERANCE` to a surface's outline counts as on it, so the seam between two rooms never drops the
 *    walker.
 *  - Support (`supportAt`): the highest surface at the point no more than `WALK_STEP_UP` above the feet, so stair
 *    treads and door sills are climbed and the walker steps down any height; a surface whose slab overlaps the body
 *    band (`WALK_STEP_UP` … `WALK_BODY_BLOCK` above the feet) is a ledge and blocks (the deck edge seen from the
 *    terrain below it, the underside of a stair); open water (ground under `waterZ`) and points outside `limits`
 *    block too. The terrain is always a candidate, so the feet never go below it.
 *  - Obstacles (`WalkWorld.segments`): the edges of every standing wall footprint with the passable openings cut out
 *    (doors, glass, sliding and sauna doors and frameless openings whose sill is at most 0.35 m above their floor and
 *    which are at least 1.2 m high; windows, the glass bump's included, stay wall), the railing panels, the hot tubs
 *    and the posts and chimneys. An obstacle blocks when its z range overlaps the body band. `pushOut` moves the
 *    circle out of every blocking segment (a few passes), which makes the walker slide along walls; `moveWalker`
 *    splits a move into sub-steps of at most `WALK_SUBSTEP` (less than the radius, so no wall is tunnelled) and
 *    tries the x and y parts alone when the whole step is refused.
 *  - Eye height (`eyeTargetAt`): `WALK_EYE_HEIGHT` (1.65 m) above the feet, lowered under a low ceiling (slab, flat
 *    ceiling, roof underside) to `CEILING_GAP` below it, never under `MIN_EYE` above the feet (ducking). `stepWalk`
 *    eases the eye towards it (`HEIGHT_RATE`), so stairs and the deck step read as smooth, keeps it within
 *    `MAX_EYE_LAG` below the target, so the camera never sinks into the terrain or a floor, and under the ceiling.
 *  - Deck-step treads may be climbed from up to `STEPS_CLIMB` below (their foot can stand above a sloping terrain).
 *
 * Plan frame: heading h is the plan angle from +x towards +y; forward = (cos h, sin h), right = (sin h, −cos h);
 * pitch > 0 looks up. Inputs: forward / strafe in −1 … 1 (keys, joystick), `run` (Shift).
 */
import { pointInPolygon } from '../geometry/polygon';
import { combinedUndersideAt } from '../geometry/roof';
import type { DerivedOpening, DerivedRoom, DerivedVariant, DerivedWall } from '../model/derived';
import type { Id, Vec2 } from '../model/types';

export const WALK_EYE_HEIGHT = 1.65;
export const WALK_RADIUS = 0.22;
/** Highest step the walker climbs (stairs, sills, the deck from the terrain where there is no railing). */
export const WALK_STEP_UP = 0.5;
/**
 * Highest step up onto a deck-step tread: the derived steps end at the terrain height at the deck edge, so on a
 * slope their last tread can stand well above the ground at its foot (0.77 m at the seed's south steps).
 */
export const STEPS_CLIMB = 0.9;
/** Top of the body band that obstacles and ledges block (the walker may duck below a lower ceiling). */
export const WALK_BODY_BLOCK = 1.4;
export const WALK_SPEED = 1.4;
export const RUN_SPEED = 3.2;
export const WALK_SUBSTEP = 0.08;
export const PITCH_LIMIT = 1.35;
/** Lowest eye height above the feet (ducking under a low ceiling). */
export const MIN_EYE = 1.25;
export const CEILING_GAP = 0.15;
export const EDGE_TOLERANCE = 0.03;
/** Eye height easing rate (1/s). */
export const HEIGHT_RATE = 10;
/** Most the eased eye may lag behind its target (m). */
export const MAX_EYE_LAG = 0.5;
/** Passable openings: sill at most this far above their floor, at least this high and wide. */
export const PASSABLE_SILL = 0.35;
export const PASSABLE_HEIGHT = 1.2;
export const PASSABLE_WIDTH = 0.45;
/** How far around the built bounds the walker may go (m). */
export const WALK_LIMIT_MARGIN = 40;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface WalkSegment extends Box {
  a: Vec2;
  b: Vec2;
  zLo: number;
  zHi: number;
}

export interface WalkSurface extends Box {
  polygon: Vec2[];
  holes: Vec2[][];
  /** Top (walking) height. */
  z: number;
  /** Underside (ledge and headroom tests). */
  bottom: number;
  /** Walkable; flat ceilings are not (headroom only). */
  walkable: boolean;
  /** Highest step up onto it (`WALK_STEP_UP`; more for deck-step treads, whose foot may stand above a slope). */
  climb: number;
}

export interface WalkWorld {
  segments: WalkSegment[];
  surfaces: WalkSurface[];
  roofs: DerivedVariant['roofs'];
  ground: (x: number, y: number) => number;
  waterZ: number | null;
  limits: Box;
}

export interface WalkPose {
  pos: Vec2;
  /** Height of the surface the walker stands on. */
  feetZ: number;
  /** Eased eye height (camera z). */
  eyeZ: number;
  heading: number;
  pitch: number;
}

export interface WalkInput {
  forward: number;
  strafe: number;
  run: boolean;
}

export const NO_INPUT: WalkInput = { forward: 0, strafe: 0, run: false };

// ---------------------------------------------------------------------------
// Small geometry helpers
// ---------------------------------------------------------------------------

function boxOf(points: readonly Vec2[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function inBox(b: Box, p: Vec2, pad: number): boolean {
  return p[0] >= b.minX - pad && p[0] <= b.maxX + pad && p[1] >= b.minY - pad && p[1] <= b.maxY + pad;
}

/** Closest point on segment ab to p. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return [a[0] + dx * t, a[1] + dy * t];
}

function distToRing(p: Vec2, ring: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const q = closestOnSegment(p, ring[i], ring[(i + 1) % ring.length]);
    best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
  }
  return best;
}

/** p on the surface: inside its outline (or within `EDGE_TOLERANCE` of it) and not deep inside a hole. */
export function onSurface(s: Pick<WalkSurface, 'polygon' | 'holes'> & Box, p: Vec2): boolean {
  if (!inBox(s, p, EDGE_TOLERANCE)) return false;
  const inside = pointInPolygon(p, s.polygon) || distToRing(p, s.polygon) <= EDGE_TOLERANCE;
  if (!inside) return false;
  for (const h of s.holes) if (h.length >= 3 && pointInPolygon(p, h) && distToRing(p, h) > EDGE_TOLERANCE) return false;
  return true;
}

function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Part of a polygon on one side of the line s = s0 (s measured from `a` along unit `u`). Sutherland–Hodgman. */
function clipAlong(poly: readonly Vec2[], a: Vec2, u: Vec2, s0: number, keep: 'above' | 'below'): Vec2[] {
  const f = (p: Vec2) => {
    const s = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1];
    return keep === 'above' ? s - s0 : s0 - s;
  };
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const fc = f(cur);
    const fp = f(prev);
    if (fc >= 0) {
      if (fp < 0) out.push(lerp2(prev, cur, fp / (fp - fc)));
      out.push(cur);
    } else if (fp >= 0) {
      out.push(lerp2(prev, cur, fp / (fp - fc)));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

/** An opening the walker passes through (see the header). `floorZ`: the elevation of the opening's level. */
export function isPassable(o: Pick<DerivedOpening, 'type' | 'isGhost' | 'status' | 'sillZ' | 'headZ' | 'width'>, floorZ: number): boolean {
  if (o.isGhost || o.status === 'removed' || o.type === 'window') return false;
  return o.sillZ - floorZ <= PASSABLE_SILL && o.headZ - o.sillZ >= PASSABLE_HEIGHT && o.width >= PASSABLE_WIDTH;
}

/** A wall that stands in 3D (visibility.ts `wallIsDrawn` without the cut: walk mode shows every storey). */
function wallStands(w: DerivedWall): boolean {
  return !w.isDivider && !w.isGhost && w.status !== 'removed' && w.footprint.length >= 3;
}

/**
 * The solid parts of a wall's footprint: the footprint cut across the wall at both jambs of every passable opening
 * (`levelZ` gives the elevation of a level id). Empty for walls that do not stand in 3D.
 */
export function wallSolidPieces(w: DerivedWall, levelZ: (id: Id) => number): Vec2[][] {
  if (!wallStands(w)) return [];
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  if (!(len > 1e-6)) return [w.footprint];
  const u: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
  const gaps = w.openings
    .filter((o) => isPassable(o, levelZ(o.levelId)))
    .map((o) => [o.offset - o.width / 2, o.offset + o.width / 2] as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const g of gaps) {
    const last = merged[merged.length - 1];
    if (last && g[0] <= last[1]) last[1] = Math.max(last[1], g[1]);
    else merged.push([g[0], g[1]]);
  }
  if (merged.length === 0) return [w.footprint];
  const pieces: Vec2[][] = [];
  let lo = -Infinity;
  for (const [g0, g1] of [...merged, [Infinity, Infinity] as [number, number]]) {
    if (g0 > lo) {
      let poly: Vec2[] = w.footprint;
      if (Number.isFinite(lo)) poly = clipAlong(poly, w.a, u, lo, 'above');
      if (Number.isFinite(g0) && poly.length >= 3) poly = clipAlong(poly, w.a, u, g0, 'below');
      if (poly.length >= 3) pieces.push(poly);
    }
    lo = g1;
  }
  return pieces;
}

function segmentsOfRing(ring: readonly Vec2[], zLo: number, zHi: number, out: WalkSegment[]): void {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
    out.push({ a, b, zLo, zHi, ...boxOf([a, b]) });
  }
}

function circleRing(c: Vec2, r: number, n = 16): Vec2[] {
  return Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)] as Vec2);
}

function boxRing(min: Vec2, max: Vec2): Vec2[] {
  return [
    [min[0], min[1]],
    [max[0], min[1]],
    [max[0], max[1]],
    [min[0], max[1]],
  ];
}

function surface(polygon: Vec2[], holes: Vec2[][], z: number, bottom: number, walkable = true, climb = WALK_STEP_UP): WalkSurface {
  return { polygon, holes, z, bottom, walkable, climb, ...boxOf(polygon) };
}

export type WalkDerived = Pick<DerivedVariant, 'walls' | 'floors' | 'structure' | 'outdoor' | 'roofs' | 'levels' | 'bounds' | 'site'>;

/** Everything the walker collides with and stands on, from the derived model and the terrain height function. */
export function buildWalkWorld(derived: WalkDerived, ground: (x: number, y: number) => number): WalkWorld {
  const levelZ = (id: Id) => derived.levels.find((l) => l.id === id)?.elevation ?? 0;
  const segments: WalkSegment[] = [];
  for (const w of derived.walls) {
    for (const piece of wallSolidPieces(w, levelZ)) segmentsOfRing(piece, w.baseZ, w.topZ, segments);
  }
  for (const r of derived.outdoor.railings) {
    for (const p of r.panels) {
      const a: Vec2 = [p.a[0], p.a[1]];
      const b: Vec2 = [p.b[0], p.b[1]];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6) segments.push({ a, b, zLo: r.baseZ, zHi: r.baseZ + r.height, ...boxOf([a, b]) });
    }
  }
  for (const t of derived.outdoor.hotTubs) segmentsOfRing(circleRing(t.centre, t.diameter / 2), t.baseZ, t.rimZ, segments);
  for (const s of derived.structure) {
    if (s.kind === 'post') {
      const h = s.size / 2;
      segmentsOfRing(boxRing([s.position[0] - h, s.position[1] - h], [s.position[0] + h, s.position[1] + h]), s.bottomZ, s.topZ, segments);
    } else if (s.kind === 'chimney') {
      segmentsOfRing(boxRing(s.min, s.max), s.bottomZ, s.topZ, segments);
    }
  }

  const surfaces: WalkSurface[] = [];
  for (const f of derived.floors) {
    if (f.polygon.length < 3) continue;
    if (f.kind === 'ceiling') surfaces.push(surface(f.polygon, f.holes, f.z, f.z - Math.max(0.05, f.thickness), false));
    else surfaces.push(surface(f.polygon, f.holes, f.z, f.z - Math.max(0, f.thickness)));
  }
  for (const s of derived.structure) {
    if (s.kind !== 'stair') continue;
    for (const t of s.treads) if (t.polygon.length >= 3) surfaces.push(surface(t.polygon, [], t.z, t.z - 0.05));
  }
  for (const d of derived.outdoor.decks) {
    for (const piece of d.pieces) {
      if (!piece[0] || piece[0].length < 3) continue;
      surfaces.push(surface(piece[0], piece.slice(1), d.topZ, d.topZ - d.thickness));
    }
  }
  for (const st of derived.outdoor.steps) {
    if (st.blocked) continue;
    for (const t of st.treads) if (t.polygon.length >= 3) surfaces.push(surface(t.polygon, [], t.z, t.z - 0.05, true, STEPS_CLIMB));
  }
  const b = derived.bounds;
  const ok = [b.min[0], b.min[1], b.max[0], b.max[1]].every(Number.isFinite);
  const limits: Box = ok
    ? { minX: b.min[0] - WALK_LIMIT_MARGIN, minY: b.min[1] - WALK_LIMIT_MARGIN, maxX: b.max[0] + WALK_LIMIT_MARGIN, maxY: b.max[1] + WALK_LIMIT_MARGIN }
    : { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  return { segments, surfaces, roofs: derived.roofs, ground, waterZ: derived.site.waterZ ?? null, limits };
}

// ---------------------------------------------------------------------------
// Support, headroom, collisions
// ---------------------------------------------------------------------------

export interface Support {
  /** Height the feet stand on (the best candidate, also when blocked). */
  z: number;
  /** The walker cannot stand here (ledge, nothing reachable, open water, outside the limits). */
  blocked: boolean;
}

/** What the walker would stand on at p with its feet at `feetZ` (see the header). */
export function supportAt(world: WalkWorld, p: Vec2, feetZ: number): Support {
  const groundZ = world.ground(p[0], p[1]);
  let best = Number.isFinite(groundZ) && groundZ <= feetZ + WALK_STEP_UP ? groundZ : -Infinity;
  let onGround = best > -Infinity;
  let blocked = !inBox(world.limits, p, 0);
  for (const s of world.surfaces) {
    if (!onSurface(s, p)) continue;
    const reach = feetZ + (s.walkable ? s.climb : WALK_STEP_UP);
    if (s.z > reach && s.bottom < feetZ + WALK_BODY_BLOCK) blocked = true;
    if (s.walkable && s.z <= reach && s.z > best) {
      best = s.z;
      onGround = false;
    }
  }
  if (best === -Infinity) return { z: Number.isFinite(groundZ) ? groundZ : feetZ, blocked: true };
  if (onGround && world.waterZ !== null && best < world.waterZ) blocked = true;
  return { z: best, blocked };
}

/** Lowest ceiling (slab underside, flat ceiling, roof underside) above the body band at p, or Infinity. */
export function headroomAt(world: WalkWorld, p: Vec2, feetZ: number): number {
  const band = feetZ + WALK_BODY_BLOCK;
  let best = Infinity;
  for (const s of world.surfaces) {
    if (s.bottom >= band && s.bottom < best && onSurface(s, p)) best = s.bottom;
  }
  const roof = combinedUndersideAt(world.roofs, p[0], p[1]);
  if (roof !== null && roof >= band && roof < best) best = roof;
  return best;
}

/** Eye height the walker settles to at p: 1.65 m above the feet, ducking under a low ceiling. */
export function eyeTargetAt(world: WalkWorld, p: Vec2, feetZ: number): number {
  return eyeAt(world, p, feetZ).target;
}

function eyeAt(world: WalkWorld, p: Vec2, feetZ: number): { target: number; ceiling: number } {
  const ceiling = headroomAt(world, p, feetZ);
  return { target: feetZ + Math.max(MIN_EYE, Math.min(WALK_EYE_HEIGHT, ceiling - CEILING_GAP - feetZ)), ceiling };
}

function blocks(s: WalkSegment, feetZ: number): boolean {
  return s.zHi > feetZ + WALK_STEP_UP && s.zLo < feetZ + WALK_BODY_BLOCK;
}

function near(s: Box, x: number, y: number, r: number): boolean {
  return x >= s.minX - r && x <= s.maxX + r && y >= s.minY - r && y <= s.maxY + r;
}

/** Moves the walker's circle out of every blocking obstacle (a few passes; sliding along walls follows from it). */
export function pushOut(world: WalkWorld, p: Vec2, feetZ: number, r = WALK_RADIUS): Vec2 {
  let x = p[0];
  let y = p[1];
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const s of world.segments) {
      if (!near(s, x, y, r) || !blocks(s, feetZ)) continue;
      const q = closestOnSegment([x, y], s.a, s.b);
      const dx = x - q[0];
      const dy = y - q[1];
      const d = Math.hypot(dx, dy);
      if (d >= r - 1e-9) continue;
      if (d > 1e-9) {
        x = q[0] + (dx / d) * r;
        y = q[1] + (dy / d) * r;
      } else {
        // on the segment itself: out along its left normal
        const ex = s.b[0] - s.a[0];
        const ey = s.b[1] - s.a[1];
        const l = Math.hypot(ex, ey) || 1;
        x = q[0] - (ey / l) * r;
        y = q[1] + (ex / l) * r;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return [x, y];
}

/** True when the circle at p overlaps a blocking obstacle. */
export function collides(world: WalkWorld, p: Vec2, feetZ: number, r = WALK_RADIUS): boolean {
  for (const s of world.segments) {
    if (!near(s, p[0], p[1], r) || !blocks(s, feetZ)) continue;
    const q = closestOnSegment(p, s.a, s.b);
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) < r - 1e-6) return true;
  }
  return false;
}

function tryStep(world: WalkWorld, pos: Vec2, feetZ: number, d: Vec2): { pos: Vec2; feetZ: number } | null {
  if (d[0] === 0 && d[1] === 0) return null;
  const cand = pushOut(world, [pos[0] + d[0], pos[1] + d[1]], feetZ);
  if (collides(world, cand, feetZ)) return null;
  // a push-out larger than the step means the walker was squeezed sideways: refuse rather than jump
  if (Math.hypot(cand[0] - pos[0], cand[1] - pos[1]) > Math.hypot(d[0], d[1]) * 1.5 + 1e-6) return null;
  const s = supportAt(world, cand, feetZ);
  if (s.blocked) return null;
  // standing higher or lower changes which obstacles block
  if (Math.abs(s.z - feetZ) > 1e-9 && collides(world, cand, s.z)) return null;
  return { pos: cand, feetZ: s.z };
}

/** Moves the walker by the plan vector `delta` with collisions, sliding and climbing (see the header). */
export function moveWalker(world: WalkWorld, pos: Vec2, feetZ: number, delta: Vec2): { pos: Vec2; feetZ: number } {
  const len = Math.hypot(delta[0], delta[1]);
  if (!(len > 0)) return { pos, feetZ };
  const n = Math.max(1, Math.ceil(len / WALK_SUBSTEP));
  const d: Vec2 = [delta[0] / n, delta[1] / n];
  let cur = { pos, feetZ };
  for (let i = 0; i < n; i++) {
    const next = tryStep(world, cur.pos, cur.feetZ, d) ?? tryStep(world, cur.pos, cur.feetZ, [d[0], 0]) ?? tryStep(world, cur.pos, cur.feetZ, [0, d[1]]);
    if (!next) break;
    cur = next;
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Inputs, the frame step, the camera
// ---------------------------------------------------------------------------

/** Plan vector of a move input for a heading (length ≤ 1). */
export function moveDirection(heading: number, input: Pick<WalkInput, 'forward' | 'strafe'>): Vec2 {
  let f = input.forward;
  let s = input.strafe;
  const l = Math.hypot(f, s);
  if (l > 1) {
    f /= l;
    s /= l;
  }
  const c = Math.cos(heading);
  const n = Math.sin(heading);
  return [c * f + n * s, n * f - c * s];
}

/** One frame: move (speed × dt along the input), then ease the eye towards its target height. */
export function stepWalk(world: WalkWorld, pose: WalkPose, input: WalkInput, dt: number): WalkPose {
  const t = Math.max(0, Math.min(0.1, dt));
  const dir = moveDirection(pose.heading, input);
  const speed = input.run ? RUN_SPEED : WALK_SPEED;
  const moved = moveWalker(world, pose.pos, pose.feetZ, [dir[0] * speed * t, dir[1] * speed * t]);
  const { target, ceiling } = eyeAt(world, moved.pos, moved.feetZ);
  let eyeZ = pose.eyeZ + (target - pose.eyeZ) * (1 - Math.exp(-HEIGHT_RATE * t));
  // never more than MAX_EYE_LAG below the target (terrain, a floor), never into a ceiling when stepping down
  eyeZ = Math.max(target - MAX_EYE_LAG, Math.min(eyeZ, target + 4 * MAX_EYE_LAG, Math.max(target, ceiling - 0.05)));
  return { ...pose, pos: moved.pos, feetZ: moved.feetZ, eyeZ };
}

/** The eye has (nearly) reached its target height: no more frames are needed while there is no input. */
export function eyeSettled(world: WalkWorld, pose: WalkPose): boolean {
  return Math.abs(eyeTargetAt(world, pose.pos, pose.feetZ) - pose.eyeZ) < 0.002;
}

/** Mouse / touch look: `dx`, `dy` in screen px (right, down), `sens` radians per px. */
export function applyLook(pose: WalkPose, dx: number, dy: number, sens: number): WalkPose {
  const h = pose.heading - dx * sens;
  const heading = Math.atan2(Math.sin(h), Math.cos(h));
  const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pose.pitch - dy * sens));
  return { ...pose, heading, pitch };
}

/** Radians per px for a mouse with the pointer locked or dragging, and for a drag on a touch screen. */
export const MOUSE_SENS = 0.0024;
export const TOUCH_SENS = 0.0055;

/**
 * Joystick vector from the knob's offset (`dx` right, `dy` down, px) on a base of radius `radius`: { strafe,
 * forward } in −1 … 1, length ≤ 1, zero inside the dead zone (a fraction of the radius) and rescaled outside it.
 */
export function joystickVector(dx: number, dy: number, radius: number, deadZone = 0.15): { strafe: number; forward: number } {
  if (!(radius > 0)) return { strafe: 0, forward: 0 };
  const x = dx / radius;
  const y = -dy / radius;
  const m = Math.hypot(x, y);
  if (!(m > deadZone)) return { strafe: 0, forward: 0 };
  const k = Math.min(1, (m - deadZone) / (1 - deadZone)) / m;
  return { strafe: x * k, forward: y * k };
}

/** Where the joystick knob is drawn (px from the base centre): the offset clamped to the base radius. */
export function joystickKnob(dx: number, dy: number, radius: number): Vec2 {
  const m = Math.hypot(dx, dy);
  if (!(m > radius)) return [dx, dy];
  return [(dx / m) * radius, (dy / m) * radius];
}

/** Key codes (KeyboardEvent.code) the walk mode uses. */
export const WALK_KEYS: ReadonlySet<string> = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
]);

/** Move input from the pressed keys: W/↑ forward, S/↓ back, A/← left, D/→ right, Shift runs. */
export function keyInput(keys: ReadonlySet<string>): WalkInput {
  const has = (...k: string[]) => k.some((c) => keys.has(c));
  const forward = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
  const strafe = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0);
  return { forward, strafe, run: has('ShiftLeft', 'ShiftRight') };
}

/** Sum of two inputs (keys and joystick), clamped. */
export function combineInputs(a: WalkInput, b: WalkInput): WalkInput {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return { forward: clamp(a.forward + b.forward), strafe: clamp(a.strafe + b.strafe), run: a.run || b.run };
}

export function hasMotion(input: WalkInput): boolean {
  return Math.abs(input.forward) > 1e-6 || Math.abs(input.strafe) > 1e-6;
}

/**
 * Vertical field of view (degrees) for walking in a viewport of `aspect`: about 80° across, 50–75° high (the
 * orbit presets use 42°, which feels like binoculars at eye level).
 */
export function walkFov(aspect: number): number {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1.5;
  const v = (2 * Math.atan(Math.tan((40 * Math.PI) / 180) / a) * 180) / Math.PI;
  return Math.max(50, Math.min(75, v));
}

// ---------------------------------------------------------------------------
// Where a walk starts
// ---------------------------------------------------------------------------

/** Floor height of a room (its floor's z, else its level's elevation). */
function roomFloorZ(derived: Pick<DerivedVariant, 'floors' | 'levels'>, room: DerivedRoom): number {
  const f = derived.floors.find((x) => x.roomId === room.id && x.kind === 'room');
  return f?.z ?? derived.levels.find((l) => l.id === room.levelId)?.elevation ?? 0;
}

/** The living room: type 'stue' (the largest), else a room named Stue, else the largest room nearest the main floor. */
export function livingRoom(derived: Pick<DerivedVariant, 'rooms' | 'levels'>): DerivedRoom | null {
  const byArea = [...derived.rooms].filter((r) => r.polygon.length >= 3).sort((a, b) => b.area - a.area);
  const stue = byArea.find((r) => r.room?.type === 'stue') ?? byArea.find((r) => /\bstue\b/i.test(r.room?.name ?? ''));
  if (stue) return stue;
  const elev = (r: DerivedRoom) => Math.abs(derived.levels.find((l) => l.id === r.levelId)?.elevation ?? 0);
  return [...byArea].sort((a, b) => elev(a) - elev(b) || b.area - a.area)[0] ?? null;
}

function inRoom(room: DerivedRoom, p: Vec2): boolean {
  return pointInPolygon(p, room.polygon) && !room.holes.some((h) => h.length >= 3 && pointInPolygon(p, h));
}

/**
 * A pose standing at plan point p on the surface at (or just below) `z`, out of the walls, facing `heading`. With
 * `strict`, null when nobody can stand there.
 */
export function poseAt(world: WalkWorld, p: Vec2, z: number, heading: number, pitch: number): WalkPose;
export function poseAt(world: WalkWorld, p: Vec2, z: number, heading: number, pitch: number, strict: true): WalkPose | null;
export function poseAt(world: WalkWorld, p: Vec2, z: number, heading: number, pitch: number, strict = false): WalkPose | null {
  const s0 = supportAt(world, p, z + 0.05);
  const pos = pushOut(world, p, s0.z);
  const s = supportAt(world, pos, s0.z);
  if (strict && (s.blocked || collides(world, pos, s.z))) return null;
  return { pos, feetZ: s.z, eyeZ: eyeTargetAt(world, pos, s.z), heading, pitch };
}

/**
 * The default start: inside the living room, a little back from its door to the terrace (an exterior door whose
 * outside is a deck), facing it. Without such a door: the widest door out; without one, the room's label point
 * facing plan −y (towards the lake). Without rooms: on the terrain 6 m in front of the bounds.
 */
export function defaultWalkStart(derived: WalkDerived & Pick<DerivedVariant, 'rooms'>, world: WalkWorld): WalkPose {
  const room = livingRoom(derived);
  if (!room) {
    const raw: Vec2 = [(derived.bounds.min[0] + derived.bounds.max[0]) / 2, derived.bounds.min[1] - 6];
    const c: Vec2 = Number.isFinite(raw[0]) && Number.isFinite(raw[1]) ? raw : [0, 0];
    return poseAt(world, c, world.ground(c[0], c[1]), Math.PI / 2, 0);
  }
  const floorZ = roomFloorZ(derived, room);
  const levelZ = (id: Id) => derived.levels.find((l) => l.id === id)?.elevation ?? 0;
  const onDeck = (p: Vec2) =>
    derived.outdoor.decks.some((d) => d.pieces.some((pc) => !!pc[0] && pc[0].length >= 3 && onSurface({ polygon: pc[0], holes: pc.slice(1), ...boxOf(pc[0]) }, p)));
  const doors: { centre: Vec2; out: Vec2; deck: boolean; width: number }[] = [];
  for (const w of derived.walls) {
    if (!w.isExterior || !room.wallIds.includes(w.id)) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (!(len > 0)) continue;
    for (const o of w.openings) {
      if (!o.outward || !isPassable(o, levelZ(o.levelId))) continue;
      const centre: Vec2 = [w.a[0] + ((w.b[0] - w.a[0]) / len) * o.offset, w.a[1] + ((w.b[1] - w.a[1]) / len) * o.offset];
      doors.push({ centre, out: o.outward, deck: onDeck([centre[0] + o.outward[0], centre[1] + o.outward[1]]), width: o.width });
    }
  }
  doors.sort((a, b) => Number(b.deck) - Number(a.deck) || b.width - a.width);
  const door = doors[0];
  if (door) {
    // walk inwards from the door until the room ends (at most 6 m); stand 0.6 m short of that, 1–4 m from the door
    let depth = 0;
    for (let d = 0.3; d <= 6.001; d += 0.1) {
      if (!inRoom(room, [door.centre[0] - door.out[0] * d, door.centre[1] - door.out[1] * d])) break;
      depth = d;
    }
    const back = Math.max(1, Math.min(4, depth - 0.6));
    const p: Vec2 = [door.centre[0] - door.out[0] * back, door.centre[1] - door.out[1] * back];
    if (inRoom(room, p)) return poseAt(world, p, floorZ, Math.atan2(door.out[1], door.out[0]), -0.05);
  }
  const lp = room.labelPoint;
  const heading = door ? Math.atan2(door.centre[1] - lp[1], door.centre[0] - lp[0]) : -Math.PI / 2;
  return poseAt(world, lp, floorZ, heading, -0.05);
}

/**
 * Start for a walk entered with something selected: the point the user clicked in 3D (`pick`, moved 0.3 m towards
 * the camera so a click on a wall face starts on the clicked side), else a selected room's label point; facing
 * `heading` (the orbit camera's). Null when there is no such point or nobody can stand there.
 */
export function selectionWalkStart(
  derived: WalkDerived & Pick<DerivedVariant, 'rooms'>,
  world: WalkWorld,
  selection: { kind: string; id: Id } | null,
  pick: { point: Vec2; z: number } | null,
  camera: Vec2,
  heading: number,
): WalkPose | null {
  if (pick) {
    const dx = camera[0] - pick.point[0];
    const dy = camera[1] - pick.point[1];
    const d = Math.hypot(dx, dy);
    const k = d > 1e-6 ? Math.min(0.3, d) / d : 0;
    const pose = poseAt(world, [pick.point[0] + dx * k, pick.point[1] + dy * k], pick.z, heading, 0, true);
    if (pose) return pose;
  }
  if (selection?.kind === 'room') {
    const room = derived.rooms.find((r) => r.id === selection.id);
    if (room) return poseAt(world, room.labelPoint, roomFloorZ(derived, room), heading, 0, true);
  }
  return null;
}
