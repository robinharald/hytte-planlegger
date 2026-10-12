// @vitest-environment jsdom
/**
 * The plan's editor polish (phase 2b, plan side), through the rendered PlanView with a mock of the edit API:
 *  - adaptive drag: `previewDrag` every frame, `updateDrag` at most every T = clamp(2 × its last duration, 16, 150) ms,
 *    the last position applied before `endDrag` (the second review: wall, edge, block and unit drags ran at ≈ 3 fps on
 *    a phone-class CPU because every frame derived the building stage);
 *  - short moves with a finger: a press on the selection that moves 6–10 px is a drag, not a tap that changes the
 *    selection;
 *  - room labels on narrow rooms: a tap the DOM gives to a wall band but that lies on a drawn label selects the room
 *    outside the band's ±4,5 px core («Bod (ny)» at the phone's starting zoom).
 */
import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import type { Vec2 } from '../model/types';
import * as A from '../state/editActions';
import { createAppStore, selectActiveVariant } from '../state/store';
import { deriveForState } from '../state/useDerived';
import { LABEL_TAP_CORE_PX, labelTap, parseLabelBox, wallsById } from './editModel';
import type { PlanSelection } from './editTypes';
import { svgElementAt } from './svgHitTest';
import type { LabelBox } from './editModel';
import { EMPTY_FEEDBACK, normalizeFeedback, normalizePreview } from './editFeedback';
import { createPlanFixture, createPlanFixtureSite } from './fixture';
import { PlanView } from './PlanView';
import { UPDATE_INTERVAL_MAX_MS, UPDATE_INTERVAL_MIN_MS, labelBoxesNear, previewFeedback, updateInterval } from './usePlanEditing';

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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Fn = (...args: unknown[]) => unknown;
const SESSION = { id: 'session-1' };
/** The dragged wall's base outline (updateDrag's ghost) and a preview outline that follows the pointer. */
const BASE: Vec2[] = [
  [7, 2.9],
  [10, 2.9],
  [10, 3.1],
  [7, 3.1],
];

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

function scr(svg: SVGSVGElement, p: Vec2): Vec2 {
  const [s, , , , tx, ty] = rootMatrix(svg);
  return [s * p[0] + tx, -s * p[1] + ty];
}

function plan(svg: SVGSVGElement, q: Vec2): Vec2 {
  const [s, , , , tx, ty] = rootMatrix(svg);
  return [(q[0] - tx) / s, -(q[1] - ty) / s];
}

function pointer(el: Element, type: string, at: Vec2, pointerType = 'mouse') {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: at[0], clientY: at[1], pointerId: 1, button: 0, pointerType, isPrimary: true }));
}

const plus = (a: Vec2, dx: number, dy: number): Vec2 => [a[0] + dx, a[1] + dy];

const WALL_SEL = { kind: 'wall' as const, id: 'w-bad-s', levelId: 'main' };

