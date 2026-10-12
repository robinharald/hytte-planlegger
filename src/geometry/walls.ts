/**
 * Blocks, exterior wall pieces, stored walls and openings — docs/architecture.md "Derivation pipeline" steps 1
 * (`deriveBlocks`) and 3 (`deriveWalls`), "Data model conventions" and "Derived ids". Pure functions: plan frame in
 * metres, z relative to the main floor.
 *
 * Step 3 comes in two halves so derive can memoise them separately (fix round 2 after 2a): `deriveWallPieces` (the
 * pieces and stored walls without openings, plus the host index) and `attachWallOpenings(pieces, openings)` (copies of
 * the pieces that hold openings / patches, and the opening warnings); `deriveWalls` = both.
 *
 * Both entry points take an optional last `opts` argument so the module can be used and tested on its own:
 * `opts.terrainZ` replaces `terrainZAt(terrain, site, x, y)` and `opts.undersideAt` replaces
 * `combinedUndersideAt(roofs, x, y)`.
 *
 * Decisions where the architecture is silent:
 *  - Junctions: edge pairs that are collinear within 1 cm / 0.5°, run in opposite directions and overlap > 1 cm
 *    (`collinearOverlap` defaults). 'open' in either entry wins; otherwise the owner is the block whose entry says
 *    'wall' (both / neither: the block listed first in `variant.blocks`). A missing entry means 'wall'.
 *  - Exterior pieces are split at part boundaries, at 'replace' zone boundaries ('add' zones stack a floor and do not
 *    change the wall's base) and at junction boundaries; consecutive intervals with the same part, zone, level and
 *    baseZ are merged again. Part and zone come from the interval midpoint nudged 1 cm inside the block.
 *  - Piece id `${blockId}/${edgeId}/${partId}/${zoneId ?? 'base'}`; if one edge yields the same id twice (a removed
 *    segment between two runs of the same part and zone) the later pieces get `/2`, `/3`, ….
 *  - Implicit part: id `${blockId}-implicit`, name = the block name (with " (resten)" when the block has explicit
 *    parts), isNew = true when the block has explicit parts (phase 2: the remainder is new work), else block.isNew
 *    (`implicitIsNew`). Clipped parts / zones / remainders that fall apart give one entry per polygon
 *    (same id); holes of clipped polygons are dropped (outer ring only).
 *  - Mitres at block vertices meet the adjacent edge's face lines. A "free" end (next to a removed segment or a
 *    removed adjacent edge) that meets another block's free piece end at the same point (≤ 1 mm, not parallel) is
 *    mitred against that wall like a block corner (inside face with inside face), so junction corners such as glass
 *    bump / living room close cleanly. Otherwise, at a block vertex whose adjacent edge has no wall of this block,
 *    the end is cut along the adjacent edge's axis line (open junction) or along the owner's outer wall face
 *    (junction owned by the other block), so exterior pieces never overlap there. Parallel edges or a mitre tip
 *    farther than 10 × thickness give a square end ('butt'); a piece too short for its mitres gets square ends on
 *    both sides.
 *  - topProfile (`envelopeProfile`): candidates at the ends, 1 mm inside the ends, every ≤ 0.1 m and at the roof
 *    events (outline / slope-edge crossings ± 1 µm, ridge crossings, pairwise underside-plane intersections), each
 *    evaluated with undersideAt; breaks between candidates are located exactly (kink = intersection of the
 *    neighbouring lines, jumps by bisection), collinear points removed (1e-7 m). Where no roof covers the line:
 *    exterior → the block's eaveZ; stored walls → ceiling / fixed height / level + 2.4 m.
 *  - 'auto' walls on a level with a ceiling and 'fixed' walls are min(cap, roof envelope), with exact crossings.
 *    Block ceilings: an 'auto' wall whose midpoint lies in the axis polygon of a block with `ceilingHeight` is also
 *    capped at that block's level elevation + ceilingHeight (the lower of the two caps; ignored when the ceiling is
 *    not above the wall's base).
 *  - levelIds: the wall's own level plus every HIGHER level (elevation above the wall's base) that the wall clearly
 *    reaches — topZ ≥ elevation + 1.0 + 0.3 (margin) — and that has a floor at the wall's midpoint: a block whose
 *    base level it is, or a floor zone of that level (for the loft: the 'add' zone), contains the midpoint or the
 *    midpoint nudged 1 cm beyond either face (so a wall along the zone boundary counts). Without the margin the
 *    2.5 m main-level partitions (loft + 1.0 = 2.47) joined the loft, and testing the end points pulled in the
 *    corridor walls that start at a corner of the loft zone; both then showed as cut walls in the Hems plan. The
 *    floor test also keeps main-level walls of the bod wing out of the loft graph (they would dangle there).
 *    Dividers: only their own level (they are graph edges of that level). Exterior pieces take part in the block's
 *    base level and in the level of every floor zone they run along (the piece midpoint nudged 1 cm into the block
 *    lies in the zone), whatever their height: the knee walls beside the loft zone bound the loft's rooms even
 *    though they stop at the eave, while the rest of the main block's walls stay out of the loft graph.
 *    storeyIds = the storeys of those levels. Ids are listed in `variant.levels` order.
 *  - Openings on block edges: offset from the block vertex (the whole edge is the host); resolved onto the piece
 *    containing the centre (piece offset = offset − piece start). Centre on a removed segment →
 *    `opening-on-removed-edge`, not attached. Outside the host by more than 1 mm → `opening-outside-host` (still
 *    attached to the nearest piece so it can be seen and fixed). Unknown host or a divider host →
 *    `opening-outside-host`, not attached. Removed openings are attached (plan symbol) + patch, never validated.
 *  - Default sill level: the first 'replace' zone of the block containing the point 0.2 m inside the edge at the
 *    centre, else the block level; for stored walls the wall's level.
 *  - opening-overlap: overlap along the host AND in height (> 1 mm), so a loft window above a lower window is fine.
 *  - opening-above-roof: headZ > (lowest point of topProfile over the opening span) − 0.05; skipped for fullHeight.
 *  - Swing: hinge on the face of the side the leaf opens into, at the jamb named by `hinge`; closed = the other
 *    jamb on that face; open = hinge + width × that side's normal; sweep from the turn closed → open. Double doors
 *    (`leaves === 2`): `swing` is the half-width leaf at the `hinge` jamb, `swing2` the half-width leaf at the other
 *    jamb; both close at the centre.
 *  - Patches of removed openings are rectangles (along the piece × height) minus the rectangles of the non-removed
 *    openings of the same piece (`patchMinusOpenings`), so new doors / windows are never marked as infill.
 *  - Boolean operations fall back locally on `ClipError` (parts / zones unclipped, no implicit part, overlap checks
 *    skipped). `deriveBlockWarnings` also reports `block-self-intersecting`.
 *  - Hints: glassPlane = mid-thickness ((faceLeft − faceRight) / 2); panes = mullions ?? [1, 1]; leaf colour
 *    default door → white, glazed types → glass, opening → white (leaf 'none').
 *  - DerivedBlock eaveZ / ridgeZ / pitchDeg come from roof.ts `roofParams` (one source of truth).
 *    groundZ = minimum of terrainZ sampled every 0.5 m along the outer outline and on a 1 m grid inside it.
 */
import type { Block, Id, Level, Opening, Site, TerrainAsset, Variant, Vec2, Wall } from '../model/types';
import type { DerivedBlock, DerivedOpening, DerivedRoof, DerivedWall, ModelWarning } from '../model/derived';
import {
  EPS,
  area,
  bbox,
  centroid,
  collinearOverlap,
  differencePolygons,
  distancePointSegment,
  intersectPolygons,
  isSelfIntersecting,
  lineIntersection,
  offsetPolygonPerEdge,
  pointInPolygon,
  segmentIntersection,
  signedArea,
  simplifyCollinear,
  withClipFallback,
} from './polygon';
import { combinedUndersideAt, roofParams } from './roof';
import { terrainZAt } from './terrain';

export type TerrainZFn = (x: number, y: number) => number;
export type UndersideFn = (x: number, y: number) => number | null;
export type Profile = { t: number; z: number }[];

/** Nudge (m) from an edge into the block when classifying a piece (part / zone). */
const NUDGE = 0.01;
/** Distance (m) inside the host at which the default sill level is probed. */
const SILL_PROBE = 0.2;
/** An opening may touch the host end within this tolerance (m). */
const TOUCH = 0.001;
const ABOVE_ROOF_MARGIN = 0.05;
const SAMPLE_STEP = 0.1;
const END_PROBE = 0.001;
/** Half width (m) of the step inserted at roof-outline crossings. */
const JUMP = 1e-6;
const Z_TOL = 1e-7;
/** Tolerance (m) for "lies on the block boundary" when refining part outlines. */
const ON_LINE = 1e-4;
/** Pieces / intervals shorter than this (m) are merged away. */
const MIN_PIECE = 1e-4;
const MIN_AREA = 1e-6;
const DEFAULT_WALL_HEIGHT = 2.4;
/** A block ceiling must be at least this (m) above a wall's base to cap it. */
const LEVEL_EPS = 0.01;
/** levelIds rule: a stored wall joins a higher level when its topZ ≥ level.elevation + LEVEL_PROBE + LEVEL_MARGIN. */
const LEVEL_PROBE = 1.0;
const LEVEL_MARGIN = 0.3;
/** How far beyond a wall face its midpoint is probed for a higher level's floor (m). */
const LEVEL_NUDGE = 0.01;
const FRAME_DEPTH = 0.1;
/** Mitre tips farther than this × thickness from the vertex are squared off. */
const MAX_MITRE = 10;

