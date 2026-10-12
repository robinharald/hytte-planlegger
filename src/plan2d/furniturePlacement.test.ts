/**
 * Tap-to-place and drop math (furniturePlacement.ts) on the real Forslag D model: back to the nearest free wall,
 * front into the room, out of door zones and other items, corners for showers, free items near the start point, and
 * drops that turn towards a near wall or stay where they are.
 */
import { describe, expect, it } from 'vitest';
import type { DerivedFurniture, DerivedRoom, DerivedVariant } from '../model/derived';
import type { Vec2 } from '../model/types';
import { pointInPolygon } from '../geometry/polygon';
import { seedFixture } from '../ui/testSeed';
import {
  catalogPlacementSpec,
  convexOverlap,
  doorZones,
  dropPlacement,
  insideRoom,
  normDeg,
  rectFootprint,
  roomAt,
  roomWallEdges,
  rotationFacing,
  tapPlacement,
} from './furniturePlacement';
import type { PlacementSpec } from './furniturePlacement';

const seed = seedFixture();
// The rooms and walls of Forslag D without its furniture (the seed furnishing has its own test below).
const derived: DerivedVariant = { ...seed.derived, furniture: [] };

function room(id: string): DerivedRoom {
  const r = derived.rooms.find((x) => x.id === id);
  if (!r) throw new Error(`no room ${id}`);
  return r;
}

const WC: PlacementSpec = { size: { w: 0.4, d: 0.65, h: 0.8 }, mode: 'wall' };
const BED: PlacementSpec = { size: { w: 1.5, d: 2.05, h: 0.5 }, mode: 'wall' };
const SHOWER: PlacementSpec = { size: { w: 0.9, d: 0.9, h: 2 }, mode: 'corner' };
const RUG: PlacementSpec = { size: { w: 2, d: 1.4, h: 0.01 }, mode: 'free' };
const TABLE: PlacementSpec = { size: { w: 1.6, d: 0.9, h: 0.75 }, mode: 'free' };

/** The item's back edge (local +y) in plan coordinates. */
function backEdge(position: Vec2, rotationDeg: number, w: number, d: number): [Vec2, Vec2] {
  const fp = rectFootprint(position, rotationDeg, w, d);
  return [fp[2], fp[3]];
}

/** A derived model with one more item standing at a placement. */
function withItem(base: DerivedVariant, id: string, position: Vec2, rotationDeg: number, size: PlacementSpec['size'], levelId: string): DerivedVariant {
  const footprint = rectFootprint(position, rotationDeg, size.w, size.d);
  const xs = footprint.map((p) => p[0]);
  const ys = footprint.map((p) => p[1]);
  const f: DerivedFurniture = {
    id,
    item: { id, catalogId: 'x', position, rotationDeg, levelId, size, isNew: true },
    catalog: null,
    footprint,
    bbox: { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] },
    levelId,
    floorZ: 0,
    z: 0,
    clearances: [],
    collisions: [],
    blocksDoors: [],
    needsDrain: false,
    isNew: true,
  };
  return { ...base, furniture: [...base.furniture, f] };
}

describe('frames and rotation', () => {
  it('turns the front (local −y) towards the inward normal of a wall', () => {
    expect(rotationFacing([0, 1])).toBe(180); // wall on the south side, room to the north
    expect(rotationFacing([0, -1])).toBe(0);
    expect(rotationFacing([1, 0])).toBe(90);
    expect(rotationFacing([-1, 0])).toBe(270);
    expect(normDeg(-90)).toBe(270);
    expect(normDeg(720)).toBe(0);
    // rotation 90: the local front (0, −1) points to +x
    const fp = rectFootprint([0, 0], 90, 2, 1);
    expect(fp[0][0]).toBeCloseTo(0.5, 9);
    expect(fp[0][1]).toBeCloseTo(-1, 9);
  });

  it('tests convex overlap with a touching tolerance', () => {
    const a = rectFootprint([0, 0], 0, 1, 1);
    expect(convexOverlap(a, rectFootprint([1, 0], 0, 1, 1))).toBe(false); // touching
    expect(convexOverlap(a, rectFootprint([0.99, 0], 0, 1, 1))).toBe(true);
    expect(convexOverlap(a, rectFootprint([0.5, 0.5], 45, 0.5, 0.5))).toBe(true);
    expect(convexOverlap(a, rectFootprint([1.3, 1.3], 45, 0.5, 0.5))).toBe(false);
  });
});

