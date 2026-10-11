import { describe, expect, it } from 'vitest';
import type { DerivedBlock, DerivedDeck, DerivedRoom } from '../model/derived';
import type { Block, Level, Room, Variant, Vec2 } from '../model/types';
import { blockPartRegions, computeAreas, levelRegion, partitionByParts, splitAreaByParts } from './areas';
import type { AreaInput } from './areas';
import { area, multiPolygonArea } from './polygon';

// ---------------------------------------------------------------------------
// Fixture: two rectangular blocks sharing an 'open' edge at x = 10
//  A "Hytta" [0,10]×[0,6], existing, parts: old [0,6] (existing), ext [6,10] (new);
//    'replace' zone [0,3]×[0,6] on 'lower', 'add' zone [0,6]×[0,6] on 'loft'.
//  B "Fløy" [10,14]×[0,6], new, one implicit part (as walls.ts derives it).
//  Exterior walls 0.27 = 0.11 outside + 0.16 inside the axis line; no wall (offset 0) along x = 10.
// ---------------------------------------------------------------------------

const OUT = 0.11;
const IN = 0.16;

type Rect = [number, number, number, number];
const rect = ([x0, y0, x1, y1]: Rect): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Offsets a rectangle per side: positive grows. Sides absent from `open` get `d`, open sides 0. */
function grow([x0, y0, x1, y1]: Rect, d: number, open: { W?: boolean; E?: boolean }): Rect {
  return [x0 - (open.W ? 0 : d), y0 - d, x1 + (open.E ? 0 : d), y1 + d];
}

interface PartSpec {
  id: string;
  name: string;
  x0: number;
  x1: number;
  isNew: boolean;
  implicit?: boolean;
}

function makeBlock(
  id: string,
  name: string,
  r: Rect,
  isNew: boolean,
  open: { W?: boolean; E?: boolean },
  parts: PartSpec[],
  zones: DerivedBlock['zones'] = [],
): DerivedBlock {
  const block: Block = {
    id,
    name,
    polygon: rect(r).map((p, i) => ({ id: `${id}-v${i}`, p })),
    levelId: 'main',
    floorZones: [],
    parts: parts.filter((p) => !p.implicit).map((p) => ({ id: p.id, name: p.name, polygon: rect([p.x0, r[1], p.x1, r[3]]), isNew: p.isNew })),
    isNew,
    wall: { thickness: 0.27, outerOffset: OUT },
    eaveHeight: 2.22,
    roof: {
      type: 'gable',
      ridgeAxis: 'x',
      drive: 'pitch',
      pitchDeg: 28,
      ridgeHeight: 3.5,
      thickness: 0.31,
      overhangEave: 0.51,
      overhangGable: 0.35,
      material: 'turf',
    },
    junctions: [],
  };
  const partOpen = (p: PartSpec) => ({ W: p.x0 > r[0] || open.W, E: p.x1 < r[2] || open.E });
  return {
    block,
    axis: rect(r),
    outer: rect(grow(r, OUT, open)),
    inner: rect(grow(r, -IN, open)),
    parts: parts.map((p) => {
      const pr: Rect = [p.x0, r[1], p.x1, r[3]];
      return {
        part: { id: p.id, name: p.name, polygon: rect(pr), isNew: p.isNew },
        outer: rect(grow(pr, OUT, partOpen(p))),
        inner: rect(grow(pr, -IN, partOpen(p))),
        isImplicit: p.implicit === true,
      };
    }),
    zones,
    edges: [],
    axisDims: { w: r[2] - r[0], h: r[3] - r[1] },
    eaveZ: 2.22,
    ridgeZ: 3.5,
    pitchDeg: 28,
    lowestFloorZ: zones.some((z) => z.kind === 'replace') ? -1 : 0,
    groundZ: -1,
  };
}

const LEVELS: Level[] = [
  { id: 'lower', name: 'Underetasje', storeyId: 'ground', elevation: -1, ceilingHeight: 2.3, floorThickness: 0 },
  { id: 'main', name: 'Hovedplan', storeyId: 'ground', elevation: 0, floorThickness: 0 },
  { id: 'loft', name: 'Hems', storeyId: 'loft', elevation: 1.5, floorThickness: 0.17 },
];

