/**
 * Decks, railings, steps, hot tubs (docs/architecture.md "Derivation pipeline" step 6, schema 2 of
 * docs/phase2-plan.md §2) and posts / beams / chimney / stairs (step 7). Pure functions; plan frame in metres, z
 * absolute (relative to the main floor).
 *
 * Both entry points take an optional last `opts` argument so the module can be used and tested on its own:
 * `opts.terrainZ` replaces `terrainZAt(terrain, site, x, y)`, `opts.undersideAt` replaces
 * `combinedUndersideAt(roofs, x, y)`, and `opts.blocks` are the derived blocks that trim the decks (none = untrimmed).
 *
 * Decks
 *  - `pieces` = the stored outline (made CCW) minus the outer outline of every block (cladding face; the axis when a
 *    block has no outer outline) whose box overlaps the deck; outer rings CCW, holes CW. When nothing overlaps, the
 *    outline itself (no boolean operation); when the clipping fails, the outline itself (reported fallback).
 *  - `skirtBottomZ[piece][vertex]` = terrain − 0.05 at every vertex of the piece's outer ring.
 *  - Deck boards run along the longer side of the stored outline's bbox ('x' on a tie).
 *  - Free runs: every stored edge is cut at its crossings with the block outlines, at the ends of collinear overlaps
 *    (1 mm) and at block vertices lying on it (1 mm); an interval is free when its midpoint is outside every outline
 *    and more than 1 mm from every outline edge. Adjacent free intervals of one edge merge; runs shorter than 1 cm are
 *    dropped. This equals "the trimmed ring's edges not overlapping a block outer edge", with the stored edge's id.
 * Railing (one per deck with `deck.railing`, id `${deckId}/railing`)
 *  - Runs = free runs of edges not in `noRailingEdges`, minus the gaps of the deck's (not blocked) steps
 *    [offset − width/2, offset + width/2] on their edge. Runs are taken in ring order and chained where one ends
 *    where the next starts (a deck corner); the chain that ends at the start of the first one is joined to it, so a
 *    railing round a whole free deck closes. Panels = the straight segments of every chain; posts at the chain ends,
 *    at its corners and evenly between them so no span exceeds 1.5 m (posts closer than 1 µm merge).
 * Steps (`DeckSteps`, hosted on their edge like an opening)
 *  - at = edge start + offset along the edge; outward = the edge's outward normal (away from the deck interior);
 *    width as stored. blocked = no free run of that edge contains the centre (1 µm) — warning 'deck-steps-blocked',
 *    no railing gap. Steps on an unknown (or zero-length) edge are not derived (warning only).
 *  - risers = ceil(drop / 0.18) with drop = deck top − terrain 0.5 m outside the centre (0 when the terrain is not
 *    below the deck); risers − 1 treads of `going` 0.3, the k-th one riserHeight·k below the deck top, stepping
 *    outward from the deck edge (the last riser lands on the terrain).
 *  - Hot tub base: top of the first deck whose pieces contain the centre, else the terrain at the centre.
 * Structure
 *  - Chimney roofExitZ: undersideAt(centre) + the roof thickness of the first block whose polygon contains the
 *    centre; null when no block contains it or no roof covers it.
 *  - Stairs: n = ceil(|dz| / 0.18) treads (at least 1) over the footprint length along `upDirection`; tread i
 *    (0-based, from the bottom) spans [i, i + 1]·going and lies at fromZ + (i + 1)·riser, so the top tread is at the
 *    arrival floor. Arrow from the centre of the first tread to the centre of the last.
 */
import type { Cardinal, Deck, Site, StructureElement, TerrainAsset, Variant, Vec2, Vec3 } from '../model/types';
import type {
  DerivedBlock,
  DerivedDeck,
  DerivedHotTub,
  DerivedRailing,
  DerivedRoof,
  DerivedSteps,
  DerivedStructure,
  DerivedVariant,
  ModelWarning,
} from '../model/derived';
import { bbox, differenceMulti, distancePointSegment, ensureCCW, isCCW, pointInPolygon, segmentIntersection, signedArea, withClipFallback } from './polygon';
import type { MultiPoly } from './polygon';
import { combinedUndersideAt } from './roof';
import { terrainZAt } from './terrain';

export type TerrainZFn = (x: number, y: number) => number;
export type UndersideFn = (x: number, y: number) => number | null;

