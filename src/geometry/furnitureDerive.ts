/**
 * Furniture derive stage (docs/phase2-plan.md §4, revision 2 rules): `deriveFurniture(items, ctx)` turns the stored
 * `FurnitureItem`s into `DerivedFurniture` with catalogue data, footprints, level / room / floor resolution,
 * clearances, collisions and warnings. Pure; derive.ts runs it as the furniture stage, memoised on the building,
 * opening and outdoor stages and `variant.furniture` (a furniture-only edit reuses everything else).
 *
 * Frame (see furniture/catalog.ts): w along the item's local x, d along local y, back edge at local +y; rotationDeg
 * turns CCW about `position`. The footprint is the w × d rectangle; an L-shaped corner sofa collides with its two
 * parts only (`localParts`).
 *
 * Level, room, floor:
 *  - The item belongs to the storey of its stored `levelId`. `roomId` is the derived room of that storey whose inner
 *    polygon (minus holes) contains the item's centre. The derived `levelId` is that room's level (geometry wins, as
 *    for rooms: a bed dragged from Korridor (øvre) into Soverom 1 stands on 'lower' even before its stored level is
 *    updated); without a room it is the stored level.
 *  - Without a room (the centre in a wall or a doorway) the level is the storey's floor under the centre
 *    (`locateLevel`); outside the building it is the stored level.
 *  - `floorZ`: that level's elevation; else the top of the deck under the centre; else, inside a block (a loft item
 *    over the stairwell), the stored level's elevation; else the terrain there. `z` = floorZ + the catalogue
 *    `elevation`.
 *
 * Collisions (tolerance 5 mm: shapes that only touch, or overlap by at most 5 mm, do not collide; separating-axis
 * tests on convex pieces, never polygon clipping):
 *  - 'flat' items (rugs, drains) never collide with anything and never block a door;
 *  - furniture ↔ furniture: same derived level, z ranges [z, z + h] overlapping; a seat (SEATING: stol, utestol)
 *    pulled in under a table (TABLES: spisebord-*, utebord, salongbord, kjokkenoy) is no collision while its centre is
 *    at most TUCK_DEPTH_M inside the table's edge and part of it is still outside the table (`tuckedUnder`);
 *  - furniture ↔ walls: non-ghost, non-divider walls whose `levelIds` include the item's level. A wall is solid except
 *    in its doors and windows that the item fits through vertically (sill at or below the item's bottom, head at or
 *    above its top): a rug or a chair in a doorway is not "in the wall", a cabinet under a window is;
 *  - furniture ↔ structure: posts, the chimney and stairs (z ranges overlapping), and hot tubs; beams are ignored;
 *  - doors: the swing sector(s) (each arc as 8 segments) of every non-ghost door on the item's level whose
 *    [sill, head] overlaps the item's z range. → `blocksDoors`, 'door-blocked'.
 * `collisions` lists the ids of everything the item collides with (other furniture, walls, structure, hot tubs), so
 * renderers can tint it red when `collisions` or `blocksDoors` is non-empty.
 *
 * Warnings (in item order): 'furniture-unknown' (unknown catalogue id: a plain box of its size, no clearances),
 * 'furniture-outside' (an indoor entry whose centre is on no floor of its storey and on no deck), 'furniture-needs-wet-room'
 * (needsDrain outside bad / wc / teknisk / badstue / kjokken), 'furniture-in-wall' (the first wall, structure
 * element or hot tub the item stands in; `wallId` is that id), then 'furniture-overlap' per colliding pair and
 * 'door-blocked' per door and item (`by` = the furniture id).
 */
import type {
  DerivedBlock,
  DerivedDeck,
  DerivedFurniture,
  DerivedHotTub,
  DerivedRoom,
  DerivedStructure,
  DerivedVariant,
  DerivedWall,
  ModelWarning,
} from '../model/derived';
import type { FurnitureItem, Id, Level, Vec2 } from '../model/types';
import { WET_ROOM_TYPES, catalogItem, isIndoor, localClearances, localParts } from '../furniture/catalog';
import type { FurnitureCatalogItem, LocalRect } from '../furniture/catalog';
import { locateLevel } from './levels';
import { pointInPolygon } from './polygon';

