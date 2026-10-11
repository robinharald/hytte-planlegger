/**
 * Area summary — docs/architecture.md "Areas" and pipeline step 8. Pure functions, plan frame, metres / m².
 *
 * DEVIATION from the contracted signature (requested so this module does not depend on roof.ts / terrain.ts):
 * `computeAreas` takes `undersideAt(x, y)` (= `combinedUndersideAt(roofs, x, y)`) and `terrainZ(x, y)`
 * (= `terrainZAt(terrain, site, x, y)`) instead of `roofs`, `site` and `terrain`.
 *
 * Partition rule (BYA, BRA and axis existing/new; `partitionByParts`): parts are tried in order and every point
 * of the region belongs to the FIRST part containing it; the pieces of the region outside every part go whole to
 * the part nearest to their label point. `blockPartRegions` orders the parts as: the derived parts of all blocks
 * (block order, part order), then every block's whole outline with the block's `isNew` as a fallback (this
 * covers an implicit remainder that walls.ts may or may not list, and slivers between part outlines).
 *
 * BYA
 *  - buildings = area of the union of the blocks' outer outlines; existing/new = that union partitioned by the
 *    parts' `outer` polygons.
 *  - decks: each deck polygon minus the buildings and minus the decks listed before it (overlaps count once, for
 *    the first deck), measured on a 0.25 m grid aligned to multiples of 0.25 m: a cell contributes the EXACT area
 *    of the deck piece inside it (Sutherland–Hodgman clip) when deck.topZ − terrainZ(cell centre) > 0.5 m.
 *    existing/new by `deck.isNew`.
 *  - total = buildings + decks; existing/new = buildings split + decks split.
 *  - perBlock is per block and NOT unioned: area = |block.outer|, parts[i].area = |part.outer| (the parts of a
 *    block sum to its area when they tile it). Σ perBlock.area equals `buildings` only when the outer outlines do
 *    not overlap (blocks sharing an edge have no outer offset along it, so they do not).
 * BRA, per level of `variant.levels` (order kept)
 *  - region = union over blocks of: (block.inner minus all of the block's 'replace' zones) when the block's base
 *    level is this level, plus (zone polygon ∩ block.inner) for every zone ('replace' or 'add') on this level.
 *    gross = area(region).
 *  - measurable = region minus the polygons (with holes) of rooms of type 'apning' on this level, then:
 *     · level with ceilingHeight: all of it when ceilingHeight ≥ 1.9, else nothing;
 *     · level without ceiling: 0.25 m grid (as for decks). The rule "free height ≥ 1.9" — undersideAt(x, y) −
 *       elevation ≥ 1.9, or no roof at all (null) — is sampled at every cell centre. A cell counts when a
 *       satisfied sample lies within 0.6 m of the cell (distance from the sample to the cell square ≤ 0.6, i.e. the
 *       5 × 5 cells around it); it contributes the exact area of the region inside it. The strip is thereby
 *       resolved to the grid: it reaches 0.375–0.625 m (0.5 m on average) beyond the 1.9 m line.
 *    area = measurable existing + measurable new, from the region partitioned by the parts' `inner` polygons.
 *  - bra.total / existing / new = sums over levels (so the loft counts only its measurable part).
 * Axis (aksemål): union of the axis polygons; existing/new by the parts' polygons clipped to their block's axis.
 * Rooms: one row per derived room (room records and unnamed faces; name '' when there is no record — the UI shows
 * its own "Uten navn"), areas as derived.
 */
import polygonClipping from 'polygon-clipping';
import type { MultiPolygon as ClipMultiPolygon } from 'polygon-clipping';
import type { AreaSplit, AreaSummary, DerivedBlock, DerivedDeck, DerivedRoom } from '../model/derived';
import type { Level, Variant, Vec2 } from '../model/types';
import { EPS, area, bbox, distancePointSegment, labelPoint, multiPolygonArea, pointInPolygon, signedArea } from './polygon';