// ---------------------------------------------------------------------------
// Small vector helpers
// ---------------------------------------------------------------------------

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const scale = (v: Vec2, s: number): Vec2 => [v[0] * s, v[1] * s];
const along = (p: Vec2, u: Vec2, s: number): Vec2 => [p[0] + u[0] * s, p[1] + u[1] * s];
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const leftNormal = (u: Vec2): Vec2 => [-u[1], u[0]];
const copy = (p: Vec2): Vec2 => [p[0], p[1]];

function unit(v: Vec2): Vec2 {
  const l = Math.hypot(v[0], v[1]);
  return l < 1e-12 ? [0, 0] : [v[0] / l, v[1] / l];
}

/** Distance from p to the infinite line through a and b. */
function lineDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const l = Math.hypot(d[0], d[1]);
  return l < EPS ? dist(p, a) : Math.abs(cross(d, sub(p, a))) / l;
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

interface Levels {
  list: Level[];
  get(id: Id): Level | undefined;
  elevation(id: Id): number;
  storey(id: Id): Id | undefined;
  /** Absolute z of the level's flat ceiling, or null. */
  ceiling(id: Id): number | null;
}

function levelIndex(variant: Variant): Levels {
  const byId = new Map(variant.levels.map((l) => [l.id, l]));
  return {
    list: variant.levels,
    get: (id) => byId.get(id),
    elevation: (id) => byId.get(id)?.elevation ?? 0,
    storey: (id) => byId.get(id)?.storeyId,
    ceiling: (id) => {
      const l = byId.get(id);
      return l?.ceilingHeight === undefined ? null : l.elevation + l.ceilingHeight;
    },
  };
}

/** Levels above baseZ that a wall reaching topZ joins: topZ ≥ elevation + 1.0 + 0.3 (1 µm tolerance). */
function reachedLevels(levels: Levels, baseZ: number, topZ: number): Id[] {
  return levels.list
    .filter((l) => l.elevation > baseZ + 1e-9 && topZ >= l.elevation + LEVEL_PROBE + LEVEL_MARGIN - 1e-6)
    .map((l) => l.id);
}

/** Ids in `variant.levels` order (unknown ids last, in insertion order). */
function orderLevels(levels: Levels, ids: Set<Id>): Id[] {
  const known = levels.list.filter((l) => ids.has(l.id)).map((l) => l.id);
  const rest = [...ids].filter((id) => !known.includes(id));
  return [...known, ...rest];
}

function storeysOf(levels: Levels, levelIds: Id[]): Id[] {
  const out: Id[] = [];
  for (const id of levelIds) {
    const s = levels.storey(id);
    if (s !== undefined && !out.includes(s)) out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block edges and junctions
// ---------------------------------------------------------------------------

interface EdgeGeom {
  a: Vec2;
  b: Vec2;
  length: number;
  /** Unit direction a → b ([0, 0] for a zero-length edge). */
  u: Vec2;
}

function blockEdges(block: Block): EdgeGeom[] {
  const n = block.polygon.length;
  return block.polygon.map((v, i) => {
    const a = v.p;
    const b = block.polygon[(i + 1) % n].p;
    return { a, b, length: dist(a, b), u: unit(sub(b, a)) };
  });
}

/** What happens to a shared edge segment on one block: no wall, this block's wall, the other block's wall. */
export type JunctionRole = 'open' | 'own' | 'other';

export interface EdgeJunction {
  /** Distances along this block's edge (from the edge start), s0 < s1. */
  s0: number;
  s1: number;
  otherBlockId: Id;
  /** Index of the partner block's edge that shares the segment. */
  otherEdgeIndex: number;
  role: JunctionRole;
  /** The other block's `wall.outerOffset` (its wall face reaches that far into this block when it keeps the wall). */
  otherOuterOffset: number;
}

/** Resolved junction policy of a block pair (a listed before b). */
function junctionPolicy(a: Block, b: Block): { open: boolean; owner: Id } {
  const ea = a.junctions.find((j) => j.otherBlockId === b.id);
  const eb = b.junctions.find((j) => j.otherBlockId === a.id);
  if (ea?.policy === 'open' || eb?.policy === 'open') return { open: true, owner: a.id };
  const aSays = ea?.policy === 'wall';
  const bSays = eb?.policy === 'wall';
  return { open: false, owner: bSays && !aSays ? b.id : a.id };
}

function roleFor(blockId: Id, policy: { open: boolean; owner: Id }): JunctionRole {
  if (policy.open) return 'open';
  return policy.owner === blockId ? 'own' : 'other';
}

/** Distances along e of the two points of an overlap (ordered). */
function overlapRange(e: EdgeGeom, seg: [Vec2, Vec2]): [number, number] {
  const s0 = dot(sub(seg[0], e.a), e.u);
  const s1 = dot(sub(seg[1], e.a), e.u);
  return s0 <= s1 ? [s0, s1] : [s1, s0];
}

/**
 * Shared edge segments of every block, per edge index: blockId → edges → junctions. Edges must run in opposite
 * directions (adjacent blocks); same-direction overlaps are block overlaps, not junctions.
 */
export function resolveJunctions(variant: Variant): Map<Id, EdgeJunction[][]> {
  const blocks = variant.blocks;
  const edgesOf = blocks.map(blockEdges);
  const out = new Map<Id, EdgeJunction[][]>();
  blocks.forEach((b, i) => out.set(b.id, edgesOf[i].map(() => [])));
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const A = blocks[i];
      const B = blocks[j];
      const policy = junctionPolicy(A, B);
      edgesOf[i].forEach((e, ei) => {
        edgesOf[j].forEach((f, fi) => {
          if (e.length < EPS || f.length < EPS || dot(e.u, f.u) >= 0) return;
          const onA = collinearOverlap(e.a, e.b, f.a, f.b);
          const onB = collinearOverlap(f.a, f.b, e.a, e.b);
          if (onA === null || onB === null) return;
          const [a0, a1] = overlapRange(e, onA);
          const [b0, b1] = overlapRange(f, onB);
          out.get(A.id)?.[ei].push({ s0: a0, s1: a1, otherBlockId: B.id, otherEdgeIndex: fi, role: roleFor(A.id, policy), otherOuterOffset: B.wall.outerOffset });
          out.get(B.id)?.[fi].push({ s0: b0, s1: b1, otherBlockId: A.id, otherEdgeIndex: ei, role: roleFor(B.id, policy), otherOuterOffset: A.wall.outerOffset });
        });
      });
    }
  }
  return out;
}

const ROLE_RANK: Record<JunctionRole, number> = { open: 0, other: 1, own: 2 };

/** Junction covering distance s on an edge; removal wins over keeping when several overlap. */
function junctionAt(list: EdgeJunction[], s: number): EdgeJunction | undefined {
  let best: EdgeJunction | undefined;
  for (const j of list) {
    if (s < j.s0 - 1e-9 || s > j.s1 + 1e-9) continue;
    if (best === undefined || ROLE_RANK[j.role] < ROLE_RANK[best.role]) best = j;
  }
  return best;
}

/** Sorted breakpoints in [0, L] incl. both ends; points closer than MIN_PIECE are merged. */
function breakpoints(values: number[], L: number): number[] {
  const sorted = [0, L, ...values.filter((v) => Number.isFinite(v)).map((v) => Math.min(L, Math.max(0, v)))].sort(
    (p, q) => p - q,
  );
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1] >= MIN_PIECE) out.push(v);
  }
  out[out.length - 1] = L;
  if (out.length === 1) out.unshift(0);
  return out;
}

// ---------------------------------------------------------------------------
// Outlines (axis / outer / inner) with per-edge offsets
// ---------------------------------------------------------------------------

/** A sub-segment of the block boundary with its outward distances for the outer and inner outlines. */
interface BoundarySeg {
  a: Vec2;
  b: Vec2;
  outer: number;
  /** Outward distance of the inner outline (≤ 0). */
  inner: number;
}

function boundarySegments(block: Block, edges: EdgeGeom[], junctions: EdgeJunction[][]): BoundarySeg[] {
  const outerOffset = block.wall.outerOffset;
  const innerOffset = block.wall.thickness - block.wall.outerOffset;
  const segs: BoundarySeg[] = [];
  edges.forEach((e, i) => {
    if (e.length < EPS) return;
    const list = junctions[i] ?? [];
    const bps = breakpoints(list.flatMap((j) => [j.s0, j.s1]), e.length);
    for (let k = 0; k + 1 < bps.length; k++) {
      const j = junctionAt(list, (bps[k] + bps[k + 1]) / 2);
      let outer = outerOffset;
      let inner = -innerOffset;
      if (j !== undefined) {
        outer = 0;
        inner = j.role === 'own' ? -innerOffset : j.role === 'other' ? -j.otherOuterOffset : 0;
      }
      segs.push({ a: along(e.a, e.u, bps[k]), b: along(e.a, e.u, bps[k + 1]), outer, inner });
    }
  });
  return segs;
}

