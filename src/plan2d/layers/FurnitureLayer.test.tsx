// @vitest-environment jsdom
/**
 * The plan's furniture layer (FurnitureLayer.tsx): symbols per catalogue id, the footprint as the only hit area,
 * selection / collision outlines, clearances on request, names only when selected (or unknown), appliance codes, the
 * drop ghost, and the rotate handle (tap = 90°, drag = towards the pointer in 15° steps; the plan's tracker only
 * counts its pointer, a pinch drops it; its hit area is the drawn circle, capped at 0.3 m on touch; final fix round:
 * a press on it always turns the item, and it stands on a side clear of other items and walls).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedFurniture, DerivedWall } from '../../model/derived';
import { catalogItem } from '../../furniture/catalog';
import { distancePointSegment, pointInPolygon, segmentIntersection } from '../../geometry/polygon';
import { createForslagD } from '../../model/seed/forslagD';
import type { Vec2 } from '../../model/types';
import { createAppStore } from '../../state/store';
import { deriveForState } from '../../state/useDerived';
import { HANDLE_RADIUS_PX } from '../editModel';
import { rectFootprint } from '../furniturePlacement';
import { planLayerData } from '../storeyData';
import { ACCENT } from '../style';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { pointerHandOff } from '../usePanZoom';
import { FurnitureLayer, FurnitureRotateHandle, ROTATE_HANDLE_MAX_M, ROTATE_HANDLE_MIN_TOUCH_PX } from './FurnitureLayer';
import type { FurnitureGhost } from './FurnitureLayer';
import { COLLISION } from './furnitureLayerModel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function item(id: string, catalogId: string, position: Vec2, size: { w: number; d: number; h: number }, extra: Partial<DerivedFurniture> = {}, rotationDeg = 0): DerivedFurniture {
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
    floorZ: 0,
    z: 0,
    clearances: [],
    collisions: [],
    blocksDoors: [],
    needsDrain: false,
    isNew: true,
    ...extra,
  };
}

const BED = item('f-bed', 'seng-150', [2, 3], { w: 1.5, d: 2, h: 0.5 }, { clearances: [rectFootprint([2, 4.3], 0, 1.5, 0.6)] });
const WASHER = item('f-vm', 'vaskemaskin', [6, 1], { w: 0.6, d: 0.6, h: 0.85 });
const UNKNOWN = item('f-x', 'flygel', [9, 1], { w: 1.5, d: 1.8, h: 1 }, { catalog: null });
const TABLE = item('f-t', 'spisebord-4', [4, 6], { w: 1.2, d: 0.8, h: 0.74 });

function draw(props: Partial<Parameters<typeof FurnitureLayer>[0]> = {}): SVGSVGElement {
  act(() =>
    root.render(
      <svg>
        <FurnitureLayer items={[BED, WASHER, UNKNOWN, TABLE]} selection={null} scale={40} showClearances={false} {...props} />
      </svg>,
    ),
  );
  return container.querySelector('svg')!;
}

describe('FurnitureLayer', () => {
  it('draws each item as its catalogue symbol, turned and placed, selectable through its footprint', () => {
    const svg = draw();
    const bed = svg.querySelector('[data-furniture-id="f-bed"]')!;
    expect(bed.getAttribute('data-sel-kind')).toBe('furniture');
    expect(bed.getAttribute('data-sel-id')).toBe('f-bed');
    expect(bed.getAttribute('data-sel-level')).toBe('main');
    expect(bed.querySelector('[data-symbol="seng-150"]')).not.toBeNull();
    expect(bed.querySelector('[data-furniture-symbol]')!.getAttribute('transform')).toBe('translate(2 3)');
    // The footprint is the first path and the only hit area: the symbol takes no pointer events.
    const hit = bed.querySelector('path')!;
    expect(hit.getAttribute('pointer-events')).toBe('fill');
    expect(bed.querySelector('[data-furniture-symbol]')!.getAttribute('pointer-events')).toBe('none');
    // Pillows (soft) of a double bed.
    expect(bed.querySelectorAll('[data-sym="soft"]').length).toBeGreaterThanOrEqual(3);
    const turned = item('f-r', 'stol', [1, 1], { w: 0.45, d: 0.45, h: 0.85 }, {}, 90);
    const svg2 = draw({ items: [turned] });
    expect(svg2.querySelector('[data-furniture-symbol]')!.getAttribute('transform')).toBe('translate(1 1) rotate(90)');
  });

  it('outlines the selected item in the accent colour and names it; others are not named', () => {
    const svg = draw({ selection: { kind: 'furniture', id: 'f-bed' } });
    expect(svg.querySelector('[data-furniture-id="f-bed"] path')!.getAttribute('stroke')).toBe(ACCENT);
    expect(svg.querySelector('[data-furniture-outline="selected"]')).not.toBeNull();
    expect(svg.querySelector('[data-furniture-label="f-bed"]')!.textContent).toBe('Seng 150');
    expect(svg.querySelector('[data-furniture-label="f-t"]')).toBeNull();
    // An unknown id is a named box.
    expect(svg.querySelector('[data-furniture-label="f-x"]')!.textContent).toBe('flygel');
    expect(svg.querySelector('[data-furniture-id="f-x"] [data-symbol="flygel"]')).not.toBeNull();
  });

  it('writes the appliance code when the item is big enough on screen', () => {
    expect(draw({ scale: 40 }).querySelector('[data-furniture-code="f-vm"]')!.textContent).toBe('VM');
    expect(draw({ scale: 10 }).querySelector('[data-furniture-code="f-vm"]')).toBeNull();
  });

  it('draws colliding items with a red outline (own collisions, blocked doors, or the given ids)', () => {
    const red = item('f-red', 'kommode', [1, 8], { w: 0.8, d: 0.45, h: 0.8 }, { collisions: ['w-1'] });
    const door = item('f-door', 'kommode', [3, 8], { w: 0.8, d: 0.45, h: 0.8 }, { blocksDoors: ['d-1'] });
    let svg = draw({ items: [red, door, BED] });
    expect(svg.querySelector('[data-furniture-id="f-red"] path')!.getAttribute('stroke')).toBe(COLLISION);
    expect(svg.querySelector('[data-furniture-id="f-door"]')!.getAttribute('data-furniture-colliding')).toBe('true');
    expect(svg.querySelector('[data-furniture-id="f-bed"] path')!.getAttribute('stroke')).toBe('none');
    svg = draw({ items: [red, BED], colliding: ['f-bed'] });
    expect(svg.querySelector('[data-furniture-id="f-bed"] path')!.getAttribute('stroke')).toBe(COLLISION);
    expect(svg.querySelector('[data-furniture-id="f-red"] path')!.getAttribute('stroke')).toBe('none');
  });

  it('hatches the clearance zones only with showClearances, and never as a hit area', () => {
    expect(draw().querySelector('[data-clearance-of]')).toBeNull();
    const svg = draw({ showClearances: true });
    const c = svg.querySelector('[data-clearance-of="f-bed"]')!;
    expect(c).not.toBeNull();
    expect(c.getAttribute('fill')).toMatch(/^url\(#/);
    expect(c.closest('[data-layer="clearances"]')!.getAttribute('pointer-events')).toBe('none');
  });

  it('draws the drop ghost: accent when the spot is free, red when not', () => {
    const ghost: FurnitureGhost = { catalogId: 'toalett', position: [5, 5], rotationDeg: 180, size: { w: 0.4, d: 0.65 }, footprint: rectFootprint([5, 5], 180, 0.4, 0.65), free: true };
    let svg = draw({ items: [], ghost });
    const g = svg.querySelector('[data-furniture-ghost="toalett"]')!;
    expect(g.getAttribute('data-furniture-ghost-free')).toBe('true');
    expect(g.querySelector('path')!.getAttribute('stroke')).toBe(ACCENT);
    expect(g.querySelector('[data-symbol="toalett"]')).not.toBeNull();
    svg = draw({ items: [], ghost: { ...ghost, free: false } });
    expect(svg.querySelector('[data-furniture-ghost="toalett"] path')!.getAttribute('stroke')).toBe(COLLISION);
    expect(draw({ items: [] }).querySelector('[data-layer="furniture"]')).toBeNull();
  });
});

describe('FurnitureRotateHandle', () => {
  /** Plan point ↔ client px: 40 px/m, y down, origin at client (0, 400). */
  const toClient = (p: Vec2): [number, number] => [p[0] * 40, 400 - p[1] * 40];
  const clientToPlan = (x: number, y: number): Vec2 => [x / 40, (400 - y) / 40];

  function drawHandle(onRotate = vi.fn(), parentDown = vi.fn(), opts: { scale?: number; handleR?: number; coarse?: boolean; others?: DerivedFurniture[]; items?: DerivedFurniture[] } = {}) {
    act(() =>
      root.render(
        <svg onPointerDown={parentDown}>
          {opts.others && <FurnitureLayer items={opts.others} selection={null} scale={opts.scale ?? 40} showClearances={false} />}
          <FurnitureRotateHandle item={BED} scale={opts.scale ?? 40} handleR={opts.handleR ?? 7} coarse={opts.coarse} items={opts.items} clientToPlan={clientToPlan} onRotate={onRotate} title="Roter" />
        </svg>,
      ),
    );
    const handle = container.querySelector('[data-furniture-rotate="f-bed"]')!;
    return { handle, onRotate, parentDown };
  }

  /** The hand-off the plan's tracker saw on the last pointer-down that reached the svg. */
  const handOffOf = (parentDown: ReturnType<typeof vi.fn>) => {
    const e = parentDown.mock.calls.at(-1)?.[0] as ReactPointerEvent | undefined;
    return e ? pointerHandOff(e.nativeEvent) : undefined;
  };

  function pointer(el: Element, type: string, at: [number, number], extra: Partial<PointerEventInit> = {}) {
    act(() => {
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: at[0], clientY: at[1], ...extra }));
    });
  }

  it('sits on a stem outside the middle of the front edge', () => {
    drawHandle();
    const circle = container.querySelector('[data-furniture-rotate] circle[fill="#ffffff"]')!;
    expect(Number(circle.getAttribute('cx'))).toBeCloseTo(2, 6);
    expect(Number(circle.getAttribute('cy'))).toBeCloseTo(2 - 13 / 40, 6);
    expect(Number(circle.getAttribute('r'))).toBeCloseTo(7 / 40, 6);
    expect(container.querySelector('[data-furniture-rotate] title')!.textContent).toBe('Roter');
  });

  it('a tap turns the item 90°; the plan only counts the pointer (held: no pan, no tap of its own)', () => {
    const { handle, onRotate, parentDown } = drawHandle();
    const at = toClient([2, 2 - 13 / 40]);
    pointer(handle, 'pointerdown', at);
    // The press reaches the plan's gesture tracker, marked as held by the handle.
    expect(parentDown).toHaveBeenCalledTimes(1);
    expect(handOffOf(parentDown)?.kind).toBe('held');
    pointer(handle, 'pointerup', at);
    expect(onRotate).toHaveBeenCalledWith('f-bed', 90);
  });

  it('a pinch drops the press: the held press is cancelled (no preview, no turn on release)', () => {
    const { handle, onRotate, parentDown } = drawHandle();
    const start = toClient([2, 2 - 13 / 40]);
    pointer(handle, 'pointerdown', start);
    pointer(handle, 'pointermove', toClient([3.5, 3.1]));
    expect(container.querySelector('[data-rotate-preview]')).not.toBeNull();
    const off = handOffOf(parentDown);
    expect(off?.kind).toBe('held');
    act(() => {
      if (off?.kind === 'held') off.cancel();
    });
    expect(container.querySelector('[data-rotate-preview]')).toBeNull();
    pointer(handle, 'pointermove', toClient([3, 2]));
    pointer(handle, 'pointerup', toClient([3, 2]));
    expect(onRotate).not.toHaveBeenCalled();
  });

  it('the hit area is the drawn circle, nothing bigger', () => {
    drawHandle();
    const hits = [...container.querySelectorAll('[data-furniture-rotate] circle, [data-furniture-rotate] path')].filter((el) => el.getAttribute('pointer-events') !== 'none');
    expect(hits).toHaveLength(1);
    expect(hits[0].getAttribute('fill')).toBe('#ffffff');
    expect(Number(hits[0].getAttribute('r'))).toBeCloseTo(7 / 40, 9);
    expect(container.querySelector('[data-rotate-hit="f-bed"]')).toBe(hits[0]);
  });

  it('on touch the handle covers at most 0.3 m, and is hidden where a usable one would cover more (11.6 px/m)', () => {
    const radius = (scale: number, handleR: number, coarse: boolean): number | null => {
      drawHandle(vi.fn(), vi.fn(), { scale, handleR, coarse });
      const hit = container.querySelector('[data-rotate-hit="f-bed"]');
      return hit ? Number(hit.getAttribute('r')) * scale : null;
    };
    // A fine pointer: unchanged (7 px at any zoom).
    expect(radius(24.7, 7, false)).toBeCloseTo(7, 3);
    // The phone's starting zoom, and 26 px/m: no handle (the mini-bar's Roter remains).
    expect(radius(11.6, 14, true)).toBeNull();
    expect(radius(26, 14, true)).toBeNull();
    // Zoomed in: drawn, at most 0.3 m, at least the touch minimum; full size once 14 px is under 0.3 m.
    expect(radius(40, 14, true)).toBeCloseTo(12, 3);
    expect(radius(80, 14, true)).toBeCloseTo(14, 3);
    for (const scale of [ROTATE_HANDLE_MIN_TOUCH_PX / ROTATE_HANDLE_MAX_M, 40, 60, 120]) {
      const r = radius(scale, 14, true)!;
      expect(r / scale).toBeLessThanOrEqual(ROTATE_HANDLE_MAX_M + 1e-6);
      expect(r).toBeGreaterThanOrEqual(ROTATE_HANDLE_MIN_TOUCH_PX - 1e-3);
    }
  });

  it('a press on the drawn circle always turns the item, whatever lies under it (final fix round: no pass-through)', () => {
    const other = item('f-other', 'kommode', [2, 2.6 - 13 / 40], { w: 0.8, d: 0.45, h: 0.8 });
    const onRotate = vi.fn();
    const parentDown = vi.fn();
    // The other item is drawn under the handle, but not given to it (so the handle stays on the front, over it).
    const { handle } = drawHandle(onRotate, parentDown, { others: [other] });
    const under = container.querySelector('[data-furniture-id="f-other"] path')!;
    const room = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    room.setAttribute('data-room-label-hit', 'rom-1');
    const real = document.elementFromPoint;
    for (const what of [under, room, null]) {
      document.elementFromPoint = () => what;
      try {
        const at = toClient([2, 2 - 13 / 40]);
        pointer(handle, 'pointerdown', at);
        expect(handOffOf(parentDown)?.kind).toBe('held');
        pointer(handle, 'pointerup', at);
      } finally {
        document.elementFromPoint = real;
      }
    }
    expect(onRotate).toHaveBeenCalledTimes(3);
    expect(onRotate).toHaveBeenLastCalledWith('f-bed', 90);
  });

  it('stands on the first side clear of other items and walls (front, back, left, right), else beside a rug only, else the front', () => {
    // BED: 1.5 × 2 m at (2, 3), front to the south (−y); a 7 px handle at 40 px/m stands 13 px beyond each edge.
    const box = (id: string, at: Vec2, flat = false) => item(id, flat ? 'teppe' : 'kommode', at, { w: 0.6, d: 0.6, h: flat ? 0.01 : 0.8 });
    const front = box('f-front', [2, 2 - 13 / 40]);
    const back = box('f-back', [2, 4 + 13 / 40]);
    const left = box('f-left', [1.25 - 13 / 40, 3]);
    const right = box('f-right', [2.75 + 13 / 40, 3]);
    /** The side the drawn handle stands on (degrees from the front); on touch a 14 px handle, 12 px at 40 px/m. */
    const sideOf = (items: DerivedFurniture[], walls: DerivedWall[], coarse: boolean) => {
      act(() =>
        root.render(
          <svg>
            <FurnitureRotateHandle item={BED} scale={40} handleR={coarse ? 14 : 7} coarse={coarse} items={[BED, ...items]} walls={walls} clientToPlan={clientToPlan} onRotate={vi.fn()} />
          </svg>,
        ),
      );
      const drawn = container.querySelector('[data-rotate-side]');
      return drawn ? Number(drawn.getAttribute('data-rotate-side')) : null;
    };
    const side = (items: DerivedFurniture[], walls: DerivedWall[] = []) => sideOf(items, walls, false);
    expect(side([])).toBe(0);
    expect(side([front])).toBe(180);
    expect(side([front, back])).toBe(-90);
    expect(side([front, back, left])).toBe(90);
    // Last fix round: an item under the middle of every side's handle: no handle (before: the front, on the item).
    expect(side([front, back, left, right])).toBeNull();
    // A wall in front (its footprint): the back.
    const wall = { id: 'w', isGhost: false, footprint: [[0, 1.5], [4, 1.5], [4, 1.7], [0, 1.7]] } as unknown as DerivedWall;
    expect(side([], [wall])).toBe(180);
    expect(side([], [{ ...wall, isGhost: true }])).toBe(0);
    // A wall the bed's front stands against, with free floor beyond it (the circle clear of it): the stem would run
    // through the wall into the next room, so the back (integration: a kommode in Soverom got its handle in Gang).
    const thin = { id: 'w2', isGhost: false, footprint: [[0, 1.88], [4, 1.88], [4, 2], [0, 2]] } as unknown as DerivedWall;
    expect(side([], [thin])).toBe(180);
    // A rug is better than a table, free floor better than a rug.
    const rugFront = box('f-rug', [2, 2 - 13 / 40], true);
    expect(side([rugFront])).toBe(180);
    expect(side([rugFront, back, left, right])).toBe(0);
    expect(side([front, back, box('f-rug-l', [1.25 - 13 / 40, 3], true), right])).toBe(-90);
    // On touch an edge facing up on the screen (+y: the bed's back here) is never used — the phone's mini-bar floats
    // right above the selection (sixth review: before, it came after the free sides and a rug, under the bar).
    const touch = (items: DerivedFurniture[]) => sideOf(items, [], true);
    expect(touch([front])).toBe(-90);
    expect(touch([front, left, right])).toBeNull();
    expect(sideOf([front, left, right], [], false)).toBe(180);
    expect(touch([front, box('f-rug-l', [1.25 - 13 / 40, 3], true), right])).toBe(-90);
    expect(touch([])).toBe(0);
  });

  it('on touch no seed item at 40 px/m has its handle on the side facing up (sixth review: under the mini-bar)', () => {
    const data = planLayerData(deriveForState(createAppStore(createForslagD()).getState()), 'ground');
    let drawn = 0;
    for (const f of data.furniture) {
      if (f.footprint.length < 3) continue;
      act(() =>
        root.render(
          <svg>
            <FurnitureRotateHandle item={f} scale={40} handleR={14} coarse items={data.furniture} walls={data.pieces} clientToPlan={() => null} onRotate={vi.fn()} />
          </svg>,
        ),
      );
      const c = container.querySelector(`[data-rotate-hit="${f.id}"]`);
      if (!c) continue;
      drawn++;
      const dx = Number(c.getAttribute('cx')) - f.item.position[0];
      const dy = Number(c.getAttribute('cy')) - f.item.position[1];
      expect(dy, f.id).toBeLessThanOrEqual(0.5 * Math.hypot(dx, dy));
    }
    // Before, 9 of the 42 drawn sat on the side facing up (fu-bad-2, fu-leseskrok-1, fu-wc-1, …); now they are hidden.
    expect(drawn).toBeGreaterThan(25);
  });

  it('no free side (last fix round): an item only grazed beats a wall, the least overlap wins; walls or items under every handle hide it', () => {
    // BED as above: each 7 px handle (0.2 m with its border at 40 px/m) stands 13 px beyond the edge's middle.
    const box = (id: string, at: Vec2) => item(id, 'kommode', at, { w: 0.6, d: 0.6, h: 0.8 });
    const slab = (id: string, x0: number, y0: number, x1: number, y1: number) =>
      ({ id, isGhost: false, footprint: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] }) as unknown as DerivedWall;
    // Walls under the front, back, left and right handles' middles.
    const wallFront = slab('w-f', 0, 1.5, 4, 1.7);
    const wallBack = slab('w-b', 0, 4.2, 4, 4.4);
    const wallLeft = slab('w-l', 0.8, 0, 0.95, 6);
    const wallRight = slab('w-r', 3.05, 0, 3.2, 6);
    // Items whose edge the front / back handle only grazes: 0.05 m, 0.08 m and 0.02 m deep, the middle off them.
    const frontGraze = box('f-fg', [2, 2 - 13 / 40 - 0.45]);
    const backGraze = box('f-bg', [2, 4 + 13 / 40 + 0.42]);
    const backLess = box('f-bl', [2, 4 + 13 / 40 + 0.48]);
    const frontOn = box('f-fo', [2, 2 - 13 / 40]);
    const sideOf = (items: DerivedFurniture[], walls: DerivedWall[], coarse = false) => {
      act(() =>
        root.render(
          <svg>
            <FurnitureRotateHandle item={BED} scale={40} handleR={coarse ? 14 : 7} coarse={coarse} items={[BED, ...items]} walls={walls} clientToPlan={clientToPlan} onRotate={vi.fn()} />
          </svg>,
        ),
      );
      const drawn = container.querySelector('[data-rotate-side]');
      return drawn ? Number(drawn.getAttribute('data-rotate-side')) : null;
    };
    // Walls all round: no handle (before: the front, its stem through the wall).
    expect(sideOf([], [wallFront, wallBack, wallLeft, wallRight])).toBeNull();
    // A grazed item beats walls; an item under the handle's middle does not.
    expect(sideOf([frontGraze], [wallBack, wallLeft, wallRight])).toBe(0);
    expect(sideOf([frontOn], [wallBack, wallLeft, wallRight])).toBeNull();
    // Two grazed sides: the one with less overlap.
    expect(sideOf([frontGraze, backGraze], [wallLeft, wallRight])).toBe(0);
    expect(sideOf([frontGraze, backLess], [wallLeft, wallRight])).toBe(180);
    // A rug beats a grazed item.
    expect(sideOf([frontGraze, item('f-rug', 'teppe', [2, 4 + 13 / 40], { w: 0.6, d: 0.6, h: 0.01 })], [wallLeft, wallRight])).toBe(180);
  });

  it('the seed at the laptop starting zoom (23.5 px/m): a handle never meets a wall nor stands on another item; the WC toilet\'s is hidden or free', () => {
    const store = createAppStore(createForslagD());
    store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
    const derived = deriveForState(store.getState());
    const data = planLayerData(derived, 'ground');
    const walls = data.pieces.filter((w) => !w.isGhost && w.footprint.length >= 3);
    const scale = 23.5;
    const r = (HANDLE_RADIUS_PX + 1) / scale;
    let drawn = 0;
    for (const f of data.furniture) {
      act(() =>
        root.render(
          <svg>
            <FurnitureRotateHandle item={f} scale={scale} handleR={HANDLE_RADIUS_PX} items={data.furniture} walls={data.pieces} clientToPlan={clientToPlan} onRotate={vi.fn()} />
          </svg>,
        ),
      );
      const circle = container.querySelector(`[data-rotate-hit="${f.id}"]`);
      if (!circle) continue;
      drawn++;
      const line = container.querySelector(`[data-rotate-of="${f.id}"] line`)!;
      const c: Vec2 = [Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))];
      const e: Vec2 = [Number(line.getAttribute('x1')), Number(line.getAttribute('y1'))];
      for (const w of walls) {
        const fp = w.footprint;
        const meets = pointInPolygon(c, fp) || fp.some((q, i) => distancePointSegment(c, q, fp[(i + 1) % fp.length]) < r - 1e-6) || fp.some((q, i) => segmentIntersection(e, c, q, fp[(i + 1) % fp.length]) !== null);
        expect(meets, `${f.id}'s handle meets ${w.id}`).toBe(false);
      }
      for (const o of data.furniture) {
        if (o.id === f.id || o.catalog?.mount === 'flat' || o.footprint.length < 3) continue;
        expect(pointInPolygon(c, o.footprint), `${f.id}'s handle stands on ${o.id}`).toBe(false);
      }
    }
    // Most items keep a handle.
    expect(drawn).toBeGreaterThan(data.furniture.length / 2);
    // The review's toilet in WC (its handle stood in Pantry, across w-pantry-wc): hidden, or on a free side.
    const wc = data.furniture.find((f) => f.id === 'fu-wc-1')!;
    act(() =>
      root.render(
        <svg>
          <FurnitureRotateHandle item={wc} scale={scale} handleR={HANDLE_RADIUS_PX} items={data.furniture} walls={data.pieces} clientToPlan={clientToPlan} onRotate={vi.fn()} />
        </svg>,
      ),
    );
    const hit = container.querySelector('[data-rotate-hit="fu-wc-1"]');
    if (hit) {
      const c: Vec2 = [Number(hit.getAttribute('cx')), Number(hit.getAttribute('cy'))];
      const room = derived.rooms.find((x) => x.id === 'room-wc')!;
      expect(pointInPolygon(c, room.polygon), 'the toilet\'s handle stands in WC').toBe(true);
    }
  });

  it('drawn on the back when something stands in front; a drag turns the back towards the pointer', () => {
    const front = item('f-front', 'kommode', [2, 2 - 13 / 40], { w: 0.6, d: 0.6, h: 0.8 });
    const { handle, onRotate } = drawHandle(vi.fn(), vi.fn(), { items: [BED, front] });
    const circle = handle.querySelector('circle')!;
    expect(Number(circle.getAttribute('cx'))).toBeCloseTo(2, 6);
    expect(Number(circle.getAttribute('cy'))).toBeCloseTo(4 + 13 / 40, 6);
    expect(container.querySelector('[data-rotate-side]')!.getAttribute('data-rotate-side')).toBe('180');
    // A tap: 90°, as from the front.
    const at = toClient([2, 4 + 13 / 40]);
    pointer(handle, 'pointerdown', at);
    pointer(handle, 'pointerup', at);
    expect(onRotate).toHaveBeenLastCalledWith('f-bed', 90);
    // Dragged east of the centre: the back (now north) turns east, so the front faces west: rotation −90.
    pointer(handle, 'pointerdown', at);
    pointer(handle, 'pointermove', toClient([3.5, 3.1]));
    pointer(handle, 'pointerup', toClient([3.5, 3.1]));
    expect(onRotate).toHaveBeenLastCalledWith('f-bed', -90);
  });

  it('a drag turns the front towards the pointer in 15° steps, previewed, applied once on release', () => {
    const { handle, onRotate } = drawHandle();
    const start = toClient([2, 2 - 13 / 40]);
    pointer(handle, 'pointerdown', start);
    // Towards the east of the bed's centre (2, 3): front east = rotation 90.
    pointer(handle, 'pointermove', toClient([3.5, 3.1]));
    expect(container.querySelector('[data-rotate-preview]')!.getAttribute('data-rotate-preview')).toBe('90');
    expect(container.querySelector('[data-rotate-label]')!.textContent).toBe('90°');
    expect(onRotate).not.toHaveBeenCalled();
    pointer(handle, 'pointermove', toClient([3, 2])); // south-east: 45
    pointer(handle, 'pointerup', toClient([3, 2]));
    expect(onRotate).toHaveBeenCalledTimes(1);
    expect(onRotate).toHaveBeenCalledWith('f-bed', 45);
    expect(container.querySelector('[data-rotate-preview]')).toBeNull();
  });

  it('a drag back to where it started turns nothing; a cancelled drag neither', () => {
    const { handle, onRotate } = drawHandle();
    const start = toClient([2, 2 - 13 / 40]);
    pointer(handle, 'pointerdown', start);
    pointer(handle, 'pointermove', toClient([2.05, 1]));
    pointer(handle, 'pointerup', toClient([2.05, 1]));
    expect(onRotate).not.toHaveBeenCalled();
    pointer(handle, 'pointerdown', start);
    pointer(handle, 'pointermove', toClient([4, 3]));
    pointer(handle, 'pointercancel', toClient([4, 3]));
    pointer(handle, 'pointerup', toClient([4, 3]));
    expect(onRotate).not.toHaveBeenCalled();
  });

  it('Alt turns in 1° steps', () => {
    const { handle, onRotate } = drawHandle();
    pointer(handle, 'pointerdown', toClient([2, 2 - 13 / 40]));
    const a = (-80 * Math.PI) / 180; // front at −80° → rotation 10
    const p: Vec2 = [2 + Math.cos(a) * 2, 3 + Math.sin(a) * 2];
    pointer(handle, 'pointermove', toClient(p), { altKey: true });
    pointer(handle, 'pointerup', toClient(p), { altKey: true });
    expect(onRotate).toHaveBeenCalledWith('f-bed', 10);
  });
});
