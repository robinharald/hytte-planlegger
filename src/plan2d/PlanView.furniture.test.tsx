// @vitest-environment jsdom
/**
 * The plan's furniture hand-off (phase 2b; PlanView.tsx, furnitureDrop.ts, FurnitureLayer.tsx): the layer order
 * (furniture hit areas above the room-label hit areas, below walls and openings), the library's drag preview and
 * drop through DOM events, the visible-centre answer, the Møbler tool acting as Velg while no item is armed, and the
 * rotate handle of the selected item. Fix round: the handle never covers other things (a click on the table under a
 * chair's handle selects the table; on touch it is hidden at the phone's starting zoom), a pinch with one finger on
 * it zooms, and a library tap with nothing selected places in the part of the plan the user sees, in a room.
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
import { rectFootprint, roomAt } from './furniturePlacement';
import { placeFurniture } from '../ui/furniturePlacer';
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

// ---------------------------------------------------------------------------
// Fix round after the phase-2b review: the rotate handle never covers other things, a pinch with a finger on it
// zooms, and a library tap with nothing selected lands in the part of the plan the user sees.
// ---------------------------------------------------------------------------

/** A derived item of the plan fixture (no collisions; `roomId` as given). */
function furnitureItem(id: string, catalogId: string, position: Vec2, rotationDeg: number, size: { w: number; d: number; h: number }, roomId?: string): DerivedFurniture {
  const footprint = rectFootprint(position, rotationDeg, size.w, size.d);
  const xs = footprint.map((p) => p[0]);
  const ys = footprint.map((p) => p[1]);
  return {
    id,
    item: { id, catalogId, position, rotationDeg, levelId: 'main', size, isNew: true },
    catalog: catalogItem(catalogId) ?? null,
    footprint,
    bbox: { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] },
    levelId: 'main',
    ...(roomId ? { roomId } : {}),
    floorZ: 0,
    z: 0,
    clearances: [],
    collisions: [],
    blocksDoors: [],
    needsDrain: false,
    isNew: true,
  };
}

/** Pointer events of any type and id (touch by default). */
function finger(el: Element, type: string, at: Vec2, pointerId: number, pointerType = 'touch') {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: at[0], clientY: at[1], pointerId, button: 0, pointerType, isPrimary: pointerId === 1 }));
}