export interface AreaInput {
  variant: Variant;
  blocks: DerivedBlock[];
  rooms: DerivedRoom[];
  decks: DerivedDeck[];
  /** Roof underside (absolute z) at a plan point, null outside every roof: `combinedUndersideAt(roofs, x, y)`. */
  undersideAt: (x: number, y: number) => number | null;
  /** Terrain height relative to the main floor: `terrainZAt(terrain, site, x, y)`. */
  terrainZ: (x: number, y: number) => number;
}

/** A simple polygon flagged existing / new, used by `partitionByParts`. */
export interface PartRegion {
  polygon: Vec2[];
  isNew: boolean;
}

/** MultiPolygon `[poly][ring][pt]`, open rings, ring 0 = outer. */
type MP = Vec2[][][];

const CELL = 0.25;
const STRIP = 0.6;
const MIN_FREE_HEIGHT = 1.9;
const DECK_MIN_HEIGHT = 0.5;
const TOL = 1e-9;

// ---------------------------------------------------------------------------
// MultiPolygon boolean operations with holes (polygon.ts only takes lists of simple polygons)
// ---------------------------------------------------------------------------

function openRing(ring: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last === undefined || Math.hypot(last[0] - p[0], last[1] - p[1]) > EPS) out.push([p[0], p[1]]);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= EPS) {
    out.pop();
  }
  return out;
}

function toClip(mp: MP): ClipMultiPolygon {
  const out: ClipMultiPolygon = [];
  for (const poly of mp) {
    const rings = poly.map(openRing);
    if (rings.length === 0 || rings[0].length < 3) continue;
    out.push([rings[0], ...rings.slice(1).filter((r) => r.length >= 3)]);
  }
  return out;
}

function fromClip(mp: ClipMultiPolygon): MP {
  return mp.map((poly) => poly.map((ring) => openRing(ring.map((p): Vec2 => [p[0], p[1]]))));
}

function mpUnion(a: MP, b: MP = []): MP {
  const ga = toClip(a);
  const gb = toClip(b);
  if (ga.length === 0 && gb.length === 0) return [];
  if (gb.length === 0) return fromClip(polygonClipping.union(ga));
  if (ga.length === 0) return fromClip(polygonClipping.union(gb));
  return fromClip(polygonClipping.union(ga, gb));
}

function mpIntersect(a: MP, b: MP): MP {
  const ga = toClip(a);
  const gb = toClip(b);
  if (ga.length === 0 || gb.length === 0) return [];
  return fromClip(polygonClipping.intersection(ga, gb));
}

function mpDifference(a: MP, b: MP): MP {
  const ga = toClip(a);
  if (ga.length === 0) return [];
  const gb = toClip(b);
  return fromClip(gb.length === 0 ? polygonClipping.union(ga) : polygonClipping.difference(ga, gb));
}

function boxesOverlap(p: { min: Vec2; max: Vec2 }, q: { min: Vec2; max: Vec2 }): boolean {
  return p.min[0] <= q.max[0] && q.min[0] <= p.max[0] && p.min[1] <= q.max[1] && q.min[1] <= p.max[1];
}

function mpBox(mp: MP): { min: Vec2; max: Vec2 } {
  return bbox(mp.flatMap((poly) => poly[0] ?? []));
}

// ---------------------------------------------------------------------------
// Partition by parts
// ---------------------------------------------------------------------------

function distanceToPolygon(p: Vec2, poly: Vec2[]): number {
  if (pointInPolygon(p, poly)) return 0;
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distancePointSegment(p, poly[j], poly[i]));
  return d;
}

/**
 * Splits `region` into existing and new: each point goes to the first part containing it, pieces outside every
 * part to the part nearest to their label point (existing when there are no parts). Results are lists of
 * disjoint polygons (not unioned).
 */
