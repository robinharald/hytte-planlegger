/**
 * Walk mode inside the R3F canvas (walk.ts has the kinematics, walkState.ts the session and the joystick input).
 *
 * While `session` is set:
 *  - the start: where the user clicked in 3D when that click made the current selection, else a selected room's
 *    label point (both facing the way the orbit camera looked), else inside the Stue facing the terrace door
 *    (walk.ts `selectionWalkStart` / `defaultWalkStart`); the field of view widens to `walkFov` (restored after);
 *  - desktop: the pointer is locked to the canvas (mouse looks); if the browser refuses, a drag looks and a click
 *    locks; W A S D / arrows move, Shift runs (keys are taken in the capture phase and default-prevented, so the
 *    plan's arrow-key nudge and the other shortcuts stay quiet); Esc, or losing the pointer lock (the browser's own
 *    Esc), ends the walk; keys while the 3D pane is hidden end it too;
 *  - touch: the joystick (WalkOverlay, via `walkInput`) moves, a drag that starts on the right 60 % of the canvas
 *    looks;
 *  - every frame with input (or an eye still easing) steps the walker and asks for the next frame (frameloop
 *    'demand'); idle, nothing renders.
 * The orbit controls are disabled meanwhile (Scene.tsx) and the camera rig brings the orbit camera back afterwards.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { DerivedVariant } from '../model/derived';
import type { Site, TerrainAsset } from '../model/types';
import type { Selection } from '../state/selection';
import { isEditableTarget } from '../ui/keys';
import { fromWorld, toWorld } from './coords';
import { flatGroundZ, groundZFn } from './ground';
import * as W from './walk';
import type { WalkPose } from './walk';
import { pickFor, publishWalkProbe, setPointerLocked, stopWalk, walkInput } from './walkState';

export interface WalkControlsProps {
  /** Walk session id while walking, else null. */
  session: number | null;
  derived: DerivedVariant;
  site: Site;
  terrain: TerrainAsset | null;
  selection: Selection | null;
  /** Touch device: no pointer lock; the joystick and drag-to-look. */
  coarse: boolean;
}

/** Share of the canvas width (from the left) where a touch does not start a look drag (the joystick's side). */
const TOUCH_LOOK_FROM = 0.4;

/** Puts a camera at a walk pose (and tells the test probe, walkState.ts `publishWalkProbe`). */
function applyWalkPose(
  camera: { position: Vector3; rotation: { set(x: number, y: number, z: number, order: 'YXZ'): unknown }; updateMatrixWorld(): void },
  p: WalkPose,
  session: number,
): void {
  camera.position.copy(toWorld(p.pos[0], p.pos[1], p.eyeZ));
  camera.rotation.set(p.pitch, p.heading - Math.PI / 2, 0, 'YXZ');
  camera.updateMatrixWorld();
  publishWalkProbe({ session, x: p.pos[0], y: p.pos[1], feetZ: p.feetZ, eyeZ: p.eyeZ, heading: p.heading });
}