/**
 * Splits the edges of `poly` where boundary segments start / end on them and assigns each sub-edge the distances of
 * the boundary segment it lies on (0 / 0 for edges inside the block).
 */
function refineAgainst(poly: Vec2[], segs: BoundarySeg[]): { pts: Vec2[]; outer: number[]; inner: number[] } {
  const pts: Vec2[] = [];
  const outer: number[] = [];
  const inner: number[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const d = sub(q, p);
    const L = Math.hypot(d[0], d[1]);
    if (L < EPS) continue;
    const onLine = segs.filter((s) => lineDistance(s.a, p, q) <= ON_LINE && lineDistance(s.b, p, q) <= ON_LINE);
    const ts = breakpoints(
      onLine.flatMap((s) => [dot(sub(s.a, p), d) / L, dot(sub(s.b, p), d) / L]),
      L,
    );
    for (let k = 0; k + 1 < ts.length; k++) {
      pts.push(along(p, scale(d, 1 / L), ts[k]));
      const mid = along(p, scale(d, 1 / L), (ts[k] + ts[k + 1]) / 2);
      const seg = onLine.find((s) => distancePointSegment(mid, s.a, s.b) <= ON_LINE);
      outer.push(seg?.outer ?? 0);
      inner.push(seg?.inner ?? 0);
    }
  }
  return { pts, outer, inner };
}

function offsetOutline(pts: Vec2[], distances: number[]): Vec2[] {
  const raw = offsetPolygonPerEdge(pts, distances);
  const clean = simplifyCollinear(raw, 1e-9);
  return clean.length >= 3 ? clean : raw;
}

function outlinesOf(poly: Vec2[], segs: BoundarySeg[]): { outer: Vec2[]; inner: Vec2[] } {
  const r = refineAgainst(poly, segs);
  return { outer: offsetOutline(r.pts, r.outer), inner: offsetOutline(r.pts, r.inner) };
}

/** Outer rings of `poly` ∩ `axis` with a non-trivial area (`poly` unclipped when the clipping fails). */
function clipRings(poly: Vec2[], axis: Vec2[]): Vec2[][] {
  return withClipFallback(
    'clip a part or floor zone to its block',
    () => intersectPolygons([poly], [axis]).map((p) => p[0]),
    () => [poly],
  ).filter((r) => r !== undefined && r.length >= 3 && area(r) > MIN_AREA);
}

// ---------------------------------------------------------------------------
// deriveBlocks
// ---------------------------------------------------------------------------

/** Minimum of terrainZ along the outline (every ≤ 0.5 m) and on a 1 m grid inside it. */
function minTerrainUnder(poly: Vec2[], terrainZ: TerrainZFn): number {
  let best = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const k = Math.max(1, Math.ceil(dist(a, b) / 0.5));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      best = Math.min(best, terrainZ(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t));
    }
  }
  const { min, max } = bbox(poly);
  for (let x = min[0] + 0.5; x < max[0]; x += 1) {
    for (let y = min[1] + 0.5; y < max[1]; y += 1) {
      if (pointInPolygon([x, y], poly)) best = Math.min(best, terrainZ(x, y));
    }
  }
  if (!Number.isFinite(best)) {
    const c = centroid(poly);
    return terrainZ(c[0], c[1]);
  }
  return best;
}

/** Minimum terrain height under a derived block's outer outline (axis when there is none), as `DerivedBlock.groundZ`. */
export function blockGroundZ(db: DerivedBlock, terrainZ: TerrainZFn): number {
  return minTerrainUnder(db.outer.length >= 3 ? db.outer : db.axis, terrainZ);
}

/** eaveZ / ridgeZ / pitchDeg from roof.ts (a missing level counts as elevation 0). */
function roofHeightsOf(block: Block, levels: Levels): { eaveZ: number; ridgeZ: number; pitchDeg: number } {
  const level = levels.get(block.levelId) ?? { id: block.levelId, name: '', storeyId: '', elevation: 0, floorThickness: 0 };
  const { eaveZ, ridgeZ, pitchDeg } = roofParams(block, level);
  return { eaveZ, ridgeZ, pitchDeg };
}

/**
 * Whether the implicit remainder of a block is new: always for a block with explicit parts (an explicit existing part
 * never grows, so area added by dragging an edge outwards is new work, docs/phase2-plan.md §3.4), else the block's isNew.
 */
export function implicitIsNew(block: Block): boolean {
  return block.parts.length > 0 || block.isNew;
}

function implicitPartName(block: Block): string {
  return block.parts.length > 0 ? `${block.name} (resten)` : block.name;
}

function deriveBlock(block: Block, junctions: EdgeJunction[][], levels: Levels, terrainZ: TerrainZFn): DerivedBlock {
  const axis = block.polygon.map((v) => copy(v.p));
  const elevation = levels.elevation(block.levelId);
  const geoms = blockEdges(block);
  const sign = signedArea(axis) < 0 ? -1 : 1;
  const edges = geoms.map((e, i) => ({
    edgeId: block.polygon[i].id,
    a: copy(e.a),
    b: copy(e.b),
    length: e.length,
    outward: scale(leftNormal(e.u), -sign),
  }));
  const segs = boundarySegments(block, geoms, junctions);
  const { outer, inner } = axis.length >= 3 ? outlinesOf(axis, segs) : { outer: [], inner: [] };

  const parts: DerivedBlock['parts'] = [];
  for (const part of block.parts) {
    for (const ring of clipRings(part.polygon, axis)) {
      parts.push({ part: { ...part, polygon: ring }, ...outlinesOf(ring, segs), isImplicit: false });
    }
  }
  const remainder =
    block.parts.length === 0
      ? axis.length >= 3 && area(axis) > MIN_AREA
        ? [axis.map(copy)]
        : []
      : withClipFallback(
          'implicit part of a block',
          () => differencePolygons([axis], block.parts.map((p) => p.polygon)).map((p) => p[0]),
          () => [],
        ).filter((r) => r !== undefined && r.length >= 3 && area(r) > MIN_AREA);
  for (const ring of remainder) {
    const part = { id: `${block.id}-implicit`, name: implicitPartName(block), polygon: ring, isNew: implicitIsNew(block) };
    parts.push({ part, ...outlinesOf(ring, segs), isImplicit: true });
  }

  const zones: DerivedBlock['zones'] = [];
  for (const z of block.floorZones) {
    for (const ring of clipRings(z.polygon, axis)) zones.push({ zoneId: z.id, levelId: z.levelId, kind: z.kind, polygon: ring });
  }

  const replace = zones.filter((z) => z.kind === 'replace');
  const baseLeft =
    replace.length === 0
      ? area(axis)
      : withClipFallback(
          'base floor of a block',
          () => differencePolygons([axis], replace.map((z) => z.polygon)).reduce((s, p) => s + area(p[0] ?? []), 0),
          () => area(axis) - replace.reduce((s, z) => s + area(z.polygon), 0),
        );
  const floors = replace.map((z) => levels.elevation(z.levelId));
  if (baseLeft > MIN_AREA || floors.length === 0) floors.push(elevation);

  const box = bbox(axis);
  return {
    block,
    axis,
    outer,
    inner,
    parts,
    zones,
    edges,
    axisDims: { w: box.max[0] - box.min[0], h: box.max[1] - box.min[1] },
    ...roofHeightsOf(block, levels),
    lowestFloorZ: Math.min(...floors),
    groundZ: minTerrainUnder(outer.length >= 3 ? outer : axis, terrainZ),
    junctions: junctions.flatMap((list, edgeIndex) =>
      list.map((j) => ({
        edgeIndex,
        s0: j.s0,
        s1: j.s1,
        otherBlockId: j.otherBlockId,
        otherEdgeIndex: j.otherEdgeIndex,
        role: j.role === 'own' ? ('owner' as const) : j.role === 'other' ? ('removed' as const) : ('open' as const),
      })),
    ),
  };
}

/**
 * Step 1: axis / outer / inner outlines, parts and zones clipped to the block, edges, roof heights, lowest floor and
 * ground height of every block (in `variant.blocks` order).
 */
export function deriveBlocks(
  variant: Variant,
  site: Site,
  terrain: TerrainAsset | null,
  opts: { terrainZ?: TerrainZFn } = {},
): DerivedBlock[] {
  const terrainZ = opts.terrainZ ?? ((x: number, y: number) => terrainZAt(terrain, site, x, y));
  const junctions = resolveJunctions(variant);
  const levels = levelIndex(variant);
  return variant.blocks.map((b) => deriveBlock(b, junctions.get(b.id) ?? [], levels, terrainZ));
}

