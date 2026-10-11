// @vitest-environment jsdom
/**
 * Mounts the real scene graph (Scene.tsx) with R3F's reconciler and a stand-in renderer (no WebGL in jsdom), to
 * catch runtime errors in the components and to check modes, labels, picking, the selection overlay and onReady.
 */
import { _roots, act, advance, createRoot, extend } from '@react-three/fiber';
import type { ReconcilerRoot } from '@react-three/fiber';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Group, Mesh, Object3D, Scene as ThreeScene, Vector3 } from 'three';
import type { DerivedFloor } from '../model/derived';
import type { Selection } from '../state/selection';
import { toWorld } from './coords';
import { FIXTURE_DERIVED, FIXTURE_SITE, FIXTURE_TERRAIN } from './fixture';
import { PIN_MARGIN } from './labelDefs';
import { Scene } from './Scene';
import type { SceneProps } from './Scene';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  extend(THREE as unknown as Parameters<typeof extend>[0]);
  // jsdom has no 2D canvas; the canvas textures then stay blank, which is fine here
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  // jsdom has no pointer capture (OrbitControls uses it)
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
});

interface Mounted {
  root: ReconcilerRoot<HTMLCanvasElement>;
  canvas: HTMLCanvasElement;
  container: HTMLDivElement;
  scene: () => ThreeScene;
  render: ReturnType<typeof vi.fn>;
  /** Puts the camera at a plan point looking at another (the orbit controls keep it there). */
  look: (from: [number, number, number], to: [number, number, number]) => void;
}

const mounted: Mounted[] = [];

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await act(async () => m.root.unmount());
    m.container.remove();
  }
});

function baseProps(over: Partial<SceneProps> = {}): SceneProps {
  return {
    derived: FIXTURE_DERIVED,
    site: FIXTURE_SITE,
    terrain: FIXTURE_TERRAIN,
    mode: 'ute',
    activeStoreyId: 'ground',
    cutHeight: 1.6,
    showLabels: true,
    highlightNew: false,
    showTrees: true,
    showTerrain: true,
    sun: { dir: [0.3, -0.5, 0.81], isUp: true },
    preset: 'oversikt',
    selection: null,
    onSelect: () => {},
    coarse: false,
    ...over,
  };
}

async function mount(props: SceneProps): Promise<Mounted> {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  document.body.appendChild(container);
  // jsdom has no layout; OrbitControls divides by the client size
  Object.defineProperty(canvas, 'clientWidth', { value: 800 });
  Object.defineProperty(canvas, 'clientHeight', { value: 600 });
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  const render = vi.fn();
  const gl = {
    domElement: canvas,
    render,
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
    root.render(<Scene {...props} />);
  });
  const state = () => {
    const entry = _roots.get(canvas);
    if (!entry) throw new Error('root missing');
    return entry.store.getState();
  };
  const m: Mounted = {
    root,
    canvas,
    container,
    render,
    scene: () => state().scene,
    look: (from, to) => {
      const s = state();
      const controls = s.controls as unknown as { target: Vector3; update(): void } | null;
      s.camera.position.copy(toWorld(...from));
      controls?.target.copy(toWorld(...to));
      s.camera.lookAt(toWorld(...to));
      controls?.update();
      s.invalidate();
    },
  };
  mounted.push(m);
  return m;
}

async function frames(n = 3) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      advance(performance.now() + i * 16, true);
    });
  }
}

function byName(root: Object3D, name: string): Object3D | undefined {
  return root.getObjectByName(name);
}

function meshCount(o: Object3D | undefined): number {
  let n = 0;
  o?.traverse((c) => {
    if ((c as Mesh).isMesh) n++;
  });
  return n;
}