describe('updateInterval and previewFeedback', () => {
  it('T = clamp(2 × the last updateDrag duration, 16, 150) ms', () => {
    expect([UPDATE_INTERVAL_MIN_MS, UPDATE_INTERVAL_MAX_MS]).toEqual([16, 150]);
    expect(updateInterval(0)).toBe(16);
    expect(updateInterval(3)).toBe(16);
    expect(updateInterval(20)).toBe(40);
    expect(updateInterval(45)).toBe(90);
    expect(updateInterval(100)).toBe(150);
    expect(updateInterval(300)).toBe(150);
    expect(updateInterval(Number.NaN)).toBe(16);
  });

  it('draws the moving outline (the preview\'s target) over the base outline, without drawing the base twice', () => {
    const target: Vec2[] = BASE.map(([x, y]) => [x, y + 0.5]);
    // The real shape (state/editActions.ts previewDrag): ghost = the base outline, target = the moving outline.
    const preview = { ...EMPTY_FEEDBACK, ghost: [BASE], target: [target], chips: [{ at: [8, 3] as Vec2, text: '1,00 m' }] };
    const fb = previewFeedback(preview, [BASE]);
    expect(fb.ghost).toEqual([BASE, target]);
    expect(fb.target).toEqual([target]);
    expect(fb.chips).toEqual(preview.chips);
    // Before the first updateDrag: the preview's own ghost is the base outline.
    expect(previewFeedback(preview, []).ghost).toEqual([BASE, target]);
    // A preview at the pointer-down place: one outline.
    expect(previewFeedback({ ...preview, target: [BASE] }, [BASE]).ghost).toEqual([BASE]);
    // An API without `target` that sends the moving outline as its ghost: as before.
    expect(previewFeedback({ ...EMPTY_FEEDBACK, ghost: [target] }, [BASE]).ghost).toEqual([BASE, target]);
    expect(previewFeedback({ ...EMPTY_FEEDBACK, ghost: [target] }, []).ghost).toEqual([target]);
  });

  it('normalizePreview keeps the target that normalizeFeedback drops', () => {
    const target: Vec2[] = BASE.map(([x, y]) => [x, y + 0.5]);
    const raw = { indicators: [], chips: [], ghost: [BASE], target: [target] };
    expect(normalizeFeedback(raw).ghost).toEqual([BASE]);
    expect(normalizePreview(raw).ghost).toEqual([BASE]);
    expect(normalizePreview(raw).target).toEqual([target]);
    expect(normalizePreview({ ghost: [BASE] }).target).toEqual([]);
    expect(normalizePreview(null).target).toEqual([]);
  });
});

