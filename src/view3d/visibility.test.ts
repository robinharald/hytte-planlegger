import { describe, expect, it } from 'vitest';
import { computeVisibility, storeyRank } from './visibility';
import { FIXTURE_DERIVED } from './fixture';

describe('visibility', () => {
  it('shows everything in exterior mode', () => {
    const v = computeVisibility(FIXTURE_DERIVED, 'ute', 'ground', 1.6);
    expect(v.showRoofs).toBe(true);
    expect(v.cutZFor(FIXTURE_DERIVED.walls[0])).toBeNull();
    expect(v.isLevelVisible('loft')).toBe(true);
  });

  it('ranks storeys by elevation and hides the ones above the active storey', () => {
    const rank = storeyRank(FIXTURE_DERIVED);
    expect(rank.get('ground')).toBe(0);
    expect(rank.get('loft')).toBe(1);
    const v = computeVisibility(FIXTURE_DERIVED, 'inne', 'ground', 1.6);
    expect(v.showRoofs).toBe(false);
    expect(v.isLevelVisible('main')).toBe(true);
    expect(v.isLevelVisible('loft')).toBe(false);
    expect(v.structureCutZ).toBeCloseTo(1.6, 9);
  });

  it('cuts a wall relative to its highest visible level', () => {
    const east = FIXTURE_DERIVED.walls.find((w) => w.id.includes('v-e'))!;
    expect(east.levelIds).toEqual(['main', 'loft']);
    const ground = computeVisibility(FIXTURE_DERIVED, 'inne', 'ground', 1.6);
    expect(ground.cutZFor(east)).toBeCloseTo(1.6, 9);
    const loft = computeVisibility(FIXTURE_DERIVED, 'inne', 'loft', 1.6);
    expect(loft.cutZFor(east)).toBeCloseTo(1.47 + 1.6, 9);
    expect(loft.isLevelVisible('main')).toBe(true);
  });
});
