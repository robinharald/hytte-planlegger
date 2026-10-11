/**
 * Camera presets. The architecture doc gives each preset as a (position, target) pair in plan coordinates for
 * Forslag D. Here they are stored relative to Forslag D's reference bounds (`REF_BOUNDS`, outer outlines + deck)
 * and mapped onto the current `bounds`: targets move with the bounds centre, the camera offset scales with the
 * ratio of the bounds diagonals (clamped 0.5–3) so a much bigger or smaller design still fits the frame.
 * Interior presets (eye-level views inside a room) only translate, never scale, so the eye height is kept.
 * With the seed bounds the presets reproduce the doc's numbers exactly.
 */
import { Vector3 } from 'three';
import type { Vec2, Vec3 } from '../model/types';
import { toWorld } from './coords';

export type CameraPreset =
  | 'oversikt'
  | 'terrassen'
  | 'framsiden'
  | 'baksiden'
  | 'langsiden'
  | 'ovenfra'
  | 'naert-tilbygget'
  | 'inne-stua';

export const CAMERA_PRESETS: readonly CameraPreset[] = [
  'oversikt',
  'terrassen',
  'framsiden',
  'baksiden',
  'langsiden',
  'ovenfra',
  'naert-tilbygget',
  'inne-stua',
];

export const CAMERA_FOV = 42;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 1000;
export const CAMERA_ANIM_MS = 900;
export const ORBIT_LIMITS = { maxPolarAngle: Math.PI * 0.495, minDistance: 3, maxDistance: 120 } as const;

export interface PlanView {
  position: Vec3;
  target: Vec3;
}

/** Forslag D: outer outlines (x −0.11 … 20.91, y −2.11 … 12.21) plus the deck (5 … 23.2, −4.6 … 12.1). */
export const REF_BOUNDS: { min: Vec2; max: Vec2 } = { min: [-0.11, -4.6], max: [23.2, 12.21] };

/** Eye height (m above the main floor) of the eye-level presets. */
export const EYE_HEIGHT = 1.55;

/**
 * Doc values (plan coords, Forslag D), from the old model's views. 'framsiden' is the old model's east view
 * (the new wing's long side with the white glass door), 'langsiden' its lake facade (glass bump, stue door, the new
 * wing's south gable). 'inne-stua' stands at eye height in the west end of the stue and looks east-north-east along
 * the open plan, so the stue's own label point (8.0, 1.3), Passasje and Spiseplass are in frame (the stue's label
 * point lies west of x = 9.5, so a camera further east would have it behind it).
 */
const PRESET_VIEWS: Record<CameraPreset, PlanView> = {
  oversikt: { position: [36, -25, 26], target: [11.5, 4.5, 1.5] },
  terrassen: { position: [29, 19, 8], target: [14.5, 8, 1.2] },
  framsiden: { position: [38, 2, 4.5], target: [16, 2.5, 2] },
  baksiden: { position: [-14, 22, 8], target: [8, 5, 2] },
  langsiden: { position: [11, -27, 5], target: [12.5, 0, 2] },
  ovenfra: { position: [12, 4.49, 54], target: [12, 4.5, 0] },
  'naert-tilbygget': { position: [26, -9, 12], target: [17.5, 2.5, 0.6] },
  'inne-stua': { position: [6.3, 0.9, EYE_HEIGHT], target: [15.5, 4.5, 1.3] },
};

/** Eye-level presets inside the building: translated with the bounds, never scaled. */
export const INTERIOR_PRESETS: ReadonlySet<CameraPreset> = new Set<CameraPreset>(['inne-stua']);

function centre(b: { min: Vec2; max: Vec2 }): Vec2 {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
}
function diagonal(b: { min: Vec2; max: Vec2 }): number {
  return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]);
}

/** Scale factor applied to camera offsets for the given bounds. */
export function presetScale(bounds: { min: Vec2; max: Vec2 }): number {
  const d = diagonal(bounds);
  if (!Number.isFinite(d) || d < 1) return 1;
  return Math.min(3, Math.max(0.5, d / diagonal(REF_BOUNDS)));
}

/** Preset in plan coordinates for the given bounds. */
export function presetView(preset: CameraPreset, bounds: { min: Vec2; max: Vec2 }): PlanView {
  const ref = PRESET_VIEWS[preset] ?? PRESET_VIEWS.oversikt;
  const c0 = centre(REF_BOUNDS);
  const c1 = centre(bounds);
  const s = INTERIOR_PRESETS.has(preset) ? 1 : presetScale(bounds);
  const ok = Number.isFinite(c1[0]) && Number.isFinite(c1[1]);
  const cx = ok ? c1[0] : c0[0];
  const cy = ok ? c1[1] : c0[1];
  const target: Vec3 = [cx + (ref.target[0] - c0[0]) * s, cy + (ref.target[1] - c0[1]) * s, ref.target[2]];
  const position: Vec3 = [
    target[0] + (ref.position[0] - ref.target[0]) * s,
    target[1] + (ref.position[1] - ref.target[1]) * s,
    target[2] + (ref.position[2] - ref.target[2]) * s,
  ];
  return { position, target };
}

/**
 * Viewport aspect (width / height) the doc's views frame well: the 3D pane alone on a 1400 × 900 desktop. A narrower
 * viewport (the 3D half of "Begge", a portrait tablet) would cut the building at the sides.
 */
export const REF_ASPECT = 0.9;

/** How much further back an exterior preset's camera goes in a viewport of `aspect` (1 … 2.5; eye-level presets: 1). */
export function aspectFactor(preset: CameraPreset, aspect: number): number {
  if (INTERIOR_PRESETS.has(preset) || !(aspect > 0) || !Number.isFinite(aspect)) return 1;
  return Math.min(2.5, Math.max(1, REF_ASPECT / aspect));
}

/** Preset as world-frame vectors (three.js), pulled back for viewports narrower than REF_ASPECT. */
export function presetWorld(preset: CameraPreset, bounds: { min: Vec2; max: Vec2 }, aspect = REF_ASPECT): { position: Vector3; target: Vector3 } {
  const v = presetView(preset, bounds);
  const target = toWorld(...v.target);
  const position = toWorld(...v.position);
  const k = aspectFactor(preset, aspect);
  if (k !== 1) position.sub(target).multiplyScalar(k).add(target);
  return { position, target };
}

/** The old model's ease: quadratic in/out. */
export function easeInOutQuad(k: number): number {
  const x = Math.min(1, Math.max(0, k));
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}
