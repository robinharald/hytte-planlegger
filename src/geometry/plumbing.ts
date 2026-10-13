/**
 * Plumbing and drainage helper (the original brief §5): which fixtures need a drain, where the drain stacks stand, how
 * far each fixture's waste pipe runs to a stack, and whether that is fine. Pure, no React, read from the derived model.
 *
 * Model
 *  - Fixtures: every derived furniture item whose catalogue entry has `needsDrain` (toilets, showers, sinks, washers,
 *    floor drains, the bathtub, the water heater). The waste pipe leaves a wall-backed fixture (catalogue snap
 *    'back-to-wall': toilet, sink, washer) at the middle of its back, every other one at its centre (`drainPoint`).
 *  - Today's drains: a fixture standing in one of today's wet rooms (a room of today's cabin, `DerivedRoom.isNew`
 *    false, whose type is bad / wc, or for fixtures other than toilets also teknisk / kjokken, and — when the caller
 *    passes `todayRoomIds` — whose Room record had a wet type in Forslag D) uses the drain that is there today: state
 *    'today', no run, no warning. A bedroom of today's cabin turned into a bathroom in a proposal gets no such drain.
 *  - Stacks: `Variant.plumbing.stacks` (a point on a wall's centre line, per storey). A storey with fixtures that need
 *    a stack and no stored stack gets ONE suggested stack (`suggested: true`, id `suggested-<storeyId>`), for the
 *    largest group of those fixtures (fixtures within CLUSTER_LINK_M of each other form a group, so one toilet put in a
 *    bedroom does not drag the stack away from the bathrooms; toilets weigh TOILET_WEIGHT, since their reach is the
 *    shortest): the wall point that leaves most of the group within reach, and of those the one nearest the group's
 *    weighted centroid, preferring a wall with wet rooms (bad, wc, teknisk, or a room holding a fixture that needs a
 *    drain) on both sides, then one wet side, and avoiding exterior walls (frost) and door / window openings
 *    (`suggestStackPoint`).
 *  - Runs: a toilet runs along the wall its stack stands on (across to that wall's line, then along it: the drawn run
 *    has a corner), every other fixture straight under the floor. Each fixture goes to the stack on its storey with
 *    the shortest run.
 *  - Rules: a toilet is fine within TOILET_REACH_M (1.0 m) of a stack along the wall, or when it stands back to back or
 *    side by side with another toilet on one wall line that reaches a stack (the stack on that line) within
 *    PAIR_REACH_M (2.5 m) of both; other fixtures are fine within FIXTURE_REACH_M (3.0 m). Anything else is 'far' and
 *    carries its distance (`drainWarnings` → kind 'drain-far').
 *
 * `analysePlumbing` is memoised on the derived model, the plumbing object and the today set (identity), and costs well
 * under 2 ms on the furnished seed. `snapStackToWall` puts a dragged stack on the nearest wall (out of openings).
 */
import type { DerivedFurniture, DerivedRoom, DerivedVariant, DerivedWall } from '../model/derived';
import type { Id, RoomType, Variant, Vec2 } from '../model/types';
import { backEdge } from './furnitureDerive';
import { pointInPolygon } from './polygon';

export type VariantPlumbing = NonNullable<Variant['plumbing']>;
export type DrainStack = VariantPlumbing['stacks'][number];

/** A toilet is fine this close (m, along the wall) to a stack. */
export const TOILET_REACH_M = 1.0;
/** Two toilets back to back / side by side on one wall line are fine this close (m, along the wall) to a stack on it. */
export const PAIR_REACH_M = 2.5;
/** Other fixtures are fine this close (m) to a stack. */
export const FIXTURE_REACH_M = 3.0;
/** A stack this close (m) to a wall's centre line stands on that wall. */
export const STACK_ON_WALL_M = 0.2;
/** Toilets count this many times in the centroid a suggested stack is placed by. */
export const TOILET_WEIGHT = 3;
/** Fixtures this close (m) to one another form one group for a suggested stack. */
export const CLUSTER_LINK_M = FIXTURE_REACH_M;