/** Sets a perspective camera's vertical field of view (degrees). */
function setFov(camera: PerspectiveCamera, fov: number): void {
  if (!camera.isPerspectiveCamera || camera.fov === fov) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

/** The walker's ground: the terrain with the ground works, else the flat ground of the 3D view. */
function walkGround(derived: DerivedVariant, site: Site, terrain: TerrainAsset | null): (x: number, y: number) => number {
  if (terrain && terrain.grids.length > 0) return groundZFn(terrain, site, derived.groundWorks);
  const z = flatGroundZ(derived.blocks);
  return () => z;
}

export function WalkControls({ session, derived, site, terrain, selection, coarse }: WalkControlsProps) {
  // the camera is moved imperatively, so it is read through get() (not a render value)
  const get = useThree((s) => s.get);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const world = useMemo(() => W.buildWalkWorld(derived, walkGround(derived, site, terrain)), [derived, site, terrain]);
  const pose = useRef<WalkPose | null>(null);
  const keys = useRef(new Set<string>());
  /** The previous frame stepped the walker (else the next one starts with a nominal dt). */
  const stepping = useRef(false);
  const latest = useRef({ world, derived, selection, aspect: width / Math.max(1, height) });
  useLayoutEffect(() => {
    latest.current = { world, derived, selection, aspect: width / Math.max(1, height) };
  }, [world, derived, selection, width, height]);

  // Start and end of a session: the start pose, the field of view.
  useLayoutEffect(() => {
    if (session === null) return;
    const camera = get().camera as PerspectiveCamera;
    const pressed = keys.current;
    const { world: w, derived: d, selection: sel, aspect } = latest.current;
    const dir = new Vector3();
    camera.getWorldDirection(dir);
    const heading = Math.atan2(-dir.z, dir.x);
    const at = fromWorld(camera.position);
    const start = W.selectionWalkStart(d, w, sel, pickFor(sel), [at[0], at[1]], heading) ?? W.defaultWalkStart(d, w);
    pose.current = start;
    stepping.current = false;
    const fov = camera.fov;
    setFov(camera, W.walkFov(aspect));
    applyWalkPose(camera, start, session);
    invalidate();
    return () => {
      publishWalkProbe(null);
      pose.current = null;
      pressed.clear();
      setFov(camera, fov);
      invalidate();
    };
  }, [session, get, invalidate]);

  // The viewport changes shape while walking: keep about 80° across.
  useEffect(() => {
    if (session === null || !(width > 0 && height > 0)) return;
    setFov(get().camera as PerspectiveCamera, W.walkFov(width / height));
    invalidate();
  }, [session, get, width, height, invalidate]);

  // Inputs.
  useEffect(() => {
    if (session === null) return;
    const el = gl.domElement;
    const camera = get().camera;
    const pressed = keys.current;
    pressed.clear();
    walkInput.wake = invalidate;
    const look = (dx: number, dy: number, sens: number) => {
      const p = pose.current;
      if (!p || (dx === 0 && dy === 0)) return;
      pose.current = W.applyLook(p, dx, dy, sens);
      applyWalkPose(camera, pose.current, session);
      invalidate();
    };
    const shown = () => {
      try {
        return el.isConnected && getComputedStyle(el).visibility !== 'hidden';
      } catch {
        return true;
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      if (e.key !== 'Escape' && !W.WALK_KEYS.has(e.code)) return;
      if (!shown()) {
        stopWalk();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') stopWalk();
      else {
        pressed.add(e.code);
        invalidate();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (pressed.delete(e.code)) invalidate();
    };
    const onBlur = () => pressed.clear();

    // pointer lock (desktop)
    const canLock = !coarse && typeof el.requestPointerLock === 'function';
    const requestLock = () => {
      if (!canLock || document.pointerLockElement === el) return;
      try {
        const r = el.requestPointerLock() as unknown;
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
      } catch {
        // refused (no user gesture, sandboxed frame): drag to look instead
      }
    };
    let wasLocked = false;
    const onLockChange = () => {
      const locked = document.pointerLockElement === el;
      setPointerLocked(locked);
      if (locked) wasLocked = true;
      else if (wasLocked) stopWalk(); // Esc (the browser takes it) or the window lost focus
    };
    requestLock();

    // drag to look (touch; the mouse while not locked)
    let drag: { id: number; x: number; y: number; sens: number; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      if (document.pointerLockElement === el || drag) return;
      if (e.pointerType === 'mouse') {
        if (e.button !== 0) return;
      } else {
        const r = el.getBoundingClientRect();
        if (e.clientX < r.left + r.width * TOUCH_LOOK_FROM) return;
      }
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sens: e.pointerType === 'mouse' ? W.MOUSE_SENS : W.TOUCH_SENS, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (document.pointerLockElement === el) {
        look(e.movementX || 0, e.movementY || 0, W.MOUSE_SENS);
        return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      look(dx, dy, drag.sens);
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const click = !drag.moved && e.pointerType === 'mouse';
      drag = null;
      if (click) requestLock();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('pointerlockchange', onLockChange);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    if (coarse) {
      try {
        el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      } catch {
        // old browsers: no smooth scrolling options
      }
    }
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onLockChange);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      if (walkInput.wake === invalidate) walkInput.wake = null;
      pressed.clear();
      setPointerLocked(false);
      if (document.pointerLockElement === el) {
        try {
          document.exitPointerLock();
        } catch {
          // nothing to release
        }
      }
    };
  }, [session, gl, get, invalidate, coarse]);

  useFrame((state, delta) => {
    const p = pose.current;
    if (session === null || !p) return;
    const w = latest.current.world;
    const input = W.combineInputs(W.keyInput(keys.current), { forward: walkInput.joy.forward, strafe: walkInput.joy.strafe, run: false });
    if (!W.hasMotion(input) && W.eyeSettled(w, p)) {
      stepping.current = false;
      return;
    }
    const dt = stepping.current ? Math.min(0.05, Math.max(0, delta)) : 1 / 60;
    stepping.current = true;
    pose.current = W.stepWalk(w, p, input, dt);
    applyWalkPose(state.camera, pose.current, session);
    invalidate();
  });
  return null;
}