/**
 * `block-self-intersecting` (axis polygon whose boundary crosses or touches itself), `block-overlap` (blocks sharing
 * area > 0.01 m²) and `parts-overlap` (explicit parts of a block overlapping). A pair whose overlap cannot be
 * computed (`ClipError`) is skipped.
 */
export function deriveBlockWarnings(blocks: DerivedBlock[]): ModelWarning[] {
  const warnings: ModelWarning[] = [];
  for (const db of blocks) {
    if (db.axis.length >= 3 && isSelfIntersecting(db.axis)) warnings.push({ kind: 'block-self-intersecting', blockId: db.block.id });
  }
  const sharedArea = (a: Vec2[][], b: Vec2[][]): number =>
    withClipFallback('overlap check', () => intersectPolygons(a, b).reduce((s, p) => s + area(p[0] ?? []), 0), () => 0);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (sharedArea([blocks[i].axis], [blocks[j].axis]) > 0.01) warnings.push({ kind: 'block-overlap', blockIds: [blocks[i].block.id, blocks[j].block.id] });
    }
  }
  for (const db of blocks) {
    const ps = db.block.parts;
    let overlap = false;
    for (let i = 0; i < ps.length && !overlap; i++) {
      for (let j = i + 1; j < ps.length && !overlap; j++) {
        const shared = withClipFallback('overlap check', () => intersectPolygons([ps[i].polygon], [ps[j].polygon]), () => []);
        if (shared.length > 0 && sharedArea(shared.map((p) => p[0]), [db.axis]) > 0.01) overlap = true;
      }
    }
    if (overlap) warnings.push({ kind: 'parts-overlap', blockId: db.block.id });
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Top profiles
// ---------------------------------------------------------------------------

interface Plane {
  c: number;
  gx: number;
  gy: number;
}

/** Roof geometry used to find profile breakpoints along a line. */
export interface RoofEvents {
  /** Plan segments where the envelope may change: outline / slope edges (jump = may be a step) and ridges. */
  segments: { a: Vec2; b: Vec2; jump: boolean }[];
  /** Underside planes z = c + gx·x + gy·y of all slopes. */
  planes: Plane[];
}

export function roofEvents(roofs: DerivedRoof[]): RoofEvents {
  const segments: RoofEvents['segments'] = [];
  const planes: Plane[] = [];
  const ringSegments = (ring: Vec2[], jump: boolean) => {
    for (let i = 0; i < ring.length; i++) segments.push({ a: ring[i], b: ring[(i + 1) % ring.length], jump });
  };
  for (const roof of roofs) {
    ringSegments(roof.outline, true);
    if (roof.ridge) segments.push({ a: [roof.ridge.a[0], roof.ridge.a[1]], b: [roof.ridge.b[0], roof.ridge.b[1]], jump: false });
    for (const slope of roof.slopes) {
      ringSegments(slope.polygon.map((p): Vec2 => [p[0], p[1]]), true);
      const [nx, ny, nz] = slope.normal;
      const p0 = slope.polygon[0];
      if (p0 === undefined || Math.abs(nz) < 1e-9) continue;
      const gx = -nx / nz;
      const gy = -ny / nz;
      planes.push({ gx, gy, c: p0[2] - gx * p0[0] - gy * p0[1] - roof.thickness });
    }
  }
  return { segments, planes };
}

/** Candidate t values (0..1) along a → b from roof events. */
function eventTs(a: Vec2, b: Vec2, L: number, events: RoofEvents): number[] {
  const ts: number[] = [];
  for (const s of events.segments) {
    const hit = segmentIntersection(a, b, s.a, s.b);
    if (hit === null) continue;
    ts.push(hit.ta);
    if (s.jump) ts.push(hit.ta - JUMP / L, hit.ta + JUMP / L);
  }
  const zA = events.planes.map((p) => p.c + p.gx * a[0] + p.gy * a[1]);
  const zB = events.planes.map((p) => p.c + p.gx * b[0] + p.gy * b[1]);
  for (let i = 0; i < zA.length; i++) {
    for (let j = i + 1; j < zA.length; j++) {
      const d0 = zA[i] - zA[j];
      const d1 = zB[i] - zB[j];
      if (d0 * d1 < 0) ts.push(d0 / (d0 - d1));
    }
  }
  return ts;
}

/** z of a profile at t (linear; clamped beyond the ends). */
export function profileAt(profile: Profile, t: number): number {
  if (profile.length === 0) return 0;
  if (t <= profile[0].t) return profile[0].z;
  for (let i = 0; i + 1 < profile.length; i++) {
    const p = profile[i];
    const q = profile[i + 1];
    if (t <= q.t) return q.t - p.t < 1e-15 ? q.z : p.z + ((t - p.t) / (q.t - p.t)) * (q.z - p.z);
  }
  return profile[profile.length - 1].z;
}

/** Lowest profile z over [t0, t1]. */
function profileMin(profile: Profile, t0: number, t1: number): number {
  let m = Math.min(profileAt(profile, t0), profileAt(profile, t1));
  for (const p of profile) if (p.t > t0 && p.t < t1) m = Math.min(m, p.z);
  return m;
}

/**
 * Breakpoints strictly inside (p, q), given the line through (l0, p) on the left and (q, r1) on the right: the
 * intersection of the two lines for a kink, else a bisection on "still on the left line" (jumps).
 */
function locateBreak(l0: Profile[number], p: Profile[number], q: Profile[number], r1: Profile[number], zAt: (t: number) => number, L: number): Profile {
  if (p.t - l0.t <= 0 || r1.t - q.t <= 0) return [];
  const sL = (p.z - l0.z) / (p.t - l0.t);
  const sR = (r1.z - q.z) / (r1.t - q.t);
  const lineL = (t: number) => p.z + sL * (t - p.t);
  const lineR = (t: number) => q.z + sR * (t - q.t);
  if (Math.abs(lineL(q.t) - q.z) <= Z_TOL || Math.abs(lineR(p.t) - p.z) <= Z_TOL) return [];
  if (Math.abs(sL - sR) > 1e-12) {
    const t = (q.z - sR * q.t - p.z + sL * p.t) / (sL - sR);
    if (t > p.t && t < q.t) {
      const z = zAt(t);
      if (Math.abs(z - lineL(t)) <= 1e-6 && Math.abs(z - lineR(t)) <= 1e-6) return [{ t, z }];
    }
  }
  let lo = p.t;
  let hi = q.t;
  for (let k = 0; k < 64 && (hi - lo) * L > 1e-9; k++) {
    const m = (lo + hi) / 2;
    if (Math.abs(zAt(m) - lineL(m)) <= Z_TOL) lo = m;
    else hi = m;
  }
  return [
    { t: lo, z: zAt(lo) },
    { t: hi, z: zAt(hi) },
  ].filter((x) => x.t > p.t && x.t < q.t);
}

function refineProfile(pts: Profile, zAt: (t: number) => number, L: number): Profile {
  const out: Profile = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    if (out.length >= 2 && i + 2 < pts.length && (q.t - p.t) * L > 1e-6) {
      out.push(...locateBreak(out[out.length - 2], p, q, pts[i + 2], zAt, L));
    }
    out.push(q);
  }
  return out;
}

/** Removes points on the line through their kept neighbours (vertical steps stay). */
function simplifyProfile(pts: Profile): Profile {
  const out: Profile = [];
  for (const p of pts) {
    while (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      if (p.t - a.t <= 0 || b.t <= a.t) break;
      const zb = a.z + ((p.z - a.z) * (b.t - a.t)) / (p.t - a.t);
      if (Math.abs(zb - b.z) > Z_TOL) break;
      out.pop();
    }
    const last = out[out.length - 1];
    if (last !== undefined && p.t - last.t < 1e-15 && Math.abs(p.z - last.z) <= Z_TOL) continue;
    out.push(p);
  }
  return out;
}

/**
 * Exact piecewise-linear upper roof envelope along a → b (t in [0, 1]); `fallback` where no roof covers the line.
 * `events` (from `roofEvents`) adds the analytic breakpoints; without it the sampling + break location still
 * recover every break of a piecewise-linear envelope whose pieces are at least 0.1 m long.
 */
export function envelopeProfile(a: Vec2, b: Vec2, undersideAt: UndersideFn, fallback: number, events?: RoofEvents): Profile {
  const L = dist(a, b);
  const zAt = (t: number) => undersideAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) ?? fallback;
  if (L < EPS) {
    const z = zAt(0);
    return [
      { t: 0, z },
      { t: 1, z },
    ];
  }
  const raw: number[] = [0, 1];
  if (L > 4 * END_PROBE) raw.push(END_PROBE / L, 1 - END_PROBE / L);
  const n = Math.max(1, Math.ceil(L / SAMPLE_STEP - 1e-9));
  for (let k = 1; k < n; k++) raw.push(k / n);
  if (events) raw.push(...eventTs(a, b, L, events));
  const ts = raw.filter((t) => t >= 0 && t <= 1).sort((p, q) => p - q);
  const pts: Profile = [];
  for (const t of ts) {
    if (pts.length > 0 && (t - pts[pts.length - 1].t) * L < 1e-9) continue;
    pts.push({ t, z: zAt(t) });
  }
  pts[pts.length - 1].t = 1;
  return simplifyProfile(refineProfile(pts, zAt, L));
}

