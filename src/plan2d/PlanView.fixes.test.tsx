// @vitest-environment jsdom
/**
 * The plan's fix round after phase 2a (UX and editor reviews): the drag loop (one updateDrag per animation frame),
 * drags on the locked base proposal, small selected things and their handles, room labels as tap targets, the
 * mini-bar anchor (box, scroll / resize) and `viewportInsets`. The edit API is a mock of the drag protocol, as in
 * PlanView.edit.test.tsx.
 */
import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import type { Vec2 } from '../model/types';
import type { SelectionBarAnchor } from './editTypes';
import { createPlanFixture, createPlanFixtureSite } from './fixture';
import { PlanView } from './PlanView';

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
  vi.unstubAllGlobals();
});

const SESSION = { id: 'session-1' };

type Fn = (...args: unknown[]) => unknown;

function mockActions(o: { beginDrag?: Fn } = {}) {
  return {
    beginDrag: vi.fn<Fn>(o.beginDrag ?? (() => SESSION)),
    updateDrag: vi.fn<Fn>(() => ({ indicators: [], chips: [], ghost: [[[7, 2.9], [10, 2.9], [10, 3.1], [7, 3.1]]] })),
    endDrag: vi.fn<Fn>(),
    cancelDrag: vi.fn<Fn>(),
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

function render(props: Props) {
  act(() => root.render(<PlanView {...props} />));
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

/** Plan point under a screen point. */
function plan(svg: SVGSVGElement, q: Vec2): Vec2 {
  const [s, , , , tx, ty] = rootMatrix(svg);
  return [(q[0] - tx) / s, -(q[1] - ty) / s];
}

function pointer(el: Element, type: string, at: Vec2, o: { id?: number; pointerType?: string } = {}) {
  const id = o.id ?? 1;
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: at[0], clientY: at[1], pointerId: id, button: 0, pointerType: o.pointerType ?? 'mouse', isPrimary: id === 1 }));
}

const plus = (a: Vec2, dx: number, dy: number): Vec2 => [a[0] + dx, a[1] + dy];

/** A manual requestAnimationFrame queue (the plan coalesces drag updates and window scroll / resize to frames). */
function stubFrames() {
  const queue = new Map<number, FrameRequestCallback>();
  let next = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.set(next, cb);
    return next++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => void queue.delete(id));
  return {
    pending: () => queue.size,
    flush: () =>
      act(() => {
        const cbs = [...queue.values()];
        queue.clear();
        for (const cb of cbs) cb(0);
      }),
  };
}

const WALL_SEL = { kind: 'wall' as const, id: 'w-bad-s', levelId: 'main' };

describe('the drag loop: one updateDrag per animation frame', () => {
  it('10 moves in one frame → 1 updateDrag; the overlay keeps the last feedback; release flushes the last position', () => {
    const frames = stubFrames();
    const actions = mockActions();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: WALL_SEL }));
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 0, -20));
    });
    // The start updates right away (and the same position is not queued again).
    expect(actions.updateDrag).toHaveBeenCalledTimes(1);
    expect(frames.pending()).toBe(0);
    act(() => {
      for (let i = 1; i <= 10; i++) pointer(svg, 'pointermove', plus(at, 0, -20 - 3 * i));
    });
    expect(actions.updateDrag).toHaveBeenCalledTimes(1);
    expect(frames.pending()).toBe(1);
    expect(svg.querySelector('[data-edit-ghost]')).not.toBeNull();
    frames.flush();
    expect(actions.updateDrag).toHaveBeenCalledTimes(2);
    expect((actions.updateDrag.mock.calls[1] as [unknown, Vec2])[1][1]).toBeCloseTo(plan(svg, plus(at, 0, -50))[1], 9);
    expect(svg.querySelector('[data-edit-ghost]')).not.toBeNull();
    // Moves, then the release before the next frame: the last position is applied, then endDrag.
    act(() => {
      pointer(svg, 'pointermove', plus(at, 0, -60));
      pointer(svg, 'pointermove', plus(at, 0, -70));
      pointer(svg, 'pointerup', plus(at, 0, -70));
    });
    expect(actions.updateDrag).toHaveBeenCalledTimes(3);
    expect((actions.updateDrag.mock.calls[2] as [unknown, Vec2])[1][1]).toBeCloseTo(plan(svg, plus(at, 0, -70))[1], 9);
    expect(actions.endDrag).toHaveBeenCalledTimes(1);
    expect(actions.updateDrag.mock.invocationCallOrder[2]).toBeLessThan(actions.endDrag.mock.invocationCallOrder[0]);
    expect(frames.pending()).toBe(0);
  });

  it('a cancelled drag drops its queued update', () => {
    const frames = stubFrames();
    const actions = mockActions();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: WALL_SEL }));
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 0, -20));
      pointer(svg, 'pointermove', plus(at, 0, -40));
      pointer(svg, 'pointercancel', plus(at, 0, -40));
    });
    expect(actions.cancelDrag).toHaveBeenCalledTimes(1);
    expect(frames.pending()).toBe(0);
    frames.flush();
    expect(actions.updateDrag).toHaveBeenCalledTimes(1);
    expect(actions.endDrag).not.toHaveBeenCalled();
  });
});

