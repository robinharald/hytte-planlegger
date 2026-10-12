// @vitest-environment jsdom
/**
 * Furniture.tsx mounted with R3F's reconciler and a stand-in renderer (no WebGL in jsdom): placement and rotation,
 * pick tags, interior-mode visibility and cut, tints (collision, new), the item colour, the glass mesh, and geometry
 * reuse when an item moves or turns.
 */
import { act, createRoot, extend } from '@react-three/fiber';
import type { ReconcilerRoot } from '@react-three/fiber';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Group, Mesh, MeshLambertMaterial, Object3D } from 'three';
import { furnitureFootprint } from '../geometry/derive';
import type { DerivedFurniture } from '../model/derived';
import type { FurnitureItem } from '../model/types';
import { fromWorld } from './coords';
import { FIXTURE_DERIVED } from './fixture';
import { Furniture } from './Furniture';
import { FURNITURE_MAT } from './furnitureBuilders';
import { getFurnitureGlass, getFurnitureMaterials, PALETTE } from './materials';
import { selectionOf } from './sceneUtils';
import { computeVisibility } from './visibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  extend(THREE as unknown as Parameters<typeof extend>[0]);
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});

const roots: ReconcilerRoot<HTMLCanvasElement>[] = [];

afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
});

async function mount(el: ReactNode) {
  const canvas = document.createElement('canvas');
  const gl = {
    domElement: canvas,
    render: () => {},
    setPixelRatio: () => {},
    getPixelRatio: () => 1,
    setSize: () => {},
    shadowMap: { enabled: false, type: 0, needsUpdate: false },
    outputColorSpace: 'srgb',
    toneMapping: 0,
    dispose: () => {},
  };
  const root = createRoot(canvas);
  roots.push(root);
  let scene: THREE.Scene | null = null;
  await act(async () => {
    await root.configure({ gl: gl as never, size: { width: 400, height: 300, top: 0, left: 0 }, frameloop: 'never', onCreated: (s) => void (scene = s.scene) });
    root.render(el);
  });
  return {
    render: async (next: ReactNode) => act(async () => root.render(next)),
    group: () => {
      const g = scene!.getObjectByName('furniture') as Group | undefined;
      if (!g) throw new Error('no furniture group');
      return g;
    },
  };
}

function item(over: Partial<FurnitureItem> = {}): FurnitureItem {
  return { id: 'f-1', catalogId: 'sofa-2', position: [3, 2], rotationDeg: 0, levelId: 'main', size: { w: 1.6, d: 0.9, h: 0.8 }, isNew: true, ...over };
}

function derived(it: FurnitureItem, over: Partial<DerivedFurniture> = {}): DerivedFurniture {
  const footprint = furnitureFootprint(it);
  const z = it.levelId === 'loft' ? 1.47 : 0;
  return {
    id: it.id,
    item: it,
    catalog: null,
    footprint,
    bbox: { min: [Math.min(...footprint.map((p) => p[0])), Math.min(...footprint.map((p) => p[1]))], max: [Math.max(...footprint.map((p) => p[0])), Math.max(...footprint.map((p) => p[1]))] },
    levelId: it.levelId,
    floorZ: z,
    z,
    clearances: [],
    collisions: [],
    blocksDoors: [],
    needsDrain: false,
    isNew: it.isNew,
    ...over,
  } as DerivedFurniture;
}

const UTE = computeVisibility(FIXTURE_DERIVED, 'ute', 'ground', 1.3);
const INNE = computeVisibility(FIXTURE_DERIVED, 'inne', 'ground', 1.3);

function meshes(o: Object3D): Mesh[] {
  const out: Mesh[] = [];
  o.traverse((c) => {
    if ((c as Mesh).isMesh) out.push(c as Mesh);
  });
  return out;
}

function itemGroup(root: Group, id: string): Group {
  const g = root.getObjectByName(`furniture:${id}`) as Group | undefined;
  if (!g) throw new Error(`no group for ${id}`);
  return g;
}

