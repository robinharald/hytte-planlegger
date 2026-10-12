// @vitest-environment jsdom
/**
 * The plan's reveal of a new furniture item without insets (last fix round; PlanView.tsx `knownFurniture`): on a PC
 * (no `viewportInsets`) a library item or a copy that lands in a room off screen is panned into view, like the phone
 * does with its sheet insets; an item that was already there is not (selecting it pans nothing, as before).
 * Integration: a selected unit is not panned above the sheet while the Møbler library is open.
 */
import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DerivedFurniture, DerivedVariant } from '../model/derived';
import { catalogItem } from '../furniture/catalog';
import type { Vec2 } from '../model/types';
import { createPlanFixture, createPlanFixtureSite } from './fixture';
import { rectFootprint } from './furniturePlacement';
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
});

function chest(id: string, position: Vec2): DerivedFurniture {
  const size = { w: 0.8, d: 0.45, h: 0.8 };
  const footprint = rectFootprint(position, 0, size.w, size.d);
  return {
    id,
    item: { id, catalogId: 'kommode', position, rotationDeg: 0, levelId: 'main', size, isNew: true },
    catalog: catalogItem('kommode') ?? null,
    footprint,
    bbox: { min: [position[0] - 0.4, position[1] - 0.225], max: [position[0] + 0.4, position[1] + 0.225] },
    levelId: 'main',
    floorZ: 0,
    z: 0,
    clearances: [],
    collisions: [],
    blocksDoors: [],
    needsDrain: false,
    isNew: true,
  };
}

function props(furniture: DerivedFurniture[], selectedId: string | null): Props {
  const derived: DerivedVariant = { ...createPlanFixture(), furniture };
  return {
    derived,
    site: createPlanFixtureSite(),
    planStorey: 'ground',
    selection: selectedId ? { kind: 'furniture', id: selectedId, levelId: 'main' } : null,
    onSelect: () => {},
    showLabels: true,
    showDims: false,
    showGrid: false,
    showRoofPlan: false,
    highlightNew: false,
  };
}

function render(p: Props): SVGSVGElement {
  act(() => root.render(<PlanView {...p} />));
  return container.querySelector<SVGSVGElement>('svg[data-testid="plan-view"]')!;
}

function rootMatrix(svg: SVGSVGElement): number[] {
  const t = svg.querySelector('[data-plan-root]')!.getAttribute('transform')!;
  return /^matrix\(([^)]+)\)$/.exec(t)![1].split(' ').map(Number);
}

/** Screen box (svg px) of a plan rectangle. */
function screenBox(svg: SVGSVGElement, min: Vec2, max: Vec2) {
  const [s, , , , tx, ty] = rootMatrix(svg);
  return { x0: s * min[0] + tx, x1: s * max[0] + tx, y0: -s * max[1] + ty, y1: -s * min[1] + ty };
}

describe('a new furniture item off screen on a PC (no insets)', () => {
  // The fixture's plan is fitted into the 1000 × 700 px fallback; (40, 2) lies far east of it.
  const far: Vec2 = [40, 2];

  it('is panned into view when it is added and selected at once (library tap, Dupliser); never zoomed', () => {
    const near = chest('f-near', [5, 2]);
    let svg = render(props([near], null));
    const before = rootMatrix(svg);
    const added = chest('f-new', far);
    expect(screenBox(svg, added.bbox.min, added.bbox.max).x0).toBeGreaterThan(1000);
    svg = render(props([near, added], 'f-new'));
    const after = rootMatrix(svg);
    expect(after[0]).toBe(before[0]);
    const box = screenBox(svg, added.bbox.min, added.bbox.max);
    expect(box.x1).toBeLessThanOrEqual(1000 - 12 + 1e-6);
    expect(box.x0).toBeGreaterThanOrEqual(12 - 1e-6);
    expect(box.y0).toBeGreaterThanOrEqual(0);
    expect(box.y1).toBeLessThanOrEqual(700);
  });

  it('an item that was already there is not panned to when selected (unchanged), nor one the model gets later', () => {
    const old = chest('f-old', far);
    let svg = render(props([old], null));
    const before = rootMatrix(svg);
    svg = render(props([old], 'f-old'));
    expect(rootMatrix(svg)).toEqual(before);
    // Selected before the derived model has it: revealed on the render that brings it.
    act(() => root.unmount());
    root = createRoot(container);
    svg = render(props([], null));
    const fit = rootMatrix(svg);
    svg = render(props([], 'f-later'));
    expect(rootMatrix(svg)).toEqual(fit);
    svg = render(props([chest('f-later', far)], 'f-later'));
    const box = screenBox(svg, [far[0] - 0.4, far[1] - 0.225], [far[0] + 0.4, far[1] + 0.225]);
    expect(box.x1).toBeLessThanOrEqual(1000 - 12 + 1e-6);
  });
});

describe('a selected unit while the Møbler library is open (integration of the last fix round)', () => {
  // The phone's first-time flow: Nytt bygg leaves the new shed selected; the library sheet must not pull it into view,
  // since a library tap then places into the room the user is looking at (the plan's middle before the sheet).
  it('is not panned above the library sheet; with another tool the same insets pan it', () => {
    const base: Props = { ...props([], null), selection: { kind: 'block', id: 'blk-b' } };
    let svg = render(base);
    const before = rootMatrix(svg);
    const insets = { top: 0, right: 0, bottom: 600, left: 0 };
    expect(screenBox(svg, [10, 0], [14, 4]).y0).toBeGreaterThan(700 - 600);
    svg = render({ ...base, tool: 'furniture', viewportInsets: insets });
    expect(rootMatrix(svg)).toEqual(before);
    svg = render({ ...base, tool: 'select', viewportInsets: { ...insets, bottom: 601 } });
    expect(rootMatrix(svg)).not.toEqual(before);
    expect(rootMatrix(svg)[0]).toBe(before[0]);
  });
});
