// @vitest-environment jsdom
import { act, createRef } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Selection } from '../state/selection';
import { createPlanFixture, createPlanFixtureSite } from './fixture';
import { PlanView } from './PlanView';
import type { PlanViewHandle } from './PlanView';
import { isRoomSelected, isWallHighlighted, selectionFromTarget, wallSelection } from './selection';
import { NORTH_ARROW_BOX, fitBounds, floorFill } from './drawing';
import { ACCENT, COLORS, FLOOR_TINT } from './style';

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
  const m = /^matrix\(([^)]+)\)$/.exec(t);
  expect(m).not.toBeNull();
  return m![1].split(' ').map(Number);
}

function pointer(el: Element, type: string, x: number, y: number, id = 1) {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, button: 0, pointerType: 'mouse', isPrimary: id === 1 }));
}

function tap(el: Element, x = 10, y = 10) {
  act(() => {
    pointer(el, 'pointerdown', x, y);
    pointer(el, 'pointerup', x, y);
  });
}

describe('PlanView rendering', () => {
  it('renders a flipped root group with touch-action none', () => {
    const svg = render(baseProps());
    expect(svg).not.toBeNull();
    expect(svg.style.touchAction).toBe('none');
    const [s, b, c, d] = rootMatrix(svg);
    expect(s).toBeGreaterThan(0);
    expect(b).toBe(0);
    expect(c).toBe(0);
    expect(d).toBe(-s);
    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 700');
  });

  it('labels the four ground-floor rooms with name, dims and area', () => {
    const svg = render(baseProps());
    const labels = svg.querySelectorAll('[data-room-label]');
    expect(labels).toHaveLength(4);
    const kitchen = svg.querySelector('[data-room-label="rom-kjokken"]')!;
    const lines = [...kitchen.querySelectorAll('text')].map((t) => t.textContent);
    expect(lines[0]).toBe('Kjøkken');
    expect(lines[1]).toMatch(/^ca\. \d+,\d × \d+,\d m$/);
    expect(lines[2]).toMatch(/^\d+,\d m²$/);
    expect(kitchen.getAttribute('data-label-kind')).toBe('full');
  });

  it('labels only the loft room on the Hems tab and switches openings', () => {
    const svg = render(baseProps({ planStorey: 'loft' }));
    expect(svg.querySelectorAll('[data-room-label]')).toHaveLength(1);
    expect(svg.querySelector('[data-room-label="rom-hems"]')).not.toBeNull();
    expect(svg.querySelector('[data-opening-id="win-hems"]')).not.toBeNull();
    expect(svg.querySelector('[data-opening-id="d-inng"]')).toBeNull();
    expect(svg.querySelector('[data-layer="other-storeys"] path')).not.toBeNull();
  });

  it('draws doors with a leaf and an SVG arc, windows as a triple line', () => {
    const svg = render(baseProps());
    const arc = svg.querySelector('path[data-door-arc="d-inng"]')!;
    expect(arc).not.toBeNull();
    expect(arc.getAttribute('d')).toMatch(/^M[-\d. ]+A0\.9 0\.9 0 0 [01] [-\d. ]+$/);
    expect(svg.querySelectorAll('path[data-door-arc]')).toHaveLength(3);
    const win = svg.querySelector('[data-opening-id="win-stue"]')!;
    expect(win.querySelectorAll('line')).toHaveLength(5);
    expect(svg.querySelector('[data-opening-id="win-hems"]')).toBeNull();
    const removed = svg.querySelector('[data-opening-id="win-old"] path')!;
    expect(removed.getAttribute('stroke-dasharray')).toBe('3 2');
  });

  it('draws walls by status, dividers dashed and keeps strokes non-scaling', () => {
    const svg = render(baseProps());
    const unions = [...svg.querySelectorAll('[data-wall-status]')];
    expect(unions.map((u) => u.getAttribute('data-wall-status'))).toEqual(['removed', 'existing', 'new']);
    expect(unions[0].getAttribute('stroke-dasharray')).toBe('4 3');
    expect(unions[1].getAttribute('fill')).toBe(COLORS.wallExisting);
    expect(unions[2].getAttribute('fill')).toBe(COLORS.wallNewFill);
    expect(svg.querySelector('[data-layer="dividers"] line')!.getAttribute('stroke-dasharray')).toBe('5 4');
    for (const el of svg.querySelectorAll('[data-plan-root] [stroke-width]')) {
      if (el.closest('pattern') || el.tagName === 'text') continue; // text halos live in screen px already
      expect(el.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    }
  });

  it('draws ghosts (removed walls and openings, moved block edges) dashed only with "highlight new"', () => {
    const derived = { ...createPlanFixture(), ghosts: [{ id: 'g-1', a: [0, 0] as [number, number], b: [0, 6] as [number, number] }] };
    const on = render(baseProps({ derived, highlightNew: true }));
    expect(on.querySelector('[data-wall-status="removed"]')).not.toBeNull();
    expect(on.querySelector('[data-wall-id="w-rives"]')).not.toBeNull();
    expect(on.querySelector('[data-opening-id="win-old"]')).not.toBeNull();
    expect(on.querySelector('[data-ghost-id="g-1"]')!.getAttribute('stroke-dasharray')).toBe('5 3');
    const off = render(baseProps({ derived, highlightNew: false }));
    expect(off.querySelector('[data-wall-status="removed"]')).toBeNull();
    expect(off.querySelector('[data-wall-id="w-rives"]')).toBeNull();
    expect(off.querySelector('[data-opening-id="win-old"]')).toBeNull();
    expect(off.querySelector('[data-ghost-id]')).toBeNull();
  });

  it('draws a deck as its pieces (holes where a unit stands), even-odd', () => {
    const derived = createPlanFixture();
    const deck = derived.outdoor.decks[0];
    const hole: [number, number][] = [[10, -2], [10, -1], [11, -1], [11, -2]];
    derived.outdoor.decks[0] = { ...deck, pieces: [[deck.pieces[0][0], hole]] };
    const svg = render(baseProps({ derived }));
    const path = svg.querySelector('[data-deck-id="deck-1"] path')!;
    expect(path.getAttribute('fill-rule')).toBe('evenodd');
    expect((path.getAttribute('d') ?? '').match(/M/g)).toHaveLength(2);
  });

  it('paints new walls like existing ones when "highlight new" is off', () => {
    const svg = render(baseProps({ highlightNew: false }));
    expect(svg.querySelector('[data-wall-status="new"]')!.getAttribute('fill')).toBe(COLORS.wallExisting);
  });

  it('draws structure, railings with steps, dimensions, grid and the overlays', () => {
    const svg = render(baseProps({ showRoofPlan: true }));
    expect(svg.querySelector('[data-structure-kind="chimney"] path')!.getAttribute('d')).toMatch(/^M/);
    expect(svg.querySelector('[data-structure-kind="post"]')).not.toBeNull();
    expect(svg.querySelector('[data-stair-arrow="stair-1"]')).not.toBeNull();
    expect(svg.querySelector('[data-stair-label="stair-1"]')!.textContent).toBe('opp');
    expect(svg.querySelectorAll('[data-steps-id] path')).toHaveLength(4);
    expect(svg.querySelectorAll('[data-dimension-kind]')).toHaveLength(6);
    expect(svg.querySelector('[data-layer="grid"] path')).not.toBeNull();
    expect(svg.querySelector('[data-layer="roof-plan"]')).not.toBeNull();
    expect(svg.querySelector('[data-overlay="north"]')!.textContent).toBe('N');
    expect(svg.querySelector('[data-overlay="scale"] text')!.textContent).toMatch(/^\d+(,\d)? m$/);
  });

  it('tints floors by material only, and new floors orange only with "highlight new"', () => {
    const svg = render(baseProps({ highlightNew: false }));
    const fill = (id: string) => svg.querySelector(`[data-floor-id="${id}"]`)!.getAttribute('fill');
    expect(fill('rom-soverom/floor')).toBe(FLOOR_TINT.wood); // new room
    expect(fill('rom-stue/floor')).toBe(FLOOR_TINT.wood);
    expect(fill('rom-bad/floor')).toBe(FLOOR_TINT.tile);
    render(baseProps({ highlightNew: true }));
    expect(fill('rom-soverom/floor')).toBe(floorFill('wood', true, true));
    expect(fill('rom-soverom/floor')).not.toBe(FLOOR_TINT.wood);
    expect(fill('rom-stue/floor')).toBe(FLOOR_TINT.wood);
  });

  it('draws both leaves of a double door', () => {
    const derived = createPlanFixture();
    const door = derived.walls.flatMap((w) => w.openings).find((o) => o.id === 'd-inng')!;
    const sw = door.swing!;
    door.swing2 = {
      hinge: sw.closed,
      closed: sw.hinge,
      open: [sw.closed[0] + sw.open[0] - sw.hinge[0], sw.closed[1] + sw.open[1] - sw.hinge[1]],
      sweep: sw.sweep === 1 ? -1 : 1,
    };
    const svg = render(baseProps({ derived }));
    const arcs = [...svg.querySelectorAll('path[data-door-arc="d-inng"]')];
    expect(arcs.map((a) => a.getAttribute('data-door-leaf'))).toEqual(['1', '2']);
    expect(arcs[0].getAttribute('d')).not.toBe(arcs[1].getAttribute('d'));
    expect(svg.querySelectorAll('path[data-door-arc]')).toHaveLength(4);
  });

  it('draws the stair arriving at the loft with a break line and its arrow', () => {
    const svg = render(baseProps({ planStorey: 'loft' }));
    const stair = svg.querySelector('[data-structure-kind="stair"]')!;
    expect(stair).not.toBeNull();
    expect(stair.querySelector('[data-stair-part="upper"]')).not.toBeNull();
    expect(svg.querySelector('[data-stair-arrow="stair-1"]')).not.toBeNull();
    expect(svg.querySelector('[data-stair-cut="stair-1"]')).not.toBeNull();
    expect(stair.querySelectorAll('[stroke-dasharray]').length).toBeGreaterThan(0);
    expect(svg.querySelector('[data-stair-label]')).toBeNull();
    render(baseProps());
    expect(svg.querySelector('[data-stair-part="full"]')).not.toBeNull();
    expect(svg.querySelector('[data-stair-cut]')).toBeNull();
  });

  it('keeps the north arrow on a small backdrop in a corner clear of the drawing', () => {
    const svg = render(baseProps());
    const [s, , , , tx, ty] = rootMatrix(svg);
    const d = createPlanFixture();
    const r = fitBounds(d.bounds, d.dimensions);
    const model = { x0: s * r.min[0] + tx, x1: s * r.max[0] + tx, y0: -s * r.max[1] + ty, y1: -s * r.min[1] + ty };
    const disc = svg.querySelector('[data-overlay="north"] circle')!;
    const cx = Number(disc.getAttribute('cx'));
    const cy = Number(disc.getAttribute('cy'));
    const half = NORTH_ARROW_BOX / 2;
    expect(Number(disc.getAttribute('r'))).toBe(half);
    expect(cx + half <= model.x0 || cx - half >= model.x1 || cy + half <= model.y0 || cy - half >= model.y1).toBe(true);
  });

  it('drops dimension chains and room labels when zoomed out below 8 px/m', () => {
    const svg = render(baseProps());
    expect(svg.querySelectorAll('[data-dimension-kind]').length).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      act(() => {
        svg.dispatchEvent(new WheelEvent('wheel', { deltaY: 2000, clientX: 500, clientY: 350, bubbles: true, cancelable: true }));
      });
    }
    expect(rootMatrix(svg)[0]).toBeLessThan(8);
    expect(svg.querySelectorAll('[data-layer="dimensions"] *')).toHaveLength(0);
    expect(svg.querySelectorAll('[data-room-label]')).toHaveLength(0);
  });

  it('hides labels, dimensions, grid and roof plan when switched off', () => {
    const svg = render(baseProps({ showLabels: false, showDims: false, showGrid: false }));
    expect(svg.querySelectorAll('[data-room-label]')).toHaveLength(0);
    expect(svg.querySelectorAll('[data-dimension-kind]')).toHaveLength(0);
    expect(svg.querySelector('[data-layer="grid"]')).toBeNull();
    expect(svg.querySelector('[data-layer="roof-plan"]')).toBeNull();
  });
});

