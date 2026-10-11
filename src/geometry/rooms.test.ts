import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../model/types';
import { area, fnv1a, isCCW, pointInPolygon, signedArea } from './polygon';
import { detectRooms } from './rooms';
import type { DetectedRoom, WallLine } from './rooms';

/**
 * Rectangle footprint around the line a→b: `left` / `right` = distances of the faces from the line
 * (left = (-dy, dx) side), extended along the line by extStart / extEnd.
 */
function footprint(a: Vec2, b: Vec2, left: number, right: number, extStart = 0, extEnd = 0): Vec2[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n: Vec2 = [-u[1], u[0]];
  const s: Vec2 = [a[0] - u[0] * extStart, a[1] - u[1] * extStart];
  const e: Vec2 = [b[0] + u[0] * extEnd, b[1] + u[1] * extEnd];
  return [
    [s[0] - n[0] * right, s[1] - n[1] * right],
    [e[0] - n[0] * right, e[1] - n[1] * right],
    [e[0] + n[0] * left, e[1] + n[1] * left],
    [s[0] + n[0] * left, s[1] + n[1] * left],
  ];
}

const OUTER = 0.11;
const INNER = 0.16;

/** Exterior wall on a CCW block edge: 0.16 inside (left), 0.11 outside, extended 0.11 at both ends (corner fill). */
const exterior = (id: string, a: Vec2, b: Vec2, extStart = OUTER, extEnd = OUTER): WallLine => ({
  id,
  a,
  b,
  footprint: footprint(a, b, INNER, OUTER, extStart, extEnd),
});

/** Interior wall, 0.12 thick, centred. */
const interior = (id: string, a: Vec2, b: Vec2, t = 0.12): WallLine => ({ id, a, b, footprint: footprint(a, b, t / 2, t / 2) });

const divider = (id: string, a: Vec2, b: Vec2): WallLine => ({ id, a, b, footprint: [] });

/** Exterior walls of a CCW rectangle [x0,x1]×[y0,y1]: ids `${p}S`, `${p}E`, `${p}N`, `${p}W`. */
function block(p: string, x0: number, y0: number, x1: number, y1: number): WallLine[] {
  return [
    exterior(`${p}S`, [x0, y0], [x1, y0]),
    exterior(`${p}E`, [x1, y0], [x1, y1]),
    exterior(`${p}N`, [x1, y1], [x0, y1]),
    exterior(`${p}W`, [x0, y1], [x0, y0]),
  ];
}

function roomAt(rooms: DetectedRoom[], p: Vec2): DetectedRoom {
  const found = rooms.filter((r) => pointInPolygon(p, r.innerPolygon) && !r.holes.some((h) => pointInPolygon(p, h)));
  expect(found).toHaveLength(1);
  return found[0];
}