/** Overlaps up to this (m) do not count as a collision (touching items, a back snapped onto a wall face). */
export const COLLISION_TOLERANCE = 0.005;
/** Seats that may be pulled in under a table (see the header). */
export const SEATING: ReadonlySet<string> = new Set(['stol', 'utestol']);
/** Tables a seat may be pulled in under. */
export const TABLES: ReadonlySet<string> = new Set(['spisebord-4', 'spisebord-6', 'spisebord-8', 'utebord', 'salongbord', 'kjokkenoy']);
/** How far (m) inside a table's edge a pulled-in seat's centre may be. */
export const TUCK_DEPTH_M = 0.25;
/** Segments per door swing arc. */
const ARC_SEGMENTS = 8;
/** Segments of a hot tub's circle. */
const TUB_SEGMENTS = 16;

/** What the furniture stage reads from the other stages. */
export interface FurnitureContext {
  levels: Level[];
  storeys: DerivedVariant['storeys'];
  rooms: DerivedRoom[];
  /** Walls WITH their openings (the opening stage's walls). */
  walls: DerivedWall[];
  blocks: DerivedBlock[];
  structure: DerivedStructure[];
  decks: DerivedDeck[];
  hotTubs: DerivedHotTub[];
  /** Terrain after ground works, relative to the main floor. */
  terrainZ: (x: number, y: number) => number;
}

// ---------------------------------------------------------------------------
// Local frame
// ---------------------------------------------------------------------------

type Placed = Pick<FurnitureItem, 'position' | 'rotationDeg'>;

/** Plan point of the local point (u, v) of an item (u along w, v along d, back at +v). */
export function localToPlan(item: Placed, u: number, v: number): Vec2 {
  const t = (item.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [item.position[0] + u * c - v * s, item.position[1] + u * s + v * c];
}

/** Local coordinates of a plan point. */
export function planToLocal(item: Placed, p: Vec2): Vec2 {
  const t = (item.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const dx = p[0] - item.position[0];
  const dy = p[1] - item.position[1];
  return [dx * c + dy * s, -dx * s + dy * c];
}

const sizeOf = (item: FurnitureItem): { w: number; d: number; h: number } => ({
  w: item.size?.w ?? 1,
  d: item.size?.d ?? 1,
  h: item.size?.h ?? 1,
});

function rectToPlan(item: Placed, r: LocalRect): Vec2[] {
  return [localToPlan(item, r.x0, r.y0), localToPlan(item, r.x1, r.y0), localToPlan(item, r.x1, r.y1), localToPlan(item, r.x0, r.y1)];
}

/** The item's size rectangle (w along its local x, d along local y) rotated by rotationDeg (CCW) about its position. */
export function furnitureFootprint(item: FurnitureItem): Vec2[] {
  const { w, d } = sizeOf(item);
  return rectToPlan(item, { x0: -w / 2, y0: -d / 2, x1: w / 2, y1: d / 2 });
}

/** The back edge (local +y side) from its local −x end to its +x end. */
export function backEdge(item: FurnitureItem): [Vec2, Vec2] {
  const { w, d } = sizeOf(item);
  return [localToPlan(item, -w / 2, d / 2), localToPlan(item, w / 2, d / 2)];
}

/** The convex solid parts of an item in plan (one rectangle, two for an L-shaped sofa). */
export function furnitureParts(item: FurnitureItem, catalog: FurnitureCatalogItem | null = catalogItem(item.catalogId)): Vec2[][] {
  return localParts(catalog, sizeOf(item)).map((r) => rectToPlan(item, r));
}

// ---------------------------------------------------------------------------
// Convex geometry (separating axes)
// ---------------------------------------------------------------------------

interface Box {
  min: Vec2;
  max: Vec2;
}

function boxOf(polys: Vec2[][]): Box {
  const min: Vec2 = [Infinity, Infinity];
  const max: Vec2 = [-Infinity, -Infinity];
  for (const poly of polys) {
    for (const [x, y] of poly) {
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
    }
  }
  return { min, max };
}

/** Boxes overlapping by more than `tol` on both axes. */
function boxesOverlap(a: Box, b: Box, tol: number): boolean {
  return Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]) > tol && Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]) > tol;
}