/** min(profile, cap) with the exact crossing points. */
export function capProfile(profile: Profile, cap: number): Profile {
  const out: Profile = [];
  profile.forEach((p, i) => {
    const prev = profile[i - 1];
    if (prev !== undefined && (prev.z - cap) * (p.z - cap) < 0 && p.t > prev.t) {
      out.push({ t: prev.t + ((cap - prev.z) / (p.z - prev.z)) * (p.t - prev.t), z: cap });
    }
    out.push({ t: p.t, z: Math.min(p.z, cap) });
  });
  return simplifyProfile(out);
}

const profileTop = (profile: Profile): number => profile.reduce((m, p) => Math.max(m, p.z), -Infinity);

// ---------------------------------------------------------------------------
// Exterior pieces
// ---------------------------------------------------------------------------

interface PieceSpec {
  s0: number;
  s1: number;
  partId: Id;
  isNew: boolean;
  zoneId: Id | null;
  levelId: Id;
  baseZ: number;
}

interface EdgeLayout {
  index: number;
  edgeId: Id;
  geom: EdgeGeom;
  /** Unit normal pointing into the block. */
  nIn: Vec2;
  pieces: PieceSpec[];
  removed: [number, number][];
  /** Whether this block keeps a wall at s = 0 / s = L (for the neighbours' mitres). */
  startKept: boolean;
  endKept: boolean;
  /**
   * Where the edge has no wall of this block at s = 0 / s = L: how far inside the block the neighbours' ends are cut
   * (0 for an open junction, the owner's outerOffset when the other block keeps the wall, so nothing overlaps it).
   */
  startCut: number;
  endCut: number;
}

type PartEntry = DerivedBlock['parts'][number];

function partAt(db: DerivedBlock, p: Vec2): { id: Id; isNew: boolean } {
  const hit = db.parts.find((e) => pointInPolygon(p, e.part.polygon));
  if (hit) return { id: hit.part.id, isNew: hit.part.isNew };
  let best: PartEntry | undefined;
  let bestD = Infinity;
  for (const e of db.parts) {
    const ring = e.part.polygon;
    for (let i = 0; i < ring.length; i++) {
      const d = distancePointSegment(p, ring[i], ring[(i + 1) % ring.length]);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
  }
  return best ? { id: best.part.id, isNew: best.part.isNew } : { id: `${db.block.id}-implicit`, isNew: implicitIsNew(db.block) };
}

function replaceZoneAt(db: DerivedBlock, p: Vec2): DerivedBlock['zones'][number] | undefined {
  return db.zones.find((z) => z.kind === 'replace' && pointInPolygon(p, z.polygon));
}

/** Floor elevation of a block at p (its 'replace' zone there, else its base level). */
function floorAt(db: DerivedBlock, p: Vec2, levels: Levels): number {
  const z = replaceZoneAt(db, p);
  return levels.elevation(z ? z.levelId : db.block.levelId);
}

function sameSpec(p: PieceSpec, q: PieceSpec): boolean {
  return p.partId === q.partId && p.zoneId === q.zoneId && p.levelId === q.levelId && Math.abs(p.baseZ - q.baseZ) < 1e-9;
}

/** Vertices (on the edge) and crossings of the given rings, as distances along the edge. */
function ringBreaks(e: EdgeGeom, rings: Vec2[][]): number[] {
  const out: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      if (distancePointSegment(p, e.a, e.b) <= ON_LINE) out.push(dot(sub(p, e.a), e.u));
      const hit = segmentIntersection(e.a, e.b, p, q);
      if (hit !== null) out.push(hit.ta * e.length);
    }
  }
  return out;
}

function edgeLayout(
  db: DerivedBlock,
  index: number,
  geom: EdgeGeom,
  junctions: EdgeJunction[],
  levels: Levels,
  blocksById: Map<Id, DerivedBlock>,
): EdgeLayout {
  const sign = signedArea(db.axis) < 0 ? -1 : 1;
  const nIn = scale(leftNormal(geom.u), sign);
  const layout: EdgeLayout = { index, edgeId: db.block.polygon[index].id, geom, nIn, pieces: [], removed: [], startKept: false, endKept: false, startCut: 0, endCut: 0 };
  if (geom.length < EPS) return layout;
  const rings = [...db.parts.map((e) => e.part.polygon), ...db.zones.filter((z) => z.kind === 'replace').map((z) => z.polygon)];
  const bps = breakpoints([...junctions.flatMap((j) => [j.s0, j.s1]), ...ringBreaks(geom, rings)], geom.length);
  for (let k = 0; k + 1 < bps.length; k++) {
    const s0 = bps[k];
    const s1 = bps[k + 1];
    const sm = (s0 + s1) / 2;
    const j = junctionAt(junctions, sm);
    if (j !== undefined && j.role !== 'own') {
      const last = layout.removed[layout.removed.length - 1];
      if (last !== undefined && Math.abs(last[1] - s0) < 1e-9) last[1] = s1;
      else layout.removed.push([s0, s1]);
      const cut = j.role === 'other' ? j.otherOuterOffset : 0;
      if (s0 < 1e-9) layout.startCut = cut;
      if (s1 > geom.length - 1e-9) layout.endCut = cut;
      continue;
    }
    const mid = along(geom.a, geom.u, sm);
    const inside = add(mid, scale(nIn, NUDGE));
    const part = partAt(db, inside);
    const zone = replaceZoneAt(db, inside);
    const levelId = zone ? zone.levelId : db.block.levelId;
    let baseZ = levels.elevation(levelId);
    if (j !== undefined) {
      const other = blocksById.get(j.otherBlockId);
      if (other) baseZ = Math.min(baseZ, floorAt(other, sub(mid, scale(nIn, NUDGE)), levels));
    }
    const spec: PieceSpec = { s0, s1, partId: part.id, isNew: part.isNew, zoneId: zone ? zone.zoneId : null, levelId, baseZ };
    const prev = layout.pieces[layout.pieces.length - 1];
    if (prev !== undefined && Math.abs(prev.s1 - s0) < 1e-9 && sameSpec(prev, spec)) prev.s1 = s1;
    else layout.pieces.push(spec);
  }
  const first = layout.pieces[0];
  const last = layout.pieces[layout.pieces.length - 1];
  layout.startKept = first !== undefined && first.s0 < 1e-9;
  layout.endKept = last !== undefined && last.s1 > geom.length - 1e-9;
  return layout;
}

/** Adjacent edge at a block vertex, for the mitre: its direction, left normal and face distances there. */
interface Adjacent {
  u: Vec2;
  nL: Vec2;
  fL: number;
  fR: number;
}

/**
 * Footprint (CCW for a left normal nL of u) of a straight wall from a to b with faces fL (left) / fR (right);
 * mitred against the adjacent edges where given, square otherwise.
 */
function pieceFootprint(
  a: Vec2,
  b: Vec2,
  fL: number,
  fR: number,
  startAdj: Adjacent | null,
  endAdj: Adjacent | null,
): { footprint: Vec2[]; ends: DerivedWall['ends'] } {
  const u = unit(sub(b, a));
  const nL = leftNormal(u);
  const limit = MAX_MITRE * Math.max(fL + fR, 0.05);
  const square = (p: Vec2): [Vec2, Vec2] => [along(p, nL, fL), along(p, nL, -fR)];
  const mitre = (p: Vec2, adj: Adjacent | null): [Vec2, Vec2] | null => {
    if (adj === null) return null;
    const l = lineIntersection(along(p, nL, fL), u, along(p, adj.nL, adj.fL), adj.u);
    const r = lineIntersection(along(p, nL, -fR), u, along(p, adj.nL, -adj.fR), adj.u);
    if (l === null || r === null || dist(l, p) > limit || dist(r, p) > limit) return null;
    return [l, r];
  };
  const sm = mitre(a, startAdj);
  const em = mitre(b, endAdj);
  let [SL, SR] = sm ?? square(a);
  let [EL, ER] = em ?? square(b);
  let ends: DerivedWall['ends'] = { start: sm ? 'miter' : 'butt', end: em ? 'miter' : 'butt' };
  const s = (p: Vec2) => dot(sub(p, a), u);
  if (s(SL) > s(EL) - 1e-9 || s(SR) > s(ER) - 1e-9) {
    [SL, SR] = square(a);
    [EL, ER] = square(b);
    ends = { start: 'butt', end: 'butt' };
  }
  const footprint: Vec2[] = [SR, ER, EL, SL];
  return { footprint: signedArea(footprint) > 1e-12 ? footprint : [], ends };
}

interface Ctx {
  levels: Levels;
  blocks: DerivedBlock[];
  undersideAt: UndersideFn;
  events: RoofEvents;
}

/** Edge host record used when attaching openings. */
interface EdgeHost {
  db: DerivedBlock;
  layout: EdgeLayout;
  walls: { spec: PieceSpec; wall: DerivedWall }[];
}

