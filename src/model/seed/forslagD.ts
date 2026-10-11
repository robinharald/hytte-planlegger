/**
 * Forslag D — the seed project (`createForslagD()`), built from calibrated numbers.
 *
 * Every number comes from docs/seed-brief-forslag-d.md (authoritative), which merges the architect's IFC
 * (docs/kalibrering-ifc.md) for the existing cabin, forslag-D-spec.json for the new parts and Robin's decisions of
 * 2026-10-11. Plan frame, metres; heights relative to the main floor. See README.md in this folder.
 *
 * `createForslagD()` returns a fresh deep object on every call (nothing in the result is shared module state), so
 * callers may mutate it freely (immer drafts, tests). Timestamps come from the `now` argument or `SEED_TIMESTAMP`;
 * Date.now() is never used here.
 *
 * Small decisions where the brief is silent:
 *  - Every opening carries an explicit `levelId` (no reliance on the derive-time default).
 *  - Offsets are computed from plan coordinates (block edges run CCW: S west→east, E south→north, N east→west,
 *    W north→south; walls a→b) and rounded to the millimetre, so the stored numbers equal the brief's tables.
 *  - Exterior doors that swing out hinge at the jamb nearer an adjacent wall corner, else at 'start'.
 *  - `d-badstue` opens OUT of the sauna into the bathroom (+x). With the host a→b going +y, +x is the RIGHT side
 *    ((-dy, dx) = (-1, 0) is left), so the stored side is 'right' — the brief's text says 'left' but describes +x.
 *  - The removed room-106 door keeps its outward swing (only used for the dashed "rives" symbol).
 */
import { CURRENT_SCHEMA_VERSION } from '../types';
import type {
  Block,
  BlockPart,
  BlockVertex,
  Deck,
  ElementStatus,
  FloorZone,
  GroundWork,
  Id,
  Level,
  Opening,
  OpeningHost,
  OpeningStyle,
  OpeningType,
  Project,
  Railing,
  Room,
  RoomType,
  Site,
  StructureElement,
  Tree,
  Variant,
  Vec2,
  Wall,
  WallBuildUp,
  WallKind,
} from '../types';

/** Bump when the seed content changes; the app offers "Hent ny Forslag D" to projects with an older revision. */
export const SEED_REVISION = 1;
export const SEED_PROJECT_ID = 'hytte-merkesvatnet';
export const SEED_VARIANT_ID = 'forslag-d';
/** Id of the bundled terrain asset (src/model/seed/terrain-merkesvatnet.json). */
export const TERRAIN_ASSET_ID = 'merkesvatnet-2026-10';
/** Timestamp used when `createForslagD()` is called without `now`. */
export const SEED_TIMESTAMP = '2026-10-11T12:00:00.000Z';

// ---------------------------------------------------------------------------
// Constants shared by all blocks (IFC calibration)
// ---------------------------------------------------------------------------

const EAVE_HEIGHT = 2.22;
const PITCH_DEG = 28;
const MAIN_RIDGE = 3.87;
const WING_RIDGE = 3.28;
const ROOF_THICKNESS = 0.31;
const OVERHANG_EAVE = 0.51;
const OVERHANG_GABLE = 0.35;
const INTERIOR_THICKNESS = 0.12;
const OLD_EXTERIOR_THICKNESS = 0.27;
const OLD_PARTITION_HEIGHT = 2.3; // existing main-level partitions stop at tie-beam level
const NEW_PARTITION_HEIGHT = 2.4; // new wing partitions

const exteriorWall = (): WallBuildUp => ({ thickness: 0.27, outerOffset: 0.11 });

// ---------------------------------------------------------------------------
// Small geometry helpers
// ---------------------------------------------------------------------------

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Round to the millimetre (keeps computed offsets equal to the brief's numbers). */
const mm = (v: number): number => Math.round(v * 1000) / 1000;

/** CCW rectangle polygon. */
const rect = (r: Rect): Vec2[] => [
  [r.x0, r.y0],
  [r.x1, r.y0],
  [r.x1, r.y1],
  [r.x0, r.y1],
];

const sub = (p: Vec2, q: Vec2): Vec2 => [p[0] - q[0], p[1] - q[1]];
const len = (v: Vec2): number => Math.hypot(v[0], v[1]);

/** Distance along the line a→b of the projection of p. */
function along(a: Vec2, b: Vec2, p: Vec2): number {
  const d = sub(b, a);
  const l = len(d);
  if (l === 0) throw new Error('degenerate line');
  const v = sub(p, a);
  return (v[0] * d[0] + v[1] * d[1]) / l;
}

/** Distance from p to the segment a–b. */
function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const l2 = d[0] * d[0] + d[1] * d[1];
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2));
  return len(sub(p, [a[0] + t * d[0], a[1] + t * d[1]]));
}

