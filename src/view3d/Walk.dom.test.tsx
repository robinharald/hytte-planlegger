// @vitest-environment jsdom
/**
 * Walk mode in the real scene graph (Scene.tsx + WalkControls.tsx) with R3F's reconciler and a stand-in renderer:
 * the start pose in the Stue, keys moving the camera (default-prevented, so the plan's shortcuts stay quiet), Esc
 * ending the walk and the camera coming back, full walls and roofs in the interior mode, no picking while walking,
 * the start at a clicked point, and the shadows switch.
 */
import { _roots, act, advance, createRoot, extend } from '@react-three/fiber';
import type { ReconcilerRoot } from '@react-three/fiber';
import * as THREE from 'three';
import type { DirectionalLight, Object3D, PerspectiveCamera, Scene as ThreeScene } from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveVariant } from '../geometry/derive';
import { createForslagD } from '../model/seed/forslagD';
import type { Selection } from '../state/selection';
import { fromWorld } from './coords';
import { Scene } from './Scene';
import type { SceneProps } from './Scene';
import { WALK_EYE_HEIGHT } from './walk';
import { recordPick, resetView3dLocal, startWalk, view3dLocal } from './walkState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project = createForslagD();
const derived = deriveVariant(project.variants[0], project.site, null);

beforeAll(() => {
  extend(THREE as unknown as Parameters<typeof extend>[0]);
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
  // reduced motion: the camera rig jumps instead of easing (no wall-clock waits in the tests)
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

interface Mounted {
  root: ReconcilerRoot<HTMLCanvasElement>;
  canvas: HTMLCanvasElement;
  container: HTMLDivElement;
  state: () => ReturnType<NonNullable<ReturnType<typeof _roots.get>>['store']['getState']>;
  rerender: (props: SceneProps) => Promise<void>;
}

const mounted: Mounted[] = [];

beforeEach(() => resetView3dLocal());
afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await act(async () => m.root.unmount());
    m.container.remove();
  }
  resetView3dLocal();
});

function props(over: Partial<SceneProps> = {}): SceneProps {
  return {
    derived,
    site: project.site,
    terrain: null,
    mode: 'ute',
    activeStoreyId: 'ground',
    cutHeight: 1.3,
    showLabels: false,
    highlightNew: false,
    showTrees: false,
    showTerrain: false,
    sun: { dir: [0.3, -0.5, 0.81], isUp: true },
    preset: 'oversikt',
    selection: null,
    onSelect: () => {},
    coarse: false,
    ...over,
  };
}

async function mount(p: SceneProps): Promise<Mounted> {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  document.body.appendChild(container);
  Object.defineProperty(canvas, 'clientWidth', { value: 800 });
  Object.defineProperty(canvas, 'clientHeight', { value: 600 });
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  const gl = {
    domElement: canvas,
    render: vi.fn(),
    setPixelRatio: () => {},
    getPixelRatio: () => 1,
    setSize: () => {},
    shadowMap: { enabled: false, type: 0, needsUpdate: false },
    outputColorSpace: 'srgb',
    toneMapping: 0,
    dispose: () => {},
  };
  const root = createRoot(canvas);
  await act(async () => {
    await root.configure({
      gl: gl as never,
      size: { width: 800, height: 600, top: 0, left: 0 },
      frameloop: 'never',
      shadows: 'percentage',
      flat: true,
      camera: { fov: 42, near: 0.1, far: 1000, position: [30, 20, 30] },
    });
    root.render(<Scene {...p} />);
  });
  const m: Mounted = {
    root,
    canvas,
    container,
    state: () => {
      const entry = _roots.get(canvas);
      if (!entry) throw new Error('root missing');
      return entry.store.getState();
    },
    rerender: async (next) => {
      await act(async () => root.render(<Scene {...next} />));
    },
  };
  mounted.push(m);
  return m;
}

let clock = 0;
async function frames(n = 3) {
  for (let i = 0; i < n; i++) {
    clock += 16;
    await act(async () => {
      advance(clock, true);
    });
  }
}

const planOf = (m: Mounted) => fromWorld(m.state().camera.position);
const controlsOf = (m: Mounted) => m.state().controls as unknown as { enabled: boolean; target: THREE.Vector3 };
const key = (type: 'keydown' | 'keyup', code: string, k = code) => {
  const e = new KeyboardEvent(type, { code, key: k, bubbles: true, cancelable: true });
  window.dispatchEvent(e);
  return e;
};

function byName(root: Object3D, name: string): Object3D | undefined {
  return root.getObjectByName(name);
}

