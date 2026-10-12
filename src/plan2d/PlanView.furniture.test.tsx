// @vitest-environment jsdom
/**
 * The plan's furniture hand-off (phase 2b; PlanView.tsx, furnitureDrop.ts, FurnitureLayer.tsx): the layer order
 * (furniture hit areas above the room-label hit areas, below walls and openings), the library's drag preview and
 * drop through DOM events, the visible-centre answer, the Møbler tool acting as Velg while no item is armed, and the
 * rotate handle of the selected item.
 */
import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedFurniture, DerivedVariant } from '../model/derived';
import { catalogItem } from '../furniture/catalog';
import type { Vec2 } from '../model/types';
import { createPlanFixture, createPlanFixtureSite } from './fixture';
import { FURNITURE_DRAG_EVENT, dispatchFurnitureDrag, dispatchFurnitureDrop, requestPlanCentre } from './furnitureDrop';
import { rectFootprint } from './furniturePlacement';
import { PlanView } from './PlanView';
import { svgElementAt } from './svgHitTest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof PlanView>;

let container: HTMLDivElement;
let root: Root;
let elementAt: Element | null = null;
const realElementFromPoint = document.elementFromPoint;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom has no layout: the "element under the pointer" is whatever the test says.
  document.elementFromPoint = () => elementAt;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.elementFromPoint = realElementFromPoint;
  elementAt = null;
});

function bed(): DerivedFurniture {
  const position: Vec2 = [12, 2];
  const size = { w: 1.5, d: 2, h: 0.5 };
  return {
    id: 'f-seng',
    item: { id: 'f-seng', catalogId: 'seng-150', position, rotationDeg: 0, levelId: 'main', size, isNew: true },
    catalog: catalogItem('seng-150') ?? null,
    footprint: rectFootprint(position, 0, size.w, size.d),
    bbox: { min: [11.25, 1], max: [12.75, 3] },
    levelId: 'main',
    roomId: 'rom-soverom',
    floorZ: 0,
    z: 0,
    clearances: [],
    collisions: [],
    blocksDoors: [],
    needsDrain: false,
    isNew: true,
  };
}

function withBed(): DerivedVariant {
  return { ...createPlanFixture(), furniture: [bed()] };
}

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    derived: withBed(),
    site: createPlanFixtureSite(),
    planStorey: 'ground',
    selection: null,
    onSelect: () => {},
    showLabels: true,
    showDims: false,
    showGrid: false,
    showRoofPlan: false,
    highlightNew: false,
    ...overrides,
  };
}

function render(props: Props) {
  act(() => root.render(<PlanView {...props} />));
  return container.querySelector<SVGSVGElement>('svg[data-testid="plan-view"]')!;
}

function rootMatrix(svg: SVGSVGElement): number[] {
  const t = svg.querySelector('[data-plan-root]')!.getAttribute('transform')!;
  return /^matrix\(([^)]+)\)$/.exec(t)![1].split(' ').map(Number);
}

function scr(svg: SVGSVGElement, p: Vec2): Vec2 {
  const [s, , , , tx, ty] = rootMatrix(svg);
  return [s * p[0] + tx, -s * p[1] + ty];
}

function pointer(el: Element, type: string, at: Vec2) {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: at[0], clientY: at[1], pointerId: 1, button: 0, pointerType: 'mouse', isPrimary: true }));
}

function tapAt(el: Element, at: Vec2) {
  act(() => {
    pointer(el, 'pointerdown', at);
    pointer(el, 'pointerup', at);
  });
}

const editActions = () => ({
  beginDrag: vi.fn(() => ({ id: 's' })),
  updateDrag: vi.fn(() => ({ indicators: [], chips: [], ghost: [] })),
  endDrag: vi.fn(),
  cancelDrag: vi.fn(),
  rotateFurniture: vi.fn(() => true),
});

describe('layer order', () => {
  it('draws the furniture above the room-label hit areas and below the walls and openings', () => {
    const svg = render(baseProps());
    const layers = [...svg.querySelectorAll('[data-plan-root] > *')];
    const at = (pred: (e: Element) => boolean) => layers.findIndex(pred);
    const furniture = at((e) => e.getAttribute('data-layer') === 'furniture');
    const labelHits = at((e) => !!e.querySelector('[data-room-label-hit]') || e.getAttribute('data-layer') === 'label-hits');
    const walls = at((e) => !!e.querySelector('[data-wall-id]'));
    expect(furniture).toBeGreaterThan(-1);
    expect(walls).toBeGreaterThan(furniture);
    expect(labelHits).toBeGreaterThan(-1);
    expect(furniture).toBeGreaterThan(labelHits);
  });
});

