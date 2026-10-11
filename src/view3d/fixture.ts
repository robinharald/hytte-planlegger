/**
 * A small hand-made derived model for the 3D view's tests (no derive pipeline involved).
 *
 * One block 'blk' on the axis rectangle [0,6]×[0,4] (exterior build-up 0.27 m, 0.11 m outside the axis line),
 * gable roof with the ridge along x at y = 2 (eave underside 2.2, ridge underside 3.2, slope 0.5 m/m, roof
 * thickness 0.31, overhangs 0.51 / 0.35), an interior wall at x = 3.5 (new), a divider at y = 2, a window and a
 * green door in the south wall, a door in the interior wall, three rooms on 'main' and a loft room ('add' zone)
 * over the east part, a deck south of the house with a glass railing, steps and a hot tub, a post, a beam, a
 * chimney and a stair, two birches, water 2.5 m below the floor and a terrain asset with a 3×3 fine grid
 * (plus a 3×3 coarse one around it).
 */
import type {
  DerivedBlock,
  DerivedFloor,
  DerivedOpening,
  DerivedRoof,
  DerivedRoom,
  DerivedVariant,
  DerivedWall,
} from '../model/derived';
import type { Block, Level, Opening, OpeningType, RoomType, Site, TerrainAsset, Vec2, Vec3 } from '../model/types';

const LEVELS: Level[] = [
  { id: 'main', name: 'Hovedplan', storeyId: 'ground', elevation: 0, floorThickness: 0 },
  { id: 'loft', name: 'Hems', storeyId: 'loft', elevation: 1.47, floorThickness: 0.17 },
];

const AXIS: Vec2[] = [
  [0, 0],
  [6, 0],
  [6, 4],
  [0, 4],
];
const OUTER: Vec2[] = [
  [-0.11, -0.11],
  [6.11, -0.11],
  [6.11, 4.11],
  [-0.11, 4.11],
];
const INNER: Vec2[] = [
  [0.16, 0.16],
  [5.84, 0.16],
  [5.84, 3.84],
  [0.16, 3.84],
];
const LOFT_ZONE: Vec2[] = [
  [3.56, 0.16],
  [5.84, 0.16],
  [5.84, 3.84],
  [3.56, 3.84],
];

const BLOCK: Block = {
  id: 'blk',
  name: 'Hytta',
  polygon: [
    { id: 'v-s', p: [0, 0] },
    { id: 'v-e', p: [6, 0] },
    { id: 'v-n', p: [6, 4] },
    { id: 'v-w', p: [0, 4] },
  ],
  levelId: 'main',
  floorZones: [{ id: 'zone-loft', polygon: LOFT_ZONE, levelId: 'loft', kind: 'add' }],
  parts: [],
  isNew: false,
  wall: { thickness: 0.27, outerOffset: 0.11 },
  eaveHeight: 2.2,
  roof: {
    type: 'gable',
    ridgeAxis: 'x',
    drive: 'height',
    pitchDeg: 26.565,
    ridgeHeight: 3.2,
    thickness: 0.31,
    overhangEave: 0.51,
    overhangGable: 0.35,
    material: 'turf',
  },
  junctions: [],
};

const DERIVED_BLOCK: DerivedBlock = {
  block: BLOCK,
  axis: AXIS,
  outer: OUTER,
  inner: INNER,
  parts: [{ part: { id: 'blk-rest', name: 'Hytta', polygon: AXIS, isNew: false }, outer: OUTER, inner: INNER, isImplicit: true }],
  zones: [{ zoneId: 'zone-loft', levelId: 'loft', kind: 'add', polygon: LOFT_ZONE }],
  edges: [
    { edgeId: 'v-s', a: [0, 0], b: [6, 0], length: 6, outward: [0, -1] },
    { edgeId: 'v-e', a: [6, 0], b: [6, 4], length: 4, outward: [1, 0] },
    { edgeId: 'v-n', a: [6, 4], b: [0, 4], length: 6, outward: [0, 1] },
    { edgeId: 'v-w', a: [0, 4], b: [0, 0], length: 4, outward: [-1, 0] },
  ],
  axisDims: { w: 6, h: 4 },
  eaveZ: 2.2,
  ridgeZ: 3.2,
  pitchDeg: 26.565,
  lowestFloorZ: 0,
  groundZ: -0.6,
};

function opening(
  id: string,
  type: OpeningType,
  host: Opening['host'],
  offset: number,
  width: number,
  sill: number,
  height: number,
  style: Opening['style'],
  status: Opening['status'] = 'existing',
): Opening {
  return { id, type, host, offset, width, height, sill, levelId: 'main', style, status };
}

