/**
 * Hand-made DerivedVariant for developing and testing the plan (NOT produced by deriveVariant). The geometry is
 * self-consistent (CCW polygons, footprints from faces and offsets, wall unions via geometry/polygon.ts) and
 * follows the conventions of docs/architecture.md, but the derive pipeline's finer rules (part/zone splits,
 * exact roof envelopes, measurable areas) are approximated.
 *
 * Content (plan metres, heights relative to the main floor):
 *  - Levels main (0, storey "ground") and loft (1.47, storey "loft").
 *  - Block "Hovedhus" (existing) [0,10]×[0,6], gable roof along x, an 'add' zone (loft) over x < 4.
 *    Block "Tilbygg" (new) [10,14]×[0,4], flat roof; the shared edge x = 10 keeps A's wall (B's piece removed).
 *  - Rooms: Stue | Kjøkken split by a divider at x = 4, Bad (interior walls), Soverom in the new block, Hems on
 *    the loft. Kjøkken is L-shaped (approx dims) with the chimney as a hole.
 *  - Openings: windows (one removed, one on the loft level in the west gable), an outward entrance door, a
 *    bathroom door, a glass door from the new block onto the deck (all with swings), a frameless passage.
 *  - A removed interior wall (dashed), a deck with a railing that has one steps gap, a hot tub, a tree, a post,
 *    the chimney and a stair main → loft with its arrow.
 */
import { area, labelPoint, unionArea, unionPolygons } from '../geometry/polygon';
import type {
  AreaSummary,
  DerivedBlock,
  DerivedDimension,
  DerivedFloor,
  DerivedOpening,
  DerivedRailing,
  DerivedRoof,
  DerivedRoom,
  DerivedSteps,
  DerivedStructure,
  DerivedVariant,
  DerivedWall,
  WallSource,
} from '../model/derived';
import type {
  Block,
  ElementStatus,
  FloorMaterial,
  Id,
  Level,
  Opening,
  OpeningHost,
  OpeningStyle,
  OpeningType,
  Room,
  Site,
  StructureElement,
  Tree,
  Vec2,
  Vec3,
} from '../model/types';

// ---------------------------------------------------------------------------
// Small vector helpers
// ---------------------------------------------------------------------------

const at = (p: Vec2, v: Vec2, d: number): Vec2 => [p[0] + v[0] * d, p[1] + v[1] * d];

