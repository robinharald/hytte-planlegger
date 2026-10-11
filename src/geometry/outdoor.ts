/**
 * Decks, railings, steps, hot tubs (docs/architecture.md "Derivation pipeline" step 6) and posts / beams / chimney /
 * stairs (step 7). Pure functions; plan frame in metres, z absolute (relative to the main floor).
 *
 * Both entry points take an optional last `opts` argument so the module can be used and tested on its own:
 * `opts.terrainZ` replaces `terrainZAt(terrain, site, x, y)` and `opts.undersideAt` replaces
 * `combinedUndersideAt(roofs, x, y)`.
 *
 * Decisions where the architecture is silent:
 *  - Deck boards run along the longer side of the deck's bbox ('x' on a tie).
 *  - Railing gaps are clamped to the path and merged where they overlap; panels are the straight runs of the solid
 *    parts (split at path corners); posts at both ends of every solid part, at the corners inside it and evenly
 *    between them so no span exceeds 1.5 m. A railing whose deck is missing stands on the terrain at its first point.
 *  - Steps (gaps with `steps: true`, id `${railingId}/steps/${gapIndex}` with the index in `railing.gaps`): outward =
 *    the normal of the path at the gap centre whose 0.5 m probe lies outside the deck (else the right normal);
 *    risers = ceil(drop / 0.18) (0 when the terrain is not below the deck); risers − 1 treads of `going` 0.3, the
 *    k-th one riserHeight·k below the deck top, stepping outward from the deck edge (the last riser lands on the
 *    terrain).
 *  - Hot tub base: top of the first deck containing the centre, else the terrain at the centre.
 *  - Chimney roofExitZ: undersideAt(centre) + the roof thickness of the first block whose polygon contains the
 *    centre; null when no block contains it or no roof covers it.
 *  - Stairs: n = ceil(|dz| / 0.18) treads (at least 1) over the footprint length along `upDirection`; tread i
 *    (0-based, from the bottom) spans [i, i + 1]·going and lies at fromZ + (i + 1)·riser, so the top tread is at the
 *    arrival floor. Arrow from the centre of the first tread to the centre of the last.
 */
import type { Cardinal, Site, StructureElement, TerrainAsset, Variant, Vec2, Vec3 } from '../model/types';
import type { DerivedDeck, DerivedHotTub, DerivedRailing, DerivedRoof, DerivedSteps, DerivedStructure, DerivedVariant } from '../model/derived';
import { bbox, ensureCCW, pointInPolygon } from './polygon';
import { combinedUndersideAt } from './roof';
import { terrainZAt } from './terrain';

export type TerrainZFn = (x: number, y: number) => number;
export type UndersideFn = (x: number, y: number) => number | null;

const DECK_THICKNESS = 0.15;
const SKIRT_BELOW_TERRAIN = 0.05;
const MAX_POST_SPACING = 1.5;
const MAX_RISER = 0.18;
const STEP_GOING = 0.3;
/** Distance (m) outside the gap centre where the terrain under the steps is probed. */
const STEP_PROBE = 0.5;
const HOT_TUB_HEIGHT = 1.05;
/** Lengths below this (m) are treated as zero. */
const TINY = 1e-6;

const along = (p: Vec2, u: Vec2, s: number): Vec2 => [p[0] + u[0] * s, p[1] + u[1] * s];
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const at3 = (p: Vec2, z: number): Vec3 => [p[0], p[1], z];

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