/** A toilet's back is against a wall when it is at most this far (m) from the wall face. */
const BACK_GAP_M = 0.15;
/** Back to back: the two backs at most this far apart (m) along the wall. */
const BACK_TO_BACK_ALONG_M = 0.6;
/** Side by side: the two toilets at most this far apart (m) along the wall. */
const SIDE_BY_SIDE_ALONG_M = 1.5;
/** A pair's wall reaches this far (m) past the ends of the two toilets' wall pieces. */
const PAIR_WALL_REACH_M = 0.3;
/** Score bonus (m) of a wall stretch with wet rooms on both sides / one side, and the penalty of an exterior wall. */
const SHARED_WET_BONUS_M = 2;
const WET_SIDE_BONUS_M = 1;
const EXTERIOR_PENALTY_M = 1.5;
/** A stack keeps this far (m) from the jambs of an opening in its wall. */
const OPENING_CLEAR_M = 0.1;
/** Wall sampling step (m) and how far (m) beyond a face the room on that side is probed. */
const SAMPLE_STEP_M = 0.1;
const PROBE_M = 0.05;
const MIN_WALL_M = 0.05;
/** Walls this far (m) beyond the group's spread around its centroid are candidates for a stack; else the nearest few. */
const SEARCH_MARGIN_M = 2;
const FALLBACK_WALLS = 6;

/** Room types that hold drains (a stack between two of them is the classic spot). */
const WET_TYPES: ReadonlySet<RoomType> = new Set<RoomType>(['bad', 'wc', 'teknisk']);
/** Today's rooms whose drain a toilet / any other fixture may use. */
export const TODAY_TOILET_ROOM_TYPES: ReadonlySet<RoomType> = new Set<RoomType>(['bad', 'wc']);
export const TODAY_DRAIN_ROOM_TYPES: ReadonlySet<RoomType> = new Set<RoomType>(['bad', 'wc', 'teknisk', 'kjokken']);

export interface PlumbingStack {
  id: Id;
  p: Vec2;
  storeyId: Id;
  /** Suggested by the helper: the proposal stores no stack on this storey. */
  suggested: boolean;
  /** The wall the stack stands on (within STACK_ON_WALL_M), if any. */
  wallId: Id | null;
  /** Unit direction of that wall (a toilet's run goes along it); null when the stack stands on no wall. */
  dir: Vec2 | null;
}

/** 'ok': fine; 'far': too far from every stack (or no stack); 'today': uses a drain of today's cabin. */
export type FixtureState = 'ok' | 'far' | 'today';

export interface PlumbingFixture {
  /** The furniture item's id. */
  id: Id;
  catalogId: string;
  toilet: boolean;
  levelId: Id;
  storeyId: Id;
  roomId?: Id;
  roomName?: string;
  /** Where the waste pipe leaves the fixture (see the header). */
  point: Vec2;
  footprint: Vec2[];
  state: FixtureState;
  /** 'near': within its reach of a stack; 'pair': a toilet pair on a wall that reaches a stack; 'none': no stack. */
  reason: 'near' | 'pair' | 'far' | 'today' | 'none';
  stackId: Id | null;
  /** The run drawn to the stack: [fixture, stack] or [fixture, corner, stack]; empty for 'today' and without a stack. */
  run: Vec2[];
  /** Length of the run (m); null without a run. */
  distance: number | null;
  /** The reach that applies: 1.0 (toilet), 2.5 (toilet in a pair), 3.0 (other). */
  limit: number;
}

export interface ToiletPair {
  ids: [Id, Id];
  kind: 'back-to-back' | 'side-by-side';
  wallId: Id;
  /** The wall line: 'x' when it runs along plan y (at x = value), 'y' when it runs along plan x, null when slanted. */
  axis: 'x' | 'y' | null;
  value: number;
  /** The rooms of the two toilets (unique, in order). */
  roomNames: string[];
  /** The stack the pair reaches best on its wall line, null when none stands on it. */
  stackId: Id | null;
  /** Both toilets within PAIR_REACH_M of that stack along the wall. */
  fine: boolean;
}

export interface PlumbingAnalysis {
  stacks: PlumbingStack[];
  fixtures: PlumbingFixture[];
  pairs: ToiletPair[];
  /** Names of today's wet rooms whose drains the 'today' fixtures use (unique, in furniture order). */
  todayRooms: string[];
}

/** A fixture too far from the stacks (shown in Advarsler while «Avløp og sluk» is on). */
export interface DrainFarWarning {
  kind: 'drain-far';
  furnitureId: Id;
  catalogId: string;
  roomId?: Id;
  /** Run length (m) to the nearest stack, to the centimetre. */
  distance: number;
}

