import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../model/types';
import {
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  fitView,
  pan,
  pinchUpdate,
  planToScreen,
  rootTransform,
  screenToPlan,
  snapRectOut,
  visiblePlanRect,
  wheelZoomFactor,
  zoomAround,
} from './viewport';
import type { View } from './viewport';

const close = (a: Vec2, b: Vec2, digits = 9) => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
};

const V: View = { s: 40, tx: 100, ty: 500 };

describe('plan ↔ screen', () => {
  it('flips y so plan +y points up on screen', () => {
    close(planToScreen(V, [0, 0]), [100, 500]);
    close(planToScreen(V, [1, 0]), [140, 500]);
    close(planToScreen(V, [0, 1]), [100, 460]);
  });

  it('round-trips', () => {
    for (const p of [[0, 0], [3.7, -2.2], [-100, 55]] as Vec2[]) close(screenToPlan(V, planToScreen(V, p)), p);
  });

  it('uses the same mapping for the SVG root group', () => {
    expect(rootTransform(V)).toBe('matrix(40 0 0 -40 100 500)');
  });
});

describe('pan and zoom', () => {
  it('pans by a screen delta', () => {
    expect(pan(V, 10, -20)).toEqual({ s: 40, tx: 110, ty: 480 });
  });

  it('keeps the plan point under the cursor fixed when zooming', () => {
    const cursor: Vec2 = [321, 123];
    const before = screenToPlan(V, cursor);
    for (const f of [2, 0.5, 1.37]) {
      const z = zoomAround(V, f, cursor[0], cursor[1]);
      expect(z.s).toBeCloseTo(V.s * f, 9);
      close(screenToPlan(z, cursor), before);
    }
  });

  it('clamps the scale and still keeps the cursor point fixed', () => {
    const cursor: Vec2 = [50, 60];
    const before = screenToPlan(V, cursor);
    const zin = zoomAround(V, 1e6, cursor[0], cursor[1]);
    expect(zin.s).toBe(MAX_SCALE);
    close(screenToPlan(zin, cursor), before);
    const zout = zoomAround(V, 1e-6, cursor[0], cursor[1]);
    expect(zout.s).toBe(MIN_SCALE);
    close(screenToPlan(zout, cursor), before);
  });

  it('clamps invalid scales', () => {
    expect(clampScale(Number.NaN)).toBe(MIN_SCALE);
    expect(clampScale(-5)).toBe(MIN_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(MIN_SCALE);
    expect(clampScale(77)).toBe(77);
  });

  it('turns wheel deltas into bounded zoom factors', () => {
    expect(wheelZoomFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0)).toBeLessThan(1);
    expect(wheelZoomFactor(0, 0)).toBe(1);
    expect(wheelZoomFactor(-100, 0) * wheelZoomFactor(100, 0)).toBeCloseTo(1, 12);
    expect(wheelZoomFactor(-1e5, 0)).toBe(2);
    expect(wheelZoomFactor(1e5, 0)).toBe(0.5);
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(Math.exp(0.15), 12);
    expect(wheelZoomFactor(1, 2)).toBeCloseTo(Math.exp(-0.5), 12);
  });
});

describe('pinch', () => {
  it('zooms by the change in finger distance around the midpoint', () => {
    const mid: Vec2 = [300, 300];
    const before = screenToPlan(V, mid);
    const z = pinchUpdate(V, [250, 300], [350, 300], [200, 300], [400, 300]);
    expect(z.s).toBeCloseTo(80, 9);
    close(screenToPlan(z, mid), before);
  });

  it('pans with the midpoint when the distance is unchanged', () => {
    const z = pinchUpdate(V, [0, 0], [100, 0], [10, 20], [110, 20]);
    expect(z.s).toBeCloseTo(V.s, 12);
    expect(z.tx).toBeCloseTo(V.tx + 10, 9);
    expect(z.ty).toBeCloseTo(V.ty + 20, 9);
  });

  it('keeps the plan point under the fingers attached while pinching and moving', () => {
    const prevA: Vec2 = [100, 100];
    const prevB: Vec2 = [200, 200];
    const anchor = screenToPlan(V, [150, 150]);
    const z = pinchUpdate(V, prevA, prevB, [120, 90], [320, 290]);
    close(screenToPlan(z, [220, 190]), anchor);
  });

  it('ignores the scale part when the fingers coincide', () => {
    const z = pinchUpdate(V, [5, 5], [5, 5], [5, 5], [50, 50]);
    expect(z.s).toBe(V.s);
  });
});

describe('fit view', () => {
  const bounds = { min: [-0.11, -3] as Vec2, max: [15, 6.11] as Vec2 };

  it('fits the bounds plus margin into the viewport, centred', () => {
    const v = fitView(bounds, 1000, 700, 1.5, 24);
    const expected = Math.min((1000 - 48) / (15.11 + 3), (700 - 48) / (9.11 + 3));
    expect(v.s).toBeCloseTo(expected, 9);
    close(planToScreen(v, [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2]), [500, 350]);
    const vis = visiblePlanRect(v, 1000, 700);
    expect(vis.min[0]).toBeLessThanOrEqual(bounds.min[0] - 1.5 + 1e-9);
    expect(vis.max[0]).toBeGreaterThanOrEqual(bounds.max[0] + 1.5 - 1e-9);
    expect(vis.min[1]).toBeLessThanOrEqual(bounds.min[1] - 1.5 + 1e-9);
    expect(vis.max[1]).toBeGreaterThanOrEqual(bounds.max[1] + 1.5 - 1e-9);
  });

  it('handles point bounds and tiny viewports', () => {
    const v = fitView({ min: [2, 3], max: [2, 3] }, 400, 300, 1.5, 24);
    expect(Number.isFinite(v.s)).toBe(true);
    close(planToScreen(v, [2, 3]), [200, 150]);
    const tiny = fitView(bounds, 1, 1);
    expect(tiny.s).toBe(MIN_SCALE);
    expect(Number.isFinite(tiny.tx) && Number.isFinite(tiny.ty)).toBe(true);
    const zeroMargin = fitView({ min: [0, 0], max: [0, 0] }, 400, 300, 0);
    expect(zeroMargin.s).toBe(MAX_SCALE);
  });
});

describe('visible rect', () => {
  it('is the plan rectangle under the viewport', () => {
    const r = visiblePlanRect({ s: 10, tx: 0, ty: 100 }, 200, 100);
    expect(r).toEqual({ min: [0, 0], max: [20, 10] });
  });

  it('snaps outwards to whole steps', () => {
    expect(snapRectOut({ min: [-0.3, 1.2], max: [7.1, 9.9] }, 5)).toEqual({ min: [-5, 0], max: [10, 10] });
    expect(snapRectOut({ min: [0, 0], max: [5, 5] }, 5)).toEqual({ min: [0, 0], max: [5, 5] });
  });
});
