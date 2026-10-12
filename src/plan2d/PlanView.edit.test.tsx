// @vitest-environment jsdom
/**
 * Editing in the plan (docs/phase2-plan.md §3.1–3.4): pan vs drag, thresholds, handles and their sizes, the tools,
 * Esc / pointercancel / lostpointercapture, ghosts, the legend, furniture and the temporary overlays. The edit API
 * is a mock implementing the drag protocol (state/editActions.ts is built in parallel).
 */
import { act, createRef } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedFurniture, DerivedVariant } from '../model/derived';
import type { Vec2 } from '../model/types';
import { editStrings } from './editStrings';
import type { SelectionBarAnchor } from './editTypes';
import { createPlanFixture, createPlanFixtureSite } from './fixture';
import { PlanView } from './PlanView';
import type { PlanViewHandle } from './PlanView';
import { ACCENT } from './style';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof PlanView>;

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

const SESSION = { id: 'session-1' };

type Fn = (...args: unknown[]) => unknown;

function mockActions(o: { beginDrag?: Fn; addOpening?: Fn; snapPoint?: Fn; insertDeckVertex?: Fn } = {}) {
  return {
    beginDrag: vi.fn<Fn>(o.beginDrag ?? (() => SESSION)),
    updateDrag: vi.fn<Fn>((_s, p) => ({
      indicators: [{ kind: 'endpoint', p }],
      chips: [{ a: [7, 3], b: [10, 3], value: 3 }],
      ghost: [
        [7, 2.9],
        [10, 2.9],
        [10, 3.1],
        [7, 3.1],
      ],
    })),
    endDrag: vi.fn<Fn>(),
    cancelDrag: vi.fn<Fn>(),
    addWall: vi.fn<Fn>(() => 'w-new'),
    addOpening: vi.fn<Fn>(o.addOpening ?? (() => 'o-new')),
    placeUnit: vi.fn<Fn>(() => 'blk-new'),
    insertDeckVertex: vi.fn<Fn>(o.insertDeckVertex ?? (() => 'deck-1-new')),
    snapPoint: o.snapPoint,
  };
}

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    derived: createPlanFixture(),
    site: createPlanFixtureSite(),
    planStorey: 'ground',
    selection: null,
    onSelect: () => {},
    showLabels: true,
    showDims: true,
    showGrid: true,
    showRoofPlan: false,
    highlightNew: true,
    ...overrides,
  };
}

function render(props: Props, ref?: React.Ref<PlanViewHandle>) {
  act(() => root.render(<PlanView {...props} ref={ref} />));
  return container.querySelector<SVGSVGElement>('svg[data-testid="plan-view"]')!;
}

function rootMatrix(svg: SVGSVGElement): number[] {
  const t = svg.querySelector('[data-plan-root]')!.getAttribute('transform')!;
  return /^matrix\(([^)]+)\)$/.exec(t)![1].split(' ').map(Number);
}

/** Screen (client) position of a plan point (jsdom: the SVG sits at 0,0). */
function scr(svg: SVGSVGElement, p: Vec2): Vec2 {
  const [s, , , , tx, ty] = rootMatrix(svg);
  return [s * p[0] + tx, -s * p[1] + ty];
}

interface PtrOpts {
  id?: number;
  pointerType?: string;
  button?: number;
  altKey?: boolean;
}

function pointer(el: Element, type: string, at: Vec2, o: PtrOpts = {}) {
  const id = o.id ?? 1;
  el.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, clientX: at[0], clientY: at[1], pointerId: id, button: o.button ?? 0, pointerType: o.pointerType ?? 'mouse', isPrimary: id === 1, altKey: !!o.altKey }),
  );
}

const plus = (a: Vec2, dx: number, dy: number): Vec2 => [a[0] + dx, a[1] + dy];

function tapAt(el: Element, at: Vec2, o: PtrOpts = {}) {
  act(() => {
    pointer(el, 'pointerdown', at, o);
    pointer(el, 'pointerup', at, o);
  });
}

function hoverAt(svg: SVGSVGElement, at: Vec2) {
  act(() => pointer(svg, 'pointermove', at));
}

function escape(): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  act(() => {
    window.dispatchEvent(e);
  });
  return e;
}

const WALL_SEL = { kind: 'wall' as const, id: 'w-bad-s', levelId: 'main' };