describe('adaptive drag: previewDrag every frame, updateDrag at most every T ms', () => {
  /** A drag API whose updateDrag takes `cost` ms on the mocked clock (performance.now). */
  function slowActions(clock: { t: number }, cost: number) {
    return {
      beginDrag: vi.fn<Fn>(() => SESSION),
      // The real shape (state/editActions.ts DragPreview): ghost = the base outline, target = the moving outline.
      previewDrag: vi.fn<Fn>((_s, p) => {
        const q = p as Vec2;
        return { indicators: [{ kind: 'grid', p: q }], chips: [], ghost: [BASE], target: [[[q[0] - 1.5, q[1] - 0.1], [q[0] + 1.5, q[1] - 0.1], [q[0] + 1.5, q[1] + 0.1], [q[0] - 1.5, q[1] + 0.1]]] };
      }),
      updateDrag: vi.fn<Fn>(() => {
        clock.t += cost;
        return { indicators: [], chips: [], ghost: [BASE] };
      }),
      endDrag: vi.fn<Fn>(),
      cancelDrag: vi.fn<Fn>(),
    };
  }

  function setup(cost: number) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const clock = { t: 1000 };
    vi.spyOn(performance, 'now').mockImplementation(() => clock.t);
    const actions = slowActions(clock, cost);
    const svg = render(baseProps({ editable: true, editActions: actions, selection: WALL_SEL }));
    /** One 16 ms frame: the clock and the timers move on together. */
    const frame = () =>
      act(() => {
        clock.t += 16;
        vi.advanceTimersByTime(16);
      });
    return { clock, actions, svg, frame };
  }

  it('updateDrag stubbed at 100 ms: 20 frames give 20 previews, at most 3 updates, and the last position is applied', () => {
    const { actions, svg, frame } = setup(100);
    const at = scr(svg, [8.5, 3]);
    // Frame 1: the press passes the threshold; the drag starts with a preview and the first update right away.
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 0, -10));
    });
    expect(actions.beginDrag).toHaveBeenCalledTimes(1);
    expect(actions.previewDrag).toHaveBeenCalledTimes(1);
    expect(actions.updateDrag).toHaveBeenCalledTimes(1);
    // Frames 2 … 20: one pointer move each.
    let last = plus(at, 0, -10);
    for (let i = 2; i <= 20; i++) {
      last = plus(at, 0, -10 - 3 * i);
      act(() => pointer(svg, 'pointermove', last));
      frame();
      // The overlay follows the finger on every frame: the preview's outline is drawn at the pointer.
      const ghosts = [...svg.querySelectorAll('[data-edit-ghost]')];
      expect(ghosts.length).toBe(2);
    }
    expect(actions.previewDrag).toHaveBeenCalledTimes(20);
    // 1000 → 1100 (first update), then T = 150 ms: the next at frame 11, the one after that would be frame 21.
    expect(actions.updateDrag).toHaveBeenCalledTimes(2);
    act(() => pointer(svg, 'pointerup', last));
    expect(actions.updateDrag).toHaveBeenCalledTimes(3);
    // The final updateDrag applies the last pointer position, before endDrag.
    const final = actions.updateDrag.mock.calls.at(-1) as [unknown, Vec2];
    expect(final[0]).toBe(SESSION);
    expect(final[1][1]).toBeCloseTo(plan(svg, last)[1], 9);
    expect(actions.endDrag).toHaveBeenCalledTimes(1);
    expect(actions.updateDrag.mock.invocationCallOrder.at(-1)!).toBeLessThan(actions.endDrag.mock.invocationCallOrder[0]);
    // Every preview got the session, a pointer and the modifiers.
    const [s, p, mods] = actions.previewDrag.mock.calls.at(-1) as [unknown, Vec2, { snapRadiusM: number }];
    expect(s).toBe(SESSION);
    expect(p[1]).toBeCloseTo(plan(svg, last)[1], 9);
    expect(mods.snapRadiusM).toBeGreaterThan(0);
  });

  it('a fast updateDrag (5 ms) runs every frame: T is 16 ms', () => {
    const { actions, svg, frame } = setup(5);
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 0, -10));
    });
    for (let i = 2; i <= 10; i++) {
      act(() => pointer(svg, 'pointermove', plus(at, 0, -10 - 3 * i)));
      frame();
    }
    expect(actions.previewDrag).toHaveBeenCalledTimes(10);
    expect(actions.updateDrag).toHaveBeenCalledTimes(10);
    act(() => pointer(svg, 'pointerup', plus(at, 0, -40)));
    // The last position was applied in its frame already: no second update for it.
    expect(actions.updateDrag).toHaveBeenCalledTimes(10);
    expect(actions.endDrag).toHaveBeenCalledTimes(1);
  });

  it('when the finger rests, the waiting position is applied once T has passed, without more moves', () => {
    const { actions, svg, frame } = setup(100);
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 0, -10));
    });
    act(() => pointer(svg, 'pointermove', plus(at, 0, -30)));
    frame();
    expect(actions.updateDrag).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 12; i++) frame();
    expect(actions.updateDrag).toHaveBeenCalledTimes(2);
    expect((actions.updateDrag.mock.calls[1] as [unknown, Vec2])[1][1]).toBeCloseTo(plan(svg, plus(at, 0, -30))[1], 9);
    // Nothing waits any more: the loop stops, and the release adds no update.
    for (let i = 0; i < 12; i++) frame();
    expect(actions.updateDrag).toHaveBeenCalledTimes(2);
    expect(actions.previewDrag).toHaveBeenCalledTimes(2);
    act(() => pointer(svg, 'pointerup', plus(at, 0, -30)));
    expect(actions.updateDrag).toHaveBeenCalledTimes(2);
    expect(actions.endDrag).toHaveBeenCalledTimes(1);
  });

  it('a previewDrag that throws does not break the drag: the rest of it updates every frame', () => {
    const { actions, svg, frame } = setup(100);
    actions.previewDrag.mockImplementation(() => {
      throw new Error('no preview for this kind');
    });
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 0, -10));
    });
    for (let i = 2; i <= 5; i++) {
      act(() => pointer(svg, 'pointermove', plus(at, 0, -10 - 3 * i)));
      frame();
    }
    expect(actions.previewDrag).toHaveBeenCalledTimes(1);
    expect(actions.updateDrag).toHaveBeenCalledTimes(5);
    act(() => pointer(svg, 'pointerup', plus(at, 0, -25)));
    expect(actions.endDrag).toHaveBeenCalledTimes(1);
  });

  it('a cancelled drag drops the waiting position: no update after cancelDrag', () => {
    const { actions, svg, frame } = setup(100);
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 0, -10));
      pointer(svg, 'pointermove', plus(at, 0, -40));
    });
    frame();
    act(() => pointer(svg, 'pointercancel', plus(at, 0, -40)));
    for (let i = 0; i < 15; i++) frame();
    expect(actions.cancelDrag).toHaveBeenCalledTimes(1);
    expect(actions.updateDrag).toHaveBeenCalledTimes(1);
    expect(actions.endDrag).not.toHaveBeenCalled();
  });
});

