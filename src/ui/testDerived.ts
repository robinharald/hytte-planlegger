/**
 * Hand-made DerivedVariant fixture for UI unit tests (schedule, properties, warnings, panels). Not used by the app.
 * Matches testProject.ts's variant ids where they overlap (block 'blk-1', rooms 'room-1'/'room-2', wall 'w-1').
 */
import type { DerivedBlock, DerivedOpening, DerivedRoom, DerivedVariant, DerivedWall } from '../model/derived';
import type { Level, Room, Vec2 } from '../model/types';
import { makeVariant } from '../state/testProject';

export const LEVELS: Level[] = [
  { id: 'main', name: 'Hovedplan', storeyId: 'ground', elevation: 0, floorThickness: 0 },
  { id: 'lower', name: 'Underetasje (soverom)', storeyId: 'ground', elevation: -1, ceilingHeight: 2.3, floorThickness: 0 },
  { id: 'loft', name: 'Hems', storeyId: 'loft', elevation: 1.47, floorThickness: 0.17 },
];

function rect(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

export function derivedRoom(
  id: string,
  levelId: string,
  area: number,
  split: { existing: number; new: number },
  room?: Partial<Room> & { name: string; type: Room['type'] },
): DerivedRoom {
  const storeyId = LEVELS.find((l) => l.id === levelId)?.storeyId ?? 'ground';
  const poly = rect(0, 0, 2, area / 2);
  return {
    id,
    room: room ? { id, levelId, anchor: [1, 1], ...room } : undefined,
    levelId,
    storeyId,
    polygon: poly,
    holes: [],
    area,
    areaExisting: split.existing,
    areaNew: split.new,
    isNew: split.new > split.existing,
    bbox: { min: [0, 0], max: [2, area / 2] },
    dims: { w: 2, h: area / 2, approx: false },
    labelPoint: [1, area / 4],
    blockId: 'blk-1',
    floorMaterial: 'wood',
    facePolygon: poly,
    wallIds: [],
  };
}

const variant = makeVariant('v-1', 'Forslag D');

export const BLOCK: DerivedBlock = {
  block: variant.blocks[0],
  axis: rect(0, 0, 6, 4),
  outer: rect(-0.11, -0.11, 6.11, 4.11),
  inner: rect(0.16, 0.16, 5.84, 3.84),
  parts: [],
  zones: [],
  edges: [{ edgeId: 'v-sw', a: [0, 0], b: [6, 0], length: 6, outward: [0, -1] }],
  axisDims: { w: 6, h: 4 },
  eaveZ: 2.22,
  ridgeZ: 3.27,
  pitchDeg: 28,
  lowestFloorZ: 0,
  groundZ: -0.5,
};

const OPENING: DerivedOpening = {
  id: 'o-1',
  opening: {
    id: 'o-1',
    type: 'window',
    host: { kind: 'blockEdge', blockId: 'blk-1', edgeId: 'v-sw' },
    offset: 3,
    width: 1.2,
    height: 1.1,
    sill: 0.9,
    style: { frameColour: 'white' },
    status: 'new',
  },
  type: 'window',
  status: 'new',
  isNew: true,
  offset: 3,
  width: 1.2,
  sillZ: 0.9,
  headZ: 2.0,
  footprint: [],
  glazed: true,
  leaf: 'none',
  frameColour: 'white',
  leafColour: 'glass',
  panes: [1, 1],
  frameDepth: 0.1,
  glassPlane: 0.08,
};

function wall(id: string, source: DerivedWall['source'], a: Vec2, b: Vec2, extra: Partial<DerivedWall> = {}): DerivedWall {
  return {
    id,
    source,
    a,
    b,
    thickness: 0.12,
    faceLeft: 0.06,
    faceRight: 0.06,
    footprint: [],
    ends: { start: 'butt', end: 'butt' },
    isExterior: false,
    isDivider: false,
    status: 'existing',
    isNew: false,
    levelId: 'main',
    levelIds: ['main'],
    storeyIds: ['ground'],
    baseZ: 0,
    topZ: 2.3,
    topProfile: [
      { t: 0, z: 2.3 },
      { t: 1, z: 2.3 },
    ],
    openings: [],
    patches: [],
    ...extra,
  };
}

export const EXT_WALL = wall('blk-1/v-sw/blk-1/base', { kind: 'blockEdge', blockId: 'blk-1', edgeId: 'v-sw', partId: 'blk-1', zoneId: null }, [0, 0], [6, 0], {
  thickness: 0.27,
  faceLeft: 0.16,
  faceRight: 0.11,
  isExterior: true,
  topZ: 2.22,
  openings: [OPENING],
});

export const INT_WALL = wall('w-1', { kind: 'wall', wallId: 'w-1' }, [3, 0], [3, 4]);

export function makeDerived(overrides: Partial<DerivedVariant> = {}): DerivedVariant {
  const rooms = [
    derivedRoom('room-1', 'main', 20.04, { existing: 20.04, new: 0 }, { name: 'Stue', type: 'stue' }),
    derivedRoom('room-2', 'main', 6.5, { existing: 0, new: 6.5 }, { name: 'Hovedbad', type: 'bad' }),
    derivedRoom('gang', 'lower', 5, { existing: 3, new: 2 }, { name: 'Gang nedre', type: 'gang', note: 'Trapp opp' }),
    derivedRoom('face-abc', 'main', 1.2, { existing: 1.2, new: 0 }),
    derivedRoom('void', 'loft', 2, { existing: 2, new: 0 }, { name: 'Trappeåpning', type: 'apning' }),
    derivedRoom('hems-1', 'loft', 8, { existing: 8, new: 0 }, { name: 'Hems 1', type: 'hems' }),
  ];
  return {
    variantId: 'v-1',
    levels: LEVELS,
    storeys: [
      { id: 'ground', name: 'Plan 1', levelIds: ['lower', 'main'] },
      { id: 'loft', name: 'Hems', levelIds: ['loft'] },
    ],
    blocks: [BLOCK],
    walls: [EXT_WALL, INT_WALL],
    groundWorks: [],
    wallUnion: [],
    rooms,
    floors: [],
    roofs: [],
    outdoor: {
      decks: [{ id: 'deck-1', polygon: rect(0, -3, 4, 0), topZ: 0, thickness: 0.15, skirtBottomZ: [], boardDirection: 'x', isNew: true }],
      railings: [],
      hotTubs: [],
    },
    structure: [],
    furniture: [],
    foundations: [],
    dimensions: [],
    site: { trees: [{ tree: { id: 't-1', position: [-4, 4], height: 5.5, kind: 'bjork' }, baseZ: -1 }] },
    bounds: { min: [0, -3], max: [6, 4] },
    areas: {
      bya: { total: 170.2, existing: 120.1, new: 50.1, buildings: 160.2, decks: 10, perBlock: [] },
      bra: {
        total: 140,
        existing: 100,
        new: 40,
        perLevel: [
          { levelId: 'main', name: 'Hovedplan', gross: 110, area: 100 },
          { levelId: 'loft', name: 'Hems', gross: 20, area: 8 },
          { levelId: 'lower', name: 'Underetasje (soverom)', gross: 35, area: 32 },
        ],
      },
      axis: { total: 170.16, existing: 120, new: 50.16 },
      rooms: rooms.map((r) => ({
        roomId: r.id,
        name: r.room?.name ?? '',
        levelId: r.levelId,
        area: r.area,
        areaExisting: r.areaExisting,
        areaNew: r.areaNew,
        isNew: r.isNew,
      })),
    },
    warnings: [
      { kind: 'room-unnamed', faceId: 'face-abc', levelId: 'main', area: 1.2 },
      { kind: 'wall-dangling', wallId: 'w-1' },
      { kind: 'area-limit', limit: 150, actual: 170.2 },
    ],
    ...overrides,
  };
}
