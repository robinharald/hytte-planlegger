// @vitest-environment jsdom
/**
 * The plan's furniture layer (FurnitureLayer.tsx): symbols per catalogue id, the footprint as the only hit area,
 * selection / collision outlines, clearances on request, names only when selected (or unknown), appliance codes, the
 * drop ghost, and the rotate handle (tap = 90°, drag = towards the pointer in 15° steps; the plan's tracker only
 * counts its pointer, a pinch drops it; its hit area is the drawn circle, capped at 0.3 m on touch; a press on
 * something else under it goes through to the plan).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedFurniture } from '../../model/derived';
import { catalogItem } from '../../furniture/catalog';
import type { Vec2 } from '../../model/types';
import { rectFootprint } from '../furniturePlacement';
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

  function drawHandle(onRotate = vi.fn(), parentDown = vi.fn(), opts: { scale?: number; handleR?: number; coarse?: boolean; others?: DerivedFurniture[] } = {}) {
    act(() =>
      root.render(
        <svg onPointerDown={parentDown}>
          {opts.others && <FurnitureLayer items={opts.others} selection={null} scale={opts.scale ?? 40} showClearances={false} />}
          <FurnitureRotateHandle item={BED} scale={opts.scale ?? 40} handleR={opts.handleR ?? 7} coarse={opts.coarse} clientToPlan={clientToPlan} onRotate={onRotate} title="Roter" />
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

  it('a press on another item under the handle goes through to the plan as a press on that item (no turn)', () => {
    const rug = item('f-rug', 'kommode', [2, 2.6 - 13 / 40], { w: 0.8, d: 0.45, h: 0.8 });
    const onRotate = vi.fn();
    const parentDown = vi.fn();
    const { handle } = drawHandle(onRotate, parentDown, { others: [rug] });
    const other = container.querySelector('[data-furniture-id="f-rug"] path')!;
    const real = document.elementFromPoint;
    // What the browser would hit with the handle out of the way: the other item.
    const seen: string[] = [];
    document.elementFromPoint = () => {
      seen.push(handle.querySelector('circle')!.style.pointerEvents);
      return other;
    };
    try {
      const at = toClient([2, 2 - 13 / 40]);
      pointer(handle, 'pointerdown', at);
      pointer(handle, 'pointerup', at);
    } finally {
      document.elementFromPoint = real;
    }
    expect(seen).toEqual(['none']); // the handle took no pointer events for the look-up …
    expect(handle.querySelector('circle')!.style.pointerEvents).toBe(''); // … and does again
    const off = handOffOf(parentDown);
    expect(off).toEqual({ kind: 'pass', target: other });
    expect(onRotate).not.toHaveBeenCalled();
    expect(container.querySelector('[data-rotate-preview]')).toBeNull();
  });

  it('a press over the floor or empty paper keeps the press (the handle turns the item)', () => {
    const onRotate = vi.fn();
    const parentDown = vi.fn();
    const { handle } = drawHandle(onRotate, parentDown);
    const floor = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    floor.setAttribute('data-sel-kind', 'room');
    floor.setAttribute('data-sel-id', 'rom-1');
    const real = document.elementFromPoint;
    for (const under of [floor, null]) {
      document.elementFromPoint = () => under;
      try {
        const at = toClient([2, 2 - 13 / 40]);
        pointer(handle, 'pointerdown', at);
        pointer(handle, 'pointerup', at);
      } finally {
        document.elementFromPoint = real;
      }
      expect(handOffOf(parentDown)?.kind).toBe('held');
    }
    expect(onRotate).toHaveBeenCalledTimes(2);
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