const DECK_THICKNESS = 0.15;
const SKIRT_BELOW_TERRAIN = 0.05;
const MAX_POST_SPACING = 1.5;
const MAX_RISER = 0.18;
const STEP_GOING = 0.3;
/** Distance (m) outside the steps' centre where the terrain under the steps is probed. */
const STEP_PROBE = 0.5;
const HOT_TUB_HEIGHT = 1.05;
/** Lengths below this (m) are treated as zero. */
const TINY = 1e-6;
/** A deck edge within this distance (m) of a block outline runs along the building (no railing). */
const TOUCH = 0.001;
/** Free runs shorter than this (m) are dropped. */
const MIN_RUN = 0.01;

const along = (p: Vec2, u: Vec2, s: number): Vec2 => [p[0] + u[0] * s, p[1] + u[1] * s];
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const at3 = (p: Vec2, z: number): Vec3 => [p[0], p[1], z];
const samePoint = (a: Vec2, b: Vec2): boolean => dist(a, b) <= TINY;

/** ceil with a tolerance, so 0.9 / 0.18 = 5.000000000000001 gives 5. */
const ceilTol = (x: number): number => Math.ceil(x - 1e-9);

// ---------------------------------------------------------------------------
// Polyline helpers
// ---------------------------------------------------------------------------

interface Polyline {
  pts: Vec2[];
  /** Cumulative distance at each point. */
  cum: number[];
  total: number;
}

function polyline(pts: Vec2[]): Polyline {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return { pts, cum, total: cum[cum.length - 1] ?? 0 };
}

