// @vitest-environment jsdom
/**
 * The plan's second fix round after phase 2a, on the real seed with the real edit API:
 *  - a tap on a placed unit selects the unit (Roter 90° · Slett, body drag), the next tap its room;
 *  - render cost of drags: a wall drag re-renders only the layers whose data changed, and in the opening layer only
 *    the openings that moved (the layers are counted through vi.mock wrappers around the real components).
 */
import { act, memo } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import type { Vec2 } from '../model/types';
import * as A from '../state/editActions';
import { createAppStore } from '../state/store';
import { deriveForState } from '../state/useDerived';
import type { PlanSelection } from './editTypes';
import { PlanView } from './PlanView';
import { svgElementAt } from './svgHitTest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Renders per layer (and `openingFrame` calls, one per drawn opening and symbol) since the last reset. */
const counts = vi.hoisted(() => ({ layers: {} as Record<string, number>, openingFrame: 0 }));

/** Wrap a memoised layer so its renders are counted (the real component still renders). */
function counted(name: string, layer: unknown) {
  const inner = (layer as { type: (props: object) => ReactElement | null }).type;
  return memo((props: object) => {
    counts.layers[name] = (counts.layers[name] ?? 0) + 1;
    return inner(props);
  });
}

vi.mock('./layers/WallLayer', async (orig) => {
  const m = await orig<typeof import('./layers/WallLayer')>();
  return { ...m, WallLayer: counted('walls', m.WallLayer) };
});
vi.mock('./layers/OpeningLayer', async (orig) => {
  const m = await orig<typeof import('./layers/OpeningLayer')>();
  return { ...m, OpeningLayer: counted('openings', m.OpeningLayer) };
});
vi.mock('./layers/StructureLayer', async (orig) => {
  const m = await orig<typeof import('./layers/StructureLayer')>();
  return { ...m, StructureLayer: counted('structure', m.StructureLayer) };
});
vi.mock('./layers/DimensionLayer', async (orig) => {
  const m = await orig<typeof import('./layers/DimensionLayer')>();
  return { ...m, DimensionLayer: counted('dimensions', m.DimensionLayer) };
});
vi.mock('./layers/OutdoorLayer', async (orig) => {
  const m = await orig<typeof import('./layers/OutdoorLayer')>();
  return { ...m, OutdoorLayer: counted('outdoor', m.OutdoorLayer) };
});
vi.mock('./layers/RailingLayer', async (orig) => {
  const m = await orig<typeof import('./layers/RailingLayer')>();
  return { ...m, RailingLayer: counted('railings', m.RailingLayer) };
});
vi.mock('./layers/FurnitureLayer', async (orig) => {
  const m = await orig<typeof import('./layers/FurnitureLayer')>();
  return { ...m, FurnitureLayer: counted('furniture', m.FurnitureLayer) };
});
vi.mock('./layers/BlockLayer', async (orig) => {
  const m = await orig<typeof import('./layers/BlockLayer')>();
  return { ...m, BlockLayer: counted('blocks', m.BlockLayer) };
});
vi.mock('./layers/GhostLayer', async (orig) => {
  const m = await orig<typeof import('./layers/GhostLayer')>();
  return { ...m, GhostLayer: counted('ghosts', m.GhostLayer) };
});
vi.mock('./layers/OtherStoreyLayer', async (orig) => {
  const m = await orig<typeof import('./layers/OtherStoreyLayer')>();
  return { ...m, OtherStoreyLayer: counted('otherStoreys', m.OtherStoreyLayer) };
});
vi.mock('./layers/RoomLayer', async (orig) => {
  const m = await orig<typeof import('./layers/RoomLayer')>();
  return { ...m, RoomLayer: counted('rooms', m.RoomLayer) };
});
vi.mock('./svg', async (orig) => {
  const m = await orig<typeof import('./svg')>();
  return {
    ...m,
    openingFrame: (...args: Parameters<typeof m.openingFrame>) => {
      counts.openingFrame++;
      return m.openingFrame(...args);
    },
  };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function proposal() {
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  store.getState().clearHistory();
  return store;
}

type Store = ReturnType<typeof proposal>;

function rootMatrix(svg: SVGSVGElement): number[] {
  const t = svg.querySelector('[data-plan-root]')!.getAttribute('transform')!;
  return /^matrix\(([^)]+)\)$/.exec(t)![1].split(' ').map(Number);
}

function scr(svg: SVGSVGElement, p: Vec2): Vec2 {
  const [s, , , , tx, ty] = rootMatrix(svg);
  return [s * p[0] + tx, -s * p[1] + ty];
}

function pointer(el: Element, type: string, at: Vec2, pointerType = 'touch') {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: at[0], clientY: at[1], pointerId: 1, button: 0, pointerType, isPrimary: true }));
}