export interface PlumbingOptions {
  /**
   * Ids of the Room records that had a wet type in Forslag D (state/plumbingActions.ts `todayWetRoomIds`). Without it,
   * every wet room of today's cabin counts as having today's drain.
   */
  todayRoomIds?: ReadonlySet<Id> | null;
}

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round3 = (v: number): number => Math.round(v * 1000) / 1000 || 0;
const roundP = (p: Vec2): Vec2 => [round3(p[0]), round3(p[1])];

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

/** A live, solid wall of a storey as its centre line. */
interface WallLine {
  w: DerivedWall;
  a: Vec2;
  u: Vec2;
  /** Left normal of `u`. */
  n: Vec2;
  len: number;
  /** Half the thickness: the faces are at ±half from the centre line. */
  half: number;
}

const wallLineCache = new WeakMap<DerivedVariant, Map<Id, WallLine[]>>();

/** The storey's live walls with a body (no ghosts, no dividers) as centre lines. */
function wallLines(derived: DerivedVariant, storeyId: Id): WallLine[] {
  let byStorey = wallLineCache.get(derived);
  if (!byStorey) {
    byStorey = new Map();
    wallLineCache.set(derived, byStorey);
  }
  const hit = byStorey.get(storeyId);
  if (hit) return hit;
  const out: WallLine[] = [];
  for (const w of derived.walls) {
    if (w.isGhost || w.isDivider || w.thickness <= 0 || !w.storeyIds.includes(storeyId)) continue;
    const d = sub(w.b, w.a);
    const len = Math.hypot(d[0], d[1]);
    if (len < MIN_WALL_M) continue;
    const u: Vec2 = [d[0] / len, d[1] / len];
    const n: Vec2 = [-u[1], u[0]];
    const shift = (w.faceLeft - w.faceRight) / 2;
    out.push({ w, a: add(w.a, scale(n, shift)), u, n, len, half: (w.faceLeft + w.faceRight) / 2 });
  }
  byStorey.set(storeyId, out);
  return out;
}

const pointAt = (l: WallLine, t: number): Vec2 => add(l.a, scale(l.u, t));

/** Nearest point of a wall's centre segment to p. */
function nearestOn(l: WallLine, p: Vec2): { t: number; q: Vec2; d: number } {
  const t = clamp(dot(sub(p, l.a), l.u), 0, l.len);
  const q = pointAt(l, t);
  return { t, q, d: dist(p, q) };
}

/** Moves a position along the wall out of its openings (jambs + OPENING_CLEAR_M), to the nearer free side. */
function clearOfOpenings(l: WallLine, t: number): number {
  const spans = l.w.openings.filter((o) => !o.isGhost).map((o) => [o.offset - o.width / 2 - OPENING_CLEAR_M, o.offset + o.width / 2 + OPENING_CLEAR_M] as const);
  let at = t;
  for (let pass = 0; pass < 4; pass++) {
    const hit = spans.find(([lo, hi]) => at > lo && at < hi);
    if (!hit) return at;
    const options = [hit[0], hit[1]].filter((v) => v >= 0 && v <= l.len).sort((x, y) => Math.abs(x - at) - Math.abs(y - at));
    if (options.length === 0) return at;
    at = options[0];
  }
  return at;
}