describe('short moves with a finger (5 px on the selection, 10 px elsewhere)', () => {
  function mock() {
    return {
      beginDrag: vi.fn<Fn>(() => SESSION),
      updateDrag: vi.fn<Fn>(() => ({ indicators: [], chips: [], ghost: [BASE] })),
      endDrag: vi.fn<Fn>(),
      cancelDrag: vi.fn<Fn>(),
    };
  }

  it('a touch press on the selected wall moved 8 px drags it (one beginDrag … endDrag) and keeps the selection', () => {
    const actions = mock();
    const onSelect = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: WALL_SEL, onSelect, coarsePointer: true }));
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at, 'touch');
      pointer(svg, 'pointermove', plus(at, 0, -8), 'touch');
      pointer(svg, 'pointerup', plus(at, 0, -8), 'touch');
    });
    expect(actions.beginDrag).toHaveBeenCalledTimes(1);
    expect(actions.beginDrag.mock.calls[0][0]).toEqual({ kind: 'wall', id: 'w-bad-s' });
    expect(actions.updateDrag).toHaveBeenCalledTimes(1);
    expect((actions.updateDrag.mock.calls[0] as [unknown, Vec2])[1][1]).toBeCloseTo(plan(svg, plus(at, 0, -8))[1], 9);
    expect(actions.endDrag).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('5 px is still a tap (it selects); 8 px elsewhere than the selection is a tap too, not a drag', () => {
    const actions = mock();
    const onSelect = vi.fn();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: WALL_SEL, onSelect, coarsePointer: true }));
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at, 'touch');
      pointer(svg, 'pointermove', plus(at, 0, -5), 'touch');
      pointer(svg, 'pointerup', plus(at, 0, -5), 'touch');
    });
    expect(actions.beginDrag).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);
    // Empty paper, 8 px: a tap (it clears the selection), no drag.
    const empty = scr(svg, [20, 10]);
    act(() => {
      pointer(svg, 'pointerdown', empty, 'touch');
      pointer(svg, 'pointermove', plus(empty, 8, 0), 'touch');
      pointer(svg, 'pointerup', plus(empty, 8, 0), 'touch');
    });
    expect(actions.beginDrag).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('a mouse keeps its 5 px threshold (8 px on the selection was a drag already)', () => {
    const actions = mock();
    const svg = render(baseProps({ editable: true, editActions: actions, selection: WALL_SEL }));
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 0, -8));
      pointer(svg, 'pointerup', plus(at, 0, -8));
    });
    expect(actions.beginDrag).toHaveBeenCalledTimes(1);
    expect(actions.endDrag).toHaveBeenCalledTimes(1);
  });

  it('the locked base proposal: 8 px on the selection is the refused drag (onLocked), not a tap', () => {
    const actions = mock();
    const onSelect = vi.fn();
    const onLocked = vi.fn();
    const derived: DerivedVariant = { ...createPlanFixture(), locked: true };
    const svg = render(baseProps({ derived, editable: false, editActions: actions, selection: WALL_SEL, onSelect, onLocked, coarsePointer: true }));
    const at = scr(svg, [8.5, 3]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-bad-s"]')!, 'pointerdown', at, 'touch');
      pointer(svg, 'pointermove', plus(at, 0, -8), 'touch');
      pointer(svg, 'pointerup', plus(at, 0, -8), 'touch');
    });
    expect(onLocked).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(actions.beginDrag).not.toHaveBeenCalled();
  });
});