/** Point at distance s along the polyline (clamped). */
function pointAt(pl: Polyline, s: number): Vec2 {
  const n = pl.pts.length;
  if (n === 0) return [0, 0];
  if (n === 1) return pl.pts[0];
  const d = Math.min(Math.max(s, 0), pl.total);
  let i = 0;
  while (i < n - 2 && (pl.cum[i + 1] < d || pl.cum[i + 1] - pl.cum[i] < TINY)) i++;
  const a = pl.pts[i];
  const b = pl.pts[i + 1];
  const len = pl.cum[i + 1] - pl.cum[i];
  const u: Vec2 = len < TINY ? [1, 0] : [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  return along(a, u, d - pl.cum[i]);
}

/** Distances of the polyline vertices strictly inside (s0, s1). */
function cornersBetween(pl: Polyline, s0: number, s1: number): number[] {
  return pl.cum.filter((c, i) => i > 0 && i < pl.pts.length - 1 && c > s0 + TINY && c < s1 - TINY);
}

/** Post distances along a chain: ends, inner corners and evenly spaced posts (spans ≤ 1.5 m). */
function postDistances(pl: Polyline): number[] {
  const keys = [0, ...cornersBetween(pl, 0, pl.total), pl.total];
  const out: number[] = [0];
  for (let i = 0; i + 1 < keys.length; i++) {
    const span = keys[i + 1] - keys[i];
    const n = Math.max(1, ceilTol(span / MAX_POST_SPACING));
    for (let k = 1; k <= n; k++) out.push(keys[i] + (span * k) / n);
  }
  return out;
}

/** [s0, s1] minus the given intervals, as sorted disjoint intervals longer than TINY. */
function subtractIntervals(s0: number, s1: number, cuts: [number, number][]): [number, number][] {
  let pieces: [number, number][] = [[s0, s1]];
  for (const [c0, c1] of cuts) {
    const lo = Math.min(c0, c1);
    const hi = Math.max(c0, c1);
    const next: [number, number][] = [];
    for (const [a, b] of pieces) {
      if (hi <= a || lo >= b) {
        next.push([a, b]);
        continue;
      }
      if (lo - a > TINY) next.push([a, lo]);
      if (b - hi > TINY) next.push([hi, b]);
    }
    pieces = next;
  }
  return pieces.sort((p, q) => p[0] - q[0]);
}

// ---------------------------------------------------------------------------
// Decks: pieces and free runs
// ---------------------------------------------------------------------------

/** One stored deck edge (vertex i → i + 1). */
interface DeckEdge {
  id: string;
  a: Vec2;
  b: Vec2;
  length: number;
  /** Unit direction a → b. */
  u: Vec2;
  /** Unit normal pointing away from the deck. */
  outward: Vec2;
}

function deckEdges(deck: Deck): DeckEdge[] {
  const pts = deck.polygon.map((v) => v.p);
  const n = pts.length;
  const ccw = signedArea(pts) >= 0;
  return deck.polygon.map((v, i) => {
    const a = v.p;
    const b = pts[(i + 1) % n];
    const length = dist(a, b);
    const u: Vec2 = length < TINY ? [1, 0] : [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    // For a CCW outline the inside is on the left, so the outward normal is the right one.
    const outward: Vec2 = ccw ? [u[1], -u[0]] : [-u[1], u[0]];
    return { id: v.id, a, b, length, u, outward };
  });
}

/** Outer outlines of the blocks (the axis when a block has none): the rings that trim decks. */
function buildingRings(blocks: readonly DerivedBlock[]): Vec2[][] {
  return blocks.map((db) => (db.outer.length >= 3 ? db.outer : db.axis)).filter((r) => r.length >= 3);
}

type Box = { min: Vec2; max: Vec2 };

function boxesOverlap(a: Box, b: Box, margin = 0): boolean {
  return a.min[0] <= b.max[0] + margin && b.min[0] <= a.max[0] + margin && a.min[1] <= b.max[1] + margin && b.min[1] <= a.max[1] + margin;
}

/** Rings: outer CCW, holes CW; degenerate rings dropped. */
function orientPieces(mp: MultiPoly): MultiPoly {
  const out: MultiPoly = [];
  for (const poly of mp) {
    const outer = poly[0];
    if (!outer || outer.length < 3 || Math.abs(signedArea(outer)) < 1e-9) continue;
    const holes = poly.slice(1).filter((h) => h.length >= 3 && Math.abs(signedArea(h)) >= 1e-9);
    out.push([ensureCCW(outer), ...holes.map((h) => (isCCW(h) ? [...h].reverse() : h))]);
  }
  return out;
}

/** The deck outline minus the overlapping block outlines (see the header). */
function deckPieces(outline: Vec2[], rings: Vec2[][]): MultiPoly {
  const box = bbox(outline);
  const cutters = rings.filter((r) => boxesOverlap(box, bbox(r)));
  const own: MultiPoly = [[ensureCCW(outline)]];
  if (cutters.length === 0) return own;
  return orientPieces(withClipFallback('deck minus buildings', () => differenceMulti(own, ...cutters.map((r): MultiPoly => [[r]])), () => own));
}

/** Whether p is inside a ring or within TOUCH of its boundary. */
function covers(ring: Vec2[], p: Vec2): boolean {
  if (pointInPolygon(p, ring)) return true;
  for (let i = 0; i < ring.length; i++) if (distancePointSegment(p, ring[i], ring[(i + 1) % ring.length]) <= TOUCH) return true;
  return false;
}

/** Free intervals [s0, s1] of one stored edge (see the header). */
function freeIntervals(e: DeckEdge, rings: Vec2[][]): [number, number][] {
  if (e.length < TINY) return [];
  const box = bbox([e.a, e.b]);
  const close = rings.filter((r) => boxesOverlap(box, bbox(r), TOUCH));
  const cuts: number[] = [0, e.length];
  const sOf = (p: Vec2) => (p[0] - e.a[0]) * e.u[0] + (p[1] - e.a[1]) * e.u[1];
  for (const ring of close) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      if (distancePointSegment(p, e.a, e.b) <= TOUCH) cuts.push(sOf(p));
      const hit = segmentIntersection(e.a, e.b, p, q);
      if (hit !== null) cuts.push(hit.ta * e.length);
      // A collinear stretch (within TOUCH) that reaches past an end of the deck edge has no vertex on it: its ends
      // are the deck edge's ends (already cuts), so nothing more is needed here.
    }
  }
  const sorted = cuts.map((s) => Math.min(e.length, Math.max(0, s))).sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < sorted.length; k++) {
    const s0 = sorted[k];
    const s1 = sorted[k + 1];
    if (s1 - s0 < TINY) continue;
    const m = along(e.a, e.u, (s0 + s1) / 2);
    if (close.some((ring) => covers(ring, m))) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - s0) < TINY) last[1] = s1;
    else out.push([s0, s1]);
  }
  return out.filter(([s0, s1]) => s1 - s0 >= MIN_RUN);
}