const blockA = makeBlock(
  'blk-a',
  'Hytta',
  [0, 0, 10, 6],
  false,
  { E: true },
  [
    { id: 'part-old', name: 'Eksisterende', x0: 0, x1: 6, isNew: false },
    { id: 'part-ext', name: 'Forlenget', x0: 6, x1: 10, isNew: true },
  ],
  [
    { zoneId: 'zone-lower', levelId: 'lower', kind: 'replace', polygon: rect([0, 0, 3, 6]) },
    { zoneId: 'zone-loft', levelId: 'loft', kind: 'add', polygon: rect([0, 0, 6, 6]) },
  ],
);
const blockB = makeBlock('blk-b', 'Fløy', [10, 0, 14, 6], true, { W: true }, [
  { id: 'blk-b/implicit', name: 'Resten', x0: 10, x1: 14, isNew: true, implicit: true },
]);

const deck = (id: string, r: Rect, isNew: boolean): DerivedDeck => ({
  id,
  polygon: rect(r),
  topZ: 0,
  thickness: 0.15,
  skirtBottomZ: [],
  boardDirection: 'x',
  isNew,
});

function derivedRoom(id: string, room: Room | undefined, levelId: string, poly: Vec2[], split: [number, number]): DerivedRoom {
  return {
    id,
    room,
    levelId,
    storeyId: 'ground',
    polygon: poly,
    holes: [],
    area: area(poly),
    areaExisting: split[0],
    areaNew: split[1],
    isNew: split[1] > split[0],
    bbox: { min: poly[0], max: poly[2] },
    dims: { w: 1, h: 1, approx: false },
    labelPoint: poly[0],
    floorMaterial: 'wood',
    facePolygon: poly,
    wallIds: [],
  };
}

const stairwell: Room = { id: 'r-apning', name: 'Trapperom', type: 'apning', levelId: 'main', anchor: [8.5, 2.5] };
const stue: Room = { id: 'r-stue', name: 'Stue', type: 'stue', levelId: 'main', anchor: [12, 3] };

/** Gable roof along x with the ridge at y = 3: underside 3.5 at the ridge, falling 0.5 per metre; null outside. */
function undersideAt(x: number, y: number): number | null {
  if (x < -0.6 || x > 14.6 || y < -0.5 || y > 6.5) return null;
  return 3.5 - 0.5 * Math.abs(y - 3);
}

/** Terrain 1.0 m below the floor west of x = −1.5 and east of x = 7, else 0.3 m below. */
const terrainZ = (x: number): number => (x < -1.5 || x >= 7 ? -1 : -0.3);

function fixture(): AreaInput {
  const variant = { levels: LEVELS } as unknown as Variant;
  return {
    variant,
    blocks: [blockA, blockB],
    rooms: [
      derivedRoom('r-apning', stairwell, 'main', rect([8, 2, 9, 3]), [0, 1]),
      derivedRoom('r-stue', stue, 'main', rect([10, 0.16, 13.84, 5.84]), [0, 3.84 * 5.68]),
      derivedRoom('face-abc', undefined, 'lower', rect([0.16, 0.16, 3, 5.84]), [2.84 * 5.68, 0]),
    ],
    decks: [
      deck('deck-new', [2, -3, 12, 1], true), // overlaps the buildings; high above terrain only for x ≥ 7
      deck('deck-old', [-3, 2, 0, 4], false), // overlaps the west cladding; high only for x < −1.5
      deck('deck-dup', [10, -2, 13, -1], false), // overlaps deck-new for x < 12 (counted once, for deck-new)
    ],
    undersideAt,
    terrainZ: (x) => terrainZ(x),
  };
}

// ---------------------------------------------------------------------------

describe('computeAreas — BYA', () => {
  const { bya } = computeAreas(fixture());

  it('measures buildings as the union of the outer outlines, split by the parts', () => {
    expect(bya.buildings).toBeCloseTo(14.22 * 6.22, 9);
    // Existing = the old part's outer outline [−0.11, 6] × [−0.11, 6.11].
    expect(bya.existing - 4).toBeCloseTo(6.11 * 6.22, 9);
    expect(bya.new - 14.45).toBeCloseTo(14.22 * 6.22 - 6.11 * 6.22, 9);
  });

  it('counts deck area outside the buildings only where the deck is more than 0.5 m above terrain', () => {
    // deck-new: [7,12] × [−3,−0.11] = 14.45 (new); deck-old: [−3,−1.5] × [2,4] = 3; deck-dup: only [12,13] × [−2,−1].
    expect(bya.decks).toBeCloseTo(14.45 + 3 + 1, 9);
  });

  it('keeps the invariants existing + new = total = buildings + decks', () => {
    expect(bya.existing + bya.new).toBeCloseTo(bya.total, 9);
    expect(bya.buildings + bya.decks).toBeCloseTo(bya.total, 9);
  });

  it('reports perBlock per block (not unioned): the parts sum to the block, the blocks to the buildings here', () => {
    expect(bya.perBlock.map((b) => b.blockId)).toEqual(['blk-a', 'blk-b']);
    const [a, b] = bya.perBlock;
    expect(a).toMatchObject({ name: 'Hytta', isNew: false });
    expect(a.area).toBeCloseTo(10.11 * 6.22, 9);
    expect(a.parts.map((p) => [p.partId, p.isNew])).toEqual([
      ['part-old', false],
      ['part-ext', true],
    ]);
    expect(a.parts[0].area).toBeCloseTo(6.11 * 6.22, 9);
    expect(a.parts[1].area).toBeCloseTo(4 * 6.22, 9);
    expect(a.parts[0].area + a.parts[1].area).toBeCloseTo(a.area, 9);
    expect(b.area).toBeCloseTo(4.11 * 6.22, 9);
    expect(b.parts).toHaveLength(1);
    // Shared edge without outer offset → no overlap → Σ perBlock = buildings.
    expect(a.area + b.area).toBeCloseTo(bya.buildings, 9);
  });
});