describe('short moves with a finger on the real seed (the real edit API)', () => {
  it('a selected Vedskjul nudged 0,6 m (6,9 px) at the starting zoom on the phone moves 0,6 m and stays selected', () => {
    const store = createAppStore(createForslagD());
    store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
    const id = A.placeUnit(store, 'vedskjul', [14, 11.35], 0)!;
    expect(id).toBeTruthy();
    const sel = { current: { kind: 'block', id } as PlanSelection | null };
    const actions = A.bindEditActions(store);
    const draw = () =>
      act(() =>
        root.render(
          <PlanView
            derived={deriveForState(store.getState())}
            site={store.getState().project.site}
            planStorey="ground"
            selection={sel.current as never}
            onSelect={(x) => {
              sel.current = x as PlanSelection | null;
            }}
            showLabels
            showDims={false}
            showGrid={false}
            showRoofPlan={false}
            highlightNew
            editable
            editActions={actions as never}
            coarsePointer
          />,
        ),
      );
    draw();
    let svg = container.querySelector<SVGSVGElement>('svg[data-testid="plan-view"]')!;
    for (let i = 0; i < 6 && Math.abs(rootMatrix(svg)[0] / 11.56 - 1) > 1e-9; i++) {
      const k = Math.min(2, Math.max(0.5, 11.56 / rootMatrix(svg)[0]));
      act(() => {
        svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -Math.log(k) / 0.0015, clientX: 500, clientY: 350, bubbles: true, cancelable: true }));
      });
    }
    svg = container.querySelector<SVGSVGElement>('svg[data-testid="plan-view"]')!;
    const s = rootMatrix(svg)[0];
    expect(s).toBeCloseTo(11.56, 6);
    const x0 = () => Math.min(...deriveForState(store.getState()).blocks.find((b) => b.block.id === id)!.block.polygon.map((v) => v.p[0]));
    const before = x0();
    const at = scr(svg, [14, 11.35]);
    const el = svgElementAt(svg, at) ?? svg;
    act(() => {
      pointer(el, 'pointerdown', at, 'touch');
      pointer(svg, 'pointermove', [at[0] - 0.6 * s, at[1]], 'touch');
      pointer(svg, 'pointerup', [at[0] - 0.6 * s, at[1]], 'touch');
    });
    expect(x0() - before).toBeCloseTo(-0.6, 1);
    // Still the unit, not its room (a tap would have moved on to the room).
    expect(sel.current).toEqual({ kind: 'block', id });
    // One undo step.
    act(() => store.temporal.getState().undo());
    expect(x0()).toBeCloseTo(before, 9);
  });
});