/** Edge layouts of one block plus its face distances (relative to each edge's geometric left normal). */
interface BlockLayout {
  db: DerivedBlock;
  layouts: EdgeLayout[];
  fL: number;
  fR: number;
  /** +1 for a CCW block (inside = left), -1 for CW. */
  sign: number;
}

function blockLayout(db: DerivedBlock, junctions: EdgeJunction[][], levels: Levels, blocksById: Map<Id, DerivedBlock>): BlockLayout {
  const layouts = blockEdges(db.block).map((g, i) => edgeLayout(db, i, g, junctions[i] ?? [], levels, blocksById));
  const { thickness, outerOffset } = db.block.wall;
  const fIn = thickness - outerOffset;
  // Inside is the left side of a CCW block.
  const sign = signedArea(db.axis) < 0 ? -1 : 1;
  const [fL, fR] = sign < 0 ? [outerOffset, fIn] : [fIn, outerOffset];
  return { db, layouts, fL, fR, sign };
}

/** A piece end with no wall of its own block continuing there (next to a removed segment or a removed edge). */
interface FreeEnd {
  blockId: Id;
  p: Vec2;
  u: Vec2;
  fL: number;
  fR: number;
}

function isFreeStart(bl: BlockLayout, layout: EdgeLayout, k: number): boolean {
  const spec = layout.pieces[k];
  if (spec.s0 < 1e-9) return !bl.layouts[(layout.index + bl.layouts.length - 1) % bl.layouts.length].endKept;
  return k === 0 || layout.pieces[k - 1].s1 < spec.s0 - 1e-9;
}

function isFreeEnd(bl: BlockLayout, layout: EdgeLayout, k: number): boolean {
  const spec = layout.pieces[k];
  if (spec.s1 > layout.geom.length - 1e-9) return !bl.layouts[(layout.index + 1) % bl.layouts.length].startKept;
  return k === layout.pieces.length - 1 || layout.pieces[k + 1].s0 > spec.s1 + 1e-9;
}

function freeEnds(bl: BlockLayout): FreeEnd[] {
  const out: FreeEnd[] = [];
  for (const layout of bl.layouts) {
    const { a, u } = layout.geom;
    layout.pieces.forEach((spec, k) => {
      const base = { blockId: bl.db.block.id, u, fL: bl.fL, fR: bl.fR };
      if (isFreeStart(bl, layout, k)) out.push({ ...base, p: along(a, u, spec.s0) });
      if (isFreeEnd(bl, layout, k)) out.push({ ...base, p: along(a, u, spec.s1) });
    });
  }
  return out;
}

/**
 * What the end of a piece meets: the own adjacent edge's wall (block vertex, kept), else another block's wall ending
 * freely at the same point (junction corner, mitred like a block corner), else the own adjacent edge's axis line
 * (block vertex), else nothing (square end).
 */
function endPartner(bl: BlockLayout, layout: EdgeLayout, k: number, atStart: boolean, ends: FreeEnd[]): Adjacent | null {
  const n = bl.layouts.length;
  const spec = layout.pieces[k];
  const atVertex = atStart ? spec.s0 < 1e-9 : spec.s1 > layout.geom.length - 1e-9;
  const adj = bl.layouts[(layout.index + (atStart ? n - 1 : 1)) % n];
  const cut = (atStart ? adj.endCut : adj.startCut) * bl.sign;
  // Kept: the adjacent wall's faces. Not kept: both face lines on the cut line `cut` inside the block.
  const own = (kept: boolean): Adjacent | null =>
    adj.geom.length < EPS ? null : { u: adj.geom.u, nL: leftNormal(adj.geom.u), fL: kept ? bl.fL : cut, fR: kept ? bl.fR : -cut };
  if (atVertex && (atStart ? adj.endKept : adj.startKept)) return own(true);
  if (atStart ? isFreeStart(bl, layout, k) : isFreeEnd(bl, layout, k)) {
    const u = layout.geom.u;
    const p = along(layout.geom.a, u, atStart ? spec.s0 : spec.s1);
    const hit = ends.find((e) => e.blockId !== bl.db.block.id && dist(e.p, p) <= TOUCH && Math.abs(cross(e.u, u)) > 1e-6);
    if (hit) return { u: hit.u, nL: leftNormal(hit.u), fL: hit.fL, fR: hit.fR };
  }
  return atVertex ? own(false) : null;
}

function pieceId(db: DerivedBlock, layout: EdgeLayout, spec: PieceSpec, usedIds: Set<Id>): Id {
  const base = `${db.block.id}/${layout.edgeId}/${spec.partId}/${spec.zoneId ?? 'base'}`;
  let id = base;
  for (let k = 2; usedIds.has(id); k++) id = `${base}/${k}`;
  usedIds.add(id);
  return id;
}

function exteriorWalls(bl: BlockLayout, ends: FreeEnd[], ctx: Ctx, usedIds: Set<Id>): EdgeHost[] {
  const { db, fL, fR } = bl;
  return bl.layouts.map((layout) => {
    const host: EdgeHost = { db, layout, walls: [] };
    const g = layout.geom;
    layout.pieces.forEach((spec, k) => {
      const a = along(g.a, g.u, spec.s0);
      const b = along(g.a, g.u, spec.s1);
      const startAdj = endPartner(bl, layout, k, true, ends);
      const endAdj = endPartner(bl, layout, k, false, ends);
      const { footprint, ends: endKinds } = pieceFootprint(a, b, fL, fR, startAdj, endAdj);
      const topProfile = envelopeProfile(a, b, ctx.undersideAt, db.eaveZ, ctx.events);
      const topZ = profileTop(topProfile);
      // The piece's own level, the block's base level and the level of every zone the piece runs along (its
      // midpoint nudged 1 cm into the block lies in the zone): a main-block wall beside the loft zone takes part
      // in the loft's room graph, the rest of the main block's walls do not.
      const ids = new Set<Id>([spec.levelId, db.block.levelId]);
      const probe = along(along(g.a, g.u, (spec.s0 + spec.s1) / 2), leftNormal(g.u), NUDGE * bl.sign);
      for (const z of db.zones) if (z.polygon.length >= 3 && pointInPolygon(probe, z.polygon)) ids.add(z.levelId);
      const levelIds = orderLevels(ctx.levels, ids);
      const wall: DerivedWall = {
        id: pieceId(db, layout, spec, usedIds),
        source: { kind: 'blockEdge', blockId: db.block.id, edgeId: layout.edgeId, partId: spec.partId, zoneId: spec.zoneId, s0: spec.s0, s1: spec.s1 },
        a,
        b,
        thickness: db.block.wall.thickness,
        faceLeft: fL,
        faceRight: fR,
        footprint,
        ends: endKinds,
        isExterior: true,
        isDivider: false,
        status: spec.isNew ? 'new' : 'existing',
        isNew: spec.isNew,
        isGhost: false,
        levelId: spec.levelId,
        levelIds,
        storeyIds: storeysOf(ctx.levels, levelIds),
        baseZ: spec.baseZ,
        topZ,
        topProfile,
        openings: [],
        patches: [],
      };
      host.walls.push({ spec, wall });
    });
    return host;
  });
}

// ---------------------------------------------------------------------------
// Stored walls
// ---------------------------------------------------------------------------

const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/**
 * Lowest flat block ceiling (absolute z: block level elevation + `Block.ceilingHeight`) of the blocks whose axis
 * polygon contains p, ignoring ceilings not above `above` (a wall standing higher than the ceiling); null when none.
 */
function blockCeilingAt(ctx: Ctx, p: Vec2, above: number): number | null {
  let best: number | null = null;
  for (const db of ctx.blocks) {
    const h = db.block.ceilingHeight;
    if (h === undefined || !Number.isFinite(h) || db.axis.length < 3 || !pointInPolygon(p, db.axis)) continue;
    const z = ctx.levels.elevation(db.block.levelId) + h;
    if (z > above + LEVEL_EPS && (best === null || z < best)) best = z;
  }
  return best;
}

function storedTopProfile(w: Wall, ctx: Ctx): Profile {
  const elevation = ctx.levels.elevation(w.levelId);
  let cap: number | null = null;
  if (w.heightMode === 'fixed') cap = elevation + (w.height ?? DEFAULT_WALL_HEIGHT);
  else if (w.heightMode === 'auto') {
    const ceilings = [ctx.levels.ceiling(w.levelId), blockCeilingAt(ctx, mid(w.a, w.b), elevation)].filter((z): z is number => z !== null);
    if (ceilings.length > 0) cap = Math.min(...ceilings);
  }
  const fallback = cap ?? elevation + DEFAULT_WALL_HEIGHT;
  const envelope = envelopeProfile(w.a, w.b, ctx.undersideAt, fallback, ctx.events);
  return cap === null ? envelope : capProfile(envelope, cap);
}

/** A level exists at p when a block containing p has it as its base level or has a zone of it containing p. */
function levelExistsAt(blocks: DerivedBlock[], levelId: Id, p: Vec2): boolean {
  return blocks.some(
    (db) =>
      db.axis.length >= 3 &&
      pointInPolygon(p, db.axis) &&
      (db.block.levelId === levelId || db.zones.some((z) => z.levelId === levelId && pointInPolygon(p, z.polygon))),
  );
}