function deriveDeck(deck: Deck, edges: DeckEdge[], rings: Vec2[][], terrainZ: TerrainZFn): DerivedDeck {
  const polygon = deck.polygon.map((v): Vec2 => [v.p[0], v.p[1]]);
  const usable = polygon.length >= 3 && Math.abs(signedArea(polygon)) > 1e-9;
  const pieces = usable ? deckPieces(polygon, rings) : [];
  const freeRuns: DerivedDeck['freeRuns'] = [];
  if (usable) {
    for (const e of edges) {
      for (const [s0, s1] of freeIntervals(e, rings)) freeRuns.push({ edgeId: e.id, a: along(e.a, e.u, s0), b: along(e.a, e.u, s1), s0, s1 });
    }
  }
  const box: Box = polygon.length > 0 ? bbox(polygon) : { min: [0, 0], max: [0, 0] };
  return {
    id: deck.id,
    polygon,
    vertexIds: deck.polygon.map((v) => v.id),
    pieces,
    topZ: deck.topHeight,
    thickness: DECK_THICKNESS,
    skirtBottomZ: pieces.map((piece) => (piece[0] ?? []).map((p) => terrainZ(p[0], p[1]) - SKIRT_BELOW_TERRAIN)),
    boardDirection: box.max[0] - box.min[0] >= box.max[1] - box.min[1] ? 'x' : 'y',
    isNew: deck.isNew,
    freeRuns,
  };
}

// ---------------------------------------------------------------------------
// Steps and railings
// ---------------------------------------------------------------------------

function deriveSteps(deck: Deck, s: Deck['steps'][number], e: DeckEdge, derived: DerivedDeck, terrainZ: TerrainZFn): DerivedSteps {
  const at = along(e.a, e.u, s.offset);
  const outward: Vec2 = [e.outward[0], e.outward[1]];
  const foot = along(at, outward, STEP_PROBE);
  const topZ = deck.topHeight;
  const bottomZ = terrainZ(foot[0], foot[1]);
  const drop = topZ - bottomZ;
  const risers = drop > TINY ? ceilTol(drop / MAX_RISER) : 0;
  const riserHeight = risers > 0 ? drop / risers : 0;
  const width = Math.max(0, s.width);
  const treads: DerivedSteps['treads'] = [];
  for (let k = 1; k < risers; k++) {
    const d0 = (k - 1) * STEP_GOING;
    const d1 = k * STEP_GOING;
    const a = along(at, e.u, -width / 2);
    const b = along(at, e.u, width / 2);
    const poly: Vec2[] = [along(a, outward, d0), along(b, outward, d0), along(b, outward, d1), along(a, outward, d1)];
    treads.push({ polygon: ensureCCW(poly), z: topZ - k * riserHeight });
  }
  const blocked = !derived.freeRuns.some((r) => r.edgeId === e.id && s.offset >= r.s0 - TINY && s.offset <= r.s1 + TINY);
  return { id: s.id, deckId: deck.id, edgeId: e.id, at, outward, width, topZ, bottomZ, risers, riserHeight, going: STEP_GOING, treads, blocked };
}

/** The runs that carry the railing, as straight segments in ring order (see the header). */
function railingSegments(deck: Deck, derived: DerivedDeck, edges: DeckEdge[], steps: { edgeId: string; offset: number; width: number }[]): { a: Vec2; b: Vec2 }[] {
  const skip = new Set(deck.noRailingEdges);
  const out: { a: Vec2; b: Vec2 }[] = [];
  for (const e of edges) {
    if (skip.has(e.id)) continue;
    const gaps = steps.filter((s) => s.edgeId === e.id).map((s): [number, number] => [s.offset - s.width / 2, s.offset + s.width / 2]);
    for (const run of derived.freeRuns) {
      if (run.edgeId !== e.id) continue;
      for (const [s0, s1] of subtractIntervals(run.s0, run.s1, gaps)) out.push({ a: along(e.a, e.u, s0), b: along(e.a, e.u, s1) });
    }
  }
  return out;
}

