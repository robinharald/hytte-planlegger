import { describe, expect, it } from 'vitest';
import { FIXTURE_DERIVED } from './fixture';
import { blockLabels, labelDensities, labelDensity, MAX_LABELS, pxPerMetre, roomLabels } from './labelDefs';
import { computeVisibility, wallIsDrawn } from './visibility';

describe('label definitions', () => {
  it('labels the named rooms of the active storey above its cut plane', () => {
    const ground = roomLabels(FIXTURE_DERIVED, 'ground', 1.6);
    expect(ground.map((l) => l.title)).toEqual(['Stue', 'Kjøkken', 'Soverom']);
    expect(ground[0].detail).toBe('3,3 × 1,8 m · 6,0 m²');
    expect(ground[0].at[2]).toBeCloseTo(0 + 1.6 + 0.3, 9);
    expect(ground[2].isNew).toBe(true);
    const loft = roomLabels(FIXTURE_DERIVED, 'loft', 1.6);
    expect(loft.map((l) => l.title)).toEqual(['Hems']);
    expect(loft[0].at[2]).toBeCloseTo(1.47 + 1.6 + 0.3, 9);
    expect(roomLabels(FIXTURE_DERIVED, 'nope', 1.6)).toEqual([]);
  });

  it('labels blocks above the roof with their BYA area', () => {
    const [b] = blockLabels(FIXTURE_DERIVED);
    expect(b.title).toBe('Hytta');
    expect(b.detail).toBe('25,6 m²');
    expect(b.at[0]).toBeCloseTo(3, 9);
    expect(b.at[1]).toBeCloseTo(2, 9);
    expect(b.at[2]).toBeCloseTo(3.2 + 0.31 + 0.6, 9);
  });

  it('applies the plan density rule by pixels per metre', () => {
    expect(labelDensity(30)).toBe('full');
    expect(labelDensity(25)).toBe('full');
    expect(labelDensity(20)).toBe('name');
    expect(labelDensity(11.9)).toBe('none');
    const near = pxPerMetre(700, 42, 10);
    expect(near).toBeCloseTo(700 / (20 * Math.tan((21 * Math.PI) / 180)), 9);
    expect(pxPerMetre(700, 42, 0)).toBeGreaterThan(1e4);
  });

  it('shows at most 30 labels, nearest first', () => {
    const distances = Array.from({ length: 40 }, (_, i) => 40 - i * 0.5);
    const d = labelDensities(distances, 2000, 42);
    expect(d.filter((x) => x !== 'none').length).toBe(MAX_LABELS);
    expect(d[0]).toBe('none'); // the farthest
    expect(d[39]).not.toBe('none'); // the nearest
  });
});

describe('wallIsDrawn', () => {
  it('skips dividers and walls of hidden storeys', () => {
    const ute = computeVisibility(FIXTURE_DERIVED, 'ute', 'ground', 1.6);
    const drawn = FIXTURE_DERIVED.walls.filter((w) => wallIsDrawn(w, ute)).map((w) => w.id);
    expect(drawn).not.toContain('w-div');
    expect(drawn.length).toBe(5);
    const hiddenLoft = computeVisibility({ ...FIXTURE_DERIVED, walls: [{ ...FIXTURE_DERIVED.walls[4], levelId: 'loft', levelIds: ['loft'] }] }, 'inne', 'ground', 1.6);
    expect(wallIsDrawn({ ...FIXTURE_DERIVED.walls[4], levelId: 'loft', levelIds: ['loft'] }, hiddenLoft)).toBe(false);
    expect(wallIsDrawn({ ...FIXTURE_DERIVED.walls[0], status: 'removed' }, ute)).toBe(false);
  });
});
