// @vitest-environment jsdom
/**
 * The plan's furniture layer (FurnitureLayer.tsx): symbols per catalogue id, the footprint as the only hit area,
 * selection / collision outlines, clearances on request, names only when selected (or unknown), appliance codes, the
 * drop ghost, and the rotate handle (tap = 90°, drag = towards the pointer in 15° steps, never reaching the plan's
 * own gestures).
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
import { FurnitureLayer, FurnitureRotateHandle } from './FurnitureLayer';
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

  function drawHandle(onRotate = vi.fn(), parentDown = vi.fn()) {
    act(() =>
      root.render(
        <svg onPointerDown={parentDown}>
          <FurnitureRotateHandle item={BED} scale={40} handleR={7} clientToPlan={clientToPlan} onRotate={onRotate} title="Roter" />
        </svg>,
      ),
    );
    const handle = container.querySelector('[data-furniture-rotate="f-bed"]')!;
    return { handle, onRotate, parentDown };
  }

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

  it('a tap turns the item 90° and never reaches the plan', () => {
    const { handle, onRotate, parentDown } = drawHandle();
    const at = toClient([2, 2 - 13 / 40]);
    pointer(handle, 'pointerdown', at);
    pointer(handle, 'pointerup', at);
    expect(onRotate).toHaveBeenCalledWith('f-bed', 90);
    expect(parentDown).not.toHaveBeenCalled();
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
