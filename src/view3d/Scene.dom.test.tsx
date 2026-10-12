// @vitest-environment jsdom
/**
 * Mounts the real scene graph (Scene.tsx) with R3F's reconciler and a stand-in renderer (no WebGL in jsdom), to
 * catch runtime errors in the components and to check modes, labels, picking (block edges, steps, rooms, the
 * touch tolerance), the selection highlight, the group memo split (a furniture or deck edit keeps the wall and roof
 * meshes), the furniture drop target and onReady.
 */
import { _roots, act, advance, createRoot, extend } from '@react-three/fiber';
import type { ReconcilerRoot } from '@react-three/fiber';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Group, Mesh, Object3D, Scene as ThreeScene, Vector3 } from 'three';
import { deriveVariant } from '../geometry/derive';
import type { DerivedFloor, DerivedFurniture, DerivedVariant, DerivedWall } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import type { Selection } from '../state/selection';
import { presetView } from './cameras';
import { toWorld } from './coords';
import type { DropHit } from './drop';
import { dispatchFurnitureDrop, FURNITURE_DROP_EVENT } from './dropEvent';
import { FIXTURE_DERIVED, FIXTURE_SITE, FIXTURE_TERRAIN } from './fixture';
import { PIN_MARGIN } from './labelDefs';
import { Scene } from './Scene';
import type { SceneProps } from './Scene';
import { pickTagsOf, selectionOf } from './sceneUtils';

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
    // pinned bottom-right (jsdom measures tags as 0 × 0, so its centre sits PIN_MARGIN from both edges)
    expect(stue.style.transform).toContain(`translate(${800 - PIN_MARGIN}px, ${600 - PIN_MARGIN}px)`);
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

  it("labels the block in front from 'framsiden', hides the one behind it and moves a partly hidden one (Forslag D)", async () => {
    const project = createForslagD();
    const derived = deriveVariant(project.variants[0], project.site, null);
    // real tag sizes (jsdom has no layout): 120 × 32 px
    const proto = HTMLElement.prototype;
    const ow = Object.getOwnPropertyDescriptor(proto, 'offsetWidth');
    const oh = Object.getOwnPropertyDescriptor(proto, 'offsetHeight');
    const sized = (v: number) => ({
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-label') ? v : 0;
      },
    });
    Object.defineProperty(proto, 'offsetWidth', sized(120));
    Object.defineProperty(proto, 'offsetHeight', sized(32));
    try {
      const m = await mount(baseProps({ derived, site: project.site, terrain: null, preset: 'framsiden', showTerrain: false, showTrees: false }));
      const v = presetView('framsiden', derived.bounds);
      m.look(v.position, v.target);
      await frames(3);
      const shown = (id: string) => m.container.querySelector<HTMLElement>(`[data-label="block:${id}"]`)!.style.display === 'block';
      const box = (id: string) => {
        const t = /translate\((-?\d+)px, (-?\d+)px\)/.exec(m.container.querySelector<HTMLElement>(`[data-label="block:${id}"]`)!.style.transform)!;
        return { x: Number(t[1]), y: Number(t[2]) };
      };
      expect(shown('blk-wing')).toBe(true); // the new wing, nearest
      expect(shown('blk-glass')).toBe(false); // behind the wing
      // the main house's ridge shows above the wing's: its tag is nudged clear of the wing's instead of hidden
      expect(shown('blk-main')).toBe(true);
      const [wing, main] = [box('blk-wing'), box('blk-main')];
      expect(Math.abs(wing.x - main.x) >= 120 || Math.abs(wing.y - main.y) >= 32).toBe(true);
      // only the north end of the bod wing shows, right of the new wing: its tag sits there, not over the wing
      expect(shown('blk-bod')).toBe(true);
      expect(box('blk-bod').x).toBeGreaterThan(wing.x + 150);
    } finally {
      if (ow) Object.defineProperty(proto, 'offsetWidth', ow);
      if (oh) Object.defineProperty(proto, 'offsetHeight', oh);
    }
  });

  it('highlights every shown mesh the selection matches, with an overlay and an outline each', async () => {
    const overlayCount = async (selection: Selection) => {
      const m = await mount(baseProps({ selection, showTerrain: false, showTrees: false }));
      await frames(1);
      const overlay = byName(m.scene(), 'selection') as Group;
      const meshes = overlay.children.filter((c) => (c as Mesh).isMesh && !(c as unknown as { isLineSegments?: boolean }).isLineSegments).length;
      const lines = overlay.children.filter((c) => (c as unknown as { isLineSegments?: boolean }).isLineSegments).length;
      expect(lines).toBe(meshes);
      return meshes;
    };
    // the plan's piece selection, and the 3D pick of the same wall (its block edge)
    expect(await overlayCount({ kind: 'wall', id: FIXTURE_DERIVED.walls[0].id })).toBe(1);
    expect(await overlayCount({ kind: 'blockEdge', id: 'v-s' })).toBe(1);
    // a block: its roof (2 slopes + trims), foundation and 4 exterior wall pieces
    expect(await overlayCount({ kind: 'block', id: 'blk' })).toBe(3 + 1 + 4);
    expect(await overlayCount({ kind: 'room', id: 'rom-stue', levelId: 'main' })).toBe(1);
    expect(await overlayCount({ kind: 'steps', id: 'deck-1/steps/0' })).toBe(1);
    // the deck lights up with its steps
    expect(await overlayCount({ kind: 'deck', id: 'deck-1' })).toBe(2);
    expect(await overlayCount({ kind: 'hotTub', id: 'tub-1' })).toBeGreaterThan(0);
    expect(await overlayCount({ kind: 'wall', id: 'nothing' })).toBe(0);
  });

  it('picks an exterior wall as its block edge, a deck step as steps and a floor as its room', async () => {
    const onSelect = vi.fn<(s: Selection | null) => void>();
    const m = await mount(baseProps({ onSelect, mode: 'inne', showTerrain: false, showTrees: false, showLabels: false }));
    await frames(1);
    const click = () => {
      for (const type of ['pointerdown', 'pointerup']) {
        const e = new MouseEvent(type, { bubbles: true, clientX: 400, clientY: 300, button: 0 });
        Object.defineProperty(e, 'pointerId', { value: 1 });
        Object.defineProperty(e, 'pointerType', { value: 'mouse' });
        m.canvas.dispatchEvent(e);
      }
    };
    m.look([14, 2, 1], [6, 2, 1]);
    await frames(1);
    click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'blockEdge', id: 'v-e' });
    m.look([2.5, -3.5, 10], [2.5, -3.45, 0]);
    await frames(1);
    click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'steps', id: 'deck-1/steps/0' });
    m.look([1.5, 1, 10], [1.5, 1.05, 0]);
    await frames(1);
    click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'room', id: 'rom-stue', levelId: 'main' });
  });

  it('uses the touch tolerance for touch presses (10 px) and the mouse one otherwise (5 px)', async () => {
    const onSelect = vi.fn<(s: Selection | null) => void>();
    const m = await mount(baseProps({ onSelect, preset: 'ovenfra', showTerrain: false, showTrees: false }));
    await frames(1);
    const press = (pointerType: string, dx: number) => {
      for (const [type, x] of [
        ['pointerdown', 400],
        ['pointermove', 400 + dx],
        ['pointerup', 400 + dx],
      ] as const) {
        const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 300, button: 0 });
        Object.defineProperty(e, 'pointerId', { value: 7 });
        Object.defineProperty(e, 'pointerType', { value: pointerType });
        m.canvas.dispatchEvent(e);
      }
    };
    press('mouse', 8);
    expect(onSelect).not.toHaveBeenCalled();
    press('touch', 8);
    expect(onSelect).toHaveBeenCalledTimes(1);
    press('touch', 12);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('builds no ghosts, no blocked steps, and one mesh per steps', async () => {
    const interior = FIXTURE_DERIVED.walls.find((w) => w.id === 'w-int')!;
    const ghost: DerivedWall = { ...interior, id: 'w-ghost', source: { kind: 'wall', wallId: 'w-ghost' }, status: 'removed', isGhost: true, openings: [] };
    const second = { ...FIXTURE_DERIVED.outdoor.steps[0], id: 'deck-1/steps/1', at: [5, -3] as [number, number] };
    const blocked = { ...FIXTURE_DERIVED.outdoor.steps[0], id: 'deck-1/steps/2', blocked: true };
    const derived: DerivedVariant = {
      ...FIXTURE_DERIVED,
      walls: [...FIXTURE_DERIVED.walls, ghost],
      outdoor: { ...FIXTURE_DERIVED.outdoor, steps: [...FIXTURE_DERIVED.outdoor.steps, second, blocked] },
    };
    const m = await mount(baseProps({ derived, showTerrain: false, showTrees: false }));
    await frames(1);
    const tagged = new Map<string, number>();
    m.scene().traverse((o) => {
      if (!(o as Mesh).isMesh) return;
      const sel = selectionOf(o);
      if (sel) tagged.set(`${sel.kind}:${sel.id}`, (tagged.get(`${sel.kind}:${sel.id}`) ?? 0) + 1);
    });
    expect(meshCount(byName(m.scene(), 'interior-walls'))).toBe(1);
    expect(tagged.has('wall:w-ghost')).toBe(false);
    expect([...tagged.keys()].some((k) => k.startsWith('opening:win-old'))).toBe(false); // the removed window
    expect(tagged.get('steps:deck-1/steps/0')).toBe(1);
    expect(tagged.get('steps:deck-1/steps/1')).toBe(1);
    expect(tagged.has('steps:deck-1/steps/2')).toBe(false);
    expect(tagged.get('railing:deck-1/railing')).toBe(2); // solid + glass
    expect(tagged.get('deck:deck-1')).toBe(1);
  });

  it('a furniture or deck edit rebuilds neither the walls nor the roofs', async () => {
    const props = baseProps({ showTerrain: false, showTrees: false });
    const m = await mount(props);
    await frames(1);
    const meshesOf = (name: string) => {
      const out: Mesh[] = [];
      byName(m.scene(), name)?.traverse((o) => {
        if ((o as Mesh).isMesh) out.push(o as Mesh);
      });
      return out;
    };
    /** Mesh instances and the geometries they hold right now. */
    const snapshot = (name: string) => meshesOf(name).map((mesh) => ({ mesh, geometry: mesh.geometry }));
    const walls0 = snapshot('exterior-walls');
    const roofs0 = snapshot('roofs');
    const floors0 = snapshot('floors');
    const deckGeometry0 = meshesOf('outdoor').find((o) => pickTagsOf(o)?.select?.kind === 'deck')!.geometry;
    const item: DerivedFurniture = {
      id: 'f-1',
      item: { id: 'f-1', catalogId: 'stol', position: [1.5, 1], rotationDeg: 30, levelId: 'main', size: { w: 0.5, d: 0.5, h: 0.9 }, isNew: true },
      catalog: null,
      footprint: [
        [1.25, 0.75],
        [1.75, 0.75],
        [1.75, 1.25],
        [1.25, 1.25],
      ],
      bbox: { min: [1.25, 0.75], max: [1.75, 1.25] },
      levelId: 'main',
      roomId: 'rom-stue',
      floorZ: 0,
      z: 0,
      clearances: [],
      collisions: [],
      blocksDoors: [],
      needsDrain: false,
      isNew: true,
    };
    const withChair: DerivedVariant = { ...FIXTURE_DERIVED, furniture: [item] };
    await act(async () => m.root.render(<Scene {...props} derived={withChair} />));
    await frames(1);
    expect(meshCount(byName(m.scene(), 'furniture'))).toBe(1);
    const chair = meshesOf('furniture')[0];
    expect(selectionOf(chair)).toEqual({ kind: 'furniture', id: 'f-1', levelId: 'main' });
    chair.geometry.computeBoundingBox();
    expect(chair.geometry.boundingBox!.max.y).toBeCloseTo(0.9, 6); // float32 positions
    const same = (a: ReturnType<typeof snapshot>, b: ReturnType<typeof snapshot>) =>
      a.length > 0 && a.length === b.length && a.every((x, i) => x.mesh === b[i].mesh && x.geometry === b[i].geometry);
    expect(same(snapshot('exterior-walls'), walls0)).toBe(true);
    expect(same(snapshot('roofs'), roofs0)).toBe(true);
    expect(same(snapshot('floors'), floors0)).toBe(true);

    const deck = FIXTURE_DERIVED.outdoor.decks[0];
    const lowered = { ...deck, topZ: -0.2 };
    const withDeck: DerivedVariant = { ...withChair, outdoor: { ...withChair.outdoor, decks: [lowered] } };
    await act(async () => m.root.render(<Scene {...props} derived={withDeck} />));
    await frames(1);
    expect(same(snapshot('exterior-walls'), walls0)).toBe(true);
    expect(same(snapshot('roofs'), roofs0)).toBe(true);
    expect(meshesOf('furniture')[0]).toBe(chair);
    const deck1 = meshesOf('outdoor').find((o) => pickTagsOf(o)?.select?.kind === 'deck')!;
    expect(deck1.geometry).not.toBe(deckGeometry0);
    // and a wall edit does rebuild the wall it touches
    const walls = FIXTURE_DERIVED.walls.map((w, i) => (i === 0 ? { ...w } : w));
    await act(async () => m.root.render(<Scene {...props} derived={{ ...withDeck, walls }} />));
    await frames(1);
    const walls2 = snapshot('exterior-walls');
    expect(walls2.filter((x, i) => x.geometry !== walls0[i].geometry).length).toBe(1);

    // in the interior mode on the ground storey a loft item is not built, a tall one is cut
    const loftItem: DerivedFurniture = { ...item, id: 'f-2', levelId: 'loft', z: 1.47, floorZ: 1.47, item: { ...item.item, id: 'f-2', levelId: 'loft' } };
    const tall: DerivedFurniture = { ...item, id: 'f-3', item: { ...item.item, id: 'f-3', size: { w: 0.5, d: 0.5, h: 2.2 } } };
    const inne = await mount(baseProps({ mode: 'inne', cutHeight: 1.3, derived: { ...FIXTURE_DERIVED, furniture: [loftItem, tall] }, showTerrain: false }));
    await frames(1);
    const built: Mesh[] = [];
    byName(inne.scene(), 'furniture')?.traverse((o) => {
      if ((o as Mesh).isMesh) built.push(o as Mesh);
    });
    expect(built.length).toBe(1);
    built[0].geometry.computeBoundingBox();
    expect(built[0].geometry.boundingBox!.max.y).toBeCloseTo(1.3, 6);
  });

  it('accepts a furniture drop on the floor under the pointer and reports the plan point', async () => {
    const onDropFurniture = vi.fn<(catalogId: string, p: [number, number], hit: DropHit) => void>();
    const m = await mount(baseProps({ onDropFurniture, mode: 'inne', showTerrain: false, showTrees: false, showLabels: false }));
    await frames(1);
    m.look([1.5, 1, 10], [1.5, 1.05, 0]);
    await frames(1);
    const drop = (x: number, y: number, catalogId = 'sofa-3') =>
      !m.canvas.dispatchEvent(new CustomEvent(FURNITURE_DROP_EVENT, { bubbles: true, cancelable: true, detail: { catalogId, clientX: x, clientY: y } }));
    expect(drop(400, 300)).toBe(true);
    expect(onDropFurniture).toHaveBeenCalledTimes(1);
    const [catalogId, point, hit] = onDropFurniture.mock.calls[0];
    expect(catalogId).toBe('sofa-3');
    expect(point[0]).toBeCloseTo(1.5, 6);
    expect(point[1]).toBeCloseTo(1.05, 6);
    expect(hit).toMatchObject({ surface: 'floor', levelId: 'main', id: 'rom-stue/floor' });
    // outside the canvas, a malformed event, or empty sky: not accepted
    expect(drop(900, 300)).toBe(false);
    expect(!m.canvas.dispatchEvent(new CustomEvent(FURNITURE_DROP_EVENT, { bubbles: true, cancelable: true, detail: { clientX: 400, clientY: 300 } }))).toBe(false);
    m.look([1.5, 1, 1], [1.5, 30, 6]);
    await frames(1);
    expect(drop(400, 300)).toBe(false);
    expect(onDropFurniture).toHaveBeenCalledTimes(1);
    // the library's helper dispatches on the element under the pointer
    m.look([1.5, 1, 10], [1.5, 1.05, 0]);
    await frames(1);
    const doc = { elementFromPoint: () => m.canvas } as unknown as Document;
    expect(dispatchFurnitureDrop(400, 300, 'seng-150', doc)).toBe(true);
    expect(onDropFurniture).toHaveBeenLastCalledWith('seng-150', expect.any(Array), expect.objectContaining({ surface: 'floor' }));
    expect(dispatchFurnitureDrop(400, 300, 'seng-150', { elementFromPoint: () => null } as unknown as Document)).toBe(false);
  });

  it('accepts no drop without a handler', async () => {
    const m = await mount(baseProps({ mode: 'inne', showTerrain: false, showTrees: false, showLabels: false }));
    await frames(1);
    m.look([1.5, 1, 10], [1.5, 1.05, 0]);
    await frames(1);
    const accepted = !m.canvas.dispatchEvent(
      new CustomEvent(FURNITURE_DROP_EVENT, { bubbles: true, cancelable: true, detail: { catalogId: 'x', clientX: 400, clientY: 300 } }),
    );
    expect(accepted).toBe(false);
  });
});