export function partitionByParts(region: MP, parts: PartRegion[]): { existing: MP; new: MP } {
  const existing: MP = [];
  const added: MP = [];
  const regionBox = mpBox(region);
  let claimed: MP = [];
  for (const part of parts) {
    if (part.polygon.length < 3) continue;
    const shape: MP = [[part.polygon]];
    if (region.length > 0 && boxesOverlap(regionBox, bbox(part.polygon))) {
      let piece = mpIntersect(region, shape);
      if (piece.length > 0 && claimed.length > 0) piece = mpDifference(piece, claimed);
      (part.isNew ? added : existing).push(...piece);
    }
    claimed = mpUnion(claimed, shape);
  }
  for (const poly of mpDifference(region, claimed)) {
    const p = labelPoint(poly[0], poly.slice(1));
    let nearest: PartRegion | undefined;
    let best = Infinity;
    for (const part of parts) {
      if (part.polygon.length < 3) continue;
      const d = distanceToPolygon(p, part.polygon);
      if (d < best) {
        best = d;
        nearest = part;
      }
    }
    (nearest?.isNew ? added : existing).push(poly);
  }
  return { existing, new: added };
}

/**
 * Part polygons of all blocks at one outline level, in partition order (see header): derived parts first, then
 * each block's whole outline as a fallback. 'axis' clips the parts' own polygons to their block's axis polygon.
 */
export function blockPartRegions(blocks: DerivedBlock[], outline: 'axis' | 'outer' | 'inner'): PartRegion[] {
  const parts: PartRegion[] = [];
  for (const b of blocks) {
    for (const p of b.parts) {
      if (outline === 'axis') {
        for (const piece of mpIntersect([[p.part.polygon]], [[b.axis]])) parts.push({ polygon: piece[0], isNew: p.part.isNew });
      } else {
        parts.push({ polygon: p[outline], isNew: p.part.isNew });
      }
    }
  }
  for (const b of blocks) parts.push({ polygon: b[outline], isNew: b.block.isNew });
  return parts;
}

/** Existing / new area of a polygon with holes (e.g. a room's inner polygon) by the partition rule. */
export function splitAreaByParts(polygon: Vec2[], holes: Vec2[][], parts: PartRegion[]): { existing: number; new: number } {
  const split = partitionByParts([[polygon, ...holes]], parts);
  return { existing: multiPolygonArea(split.existing), new: multiPolygonArea(split.new) };
}

// ---------------------------------------------------------------------------
// 0.25 m grid
// ---------------------------------------------------------------------------

/** Cell flags over cells i0..i0+ni-1 × j0..j0+nj-1; cell (i, j) covers [i·CELL, (i+1)·CELL] × [j·CELL, (j+1)·CELL]. */
interface CellMask {
  i0: number;
  j0: number;
  ni: number;
  nj: number;
  on: Uint8Array;
}

function maskOver(box: { min: Vec2; max: Vec2 }, margin: number): CellMask {
  const i0 = Math.floor((box.min[0] - margin) / CELL);
  const j0 = Math.floor((box.min[1] - margin) / CELL);
  const ni = Math.max(0, Math.ceil((box.max[0] + margin) / CELL) - i0);
  const nj = Math.max(0, Math.ceil((box.max[1] + margin) / CELL) - j0);
  return { i0, j0, ni, nj, on: new Uint8Array(ni * nj) };
}

function isOn(m: CellMask, i: number, j: number): boolean {
  const a = i - m.i0;
  const b = j - m.j0;
  return a >= 0 && b >= 0 && a < m.ni && b < m.nj && m.on[b * m.ni + a] === 1;
}

/** Mask of the cells whose centre satisfies `test`. */
function sampleCells(box: { min: Vec2; max: Vec2 }, margin: number, test: (x: number, y: number) => boolean): CellMask {
  const m = maskOver(box, margin);
  for (let b = 0; b < m.nj; b++) {
    for (let a = 0; a < m.ni; a++) {
      if (test((m.i0 + a + 0.5) * CELL, (m.j0 + b + 0.5) * CELL)) m.on[b * m.ni + a] = 1;
    }
  }
  return m;
}