/** Distance along an open polyline to a point lying on it (throws if the point is not on the path). */
function alongPath(path: Vec2[], p: Vec2): number {
  let acc = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (distanceToSegment(p, a, b) < 1e-6) return mm(acc + len(sub(p, a)));
    acc += len(sub(b, a));
  }
  throw new Error(`point (${p[0]}, ${p[1]}) is not on the path`);
}

/** Roof pitch (deg, 1 decimal) from the half width and the rise eave → ridge. */
const pitchOf = (halfWidth: number, eave: number, ridge: number): number =>
  Math.round((Math.atan2(ridge - eave, halfWidth) * 180) / Math.PI * 10) / 10;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const RECT = {
  main: { x0: 0, y0: 0, x1: 16, y1: 6.2 },
  glass: { x0: 5, y0: -2, x1: 9, y1: 0 },
  bod: { x0: 5, y0: 6.2, x1: 9, y1: 12.1 },
  wing: { x0: 16, y0: -2, x1: 20.8, y1: 6.2 },
} as const satisfies Record<string, Rect>;

type BlockKey = keyof typeof RECT;
const BLOCK_ID: Record<BlockKey, Id> = { main: 'blk-main', glass: 'blk-glass', bod: 'blk-bod', wing: 'blk-wing' };

type Side = 'S' | 'E' | 'N' | 'W';
/** Edge id = id of the edge's start vertex (CCW: south starts at SW, east at SE, north at NE, west at NW). */
const SIDE_VERTEX: Record<Side, 'sw' | 'se' | 'ne' | 'nw'> = { S: 'sw', E: 'se', N: 'ne', W: 'nw' };

const vertexId = (key: BlockKey, corner: 'sw' | 'se' | 'ne' | 'nw'): Id => `v-${key}-${corner}`;

function blockVertices(key: BlockKey): BlockVertex[] {
  const r = RECT[key];
  return [
    { id: vertexId(key, 'sw'), p: [r.x0, r.y0] },
    { id: vertexId(key, 'se'), p: [r.x1, r.y0] },
    { id: vertexId(key, 'ne'), p: [r.x1, r.y1] },
    { id: vertexId(key, 'nw'), p: [r.x0, r.y1] },
  ];
}

/** Offset along a CCW rectangle edge from its start vertex to the given x (S/N edges) or y (E/W edges). */
function edgeOffset(r: Rect, side: Side, coord: number): number {
  switch (side) {
    case 'S':
      return coord - r.x0; // west → east
    case 'E':
      return coord - r.y0; // south → north
    case 'N':
      return r.x1 - coord; // east → west
    case 'W':
      return r.y1 - coord; // north → south
  }
}

function gableRoof(ridgeAxis: 'x' | 'y', ridgeHeight: number, drive: 'pitch' | 'height', pitchDeg: number): Block['roof'] {
  return {
    type: 'gable',
    ridgeAxis,
    drive,
    pitchDeg,
    ridgeHeight,
    thickness: ROOF_THICKNESS,
    overhangEave: OVERHANG_EAVE,
    overhangGable: OVERHANG_GABLE,
    material: 'turf',
  };
}

const part = (id: Id, name: string, r: Rect, isNew: boolean): BlockPart => ({ id, name, polygon: rect(r), isNew });

