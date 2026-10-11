/**
 * deriveVariant — docs/architecture.md "Derivation pipeline", steps 1–8. Pure: the stored Variant + Site + terrain
 * asset in, the DerivedVariant every renderer reads out. Memoised on the (variant, site, terrain) object identities.
 *
 *  1. Blocks (`deriveBlocks`), block warnings (`block-overlap`, `parts-overlap`).
 *  2. Roofs (`buildRoofsWithWarnings`, `roof-no-meet`); `combinedUndersideAt` is the one underside query used below.
 *  3. Walls and openings (`deriveWalls`).
 *  4. Rooms per storey (`detectRooms`): the reference lines of every non-removed wall whose `storeyIds` include the
 *     storey, plus the edges of the floor zones of that storey as zero-thickness lines ('add' zones on the zone's
 *     storey; 'replace' zones on the zone's storey and on the storey of the block's base level). Each face is
 *     located by its label point: the first block whose axis polygon contains it, then the first zone of that block
 *     on this storey containing it (zone level), else the block's base level when it is on this storey and no
 *     'replace' zone carves the point out. Faces outside every block or without a floor on this storey are dropped
 *     (this is the "loft faces outside every add zone" rule). A Room record attaches to the face of its storey whose
 *     inner polygon contains the anchor (else whose face polygon does, smallest first); a second record in the same
 *     face, or a record without a face, gets `room-anchor-lost`. Faces without a record get the id
 *     `face-<hash>` and `room-unnamed`. Records with less than 0.5 m² (not 'apning') get `room-small`.
 *     The level of a room is the level of its face (geometry wins over the record's levelId).
 *     `wall-dangling` is reported only for stored walls (incl. dividers) that the graph reports as dangling on a
 *     storey and that bound no room on any storey: exterior pieces dangle legitimately where a block reaches into a
 *     storey only through an 'add' zone (the loft), and a partition with a free end that still forms rooms is fine.
 *  5. Floors: one 'room' floor per room (not 'apning'); one 'threshold' under every door / glass door / frameless
 *     opening that has a room on at least one side (probed 5 cm beyond each wall face at the opening centre on the
 *     opening's storey) at the lower room's z and with that room's material and level; 'slab' per floor zone and per
 *     block base level whose level has floorThickness > 0 (zone ∩ block inner outline, or the inner outline minus
 *     the 'replace' zones for the base), with the footprints of stairs arriving on that level cut out.
 *  6. Outdoor (`deriveOutdoor`), 7. structure (`deriveStructure`), both with the terrain / underside callbacks.
 *  8. Areas (`computeAreas`), foundations (outer outline, top = lowest floor, bottom = groundZ − 0.3), site trees
 *     (terrain baseZ) and water (waterLevel − floorElevation), dimensions, bounds (outer outlines + decks), wall
 *     unions per storey and status, furniture (z = level elevation), `area-limit`.
 *
 * Dimensions: per cardinal side the "profile" of the block axis polygons seen from that side. Its breakpoints are
 * the block and part vertex coordinates; consecutive intervals with the same outermost edge (same position, block
 * and part) are merged into one chain piece measured on that edge. Pieces set back more than 6.5 m from the
 * outermost edge of the side are left out (the bod wing's east face does not belong on the new wing's east chain).
 * The chain line runs 1.0 m outside the outermost edge of the side, a total over the whole extent of the side
 * 1.8 m outside (unless the chain is one piece covering it). Chains run counter-clockwise round the building
 * (S: west→east, E: south→north, …), so the offsets are negative (outside). Text: metres with a comma, one decimal
 * (two when the length is not a whole number of decimetres).
 */