describe('detectRooms — 2 × 2 grid with exterior 0.27/0.11 and interior 0.12 walls', () => {
  // Block [0,9]×[0,7], interior walls x = 4 and y = 3 crossing at (4,3) and meeting the exterior walls in T-junctions.
  const lines = [...block('e', 0, 0, 9, 7), interior('ix', [4, 0], [4, 7]), interior('iy', [0, 3], [9, 3])];
  const { rooms, dangling } = detectRooms(lines);

  it('finds four rooms and no dangling walls', () => {
    expect(rooms).toHaveLength(4);
    expect(dangling).toEqual([]);
  });

  it('computes exact inner areas, rectangles and dims', () => {
    const cases: { at: Vec2; w: number; h: number; face: number }[] = [
      { at: [2, 1.5], w: 3.94 - 0.16, h: 2.94 - 0.16, face: 12 },
      { at: [6, 1.5], w: 8.84 - 4.06, h: 2.94 - 0.16, face: 15 },
      { at: [2, 5], w: 3.94 - 0.16, h: 6.84 - 3.06, face: 16 },
      { at: [6, 5], w: 8.84 - 4.06, h: 6.84 - 3.06, face: 20 },
    ];
    for (const c of cases) {
      const r = roomAt(rooms, c.at);
      expect(r.area).toBeCloseTo(c.w * c.h, 9);
      expect(area(r.facePolygon)).toBeCloseTo(c.face, 9);
      expect(r.innerPolygon).toHaveLength(4);
      expect(isCCW(r.innerPolygon)).toBe(true);
      expect(r.holes).toEqual([]);
      expect(r.dims.w).toBeCloseTo(c.w, 9);
      expect(r.dims.h).toBeCloseTo(c.h, 9);
      expect(r.dims.approx).toBe(false);
      expect(r.bbox.max[0] - r.bbox.min[0]).toBeCloseTo(c.w, 9);
      expect(pointInPolygon(r.labelPoint, r.innerPolygon)).toBe(true);
    }
    expect(roomAt(rooms, [2, 1.5]).area).toBeCloseTo(3.78 * 2.78, 9);
  });

  it('lists the sorted bounding wall ids and derives a stable face id from them', () => {
    const sw = roomAt(rooms, [2, 1.5]);
    expect(sw.wallIds).toEqual(['eS', 'eW', 'ix', 'iy']);
    expect(sw.faceId).toBe(`face-${fnv1a('eS|eW|ix|iy')}`);
    const ne = roomAt(rooms, [6, 5]);
    expect(ne.wallIds).toEqual(['eE', 'eN', 'ix', 'iy']);
    expect(new Set(rooms.map((r) => r.faceId)).size).toBe(4);
  });

  it('is independent of the input order of the lines', () => {
    const shuffled = detectRooms([...lines].reverse()).rooms;
    expect(shuffled.map((r) => r.faceId).sort()).toEqual(rooms.map((r) => r.faceId).sort());
    for (const r of shuffled) expect(r.area).toBeCloseTo(rooms.find((q) => q.faceId === r.faceId)?.area ?? NaN, 9);
  });
});

describe('detectRooms — junctions, dividers, gaps', () => {
  it('detects rooms around T-junctions', () => {
    // [0,6]×[0,4]: wall x = 3 full height, wall (3,2)→(6,2) ending in two T-junctions.
    const { rooms, dangling } = detectRooms([
      ...block('e', 0, 0, 6, 4),
      interior('a', [3, 0], [3, 4]),
      interior('b', [3, 2], [6, 2]),
    ]);
    expect(dangling).toEqual([]);
    expect(rooms).toHaveLength(3);
    expect(roomAt(rooms, [1.5, 2]).area).toBeCloseTo((2.94 - 0.16) * (3.84 - 0.16), 9);
    expect(roomAt(rooms, [4.5, 1]).area).toBeCloseTo((5.84 - 3.06) * (1.94 - 0.16), 9);
    expect(roomAt(rooms, [4.5, 3]).area).toBeCloseTo((5.84 - 3.06) * (3.84 - 2.06), 9);
    expect(roomAt(rooms, [4.5, 3]).wallIds).toEqual(['a', 'b', 'eE', 'eN']);
  });

  it('splits a face with a zero-thickness divider that subtracts nothing', () => {
    const { rooms } = detectRooms([...block('e', 0, 0, 6, 4), divider('d', [2, 0], [2, 4])]);
    expect(rooms).toHaveLength(2);
    const left = roomAt(rooms, [1, 2]);
    const right = roomAt(rooms, [4, 2]);
    expect(left.area).toBeCloseTo((2 - 0.16) * 3.68, 9);
    expect(right.area).toBeCloseTo((5.84 - 2) * 3.68, 9);
    expect(left.area + right.area).toBeCloseTo(5.68 * 3.68, 9);
    expect(left.wallIds).toContain('d');
  });

  it('keeps an exterior wall and a coincident divider as one boundary (both ids listed)', () => {
    const { rooms } = detectRooms([...block('e', 0, 0, 6, 4), divider('z', [0, 0], [3, 0]), divider('y', [3, 0], [3, 4])]);
    expect(rooms).toHaveLength(2);
    const left = roomAt(rooms, [1.5, 2]);
    expect(left.wallIds).toEqual(['eN', 'eS', 'eW', 'y', 'z']);
    expect(left.area).toBeCloseTo((3 - 0.16) * 3.68, 9);
  });

  it('closes a wall ending 3 cm short (snap)', () => {
    const { rooms, dangling } = detectRooms([...block('e', 0, 0, 6, 4), interior('w', [3, 0], [3, 3.97])]);
    expect(dangling).toEqual([]);
    expect(rooms).toHaveLength(2);
    expect(roomAt(rooms, [1.5, 2]).area).toBeCloseTo((2.94 - 0.16) * 3.68, 9);
  });

  it('reports a wall ending 10 cm short as dangling and keeps one room (its body is not subtracted)', () => {
    const { rooms, dangling } = detectRooms([...block('e', 0, 0, 6, 4), interior('w', [3, 0], [3, 3.9])]);
    expect(dangling).toEqual(['w']);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].area).toBeCloseTo(5.68 * 3.68, 9);
    expect(rooms[0].wallIds).toEqual(['eE', 'eN', 'eS', 'eW']);
  });

  it('spans two blocks when their shared junction line is absent ("open")', () => {
    // Main house [0,10]×[0,6] and an extension [10,14]×[0,6]; the x = 10 edges are removed by the junction.
    // Exterior pieces end square ("butt") at the junction, so their footprints are not extended there.
    const lines = [
      exterior('mS', [0, 0], [10, 0], OUTER, 0),
      exterior('mN', [10, 6], [0, 6], 0, OUTER),
      exterior('mW', [0, 6], [0, 0]),
      exterior('xS', [10, 0], [14, 0], 0, OUTER),
      exterior('xE', [14, 0], [14, 6]),
      exterior('xN', [14, 6], [10, 6], OUTER, 0),
    ];
    const { rooms, dangling } = detectRooms(lines);
    expect(dangling).toEqual([]);
    expect(rooms).toHaveLength(1);
    expect(area(rooms[0].facePolygon)).toBeCloseTo(84, 9);
    expect(rooms[0].area).toBeCloseTo((13.84 - 0.16) * (5.84 - 0.16), 9);
    expect(rooms[0].innerPolygon).toHaveLength(4);
    expect(rooms[0].wallIds).toEqual(['mN', 'mS', 'mW', 'xE', 'xN', 'xS']);

    // With a 'wall' junction the kept wall splits it into two rooms.
    const walled = detectRooms([...lines, exterior('mE', [10, 0], [10, 6])]).rooms;
    expect(walled).toHaveLength(2);
  });
});