function buildBlocks(): Block[] {
  /** Fields shared by all blocks (fresh objects per block). */
  const common = (): Pick<Block, 'levelId' | 'wall' | 'eaveHeight'> => ({ levelId: 'main', wall: exteriorWall(), eaveHeight: EAVE_HEIGHT });

  const lowerZone: FloorZone = {
    id: 'zone-lower',
    levelId: 'lower',
    kind: 'replace',
    polygon: [
      [0, 0],
      [5.1, 0],
      [5.1, 2.18],
      [4.3, 2.18],
      [4.3, 4.24],
      [5.05, 4.24],
      [5.05, 6.2],
      [0, 6.2],
    ],
  };
  // The loft slab (hems 1 + landing + hems 2); the stairwells x 3.85..5.1 × y 2.18..3.1 and x 3.8..5.05 × y 3.1..4.24
  // are outside it.
  const loftZone: FloorZone = {
    id: 'zone-loft',
    levelId: 'loft',
    kind: 'add',
    polygon: [
      [0, 0],
      [5.1, 0],
      [5.1, 2.18],
      [3.85, 2.18],
      [3.85, 3.1],
      [3.8, 3.1],
      [3.8, 4.24],
      [5.05, 4.24],
      [5.05, 6.2],
      [0, 6.2],
    ],
  };

  const main: Block = {
    id: BLOCK_ID.main,
    name: 'Hytta, hoveddel',
    polygon: blockVertices('main'),
    ...common(),
    floorZones: [lowerZone, loftZone],
    parts: [
      part('part-main-old', 'Eksisterende', { x0: 0, y0: 0, x1: 12, y1: 6.2 }, false),
      part('part-stue-ext', 'Stue forlenget', { x0: 12, y0: 0, x1: 16, y1: 6.2 }, true),
    ],
    isNew: false,
    roof: gableRoof('x', MAIN_RIDGE, 'pitch', PITCH_DEG),
    junctions: [
      { otherBlockId: BLOCK_ID.glass, policy: 'open' },
      { otherBlockId: BLOCK_ID.bod, policy: 'wall' },
      { otherBlockId: BLOCK_ID.wing, policy: 'open' },
    ],
  };

  const glass: Block = {
    id: BLOCK_ID.glass,
    name: 'Glassutbygg (leseskrok)',
    polygon: blockVertices('glass'),
    ...common(),
    floorZones: [],
    parts: [],
    isNew: false,
    roof: gableRoof('y', WING_RIDGE, 'pitch', PITCH_DEG),
    junctions: [],
  };

  const bod: Block = {
    id: BLOCK_ID.bod,
    name: 'Bod-fløy',
    polygon: blockVertices('bod'),
    ...common(),
    floorZones: [],
    parts: [
      part('part-bod-old', 'Bod-fløy i dag', { x0: 5, y0: 6.2, x1: 9, y1: 10.1 }, false),
      part('part-bod-new', 'Ny bod + ved', { x0: 5, y0: 10.1, x1: 9, y1: 12.1 }, true),
    ],
    isNew: false,
    roof: gableRoof('y', WING_RIDGE, 'pitch', PITCH_DEG),
    junctions: [],
  };

  const wingHalfWidth = (RECT.wing.x1 - RECT.wing.x0) / 2;
  const wing: Block = {
    id: BLOCK_ID.wing,
    name: 'Ny tverrfløy',
    polygon: blockVertices('wing'),
    ...common(),
    floorZones: [],
    parts: [],
    isNew: true,
    // Ridge at the main ridge height; the pitch follows from the 4.8 m width (≈ 34.5°).
    roof: gableRoof('y', MAIN_RIDGE, 'height', pitchOf(wingHalfWidth, EAVE_HEIGHT, MAIN_RIDGE)),
    junctions: [],
  };

  return [main, glass, bod, wing];
}

// ---------------------------------------------------------------------------
// Stored walls
// ---------------------------------------------------------------------------

interface WallOpts {
  thickness?: number;
  status?: ElementStatus;
  kind?: WallKind;
  heightMode?: Wall['heightMode'];
  height?: number;
  faceLeft?: number;
  faceRight?: number;
}

function wall(id: Id, a: Vec2, b: Vec2, levelId: Id, opts: WallOpts = {}): Wall {
  const w: Wall = {
    id,
    a,
    b,
    thickness: opts.thickness ?? INTERIOR_THICKNESS,
    levelId,
    status: opts.status ?? 'existing',
    kind: opts.kind ?? 'interior',
    heightMode: opts.heightMode ?? 'auto',
  };
  // `height` only means something for 'fixed'; helpers may pass it together with an overriding heightMode.
  if (w.heightMode === 'fixed') {
    if (opts.height === undefined) throw new Error(`${id}: fixed wall without height`);
    w.height = opts.height;
  }
  if (opts.faceLeft !== undefined) w.faceLeft = opts.faceLeft;
  if (opts.faceRight !== undefined) w.faceRight = opts.faceRight;
  return w;
}