describe('room labels on narrow rooms: the label beats the wall band outside its ±4,5 px core', () => {
  const PHONE = 11.56;

  function seedDerived() {
    const store = createAppStore(createForslagD());
    store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
    return deriveForState(store.getState());
  }

  /** Render the seed's Plan 1 at `scale` px/m on a coarse pointer (labels on). */
  function renderSeed(d: DerivedVariant, scale: number, onSelect: (s: unknown) => void = () => {}, selection: Props['selection'] = null) {
    act(() =>
      root.render(
        <PlanView
          derived={d}
          site={createForslagD().site}
          planStorey="ground"
          selection={selection}
          onSelect={onSelect}
          showLabels
          showDims={false}
          showGrid={false}
          showRoofPlan={false}
          highlightNew
          coarsePointer
        />,
      ),
    );
    const svg = container.querySelector<SVGSVGElement>('svg[data-testid="plan-view"]')!;
    for (let i = 0; i < 6 && Math.abs(rootMatrix(svg)[0] / scale - 1) > 1e-9; i++) {
      const f = Math.min(2, Math.max(0.5, scale / rootMatrix(svg)[0]));
      act(() => {
        svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -Math.log(f) / 0.0015, clientX: 500, clientY: 350, bubbles: true, cancelable: true }));
      });
    }
    expect(rootMatrix(svg)[0]).toBeCloseTo(scale, 6);
    return svg;
  }

  /** A point `px` screen pixels from the segment's middle, across it. */
  const across = (a: Vec2, b: Vec2, px: number, scale: number): Vec2 => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n: Vec2 = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    return [(a[0] + b[0]) / 2 + (n[0] * px) / scale, (a[1] + b[1]) / 2 + (n[1] * px) / scale];
  };

  it('the decision (labelTap) with the Bod (ny) geometry: its label point, 5,5 px from w-bod-ved, selects the room', () => {
    const d = seedDerived();
    const svg = renderSeed(d, PHONE);
    const labels = labelBoxesNear(svg);
    const bod = d.rooms.find((r) => r.room?.name === 'Bod (ny)')!;
    const box = labels.find((l) => l.roomId === bod.id);
    expect(box).toBeDefined();
    const [wall] = wallsById(d.walls, 'w-bod-ved');
    const tapped = { kind: 'wall' as const, id: wall.id, levelId: wall.levelId };
    // The label point lies 5,5 px from the wall line, inside the drawn label.
    const dist = (Math.abs(bod.labelPoint[1] - wall.a[1]) * PHONE);
    expect(dist).toBeCloseTo(5.49, 1);
    expect(labelTap(d, tapped, bod.labelPoint, labels, PHONE)).toEqual({ kind: 'room', id: bod.id, levelId: bod.levelId });
    // Within the core (±4 px, ±2 px) the wall keeps the tap, and off every label the wall is the wall.
    const inside: Vec2 = [bod.labelPoint[0], wall.a[1] - 4 / PHONE];
    expect(inside[1]).toBeGreaterThan(box!.min[1]);
    expect(labelTap(d, tapped, inside, labels, PHONE)).toBe(tapped);
    expect(labelTap(d, tapped, [bod.labelPoint[0], wall.a[1] - 2 / PHONE], labels, PHONE)).toBe(tapped);
    expect(labelTap(d, tapped, bod.labelPoint, [], PHONE)).toBe(tapped);
    expect(LABEL_TAP_CORE_PX).toBe(4.5);
  });

  it('walls stay tappable ±4 px everywhere, also where Gang, Bad and Passasje have their labels', () => {
    const d = seedDerived();
    const svg = renderSeed(d, PHONE);
    const labels = labelBoxesNear(svg);
    let onLabel = 0;
    for (const id of ['w-gang-n', 'w-104-103', 'dv-pass-n']) {
      const [w] = wallsById(d.walls, id);
      const tapped = { kind: 'wall' as const, id: w.id };
      for (const px of [-4, 4]) {
        const p = across(w.a, w.b, px, PHONE);
        if (labels.some((l) => p[0] >= l.min[0] && p[0] <= l.max[0] && p[1] >= l.min[1] && p[1] <= l.max[1])) onLabel++;
        expect(labelTap(d, tapped, p, labels, PHONE), `${id} ${px}`).toBe(tapped);
      }
    }
    // (Three of those six points are on a label: the reason the core is 4,5 px, not 3.)
    expect(onLabel).toBe(3);
  });

  it('through the plan: a finger tap the DOM gives to w-bod-ved, at the label point, selects «Bod (ny)»', () => {
    const d = seedDerived();
    const onSelect = vi.fn();
    const svg = renderSeed(d, PHONE, onSelect);
    const bod = d.rooms.find((r) => r.room?.name === 'Bod (ny)')!;
    const [wall] = wallsById(d.walls, 'w-bod-ved');
    const corridor = svg.querySelector(`[data-wall-corridor="${wall.id}"]`)!;
    expect(corridor).not.toBeNull();
    const at = scr(svg, bod.labelPoint);
    act(() => {
      pointer(corridor, 'pointerdown', at, 'touch');
      pointer(svg, 'pointerup', at, 'touch');
    });
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'room', id: bod.id, levelId: bod.levelId });
    // 2 px from the wall line the same element is the wall.
    const near = scr(svg, [bod.labelPoint[0], wall.a[1] - 2 / PHONE]);
    act(() => {
      pointer(corridor, 'pointerdown', near, 'touch');
      pointer(svg, 'pointerup', near, 'touch');
    });
    expect(onSelect.mock.calls.at(-1)?.[0]).toMatchObject({ kind: 'wall', id: wall.id });
  });

  it('labelBoxesNear reads the drawn labels (data-label-box) of the plan a target is in', () => {
    const d = seedDerived();
    const svg = renderSeed(d, PHONE);
    const any = svg.querySelector('[data-wall-corridor]')!;
    const fromTarget: LabelBox[] = labelBoxesNear(any);
    expect(fromTarget.length).toBe(svg.querySelectorAll('[data-room-label-hit]').length);
    expect(fromTarget.length).toBeGreaterThan(0);
    for (const l of fromTarget) {
      expect(l.min[0]).toBeLessThan(l.max[0]);
      expect(l.min[1]).toBeLessThan(l.max[1]);
    }
    expect(labelBoxesNear(null)).toEqual([]);
    expect(parseLabelBox('1 2 3')).toBeNull();
  });
});

