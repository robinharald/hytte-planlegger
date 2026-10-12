/**
 * Where a furniture item dropped on the 3D view lands (pure math; phase 2b uses it through View3D's
 * `onDropFurniture(catalogId, planPoint, hit)`).
 *
 * The pointer's camera ray (plan frame) is intersected with the surfaces furniture can stand on, and the nearest hit
 * wins:
 *  - floors of visible levels (DerivedFloor kinds 'room', 'threshold' and 'slab'; never flat ceilings), each a
 *    horizontal polygon with holes at its z;
 *  - deck pieces (`DerivedDeck.pieces`, holes included) at the deck top;
 *  - the terrain (marched along the ray in DROP_TERRAIN_STEP steps up to DROP_MAX_DISTANCE, then bisected), when the
 *    view shows it.
 * Everything else (walls, roofs, railings, the hot tub) is looked through: a drop "lands on the floor at the hit
 * point" (docs/phase2-plan.md §3.2), even when the roof is on. Horizontal surfaces count only from above (the ray
 * travels down and starts above them). No hit → null (the view then does not accept the drop).
 */
import { Raycaster, Vector2 } from 'three';
import type { Camera } from 'three';
import { pointInPolygon } from '../geometry/polygon';
import type { DerivedDeck, DerivedFloor } from '../model/derived';
import type { Id, Vec2, Vec3 } from '../model/types';
import { fromWorld } from './coords';
import type { Visibility } from './visibility';

/** A ray in the plan frame: origin (x, y, z) and a unit direction. */
export interface PlanRay {
  origin: Vec3;
  dir: Vec3;
}

export interface DropSurface {
  kind: 'floor' | 'deck';
  /** Floor id / deck id. */
  id: Id;
  /** Floors: their level. */
  levelId?: Id;
  z: number;
  ring: Vec2[];
  holes: Vec2[][];
}

export interface DropHit {
  /** Plan point where the item lands. */
  point: Vec2;
  /** Height of the surface there (m above the main floor). */
  z: number;
  /** Distance along the ray (m). */
  t: number;
  surface: 'floor' | 'deck' | 'terrain';
  /** Floor id / deck id (none for the terrain). */
  id?: Id;
  /** The floor's level (floors only). */
  levelId?: Id;
}

/** Floor kinds furniture can stand on. */
export const DROP_FLOOR_KINDS: readonly DerivedFloor['kind'][] = ['room', 'threshold', 'slab'];
/** Terrain march step along the ray (m). */
export const DROP_TERRAIN_STEP = 0.5;
/** Farthest terrain hit considered (m along the ray). */
export const DROP_MAX_DISTANCE = 600;

/** The drop surfaces: floors of visible levels and every deck piece. */
export function dropSurfaces(floors: DerivedFloor[], decks: DerivedDeck[], vis: Pick<Visibility, 'isLevelVisible'>): DropSurface[] {
  const out: DropSurface[] = [];
  for (const f of floors) {
    if (!DROP_FLOOR_KINDS.includes(f.kind) || f.polygon.length < 3 || !vis.isLevelVisible(f.levelId)) continue;
    out.push({ kind: 'floor', id: f.id, levelId: f.levelId, z: f.z, ring: f.polygon, holes: f.holes });
  }
  for (const d of decks) {
    for (const piece of d.pieces) {
      const [ring, ...holes] = piece;
      if (!ring || ring.length < 3) continue;
      out.push({ kind: 'deck', id: d.id, z: d.topZ, ring, holes });
    }
  }
  return out;
}

/** Normalised device coordinates of a viewport point inside `rect`, or null when it lies outside. */
export function ndcOf(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } | null {
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const u = (clientX - rect.left) / rect.width;
  const v = (clientY - rect.top) / rect.height;
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
  return { x: u * 2 - 1, y: 1 - v * 2 };
}

/** The camera ray through NDC (x, y), in the plan frame. The camera's matrices must be current. */
export function planRayFromNdc(camera: Camera, x: number, y: number): PlanRay {
  const r = new Raycaster();
  r.setFromCamera(new Vector2(x, y), camera);
  const o = fromWorld(r.ray.origin);
  const d = fromWorld(r.ray.direction);
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return { origin: o, dir: [d[0] / l, d[1] / l, d[2] / l] };
}

function at(ray: PlanRay, t: number): Vec3 {
  return [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
}

/** Distance along the ray to the horizontal plane at z, reached from above; null when the ray never comes down onto it. */
export function rayPlaneFromAbove(ray: PlanRay, z: number): number | null {
  const dz = ray.dir[2];
  if (!(dz < -1e-9) || !(ray.origin[2] > z)) return null;
  const t = (z - ray.origin[2]) / dz;
  return t >= 0 ? t : null;
}

function inSurface(p: Vec2, s: DropSurface): boolean {
  return pointInPolygon(p, s.ring) && !s.holes.some((h) => h.length >= 3 && pointInPolygon(p, h));
}

/**
 * Nearest drop hit of the ray: the planar surfaces, then the terrain (`groundZ`, null = no terrain) closer than the
 * best planar hit. Null when nothing is hit.
 */
export function dropHit(
  ray: PlanRay,
  surfaces: DropSurface[],
  groundZ: ((x: number, y: number) => number) | null,
  opts: { step?: number; maxDistance?: number } = {},
): DropHit | null {
  let best: DropHit | null = null;
  for (const s of surfaces) {
    const t = rayPlaneFromAbove(ray, s.z);
    if (t === null || (best && t >= best.t)) continue;
    const p = at(ray, t);
    const point: Vec2 = [p[0], p[1]];
    if (!inSurface(point, s)) continue;
    best = { point, z: s.z, t, surface: s.kind, id: s.id };
    if (s.levelId !== undefined) best.levelId = s.levelId;
  }
  if (!groundZ) return best;
  const step = opts.step ?? DROP_TERRAIN_STEP;
  const maxT = Math.min(best ? best.t : Infinity, opts.maxDistance ?? DROP_MAX_DISTANCE);
  const above = (t: number) => {
    const p = at(ray, t);
    return p[2] - groundZ(p[0], p[1]);
  };
  if (!(above(0) > 0)) return best; // starting underground: the terrain cannot be hit from here
  let t0 = 0;
  while (t0 < maxT) {
    const t1 = Math.min(t0 + step, maxT);
    if (above(t1) <= 0) {
      let lo = t0;
      let hi = t1;
      for (let i = 0; i < 40 && hi - lo > 1e-6; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid) > 0) lo = mid;
        else hi = mid;
      }
      const p = at(ray, hi);
      return { point: [p[0], p[1]], z: groundZ(p[0], p[1]), t: hi, surface: 'terrain' };
    }
    t0 = t1;
  }
  return best;
}
