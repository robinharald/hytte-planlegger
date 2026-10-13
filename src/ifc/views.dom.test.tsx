// @vitest-environment jsdom
/**
 * The three views of the IFC overlay on the app's store: the plan layer (plan2d/layers/IfcLayer.tsx), the panel
 * (ui/IfcPanel.tsx) and the 3D overlay (view3d/IfcOverlay.tsx, R3F with a stand-in renderer as in Scene.dom.test.tsx).
 */
import { _roots, act as r3fAct, createRoot as createR3fRoot, extend } from '@react-three/fiber';
import { nb } from '../i18n/nb';
import type { ReconcilerRoot } from '@react-three/fiber';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import * as THREE from 'three';
import type { LineBasicMaterial, Mesh, Object3D } from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IfcLayer } from '../plan2d/layers/IfcLayer';
import { IfcPanel } from '../ui/IfcPanel';
import { IfcOverlay } from '../view3d/IfcOverlay';
import { FIXTURE_DERIVED } from '../view3d/fixture';
import { PARSER_VERSION } from './parse';
import { DEFAULT_IFC_PREFS, ifcOverlay } from './store';
import type { IfcPrefs } from './store';
import { IFC_CALIBRATION, worldMatrix } from './transform';
import type { ParsedIfc } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const box = (h0: number, h1: number) => ({
  positions: new Float32Array([0, 0, h0, 1, 0, h0, 1, 1, h0, 0, 1, h0, 0, 0, h1, 1, 0, h1, 1, 1, h1, 0, 1, h1]),
  indices: new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]),
});

const MODEL: ParsedIfc = {
  version: PARSER_VERSION,
  fileName: 'SIBSAS hytte v01.ifc',
  fileSize: 1912843,
  schema: 'IFC4',
  meshes: [
    { kind: 'wall', ...box(0, 2.5) },
    { kind: 'window', ...box(0.8, 2) },
    { kind: 'roof', ...box(2.5, 4) },
    { kind: 'slab', ...box(-0.2, 0) },
  ],
  sections: [
    { storey: 'ground', kind: 'wall', planH: 0.9, segments: new Float32Array([0, 0, 1, 0, 1, 0, 1, 1]) },
    { storey: 'ground', kind: 'window', planH: 0.9, segments: new Float32Array([0.2, 0, 0.8, 0]) },
    { storey: 'loft', kind: 'wall', planH: 2.1, segments: new Float32Array([0, 0, 1, 0]) },
  ],
  counts: { wall: 1, window: 1, door: 0, roof: 1, slab: 1, other: 0 },
  min: [0, 0, -0.2],
  max: [1, 1, 4],
};