/** The midpoint of a→b and the midpoint nudged LEVEL_NUDGE beyond the left and the right face. */
function midpointProbes(a: Vec2, b: Vec2, faceLeft: number, faceRight: number): Vec2[] {
  const m = mid(a, b);
  const n = leftNormal(unit(sub(b, a)));
  return [m, along(m, n, faceLeft + LEVEL_NUDGE), along(m, n, -(faceRight + LEVEL_NUDGE))];
}

function storedWall(w: Wall, ctx: Ctx): DerivedWall {
  const isDivider = w.kind === 'divider';
  const thickness = isDivider ? 0 : w.thickness;
  const faceLeft = isDivider ? 0 : (w.faceLeft ?? thickness / 2);
  const faceRight = isDivider ? 0 : (w.faceRight ?? thickness / 2);
  const baseZ = ctx.levels.elevation(w.levelId);
  const topProfile = storedTopProfile(w, ctx);
  const topZ = profileTop(topProfile);
  const footprint = isDivider || dist(w.a, w.b) < EPS ? [] : pieceFootprint(w.a, w.b, faceLeft, faceRight, null, null).footprint;
  const probes = midpointProbes(w.a, w.b, faceLeft, faceRight);
  const extra = reachedLevels(ctx.levels, baseZ, topZ).filter((id) => probes.some((p) => levelExistsAt(ctx.blocks, id, p)));
  const levelIds = isDivider ? [w.levelId] : orderLevels(ctx.levels, new Set([w.levelId, ...extra]));
  return {
    id: w.id,
    source: { kind: 'wall', wallId: w.id },
    a: copy(w.a),
    b: copy(w.b),
    thickness,
    faceLeft,
    faceRight,
    footprint,
    ends: { start: 'butt', end: 'butt' },
    isExterior: false,
    isDivider,
    status: w.status,
    isNew: w.status === 'new',
    isGhost: w.status === 'removed',
    levelId: w.levelId,
    levelIds,
    storeyIds: storeysOf(ctx.levels, levelIds),
    baseZ,
    topZ,
    topProfile,
    openings: [],
    patches: [],
  };
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

type Hints = Pick<DerivedOpening, 'glazed' | 'leaf' | 'frameColour' | 'leafColour' | 'panes' | 'frameDepth'>;

/** Rendering hints from type + style. */
export function openingHints(o: Opening): Hints {
  const style = o.style;
  const base = { frameColour: style.frameColour, panes: style.mullions ?? ([1, 1] as [number, number]), frameDepth: FRAME_DEPTH };
  switch (o.type) {
    case 'window':
      return { ...base, glazed: true, leaf: 'glass', leafColour: style.leaf ?? 'glass' };
    case 'glassDoor':
    case 'slidingDoor':
      return { ...base, glazed: true, leaf: 'glass', leafColour: style.leaf ?? 'glass' };
    case 'saunaDoor': {
      const leafColour = style.leaf ?? 'glass';
      return { ...base, glazed: leafColour === 'glass', leaf: leafColour === 'glass' ? 'glass' : 'solid', leafColour };
    }
    case 'door': {
      const leafColour = style.leaf ?? 'white';
      return { ...base, glazed: leafColour === 'glass', leaf: leafColour === 'glass' ? 'glass' : 'solid', leafColour };
    }
    case 'opening':
      return { ...base, glazed: false, leaf: 'none', leafColour: style.leaf ?? 'white' };
  }
}

const SWINGING = new Set<Opening['type']>(['door', 'glassDoor', 'saunaDoor']);

type Swing = NonNullable<DerivedOpening['swing']>;

/**
 * Door swing arcs on the wall's reference line (see the header for the convention). One leaf: hinged at the jamb
 * named by `hinge`, as wide as the opening. Two leaves (`leaves === 2`): `first` is the half-width leaf hinged at
 * that jamb, `second` the half-width leaf hinged at the other jamb; both close at the centre and open to the same side.
 */
function swingsOf(o: Opening, wall: DerivedWall, offset: number): { first: Swing; second?: Swing } | undefined {
  if (!o.swing || !SWINGING.has(o.type)) return undefined;
  const u = unit(sub(wall.b, wall.a));
  const nL = leftNormal(u);
  const intoLeft = o.swing.side === 'left';
  const face = intoLeft ? wall.faceLeft : -wall.faceRight;
  const sideN = intoLeft ? nL : scale(nL, -1);
  const onFace = (s: number): Vec2 => along(along(wall.a, u, s), nL, face);
  const leaf = (hingeS: number, freeS: number): Swing => {
    const hinge = onFace(hingeS);
    const closed = onFace(freeS);
    const open = along(hinge, sideN, Math.abs(freeS - hingeS));
    const sweep: 1 | -1 = cross(sub(closed, hinge), sub(open, hinge)) >= 0 ? 1 : -1;
    return { hinge, closed, open, sweep };
  };
  const jStart = offset - o.width / 2;
  const jEnd = offset + o.width / 2;
  const [hingeS, otherS] = o.swing.hinge === 'start' ? [jStart, jEnd] : [jEnd, jStart];
  if (o.leaves !== 2) return { first: leaf(hingeS, otherS) };
  return { first: leaf(hingeS, offset), second: leaf(otherS, offset) };
}

function buildOpening(o: Opening, wall: DerivedWall, offset: number, levelId: Id, outward: Vec2 | undefined, levels: Levels): DerivedOpening {
  const L = dist(wall.a, wall.b);
  const u = unit(sub(wall.b, wall.a));
  const nL = leftNormal(u);
  const sillZ = levels.elevation(levelId) + o.sill;
  const headZ = o.fullHeight ? profileAt(wall.topProfile, L > EPS ? offset / L : 0) : sillZ + o.height;
  const p0 = along(wall.a, u, offset - o.width / 2);
  const p1 = along(wall.a, u, offset + o.width / 2);
  const footprint: Vec2[] = wall.isDivider
    ? []
    : [along(p0, nL, -wall.faceRight), along(p1, nL, -wall.faceRight), along(p1, nL, wall.faceLeft), along(p0, nL, wall.faceLeft)];
  const d: DerivedOpening = {
    id: o.id,
    opening: o,
    type: o.type,
    status: o.status,
    isNew: o.status === 'new',
    isGhost: o.status === 'removed',
    levelId,
    offset,
    width: o.width,
    sillZ,
    headZ,
    footprint,
    ...openingHints(o),
    glassPlane: (wall.faceLeft - wall.faceRight) / 2,
  };
  const swings = swingsOf(o, wall, offset);
  if (swings) {
    d.swing = swings.first;
    if (swings.second) d.swing2 = swings.second;
  }
  if (outward) d.outward = outward;
  return d;
}

interface Placement {
  wall: DerivedWall;
  offset: number;
  levelId: Id;
  outward?: Vec2;
}

type HostLookup = (o: Opening) => { length: number; resolve: () => Placement | 'removed-edge' | null } | null;

/** The wall an opening is attached to: a copy of a bare piece, made once per piece (see `attachWallOpenings`). */
type OwnWall = (w: DerivedWall) => DerivedWall;

function edgeHostLookup(hosts: Map<string, EdgeHost>, own: OwnWall): HostLookup {
  return (o) => {
    if (o.host.kind !== 'blockEdge') return null;
    const host = hosts.get(`${o.host.blockId}\u0000${o.host.edgeId}`);
    if (!host) return null;
    const { layout, db } = host;
    return {
      length: layout.geom.length,
      resolve: () => {
        const off = o.offset;
        let hit = host.walls.find((w) => off >= w.spec.s0 - 1e-9 && off <= w.spec.s1 + 1e-9);
        if (!hit && layout.removed.some(([s0, s1]) => off >= s0 - 1e-9 && off <= s1 + 1e-9)) return 'removed-edge';
        if (!hit) {
          const gap = (w: { spec: PieceSpec }) => Math.max(w.spec.s0 - off, off - w.spec.s1, 0);
          hit = [...host.walls].sort((p, q) => gap(p) - gap(q))[0];
        }
        if (!hit) return null;
        const probe = along(along(layout.geom.a, layout.geom.u, off), layout.nIn, SILL_PROBE);
        const zone = replaceZoneAt(db, probe);
        return {
          wall: own(hit.wall),
          offset: off - hit.spec.s0,
          levelId: o.levelId ?? (zone ? zone.levelId : db.block.levelId),
          outward: scale(layout.nIn, -1),
        };
      },
    };
  };
}

function wallHostLookup(walls: Map<Id, DerivedWall>, own: OwnWall): HostLookup {
  return (o) => {
    if (o.host.kind !== 'wall') return null;
    const w = walls.get(o.host.wallId);
    if (!w || w.isDivider) return null;
    return { length: dist(w.a, w.b), resolve: () => ({ wall: own(w), offset: o.offset, levelId: o.levelId ?? w.levelId }) };
  };
}

function hostKey(o: Opening): string {
  return o.host.kind === 'wall' ? `w\u0000${o.host.wallId}` : `e\u0000${o.host.blockId}\u0000${o.host.edgeId}`;
}

/** Plan extent along the host and z extent of a placed opening. */
interface Span {
  id: Id;
  s0: number;
  s1: number;
  z0: number;
  z1: number;
}

/** Pairs of openings on one host that overlap along the host AND in height (by more than 1 mm). */
function overlapWarnings(spans: Map<string, Span[]>): ModelWarning[] {
  const warnings: ModelWarning[] = [];
  for (const list of spans.values()) {
    const sorted = [...list].sort((p, q) => p.s0 - q.s0);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length && sorted[j].s0 < sorted[i].s1 - TOUCH; j++) {
        const p = sorted[i];
        const q = sorted[j];
        if (Math.min(p.z1, q.z1) - Math.max(p.z0, q.z0) > TOUCH) warnings.push({ kind: 'opening-overlap', openingIds: [p.id, q.id] });
      }
    }
  }
  return warnings;
}