import type { DerivedBlock, DerivedDimension, DerivedFloor, DerivedFurniture, DerivedRoom, DerivedVariant, DerivedWall, ModelWarning } from '../model/derived';
import type { FloorMaterial, Id, Level, Room, RoomType, Site, TerrainAsset, Variant, Vec2 } from '../model/types';
import { blockPartRegions, computeAreas, splitAreaByParts } from './areas';
import { deriveOutdoor, deriveStructure } from './outdoor';
import { area, bbox, differencePolygons, ensureCCW, intersectPolygons, pointInPolygon, unionPolygons } from './polygon';
import { buildRoofsWithWarnings, combinedUndersideAt } from './roof';
import { detectRooms } from './rooms';
import type { DetectedRoom, WallLine } from './rooms';
import { terrainZAt } from './terrain';
import { deriveBlockWarnings, deriveBlocks, deriveWalls } from './walls';

/** Graph-only lines (floor-zone edges) carry ids with this prefix; they are not derived walls. */
const ZONE_LINE = 'zone:';
/** Rooms with a record smaller than this (m²) get `room-small` (a detection slip rather than a design choice; the loft landing is 0.9 m²). */
const MIN_ROOM_AREA = 0.5;
/** Probe distance (m) beyond a wall face when looking for the rooms on both sides of an opening. */
const SIDE_PROBE = 0.05;
const FOUNDATION_DEPTH = 0.3;
const CHAIN_GAP = 1.0;
const TOTAL_GAP = 1.8;
/** Chain pieces set back more than this (m) from the outermost edge of their side are left out of the chain. */
const MAX_SETBACK = 6.5;
/** Coordinates closer than this (m) are one dimension breakpoint. */
const DIM_TOL = 0.001;

