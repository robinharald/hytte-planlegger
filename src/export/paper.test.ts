/** Sheet sizes, scale and the split of a large plan over several sheets (paper.ts). */
import { describe, expect, it } from 'vitest';
import {
  PAGE_MARGIN_MM,
  TILE_OVERLAP_MM,
  TITLE_BLOCK_MM,
  chooseLayout,
  drawingArea,
  mmPerMetre,
  pageSize,
  planToSheetMm,
  pxPerMetre,
  sheetsAlong,
  sheetsPlanRect,
  tilesOf,
  titleBlockRect,
} from './paper';
import type { PlanRect } from './paper';

/** About Forslag D with its dimension chains and the margin: 26.5 × 20 m. */
const SEED: PlanRect = { min: [-2.55, -5.35], max: [23.95, 14.65] };

describe('paper', () => {
  it('has the ISO sizes and the scales', () => {
    expect(pageSize('A4', 'portrait')).toEqual({ w: 210, h: 297 });
    expect(pageSize('A4', 'landscape')).toEqual({ w: 297, h: 210 });
    expect(pageSize('A3', 'landscape')).toEqual({ w: 420, h: 297 });
    expect(mmPerMetre(50)).toBe(20);
    expect(mmPerMetre(100)).toBe(10);
    expect(pxPerMetre(50)).toBe(80);
    expect(pxPerMetre(100)).toBe(40);
  });

  it('puts the title block under the drawing area inside the margins', () => {
    const page = pageSize('A3', 'landscape');
    const a = drawingArea(page);
    const tb = titleBlockRect(page);
    expect(a.x).toBe(PAGE_MARGIN_MM);
    expect(a.w).toBe(400);
    expect(tb.h).toBe(TITLE_BLOCK_MM);
    expect(tb.y + tb.h).toBe(page.h - PAGE_MARGIN_MM);
    expect(a.y + a.h).toBeLessThan(tb.y);
  });

  it('counts sheets with the overlap', () => {
    expect(sheetsAlong(100, 100)).toBe(1);
    expect(sheetsAlong(101, 100)).toBe(2);
    expect(sheetsAlong(190, 100)).toBe(2); // 100 + 90 (10 overlap)
    expect(sheetsAlong(191, 100)).toBe(3);
  });

  it('fits Forslag D on one A3 sheet at 1:100 (landscape) and splits it on A4 and at 1:50', () => {
    const a3 = chooseLayout(SEED, 100, 'A3');
    expect([a3.orientation, a3.cols, a3.rows]).toEqual(['landscape', 1, 1]);
    expect(a3.planMm.w).toBeCloseTo(265, 6);
    const a4 = chooseLayout(SEED, 100, 'A4');
    expect(a4.cols * a4.rows).toBe(2);
    const a3at50 = chooseLayout(SEED, 50, 'A3');
    expect(a3at50.cols * a3at50.rows).toBe(4);
    const a4at50 = chooseLayout(SEED, 50, 'A4');
    expect(a4at50.cols * a4at50.rows).toBe(6);
  });

  it('chooses the orientation with fewer sheets, then the one matching the plan', () => {
    const tall: PlanRect = { min: [0, 0], max: [15, 24] };
    expect(chooseLayout(tall, 100, 'A4').orientation).toBe('portrait');
    const small: PlanRect = { min: [0, 0], max: [8, 6] };
    expect(chooseLayout(small, 100, 'A4').orientation).toBe('landscape');
  });

  it('centres a plan on one sheet and maps plan metres to sheet millimetres at scale', () => {
    const l = chooseLayout(SEED, 100, 'A3');
    const [tile] = tilesOf(l);
    const a = l.area;
    const tl = planToSheetMm(l, tile, [SEED.min[0], SEED.max[1]]);
    const br = planToSheetMm(l, tile, [SEED.max[0], SEED.min[1]]);
    expect(tl[0] - a.x).toBeCloseTo(a.x + a.w - br[0], 6);
    expect(tl[1] - a.y).toBeCloseTo(a.y + a.h - br[1], 6);
    // 16 m along x is 160 mm; plan +y is up on paper.
    const p0 = planToSheetMm(l, tile, [0, 0]);
    const p1 = planToSheetMm(l, tile, [16, 0]);
    const p2 = planToSheetMm(l, tile, [0, 6.2]);
    expect(p1[0] - p0[0]).toBeCloseTo(160, 6);
    expect(p0[1] - p2[1]).toBeCloseTo(62, 6);
  });

  it('tiles row by row from the top with overlapping steps, covering the whole plan', () => {
    const l = chooseLayout(SEED, 50, 'A4');
    const tiles = tilesOf(l);
    expect(tiles).toHaveLength(l.cols * l.rows);
    expect(tiles[0]).toEqual({ row: 0, col: 0, offset: [0, 0] });
    expect(tiles[1].offset[0]).toBeCloseTo(l.area.w - TILE_OVERLAP_MM, 9);
    // Every corner of the plan lands inside the drawing area of some sheet.
    for (const p of [SEED.min, SEED.max, [SEED.min[0], SEED.max[1]], [SEED.max[0], SEED.min[1]]] as [number, number][]) {
      const hit = tiles.some((t) => {
        const q = planToSheetMm(l, t, p);
        return q[0] >= l.area.x - 1e-6 && q[0] <= l.area.x + l.area.w + 1e-6 && q[1] >= l.area.y - 1e-6 && q[1] <= l.area.y + l.area.h + 1e-6;
      });
      expect(hit, String(p)).toBe(true);
    }
    // The grid of sheets covers the plan rectangle.
    const g = sheetsPlanRect(l);
    expect(g.min[0]).toBeLessThanOrEqual(SEED.min[0] + 1e-9);
    expect(g.max[1]).toBeGreaterThanOrEqual(SEED.max[1] - 1e-9);
    expect(g.max[0]).toBeGreaterThanOrEqual(SEED.max[0] - 1e-9);
    expect(g.min[1]).toBeLessThanOrEqual(SEED.min[1] + 1e-9);
  });
});