describe('Furniture (3D)', () => {
  it('places each item on its footprint, turned by rotationDeg, at its bottom z, and makes it pickable', async () => {
    const it0 = item({ rotationDeg: 30 });
    const m = await mount(<Furniture furniture={[derived(it0)]} vis={UTE} highlightNew={false} />);
    const g = itemGroup(m.group(), 'f-1');
    const [mesh] = meshes(g);
    expect(meshes(g)).toHaveLength(1);
    expect(selectionOf(mesh)).toEqual({ kind: 'furniture', id: 'f-1', levelId: 'main' });
    g.updateWorldMatrix(true, true);
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeCloseTo(1.6, 5);
    expect(bb.max.z - bb.min.z).toBeCloseTo(0.9, 5);
    expect(bb.min.y).toBeCloseTo(0, 5);
    expect(bb.max.y).toBeCloseTo(0.8, 5);
    // the local box corners land on derive's footprint
    const fp = furnitureFootprint(it0);
    const corners: [number, number][] = [
      [bb.min.x, bb.max.z],
      [bb.max.x, bb.max.z],
      [bb.max.x, bb.min.z],
      [bb.min.x, bb.min.z],
    ];
    corners.forEach(([x, z], i) => {
      const p = fromWorld(new THREE.Vector3(x, 0, z).applyMatrix4(mesh.matrixWorld));
      expect(p[0]).toBeCloseTo(fp[i][0], 5);
      expect(p[1]).toBeCloseTo(fp[i][1], 5);
    });
  });

  it('moving or turning an item keeps its geometry; resizing rebuilds it', async () => {
    const it0 = item();
    const m = await mount(<Furniture furniture={[derived(it0)]} vis={UTE} highlightNew={false} />);
    const geo0 = meshes(itemGroup(m.group(), 'f-1'))[0].geometry;
    const moved = item({ position: [5, -1], rotationDeg: 90 });
    await m.render(<Furniture furniture={[derived(moved)]} vis={UTE} highlightNew={false} />);
    const g = itemGroup(m.group(), 'f-1');
    expect(meshes(g)[0].geometry).toBe(geo0);
    expect(g.position.toArray()).toEqual([5, 0, 1]);
    expect(g.rotation.y).toBeCloseTo(Math.PI / 2, 9);
    await m.render(<Furniture furniture={[derived(item({ size: { w: 2, d: 0.9, h: 0.8 } }))]} vis={UTE} highlightNew={false} />);
    expect(meshes(itemGroup(m.group(), 'f-1'))[0].geometry).not.toBe(geo0);
  });

  it('interior mode: items on hidden levels are not built, tall ones are cut at the cut plane', async () => {
    const loft = item({ id: 'f-loft', levelId: 'loft', catalogId: 'stol', size: { w: 0.45, d: 0.5, h: 0.85 } });
    const tall = item({ id: 'f-tall', catalogId: 'garderobeskap', size: { w: 1, d: 0.6, h: 2.1 } });
    const low = item({ id: 'f-low', catalogId: 'stol', size: { w: 0.45, d: 0.5, h: 0.85 }, position: [6, 2] });
    const list = [derived(loft), derived(tall), derived(low)];
    const m = await mount(<Furniture furniture={list} vis={INNE} highlightNew={false} />);
    expect(m.group().getObjectByName('furniture:f-loft')).toBeUndefined();
    const cut = meshes(itemGroup(m.group(), 'f-tall'))[0];
    cut.geometry.computeBoundingBox();
    expect(cut.geometry.boundingBox!.max.y).toBeCloseTo(1.3, 5);
    const whole = meshes(itemGroup(m.group(), 'f-low'))[0];
    whole.geometry.computeBoundingBox();
    expect(whole.geometry.boundingBox!.max.y).toBeCloseTo(0.85, 5);
    await m.render(<Furniture furniture={list} vis={UTE} highlightNew={false} />);
    expect(m.group().getObjectByName('furniture:f-loft')).toBeDefined();
    const full = meshes(itemGroup(m.group(), 'f-tall'))[0];
    full.geometry.computeBoundingBox();
    expect(full.geometry.boundingBox!.max.y).toBeCloseTo(2.1, 5);
  });

  it('tints: red for a collision (over the new highlight), orange for new items with the 3D switch on, plain otherwise', async () => {
    const a = derived(item({ id: 'a' }), { collisions: ['b'] });
    const b = derived(item({ id: 'b', position: [8, 2] }));
    const c = derived(item({ id: 'c', position: [12, 2], isNew: false }));
    const m = await mount(<Furniture furniture={[a, b, c]} vis={UTE} highlightNew />);
    const mat = (id: string) => meshes(itemGroup(m.group(), id))[0].material as MeshLambertMaterial[];
    expect(mat('a')).toBe(getFurnitureMaterials('collision'));
    expect(mat('b')).toBe(getFurnitureMaterials('new'));
    expect(mat('c')).toBe(getFurnitureMaterials('plain'));
    const red = mat('a')[FURNITURE_MAT.sofa];
    const plain = getFurnitureMaterials('plain')[FURNITURE_MAT.sofa];
    expect(red.color.r).toBeGreaterThan(plain.color.r);
    expect(red.emissive.getHex(THREE.LinearSRGBColorSpace)).toBe(0xb3261e);
    expect(mat('b')[FURNITURE_MAT.sofa].emissive.getHex(THREE.LinearSRGBColorSpace)).toBe(PALETTE.newEmissive);
    await m.render(<Furniture furniture={[a, b, c]} vis={UTE} highlightNew={false} />);
    expect(mat('a')).toBe(getFurnitureMaterials('collision'));
    expect(mat('b')).toBe(getFurnitureMaterials('plain'));
  });

  it("the item's colour replaces its model's colour slot only", async () => {
    const sofa = derived(item({ colour: '#aa3322' }));
    const bad = derived(item({ id: 'f-2', colour: 'rosa', position: [8, 2] }));
    const m = await mount(<Furniture furniture={[sofa, bad]} vis={UTE} highlightNew={false} />);
    const mats = meshes(itemGroup(m.group(), 'f-1'))[0].material as MeshLambertMaterial[];
    expect(mats[FURNITURE_MAT.sofa].color.getHex(THREE.LinearSRGBColorSpace)).toBe(0xaa3322);
    expect(mats[FURNITURE_MAT.black]).toBe(getFurnitureMaterials('plain')[FURNITURE_MAT.black]);
    expect(mats).toBe(getFurnitureMaterials('plain', { slots: ['sofa'], hex: 0xaa3322 }));
    expect(meshes(itemGroup(m.group(), 'f-2'))[0].material).toBe(getFurnitureMaterials('plain'));
  });

  it('a shower has a glass mesh that casts no shadow, picked as the same item', async () => {
    const shower = derived(item({ catalogId: 'dusj-90', size: { w: 0.9, d: 0.9, h: 2 } }));
    const m = await mount(<Furniture furniture={[shower]} vis={UTE} highlightNew={false} />);
    const ms = meshes(itemGroup(m.group(), 'f-1'));
    expect(ms).toHaveLength(2);
    const glass = ms.find((x) => x.material === getFurnitureGlass('plain'))!;
    expect(glass).toBeDefined();
    expect(glass.castShadow).toBe(false);
    expect((glass.material as MeshLambertMaterial).transparent).toBe(true);
    expect(selectionOf(glass)).toEqual({ kind: 'furniture', id: 'f-1', levelId: 'main' });
    expect(ms.find((x) => x !== glass)!.castShadow).toBe(true);
  });

  it('an unknown catalogue id is drawn as the pine placeholder box', async () => {
    const m = await mount(<Furniture furniture={[derived(item({ catalogId: 'noe-nytt', size: { w: 0.6, d: 0.6, h: 1.1 } }))]} vis={UTE} highlightNew={false} />);
    const [mesh] = meshes(itemGroup(m.group(), 'f-1'));
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(1.1, 5);
    expect(mesh.geometry.groups.map((g) => g.materialIndex)).toEqual([FURNITURE_MAT.pine]);
  });

  it("reads the catalogue entry on the derived item: a later id drawn by its model key, the corner sofa's seat", async () => {
    const later = derived(item({ id: 'f-bed', catalogId: 'seng-200', size: { w: 2, d: 2.1, h: 0.5 } }), { catalog: { id: 'seng-200', name: 'Seng 200', model: 'bed' } as never });
    const sofa = (id: string, seat: number) =>
      derived(item({ id, catalogId: 'hjornesofa', size: { w: 2.7, d: 1.6, h: 0.8 }, position: [8, 2] }), { catalog: { id: 'hjornesofa', name: 'Hjørnesofa', model: 'corner-sofa', seat } as never });
    const m = await mount(<Furniture furniture={[later, sofa('f-a', 0.9), sofa('f-b', 1.2)]} vis={UTE} highlightNew={false} />);
    const bed = meshes(itemGroup(m.group(), 'f-bed'))[0];
    expect(bed.geometry.groups.map((g) => g.materialIndex)).toContain(FURNITURE_MAT.mattress);
    const a = meshes(itemGroup(m.group(), 'f-a'))[0].geometry;
    const b = meshes(itemGroup(m.group(), 'f-b'))[0].geometry;
    expect(a.getAttribute('position').array).not.toEqual(b.getAttribute('position').array);
  });
});