function buildWalls(): Wall[] {
  // Lower level partitions stop under the loft floor ('auto' + ceiling 2.3); ROOF = up to the roof envelope.
  const lower = (id: Id, a: Vec2, b: Vec2, roof = false): Wall =>
    wall(id, a, b, 'lower', { heightMode: roof ? 'roof' : 'auto' });
  const oldMain = (id: Id, a: Vec2, b: Vec2, opts: WallOpts = {}): Wall =>
    wall(id, a, b, 'main', { heightMode: 'fixed', height: OLD_PARTITION_HEIGHT, ...opts });
  const oldExterior = (id: Id, a: Vec2, b: Vec2, opts: WallOpts = {}): Wall =>
    wall(id, a, b, 'main', { kind: 'exterior-old', thickness: OLD_EXTERIOR_THICKNESS, heightMode: 'auto', ...opts });
  const newMain = (id: Id, a: Vec2, b: Vec2, opts: WallOpts = {}): Wall =>
    wall(id, a, b, 'main', { status: 'new', heightMode: 'fixed', height: NEW_PARTITION_HEIGHT, ...opts });
  const divider = (id: Id, a: Vec2, b: Vec2, status: ElementStatus = 'existing'): Wall =>
    wall(id, a, b, 'main', { kind: 'divider', thickness: 0, status });
  const loft = (id: Id, a: Vec2, b: Vec2): Wall => wall(id, a, b, 'loft');

  return [
    // --- lower level (existing) ---
    lower('w-104-103', [3.05, 4.24], [3.05, 6.2]),
    lower('w-103-korr', [3.05, 4.24], [5.05, 4.24]),
    lower('w-103-102', [5.05, 4.24], [5.05, 6.2], true), // bathroom / vindfang, runs to the roof
    lower('w-104-diag', [2.25, 3.1], [3.05, 4.24]),
    lower('w-104-s', [0, 3.1], [2.25, 3.1]),
    lower('w-105-diag', [3.1, 2.18], [2.25, 3.1]),
    lower('w-105-106', [3.1, 0], [3.1, 2.18]),
    lower('w-106-korr', [3.1, 2.18], [5.1, 2.18], true),
    lower('w-106-stue', [5.1, 0], [5.1, 2.18], true),

    // --- main level (existing) ---
    oldMain('w-korr-stue', [5.1, 2.18], [6.97, 2.18]),
    oldMain('w-peis-w', [6.97, 2.18], [6.97, 3.1]),
    oldMain('w-peis-n', [6.97, 3.1], [9, 3.1]),
    oldMain('w-vf-korr', [5.05, 4.24], [8.35, 4.24]),
    oldMain('w-vf-kjk', [8.35, 4.24], [8.35, 6.2]),
    oldExterior('w-mellom-boder', [5, 7.62], [9, 7.62]),
    oldMain('w-do-109', [6.2, 7.62], [6.2, 10.1], { heightMode: 'auto' }),
    oldMain('w-109-108', [7.6, 7.62], [7.6, 10.1], { heightMode: 'auto' }),
    // Old north gable of the bod wing: 0.11 cladding on the woodshed side (+y, left of a→b), 0.16 on the bod side.
    oldExterior('w-bod-gavl', [5, 10.1], [9, 10.1], { faceLeft: 0.11, faceRight: 0.16 }),

    // --- dividers (room-graph edges only) ---
    divider('dv-leseskrok', [5, 0], [9, 0]),
    divider('dv-kjk-w', [9, 2.2], [9, 4.24]),
    divider('dv-korr-ne', [8.35, 4.24], [9, 4.24]),
    divider('dv-stue-n', [9, 2.2], [16, 2.2], 'new'),
    divider('dv-kjk-e', [12, 2.2], [12, 6.2], 'new'),
    divider('dv-pass-n', [12, 3.4], [16, 3.4], 'new'),

    // --- main level (new) ---
    newMain('w-bod-ved', [5, 11.1], [9, 11.1], { heightMode: 'auto' }),
    newMain('w-wing-w', [16, 0], [16, 6.2]),
    newMain('w-gang-s', [16, 2.2], [20.8, 2.2]),
    newMain('w-gang-n', [16, 3.4], [20.8, 3.4]),
    newMain('w-pantry-wc', [17.4, 0], [17.4, 2.2]),
    newMain('w-sauna-n', [16, 0], [18.6, 0]),
    newMain('w-wc-bad', [18.6, -2], [18.6, 2.2]),

    // --- loft (existing, 'auto' on a level without ceiling = to the roof) ---
    loft('lw-split', [0, 3.1], [3.85, 3.1]),
    loft('lw-landing', [2.65, 2.18], [2.65, 3.1]),
    loft('lw-106-top', [2.6, 2.18], [3.1, 2.18]), // short piece west of w-106-korr (which already runs to the roof)
    loft('lw-hems2-s', [3.8, 4.24], [5.05, 4.24]),
    loft('lw-hems2-w', [3.8, 3.1], [3.8, 4.24]),
  ];
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

interface HostAt {
  host: OpeningHost;
  offset: number;
}

type Swing = NonNullable<Opening['swing']>;
const swing = (hinge: Swing['hinge'], side: Swing['side']): Swing => ({ hinge, side });
/** Exterior door swinging outwards (right of a CCW block edge = outside). */
const swingOut = (hinge: Swing['hinge'] = 'start'): Swing => swing(hinge, 'right');

interface OpeningOpts {
  status?: ElementStatus;
  style?: Partial<OpeningStyle>;
  swing?: Swing;
  fullHeight?: boolean;
}

function opening(
  id: Id,
  type: OpeningType,
  at: HostAt,
  width: number,
  height: number,
  sill: number,
  levelId: Id,
  opts: OpeningOpts = {},
): Opening {
  const style: OpeningStyle = { frameColour: 'white', ...opts.style };
  if (type === 'window' && !style.mullions) style.mullions = [2, 2];
  const o: Opening = {
    id,
    type,
    host: at.host,
    offset: at.offset,
    width,
    height,
    sill,
    levelId,
    style,
    status: opts.status ?? 'existing',
  };
  if (opts.fullHeight) o.fullHeight = true;
  if (opts.swing) o.swing = opts.swing;
  return o;
}

const GREEN: Partial<OpeningStyle> = { frameColour: 'green', leaf: 'green' };
const NEW: OpeningOpts = { status: 'new' };

function buildOpenings(walls: Wall[]): Opening[] {
  const onEdge = (key: BlockKey, side: Side, coord: number): HostAt => ({
    host: { kind: 'blockEdge', blockId: BLOCK_ID[key], edgeId: vertexId(key, SIDE_VERTEX[side]) },
    offset: mm(edgeOffset(RECT[key], side, coord)),
  });
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const onWall = (wallId: Id, offset: number): HostAt => {
    if (!wallById.has(wallId)) throw new Error(`unknown wall ${wallId}`);
    return { host: { kind: 'wall', wallId }, offset: mm(offset) };
  };
  /** Opening centred at the plan point p, projected onto the wall. */
  const onWallAt = (wallId: Id, p: Vec2): HostAt => {
    const w = wallById.get(wallId);
    if (!w) throw new Error(`unknown wall ${wallId}`);
    return onWall(wallId, along(w.a, w.b, p));
  };
  const win = (id: Id, at: HostAt, w: number, h: number, sill: number, levelId: Id, opts: OpeningOpts = {}): Opening =>
    opening(id, 'window', at, w, h, sill, levelId, opts);
  const door = (id: Id, at: HostAt, w: number, h: number, levelId: Id, sw: Swing, opts: OpeningOpts = {}): Opening =>
    opening(id, 'door', at, w, h, 0, levelId, { ...opts, swing: sw });
  const glassDoor = (id: Id, at: HostAt, w: number, h: number, sw: Swing, opts: OpeningOpts = {}): Opening =>
    opening(id, 'glassDoor', at, w, h, 0, 'main', { ...opts, swing: sw });
  const passage = (id: Id, at: HostAt, w: number, h: number, levelId: Id, opts: OpeningOpts = {}): Opening =>
    opening(id, 'opening', at, w, h, 0, levelId, opts);

  const PANES_3x2: OpeningOpts = { style: { mullions: [3, 2] } };

  return [
    // --- main block, south edge (west → east) ---
    win('win-105-s', onEdge('main', 'S', 1.73), 1.11, 1.21, 0.8, 'lower'),
    // Replaces the removed exterior door of room 106 (Robin's decision).
    win('win-106-s', onEdge('main', 'S', 3.68), 1.1, 1.2, 0.8, 'lower', NEW),
    // Two-leaf glass door out to the terrace; replaces the existing window at x 10.36.
    glassDoor('door-stue-s', onEdge('main', 'S', 10.5), 1.6, 2.05, swingOut(), NEW),
    win('win-ext-s1', onEdge('main', 'S', 13.2), 1.1, 1.2, 0.8, 'main', NEW),
    win('win-ext-s2', onEdge('main', 'S', 14.8), 1.1, 1.2, 0.8, 'main', NEW),
    // --- main block, north edge (east → west) ---
    win('win-bad-n', onEdge('main', 'N', 3.51), 0.61, 1.21, 0.8, 'lower'),
    win('win-kjk-n', onEdge('main', 'N', 10.59), 1.11, 1.21, 0.8, 'main'),
    // Between the mellombygg and the vindfang; opens into the vindfang (inside = left of the edge).
    door('door-mellom-vf', onEdge('main', 'N', 7.01), 0.91, 2.01, 'main', swing('start', 'left')),
    glassDoor('door-spis-n', onEdge('main', 'N', 12.7), 0.9, 2.0, swingOut(), NEW),
    win('win-spis-n', onEdge('main', 'N', 14.6), 1.1, 1.2, 0.8, 'main', NEW),
    // --- main block, west gable (north → south) ---
    win('win-104-w', onEdge('main', 'W', 3.81), 1.11, 1.21, 0.8, 'lower'),
    win('win-hems-w1', onEdge('main', 'W', 2.44), 1.11, 1.01, 0.53, 'loft'),
    win('win-hems-w2', onEdge('main', 'W', 3.76), 1.11, 1.01, 0.53, 'loft'),
    // --- glass bump ---
    win('win-glass-s1', onEdge('glass', 'S', 6.07), 1.61, 1.61, 0.4, 'main', PANES_3x2),
    win('win-glass-s2', onEdge('glass', 'S', 7.94), 1.61, 1.61, 0.4, 'main', PANES_3x2),
    win('win-glass-e', onEdge('glass', 'E', -0.96), 1.61, 1.61, 0.4, 'main', PANES_3x2),
    win('win-glass-w', onEdge('glass', 'W', -0.96), 1.61, 1.61, 0.4, 'main', PANES_3x2),
    // --- bod wing, east edge (south → north) ---
    door('door-green-e', onEdge('bod', 'E', 6.89), 0.91, 2.01, 'main', swingOut('start'), { style: GREEN }),
    door('door-teknisk', onEdge('bod', 'E', 8.9), 0.8, 2.0, 'main', swingOut(), NEW),
    door('door-bod-ny', onEdge('bod', 'E', 10.6), 0.9, 2.0, 'main', swingOut('start'), { ...NEW, style: GREEN }),
    // Open woodshed front towards the terrace; touches the block corner at y 12.1 (allowed).
    passage('open-ved', onEdge('bod', 'E', 11.6), 1.0, EAVE_HEIGHT, 'main', { ...NEW, fullHeight: true }), // height ignored (fullHeight)
    // --- bod wing, west edge (north → south) ---
    door('door-green-w', onEdge('bod', 'W', 6.89), 0.91, 2.01, 'main', swingOut('end'), { style: GREEN }),
    win('win-do-w', onEdge('bod', 'W', 8.82), 0.61, 1.21, 0.8, 'main'),
    // --- new wing ---
    win('win-badstue-s', onEdge('wing', 'S', 17.3), 1.2, 0.9, 0.7, 'main', NEW),
    win('win-gavl-s', onEdge('wing', 'S', 18.4), 0.8, 0.7, 2.75, 'main', NEW), // high gable window
    win('win-bad-s', onEdge('wing', 'S', 20.15), 0.6, 0.6, 1.1, 'main', NEW),
    win('win-bad-e1', onEdge('wing', 'E', -0.3), 0.6, 0.6, 1.1, 'main', NEW),
    win('win-bad-e2', onEdge('wing', 'E', 1.5), 0.5, 0.6, 1.3, 'main', NEW),
    glassDoor('door-gang-e', onEdge('wing', 'E', 2.8), 1.0, 2.05, swingOut(), NEW),
    win('win-sov-n', onEdge('wing', 'N', 18.0), 1.6, 1.3, 0.5, 'main', NEW),
    win('win-gavl-n', onEdge('wing', 'N', 18.4), 0.8, 0.7, 2.75, 'main', NEW), // high gable window
    win('win-badstue-w', onEdge('wing', 'W', -1.0), 1.0, 0.9, 0.7, 'main', NEW),

    // --- removed by the design (plan: dashed "rives"; infill patches; no 3D) ---
    win('win-stue-s-old', onEdge('main', 'S', 10.36), 1.11, 1.21, 0.8, 'main', { status: 'removed' }),
    door('door-106-old', onEdge('main', 'S', 3.68), 0.91, 2.01, 'lower', swingOut(), { status: 'removed' }),

    // --- on stored walls: lower level ---
    door('d-bad', onWallAt('w-103-korr', [3.61, 4.24]), 0.81, 2.01, 'lower', swing('start', 'left')), // into the bathroom (+y)
    door('d-104', onWall('w-104-diag', 0.7), 0.81, 2.01, 'lower', swing('end', 'left')), // into room 104
    door('d-105', onWall('w-105-diag', 0.62), 0.81, 2.01, 'lower', swing('start', 'left')), // into room 105
    door('d-106', onWallAt('w-106-korr', [3.68, 2.18]), 0.81, 2.01, 'lower', swing('start', 'right')), // into room 106 (−y)
    // --- on stored walls: main level, existing ---
    passage('o-vf', onWallAt('w-vf-korr', [6.9, 4.24]), 1.2, 2.1, 'main'),
    door('d-do', onWallAt('w-mellom-boder', [5.64, 7.62]), 0.81, 2.01, 'main', swing('start', 'left')), // into Do (+y)
    door('d-bod109', onWallAt('w-mellom-boder', [7.01, 7.62]), 0.91, 2.01, 'main', swing('start', 'left')), // into the bod (+y)
    // --- on stored walls: new wing ---
    passage('o-stue-gang', onWallAt('w-wing-w', [16, 2.8]), 1.2, 2.1, 'main', NEW),
    door('d-pantry', onWallAt('w-gang-s', [16.7, 2.2]), 0.7, 2.0, 'main', swing('start', 'right'), NEW), // into the pantry (−y)
    door('d-wc', onWallAt('w-gang-s', [18.0, 2.2]), 0.7, 2.0, 'main', swing('start', 'right'), NEW), // into the WC (−y)
    door('d-bad2', onWallAt('w-gang-s', [19.5, 2.2]), 0.8, 2.0, 'main', swing('end', 'right'), NEW), // into the bathroom (−y)
    door('d-sov-ny', onWallAt('w-gang-n', [17.3, 3.4]), 0.8, 2.0, 'main', swing('start', 'left'), NEW), // into the bedroom (+y)
    // Opens OUT of the sauna into the bathroom (+x = right of a→b going +y). Glass leaf by type.
    opening('d-badstue', 'saunaDoor', onWallAt('w-wc-bad', [18.6, -1.0]), 0.7, 1.9, 0, 'main', {
      ...NEW,
      swing: swing('start', 'right'),
      style: { frameColour: 'wood' },
    }),
    // --- on stored walls: loft ---
    door('d-hems2', onWall('lw-split', 3.24), 0.81, 1.81, 'loft', swing('end', 'left')), // into Hems 2 (+y)
    door('d-hems1', onWall('lw-landing', 0.48), 0.71, 1.81, 'loft', swing('start', 'left')), // into Hems 1 (−x)
  ];
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

function room(id: Id, name: string, type: RoomType, levelId: Id, anchor: Vec2, extra: Pick<Room, 'floorMaterial' | 'note'> = {}): Room {
  return { id, name, type, levelId, anchor, ...extra };
}

function buildRooms(): Room[] {
  return [
    // lower level
    room('room-sov1', 'Soverom 1', 'soverom', 'lower', [1.5, 5.2]),
    room('room-bad', 'Bad', 'bad', 'lower', [4.05, 5.2]),
    room('room-sov2', 'Soverom 2', 'soverom', 'lower', [1.2, 1.4]),
    room('room-sov3', 'Soverom 3', 'soverom', 'lower', [4.1, 1.1]),
    room('room-korr-nedre', 'Korridor (nedre)', 'gang', 'lower', [3.6, 3.6]),
    // main level
    room('room-korr-ovre', 'Korridor (øvre)', 'gang', 'main', [5.9, 3.6]),
    room('room-vindfang', 'Vindfang', 'vindfang', 'main', [6.7, 5.3]),
    room('room-leseskrok', 'Leseskrok', 'leseskrok', 'main', [7, -1]),
    room('room-stue', 'Stue', 'stue', 'main', [13.9, 1.0]),
    room('room-kjokken', 'Kjøkken', 'kjokken', 'main', [10.6, 4.9]),
    room('room-passasje', 'Passasje', 'gang', 'main', [14, 2.8]),
    room('room-spiseplass', 'Spiseplass', 'spiseplass', 'main', [14, 4.9]),
    // bod wing
    room('room-mellombygg', 'Mellombygg', 'vindfang', 'main', [7, 6.9]),
    room('room-do', 'Do', 'wc', 'main', [5.6, 8.8]),
    room('room-bod', 'Bod', 'bod', 'main', [6.9, 8.8]),
    room('room-teknisk', 'Teknisk / vask', 'teknisk', 'main', [8.3, 8.8], { note: 'Tidligere bod 108' }),
    room('room-bod-ny', 'Bod (ny)', 'bod', 'main', [7, 10.6]),
    room('room-ved', 'Ved', 'bod', 'main', [7, 11.6], { floorMaterial: 'deck', note: 'Åpent mot terrassen' }),
    // new wing
    room('room-gang', 'Gang', 'gang', 'main', [18.4, 2.8]),
    room('room-sov-ny', 'Soverom (ny fløy)', 'soverom', 'main', [18.4, 4.8]),
    room('room-pantry', 'Pantry', 'pantry', 'main', [16.7, 1.1]),
    room('room-wc', 'WC', 'wc', 'main', [18.0, 1.1]),
    room('room-hovedbad', 'Hovedbad', 'bad', 'main', [19.7, 0.3]),
    room('room-badstue', 'Badstue', 'badstue', 'main', [17.3, -1.0]),
    // loft
    room('room-hems1', 'Hems 1 (soverom)', 'hems', 'loft', [2.5, 1.1]),
    room('room-hems2', 'Hems 2 (soverom)', 'hems', 'loft', [2, 5]),
    room('room-repos', 'Trapperepos', 'gang', 'loft', [3.25, 2.6]),
  ];
}

// ---------------------------------------------------------------------------
// Structure, outdoor, site
// ---------------------------------------------------------------------------

function buildStructure(): StructureElement[] {
  const post = (id: Id, position: Vec2, size: number, top: number, isNew: boolean): StructureElement => ({
    id,
    kind: 'post',
    position,
    size,
    bottom: 0,
    top,
    isNew,
  });
  const beam = (id: Id, a: Vec2, b: Vec2, bottom: number, top: number, isNew: boolean): StructureElement => ({
    id,
    kind: 'beam',
    a,
    b,
    width: 0.12,
    bottom,
    top,
    isNew,
  });
  return [
    // Ridge posts under the main ridge beam. post-3 stands in the removed east gable and stays as a free post.
    post('post-1', [5.1, 3.1], 0.11, 3.5, false),
    post('post-2', [8.95, 3.1], 0.11, 3.5, false),
    post('post-3', [11.9, 3.1], 0.11, 3.5, false),
    post('post-ved', [8.93, 12.03], 0.14, EAVE_HEIGHT, true), // woodshed corner post
    beam('beam-ridge-old', [0.03, 3.1], [11.97, 3.1], 3.5, 3.86, false),
    beam('beam-ridge-new', [11.97, 3.1], [18.4, 3.1], 3.5, 3.86, true),
    beam('tie-1', [5.04, 3.1], [7.01, 3.1], 2.3, 2.5, false),
    beam('tie-2', [8.89, 3.1], [11.97, 3.1], 2.3, 2.5, false),
    beam('tie-3', [8.95, 0.07], [8.95, 3.15], 2.3, 2.5, false),
    { id: 'chimney-1', kind: 'chimney', min: [7.08, 2.48], max: [7.63, 3.03], bottom: 0, top: 5.2, isNew: false },
    { id: 'stair-loft', kind: 'stair', min: [3.85, 2.24], max: [6.1, 3.04], fromLevelId: 'main', toLevelId: 'loft', upDirection: 'W', isNew: false },
    { id: 'stair-level', kind: 'stair', min: [4.3, 3.17], max: [5.55, 4.17], fromLevelId: 'lower', toLevelId: 'main', upDirection: 'E', isNew: false },
  ];
}

function buildOutdoor(): Variant['outdoor'] {
  const deck: Deck = {
    id: 'deck-terrasse',
    polygon: [
      [5, -4.6],
      [23.2, -4.6],
      [23.2, 12.1],
      [9, 12.1],
      [9, 6.2],
      [20.8, 6.2],
      [20.8, -2],
      [16, -2],
      [16, 0],
      [9, 0],
      [9, -2],
      [5, -2],
    ],
    topHeight: -0.02,
    isNew: true,
  };
  const path: Vec2[] = [
    [5, -2],
    [5, -4.6],
    [23.2, -4.6],
    [23.2, 12.1],
    [9, 12.1],
  ];
  const gap = (from: Vec2, to: Vec2): Railing['gaps'][number] => ({ from: alongPath(path, from), to: alongPath(path, to), steps: true });
  const railing: Railing = {
    id: 'rail-terrasse',
    deckId: deck.id,
    path,
    height: 1.05,
    style: 'glass',
    gaps: [
      gap([7, -4.6], [8.4, -4.6]), // steps down from the south edge
      gap([23.2, 2.1], [23.2, 3.5]), // opposite the corridor door
      gap([23.2, 8.4], [23.2, 9.8]),
    ],
    isNew: true,
  };
  return {
    decks: [deck],
    railings: [railing],
    hotTubs: [{ id: 'tub-1', centre: [21.7, -3.2], diameter: 2.0, isNew: true }],
  };
}

const TREES: [number, number, number][] = [
  [-4, 4, 5],
  [-6, 12, 6],
  [-3, -8, 5],
  [33, 12, 6],
  [29, 22, 7],
  [25, 26, 5],
  [2, 24, 6],
  [13, 25, 5.5],
  [-9, 30, 6],
  [32, -10, 5],
  [36, -16, 6.5],
  [-10, -2, 5.5],
];

function buildSite(): Site {
  // The terrain under the deck, the bod wing and the new wing is cut so it never rises above 0.45 m below the main
  // floor; the lower bedroom part (x < 4.5) is outside it.
  const groundWork: GroundWork = {
    id: 'gw-tomt',
    polygon: rect({ x0: 4.5, y0: -5.1, x1: 23.7, y1: 12.6 }),
    maxZ: -0.45,
  };
  const trees: Tree[] = TREES.map(([x, y, height], i) => ({ id: `tree-${i + 1}`, position: [x, y], height, kind: 'bjork' }));
  return {
    originLatLon: { lat: 68.61305, lon: 14.968157 },
    planNorthBearing: 106,
    floorElevation: 161.0,
    waterLevel: 152.0,
    terrainId: TERRAIN_ASSET_ID,
    groundWorks: [groundWork],
    timezone: 'Europe/Oslo',
    trees,
  };
}

function buildLevels(): Level[] {
  return [
    { id: 'lower', name: 'Underetasje (soverom)', storeyId: 'ground', elevation: -1.0, ceilingHeight: 2.3, floorThickness: 0 },
    { id: 'main', name: 'Hovedplan', storeyId: 'ground', elevation: 0, floorThickness: 0 },
    { id: 'loft', name: 'Hems', storeyId: 'loft', elevation: 1.47, floorThickness: 0.17 },
  ];
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

/** The Forslag D variant alone (fresh object). */
export function createForslagDVariant(now: string = SEED_TIMESTAMP): Variant {
  const walls = buildWalls();
  return {
    id: SEED_VARIANT_ID,
    name: 'Forslag D',
    description: 'Stua forlenget 4 m mot øst, ny tverrfløy 4,8 × 8,2 m med soverom, bad, WC, pantry og badstue, ny bod og ved i enden av bod-fløya, terrasse med badestamp.',
    createdAt: now,
    levels: buildLevels(),
    blocks: buildBlocks(),
    walls,
    openings: buildOpenings(walls),
    rooms: buildRooms(),
    furniture: [],
    outdoor: buildOutdoor(),
    structure: buildStructure(),
    settings: {
      defaultExteriorWall: exteriorWall(),
      defaultInteriorThickness: INTERIOR_THICKNESS,
      areaLimit: null,
    },
  };
}

/**
 * The seed project: "Hytta ved Merkesvatnet" with the single variant "Forslag D".
 * Returns a fresh deep object on every call. `now` (ISO 8601) is used for all timestamps.
 */
export function createForslagD(now: string = SEED_TIMESTAMP): Project {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: SEED_PROJECT_ID,
    name: 'Hytta ved Merkesvatnet',
    createdAt: now,
    updatedAt: now,
    seedRevision: SEED_REVISION,
    site: buildSite(),
    variants: [createForslagDVariant(now)],
    activeVariantId: SEED_VARIANT_ID,
  };
}
