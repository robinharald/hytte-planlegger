/**
 * Numerical robustness of the derive pipeline (review finding "polygon-clipping throws on rounding noise"): Forslag D
 * rotated as a whole and with one corner moved off the grid must derive without throwing and still find its rooms;
 * a self-intersecting block gets a warning instead of blanking the model. (clipFailure.test.ts covers the fallbacks
 * when polygon-clipping fails outright.)
 */
import { describe, expect, it } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import type { StructureElement, Variant, Vec2 } from '../model/types';
import { createForslagD } from '../model/seed/forslagD';
import { deriveVariant } from './derive';
import { ClipError, collectClipFallbacks, differencePolygons, intersectPolygons, isSelfIntersecting, unionPolygons, withClipFallback } from './polygon';

const project = createForslagD();
const site = project.site;
const seed = deriveVariant(project.variants[0], site, null);
const LOFT_ROOMS = new Set(['room-hems1', 'room-hems2', 'room-repos']);

/**
 * The seed variant rotated by `deg` about `centre`: block vertices, floor zones, parts, stored walls, room anchors,
 * decks, railings, hot tubs, posts, beams; chimney and stair rectangles become the boxes of their rotated corners.
 * Openings keep their hosts and offsets (the hosts rotate with them).
 */
function rotatedSeed(deg: number, centre: Vec2 = [10, 4]): Variant {
  const v = createForslagD().variants[0];
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  const r = (p: Vec2): Vec2 => {
    const x = p[0] - centre[0];
    const y = p[1] - centre[1];
    return [centre[0] + c * x - s * y, centre[1] + s * x + c * y];
  };
  const box = (min: Vec2, max: Vec2): { min: Vec2; max: Vec2 } => {
    const pts = ([min, [max[0], min[1]], max, [min[0], max[1]]] as Vec2[]).map(r);
    return {
      min: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))],
      max: [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))],
    };
  };
  for (const b of v.blocks) {
    for (const vx of b.polygon) vx.p = r(vx.p);
    for (const z of b.floorZones) z.polygon = z.polygon.map(r);
    for (const p of b.parts) p.polygon = p.polygon.map(r);
  }
  for (const w of v.walls) {
    w.a = r(w.a);
    w.b = r(w.b);
  }
  for (const room of v.rooms) room.anchor = r(room.anchor);
  for (const d of v.outdoor.decks) for (const vx of d.polygon) vx.p = r(vx.p);
  for (const t of v.outdoor.hotTubs) t.centre = r(t.centre);
  v.structure = v.structure.map((e): StructureElement => {
    switch (e.kind) {
      case 'post':
        return { ...e, position: r(e.position) };
      case 'beam':
        return { ...e, a: r(e.a), b: r(e.b) };
      case 'chimney':
      case 'stair':
        return { ...e, ...box(e.min, e.max) };
    }
  });
  return v;
}

function expectRoomsFound(d: DerivedVariant): void {
  expect(d.rooms.filter((r) => r.room).length).toBe(project.variants[0].rooms.length);
  expect(d.warnings.filter((w) => w.kind === 'room-anchor-lost' || w.kind === 'room-unnamed')).toEqual([]);
}

describe('Forslag D rotated and perturbed', () => {
  it.each([0.5, 30])('rotated by %s° derives without throwing and finds every room with the same areas', (deg) => {
    const d = deriveVariant(rotatedSeed(deg), site, null);
    expectRoomsFound(d);
    expect(d.warnings.filter((w) => w.kind === 'generic')).toEqual([]);
    // Rooms below the roofs keep their areas; the loft's walls follow the (bounding-box) roofs of the rotated blocks,
    // so its rooms may differ slightly.
    const before = new Map(seed.rooms.map((r) => [r.id, r.area]));
    for (const r of d.rooms) {
      if (!LOFT_ROOMS.has(r.id)) expect(r.area, r.id).toBeCloseTo(before.get(r.id)!, 4);
    }
    expect(d.areas.axis.total).toBeCloseTo(seed.areas.axis.total, 4);
    expect(d.areas.bra.perLevel[0].area).toBeCloseTo(seed.areas.bra.perLevel[0].area, 4);
  });

  it('survives every rotation in 2° steps', () => {
    for (let deg = 1.5; deg < 90; deg += 2) {
      const d = deriveVariant(rotatedSeed(deg), site, null);
      expect(d.rooms.filter((r) => r.room).length, `${deg}°`).toBe(27);
    }
  });

  it('blk-main vertex 0 moved to (0.071, 0.043) derives and finds every room', () => {
    const v = createForslagD().variants[0];
    v.blocks[0].polygon[0].p = [0.071, 0.043];
    // The building alone: the seed's furniture (revision 6) would stand a few cm into the tilted walls.
    v.furniture = [];
    const d = deriveVariant(v, site, null);
    expectRoomsFound(d);
    expect(d.warnings).toEqual([]);
  });

  it('a self-intersecting blk-main (two vertices swapped) warns instead of throwing', () => {
    const v = createForslagD().variants[0];
    const poly = v.blocks[0].polygon;
    [poly[1].p, poly[2].p] = [poly[2].p, poly[1].p];
    const d = deriveVariant(v, site, null);
    expect(d.warnings).toContainEqual({ kind: 'block-self-intersecting', blockId: 'blk-main' });
    expect(d.walls.length).toBeGreaterThan(0);
  });
});

describe('polygon.ts boolean wrapper', () => {
  it('snaps rounding noise: nearly coincident edges give clean results', () => {
    const a: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    const b: Vec2[] = [
      [4.000000000000001, 1],
      [6, 1],
      [6, 3],
      [3.9999999999999996, 3],
    ];
    expect(unionPolygons([a, b])).toHaveLength(1);
    expect(intersectPolygons([a], [b])).toEqual([]);
    expect(differencePolygons([a], [b])[0][0]).toHaveLength(4);
  });

  it('withClipFallback falls back on ClipError only; collectClipFallbacks reports every fallback taken', () => {
    const fail = (): number => {
      throw new ClipError('union', new Error('boom'));
    };
    const { result, fallbacks } = collectClipFallbacks(() => withClipFallback('outer', () => withClipFallback('inner', fail, () => 1) + fail(), () => 2));
    expect(result).toBe(2);
    expect(fallbacks.map((f) => f.where)).toEqual(['inner', 'outer']);
    expect(withClipFallback('x', fail, () => 3)).toBe(3); // no collector: nothing reported, no error
    expect(() =>
      withClipFallback(
        'bug',
        () => {
          throw new TypeError('not a clipping failure');
        },
        () => 0,
      ),
    ).toThrow(TypeError);
  });

  it('ClipError is an Error naming the operation and the cause', () => {
    const e = new ClipError('union', new Error('boom'));
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toContain('union');
    expect(e.message).toContain('boom');
  });

  it('isSelfIntersecting: crossing, touching and folded rings', () => {
    const square: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    expect(isSelfIntersecting(square)).toBe(false);
    expect(isSelfIntersecting([square[0], square[2], square[1], square[3]])).toBe(true);
    expect(isSelfIntersecting([...square, [0, 0]])).toBe(false); // closing point repeated
    expect(
      isSelfIntersecting([
        [0, 0],
        [4, 0],
        [4, 4],
        [2, 0],
        [0, 4],
      ]),
    ).toBe(true); // vertex touching an edge
    expect(
      isSelfIntersecting([
        [0, 0],
        [4, 0],
        [2, 0],
        [2, 3],
      ]),
    ).toBe(true); // folds back
    expect(
      isSelfIntersecting([
        [0, 0],
        [2, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ]),
    ).toBe(false); // collinear vertex
  });
});