describe('library hand-off', () => {
  it('a drag over the plan shows where the item lands; leaving the plan or ending the drag hides it', () => {
    const svg = render(baseProps({ editable: true, editActions: editActions() }));
    elementAt = svg.querySelector('[data-plan-paper]');
    const p = scr(svg, [2, 2]);
    let over = false;
    act(() => {
      over = dispatchFurnitureDrag('toalett', p[0], p[1]);
    });
    expect(over).toBe(true);
    const ghost = svg.querySelector('[data-furniture-ghost="toalett"]');
    expect(ghost).not.toBeNull();
    // Over something that is not the plan: no ghost, not accepted.
    elementAt = document.body;
    act(() => {
      over = dispatchFurnitureDrag('toalett', 5000, 5000);
    });
    expect(over).toBe(false);
    expect(svg.querySelector('[data-furniture-ghost]')).toBeNull();
    elementAt = svg.querySelector('[data-plan-paper]');
    act(() => void dispatchFurnitureDrag('toalett', p[0], p[1]));
    expect(svg.querySelector('[data-furniture-ghost]')).not.toBeNull();
    act(() => void dispatchFurnitureDrag(null, 0, 0));
    expect(svg.querySelector('[data-furniture-ghost]')).toBeNull();
  });

  it('shows no ghost on a plan that cannot be edited, but still answers that it is under the pointer', () => {
    const svg = render(baseProps({ editable: false }));
    elementAt = svg.querySelector('[data-plan-paper]');
    const p = scr(svg, [2, 2]);
    let over = false;
    act(() => {
      over = dispatchFurnitureDrag('toalett', p[0], p[1]);
    });
    expect(over).toBe(true);
    expect(svg.querySelector('[data-furniture-ghost]')).toBeNull();
  });

  it('a release over the plan hands the item and the plan point to onDropFurniture', () => {
    const onDropFurniture = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: editActions(), onDropFurniture }));
    elementAt = svg.querySelector('[data-plan-paper]');
    const p = scr(svg, [3, 4]);
    act(() => void dispatchFurnitureDrag('seng-90', p[0], p[1]));
    let ok = false;
    act(() => {
      ok = dispatchFurnitureDrop(p[0], p[1], 'seng-90');
    });
    expect(ok).toBe(true);
    expect(onDropFurniture).toHaveBeenCalledTimes(1);
    const [id, at] = onDropFurniture.mock.calls[0] as [string, Vec2];
    expect(id).toBe('seng-90');
    expect(at[0]).toBeCloseTo(3, 6);
    expect(at[1]).toBeCloseTo(4, 6);
    expect(svg.querySelector('[data-furniture-ghost]')).toBeNull();
    // Released elsewhere: not taken.
    elementAt = document.body;
    act(() => {
      ok = dispatchFurnitureDrop(5000, 5000, 'seng-90');
    });
    expect(ok).toBe(false);
    expect(onDropFurniture).toHaveBeenCalledTimes(1);
  });

  it('answers the library with the middle of the visible plan, its storey and zoom', () => {
    const svg = render(baseProps());
    const c = requestPlanCentre();
    expect(c).not.toBeNull();
    const [s] = rootMatrix(svg);
    expect(c!.scale).toBeCloseTo(s, 9);
    expect(c!.storeyId).toBe('ground');
    const mid = scr(svg, c!.centre!);
    expect(mid[0]).toBeCloseTo(500, 6); // jsdom fallback viewport 1000 × 700
    expect(mid[1]).toBeCloseTo(350, 6);
    act(() => root.render(<div />));
    expect(requestPlanCentre()).toBeNull();
  });

  it('drag events of other shapes are ignored', () => {
    render(baseProps({ editable: true, editActions: editActions() }));
    act(() => void document.dispatchEvent(new CustomEvent(FURNITURE_DRAG_EVENT, { detail: { catalogId: 5 } })));
    expect(container.querySelector('[data-furniture-ghost]')).toBeNull();
  });
});