describe('PlanView interaction', () => {
  it('selects a room, a wall piece, an opening and a block area; empty paper clears', () => {
    const onSelect = vi.fn<(sel: Selection | null) => void>();
    const svg = render(baseProps({ onSelect }));
    tap(svg.querySelector('[data-room-id="rom-bad"]')!);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'room', id: 'rom-bad', levelId: 'main' });
    tap(svg.querySelector('[data-wall-id="w-bad-s"]')!);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'wall', id: 'w-bad-s', levelId: 'main' });
    tap(svg.querySelector('[data-wall-id="blk-a/a-sw/blk-a-rest/base"]')!);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'wall', id: 'blk-a/a-sw/blk-a-rest/base', levelId: 'main' });
    tap(svg.querySelector('[data-opening-id="d-inng"] path[pointer-events="fill"]')!);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'opening', id: 'd-inng', levelId: 'main' });
    tap(svg.querySelector('[data-layer="blocks"] path[data-sel-id="blk-b"]')!);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'block', id: 'blk-b' });
    tap(svg.querySelector('[data-plan-paper]')!);
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(onSelect).toHaveBeenCalledTimes(6);
  });

  it('outlines the selected items in the accent colour', () => {
    const svg = render(baseProps({ selection: { kind: 'room', id: 'rom-bad', levelId: 'main' } }));
    expect(svg.querySelector('[data-room-id="rom-bad"]')!.getAttribute('fill')).toBe(ACCENT);
    expect(svg.querySelector('[data-room-id="rom-stue"]')!.getAttribute('fill')).toBe('none');
    expect(svg.querySelector('[data-selection-outline="room"]')!.getAttribute('stroke')).toBe(ACCENT);
    render(baseProps({ selection: { kind: 'room', id: 'rom-bad', levelId: 'loft' } }));
    expect(svg.querySelector('[data-selection-outline]')).toBeNull();
    render(baseProps({ selection: { kind: 'block', id: 'blk-b' } }));
    expect(svg.querySelector('[data-selection-outline="block"]')).not.toBeNull();
    render(baseProps({ selection: { kind: 'blockEdge', id: 'a-sw' } }));
    expect(svg.querySelector('[data-wall-id="blk-a/a-sw/blk-a-rest/base"]')!.getAttribute('stroke')).toBe(ACCENT);
    render(baseProps({ selection: { kind: 'opening', id: 'win-stue' } }));
    expect(svg.querySelector('[data-opening-id="win-stue"] path[pointer-events="fill"]')!.getAttribute('stroke')).toBe(ACCENT);
  });

  it('pans by dragging without selecting', () => {
    const onSelect = vi.fn();
    const svg = render(baseProps({ onSelect }));
    const [s0, , , , tx0, ty0] = rootMatrix(svg);
    act(() => {
      pointer(svg, 'pointerdown', 100, 100);
      pointer(svg, 'pointermove', 130, 110);
      pointer(svg, 'pointermove', 150, 130);
      pointer(svg, 'pointerup', 150, 130);
    });
    const [s1, , , , tx1, ty1] = rootMatrix(svg);
    expect(s1).toBe(s0);
    expect(tx1).toBeCloseTo(tx0 + 50, 6);
    expect(ty1).toBeCloseTo(ty0 + 30, 6);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('zooms with the wheel around the cursor and pinches with two pointers', () => {
    const svg = render(baseProps());
    const [s0, , , , tx0, ty0] = rootMatrix(svg);
    const cx = 400;
    const cy = 300;
    const planX = (cx - tx0) / s0;
    act(() => {
      svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    });
    const [s1, , , , tx1] = rootMatrix(svg);
    expect(s1).toBeGreaterThan(s0);
    expect((cx - tx1) / s1).toBeCloseTo(planX, 6);
    act(() => {
      pointer(svg, 'pointerdown', 300, 300, 1);
      pointer(svg, 'pointerdown', 400, 300, 2);
      pointer(svg, 'pointermove', 450, 300, 2);
      pointer(svg, 'pointerup', 450, 300, 2);
      pointer(svg, 'pointerup', 300, 300, 1);
    });
    const [s2] = rootMatrix(svg);
    expect(s2).toBeCloseTo(s1 * 1.5, 6);
    expect(ty0).toBeDefined();
  });

  it('exposes fitView and getSvg through the ref', () => {
    const ref = createRef<PlanViewHandle>();
    const svg = render(baseProps(), ref);
    const fitted = rootMatrix(svg);
    act(() => {
      pointer(svg, 'pointerdown', 100, 100);
      pointer(svg, 'pointermove', 300, 300);
      pointer(svg, 'pointerup', 300, 300);
    });
    expect(rootMatrix(svg)).not.toEqual(fitted);
    act(() => ref.current!.fitView());
    expect(rootMatrix(svg)).toEqual(fitted);
    expect(ref.current!.getSvg()).toBe(svg);
  });

  it('does not refit on an edit of the same variant, but does on a variant change', () => {
    const props = baseProps();
    const svg = render(props);
    const fitted = rootMatrix(svg);
    act(() => {
      pointer(svg, 'pointerdown', 100, 100);
      pointer(svg, 'pointermove', 200, 100);
      pointer(svg, 'pointerup', 200, 100);
    });
    const panned = rootMatrix(svg);
    render({ ...props, derived: createPlanFixture() });
    expect(rootMatrix(svg)).toEqual(panned);
    render({ ...props, derived: { ...createPlanFixture(), variantId: 'other' } });
    expect(rootMatrix(svg)).toEqual(fitted);
  });
});