function setOverlay(model: ParsedIfc | null, prefs: Partial<IfcPrefs> = {}) {
  ifcOverlay.setState({ status: model ? 'ready' : 'idle', error: null, model, prefs: { ...DEFAULT_IFC_PREFS, key: model ? 'k|1' : null, ...prefs } });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setOverlay(null);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('IfcLayer (plan)', () => {
  const render = (storey: 'ground' | 'loft' = 'ground') =>
    act(() =>
      root.render(
        <svg>
          <IfcLayer storey={storey} />
        </svg>,
      ),
    );
  const layer = () => container.querySelector('g[data-layer="ifc"]');

  it('draws nothing until a model is loaded and «Vis i planen» is on', () => {
    render();
    expect(layer()).toBeNull();
    act(() => setOverlay(MODEL, { showPlan: false }));
    expect(layer()).toBeNull();
    act(() => ifcOverlay.setPrefs({ showPlan: true }));
    expect(layer()).not.toBeNull();
  });

  it('draws the storey’s sections in blue under the calibrated, nudged transform, without pointer events', () => {
    setOverlay(MODEL, { opacity: 0.5 });
    render();
    const g = layer()!;
    expect(g.getAttribute('transform')).toBe('matrix(1 0 0 1 4.71 1.79)');
    expect(g.getAttribute('pointer-events')).toBe('none');
    expect(g.getAttribute('opacity')).toBe('0.5');
    expect(g.querySelector('[data-ifc="wall"]')!.getAttribute('d')).toBe('M0 0L1 0M1 0L1 1');
    expect(g.querySelector('[data-ifc="window"]')!.getAttribute('d')).toBe('M0.2 0L0.8 0');
    expect(g.querySelector('[data-ifc="door"]')).toBeNull();
    act(() => ifcOverlay.nudge(2, -1));
    expect(layer()!.getAttribute('transform')).toBe('matrix(1 0 0 1 4.73 1.78)');
    render('loft');
    expect(layer()!.querySelector('[data-ifc="wall"]')!.getAttribute('d')).toBe('M0 0L1 0');
    expect(layer()!.querySelector('[data-ifc="window"]')).toBeNull();
  });
});

describe('IfcPanel', () => {
  const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  /** The panel's body is a lazy chunk: wait until it is there. */
  const render = async () => {
    act(() => root.render(<IfcPanel defaultOpen />));
    for (let i = 0; i < 100 && !$('ifc-file-input'); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
    }
  };

  it('offers «Last inn IFC-fil» and hands the picked file to the store', async () => {
    await render();
    expect(container.textContent).toContain(nb.ifc.heading);
    expect(container.textContent).toContain(nb.ifc.intro);
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    act(() => $('ifc-load')!.click());
    expect(click).toHaveBeenCalledTimes(1);
    const load = vi.spyOn(ifcOverlay, 'loadFile').mockResolvedValue();
    const input = $('ifc-file-input') as HTMLInputElement;
    const file = new File(['ISO-10303-21;'], 'hytta.ifc');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(load).toHaveBeenCalledWith(file);
  });

  it('shows loading and errors', async () => {
    await render();
    act(() => ifcOverlay.setState({ status: 'loading' }));
    expect($('ifc-status')!.textContent).toBe(nb.ifc.loading);
    expect(($('ifc-load') as HTMLButtonElement).disabled).toBe(true);
    act(() => ifcOverlay.setState({ status: 'error', error: nb.ifc.notIfc }));
    expect($('ifc-error')!.textContent).toBe(nb.ifc.notIfc);
  });

  it('switches the views and the 3D groups, sets the opacity and nudges within ±10 cm', async () => {
    setOverlay(MODEL);
    await render();
    expect($('ifc-file')!.textContent).toBe('SIBSAS hytte v01.ifc · 1,8 MB');
    act(() => $('ifc-show-plan')!.click());
    expect(ifcOverlay.getState().prefs.showPlan).toBe(false);
    act(() => $('ifc-roof-3d')!.click());
    expect(ifcOverlay.getState().prefs.roof3d).toBe(false);
    act(() => $('ifc-show-3d')!.click());
    expect(ifcOverlay.getState().prefs.show3d).toBe(false);
    expect($('ifc-walls-3d')).toBeNull();

    expect(($('ifc-nudge-reset') as HTMLButtonElement).disabled).toBe(true);
    act(() => $('ifc-nudge-right')!.click());
    act(() => $('ifc-nudge-down')!.click());
    expect(ifcOverlay.getState().prefs.nudge).toEqual({ dx: 0.01, dy: -0.01 });
    expect($('ifc-nudge-value')!.textContent).toBe('x +0,01 m · y −0,01 m');
    for (let i = 0; i < 12; i++) act(() => $('ifc-nudge-right')!.click());
    expect(ifcOverlay.getState().prefs.nudge.dx).toBe(0.1);
    expect(($('ifc-nudge-right') as HTMLButtonElement).disabled).toBe(true);
    act(() => $('ifc-nudge-reset')!.click());
    expect(ifcOverlay.getState().prefs.nudge).toEqual({ dx: 0, dy: 0 });
  });

  it('«Fjern» removes the model', async () => {
    setOverlay(MODEL);
    await render();
    const remove = vi.spyOn(ifcOverlay, 'remove').mockImplementation(async () => setOverlay(null));
    act(() => $('ifc-remove')!.click());
    expect(remove).toHaveBeenCalledTimes(1);
    expect($('ifc-load')).not.toBeNull();
  });
});

describe('IfcOverlay (3D)', () => {
  let r3f: ReconcilerRoot<HTMLCanvasElement> | null = null;
  let canvas: HTMLCanvasElement;
  const gl = { localClippingEnabled: false };

  beforeAll(() => {
    extend(THREE as unknown as Parameters<typeof extend>[0]);
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  });

  afterEach(async () => {
    if (r3f) await r3fAct(async () => r3f!.unmount());
    r3f = null;
  });

  async function mount3d(props: { mode: 'ute' | 'inne'; activeStoreyId?: string }) {
    canvas = document.createElement('canvas');
    container.appendChild(canvas);
    gl.localClippingEnabled = false;
    const renderer = {
      domElement: canvas,
      render: () => {},
      setPixelRatio: () => {},
      getPixelRatio: () => 1,
      setSize: () => {},
      shadowMap: { enabled: false, type: 0, needsUpdate: false },
      outputColorSpace: 'srgb',
      toneMapping: 0,
      dispose: () => {},
      get localClippingEnabled() {
        return gl.localClippingEnabled;
      },
      set localClippingEnabled(v: boolean) {
        gl.localClippingEnabled = v;
      },
    };
    r3f = createR3fRoot(canvas);
    await r3fAct(async () => {
      await r3f!.configure({ gl: renderer as never, size: { width: 400, height: 300, top: 0, left: 0 }, frameloop: 'never' });
      r3f!.render(<IfcOverlay derived={FIXTURE_DERIVED} mode={props.mode} cutHeight={1.3} activeStoreyId={props.activeStoreyId ?? 'ground'} />);
    });
  }
  const overlay = () => _roots.get(canvas)!.store.getState().scene.getObjectByName('ifc-overlay') ?? null;
  const kinds = () => overlay()!.children.map((c: Object3D) => c.name);

  it('shows the meshes with edges under the calibrated matrix, and follows the 3D switches', async () => {
    await mount3d({ mode: 'ute' });
    expect(overlay()).toBeNull();
    await r3fAct(async () => setOverlay(MODEL));
    const g = overlay()!;
    expect(g.matrixAutoUpdate).toBe(false);
    const want = new THREE.Matrix4().set(...(worldMatrix(IFC_CALIBRATION) as Parameters<THREE.Matrix4['set']>));
    expect(g.matrix.equals(want)).toBe(true);
    expect(kinds()).toEqual(['ifc-wall', 'ifc-window', 'ifc-roof', 'ifc-slab']);
    const mesh = g.children[0].children[0] as Mesh;
    const material = mesh.material as THREE.MeshLambertMaterial;
    expect(material.transparent && !material.depthWrite).toBe(true);
    expect(material.opacity).toBeCloseTo(DEFAULT_IFC_PREFS.opacity * 0.45, 9);
    expect((g.children[0].children[1] as THREE.LineSegments).geometry).toBeInstanceOf(THREE.EdgesGeometry);
    expect(material.clippingPlanes ?? []).toEqual([]);

    await r3fAct(async () => ifcOverlay.setPrefs({ roof3d: false, slabs3d: false }));
    expect(kinds()).toEqual(['ifc-wall', 'ifc-window']);
    await r3fAct(async () => ifcOverlay.nudge(0, 3));
    expect(overlay()!.matrix.elements[14]).toBeCloseTo(-(IFC_CALIBRATION.dy + 0.03), 9);
    await r3fAct(async () => ifcOverlay.setPrefs({ show3d: false }));
    expect(overlay()).toBeNull();
  });

  it('interior mode: no roof, clipped at the active storey’s floor + the cut height', async () => {
    setOverlay(MODEL);
    await mount3d({ mode: 'inne', activeStoreyId: 'ground' });
    expect(kinds()).toEqual(['ifc-wall', 'ifc-window', 'ifc-slab']);
    const edges = overlay()!.children[0].children[1] as THREE.LineSegments;
    const planes = (edges.material as LineBasicMaterial).clippingPlanes!;
    expect(planes).toHaveLength(1);
    // keeps world Y ≤ 1.3 (the main floor 0 + 1.3)
    expect(planes[0].distanceToPoint(new THREE.Vector3(0, 1.2, 0))).toBeGreaterThan(0);
    expect(planes[0].distanceToPoint(new THREE.Vector3(0, 1.4, 0))).toBeLessThan(0);
    expect(gl.localClippingEnabled).toBe(true);
  });
});