/** Cells with a set sample whose centre lies within `radius` of the cell square. */
function dilate(m: CellMask, radius: number): CellMask {
  const reach = Math.floor((radius + CELL / 2) / CELL);
  const offsets: [number, number][] = [];
  for (let di = -reach; di <= reach; di++) {
    for (let dj = -reach; dj <= reach; dj++) {
      const dx = Math.max(0, Math.abs(di) * CELL - CELL / 2);
      const dy = Math.max(0, Math.abs(dj) * CELL - CELL / 2);
      if (dx * dx + dy * dy <= radius * radius + TOL) offsets.push([di, dj]);
    }
  }
  const out: CellMask = { ...m, on: new Uint8Array(m.ni * m.nj) };
  for (let b = 0; b < m.nj; b++) {
    for (let a = 0; a < m.ni; a++) {
      const i = m.i0 + a;
      const j = m.j0 + b;
      if (offsets.some(([di, dj]) => isOn(m, i + di, j + dj))) out.on[b * m.ni + a] = 1;
    }
  }
  return out;
}

/** Sutherland–Hodgman clip of a ring against one axis-aligned half-plane (coordinate `axis` ≥ / ≤ `bound`). */
function clipHalf(ring: Vec2[], axis: 0 | 1, bound: number, keepAbove: boolean): Vec2[] {
  const out: Vec2[] = [];
  const side = (p: Vec2): number => (keepAbove ? p[axis] - bound : bound - p[axis]);
  for (let k = 0; k < ring.length; k++) {
    const cur = ring[k];
    const prev = ring[(k + ring.length - 1) % ring.length];
    const sc = side(cur);
    const sp = side(prev);
    if ((sc >= 0) !== (sp >= 0)) {
      const t = sp / (sp - sc);
      out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
    }
    if (sc >= 0) out.push(cur);
  }
  return out;
}

/** Area of ring ∩ cell (i, j). Exact for any simple ring: degenerate SH edges along the cell cancel in the area. */
function ringAreaInCell(ring: Vec2[], i: number, j: number): number {
  let r = clipHalf(ring, 0, i * CELL, true);
  r = clipHalf(r, 0, (i + 1) * CELL, false);
  r = clipHalf(r, 1, j * CELL, true);
  r = clipHalf(r, 1, (j + 1) * CELL, false);
  return Math.abs(signedArea(r));
}

/** Area of the MultiPolygon inside the cells accepted by `counts`. */
function areaInCells(mp: MP, counts: (i: number, j: number) => boolean): number {
  let total = 0;
  for (const poly of mp) {
    poly.forEach((ring, r) => {
      if (ring.length < 3) return;
      const { min, max } = bbox(ring);
      const i1 = Math.ceil(max[0] / CELL);
      const j1 = Math.ceil(max[1] / CELL);
      for (let i = Math.floor(min[0] / CELL); i < i1; i++) {
        for (let j = Math.floor(min[1] / CELL); j < j1; j++) {
          if (counts(i, j)) total += (r === 0 ? 1 : -1) * ringAreaInCell(ring, i, j);
        }
      }
    });
  }
  return total;
}

// ---------------------------------------------------------------------------
// BYA
// ---------------------------------------------------------------------------

function deckArea(decks: DerivedDeck[], buildings: MP, terrainZ: AreaInput['terrainZ']): { existing: number; new: number } {
  const result = { existing: 0, new: 0 };
  let claimed = buildings;
  for (const deck of decks) {
    const shape: MP = [[deck.polygon]];
    const piece = mpDifference(shape, claimed);
    claimed = mpUnion(claimed, shape);
    if (piece.length === 0) continue;
    const high = sampleCells(mpBox(piece), 0, (x, y) => deck.topZ - terrainZ(x, y) > DECK_MIN_HEIGHT);
    const a = areaInCells(piece, (i, j) => isOn(high, i, j));
    if (deck.isNew) result.new += a;
    else result.existing += a;
  }
  return result;
}

function computeBya(input: AreaInput): AreaSummary['bya'] {
  const { blocks } = input;
  const union = mpUnion(blocks.map((b) => [b.outer]));
  const buildings = multiPolygonArea(union);
  const split = partitionByParts(union, blockPartRegions(blocks, 'outer'));
  const decks = deckArea(input.decks, union, input.terrainZ);
  const perBlock = blocks.map((b) => ({
    blockId: b.block.id,
    name: b.block.name,
    area: area(b.outer),
    isNew: b.block.isNew,
    parts: b.parts.map((p) => ({ partId: p.part.id, name: p.part.name, area: area(p.outer), isNew: p.part.isNew })),
  }));
  return {
    total: buildings + decks.existing + decks.new,
    existing: multiPolygonArea(split.existing) + decks.existing,
    new: multiPolygonArea(split.new) + decks.new,
    buildings,
    decks: decks.existing + decks.new,
    perBlock,
  };
}

