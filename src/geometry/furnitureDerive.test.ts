/**
 * The furniture stage (geometry/furnitureDerive.ts, docs/phase2-plan.md §4): frame, convex tests, level / room / floor
 * resolution, collisions (overlap, in-wall, doorways and windows, door swings, wall-mounted over base cabinets, rugs
 * under sofas, the L of a corner sofa, structure and hot tubs, levels), warnings, the unknown-id fallback and the
 * structural sharing.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createForslagD } from '../model/seed/forslagD';
import terrainJson from '../model/seed/terrain-merkesvatnet.json';
import type { DerivedVariant, ModelWarning } from '../model/derived';
import type { FurnitureItem, Opening, TerrainAsset, Variant, Vec2 } from '../model/types';
import { makeTestProject, makeVariant } from '../state/testProject';
import { deriveVariant } from './derive';
import {
  COLLISION_TOLERANCE,
  backEdge,
  convexOverlap,
  convexPieces,
  furnitureFootprint,
  furnitureHasConflict,
  furnitureParts,
  localToPlan,
  planToLocal,
  swingSector,
} from './furnitureDerive';
import { area, pointInPolygon } from './polygon';
import { terrainZAt } from './terrain';

const terrain = terrainJson as unknown as TerrainAsset;
const testSite = makeTestProject().site;
const seed = createForslagD();

let n = 0;
function item(catalogId: string, position: Vec2, extra: Partial<FurnitureItem> = {}): FurnitureItem {
  const sizes: Record<string, FurnitureItem['size']> = {
    'seng-90': { w: 0.9, d: 2, h: 0.5 },
    'sofa-3': { w: 2.2, d: 0.9, h: 0.8 },
    teppe: { w: 2, d: 1.4, h: 0.01 },
    kommode: { w: 0.8, d: 0.45, h: 0.8 },
    stol: { w: 0.45, d: 0.45, h: 0.85 },
    benkeskap: { w: 1.2, d: 0.6, h: 0.9 },
    overskap: { w: 1.2, d: 0.35, h: 0.7 },
    hoyskap: { w: 0.6, d: 0.6, h: 2.1 },
    hjornesofa: { w: 2.7, d: 1.6, h: 0.8 },
    salongbord: { w: 0.6, d: 0.6, h: 0.45 },
    toalett: { w: 0.4, d: 0.65, h: 0.8 },
    utestol: { w: 0.55, d: 0.6, h: 0.9 },
    grill: { w: 0.6, d: 0.6, h: 1 },
  };
  return {
    id: extra.id ?? `t-${++n}`,
    catalogId,
    position,
    rotationDeg: 0,
    levelId: 'main',
    size: sizes[catalogId] ?? { w: 1, d: 1, h: 1 },
    isNew: true,
    ...extra,
  };
}

/** The small test cabin (6 × 4 m, interior wall w-1 at x 3: room-1 Stue west, room-2 Soverom east) with furniture. */
function small(items: FurnitureItem[], openings: Opening[] = []): DerivedVariant {
  const v: Variant = { ...makeVariant('v', 'v'), furniture: items, openings };
  return deriveVariant(v, testSite, null);
}

/** The seed with extra furniture (and optionally without its own). */
function seeded(items: FurnitureItem[], opts: { own?: boolean; terrain?: boolean } = {}): DerivedVariant {
  const base = seed.variants[0];
  const v = produce(base, (d) => {
    if (opts.own === false) d.furniture = [];
    d.furniture.push(...items);
  });
  return deriveVariant(v, seed.site, opts.terrain ? terrain : null);
}

const furnitureWarnings = (d: DerivedVariant): ModelWarning[] =>
  d.warnings.filter((w) => w.kind.startsWith('furniture-') || (w.kind === 'door-blocked' && d.furniture.some((f) => f.id === w.by)));

