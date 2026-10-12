/**
 * geometry/snap.ts on the small test fixture (one 6 × 4 m block, interior wall w-1 at x 3) plus a deck south of it.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { Variant } from '../model/types';
import { makeTestProject, makeVariant } from '../state/testProject';
import { deriveVariant } from './derive';
import {
  buildSnapContext,
  chipsAcross,
  chipsAt,
  gridPoint,
  rayToWall,
  roundTo,
  snap,
  snapCircle,
  snapFootprint,
  snapLineOffset,
  snapPolygon,
} from './snap';

const site = makeTestProject().site;

function fixture(): Variant {
  return produce(makeVariant('v-1', 'Test'), (d) => {
    d.outdoor.decks.push({
      id: 'deck-1',
      polygon: [
        { id: 'd0', p: [0, -4] },
        { id: 'd1', p: [6, -4] },
        { id: 'd2', p: [6, 0] },
        { id: 'd3', p: [0, 0] },
      ],
      topHeight: 0,
      isNew: true,
      noRailingEdges: [],
      steps: [],
    });
    d.walls.push({ id: 'w-gone', a: [1, 1], b: [2, 1], thickness: 0.1, levelId: 'main', status: 'removed', kind: 'interior', heightMode: 'auto' });
    d.furniture.push({ id: 'f-1', catalogId: 'x', position: [4.5, 2], rotationDeg: 0, levelId: 'main', size: { w: 1, d: 1, h: 1 }, isNew: true });
  });
}

const derived = deriveVariant(fixture(), site, null);
const ctx = buildSnapContext(derived, { storeyId: 'ground' });

describe('context', () => {
  it('has wall ends and midpoints, block vertices and axis edges, deck edges; no ghosts', () => {
    expect(ctx.points.filter((p) => p.kind === 'endpoint').map((p) => p.p)).toEqual([
      [3, 0],
      [3, 4],
    ]);
    expect(ctx.points.some((p) => p.id === 'w-gone')).toBe(false);
    expect(ctx.points.filter((p) => p.kind === 'vertex')).toHaveLength(4);
    expect(ctx.axisLines.filter((l) => l.kind === 'blockEdge')).toHaveLength(4);
    expect(ctx.axisLines.filter((l) => l.kind === 'deckEdge')).toHaveLength(4);
    expect(ctx.furniture.map((f) => f.id)).toEqual(['f-1']);
    const without = buildSnapContext(derived, { storeyId: 'ground', exclude: ['w-1', 'blk-1', 'deck-1', 'f-1'] });
    expect(without.points).toEqual([]);
    expect(without.lines).toEqual([]);
    expect(without.furniture).toEqual([]);
  });
});

describe('snap (points)', () => {
  it('a point target within the radius wins', () => {
    const r = snap(ctx, [3.05, 3.93], { radius: 0.12 });
    expect(r).toMatchObject({ point: [3, 4], kind: 'point' });
    expect(r.indicators[0]).toMatchObject({ kind: 'endpoint', p: [3, 4] });
  });

  it('near a line: slides along it, the free coordinate on the grid', () => {
    const r = snap(ctx, [3.06, 1.23], { radius: 0.12 });
    expect(r.kind).toBe('line');
    expect(r.point[0]).toBe(3);
    expect(r.point[1]).toBeCloseTo(1.2, 9);
  });

  it('nothing near: the grid (0.10 m, 0.01 m with Alt)', () => {
    expect(snap(ctx, [1.234, 2.267], { radius: 0.05 })).toMatchObject({ point: [1.2, 2.3], kind: 'grid' });
    expect(snap(ctx, [1.234, 2.267], { radius: 0.05, fine: true }).point).toEqual([1.23, 2.27]);
    expect(snap(ctx, [1.234, 2.267], { radius: 0.05, grid: false })).toMatchObject({ point: [1.234, 2.267], kind: 'none' });
  });

  it('two candidate lines near the pointer: their intersection (extension × ortho through `from`)', () => {
    // The extension of w-1 (x = 3) beyond y 4, and the horizontal through from (1, 5).
    const r = snap(ctx, [3.05, 5.04], { radius: 0.12, from: [1, 5] });
    expect(r.kind).toBe('intersection');
    expect(r.point[0]).toBeCloseTo(3, 9);
    expect(r.point[1]).toBeCloseTo(5, 9);
    expect(r.chips[0].length).toBeCloseTo(2, 9);
    expect(r.indicators.some((i) => i.kind === 'extension')).toBe(true);
  });

  it('chips: the distances to the walls on both sides along the narrower axis', () => {
    const r = snap(ctx, [1.5, 2], { radius: 0.05 });
    expect(r.chips).toHaveLength(2);
    const lengths = r.chips.map((c) => c.length).sort((a, b) => a - b);
    // Inner faces: x 0.16 (exterior wall, 0.27 − 0.11 inside the axis) and x 2.94 (w-1, 0.12 thick).
    expect(lengths[0]).toBeCloseTo(1.34, 6);
    expect(lengths[1]).toBeCloseTo(1.44, 6);
  });
});

describe('line, polygon, footprint and circle snaps', () => {
  it('snapLineOffset: to a parallel line in reach, else the absolute grid', () => {
    // w-1 dragged west by 2.95: lands on the block's west edge line (x 0).
    expect(snapLineOffset(ctx, [3, 0], [3, 4], 2.95, { radius: 0.1, excludeIds: new Set(['w-1']) }).offset).toBeCloseTo(3, 9);
    // Left normal of a→b (+y) is −x: offset 1.04 → x 1.96 → grid x 2.0 → offset 1.0.
    expect(snapLineOffset(ctx, [3, 0], [3, 4], 1.04, { radius: 0.01, excludeIds: new Set(['w-1']) }).offset).toBeCloseTo(1, 9);
    expect(snapLineOffset(ctx, [3, 0], [3, 4], 1.04, { radius: 0.01, grid: false, excludeIds: new Set(['w-1']) }).offset).toBe(1.04);
  });

  it('snapPolygon: a unit next to the block snaps axis to axis in both directions', () => {
    const unit = [
      [6.07, 0.05],
      [8.07, 0.05],
      [8.07, 1.55],
      [6.07, 1.55],
    ] as [number, number][];
    const r = snapPolygon(ctx, unit, { radius: 0.12 });
    expect(r.delta[0]).toBeCloseTo(-0.07, 9);
    expect(r.delta[1]).toBeCloseTo(-0.05, 9);
    expect(r.indicators).toHaveLength(2);
    // Far from everything: vertex 0 to the grid.
    const far = snapPolygon(ctx, unit.map(([x, y]) => [x + 10.03, y + 10.02] as [number, number]), { radius: 0.12 });
    expect(far.delta[0]).toBeCloseTo(0, 9);
    expect(far.delta[1]).toBeCloseTo(0.03, 9);
  });

  it('snapFootprint: furniture backs onto a wall face (0 gap)', () => {
    // A 1 × 0.5 item 0.06 m from w-1's east face (x 3.06).
    const item = [
      [3.12, 1],
      [4.12, 1],
      [4.12, 1.5],
      [3.12, 1.5],
    ] as [number, number][];
    const r = snapFootprint(ctx, item, { radius: 0.1, excludeIds: new Set(['f-1']) });
    expect(r.delta[0]).toBeCloseTo(-0.06, 9);
    expect(r.delta[1]).toBeCloseTo(0, 12);
  });

  it('snapCircle: a hot tub touches a deck edge from the inside', () => {
    const r = snapCircle(ctx, [3, -3.05], 1, { radius: 0.1 });
    expect(r.point[1]).toBeCloseTo(-3, 9);
    expect(r.point[0]).toBeCloseTo(3, 9);
  });
});

describe('gentle line snapping (UX review of phase 2a: snapping fought short drags)', () => {
  const ex = (...ids: string[]) => new Set(ids);

  it("snapLineOffset: the line's own start and lines collinear with it are no targets; a 5 cm hold keeps it", () => {
    // The block's south edge (y 0) runs along the deck's north edge: before, a 0.1 m drag snapped back onto it.
    const south = (offset: number) => snapLineOffset(ctx, [0, 0], [6, 0], offset, { radius: 0.12, excludeIds: ex('blk-1/v-sw') }).offset;
    expect(south(0.1)).toBeCloseTo(0.1, 9);
    expect(south(-0.1)).toBeCloseTo(-0.1, 9);
    // Within START_HOLD_M of the start it stays put (an off-grid line is not pushed onto the grid by a touch).
    expect(snapLineOffset(ctx, [0, 0.03], [6, 0.03], 0.04, { radius: 0.12 }).offset).toBe(0);
  });

  it('snapLineOffset: target lines reach at most 0.25 m whatever the radius; a line 3 cm away still snaps', () => {
    // w-1 (x 3) dragged west: the block's west edge (x 0) 0.3 m from the pointer → the grid; 0.2 m → snapped.
    expect(snapLineOffset(ctx, [3, 0], [3, 4], 2.7, { radius: 1, excludeIds: ex('w-1') }).offset).toBeCloseTo(2.7, 9);
    expect(snapLineOffset(ctx, [3, 0], [3, 4], 2.8, { radius: 1, excludeIds: ex('w-1') }).offset).toBeCloseTo(3, 9);
    expect(snapLineOffset(ctx, [3, 0], [3, 4], 2.97, { radius: 0.12, excludeIds: ex('w-1') }).offset).toBeCloseTo(3, 9);
  });

  it('snapLineOffset: a snap never takes back more than half of the drag', () => {
    const line = (y: number, id: string) => ({ a: [0, y] as [number, number], b: [5, y] as [number, number], kind: 'wall' as const, id });
    const custom = { ...ctx, lines: [line(0.05, 'near-start'), line(0.62, 'ahead')], axisLines: [] };
    // A 0.3 m drag: the line 5 cm from the start would take back 0.25 m (> 0.15) → the grid.
    expect(snapLineOffset(custom, [0, 0], [5, 0], 0.3, { radius: 0.5 }).offset).toBeCloseTo(0.3, 9);
    // A short drag just past it still snaps back onto it (0.03 m ≤ half of 0.08 m).
    expect(snapLineOffset(custom, [0, 0], [5, 0], 0.08, { radius: 0.5 }).offset).toBeCloseTo(0.05, 9);
    // Snaps forward are not limited by the drag length: a 0.4 m drag, a line 0.22 m ahead.
    expect(snapLineOffset(custom, [0, 0], [5, 0], 0.4, { radius: 0.5 }).offset).toBeCloseTo(0.62, 9);
  });

  it('Alt (fine) turns line snapping off, not only the 10 cm grid', () => {
    expect(snapLineOffset(ctx, [3, 0], [3, 4], 2.95, { radius: 0.1, fine: true, excludeIds: ex('w-1') }).offset).toBeCloseTo(2.95, 9);
    // No hold with Alt either: 1 cm steps from the start.
    expect(snapLineOffset(ctx, [3, 0], [3, 4], 0.03, { radius: 0.1, fine: true, excludeIds: ex('w-1') }).offset).toBeCloseTo(0.03, 9);
    const r = snap(ctx, [3.06, 1.234], { radius: 0.12, fine: true });
    expect(r.kind).toBe('grid');
    expect(r.point).toEqual([3.06, 1.23]);
  });

  it('snap: target lines are capped at 0.25 m; points and the ortho guides through `from` keep the full radius', () => {
    expect(snap(ctx, [3.3, 1.23], { radius: 0.5 }).kind).toBe('grid');
    expect(snap(ctx, [3.2, 1.23], { radius: 0.5 })).toMatchObject({ kind: 'line', point: [3, 1.2] });
    expect(snap(ctx, [3.25, 3.7], { radius: 0.5 })).toMatchObject({ kind: 'point', point: [3, 4] });
    const ortho = snap(ctx, [5.23, 5.4], { radius: 0.5, from: [1, 5] });
    expect(ortho.kind).toBe('line');
    expect(ortho.point[1]).toBeCloseTo(5, 9);
  });
});

describe('rays and chips', () => {
  it('rayToWall / chipsAt / chipsAcross', () => {
    const hit = rayToWall(ctx, [1.5, 2], [1, 0]);
    expect(hit?.t).toBeCloseTo(1.44, 6);
    expect(chipsAt(ctx, [1.5, 2]).length).toBe(2);
    const across = chipsAcross(ctx, [3, 0], [3, 4], 0.06, 0.06, { exclude: new Set(['w-1']) });
    expect(across.map((c) => c.length).sort((a, b) => a - b).map((x) => roundTo(x, 0.001))).toEqual([2.78, 2.78]);
  });

  it('grid helpers', () => {
    expect(gridPoint([0.05, -0.05])).toEqual([0.1, 0]);
    expect(roundTo(0.30000000000000004, 0.1)).toBe(0.3);
  });
});

describe('drags carry their start (second fix round: snapping still fought short drags)', () => {
  type V = [number, number];
  const withOrigin = (origin: { point?: V; polygon?: V[] }) => buildSnapContext(derived, { storeyId: 'ground', origin });
  const rect = (x0: number, y0: number, x1: number, y1: number): V[] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const moved = (poly: V[], d: V): V[] => poly.map(([x, y]) => [x + d[0], y + d[1]]);

  it('buildSnapContext keeps the origin; without one nothing changes', () => {
    expect(withOrigin({ point: [3, 4] }).origin).toEqual({ point: [3, 4] });
    expect(ctx.origin).toBeUndefined();
  });

  it('snap: no point target at the start or coincident with it (a neighbour end that met the dragged end)', () => {
    // A wall end that started at (3, 4), where w-1 ends, dragged to (3,1; 4,33): before, (3, 4) pulled it back.
    expect(snap(ctx, [3.1, 4.33], { radius: 0.5 })).toMatchObject({ kind: 'point', point: [3, 4] });
    expect(snap(withOrigin({ point: [3, 4] }), [3.1, 4.33], { radius: 0.5 })).toMatchObject({ kind: 'line', point: [3, 4.3] });
  });

  it('snap: point targets reach at most 0,25 m in a drag (the full radius without one)', () => {
    expect(snap(ctx, [3.3, 4.3], { radius: 1 })).toMatchObject({ kind: 'point', point: [3, 4] });
    expect(snap(withOrigin({ point: [5, 5] }), [3.3, 4.3], { radius: 1 })).toMatchObject({ kind: 'grid', point: [3.3, 4.3] });
  });

  it('snap: no target (point, intersection, line) takes back more than half of the drag', () => {
    // Dragged 0,42 m east from (2,8; 4): the corner (3, 4) and w-1's line would take back 0,22 m; the block edge
    // under the pointer keeps it.
    expect(snap(ctx, [3.22, 4], { radius: 0.5 })).toMatchObject({ kind: 'point', point: [3, 4] });
    expect(snap(withOrigin({ point: [2.8, 4] }), [3.22, 4], { radius: 0.5 })).toMatchObject({ kind: 'line', point: [3.2, 4] });
    // Taking back less than half is fine: dragged 0,4 m, the corner 0,2 m back.
    expect(snap(withOrigin({ point: [2.8, 4] }), [3.2, 4], { radius: 0.5 })).toMatchObject({ kind: 'point', point: [3, 4] });
    // The ortho guide through `from` too: a wall end dragged 0,36 m off its line stays off it.
    const end = snap(withOrigin({ point: [6, 2] }), [6, 2.36], { radius: 0.5, from: [1, 2] });
    expect(end.point[1]).toBeCloseTo(2.4, 9);
    expect(snap(ctx, [6, 2.36], { radius: 0.5, from: [1, 2] }).point[1]).toBeCloseTo(2, 9);
  });

  it('snap: Alt turns point targets off in a drag (they stay for the placement tools)', () => {
    expect(snap(ctx, [3.1, 4.1], { radius: 0.5, fine: true })).toMatchObject({ kind: 'point', point: [3, 4] });
    expect(snap(withOrigin({ point: [5, 5] }), [3.1, 4.1], { radius: 0.5, fine: true })).toMatchObject({ kind: 'grid', point: [3.1, 4.1] });
  });

  it("snapPolygon: the polygon's own starting line is no target (a unit against the block moved 0,2 m away)", () => {
    const start = rect(6, 1, 8, 2.5);
    expect(snapPolygon(ctx, moved(start, [0.2, 0]), { radius: 0.3 }).delta[0]).toBeCloseTo(-0.2, 9);
    const d = snapPolygon(withOrigin({ polygon: start }), moved(start, [0.2, 0]), { radius: 0.3 }).delta;
    expect(Math.abs(d[0]) + Math.abs(d[1])).toBeCloseTo(0, 9);
  });

  it('snapPolygon: never takes back more than half of the drag, never adds more than half of it', () => {
    // 5 cm from the block's east edge, dragged 0,15 m east: the edge would take back 0,2 m.
    const near = rect(6.05, 1, 8.05, 2.5);
    expect(snapPolygon(ctx, moved(near, [0.15, 0]), { radius: 0.3 }).delta[0]).toBeCloseTo(-0.2, 9);
    expect(snapPolygon(withOrigin({ polygon: near }), moved(near, [0.15, 0]), { radius: 0.3 }).delta[0]).toBeCloseTo(0, 9);
    // 0,5 m from it, dragged 0,3 m west: the edge 0,2 m ahead would add two thirds of the drag; 0,4 m west: a half.
    const far = rect(6.5, 1, 8.5, 2.5);
    expect(snapPolygon(ctx, moved(far, [-0.3, 0]), { radius: 0.3 }).delta[0]).toBeCloseTo(-0.2, 9);
    expect(snapPolygon(withOrigin({ polygon: far }), moved(far, [-0.3, 0]), { radius: 0.3 }).delta[0]).toBeCloseTo(0, 9);
    expect(snapPolygon(withOrigin({ polygon: far }), moved(far, [-0.4, 0]), { radius: 0.3 }).delta[0]).toBeCloseTo(-0.1, 9);
  });

  it('snapPolygon: targets reach at most 0,25 m (placement too); an axis moved less than 5 cm stays put', () => {
    const unit = rect(6.3, 0.05, 8.3, 1.55);
    expect(snapPolygon(ctx, unit, { radius: 1 }).delta[0]).toBeCloseTo(0, 9);
    expect(snapPolygon(ctx, rect(6.2, 0.05, 8.2, 1.55), { radius: 1 }).delta[0]).toBeCloseTo(-0.2, 9);
    // A 1 m drag west with 3 cm of wobble in y: y goes back to its start (off the grid), x to the grid.
    const start = rect(10.03, 10.07, 12.03, 11.57);
    const d = snapPolygon(withOrigin({ polygon: start }), moved(start, [-1.04, 0.03]), { radius: 0.3 }).delta;
    expect(d[1]).toBeCloseTo(-0.03, 9);
    expect(d[0]).toBeCloseTo(0.01, 9);
  });

  it('snapCircle: a hot tub touching a deck edge, moved 0,2 m off it, does not snap back', () => {
    expect(snapCircle(ctx, [3, -2.8], 1, { radius: 0.3 }).point[1]).toBeCloseTo(-3, 9);
    expect(snapCircle(withOrigin({ point: [3, -3] }), [3, -2.8], 1, { radius: 0.3 }).point[1]).toBeCloseTo(-2.8, 9);
  });

  it('snapFootprint: furniture backed onto a wall, moved 0,2 m off it, does not snap back', () => {
    const start = rect(3.06, 1, 4.06, 1.5);
    expect(snapFootprint(ctx, moved(start, [0.2, 0]), { radius: 0.3, excludeIds: new Set(['f-1']) }).delta[0]).toBeCloseTo(-0.2, 9);
    expect(snapFootprint(withOrigin({ polygon: start }), moved(start, [0.2, 0]), { radius: 0.3, excludeIds: new Set(['f-1']) }).delta[0]).toBeCloseTo(0, 9);
  });
});