describe('gestures: tap selects, drag the selected element moves, any other drag pans', () => {
  it('pans across a wall that is not selected and moves nothing', () => {
    const actions = mockActions();
    const onSelect = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: actions, onSelect }));
    const [, , , , tx0, ty0] = rootMatrix(svg);
    const wall = svg.querySelector('[data-wall-id="w-bad-s"]')!;
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(wall, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 30, 20));
      pointer(svg, 'pointermove', plus(at, 50, 30));
      pointer(svg, 'pointerup', plus(at, 50, 30));
    });
    const [, , , , tx1, ty1] = rootMatrix(svg);
    expect(tx1).toBeCloseTo(tx0 + 50, 6);
    expect(ty1).toBeCloseTo(ty0 + 30, 6);
    expect(actions.beginDrag).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('moves the selected wall: beginDrag past 5 px, updateDrag with feedback, endDrag on release', () => {
    const actions = mockActions();
    const onSelect = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: actions, onSelect, selection: WALL_SEL }));
    const before = rootMatrix(svg);
    const wall = svg.querySelector('[data-wall-id="w-bad-s"]')!;
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(wall, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 3, 2));
    });
    expect(actions.beginDrag).not.toHaveBeenCalled();
    act(() => pointer(svg, 'pointermove', plus(at, 0, -40)));
    expect(actions.beginDrag).toHaveBeenCalledTimes(1);
    const [target, p0, handle] = actions.beginDrag.mock.calls[0] as [unknown, Vec2, unknown];
    expect(target).toEqual({ kind: 'wall', id: 'w-bad-s' });
    expect(p0[0]).toBeCloseTo(8.5, 6);
    expect(p0[1]).toBeCloseTo(3, 6);
    expect(handle).toBeUndefined();
    const [session, p1, mods] = actions.updateDrag.mock.calls.at(-1) as [unknown, Vec2, { alt: boolean; snapRadiusM: number; coarse: boolean }];
    expect(session).toBe(SESSION);
    expect(p1[1]).toBeGreaterThan(3.5);
    expect(mods.alt).toBe(false);
    expect(mods.coarse).toBe(false);
    expect(mods.snapRadiusM).toBeCloseTo(12 / before[0], 9);
    expect(svg.getAttribute('data-plan-dragging')).toBe('true');
    expect(svg.querySelector('[data-edit-ghost]')).not.toBeNull();
    expect(svg.querySelector('[data-edit-marker="endpoint"]')).not.toBeNull();
    expect(svg.querySelector('[data-edit-chip="chip"]')!.textContent).toBe('3,00 m');
    expect(rootMatrix(svg)).toEqual(before);
    act(() => pointer(svg, 'pointerup', plus(at, 0, -40)));
    expect(actions.endDrag).toHaveBeenCalledWith(SESSION);
    expect(actions.cancelDrag).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(svg.getAttribute('data-plan-dragging')).toBeNull();
    expect(svg.querySelector('[data-edit-ghost]')).toBeNull();
  });

  it('passes Alt for the fine grid', () => {
    const actions = mockActions();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: WALL_SEL }));
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 0, -20), { altKey: true });
      pointer(svg, 'pointerup', plus(at, 0, -20));
    });
    expect((actions.updateDrag.mock.calls.at(-1) as [unknown, Vec2, { alt: boolean }])[2].alt).toBe(true);
  });

  it('grabs the selected block through the rooms inside it', () => {
    const actions = mockActions();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: { kind: 'block', id: 'blk-a' } }));
    const at = scr(svg, [2, 2]);
    act(() => {
      pointer(svg.querySelector('[data-room-id="rom-stue"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 20, 0));
      pointer(svg, 'pointerup', plus(at, 20, 0));
    });
    expect(actions.beginDrag.mock.calls[0][0]).toEqual({ kind: 'block', id: 'blk-a' });
    expect(actions.endDrag).toHaveBeenCalledTimes(1);
  });

  it('drags a selected exterior wall piece as its block edge', () => {
    const actions = mockActions();
    const piece = 'blk-a/a-sw/blk-a-rest/base';
    const svg = render(baseProps({ editable: true, editActions: actions, selection: { kind: 'wall', id: piece, levelId: 'main' } }));
    const at = scr(svg, [5, 0]);
    act(() => {
      pointer(svg.querySelector(`[data-wall-id="${piece}"]`)!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 0, 20));
      pointer(svg, 'pointerup', plus(at, 0, 20));
    });
    expect(actions.beginDrag.mock.calls[0][0]).toEqual({ kind: 'blockEdge', id: 'a-sw' });
  });

  it('needs 10 px before a touch press moves or pans', () => {
    const actions = mockActions();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: WALL_SEL }));
    const before = rootMatrix(svg);
    const at = scr(svg, [8.5, 3]);
    const touch = { pointerType: 'touch' };
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at, touch);
      pointer(svg, 'pointermove', plus(at, 0, 8), touch);
    });
    expect(actions.beginDrag).not.toHaveBeenCalled();
    expect(rootMatrix(svg)).toEqual(before);
    act(() => pointer(svg, 'pointermove', plus(at, 0, 14), touch));
    expect(actions.beginDrag).toHaveBeenCalledTimes(1);
    expect((actions.updateDrag.mock.calls.at(-1) as [unknown, Vec2, { coarse: boolean; snapRadiusM: number }])[2].coarse).toBe(true);
    act(() => pointer(svg, 'pointerup', plus(at, 0, 14), touch));
    expect(actions.endDrag).toHaveBeenCalledTimes(1);
  });

  it('a tap on the selected element selects it again and drags nothing', () => {
    const actions = mockActions();
    const onSelect = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: actions, onSelect, selection: WALL_SEL }));
    tapAt(svg.querySelector('[data-wall-id="w-bad-s"]')!, scr(svg, [8.5, 3]));
    expect(onSelect).toHaveBeenCalledWith(WALL_SEL);
    expect(actions.beginDrag).not.toHaveBeenCalled();
  });

  it('pans when beginDrag refuses (nothing to drag, locked variant)', () => {
    const actions = mockActions({ beginDrag: () => null });
    const svg = render(baseProps({ editable: true, editActions: actions, selection: WALL_SEL }));
    const [, , , , tx0] = rootMatrix(svg);
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 40, 0));
      pointer(svg, 'pointerup', plus(at, 40, 0));
    });
    expect(rootMatrix(svg)[4]).toBeCloseTo(tx0 + 40, 6);
    expect(actions.updateDrag).not.toHaveBeenCalled();
    expect(actions.endDrag).not.toHaveBeenCalled();
  });

  it('is the phase-1 viewer without `editable`: no handles, a drag on the selection pans', () => {
    const actions = mockActions();
    const svg = render(baseProps({ editable: false, editActions: actions, selection: WALL_SEL }));
    expect(svg.querySelector('[data-handle]')).toBeNull();
    expect(svg.getAttribute('data-plan-editable')).toBe('false');
    const [, , , , tx0] = rootMatrix(svg);
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 40, 0));
      pointer(svg, 'pointerup', plus(at, 40, 0));
    });
    expect(actions.beginDrag).not.toHaveBeenCalled();
    expect(rootMatrix(svg)[4]).not.toBe(tx0);
  });
});