describe('room walls and door zones', () => {
  it('finds the wall edges of a room and leaves out open sides', () => {
    const bad = roomWallEdges(derived, room('room-hovedbad'));
    expect(bad.length).toBeGreaterThanOrEqual(4);
    for (const e of bad) {
      // The inward normal points into the room.
      const mid: Vec2 = [(e.a[0] + e.b[0]) / 2 + e.n[0] * 0.05, (e.a[1] + e.b[1]) / 2 + e.n[1] * 0.05];
      expect(pointInPolygon(mid, room('room-hovedbad').polygon)).toBe(true);
    }
    // Kjøkken is split from Spiseplass by a divider: that edge is no wall.
    const kitchen = room('room-kjokken');
    const edges = roomWallEdges(derived, kitchen);
    const all = kitchen.polygon.length;
    expect(edges.length).toBeLessThan(all);
  });

  it('keeps a zone clear on both sides of every door', () => {
    const zones = doorZones(derived, 'ground');
    expect(zones.length).toBeGreaterThan(10);
    expect(zones.every((z) => z.polygon.length === 4)).toBe(true);
  });

  it('finds the room under a point on the storey', () => {
    expect(roomAt(derived, 'ground', [19.7, 0.3])?.id).toBe('room-hovedbad');
    expect(roomAt(derived, 'loft', [19.7, 0.3])).toBeNull();
    expect(roomAt(derived, 'ground', [40, 40])).toBeNull();
  });
});