describe('the rotate handle never covers other things', () => {
  // As the seed's Spiseplass: a 2.6 × 1.0 table, a chair 0.125 m south of it facing it (its handle lies on the table).
  const table = furnitureItem('f-table', 'spisebord-8', [5.5, 3.0], 0, { w: 2.6, d: 1.0, h: 0.74 }, 'rom-kjokken');
  const chair = furnitureItem('f-chair', 'stol', [4.7, 2.15], 180, { w: 0.45, d: 0.45, h: 0.85 }, 'rom-kjokken');
  const dining = (): DerivedVariant => ({ ...createPlanFixture(), furniture: [bed(), table, chair] });
  /** The browser's hit test (jsdom has none): the topmost element of the plan under a client point. */
  const hitTest = (svg: SVGSVGElement) => {
    document.elementFromPoint = (x: number, y: number) => svgElementAt(svg, [x, y]);
  };

  it('with the dining chair selected, a click on the table where the handle is drawn selects the table (no turn)', () => {
    const onSelect = vi.fn();
    const actions = editActions();
    const svg = render(baseProps({ derived: dining(), editable: true, editActions: actions, selection: { kind: 'furniture', id: 'f-chair', levelId: 'main' }, onSelect }));
    hitTest(svg);
    const handle = svg.querySelector('[data-furniture-rotate="f-chair"]')!;
    expect(handle).not.toBeNull();
    const c = handle.querySelector('circle')!;
    const at = scr(svg, [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]);
    // The handle's middle lies on the table, and the handle is what a click there hits.
    const [px, py] = [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))];
    expect(px > 4.2 && px < 6.8 && py > 2.5 && py < 3.5).toBe(true);
    const target = svgElementAt(svg, at)!;
    expect(target.closest('[data-furniture-rotate]')).not.toBeNull();
    act(() => {
      pointer(target, 'pointerdown', at);
      pointer(svg, 'pointerup', at);
    });
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'furniture', id: 'f-table', levelId: 'main' });
    expect(actions.rotateFurniture).not.toHaveBeenCalled();
    expect(actions.beginDrag).not.toHaveBeenCalled();
  });

  it('a click on a rug under the handle (its middle, which belongs to the room) does what it does without the handle', () => {
    const onSelect = vi.fn();
    const actions = editActions();
    // A rug in front of the bed, under its handle (the handle's middle 7.5 px inside the rug's edge).
    const rug = furnitureItem('f-rug', 'teppe', [12, 0.55], 0, { w: 1.6, d: 0.7, h: 0.01 }, 'rom-soverom');
    const svg = render(baseProps({ derived: { ...createPlanFixture(), furniture: [rug, bed()] }, editable: true, editActions: actions, selection: { kind: 'furniture', id: 'f-seng', levelId: 'main' }, onSelect }));
    hitTest(svg);
    const c = svg.querySelector('[data-furniture-rotate="f-seng"] circle')!;
    const at = scr(svg, [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]);
    expect(svgElementAt(svg, at)!.closest('[data-furniture-rotate]')).not.toBeNull();
    act(() => {
      pointer(svgElementAt(svg, at)!, 'pointerdown', at);
      pointer(svg, 'pointerup', at);
    });
    expect(actions.rotateFurniture).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'room', id: 'rom-soverom' }));
  });

  it('over the floor the handle still turns the item, and the plan neither selects nor pans', () => {
    const onSelect = vi.fn();
    const actions = editActions();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: { kind: 'furniture', id: 'f-seng', levelId: 'main' }, onSelect }));
    hitTest(svg);
    const c = svg.querySelector('[data-furniture-rotate="f-seng"] circle')!;
    const at = scr(svg, [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]);
    const before = rootMatrix(svg);
    act(() => {
      pointer(svgElementAt(svg, at)!, 'pointerdown', at);
      pointer(svgElementAt(svg, at)!, 'pointerup', at);
    });
    expect(actions.rotateFurniture).toHaveBeenCalledWith('f-seng', 90);
    expect(onSelect).not.toHaveBeenCalled();
    expect(rootMatrix(svg)).toEqual(before);
  });

  it('on touch at the phone starting zoom (11.6 px/m) there is no handle; zoomed in it covers at most 0.3 m', () => {
    const sel = { kind: 'furniture' as const, id: 'f-seng', levelId: 'main' };
    let svg = render(baseProps({ editable: true, editActions: editActions(), selection: sel, coarsePointer: true }));
    // Zoom out to 11.6 px/m with the wheel around the middle.
    const zoomTo = (target: number) => {
      for (let i = 0; i < 200 && Math.abs(rootMatrix(svg)[0] - target) > 0.05; i++) {
        const s0 = rootMatrix(svg)[0];
        act(() => void svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 350, deltaY: s0 > target ? 20 : -20 })));
      }
    };
    zoomTo(11.6);
    expect(rootMatrix(svg)[0]).toBeLessThan(12);
    expect(svg.querySelector('[data-furniture-rotate]')).toBeNull();
    zoomTo(60);
    svg = render(baseProps({ editable: true, editActions: editActions(), selection: sel, coarsePointer: true }));
    const r = Number(svg.querySelector('[data-rotate-hit="f-seng"]')!.getAttribute('r'));
    expect(r).toBeLessThanOrEqual(0.3 + 1e-9);
  });
});

