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
 *     the 'replace' zones for the base). Stairwells: the footprint of every stair is cut out of all room floors,
 *     thresholds and slabs whose z lies above the stair's bottom and at most at its top (the level stair leaves a
 *     notch / hole in the upper corridor); a floor that falls apart keeps its id for the largest piece, the others
 *     get `/2`, `/3`, …. Where nothing at or below the stair's bottom z covers the footprint, a 'slab' piece
 *     `${stairId}/stairwell` is added at the bottom z (level = the stair's lower level). 'ceiling' per block with
 *     `ceilingHeight`: the inner outline at block level + ceilingHeight + 0.05 (top of a 5 cm ceiling board), id
 *     `${blockId}/ceiling`.
 *  6. Outdoor (`deriveOutdoor`), 7. structure (`deriveStructure`), both with the terrain / underside callbacks.
 *     Terrain: `groundWorks` = the site's ground works plus one implicit cut per block (`gw-<blockId>`: its outer
 *     outline, maxZ = lowestFloorZ − 0.1), applied by EVERY terrain query here (blocks' groundZ, deck skirts, steps,
 *     hot tubs, trees, deck BYA) and by the renderers (`terrainZAt(…, derived.groundWorks)`).
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
 *
 * Robustness: boolean operations that fail on every snap grid (`ClipError`) fall back locally (see polygon.ts,
 * rooms.ts, roof.ts, walls.ts, areas.ts); each fallback taken becomes one 'generic' warning whose message starts
 * with GEOMETRY_FALLBACK (rooms whose inner polygon fell back get one warning naming the room). Each pipeline stage
 * is guarded as a last resort, so a failing operation never throws out of `deriveVariant`.
 */
import type {
  AreaSummary,
  DerivedBlock,
  DerivedDimension,
  DerivedFloor,
  DerivedFurniture,
  DerivedRoom,
  DerivedVariant,
  DerivedWall,
  ModelWarning,
} from '../model/derived';
import type { FloorMaterial, GroundWork, Id, Level, Room, RoomType, Site, TerrainAsset, Variant, Vec2 } from '../model/types';
import { blockPartRegions, computeAreas, partitionRough, splitAreaByParts } from './areas';
import type { PartRegion } from './areas';
import { deriveOutdoor, deriveStructure } from './outdoor';
import {
  area,
  bbox,
  collectClipFallbacks,
  differenceMulti,
  differencePolygons,
  ensureCCW,
  intersectPolygons,
  multiPolygonArea,
  pointInPolygon,
  unionPolygons,
  withClipFallback,
} from './polygon';
import type { MultiPoly } from './polygon';
import { buildRoofsWithWarnings, combinedUndersideAt } from './roof';
import { ROOM_FACE_FALLBACK, detectRooms } from './rooms';
import type { DetectedRoom, WallLine } from './rooms';
import { terrainZAt } from './terrain';
import { blockGroundZ, deriveBlockWarnings, deriveBlocks, deriveWalls } from './walls';

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
/** The implicit ground work under a block cuts the terrain to this far (m) below the block's lowest floor. */
const UNDER_FLOOR = 0.1;
/** Thickness (m) of the derived flat ceiling of a block with `ceilingHeight`. */
const CEILING_THICKNESS = 0.05;
/** Heights closer than this (m) count as equal (stair bottom / top against a floor). */
const Z_EPS = 1e-6;
/** Stairwell floor pieces and floor pieces cut by stairs smaller than this (m²) are dropped. */
const MIN_FLOOR_PIECE = 0.01;
/** Start of the message of every 'generic' warning about a geometry fallback. */
export const GEOMETRY_FALLBACK = 'geometry fallback';

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

