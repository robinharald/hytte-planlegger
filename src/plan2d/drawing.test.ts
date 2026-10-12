import { describe, expect, it } from 'vitest';
import { createPlanFixture } from './fixture';
import type { DerivedStructure } from '../model/derived';
import {
  NORTH_ARROW_BOX,
  cutClipPath,
  dimensionStyle,
  fitBounds,
  floorFill,
  mixHex,
  placeCornerOverlay,
  scaleBarBox,
  scaleBarLabel,
  STAIR_ARROW_PX,
  stairPlan,
  stairUpLabelAt,
  REMOVED_FILL_OPACITY,
  wallPaint,
} from './drawing';
import { COLORS, FLOOR_TINT, FONT_PX, NEW } from './style';
import { CUT_HEIGHT } from './visibility';

const d = createPlanFixture();

describe('scale bar label', () => {
  it('uses comma decimals and no decimals for whole metres', () => {
    expect(scaleBarLabel(5)).toBe('5 m');
    expect(scaleBarLabel(0.5)).toBe('0,5 m');
    expect(scaleBarLabel(0.1)).toBe('0,1 m');
    expect(scaleBarLabel(1000)).toBe('1000 m');
  });
});

describe('wall paint and opening cuts', () => {
  it('paints walls by status and the highlight toggle', () => {
    expect(wallPaint('removed', true)).toEqual({ fill: COLORS.wallRemoved, fillOpacity: REMOVED_FILL_OPACITY, stroke: COLORS.wallRemoved, dash: '4 3' });
    expect(wallPaint('removed', false).dash).toBe('4 3');
    expect(wallPaint('new', true)).toEqual({ fill: COLORS.wallNewFill, stroke: COLORS.wallNewStroke });
    expect(wallPaint('new', false).fill).toBe(COLORS.wallExisting);
    expect(wallPaint('existing', true).fill).toBe(COLORS.wallExisting);
  });

  it('builds one outer ring plus one hole per cut', () => {
    const clip = cutClipPath(d.bounds, [
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      [
        [2, 2],
        [3, 2],
        [3, 3],
      ],
    ]);
    expect((clip.match(/Z/g) ?? []).length).toBe(3);
    expect(clip.startsWith(`M${d.bounds.min[0] - 25} ${d.bounds.min[1] - 25}`)).toBe(true);
    expect(cutClipPath(d.bounds, [])).toMatch(/^M[^Z]+Z$/);
    expect(cutClipPath(d.bounds, [[[0, 0]]])).toMatch(/^M[^Z]+Z$/);
  });
});

describe('fit bounds', () => {
  it('grows the built bounds by the dimension lines', () => {
    const r = fitBounds(d.bounds, d.dimensions);
    expect(r.min[1]).toBeCloseTo(-5.8, 9); // total dimension below the deck
    expect(r.min[0]).toBeCloseTo(-1.2, 9); // west chain
    expect(r.max[0]).toBeCloseTo(15.8, 9); // east chain
    expect(r.max[1]).toBeCloseTo(7.2, 9); // north chain
  });

  it('returns the bounds unchanged without (or with degenerate) dimensions', () => {
    expect(fitBounds(d.bounds, [])).toEqual(d.bounds);
    expect(fitBounds(d.bounds, [{ a: [1, 1], b: [1, 1], offset: 50 }])).toEqual(d.bounds);
  });
});