/** Point and unit tangent at distance s along the polyline (clamped). */
function pointAt(pl: Polyline, s: number): { p: Vec2; u: Vec2 } {
  const n = pl.pts.length;
  if (n === 0) return { p: [0, 0], u: [1, 0] };
  if (n === 1) return { p: pl.pts[0], u: [1, 0] };
  const d = Math.min(Math.max(s, 0), pl.total);
  let i = 0;
  while (i < n - 2 && (pl.cum[i + 1] < d || pl.cum[i + 1] - pl.cum[i] < TINY)) i++;
  const a = pl.pts[i];
  const b = pl.pts[i + 1];
  const len = pl.cum[i + 1] - pl.cum[i];
  const u: Vec2 = len < TINY ? [1, 0] : [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  return { p: along(a, u, d - pl.cum[i]), u };
}

/** Distances of the path vertices strictly inside (s0, s1). */
function cornersBetween(pl: Polyline, s0: number, s1: number): number[] {
  return pl.cum.filter((c, i) => i > 0 && i < pl.pts.length - 1 && c > s0 + TINY && c < s1 - TINY);
}

/** Solid (non-gap) intervals of [0, total]. */
function solidIntervals(total: number, gaps: { from: number; to: number }[]): [number, number][] {
  const clamped = gaps
    .map((g) => [Math.max(0, Math.min(g.from, g.to)), Math.min(total, Math.max(g.from, g.to))] as [number, number])
    .filter(([f, t]) => t - f > TINY)
    .sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let cur = 0;
  for (const [f, t] of clamped) {
    if (f - cur > TINY) out.push([cur, f]);
    cur = Math.max(cur, t);
  }
  if (total - cur > TINY) out.push([cur, total]);
  return out;
}

// ---------------------------------------------------------------------------
// Decks, railings, steps, hot tubs
// ---------------------------------------------------------------------------

function deriveDeck(deck: Variant['outdoor']['decks'][number], terrainZ: TerrainZFn): DerivedDeck {
  const { min, max } = bbox(deck.polygon);
  return {
    id: deck.id,
    polygon: deck.polygon.map((p): Vec2 => [p[0], p[1]]),
    topZ: deck.topHeight,
    thickness: DECK_THICKNESS,
    skirtBottomZ: deck.polygon.map((p) => terrainZ(p[0], p[1]) - SKIRT_BELOW_TERRAIN),
    boardDirection: max[0] - min[0] >= max[1] - min[1] ? 'x' : 'y',
    isNew: deck.isNew,
  };
}

/** Post distances of one solid interval: ends, inner corners and evenly spaced posts (spans ≤ 1.5 m). */
function postDistances(pl: Polyline, s0: number, s1: number): number[] {
  const keys = [s0, ...cornersBetween(pl, s0, s1), s1];
  const out: number[] = [s0];
  for (let i = 0; i + 1 < keys.length; i++) {
    const span = keys[i + 1] - keys[i];
    const n = Math.max(1, ceilTol(span / MAX_POST_SPACING));
    for (let k = 1; k <= n; k++) out.push(keys[i] + (span * k) / n);
  }
  return out;
}

function deriveSteps(
  railingId: string,
  gapIndex: number,
  gap: { from: number; to: number },
  pl: Polyline,
  deckPolygon: Vec2[] | null,
  topZ: number,
  terrainZ: TerrainZFn,
): DerivedSteps {
  const from = Math.max(0, Math.min(gap.from, gap.to));
  const to = Math.min(pl.total, Math.max(gap.from, gap.to));
  const { p: centre, u } = pointAt(pl, (from + to) / 2);
  const right: Vec2 = [u[1], -u[0]];
  const left: Vec2 = [-u[1], u[0]];
  const outward = deckPolygon !== null && pointInPolygon(along(centre, right, STEP_PROBE), deckPolygon) ? left : right;
  const foot = along(centre, outward, STEP_PROBE);
  const bottomZ = terrainZ(foot[0], foot[1]);
  const drop = topZ - bottomZ;
  const risers = drop > TINY ? ceilTol(drop / MAX_RISER) : 0;
  const riserHeight = risers > 0 ? drop / risers : 0;
  const width = Math.max(0, to - from);
  const treads: DerivedSteps['treads'] = [];
  for (let k = 1; k < risers; k++) {
    const d0 = (k - 1) * STEP_GOING;
    const d1 = k * STEP_GOING;
    const a = along(centre, u, -width / 2);
    const b = along(centre, u, width / 2);
    const poly: Vec2[] = [along(a, outward, d0), along(b, outward, d0), along(b, outward, d1), along(a, outward, d1)];
    treads.push({ polygon: ensureCCW(poly), z: topZ - k * riserHeight });
  }
  return {
    id: `${railingId}/steps/${gapIndex}`,
    at: centre,
    outward,
    width,
    topZ,
    bottomZ,
    risers,
    riserHeight,
    going: STEP_GOING,
    treads,
  };
}

function deriveRailing(r: Variant['outdoor']['railings'][number], decks: DerivedDeck[], terrainZ: TerrainZFn): DerivedRailing {
  const pl = polyline(r.path);
  const deck = decks.find((d) => d.id === r.deckId);
  const start = r.path[0] ?? [0, 0];
  const baseZ = deck ? deck.topZ : terrainZ(start[0], start[1]);
  const panels: DerivedRailing['panels'] = [];
  const postDs: number[] = [];
  for (const [s0, s1] of solidIntervals(pl.total, r.gaps)) {
    const keys = [s0, ...cornersBetween(pl, s0, s1), s1];
    for (let i = 0; i + 1 < keys.length; i++) {
      panels.push({ a: at3(pointAt(pl, keys[i]).p, baseZ), b: at3(pointAt(pl, keys[i + 1]).p, baseZ) });
    }
    postDs.push(...postDistances(pl, s0, s1));
  }
  const posts: Vec3[] = [];
  for (const d of postDs.sort((p, q) => p - q)) {
    const p = at3(pointAt(pl, d).p, baseZ);
    const last = posts[posts.length - 1];
    if (last === undefined || Math.hypot(p[0] - last[0], p[1] - last[1]) > TINY) posts.push(p);
  }
  const steps: DerivedSteps[] = [];
  r.gaps.forEach((g, i) => {
    if (g.steps && Math.abs(g.to - g.from) > TINY) steps.push(deriveSteps(r.id, i, g, pl, deck ? deck.polygon : null, baseZ, terrainZ));
  });
  return { id: r.id, deckId: r.deckId, baseZ, height: r.height, style: r.style, panels, posts, steps, isNew: r.isNew };
}

function deriveHotTub(t: Variant['outdoor']['hotTubs'][number], decks: DerivedDeck[], terrainZ: TerrainZFn): DerivedHotTub {
  const deck = decks.find((d) => pointInPolygon(t.centre, d.polygon));
  const baseZ = deck ? deck.topZ : terrainZ(t.centre[0], t.centre[1]);
  return { id: t.id, centre: [t.centre[0], t.centre[1]], diameter: t.diameter, baseZ, rimZ: baseZ + HOT_TUB_HEIGHT, isNew: t.isNew };
}

/** Step 6: decks (skirts from the terrain), railings with panels / posts / steps, hot tubs. */
export function deriveOutdoor(
  variant: Variant,
  site: Site,
  terrain: TerrainAsset | null,
  opts: { terrainZ?: TerrainZFn } = {},
): DerivedVariant['outdoor'] {
  const terrainZ = opts.terrainZ ?? ((x: number, y: number) => terrainZAt(terrain, site, x, y));
  const decks = variant.outdoor.decks.map((d) => deriveDeck(d, terrainZ));
  return {
    decks,
    railings: variant.outdoor.railings.map((r) => deriveRailing(r, decks, terrainZ)),
    hotTubs: variant.outdoor.hotTubs.map((t) => deriveHotTub(t, decks, terrainZ)),
  };
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