const WIN_S = opening('win-s', 'window', { kind: 'blockEdge', blockId: 'blk', edgeId: 'v-s' }, 2, 1.2, 0.9, 1.2, { frameColour: 'white', mullions: [2, 2] });
const DOOR_S = opening('door-s', 'door', { kind: 'blockEdge', blockId: 'blk', edgeId: 'v-s' }, 4.5, 0.9, 0, 2, { frameColour: 'green', leaf: 'green' });
const DOOR_INT = opening('door-int', 'door', { kind: 'wall', wallId: 'w-int' }, 1, 0.8, 0, 2, { frameColour: 'white', leaf: 'white' }, 'new');
const OLD_WIN = opening('win-old', 'window', { kind: 'blockEdge', blockId: 'blk', edgeId: 'v-n' }, 3, 1, 1, 1, { frameColour: 'white' }, 'removed');

const SOUTH_OPENINGS: DerivedOpening[] = [
  {
    id: 'win-s',
    opening: WIN_S,
    type: 'window',
    status: 'existing',
    isNew: false,
    offset: 2,
    width: 1.2,
    sillZ: 0.9,
    headZ: 2.1,
    footprint: [
      [1.4, -0.11],
      [2.6, -0.11],
      [2.6, 0.16],
      [1.4, 0.16],
    ],
    outward: [0, -1],
    glazed: true,
    leaf: 'none',
    frameColour: 'white',
    leafColour: 'white',
    panes: [2, 2],
    frameDepth: 0.1,
    glassPlane: 0.025,
  },
  {
    id: 'door-s',
    opening: DOOR_S,
    type: 'door',
    status: 'existing',
    isNew: false,
    offset: 4.5,
    width: 0.9,
    sillZ: 0,
    headZ: 2,
    footprint: [
      [4.05, -0.11],
      [4.95, -0.11],
      [4.95, 0.16],
      [4.05, 0.16],
    ],
    outward: [0, -1],
    glazed: false,
    leaf: 'solid',
    frameColour: 'green',
    leafColour: 'green',
    panes: [1, 1],
    frameDepth: 0.1,
    glassPlane: 0.025,
  },
];

const NORTH_OPENINGS: DerivedOpening[] = [
  {
    id: 'win-old',
    opening: OLD_WIN,
    type: 'window',
    status: 'removed',
    isNew: false,
    offset: 3,
    width: 1,
    sillZ: 1,
    headZ: 2,
    footprint: [],
    outward: [0, 1],
    glazed: true,
    leaf: 'none',
    frameColour: 'white',
    leafColour: 'white',
    panes: [1, 1],
    frameDepth: 0.1,
    glassPlane: 0.025,
  },
];

const INT_OPENINGS: DerivedOpening[] = [
  {
    id: 'door-int',
    opening: DOOR_INT,
    type: 'door',
    status: 'new',
    isNew: true,
    offset: 1,
    width: 0.8,
    sillZ: 0,
    headZ: 2,
    footprint: [
      [3.56, 0.76],
      [3.56, 1.56],
      [3.44, 1.56],
      [3.44, 0.76],
    ],
    glazed: false,
    leaf: 'solid',
    frameColour: 'white',
    leafColour: 'white',
    panes: [1, 1],
    frameDepth: 0.1,
    glassPlane: 0,
  },
];

const EAVE_PROFILE = [
  { t: 0, z: 2.2 },
  { t: 1, z: 2.2 },
];
const GABLE_PROFILE = [
  { t: 0, z: 2.2 },
  { t: 0.5, z: 3.2 },
  { t: 1, z: 2.2 },
];

function exteriorWall(edgeId: string, a: Vec2, b: Vec2, footprint: Vec2[], topProfile: { t: number; z: number }[], openings: DerivedOpening[]): DerivedWall {
  const topZ = Math.max(...topProfile.map((p) => p.z));
  const levelIds = topZ >= 2.47 ? ['main', 'loft'] : ['main'];
  return {
    id: `blk/${edgeId}/blk-rest/base`,
    source: { kind: 'blockEdge', blockId: 'blk', edgeId, partId: 'blk-rest', zoneId: null },
    a,
    b,
    thickness: 0.27,
    faceLeft: 0.16,
    faceRight: 0.11,
    footprint,
    ends: { start: 'miter', end: 'miter' },
    isExterior: true,
    isDivider: false,
    status: 'existing',
    isNew: false,
    levelId: 'main',
    levelIds,
    storeyIds: levelIds.length > 1 ? ['ground', 'loft'] : ['ground'],
    baseZ: 0,
    topZ,
    topProfile,
    openings,
    patches: edgeId === 'v-n' ? [{ offset: 3, width: 1, sillZ: 1, headZ: 2 }] : [],
  };
}