describe('Scene (R3F, stand-in renderer)', () => {
  it('mounts all groups in the exterior mode and renders frames', async () => {
    const onReady = vi.fn();
    const m = await mount(baseProps({ onReady }));
    await frames(3);
    const scene = m.scene();
    expect(meshCount(byName(scene, 'exterior-walls'))).toBe(4);
    expect(meshCount(byName(scene, 'interior-walls'))).toBe(1);
    expect(meshCount(byName(scene, 'roofs'))).toBe(3); // two slopes + trims
    expect(meshCount(byName(scene, 'floors'))).toBe(FIXTURE_DERIVED.floors.length);
    expect(meshCount(byName(scene, 'terrain'))).toBe(3); // two grids + water
    expect(meshCount(byName(scene, 'trees'))).toBe(2 * 8);
    expect(meshCount(byName(scene, 'structure'))).toBe(4);
    expect(meshCount(byName(scene, 'foundations'))).toBe(1);
    expect(m.render).toHaveBeenCalled();
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    // block label in the exterior mode
    await vi.waitFor(() => expect(m.container.querySelectorAll('[data-label]').length).toBe(1));
  });

  it('hides roofs and the loft, and cuts the walls, in the interior mode', async () => {
    const m = await mount(baseProps({ mode: 'inne', activeStoreyId: 'ground', cutHeight: 1.6 }));
    await frames(2);
    const scene = m.scene();
    expect(byName(scene, 'roofs')).toBeUndefined();
    expect(meshCount(byName(scene, 'floors'))).toBe(4); // loft room + slab hidden
    let maxY = -Infinity;
    byName(scene, 'exterior-walls')!.traverse((o) => {
      const g = (o as Mesh).geometry;
      if (g?.boundingBox) maxY = Math.max(maxY, g.boundingBox.max.y);
    });
    expect(maxY).toBeCloseTo(1.6, 5);
    await vi.waitFor(() => expect(m.container.querySelectorAll('[data-label]').length).toBe(3));
  });

  it('refines the terrain over derived.groundWorks (not the site list)', async () => {
    const plain = await mount(baseProps());
    await frames(1);
    expect(byName(plain.scene(), 'terrain-patch')).toBeUndefined();
    const cut = await mount(baseProps({ derived: { ...FIXTURE_DERIVED, groundWorks: FIXTURE_SITE.groundWorks } }));
    await frames(1);
    const patch = byName(cut.scene(), 'terrain-patch') as Mesh | undefined;
    expect(patch).toBeDefined();
    patch!.geometry.computeBoundingBox();
    // the fixture's cut (maxZ −0.3) shows in the patch
    expect(patch!.geometry.boundingBox!.min.y).toBeLessThanOrEqual(-0.3 + 1e-9);
  });

  it('draws flat ceilings in the exterior mode and hides them inside', async () => {
    const ceiling: DerivedFloor = {
      id: 'blk/ceiling',
      levelId: 'main',
      polygon: FIXTURE_DERIVED.rooms[0].polygon,
      holes: [],
      z: 2.4,
      thickness: 0.05,
      material: 'wood',
      isNew: false,
      kind: 'ceiling',
    };
    const derived = { ...FIXTURE_DERIVED, floors: [...FIXTURE_DERIVED.floors, ceiling] };
    const ute = await mount(baseProps({ derived }));
    await frames(1);
    expect(meshCount(byName(ute.scene(), 'floors'))).toBe(FIXTURE_DERIVED.floors.length + 1);
    const inne = await mount(baseProps({ derived, mode: 'inne' }));
    await frames(1);
    expect(meshCount(byName(inne.scene(), 'floors'))).toBe(4);
  });

  it('never hides the label of the room the camera stands in', async () => {
    const m = await mount(baseProps({ mode: 'inne', showTerrain: false, showTrees: false }));
    await frames(2);
    // stand in the Stue (0.16…3.44 × 0.16…2) and look west, away from its label at (1.8, 1.08)
    m.look([1, 1, 1.55], [-10, 1, 1.3]);
    await frames(3);
    const stue = m.container.querySelector<HTMLElement>('[data-label="room:main:rom-stue"]')!;
    const kitchen = m.container.querySelector<HTMLElement>('[data-label="room:main:rom-kjokken"]')!;
    expect(stue.style.display).toBe('block');
    expect(stue.style.transform).toContain(`translate(400px, ${600 - PIN_MARGIN}px)`);
    expect(kitchen.style.display).toBe('none'); // behind the camera too, but not the camera's room
    // from above, nobody stands in a room: the Stue tag follows its anchor again
    m.look([3, -12, 20], [3, 2, 0]);
    await frames(3);
    expect(stue.style.transform).not.toContain(`${600 - PIN_MARGIN}px)`);
  });

  it('selects by click and ignores drags', async () => {
    const onSelect = vi.fn<(s: Selection | null) => void>();
    const m = await mount(baseProps({ onSelect, preset: 'ovenfra', showTerrain: false, showTrees: false }));
    await frames(2);
    const fire = (type: string, x: number, y: number) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      Object.defineProperty(e, 'pointerType', { value: 'mouse' });
      m.canvas.dispatchEvent(e);
    };
    // drag: no selection
    fire('pointerdown', 400, 300);
    fire('pointermove', 460, 300);
    fire('pointerup', 460, 300);
    expect(onSelect).not.toHaveBeenCalled();
    // click in the middle of the screen (the top view looks straight down at the bounds centre)
    fire('pointerdown', 400, 300);
    fire('pointerup', 401, 300);
    expect(onSelect).toHaveBeenCalledTimes(1);
    const sel = onSelect.mock.calls[0][0];
    expect(sel?.kind).toBe('block');
    // click on empty sky at the top edge → still a hit test; anything outside the model clears the selection
    fire('pointerdown', 2, 2);
    fire('pointerup', 2, 2);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('draws an overlay on the selected element', async () => {
    const m = await mount(baseProps({ selection: { kind: 'wall', id: FIXTURE_DERIVED.walls[0].id } }));
    await frames(1);
    const overlay = byName(m.scene(), 'selection') as Group;
    expect(overlay.children.length).toBe(1);
  });
});