describe('cancelling a drag', () => {
  function startDrag(o: PtrOpts = {}) {
    const actions = mockActions();
    const onSelect = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: actions, onSelect, selection: WALL_SEL }));
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at, o);
      pointer(svg, 'pointermove', plus(at, 0, -30), o);
    });
    expect(actions.beginDrag).toHaveBeenCalledTimes(1);
    return { actions, onSelect, svg, end: plus(at, 0, -30) };
  }

  it('Esc cancels (consumed, so the app does not also clear the selection); the release commits nothing', () => {
    const { actions, onSelect, svg, end } = startDrag();
    const e = escape();
    expect(e.defaultPrevented).toBe(true);
    expect(actions.cancelDrag).toHaveBeenCalledWith(SESSION);
    expect(svg.getAttribute('data-plan-dragging')).toBeNull();
    act(() => pointer(svg, 'pointerup', end));
    expect(actions.endDrag).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(escape().defaultPrevented).toBe(false);
  });

  it('pointercancel cancels', () => {
    const { actions, svg, end } = startDrag();
    act(() => pointer(svg, 'pointercancel', end));
    expect(actions.cancelDrag).toHaveBeenCalledTimes(1);
    expect(actions.endDrag).not.toHaveBeenCalled();
  });

  it('lostpointercapture cancels while the pointer is still down', () => {
    const { actions, svg, end } = startDrag();
    act(() => pointer(svg, 'lostpointercapture', end));
    expect(actions.cancelDrag).toHaveBeenCalledTimes(1);
    act(() => pointer(svg, 'pointerup', end));
    expect(actions.endDrag).not.toHaveBeenCalled();
  });

  it('a second finger cancels the drag and pinches', () => {
    const touch = { pointerType: 'touch' };
    const { actions, svg, end } = startDrag(touch);
    const s0 = rootMatrix(svg)[0];
    act(() => {
      pointer(svg, 'pointerdown', plus(end, 100, 0), { ...touch, id: 2 });
      pointer(svg, 'pointermove', plus(end, 200, 0), { ...touch, id: 2 });
      pointer(svg, 'pointerup', plus(end, 200, 0), { ...touch, id: 2 });
      pointer(svg, 'pointerup', end, touch);
    });
    expect(actions.cancelDrag).toHaveBeenCalledTimes(1);
    expect(actions.endDrag).not.toHaveBeenCalled();
    expect(rootMatrix(svg)[0]).toBeCloseTo(s0 * 2, 6);
  });

  it('cancelInteraction() on the handle cancels like Esc', () => {
    const ref = createRef<PlanViewHandle>();
    const actions = mockActions();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: WALL_SEL }), ref);
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 0, -30));
    });
    let r = false;
    act(() => {
      r = ref.current!.cancelInteraction();
    });
    expect(r).toBe(true);
    expect(actions.cancelDrag).toHaveBeenCalledTimes(1);
    expect(ref.current!.cancelInteraction()).toBe(false);
  });
});