const WALLS: DerivedWall[] = [
  exteriorWall(
    'v-s',
    [0, 0],
    [6, 0],
    [
      [-0.11, -0.11],
      [6.11, -0.11],
      [5.84, 0.16],
      [0.16, 0.16],
    ],
    EAVE_PROFILE,
    SOUTH_OPENINGS,
  ),
  exteriorWall(
    'v-e',
    [6, 0],
    [6, 4],
    [
      [6.11, -0.11],
      [6.11, 4.11],
      [5.84, 3.84],
      [5.84, 0.16],
    ],
    GABLE_PROFILE,
    [],
  ),
  exteriorWall(
    'v-n',
    [6, 4],
    [0, 4],
    [
      [6.11, 4.11],
      [-0.11, 4.11],
      [0.16, 3.84],
      [5.84, 3.84],
    ],
    EAVE_PROFILE,
    NORTH_OPENINGS,
  ),
  exteriorWall(
    'v-w',
    [0, 4],
    [0, 0],
    [
      [-0.11, 4.11],
      [-0.11, -0.11],
      [0.16, 0.16],
      [0.16, 3.84],
    ],
    GABLE_PROFILE,
    [],
  ),
  {
    id: 'w-int',
    source: { kind: 'wall', wallId: 'w-int' },
    a: [3.5, 0.16],
    b: [3.5, 3.84],
    thickness: 0.12,
    faceLeft: 0.06,
    faceRight: 0.06,
    footprint: [
      [3.56, 0.16],
      [3.56, 3.84],
      [3.44, 3.84],
      [3.44, 0.16],
    ],
    ends: { start: 'butt', end: 'butt' },
    isExterior: false,
    isDivider: false,
    status: 'new',
    isNew: true,
    levelId: 'main',
    levelIds: ['main', 'loft'],
    storeyIds: ['ground', 'loft'],
    baseZ: 0,
    topZ: 3.2,
    topProfile: [
      { t: 0, z: 2.28 },
      { t: 0.5, z: 3.2 },
      { t: 1, z: 2.28 },
    ],
    openings: INT_OPENINGS,
    patches: [],
  },
  {
    id: 'w-div',
    source: { kind: 'wall', wallId: 'w-div' },
    a: [0.16, 2],
    b: [3.44, 2],
    thickness: 0,
    faceLeft: 0,
    faceRight: 0,
    footprint: [],
    ends: { start: 'butt', end: 'butt' },
    isExterior: false,
    isDivider: true,
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
  },
];

function rect(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

function room(id: string, name: string, type: RoomType, levelId: string, poly: Vec2[], isNew: boolean): DerivedRoom {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const min: Vec2 = [Math.min(...xs), Math.min(...ys)];
  const max: Vec2 = [Math.max(...xs), Math.max(...ys)];
  const w = max[0] - min[0];
  const h = max[1] - min[1];
  return {
    id,
    room: { id, name, type, levelId, anchor: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2] },
    levelId,
    storeyId: levelId === 'loft' ? 'loft' : 'ground',
    polygon: poly,
    holes: [],
    area: w * h,
    areaExisting: isNew ? 0 : w * h,
    areaNew: isNew ? w * h : 0,
    isNew,
    bbox: { min, max },
    dims: { w, h, approx: false },
    labelPoint: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2],
    blockId: 'blk',
    floorMaterial: 'wood',
    facePolygon: poly,
    wallIds: [],
  };
}

const ROOMS: DerivedRoom[] = [
  room('rom-stue', 'Stue', 'stue', 'main', rect(0.16, 0.16, 3.44, 2), false),
  room('rom-kjokken', 'Kjøkken', 'kjokken', 'main', rect(0.16, 2, 3.44, 3.84), false),
  room('rom-sov', 'Soverom', 'soverom', 'main', rect(3.56, 0.16, 5.84, 3.84), true),
  room('rom-hems', 'Hems', 'hems', 'loft', LOFT_ZONE, true),
];

function floorOf(r: DerivedRoom, z: number, thickness: number): DerivedFloor {
  return { id: `${r.id}/floor`, levelId: r.levelId, polygon: r.polygon, holes: r.holes, z, thickness, material: r.floorMaterial, roomId: r.id, isNew: r.isNew, kind: 'room' };
}