// ---------------------------------------------------------------------------
// BRA
// ---------------------------------------------------------------------------

/** Floor region of a level inside the blocks' inner outlines (see header). */
export function levelRegion(level: Level, blocks: DerivedBlock[]): MP {
  const pieces: MP = [];
  for (const b of blocks) {
    if (b.block.levelId === level.id) {
      const replaced: MP = b.zones.filter((z) => z.kind === 'replace').map((z) => [z.polygon]);
      pieces.push(...mpDifference([[b.inner]], replaced));
    }
    for (const z of b.zones) {
      if (z.levelId === level.id) pieces.push(...mpIntersect([[z.polygon]], [[b.inner]]));
    }
  }
  return mpUnion(pieces);
}

/**
 * Measurable-area function for one level (see header): returns the measurable area of a MultiPolygon lying
 * inside `region`. The free-height grid is sampled once per level over the region.
 */
function measurer(region: MP, level: Level, undersideAt: AreaInput['undersideAt']): (mp: MP) => number {
  if (level.ceilingHeight !== undefined) {
    const all = level.ceilingHeight >= MIN_FREE_HEIGHT - TOL;
    return (mp) => (all ? multiPolygonArea(mp) : 0);
  }
  if (region.length === 0) return () => 0;
  const free = sampleCells(mpBox(region), STRIP + CELL, (x, y) => {
    const u = undersideAt(x, y);
    return u === null || u - level.elevation >= MIN_FREE_HEIGHT - TOL;
  });
  if (free.on.every((v) => v === 1)) return (mp) => multiPolygonArea(mp);
  const counted = dilate(free, STRIP);
  return (mp) => areaInCells(mp, (i, j) => isOn(counted, i, j));
}

function computeBra(input: AreaInput): AreaSummary['bra'] {
  const innerParts = blockPartRegions(input.blocks, 'inner');
  const perLevel: AreaSummary['bra']['perLevel'] = [];
  const sum: AreaSplit = { total: 0, existing: 0, new: 0 };
  for (const level of input.variant.levels) {
    const region = levelRegion(level, input.blocks);
    const openings: MP = input.rooms
      .filter((r) => r.room?.type === 'apning' && r.levelId === level.id && r.polygon.length >= 3)
      .map((r) => [r.polygon, ...r.holes]);
    const usable = openings.length > 0 ? mpDifference(region, openings) : region;
    const split = partitionByParts(usable, innerParts);
    const measure = measurer(usable, level, input.undersideAt);
    const existing = measure(split.existing);
    const added = measure(split.new);
    perLevel.push({ levelId: level.id, name: level.name, gross: multiPolygonArea(region), area: existing + added });
    sum.existing += existing;
    sum.new += added;
    sum.total += existing + added;
  }
  return { ...sum, perLevel };
}

// ---------------------------------------------------------------------------
// Axis, rooms, summary
// ---------------------------------------------------------------------------

function computeAxis(blocks: DerivedBlock[]): AreaSplit {
  const union = mpUnion(blocks.map((b) => [b.axis]));
  const split = partitionByParts(union, blockPartRegions(blocks, 'axis'));
  return { total: multiPolygonArea(union), existing: multiPolygonArea(split.existing), new: multiPolygonArea(split.new) };
}

export function computeAreas(input: AreaInput): AreaSummary {
  return {
    bya: computeBya(input),
    bra: computeBra(input),
    axis: computeAxis(input.blocks),
    rooms: input.rooms.map((r) => ({
      roomId: r.id,
      name: r.room?.name ?? '',
      levelId: r.levelId,
      area: r.area,
      areaExisting: r.areaExisting,
      areaNew: r.areaNew,
      isNew: r.isNew,
    })),
  };
}