type Patch = DerivedWall['patches'][number];

/**
 * A patch rectangle (along the wall x height) minus the rectangles of openings, as a list of rectangles; pieces
 * narrower or lower than 1 mm are dropped.
 */
export function patchMinusOpenings(patch: Patch, openings: { offset: number; width: number; sillZ: number; headZ: number }[]): Patch[] {
  let rects = [{ s0: patch.offset - patch.width / 2, s1: patch.offset + patch.width / 2, z0: patch.sillZ, z1: patch.headZ }];
  for (const o of openings) {
    const o0 = o.offset - o.width / 2;
    const o1 = o.offset + o.width / 2;
    const next: typeof rects = [];
    for (const r of rects) {
      if (o1 <= r.s0 + TOUCH || o0 >= r.s1 - TOUCH || o.headZ <= r.z0 + TOUCH || o.sillZ >= r.z1 - TOUCH) {
        next.push(r);
        continue;
      }
      if (o0 > r.s0) next.push({ ...r, s1: o0 });
      if (o1 < r.s1) next.push({ ...r, s0: o1 });
      const s0 = Math.max(r.s0, o0);
      const s1 = Math.min(r.s1, o1);
      if (o.sillZ > r.z0) next.push({ s0, s1, z0: r.z0, z1: o.sillZ });
      if (o.headZ < r.z1) next.push({ s0, s1, z0: o.headZ, z1: r.z1 });
    }
    rects = next.filter((r) => r.s1 - r.s0 > TOUCH && r.z1 - r.z0 > TOUCH);
  }
  return rects.map((r) => ({ offset: (r.s0 + r.s1) / 2, width: r.s1 - r.s0, sillZ: r.z0, headZ: r.z1 }));
}

function attachOpenings(openings: readonly Opening[], lookups: HostLookup[], levels: Levels): ModelWarning[] {
  const warnings: ModelWarning[] = [];
  const spans = new Map<string, Span[]>();
  const patched = new Set<DerivedWall>();
  for (const o of openings) {
    const removed = o.status === 'removed';
    const host = lookups.map((f) => f(o)).find((h) => h !== null);
    if (!host) {
      if (!removed) warnings.push({ kind: 'opening-outside-host', openingId: o.id });
      continue;
    }
    const s0 = o.offset - o.width / 2;
    const s1 = o.offset + o.width / 2;
    if (!removed && (s0 < -TOUCH || s1 > host.length + TOUCH)) warnings.push({ kind: 'opening-outside-host', openingId: o.id });
    const placed = host.resolve();
    if (placed === 'removed-edge') {
      if (!removed) warnings.push({ kind: 'opening-on-removed-edge', openingId: o.id });
      continue;
    }
    if (placed === null) continue;
    const d = buildOpening(o, placed.wall, placed.offset, placed.levelId, placed.outward, levels);
    placed.wall.openings.push(d);
    if (removed) {
      placed.wall.patches.push({ offset: d.offset, width: d.width, sillZ: d.sillZ, headZ: d.headZ });
      patched.add(placed.wall);
      continue;
    }
    const key = hostKey(o);
    spans.set(key, [...(spans.get(key) ?? []), { id: o.id, s0, s1, z0: d.sillZ, z1: d.headZ }]);
    if (!o.fullHeight) {
      const L = dist(placed.wall.a, placed.wall.b);
      const t0 = L > EPS ? Math.max(0, (d.offset - d.width / 2) / L) : 0;
      const t1 = L > EPS ? Math.min(1, (d.offset + d.width / 2) / L) : 1;
      const roofZ = profileMin(placed.wall.topProfile, Math.min(t0, t1), Math.max(t0, t1));
      if (d.headZ > roofZ - ABOVE_ROOF_MARGIN) warnings.push({ kind: 'opening-above-roof', openingId: o.id, headZ: d.headZ, roofZ });
    }
  }
  // Infill patches never cover the openings that stay or are new in the same piece.
  for (const wall of patched) {
    const kept = wall.openings.filter((o) => o.status !== 'removed');
    wall.patches = wall.patches.flatMap((p) => patchMinusOpenings(p, kept));
  }
  return [...warnings, ...overlapWarnings(spans)];
}

// ---------------------------------------------------------------------------
// deriveWalls = deriveWallPieces (no openings) + attachWallOpenings
// ---------------------------------------------------------------------------

/** What attaching openings needs from the pieces (opaque outside this module). */
export interface OpeningHostIndex {
  edges: Map<string, EdgeHost>;
  stored: Map<Id, DerivedWall>;
  levels: Levels;
}

/**
 * The wall pieces of a variant WITHOUT its openings (derive's building stage memoises them on the blocks, walls,
 * levels and roofs only, so an opening edit reuses them): every wall has empty `openings` and `patches` arrays, which
 * are never written — `attachWallOpenings` attaches to copies.
 */
export interface WallPieces {
  walls: DerivedWall[];
  hosts: OpeningHostIndex;
}

/**
 * Step 3 without the openings: exterior wall pieces of every block (junctions applied, split at part and zone
 * boundaries) followed by the stored walls, each with footprint, top profile and levels.
 */
export function deriveWallPieces(
  variant: Variant,
  blocks: DerivedBlock[],
  roofs: DerivedRoof[],
  opts: { undersideAt?: UndersideFn } = {},
): WallPieces {
  const ctx: Ctx = {
    levels: levelIndex(variant),
    blocks,
    undersideAt: opts.undersideAt ?? ((x: number, y: number) => combinedUndersideAt(roofs, x, y)),
    events: roofEvents(roofs),
  };
  const junctions = resolveJunctions(variant);
  const blocksById = new Map(blocks.map((b) => [b.block.id, b]));
  const usedIds = new Set<Id>();
  const edgeHosts = new Map<string, EdgeHost>();
  const walls: DerivedWall[] = [];
  const layouts = blocks.map((db) => blockLayout(db, junctions.get(db.block.id) ?? [], ctx.levels, blocksById));
  const ends = layouts.flatMap(freeEnds);
  for (const bl of layouts) {
    for (const host of exteriorWalls(bl, ends, ctx, usedIds)) {
      edgeHosts.set(`${bl.db.block.id}\u0000${host.layout.edgeId}`, host);
      walls.push(...host.walls.map((w) => w.wall));
    }
  }
  const stored = variant.walls.map((w) => storedWall(w, ctx));
  walls.push(...stored);
  return { walls, hosts: { edges: edgeHosts, stored: new Map(stored.map((w) => [w.id, w])), levels: ctx.levels } };
}

/** No pieces (derive's fallback when the wall stage fails): openings attached to it all get `opening-outside-host`. */
export function noWallPieces(variant: Variant): WallPieces {
  return { walls: [], hosts: { edges: new Map(), stored: new Map(), levels: levelIndex(variant) } };
}

/**
 * The openings resolved onto the pieces (see the header), with the opening warnings. A wall that gets an opening or a
 * patch is a fresh copy of its piece; the others are the pieces themselves (same objects). The pieces are never
 * changed, so one `WallPieces` can take any number of opening lists (derive's opening stage).
 */
export function attachWallOpenings(pieces: WallPieces, openings: readonly Opening[]): { walls: DerivedWall[]; warnings: ModelWarning[] } {
  const copies = new Map<DerivedWall, DerivedWall>();
  const own: OwnWall = (w) => {
    let c = copies.get(w);
    if (!c) {
      c = { ...w, openings: [], patches: [] };
      copies.set(w, c);
    }
    return c;
  };
  const { edges, stored, levels } = pieces.hosts;
  const warnings = attachOpenings(openings, [edgeHostLookup(edges, own), wallHostLookup(stored, own)], levels);
  return { walls: pieces.walls.map((w) => copies.get(w) ?? w), warnings };
}

/**
 * Step 3: exterior wall pieces of every block (junctions applied, split at part and zone boundaries) followed by
 * the stored walls, each with footprint, top profile, levels and resolved openings; plus the opening warnings.
 */
export function deriveWalls(
  variant: Variant,
  blocks: DerivedBlock[],
  roofs: DerivedRoof[],
  opts: { undersideAt?: UndersideFn } = {},
): { walls: DerivedWall[]; warnings: ModelWarning[] } {
  return attachWallOpenings(deriveWallPieces(variant, blocks, roofs, opts), variant.openings);
}