describe('computeAreas — BRA', () => {
  const { bra } = computeAreas(fixture());
  const level = (id: string) => bra.perLevel.find((l) => l.levelId === id);

  it('lists every level in variant order', () => {
    expect(bra.perLevel.map((l) => [l.levelId, l.name])).toEqual([
      ['lower', 'Underetasje'],
      ['main', 'Hovedplan'],
      ['loft', 'Hems'],
    ]);
  });

  it('counts the whole replace zone on a level with a ceiling', () => {
    expect(level('lower')?.gross).toBeCloseTo(2.84 * 5.68, 9);
    expect(level('lower')?.area).toBeCloseTo(2.84 * 5.68, 9);
  });

  it('carves the replace zone out of the base level and subtracts apning rooms from the measurable area only', () => {
    expect(level('main')?.gross).toBeCloseTo(10.84 * 5.68, 9);
    expect(level('main')?.area).toBeCloseTo(10.84 * 5.68 - 1, 9);
  });

  it('counts the loft only where the free height is ≥ 1.9 m plus the strip (grid-resolved)', () => {
    expect(level('loft')?.gross).toBeCloseTo(5.84 * 5.68, 9);
    // Rule holds for |y − 3| ≤ 0.2; samples at y 2.875 and 3.125; the 5 × 5 neighbourhood counts y ∈ [2.25, 3.75].
    expect(level('loft')?.area).toBeCloseTo(5.84 * 1.5, 9);
    // The exact NS 3940 value (strip 0.6 m on both sides) is 5.84 × 1.6; the grid stays within one cell per side.
    expect(Math.abs((level('loft')?.area ?? 0) - 5.84 * 1.6)).toBeLessThan(2 * 0.25 * 5.84);
  });

  it('splits by the parts and keeps existing + new = total = Σ levels', () => {
    const sum = bra.perLevel.reduce((s, l) => s + l.area, 0);
    expect(bra.total).toBeCloseTo(sum, 9);
    expect(bra.existing + bra.new).toBeCloseTo(bra.total, 9);
    // Existing: lower (all), main [3,6] × [0.16,5.84], loft strip (all inside the old part).
    expect(bra.existing).toBeCloseTo(2.84 * 5.68 + 3 * 5.68 + 5.84 * 1.5, 9);
  });

  it('counts nothing on a level whose ceiling is below 1.9 m', () => {
    const input = fixture();
    input.variant = { levels: [{ ...LEVELS[0], ceilingHeight: 1.8 }] } as unknown as Variant;
    const low = computeAreas(input).bra.perLevel[0];
    expect(low.gross).toBeCloseTo(2.84 * 5.68, 9);
    expect(low.area).toBe(0);
  });

  it('treats points without a roof as full height', () => {
    const input = fixture();
    input.undersideAt = () => null;
    const loft = computeAreas(input).bra.perLevel.find((l) => l.levelId === 'loft');
    expect(loft?.area).toBeCloseTo(5.84 * 5.68, 9);
  });
});