describe('the locked base proposal: a drag of the selection explains instead of panning', () => {
  const locked = (): DerivedVariant => ({ ...createPlanFixture(), locked: true });

  function dragWall(svg: SVGSVGElement) {
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at);
      for (let i = 1; i <= 5; i++) pointer(svg, 'pointermove', plus(at, 8 * i, 4 * i));
      pointer(svg, 'pointerup', plus(at, 40, 20));
    });
  }

  it('asks the refusing beginDrag once (its locked toast) and does not pan; a drag elsewhere still pans', () => {
    const actions = mockActions({ beginDrag: () => null });
    const onSelect = vi.fn();
    const svg = render(baseProps({ derived: locked(), editable: false, editActions: actions, onSelect, selection: WALL_SEL }));
    const before = rootMatrix(svg);
    dragWall(svg);
    expect(rootMatrix(svg)).toEqual(before);
    expect(actions.beginDrag).toHaveBeenCalledTimes(1);
    expect(actions.beginDrag.mock.calls[0][0]).toEqual({ kind: 'wall', id: 'w-bad-s' });
    expect(actions.updateDrag).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    // Empty paper pans as before.
    const empty = scr(svg, [20, 10]);
    act(() => {
      pointer(svg, 'pointerdown', empty);
      pointer(svg, 'pointermove', plus(empty, 40, 0));
      pointer(svg, 'pointerup', plus(empty, 40, 0));
    });
    expect(rootMatrix(svg)[4]).toBeCloseTo(before[4] + 40, 6);
    expect(actions.beginDrag).toHaveBeenCalledTimes(1);
  });

  it('calls onLocked instead when the UI passes it', () => {
    const actions = mockActions();
    const onLocked = vi.fn();
    const svg = render(baseProps({ derived: locked(), editable: false, editActions: actions, onLocked, selection: WALL_SEL }));
    const before = rootMatrix(svg);
    dragWall(svg);
    expect(onLocked).toHaveBeenCalledTimes(1);
    expect(actions.beginDrag).not.toHaveBeenCalled();
    expect(rootMatrix(svg)).toEqual(before);
  });
});

