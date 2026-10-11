import { describe, expect, it } from 'vitest';
import { area, isCCW, pointInPolygon } from '../geometry/polygon';
import type { DerivedStructure, DerivedVariant } from '../model/derived';
import type { Level, Vec2 } from '../model/types';
import { createPlanFixture } from './fixture';
import { openingLevelId, storeyData } from './storeyData';
import { sweptAngle } from './svg';
import { crossesCut, storeyContext, structureOnStorey, zRangeOf } from './visibility';

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe('plan fixture', () => {
  const d = createPlanFixture();

  it('has two blocks, five rooms on two levels and unique ids', () => {
    expect(d.blocks.map((b) => b.block.id)).toEqual(['blk-a', 'blk-b']);
    expect(d.rooms).toHaveLength(5);
    expect(new Set(d.rooms.map((r) => r.levelId))).toEqual(new Set(['main', 'loft']));
    expect(new Set(d.walls.map((w) => w.id)).size).toBe(d.walls.length);
    const openingIds = d.walls.flatMap((w) => w.openings.map((o) => o.id));
    expect(new Set(openingIds).size).toBe(openingIds.length);
  });

  it('has CCW polygons everywhere the contract says so', () => {
    for (const r of d.rooms) expect(isCCW(r.polygon)).toBe(true);
    for (const w of d.walls) if (!w.isDivider) expect(isCCW(w.footprint)).toBe(true);
    for (const b of d.blocks) for (const p of [b.axis, b.outer, b.inner]) expect(isCCW(p)).toBe(true);
    for (const deck of d.outdoor.decks) expect(isCCW(deck.polygon)).toBe(true);
  });

  it('builds wall footprints from the faces (area ≈ length × thickness plus mitres)', () => {
    for (const w of d.walls) {
      if (w.isDivider) {
        expect(w.footprint).toEqual([]);
        continue;
      }
      const length = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const fpArea = area(w.footprint);
      expect(fpArea).toBeGreaterThan(length * w.thickness * 0.9);
      expect(fpArea).toBeLessThan((length + 0.3) * w.thickness * 1.1);
    }
  });

  it('gives every door a consistent quarter swing of the leaf width', () => {
    const doors = d.walls.flatMap((w) => w.openings).filter((o) => o.swing);
    expect(doors.map((o) => o.id).sort()).toEqual(['d-bad', 'd-inng', 'gd-sov']);
    for (const o of doors) {
      const s = o.swing!;
      const r1 = Math.hypot(s.closed[0] - s.hinge[0], s.closed[1] - s.hinge[1]);
      const r2 = Math.hypot(s.open[0] - s.hinge[0], s.open[1] - s.hinge[1]);
      expect(r1).toBeCloseTo(o.width, 9);
      expect(r2).toBeCloseTo(o.width, 9);
      expect(sweptAngle(s.hinge, s.closed, s.open, s.sweep)).toBeCloseTo(Math.PI / 2, 9);
    }
    const entrance = doors.find((o) => o.id === 'd-inng')!;
    expect(entrance.swing!.open[0]).toBeLessThan(0); // opens outwards (west)
  });

  it('keeps everything built inside the bounds and labels inside their rooms', () => {
    const inBounds = (p: Vec2) => p[0] >= d.bounds.min[0] - 1e-9 && p[0] <= d.bounds.max[0] + 1e-9 && p[1] >= d.bounds.min[1] - 1e-9 && p[1] <= d.bounds.max[1] + 1e-9;
    for (const b of d.blocks) for (const p of b.outer) expect(inBounds(p)).toBe(true);
    for (const deck of d.outdoor.decks) for (const p of deck.polygon) expect(inBounds(p)).toBe(true);
    for (const r of d.rooms) {
      expect(pointInPolygon(r.labelPoint, r.polygon)).toBe(true);
      for (const h of r.holes) expect(pointInPolygon(r.labelPoint, h)).toBe(false);
    }
  });

  it('marks the L-shaped kitchen as approximate and subtracts the chimney', () => {
    const k = d.rooms.find((r) => r.id === 'rom-kjokken')!;
    expect(k.dims.approx).toBe(true);
    expect(k.holes).toHaveLength(1);
    expect(k.area).toBeCloseTo(area(k.polygon) - 0.55 * 0.55, 9);
    expect(d.rooms.find((r) => r.id === 'rom-bad')!.dims.approx).toBe(false);
  });

  it('has a wall union per storey and status, and a railing with one steps gap', () => {
    const keys = d.wallUnion.map((u) => `${u.storeyId}/${u.status}`).sort();
    expect(keys).toEqual(['ground/existing', 'ground/new', 'ground/removed', 'loft/existing']);
    for (const u of d.wallUnion) expect(u.polygons.length).toBeGreaterThan(0);
    expect(d.outdoor.railings[0].steps).toHaveLength(1);
    expect(d.outdoor.railings[0].steps[0].treads.length).toBeGreaterThan(0);
  });

  it('returns a fresh object on every call', () => {
    const a = createPlanFixture();
    const b = createPlanFixture();
    expect(a).not.toBe(b);
    expect(a.rooms[0]).not.toBe(b.rooms[0]);
    expect(a).toEqual(b);
  });
});