/** Chains of segments that meet end to start (the last chain joins the first when it ends where that one starts). */
function chainSegments(segs: { a: Vec2; b: Vec2 }[]): Vec2[][] {
  const chains: Vec2[][] = [];
  for (const s of segs) {
    const last = chains[chains.length - 1];
    if (last && samePoint(last[last.length - 1], s.a)) last.push(s.b);
    else chains.push([s.a, s.b]);
  }
  if (chains.length > 1) {
    const first = chains[0];
    const last = chains[chains.length - 1];
    if (samePoint(last[last.length - 1], first[0])) {
      chains[0] = [...last, ...first.slice(1)];
      chains.pop();
    }
  }
  return chains;
}

function deriveRailing(deck: Deck, derived: DerivedDeck, edges: DeckEdge[], gaps: { edgeId: string; offset: number; width: number }[]): DerivedRailing | null {
  if (!deck.railing) return null;
  const baseZ = deck.topHeight;
  const panels: DerivedRailing['panels'] = [];
  const posts: Vec3[] = [];
  const addPost = (p: Vec2) => {
    if (!posts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= TINY)) posts.push(at3(p, baseZ));
  };
  for (const chain of chainSegments(railingSegments(deck, derived, edges, gaps))) {
    for (let i = 0; i + 1 < chain.length; i++) {
      if (dist(chain[i], chain[i + 1]) > TINY) panels.push({ a: at3(chain[i], baseZ), b: at3(chain[i + 1], baseZ) });
    }
    const pl = polyline(chain);
    for (const d of postDistances(pl)) addPost(pointAt(pl, d));
  }
  return { id: `${deck.id}/railing`, deckId: deck.id, baseZ, height: deck.railing.height, style: deck.railing.style, panels, posts, isNew: deck.isNew };
}

function inPieces(p: Vec2, pieces: Vec2[][][]): boolean {
  return pieces.some((poly) => poly.length > 0 && pointInPolygon(p, poly[0]) && !poly.slice(1).some((h) => h.length >= 3 && pointInPolygon(p, h)));
}

function deriveHotTub(t: Variant['outdoor']['hotTubs'][number], decks: DerivedDeck[], terrainZ: TerrainZFn): DerivedHotTub {
  const deck = decks.find((d) => inPieces(t.centre, d.pieces));
  const baseZ = deck ? deck.topZ : terrainZ(t.centre[0], t.centre[1]);
  return { id: t.id, centre: [t.centre[0], t.centre[1]], diameter: t.diameter, baseZ, rimZ: baseZ + HOT_TUB_HEIGHT, isNew: t.isNew };
}

export interface OutdoorOptions {
  terrainZ?: TerrainZFn;
  /** Derived blocks whose outer outlines trim the decks (omitted = untrimmed: every deck edge is free). */
  blocks?: readonly DerivedBlock[];
}

/**
 * Step 6 with its warnings: decks (pieces trimmed by the buildings, skirts from the terrain, free runs), one railing
 * per deck with `railing`, the deck steps, hot tubs; 'deck-steps-blocked' for steps not on a free run.
 */
export function deriveOutdoorWithWarnings(
  variant: Variant,
  site: Site,
  terrain: TerrainAsset | null,
  opts: OutdoorOptions = {},
): { outdoor: DerivedVariant['outdoor']; warnings: ModelWarning[] } {
  const terrainZ = opts.terrainZ ?? ((x: number, y: number) => terrainZAt(terrain, site, x, y));
  const rings = buildingRings(opts.blocks ?? []);
  const warnings: ModelWarning[] = [];
  const decks: DerivedDeck[] = [];
  const railings: DerivedRailing[] = [];
  const steps: DerivedSteps[] = [];
  for (const deck of variant.outdoor.decks) {
    const edges = deckEdges(deck);
    const derived = deriveDeck(deck, edges, rings, terrainZ);
    decks.push(derived);
    const gaps: { edgeId: string; offset: number; width: number }[] = [];
    for (const s of deck.steps) {
      const e = edges.find((x) => x.id === s.edgeId);
      if (!e || e.length < TINY || derived.pieces.length === 0) {
        warnings.push({ kind: 'deck-steps-blocked', stepsId: s.id, deckId: deck.id });
        continue;
      }
      const d = deriveSteps(deck, s, e, derived, terrainZ);
      if (d.blocked) warnings.push({ kind: 'deck-steps-blocked', stepsId: s.id, deckId: deck.id });
      else gaps.push({ edgeId: e.id, offset: s.offset, width: d.width });
      steps.push(d);
    }
    const railing = deriveRailing(deck, derived, edges, gaps);
    if (railing) railings.push(railing);
  }
  return {
    outdoor: { decks, railings, steps, hotTubs: variant.outdoor.hotTubs.map((t) => deriveHotTub(t, decks, terrainZ)) },
    warnings,
  };
}