describe('handles', () => {
  const radius = (svg: SVGSVGElement, key: string) => Number(svg.querySelector(`[data-handle="${key}"] circle`)!.getAttribute('r'));
  const width = (svg: SVGSVGElement, sel: string) => Number(svg.querySelector(sel)!.getAttribute('stroke-width'));

  it('are 7 px with 12 px corridors, 14 px on a coarse pointer with corridors of 0.25 m within 10–24 px', () => {
    const actions = mockActions();
    const fine = render(baseProps({ editable: true, editActions: actions, selection: WALL_SEL }));
    expect(radius(fine, 'we:a')).toBe(7);
    expect(width(fine, '[data-wall-corridor="w-bad-s"]')).toBe(12);
    expect(width(fine, '[data-opening-corridor="d-bad"]')).toBe(12);
    expect(fine.querySelector('[data-wall-corridor="w-bad-s"]')!.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    const coarse = render(baseProps({ editable: true, editActions: actions, selection: WALL_SEL, coarsePointer: true }));
    expect(radius(coarse, 'we:a')).toBe(14);
    expect(radius(coarse, 'we:b')).toBe(14);
    // Fitted (about 41 px/m): 24 px would be 0.6 m, so the band is 0.25 m on screen.
    const s = rootMatrix(coarse)[0];
    expect(s).toBeLessThan(96);
    expect(width(coarse, '[data-wall-corridor="w-bad-s"]')).toBeCloseTo(0.25 * s, 0);
    expect(width(coarse, '[data-opening-corridor="d-bad"]')).toBeCloseTo(0.25 * s, 0);
    // Zoomed in past 96 px/m the band is the 24 px of the plan again.
    act(() => {
      coarse.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, clientX: 500, clientY: 350, bubbles: true, cancelable: true }));
      coarse.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, clientX: 500, clientY: 350, bubbles: true, cancelable: true }));
    });
    expect(rootMatrix(coarse)[0]).toBeGreaterThan(96);
    expect(width(coarse, '[data-wall-corridor="w-bad-s"]')).toBe(24);
    expect(width(coarse, '[data-opening-corridor="d-bad"]')).toBe(24);
    // Zoomed out below 40 px/m (second fix round): never under 10 px, so a finger can still hit a wall or a door.
    act(() => {
      for (let i = 0; i < 4; i++) coarse.dispatchEvent(new WheelEvent('wheel', { deltaY: 500, clientX: 500, clientY: 350, bubbles: true, cancelable: true }));
    });
    expect(rootMatrix(coarse)[0]).toBeLessThan(40);
    expect(width(coarse, '[data-wall-corridor="w-bad-s"]')).toBe(10);
    expect(width(coarse, '[data-opening-corridor="d-bad"]')).toBe(10);
    expect(coarse.getAttribute('data-hit-band')).toBe('10');
  });

  it('follow the (pointer: coarse) media query', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({ matches: query === '(pointer: coarse)', media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      const svg = render(baseProps({ editable: true, editActions: mockActions(), selection: { kind: 'block', id: 'blk-b' } }));
      expect(radius(svg, 'bv:b-se')).toBe(14);
      // A hit at 13 px from the handle centre is inside the handle on a coarse pointer.
      const c = svg.querySelector('[data-handle="bv:b-se"] circle')!;
      const centre: Vec2 = [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))];
      expect(Math.hypot(13, 0)).toBeLessThan(Number(c.getAttribute('r')));
      expect(centre).toEqual(scr(svg, [14, 0]).map((v) => Math.round(v * 10) / 10));
    } finally {
      window.matchMedia = original;
    }
  });

  it('a wall end handle drags that end', () => {
    const actions = mockActions();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: WALL_SEL }));
    const at = scr(svg, [10, 3]);
    act(() => {
      pointer(svg.querySelector('[data-handle="we:b"] circle')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 20, 0));
      pointer(svg, 'pointerup', plus(at, 20, 0));
    });
    expect(actions.beginDrag.mock.calls[0][0]).toEqual({ kind: 'wall', id: 'w-bad-s' });
    expect(actions.beginDrag.mock.calls[0][2]).toBe('b');
  });

  it('a block corner handle drags the vertex and a tap on it selects it', () => {
    const actions = mockActions();
    const onSelect = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: actions, onSelect, selection: { kind: 'block', id: 'blk-b' } }));
    const h = svg.querySelector('[data-handle="bv:b-ne"] circle')!;
    const at = scr(svg, [14, 4]);
    tapAt(h, at);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'blockVertex', id: 'b-ne' });
    act(() => {
      pointer(h, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 25, -25));
      pointer(svg, 'pointerup', plus(at, 25, -25));
    });
    expect(actions.beginDrag.mock.calls[0][0]).toEqual({ kind: 'blockVertex', id: 'b-ne' });
  });

  /** Actions without the core's one-step "+" drag (beginDrag refuses the 'insert' handle). */
  const noInsertDrag = (_sel: unknown, _p: unknown, handle: unknown) => (handle === 'insert' ? null : SESSION);
  const plainDrags = (actions: ReturnType<typeof mockActions>) => actions.beginDrag.mock.calls.filter((c) => c[2] !== 'insert');

  it('deck: "+" with the editor core insert drag inserts and drags in one session, selecting the new vertex', () => {
    const actions = mockActions({
      beginDrag: (_sel, _p, handle) => (handle === 'insert' ? { id: 'session-insert', selection: { kind: 'deckVertex', id: 'deck-1-new' } } : SESSION),
    });
    const onSelect = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: actions, onSelect, selection: { kind: 'deck', id: 'deck-1' } }));
    const at = scr(svg, [15, -1.555]);
    act(() => {
      pointer(svg.querySelector('[data-handle="di:deck-1-v1"] circle')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 30, 0));
      pointer(svg, 'pointerup', plus(at, 30, 0));
    });
    expect(actions.beginDrag.mock.calls[0].slice(0, 1)).toEqual([{ kind: 'deckEdge', id: 'deck-1-v1' }]);
    expect(actions.beginDrag.mock.calls[0][2]).toBe('insert');
    expect(actions.insertDeckVertex).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith({ kind: 'deckVertex', id: 'deck-1-new' });
    expect(actions.updateDrag).toHaveBeenCalled();
    expect(actions.endDrag).toHaveBeenCalledTimes(1);
    expect(actions.endDrag.mock.calls[0][0]).toEqual({ id: 'session-insert', selection: { kind: 'deckVertex', id: 'deck-1-new' } });
  });

  it('deck: "+" inserts a vertex (tap selects it, drag moves it), vertices and edges select on tap', () => {
    const actions = mockActions({ beginDrag: noInsertDrag });
    const onSelect = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: actions, onSelect, selection: { kind: 'deck', id: 'deck-1' } }));
    expect(svg.querySelectorAll('[data-handle-shape="vertex"]')).toHaveLength(4);
    expect(svg.querySelectorAll('[data-handle-shape="insert"]')).toHaveLength(4);
    expect(svg.querySelectorAll('[data-handle-shape="edge"]')).toHaveLength(4);
    tapAt(svg.querySelector('[data-handle="di:deck-1-v0"] circle')!, scr(svg, [12, -3]));
    expect(actions.insertDeckVertex).toHaveBeenCalledWith('deck-1-v0', [12, -3]);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'deckVertex', id: 'deck-1-new' });
    const at = scr(svg, [15, -1.555]);
    act(() => {
      pointer(svg.querySelector('[data-handle="di:deck-1-v1"] circle')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 30, 0));
      pointer(svg, 'pointerup', plus(at, 30, 0));
    });
    expect(actions.insertDeckVertex).toHaveBeenCalledTimes(2);
    expect(plainDrags(actions)[0][0]).toEqual({ kind: 'deckVertex', id: 'deck-1-new' });
    expect(actions.endDrag).toHaveBeenCalledTimes(1);
    tapAt(svg.querySelector('[data-handle="dv:deck-1-v2"] circle')!, scr(svg, [15, -0.11]));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'deckVertex', id: 'deck-1-v2' });
    tapAt(svg.querySelector('[data-handle="de:deck-1-v3"] line[pointer-events="stroke"]')!, scr(svg, [9, -1]));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'deckEdge', id: 'deck-1-v3' });
  });

  it('deck: a "+" drag picks the new vertex up from the next derived model when the action returns no id', () => {
    const actions = mockActions({ insertDeckVertex: () => undefined, beginDrag: noInsertDrag });
    const onSelect = vi.fn();
    const props = baseProps({ editable: true, editActions: actions, onSelect, selection: { kind: 'deck' as const, id: 'deck-1' } });
    const svg = render(props);
    const at = scr(svg, [15, -1.555]);
    act(() => {
      pointer(svg.querySelector('[data-handle="di:deck-1-v1"] circle')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 30, 0));
    });
    expect(actions.insertDeckVertex).toHaveBeenCalledWith('deck-1-v1', [15, -1.555]);
    expect(plainDrags(actions)).toHaveLength(0);
    expect(svg.getAttribute('data-plan-dragging')).toBe('true');
    // The store applied the insert: the deck has a new vertex after deck-1-v1.
    const d = props.derived;
    const deck = d.outdoor.decks[0];
    const polygon: Vec2[] = [deck.polygon[0], deck.polygon[1], [15, -1.555], deck.polygon[2], deck.polygon[3]];
    const vertexIds = [deck.vertexIds[0], deck.vertexIds[1], 'deck-1-vX', deck.vertexIds[2], deck.vertexIds[3]];
    render({ ...props, derived: { ...d, outdoor: { ...d.outdoor, decks: [{ ...deck, polygon, vertexIds }] } } });
    act(() => pointer(svg, 'pointermove', plus(at, 40, 0)));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'deckVertex', id: 'deck-1-vX' });
    expect(plainDrags(actions)[0][0]).toEqual({ kind: 'deckVertex', id: 'deck-1-vX' });
    expect(actions.updateDrag).toHaveBeenCalledTimes(1);
    act(() => pointer(svg, 'pointerup', plus(at, 40, 0)));
    expect(actions.endDrag).toHaveBeenCalledTimes(1);
  });

  it('marks the selected deck edge and drags it', () => {
    const actions = mockActions();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: { kind: 'deckEdge', id: 'deck-1-v1' } }));
    expect(svg.querySelectorAll('[data-handle="de:deck-1-v1"] line')).toHaveLength(2);
    expect(svg.querySelector('[data-deck-id="deck-1"] path')!.getAttribute('stroke')).toBe(ACCENT);
    const at = scr(svg, [15, -2]);
    act(() => {
      pointer(svg.querySelector('[data-handle="de:deck-1-v1"] line[pointer-events="stroke"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 30, 0));
      pointer(svg, 'pointerup', plus(at, 30, 0));
    });
    expect(actions.beginDrag.mock.calls[0][0]).toEqual({ kind: 'deckEdge', id: 'deck-1-v1' });
  });

  it('are hidden while a placement tool is active', () => {
    const svg = render(baseProps({ editable: true, editActions: mockActions(), selection: WALL_SEL, tool: 'wall' }));
    expect(svg.querySelector('[data-handle]')).toBeNull();
  });
});