function projectOn(poly: Vec2[], ax: number, ay: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, y] of poly) {
    const t = x * ax + y * ay;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  return [lo, hi];
}

/**
 * Whether two convex polygons overlap by more than `tol` (separating-axis test on both polygons' edge normals): the
 * overlap of their projections exceeds `tol` on every axis.
 */
export function convexOverlap(a: Vec2[], b: Vec2[], tol: number = COLLISION_TOLERANCE): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const ex = q[0] - p[0];
      const ey = q[1] - p[1];
      const len = Math.hypot(ex, ey);
      if (len < 1e-12) continue;
      const ax = -ey / len;
      const ay = ex / len;
      const [a0, a1] = projectOn(a, ax, ay);
      const [b0, b1] = projectOn(b, ax, ay);
      if (Math.min(a1, b1) - Math.max(a0, b0) <= tol) return false;
    }
  }
  return true;
}

/** Any pair of convex pieces overlapping by more than `tol`. */
function piecesOverlap(a: Vec2[][], b: Vec2[][], tol: number): boolean {
  for (const pa of a) for (const pb of b) if (convexOverlap(pa, pb, tol)) return true;
  return false;
}

const cross3 = (o: Vec2, a: Vec2, b: Vec2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function signedArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - a[1] * b[0];
  }
  return s / 2;
}