describe('small selected things and their handles', () => {
  const DOOR_SEL = { kind: 'opening' as const, id: 'd-bad', levelId: 'main' };
  const zoomIn = (svg: SVGSVGElement) =>
    act(() => {
      for (let i = 0; i < 2; i++) svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, clientX: 500, clientY: 350, bubbles: true, cancelable: true }));
    });

  it('a door narrower than 3 handle diameters on screen has no end handles and moves from its middle', () => {
    const actions = mockActions();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: DOOR_SEL }));
    expect(0.8 * rootMatrix(svg)[0]).toBeLessThan(42);
    expect(svg.querySelector('[data-handle]')).toBeNull();
    const at = scr(svg, [7, 4.2]);
    act(() => {
      pointer(svg.querySelector('[data-opening-id="d-bad"] path[pointer-events="fill"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 0, -20));
      pointer(svg, 'pointerup', plus(at, 0, -20));
    });
    expect(actions.beginDrag.mock.calls[0][0]).toEqual({ kind: 'opening', id: 'd-bad' });
    expect(actions.beginDrag.mock.calls[0][2]).toBeUndefined();
  });

  it('zoomed in the end handles are back, just outside the jambs; a press inside the door still moves it', () => {
    const actions = mockActions();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: DOOR_SEL }));
    zoomIn(svg);
    expect(0.8 * rootMatrix(svg)[0]).toBeGreaterThan(42);
    const start = svg.querySelector('[data-handle="oe:start"] circle')!;
    const c: Vec2 = [Number(start.getAttribute('cx')), Number(start.getAttribute('cy'))];
    // The start jamb is at y 3,8 (the door runs +y along w-bad-w); the handle sits 7 px beyond it (screen y down).
    const jamb = scr(svg, [7, 3.8]);
    expect(c[0]).toBeCloseTo(jamb[0], 0);
    expect(c[1]).toBeCloseTo(jamb[1] + 7, 0);
    // A press that lands on a handle element but inside the door's footprint moves the door.
    const inside = scr(svg, [7, 3.85]);
    act(() => {
      pointer(start, 'pointerdown', inside);
      pointer(svg, 'pointermove', plus(inside, 0, -20));
      pointer(svg, 'pointerup', plus(inside, 0, -20));
    });
    expect(actions.beginDrag.mock.calls[0][0]).toEqual({ kind: 'opening', id: 'd-bad' });
    expect(actions.beginDrag.mock.calls[0][2]).toBeUndefined();
    // On the handle itself (outside the door) it resizes, acting on the jamb: beginDrag gets the jamb's position.
    act(() => {
      pointer(start, 'pointerdown', c);
      pointer(svg, 'pointermove', plus(c, 0, 20));
      pointer(svg, 'pointerup', plus(c, 0, 20));
    });
    const [target, p0, handle] = actions.beginDrag.mock.calls[1] as [unknown, Vec2, unknown];
    expect(target).toEqual({ kind: 'opening', id: 'd-bad' });
    expect(handle).toBe('start');
    expect(p0[0]).toBeCloseTo(7, 2);
    expect(p0[1]).toBeCloseTo(3.8, 2);
  });

  it('a wall end handle drawn beyond the end drags that end as if the end itself was grabbed', () => {
    const actions = mockActions();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: WALL_SEL }));
    const circle = svg.querySelector('[data-handle="we:b"] circle')!;
    const c: Vec2 = [Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))];
    expect(c[0]).toBeCloseTo(scr(svg, [10, 3])[0] + 7, 0);
    act(() => {
      pointer(circle, 'pointerdown', c);
      pointer(svg, 'pointermove', plus(c, 20, 0));
      pointer(svg, 'pointerup', plus(c, 20, 0));
    });
    const [, p0, handle] = actions.beginDrag.mock.calls[0] as [unknown, Vec2, unknown];
    expect(handle).toBe('b');
    expect(p0[0]).toBeCloseTo(10, 2);
    expect(p0[1]).toBeCloseTo(3, 2);
    const s = rootMatrix(svg)[0];
    expect((actions.updateDrag.mock.calls.at(-1) as [unknown, Vec2])[1][0]).toBeCloseTo(10 + 20 / s, 2);
  });
});