describe('tools', () => {
  it('Vegg: the first click sets the start, the second adds the wall; the tool stays', () => {
    const actions = mockActions();
    const onSelect = vi.fn();
    const onHint = vi.fn();
    const onToolChange = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: actions, onSelect, onHint, onToolChange, tool: 'wall' }));
    expect(svg.getAttribute('data-plan-tool')).toBe('wall');
    expect(onHint).toHaveBeenLastCalledWith(editStrings.hintWallStart);
    tapAt(svg, scr(svg, [1.21, 1.29]));
    expect(actions.addWall).not.toHaveBeenCalled();
    expect(onHint).toHaveBeenLastCalledWith(editStrings.hintWallEnd);
    expect(svg.querySelector('[data-edit-wall-start]')).not.toBeNull();
    hoverAt(svg, scr(svg, [3.02, 1.31]));
    expect(svg.querySelector('[data-edit-rubber]')).not.toBeNull();
    // geometry/snap.ts: the ortho guide through the start and its length chip.
    expect([...svg.querySelectorAll('[data-edit-chip]')].map((c) => c.textContent)).toEqual(['1,80 m']);
    expect(svg.querySelector('[data-edit-guide]')).not.toBeNull();
    tapAt(svg, scr(svg, [3.02, 1.31]));
    expect(actions.addWall).toHaveBeenCalledWith([1.2, 1.3], [3, 1.3], 'main');
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'wall', id: 'w-new', levelId: 'main' });
    expect(onToolChange).not.toHaveBeenCalled();
    expect(onHint).toHaveBeenLastCalledWith(editStrings.hintWallStart);
    expect(svg.querySelector('[data-edit-rubber]')).toBeNull();
    // A drag with the tool pans and adds nothing.
    const [, , , , tx0] = rootMatrix(svg);
    const at = scr(svg, [5, 5]);
    act(() => {
      pointer(svg, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 40, 0));
      pointer(svg, 'pointerup', plus(at, 40, 0));
    });
    expect(rootMatrix(svg)[4]).not.toBe(tx0);
    expect(actions.addWall).toHaveBeenCalledTimes(1);
    expect(svg.querySelector('[data-edit-wall-start]')).toBeNull();
  });

  it('Vegg: Esc drops the start point; with nothing started Esc is left to the app', () => {
    const actions = mockActions();
    const onHint = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: actions, onHint, tool: 'wall' }));
    expect(escape().defaultPrevented).toBe(false);
    tapAt(svg, scr(svg, [1.21, 1.29]));
    expect(escape().defaultPrevented).toBe(true);
    expect(onHint).toHaveBeenLastCalledWith(editStrings.hintWallStart);
    expect(svg.querySelector('[data-edit-wall-start]')).toBeNull();
    tapAt(svg, scr(svg, [3.02, 1.31]));
    expect(actions.addWall).not.toHaveBeenCalled();
    expect(svg.querySelector('[data-edit-wall-start]')).not.toBeNull();
  });

  it('snaps through editActions.snapPoint when it is there', () => {
    const snapPoint = vi.fn((..._args: unknown[]): unknown => ({ point: [5, 5], indicators: [{ kind: 'endpoint', p: [5, 5] }] }));
    const actions = mockActions({ snapPoint });
    const svg = render(baseProps({ editable: true, editActions: actions, tool: 'wall' }));
    hoverAt(svg, scr(svg, [4.93, 5.08]));
    expect(svg.querySelector('[data-edit-marker="endpoint"]')).not.toBeNull();
    const opts = snapPoint.mock.calls[0][1] as { purpose: string; storeyId: string; levelId: string; modifiers: { snapRadiusM: number } };
    expect(opts.purpose).toBe('wall');
    expect(opts.storeyId).toBe('ground');
    expect(opts.levelId).toBe('main');
    tapAt(svg, scr(svg, [4.93, 5.08]));
    tapAt(svg, scr(svg, [6.93, 5.08]));
    expect((snapPoint.mock.calls.at(-1)![1] as { from?: Vec2 }).from).toEqual([5, 5]);
    expect(actions.addWall).not.toHaveBeenCalled(); // both clicks snapped to (5, 5): a zero-length wall is ignored
  });

  it('Dør/vindu: a click on a wall adds the chosen type there and returns to Velg', () => {
    const actions = mockActions();
    const onSelect = vi.fn();
    const onToolChange = vi.fn();
    const onHint = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: actions, onSelect, onToolChange, onHint, tool: 'opening', toolOptions: { openingType: 'door' } }));
    expect(onHint).toHaveBeenLastCalledWith(editStrings.hintOpening);
    tapAt(svg, scr(svg, [5.5, 2.5]));
    expect(actions.addOpening).not.toHaveBeenCalled();
    hoverAt(svg, scr(svg, [8.5, 3.03]));
    expect(svg.querySelector('[data-edit-opening-target="w-bad-s"]')).not.toBeNull();
    tapAt(svg, scr(svg, [8.5, 3.03]));
    expect(actions.addOpening).toHaveBeenCalledTimes(1);
    const [host, offset, type] = actions.addOpening.mock.calls[0] as [unknown, number, unknown];
    expect(host).toEqual({ kind: 'wall', wallId: 'w-bad-s' });
    expect(offset).toBeCloseTo(1.5, 6);
    expect(type).toBe('door');
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'opening', id: 'o-new' });
    expect(onToolChange).toHaveBeenCalledWith('select');
  });

  it('Dør/vindu: a click on a block edge hosts the opening on the edge', () => {
    const actions = mockActions();
    const svg = render(baseProps({ editable: true, editActions: actions, tool: 'opening' }));
    tapAt(svg, scr(svg, [14.05, 0.62]));
    const [host, offset, type] = actions.addOpening.mock.calls[0] as [unknown, number, unknown];
    expect(host).toEqual({ kind: 'blockEdge', blockId: 'blk-b', edgeId: 'b-se' });
    expect(offset).toBeCloseTo(0.6, 9);
    expect(type).toBe('window');
  });

  it('Dør/vindu: an opening that would overlap one already in the wall goes to the nearest free place on the 10 cm grid', () => {
    // b-se holds win-sov at offset 2 (1,0 m wide: 1,5–2,5). A 1,1 m window wanted at 1,5 would overlap it.
    const actions = mockActions();
    const svg = render(baseProps({ editable: true, editActions: actions, tool: 'opening' }));
    tapAt(svg, scr(svg, [14.05, 1.5]));
    expect(actions.addOpening.mock.calls[0][1]).toBeCloseTo(0.9, 9);
    // A 0,9 m door wanted at 2,3: the nearest free centre is 3,0 (2,5 + 0,45 → the next 10 cm step).
    const doors = mockActions();
    const svg2 = render(baseProps({ editable: true, editActions: doors, tool: 'opening', toolOptions: { openingType: 'door' } }));
    tapAt(svg2, scr(svg2, [14.05, 2.3]));
    expect(doors.addOpening.mock.calls[0][1]).toBeCloseTo(3, 9);
    expect(doors.addOpening.mock.calls[0][2]).toBe('door');
  });

  it('Dør/vindu: a refused placement keeps the tool', () => {
    const actions = mockActions({ addOpening: () => null });
    const onToolChange = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: actions, onToolChange, tool: 'opening' }));
    tapAt(svg, scr(svg, [8.5, 3.03]));
    expect(onToolChange).not.toHaveBeenCalled();
  });

  it('Nytt bygg: a ghost follows the pointer, a click places the unit and returns to Velg; R turns it', () => {
    const actions = mockActions();
    const onSelect = vi.fn();
    const onToolChange = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: actions, onSelect, onToolChange, tool: 'unit', toolOptions: { unitTemplate: 'vedskjul' } }));
    hoverAt(svg, scr(svg, [20.02, 3.04]));
    expect(svg.querySelector('[data-edit-unit-ghost]')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    });
    tapAt(svg, scr(svg, [20.02, 3.04]));
    // Turned once: 1,5 × 2 m; nothing to snap to out there, so its vertex 0 (local south-west, now at the
    // south-east) goes on the 0,10 m grid.
    const [tpl, at, rot] = actions.placeUnit.mock.calls[0] as [string, Vec2, number];
    expect([tpl, rot]).toEqual(['vedskjul', 1]);
    expect(at[0]).toBeCloseTo(20.05, 6);
    expect(at[1]).toBeCloseTo(3, 6);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'block', id: 'blk-new' });
    expect(onToolChange).toHaveBeenCalledWith('select');
  });

  it('Nytt bygg: nothing is placed without a template', () => {
    const actions = mockActions();
    const svg = render(baseProps({ editable: true, editActions: actions, tool: 'unit' }));
    tapAt(svg, scr(svg, [20.02, 3.04]));
    expect(actions.placeUnit).not.toHaveBeenCalled();
  });

  it('Mål: two clicks measure (also on the locked base), the next click starts again, Esc clears', () => {
    const onHint = vi.fn();
    const svg = render(baseProps({ editable: false, tool: 'measure', onHint }));
    expect(svg.getAttribute('data-plan-tool')).toBe('measure');
    expect(onHint).toHaveBeenLastCalledWith(editStrings.hintMeasure);
    tapAt(svg, scr(svg, [1.01, 1.01]));
    expect(onHint).toHaveBeenLastCalledWith(editStrings.hintMeasureEnd);
    expect(svg.querySelector('[data-edit-measure-start]')).not.toBeNull();
    tapAt(svg, scr(svg, [4.01, 5.01]));
    expect(svg.querySelector('[data-edit-dimension="measure"]')!.textContent).toBe('5,00 m');
    expect(onHint).toHaveBeenLastCalledWith(editStrings.hintMeasure);
    tapAt(svg, scr(svg, [2.01, 2.01]));
    expect(svg.querySelector('[data-edit-dimension="measure"]')).toBeNull();
    expect(svg.querySelector('[data-edit-measure-start]')).not.toBeNull();
    expect(escape().defaultPrevented).toBe(true);
    expect(svg.querySelector('[data-edit-measure-start]')).toBeNull();
  });

  it('Møbler: a click hands the item and the point to onDropFurniture', () => {
    const onDropFurniture = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: mockActions(), tool: 'furniture', toolOptions: { furnitureItem: 'seng-150' }, onDropFurniture }));
    tapAt(svg, scr(svg, [2, 2]));
    expect(onDropFurniture).toHaveBeenCalledTimes(1);
    const [id, p] = onDropFurniture.mock.calls[0] as [string, Vec2];
    expect(id).toBe('seng-150');
    expect(p[0]).toBeCloseTo(2, 6);
    expect(p[1]).toBeCloseTo(2, 6);
  });

  it('placement tools are off without `editable` (a tap selects)', () => {
    const actions = mockActions();
    const onSelect = vi.fn();
    const svg = render(baseProps({ editable: false, editActions: actions, onSelect, tool: 'wall' }));
    expect(svg.getAttribute('data-plan-tool')).toBe('select');
    tapAt(svg.querySelector('[data-room-id="rom-bad"]')!, scr(svg, [8.5, 4.5]));
    expect(actions.addWall).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith({ kind: 'room', id: 'rom-bad', levelId: 'main' });
  });
});

