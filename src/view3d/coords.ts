/**
 * Plan frame ↔ three.js world frame.
 *
 * Plan: x, y in metres (right-handed, y "up" on paper), z metres above the main floor.
 * World: X = x, Y = z, Z = −y — a proper rotation (det +1), identical to the old model's `W(x, y, h)`.
 * Because it is a rotation, winding order and normals carry over unchanged (map normals the same way).
 */
import { Vector3 } from 'three';
import type { Vec2, Vec3 } from '../model/types';

export function toWorld(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, z, -y);
}

export function toWorldTuple(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

export function vec3ToWorld(p: Vec3): Vector3 {
  return new Vector3(p[0], p[2], -p[1]);
}

/** World → plan [x, y, z]. */
export function fromWorld(v: { x: number; y: number; z: number }): Vec3 {
  return [v.x, -v.z, v.y];
}

/**
 * `rotation.y` that maps a group's local +x axis onto the plan direction `dir` (unit or not).
 * With that rotation local +z is the RIGHT normal of `dir` in plan ((dy, −dx) = outside for exterior walls)
 * and local −z the LEFT normal ((−dy, dx) = inside).
 */
export function rotationYForPlanDir(dir: Vec2): number {
  return Math.atan2(dir[1], dir[0]);
}

export function planDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function planMid(a: Vec2, b: Vec2): Vec2 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