describe('selection helpers', () => {
  const d = createPlanFixture();

  it('maps tap targets to selections', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-sel-kind', 'room');
    g.setAttribute('data-sel-id', 'rom-1');
    g.setAttribute('data-sel-level', 'main');
    const inner = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    g.appendChild(inner);
    svg.appendChild(g);
    expect(selectionFromTarget(inner)).toEqual({ kind: 'room', id: 'rom-1', levelId: 'main' });
    g.removeAttribute('data-sel-level');
    expect(selectionFromTarget(inner)).toEqual({ kind: 'room', id: 'rom-1' });
    g.setAttribute('data-sel-kind', 'bogus');
    expect(selectionFromTarget(inner)).toBeNull();
    expect(selectionFromTarget(svg)).toBeNull();
    expect(selectionFromTarget(null)).toBeNull();
  });

  it('highlights wall pieces for wall and block-edge selections', () => {
    const piece = d.walls.find((w) => w.id === 'blk-a/a-sw/blk-a-rest/base')!;
    const stored = d.walls.find((w) => w.id === 'w-bad-s')!;
    expect(wallSelection(piece)).toEqual({ kind: 'wall', id: piece.id, levelId: 'main' });
    expect(isWallHighlighted({ kind: 'wall', id: piece.id }, piece)).toBe(true);
    expect(isWallHighlighted({ kind: 'blockEdge', id: 'a-sw' }, piece)).toBe(true);
    expect(isWallHighlighted({ kind: 'blockEdge', id: 'a-se' }, piece)).toBe(false);
    expect(isWallHighlighted({ kind: 'wall', id: 'w-bad-s' }, stored)).toBe(true);
    expect(isWallHighlighted({ kind: 'room', id: 'w-bad-s' }, stored)).toBe(false);
    expect(isWallHighlighted(null, stored)).toBe(false);
  });

  it('matches room selections by id and, when given, level', () => {
    const room = { id: 'face-1', levelId: 'loft' };
    expect(isRoomSelected({ kind: 'room', id: 'face-1' }, room)).toBe(true);
    expect(isRoomSelected({ kind: 'room', id: 'face-1', levelId: 'loft' }, room)).toBe(true);
    expect(isRoomSelected({ kind: 'room', id: 'face-1', levelId: 'main' }, room)).toBe(false);
    expect(isRoomSelected({ kind: 'block', id: 'face-1' }, room)).toBe(false);
    expect(isRoomSelected(null, room)).toBe(false);
  });
});
