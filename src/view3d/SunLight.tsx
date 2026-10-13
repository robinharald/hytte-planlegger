/**
 * Lights, as in the old model: a hemisphere light (sky 0xdfe6ee, ground 0x56603f, 0.85) and a warm directional
 * sun (0xfff6ea, 0.75) with shadows. Intensities are ×π and colours linear to match the old r128 renderer (see
 * materials.ts). The sun comes from `sun.dir` (unit vector towards the sun, plan frame): position = target +
 * dir · 60 m, target = centre of the built bounds. When the sun is below the horizon its intensity is 0 and it
 * casts no shadow (the hemisphere light keeps the model readable). Shadow map 2048 (1024 on coarse pointers,
 * where the PCF filter radius is also reduced — PCFSoftShadowMap no longer exists in three r186). The shadow
 * camera box covers the bounds plus 15 m (at least ±30 m). `shadows` false (the «Skygger» switch) keeps the light
 * but casts no shadow (cheaper on phones).
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Object3D } from 'three';
import type { DirectionalLight } from 'three';
import type { Vec2, Vec3 } from '../model/types';
import { toWorld } from './coords';
import { legacyColour } from './materials';

export const SUN_DISTANCE = 60;
const SKY = legacyColour(0xdfe6ee);
const GROUND = legacyColour(0x56603f);
const SUN = legacyColour(0xfff6ea);

export interface SunLightProps {
  sun: { dir: Vec3; isUp: boolean };
  bounds: { min: Vec2; max: Vec2 };
  coarse: boolean;
  /** Cast shadows while the sun is up (default true). */
  shadows?: boolean;
}

/** Shadow box half-size for the given bounds. */
function shadowExtent(bounds: { min: Vec2; max: Vec2 }): number {
  const d = Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]);
  return Number.isFinite(d) ? Math.max(30, d / 2 + 15) : 30;
}

export function SunLight({ sun, bounds, coarse, shadows = true }: SunLightProps) {
  const light = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cy = (bounds.min[1] + bounds.max[1]) / 2;
  const centre = toWorld(Number.isFinite(cx) ? cx : 0, Number.isFinite(cy) ? cy : 0, 0);
  const dir = toWorld(sun.dir[0], sun.dir[1], sun.dir[2]).normalize();
  if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(-0.5, 0.8, 0.3).normalize();
  const position = centre.clone().addScaledVector(dir, SUN_DISTANCE);
  const r = shadowExtent(bounds);
  const mapSize = coarse ? 1024 : 2048;

  useLayoutEffect(() => {
    target.position.copy(centre);
    target.updateMatrixWorld();
    const l = light.current;
    if (!l) return;
    const cam = l.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = SUN_DISTANCE + r * 1.8;
    cam.updateProjectionMatrix();
    if (l.shadow.mapSize.x !== mapSize) {
      l.shadow.mapSize.set(mapSize, mapSize);
      l.shadow.map?.dispose();
      l.shadow.map = null;
    }
    l.shadow.needsUpdate = true;
  });

  return (
    <>
      <hemisphereLight color={SKY} groundColor={GROUND} intensity={0.85 * Math.PI} />
      <primitive object={target} />
      <directionalLight
        ref={light}
        target={target}
        color={SUN}
        intensity={sun.isUp ? 0.75 * Math.PI : 0}
        position={position}
        castShadow={sun.isUp && shadows}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
        shadow-radius={coarse ? 1 : 3}
      />
    </>
  );
}