describe('a tap on the selected opening over a ghost selects the ghost (zoomed in, the ghost is wholly under it)', () => {
  it('win-106-s at 60 px/m: a tap on its middle selects it, a second tap the door-106-old ghost under it', () => {
    const store = createAppStore(createForslagD());
    store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
    const d = deriveForState(store.getState());
    const onSelect = vi.fn();
    const render60 = (selection: Props['selection']) => {
      act(() =>
        root.render(
          <PlanView derived={d} site={createForslagD().site} planStorey="ground" selection={selection} onSelect={onSelect} showLabels showDims={false} showGrid={false} showRoofPlan={false} highlightNew />,
        ),
      );
      const svg = container.querySelector<SVGSVGElement>('svg[data-testid="plan-view"]')!;
      for (let i = 0; i < 6 && Math.abs(rootMatrix(svg)[0] / 60 - 1) > 1e-9; i++) {
        const f = Math.min(2, Math.max(0.5, 60 / rootMatrix(svg)[0]));
        act(() => {
          svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -Math.log(f) / 0.0015, clientX: 500, clientY: 350, bubbles: true, cancelable: true }));
        });
      }
      return svg;
    };
    // The window's centre: (3,68; 0) on the main house's south wall.
    let svg = render60(null);
    const body = () => svg.querySelector('[data-opening-id="win-106-s"] path[pointer-events="fill"]')!;
    const tap = () =>
      act(() => {
        const at = scr(svg, [3.68, 0.02]);
        pointer(body(), 'pointerdown', at);
        pointer(svg, 'pointerup', at);
      });
    tap();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'opening', id: 'win-106-s', levelId: 'lower' });
    svg = render60({ kind: 'opening', id: 'win-106-s', levelId: 'lower' });
    tap();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'ghost', id: 'door-106-old' });
    svg = render60({ kind: 'ghost', id: 'door-106-old' } as Props['selection']);
    tap();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'opening', id: 'win-106-s', levelId: 'lower' });
  });
});