/** The wall a stack at p stands on (within STACK_ON_WALL_M), if any. */
function wallUnder(derived: DerivedVariant, storeyId: Id, p: Vec2): WallLine | null {
  let best: WallLine | null = null;
  let bestD = STACK_ON_WALL_M;
  for (const l of wallLines(derived, storeyId)) {
    const d = nearestOn(l, p).d;
    if (d <= bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

/**
 * The point on the storey's nearest wall (centre line) to p, moved out of door and window openings; null when the
 * storey has no wall (or none within `maxDist`).
 */
export function snapStackToWall(derived: DerivedVariant, storeyId: Id, p: Vec2, maxDist = Infinity): { p: Vec2; wallId: Id; dir: Vec2 } | null {
  let best: { l: WallLine; t: number; d: number } | null = null;
  for (const l of wallLines(derived, storeyId)) {
    const n = nearestOn(l, p);
    if (!best || n.d < best.d) best = { l, t: n.t, d: n.d };
  }
  if (!best || best.d > maxDist) return null;
  const t = clearOfOpenings(best.l, best.t);
  return { p: roundP(pointAt(best.l, t)), wallId: best.l.w.id, dir: best.l.u };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const isToilet = (f: Pick<DerivedFurniture, 'item' | 'catalog'>): boolean => f.item.catalogId === 'toalett' || f.catalog?.symbol === 'toilet';

/** Where the waste pipe leaves the fixture: the middle of its back for wall-backed fixtures, else its centre. */
export function drainPoint(f: Pick<DerivedFurniture, 'item' | 'catalog'>): Vec2 {
  if (f.catalog?.snap === 'back-to-wall' && f.item.size) {
    const [a, b] = backEdge(f.item);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  return [f.item.position[0], f.item.position[1]];
}

const roomKey = (id: Id, levelId: Id) => `${id}|${levelId}`;

function roomOf(rooms: Map<string, DerivedRoom>, byId: Map<Id, DerivedRoom>, f: DerivedFurniture): DerivedRoom | undefined {
  return f.roomId ? (rooms.get(roomKey(f.roomId, f.levelId)) ?? byId.get(f.roomId)) : undefined;
}

function usesTodayDrain(room: DerivedRoom | undefined, toilet: boolean, today: ReadonlySet<Id> | null | undefined): boolean {
  if (!room?.room || room.isNew) return false;
  if (today && !today.has(room.room.id)) return false;
  return (toilet ? TODAY_TOILET_ROOM_TYPES : TODAY_DRAIN_ROOM_TYPES).has(room.room.type);
}

// ---------------------------------------------------------------------------
// Suggested stack
// ---------------------------------------------------------------------------

/** Rooms of a storey per wall id they are bounded by (DerivedRoom.wallIds). */
function roomsByWall(derived: DerivedVariant, storeyId: Id): Map<Id, DerivedRoom[]> {
  const out = new Map<Id, DerivedRoom[]>();
  for (const r of derived.rooms) {
    if (r.storeyId !== storeyId || r.polygon.length < 3) continue;
    for (const id of r.wallIds) {
      const list = out.get(id);
      if (list) list.push(r);
      else out.set(id, [r]);
    }
  }
  return out;
}

const inBox = (p: Vec2, r: DerivedRoom): boolean =>
  p[0] >= r.bbox.min[0] - 1e-6 && p[0] <= r.bbox.max[0] + 1e-6 && p[1] >= r.bbox.min[1] - 1e-6 && p[1] <= r.bbox.max[1] + 1e-6;

/** How many sides of the wall at t have a wet room (0, 1, 2). */
function wetSides(l: WallLine, t: number, rooms: readonly DerivedRoom[], wet: (r: DerivedRoom) => boolean): number {
  if (rooms.length === 0) return 0;
  const c = pointAt(l, t);
  const off = l.half + PROBE_M;
  let n = 0;
  for (const probe of [add(c, scale(l.n, off)), add(c, scale(l.n, -off))]) {
    if (rooms.some((r) => wet(r) && inBox(probe, r) && pointInPolygon(probe, r.polygon))) n++;
  }
  return n;
}

const BONUS = [0, WET_SIDE_BONUS_M, SHARED_WET_BONUS_M] as const;

/** The heaviest group of fixtures linked within CLUSTER_LINK_M (toilets weigh TOILET_WEIGHT; ties: the first). */
function heaviestGroup<T extends Pick<PlumbingFixture, 'point' | 'toilet'>>(fixtures: readonly T[]): T[] {
  const group = fixtures.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  for (let i = 0; i < fixtures.length; i++) {
    for (let j = i + 1; j < fixtures.length; j++) {
      if (dist(fixtures[i].point, fixtures[j].point) <= CLUSTER_LINK_M) group[find(j)] = find(i);
    }
  }
  const weight = new Map<number, number>();
  for (let i = 0; i < fixtures.length; i++) {
    const g = find(i);
    weight.set(g, (weight.get(g) ?? 0) + (fixtures[i].toilet ? TOILET_WEIGHT : 1));
  }
  let bestGroup = -1;
  let bestWeight = -1;
  for (let i = 0; i < fixtures.length; i++) {
    const g = find(i);
    const w = weight.get(g) ?? 0;
    if (w > bestWeight) {
      bestWeight = w;
      bestGroup = g;
    }
  }
  return fixtures.filter((_, i) => find(i) === bestGroup);
}

/**
 * Where a stack for these fixtures goes on the storey (see the header). Of their largest group (`heaviestGroup`), the
 * candidates are, on every wall near the group, per stretch of equal wetness the point nearest the weighted centroid
 * and the points nearest each toilet (moved out of openings). The candidate that leaves the most of the group within
 * reach wins (toilets weigh TOILET_WEIGHT; a toilet counts within TOILET_REACH_M along the wall, others within
 * FIXTURE_REACH_M); ties go to the best score: the distance to the centroid, a stretch with wet rooms on both sides
 * SHARED_WET_BONUS_M better, one wet side WET_SIDE_BONUS_M, an exterior wall EXTERIOR_PENALTY_M worse. Null without
 * fixtures or walls.
 */
export function suggestStackPoint(
  derived: DerivedVariant,
  storeyId: Id,
  fixtures: readonly Pick<PlumbingFixture, 'point' | 'toilet'>[],
  wet?: (r: DerivedRoom) => boolean,
): { p: Vec2; wallId: Id } | null {
  if (fixtures.length === 0) return null;
  const group = heaviestGroup(fixtures);
  let wsum = 0;
  let cx = 0;
  let cy = 0;
  for (const f of group) {
    const k = f.toilet ? TOILET_WEIGHT : 1;
    wsum += k;
    cx += f.point[0] * k;
    cy += f.point[1] * k;
  }
  const c: Vec2 = [cx / wsum, cy / wsum];
  const isWet = wet ?? ((r: DerivedRoom) => !!r.room && WET_TYPES.has(r.room.type));
  const all = wallLines(derived, storeyId)
    .map((l) => ({ l, near: nearestOn(l, c).d }))
    .sort((x, y) => x.near - y.near);
  if (all.length === 0) return null;
  // The walls near the group: within its spread (plus the toilet reach) of the centroid; else the few nearest.
  const spread = Math.max(...group.map((f) => dist(f.point, c))) + SEARCH_MARGIN_M;
  const near = all.filter((x) => x.near <= spread);
  const lines = near.length > 0 ? near : all.slice(0, FALLBACK_WALLS);
  const byWall = roomsByWall(derived, storeyId);
  const toilets = group.filter((f) => f.toilet);
  let best: { l: WallLine; t: number; cover: number; score: number } | null = null;
  const consider = (l: WallLine, t: number, wetness: number, penalty: number) => {
    const at = clearOfOpenings(l, t);
    const q = pointAt(l, at);
    let cover = 0;
    for (const f of group) {
      if (f.toilet) cover += runTo(f.point, true, { p: q, dir: l.u }).distance <= TOILET_REACH_M + 1e-9 ? TOILET_WEIGHT : 0;
      else cover += dist(f.point, q) <= FIXTURE_REACH_M + 1e-9 ? 1 : 0;
    }
    const score = dist(c, q) - BONUS[wetness] + penalty;
    if (!best || cover > best.cover || (cover === best.cover && score < best.score - 1e-9)) best = { l, t: at, cover, score };
  };
  const stretch = (l: WallLine, t0: number, t1: number, wetness: number, penalty: number) => {
    const along = (p: Vec2) => clamp(dot(sub(p, l.a), l.u), t0, t1);
    consider(l, along(c), wetness, penalty);
    for (const f of toilets) consider(l, along(f.point), wetness, penalty);
  };
  for (const { l } of lines) {
    const rooms = byWall.get(l.w.id) ?? [];
    const penalty = l.w.isExterior ? EXTERIOR_PENALTY_M : 0;
    const steps = Math.max(1, Math.ceil(l.len / SAMPLE_STEP_M));
    // Stretches of equal wetness along the wall.
    let start = 0;
    let wetness = wetSides(l, 0, rooms, isWet);
    for (let i = 1; i <= steps; i++) {
      const t = (l.len * i) / steps;
      const n = wetSides(l, t, rooms, isWet);
      if (n !== wetness) {
        stretch(l, start, (l.len * (i - 1)) / steps, wetness, penalty);
        start = t;
        wetness = n;
      }
    }
    stretch(l, start, l.len, wetness, penalty);
  }
  if (best === null) return null;
  const b = best as { l: WallLine; t: number };
  return { p: roundP(pointAt(b.l, b.t)), wallId: b.l.w.id };
}

// ---------------------------------------------------------------------------
// Runs and toilet pairs
// ---------------------------------------------------------------------------

/** The run from a fixture to a stack: along the stack's wall for a toilet, else straight. */
function runTo(point: Vec2, toilet: boolean, stack: Pick<PlumbingStack, 'p' | 'dir'>): { run: Vec2[]; distance: number } {
  if (toilet && stack.dir) {
    const d = sub(point, stack.p);
    const along = dot(d, stack.dir);
    const foot = add(stack.p, scale(stack.dir, along));
    const across = dist(point, foot);
    const run = across < 0.005 || Math.abs(along) < 0.005 ? [point, stack.p] : [point, roundP(foot), stack.p];
    return { run, distance: Math.abs(along) + across };
  }
  return { run: [point, stack.p], distance: dist(point, stack.p) };
}

/** The wall a toilet's back stands against: its line and the side (+1 left, −1 right) the toilet is on. */
interface BackWall {
  l: WallLine;
  side: 1 | -1;
}

function backWallOf(lines: readonly WallLine[], f: DerivedFurniture, point: Vec2): BackWall | null {
  const back = sub(point, f.item.position);
  const bl = Math.hypot(back[0], back[1]);
  if (bl < 1e-6) return null;
  const nb: Vec2 = [back[0] / bl, back[1] / bl];
  let best: (BackWall & { gap: number }) | null = null;
  for (const l of lines) {
    const rel = sub(point, l.a);
    const t = dot(rel, l.u);
    if (t < -0.05 || t > l.len + 0.05) continue;
    const s = dot(rel, l.n);
    const side: 1 | -1 = s >= 0 ? 1 : -1;
    // The back faces the wall: it points against the side's normal.
    if (dot(nb, l.n) * side > -0.7) continue;
    const gap = Math.abs(s) - l.half;
    if (gap < -0.05 || gap > BACK_GAP_M) continue;
    if (!best || gap < best.gap) best = { l, side, gap };
  }
  return best;
}

/** Two wall lines on one line (parallel within ~1°, within 3 cm of each other). */
const sameLine = (a: WallLine, b: WallLine): boolean => a === b || (Math.abs(cross(a.u, b.u)) < 0.02 && Math.abs(dot(sub(b.a, a.a), a.n)) < 0.03);

/** The along-line range [lo, hi] of wall `b` measured on line `a`. */
function rangeOn(a: WallLine, b: WallLine): [number, number] {
  const t0 = dot(sub(b.a, a.a), a.u);
  const t1 = dot(sub(pointAt(b, b.len), a.a), a.u);
  return [Math.min(t0, t1), Math.max(t0, t1)];
}

function lineAxis(l: WallLine): { axis: 'x' | 'y' | null; value: number } {
  if (Math.abs(l.u[0]) < 0.02) return { axis: 'x', value: round3(l.a[0]) };
  if (Math.abs(l.u[1]) < 0.02) return { axis: 'y', value: round3(l.a[1]) };
  return { axis: null, value: 0 };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

interface Draft extends PlumbingFixture {
  source: DerivedFurniture;
}

/** Memo keys for "no plumbing" / "no today set" (WeakMap keys must be objects). */
const NO_PLUMBING = {};
const NO_TODAY = {};
const memo = new WeakMap<DerivedVariant, WeakMap<object, WeakMap<object, PlumbingAnalysis>>>();

/**
 * The drainage overlay of a derived model and the proposal's stacks (see the header). Memoised per (derived, plumbing,
 * today set) by identity, so the plan's live drag preview and the Vis panel never evict each other's result.
 */
export function analysePlumbing(derived: DerivedVariant, plumbing?: VariantPlumbing | null, opts: PlumbingOptions = {}): PlumbingAnalysis {
  const stored = plumbing ?? undefined;
  const today = opts.todayRoomIds;
  let byPlumbing = memo.get(derived);
  if (!byPlumbing) {
    byPlumbing = new WeakMap();
    memo.set(derived, byPlumbing);
  }
  let byToday = byPlumbing.get(stored ?? NO_PLUMBING);
  if (!byToday) {
    byToday = new WeakMap();
    byPlumbing.set(stored ?? NO_PLUMBING, byToday);
  }
  const hit = byToday.get(today ?? NO_TODAY);
  if (hit) return hit;
  const result = compute(derived, stored, today);
  byToday.set(today ?? NO_TODAY, result);
  return result;
}

function compute(derived: DerivedVariant, plumbing: VariantPlumbing | undefined, today: ReadonlySet<Id> | null | undefined): PlumbingAnalysis {
  const storeyOfLevel = new Map(derived.levels.map((l) => [l.id, l.storeyId] as const));
  const storeyIds = new Set(derived.storeys.map((s) => s.id));
  const rooms = new Map<string, DerivedRoom>();
  const roomsById = new Map<Id, DerivedRoom>();
  for (const r of derived.rooms) {
    rooms.set(roomKey(r.id, r.levelId), r);
    if (!roomsById.has(r.id)) roomsById.set(r.id, r);
  }

  // Fixtures.
  const drafts: Draft[] = [];
  const todayRooms: string[] = [];
  const drainRooms = new Set<string>();
  for (const f of derived.furniture) {
    if (!f.needsDrain) continue;
    const storeyId = storeyOfLevel.get(f.levelId) ?? f.levelId;
    const toilet = isToilet(f);
    const room = roomOf(rooms, roomsById, f);
    if (room) drainRooms.add(roomKey(room.id, room.levelId));
    const roomName = room?.room?.name;
    const isToday = usesTodayDrain(room, toilet, today);
    if (isToday && roomName && !todayRooms.includes(roomName)) todayRooms.push(roomName);
    drafts.push({
      source: f,
      id: f.id,
      catalogId: f.item.catalogId,
      toilet,
      levelId: f.levelId,
      storeyId,
      roomId: room?.id ?? f.roomId,
      roomName,
      point: roundP(drainPoint(f)),
      footprint: f.footprint,
      state: isToday ? 'today' : 'far',
      reason: isToday ? 'today' : 'none',
      stackId: null,
      run: [],
      distance: null,
      limit: toilet ? TOILET_REACH_M : FIXTURE_REACH_M,
    });
  }

  // Stacks: the stored ones, and one suggestion per storey that needs a stack and stores none.
  const stacks: PlumbingStack[] = [];
  for (const s of plumbing?.stacks ?? []) {
    if (!storeyIds.has(s.storeyId)) continue;
    const l = wallUnder(derived, s.storeyId, s.p);
    stacks.push({ id: s.id, p: [s.p[0], s.p[1]], storeyId: s.storeyId, suggested: false, wallId: l?.w.id ?? null, dir: l?.u ?? null });
  }
  const wet = (r: DerivedRoom) => (!!r.room && WET_TYPES.has(r.room.type)) || drainRooms.has(roomKey(r.id, r.levelId));
  for (const s of derived.storeys) {
    if (stacks.some((x) => x.storeyId === s.id)) continue;
    const needing = drafts.filter((d) => d.storeyId === s.id && d.state !== 'today');
    const at = suggestStackPoint(derived, s.id, needing, wet);
    if (!at) continue;
    const l = wallLines(derived, s.id).find((x) => x.w.id === at.wallId) ?? null;
    stacks.push({ id: `suggested-${s.id}`, p: at.p, storeyId: s.id, suggested: true, wallId: at.wallId, dir: l?.u ?? null });
  }

  // Each fixture to the stack with the shortest run on its storey.
  for (const d of drafts) {
    if (d.state === 'today') continue;
    let best: { stack: PlumbingStack; run: Vec2[]; distance: number } | null = null;
    for (const s of stacks) {
      if (s.storeyId !== d.storeyId) continue;
      const r = runTo(d.point, d.toilet, s);
      if (!best || r.distance < best.distance) best = { stack: s, ...r };
    }
    if (!best) continue;
    d.stackId = best.stack.id;
    d.run = best.run;
    d.distance = best.distance;
    const ok = best.distance <= d.limit + 1e-9;
    d.state = ok ? 'ok' : 'far';
    d.reason = ok ? 'near' : 'far';
  }

  // Toilet pairs on one wall line.
  const pairs: ToiletPair[] = [];
  const toilets = drafts.filter((d) => d.toilet && d.state !== 'today');
  const backs = new Map<Id, BackWall | null>();
  for (const t of toilets) backs.set(t.id, backWallOf(wallLines(derived, t.storeyId), t.source, t.point));
  for (let i = 0; i < toilets.length; i++) {
    for (let j = i + 1; j < toilets.length; j++) {
      const t1 = toilets[i];
      const t2 = toilets[j];
      const b1 = backs.get(t1.id);
      const b2 = backs.get(t2.id);
      if (!b1 || !b2 || t1.storeyId !== t2.storeyId || !sameLine(b1.l, b2.l)) continue;
      const line = b1.l;
      const along1 = dot(sub(t1.point, line.a), line.u);
      const along2 = dot(sub(t2.point, line.a), line.u);
      const side2 = dot(sub(t2.point, line.a), line.n) >= 0 ? 1 : -1;
      const gap = Math.abs(along1 - along2);
      const kind = side2 !== b1.side && gap <= BACK_TO_BACK_ALONG_M ? 'back-to-back' : side2 === b1.side && gap <= SIDE_BY_SIDE_ALONG_M ? 'side-by-side' : null;
      if (!kind) continue;
      // A stack on this wall line, within the two pieces (and a little past them), that both reach.
      const [lo2, hi2] = rangeOn(line, b2.l);
      const lo = Math.min(0, lo2) - PAIR_WALL_REACH_M;
      const hi = Math.max(line.len, hi2) + PAIR_WALL_REACH_M;
      let reach: { stack: PlumbingStack; worst: number } | null = null;
      for (const s of stacks) {
        if (s.storeyId !== t1.storeyId) continue;
        const rel = sub(s.p, line.a);
        const ts = dot(rel, line.u);
        if (Math.abs(dot(rel, line.n)) > STACK_ON_WALL_M || ts < lo || ts > hi) continue;
        const worst = Math.max(runTo(t1.point, true, { p: s.p, dir: line.u }).distance, runTo(t2.point, true, { p: s.p, dir: line.u }).distance);
        if (!reach || worst < reach.worst) reach = { stack: s, worst };
      }
      const fine = reach !== null && reach.worst <= PAIR_REACH_M + 1e-9;
      const names = [t1.roomName, t2.roomName].filter((n): n is string => !!n).filter((n, k, all) => all.indexOf(n) === k);
      pairs.push({ ids: [t1.id, t2.id], kind, wallId: line.w.id, ...lineAxis(line), roomNames: names, stackId: reach?.stack.id ?? null, fine });
      if (!fine || !reach) continue;
      const stack = reach.stack;
      for (const t of [t1, t2]) {
        // A toilet already fine at another stack keeps that run; the pair rule only makes it fine here.
        if (t.state !== 'ok' || t.stackId === stack.id) {
          const r = runTo(t.point, true, { p: stack.p, dir: line.u });
          t.stackId = stack.id;
          t.run = r.run;
          t.distance = r.distance;
        }
        t.state = 'ok';
        t.reason = 'pair';
        t.limit = PAIR_REACH_M;
      }
    }
  }

  const fixtures: PlumbingFixture[] = drafts.map((d) => {
    const { source, ...rest } = d;
    void source;
    return rest;
  });
  return { stacks, fixtures, pairs, todayRooms };
}

/** The 'drain-far' warnings of an analysis: one per fixture too far from every stack (with a run). */
export function drainWarnings(analysis: PlumbingAnalysis): DrainFarWarning[] {
  const out: DrainFarWarning[] = [];
  for (const f of analysis.fixtures) {
    if (f.state !== 'far' || f.distance === null) continue;
    const w: DrainFarWarning = { kind: 'drain-far', furnitureId: f.id, catalogId: f.catalogId, distance: Math.round(f.distance * 100) / 100 };
    if (f.roomId) w.roomId = f.roomId;
    out.push(w);
  }
  return out;
}

/**
 * Where «Legg til avløpsstamme» puts a new stack on a storey: by the fixtures that are too far (else every fixture that
 * needs a stack there, else the middle of the storey's rooms), on a wall as for the suggestion. Null without walls.
 */
export function newStackPoint(derived: DerivedVariant, analysis: PlumbingAnalysis, storeyId: Id): Vec2 | null {
  const onStorey = analysis.fixtures.filter((f) => f.storeyId === storeyId && f.state !== 'today');
  const far = onStorey.filter((f) => f.state === 'far');
  const group = far.length > 0 ? far : onStorey;
  if (group.length > 0) return suggestStackPoint(derived, storeyId, group)?.p ?? null;
  const rooms = derived.rooms.filter((r) => r.storeyId === storeyId);
  if (rooms.length === 0) return null;
  const c: Vec2 = [rooms.reduce((s, r) => s + r.labelPoint[0], 0) / rooms.length, rooms.reduce((s, r) => s + r.labelPoint[1], 0) / rooms.length];
  return snapStackToWall(derived, storeyId, c)?.p ?? null;
}