describe('a pinch with one finger on the rotate handle', () => {
  const sel = { kind: 'furniture' as const, id: 'f-seng', levelId: 'main' };

  it('handle first, then a finger on the selected item: the plan zooms, the item neither moves nor turns', () => {
    const actions = editActions();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: sel }));
    const handle = svg.querySelector('[data-furniture-rotate="f-seng"] circle')!;
    const a0 = scr(svg, [Number(handle.getAttribute('cx')), Number(handle.getAttribute('cy'))]);
    const b0 = scr(svg, [12, 2.2]);
    const s0 = Number(svg.getAttribute('data-scale'));
    const bedPath = svg.querySelector('[data-furniture-id="f-seng"] path')!;
    act(() => {
      finger(handle, 'pointerdown', a0, 1);
      finger(bedPath, 'pointerdown', b0, 2);
    });
    // Spread: finger A moves down (it stays captured by the handle until the pinch takes it), B up.
    for (let k = 1; k <= 4; k++) {
      act(() => {
        finger(handle, 'pointermove', [a0[0], a0[1] + 10 * k], 1);
        finger(svg, 'pointermove', [b0[0], b0[1] - 10 * k], 2);
      });
    }
    act(() => {
      finger(svg, 'pointerup', [a0[0], a0[1] + 40], 1);
      finger(svg, 'pointerup', [b0[0], b0[1] - 40], 2);
    });
    expect(Number(svg.getAttribute('data-scale'))).toBeGreaterThan(s0 * 1.2);
    expect(actions.beginDrag).not.toHaveBeenCalled();
    expect(actions.updateDrag).not.toHaveBeenCalled();
    expect(actions.rotateFurniture).not.toHaveBeenCalled();
    expect(svg.querySelector('[data-rotate-preview]')).toBeNull();
  });

  it('a finger on the selected item first, then one on the handle: also a pinch, no drag, no turn', () => {
    const actions = editActions();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: sel }));
    const handle = svg.querySelector('[data-furniture-rotate="f-seng"] circle')!;
    const a0 = scr(svg, [Number(handle.getAttribute('cx')), Number(handle.getAttribute('cy'))]);
    const b0 = scr(svg, [12, 2.2]);
    const s0 = Number(svg.getAttribute('data-scale'));
    act(() => {
      finger(svg.querySelector('[data-furniture-id="f-seng"] path')!, 'pointerdown', b0, 1);
      finger(handle, 'pointerdown', a0, 2);
    });
    for (let k = 1; k <= 4; k++) {
      act(() => {
        finger(svg, 'pointermove', [b0[0], b0[1] - 10 * k], 1);
        finger(handle, 'pointermove', [a0[0], a0[1] + 10 * k], 2);
      });
    }
    act(() => {
      finger(svg, 'pointerup', [b0[0], b0[1] - 40], 1);
      finger(handle, 'pointerup', [a0[0], a0[1] + 40], 2);
    });
    expect(Number(svg.getAttribute('data-scale'))).toBeGreaterThan(s0 * 1.2);
    expect(actions.beginDrag).not.toHaveBeenCalled();
    expect(actions.rotateFurniture).not.toHaveBeenCalled();
  });

  it('a lone finger on the handle still turns the item and neither pans nor taps the plan', () => {
    const actions = editActions();
    const onSelect = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: sel, onSelect }));
    const handle = svg.querySelector('[data-furniture-rotate="f-seng"] circle')!;
    const a0 = scr(svg, [Number(handle.getAttribute('cx')), Number(handle.getAttribute('cy'))]);
    const before = rootMatrix(svg);
    // A drag to the east of the bed: front east = rotation 90.
    const east = scr(svg, [14, 2.1]);
    act(() => finger(handle, 'pointerdown', a0, 1));
    act(() => finger(handle, 'pointermove', [(a0[0] + east[0]) / 2, (a0[1] + east[1]) / 2], 1));
    act(() => finger(handle, 'pointermove', east, 1));
    act(() => finger(handle, 'pointerup', east, 1));
    expect(actions.rotateFurniture).toHaveBeenCalledWith('f-seng', 90);
    expect(rootMatrix(svg)).toEqual(before);
    expect(onSelect).not.toHaveBeenCalled();
    // The plan forgot the pointer: the next tap elsewhere is a tap again.
    tapAt(svg.querySelector('[data-plan-paper]')!, scr(svg, [20, 10]));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});