describe('the Møbler tool and the rotate handle', () => {
  it('with no item armed, Møbler behaves like Velg: a tap selects an item, the selected item can be dragged', () => {
    const onSelect = vi.fn();
    const actions = editActions();
    let svg = render(baseProps({ editable: true, editActions: actions, tool: 'furniture', onSelect }));
    expect(svg.getAttribute('data-plan-tool')).toBe('select');
    tapAt(svg.querySelector('[data-furniture-id="f-seng"] path')!, scr(svg, [12, 2]));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'furniture', id: 'f-seng', levelId: 'main' });
    svg = render(baseProps({ editable: true, editActions: actions, tool: 'furniture', selection: { kind: 'furniture', id: 'f-seng', levelId: 'main' } }));
    const at = scr(svg, [12, 2]);
    act(() => {
      pointer(svg.querySelector('[data-furniture-id="f-seng"] path')!, 'pointerdown', at);
      pointer(svg, 'pointermove', [at[0] + 30, at[1]]);
      pointer(svg, 'pointerup', [at[0] + 30, at[1]]);
    });
    expect(actions.beginDrag).toHaveBeenCalled();
    // With an item armed it stays the placement tool.
    svg = render(baseProps({ editable: true, editActions: actions, tool: 'furniture', toolOptions: { furnitureItem: 'stol' } }));
    expect(svg.getAttribute('data-plan-tool')).toBe('furniture');
  });

  it('a second tap on the selected item selects the room under it (cycleFurnitureRoom)', () => {
    const onSelect = vi.fn();
    const sel = { kind: 'furniture' as const, id: 'f-seng', levelId: 'main' };
    const svg = render(baseProps({ editable: true, editActions: editActions(), selection: sel, onSelect }));
    tapAt(svg.querySelector('[data-furniture-id="f-seng"] path')!, scr(svg, [12, 2]));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'room', id: 'rom-soverom', levelId: 'main' });
  });

  it('the selected item gets a rotate handle while editing; a tap on it calls rotateFurniture(id, 90)', () => {
    const actions = editActions();
    const sel = { kind: 'furniture' as const, id: 'f-seng', levelId: 'main' };
    let svg = render(baseProps({ editable: true, editActions: actions, selection: sel }));
    const handle = svg.querySelector('[data-furniture-rotate="f-seng"]')!;
    expect(handle).not.toBeNull();
    const c = handle.querySelector('circle[fill="#ffffff"]')!;
    const at = scr(svg, [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]);
    tapAt(handle, at);
    expect(actions.rotateFurniture).toHaveBeenCalledWith('f-seng', 90);
    expect(actions.beginDrag).not.toHaveBeenCalled();
    // Not on the locked base / read-only plan, not for other kinds, not without the action.
    svg = render(baseProps({ editable: false, editActions: actions, selection: sel }));
    expect(svg.querySelector('[data-furniture-rotate]')).toBeNull();
    const { rotateFurniture: _gone, ...noRotate } = actions;
    void _gone;
    svg = render(baseProps({ editable: true, editActions: noRotate, selection: sel }));
    expect(svg.querySelector('[data-furniture-rotate]')).toBeNull();
    svg = render(baseProps({ editable: true, editActions: actions, selection: { kind: 'room', id: 'rom-soverom' } }));
    expect(svg.querySelector('[data-furniture-rotate]')).toBeNull();
  });

  it("the rotate handle never covers a small item's body (a toilet stays draggable from its middle)", () => {
    const position: Vec2 = [12, 2];
    const size = { w: 0.4, d: 0.65, h: 0.8 };
    const wc: DerivedFurniture = {
      ...bed(),
      id: 'f-wc',
      item: { id: 'f-wc', catalogId: 'toalett', position, rotationDeg: 270, levelId: 'main', size, isNew: true },
      catalog: catalogItem('toalett') ?? null,
      footprint: rectFootprint(position, 270, size.w, size.d),
      bbox: { min: [11.675, 1.8], max: [12.325, 2.2] },
    };
    const svg = render(baseProps({ derived: { ...createPlanFixture(), furniture: [wc] }, editable: true, editActions: editActions(), selection: { kind: 'furniture', id: 'f-wc', levelId: 'main' } }));
    expect(svg.querySelector('[data-furniture-rotate="f-wc"]')).not.toBeNull();
    const hit = svgElementAt(svg, scr(svg, position));
    expect(hit?.closest('[data-furniture-rotate]')).toBeNull();
    expect(hit?.closest('[data-furniture-id="f-wc"]')).not.toBeNull();
  });

  it('room names keep clear of the furniture where they fit', () => {
    const labelAt = (svg: SVGSVGElement): number[] => {
      const hit = svg.querySelector('[data-room-label-hit="rom-soverom"]')!;
      expect(hit).not.toBeNull();
      return /translate\(([^ ]+) ([^)]+)\)/.exec(hit.parentElement!.getAttribute('transform')!)!.slice(1, 3).map(Number);
    };
    const inBed = (t: number[]) => t[0] >= 11.25 && t[0] <= 12.75 && t[1] >= 1 && t[1] <= 3;
    // Without the bed the name sits where the bed will stand …
    expect(inBed(labelAt(render(baseProps({ derived: createPlanFixture() }))))).toBe(true);
    // … with it, beside it.
    expect(inBed(labelAt(render(baseProps())))).toBe(false);
  });
});
