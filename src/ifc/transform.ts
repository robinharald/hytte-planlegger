/**
 * IFC frame → plan frame (architecture.md "Coordinate systems").
 *
 * plan (x, y) = R(rotation) · (u, ±v) + (dx, dy), plan z = h + dz, with (u, v, h) = IFC (X, Y, Z) (types.ts).
 *
 * Calibration for «SIBSAS 11453 IB Hytte Merskarvann v01.ifc» (docs/kalibrering-ifc.md, line 3: in web-ifc's Y-up world
 * "X = x + 4.71, Y = 1.79 − z, H = y"): translation (4.71, 1.79, 0), rotation 0°, NO mirror. The minus in "1.79 − z" is
 * web-ifc's own Z-up → Y-up turn (its world z is −IFC Y), not a mirror, so in the IFC's frame it is a pure shift:
 * x = X + 4.71, y = Y + 1.79, z = Z (the IFC's Z = 0 is the main floor, kote 99.85). The fit: the IFC's exterior
 * walls (cladding outer face 0.11 outside the axis, gypsum inner face 0.16 inside) land on the seed's existing walls,
 * whose axis rectangle (0,0)–(12,6.2) is today's main house ((0,0)–(16,6.2) in Forslag D with the 4 m extension);
 * align.real.test.ts measures it on the real file (every face within 1 mm). The panel can nudge the overlay
 * ±0.10 m in 1 cm steps on top of it (`withNudge`).
 */
import type { Vec2 } from '../model/types';

export interface IfcTransform {
  dx: number;
  dy: number;
  dz: number;
  /** Counter-clockwise, degrees, applied after the mirror. */
  rotationDeg: number;
  /** Mirror the IFC's Y axis before rotating. */
  mirror: boolean;
}

export interface IfcNudge {
  dx: number;
  dy: number;
}

export const IFC_CALIBRATION: Readonly<IfcTransform> = { dx: 4.71, dy: 1.79, dz: 0, rotationDeg: 0, mirror: false };

/** One press of a nudge button (m) and the furthest the overlay can be nudged from the calibration (m, per axis). */
export const NUDGE_STEP = 0.01;
export const NUDGE_MAX = 0.1;

export const NO_NUDGE: Readonly<IfcNudge> = { dx: 0, dy: 0 };

const clampAxis = (v: number) => {
  const c = Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, Number.isFinite(v) ? v : 0));
  return Math.round(c * 100) / 100 || 0;
};

/** Whole centimetres within ±NUDGE_MAX. */
export function clampNudge(n: IfcNudge): IfcNudge {
  return { dx: clampAxis(n.dx), dy: clampAxis(n.dy) };
}

export function withNudge(base: Readonly<IfcTransform>, nudge: IfcNudge): IfcTransform {
  const n = clampNudge(nudge);
  return { ...base, dx: base.dx + n.dx, dy: base.dy + n.dy };
}

function basis(t: IfcTransform): { c: number; s: number; m: number } {
  const r = (t.rotationDeg * Math.PI) / 180;
  return { c: Math.cos(r), s: Math.sin(r), m: t.mirror ? -1 : 1 };
}

export function ifcToPlan(t: IfcTransform, u: number, v: number): Vec2 {
  const { c, s, m } = basis(t);
  return [c * u - s * m * v + t.dx, s * u + c * m * v + t.dy];
}

export function planToIfc(t: IfcTransform, x: number, y: number): Vec2 {
  const { c, s, m } = basis(t);
  const px = x - t.dx;
  const py = y - t.dy;
  return [c * px + s * py, m * (-s * px + c * py)];
}

/** IFC height of a plan height (the section cut planes). */
export function ifcHeight(t: IfcTransform, planZ: number): number {
  return planZ - t.dz;
}

/** SVG `matrix(a b c d e f)` taking IFC (u, v) to plan (x, y) (inside the plan's flipped root group). */
export function svgMatrix(t: IfcTransform): string {
  const { c, s, m } = basis(t);
  const f = (n: number) => String(Math.round(n * 1e6) / 1e6 || 0);
  return `matrix(${f(c)} ${f(s)} ${f(-s * m)} ${f(c * m)} ${f(t.dx)} ${f(t.dy)})`;
}

/**
 * Row-major 4 × 4 (for three's `Matrix4.set`) taking IFC (u, v, h) to the three.js world of view3d/coords.ts
 * (X = x, Y = z, Z = −y).
 */
export function worldMatrix(t: IfcTransform): number[] {
  const { c, s, m } = basis(t);
  // prettier-ignore
  return [
    c, -s * m, 0, t.dx,
    0, 0, 1, t.dz,
    -s, -c * m, 0, -t.dy,
    0, 0, 0, 1,
  ];
}