const doorOnW1 = (type: Opening['type'], extra: Partial<Opening> = {}): Opening => ({
  id: 'o-1',
  type,
  host: { kind: 'wall', wallId: 'w-1' },
  offset: 2,
  width: 0.9,
  height: type === 'window' ? 1.2 : 2.0,
  sill: type === 'window' ? 0.8 : 0,
  levelId: 'main',
  style: { frameColour: 'white' },
  status: 'new',
  ...(type === 'door' ? { swing: { hinge: 'start', side: 'right' } } : {}),
  ...extra,
});

// ---------------------------------------------------------------------------
// Frame and convex geometry
// ---------------------------------------------------------------------------

describe('local frame', () => {
  it('back at local +y; rotationDeg turns counter-clockwise (0 north, 90 west, 180 south, 270 east)', () => {
    const at = (rotationDeg: number) => backEdge(item('seng-90', [10, 10], { rotationDeg }));
    const mid = (e: [Vec2, Vec2]): Vec2 => [(e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2];
    const expectNear = (p: Vec2, q: Vec2) => {
      expect(p[0]).toBeCloseTo(q[0], 9);
      expect(p[1]).toBeCloseTo(q[1], 9);
    };
    expectNear(mid(at(0)), [10, 11]);
    expectNear(mid(at(90)), [9, 10]);
    expectNear(mid(at(180)), [10, 9]);
    expectNear(mid(at(270)), [11, 10]);
    const it2 = item('seng-90', [3, 4], { rotationDeg: 37 });
    const q = planToLocal(it2, localToPlan(it2, 0.3, -0.7));
    expect(q[0]).toBeCloseTo(0.3, 9);
    expect(q[1]).toBeCloseTo(-0.7, 9);
  });

  it('footprint = the size rectangle rotated about the centre; an L sofa has two parts', () => {
    const fp = furnitureFootprint(item('seng-90', [1, 1], { rotationDeg: 90 }));
    expect(area(fp)).toBeCloseTo(1.8, 9);
    const xs = fp.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 9);
    expect(furnitureParts(item('hjornesofa', [0, 0]))).toHaveLength(2);
    expect(furnitureParts(item('seng-90', [0, 0]))).toHaveLength(1);
  });
});