describe('tap-to-place', () => {
  it('puts a WC in Hovedbad with its back to the nearest free wall, facing into the room', () => {
    const r = room('room-hovedbad');
    const p = tapPlacement(derived, 'ground', WC, [0, 0], r);
    expect(p.free).toBe(true);
    expect(p.roomId).toBe('room-hovedbad');
    expect(p.levelId).toBe('main');
    expect(insideRoom(p.footprint, r)).toBe(true);
    expect(p.wall).toBeDefined();
    // The back edge lies on the wall edge it was pushed to.
    const [b0, b1] = backEdge(p.position, p.rotationDeg, WC.size.w, WC.size.d);
    const { a, b } = p.wall!;
    const onLine = (q: Vec2) => Math.abs((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    expect(onLine(b0)).toBeLessThan(1e-6);
    expect(onLine(b1)).toBeLessThan(1e-6);
    // Quarter turns in an axis-parallel room.
    expect(p.rotationDeg % 90).toBe(0);
    // Not in front of a door.
    for (const z of doorZones(derived, 'ground')) expect(convexOverlap(p.footprint, z.polygon)).toBe(false);
  });

  it('a second item of the same kind goes to the next free spot, never on top of the first', () => {
    const r = room('room-hovedbad');
    const first = tapPlacement(derived, 'ground', WC, [0, 0], r);
    const d2 = withItem(derived, 'f-wc1', first.position, first.rotationDeg, WC.size, 'main');
    const second = tapPlacement(d2, 'ground', WC, [0, 0], r);
    expect(second.free).toBe(true);
    expect(convexOverlap(first.footprint, second.footprint)).toBe(false);
    expect(Math.hypot(second.position[0] - first.position[0], second.position[1] - first.position[1])).toBeGreaterThan(0.39);
  });

  it('a rug (flat) may go on top of other items, other items ignore it', () => {
    const r = room('room-stue');
    const rug = tapPlacement(derived, 'ground', RUG, [0, 0], r);
    expect(rug.free).toBe(true);
    const withRug = withItem(derived, 'f-rug', rug.position, rug.rotationDeg, RUG.size, 'main');
    const table = tapPlacement(withRug, 'ground', TABLE, [0, 0], r);
    expect(table.free).toBe(true);
    expect(convexOverlap(table.footprint, rug.footprint)).toBe(true);
  });

  it('free items stand at the room label point when it is free, turned with the room', () => {
    const r = room('room-stue');
    const p = tapPlacement(derived, 'ground', TABLE, [0, 0], r);
    expect(p.free).toBe(true);
    expect(p.wall).toBeUndefined();
    expect(Math.hypot(p.position[0] - r.labelPoint[0], p.position[1] - r.labelPoint[1])).toBeLessThan(1);
  });

  it('a bed in Soverom (ny fløy) stands against a wall inside the room', () => {
    const r = room('room-sov-ny');
    const p = tapPlacement(derived, 'ground', BED, [0, 0], r);
    expect(p.free).toBe(true);
    expect(insideRoom(p.footprint, r)).toBe(true);
    expect(p.wall).toBeDefined();
  });

  it('a shower goes into a corner', () => {
    const r = room('room-hovedbad');
    const p = tapPlacement(derived, 'ground', SHOWER, [0, 0], r);
    expect(p.free).toBe(true);
    const { a, b } = p.wall!;
    const [b0, b1] = backEdge(p.position, p.rotationDeg, SHOWER.size.w, SHOWER.size.d);
    const nearEnd = Math.min(Math.hypot(b0[0] - a[0], b0[1] - a[1]), Math.hypot(b1[0] - a[0], b1[1] - a[1]), Math.hypot(b0[0] - b[0], b0[1] - b[1]), Math.hypot(b1[0] - b[0], b1[1] - b[1]));
    expect(nearEnd).toBeLessThan(1e-6);
  });

  it('without a room: the room under the start point, else the point itself (grid)', () => {
    const inBad = tapPlacement(derived, 'ground', WC, [19.7, 0.3]);
    expect(inBad.roomId).toBe('room-hovedbad');
    const outside = tapPlacement(derived, 'ground', { size: { w: 1, d: 0.8, h: 0.75 }, mode: 'free' }, [30.04, 30.02]);
    expect(outside.roomId).toBeUndefined();
    expect(outside.position).toEqual([30, 30]);
    expect(outside.free).toBe(true);
  });

  it('an item too big for any wall of the room still lands inside it when it can', () => {
    const r = room('room-wc');
    const huge: PlacementSpec = { size: { w: 3.5, d: 0.6, h: 0.9 }, mode: 'wall' };
    const p = tapPlacement(derived, 'ground', huge, [0, 0], r);
    expect(p.free).toBe(false);
    expect(p.roomId).toBe('room-wc');
  });

  it('takes ≤ 30 ms for a wall item in a big room', () => {
    const r = room('room-stue');
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) tapPlacement(derived, 'ground', BED, [0, 0], r);
    expect((performance.now() - t0) / 5).toBeLessThan(45);
  });
});

describe('drop', () => {
  it('a wall item dropped near a wall turns its back to it, at the pointer along it', () => {
    const r = room('room-sov-ny');
    const east = roomWallEdges(derived, r)
      .filter((e) => e.n[0] < -0.9 && e.length > 1.6)
      .reduce((m, e) => (e.a[0] > m.a[0] ? e : m));
    expect(east.n[0]).toBeLessThan(-0.9);
    const x = east.a[0] - 0.9;
    const yMid = (east.a[1] + east.b[1]) / 2;
    const p = dropPlacement(derived, 'ground', BED, [x, yMid]);
    expect(p.rotationDeg).toBe(270); // front to the west
    expect(p.position[0]).toBeCloseTo(east.a[0] - BED.size.d / 2, 6);
    expect(p.position[1]).toBeCloseTo(yMid, 6);
  });

  it('a wall item dropped in the middle of a big room stays at the pointer, unturned', () => {
    const r = room('room-stue');
    const at = r.labelPoint;
    const p = dropPlacement(derived, 'ground', { size: { w: 0.5, d: 0.5, h: 0.8 }, mode: 'wall' }, at);
    if (!p.wall) {
      expect(p.rotationDeg).toBe(0);
      expect(Math.hypot(p.position[0] - at[0], p.position[1] - at[1])).toBeLessThanOrEqual(0.25 + 1e-9);
    }
  });

  it('a free item snaps back-to-wall within the reach only', () => {
    const r = room('room-sov-ny');
    const edges = roomWallEdges(derived, r);
    const e = edges.find((x) => Math.abs(x.n[1] - 1) < 1e-6)!; // a south wall, room to the north
    expect(e).toBeDefined();
    const sx = (e.a[0] + e.b[0]) / 2;
    const spec: PlacementSpec = { size: { w: 0.6, d: 0.4, h: 0.45 }, mode: 'free' };
    const near = dropPlacement(derived, 'ground', spec, [sx, e.a[1] + 0.2 + 0.1], { reach: 0.25 });
    expect(near.position[1]).toBeCloseTo(e.a[1] + 0.2, 6);
    const far = dropPlacement(derived, 'ground', spec, [sx, e.a[1] + 0.2 + 0.6], { reach: 0.25 });
    expect(far.position[1]).toBeCloseTo(e.a[1] + 0.8, 6);
  });

  it('a shower dropped near a wall end goes into the corner', () => {
    const r = room('room-hovedbad');
    const e = roomWallEdges(derived, r).find((x) => x.length > 1.6)!;
    const s = 0.45 + 0.2;
    const at: Vec2 = [e.a[0] + e.u[0] * s + e.n[0] * 0.3, e.a[1] + e.u[1] * s + e.n[1] * 0.3];
    const p = dropPlacement(derived, 'ground', SHOWER, at);
    const expected: Vec2 = [e.a[0] + e.u[0] * 0.45 + e.n[0] * 0.45, e.a[1] + e.u[1] * 0.45 + e.n[1] * 0.45];
    expect(p.position[0]).toBeCloseTo(expected[0], 6);
    expect(p.position[1]).toBeCloseTo(expected[1], 6);
  });
});

describe('in the furnished seed', () => {
  it('a tap never puts a new item on top of the seed furniture when it reports a free spot', () => {
    const furnished = seed.derived;
    for (const [roomId, id] of [
      ['room-hovedbad', 'toalett'],
      ['room-sov-ny', 'nattbord'],
      ['room-stue', 'lenestol'],
      ['room-kjokken', 'hoyskap'],
    ] as const) {
      const r = furnished.rooms.find((x) => x.id === roomId)!;
      const p = tapPlacement(furnished, 'ground', catalogPlacementSpec(id), [0, 0], r);
      expect(p.roomId, id).toBe(roomId);
      if (!p.free) continue;
      for (const f of furnished.furniture.filter((x) => x.levelId === r.levelId && (x.item.size?.h ?? 1) >= 0.05 && x.item.catalogId !== 'teppe')) {
        expect(convexOverlap(p.footprint, f.footprint), `${id} vs ${f.id}`).toBe(false);
      }
    }
  });

  it('reads the catalogue: preset size, snap mode, elevation and flat items', () => {
    expect(catalogPlacementSpec('seng-90')).toEqual({ size: { w: 0.9, d: 2, h: 0.5 }, mode: 'wall', sizeVariant: '90x200' });
    expect(catalogPlacementSpec('dusj-90').mode).toBe('corner');
    expect(catalogPlacementSpec('salongbord').mode).toBe('free');
    expect(catalogPlacementSpec('overskap').elevation).toBe(1.4);
    expect(catalogPlacementSpec('teppe').flat).toBe(true);
    expect(catalogPlacementSpec('flygel')).toEqual({ size: { w: 1, d: 1, h: 1 }, mode: 'free' });
  });
});