describe('library tap with nothing selected: where the plan says to place', () => {
  const STRIP = 700 - 345; // a 345 px bottom sheet over the 700 px plan
  const insets = { top: 0, right: 0, bottom: 345, left: 0 };

  it('the middle of the uncovered strip (not the svg middle under the sheet), in a room', () => {
    const svg = render(baseProps({ viewportInsets: insets }));
    const c = requestPlanCentre()!.centre!;
    const at = scr(svg, c);
    expect(at[0]).toBeCloseTo(500, 6);
    expect(at[1]).toBeCloseTo(STRIP / 2, 6);
    expect(roomAt(createPlanFixture(), 'ground', c)).not.toBeNull();
    // Without insets: the middle of the plan (in a room too).
    const plain = render(baseProps());
    expect(scr(plain, requestPlanCentre()!.centre!)[1]).toBeCloseTo(350, 6);
  });

  it('the svg cut to the window: a plan partly scrolled off the screen answers the middle of what is on it', () => {
    const svg = render(baseProps());
    const at = (top: number) => () => ({ left: 0, top, right: 1000, bottom: top + 700, width: 1000, height: 700, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    // Scrolled up 100 px: svg y 100 … 700 visible, its middle 400.
    svg.getBoundingClientRect = at(-100);
    let c = requestPlanCentre()!.centre!;
    expect(scr(svg, c)[1]).toBeCloseTo(400, 6);
    expect(roomAt(createPlanFixture(), 'ground', c)).not.toBeNull();
    // Starting 372 px down a 768 px window (the phone): svg y 0 … 396 visible, its middle 198.
    expect(window.innerHeight).toBe(768);
    svg.getBoundingClientRect = at(372);
    c = requestPlanCentre()!.centre!;
    expect(scr(svg, c)[1]).toBeCloseTo(198, 6);
    expect(roomAt(createPlanFixture(), 'ground', c)).not.toBeNull();
  });

  it('place → delete → place: both land in a room on screen (no drift under the sheet onto the lawn)', () => {
    for (const bottom of [345, 572]) {
      const strip = 700 - bottom;
      const props = (over: Partial<Props>) => baseProps({ viewportInsets: { top: 0, right: 0, bottom, left: 0 }, editable: true, editActions: editActions(), ...over });
      let derived = createPlanFixture();
      let svg = render(props({ derived, selection: null }));
      for (let round = 0; round < 3; round++) {
        let added: DerivedFurniture | null = null;
        const placed = placeFurniture(
          {
            derived,
            storeyId: 'ground',
            selection: null,
            addFurniture: (catalogId, p, opts) => {
              const size = opts.size ?? { w: 1, d: 1, h: 1 };
              added = furnitureItem(`f-new-${round}`, catalogId, p, opts.rotationDeg ?? 0, size, roomAt(derived, 'ground', p)?.id);
              return added.id;
            },
            select: () => {},
            planCentre: () => {
              const c = requestPlanCentre();
              return c?.centre ? { centre: c.centre, storeyId: c.storeyId } : null;
            },
          },
          'kommode',
          { kind: 'tap' },
        );
        expect(placed, `inset ${bottom}, round ${round}`).not.toBeNull();
        expect(placed!.room, `inset ${bottom}, round ${round}: in a room`).not.toBeNull();
        // Selected: the plan reveals it above the sheet (pans, never zooms) …
        derived = { ...derived, furniture: [added!] };
        svg = render(props({ derived, selection: { kind: 'furniture', id: added!.id, levelId: 'main' } }));
        const box = added!.footprint.map((p) => scr(svg, p));
        expect(Math.max(...box.map((p) => p[1])), `inset ${bottom}, round ${round}: on screen`).toBeLessThanOrEqual(strip);
        // … then Slett: nothing selected, and the next tap goes through the plan again.
        derived = { ...derived, furniture: [] };
        svg = render(props({ derived, selection: null }));
        const next = requestPlanCentre()!.centre!;
        expect(roomAt(derived, 'ground', next), `inset ${bottom}, round ${round}: next centre in a room`).not.toBeNull();
      }
    }
  });

  it('the strip over no room: the last room used, else the building', () => {
    // A thin strip far north of the building (the sheet covers all but 40 px): the svg middle maps outside the rooms.
    const thin = { top: 0, right: 0, bottom: 660, left: 0 };
    let svg = render(baseProps({ viewportInsets: thin }));
    const seen = (): Vec2 => {
      const [s, , , , tx, ty] = rootMatrix(svg);
      return [(500 - tx) / s, -(20 - ty) / s];
    };
    expect(roomAt(createPlanFixture(), 'ground', seen())).toBeNull();
    // Nothing used yet: the building's middle, in a room.
    const first = requestPlanCentre()!.centre!;
    expect(roomAt(createPlanFixture(), 'ground', first)).not.toBeNull();
    // The bed in Soverom was selected (no sheet open: no reveal), then the selection cleared: its room.
    svg = render(baseProps({ selection: { kind: 'furniture', id: 'f-seng', levelId: 'main' } }));
    svg = render(baseProps({ viewportInsets: thin, selection: null }));
    expect(roomAt(createPlanFixture(), 'ground', seen())).toBeNull();
    const c = requestPlanCentre()!.centre!;
    expect(roomAt(createPlanFixture(), 'ground', c)?.id).toBe('rom-soverom');
  });
});