describe('convex tests', () => {
  const sq = (x: number, y: number, s = 1): Vec2[] => [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ];

  it('separating axes with a 5 mm tolerance: touching or ≤ 5 mm is no overlap', () => {
    expect(COLLISION_TOLERANCE).toBe(0.005);
    expect(convexOverlap(sq(0, 0), sq(1, 0))).toBe(false);
    expect(convexOverlap(sq(0, 0), sq(0.996, 0))).toBe(false);
    expect(convexOverlap(sq(0, 0), sq(0.994, 0))).toBe(true);
    expect(convexOverlap(sq(0, 0), sq(0.5, 0.5))).toBe(true);
    // Diamond against square corner: separated along the diamond's edge normal although the boxes overlap.
    const diamond: Vec2[] = [
      [1.6, 1.0],
      [2.1, 1.5],
      [1.6, 2.0],
      [1.1, 1.5],
    ];
    expect(convexOverlap(sq(0, 0), diamond)).toBe(false);
  });

  it('convexPieces: a convex polygon stays whole, a non-convex one is triangulated with the same area', () => {
    expect(convexPieces(sq(0, 0, 2))).toHaveLength(1);
    const l: Vec2[] = [
      [0, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 2],
      [0, 2],
    ];
    const pieces = convexPieces(l);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.reduce((s, p) => s + area(p), 0)).toBeCloseTo(3, 9);
  });

  it('swingSector: the quarter disc between the closed and the open leaf, either sweep', () => {
    const ccw = swingSector({ hinge: [0, 0], closed: [1, 0], open: [0, 1], sweep: 1 });
    expect(area(ccw)).toBeCloseTo(Math.PI / 4, 1);
    expect(pointInPolygon([0.3, 0.3], ccw)).toBe(true);
    expect(pointInPolygon([0.3, -0.3], ccw)).toBe(false);
    const cw = swingSector({ hinge: [0, 0], closed: [1, 0], open: [0, -1], sweep: -1 });
    expect(pointInPolygon([0.3, -0.3], cw)).toBe(true);
    expect(convexPieces(cw)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

describe('collisions', () => {
  it('two items overlapping: furniture-overlap once, both list each other; touching items do not collide', () => {
    const a = item('kommode', [1, 1], { id: 'a' });
    const b = item('kommode', [1.3, 1], { id: 'b' });
    const c = item('kommode', [2.1, 1], { id: 'c' }); // touches b (b ends at 1.7, c starts at 1.7)
    const d = small([a, b, c]);
    expect(furnitureWarnings(d)).toEqual([{ kind: 'furniture-overlap', furnitureIds: ['a', 'b'] }]);
    expect(d.furniture.find((f) => f.id === 'a')?.collisions).toEqual(['b']);
    expect(d.furniture.find((f) => f.id === 'b')?.collisions).toEqual(['a']);
    expect(d.furniture.find((f) => f.id === 'c')?.collisions).toEqual([]);
    expect(furnitureHasConflict(d.furniture[0])).toBe(true);
    expect(furnitureHasConflict(d.furniture[2])).toBe(false);
  });

  it('an item across a wall: furniture-in-wall with the wall id', () => {
    const d = small([item('kommode', [3, 1], { id: 'k' })]);
    expect(furnitureWarnings(d)).toEqual([{ kind: 'furniture-in-wall', furnitureId: 'k', wallId: 'w-1' }]);
    expect(d.furniture[0].collisions).toEqual(['w-1']);
  });

  it('a back snapped onto a wall face (0 gap) does not collide; 1 cm into it does', () => {
    // w-1 at x 3, thickness 0.12: west face x 2.94. A kommode backed onto it (rotation 270 = back east).
    expect(furnitureWarnings(small([item('kommode', [2.94 - 0.225, 1], { rotationDeg: 270 })]))).toEqual([]);
    expect(furnitureWarnings(small([item('kommode', [2.95 - 0.225, 1], { rotationDeg: 270, id: 'in' })]))).toEqual([
      { kind: 'furniture-in-wall', furnitureId: 'in', wallId: 'w-1' },
    ]);
  });

  it('door swing: an item in the arc blocks the door (door-blocked, blocksDoors); outside the arc it does not', () => {
    // o-1 on w-1 at y 2 (1.55 … 2.45), swinging into room-2 (east, 'right' of a→b going north).
    const inArc = item('kommode', [3.5, 1.9], { id: 'k' });
    const d = small([inArc], [doorOnW1('door')]);
    expect(d.furniture[0].blocksDoors).toEqual(['o-1']);
    expect(furnitureWarnings(d)).toEqual([{ kind: 'door-blocked', openingId: 'o-1', by: 'k' }]);
    // The same item west of the wall (the door does not open that way).
    expect(furnitureWarnings(small([item('kommode', [2.5, 1.9])], [doorOnW1('door')]))).toEqual([]);
    // A rug under the swing never blocks the door.
    expect(furnitureWarnings(small([item('teppe', [4, 2])], [doorOnW1('door')]))).toEqual([]);
  });

  it('a chair standing in a doorway is not "in the wall"; a cabinet under a window is', () => {
    const chair = item('stol', [3, 2], { id: 's' });
    expect(furnitureWarnings(small([chair], [doorOnW1('opening')]))).toEqual([]);
    const cabinet = item('benkeskap', [3, 2], { id: 'b', rotationDeg: 90 });
    expect(furnitureWarnings(small([cabinet], [doorOnW1('window')]))).toEqual([{ kind: 'furniture-in-wall', furnitureId: 'b', wallId: 'w-1' }]);
    // Without any opening the chair is in the wall.
    expect(furnitureWarnings(small([item('stol', [3, 2], { id: 's2' })]))).toEqual([{ kind: 'furniture-in-wall', furnitureId: 's2', wallId: 'w-1' }]);
  });

  it('a wall cabinet over a base cabinet does not collide; over a tall cabinet it does', () => {
    // Both backed onto the south wall's inner face (y 0.16), rotation 180 = back south.
    const base = item('benkeskap', [1.5, 0.16 + 0.3], { id: 'base', rotationDeg: 180 });
    const wallCab = item('overskap', [1.5, 0.16 + 0.175], { id: 'wall', rotationDeg: 180 });
    const d = small([base, wallCab]);
    expect(furnitureWarnings(d)).toEqual([]);
    expect(d.furniture.find((f) => f.id === 'wall')?.z).toBeCloseTo(1.4, 9);
    const tall = item('hoyskap', [1.5, 0.16 + 0.3], { id: 'tall', rotationDeg: 180 });
    expect(furnitureWarnings(small([tall, { ...wallCab, id: 'wall2' }]))).toEqual([{ kind: 'furniture-overlap', furnitureIds: ['tall', 'wall2'] }]);
  });

  it('a rug under a sofa does not collide; two sofas do', () => {
    expect(furnitureWarnings(small([item('teppe', [1.5, 2]), item('sofa-3', [1.5, 2])]))).toEqual([]);
    expect(furnitureWarnings(small([item('sofa-3', [1.5, 2], { id: 'x' }), item('sofa-3', [1.5, 2.3], { id: 'y' })]))).toEqual([
      { kind: 'furniture-overlap', furnitureIds: ['x', 'y'] },
    ]);
  });

  it('a coffee table may stand in the free corner of a corner sofa, not on its chaise', () => {
    // Sofa 2.7 × 1.6 at (1.55, 2): back strip y 1.9 … 2.8, chaise x 2.0 … 2.9, y 1.2 … 1.9.
    const sofa = item('hjornesofa', [1.55, 2], { id: 'sofa' });
    expect(furnitureWarnings(small([sofa, item('salongbord', [1.0, 1.5], { id: 'free' })]))).toEqual([]);
    expect(furnitureWarnings(small([sofa, item('salongbord', [2.45, 1.5], { id: 'chaise' })]))).toEqual([
      { kind: 'furniture-overlap', furnitureIds: ['sofa', 'chaise'] },
    ]);
  });

  it('structure and the hot tub: the chimney, a post, a stair, the tub', () => {
    const d = seeded(
      [
        item('stol', [7.35, 2.75], { id: 'chimney' }),
        item('stol', [8.95, 3.4], { id: 'post' }),
        item('stol', [5.5, 2.6], { id: 'stair' }),
        item('utestol', [21.7, -3.2], { id: 'tub' }),
      ],
      { own: false },
    );
    const byId = (id: string) => d.furniture.find((f) => f.id === id);
    expect(byId('chimney')?.collisions).toEqual(['chimney-1']);
    expect(byId('post')?.collisions).toEqual([]);
    expect(byId('stair')?.collisions).toEqual(['stair-loft']);
    expect(byId('tub')?.collisions).toEqual(['tub-1']);
    expect(furnitureWarnings(d)).toEqual([
      { kind: 'furniture-in-wall', furnitureId: 'chimney', wallId: 'chimney-1' },
      { kind: 'furniture-in-wall', furnitureId: 'stair', wallId: 'stair-loft' },
      { kind: 'furniture-in-wall', furnitureId: 'tub', wallId: 'tub-1' },
    ]);
    const onPost = seeded([item('stol', [8.95, 3.1], { id: 'p' })], { own: false });
    expect(onPost.furniture[0].collisions).toContain('post-2');
  });

  it('levels: a loft bed over a lower door blocks nothing; the same bed on the lower level blocks it', () => {
    // d-105 (lower) swings into Soverom 2 around (2.6, 2.3); Hems 1 (loft) lies above it.
    const loftBed = item('seng-90', [2.4, 1.12], { id: 'loft', levelId: 'loft', size: { w: 0.9, d: 1.9, h: 0.5 } });
    const d = seeded([loftBed], { own: false });
    expect(d.furniture[0]).toMatchObject({ levelId: 'loft', roomId: 'room-hems1', floorZ: 1.47, blocksDoors: [], collisions: [] });
    expect(furnitureWarnings(d)).toEqual([]);
    const lowerBed = { ...loftBed, id: 'lower', levelId: 'lower' };
    const dl = seeded([lowerBed], { own: false });
    expect(dl.furniture[0]).toMatchObject({ levelId: 'lower', roomId: 'room-sov2', floorZ: -1 });
    expect(dl.furniture[0].blocksDoors).toEqual(['d-105']);
  });
});

// ---------------------------------------------------------------------------
// Level, room, floor; warnings
// ---------------------------------------------------------------------------

describe('level, room and floor', () => {
  it('the derived level is the room under the centre (a bed stored on main in Soverom 1 stands at −1.0)', () => {
    const d = seeded([item('seng-90', [1.2, 5], { id: 'b', levelId: 'main' })], { own: false });
    expect(d.furniture[0]).toMatchObject({ levelId: 'lower', roomId: 'room-sov1', floorZ: -1, z: -1 });
  });

  it('on the deck: the deck top; on the lawn: the terrain; inside a block without a room: the level', () => {
    const d = seeded(
      [item('utestol', [12, -3], { id: 'deck' }), item('grill', [-4, 18], { id: 'lawn' }), item('stol', [8.0, 4.24], { id: 'wall' })],
      { own: false, terrain: true },
    );
    const byId = (id: string) => d.furniture.find((f) => f.id === id)!;
    expect(byId('deck')).toMatchObject({ floorZ: -0.02, levelId: 'main' });
    expect(byId('deck').roomId).toBeUndefined();
    expect(byId('lawn').floorZ).toBeCloseTo(terrainZAt(terrain, seed.site, -4, 18, d.groundWorks), 9);
    expect(byId('lawn').floorZ).toBeLessThan(-1);
    // A chair centred on a wall line stands on the floor next to it (no room, but in the building: no 'outside').
    expect(byId('wall')).toMatchObject({ levelId: 'main', floorZ: 0 });
    expect(byId('wall').roomId).toBeUndefined();
    expect(d.warnings.some((w) => w.kind === 'furniture-outside' && w.furnitureId === 'wall')).toBe(false);
  });

  it('a loft item over the stairwell: no floor there ("outside"), but it stays at the loft level', () => {
    const d = seeded([item('stol', [4.5, 2.6], { id: 'well', levelId: 'loft' })], { own: false });
    expect(d.furniture[0]).toMatchObject({ levelId: 'loft', floorZ: 1.47 });
    expect(d.furniture[0].roomId).toBeUndefined();
    expect(furnitureWarnings(d)).toContainEqual({ kind: 'furniture-outside', furnitureId: 'well' });
  });

  it('warnings: indoor items outside every room and deck, items that need a drain outside wet rooms', () => {
    const d = seeded(
      [
        item('stol', [-4, 18], { id: 'lawn-chair' }),
        item('grill', [-4, 19], { id: 'lawn-grill' }),
        item('sofa-3', [13, -3], { id: 'deck-sofa' }),
        item('toalett', [13.5, 1.0], { id: 'stue-wc' }),
        item('toalett', [-6, 18], { id: 'lawn-wc' }),
        item('toalett', [19.8, 0.2], { id: 'bath-wc', rotationDeg: 0 }),
      ],
      { own: false },
    );
    expect(furnitureWarnings(d)).toEqual([
      { kind: 'furniture-outside', furnitureId: 'lawn-chair' },
      { kind: 'furniture-needs-wet-room', furnitureId: 'stue-wc', roomId: 'room-stue' },
      { kind: 'furniture-outside', furnitureId: 'lawn-wc' },
      { kind: 'furniture-needs-wet-room', furnitureId: 'lawn-wc' },
    ]);
    expect(d.furniture.find((f) => f.id === 'stue-wc')?.needsDrain).toBe(true);
    expect(d.furniture.find((f) => f.id === 'lawn-chair')?.needsDrain).toBe(false);
  });

  it('unknown catalogue id: a plain box of its size, catalog null, no clearances, furniture-unknown', () => {
    const d = small([item('rakett', [1.5, 2], { id: 'r', size: { w: 0.5, d: 0.4, h: 2 } })]);
    expect(d.furniture[0]).toMatchObject({ catalog: null, clearances: [], needsDrain: false, roomId: 'room-1' });
    expect(area(d.furniture[0].footprint)).toBeCloseTo(0.2, 9);
    expect(furnitureWarnings(d)).toEqual([{ kind: 'furniture-unknown', furnitureId: 'r', catalogId: 'rakett' }]);
  });

  it('catalogue data and clearances in plan: a toilet backed east has its 0,6 m zone to the west', () => {
    const d = small([item('toalett', [2.94 - 0.325, 1], { id: 'wc', rotationDeg: 270 })]);
    const f = d.furniture[0];
    expect(f.catalog?.name).toBe('Toalett');
    expect(f.clearances).toHaveLength(1);
    const xs = f.clearances[0].map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(2.94 - 0.65 - 0.6, 9);
    expect(Math.max(...xs)).toBeCloseTo(2.94 - 0.65, 9);
  });
});

// ---------------------------------------------------------------------------
// Structural sharing and cost
// ---------------------------------------------------------------------------

describe('sharing and cost', () => {
  it('a building edit that touches no furniture keeps the derived items; one that does renews only those', () => {
    const base = seed.variants[0];
    const d0 = deriveVariant(base, seed.site, null);
    // w-gang-n thicker by 2 cm: no item stands within 1 cm of it.
    const thicker = produce(base, (v) => {
      v.walls.find((w) => w.id === 'w-gang-n')!.thickness = 0.14;
    });
    const d1 = deriveVariant(thicker, seed.site, null);
    expect(d1.walls).not.toBe(d0.walls);
    expect(d1.furniture).toBe(d0.furniture);
    // w-gang-n moved 0,1 m north runs into the south nightstand of the new bedroom.
    const moved = produce(base, (v) => {
      const w = v.walls.find((x) => x.id === 'w-gang-n')!;
      w.a = [w.a[0], 3.5];
      w.b = [w.b[0], 3.5];
    });
    const d2 = deriveVariant(moved, seed.site, null);
    const changed = d2.furniture.filter((f, i) => f !== d0.furniture[i]).map((f) => f.id);
    expect(changed).toEqual(['fu-sov-ny-2']);
    expect(d2.furniture.find((f) => f.id === 'fu-sov-ny-2')?.collisions).toEqual(['w-gang-n']);
  });

  it('a furniture-only change re-derives only the furniture stage (≤ 5 ms on the furnished seed)', () => {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    const slack = env.CI ? 3 : 1.5;
    const base = seed.variants[0];
    const d0 = deriveVariant(base, seed.site, terrain);
    let best = Infinity;
    for (let k = 0; k < 10; k++) {
      const v = produce(base, (x) => {
        const f = x.furniture.find((it) => it.id === 'fu-stue-3')!;
        f.position = [f.position[0] + 0.01 * (k + 1), f.position[1]];
      });
      const t0 = performance.now();
      const d = deriveVariant(v, seed.site, terrain);
      best = Math.min(best, performance.now() - t0);
      expect(d.walls).toBe(d0.walls);
      expect(d.rooms).toBe(d0.rooms);
    }
    expect(best).toBeLessThanOrEqual(5 * slack);
  });
});