function withFurniture(): DerivedVariant {
  const d = createPlanFixture();
  const item: DerivedFurniture = {
    id: 'f-seng',
    item: { id: 'f-seng', catalogId: 'seng-150', position: [12, 2], rotationDeg: 0, levelId: 'main', size: { w: 1.5, d: 2, h: 0.5 }, isNew: true },
    catalog: { id: 'seng-150', name: 'Seng 150' },
    footprint: [
      [11.25, 1],
      [12.75, 1],
      [12.75, 3],
      [11.25, 3],
    ],
    bbox: { min: [11.25, 1], max: [12.75, 3] },
    levelId: 'main',
    roomId: 'rom-soverom',
    floorZ: 0,
    z: 0,
    clearances: [
      [
        [11.25, 3],
        [12.75, 3],
        [12.75, 3.6],
        [11.25, 3.6],
      ],
    ],
    collisions: [],
    blocksDoors: [],
    needsDrain: false,
    isNew: true,
  };
  return { ...d, furniture: [item, { ...item, id: 'f-hems', levelId: 'loft', item: { ...item.item, id: 'f-hems', levelId: 'loft' } }] };
}

describe('ghosts, legend, furniture and temporary overlays', () => {
  it('selects every dashed ghost as kind "ghost" and outlines the selected one', () => {
    const onSelect = vi.fn();
    const derived = { ...createPlanFixture(), ghosts: [{ id: 'g-1', a: [0, 0] as Vec2, b: [0, 6] as Vec2 }] };
    const svg = render(baseProps({ derived, onSelect }));
    tapAt(svg.querySelector('[data-wall-id="w-rives"]')!, scr(svg, [0.8, 3.5]));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'ghost', id: 'w-rives' });
    tapAt(svg.querySelector('[data-opening-id="win-old"] path[pointer-events="fill"]')!, scr(svg, [1.5, 6]));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'ghost', id: 'win-old' });
    tapAt(svg.querySelector('[data-ghost-corridor="g-1"]')!, scr(svg, [0, 3]));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'ghost', id: 'g-1' });
    render(baseProps({ derived, selection: { kind: 'ghost' as never, id: 'w-rives' } }));
    expect(svg.querySelector('[data-wall-id="w-rives"]')!.getAttribute('stroke')).toBe(ACCENT);
    render(baseProps({ derived, selection: { kind: 'ghost' as never, id: 'g-1' } }));
    expect(svg.querySelector('[data-ghost-id="g-1"]')!.getAttribute('stroke')).toBe(ACCENT);
  });

  it('shows the legend "Hytta i dag / Nytt / Fjernet" with "highlight new" only', () => {
    const on = render(baseProps({ highlightNew: true }));
    const legend = on.querySelector('[data-overlay="legend"]')!;
    expect([...legend.querySelectorAll('text')].map((t) => t.textContent)).toEqual([editStrings.legendExisting, editStrings.legendNew, editStrings.legendRemoved]);
    expect(legend.querySelector('[data-legend-item="removed"] rect')!.getAttribute('stroke-dasharray')).toBe('3 2');
    const off = render(baseProps({ highlightNew: false }));
    expect(off.querySelector('[data-overlay="legend"]')).toBeNull();
  });

  it('selects deck steps and marks blocked ones', () => {
    const onSelect = vi.fn();
    const derived = createPlanFixture();
    const svg = render(baseProps({ derived, onSelect }));
    tapAt(svg.querySelector('[data-steps-id="deck-1/steps/0"] path')!, scr(svg, [11.5, -3.2]));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'steps', id: 'deck-1/steps/0' });
    render(baseProps({ derived: { ...derived, outdoor: { ...derived.outdoor, steps: [{ ...derived.outdoor.steps[0], blocked: true }] } } }));
    expect(svg.querySelector('[data-steps-id="deck-1/steps/0"]')!.getAttribute('data-steps-blocked')).toBe('true');
  });

  it('draws furniture of the storey as named rectangles, selectable, with clearances on request', () => {
    const onSelect = vi.fn();
    const svg = render(baseProps({ derived: withFurniture(), onSelect }));
    expect(svg.querySelectorAll('[data-furniture-id]')).toHaveLength(1);
    expect(svg.querySelector('[data-furniture-label="f-seng"]')!.textContent).toBe('Seng 150');
    expect(svg.querySelector('[data-clearance-of]')).toBeNull();
    tapAt(svg.querySelector('[data-furniture-id="f-seng"] path')!, scr(svg, [12, 2]));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'furniture', id: 'f-seng', levelId: 'main' });
    render(baseProps({ derived: withFurniture(), showClearances: true, selection: { kind: 'furniture', id: 'f-seng' } }));
    expect(svg.querySelector('[data-clearance-of="f-seng"]')).not.toBeNull();
    expect(svg.querySelector('[data-furniture-id="f-seng"] path')!.getAttribute('stroke')).toBe(ACCENT);
    render(baseProps({ derived: withFurniture(), planStorey: 'loft' }));
    expect([...svg.querySelectorAll('[data-furniture-id]')].map((e) => e.getAttribute('data-furniture-id'))).toEqual(['f-hems']);
  });

  it('drags the selected furniture item', () => {
    const actions = mockActions();
    const svg = render(baseProps({ derived: withFurniture(), editable: true, editActions: actions, selection: { kind: 'furniture', id: 'f-seng', levelId: 'main' } }));
    const at = scr(svg, [12, 2]);
    act(() => {
      pointer(svg.querySelector('[data-furniture-id="f-seng"] path')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 30, 0));
      pointer(svg, 'pointerup', plus(at, 30, 0));
    });
    expect(actions.beginDrag.mock.calls[0][0]).toEqual({ kind: 'furniture', id: 'f-seng' });
  });

  it('draws "Avstand fra hjørne" for the focused opening, extra dimensions and highlighted walls', () => {
    const svg = render(baseProps({ overlay: { cornerDimensionFor: 'd-bad', dimensions: [{ a: [0, 0], b: [2, 0] }], highlightWalls: [{ wallId: 'w-bad-s', arrow: [0, 1] }] } }));
    expect(svg.querySelector('[data-edit-dimension="corner"]')!.textContent).toBe('0,75 m');
    expect(svg.querySelector('[data-edit-dimension="extra"]')!.textContent).toBe('2,00 m');
    expect(svg.querySelector('[data-edit-highlight] path')).not.toBeNull();
    expect(svg.querySelector('[data-edit-arrow]')).not.toBeNull();
    render(baseProps({ overlay: {} }));
    expect(svg.querySelector('[data-edit-dimension]')).toBeNull();
    // The properties panel's highlight shape (ui/overlay.ts PanelHighlight) is accepted as is.
    render(baseProps({ overlay: { highlight: { kind: 'dimension', a: [1, 1], b: [1, 2.5], text: '1,50' } } }));
    expect(svg.querySelector('[data-edit-dimension="extra"]')!.textContent).toBe('1,50');
    render(baseProps({ overlay: { highlight: { kind: 'wall', wallId: 'w-bad-w', arrow: [-1, 0] } } }));
    expect(svg.querySelectorAll('[data-edit-highlight]')).toHaveLength(1);
    expect(svg.querySelector('[data-edit-arrow]')).not.toBeNull();
  });

  it('reports the mini-bar anchor above the selection, null while dragging and without a selection', () => {
    const onSelectionBar = vi.fn<(a: SelectionBarAnchor | null) => void>();
    const actions = mockActions();
    const svg = render(baseProps({ editable: true, editActions: actions, onSelectionBar, selection: WALL_SEL }));
    const a = onSelectionBar.mock.calls.at(-1)![0]!;
    const left = scr(svg, [7, 3.05]);
    const right = scr(svg, [10, 2.95]);
    expect(a.box.x0).toBeCloseTo(left[0], 6);
    expect(a.box.x1).toBeCloseTo(right[0], 6);
    expect(a.y).toBeCloseTo(left[1], 6);
    expect(a.x).toBeCloseTo((left[0] + right[0]) / 2, 6);
    expect(a.localX).toBe(a.x); // jsdom: the SVG sits at the viewport origin
    expect(a.localY).toBe(a.y);
    const calls = onSelectionBar.mock.calls.length;
    render(baseProps({ editable: true, editActions: actions, onSelectionBar, selection: WALL_SEL }));
    expect(onSelectionBar.mock.calls.length).toBe(calls);
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 0, -30));
    });
    expect(onSelectionBar).toHaveBeenLastCalledWith(null);
    act(() => pointer(svg, 'pointerup', plus(at, 0, -30)));
    expect(onSelectionBar.mock.calls.at(-1)![0]).not.toBeNull();
    render(baseProps({ editable: true, editActions: actions, onSelectionBar, selection: null }));
    expect(onSelectionBar).toHaveBeenLastCalledWith(null);
  });

  it('takes furniture library drags through the handle: marker while over the plan, drop on release', () => {
    const ref = createRef<PlanViewHandle>();
    const onDropFurniture = vi.fn();
    const svg = render(baseProps({ onDropFurniture }), ref);
    const at = scr(svg, [12, 2]);
    let over = false;
    act(() => {
      over = ref.current!.furnitureDragOver('seng-150', at[0], at[1]);
    });
    expect(over).toBe(true);
    expect(svg.querySelector('[data-edit-drop-preview]')).not.toBeNull();
    act(() => {
      over = ref.current!.furnitureDragOver('seng-150', -50, 20);
    });
    expect(over).toBe(false);
    expect(svg.querySelector('[data-edit-drop-preview]')).toBeNull();
    let dropped = false;
    act(() => {
      dropped = ref.current!.dropFurniture('seng-150', at[0], at[1]);
    });
    expect(dropped).toBe(true);
    const [id, p] = onDropFurniture.mock.calls[0] as [string, Vec2];
    expect(id).toBe('seng-150');
    expect(p[0]).toBeCloseTo(12, 6);
    expect(p[1]).toBeCloseTo(2, 6);
    expect(ref.current!.dropFurniture('seng-150', 5000, 5000)).toBe(false);
    const c = ref.current!.visibleCenter();
    const centre = scr(svg, c);
    expect(centre[0]).toBeCloseTo(500, 6);
    expect(centre[1]).toBeCloseTo(350, 6);
    expect(ref.current!.clientToPlan(-1, 10)).toBeNull();
  });
});