/** Step 6: decks, railings, steps and hot tubs (see `deriveOutdoorWithWarnings`). */
export function deriveOutdoor(variant: Variant, site: Site, terrain: TerrainAsset | null, opts: OutdoorOptions = {}): DerivedVariant['outdoor'] {
  return deriveOutdoorWithWarnings(variant, site, terrain, opts).outdoor;
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

const UP_DIR: Record<Cardinal, Vec2> = { E: [1, 0], W: [-1, 0], N: [0, 1], S: [0, -1] };

type StairElement = Extract<StructureElement, { kind: 'stair' }>;

function deriveStair(el: StairElement, elevation: (id: string) => number): DerivedStructure {
  const [x0, y0] = el.min;
  const [x1, y1] = el.max;
  const fromZ = elevation(el.fromLevelId);
  const toZ = elevation(el.toLevelId);
  const dz = toZ - fromZ;
  const n = Math.max(1, ceilTol(Math.abs(dz) / MAX_RISER));
  const riser = dz / n;
  const u = UP_DIR[el.upDirection];
  const alongX = el.upDirection === 'E' || el.upDirection === 'W';
  const length = alongX ? x1 - x0 : y1 - y0;
  const going = length / n;
  // Bottom edge of the footprint (the end the stair starts from) and its across range.
  const bottom = u[0] + u[1] > 0 ? (alongX ? x0 : y0) : alongX ? x1 : y1;
  const sign = u[0] + u[1];
  const [c0, c1] = alongX ? [y0, y1] : [x0, x1];
  const point = (s: number, c: number): Vec2 => (alongX ? [bottom + sign * s, c] : [c, bottom + sign * s]);
  const treads = Array.from({ length: n }, (_, i) => ({
    polygon: ensureCCW([point(i * going, c0), point((i + 1) * going, c0), point((i + 1) * going, c1), point(i * going, c1)]),
    z: fromZ + (i + 1) * riser,
  }));
  const mid = (c0 + c1) / 2;
  return {
    id: el.id,
    kind: 'stair',
    element: el,
    footprint: [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    fromZ,
    toZ,
    upDirection: el.upDirection,
    riser,
    going,
    treads,
    arrow: { a: point(going / 2, mid), b: point(length - going / 2, mid) },
    isNew: el.isNew,
  };
}

/** Step 7: posts, beams and chimneys with absolute z (chimney roof exit), stairs as treads with an arrow. */
export function deriveStructure(variant: Variant, roofs: DerivedRoof[], opts: { undersideAt?: UndersideFn } = {}): DerivedStructure[] {
  const undersideAt = opts.undersideAt ?? ((x: number, y: number) => combinedUndersideAt(roofs, x, y));
  const levels = new Map(variant.levels.map((l) => [l.id, l.elevation]));
  const elevation = (id: string) => levels.get(id) ?? 0;
  return variant.structure.map((el): DerivedStructure => {
    switch (el.kind) {
      case 'post':
        return { id: el.id, kind: 'post', element: el, position: el.position, size: el.size, bottomZ: el.bottom, topZ: el.top, isNew: el.isNew };
      case 'beam':
        return { id: el.id, kind: 'beam', element: el, a: el.a, b: el.b, width: el.width, bottomZ: el.bottom, topZ: el.top, isNew: el.isNew };
      case 'chimney': {
        const c: Vec2 = [(el.min[0] + el.max[0]) / 2, (el.min[1] + el.max[1]) / 2];
        const block = variant.blocks.find((b) => b.polygon.length >= 3 && pointInPolygon(c, b.polygon.map((v) => v.p)));
        const underside = block ? undersideAt(c[0], c[1]) : null;
        const roofExitZ = block && underside !== null ? underside + block.roof.thickness : null;
        return { id: el.id, kind: 'chimney', element: el, min: el.min, max: el.max, bottomZ: el.bottom, topZ: el.top, roofExitZ, isNew: el.isNew };
      }
      case 'stair':
        return deriveStair(el, elevation);
    }
  });
}