describe('walk mode (Scene + WalkControls)', () => {
  it('starts in the Stue at eye height facing the terrace, walks with W, and Esc brings the orbit camera back', async () => {
    const m = await mount(props());
    await frames(2);
    const orbit = m.state().camera.position.clone();
    expect(controlsOf(m).enabled).toBe(true);

    startWalk();
    await m.rerender(props({ walk: view3dLocal.getState().walk }));
    await frames(1);
    const cam = m.state().camera as PerspectiveCamera;
    const [x, y, z] = planOf(m);
    expect(x).toBeGreaterThan(9.7);
    expect(x).toBeLessThan(11.3);
    expect(y).toBeGreaterThan(1);
    expect(y).toBeLessThan(2.2);
    expect(z).toBeCloseTo(WALK_EYE_HEIGHT, 6);
    expect(cam.fov).toBeGreaterThan(42);
    expect(controlsOf(m).enabled).toBe(false);
    // looking towards plan −y (the glass door, the deck)
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    expect(dir.z).toBeGreaterThan(0.9); // world +z = plan −y

    const down = key('keydown', 'KeyW', 'w');
    expect(down.defaultPrevented).toBe(true);
    await frames(12);
    key('keyup', 'KeyW', 'w');
    const [, y2, z2] = planOf(m);
    expect(y2).toBeLessThan(y - 0.4);
    expect(z2).toBeCloseTo(WALK_EYE_HEIGHT, 3);
    // an arrow key is taken too (no nudge of a selection in the plan)
    const arrow = key('keydown', 'ArrowLeft', 'ArrowLeft');
    expect(arrow.defaultPrevented).toBe(true);
    key('keyup', 'ArrowLeft', 'ArrowLeft');

    const esc = key('keydown', 'Escape', 'Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(view3dLocal.getState().walk).toBeNull();
    await m.rerender(props({ walk: null }));
    await frames(1);
    expect(m.state().camera.position.distanceTo(orbit)).toBeLessThan(1e-6);
    expect((m.state().camera as PerspectiveCamera).fov).toBe(42);
    expect(controlsOf(m).enabled).toBe(true);
    // keys are left alone again
    expect(key('keydown', 'KeyW', 'w').defaultPrevented).toBe(false);
  });

  it('goes to the preset instead when a preset was chosen during the walk', async () => {
    const m = await mount(props());
    await frames(2);
    startWalk();
    await m.rerender(props({ walk: view3dLocal.getState().walk }));
    await frames(1);
    await m.rerender(props({ walk: null, preset: 'ovenfra' }));
    await frames(1);
    const [, , z] = planOf(m);
    expect(z).toBeGreaterThan(40); // 'ovenfra' is 54 m up
  });

  it('shows every storey with roofs while walking, also in the interior mode', async () => {
    const m = await mount(props({ mode: 'inne', walk: 1 }));
    await frames(1);
    const scene = m.state().scene as ThreeScene;
    expect(byName(scene, 'roofs')).toBeDefined();
    const inne = await mount(props({ mode: 'inne' }));
    await frames(1);
    expect(byName(inne.state().scene as ThreeScene, 'roofs')).toBeUndefined();
  });

  it('does not select on clicks while walking', async () => {
    const onSelect = vi.fn<(s: Selection | null) => void>();
    const m = await mount(props({ onSelect, walk: 1 }));
    await frames(1);
    const fire = (type: string) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 400, clientY: 300, button: 0 });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      Object.defineProperty(e, 'pointerType', { value: 'mouse' });
      m.canvas.dispatchEvent(e);
    };
    fire('pointerdown');
    fire('pointerup');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('starts where the user clicked when entered with that selection', async () => {
    const sel: Selection = { kind: 'room', id: 'room-stue', levelId: 'main' };
    const m = await mount(props({ selection: sel }));
    await frames(1);
    recordPick(sel, [13.5, 1.2], 0);
    startWalk();
    await m.rerender(props({ selection: sel, walk: view3dLocal.getState().walk }));
    await frames(1);
    const [x, y, z] = planOf(m);
    expect(Math.hypot(x - 13.5, y - 1.2)).toBeLessThan(0.31);
    expect(z).toBeCloseTo(WALK_EYE_HEIGHT, 6);
  });

  it('turns the sun shadows off with the switch', async () => {
    const light = (m: Mounted) => {
      let l: DirectionalLight | undefined;
      m.state().scene.traverse((o: Object3D) => {
        if ((o as DirectionalLight).isDirectionalLight) l = o as DirectionalLight;
      });
      return l!;
    };
    const on = await mount(props());
    await frames(1);
    expect(light(on).castShadow).toBe(true);
    const off = await mount(props({ shadows: false }));
    await frames(1);
    expect(light(off).castShadow).toBe(false);
    expect(light(off).intensity).toBeGreaterThan(0);
  });
});
