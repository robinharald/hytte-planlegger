/**
 * The 3D view's own little state, shared by the left column (ui/Controls.tsx: «Gå rundt», the shadows switch) and
 * the lazy-loaded 3D view (View3D, Scene, WalkControls). No three.js here, so the main bundle may import it.
 *
 *  - `walk`: the walk session id while walking (`startWalk`), else null. `stopWalk({ toPreset })` ends it: the
 *    orbit camera then goes back to where it was, or (`toPreset`, a preset button was pressed) to the chosen preset.
 *  - `locked`: the mouse pointer is locked to the 3D view (desktop walking; the hint line text depends on it).
 *  - `shadows`: the sun casts shadows in 3D (on by default; remembered per device in localStorage, guarded).
 *  - `walkInput` (not reactive): the on-screen joystick's vector and the 3D view's `invalidate`, so the joystick
 *    (a DOM element over the canvas) can drive the render loop (frameloop 'demand').
 *  - `recordPick` / `pickFor`: the plan point of the last 3D click and the selection it made, so «Gå rundt» with
 *    that selection starts where the user clicked.
 *
 * `walk` and `shadows` live here rather than in the app store's UiState (the shadows choice per device, guarded
 * localStorage). `walkProbe` is the walker's pose for the e2e tests (`window.__hytte.walk`, ui/hooks.ts).
 */
import { useSyncExternalStore } from 'react';
import type { Vec2 } from '../model/types';

export interface View3dLocalState {
  walk: number | null;
  /** How the last walk ended: true = to the chosen camera preset, false = back to where the camera was. */
  returnToPreset: boolean;
  locked: boolean;
  shadows: boolean;
}

const SHADOWS_KEY = 'hytte.view3d.shadows';

function readShadows(): boolean {
  try {
    return globalThis.localStorage?.getItem(SHADOWS_KEY) !== '0';
  } catch {
    return true;
  }
}

let state: View3dLocalState = { walk: null, returnToPreset: false, locked: false, shadows: readShadows() };
let sessions = 0;
const listeners = new Set<() => void>();

function set(patch: Partial<View3dLocalState>): void {
  const next = { ...state, ...patch };
  if ((Object.keys(patch) as (keyof View3dLocalState)[]).every((k) => next[k] === state[k])) return;
  state = next;
  for (const l of [...listeners]) l();
}

export const view3dLocal = {
  getState: (): View3dLocalState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useView3dLocal<T>(select: (s: View3dLocalState) => T): T {
  return useSyncExternalStore(
    view3dLocal.subscribe,
    () => select(state),
    () => select(state),
  );
}

export function startWalk(): void {
  sessions += 1;
  set({ walk: sessions, returnToPreset: false, locked: false });
}

export function stopWalk(opts: { toPreset?: boolean } = {}): void {
  clearWalkInput();
  if (state.walk === null) return;
  set({ walk: null, returnToPreset: !!opts.toPreset, locked: false });
}

export function toggleWalk(): void {
  if (state.walk === null) startWalk();
  else stopWalk();
}

export function setPointerLocked(locked: boolean): void {
  set({ locked });
}

export function setShadows(on: boolean): void {
  set({ shadows: on });
  try {
    globalThis.localStorage?.setItem(SHADOWS_KEY, on ? '1' : '0');
  } catch {
    // private mode / blocked storage: the switch still works for this visit
  }
}

// ---------------------------------------------------------------------------
// Joystick input (not reactive)
// ---------------------------------------------------------------------------

export const walkInput: { joy: { strafe: number; forward: number }; wake: (() => void) | null } = {
  joy: { strafe: 0, forward: 0 },
  wake: null,
};

export function setJoystick(strafe: number, forward: number): void {
  walkInput.joy = { strafe, forward };
  walkInput.wake?.();
}

export function clearWalkInput(): void {
  walkInput.joy = { strafe: 0, forward: 0 };
}

// ---------------------------------------------------------------------------
// Test probe: the walker's pose (window.__hytte.walk)
// ---------------------------------------------------------------------------

/** The walker as the Playwright tests see it (`window.__hytte.walk`): plan position, feet and eye height (m). */
export interface WalkProbe {
  session: number;
  x: number;
  y: number;
  feetZ: number;
  eyeZ: number;
  heading: number;
}

let probe: WalkProbe | null = null;

/** The walker's last pose while walking, else null. */
export function walkProbe(): WalkProbe | null {
  return probe;
}

/** WalkControls: a pose was applied to the camera (null: the walk ended). Also set on the current `window.__hytte`. */
export function publishWalkProbe(next: WalkProbe | null): void {
  probe = next;
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __hytte?: Record<string, unknown> };
  if (w.__hytte) w.__hytte.walk = next;
}

// ---------------------------------------------------------------------------
// The last 3D click
// ---------------------------------------------------------------------------

export interface PickRecord {
  /** `${kind}:${id}` of the selection the click made. */
  key: string;
  point: Vec2;
  /** Height of the hit point (m above the main floor). */
  z: number;
}

let lastPick: PickRecord | null = null;

export function selectionKey(sel: { kind: string; id: string } | null): string | null {
  return sel ? `${sel.kind}:${sel.id}` : null;
}

export function recordPick(sel: { kind: string; id: string } | null, point: Vec2, z: number): void {
  const key = selectionKey(sel);
  lastPick = key ? { key, point, z } : null;
}

/** The last 3D click, when it made this selection. */
export function pickFor(sel: { kind: string; id: string } | null): PickRecord | null {
  const key = selectionKey(sel);
  return key && lastPick?.key === key ? lastPick : null;
}

/** Test helper: back to the initial state. */
export function resetView3dLocal(): void {
  state = { walk: null, returnToPreset: false, locked: false, shadows: true };
  lastPick = null;
  probe = null;
  clearWalkInput();
  walkInput.wake = null;
  for (const l of [...listeners]) l();
}