/** Existing / new split of a polygon by the parts; on a clipping failure the whole area goes to the part at its label point. */
function splitSafe(polygon: Vec2[], holes: Vec2[][], parts: PartRegion[], where: string): { existing: number; new: number } {
  return withClipFallback(
    where,
    () => splitAreaByParts(polygon, holes, parts),
    () => {
      const rough = partitionRough([[polygon, ...holes]], parts);
      return { existing: multiPolygonArea(rough.existing), new: multiPolygonArea(rough.new) };
    },
  );
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
    const split = splitSafe(det.innerPolygon, det.holes, innerParts, 'existing / new split of a room');
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

  faces.forEach((f, i) => {
    if (f.det.approximate) {
      const name = f.room ? `"${f.room.name}"` : rooms[i].id;
      warnings.push({ kind: 'generic', message: `${GEOMETRY_FALLBACK}: the floor of room ${name} follows the wall axes (polygon clipping failed)` });
    }
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

/** A stair as a vertical cut through the floors: footprint, bottom and top z, bottom level. */
interface StairCut {
  id: Id;
  footprint: Vec2[];
  bottomLevelId: Id;
  bottomZ: number;
  topZ: number;
  isNew: boolean;
}

function stairCuts(variant: Variant, levels: Map<Id, Level>): StairCut[] {
  const out: StairCut[] = [];
  for (const s of variant.structure) {
    if (s.kind !== 'stair') continue;
    const x0 = Math.min(s.min[0], s.max[0]);
    const x1 = Math.max(s.min[0], s.max[0]);
    const y0 = Math.min(s.min[1], s.max[1]);
    const y1 = Math.max(s.min[1], s.max[1]);
    if (!((x1 - x0) * (y1 - y0) > 1e-6)) continue;
    const fromZ = levels.get(s.fromLevelId)?.elevation ?? 0;
    const toZ = levels.get(s.toLevelId)?.elevation ?? 0;
    out.push({
      id: s.id,
      footprint: [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      bottomLevelId: fromZ <= toZ ? s.fromLevelId : s.toLevelId,
      bottomZ: Math.min(fromZ, toZ),
      topZ: Math.max(fromZ, toZ),
      isNew: s.isNew,
    });
  }
  return out;
}

function boxesOverlap(a: { min: Vec2; max: Vec2 }, b: { min: Vec2; max: Vec2 }): boolean {
  return a.min[0] < b.max[0] && b.min[0] < a.max[0] && a.min[1] < b.max[1] && b.min[1] < a.max[1];
}

/** Stairs passing through a floor at z (bottom < z ≤ top) whose footprint box overlaps the polygon's box. */
function cutsThrough(cuts: StairCut[], z: number, polygon: Vec2[]): StairCut[] {
  const box = bbox(polygon);
  return cuts.filter((c) => z > c.bottomZ + Z_EPS && z <= c.topZ + Z_EPS && boxesOverlap(box, bbox(c.footprint)));
}

/** Pieces of a region minus the stair footprints, largest first (the region itself when the clipping fails). */
function minusStairs(region: MultiPoly, cuts: StairCut[]): MultiPoly {
  if (cuts.length === 0) return region;
  const pieces = withClipFallback('stairwell cut-out', () => differenceMulti(region, ...cuts.map((c): MultiPoly => [[c.footprint]])), () => region);
  return pieces.filter((p) => p.length > 0 && p[0].length >= 3).sort((a, b) => area(b[0]) - area(a[0]));
}

/** A room floor or threshold with the stairs passing through it cut out (one floor per remaining piece). */
function cutFloor(floor: DerivedFloor, cuts: StairCut[]): DerivedFloor[] {
  const through = cutsThrough(cuts, floor.z, floor.polygon);
  if (through.length === 0) return [floor];
  return minusStairs([[floor.polygon, ...floor.holes]], through)
    .filter((p) => multiPolygonArea([p]) >= MIN_FLOOR_PIECE)
    .map((p, i) => ({ ...floor, id: i === 0 ? floor.id : `${floor.id}/${i + 1}`, polygon: ensureCCW(p[0]), holes: p.slice(1) }));
}

function slabFloors(blocks: DerivedBlock[], levels: Map<Id, Level>, cuts: StairCut[]): DerivedFloor[] {
  const floors: DerivedFloor[] = [];
  const innerParts = blockPartRegions(blocks, 'inner');
  const push = (baseId: string, levelId: Id, region: Vec2[][][]) => {
    const level = levels.get(levelId);
    if (!level || !(level.floorThickness > 0)) return;
    const outers = region.map((p) => p[0]).filter((r): r is Vec2[] => r !== undefined && r.length >= 3);
    if (outers.length === 0) return;
    const through = cuts.filter((c) => level.elevation > c.bottomZ + Z_EPS && level.elevation <= c.topZ + Z_EPS);
    const pieces = through.length === 0 ? outers.map((o): Vec2[][] => [o]) : minusStairs(outers.map((o): Vec2[][] => [o]), through);
    pieces.forEach((poly, i) => {
      if (poly.length === 0 || area(poly[0]) < 1e-6) return;
      const outer = ensureCCW(poly[0]);
      const holes = poly.slice(1);
      const split = splitSafe(outer, holes, innerParts, 'existing / new split of a floor');
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
    const base =
      replaced.length > 0
        ? withClipFallback('slab of a block', () => differencePolygons([db.inner], replaced), () => [[db.inner]])
        : [[db.inner]];
    push(`${db.block.id}/base`, db.block.levelId, base);
    const seen = new Map<Id, number>();
    for (const z of db.zones) {
      if (z.polygon.length < 3) continue;
      const k = (seen.get(z.zoneId) ?? 0) + 1;
      seen.set(z.zoneId, k);
      const region = withClipFallback('slab of a floor zone', () => intersectPolygons([z.polygon], [db.inner]), () => [[z.polygon]]);
      push(`${db.block.id}/${z.zoneId}${k > 1 ? `#${k}` : ''}`, z.levelId, region);
    }
  }
  return floors;
}

/** Floor at the bottom of every stair where nothing at or below that z covers its footprint. */
function stairwellFloors(cuts: StairCut[], floors: DerivedFloor[], levels: Map<Id, Level>): DerivedFloor[] {
  const out: DerivedFloor[] = [];
  for (const c of cuts) {
    const box = bbox(c.footprint);
    const below = floors.filter((f) => f.kind !== 'ceiling' && f.z <= c.bottomZ + Z_EPS && f.polygon.length >= 3 && boxesOverlap(box, bbox(f.polygon)));
    const open = withClipFallback(
      'stairwell floor',
      () => (below.length === 0 ? [[c.footprint]] : differenceMulti([[c.footprint]], ...below.map((f): MultiPoly => [[f.polygon, ...f.holes]]))),
      () => [],
    );
    const pieces = open.filter((p) => p.length > 0 && p[0].length >= 3 && multiPolygonArea([p]) >= MIN_FLOOR_PIECE).sort((a, b) => area(b[0]) - area(a[0]));
    pieces.forEach((p, i) => {
      out.push({
        id: i === 0 ? `${c.id}/stairwell` : `${c.id}/stairwell/${i + 1}`,
        levelId: c.bottomLevelId,
        polygon: ensureCCW(p[0]),
        holes: p.slice(1),
        z: c.bottomZ,
        thickness: levels.get(c.bottomLevelId)?.floorThickness ?? 0,
        material: 'wood',
        isNew: c.isNew,
        kind: 'slab',
      });
    });
  }
  return out;
}

/** Flat ceiling of every block with `ceilingHeight` (top of the ceiling board). */
function ceilingFloors(blocks: DerivedBlock[], levels: Map<Id, Level>): DerivedFloor[] {
  const out: DerivedFloor[] = [];
  for (const db of blocks) {
    const h = db.block.ceilingHeight;
    if (h === undefined || !Number.isFinite(h) || db.inner.length < 3) continue;
    out.push({
      id: `${db.block.id}/ceiling`,
      levelId: db.block.levelId,
      polygon: ensureCCW(db.inner),
      holes: [],
      z: (levels.get(db.block.levelId)?.elevation ?? 0) + h + CEILING_THICKNESS,
      thickness: CEILING_THICKNESS,
      material: 'wood',
      isNew: db.block.isNew,
      kind: 'ceiling',
    });
  }
  return out;
}

/** Step 5: slabs, room floors, thresholds (stairwells cut out), stairwell floors, block ceilings. */
function deriveFloors(variant: Variant, blocks: DerivedBlock[], walls: DerivedWall[], rooms: DerivedRoom[], levels: Map<Id, Level>): DerivedFloor[] {
  const cuts = stairCuts(variant, levels);
  const floors = [
    ...slabFloors(blocks, levels, cuts),
    ...roomFloors(rooms, levels).flatMap((f) => cutFloor(f, cuts)),
    ...thresholdFloors(walls, rooms, levels).flatMap((f) => cutFloor(f, cuts)),
  ];
  return [...floors, ...stairwellFloors(cuts, floors, levels), ...ceilingFloors(blocks, levels)];
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
      if (fps.length === 0) continue;
      const polygons = withClipFallback('wall outlines', () => unionPolygons(fps), () => fps.map((f) => [ensureCCW(f)]));
      out.push({ storeyId: s.id, status, polygons });
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

/** One implicit cut per block: its outer outline (axis without one), maxZ = lowest floor − 0.1. */
export function blockGroundWorks(blocks: DerivedBlock[]): GroundWork[] {
  const out: GroundWork[] = [];
  for (const db of blocks) {
    const polygon = db.outer.length >= 3 ? db.outer : db.axis;
    if (polygon.length < 3) continue;
    out.push({ id: `gw-${db.block.id}`, polygon: polygon.map((p): Vec2 => [p[0], p[1]]), maxZ: db.lowestFloorZ - UNDER_FLOOR });
  }
  return out;
}

function emptyAreas(): AreaSummary {
  const zero = { total: 0, existing: 0, new: 0 };
  return { bya: { ...zero, buildings: 0, decks: 0, perBlock: [] }, bra: { ...zero, perLevel: [] }, axis: { ...zero }, rooms: [] };
}

function computeParts(variant: Variant, site: Site, terrain: TerrainAsset | null): DerivedVariant {
  const levels = new Map(variant.levels.map((l) => [l.id, l]));
  const storeys = storeysOf(variant.levels);
  const stage = <T>(name: string, fn: () => T, fallback: () => T): T => withClipFallback(`${name} (stage)`, fn, fallback);

  // Outlines do not depend on the terrain: blocks first, then the implicit cuts under them, then their ground height.
  const outlines = deriveBlocks(variant, site, terrain, { terrainZ: () => 0 });
  const implicit = blockGroundWorks(outlines);
  const terrainZ = (x: number, y: number) => terrainZAt(terrain, site, x, y, implicit);
  const blocks = outlines.map((db) => ({ ...db, groundZ: blockGroundZ(db, terrainZ) }));

  const { roofs, warnings: roofWarnings } = stage('roofs', () => buildRoofsWithWarnings(variant), () => ({ roofs: [], warnings: [] }));
  const undersideAt = (x: number, y: number) => combinedUndersideAt(roofs, x, y);
  const { walls, warnings: wallWarnings } = stage('walls', () => deriveWalls(variant, blocks, roofs, { undersideAt }), () => ({ walls: [], warnings: [] }));
  const { rooms, warnings: roomWarnings } = stage('rooms', () => deriveRooms(variant, storeys, blocks, walls), () => ({ rooms: [], warnings: [] }));
  const outdoor = deriveOutdoor(variant, site, terrain, { terrainZ });
  const structure = deriveStructure(variant, roofs, { undersideAt });
  const floors = stage('floors', () => deriveFloors(variant, blocks, walls, rooms, levels), () => []);
  const areas = stage('areas', () => computeAreas({ variant, blocks, rooms, decks: outdoor.decks, undersideAt, terrainZ, roofs }), emptyAreas);

  const furniture: DerivedFurniture[] = variant.furniture.map((f) => ({
    id: f.id,
    catalogId: f.catalogId,
    position: f.position,
    rotationDeg: f.rotationDeg,
    levelId: f.levelId,
    z: levels.get(f.levelId)?.elevation ?? 0,
    isNew: f.isNew,
  }));

  const blockWarnings = stage('block checks', () => deriveBlockWarnings(blocks), () => []);
  const warnings: ModelWarning[] = [...blockWarnings, ...roofWarnings, ...wallWarnings, ...roomWarnings];
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
    groundWorks: [...site.groundWorks, ...implicit],
    bounds: boundsOf([...blocks.map((db) => db.outer), ...outdoor.decks.map((d) => d.polygon)]),
    areas,
    warnings,
  };
}

function computeVariant(variant: Variant, site: Site, terrain: TerrainAsset | null): DerivedVariant {
  const { result, fallbacks } = collectClipFallbacks(() => computeParts(variant, site, terrain));
  const seen = new Set<string>();
  for (const f of fallbacks) {
    if (f.where === ROOM_FACE_FALLBACK || seen.has(f.where)) continue;
    seen.add(f.where);
    result.warnings.push({ kind: 'generic', message: `${GEOMETRY_FALLBACK}: ${f.where} (polygon clipping failed)` });
  }
  return result;
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
