import { describe, expect, it } from 'vitest';
import type { PlanDragModifiers, PlanSnapOptions } from './editTypes';
import { createPlanFixture } from './fixture';
import { defaultSnapPoint, snapContextFor } from './planSnap';

const mods: PlanDragModifiers = { alt: false, shift: false, ctrl: false, meta: false, snapRadiusM: 0.24, coarse: false };
const opts = (o: Partial<PlanSnapOptions>): PlanSnapOptions => ({ purpose: 'wall', storeyId: 'ground', levelId: 'main', modifiers: mods, ...o });

describe('default snapping of the placement tools', () => {
  it('builds the snap context once per derived model and storey', () => {
    const d = createPlanFixture();
    expect(snapContextFor(d, 'ground')).toBe(snapContextFor(d, 'ground'));
    expect(snapContextFor(d, 'loft')).not.toBe(snapContextFor(d, 'ground'));
    expect(snapContextFor(createPlanFixture(), 'ground')).not.toBe(snapContextFor(d, 'ground'));
  });

  it('snaps a wall point to a block corner, else to the grid (fine with Alt)', () => {
    const d = createPlanFixture();
    const corner = defaultSnapPoint(d, [10.05, 0.06], opts({}));
    expect(corner.point).toEqual([10, 0]);
    expect(corner.kind).toBe('point');
    expect(defaultSnapPoint(d, [1.21, 1.29], opts({})).point).toEqual([1.2, 1.3]);
    expect(defaultSnapPoint(d, [1.213, 1.287], opts({ modifiers: { ...mods, alt: true } })).point).toEqual([1.21, 1.29]);
  });

  it('gives a length chip from the first point', () => {
    const r = defaultSnapPoint(createPlanFixture(), [3.02, 1.31], opts({ from: [1.2, 1.3] }));
    expect(r.point).toEqual([3, 1.3]);
    expect(r.chips).toHaveLength(1);
    expect(r.chips[0].length).toBeCloseTo(1.8, 9);
  });

  it('snaps a unit ghost axis to axis against a block edge', () => {
    // Vedskjul 2 × 1,5 centred at x 15.05: its west edge (x 14.05) snaps onto Tilbygg's east axis edge (x 14).
    const r = defaultSnapPoint(createPlanFixture(), [15.05, 2.02], opts({ purpose: 'unit', templateId: 'vedskjul', rotation90: 0 }));
    expect(r.point[0]).toBeCloseTo(15, 9);
    expect(r.indicators.length).toBeGreaterThan(0);
  });
});