describe('storeyData', () => {
  const d = createPlanFixture();

  it('splits rooms, walls and floors by storey', () => {
    const g = storeyData(d, 'ground');
    const l = storeyData(d, 'loft');
    expect(g.ctx?.storeyId).toBe('ground');
    expect(ids(g.rooms)).toEqual(['rom-bad', 'rom-kjokken', 'rom-soverom', 'rom-stue']);
    expect(ids(l.rooms)).toEqual(['rom-hems']);
    expect(g.pieces).toHaveLength(10);
    expect(g.dividers.map((w) => w.id)).toEqual(['d-stue-kjokken']);
    expect(l.pieces.every((w) => w.id.startsWith('blk-a/'))).toBe(true);
    expect(l.pieces).toHaveLength(4);
    expect(l.dividers).toEqual([]);
    expect(g.floors.every((f) => f.levelId === 'main')).toBe(true);
    expect(l.floors.map((f) => f.kind).sort()).toEqual(['room', 'slab']);
  });

  it('shows openings only on the storey of their level and cuts only openings that are not removed', () => {
    const g = storeyData(d, 'ground');
    const l = storeyData(d, 'loft');
    expect(g.openings.map((o) => o.opening.id).sort()).toEqual(['d-bad', 'd-inng', 'gd-sov', 'op-tilbygg', 'win-old', 'win-sov', 'win-stue']);
    expect(l.openings.map((o) => o.opening.id)).toEqual(['win-hems']);
    expect(g.cuts).toHaveLength(6);
    expect(l.cuts).toHaveLength(1);
  });

  it('orders wall unions removed → existing → new and lists other storeys without removed walls', () => {
    const g = storeyData(d, 'ground');
    expect(g.unions.map((u) => u.status)).toEqual(['removed', 'existing', 'new']);
    expect(g.otherUnions.map((u) => `${u.storeyId}/${u.status}`)).toEqual(['loft/existing']);
    const l = storeyData(d, 'loft');
    expect(l.otherUnions.map((u) => `${u.storeyId}/${u.status}`).sort()).toEqual(['ground/existing', 'ground/new']);
  });

  it('filters structure by the plan cut and dimensions by level', () => {
    const g = storeyData(d, 'ground');
    const l = storeyData(d, 'loft');
    expect(ids(g.structure)).toEqual(['chimney-1', 'post-1', 'stair-1']);
    expect(ids(l.structure)).toEqual(['chimney-1', 'post-1']);
    expect(g.dimensions).toHaveLength(6);
    expect(l.dimensions).toHaveLength(7);
  });

  it('marks outdoor elements active only on the storey with the main floor', () => {
    expect(storeyData(d, 'ground').outdoorActive).toBe(true);
    expect(storeyData(d, 'loft').outdoorActive).toBe(false);
  });

  it('falls back to the first storey and copes with a model without storeys', () => {
    expect(storeyData(d, 'nope').ctx?.storeyId).toBe('ground');
    const empty: DerivedVariant = { ...d, storeys: [] };
    const s = storeyData(empty, 'ground');
    expect(s.ctx).toBeNull();
    expect(s.rooms).toEqual([]);
    expect(s.openings).toEqual([]);
  });

  it('falls back to the host wall level for openings with an unknown level', () => {
    const wall = d.walls.find((w) => w.openings.some((o) => o.id === 'win-stue'))!;
    const o = wall.openings.find((x) => x.id === 'win-stue')!;
    const known = d.levels.map((x) => x.id);
    expect(openingLevelId(o, wall, known)).toBe('main');
    expect(openingLevelId({ ...o, opening: { ...o.opening, levelId: 'loft' } }, wall, known)).toBe('loft');
    expect(openingLevelId({ ...o, opening: { ...o.opening, levelId: 'ghost' } }, wall, known)).toBe('main');
    const { levelId: _drop, ...noLevel } = o.opening;
    expect(openingLevelId({ ...o, opening: noLevel }, wall, known)).toBe(wall.levelId);
  });
});

describe('structure visibility', () => {
  const levels: Level[] = [
    { id: 'main', name: 'Hovedplan', storeyId: 'ground', elevation: 0, floorThickness: 0 },
    { id: 'lower', name: 'Nede', storeyId: 'ground', elevation: -1, floorThickness: 0 },
  ];

  it('crosses the 1.2 m cut of any level of the storey (open interval)', () => {
    expect(crossesCut(-0.5, 0.5, levels)).toBe(true);
    expect(crossesCut(1.2, 3, levels)).toBe(false);
    expect(crossesCut(1.19, 3, levels)).toBe(true);
    expect(crossesCut(-3, -1, levels)).toBe(false);
    expect(crossesCut(-1.5, -0.9, levels)).toBe(true);
    expect(crossesCut(0, 1, [])).toBe(false);
  });

  it('uses the stair z range regardless of direction', () => {
    const d = createPlanFixture();
    const stair = d.structure.find((s) => s.kind === 'stair') as Extract<DerivedStructure, { kind: 'stair' }>;
    expect(zRangeOf({ ...stair, fromZ: 1.47, toZ: 0 })).toEqual({ bottom: 0, top: 1.47 });
    const ctx = storeyContext(d, 'loft')!;
    expect(structureOnStorey(stair, ctx)).toBe(false);
    expect(structureOnStorey(stair, storeyContext(d, 'ground')!)).toBe(true);
  });
});