describe('the drag preview draws the dragged element at the pointer, with the REAL bound edit actions (no mock)', () => {
  /** Plan points of a drawn ghost path (screen px "M x yL x y…" mapped back to plan metres). */
  const ringOf = (svg: SVGSVGElement, el: Element): Vec2[] => {
    const nums = (el.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const out: Vec2[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) out.push(plan(svg, [nums[i], nums[i + 1]]));
    return out;
  };

  it('w-gang-n dragged south: every frame draws two outlines, the base at y 3,4 and the moving one at the pointer', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const store = createAppStore(createForslagD());
    store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
    store.getState().clearHistory();
    const actions = A.bindEditActions(store);
    const derived = deriveForState(store.getState());
    const selection = { kind: 'wall' as const, id: 'w-gang-n', levelId: 'main' };
    act(() =>
      root.render(
        <PlanView
          derived={derived}
          site={store.getState().project.site}
          planStorey="ground"
          selection={selection}
          onSelect={() => {}}
          showLabels
          showDims={false}
          showGrid={false}
          showRoofPlan={false}
          highlightNew
          editable
          editActions={actions}
        />,
      ),
    );
    const svg = container.querySelector<SVGSVGElement>('svg[data-testid="plan-view"]')!;
    const s = rootMatrix(svg)[0];
    const at = scr(svg, [18.5, 3.4]);
    act(() => {
      pointer(svg.querySelector('[data-wall-id="w-gang-n"]')!, 'pointerdown', at);
      pointer(svg, 'pointermove', plus(at, 0, 10));
    });
    const movingY: number[] = [];
    for (let i = 1; i <= 12; i++) {
      const now = plus(at, 0, 10 + i * 4);
      act(() => pointer(svg, 'pointermove', now));
      act(() => void vi.advanceTimersByTime(16));
      const ghosts = [...svg.querySelectorAll('[data-edit-ghost]')];
      expect(ghosts.length, `frame ${i}`).toBe(2);
      // The overlay styles them apart: the base dashed, the moving outline solid (EditOverlay `data-edit-moving`).
      expect(ghosts[0].hasAttribute('data-edit-moving'), `frame ${i}`).toBe(false);
      expect(ghosts[1].hasAttribute('data-edit-moving'), `frame ${i}`).toBe(true);
      const [base, moving] = ghosts.map((g) => ringOf(svg, g));
      // The base outline stays where the wall was at pointer-down …
      for (const p of base) expect(p[1]).toBeCloseTo(3.4, 1);
      // … and the moving one is at the pointer: on the grid or a snap target, never farther than the snap reach
      // (geometry/snap.ts LINE_SNAP_MAX_M, 0,25 m), and level (the whole wall moved).
      const y = plan(svg, now)[1];
      for (const p of moving) expect(Math.abs(p[1] - y), `frame ${i}`).toBeLessThanOrEqual(0.25 + 1 / s);
      expect(Math.abs(moving[0][1] - moving[1][1])).toBeLessThan(1e-6 + 0.2 / s);
      expect(moving.map((p) => p[0]).sort((p, q) => p - q)).toEqual([expect.closeTo(16, 1), expect.closeTo(20.8, 1)]);
      movingY.push(moving[0][1]);
    }
    // It followed the finger 1,6 m south over the frames (not only when an updateDrag landed).
    expect(movingY[0]).toBeLessThan(3.4 - 0.2);
    expect(movingY.at(-1)!).toBeLessThan(movingY[0] - 1);
    for (let i = 1; i < movingY.length; i++) expect(movingY[i]).toBeLessThanOrEqual(movingY[i - 1] + 1e-9);
    act(() => pointer(svg, 'pointerup', plus(at, 0, 58)));
    // The drop applied the last position: the wall is 1,2 m further south (48 px at the plan's zoom, on the grid).
    const w = selectActiveVariant(store.getState()).walls.find((x) => x.id === 'w-gang-n')!;
    expect(w.a[1]).toBeCloseTo(Math.round(plan(svg, plus(at, 0, 58))[1] * 10) / 10, 6);
    expect(svg.querySelectorAll('[data-edit-ghost]').length).toBe(0);
  });
});