const FLOORS: DerivedFloor[] = [
  floorOf(ROOMS[0], 0, 0),
  { ...floorOf(ROOMS[1], 0, 0), material: 'tile' },
  floorOf(ROOMS[2], 0, 0),
  floorOf(ROOMS[3], 1.47, 0.17),
  { id: 'blk/zone-loft/slab', levelId: 'loft', polygon: LOFT_ZONE, holes: [rect(4, 0.3, 4.8, 1.2)], z: 1.47, thickness: 0.17, material: 'wood', isNew: false, kind: 'slab' },
  { id: 'door-int/threshold', levelId: 'main', polygon: rect(3.44, 0.76, 3.56, 1.56), holes: [], z: 0, thickness: 0, material: 'wood', isNew: true, kind: 'threshold' },
];

const S = 0.4472135955; // sin(atan 0.5)
const C = 0.894427191; // cos(atan 0.5)

const ROOF: DerivedRoof = {
  blockId: 'blk',
  material: 'turf',
  thickness: 0.31,
  slopes: [
    {
      polygon: [
        [-0.35, -0.51, 2.255],
        [6.35, -0.51, 2.255],
        [6.35, 2, 3.51],
        [-0.35, 2, 3.51],
      ],
      normal: [0, -S, C],
      facing: 'S',
      isNew: false,
    },
    {
      polygon: [
        [-0.35, 2, 3.51],
        [6.35, 2, 3.51],
        [6.35, 4.51, 2.255],
        [-0.35, 4.51, 2.255],
      ],
      normal: [0, S, C],
      facing: 'N',
      isNew: false,
    },
  ],
  ridge: { a: [-0.35, 2, 3.2], b: [6.35, 2, 3.2] },
  trims: [
    { a: [-0.35, -0.51, 2.255], b: [-0.35, 2, 3.51], kind: 'barge' },
    { a: [-0.35, 2, 3.51], b: [-0.35, 4.51, 2.255], kind: 'barge' },
    { a: [6.35, -0.51, 2.255], b: [6.35, 2, 3.51], kind: 'barge' },
    { a: [6.35, 2, 3.51], b: [6.35, 4.51, 2.255], kind: 'barge' },
    { a: [-0.35, -0.51, 2.255], b: [6.35, -0.51, 2.255], kind: 'fascia' },
    { a: [6.35, 4.51, 2.255], b: [-0.35, 4.51, 2.255], kind: 'fascia' },
  ],
  outline: rect(-0.35, -0.51, 6.35, 4.51),
};

const POSTS: Vec3[] = [
  [-0.11, -3, 0],
  [2, -3, 0],
  [3, -3, 0],
  [4.555, -3, 0],
  [6.11, -3, 0],
];

export const FIXTURE_DERIVED: DerivedVariant = {
  variantId: 'fixture',
  levels: LEVELS,
  storeys: [
    { id: 'ground', name: 'Plan 1', levelIds: ['main'] },
    { id: 'loft', name: 'Hems', levelIds: ['loft'] },
  ],
  blocks: [DERIVED_BLOCK],
  walls: WALLS,
  groundWorks: [],
  wallUnion: [],
  rooms: ROOMS,
  floors: FLOORS,
  roofs: [ROOF],
  outdoor: {
    decks: [
      {
        id: 'deck-1',
        polygon: rect(-0.11, -3, 6.11, -0.11),
        topZ: 0,
        thickness: 0.15,
        skirtBottomZ: [-0.75, -0.65, -0.6, -0.7],
        boardDirection: 'x',
        isNew: true,
      },
    ],
    railings: [
      {
        id: 'rail-1',
        deckId: 'deck-1',
        baseZ: 0,
        height: 1.05,
        style: 'glass',
        panels: [
          { a: [-0.11, -3, 0], b: [2, -3, 0] },
          { a: [3, -3, 0], b: [6.11, -3, 0] },
        ],
        posts: POSTS,
        steps: [
          {
            id: 'rail-1/steps/0',
            at: [2.5, -3],
            outward: [0, -1],
            width: 1,
            topZ: 0,
            bottomZ: -0.7,
            risers: 4,
            riserHeight: 0.175,
            going: 0.3,
            treads: [
              { polygon: rect(2, -3.3, 3, -3), z: -0.175 },
              { polygon: rect(2, -3.6, 3, -3.3), z: -0.35 },
              { polygon: rect(2, -3.9, 3, -3.6), z: -0.525 },
            ],
          },
        ],
        isNew: true,
      },
    ],
    hotTubs: [{ id: 'tub-1', centre: [5, -2], diameter: 2, baseZ: 0, rimZ: 1.05, isNew: true }],
  },
  structure: [],
  furniture: [],
  foundations: [{ blockId: 'blk', polygon: OUTER, topZ: 0, bottomZ: -0.9 }],
  dimensions: [],
  site: {
    trees: [
      { tree: { id: 'tree-1', position: [-5, 6], height: 5, kind: 'bjork' }, baseZ: -0.8 },
      { tree: { id: 'tree-2', position: [9, -4], height: 6, kind: 'bjork' }, baseZ: -1.2 },
    ],
    waterZ: -2.5,
  },
  bounds: { min: [-0.11, -3], max: [6.11, 4.11] },
  areas: {
    bya: {
      total: 43.6,
      existing: 25.6,
      new: 18,
      buildings: 25.6,
      decks: 18,
      perBlock: [{ blockId: 'blk', name: 'Hytta', area: 25.64, isNew: false, parts: [{ partId: 'blk-rest', name: 'Hytta', area: 25.64, isNew: false }] }],
    },
    bra: { total: 20.9, existing: 12.1, new: 8.4, perLevel: [{ levelId: 'main', name: 'Hovedplan', gross: 20.9, area: 20.9 }] },
    axis: { total: 24, existing: 24, new: 0 },
    rooms: [],
  },
  warnings: [],
};