const FLOOR_BY_TYPE: Record<RoomType, FloorMaterial> = {
  stue: 'wood',
  kjokken: 'wood',
  spiseplass: 'wood',
  soverom: 'wood',
  bad: 'tile',
  wc: 'tile',
  badstue: 'sauna',
  gang: 'wood',
  vindfang: 'tile',
  bod: 'wood',
  teknisk: 'tile',
  pantry: 'wood',
  hems: 'wood',
  leseskrok: 'wood',
  apning: 'wood',
  annet: 'wood',
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function storeysOf(levels: Level[]): DerivedVariant['storeys'] {
  const ids: Id[] = [];
  for (const l of levels) if (!ids.includes(l.storeyId)) ids.push(l.storeyId);
  return ids.map((id) => {
    const ls = levels.filter((l) => l.storeyId === id);
    return { id, name: ls.map((l) => l.name).join(' / '), levelIds: ls.map((l) => l.id) };
  });
}

/** Point inside a polygon with holes (boundary inclusive for the outer ring, exclusive for holes). */
function inPolygonWithHoles(p: Vec2, outer: Vec2[], holes: Vec2[][]): boolean {
  if (!pointInPolygon(p, outer)) return false;
  return !holes.some((h) => h.length >= 3 && pointInPolygon(p, h));
}

/** Norwegian dimension text: "4,8", "3,95". */
export function dimensionText(length: number): string {
  const tenths = length * 10;
  const decimals = Math.abs(tenths - Math.round(tenths)) < 0.01 ? 1 : 2;
  return length.toFixed(decimals).replace('.', ',');
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

interface Located {
  levelId: Id;
  blockId: Id;
}

/** Level (and block) of a point on one storey, or null when the storey has no floor there. */
function locate(p: Vec2, storeyLevels: Set<Id>, blocks: DerivedBlock[]): Located | null {
  for (const db of blocks) {
    if (db.axis.length < 3 || !pointInPolygon(p, db.axis)) continue;
    for (const z of db.zones) {
      if (storeyLevels.has(z.levelId) && z.polygon.length >= 3 && pointInPolygon(p, z.polygon)) return { levelId: z.levelId, blockId: db.block.id };
    }
    if (storeyLevels.has(db.block.levelId)) {
      const carved = db.zones.some((z) => z.kind === 'replace' && z.polygon.length >= 3 && pointInPolygon(p, z.polygon));
      if (!carved) return { levelId: db.block.levelId, blockId: db.block.id };
    }
  }
  return null;
}

/** Reference lines of one storey's room graph: walls of the storey plus the floor-zone edges. */
function storeyLines(storeyId: Id, walls: DerivedWall[], blocks: DerivedBlock[], storeyOfLevel: Map<Id, Id>): WallLine[] {
  const lines: WallLine[] = [];
  for (const w of walls) {
    if (w.status === 'removed' || !w.storeyIds.includes(storeyId)) continue;
    lines.push({ id: w.id, a: w.a, b: w.b, footprint: w.isDivider ? [] : w.footprint });
  }
  for (const db of blocks) {
    db.zones.forEach((z, zi) => {
      const own = storeyOfLevel.get(z.levelId) === storeyId;
      const base = z.kind === 'replace' && storeyOfLevel.get(db.block.levelId) === storeyId;
      if (!(own || base) || z.polygon.length < 3) return;
      const poly = z.polygon;
      for (let i = 0; i < poly.length; i++) {
        lines.push({ id: `${ZONE_LINE}${db.block.id}/${z.zoneId}#${zi}/${i}`, a: poly[i], b: poly[(i + 1) % poly.length], footprint: [] });
      }
    });
  }
  return lines;
}

interface StoreyFace {
  det: DetectedRoom;
  storeyId: Id;
  levelId: Id;
  blockId: Id;
  room?: Room;
}

interface RoomResult {
  rooms: DerivedRoom[];
  warnings: ModelWarning[];
}

function deriveRooms(variant: Variant, storeys: DerivedVariant['storeys'], blocks: DerivedBlock[], walls: DerivedWall[]): RoomResult {
  const storeyOfLevel = new Map(variant.levels.map((l) => [l.id, l.storeyId]));
  const warnings: ModelWarning[] = [];
  const faces: StoreyFace[] = [];
  const danglingIds = new Set<Id>();
  const boundingIds = new Set<Id>();
  for (const s of storeys) {
    const levels = new Set(s.levelIds);
    const { rooms, dangling } = detectRooms(storeyLines(s.id, walls, blocks, storeyOfLevel));
    for (const id of dangling) danglingIds.add(id);
    for (const det of rooms) {
      const at = locate(det.labelPoint, levels, blocks);
      if (!at) continue;
      for (const id of det.wallIds) boundingIds.add(id);
      faces.push({ det, storeyId: s.id, levelId: at.levelId, blockId: at.blockId });
    }
  }

  for (const room of variant.rooms) {
    const storeyId = storeyOfLevel.get(room.levelId);
    const onStorey = faces.filter((f) => f.storeyId === storeyId);
    const face =
      onStorey.find((f) => inPolygonWithHoles(room.anchor, f.det.innerPolygon, f.det.holes)) ??
      onStorey.filter((f) => pointInPolygon(room.anchor, f.det.facePolygon)).sort((a, b) => area(a.det.facePolygon) - area(b.det.facePolygon))[0];
    if (!face || face.room) {
      warnings.push({ kind: 'room-anchor-lost', roomId: room.id });
      continue;
    }
    face.room = room;
  }

  const innerParts = blockPartRegions(blocks, 'inner');
  const rooms: DerivedRoom[] = faces.map((f) => {
    const { det } = f;
    const split = splitAreaByParts(det.innerPolygon, det.holes, innerParts);
    const derived: DerivedRoom = {
      id: f.room?.id ?? det.faceId,
      levelId: f.levelId,
      storeyId: f.storeyId,
      polygon: det.innerPolygon,
      holes: det.holes,
      area: det.area,
      areaExisting: split.existing,
      areaNew: split.new,
      isNew: split.new > split.existing,
      bbox: det.bbox,
      dims: det.dims,
      labelPoint: det.labelPoint,
      blockId: f.blockId,
      floorMaterial: f.room?.floorMaterial ?? FLOOR_BY_TYPE[f.room?.type ?? 'annet'],
      facePolygon: det.facePolygon,
      wallIds: det.wallIds.filter((id) => !id.startsWith(ZONE_LINE)),
    };
    if (f.room) derived.room = f.room;
    return derived;
  });

  for (const r of rooms) {
    if (!r.room) warnings.push({ kind: 'room-unnamed', faceId: r.id, levelId: r.levelId, area: r.area });
    else if (r.room.type !== 'apning' && r.area < MIN_ROOM_AREA) warnings.push({ kind: 'room-small', roomId: r.room.id, area: r.area, min: MIN_ROOM_AREA });
  }
  const stored = new Map(walls.filter((w) => w.source.kind === 'wall').map((w) => [w.id, w]));
  for (const id of danglingIds) {
    const w = stored.get(id);
    if (w && w.status !== 'removed' && !boundingIds.has(id)) warnings.push({ kind: 'wall-dangling', wallId: id });
  }
  return { rooms, warnings };
}

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

const THRESHOLD_TYPES = new Set(['door', 'glassDoor', 'slidingDoor', 'saunaDoor', 'opening']);

function roomFloors(rooms: DerivedRoom[], levels: Map<Id, Level>): DerivedFloor[] {
  const floors: DerivedFloor[] = [];
  for (const r of rooms) {
    if (r.room?.type === 'apning' || r.polygon.length < 3) continue;
    const level = levels.get(r.levelId);
    const floor: DerivedFloor = {
      id: `${r.id}/floor`,
      levelId: r.levelId,
      polygon: r.polygon,
      holes: r.holes,
      z: level?.elevation ?? 0,
      thickness: level?.floorThickness ?? 0,
      material: r.floorMaterial,
      isNew: r.isNew,
      kind: 'room',
    };
    if (r.room) floor.roomId = r.room.id;
    floors.push(floor);
  }
  return floors;
}

function thresholdFloors(walls: DerivedWall[], rooms: DerivedRoom[], levels: Map<Id, Level>): DerivedFloor[] {
  const floors: DerivedFloor[] = [];
  const roomAt = (p: Vec2, storeyId: Id | undefined): DerivedRoom | undefined =>
    rooms.find((r) => r.storeyId === storeyId && r.room?.type !== 'apning' && inPolygonWithHoles(p, r.polygon, r.holes));
  const elevation = (r: DerivedRoom) => levels.get(r.levelId)?.elevation ?? 0;
  for (const w of walls) {
    if (w.isDivider || w.footprint.length < 3) continue;
    const dx = w.b[0] - w.a[0];
    const dy = w.b[1] - w.a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const u: Vec2 = [dx / len, dy / len];
    const n: Vec2 = [-u[1], u[0]];
    for (const o of w.openings) {
      if (o.status === 'removed' || !THRESHOLD_TYPES.has(o.type) || o.footprint.length < 3) continue;
      const storeyId = levels.get(o.opening.levelId ?? w.levelId)?.storeyId;
      const c: Vec2 = [w.a[0] + u[0] * o.offset, w.a[1] + u[1] * o.offset];
      const left: Vec2 = [c[0] + n[0] * (w.faceLeft + SIDE_PROBE), c[1] + n[1] * (w.faceLeft + SIDE_PROBE)];
      const right: Vec2 = [c[0] - n[0] * (w.faceRight + SIDE_PROBE), c[1] - n[1] * (w.faceRight + SIDE_PROBE)];
      const sides = [roomAt(left, storeyId), roomAt(right, storeyId)].filter((r): r is DerivedRoom => r !== undefined);
      if (sides.length === 0) continue;
      const lower = sides.reduce((best, r) => (elevation(r) < elevation(best) ? r : best));
      const level = levels.get(lower.levelId);
      floors.push({
        id: `${o.id}/threshold`,
        levelId: lower.levelId,
        polygon: ensureCCW(o.footprint),
        holes: [],
        z: level?.elevation ?? 0,
        thickness: level?.floorThickness ?? 0,
        material: lower.floorMaterial,
        isNew: o.isNew,
        kind: 'threshold',
      });
    }
  }
  return floors;
}

function stairFootprints(variant: Variant, levelId: Id): Vec2[][] {
  const out: Vec2[][] = [];
  for (const s of variant.structure) {
    if (s.kind !== 'stair' || s.toLevelId !== levelId) continue;
    out.push([
      [s.min[0], s.min[1]],
      [s.max[0], s.min[1]],
      [s.max[0], s.max[1]],
      [s.min[0], s.max[1]],
    ]);
  }
  return out;
}

function slabFloors(variant: Variant, blocks: DerivedBlock[], levels: Map<Id, Level>): DerivedFloor[] {
  const floors: DerivedFloor[] = [];
  const innerParts = blockPartRegions(blocks, 'inner');
  const push = (baseId: string, levelId: Id, region: Vec2[][][]) => {
    const level = levels.get(levelId);
    if (!level || !(level.floorThickness > 0)) return;
    const outers = region.map((p) => p[0]).filter((r): r is Vec2[] => r !== undefined && r.length >= 3);
    if (outers.length === 0) return;
    const pieces = differencePolygons(outers, stairFootprints(variant, levelId));
    pieces.forEach((poly, i) => {
      if (poly.length === 0 || area(poly[0]) < 1e-6) return;
      const outer = ensureCCW(poly[0]);
      const holes = poly.slice(1);
      const split = splitAreaByParts(outer, holes, innerParts);
      floors.push({
        id: i === 0 ? `${baseId}/slab` : `${baseId}/slab/${i + 1}`,
        levelId,
        polygon: outer,
        holes,
        z: level.elevation,
        thickness: level.floorThickness,
        material: 'wood',
        isNew: split.new > split.existing,
        kind: 'slab',
      });
    });
  };
  for (const db of blocks) {
    if (db.inner.length < 3) continue;
    const replaced = db.zones.filter((z) => z.kind === 'replace' && z.polygon.length >= 3).map((z) => z.polygon);
    push(`${db.block.id}/base`, db.block.levelId, replaced.length > 0 ? differencePolygons([db.inner], replaced) : [[db.inner]]);
    const seen = new Map<Id, number>();
    for (const z of db.zones) {
      if (z.polygon.length < 3) continue;
      const k = (seen.get(z.zoneId) ?? 0) + 1;
      seen.set(z.zoneId, k);
      push(`${db.block.id}/${z.zoneId}${k > 1 ? `#${k}` : ''}`, z.levelId, intersectPolygons([z.polygon], [db.inner]));
    }
  }
  return floors;
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

interface SideDef {
  /** Coordinate index along the side (0 = x) and across it. */
  along: 0 | 1;
  across: 0 | 1;
  /** +1 when "outside" is towards larger `across` values. */
  out: 1 | -1;
  /** +1 when the chain runs towards larger `along` values (counter-clockwise round the building). */
  dir: 1 | -1;
}

const SIDES: SideDef[] = [
  { along: 0, across: 1, out: -1, dir: 1 }, // south: west → east
  { along: 1, across: 0, out: 1, dir: 1 }, // east: south → north
  { along: 0, across: 1, out: 1, dir: -1 }, // north: east → west
  { along: 1, across: 0, out: -1, dir: -1 }, // west: north → south
];

/** Across values where the line `along = u` crosses the polygon boundary. */
function crossings(poly: Vec2[], side: SideDef, u: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const pu = p[side.along];
    const qu = q[side.along];
    if ((pu - u) * (qu - u) > 0 || Math.abs(qu - pu) < 1e-12) continue;
    const t = (u - pu) / (qu - pu);
    out.push(p[side.across] + t * (q[side.across] - p[side.across]));
  }
  return out;
}

function pointOn(side: SideDef, u: number, v: number): Vec2 {
  return side.along === 0 ? [u, v] : [v, u];
}

interface ChainPiece {
  u0: number;
  u1: number;
  v: number;
  key: string;
}

function sideDimensions(blocks: DerivedBlock[], side: SideDef): DerivedDimension[] {
  const coords: number[] = [];
  for (const db of blocks) {
    if (db.axis.length < 3) continue;
    for (const p of db.axis) coords.push(p[side.along]);
    const box = bbox(db.axis);
    for (const part of db.parts) {
      for (const p of part.part.polygon) {
        const c = p[side.along];
        if (c > box.min[side.along] && c < box.max[side.along]) coords.push(c);
      }
    }
  }
  coords.sort((a, b) => a - b);
  const breaks: number[] = [];
  for (const c of coords) if (breaks.length === 0 || c - breaks[breaks.length - 1] > DIM_TOL) breaks.push(c);

  const pieces: ChainPiece[] = [];
  for (let i = 0; i + 1 < breaks.length; i++) {
    const u0 = breaks[i];
    const u1 = breaks[i + 1];
    const m = (u0 + u1) / 2;
    let best: { v: number; db: DerivedBlock } | null = null;
    for (const db of blocks) {
      if (db.axis.length < 3) continue;
      for (const v of crossings(db.axis, side, m)) {
        if (best === null || (v - best.v) * side.out > DIM_TOL) best = { v, db };
      }
    }
    if (best === null) continue;
    const probe = pointOn(side, m, best.v - side.out * 0.01);
    const part = best.db.parts.find((p) => p.part.polygon.length >= 3 && pointInPolygon(probe, p.part.polygon));
    const key = `${Math.round(best.v * 1000)}|${best.db.block.id}|${part?.part.id ?? ''}`;
    const last = pieces[pieces.length - 1];
    if (last && last.key === key && Math.abs(last.u1 - u0) < DIM_TOL) last.u1 = u1;
    else pieces.push({ u0, u1, v: best.v, key });
  }
  if (pieces.length === 0) return [];
  const edge = pieces.reduce((e, p) => (side.out > 0 ? Math.max(e, p.v) : Math.min(e, p.v)), pieces[0].v);
  const make = (u0: number, u1: number, v: number, gap: number, kind: DerivedDimension['kind']): DerivedDimension => {
    const [s, e] = side.dir > 0 ? [u0, u1] : [u1, u0];
    return { a: pointOn(side, s, v), b: pointOn(side, e, v), offset: -(Math.abs(edge - v) + gap), text: dimensionText(u1 - u0), kind };
  };
  const chain = pieces.filter((p) => Math.abs(edge - p.v) <= MAX_SETBACK);
  const ordered = side.dir > 0 ? chain : [...chain].reverse();
  const dims = ordered.map((p) => make(p.u0, p.u1, p.v, CHAIN_GAP, 'axisChain'));
  const u0 = pieces[0].u0;
  const u1 = pieces[pieces.length - 1].u1;
  const covered = chain.length === 1 && Math.abs(chain[0].u0 - u0) < DIM_TOL && Math.abs(chain[0].u1 - u1) < DIM_TOL;
  if (!covered) dims.push(make(u0, u1, edge, TOTAL_GAP, 'axisTotal'));
  return dims;
}

/** Axis dimension chains (one per cardinal side) plus a total per side. */
export function deriveDimensions(blocks: DerivedBlock[]): DerivedDimension[] {
  return SIDES.flatMap((s) => sideDimensions(blocks, s));
}

// ---------------------------------------------------------------------------
// Wall unions, bounds
// ---------------------------------------------------------------------------

function wallUnions(walls: DerivedWall[], storeys: DerivedVariant['storeys']): DerivedVariant['wallUnion'] {
  const out: DerivedVariant['wallUnion'] = [];
  for (const s of storeys) {
    for (const status of ['existing', 'new', 'removed'] as const) {
      const fps = walls
        .filter((w) => !w.isDivider && w.status === status && w.footprint.length >= 3 && w.storeyIds.includes(s.id))
        .map((w) => w.footprint);
      if (fps.length > 0) out.push({ storeyId: s.id, status, polygons: unionPolygons(fps) });
    }
  }
  return out;
}

function boundsOf(polys: Vec2[][]): { min: Vec2; max: Vec2 } {
  const pts = polys.flat();
  if (pts.length === 0) return { min: [0, 0], max: [10, 10] };
  return bbox(pts);
}

// ---------------------------------------------------------------------------
// deriveVariant
// ---------------------------------------------------------------------------

function computeVariant(variant: Variant, site: Site, terrain: TerrainAsset | null): DerivedVariant {
  const terrainZ = (x: number, y: number) => terrainZAt(terrain, site, x, y);
  const levels = new Map(variant.levels.map((l) => [l.id, l]));
  const storeys = storeysOf(variant.levels);

  const blocks = deriveBlocks(variant, site, terrain, { terrainZ });
  const { roofs, warnings: roofWarnings } = buildRoofsWithWarnings(variant);
  const undersideAt = (x: number, y: number) => combinedUndersideAt(roofs, x, y);
  const { walls, warnings: wallWarnings } = deriveWalls(variant, blocks, roofs, { undersideAt });
  const { rooms, warnings: roomWarnings } = deriveRooms(variant, storeys, blocks, walls);
  const outdoor = deriveOutdoor(variant, site, terrain, { terrainZ });
  const structure = deriveStructure(variant, roofs, { undersideAt });
  const floors = [...slabFloors(variant, blocks, levels), ...roomFloors(rooms, levels), ...thresholdFloors(walls, rooms, levels)];
  const areas = computeAreas({ variant, blocks, rooms, decks: outdoor.decks, undersideAt, terrainZ });

  const furniture: DerivedFurniture[] = variant.furniture.map((f) => ({
    id: f.id,
    catalogId: f.catalogId,
    position: f.position,
    rotationDeg: f.rotationDeg,
    levelId: f.levelId,
    z: levels.get(f.levelId)?.elevation ?? 0,
    isNew: f.isNew,
  }));

  const warnings: ModelWarning[] = [...deriveBlockWarnings(blocks), ...roofWarnings, ...wallWarnings, ...roomWarnings];
  const limit = variant.settings.areaLimit;
  if (limit !== null && areas.bya.total > limit) warnings.push({ kind: 'area-limit', limit, actual: areas.bya.total });

  const derivedSite: DerivedVariant['site'] = {
    trees: site.trees.map((tree) => ({ tree, baseZ: terrainZ(tree.position[0], tree.position[1]) })),
  };
  if (site.waterLevel !== undefined) derivedSite.waterZ = site.waterLevel - site.floorElevation;

  return {
    variantId: variant.id,
    levels: variant.levels,
    storeys,
    blocks,
    walls,
    wallUnion: wallUnions(walls, storeys),
    rooms,
    floors,
    roofs,
    outdoor,
    structure,
    furniture,
    foundations: blocks
      .filter((db) => db.outer.length >= 3)
      .map((db) => ({ blockId: db.block.id, polygon: db.outer, topZ: db.lowestFloorZ, bottomZ: db.groundZ - FOUNDATION_DEPTH })),
    dimensions: deriveDimensions(blocks),
    site: derivedSite,
    groundWorks: site.groundWorks,
    bounds: boundsOf([...blocks.map((db) => db.outer), ...outdoor.decks.map((d) => d.polygon)]),
    areas,
    warnings,
  };
}

/** Key for a null terrain in the identity memo. */
const NO_TERRAIN = {};
const memo = new WeakMap<Variant, WeakMap<Site, WeakMap<object, DerivedVariant>>>();

/** Derive everything the renderers need from a stored variant (memoised on the argument identities). */
export function deriveVariant(variant: Variant, site: Site, terrain: TerrainAsset | null): DerivedVariant {
  let bySite = memo.get(variant);
  if (!bySite) {
    bySite = new WeakMap();
    memo.set(variant, bySite);
  }
  let byTerrain = bySite.get(site);
  if (!byTerrain) {
    byTerrain = new WeakMap();
    bySite.set(site, byTerrain);
  }
  const key: object = terrain ?? NO_TERRAIN;
  let derived = byTerrain.get(key);
  if (!derived) {
    derived = computeVariant(variant, site, terrain);
    byTerrain.set(key, derived);
  }
  return derived;
}