describe('computeAreas — axis and rooms', () => {
  const summary = computeAreas(fixture());

  it('measures the axis-line footprint and splits it by the parts', () => {
    expect(summary.axis.total).toBeCloseTo(84, 9);
    expect(summary.axis.existing).toBeCloseTo(36, 9);
    expect(summary.axis.new).toBeCloseTo(48, 9);
  });

  it('lists every derived room with its net areas (empty name without a record)', () => {
    expect(summary.rooms.map((r) => [r.roomId, r.name, r.levelId])).toEqual([
      ['r-apning', 'Trapperom', 'main'],
      ['r-stue', 'Stue', 'main'],
      ['face-abc', '', 'lower'],
    ]);
    expect(summary.rooms[1].area).toBeCloseTo(3.84 * 5.68, 9);
    expect(summary.rooms[1].isNew).toBe(true);
  });

  it('returns zeros for a variant without blocks', () => {
    const empty = computeAreas({ ...fixture(), blocks: [], rooms: [], decks: [] });
    expect(empty.bya).toMatchObject({ total: 0, existing: 0, new: 0, buildings: 0, decks: 0, perBlock: [] });
    expect(empty.bra.total).toBe(0);
    expect(empty.bra.perLevel.every((l) => l.gross === 0 && l.area === 0)).toBe(true);
    expect(empty.axis).toEqual({ total: 0, existing: 0, new: 0 });
  });
});

describe('partitionByParts', () => {
  const strip = (x0: number, x1: number): Vec2[] => rect([x0, 0, x1, 1]);

  it('gives overlaps to the first part', () => {
    const region = [[strip(0, 4)]];
    const a = partitionByParts(region, [
      { polygon: strip(0, 3), isNew: true },
      { polygon: strip(2, 4), isNew: false },
    ]);
    expect(multiPolygonArea(a.new)).toBeCloseTo(3, 12);
    expect(multiPolygonArea(a.existing)).toBeCloseTo(1, 12);
    const b = partitionByParts(region, [
      { polygon: strip(2, 4), isNew: false },
      { polygon: strip(0, 3), isNew: true },
    ]);
    expect(multiPolygonArea(b.existing)).toBeCloseTo(2, 12);
    expect(multiPolygonArea(b.new)).toBeCloseTo(2, 12);
  });

  it('gives pieces outside every part to the nearest part', () => {
    const split = partitionByParts([[strip(-2, 4)]], [
      { polygon: strip(0, 1), isNew: false },
      { polygon: strip(1, 3), isNew: true },
    ]);
    expect(multiPolygonArea(split.existing)).toBeCloseTo(1 + 2, 12); // [0,1] + [−2,0]
    expect(multiPolygonArea(split.new)).toBeCloseTo(2 + 1, 12); // [1,3] + [3,4]
  });

  it('handles regions with holes and empty input', () => {
    const square = rect([0, 0, 4, 4]);
    const hole = rect([1, 1, 3, 3]).reverse();
    const split = splitAreaByParts(square, [hole], [
      { polygon: rect([0, 0, 2, 4]), isNew: false },
      { polygon: rect([2, 0, 4, 4]), isNew: true },
    ]);
    expect(split.existing).toBeCloseTo(6, 12);
    expect(split.new).toBeCloseTo(6, 12);
    expect(partitionByParts([], [{ polygon: square, isNew: true }])).toEqual({ existing: [], new: [] });
    const noParts = partitionByParts([[square]], []);
    expect(multiPolygonArea(noParts.existing)).toBeCloseTo(16, 12);
    expect(noParts.new).toEqual([]);
  });

  it('orders block parts: derived parts first, then whole blocks as fallback', () => {
    const regions = blockPartRegions([blockA, blockB], 'inner');
    expect(regions.map((r) => r.isNew)).toEqual([false, true, true, false, true]);
    expect(area(regions[3].polygon)).toBeCloseTo(9.84 * 5.68, 9);
    const axis = blockPartRegions([blockA, blockB], 'axis');
    expect(axis.map((r) => area(r.polygon))).toEqual([36, 24, 24, 60, 24]);
  });

  it('falls back to the block when walls.ts lists no implicit part', () => {
    const bare: DerivedBlock = { ...blockB, parts: [] };
    const split = partitionByParts([[bare.inner]], blockPartRegions([bare], 'inner'));
    expect(multiPolygonArea(split.new)).toBeCloseTo(3.84 * 5.68, 9);
    expect(split.existing).toEqual([]);
  });
});

describe('levelRegion', () => {
  it('builds base minus replace zones, plus zones on the level, inside the inner outlines', () => {
    expect(multiPolygonArea(levelRegion(LEVELS[0], [blockA, blockB]))).toBeCloseTo(2.84 * 5.68, 9);
    expect(multiPolygonArea(levelRegion(LEVELS[1], [blockA, blockB]))).toBeCloseTo(10.84 * 5.68, 9);
    expect(multiPolygonArea(levelRegion(LEVELS[2], [blockA, blockB]))).toBeCloseTo(5.84 * 5.68, 9);
    expect(levelRegion({ ...LEVELS[1], id: 'none' }, [blockA, blockB])).toEqual([]);
  });
});