describe('detectRooms — islands, filters, degenerate input', () => {
  it('cuts a free-standing closed wall loop out of the surrounding room', () => {
    // 0.12 m walls whose footprints overlap at the corners (extended by half the thickness).
    const boxWall = (id: string, a: Vec2, b: Vec2): WallLine => ({ id, a, b, footprint: footprint(a, b, 0.06, 0.06, 0.06, 0.06) });
    const box = [
      boxWall('b1', [3, 2], [5, 2]),
      boxWall('b2', [5, 2], [5, 4]),
      boxWall('b3', [5, 4], [3, 4]),
      boxWall('b4', [3, 4], [3, 2]),
    ];
    const { rooms } = detectRooms([...block('e', 0, 0, 8, 6), ...box]);
    expect(rooms).toHaveLength(2);
    const inside = roomAt(rooms, [4, 3]);
    expect(inside.area).toBeCloseTo(1.88 * 1.88, 9);
    const around = roomAt(rooms, [1, 1]);
    expect(around.holes).toHaveLength(1);
    expect(around.area).toBeCloseTo(7.68 * 5.68 - 2.12 * 2.12, 9);
    expect(around.wallIds).toEqual(['b1', 'b2', 'b3', 'b4', 'eE', 'eN', 'eS', 'eW']);
    expect(pointInPolygon(around.labelPoint, around.holes[0])).toBe(false);
  });

  it('handles a loop attached by a bridge wall (weakly simple face)', () => {
    const lines = [
      ...block('e', 0, 0, 8, 6),
      divider('b1', [3, 2], [5, 2]),
      divider('b2', [5, 2], [5, 4]),
      divider('b3', [5, 4], [3, 4]),
      divider('b4', [3, 4], [3, 2]),
      divider('br', [4, 0], [4, 2]),
    ];
    const { rooms, dangling } = detectRooms(lines);
    expect(dangling).toEqual([]);
    expect(rooms).toHaveLength(2);
    expect(roomAt(rooms, [4, 3]).area).toBeCloseTo(4, 9);
    expect(roomAt(rooms, [1, 1]).area).toBeCloseTo(7.68 * 5.68 - 4, 9);
  });

  it('drops faces smaller than minArea and honours a custom minArea', () => {
    const lines = [
      divider('a', [0, 0], [4, 0]),
      divider('b', [4, 0], [4, 3]),
      divider('c', [4, 3], [0, 3]),
      divider('d', [0, 3], [0, 0]),
      divider('s1', [0, 0.5], [0.5, 0.5]),
      divider('s2', [0.5, 0.5], [0.5, 0]),
    ];
    expect(detectRooms(lines).rooms.map((r) => r.area)).toEqual([12 - 0.25]);
    expect(
      detectRooms(lines, { minArea: 0.2 })
        .rooms.map((r) => r.area)
        .sort((x, y) => x - y),
    ).toEqual([0.25, 11.75]);
  });

  it('drops a face that is completely filled by wall bodies', () => {
    // Two 0.27 m walls 0.2 m apart: the 0.2 × 3 m face between them (0.6 m²) has no inner area left.
    const thick = (id: string, a: Vec2, b: Vec2): WallLine => ({ id, a, b, footprint: footprint(a, b, 0.135, 0.135) });
    const { rooms } = detectRooms([
      thick('a', [0, 0], [3, 0]),
      thick('b', [3, 0], [3, 0.2]),
      thick('c', [3, 0.2], [0, 0.2]),
      thick('d', [0, 0.2], [0, 0]),
    ]);
    expect(rooms).toEqual([]);
  });

  it('makes face ids unique when two faces have the same bounding walls', () => {
    // Two triangles sharing the crossing diagonals: different third walls, different ids.
    const lines = [
      divider('a', [0, 0], [2, 2]),
      divider('b', [0, 2], [2, 0]),
      divider('c', [0, 0], [0, 2]),
      divider('d', [2, 0], [2, 2]),
    ];
    const { rooms } = detectRooms(lines);
    expect(rooms).toHaveLength(2);
    const base = `face-${fnv1a('a|b|c')}`;
    expect(rooms.map((r) => r.faceId).sort()).toEqual([`face-${fnv1a('a|b|d')}`, base].sort());
    // Force a collision: the same segment ids on both sides.
    const twin = detectRooms([
      divider('x', [0, 0], [4, 0]),
      divider('x', [4, 0], [4, 2]),
      divider('x', [4, 2], [0, 2]),
      divider('x', [0, 2], [0, 0]),
      divider('x', [2, 0], [2, 2]),
    ]).rooms;
    expect(twin.map((r) => r.faceId)).toEqual([`face-${fnv1a('x')}`, `face-${fnv1a('x')}-2`]);
  });

  it('returns nothing for empty or degenerate input', () => {
    expect(detectRooms([])).toEqual({ rooms: [], dangling: [] });
    expect(detectRooms([divider('p', [1, 1], [1, 1])])).toEqual({ rooms: [], dangling: ['p'] });
    expect(detectRooms([divider('a', [0, 0], [1, 0]), divider('b', [1, 0], [1, 1])]).rooms).toEqual([]);
  });

  it('returns CCW face polygons and handles non-rectangular rooms (approx dims)', () => {
    const { rooms } = detectRooms([
      divider('a', [0, 0], [4, 0]),
      divider('b', [4, 0], [4, 2]),
      divider('c', [4, 2], [2, 2]),
      divider('d', [2, 2], [2, 4]),
      divider('e', [2, 4], [0, 4]),
      divider('f', [0, 4], [0, 0]),
    ]);
    expect(rooms).toHaveLength(1);
    expect(signedArea(rooms[0].facePolygon)).toBeGreaterThan(0);
    expect(rooms[0].area).toBeCloseTo(12, 12);
    expect(rooms[0].dims).toEqual({ w: 4, h: 4, approx: true });
    expect(pointInPolygon(rooms[0].labelPoint, rooms[0].innerPolygon)).toBe(true);
  });
});