function axes(a: Vec2, b: Vec2): { u: Vec2; n: Vec2; len: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const u: Vec2 = [dx / len, dy / len];
  return { u, n: [-u[1], u[0]], len };
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

function bboxOf(poly: Vec2[]): { min: Vec2; max: Vec2 } {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

// ---------------------------------------------------------------------------
// Levels, blocks
// ---------------------------------------------------------------------------

const T = 0.27;
const OUT = 0.11;
const IN = T - OUT;

const LEVELS: Level[] = [
  { id: 'main', name: 'Hovedplan', storeyId: 'ground', elevation: 0, floorThickness: 0 },
  { id: 'loft', name: 'Hems', storeyId: 'loft', elevation: 1.47, floorThickness: 0.17 },
];

const levelZ = (id: Id): number => LEVELS.find((l) => l.id === id)?.elevation ?? 0;

function makeBlocks(): { a: Block; b: Block } {
  const a: Block = {
    id: 'blk-a',
    name: 'Hovedhus',
    polygon: [
      { id: 'a-sw', p: [0, 0] },
      { id: 'a-se', p: [10, 0] },
      { id: 'a-ne', p: [10, 6] },
      { id: 'a-nw', p: [0, 6] },
    ],
    levelId: 'main',
    floorZones: [{ id: 'zone-loft', polygon: rect(0, 0, 4, 6), levelId: 'loft', kind: 'add' }],
    parts: [],
    isNew: false,
    wall: { thickness: T, outerOffset: OUT },
    eaveHeight: 2.22,
    roof: { type: 'gable', ridgeAxis: 'x', drive: 'height', pitchDeg: 28, ridgeHeight: 3.87, thickness: 0.31, overhangEave: 0.51, overhangGable: 0.35, material: 'turf' },
    junctions: [{ otherBlockId: 'blk-b', policy: 'wall' }],
  };
  const b: Block = {
    id: 'blk-b',
    name: 'Tilbygg',
    polygon: [
      { id: 'b-sw', p: [10, 0] },
      { id: 'b-se', p: [14, 0] },
      { id: 'b-ne', p: [14, 4] },
      { id: 'b-nw', p: [10, 4] },
    ],
    levelId: 'main',
    floorZones: [],
    parts: [],
    isNew: true,
    wall: { thickness: T, outerOffset: OUT },
    eaveHeight: 2.4,
    roof: { type: 'flat', drive: 'height', pitchDeg: 0, ridgeHeight: 2.4, thickness: 0.31, overhangEave: 0.3, overhangGable: 0.3, material: 'metal' },
    junctions: [{ otherBlockId: 'blk-a', policy: 'wall' }],
  };
  return { a, b };
}

function derivedBlock(block: Block, outer: Vec2[], inner: Vec2[], extra: Pick<DerivedBlock, 'zones' | 'eaveZ' | 'ridgeZ' | 'pitchDeg' | 'groundZ'>): DerivedBlock {
  const axis = block.polygon.map((v) => v.p);
  const box = bboxOf(axis);
  return {
    block,
    axis,
    outer,
    inner,
    parts: [{ part: { id: `${block.id}-rest`, name: block.name, polygon: axis, isNew: block.isNew }, outer, inner, isImplicit: true }],
    edges: block.polygon.map((v, i) => {
      const a = v.p;
      const b = block.polygon[(i + 1) % block.polygon.length].p;
      const { n, len } = axes(a, b);
      return { edgeId: v.id, a, b, length: len, outward: [-n[0], -n[1]] as Vec2 };
    }),
    axisDims: { w: box.max[0] - box.min[0], h: box.max[1] - box.min[1] },
    lowestFloorZ: 0,
    junctions: [],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Walls and openings
// ---------------------------------------------------------------------------

/** How far each face extends beyond the reference end point along the wall (negative = shortened). */
interface EndExt {
  right: number;
  left: number;
}
/** Convex right-angle block corner with the same build-up on both edges (left = inside). */
const MITRE: EndExt = { right: OUT, left: -IN };
const BUTT: EndExt = { right: 0, left: 0 };

function wallFootprint(a: Vec2, b: Vec2, fl: number, fr: number, s: EndExt, e: EndExt): Vec2[] {
  const { u, n } = axes(a, b);
  return [at(at(a, u, -s.right), n, -fr), at(at(b, u, e.right), n, -fr), at(at(b, u, e.left), n, fl), at(at(a, u, -s.left), n, fl)];
}

interface OpeningSpec {
  id: Id;
  type: OpeningType;
  offset: number;
  width: number;
  height: number;
  sill: number;
  status: ElementStatus;
  levelId?: Id;
  swing?: Opening['swing'];
  style?: Partial<OpeningStyle>;
}

interface WallGeom {
  a: Vec2;
  b: Vec2;
  faceLeft: number;
  faceRight: number;
  isExterior: boolean;
  levelId: Id;
}

function doorSwing(g: WallGeom, spec: OpeningSpec): DerivedOpening['swing'] {
  if (!spec.swing) return undefined;
  const { u, n } = axes(g.a, g.b);
  const t0 = spec.offset - spec.width / 2;
  const t1 = spec.offset + spec.width / 2;
  const [hingeT, freeT] = spec.swing.hinge === 'start' ? [t0, t1] : [t1, t0];
  const sideSign = spec.swing.side === 'left' ? 1 : -1;
  const face = spec.swing.side === 'left' ? g.faceLeft : -g.faceRight;
  const hinge = at(at(g.a, u, hingeT), n, face);
  const closed = at(at(g.a, u, freeT), n, face);
  const open = at(hinge, n, sideSign * spec.width);
  const cross = (closed[0] - hinge[0]) * (open[1] - hinge[1]) - (closed[1] - hinge[1]) * (open[0] - hinge[0]);
  return { hinge, closed, open, sweep: cross > 0 ? 1 : -1 };
}

function derivedOpening(g: WallGeom, host: OpeningHost, spec: OpeningSpec): DerivedOpening {
  const { u, n } = axes(g.a, g.b);
  const s = at(g.a, u, spec.offset - spec.width / 2);
  const e = at(g.a, u, spec.offset + spec.width / 2);
  const isDoor = spec.type === 'door' || spec.type === 'glassDoor' || spec.type === 'saunaDoor' || spec.type === 'slidingDoor';
  const glassLeaf = spec.type === 'glassDoor' || spec.type === 'saunaDoor' || spec.type === 'slidingDoor';
  const style: OpeningStyle = { frameColour: 'white', ...spec.style };
  const opening: Opening = {
    id: spec.id,
    type: spec.type,
    host,
    offset: spec.offset,
    width: spec.width,
    height: spec.height,
    sill: spec.sill,
    ...(spec.levelId ? { levelId: spec.levelId } : {}),
    ...(spec.swing ? { swing: spec.swing } : {}),
    style,
    status: spec.status,
  };
  const sillZ = levelZ(spec.levelId ?? g.levelId) + spec.sill;
  return {
    id: spec.id,
    opening,
    type: spec.type,
    status: spec.status,
    isNew: spec.status === 'new',
    isGhost: spec.status === 'removed',
    levelId: spec.levelId ?? g.levelId,
    offset: spec.offset,
    width: spec.width,
    sillZ,
    headZ: sillZ + spec.height,
    footprint: [at(s, n, -g.faceRight), at(e, n, -g.faceRight), at(e, n, g.faceLeft), at(s, n, g.faceLeft)],
    swing: doorSwing(g, spec),
    ...(g.isExterior ? { outward: [-n[0], -n[1]] as Vec2 } : {}),
    glazed: spec.type === 'window' || glassLeaf,
    leaf: spec.type === 'window' || spec.type === 'opening' ? 'none' : glassLeaf ? 'glass' : 'solid',
    frameColour: style.frameColour,
    leafColour: style.leaf ?? (glassLeaf ? 'glass' : 'white'),
    panes: style.mullions ?? [1, 1],
    frameDepth: 0.1,
    glassPlane: isDoor || spec.type === 'window' ? (g.faceLeft - g.faceRight) / 2 : 0,
  };
}

interface WallSpec {
  id: Id;
  source: WallSource;
  a: Vec2;
  b: Vec2;
  faceLeft: number;
  faceRight: number;
  start: EndExt;
  end: EndExt;
  kind: 'exterior' | 'interior' | 'divider';
  status: ElementStatus;
  levelIds: Id[];
  storeyIds: Id[];
  topProfile: { t: number; z: number }[];
  openings?: OpeningSpec[];
}

function derivedWall(spec: WallSpec): DerivedWall {
  const isDivider = spec.kind === 'divider';
  const isExterior = spec.kind === 'exterior';
  const g: WallGeom = { a: spec.a, b: spec.b, faceLeft: spec.faceLeft, faceRight: spec.faceRight, isExterior, levelId: 'main' };
  const host: OpeningHost = spec.source.kind === 'blockEdge' ? { kind: 'blockEdge', blockId: spec.source.blockId, edgeId: spec.source.edgeId } : { kind: 'wall', wallId: spec.source.wallId };
  const openings = (spec.openings ?? []).map((o) => derivedOpening(g, host, o));
  const isButt = (x: EndExt) => x.right === 0 && x.left === 0;
  const length = Math.hypot(spec.b[0] - spec.a[0], spec.b[1] - spec.a[1]);
  return {
    id: spec.id,
    source: spec.source.kind === 'blockEdge' ? { ...spec.source, s1: spec.source.s0 + length } : spec.source,
    a: spec.a,
    b: spec.b,
    thickness: spec.faceLeft + spec.faceRight,
    faceLeft: spec.faceLeft,
    faceRight: spec.faceRight,
    footprint: isDivider ? [] : wallFootprint(spec.a, spec.b, spec.faceLeft, spec.faceRight, spec.start, spec.end),
    ends: { start: isButt(spec.start) ? 'butt' : 'miter', end: isButt(spec.end) ? 'butt' : 'miter' },
    isExterior,
    isDivider,
    status: spec.status,
    isNew: spec.status === 'new',
    isGhost: spec.status === 'removed',
    levelId: 'main',
    levelIds: spec.levelIds,
    storeyIds: spec.storeyIds,
    baseZ: 0,
    topZ: Math.max(...spec.topProfile.map((p) => p.z)),
    topProfile: spec.topProfile,
    openings,
    patches: openings
      .filter((o) => o.status === 'removed')
      .map((o) => ({ offset: o.offset, width: o.width, sillZ: o.sillZ, headZ: o.headZ })),
  };
}

const EAVE_A = [
  { t: 0, z: 2.22 },
  { t: 1, z: 2.22 },
];
const GABLE_A = [
  { t: 0, z: 2.22 },
  { t: 0.5, z: 3.87 },
  { t: 1, z: 2.22 },
];
const FLAT_B = [
  { t: 0, z: 2.4 },
  { t: 1, z: 2.4 },
];
const FIXED_23 = [
  { t: 0, z: 2.3 },
  { t: 1, z: 2.3 },
];

function edge(blockId: Id, edgeId: Id): { id: Id; source: WallSource } {
  const partId = `${blockId}-rest`;
  return { id: `${blockId}/${edgeId}/${partId}/base`, source: { kind: 'blockEdge', blockId, edgeId, partId, zoneId: null, s0: 0, s1: 0 } };
}

function makeWalls(): DerivedWall[] {
  const extA = { faceLeft: IN, faceRight: OUT, kind: 'exterior' as const, status: 'existing' as const, storeyIds: ['ground', 'loft'] };
  const extB = { faceLeft: IN, faceRight: OUT, kind: 'exterior' as const, status: 'new' as const, storeyIds: ['ground'], levelIds: ['main'], topProfile: FLAT_B };
  const inner = { faceLeft: 0.05, faceRight: 0.05, kind: 'interior' as const, start: BUTT, end: BUTT, levelIds: ['main'], storeyIds: ['ground'], topProfile: FIXED_23 };
  const specs: WallSpec[] = [
    {
      ...edge('blk-a', 'a-sw'),
      ...extA,
      a: [0, 0],
      b: [10, 0],
      start: MITRE,
      end: MITRE,
      levelIds: ['main'],
      topProfile: EAVE_A,
      openings: [{ id: 'win-stue', type: 'window', offset: 2, width: 1.2, height: 1.2, sill: 0.8, status: 'existing', levelId: 'main', style: { mullions: [2, 1] } }],
    },
    {
      ...edge('blk-a', 'a-se'),
      ...extA,
      a: [10, 0],
      b: [10, 6],
      start: MITRE,
      end: MITRE,
      levelIds: ['main', 'loft'],
      topProfile: GABLE_A,
      openings: [{ id: 'op-tilbygg', type: 'opening', offset: 2, width: 1.0, height: 2.1, sill: 0, status: 'new', levelId: 'main' }],
    },
    {
      ...edge('blk-a', 'a-ne'),
      ...extA,
      a: [10, 6],
      b: [0, 6],
      start: MITRE,
      end: MITRE,
      levelIds: ['main'],
      topProfile: EAVE_A,
      openings: [{ id: 'win-old', type: 'window', offset: 8.5, width: 1.0, height: 1.0, sill: 0.9, status: 'removed', levelId: 'main' }],
    },
    {
      ...edge('blk-a', 'a-nw'),
      ...extA,
      a: [0, 6],
      b: [0, 0],
      start: MITRE,
      end: MITRE,
      levelIds: ['main', 'loft'],
      topProfile: GABLE_A,
      openings: [
        { id: 'd-inng', type: 'door', offset: 3, width: 0.9, height: 2.0, sill: 0, status: 'existing', levelId: 'main', swing: { hinge: 'start', side: 'right' }, style: { frameColour: 'green', leaf: 'green' } },
        { id: 'win-hems', type: 'window', offset: 4.5, width: 0.6, height: 0.6, sill: 0.4, status: 'existing', levelId: 'loft' },
      ],
    },
    {
      ...edge('blk-b', 'b-sw'),
      ...extB,
      a: [10, 0],
      b: [14, 0],
      start: BUTT,
      end: MITRE,
      openings: [{ id: 'gd-sov', type: 'glassDoor', offset: 2.5, width: 0.9, height: 2.1, sill: 0, status: 'new', levelId: 'main', swing: { hinge: 'end', side: 'right' } }],
    },
    {
      ...edge('blk-b', 'b-se'),
      ...extB,
      a: [14, 0],
      b: [14, 4],
      start: MITRE,
      end: MITRE,
      openings: [{ id: 'win-sov', type: 'window', offset: 2, width: 1.0, height: 1.2, sill: 0.8, status: 'new', levelId: 'main' }],
    },
    { ...edge('blk-b', 'b-ne'), ...extB, a: [14, 4], b: [10, 4], start: MITRE, end: BUTT },
    {
      ...inner,
      id: 'w-bad-s',
      source: { kind: 'wall', wallId: 'w-bad-s' },
      a: [7, 3],
      b: [10, 3],
      status: 'existing',
    },
    {
      ...inner,
      id: 'w-bad-w',
      source: { kind: 'wall', wallId: 'w-bad-w' },
      a: [7, 2.95],
      b: [7, 6],
      status: 'existing',
      openings: [{ id: 'd-bad', type: 'door', offset: 1.25, width: 0.8, height: 2.0, sill: 0, status: 'existing', levelId: 'main', swing: { hinge: 'start', side: 'right' } }],
    },
    { ...inner, id: 'w-rives', source: { kind: 'wall', wallId: 'w-rives' }, a: [0, 3.5], b: [1.6, 3.5], status: 'removed' },
    {
      id: 'd-stue-kjokken',
      source: { kind: 'wall', wallId: 'd-stue-kjokken' },
      a: [4, 0],
      b: [4, 6],
      faceLeft: 0,
      faceRight: 0,
      start: BUTT,
      end: BUTT,
      kind: 'divider',
      status: 'existing',
      levelIds: ['main'],
      storeyIds: ['ground'],
      topProfile: GABLE_A,
    },
  ];
  return specs.map(derivedWall);
}

function makeWallUnion(walls: DerivedWall[]): DerivedVariant['wallUnion'] {
  const out: DerivedVariant['wallUnion'] = [];
  for (const storeyId of ['ground', 'loft']) {
    for (const status of ['existing', 'new', 'removed'] as const) {
      const fps = walls.filter((w) => !w.isDivider && w.status === status && w.storeyIds.includes(storeyId)).map((w) => w.footprint);
      if (fps.length > 0) out.push({ storeyId, status, polygons: unionPolygons(fps) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rooms and floors
// ---------------------------------------------------------------------------

const CHIMNEY = { min: [5, 1.2] as Vec2, max: [5.55, 1.75] as Vec2 };

interface RoomSpec {
  room: Room;
  storeyId: Id;
  polygon: Vec2[];
  holes?: Vec2[][];
  facePolygon: Vec2[];
  wallIds: Id[];
  blockId: Id;
  isNew: boolean;
  floorMaterial: FloorMaterial;
}

function derivedRoom(s: RoomSpec): DerivedRoom {
  const holes = s.holes ?? [];
  const net = area(s.polygon) - holes.reduce((sum, h) => sum + area(h), 0);
  const box = bboxOf(s.polygon);
  const w = box.max[0] - box.min[0];
  const h = box.max[1] - box.min[1];
  return {
    id: s.room.id,
    room: s.room,
    levelId: s.room.levelId,
    storeyId: s.storeyId,
    polygon: s.polygon,
    holes,
    area: net,
    areaExisting: s.isNew ? 0 : net,
    areaNew: s.isNew ? net : 0,
    isNew: s.isNew,
    bbox: box,
    dims: { w, h, approx: Math.abs(area(s.polygon) - w * h) / (w * h) > 0.02 },
    labelPoint: labelPoint(s.polygon, holes),
    blockId: s.blockId,
    floorMaterial: s.floorMaterial,
    facePolygon: s.facePolygon,
    wallIds: s.wallIds,
  };
}

function makeRooms(): DerivedRoom[] {
  const A = (e: string) => edge('blk-a', e).id;
  const B = (e: string) => edge('blk-b', e).id;
  const specs: RoomSpec[] = [
    {
      room: { id: 'rom-stue', name: 'Stue', type: 'stue', levelId: 'main', anchor: [2, 2] },
      storeyId: 'ground',
      polygon: rect(IN, IN, 4, 6 - IN),
      facePolygon: rect(0, 0, 4, 6),
      wallIds: [A('a-sw'), 'd-stue-kjokken', A('a-ne'), A('a-nw')],
      blockId: 'blk-a',
      isNew: false,
      floorMaterial: 'wood',
    },
    {
      room: { id: 'rom-kjokken', name: 'Kjøkken', type: 'kjokken', levelId: 'main', anchor: [8, 1.5] },
      storeyId: 'ground',
      polygon: [
        [4, IN],
        [10 - IN, IN],
        [10 - IN, 2.95],
        [6.95, 2.95],
        [6.95, 6 - IN],
        [4, 6 - IN],
      ],
      holes: [[CHIMNEY.min, [CHIMNEY.max[0], CHIMNEY.min[1]], CHIMNEY.max, [CHIMNEY.min[0], CHIMNEY.max[1]]]],
      facePolygon: [
        [4, 0],
        [10, 0],
        [10, 3],
        [7, 3],
        [7, 6],
        [4, 6],
      ],
      wallIds: [A('a-sw'), A('a-se'), 'w-bad-s', 'w-bad-w', A('a-ne'), 'd-stue-kjokken'],
      blockId: 'blk-a',
      isNew: false,
      floorMaterial: 'wood',
    },
    {
      room: { id: 'rom-bad', name: 'Bad', type: 'bad', levelId: 'main', anchor: [8.5, 4.5] },
      storeyId: 'ground',
      polygon: rect(7.05, 3.05, 10 - IN, 6 - IN),
      facePolygon: rect(7, 3, 10, 6),
      wallIds: ['w-bad-s', A('a-se'), A('a-ne'), 'w-bad-w'],
      blockId: 'blk-a',
      isNew: false,
      floorMaterial: 'tile',
    },
    {
      room: { id: 'rom-soverom', name: 'Soverom', type: 'soverom', levelId: 'main', anchor: [12, 2] },
      storeyId: 'ground',
      polygon: rect(10 + OUT, IN, 14 - IN, 4 - IN),
      facePolygon: rect(10, 0, 14, 4),
      wallIds: [B('b-sw'), B('b-se'), B('b-ne'), A('a-se')],
      blockId: 'blk-b',
      isNew: true,
      floorMaterial: 'wood',
    },
    {
      room: { id: 'rom-hems', name: 'Hems', type: 'hems', levelId: 'loft', anchor: [2, 3] },
      storeyId: 'loft',
      polygon: rect(IN, IN, 4, 6 - IN),
      facePolygon: rect(0, 0, 4, 6),
      wallIds: [A('a-sw'), A('a-ne'), A('a-nw')],
      blockId: 'blk-a',
      isNew: false,
      floorMaterial: 'wood',
    },
  ];
  return specs.map(derivedRoom);
}

function makeFloors(rooms: DerivedRoom[], walls: DerivedWall[]): DerivedFloor[] {
  const floors: DerivedFloor[] = rooms.map((r) => {
    const level = LEVELS.find((l) => l.id === r.levelId);
    return {
      id: `${r.id}/floor`,
      levelId: r.levelId,
      polygon: r.polygon,
      holes: r.holes,
      z: level?.elevation ?? 0,
      thickness: level?.floorThickness ?? 0,
      material: r.floorMaterial,
      roomId: r.id,
      isNew: r.isNew,
      kind: 'room',
    };
  });
  for (const w of walls) {
    for (const o of w.openings) {
      if (w.isExterior && o.id !== 'op-tilbygg') continue;
      if (o.type === 'window' || o.status === 'removed') continue;
      floors.push({ id: `${o.id}/threshold`, levelId: 'main', polygon: o.footprint, holes: [], z: 0, thickness: 0, material: 'wood', isNew: o.isNew, kind: 'threshold' });
    }
  }
  floors.push({ id: 'blk-a/zone-loft/slab', levelId: 'loft', polygon: rect(IN, IN, 4, 6 - IN), holes: [], z: 1.47, thickness: 0.17, material: 'wood', isNew: false, kind: 'slab' });
  return floors;
}

// ---------------------------------------------------------------------------
// Roofs
// ---------------------------------------------------------------------------

function makeRoofs(): DerivedRoof[] {
  const pitch = Math.atan((3.87 - 2.22) / 3);
  const tan = Math.tan(pitch);
  const th = 0.31;
  const zEave = 2.22 - 0.51 * tan + th;
  const zRidge = 3.87 + th;
  const ns = Math.sin(pitch);
  const nc = Math.cos(pitch);
  const roofA: DerivedRoof = {
    blockId: 'blk-a',
    material: 'turf',
    thickness: th,
    slopes: [
      {
        polygon: [
          [-0.35, -0.51, zEave],
          [10.35, -0.51, zEave],
          [10.35, 3, zRidge],
          [-0.35, 3, zRidge],
        ],
        normal: [0, -ns, nc],
        facing: 'S',
        isNew: false,
      },
      {
        polygon: [
          [10.35, 6.51, zEave],
          [-0.35, 6.51, zEave],
          [-0.35, 3, zRidge],
          [10.35, 3, zRidge],
        ],
        normal: [0, ns, nc],
        facing: 'N',
        isNew: false,
      },
    ],
    ridge: { a: [-0.35, 3, 3.87], b: [10.35, 3, 3.87] },
    trims: [
      { a: [-0.35, -0.51, zEave], b: [10.35, -0.51, zEave], kind: 'fascia' },
      { a: [10.35, 6.51, zEave], b: [-0.35, 6.51, zEave], kind: 'fascia' },
      { a: [-0.35, 6.51, zEave], b: [-0.35, 3, zRidge], kind: 'barge' },
      { a: [-0.35, 3, zRidge], b: [-0.35, -0.51, zEave], kind: 'barge' },
    ],
    outline: rect(-0.35, -0.51, 10.35, 6.51),
  };
  const zFlat = 2.4 + th;
  const outlineB = rect(10.35, -0.3, 14.3, 4.3);
  const roofB: DerivedRoof = {
    blockId: 'blk-b',
    material: 'metal',
    thickness: th,
    slopes: [{ polygon: outlineB.map(([x, y]) => [x, y, zFlat] as Vec3), normal: [0, 0, 1], facing: 'S', isNew: true }],
    trims: [{ a: [10.35, -0.3, zFlat], b: [14.3, -0.3, zFlat], kind: 'fascia' }],
    outline: outlineB,
  };
  return [roofA, roofB];
}

// ---------------------------------------------------------------------------
// Outdoor, structure, dimensions, areas
// ---------------------------------------------------------------------------

const DECK_POLY: Vec2[] = rect(9, -3, 15, -OUT);
const DECK_TOP = -0.05;

function makeSteps(): DerivedSteps[] {
  const z = DECK_TOP;
  const treads = [0, 1, 2, 3].map((i) => ({ polygon: rect(11, -3 - 0.3 * (i + 1), 12.2, -3 - 0.3 * i), z: z - 0.15 * (i + 1) }));
  return [
    { id: 'deck-1/steps/0', deckId: 'deck-1', edgeId: 'deck-1-v0', at: [11.6, -3], outward: [0, -1], width: 1.2, topZ: z, bottomZ: -0.8, risers: 5, riserHeight: 0.15, going: 0.3, treads, blocked: false },
  ];
}

function makeRailing(): DerivedRailing {
  const z = DECK_TOP;
  const p3 = (x: number, y: number): Vec3 => [x, y, z];
  return {
    id: 'deck-1/railing',
    deckId: 'deck-1',
    baseZ: z,
    height: 1.05,
    style: 'boards',
    panels: [
      { a: p3(9, -OUT), b: p3(9, -3) },
      { a: p3(9, -3), b: p3(11, -3) },
      { a: p3(12.2, -3), b: p3(15, -3) },
      { a: p3(15, -3), b: p3(15, -OUT) },
    ],
    posts: [p3(9, -OUT), p3(9, -1.555), p3(9, -3), p3(10, -3), p3(11, -3), p3(12.2, -3), p3(13.6, -3), p3(15, -3), p3(15, -1.555), p3(15, -OUT)],
    isNew: true,
  };
}

function makeStructure(): DerivedStructure[] {
  const chimney: StructureElement = { id: 'chimney-1', kind: 'chimney', min: CHIMNEY.min, max: CHIMNEY.max, bottom: -0.5, top: 5.2, isNew: false };
  const stair: StructureElement = { id: 'stair-1', kind: 'stair', min: [4.1, 4.95], max: [6.1, 6 - IN], fromLevelId: 'main', toLevelId: 'loft', upDirection: 'W', isNew: false };
  const post: StructureElement = { id: 'post-1', kind: 'post', position: [14.6, 4.6], size: 0.15, bottom: -0.6, top: 2.4, isNew: true };
  const n = Math.ceil(1.47 / 0.18);
  const going = 2.0 / n;
  const riser = 1.47 / n;
  const yMid = (4.95 + 6 - IN) / 2;
  return [
    { id: 'chimney-1', kind: 'chimney', element: chimney, min: CHIMNEY.min, max: CHIMNEY.max, bottomZ: -0.5, topZ: 5.2, roofExitZ: 3.4, isNew: false },
    {
      id: 'stair-1',
      kind: 'stair',
      element: stair,
      footprint: rect(4.1, 4.95, 6.1, 6 - IN),
      fromZ: 0,
      toZ: 1.47,
      upDirection: 'W',
      riser,
      going,
      treads: Array.from({ length: n }, (_, i) => ({ polygon: rect(6.1 - going * (i + 1), 4.95, 6.1 - going * i, 6 - IN), z: riser * (i + 1) })),
      arrow: { a: [6.1 - going / 2, yMid], b: [4.1 + going / 2, yMid] },
      isNew: false,
    },
    { id: 'post-1', kind: 'post', element: post, position: [14.6, 4.6], size: 0.15, bottomZ: -0.6, topZ: 2.4, isNew: true },
  ];
}

function makeDimensions(): DerivedDimension[] {
  return [
    { a: [0, 0], b: [10, 0], offset: -5, text: '10,0', kind: 'axisChain' },
    { a: [10, 0], b: [14, 0], offset: -5, text: '4,0', kind: 'axisChain' },
    { a: [0, 0], b: [14, 0], offset: -5.8, text: '14,0', kind: 'axisTotal' },
    { a: [0, 6], b: [0, 0], offset: -1.2, text: '6,0', kind: 'axisChain' },
    { a: [14, 0], b: [14, 4], offset: -1.8, text: '4,0', kind: 'axisChain' },
    { a: [10, 6], b: [0, 6], offset: -1.2, text: '10,0', kind: 'axisChain' },
    { a: [IN, IN], b: [4, IN], offset: 0.35, text: '3,84', kind: 'room', levelId: 'loft' },
  ];
}

function makeAreas(blocks: DerivedBlock[], rooms: DerivedRoom[]): AreaSummary {
  const [a, b] = blocks;
  const buildings = unionArea([a.outer, b.outer]);
  const existing = area(a.outer);
  const innerMain = area(a.inner) + area(b.inner);
  const innerNew = area(b.inner);
  const loft = rooms.find((r) => r.id === 'rom-hems')?.area ?? 0;
  return {
    bya: {
      total: buildings,
      existing,
      new: buildings - existing,
      buildings,
      decks: 0,
      perBlock: [
        { blockId: 'blk-a', name: 'Hovedhus', area: area(a.outer), isNew: false, parts: [{ partId: 'blk-a-rest', name: 'Hovedhus', area: area(a.outer), isNew: false }] },
        { blockId: 'blk-b', name: 'Tilbygg', area: area(b.outer), isNew: true, parts: [{ partId: 'blk-b-rest', name: 'Tilbygg', area: area(b.outer), isNew: true }] },
      ],
    },
    bra: {
      total: innerMain + loft * 0.6,
      existing: innerMain - innerNew + loft * 0.6,
      new: innerNew,
      perLevel: [
        { levelId: 'main', name: 'Hovedplan', gross: innerMain, area: innerMain },
        { levelId: 'loft', name: 'Hems', gross: loft, area: loft * 0.6 },
      ],
    },
    axis: { total: 76, existing: 60, new: 16 },
    rooms: rooms.map((r) => ({ roomId: r.id, name: r.room?.name ?? '', levelId: r.levelId, area: r.area, areaExisting: r.areaExisting, areaNew: r.areaNew, isNew: r.isNew })),
  };
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

const TREE: Tree = { id: 'tree-1', position: [-3, 9], height: 7, kind: 'bjork' };

export function createPlanFixtureSite(): Site {
  return {
    originLatLon: { lat: 68.565, lon: 14.93 },
    planNorthBearing: 106,
    floorElevation: 161,
    waterLevel: 157,
    terrainId: 'merkesvatnet',
    groundWorks: [],
    timezone: 'Europe/Oslo',
    trees: [{ ...TREE, position: [...TREE.position] as Vec2 }],
  };
}

/** A fresh fixture on every call (callers may mutate it). */
export function createPlanFixture(): DerivedVariant {
  const { a, b } = makeBlocks();
  const blocks = [
    derivedBlock(a, rect(-OUT, -OUT, 10 + OUT, 6 + OUT), rect(IN, IN, 10 - IN, 6 - IN), {
      zones: [{ zoneId: 'zone-loft', levelId: 'loft', kind: 'add', polygon: rect(0, 0, 4, 6) }],
      eaveZ: 2.22,
      ridgeZ: 3.87,
      pitchDeg: (Math.atan((3.87 - 2.22) / 3) * 180) / Math.PI,
      groundZ: -0.7,
    }),
    derivedBlock(b, rect(10, -OUT, 14 + OUT, 4 + OUT), rect(10 + OUT, IN, 14 - IN, 4 - IN), { zones: [], eaveZ: 2.4, ridgeZ: 2.4, pitchDeg: 0, groundZ: -0.9 }),
  ];
  const walls = makeWalls();
  const rooms = makeRooms();
  return {
    variantId: 'var-fixture',
    locked: false,
    levels: LEVELS.map((l) => ({ ...l })),
    storeys: [
      { id: 'ground', name: 'Plan 1', levelIds: ['main'] },
      { id: 'loft', name: 'Hems', levelIds: ['loft'] },
    ],
    blocks,
    walls,
    wallUnion: makeWallUnion(walls),
    rooms,
    floors: makeFloors(rooms, walls),
    groundWorks: [],
    roofs: makeRoofs(),
    outdoor: {
      decks: [
        {
          id: 'deck-1',
          polygon: DECK_POLY,
          vertexIds: DECK_POLY.map((_, i) => `deck-1-v${i}`),
          pieces: [[DECK_POLY]],
          topZ: DECK_TOP,
          thickness: 0.15,
          skirtBottomZ: [[-0.9, -0.9, -0.6, -0.6]],
          boardDirection: 'x',
          isNew: true,
          freeRuns: [
            { edgeId: 'deck-1-v0', a: [9, -3], b: [15, -3], s0: 0, s1: 6 },
            { edgeId: 'deck-1-v1', a: [15, -3], b: [15, -OUT], s0: 0, s1: 3 - OUT },
            { edgeId: 'deck-1-v3', a: [9, -OUT], b: [9, -3], s0: 0, s1: 3 - OUT },
          ],
        },
      ],
      railings: [makeRailing()],
      steps: makeSteps(),
      hotTubs: [{ id: 'tub-1', centre: [14, -1.9], diameter: 1.6, baseZ: DECK_TOP, rimZ: DECK_TOP + 1.05, isNew: true }],
    },
    structure: makeStructure(),
    furniture: [],
    ghosts: [],
    foundations: blocks.map((blk) => ({ blockId: blk.block.id, polygon: blk.outer, topZ: 0, bottomZ: blk.groundZ - 0.3 })),
    dimensions: makeDimensions(),
    site: { trees: [{ tree: { ...TREE }, baseZ: -1.5 }], waterZ: -4 },
    bounds: { min: [-OUT, -3], max: [15, 6 + OUT] },
    areas: makeAreas(blocks, rooms),
    warnings: [],
  };
}

/** Shared read-only instances for development (do not mutate; use the create functions in tests). */
export const PLAN_FIXTURE: DerivedVariant = createPlanFixture();
export const PLAN_FIXTURE_SITE: Site = createPlanFixtureSite();