describe('floor fill', () => {
  it('mixes hex colours linearly', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#102030', '#102030', 0.3)).toBe('#102030');
  });

  it('tints by material only while "highlight new" is off', () => {
    expect(floorFill('wood', true, false)).toBe(FLOOR_TINT.wood);
    expect(floorFill('wood', false, false)).toBe(FLOOR_TINT.wood);
    expect(floorFill('tile', true, false)).toBe(FLOOR_TINT.tile);
    expect(floorFill('sauna', true, false)).toBe(FLOOR_TINT.sauna);
  });

  it('adds the orange "new" tint to new floors only when "highlight new" is on', () => {
    expect(floorFill('wood', false, true)).toBe(FLOOR_TINT.wood);
    const tinted = floorFill('wood', true, true);
    expect(tinted).not.toBe(FLOOR_TINT.wood);
    // Moves towards NEW (#c8742a): red stays high, blue drops the most.
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [r0, , b0] = rgb(FLOOR_TINT.wood);
    const [r1, , b1] = rgb(tinted);
    const [rn, , bn] = rgb(NEW);
    expect(b0 - b1).toBeGreaterThan(r0 - r1);
    expect(Math.abs(r1 - rn)).toBeLessThan(Math.abs(r0 - rn));
    expect(Math.abs(b1 - bn)).toBeLessThan(Math.abs(b0 - bn));
    expect(floorFill('tile', true, true)).not.toBe(tinted); // still distinguishable by material
  });

  it('keeps every material tint free of an orange cast (no channel spread above 20)', () => {
    for (const hex of Object.values(FLOOR_TINT)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(20);
    }
  });
});

describe('dimension style', () => {
  it('draws no chains below 8 px/m, small text below 12, normal text above', () => {
    expect(dimensionStyle(7.99)).toEqual({ show: false, fontPx: 0 });
    expect(dimensionStyle(0)).toEqual({ show: false, fontPx: 0 });
    expect(dimensionStyle(Number.NaN).show).toBe(false);
    expect(dimensionStyle(8)).toEqual({ show: true, fontPx: FONT_PX.dimSmall });
    expect(dimensionStyle(11.9)).toEqual({ show: true, fontPx: FONT_PX.dimSmall });
    expect(dimensionStyle(12)).toEqual({ show: true, fontPx: FONT_PX.dim });
    expect(FONT_PX.dimSmall).toBeLessThan(FONT_PX.dim);
  });
});

describe('stair plan symbol', () => {
  const stair = d.structure.find((s) => s.kind === 'stair') as Extract<DerivedStructure, { kind: 'stair' }>;

  it('draws every tread and the whole walking line in full mode', () => {
    const p = stairPlan(stair, 'full', CUT_HEIGHT);
    expect(p.solid).toHaveLength(stair.treads.length);
    expect(p.dashed).toEqual([]);
    expect(p.walkSolid).toEqual([stair.arrow.a, stair.arrow.b]);
    expect(p.walkDashed).toBeNull();
    expect(p.breakLine).toBeNull();
  });

  it('draws the arriving flight beyond the lower plan cut solid, the rest dashed, with a break line', () => {
    const p = stairPlan(stair, 'upper', CUT_HEIGHT);
    const cutZ = stair.fromZ + CUT_HEIGHT;
    expect(p.solid.length + p.dashed.length).toBe(stair.treads.length);
    expect(p.solid.length).toBe(stair.treads.filter((t) => t.z > cutZ).length);
    expect(p.solid.length).toBeGreaterThan(0);
    expect(p.dashed.length).toBeGreaterThan(0);
    // The cut lies 1.2 / 1.47 of the way up the walking line; the arrow head stays at the top.
    const [a, b] = [stair.arrow.a, stair.arrow.b];
    const t = CUT_HEIGHT / (stair.toZ - stair.fromZ);
    const cut = p.walkSolid[0];
    expect(cut[0]).toBeCloseTo(a[0] + (b[0] - a[0]) * t, 9);
    expect(cut[1]).toBeCloseTo(a[1] + (b[1] - a[1]) * t, 9);
    expect(p.walkSolid[1]).toEqual(b);
    expect(p.walkDashed).toEqual([a, cut]);
    // The break line spans the flight width (the stair runs along x, so across = y) and passes the cut point.
    const bl = p.breakLine!;
    const ys = stair.footprint.map((q) => q[1]);
    expect(Math.min(bl[0][1], bl[1][1])).toBeCloseTo(Math.min(...ys), 9);
    expect(Math.max(bl[0][1], bl[1][1])).toBeCloseTo(Math.max(...ys), 9);
    expect((bl[0][0] + bl[1][0]) / 2).toBeCloseTo(cut[0], 9);
    expect(bl[0][0]).not.toBeCloseTo(bl[1][0], 3); // slanted
  });

  it('copes with a flight lower than the cut', () => {
    const low = { ...stair, toZ: stair.fromZ + 0.8, treads: stair.treads.map((t) => ({ ...t, z: t.z * 0.5 })) };
    const p = stairPlan(low, 'upper', CUT_HEIGHT);
    expect(p.solid).toEqual([]);
    expect(p.walkSolid[0]).toEqual(low.arrow.b);
  });
});

