/**
 * Scene contents of the 3D view (inside the R3F <Canvas> of View3D).
 *
 * Groups (architecture.md "3D view"): `exterior` (exterior walls, their openings, roofs, foundations),
 * `interior` (floors, interior walls and their openings, structure), `base` (terrain, water, decks, railings,
 * steps, hot tubs, trees). The building (exterior + interior) is the label occluder; everything is pickable.
 * Mode-dependent content is mounted/unmounted rather than hidden, because ray casts do not skip invisible objects.
 *
 * Also here: background colour and fog of the old model, OrbitControls (damped, maxPolarAngle 0.495π,
 * minDistance 3), the camera rig (presets animated ~900 ms with the old ease, instant on mount and with reduced
 * motion; exterior presets pulled back in viewports narrower than cameras.ts REF_ASPECT and re-framed when the
 * viewport changes shape while the user has not moved the camera; transitions are cancelled when the user grabs
 * the controls), click selection (ray cast on pointer-up when the pointer
 * moved ≤ 5 px and only one pointer was down, so orbiting never selects; empty space → null), the selection
 * overlay, `invalidate()` on every prop change (frameloop 'demand') and `onReady` after the first rendered frame.
 */
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { Group, Mesh, Raycaster, Vector2, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { DerivedVariant } from '../model/derived';
import type { Id, Site, TerrainAsset, Vec2, Vec3 } from '../model/types';
import type { Selection } from '../state/selection';
import { CAMERA_ANIM_MS, easeInOutQuad, ORBIT_LIMITS, presetWorld, REF_ASPECT } from './cameras';
import type { CameraPreset } from './cameras';
import { Floors } from './Floors';
import { Foundations } from './Foundations';
import { Labels } from './Labels';
import { getMaterials, PALETTE } from './materials';
import { Openings } from './Openings';
import { Outdoor } from './Outdoor';
import { Roofs } from './Roofs';
import { isShown, matchesSelection, selectionOf } from './sceneUtils';
import { StructureMeshes } from './StructureMeshes';
import { SunLight } from './SunLight';
import { Terrain } from './Terrain';
import { Trees } from './Trees';
import { computeVisibility } from './visibility';
import { Walls } from './Walls';

export interface SceneProps {
  derived: DerivedVariant;
  site: Site;
  terrain: TerrainAsset | null;
  mode: 'ute' | 'inne';
  activeStoreyId: Id;
  cutHeight: number;
  showLabels: boolean;
  highlightNew: boolean;
  showTrees: boolean;
  showTerrain: boolean;
  sun: { dir: Vec3; isUp: boolean };
  preset: CameraPreset;
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  onReady?: () => void;
  /** Coarse pointer (phone/tablet): smaller shadow map, harder shadows. */
  coarse: boolean;
  /** An element over the canvas the labels keep clear of (View3D's navigation hint). */
  labelReserve?: RefObject<HTMLElement | null>;
}

const BACKGROUND = `#${PALETTE.background.toString(16).padStart(6, '0')}`;
/** Pointer travel (CSS px) above which a press is a drag (orbit), not a click. */
export const CLICK_TOLERANCE_PX = 5;

export function Scene(props: SceneProps) {
  const { derived, site, terrain, mode, activeStoreyId, cutHeight, highlightNew } = props;
  const invalidate = useThree((s) => s.invalidate);
  const pickRoot = useRef<Group>(null);
  const building = useRef<Group>(null);
  /** Set once the camera rig has put the camera on its first preset (onReady waits for it). */
  const placed = useRef(false);
  const markPlaced = useCallback(() => {
    placed.current = true;
  }, []);
  const isPlaced = useCallback(() => placed.current, []);

  const vis = useMemo(() => computeVisibility(derived, mode, activeStoreyId, cutHeight), [derived, mode, activeStoreyId, cutHeight]);
  const centre: Vec2 = useMemo(
    () => [(derived.bounds.min[0] + derived.bounds.max[0]) / 2, (derived.bounds.min[1] + derived.bounds.max[1]) / 2],
    [derived.bounds],
  );

  // frameloop 'demand': draw again after every prop change
  useEffect(() => {
    invalidate();
  });

  return (
    <>
      <color attach="background" args={[BACKGROUND]} />
      <fog attach="fog" args={[BACKGROUND, 110, 420]} />
      <SunLight sun={props.sun} bounds={derived.bounds} coarse={props.coarse} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        maxPolarAngle={ORBIT_LIMITS.maxPolarAngle}
        minDistance={ORBIT_LIMITS.minDistance}
        maxDistance={ORBIT_LIMITS.maxDistance}
      />
      <CameraRig preset={props.preset} bounds={derived.bounds} onPlaced={markPlaced} />

      <group ref={pickRoot} name="pickable">
        <group ref={building} name="building">
          <group name="exterior">
            <Walls walls={derived.walls} vis={vis} highlightNew={highlightNew} exterior />
            <Openings walls={derived.walls} vis={vis} highlightNew={highlightNew} exterior />
            {vis.showRoofs && <Roofs roofs={derived.roofs} highlightNew={highlightNew} />}
            <Foundations foundations={derived.foundations} walls={derived.walls} blocks={derived.blocks} highlightNew={highlightNew} />
          </group>
          <group name="interior">
            <Floors floors={derived.floors} rooms={derived.rooms} foundations={derived.foundations} vis={vis} highlightNew={highlightNew} />
            <Walls walls={derived.walls} vis={vis} highlightNew={highlightNew} exterior={false} />
            <Openings walls={derived.walls} vis={vis} highlightNew={highlightNew} exterior={false} />
            <StructureMeshes structure={derived.structure} cutZ={vis.structureCutZ} highlightNew={highlightNew} />
          </group>
        </group>
        <group name="base">
          {props.showTerrain && <Terrain terrain={terrain} site={site} derived={derived} />}
          <Outdoor outdoor={derived.outdoor} centre={centre} highlightNew={highlightNew} />
          {props.showTrees && <Trees trees={derived.site.trees} />}
        </group>
      </group>

      {props.showLabels && (
        <Labels
          derived={derived}
          mode={mode}
          activeStoreyId={activeStoreyId}
          cutHeight={cutHeight}
          highlightNew={highlightNew}
          occluder={building}
          reserve={props.labelReserve}
        />
      )}
      <SelectionOverlay
        selection={props.selection}
        root={pickRoot}
        version={[derived, mode, activeStoreyId, cutHeight, props.showTrees, props.showTerrain]}
      />
      <Picking root={pickRoot} onSelect={props.onSelect} />
      <ReadySignal onReady={props.onReady} isPlaced={isPlaced} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Camera presets
// ---------------------------------------------------------------------------

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** The part of drei's OrbitControls (three-stdlib) the rig uses. */
interface ControlsLike {
  target: Vector3;
  update(): unknown;
  addEventListener(type: 'start', listener: () => void): void;
  removeEventListener(type: 'start', listener: () => void): void;
}

interface Tween {
  p0: Vector3;
  t0: Vector3;
  p1: Vector3;
  t1: Vector3;
  start: number;
}

function CameraRig({ preset, bounds, onPlaced }: { preset: CameraPreset; bounds: { min: Vec2; max: Vec2 }; onPlaced: () => void }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const invalidate = useThree((s) => s.invalidate);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const aspect = width > 0 && height > 0 ? width / height : REF_ASPECT;
  const tween = useRef<Tween | null>(null);
  const first = useRef(true);
  /** True once the user moved the camera after the last preset placement. */
  const userMoved = useRef(false);
  const boundsRef = useRef(bounds);
  const aspectRef = useRef(aspect);
  const presetRef = useRef(preset);
  useLayoutEffect(() => {
    boundsRef.current = bounds;
    aspectRef.current = aspect;
    presetRef.current = preset;
  }, [bounds, aspect, preset]);

  // Jump on the first frame with controls, animate on later preset changes. Bounds changes (edits) never move
  // the camera.
  useEffect(() => {
    if (!controls) return;
    const v = presetWorld(preset, boundsRef.current, aspectRef.current);
    userMoved.current = false;
    if (first.current || prefersReducedMotion()) {
      first.current = false;
      tween.current = null;
      camera.position.copy(v.position);
      controls.target.copy(v.target);
      controls.update();
      onPlaced();
    } else {
      tween.current = { p0: camera.position.clone(), t0: controls.target.clone(), p1: v.position, t1: v.target, start: performance.now() };
    }
    invalidate();
  }, [preset, controls, camera, invalidate, onPlaced]);

  // A viewport of another shape (Begge ↔ 3D, a rotated phone) re-frames the preset, unless the user has moved the
  // camera since it was placed.
  useEffect(() => {
    if (!controls || first.current || userMoved.current || tween.current) return;
    const v = presetWorld(presetRef.current, boundsRef.current, aspect);
    camera.position.copy(v.position);
    controls.target.copy(v.target);
    controls.update();
    invalidate();
  }, [aspect, controls, camera, invalidate]);

  // The user grabbing the controls cancels a running transition.
  useEffect(() => {
    if (!controls) return;
    const cancel = () => {
      tween.current = null;
      userMoved.current = true;
    };
    controls.addEventListener('start', cancel);
    return () => controls.removeEventListener('start', cancel);
  }, [controls]);

  useFrame(() => {
    const t = tween.current;
    if (!t || !controls) return;
    const k = Math.min(1, (performance.now() - t.start) / CAMERA_ANIM_MS);
    const e = easeInOutQuad(k);
    camera.position.lerpVectors(t.p0, t.p1, e);
    controls.target.lerpVectors(t.t0, t.t1, e);
    controls.update();
    if (k >= 1) tween.current = null;
    invalidate();
  });
  return null;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function Picking({ root, onSelect }: { root: RefObject<Group | null>; onSelect: (sel: Selection | null) => void }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const onSelectRef = useRef(onSelect);
  useLayoutEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const active = new Set<number>();
    let press: { id: number; x: number; y: number } | null = null;

    const down = (e: PointerEvent) => {
      active.add(e.pointerId);
      press = active.size === 1 && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
    };
    const move = (e: PointerEvent) => {
      if (press && press.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_TOLERANCE_PX) press = null;
    };
    const up = (e: PointerEvent) => {
      active.delete(e.pointerId);
      const p = press;
      press = null;
      if (!p || p.id !== e.pointerId || Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_TOLERANCE_PX) return;
      const r = root.current;
      if (!r) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      // matrices are normally refreshed by the renderer; make sure they match what is on screen now
      camera.updateMatrixWorld();
      r.updateWorldMatrix(true, true);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(r, true).find((h) => isShown(h.object));
      onSelectRef.current(hit ? selectionOf(hit.object) : null);
    };
    const cancel = (e: PointerEvent) => {
      active.delete(e.pointerId);
      press = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, [gl, camera, root]);
  return null;
}

const noRaycast = () => {};

/** Translucent overlay sharing the geometry of every visible mesh tagged with the selected element. */
function SelectionOverlay({ selection, root, version }: { selection: Selection | null; root: RefObject<Group | null>; version: unknown[] }) {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const g = group.current;
    const r = root.current;
    if (!g || !r) return;
    g.clear();
    if (selection) {
      const material = getMaterials().selection;
      r.updateWorldMatrix(true, true);
      r.traverse((o: Object3D) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !isShown(mesh)) return;
        const sel = selectionOf(mesh);
        if (!sel || !matchesSelection(sel, selection)) return;
        const overlay = new Mesh(mesh.geometry, material);
        overlay.matrixAutoUpdate = false;
        overlay.matrix.copy(mesh.matrixWorld);
        overlay.renderOrder = 10;
        overlay.raycast = noRaycast;
        g.add(overlay);
      });
    }
    invalidate();
    return () => {
      g.clear();
    };
    // `version` lists everything that rebuilds meshes
  }, [selection, root, invalidate, ...version]); // eslint-disable-line react-hooks/exhaustive-deps
  return <group ref={group} name="selection" />;
}

// ---------------------------------------------------------------------------
// Ready signal
// ---------------------------------------------------------------------------

function ReadySignal({ onReady, isPlaced }: { onReady?: () => void; isPlaced: () => boolean }) {
  const done = useRef(false);
  const cb = useRef(onReady);
  useLayoutEffect(() => {
    cb.current = onReady;
  }, [onReady]);
  useFrame(() => {
    if (done.current || !isPlaced()) return;
    done.current = true;
    // useFrame runs just before this frame's render; report on the next animation frame, i.e. after it.
    const report = () => cb.current?.();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(report);
    else setTimeout(report, 0);
  });
  return null;
}