/** The polygon CCW without (nearly) collinear or duplicate vertices. */
function cleanCCW(poly: Vec2[]): Vec2[] {
  let pts = signedArea(poly) < 0 ? [...poly].reverse() : [...poly];
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const next = pts[(i + 1) % pts.length];
      if (Math.abs(cross3(prev, pts[i], next)) < 1e-12) {
        pts = pts.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

function isConvexCCW(pts: Vec2[]): boolean {
  for (let i = 0; i < pts.length; i++) {
    if (cross3(pts[i], pts[(i + 1) % pts.length], pts[(i + 2) % pts.length]) < -1e-12) return false;
  }
  return true;
}

function inTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  return cross3(a, b, p) >= -1e-12 && cross3(b, c, p) >= -1e-12 && cross3(c, a, p) >= -1e-12;
}

/** Convex pieces of a simple polygon: itself when convex, else an ear-clipping triangulation. */
export function convexPieces(poly: Vec2[]): Vec2[][] {
  if (poly.length < 3) return [];
  const pts = cleanCCW(poly);
  if (pts.length < 3) return [];
  if (isConvexCCW(pts)) return [pts];
  const idx = pts.map((_, i) => i);
  const out: Vec2[][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10_000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const a = pts[idx[(k - 1 + idx.length) % idx.length]];
      const b = pts[idx[k]];
      const c = pts[idx[(k + 1) % idx.length]];
      if (cross3(a, b, c) <= 1e-12) continue;
      const blocked = idx.some((j, m) => m !== k && m !== (k - 1 + idx.length) % idx.length && m !== (k + 1) % idx.length && inTriangle(pts[j], a, b, c));
      if (blocked) continue;
      out.push([a, b, c]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx.map((i) => pts[i]));
  return out;
}

/** A convex polygon clipped to the slab lo ≤ dot(p − o, u) ≤ hi (either bound may be infinite). */
function clipToSlab(poly: Vec2[], o: Vec2, u: Vec2, lo: number, hi: number): Vec2[] {
  const s = (p: Vec2) => (p[0] - o[0]) * u[0] + (p[1] - o[1]) * u[1];
  const clip = (pts: Vec2[], keep: (v: number) => number): Vec2[] => {
    // keep(v) >= 0 inside.
    const out: Vec2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const fp = keep(s(p));
      const fq = keep(s(q));
      if (fp >= 0) out.push(p);
      if ((fp >= 0) !== (fq >= 0)) {
        const t = fp / (fp - fq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    return out;
  };
  let pts = poly;
  if (Number.isFinite(lo)) pts = clip(pts, (v) => v - lo);
  if (pts.length >= 3 && Number.isFinite(hi)) pts = clip(pts, (v) => hi - v);
  return pts.length >= 3 ? pts : [];
}

function circlePoly(c: Vec2, r: number, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return out;
}

/** A door swing sector (hinge, closed leaf end, open leaf end, sweep direction) as a convex polygon. */
export function swingSector(sw: { hinge: Vec2; closed: Vec2; open: Vec2; sweep: 1 | -1 }, segments: number = ARC_SEGMENTS): Vec2[] {
  const r = Math.hypot(sw.closed[0] - sw.hinge[0], sw.closed[1] - sw.hinge[1]);
  if (r < 1e-9) return [];
  const a0 = Math.atan2(sw.closed[1] - sw.hinge[1], sw.closed[0] - sw.hinge[0]);
  const a1 = Math.atan2(sw.open[1] - sw.hinge[1], sw.open[0] - sw.hinge[0]);
  let delta = a1 - a0;
  if (sw.sweep > 0) while (delta <= 0) delta += 2 * Math.PI;
  else while (delta >= 0) delta -= 2 * Math.PI;
  const pts: Vec2[] = [sw.hinge];
  for (let k = 0; k <= segments; k++) {
    const a = a0 + (delta * k) / segments;
    pts.push([sw.hinge[0] + r * Math.cos(a), sw.hinge[1] + r * Math.sin(a)]);
  }
  return sw.sweep > 0 ? pts : pts.reverse();
}

const zOverlap = (a0: number, a1: number, b0: number, b1: number, tol: number) => Math.min(a1, b1) - Math.max(a0, b0) > tol;

function inPolygonWithHoles(p: Vec2, outer: Vec2[], holes: Vec2[][]): boolean {
  return pointInPolygon(p, outer) && !holes.some((h) => h.length >= 3 && pointInPolygon(p, h));
}

function onDeck(p: Vec2, deck: DerivedDeck): boolean {
  return deck.pieces.some((piece) => piece.length > 0 && piece[0].length >= 3 && inPolygonWithHoles(p, piece[0], piece.slice(1)));
}

// ---------------------------------------------------------------------------
// Static obstacles (walls, structure, hot tubs), cached per derived object
// ---------------------------------------------------------------------------

const wallPiecesCache = new WeakMap<DerivedWall, { pieces: Vec2[][]; box: Box }>();

function wallSolid(w: DerivedWall): { pieces: Vec2[][]; box: Box } {
  let hit = wallPiecesCache.get(w);
  if (!hit) {
    const pieces = convexPieces(w.footprint);
    hit = { pieces, box: boxOf(pieces) };
    wallPiecesCache.set(w, hit);
  }
  return hit;
}

/** The wall's convex pieces that are solid for an item spanning [z0, z1] (doors / windows it fits through cut out). */
function solidPieces(w: DerivedWall, pieces: Vec2[][], z0: number, z1: number, tol: number): Vec2[][] {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  if (len < 1e-9) return pieces;
  const u: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
  const gaps: [number, number][] = [];
  for (const o of w.openings) {
    if (o.isGhost || o.footprint.length < 3) continue;
    if (o.sillZ > z0 + tol || o.headZ < z1 - tol) continue;
    gaps.push([o.offset - o.width / 2, o.offset + o.width / 2]);
  }
  if (gaps.length === 0) return pieces;
  gaps.sort((a, b) => a[0] - b[0]);
  const solids: [number, number][] = [];
  let from = -Infinity;
  for (const [g0, g1] of gaps) {
    if (g0 > from) solids.push([from, g0]);
    from = Math.max(from, g1);
  }
  solids.push([from, Infinity]);
  const out: Vec2[][] = [];
  for (const piece of pieces) {
    for (const [lo, hi] of solids) {
      const c = clipToSlab(piece, w.a, u, lo, hi);
      if (c.length >= 3) out.push(c);
    }
  }
  return out;
}

interface Obstacle {
  id: Id;
  polys: Vec2[][];
  box: Box;
  z0: number;
  z1: number;
}

function structureObstacles(structure: DerivedStructure[], hotTubs: DerivedHotTub[]): Obstacle[] {
  const out: Obstacle[] = [];
  for (const s of structure) {
    let poly: Vec2[] | null = null;
    let z0 = 0;
    let z1 = 0;
    if (s.kind === 'post') {
      const h = s.size / 2;
      const [x, y] = s.position;
      poly = [
        [x - h, y - h],
        [x + h, y - h],
        [x + h, y + h],
        [x - h, y + h],
      ];
      z0 = s.bottomZ;
      z1 = s.topZ;
    } else if (s.kind === 'chimney') {
      poly = [
        [s.min[0], s.min[1]],
        [s.max[0], s.min[1]],
        [s.max[0], s.max[1]],
        [s.min[0], s.max[1]],
      ];
      z0 = s.bottomZ;
      z1 = s.topZ;
    } else if (s.kind === 'stair') {
      poly = s.footprint;
      z0 = Math.min(s.fromZ, s.toZ);
      z1 = Math.max(s.fromZ, s.toZ);
    }
    if (!poly || poly.length < 3) continue;
    const polys = convexPieces(poly);
    out.push({ id: s.id, polys, box: boxOf(polys), z0, z1 });
  }
  for (const t of hotTubs) {
    const polys = [circlePoly(t.centre, t.diameter / 2, TUB_SEGMENTS)];
    out.push({ id: t.id, polys, box: boxOf(polys), z0: t.baseZ, z1: t.rimZ });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

interface Work {
  df: DerivedFurniture;
  catalog: FurnitureCatalogItem | null;
  parts: Vec2[][];
  box: Box;
  z0: number;
  z1: number;
  flat: boolean;
  /** First wall / structure / hot tub hit (for 'furniture-in-wall'). */
  inWall?: Id;
  /** In a room, on a floor of its storey (a wall, a doorway) or on a deck. */
  inside: boolean;
}

/** The furniture stage (see the header). */
export function deriveFurniture(items: FurnitureItem[], ctx: FurnitureContext): { furniture: DerivedFurniture[]; warnings: ModelWarning[] } {
  const tol = COLLISION_TOLERANCE;
  const levels = new Map(ctx.levels.map((l) => [l.id, l]));
  const work: Work[] = items.map((item) => {
    const catalog = catalogItem(item.catalogId);
    const level = levels.get(item.levelId);
    const storeyId = level?.storeyId ?? ctx.storeys[0]?.id;
    const p = item.position;
    const room = ctx.rooms.find((r) => r.storeyId === storeyId && r.polygon.length >= 3 && inPolygonWithHoles(p, r.polygon, r.holes));
    // No room: a floor of the storey under the centre (a wall, a doorway), else the deck, else the terrain.
    const located = room ? null : locateLevel(p, new Set(ctx.storeys.find((st) => st.id === storeyId)?.levelIds ?? []), ctx.blocks);
    const deck = room || located ? undefined : ctx.decks.find((d) => onDeck(p, d));
    const levelId = room?.levelId ?? located?.levelId ?? item.levelId;
    let floorZ: number;
    if (room || located) floorZ = levels.get(levelId)?.elevation ?? 0;
    else if (deck) floorZ = deck.topZ;
    // Inside the building but on no floor of its storey (a loft item over the stairwell): its stored level.
    else if (ctx.blocks.some((b) => b.axis.length >= 3 && pointInPolygon(p, b.axis))) floorZ = level?.elevation ?? 0;
    else floorZ = ctx.terrainZ(p[0], p[1]);
    const sz = sizeOf(item);
    const z = floorZ + (catalog?.elevation ?? 0);
    const footprint = furnitureFootprint(item);
    const parts = furnitureParts(item, catalog);
    const bbox = boxOf([footprint]);
    const df: DerivedFurniture = {
      id: item.id,
      item,
      catalog,
      footprint,
      bbox: { min: [bbox.min[0], bbox.min[1]], max: [bbox.max[0], bbox.max[1]] },
      levelId,
      floorZ,
      z,
      clearances: localClearances(catalog, sz).map((r) => rectToPlan(item, r)),
      collisions: [],
      blocksDoors: [],
      needsDrain: catalog?.needsDrain === true,
      isNew: item.isNew,
    };
    if (room) df.roomId = room.id;
    return { df, catalog, parts, box: boxOf(parts), z0: z, z1: z + sz.h, flat: catalog?.mount === 'flat', inside: room !== undefined || located !== null || deck !== undefined };
  });

  // Walls (with the doors / windows the item fits through cut out), structure, hot tubs.
  const walls = ctx.walls.filter((w) => !w.isGhost && !w.isDivider && w.footprint.length >= 3);
  const obstacles = structureObstacles(ctx.structure, ctx.hotTubs);
  for (const it of work) {
    if (it.flat) continue;
    for (const w of walls) {
      if (!w.levelIds.includes(it.df.levelId)) continue;
      const solid = wallSolid(w);
      if (!boxesOverlap(it.box, solid.box, tol)) continue;
      if (piecesOverlap(it.parts, solidPieces(w, solid.pieces, it.z0, it.z1, tol), tol)) {
        it.df.collisions.push(w.id);
        it.inWall ??= w.id;
      }
    }
    for (const o of obstacles) {
      if (!zOverlap(it.z0, it.z1, o.z0, o.z1, tol) || !boxesOverlap(it.box, o.box, tol)) continue;
      if (piecesOverlap(it.parts, o.polys, tol)) {
        it.df.collisions.push(o.id);
        it.inWall ??= o.id;
      }
    }
  }

  // Furniture against furniture.
  const overlaps: [Id, Id][] = [];
  for (let i = 0; i < work.length; i++) {
    const a = work[i];
    if (a.flat) continue;
    for (let j = i + 1; j < work.length; j++) {
      const b = work[j];
      if (b.flat || a.df.levelId !== b.df.levelId) continue;
      if (!zOverlap(a.z0, a.z1, b.z0, b.z1, tol) || !boxesOverlap(a.box, b.box, tol)) continue;
      if (!piecesOverlap(a.parts, b.parts, tol)) continue;
      if (tuckedUnder(a.df.item, b.df.item) || tuckedUnder(b.df.item, a.df.item)) continue;
      a.df.collisions.push(b.df.id);
      b.df.collisions.push(a.df.id);
      overlaps.push([a.df.id, b.df.id]);
    }
  }

  // Door swings.
  const blocked: { openingId: Id; by: Id }[] = [];
  for (const w of ctx.walls) {
    if (w.isGhost) continue;
    for (const o of w.openings) {
      if (o.isGhost || (!o.swing && !o.swing2)) continue;
      const sectors = [o.swing, o.swing2].filter((s) => s !== undefined).map((s) => swingSector(s));
      const sbox = boxOf(sectors);
      for (const it of work) {
        if (it.flat || it.df.levelId !== o.levelId) continue;
        if (!zOverlap(it.z0, it.z1, o.sillZ, o.headZ, tol) || !boxesOverlap(it.box, sbox, tol)) continue;
        if (!piecesOverlap(it.parts, sectors, tol)) continue;
        if (!it.df.blocksDoors.includes(o.id)) {
          it.df.blocksDoors.push(o.id);
          blocked.push({ openingId: o.id, by: it.df.id });
        }
      }
    }
  }

  const warnings: ModelWarning[] = [];
  for (const it of work) {
    const { df, catalog } = it;
    if (!catalog) {
      warnings.push({ kind: 'furniture-unknown', furnitureId: df.id, catalogId: df.item.catalogId });
    } else {
      if (isIndoor(catalog) && !it.inside) warnings.push({ kind: 'furniture-outside', furnitureId: df.id });
      if (catalog.needsDrain) {
        const room = df.roomId === undefined ? undefined : ctx.rooms.find((r) => r.id === df.roomId);
        const type = room?.room?.type;
        if (!type || !WET_ROOM_TYPES.has(type)) {
          warnings.push(
            df.roomId === undefined
              ? { kind: 'furniture-needs-wet-room', furnitureId: df.id }
              : { kind: 'furniture-needs-wet-room', furnitureId: df.id, roomId: df.roomId },
          );
        }
      }
    }
    if (it.inWall) warnings.push({ kind: 'furniture-in-wall', furnitureId: df.id, wallId: it.inWall });
  }
  for (const pair of overlaps) warnings.push({ kind: 'furniture-overlap', furnitureIds: pair });
  for (const b of blocked) warnings.push({ kind: 'door-blocked', openingId: b.openingId, by: b.by });
  return { furniture: work.map((w) => w.df), warnings };
}

/**
 * A seat pulled in under a table (see the header): `seat` is SEATING, `table` is one of TABLES, the seat's centre is
 * at most TUCK_DEPTH_M inside the table's rectangle, and the seat is not wholly inside it.
 */
export function tuckedUnder(seat: FurnitureItem, table: FurnitureItem): boolean {
  if (!SEATING.has(seat.catalogId) || !TABLES.has(table.catalogId)) return false;
  const t = sizeOf(table);
  const [u, v] = planToLocal(table, seat.position);
  // Depth of the seat's centre inside the table's edge (negative: outside).
  const depth = Math.min(t.w / 2 - Math.abs(u), t.d / 2 - Math.abs(v));
  if (depth > TUCK_DEPTH_M + 1e-9) return false;
  const tol = COLLISION_TOLERANCE;
  const inside = furnitureFootprint(seat).every((p) => {
    const [pu, pv] = planToLocal(table, p);
    return Math.abs(pu) <= t.w / 2 + tol && Math.abs(pv) <= t.d / 2 + tol;
  });
  return !inside;
}

const sameIds = (a: Id[], b: Id[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Same derived item: the same stored item and catalogue entry, and equal resolution and collisions. */
function sameDerived(a: DerivedFurniture, b: DerivedFurniture): boolean {
  return (
    a.item === b.item &&
    a.catalog === b.catalog &&
    a.levelId === b.levelId &&
    a.roomId === b.roomId &&
    a.floorZ === b.floorZ &&
    a.z === b.z &&
    a.needsDrain === b.needsDrain &&
    a.isNew === b.isNew &&
    sameIds(a.collisions, b.collisions) &&
    sameIds(a.blocksDoors, b.blocksDoors)
  );
}

/** Recent derived objects per stored item (a few, newest first), for `shareUnchanged`. */
const recentDerived = new WeakMap<FurnitureItem, DerivedFurniture[]>();
const RECENT = 4;

/**
 * Structural sharing for the stage's result: every derived item equal to a recent derived object of the same stored
 * item (same catalogue entry, level, room, floor, collisions, blocked doors) is that object, and when the result equals
 * one of `prevs` (derive.ts keeps the last few results per `variant.furniture` array) that result itself comes back.
 * So a wall, deck or hot-tub edit that touches no furniture hands renderers the same `furniture` array and items (they
 * keep their meshes), also after an edit that did touch them was undone.
 */
export function shareUnchanged<T extends { furniture: DerivedFurniture[]; warnings: ModelWarning[] }>(prevs: readonly T[], next: T): T {
  const furniture = next.furniture.map((df) => {
    const list = recentDerived.get(df.item) ?? [];
    const hit = list.find((p) => p.id === df.id && sameDerived(p, df));
    if (hit) return hit;
    list.unshift(df);
    if (list.length > RECENT) list.length = RECENT;
    recentDerived.set(df.item, list);
    return df;
  });
  const warnings = JSON.stringify(next.warnings);
  for (const prev of prevs) {
    const same = prev.furniture.length === furniture.length && furniture.every((df, i) => df === prev.furniture[i]);
    if (same && JSON.stringify(prev.warnings) === warnings) return prev;
  }
  return { ...next, furniture };
}

/** Whether a derived item collides with anything or blocks a door (renderers tint it red). */
export function furnitureHasConflict(df: Pick<DerivedFurniture, 'collisions' | 'blocksDoors'>): boolean {
  return df.collisions.length > 0 || df.blocksDoors.length > 0;
}