describe('north arrow placement', () => {
  const W = 400;
  const H = 300;
  const S = NORTH_ARROW_BOX;
  const overlaps = (c: [number, number], box: { x0: number; y0: number; x1: number; y1: number }) =>
    c[0] + S / 2 > box.x0 && c[0] - S / 2 < box.x1 && c[1] + S / 2 > box.y0 && c[1] - S / 2 < box.y1;

  it('keeps the top-right corner when it is free', () => {
    expect(placeCornerOverlay({ x0: 100, y0: 100, x1: 300, y1: 200 }, W, H, S, 8)).toEqual([W - 8 - S / 2, 8 + S / 2]);
  });

  it('moves to a free corner when the drawing fills the top right', () => {
    const model = { x0: 150, y0: 0, x1: 400, y1: 220 };
    const c = placeCornerOverlay(model, W, H, S, 8);
    expect(overlaps(c, model)).toBe(false);
    expect(c[0]).toBe(8 + S / 2); // a left corner (the bottom one is farther from the drawing)
    expect(placeCornerOverlay(model, W, H, S, 8, [scaleBarBox(20, 16, H - 16)])).toEqual([8 + S / 2, 8 + S / 2]);
  });

  it('never covers the scale bar and otherwise takes the corner with the least overlap', () => {
    const model = { x0: 0, y0: 0, x1: 400, y1: 240 }; // the bottom corners overlap least …
    const bar = scaleBarBox(20, 16, H - 16);
    const c = placeCornerOverlay(model, W, H, S, 8, [bar]); // … and the scale bar takes the left one
    expect(overlaps(c, bar)).toBe(false);
    expect(c).toEqual([W - 8 - S / 2, H - 8 - S / 2]); // bottom right overlaps the drawing least
  });

  it('measures the scale bar box including its backdrop', () => {
    const b = scaleBarBox(20, 16, 284);
    expect(b.x0).toBe(10);
    expect(b.y1).toBe(292);
    expect(b.x1 - b.x0).toBeGreaterThan(60);
  });
});

describe('stair "opp" text', () => {
  const stair = d.structure.find((s) => s.kind === 'stair') as Extract<DerivedStructure, { kind: 'stair' }>;

  it('sits on the walking line just behind the arrow head, inside the stair', () => {
    const at = stairUpLabelAt(stair, 40)!;
    const { a, b } = stair.arrow;
    expect(at[1]).toBeCloseTo(a[1], 9); // the fixture stair runs along x
    const back = Math.abs(b[0] - at[0]) * 40;
    expect(back).toBeGreaterThan(STAIR_ARROW_PX);
    expect(back).toBeLessThan(STAIR_ARROW_PX + 20);
    expect(Math.sign(a[0] - b[0])).toBe(Math.sign(at[0] - b[0]));
  });

  it('is left out when the stair is too narrow or too short on screen', () => {
    expect(stairUpLabelAt(stair, 8)).toBeNull();
    expect(stairUpLabelAt({ ...stair, arrow: { a: stair.arrow.b, b: stair.arrow.b } }, 40)).toBeNull();
    expect(stairUpLabelAt(stair, 0)).toBeNull();
  });
});
