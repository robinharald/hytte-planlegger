/**
 * Scene contents of the 3D view (inside the R3F <Canvas> of View3D).
 *
 * Groups (architecture.md "3D view"; keyed on the derived sub-objects, sceneParts.ts): `building` (`exterior`:
 * exterior walls, their openings, roofs, foundations; `interior`: floors and flat ceilings, interior walls and their
 * openings, structure), `outdoor` (decks, railings, deck steps, hot tubs), `furniture` (parametric models per catalogue
 * entry, Furniture.tsx / furnitureBuilders.ts) and `site` (terrain, water, trees). Each group is a memoised component
 * fed one object of derived sub-objects
 * that `sceneParts` reuses while its members are unchanged, so a furniture or deck edit does not re-render (or
 * rebuild) the walls and roofs. The building is the label occluder; everything is pickable. Ghosts (status
 * 'removed') are never built. Mode-dependent content is mounted/unmounted rather than hidden, because ray casts do not
 * skip invisible objects.
 *
 * Also here: background colour and fog of the old model, OrbitControls (damped, maxPolarAngle 0.495π,
 * minDistance 3), the camera rig (presets animated ~900 ms with the old ease, instant on mount and with reduced
 * motion; exterior presets pulled back in viewports narrower than cameras.ts REF_ASPECT and re-framed when the
 * viewport changes shape while the user has not moved the camera; transitions are cancelled when the user grabs
 * the controls), click selection (selection3d.ts: a ray cast on pointer-up when only one pointer was down and it
 * moved ≤ 5 px, 10 px for touch, so orbiting never selects; the nearest shown object's pick tags decide, empty
 * space → null; no dragging in 3D in this phase), the selection highlight (a translucent overlay plus an outline of
 * the crease edges of every shown mesh the selection matches, selection3d.highlightMatches), the furniture drop target
 * (dropEvent.ts / drop.ts → `onDropFurniture`), `invalidate()` on every prop change (frameloop 'demand') and
 * `onReady` after the first rendered frame.
 *
 * Walk mode (`walk` = a session id, WalkControls.tsx): every storey with full walls and roofs (the exterior mode's
 * visibility whatever `mode` and the cut say), the orbit controls and click selection off; the camera rig keeps the
 * orbit camera's place and, when the walk ends, eases back to it (or to the preset when one was chosen meanwhile,
 * walkState `returnToPreset`). A 3D click records its plan point (walkState `recordPick`) so a walk entered with
 * that selection starts there. `shadows` (default on) lets the sun cast shadows.
 *
 * Every tap on a camera preset goes to it, also the one already chosen (walkState `presetRequest`, fix round 3 after
 * phase 3: after Esc kept a walk's view the pressed preset did nothing). Playwright reads the camera through
 * `window.__hytteCamera()` (position, orbit target, field of view; nothing in the app uses it).
 */
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { EdgesGeometry, Group, LineSegments, Mesh, Raycaster, Vector2, Vector3 } from 'three';
import type { BufferGeometry, Object3D } from 'three';
import type { DerivedVariant } from '../model/derived';
import type { Id, Site, TerrainAsset, Vec2, Vec3 } from '../model/types';
import type { Selection } from '../state/selection';
import { CAMERA_ANIM_MS, easeInOutQuad, ORBIT_LIMITS, presetWorld, REF_ASPECT } from './cameras';
import type { CameraPreset } from './cameras';
import { dropHit, dropSurfaces, ndcOf, planRayFromNdc } from './drop';
import type { DropHit } from './drop';
import { FURNITURE_DROP_EVENT, furnitureDropDetail } from './dropEvent';
import { Floors } from './Floors';
import { Foundations } from './Foundations';
import { Furniture } from './Furniture';
import { shownGroundFn } from './ground';
import { Labels } from './Labels';
import { getMaterials, PALETTE } from './materials';
import { Openings } from './Openings';
import { Outdoor } from './Outdoor';
import { Roofs } from './Roofs';
import { sceneParts } from './sceneParts';
import type { BuildingParts, OutdoorParts, SceneParts, SiteParts } from './sceneParts';
import { isShown, pickTagsOf, selectionOf } from './sceneUtils';
import { highlightMatches, isClick } from './selection3d';
import type { FloorPickContext } from './selection3d';
import { StructureMeshes } from './StructureMeshes';
import { fromWorld } from './coords';
import { WalkControls } from './WalkControls';
import { recordPick, useView3dLocal, view3dLocal } from './walkState';
import { SunLight } from './SunLight';
import { Terrain } from './Terrain';
import { Trees } from './Trees';
import { computeVisibility } from './visibility';
import type { Visibility } from './visibility';
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
  /** A furniture library item dropped on the view (View3DProps.onDropFurniture). */
  onDropFurniture?: (catalogId: string, planPoint: Vec2, hit: DropHit) => void;
  /** Element that receives the furniture drop events (View3D's root); default: the canvas. */
  dropRoot?: RefObject<HTMLElement | null>;
  /** Coarse pointer (phone/tablet): smaller shadow map, harder shadows. */
  coarse: boolean;
  /** An element over the canvas the labels keep clear of (View3D's navigation hint). */
  labelReserve?: RefObject<HTMLElement | null>;
  /** Walk session id while walking (walkState.ts), else null / undefined. */
  walk?: number | null;
  /** The sun casts shadows (default true). */
  shadows?: boolean;
}