const STAIR_TREADS = Array.from({ length: 8 }, (_, k) => ({ polygon: rect(4, 0.3 + (k * 2) / 9, 4.8, 0.3 + ((k + 1) * 2) / 9), z: ((k + 1) * 1.47) / 9 }));

FIXTURE_DERIVED.structure.push(
  { id: 'post-1', kind: 'post', element: { id: 'post-1', kind: 'post', position: [1, 1], size: 0.15, bottom: 0, top: 2.2, isNew: false }, position: [1, 1], size: 0.15, bottomZ: 0, topZ: 2.2, isNew: false },
  { id: 'beam-1', kind: 'beam', element: { id: 'beam-1', kind: 'beam', a: [0.16, 2], b: [5.84, 2], width: 0.12, bottom: 2.9, top: 3.1, isNew: false }, a: [0.16, 2], b: [5.84, 2], width: 0.12, bottomZ: 2.9, topZ: 3.1, isNew: false },
  {
    id: 'chim-1',
    kind: 'chimney',
    element: { id: 'chim-1', kind: 'chimney', min: [2.6, 2.6], max: [3.2, 3.2], bottom: 0, top: 4.2, isNew: false },
    min: [2.6, 2.6],
    max: [3.2, 3.2],
    bottomZ: 0,
    topZ: 4.2,
    roofExitZ: 3.3,
    isNew: false,
  },
  {
    id: 'stair-1',
    kind: 'stair',
    element: { id: 'stair-1', kind: 'stair', min: [4, 0.3], max: [4.8, 2.3], fromLevelId: 'main', toLevelId: 'loft', upDirection: 'N', isNew: true },
    footprint: rect(4, 0.3, 4.8, 2.3),
    fromZ: 0,
    toZ: 1.47,
    upDirection: 'N',
    riser: 1.47 / 9,
    going: 2 / 9,
    treads: STAIR_TREADS,
    arrow: { a: [4.4, 0.4], b: [4.4, 2.2] },
    isNew: true,
  },
);

export const FIXTURE_SITE: Site = {
  originLatLon: { lat: 68.61305, lon: 14.968157 },
  planNorthBearing: 106,
  floorElevation: 101,
  waterLevel: 98.5,
  terrainId: 'fixture-terrain',
  groundWorks: [{ id: 'gw-1', polygon: rect(-1, -1, 7, 5), maxZ: -0.3 }],
  timezone: 'Europe/Oslo',
  trees: FIXTURE_DERIVED.site.trees.map((t) => t.tree),
};

export const FIXTURE_TERRAIN: TerrainAsset = {
  id: 'fixture-terrain',
  grids: [
    { x0: -20, y0: -20, dx: 20, dy: 20, nx: 3, ny: 3, z: [99.0, 99.4, 99.8, 100.2, 100.4, 100.6, 101.0, 101.2, 101.4] },
    { x0: -100, y0: -100, dx: 100, dy: 100, nx: 3, ny: 3, z: [98.5, 98.5, 99.0, 99.5, 100.4, 101.0, 104.0, 106.0, 110.0] },
  ],
};

export function fixtureWall(id: string): DerivedWall {
  const w = FIXTURE_DERIVED.walls.find((x) => x.id === id || x.id.includes(`/${id}/`));
  if (!w) throw new Error(`fixture wall ${id} missing`);
  return w;
}