/** The editable plan of the store's active proposal; the selection is kept like the app does. */
function mount(store: Store, selection: { current: PlanSelection | null }) {
  const actions = A.bindEditActions(store);
  const draw = () =>
    act(() =>
      root.render(
        <PlanView
          derived={deriveForState(store.getState())}
          site={store.getState().project.site}
          planStorey="ground"
          selection={selection.current as never}
          onSelect={(s) => {
            selection.current = s as PlanSelection | null;
          }}
          showLabels
          showDims
          showGrid
          showRoofPlan={false}
          highlightNew
          editable
          editActions={actions as never}
          coarsePointer
        />,
      ),
    );
  draw();
  return { draw, svg: () => container.querySelector<SVGSVGElement>('svg[data-testid="plan-view"]')! };
}

/** A tap (touch) at a plan point on whatever the plan draws there. */
function tap(svg: SVGSVGElement, p: Vec2) {
  const at = scr(svg, p);
  const el = svgElementAt(svg, at) ?? svg;
  act(() => {
    pointer(el, 'pointerdown', at);
    pointer(el, 'pointerup', at);
  });
}

describe('a placed unit: the first tap selects the unit, the next its room', () => {
  it('Vedskjul: tap → block (Roter 90° · Slett), tap again → its room, again → the block; a body drag moves it', () => {
    const store = proposal();
    const id = A.placeUnit(store, 'vedskjul', [14, 11.35], 0)!;
    expect(id).toBeTruthy();
    const sel = { current: null as PlanSelection | null };
    const plan = mount(store, sel);
    const roomId = deriveForState(store.getState()).rooms.find((r) => r.blockId === id)!.id;
    tap(plan.svg(), [14, 11.35]);
    expect(sel.current).toEqual({ kind: 'block', id });
    plan.draw();
    tap(plan.svg(), [14, 11.35]);
    expect(sel.current).toMatchObject({ kind: 'room', id: roomId });
    plan.draw();
    tap(plan.svg(), [14, 11.35]);
    expect(sel.current).toEqual({ kind: 'block', id });
    plan.draw();
    // The selected unit drags by its body (1 m west at the plan's zoom).
    const svg = plan.svg();
    const s = rootMatrix(svg)[0];
    const at = scr(svg, [14, 11.35]);
    const x0 = Math.min(...deriveForState(store.getState()).blocks.find((b) => b.block.id === id)!.block.polygon.map((v) => v.p[0]));
    act(() => {
      const el = svgElementAt(svg, at)!;
      pointer(el, 'pointerdown', at);
      for (let i = 1; i <= 10; i++) pointer(svg, 'pointermove', [at[0] - (s * i) / 10, at[1]]);
      pointer(svg, 'pointerup', [at[0] - s, at[1]]);
    });
    const x1 = Math.min(...deriveForState(store.getState()).blocks.find((b) => b.block.id === id)!.block.polygon.map((v) => v.p[0]));
    expect(x1 - x0).toBeCloseTo(-1, 1);
  });

  it('rooms of the cabin and of blocks without a template are selected on the first tap as before', () => {
    const store = proposal();
    const sel = { current: null as PlanSelection | null };
    const plan = mount(store, sel);
    const stue = deriveForState(store.getState()).rooms.find((r) => r.room?.name === 'Stue')!;
    tap(plan.svg(), stue.labelPoint);
    expect(sel.current).toMatchObject({ kind: 'room', id: stue.id });
  });
});

describe('render cost: a wall drag re-renders only what changed', () => {
  it('w-gang-n dragged: walls, openings and rooms re-render; structure, dimensions, outdoor, furniture, blocks do not', () => {
    const store = proposal();
    const sel = { current: { kind: 'wall', id: 'w-gang-n', levelId: 'main' } as PlanSelection | null };
    const plan = mount(store, sel);
    const session = A.beginDrag(store, { kind: 'wall', id: 'w-gang-n' }, [18, 3.4], undefined, { snapRadiusM: 0.5 });
    const frames: DerivedVariant[] = [];
    for (let i = 1; i <= 3; i++) {
      // South, into the corridor: north it would run into the bedroom's nightstand (the seed is furnished, revision 6)
      // and the furniture would legitimately re-render.
      A.updateDrag(store, session, [18, 3.4 - 0.1 * i], { snapRadiusM: 0.5 });
      counts.layers = {};
      counts.openingFrame = 0;
      plan.draw();
      frames.push(deriveForState(store.getState()));
      expect(counts.layers.walls ?? 0).toBe(1);
      expect(counts.layers.openings ?? 0).toBe(1);
      expect(counts.layers.rooms ?? 0).toBe(1);
      for (const still of ['structure', 'dimensions', 'outdoor', 'railings', 'furniture', 'blocks', 'ghosts', 'otherStoreys']) {
        expect(counts.layers[still] ?? 0, still).toBe(0);
      }
      // Only the door in w-gang-n (d-sov-ny) is drawn again: before, all 45 openings were (≥ 45 openingFrame calls).
      expect(counts.openingFrame).toBeGreaterThan(0);
      expect(counts.openingFrame).toBeLessThanOrEqual(4);
    }
    A.endDrag(store, session);
    expect(new Set(frames).size).toBe(3);
  });
});