const BACKGROUND = `#${PALETTE.background.toString(16).padStart(6, '0')}`;

/**
 * The scene's group objects for `derived`, reusing the previous render's objects whose members are unchanged
 * (state derived from the previous render: React re-renders at once with the stored value, no effect involved).
 */
function useSceneParts(derived: DerivedVariant): SceneParts {
  const [state, setState] = useState(() => ({ derived, parts: sceneParts(derived) }));
  if (state.derived === derived) return state.parts;
  const next = { derived, parts: sceneParts(derived, state.parts) };
  setState(next);
  return next.parts;
}

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

  const parts = useSceneParts(derived);
  const walking = props.walk != null;
  // walking shows every storey with full walls and roofs
  const shownMode = walking ? 'ute' : mode;
  const vis = useMemo(() => computeVisibility(parts.levels, shownMode, activeStoreyId, cutHeight), [parts.levels, shownMode, activeStoreyId, cutHeight]);
  const ground = useMemo(
    () => shownGroundFn(terrain, site, parts.site.groundWorks, parts.site.blocks, props.showTerrain),
    [terrain, site, parts.site, props.showTerrain],
  );

  // frameloop 'demand': draw again after every prop change
  useEffect(() => {
    invalidate();
  });

  return (
    <>
      <color attach="background" args={[BACKGROUND]} />
      <fog attach="fog" args={[BACKGROUND, 110, 420]} />
      <SunLight sun={props.sun} bounds={derived.bounds} coarse={props.coarse} shadows={props.shadows ?? true} />
      <OrbitControls
        makeDefault
        enabled={!walking}
        enableDamping
        dampingFactor={0.1}
        maxPolarAngle={ORBIT_LIMITS.maxPolarAngle}
        minDistance={ORBIT_LIMITS.minDistance}
        maxDistance={ORBIT_LIMITS.maxDistance}
      />
      <CameraRig preset={props.preset} bounds={derived.bounds} onPlaced={markPlaced} walking={walking} />
      <WalkControls session={props.walk ?? null} derived={derived} site={site} terrain={terrain} selection={props.selection} coarse={props.coarse} />

      <group ref={pickRoot} name="pickable">
        <group ref={building} name="building">
          <BuildingGroup parts={parts.building} vis={vis} highlightNew={highlightNew} />
        </group>
        <OutdoorGroup parts={parts.outdoor} highlightNew={highlightNew} />
        <Furniture furniture={parts.furniture.furniture} vis={vis} highlightNew={highlightNew} />
        <SiteGroup parts={parts.site} site={site} terrain={terrain} showTerrain={props.showTerrain} showTrees={props.showTrees} />
      </group>

      {props.showLabels && (
        <Labels
          derived={derived}
          mode={shownMode}
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
        version={[parts.building, parts.outdoor, parts.furniture, parts.site, vis, props.showTrees, props.showTerrain]}
      />
      <Picking root={pickRoot} onSelect={props.onSelect} disabled={walking} />
      <DropTarget
        root={props.dropRoot}
        onDrop={props.onDropFurniture}
        floors={parts.building.floors}
        decks={parts.outdoor.outdoor.decks}
        vis={vis}
        ground={ground}
      />
      <ReadySignal onReady={props.onReady} isPlaced={isPlaced} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Groups (memoised on their sceneParts objects)
// ---------------------------------------------------------------------------

const BuildingGroup = memo(function BuildingGroup({ parts, vis, highlightNew }: { parts: BuildingParts; vis: Visibility; highlightNew: boolean }) {
  const { walls, roofs, floors, rooms, foundations, blocks, structure } = parts;
  const pickContext: FloorPickContext = useMemo(
    () => ({ openingIds: new Set(walls.flatMap((w) => w.openings.map((o) => o.id))), blockIds: new Set(blocks.map((b) => b.block.id)) }),
    [walls, blocks],
  );
  return (
    <>
      <group name="exterior">
        <Walls walls={walls} vis={vis} highlightNew={highlightNew} exterior />
        <Openings walls={walls} vis={vis} highlightNew={highlightNew} exterior />
        {vis.showRoofs && <Roofs roofs={roofs} highlightNew={highlightNew} />}
        <Foundations foundations={foundations} walls={walls} blocks={blocks} highlightNew={highlightNew} />
      </group>
      <group name="interior">
        <Floors floors={floors} rooms={rooms} foundations={foundations} vis={vis} highlightNew={highlightNew} pickContext={pickContext} />
        <Walls walls={walls} vis={vis} highlightNew={highlightNew} exterior={false} />
        <Openings walls={walls} vis={vis} highlightNew={highlightNew} exterior={false} />
        <StructureMeshes structure={structure} cutZ={vis.structureCutZ} highlightNew={highlightNew} />
      </group>
    </>
  );
});

const OutdoorGroup = memo(function OutdoorGroup({ parts, highlightNew }: { parts: OutdoorParts; highlightNew: boolean }) {
  const { bounds } = parts;
  const centre: Vec2 = useMemo(() => [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2], [bounds]);
  return <Outdoor outdoor={parts.outdoor} centre={centre} highlightNew={highlightNew} />;
});

interface SiteGroupProps {
  parts: SiteParts;
  site: Site;
  terrain: TerrainAsset | null;
  showTerrain: boolean;
  showTrees: boolean;
}

const SiteGroup = memo(function SiteGroup({ parts, site, terrain, showTerrain, showTrees }: SiteGroupProps) {
  return (
    <group name="site">
      {showTerrain && <Terrain terrain={terrain} site={site} derived={parts} />}
      {showTrees && <Trees trees={parts.site.trees} />}
    </group>
  );
});

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

function CameraRig({ preset, bounds, onPlaced, walking }: { preset: CameraPreset; bounds: { min: Vec2; max: Vec2 }; onPlaced: () => void; walking: boolean }) {
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
  const walkingRef = useRef(walking);
  /** The orbit camera's place when a walk began (the preset at that time too). */
  const beforeWalk = useRef<{ position: Vector3; target: Vector3; preset: CameraPreset } | null>(null);
  /** Bumped by every tap on a preset (walkState `requestPreset`): the preset effect runs again for the same preset. */
  const presetRequest = useView3dLocal((s) => s.presetRequest);
  useLayoutEffect(() => {
    boundsRef.current = bounds;
    aspectRef.current = aspect;
    presetRef.current = preset;
    walkingRef.current = walking;
  }, [bounds, aspect, preset, walking]);

  // Jump on the first frame with controls, animate on later preset changes and on every tap on a preset
  // (`presetRequest`). Bounds changes (edits) never move the camera. While walking the preset waits for the walk to end.
  useEffect(() => {
    if (!controls) return;
    if (walkingRef.current) {
      // the walk owns the camera (mounted while walking: count as placed)
      if (first.current) {
        first.current = false;
        onPlaced();
      }
      return;
    }
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
  }, [preset, presetRequest, controls, camera, invalidate, onPlaced]);

  // Playwright: the camera as `window.__hytteCamera()` (e2e/walk-preset.spec.ts).
  useEffect(() => {
    if (!controls) return;
    const g = globalThis as { __hytteCamera?: () => { position: number[]; target: number[]; fov: number } };
    const probe = () => ({ position: camera.position.toArray(), target: controls.target.toArray(), fov: (camera as { fov?: number }).fov ?? 0 });
    g.__hytteCamera = probe;
    return () => {
      if (g.__hytteCamera === probe) delete g.__hytteCamera;
    };
  }, [controls, camera]);

  // A walk keeps the orbit camera's place (before WalkControls moves the camera: this rig comes first in the
  // scene) and eases back to it afterwards, or to the preset when one was chosen meanwhile (walkState
  // `returnToPreset`, or the preset prop changed).
  useLayoutEffect(() => {
    if (!controls) return;
    if (walking) {
      tween.current = null;
      // mounted while walking: the camera never reached its preset, come back to that
      const v = first.current ? presetWorld(presetRef.current, boundsRef.current, aspectRef.current) : { position: camera.position, target: controls.target };
      beforeWalk.current = { position: v.position.clone(), target: v.target.clone(), preset: presetRef.current };
      return;
    }
    const saved = beforeWalk.current;
    beforeWalk.current = null;
    if (!saved) return;
    const toPreset = view3dLocal.getState().returnToPreset || saved.preset !== presetRef.current;
    const v = toPreset ? presetWorld(presetRef.current, boundsRef.current, aspectRef.current) : saved;
    if (toPreset) userMoved.current = false;
    // start the orbit target straight ahead of the walker, as far as the target will be from the camera
    const ahead = new Vector3();
    camera.getWorldDirection(ahead);
    const t0 = camera.position.clone().addScaledVector(ahead, Math.max(1, v.position.distanceTo(v.target)));
    if (prefersReducedMotion()) {
      tween.current = null;
      camera.position.copy(v.position);
      controls.target.copy(v.target);
      controls.update();
    } else {
      controls.target.copy(t0);
      tween.current = { p0: camera.position.clone(), t0, p1: v.position.clone(), t1: v.target.clone(), start: performance.now() };
    }
    invalidate();
  }, [walking, controls, camera, invalidate]);

  // A viewport of another shape (Begge ↔ 3D, a rotated phone) re-frames the preset, unless the user has moved the
  // camera since it was placed.
  useEffect(() => {
    if (!controls || first.current || userMoved.current || tween.current || walkingRef.current) return;
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
    if (!t || !controls || walkingRef.current) return;
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

function Picking({ root, onSelect, disabled }: { root: RefObject<Group | null>; onSelect: (sel: Selection | null) => void; disabled: boolean }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const onSelectRef = useRef(onSelect);
  const disabledRef = useRef(disabled);
  useLayoutEffect(() => {
    onSelectRef.current = onSelect;
    disabledRef.current = disabled;
  }, [onSelect, disabled]);

  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const active = new Set<number>();
    let press: { id: number; x: number; y: number; type: string } | null = null;

    const down = (e: PointerEvent) => {
      active.add(e.pointerId);
      press = active.size === 1 && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType } : null;
    };
    const move = (e: PointerEvent) => {
      if (press && press.id === e.pointerId && !isClick(press, { x: e.clientX, y: e.clientY }, press.type)) press = null;
    };
    const up = (e: PointerEvent) => {
      active.delete(e.pointerId);
      const p = press;
      press = null;
      if (!p || p.id !== e.pointerId || !isClick(p, { x: e.clientX, y: e.clientY }, p.type) || disabledRef.current) return;
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
      const sel = hit ? selectionOf(hit.object) : null;
      if (hit) {
        const at = fromWorld(hit.point);
        recordPick(sel, [at[0], at[1]], at[2]);
      }
      onSelectRef.current(sel);
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

/** Crease angle (degrees) above which an edge of a selected mesh is outlined. */
const OUTLINE_CREASE_DEG = 25;

/**
 * Highlight of the selection: for every shown mesh whose pick tags match it (selection3d.highlightMatches), a
 * translucent overlay sharing its geometry and an outline of its crease edges drawn through everything.
 */
function SelectionOverlay({ selection, root, version }: { selection: Selection | null; root: RefObject<Group | null>; version: unknown[] }) {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const g = group.current;
    const r = root.current;
    if (!g || !r) return;
    g.clear();
    const owned: BufferGeometry[] = [];
    if (selection) {
      const m = getMaterials();
      r.updateWorldMatrix(true, true);
      r.traverse((o: Object3D) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !isShown(mesh)) return;
        if (!highlightMatches(pickTagsOf(mesh), selection)) return;
        const fill = new Mesh(mesh.geometry, m.selection);
        const edges = new EdgesGeometry(mesh.geometry, OUTLINE_CREASE_DEG);
        owned.push(edges);
        const line = new LineSegments(edges, m.selectionLine);
        const layers: [Object3D, number][] = [
          [fill, 10],
          [line, 11],
        ];
        for (const [obj, order] of layers) {
          obj.matrixAutoUpdate = false;
          obj.matrix.copy(mesh.matrixWorld);
          obj.renderOrder = order;
          obj.raycast = noRaycast;
          g.add(obj);
        }
      });
    }
    invalidate();
    return () => {
      g.clear();
      for (const e of owned) e.dispose();
    };
    // `version` lists everything that rebuilds meshes
  }, [selection, root, invalidate, ...version]); // eslint-disable-line react-hooks/exhaustive-deps
  return <group ref={group} name="selection" />;
}

// ---------------------------------------------------------------------------
// Furniture drop target
// ---------------------------------------------------------------------------

interface DropTargetProps {
  root?: RefObject<HTMLElement | null>;
  onDrop?: (catalogId: string, planPoint: Vec2, hit: DropHit) => void;
  floors: DerivedVariant['floors'];
  decks: DerivedVariant['outdoor']['decks'];
  vis: Visibility;
  ground: ((x: number, y: number) => number) | null;
}

/**
 * Accepts FURNITURE_DROP_EVENT (dropEvent.ts) on `root` (else the canvas): the camera ray through the drop point is
 * intersected with the visible floors, the decks and the shown ground (drop.ts); on a hit the event is accepted
 * (preventDefault) and `onDrop(catalogId, planPoint, hit)` called. Without `onDrop` nothing is accepted.
 */
function DropTarget({ root, onDrop, floors, decks, vis, ground }: DropTargetProps) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const latest = useRef({ onDrop, floors, decks, vis, ground });
  useLayoutEffect(() => {
    latest.current = { onDrop, floors, decks, vis, ground };
  }, [onDrop, floors, decks, vis, ground]);

  useEffect(() => {
    const el = root?.current ?? gl.domElement;
    const handle = (e: Event) => {
      const cur = latest.current;
      const detail = furnitureDropDetail(e);
      if (!cur.onDrop || !detail) return;
      const ndc = ndcOf(detail.clientX, detail.clientY, gl.domElement.getBoundingClientRect());
      if (!ndc) return;
      camera.updateMatrixWorld();
      const ray = planRayFromNdc(camera, ndc.x, ndc.y);
      const hit = dropHit(ray, dropSurfaces(cur.floors, cur.decks, cur.vis), cur.ground);
      if (!hit) return;
      e.preventDefault();
      cur.onDrop(detail.catalogId, hit.point, hit);
    };
    el.addEventListener(FURNITURE_DROP_EVENT, handle);
    return () => el.removeEventListener(FURNITURE_DROP_EVENT, handle);
  }, [gl, camera, root]);
  return null;
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