describe('taps on room labels', () => {
  it('each drawn label is a hit area of its room, above the walls and openings', () => {
    const onSelect = vi.fn();
    const svg = render(baseProps({ onSelect, coarsePointer: true }));
    const hit = svg.querySelector('[data-room-label-hit="rom-bad"]')!;
    expect(hit).not.toBeNull();
    expect(hit.getAttribute('pointer-events')).toBe('fill');
    expect(hit.getAttribute('data-sel-kind')).toBe('room');
    // Drawn after (on top of) the wall and opening hit areas.
    const walls = svg.querySelector('[data-layer="walls"]')!;
    const openings = svg.querySelector('[data-layer="openings"]')!;
    expect(walls.compareDocumentPosition(hit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(openings.compareDocumentPosition(hit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const at = scr(svg, [8.5, 4.5]);
    act(() => {
      pointer(hit, 'pointerdown', at, { pointerType: 'touch' });
      pointer(hit, 'pointerup', at, { pointerType: 'touch' });
    });
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'room', id: 'rom-bad', levelId: 'main' });
  });
});

describe('the selection mini-bar anchor and the uncovered viewport', () => {
  const rect = (top: number, left = 0) => () => ({ left, top, right: left + 1000, bottom: top + 700, width: 1000, height: 700, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

  it('reports the selection box (viewport px) and re-reports after a pan and on window scroll / resize, once per frame', () => {
    const frames = stubFrames();
    const onSelectionBar = vi.fn<(a: SelectionBarAnchor | null) => void>();
    const svg = render(baseProps({ onSelectionBar, selection: WALL_SEL }));
    const a = onSelectionBar.mock.calls.at(-1)![0]!;
    expect(a.rect.left).toBeCloseTo(a.box.x0, 6);
    expect(a.rect.top).toBeCloseTo(a.box.y0, 6);
    expect(a.rect.width).toBeCloseTo(a.box.x1 - a.box.x0, 6);
    expect(a.rect.height).toBeCloseTo(a.box.y1 - a.box.y0, 6);
    // A pan moves it.
    const empty = scr(svg, [20, 10]);
    act(() => {
      pointer(svg, 'pointerdown', empty);
      pointer(svg, 'pointermove', plus(empty, 30, 0));
      pointer(svg, 'pointerup', plus(empty, 30, 0));
    });
    const panned = onSelectionBar.mock.calls.at(-1)![0]!;
    expect(panned.x).toBeCloseTo(a.x + 30, 6);
    expect(panned.rect.left).toBeCloseTo(a.rect.left + 30, 6);
    // The page scrolls 120 px: the plan's box moves up without a render; three scroll events → one report.
    const calls = onSelectionBar.mock.calls.length;
    svg.getBoundingClientRect = rect(-120);
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      document.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('scroll'));
    });
    expect(onSelectionBar.mock.calls.length).toBe(calls);
    frames.flush();
    expect(onSelectionBar.mock.calls.length).toBe(calls + 1);
    const scrolled = onSelectionBar.mock.calls.at(-1)![0]!;
    expect(scrolled.y).toBeCloseTo(panned.y - 120, 6);
    expect(scrolled.rect.top).toBeCloseTo(panned.rect.top - 120, 6);
    // A resize that moves the plan.
    svg.getBoundingClientRect = rect(40, 10);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    frames.flush();
    const resized = onSelectionBar.mock.calls.at(-1)![0]!;
    expect(resized.y).toBeCloseTo(panned.y + 40, 6);
    expect(resized.x).toBeCloseTo(panned.x + 10, 6);
  });

  it('viewportInsets: a wall under a 345 px bottom sheet is panned just above it; never zoomed; a fitting one stays', () => {
    const piece = 'blk-a/a-sw/blk-a-rest/base';
    const sel = { kind: 'wall' as const, id: piece, levelId: 'main' };
    const derived = createPlanFixture();
    const footprint = derived.walls.find((w) => w.id === piece)!.footprint;
    const svg = render(baseProps({ derived, selection: sel }));
    const bottom = () => Math.max(...footprint.map((p) => scr(svg, p)[1]));
    const before = rootMatrix(svg);
    expect(bottom()).toBeGreaterThan(700 - 345);
    const insets = { top: 0, right: 0, bottom: 345, left: 0 };
    render(baseProps({ derived, selection: sel, viewportInsets: insets }));
    const after = rootMatrix(svg);
    expect(after[0]).toBe(before[0]);
    expect(after[4]).toBe(before[4]);
    expect(bottom()).toBeCloseTo(700 - 345 - 12, 6);
    // The same insets again (a new object): nothing moves.
    render(baseProps({ derived, selection: sel, viewportInsets: { ...insets } }));
    expect(rootMatrix(svg)).toEqual(after);
    // A selection that already fits above the sheet: nothing moves.
    render(baseProps({ derived, selection: WALL_SEL, viewportInsets: { ...insets } }));
    expect(rootMatrix(svg)).toEqual(after);
  });
});
