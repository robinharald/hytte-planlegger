/**
 * Editing geometry (docs/phase2-plan.md §1, §3.4, §3.5, §3.7). Pure: every `apply…` function mutates a DRAFT variant
 * (an immer draft or a plain copy) and reads the pre-edit state from an `EditContext` ({ base, derived }: the variant
 * before the edit — for drags the pointer-down base — and its derived model). state/editActions.ts wraps them in
 * `produce`, reconciles the rooms and stores the result. No React, no store access.
 *
 * Lock (§1.1): `isLocked(variant)` = `variant.locked === true` (the bundled Forslag D). The ONLY lock.
 *
 * Status bookkeeping (§1.2, §3.4)
 *  - `touchExisting(draft, id)`: an EXISTING stored wall / opening becomes 'new' and a 'removed' copy with the old
 *    geometry is appended as `${id}/ghost` (idempotent: an element that is already 'new' is left alone, an existing
 *    ghost id is never added twice). Openings with status 'removed' (demolition markers) on a touched wall go with the
 *    wall's ghost. A wall that MOVES takes its openings along (`touchWallForMove`): existing openings on it are touched
 *    too and their ghosts are hosted on the wall's ghost; a wall that is only stretched keeps its openings in place.
 *  - Deleting an existing wall / opening marks it 'removed' in place (it is its own ghost); existing openings on a
 *    deleted existing wall are removed with it, new ones are deleted. New elements are really deleted.
 *  - Block edges: moving an edge whose derived exterior pieces include existing ones (part of today's cabin) records
 *    the old line of those pieces in `variant.ghosts` (`${blockId}/${edgeId}/ghost`, `/ghost/2` … — the first free id;
 *    one entry per line). An edge that only got SHORTER (its line stayed; e.g. a junction shift moved the partner's
 *    end edge) records the existing ranges it lost the same way (stubs). Pieces beyond an older edge ghost of the
 *    same block are an earlier edit's growth and get none. Parts are never changed: an explicit existing part polygon
 *    stays, the implicit remainder is new. An existing block WITHOUT explicit parts (a stored copy of the glass bump
 *    from before seed revision 5) gets its pre-edit outline as the existing part `${blockId}-today` the first time an
 *    edit changes its outline (copy-on-write, `todayPart`; an edge that already has a move ghost runs on the ghost's
 *    line there, so growth from before revision 5 is not kept as today's), so it follows the same rules. Every piece
 *    of an edge with a move ghost is new, also inside an existing part (walls.ts `movedEdgeKeys`). A junction shift may
 *    therefore shrink an EXISTING partner block (blk-main's north edge +1 takes 1 m of blk-bod, existing part
 *    included): allowed; its lost wall stubs are ghosted, and its lost floor counts with the growing block's new
 *    remainder (areas.ts). An edge whose line stays but whose existing pieces a junction without a wall of its own
 *    ('open', or the partner's wall) now covers — the glass bump grown 0.5 m east opens 9..9.5 of the main block's
 *    south wall — records that stretch as an edge ghost too (`addJunctionGhosts`; not where the partner's part of
 *    today's cabin already met it); such a ghost does not heal while the junction covers it, and "Ta tilbake" on it
 *    moves the partner's edge back (`uncoverJunction`).
 *  - Openings on a changed block edge keep their plan position (clamped to the new segment). An EXISTING opening whose
 *    plan centre changes (its edge's line moved, or a shortened edge clamped it) becomes new with its ghost at the
 *    old centre. Where that old centre is no longer on the edge (a moved line, a lost stub) the ghost — and any
 *    removed opening there — is hosted on the edge ghost's HOST WALL: a 'removed' 'exterior-old' stored wall on the
 *    ghost line with the block's build-up and the edge ghost's id (`ensureGhostHost`; a ghost like any removed wall,
 *    and `ghostRef` maps it to the edge ghost). It goes when the edge ghost heals or is restored, its openings back on
 *    the edge at their plan position (where they heal against live openings that are back too). Ghosts still on the
 *    edge keep their plan position (no clamp). When a later edit makes the host (edge or stored wall) LONGER again, an
 *    opening that the shorter host had pressed against its end (or left in the middle of a host too short for it)
 *    goes back to its ghost's offset if it fits there and heals (`pullBackOpenings`); one the user moved stays. Polish
 *    round (2b): a return in several steps keeps it pressed against that end until its place fits, and a stored wall
 *    back on today's line takes back an opening within 0.15 m of its ghost (a wall turned there and back).
 *  - Healing: whenever an element is back on its ghost (a wall with the same geometry as `${id}/ghost`, an opening with
 *    the same host, offset and size, a block edge whose segment covers its ghost line) the ghost is dropped and the
 *    status goes back to 'existing' (`healGhosts`). So 16 → 18 → 16 or a nudge back and forth leaves nothing behind.
 *  - `restoreGhost` ("Ta tilbake"): a moved wall is moved back with the same cascades and then gets the ghost's exact
 *    geometry; a moved opening gets the ghost's host / offset / size; a deleted (removed in place) wall or opening
 *    becomes existing again (with the openings removed by the delete); a block-edge ghost moves its edge back
 *    (`applyRestoreEdgeGhost`; a stub by moving the adjacent edge back out), junction partners following, and every
 *    opening ghost on the host walls of the ghosts that heal is restored (the openings the edge edit moved or clamped
 *    are back where they were). A wall that is not just its ghost translated (an endpoint drag) is first dragged back
 *    end by end with the endpoint cascades (state/editActions.ts restoreGhost).
 *
 * Wall move / endpoint drag (§3.5). Supports of an endpoint P: block edges and vertices containing P (1 cm), floor-zone
 * edges of the wall's storey, stored walls of the storey whose INTERIOR contains P, and — where the plan is silent —
 * coincident walls that reach a storey the moved wall does not (a lower partition never drags a wall that runs on
 * through the loft). P with a non-parallel support (> 5°) is anchored: it slides along the support line (the support
 * with the least clamping wins, ties: the most perpendicular), clamped to the support's extent; coincident walls are
 * not stretched. A wall MOVE whose end even the best support cannot follow (clamped short of the moved line) moves
 * that end as a free node instead when a non-parallel coincident wall can carry it, so the wall keeps its direction
 * (w-103-korr dragged south: w-103-102 is extended, the collinear w-vf-korr stays; before, the end stayed pinned and
 * the wall tilted). A free node (no support) moves as a node: every coincident wall keeps its direction and ends on the
 * moved line; the moved wall ends at the outermost of those points, so with several coincident walls of different
 * directions the others meet it as T-junctions instead of the node falling apart (without non-parallel ones the node
 * moves with the wall). A wall attached at both ends therefore cannot slide along itself. Fix round after 2b — a moved
 * wall never turns: a clamped end slides onto a non-parallel coincident wall that runs on towards the moved line (left
 * as it is, a T-junction: w-wing-w east along w-sauna-n); when an end still stays clamped (its support ends short of
 * the moved line and nothing carries it), the
 * move is cut back to the largest part that every end can follow (`followableFraction`; exactly onto the support's
 * end: w-peis-n 1 m south stops on y 2,2, w-vf-kjk 1 m east on x 9), and refused when an end cannot move at all
 * (lw-split north); a parallel coincident wall (a continuation in line) is carried along sideways when its far end can
 * follow (`carryParallel`: w-106-korr takes the loft piece lw-106-top along level), else it stays where a non-parallel
 * wall carries the node and follows the node only when nothing else does. Walls ending on the moved wall's interior
 * (T-junctions, non-parallel) are trimmed / extended
 * along their own direction. Openings on the moved wall keep their offset; openings on stretched walls keep their
 * plan position (re-offset, clamped to the wall when they fit). Endpoint drags: an anchored end slides along its
 * support to the projection of the pointer; a free end goes to the pointer and the coincident walls' ends go with it
 * (the plan's "keeping its direction" cannot reach the pointer, so the node simply moves); openings on the dragged
 * wall keep their plan position. Endpoint drags snap to the ends of ghost walls too (geometry/snap.ts `ghostEnds`), so
 * an end dragged out and back by hand lands on today's point and the wall heals.
 *
 * Block edits (§3.4, §3.5). Edges move along their outward normal. Gable / mono blocks keep their shape: a corner
 * drag moves both adjacent edges (each by the pointer's component along its normal); only flat-roof blocks get free
 * vertex drags. Every junction (DerivedBlock.junctions) carries the partner block's coincident edge along by the same
 * vector (and so on through the partner's junctions on that edge) — never to or from a template unit
 * (`carriesThrough`, last fix round, sixth review, and fix round 3 after phase 3 for two units side by side: a unit's
 * edge moves only itself, and an attached edge of a unit pushed into its neighbour stays, the toast naming another
 * unit there). New polygons are validated (area ≥ 0.25 m², not
 * self-intersecting, same orientation); a move that breaks one is scaled back to the largest valid fraction. Then,
 * generically for every changed edge: openings keep their plan position (projected on the new edge, clamped); stored
 * walls collinear with a moved edge (both ends within 1 cm of the old segment) are carried along (with their
 * openings); walls with one end on a moved edge are extended / trimmed along their own direction; floor-zone
 * vertices on the block's old vertices / moved edges follow (the lower floor and the loft keep reaching the wall).
 * Decks do not follow block edits: derive trims them by the buildings, so a deck under a grown block loses that part.
 * `moveBlock` (whole block) translates polygon, parts, zones, stored walls with both ends on / inside the axis
 * polygon (with their openings), room anchors, furniture and structure inside it; it is refused for a block with
 * existing area (like `deleteBlock`): today's cabin is changed through its walls and edges instead. `applyRotateBlock`
 * turns a block with a template a quarter turn about a centre that maps the 0.1 m grid onto itself (so +90 then −90
 * gives the same footprint back; a free unit OFF the grid turns about its own bounding-box centre with no snap, so it
 * keeps its offset from the grid and does not drift 5 cm per turn: `centreTurn`), carrying the same things (furniture turned too) plus the roof's ridge axis / slope
 * side; a unit standing against another block or a deck edge (an edge of its axis polygon on that line) turns about
 * its bounding-box centre and is shifted back onto that line (and onto a second, non-parallel one in a corner), so it
 * keeps the contact and its middle along the line (`contactTurn`; no grid snap). Both report the rooms they carried
 * in `ctx.carried` (with the transform) for `reconcileRooms`.
 *
 * Openings: a drag is clamped to its piece range [s0, s1] of the derived wall (end-touch allowed, a part / zone /
 * junction split is not crossed); re-hosting keeps the swing in world terms (hinge jamb and opening side, rotated
 * with the host when the new host is not parallel); `levelId` is recomputed at the new place (0.2 m inside the host,
 * the first 'replace' zone, else the block level; walls: their level) unless it was set to something other than the
 * old default. Existing openings that move or are resized become new with a ghost.
 *
 * Deck: vertex / edge / whole-deck moves (min area 0.5 m², no self-intersection), insert (steps beyond the new vertex
 * move to the new edge), delete (min 3 vertices — refused with 'self-intersecting' when the outline without the corner
 * would cross itself or be too small; steps of both merged edges are re-hosted on the merged edge by their plan
 * position). Steps on changed edges keep their plan position (clamped).
 *
 * Units (§3.5): `applyPlaceUnit` — new block (isNew, `template`, level 'main', no parts / zones / junctions, nanoid
 * vertex ids, `templateFrontEdgeId` = the front edge), one room (anchor = centroid), the Vedskjul's full-height
 * frameless opening on the front (0.1 m posts at the corners), else a door on the deck-facing side (the front when it
 * faces the deck or nothing better does; a side whose outside probe 0.6 m out lies on a deck piece and in no block).
 * Furniture whose centre the new unit covers is pushed out past its nearest side (`pushFurnitureOut`), and whole-block
 * moves, turns and deletes take only the furniture standing in the block's own rooms (`furnitureOfBlock`): a Vedskjul
 * placed over the terrace table and moved later leaves the table (fix round after 2b). Final fix round after 2b: only
 * furniture outside every block is pushed (never the house's), clear of walls and door swings; a block moved or turned
 * onto terrace furniture pushes it out too (`EditContext.pushed`), so a unit never takes it over; a Vedskjul placed
 * with its open front against another block turns half round. Last fix round, fifth review: a template unit never
 * ends up on another block (`unitOverlaps`: deeper than UNIT_OVERLAP_TOL; along a wall is fine) — edge and corner moves
 * are cut back to the contact (`unitClampedPlan`; `blockEdgeMoveClamp` / `blockVertexMoveClamp` tell the drag), and for
 * placements, whole-block moves and turns state/editActions.ts shifts it clear (`unitClearShift`), stops it at the
 * contact (`unitMoveFraction`) or refuses; a whole-block move, turn or delete takes only what is the block's own
 * (`blockOwnership`: new walls in no other block, its rooms — `Room.unitId` — furniture and structure in no other
 * block), so a unit standing on the house leaves the house's walls, names and furniture; a unit's edge or corner moved
 * over terrace furniture pushes it out (`applyUnitPolygons`); a Vedskjul with its back against a block gets a lean-to
 * roof, high against that wall. Wall moves and end drags record on each wall they carry `Wall.carriedBy` (`markCarried`)
 * for "Ta tilbake".
 *
 * Rooms (§3.5): `reconcileRooms(baseDerived, next, nextDerived, { carried })` — each Room stays with a face of its
 * storey that overlaps its previous inner polygon (unchanged faces are kept without clipping; a room a whole-block
 * edit carried is compared with its previous polygon carried the same way): one Room per face, as many Rooms kept as
 * possible, then the largest total overlap (so a wall dragged past the middle of the room beside it moves the
 * boundary, it never swaps or merges the two rooms); its anchor moves to the face's label point when it is not
 * STRICTLY inside that face (on its boundary or within 1 cm of it counts as outside: a zero-thickness divider moved
 * onto an anchor would otherwise let derive hand the room to the neighbour face); two Rooms in one face (fewer faces than Rooms, e.g. a deleted wall) → the one with the
 * larger previous area stays, the other is deleted (reported as a merge); a split face → the larger overlap keeps the
 * Room, the other piece is unnamed ("Gi navn" → `nameFace`). `reviveRooms` brings back deleted Room records whose anchor
 * lies in an unnamed face (used by "Ta tilbake" with the records found in the undo history).
 */
import { nanoid } from 'nanoid';
import { nb } from '../i18n/nb';
import type { DerivedRoom, DerivedVariant, DerivedWall } from '../model/derived';
import type {
  Block,
  Deck,
  DeckSteps,
  FloorMaterial,
  FurnitureItem,
  Id,
  Opening,
  OpeningHost,
  OpeningType,
  Room,
  RoomType,
  StructureElement,
  Variant,
  VariantGhost,
  Vec2,
  Wall,
  WallKind,
} from '../model/types';
import { furnitureSizeFallback } from '../model/migrate';
import { cardinalOf, quarterTurns, unitFootprint, unitTemplate } from '../model/unitTemplates';
import type { UnitTemplate } from '../model/unitTemplates';
import {
  area,
  bbox,
  centroid,
  distancePointSegment,
  intersectPolygons,
  isSelfIntersecting,
  labelPoint,
  lineIntersection,
  pointInPolygon,
  projectPointOnSegment,
  signedArea,
  withClipFallback,
} from './polygon';
import { convexOverlap, convexPieces, furnitureFootprint, swingSector } from './furnitureDerive';
import { resolveJunctions } from './walls';
import type { EdgeJunction } from './walls';

// ---------------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------------

/** Points closer than this (m) coincide (wall ends, supports, edges). */
export const COINCIDE = 0.01;
/** Geometry closer than this (m) is "the same" (healing ghosts). */
const SAME = 0.001;
/** Shortest wall (m) the editor creates. */
export const MIN_WALL_LENGTH = 0.05;
/** Smallest block area (m²) an edge / vertex move may leave. */
const MIN_BLOCK_AREA = 0.25;
/** Smallest deck area (m²). */
const MIN_DECK_AREA = 0.5;
/** Supports within this angle (sin) of the wall direction are parallel (not anchoring). */
const SUPPORT_PARALLEL_SIN = Math.sin((5 * Math.PI) / 180);
const PARALLEL_SIN = Math.sin((0.5 * Math.PI) / 180);
/** Probe distance (m) inside a host for an opening's default level (walls.ts SILL_PROBE). */
const SILL_PROBE = 0.2;
/** Probe distance (m) outside a unit's edge for the deck-facing side. */
const DECK_PROBE = 0.6;
const TINY = 1e-9;

export const GHOST_SUFFIX = '/ghost';
export const ghostIdOf = (id: Id): Id => `${id}${GHOST_SUFFIX}`;
/** The live element's id of a `${id}/ghost` id, else null. */
export function originalIdOf(ghostId: Id): Id | null {
  return ghostId.endsWith(GHOST_SUFFIX) ? ghostId.slice(0, -GHOST_SUFFIX.length) : null;
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a: Vec2): Vec2 => {
  const l = len(a);
  return l < TINY ? [1, 0] : [a[0] / l, a[1] / l];
};
const leftNormal = (u: Vec2): Vec2 => [-u[1], u[0]];
/** Coordinates rounded to the nanometre (kills float noise such as 0.29999999999999993 in stored data). */
const clean = (v: number): number => {
  const r = Math.round(v * 1e9) / 1e9;
  return r === 0 ? 0 : r;
};
const copy = (p: Vec2): Vec2 => [clean(p[0]), clean(p[1])];
/**
 * An opening offset re-computed from its plan position: cleaned like a coordinate, but within 10 nm of a tenth of a
 * millimetre it is that value — a wall stretched or turned there and back gives today's offset again exactly (the
 * nanometre rounding of the step there left 0.529999999; polish round 2b).
 */
const cleanOffset = (v: number): number => {
  const r = Math.round(v * 1e4) / 1e4;
  return Math.abs(v - r) < 1e-8 ? (r === 0 ? 0 : r) : clean(v);
};
/** a + b, cleaned (stored coordinates). */
const addc = (a: Vec2, b: Vec2): Vec2 => copy(add(a, b));
const sinAngle = (u: Vec2, v: Vec2): number => Math.abs(cross(unit(u), unit(v)));
const isParallel = (u: Vec2, v: Vec2, sin = PARALLEL_SIN): boolean => sinAngle(u, v) <= sin;
const samePoint = (a: Vec2, b: Vec2, tol = SAME): boolean => dist(a, b) <= tol;
/** Plain deep copy of a (possibly draft) JSON value. */
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** Distance from p to the infinite line through a, b. */
const lineDistance = (p: Vec2, a: Vec2, b: Vec2): number => {
  const d = sub(b, a);
  const l = len(d);
  return l < TINY ? dist(p, a) : Math.abs(cross(d, sub(p, a))) / l;
};
const newId = (prefix: string): Id => `${prefix}-${nanoid(8)}`;

/** A plan transform (translation / rotation) that an edit applied to a carried room. */
export type PlanTransform = (p: Vec2) => Vec2;

/** Extra fields of the edit context. */
export interface EditContext {
  /** The variant before the edit (read-only). Drags: the pointer-down base. */
  base: Variant;
  /** deriveVariant(base, …). */
  derived: DerivedVariant;
  /**
   * Out: rooms a whole-block edit carried along (moveBlock, rotateBlock), with the transform it applied. The caller
   * hands it to `reconcileRooms`, which matches those rooms by their previous polygon transformed the same way.
   */
  carried?: Map<Id, PlanTransform>;
  /**
   * Out: furniture a whole-block edit pushed out of the block (moveBlock, rotateBlock; fix round 2b, final): what stood
   * where the block went and was not its own. The caller toasts it.
   */
  pushed?: Id[];
}

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

/** docs/phase2-plan.md §1.1: the bundled Forslag D is the immutable base proposal; nothing else is locked. */
export function isLocked(variant: Pick<Variant, 'locked'> | null | undefined): boolean {
  return variant?.locked === true;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

function storeyOfLevel(v: Variant, levelId: Id): Id | undefined {
  return v.levels.find((l) => l.id === levelId)?.storeyId;
}

/** Storeys a stored wall takes part in (derived storeyIds, else the storey of its level). */
function wallStoreys(ctx: EditContext, wall: Wall): Id[] {
  const dw = ctx.derived.walls.find((w) => w.source.kind === 'wall' && w.source.wallId === wall.id);
  if (dw && dw.storeyIds.length > 0) return dw.storeyIds;
  const s = storeyOfLevel(ctx.base, wall.levelId);
  return s ? [s] : [];
}

const shareStorey = (a: readonly Id[], b: readonly Id[]): boolean => a.some((x) => b.includes(x));

/** Stored, non-removed walls of the base that share a storey with `storeys` (except `except`). */
function liveWalls(ctx: EditContext, storeys: readonly Id[] | null, except: ReadonlySet<Id> = new Set()): Wall[] {
  return ctx.base.walls.filter((w) => w.status !== 'removed' && !except.has(w.id) && (storeys === null || shareStorey(wallStoreys(ctx, w), storeys)));
}

function blockEdgeGeom(block: Block, i: number): { a: Vec2; b: Vec2 } {
  const n = block.polygon.length;
  return { a: block.polygon[i].p, b: block.polygon[(i + 1) % n].p };
}

/** Outward unit normal of edge i of a polygon (any orientation). */
function outwardNormal(points: Vec2[], i: number): Vec2 {
  const a = points[i];
  const b = points[(i + 1) % points.length];
  const u = unit(sub(b, a));
  const ccw = signedArea(points) >= 0;
  return ccw ? [u[1], -u[0]] : [-u[1], u[0]];
}

/** Host line of an opening host in the given variant: start, end, length. Null when the host is unknown. */
export function hostLine(v: Variant, host: OpeningHost): { a: Vec2; b: Vec2; length: number; block?: Block; wall?: Wall } | null {
  if (host.kind === 'wall') {
    const wall = v.walls.find((w) => w.id === host.wallId);
    return wall ? { a: wall.a, b: wall.b, length: dist(wall.a, wall.b), wall } : null;
  }
  const block = v.blocks.find((b) => b.id === host.blockId);
  if (!block) return null;
  const i = block.polygon.findIndex((x) => x.id === host.edgeId);
  if (i < 0) return null;
  const { a, b } = blockEdgeGeom(block, i);
  return { a, b, length: dist(a, b), block };
}

const sameHost = (h1: OpeningHost, h2: OpeningHost): boolean =>
  h1.kind === 'wall' ? h2.kind === 'wall' && h2.wallId === h1.wallId : h2.kind === 'blockEdge' && h2.blockId === h1.blockId && h2.edgeId === h1.edgeId;

const pointAlong = (a: Vec2, b: Vec2, s: number): Vec2 => add(a, scale(unit(sub(b, a)), s));
const along = (a: Vec2, b: Vec2, p: Vec2): number => dot(sub(p, a), unit(sub(b, a)));

/** Offset clamped so an opening of width w fits in [lo, hi] (end-touch allowed); the middle when it does not fit. */
function clampOffset(offset: number, width: number, lo: number, hi: number): number {
  if (hi - lo < width) return (lo + hi) / 2;
  return Math.min(hi - width / 2, Math.max(lo + width / 2, offset));
}

// ---------------------------------------------------------------------------
// Status bookkeeping and ghosts
// ---------------------------------------------------------------------------

function pushOpeningGhost(draft: Variant, o: Opening, host: OpeningHost, offset: number): void {
  const gid = ghostIdOf(o.id);
  if (draft.openings.some((x) => x.id === gid)) return;
  const ghost = plain(o);
  ghost.id = gid;
  ghost.status = 'removed';
  ghost.host = plain(host);
  ghost.offset = offset;
  draft.openings.push(ghost);
}

/**
 * Status bookkeeping (§3.4): an existing stored wall or opening becomes 'new' and leaves a 'removed' copy with its
 * current geometry (`${id}/ghost`). Returns true when the element was existing. Idempotent.
 */
export function touchExisting(draft: Variant, id: Id): boolean {
  const wall = draft.walls.find((w) => w.id === id);
  if (wall) {
    if (wall.status !== 'existing') return false;
    const gid = ghostIdOf(id);
    if (!draft.walls.some((w) => w.id === gid)) {
      const ghost = plain(wall);
      ghost.id = gid;
      ghost.status = 'removed';
      draft.walls.push(ghost);
      // Demolition markers belong to the old wall.
      for (const o of draft.openings) {
        if (o.status === 'removed' && o.host.kind === 'wall' && o.host.wallId === id) o.host = { kind: 'wall', wallId: gid };
      }
    }
    wall.status = 'new';
    return true;
  }
  const o = draft.openings.find((x) => x.id === id);
  if (o) {
    if (o.status !== 'existing') return false;
    pushOpeningGhost(draft, o, o.host, o.offset);
    o.status = 'new';
    return true;
  }
  return false;
}

/**
 * A wall about to MOVE: touch it and its existing openings (they move with it); the openings' ghosts are hosted on
 * the wall's ghost at their old plan position.
 */
function touchWallForMove(draft: Variant, wallId: Id): void {
  const wall = draft.walls.find((w) => w.id === wallId);
  if (!wall) return;
  const a = copy(wall.a);
  const b = copy(wall.b);
  const moving = draft.openings.filter((o) => o.status === 'existing' && o.host.kind === 'wall' && o.host.wallId === wallId);
  touchExisting(draft, wallId);
  const ghostWall = draft.walls.find((w) => w.id === ghostIdOf(wallId));
  for (const o of moving) {
    const centre = pointAlong(a, b, o.offset);
    touchExisting(draft, o.id);
    const g = draft.openings.find((x) => x.id === ghostIdOf(o.id));
    if (g && ghostWall) {
      g.host = { kind: 'wall', wallId: ghostWall.id };
      g.offset = clean(along(ghostWall.a, ghostWall.b, centre));
    }
  }
}

function sameWallGeometry(w: Wall, g: Wall): boolean {
  return (
    samePoint(w.a, g.a) &&
    samePoint(w.b, g.b) &&
    Math.abs(w.thickness - g.thickness) <= SAME &&
    w.kind === g.kind &&
    w.levelId === g.levelId &&
    (w.faceLeft ?? null) === (g.faceLeft ?? null) &&
    (w.faceRight ?? null) === (g.faceRight ?? null)
  );
}

function sameOpeningGeometry(o: Opening, g: Opening): boolean {
  return (
    sameHost(o.host, g.host) &&
    Math.abs(o.offset - g.offset) <= SAME &&
    o.type === g.type &&
    Math.abs(o.width - g.width) <= SAME &&
    Math.abs(o.height - g.height) <= SAME &&
    Math.abs(o.sill - g.sill) <= SAME &&
    (o.fullHeight ?? false) === (g.fullHeight ?? false) &&
    (o.leaves ?? 1) === (g.leaves ?? 1)
  );
}

const EDGE_GHOST = /^(.*)\/([^/]+)\/ghost(?:\/\d+)?$/;

/** Block id and edge id of a `Variant.ghosts` id, or null. */
export function parseEdgeGhostId(id: Id): { blockId: Id; edgeId: Id } | null {
  const m = EDGE_GHOST.exec(id);
  return m ? { blockId: m[1], edgeId: m[2] } : null;
}

/**
 * The parts of the range [s0, s1] of a block edge that lie on a shared segment where the edge has no wall of its own
 * (merged, sorted; empty when none overlaps by more than SAME).
 */
function sharedWithoutWall(list: readonly EdgeJunction[] | undefined, s0: number, s1: number): [number, number][] {
  const lo = Math.min(s0, s1);
  const hi = Math.max(s0, s1);
  const parts: [number, number][] = [];
  for (const j of list ?? []) {
    if (j.role === 'own') continue;
    const p0 = Math.max(lo, j.s0);
    const p1 = Math.min(hi, j.s1);
    if (p1 - p0 > SAME) parts.push([p0, p1]);
  }
  return mergeRanges(parts);
}

/**
 * Clip an edge ghost that lies on its live edge to the stretch [c0, c1] (along the edge) that a junction still keeps
 * open (fix round after 2b): the rest of its line is today's wall again. Keeps the ghost's direction; its host wall
 * (opening ghosts at the old place) shrinks with it, and the openings on the host outside the stretch go back onto the
 * edge at their plan position (where they heal against live openings that are back too). Returns false when an equal
 * ghost of the same edge already records that stretch (the caller drops this one).
 */
function clipEdgeGhost(draft: Variant, g: VariantGhost, block: Block, edgeIndex: number, c0: number, c1: number): boolean {
  const { a, b } = blockEdgeGeom(block, edgeIndex);
  const forward = along(a, b, g.a) <= along(a, b, g.b);
  const p = copy(pointAlong(a, b, forward ? c0 : c1));
  const q = copy(pointAlong(a, b, forward ? c1 : c0));
  const ref = parseEdgeGhostId(g.id);
  const twin = (draft.ghosts ?? []).find((x) => x !== g && parseEdgeGhostId(x.id)?.edgeId === ref?.edgeId && parseEdgeGhostId(x.id)?.blockId === ref?.blockId && samePoint(x.a, p) && samePoint(x.b, q));
  if (twin) return false;
  const host = draft.walls.find((w) => w.id === g.id && w.status === 'removed');
  if (host) {
    const ref2 = parseEdgeGhostId(g.id);
    for (const o of draft.openings) {
      if (o.host.kind !== 'wall' || o.host.wallId !== g.id) continue;
      const centre = pointAlong(host.a, host.b, o.offset);
      const s = along(a, b, centre);
      if (s >= c0 - SAME && s <= c1 + SAME) o.offset = clean(along(p, q, centre));
      else if (ref2) {
        o.host = { kind: 'blockEdge', blockId: ref2.blockId, edgeId: ref2.edgeId };
        o.offset = clean(s);
      }
    }
    host.a = p;
    host.b = q;
    if (!draft.openings.some((o) => o.host.kind === 'wall' && o.host.wallId === g.id)) draft.walls.splice(draft.walls.indexOf(host), 1);
  }
  g.a = p;
  g.b = q;
  return true;
}

/**
 * Drop every ghost whose element is back on it (see the header): walls and openings get status 'existing' again,
 * a block edge ghost covered by its edge disappears — unless a junction without a wall ('open', or the partner's
 * wall) lies on that stretch: there today's wall is still gone (see addJunctionGhosts), and the ghost is clipped to
 * that stretch (fix round after 2b: main south +0.3, glass east +0.5, then "Ta tilbake" on the main wall left its
 * ghost [9, 0]–[12, 0] over the live wall from 9.5 to 12; now [9, 0]–[9.5, 0], as from the seed with glass +0.5).
 */
export function healGhosts(draft: Variant): void {
  // Edge ghosts first: their host walls give their opening ghosts back to the edge, where they may heal below.
  if (draft.ghosts && draft.ghosts.length > 0) {
    const healed: Id[] = [];
    let junctions: Map<Id, EdgeJunction[][]> | null = null;
    const kept = draft.ghosts.filter((g) => {
      const ref = parseEdgeGhostId(g.id);
      if (!ref) return true;
      const block = draft.blocks.find((b) => b.id === ref.blockId);
      const i = block ? block.polygon.findIndex((v) => v.id === ref.edgeId) : -1;
      if (!block || i < 0) return true;
      const { a, b } = blockEdgeGeom(block, i);
      if (distancePointSegment(g.a, a, b) > SAME || distancePointSegment(g.b, a, b) > SAME) return true;
      junctions ??= resolveJunctions(draft);
      const open = sharedWithoutWall(junctions.get(block.id)?.[i], along(a, b, g.a), along(a, b, g.b));
      if (open.length > 0) {
        // Still open there: keep the ghost on that stretch only (the first to the last open part).
        const c0 = open[0][0];
        const c1 = open[open.length - 1][1];
        const s0 = Math.min(along(a, b, g.a), along(a, b, g.b));
        const s1 = Math.max(along(a, b, g.a), along(a, b, g.b));
        if (c0 <= s0 + SAME && c1 >= s1 - SAME) return true;
        if (clipEdgeGhost(draft, g, block, i, c0, c1)) return true;
      }
      healed.push(g.id);
      return false;
    });
    // Only when one healed: a new array for nothing made every refused edit an undo step (final morning round).
    if (kept.length !== draft.ghosts.length) draft.ghosts = kept;
    for (const id of healed) dropGhostHost(draft, id);
    if (draft.ghosts.length === 0) delete draft.ghosts;
  }
  for (const g of [...draft.walls]) {
    const orig = g.status === 'removed' ? originalIdOf(g.id) : null;
    if (orig === null) continue;
    const live = draft.walls.find((w) => w.id === orig);
    if (!live || live.status !== 'new' || !sameWallGeometry(live, g)) continue;
    live.status = 'existing';
    delete live.carriedBy;
    for (const o of draft.openings) {
      if (o.host.kind === 'wall' && o.host.wallId === g.id) o.host = { kind: 'wall', wallId: orig };
    }
    draft.walls.splice(draft.walls.indexOf(g), 1);
  }
  for (const g of [...draft.openings]) {
    const orig = g.status === 'removed' ? originalIdOf(g.id) : null;
    if (orig === null) continue;
    const live = draft.openings.find((o) => o.id === orig);
    if (!live || live.status !== 'new' || !sameOpeningGeometry(live, g)) continue;
    live.status = 'existing';
    draft.openings.splice(draft.openings.indexOf(g), 1);
  }
}

/** Ranges [s0, s1] (merged) of the existing derived exterior pieces of a block edge, in the base. */
function existingEdgeRanges(ctx: EditContext, blockId: Id, edgeId: Id): [number, number][] {
  const ranges: [number, number][] = [];
  for (const w of ctx.derived.walls) {
    if (w.source.kind !== 'blockEdge' || w.source.blockId !== blockId || w.source.edgeId !== edgeId) continue;
    if (w.isNew || w.isGhost) continue;
    ranges.push([w.source.s0, w.source.s1]);
  }
  ranges.sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + SAME) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** An edge ghost and the range [s0, s1] along the OLD edge (from its old start) that it records. */
interface EdgeGhostRange {
  ghost: VariantGhost;
  s0: number;
  s1: number;
}

/**
 * The `Variant.ghosts` entry of block edge (blockId, edgeId) on the line a → b: an existing entry with the same line,
 * else a new one with the first free id (`${blockId}/${edgeId}/ghost`, `/ghost/2` …; a shortened edge's stub and a
 * later move of the same edge get different ids).
 */
function edgeGhostFor(draft: Variant, blockId: Id, edgeId: Id, a: Vec2, b: Vec2): VariantGhost {
  const ghosts = (draft.ghosts ??= []);
  const same = ghosts.find((g) => {
    const ref = parseEdgeGhostId(g.id);
    return ref?.blockId === blockId && ref.edgeId === edgeId && samePoint(g.a, a) && samePoint(g.b, b);
  });
  if (same) return same;
  const prefix = `${blockId}/${edgeId}${GHOST_SUFFIX}`;
  let id = prefix;
  for (let k = 2; ghosts.some((g) => g.id === id) || draft.walls.some((w) => w.id === id); k++) id = `${prefix}/${k}`;
  const ghost: VariantGhost = { id, a: copy(a), b: copy(b) };
  ghosts.push(ghost);
  return ghost;
}

/**
 * Whether a segment of block `blockId` that derive counts as existing is NOT part of today's cabin but an earlier
 * edit's work (a wall moved into an existing part counts as existing; so did the growth of an existing block without
 * explicit parts before `todayPart` gave it one), so it gets no ghost when it moves or is cut off:
 *  - `movedEdgeId`: that edge already has a ghost of an earlier move (not on its current line) — its line is new;
 *  - the segment lies beyond an older edge ghost (of any block): on the far side of the ghost's line from the block's
 *    centre, within the ghost's span — where an earlier edit grew the block (6 → 7 → 6 leaves nothing behind).
 */
function notToday(ctx: EditContext, blockId: Id, p: Vec2, q: Vec2, movedEdgeId?: Id): boolean {
  const block = ctx.base.blocks.find((b) => b.id === blockId);
  if (!block || !ctx.base.ghosts) return false;
  const centre = centroid(block.polygon.map((v) => v.p));
  const mid = scale(add(p, q), 0.5);
  return ctx.base.ghosts.some((g) => {
    const ref = parseEdgeGhostId(g.id);
    if (movedEdgeId !== undefined && ref?.blockId === blockId && ref.edgeId === movedEdgeId && (lineDistance(g.a, p, q) > SAME || lineDistance(g.b, p, q) > SAME)) return true;
    const L = dist(g.a, g.b);
    if (L < TINY) return false;
    const u = unit(sub(g.b, g.a));
    const s = dot(sub(mid, g.a), u);
    if (s < -COINCIDE || s > L + COINCIDE) return false;
    const side = cross(u, sub(mid, g.a));
    const home = cross(u, sub(centre, g.a));
    return Math.abs(side) > SAME && Math.abs(home) > SAME && Math.sign(side) !== Math.sign(home);
  });
}

/** Record the old line of a MOVED block edge's existing pieces as `Variant.ghosts` (once per line). */
function addEdgeGhosts(draft: Variant, ctx: EditContext, blockId: Id, edgeId: Id, a: Vec2, b: Vec2): EdgeGhostRange[] {
  const out: EdgeGhostRange[] = [];
  for (const [s0, s1] of existingEdgeRanges(ctx, blockId, edgeId)) {
    const p = pointAlong(a, b, s0);
    const q = pointAlong(a, b, s1);
    if (!notToday(ctx, blockId, p, q, edgeId)) out.push({ ghost: edgeGhostFor(draft, blockId, edgeId, p, q), s0, s1 });
  }
  return out;
}

/**
 * Record the existing ranges a SHORTENED block edge lost (its line did not move; e.g. the bod's side walls when a
 * junction shift moves its end edge) as `Variant.ghosts` — not on an edge whose line an earlier edit moved (`notToday`
 * with the edge id: that line is not today's).
 */
function addStubGhosts(draft: Variant, ctx: EditContext, e: ChangedEdge): EdgeGhostRange[] {
  const L0 = dist(e.oa, e.ob);
  const t0 = along(e.oa, e.ob, e.na);
  const t1 = along(e.oa, e.ob, e.nb);
  const lost: [number, number][] = [];
  if (t0 > SAME) lost.push([0, Math.min(t0, L0)]);
  if (t1 < L0 - SAME) lost.push([Math.max(t1, 0), L0]);
  const out: EdgeGhostRange[] = [];
  for (const [r0, r1] of existingEdgeRanges(ctx, e.blockId, e.edgeId)) {
    for (const [l0, l1] of lost) {
      const s0 = Math.max(r0, l0);
      const s1 = Math.min(r1, l1);
      if (s1 - s0 <= SAME) continue;
      const p = pointAlong(e.oa, e.ob, s0);
      const q = pointAlong(e.oa, e.ob, s1);
      if (!notToday(ctx, e.blockId, p, q, e.edgeId)) out.push({ ghost: edgeGhostFor(draft, e.blockId, e.edgeId, p, q), s0, s1 });
    }
  }
  return out;
}

/** Merged, sorted copy of a list of ranges. */
function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = ranges.map(([p, q]): [number, number] => [Math.min(p, q), Math.max(p, q)]).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + SAME) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}

/** The parts of the ranges `from` (merged) outside every range of `minus` (merged). */
function subtractRanges(from: [number, number][], minus: [number, number][]): [number, number][] {
  let out = from;
  for (const [m0, m1] of minus) {
    out = out.flatMap(([r0, r1]): [number, number][] => {
      if (m1 <= r0 || m0 >= r1) return [[r0, r1]];
      const pieces: [number, number][] = [];
      if (m0 > r0) pieces.push([r0, m0]);
      if (m1 < r1) pieces.push([m1, r1]);
      return pieces;
    });
  }
  return out.filter(([r0, r1]) => r1 - r0 > SAME);
}

/**
 * Edge ghosts for today's walls that a block edit OPENS without moving them: an edge whose line stays (unchanged or
 * only stretched) and whose existing pieces in the base now lie on a shared segment without a wall of its own (an
 * 'open' junction, or one where the partner keeps the wall) that was not shared before. E.g. the glass bump grown
 * 0.5 m east opens 9..9.5 of the main block's south wall: `blk-main/v-main-sw/ghost` [9, 0]–[9.5, 0]. Stretches along
 * an edge of the partner's part of today's cabin (`todayOutlines`) get none: today there was no wall of this block
 * there (the glass bump shrunk and then grown back to x 5 re-opens 5..5.5, which was open today), and none on an edge
 * whose line an earlier edit moved (`notToday` with the edge id, polish round 2b: main south +0.3, then glass east
 * +0.5 left a stray ghost on the moved line whose "Ta tilbake" moved today's wall). Called after the new
 * polygons are in the draft. (healGhosts keeps such a ghost while the junction covers it; restoring it moves the
 * partner's edge back, see applyRestoreEdgeGhost.)
 */
function addJunctionGhosts(draft: Variant, ctx: EditContext, changed: ChangedEdge[]): void {
  const after = resolveJunctions(draft);
  for (const db of ctx.derived.blocks) {
    const b0 = ctx.base.blocks.find((b) => b.id === db.block.id);
    const b = draft.blocks.find((x) => x.id === db.block.id);
    if (!b0 || !b || b.polygon.length !== b0.polygon.length) continue;
    const n = b0.polygon.length;
    for (let i = 0; i < n; i++) {
      const edgeId = b0.polygon[i].id;
      if (changed.some((e) => e.blockId === b0.id && e.edgeId === edgeId && e.moved)) continue;
      const shared = (after.get(b0.id)?.[i] ?? []).filter((j) => j.role !== 'own');
      if (shared.length === 0) continue;
      const { a: oa, b: ob } = blockEdgeGeom(b0, i);
      const { a: na, b: nb } = blockEdgeGeom(b, i);
      const now = mergeRanges(shared.map((j) => [along(oa, ob, pointAlong(na, nb, j.s0)), along(oa, ob, pointAlong(na, nb, j.s1))]));
      const before = mergeRanges(db.junctions.filter((j) => j.edgeIndex === i && j.role !== 'owner').map((j) => [j.s0, j.s1]));
      const today = mergeRanges(
        [...new Set(shared.map((j) => j.otherBlockId))].flatMap((id) => {
          const partner = ctx.base.blocks.find((x) => x.id === id);
          return partner ? todayOutlines(partner).flatMap((poly) => collinearRanges(oa, ob, poly)) : [];
        }),
      );
      const fresh = subtractRanges(subtractRanges(now, before), today);
      if (fresh.length === 0) continue;
      for (const [r0, r1] of existingEdgeRanges(ctx, b0.id, edgeId)) {
        for (const [f0, f1] of fresh) {
          const s0 = Math.max(r0, f0);
          const s1 = Math.min(r1, f1);
          if (s1 - s0 <= SAME) continue;
          const p = pointAlong(oa, ob, s0);
          const q = pointAlong(oa, ob, s1);
          if (!notToday(ctx, b0.id, p, q, edgeId)) edgeGhostFor(draft, b0.id, edgeId, p, q);
        }
      }
    }
  }
}

/** Polygons of today's cabin in a block: its existing explicit parts, or the whole outline of an existing block without parts. */
function todayOutlines(block: Block): Vec2[][] {
  if (block.parts.length === 0) return block.isNew ? [] : [block.polygon.map((v) => v.p)];
  return block.parts.filter((p) => !p.isNew).map((p) => p.polygon);
}

/** Ranges along the segment a → b (distances from a) where an edge of `poly` lies on it (collinear within 1 cm). */
function collinearRanges(a: Vec2, b: Vec2, poly: Vec2[]): [number, number][] {
  const out: [number, number][] = [];
  const L = dist(a, b);
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k];
    const q = poly[(k + 1) % poly.length];
    if (lineDistance(p, a, b) > COINCIDE || lineDistance(q, a, b) > COINCIDE) continue;
    const s0 = Math.max(0, Math.min(along(a, b, p), along(a, b, q)));
    const s1 = Math.min(L, Math.max(along(a, b, p), along(a, b, q)));
    if (s1 - s0 > SAME) out.push([s0, s1]);
  }
  return out;
}

/**
 * Copy-on-write of today's outline (§3.4): an existing block WITHOUT explicit parts (a stored copy of Forslag D before
 * seed revision 5 gave the glass bump `part-glass-old`) gets its pre-edit polygon as an explicit existing part the
 * first time an edit changes its outline, so — like every other block of today's cabin — what the edit adds is the new
 * implicit remainder and the old outline stays today's. Today's outline is built from today's LINES (polish round,
 * phase 2b): an edge that already carries an edge ghost of an earlier move (a copy whose glass bump was grown under
 * revision 4: ghost at x 9, edge at 9.5) runs on its ghost's line, each corner being the intersection of the two
 * adjacent lines; so the earlier growth is new from that edit on (falls back to the plain outline if that polygon is
 * not valid).
 */
function todayPart(block: Block, ghosts: readonly VariantGhost[] | undefined): Block['parts'][number] {
  const pts = block.polygon.map((v) => v.p);
  const n = pts.length;
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const g = (ghosts ?? []).find((x) => {
      const ref = parseEdgeGhostId(x.id);
      return ref?.blockId === block.id && ref.edgeId === block.polygon[i].id && (lineDistance(x.a, a, b) > SAME || lineDistance(x.b, a, b) > SAME);
    });
    return g && dist(g.a, g.b) > TINY ? { o: g.a, d: sub(g.b, g.a) } : { o: a, d: sub(b, a) };
  });
  const today = pts.map((p, i) => {
    const prev = lines[(i - 1 + n) % n];
    return copy(lineIntersection(prev.o, prev.d, lines[i].o, lines[i].d) ?? p);
  });
  const polygon = validBlockPolygon(pts, today) ? today : pts.map(copy);
  return { id: `${block.id}-today`, name: nb.status.existing, polygon, isNew: false };
}

/**
 * The stored wall that carries the opening ghosts of an edge ghost at the edge's old place: a 'removed'
 * 'exterior-old' wall on the ghost line with the block's build-up (axis line = the outer face of the frame), id =
 * the edge ghost id. It is a ghost like any removed wall (plan only: no rooms, areas or 3D), selecting it selects the
 * edge ghost, and it goes when the edge ghost heals or is restored.
 */
function ensureGhostHost(draft: Variant, ctx: EditContext, blockId: Id, ghost: VariantGhost): Wall | null {
  const have = draft.walls.find((w) => w.id === ghost.id);
  if (have) return have.status === 'removed' ? have : null;
  const block = ctx.base.blocks.find((b) => b.id === blockId);
  if (!block) return null;
  const t = block.wall.thickness;
  const out = block.wall.outerOffset;
  const ccw = signedArea(block.polygon.map((v) => v.p)) >= 0;
  const host: Wall = {
    id: ghost.id,
    a: copy(ghost.a),
    b: copy(ghost.b),
    thickness: t,
    levelId: block.levelId,
    status: 'removed',
    kind: 'exterior-old',
    heightMode: 'roof',
    faceLeft: ccw ? t - out : out,
    faceRight: ccw ? out : t - out,
  };
  draft.walls.push(host);
  return host;
}

/** A removed stored wall that hosts opening ghosts of an edge ghost (see ensureGhostHost). */
function isGhostHost(v: Variant, wallId: Id): boolean {
  const ref = parseEdgeGhostId(wallId);
  return ref !== null && v.walls.some((w) => w.id === wallId && w.status === 'removed') && v.blocks.some((b) => b.id === ref.blockId && b.polygon.some((x) => x.id === ref.edgeId));
}

/**
 * The edge ghost `ghostId` is gone (healed / restored): drop its host wall; the openings on it go back onto the block
 * edge at their plan position (so a live opening that is back at the same place heals with them).
 */
function dropGhostHost(draft: Variant, ghostId: Id): void {
  const host = draft.walls.find((w) => w.id === ghostId && w.status === 'removed');
  const ref = parseEdgeGhostId(ghostId);
  if (!host || !ref) return;
  const block = draft.blocks.find((b) => b.id === ref.blockId);
  const i = block ? block.polygon.findIndex((v) => v.id === ref.edgeId) : -1;
  for (const o of [...draft.openings]) {
    if (o.host.kind !== 'wall' || o.host.wallId !== ghostId) continue;
    if (!block || i < 0) {
      draft.openings.splice(draft.openings.indexOf(o), 1);
      continue;
    }
    const { a, b } = blockEdgeGeom(block, i);
    const centre = pointAlong(host.a, host.b, o.offset);
    o.host = { kind: 'blockEdge', blockId: ref.blockId, edgeId: ref.edgeId };
    o.offset = clean(along(a, b, centre));
  }
  draft.walls.splice(draft.walls.indexOf(host), 1);
}

// ---------------------------------------------------------------------------
// Openings: positions, defaults, levels, swing
// ---------------------------------------------------------------------------

/**
 * Keep the plan position of the openings on a stored wall whose line changed from (oldA, oldB) (clamped to the wall).
 * `bookkeep` (block-edit cascades): an EXISTING opening that a clamp moves becomes new and leaves its ghost at the old
 * centre, on the wall's ghost when the wall has one.
 */
function keepWallOpenings(draft: Variant, wallId: Id, oldA: Vec2, oldB: Vec2, bookkeep = false): void {
  const wall = draft.walls.find((w) => w.id === wallId);
  if (!wall) return;
  const L = dist(wall.a, wall.b);
  const ghost = draft.walls.find((w) => w.id === ghostIdOf(wallId) && w.status === 'removed');
  for (const o of [...draft.openings]) {
    if (o.host.kind !== 'wall' || o.host.wallId !== wallId) continue;
    const centre = pointAlong(oldA, oldB, o.offset);
    const offset = cleanOffset(clampOffset(along(wall.a, wall.b, centre), o.width, 0, L));
    if (bookkeep && o.status === 'existing' && dist(pointAlong(wall.a, wall.b, offset), centre) > SAME) {
      const host = ghost ?? wall;
      pushOpeningGhost(draft, o, { kind: 'wall', wallId: host.id }, clean(along(host.a, host.b, centre)));
      o.status = 'new';
    }
    o.offset = offset;
  }
}

/**
 * Keep the plan position of the openings on a changed block edge (clamped to the new segment), with the status
 * bookkeeping (§1.2): an EXISTING opening whose plan centre changes (it moved with the edge's line, or a shortened
 * edge clamped it) becomes new and leaves its ghost at the old centre, hosted on the host wall of the edge ghost whose
 * range holds (or, for a clamp, lies within half the opening's width of) the old centre — so "Ta tilbake" on that
 * edge ghost brings it back —, else on the edge itself. Removed openings (ghosts, demolition markers) whose old centre
 * is no longer on the edge stay at the old place on such a host as well.
 */
function keepEdgeOpenings(draft: Variant, ctx: EditContext, e: ChangedEdge, ghosts: EdgeGhostRange[]): void {
  const L = dist(e.na, e.nb);
  const onNewEdge = (s: number): boolean => {
    const sNew = along(e.na, e.nb, pointAlong(e.oa, e.ob, s));
    return !e.moved && sNew >= -SAME && sNew <= L + SAME;
  };
  const oldPlace = (o: Opening, s: number): { wall: Wall } | null => {
    const r = ghosts.find((g) => s >= g.s0 - SAME && s <= g.s1 + SAME) ?? ghosts.find((g) => s >= g.s0 - o.width / 2 && s <= g.s1 + o.width / 2);
    const wall = r ? ensureGhostHost(draft, ctx, e.blockId, r.ghost) : null;
    return wall ? { wall } : null;
  };
  for (const o of [...draft.openings]) {
    if (o.host.kind !== 'blockEdge' || o.host.blockId !== e.blockId || o.host.edgeId !== e.edgeId) continue;
    const centre = pointAlong(e.oa, e.ob, o.offset);
    if (o.status === 'removed') {
      const on = onNewEdge(o.offset);
      const at = on ? null : oldPlace(o, o.offset);
      if (at) {
        o.host = { kind: 'wall', wallId: at.wall.id };
        o.offset = clean(along(at.wall.a, at.wall.b, centre));
      } else {
        // A ghost stays where the opening was (fix round 2: a shortened edge no longer drags it along).
        o.offset = clean(on ? along(e.na, e.nb, centre) : clampOffset(along(e.na, e.nb, centre), o.width, 0, L));
      }
      continue;
    }
    const offset = clean(clampOffset(along(e.na, e.nb, centre), o.width, 0, L));
    if (o.status === 'existing' && dist(pointAlong(e.na, e.nb, offset), centre) > SAME) {
      const at = oldPlace(o, o.offset);
      if (at) pushOpeningGhost(draft, o, { kind: 'wall', wallId: at.wall.id }, clean(along(at.wall.a, at.wall.b, centre)));
      else pushOpeningGhost(draft, o, o.host, clean(along(e.na, e.nb, centre)));
      o.status = 'new';
    }
    o.offset = offset;
  }
}

export interface OpeningDefaults {
  width: number;
  height: number;
  sill: number;
  swing?: NonNullable<Opening['swing']>;
  style: Opening['style'];
}

/** Default size / sill / swing / style of a new opening by type. */
export function openingDefaults(type: OpeningType): OpeningDefaults {
  switch (type) {
    case 'window':
      return { width: 1.1, height: 1.2, sill: 0.8, style: { frameColour: 'white', mullions: [2, 2] } };
    case 'door':
      return { width: 0.9, height: 2.0, sill: 0, swing: { hinge: 'start', side: 'left' }, style: { frameColour: 'white' } };
    case 'glassDoor':
      return { width: 0.9, height: 2.05, sill: 0, swing: { hinge: 'start', side: 'left' }, style: { frameColour: 'white' } };
    case 'slidingDoor':
      return { width: 1.8, height: 2.05, sill: 0, style: { frameColour: 'white' } };
    case 'saunaDoor':
      return { width: 0.7, height: 1.9, sill: 0, swing: { hinge: 'start', side: 'right' }, style: { frameColour: 'wood' } };
    case 'opening':
      return { width: 0.9, height: 2.1, sill: 0, style: { frameColour: 'white' } };
  }
}

const SWINGING: ReadonlySet<OpeningType> = new Set<OpeningType>(['door', 'glassDoor', 'saunaDoor']);

/**
 * Default level of an opening's sill at a host position (walls.ts rule): block edge → the first 'replace' zone of the
 * block containing the point 0.2 m inside the edge at the centre, else the block level; stored wall → its level.
 */
export function defaultOpeningLevel(v: Variant, host: OpeningHost, offset: number): Id | null {
  if (host.kind === 'wall') return v.walls.find((w) => w.id === host.wallId)?.levelId ?? null;
  const block = v.blocks.find((b) => b.id === host.blockId);
  if (!block) return null;
  const i = block.polygon.findIndex((x) => x.id === host.edgeId);
  if (i < 0) return block.levelId;
  const { a, b } = blockEdgeGeom(block, i);
  const n = outwardNormal(block.polygon.map((x) => x.p), i);
  const probe = add(pointAlong(a, b, offset), scale(n, -SILL_PROBE));
  const zone = block.floorZones.find((z) => z.kind === 'replace' && z.polygon.length >= 3 && pointInPolygon(probe, z.polygon));
  return zone ? zone.levelId : block.levelId;
}

const rotate = (v: Vec2, theta: number): Vec2 => [v[0] * Math.cos(theta) - v[1] * Math.sin(theta), v[0] * Math.sin(theta) + v[1] * Math.cos(theta)];

/**
 * Swing on a new host direction `u2` keeping it in world terms (hinge jamb direction and opening side as plan
 * vectors). When the hosts are far from parallel, the world vectors are first turned with the host.
 */
export function swingOnNewHost(swing: NonNullable<Opening['swing']>, u1: Vec2, u2: Vec2): NonNullable<Opening['swing']> {
  const a = unit(u1);
  const b = unit(u2);
  let hingeDir = swing.hinge === 'start' ? scale(a, -1) : a;
  let sideN = swing.side === 'left' ? leftNormal(a) : scale(leftNormal(a), -1);
  if (Math.abs(dot(a, b)) < 0.5) {
    const theta = Math.atan2(cross(a, b), dot(a, b));
    hingeDir = rotate(hingeDir, theta);
    sideN = rotate(sideN, theta);
  }
  return { hinge: dot(hingeDir, b) >= 0 ? 'end' : 'start', side: dot(sideN, leftNormal(b)) >= 0 ? 'left' : 'right' };
}

/** Range [s0, s1] along the stored host of the derived piece containing `offset` (block edges), else the host. */
export function pieceRange(ctx: EditContext, host: OpeningHost, offset: number): [number, number] | null {
  const line = hostLine(ctx.base, host);
  if (!line) return null;
  if (host.kind === 'wall') return [0, line.length];
  const pieces = ctx.derived.walls.filter(
    (w) => !w.isGhost && w.source.kind === 'blockEdge' && w.source.blockId === host.blockId && w.source.edgeId === host.edgeId,
  );
  let best: [number, number] | null = null;
  let bestGap = Infinity;
  for (const w of pieces) {
    if (w.source.kind !== 'blockEdge') continue;
    const gap = Math.max(w.source.s0 - offset, offset - w.source.s1, 0);
    if (gap < bestGap) {
      bestGap = gap;
      best = [w.source.s0, w.source.s1];
    }
  }
  return best ?? [0, line.length];
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

interface Support {
  a: Vec2;
  b: Vec2;
}

/** Supports of a wall endpoint (see the header). */
function supportsAt(ctx: EditContext, p: Vec2, storeys: readonly Id[], except: ReadonlySet<Id>): Support[] {
  const out: Support[] = [];
  const storeySet = new Set(storeys);
  for (const block of ctx.base.blocks) {
    const n = block.polygon.length;
    for (let i = 0; i < n; i++) {
      const { a, b } = blockEdgeGeom(block, i);
      if (distancePointSegment(p, a, b) <= COINCIDE) out.push({ a, b });
    }
    const baseStorey = storeyOfLevel(ctx.base, block.levelId);
    for (const z of block.floorZones) {
      const zs = storeyOfLevel(ctx.base, z.levelId);
      const relevant = (zs !== undefined && storeySet.has(zs)) || (z.kind === 'replace' && baseStorey !== undefined && storeySet.has(baseStorey));
      if (!relevant) continue;
      for (let i = 0; i < z.polygon.length; i++) {
        const a = z.polygon[i];
        const b = z.polygon[(i + 1) % z.polygon.length];
        if (distancePointSegment(p, a, b) <= COINCIDE) out.push({ a, b });
      }
    }
  }
  for (const w of liveWalls(ctx, storeys, except)) {
    if (dist(p, w.a) <= COINCIDE || dist(p, w.b) <= COINCIDE) continue;
    if (distancePointSegment(p, w.a, w.b) <= COINCIDE) out.push({ a: w.a, b: w.b });
  }
  return out;
}

/**
 * Supports and followers of a wall end: supports as `supportsAt`, plus the coincident walls that reach a storey the
 * wall does not (a partition must not drag a wall that runs on through the loft; listed in `through` as well); the
 * other coincident walls follow.
 */
function endClass(
  ctx: EditContext,
  wall: Wall,
  p: Vec2,
  except: ReadonlySet<Id>,
): { supports: Support[]; followers: { wall: Wall; end: 'a' | 'b' }[]; through: { wall: Wall; end: 'a' | 'b' }[] } {
  const storeys = wallStoreys(ctx, wall);
  const supports = supportsAt(ctx, p, storeys, except);
  const followers: { wall: Wall; end: 'a' | 'b' }[] = [];
  const through: { wall: Wall; end: 'a' | 'b' }[] = [];
  for (const c of coincidentAt(ctx, p, storeys, except)) {
    if (wallStoreys(ctx, c.wall).some((s) => !storeys.includes(s))) {
      supports.push({ a: c.wall.a, b: c.wall.b });
      through.push(c);
    } else followers.push(c);
  }
  return { supports, followers, through };
}

/** Walls of the storeys with an end within 1 cm of p: { wall, end }. */
function coincidentAt(ctx: EditContext, p: Vec2, storeys: readonly Id[], except: ReadonlySet<Id>): { wall: Wall; end: 'a' | 'b' }[] {
  const out: { wall: Wall; end: 'a' | 'b' }[] = [];
  for (const w of liveWalls(ctx, storeys, except)) {
    if (dist(p, w.a) <= COINCIDE) out.push({ wall: w, end: 'a' });
    else if (dist(p, w.b) <= COINCIDE) out.push({ wall: w, end: 'b' });
  }
  return out;
}

/**
 * Anchored endpoint on the moved line (origin o, direction d): the best non-parallel support, or null when free.
 * `err` = how far the anchor is from the moved line (> 0 when even the best support ends short of it: clamped).
 */
function anchorOnLine(supports: Support[], o: Vec2, d: Vec2): { p: Vec2; err: number } | null {
  let best: { p: Vec2; err: number; sin: number } | null = null;
  for (const s of supports) {
    const sd = sub(s.b, s.a);
    const sin = sinAngle(d, sd);
    if (sin <= SUPPORT_PARALLEL_SIN) continue;
    const x = lineIntersection(o, d, s.a, sd);
    if (!x) continue;
    const c = projectPointOnSegment(x, s.a, s.b).point;
    const err = dist(x, c);
    if (!best || err < best.err - 1e-9 || (Math.abs(err - best.err) <= 1e-9 && sin > best.sin)) best = { p: c, err, sin };
  }
  return best ? { p: best.p, err: best.err } : null;
}

/** Anchored endpoint for an endpoint drag: the pointer projected on the best non-parallel support, or null when free. */
function anchorToward(supports: Support[], wallDir: Vec2, pointer: Vec2): Vec2 | null {
  let best: { p: Vec2; d: number } | null = null;
  for (const s of supports) {
    if (sinAngle(wallDir, sub(s.b, s.a)) <= SUPPORT_PARALLEL_SIN) continue;
    const c = projectPointOnSegment(pointer, s.a, s.b).point;
    const d = dist(c, pointer);
    if (!best || d < best.d) best = { p: c, d };
  }
  return best ? best.p : null;
}

interface WallChange {
  a?: Vec2;
  b?: Vec2;
}

/** A host (stored wall or block edge) that an edit changed, with its line before the edit (for pullBackOpenings). */
interface ChangedHost {
  host: OpeningHost;
  oldA: Vec2;
  oldB: Vec2;
}

/** The stored wall `id` (line oldA → oldB before the edit) as a ChangedHost when the draft changed its line. */
function changedWall(draft: Variant, id: Id, oldA: Vec2, oldB: Vec2): ChangedHost[] {
  const w = draft.walls.find((x) => x.id === id);
  return w && (!samePoint(w.a, oldA, TINY) || !samePoint(w.b, oldB, TINY)) ? [{ host: { kind: 'wall', wallId: id }, oldA, oldB }] : [];
}

/** An opening this close (m, along its host) to its ghost when its stored wall is back on today's line goes back to it. */
const DRIFT_BACK = 0.15;

/**
 * Offset along the host line of an opening ghost: its own offset when it is on the host; else, when it stands on a
 * removed wall on the host's line that belongs to the host — the wall's own ghost (a wall that was only shortened) or
 * the host wall of a stub ghost of the same block edge —, the projection of its centre; else null.
 */
function ghostOffsetOn(v: Variant, g: Opening, host: OpeningHost, line: { a: Vec2; b: Vec2 }): number | null {
  if (sameHost(g.host, host)) return g.offset;
  if (g.host.kind !== 'wall') return null;
  const wallId = g.host.wallId;
  const ref = parseEdgeGhostId(wallId);
  const own =
    host.kind === 'wall' ? wallId === ghostIdOf(host.wallId) : ref !== null && ref.blockId === host.blockId && ref.edgeId === host.edgeId;
  if (!own) return null;
  const w = v.walls.find((x) => x.id === wallId && x.status === 'removed');
  if (!w || lineDistance(w.a, line.a, line.b) > SAME || lineDistance(w.b, line.a, line.b) > SAME) return null;
  return along(line.a, line.b, pointAlong(w.a, w.b, g.offset));
}

/** Height range [sill, head] of an opening (absolute, from its level; a full-height one reaches up indefinitely). */
function openingZ(v: Variant, o: Opening): [number, number] {
  const levelId = o.levelId ?? defaultOpeningLevel(v, o.host, o.offset);
  const z = v.levels.find((l) => l.id === levelId)?.elevation ?? 0;
  return o.fullHeight ? [z, Infinity] : [z + o.sill, z + o.sill + o.height];
}

/**
 * Openings back on their ghosts when their host got longer again (fix round 2 after 2a): a shortened edge or wall
 * clamped an existing opening, which became new with its ghost at the old place; when a later edit lengthens the host
 * again, the opening goes back to its ghost's offset — so it heals and is today's opening again — provided that
 *  - the ghost is on the same host (after the edge / wall ghosts healed: `healGhosts` runs first),
 *  - before this edit the opening was pressed against an end of the host with its ghost beyond that end, or left in
 *    the middle of a host too short for it (a clamp, not the user's own move), and the ghost's place fits on the host
 *    now without overlapping another opening there,
 *  - nothing else of the opening changed (it heals there).
 * Polish round (phase 2b):
 *  - a return in several steps: when the ghost's place does not fit yet, an opening that was pressed against the end
 *    on its ghost's side stays pressed against that end as it moves out (as near its ghost as fits), so the next
 *    lengthening finds it pressed again and the last one puts it back (blk-bod's south edge −0.5, then +0.25 twice:
 *    door-green-e at 0.69 again). One the user moved off the end stays where it is. Another opening blocks such a
 *    step only when the opening would overlap it more than it does now (fix round after 2b: the glass east edge −1
 *    and back +0.2 / +0.8 left win-glass-s2, already over win-glass-s1, «Nytt» beside its ghost);
 *  - a stored wall back on today's line (existing again: an end moved out and back turned it there and back) takes
 *    back an opening within DRIFT_BACK of its ghost whose ghost place fits: keeping its plan position on the turned
 *    wall and back left it 1–12 cm off (d-104 on w-104-diag after w-103-korr's end a out and back).
 * Returns true when an opening moved (healGhosts has then run again).
 */
function pullBackOpenings(draft: Variant, ctx: EditContext, changedHosts: ChangedHost[]): boolean {
  const ghostOf = new Set(draft.openings.filter((x) => x.status === 'removed').map((x) => x.id));
  const candidate = (o: Opening) => o.status === 'new' && ghostOf.has(ghostIdOf(o.id)) && changedHosts.some((h) => sameHost(o.host, h.host));
  if (!draft.openings.some(candidate)) return false;
  healGhosts(draft);
  let moved = false;
  for (const { host, oldA, oldB } of changedHosts) {
    const line = hostLine(draft, host);
    if (!line || line.length < TINY) continue;
    const L0 = dist(oldA, oldB);
    const grew = line.length > L0 + SAME;
    const today = host.kind === 'wall' && line.wall?.status === 'existing';
    if (!grew && !today) continue;
    const onHost = draft.openings.filter((o) => o.status !== 'removed' && sameHost(o.host, host));
    for (const o of onHost) {
      if (o.status !== 'new') continue;
      const g = draft.openings.find((x) => x.id === ghostIdOf(o.id) && x.status === 'removed');
      // The ghost's place along the host: on the host itself, or on the host wall of a stub ghost of this edge (on its
      // line beyond the end; it comes back onto the edge when the stub heals).
      const gOff = g ? ghostOffsetOn(draft, g, host, line) : null;
      if (!g || gOff === null || Math.abs(gOff - o.offset) <= SAME) continue;
      const half = o.width / 2;
      const fits = gOff - half >= -SAME && gOff + half <= line.length + SAME;
      let target: number | null = today && fits && sameHost(g.host, host) && Math.abs(gOff - o.offset) <= DRIFT_BACK ? gOff : null;
      if (target === null && grew) {
        // A clamp: before this edit the opening was pressed against an end of the host and its ghost lay beyond that end.
        const before = ctx.base.openings.find((x) => x.id === o.id);
        if (!before || !sameHost(before.host, host)) continue;
        const sOld = along(oldA, oldB, pointAlong(line.a, line.b, gOff));
        const sLive = before.offset;
        const atStart = Math.abs(sLive - half) <= SAME && sOld - half < -SAME;
        const atEnd = Math.abs(sLive + half - L0) <= SAME && sOld + half > L0 + SAME;
        // (Too wide for the shortened host: clampOffset left it in the middle.)
        const centred = o.width > L0 + SAME && Math.abs(sLive - L0 / 2) <= SAME && (sOld - half < -SAME || sOld + half > L0 + SAME);
        if (fits && (atStart || atEnd || centred)) target = gOff;
        // Not back yet (a return in several steps): pressed against the end on its ghost's side of the longer host.
        else if (!fits && line.length >= o.width - SAME && (atStart || atEnd || centred)) target = clean(gOff < half ? half : line.length - half);
      }
      if (target === null || Math.abs(target - o.offset) <= SAME) continue;
      const t = target;
      const zo = openingZ(draft, o);
      // Blocked only by an opening it would overlap MORE there than where it is now (fix round after 2b): a clamped
      // opening pressed against the end often already overlaps its neighbour (win-glass-s2 over win-glass-s1 after the
      // glass east edge −1), and the step that moves it out towards its ghost lessens that overlap.
      const overlapAt = (s: number, x: Opening) => Math.max(0, Math.min(s + half, x.offset + x.width / 2) - Math.max(s - half, x.offset - x.width / 2));
      const blocked = onHost.some((x) => {
        if (x === o || overlapAt(t, x) <= overlapAt(o.offset, x) + SAME) return false;
        const zx = openingZ(draft, x);
        return Math.min(zo[1], zx[1]) - Math.max(zo[0], zx[0]) > SAME;
      });
      if (blocked || !sameOpeningGeometry({ ...plain(o), host: plain(g.host), offset: g.offset }, g)) continue;
      o.offset = t;
      moved = true;
    }
  }
  if (moved) healGhosts(draft);
  return moved;
}

/**
 * Apply endpoint changes of other walls (touch, set, keep their openings' plan positions with the bookkeeping of
 * keepWallOpenings: an existing opening the change moves — a clamp, or a wall that turned — is new with a ghost).
 * Returns the walls it changed (for pullBackOpenings).
 */
function applyWallChanges(draft: Variant, ctx: EditContext, changes: Map<Id, WallChange>, bookkeep = true): ChangedHost[] {
  const changedHosts: ChangedHost[] = [];
  for (const [id, ch] of changes) {
    const w0 = ctx.base.walls.find((w) => w.id === id);
    const w = draft.walls.find((x) => x.id === id);
    if (!w0 || !w) continue;
    const a = ch.a ?? w0.a;
    const b = ch.b ?? w0.b;
    if (samePoint(a, w0.a, TINY) && samePoint(b, w0.b, TINY)) continue;
    if (dist(a, b) < MIN_WALL_LENGTH) continue;
    touchExisting(draft, id);
    w.a = copy(a);
    w.b = copy(b);
    keepWallOpenings(draft, id, w0.a, w0.b, bookkeep);
    changedHosts.push(...changedWall(draft, id, w0.a, w0.b));
  }
  return changedHosts;
}

/**
 * Set ends of stored walls (`ends`, by id) as a cascade does, from the state `ctx.base`: an existing wall is touched
 * (its ghost added), openings keep their plan position and go back towards their ghosts when a host gets longer.
 * "Ta tilbake" keeps a corner with a wall the user moved closed this way (state/editActions.ts `closeJunctions`; last
 * fix round, sixth review). False when nothing changed.
 */
export function applyWallEnds(draft: Variant, ctx: EditContext, ends: ReadonlyMap<Id, { a?: Vec2; b?: Vec2 }>): boolean {
  const changes = new Map<Id, WallChange>([...ends].map(([id, e]) => [id, { ...e }]));
  const hosts = applyWallChanges(draft, ctx, changes, true);
  pullBackOpenings(draft, ctx, hosts);
  return hosts.length > 0;
}

/** T-junction walls ending on the interior of segment (a, b): their end follows the new line (na, nb). */
function tJunctionChanges(ctx: EditContext, a: Vec2, b: Vec2, na: Vec2, nb: Vec2, storeys: readonly Id[], except: ReadonlySet<Id>, changes: Map<Id, WallChange>): void {
  const dNew = sub(nb, na);
  for (const t of liveWalls(ctx, storeys, except)) {
    for (const end of ['a', 'b'] as const) {
      const e = t[end];
      if (dist(e, a) <= COINCIDE || dist(e, b) <= COINCIDE) continue;
      if (distancePointSegment(e, a, b) > COINCIDE) continue;
      const other = end === 'a' ? t.b : t.a;
      const td = sub(e, other);
      if (isParallel(td, sub(b, a), SUPPORT_PARALLEL_SIN)) continue;
      const x = lineIntersection(other, td, na, dNew);
      if (!x) continue;
      const ch = changes.get(t.id) ?? {};
      ch[end] = x;
      changes.set(t.id, ch);
    }
  }
}

/** Both ends of a stored wall are free (no support, no coincident wall): a drag may move it in any direction. */
export function wallEndsFree(ctx: EditContext, wallId: Id): boolean {
  const w = ctx.base.walls.find((x) => x.id === wallId);
  if (!w) return false;
  const storeys = wallStoreys(ctx, w);
  const self = new Set([wallId]);
  return (['a', 'b'] as const).every((end) => supportsAt(ctx, w[end], storeys, self).length === 0 && coincidentAt(ctx, w[end], storeys, self).length === 0);
}

/**
 * Move a stored wall by `delta` with its cascades (header: "Wall move"). False when nothing changed. `opts.keep`: walls
 * the move must leave alone (no support, follower or T-junction): "Ta tilbake" moving a wall back keeps the walls the
 * forward step did not touch, even where the forward step left the wall's end on theirs.
 */
export function applyMoveWall(draft: Variant, ctx: EditContext, wallId: Id, delta: Vec2, opts: { keep?: ReadonlySet<Id>; clamped?: boolean } = {}): boolean {
  const w0 = ctx.base.walls.find((w) => w.id === wallId);
  if (!w0 || w0.status === 'removed' || len(delta) < TINY) return false;
  const storeys = wallStoreys(ctx, w0);
  const self = new Set([wallId, ...(opts.keep ?? [])]);
  const dir = sub(w0.b, w0.a);
  const o = addc(w0.a, delta);
  const changes = new Map<Id, WallChange>();
  const ends: Record<'a' | 'b', Vec2> = { a: addc(w0.a, delta), b: addc(w0.b, delta) };
  const plans = wallEndPlans(ctx, w0, delta, self);
  // A support that ends short of the moved line (clamped, e.g. the floor step and w-103-102 under w-103-korr's east end
  // when the wall moves south) would pin that end and turn the wall. When a non-parallel coincident wall can carry the
  // corner by getting LONGER (w-103-102, even though it runs on to the loft), the end moves as a node with the
  // coincident walls and the wall keeps its direction; a parallel one (w-vf-korr continuing the wall) stays and meets
  // the carried wall as a T-junction (polish round, phase 2b). Only when no end stays clamped (else the wall would turn
  // anyway) and never by shortening a wall (w-wing-w east: w-sauna-n would leave the wing's edge): as before then.
  const carry = cornerCarried(plans);
  // Never one end sliding while the other is pinned (fix round after 2b, generalising the w-103-korr rule): when an end
  // stays clamped (its supports end short of the moved line and no coincident wall carries it), the move is cut back to
  // the largest part of `delta` that every end can follow, so the wall stays parallel (w-peis-n 1 m south stops on
  // y 2,2, w-vf-kjk 1 m east on x 9, lw-landing at the ends of lw-106-top); an end that cannot move at all refuses the
  // move (lw-split north: its east end is pinned at the stairwell corner).
  if (!carry && !opts.clamped && plans.some((pl) => pl.clamped && !pl.slide)) {
    const t = followableFraction(ctx, w0, delta, self);
    return t * len(delta) > SAME ? applyMoveWall(draft, ctx, wallId, scale(delta, t), { ...opts, clamped: true }) : false;
  }
  for (const { end, p, followers, through, onMoved, extended, anchored, clamped, slide } of plans) {
    const carriedCorner = carry && clamped;
    if (anchored && !carriedCorner) {
      ends[end] = copy(clamped && slide ? slide : anchored.p);
      continue;
    }
    const movers = carriedCorner ? [...followers, ...through.filter(extended)] : followers;
    const xs = movers.map(onMoved);
    // A free node: every non-parallel follower keeps its direction and ends on the moved line; the moved wall ends
    // at the outermost of those points, so the others meet it as T-junctions and the node never falls apart.
    const outward = unit(sub(p, end === 'a' ? w0.b : w0.a));
    let node = addc(p, delta);
    let best = -Infinity;
    const ud = unit(dir);
    for (const x of xs) {
      if (!x) continue;
      const s = dot(sub(x, o), outward);
      if (s > best) {
        best = s;
        // Exactly on the moved line (the intersection's float noise tilted the wall by a nanometre).
        node = copy(add(o, scale(ud, dot(sub(x, o), ud))));
      }
    }
    ends[end] = node;
    // A parallel coincident wall (a continuation in line) never turns where it can help it (fix round after 2b: moving
    // w-106-korr turned the loft piece lw-106-top): it is carried along sideways, parallel, when its far end can follow
    // (free, or sliding on a support; `carryParallel`); else it stays where a non-parallel wall carries the node (it
    // meets the moved wall as a T-junction there, as w-vf-korr does for w-103-korr), and follows the node only when
    // nothing else does.
    const carriedNode = carriedCorner || xs.some((x) => x !== null);
    movers.forEach((c, i) => {
      if (xs[i] === null && (carryParallel(ctx, c, p, node, self, changes) || carriedNode)) return;
      const ch = changes.get(c.wall.id) ?? {};
      ch[c.end] = copy(xs[i] ?? node);
      changes.set(c.wall.id, ch);
    });
  }
  if (dist(ends.a, ends.b) < MIN_WALL_LENGTH) return false;
  if (samePoint(ends.a, w0.a, TINY) && samePoint(ends.b, w0.b, TINY)) return false;
  tJunctionChanges(ctx, w0.a, w0.b, ends.a, ends.b, storeys, new Set([...self, ...changes.keys()]), changes);
  touchWallForMove(draft, wallId);
  const w = draft.walls.find((x) => x.id === wallId);
  if (!w) return false;
  w.a = copy(ends.a);
  w.b = copy(ends.b);
  delete w.carriedBy;
  pullBackOpenings(draft, ctx, [...changedWall(draft, wallId, w0.a, w0.b), ...applyWallChanges(draft, ctx, changes)]);
  markCarried(draft, ctx, wallId, changes.keys());
  return true;
}

/**
 * Record on each moved wall among `ids` (new, changed by this edit) that wall `by`'s move carried it, and where to
 * (`Wall.carriedBy`; last fix round, fifth review): "Ta tilbake" on `by` brings back only those still there, to where
 * they stood before `by`'s moves carried them (`from`: kept while `by`'s earlier carry still holds, so a wall moved in
 * several steps sends it back past all of them; last fix round, sixth review). Also on a new wall without a ghost (a
 * divider of the base proposal), so "Ta tilbake" tells it from one the user moved.
 */
function markCarried(draft: Variant, ctx: EditContext, by: Id, ids: Iterable<Id>): void {
  for (const id of ids) {
    const w = draft.walls.find((x) => x.id === id);
    const w0 = ctx.base.walls.find((x) => x.id === id);
    if (!w || !w0 || w.status !== 'new') continue;
    if (samePoint(w.a, w0.a, TINY) && samePoint(w.b, w0.b, TINY)) continue;
    const c0 = w0.carriedBy;
    const chained = c0 !== undefined && c0.by === by && samePoint(c0.a, w0.a, 1e-9) && samePoint(c0.b, w0.b, 1e-9);
    const from = chained ? c0.from : { a: copy(w0.a), b: copy(w0.b) };
    w.carriedBy = from ? { by, a: copy(w.a), b: copy(w.b), from: { a: copy(from.a), b: copy(from.b) } } : { by, a: copy(w.a), b: copy(w.b) };
  }
}

/** Whether the clamped ends of a wall move (`wallEndPlans`) are all carried by a coincident wall that gets longer. */
function cornerCarried(plans: readonly { clamped: boolean; carriers: boolean }[]): boolean {
  return plans.some((pl) => pl.clamped) && plans.every((pl) => !pl.clamped || pl.carriers);
}

/**
 * The part of `delta` that applyMoveWall moves wall `wallId` by (fix round 2b, final: the drag preview draws the same
 * clamp): 1 when the move is not cut back, t ∈ (0, 1) when an end whose support runs out cuts it to t·delta, 0 when the
 * move is refused (an end cannot follow at all: lw-split north).
 */
export function wallMoveFraction(ctx: EditContext, wallId: Id, delta: Vec2): number {
  const w0 = ctx.base.walls.find((w) => w.id === wallId);
  if (!w0 || w0.status === 'removed' || len(delta) < TINY) return 1;
  const self = new Set([wallId]);
  const plans = wallEndPlans(ctx, w0, delta, self);
  if (cornerCarried(plans) || !plans.some((pl) => pl.clamped && !pl.slide)) return 1;
  const t = followableFraction(ctx, w0, delta, self);
  return t * len(delta) > SAME ? t : 0;
}

/** Per end of wall `w0` moved by `delta` (applyMoveWall): its supports and coincident walls, and how the end can follow. */
function wallEndPlans(ctx: EditContext, w0: Wall, delta: Vec2, self: ReadonlySet<Id>) {
  const dir = sub(w0.b, w0.a);
  const o = addc(w0.a, delta);
  return (['a', 'b'] as const).map((end) => {
    const p = w0[end];
    const { supports, followers, through } = endClass(ctx, w0, p, self);
    // A coincident wall's point on the moved line (a non-parallel one keeps its direction; null for a parallel one).
    const onMoved = (c: { wall: Wall; end: 'a' | 'b' }): Vec2 | null => {
      const other = c.end === 'a' ? c.wall.b : c.wall.a;
      return isParallel(sub(c.wall.b, c.wall.a), dir) ? null : lineIntersection(other, sub(p, other), o, dir);
    };
    // … and whether that point extends it beyond this end (so it still covers the old corner: nothing there comes loose).
    const extended = (c: { wall: Wall; end: 'a' | 'b' }): boolean => {
      const x = onMoved(c);
      return x !== null && dot(sub(x, p), sub(p, c.end === 'a' ? c.wall.b : c.wall.a)) > TINY;
    };
    const anchored = anchorOnLine(supports, o, dir);
    const clamped = anchored !== null && anchored.err > COINCIDE;
    // A clamped end may instead slide onto a non-parallel coincident wall that runs on towards the moved line, which
    // then stays as it is (a T-junction; fix round after 2b: w-wing-w moved east slides along w-sauna-n, which it would
    // otherwise have to shorten).
    const slide = clamped
      ? ([...followers, ...through]
          .map((c) => {
            const x = onMoved(c);
            const other = c.end === 'a' ? c.wall.b : c.wall.a;
            return x && dot(sub(x, p), sub(other, p)) > TINY && dist(x, p) <= dist(other, p) - MIN_WALL_LENGTH ? copy(x) : null;
          })
          .find((x) => x !== null) ?? null)
      : null;
    return { end, p, followers, through, onMoved, extended, anchored, clamped, slide, carriers: [...followers, ...through].some(extended) };
  });
}

/**
 * A parallel coincident wall `c` (its end `c.end` at the moved wall's node `p`, which goes to `node`) carried along
 * sideways, keeping its direction (fix round after 2b): its far end goes onto the follower's moved line — sliding on
 * its non-parallel support there (not past its end), or straight across when it is free — and walls with a T-junction
 * on it follow. Not when its far end has coincident walls, only parallel supports or a support that ends short, nor when
 * the node slid past its far end: then nothing is recorded and false is returned (the caller lets it stay, or follow
 * the node).
 */
function carryParallel(ctx: EditContext, c: { wall: Wall; end: 'a' | 'b' }, p: Vec2, node: Vec2, except: ReadonlySet<Id>, changes: Map<Id, WallChange>): boolean {
  const f = c.wall;
  if (changes.has(f.id)) return false;
  const far = c.end === 'a' ? 'b' : 'a';
  const F = f[far];
  const fdir = sub(f.b, f.a);
  const n = leftNormal(unit(fdir));
  const across = dot(sub(node, p), n);
  if (Math.abs(across) < TINY) return false;
  const skip = new Set([...except, f.id]);
  const { supports, followers } = endClass(ctx, f, F, skip);
  if (followers.length > 0) return false;
  const o = add(F, scale(n, across));
  const anchored = anchorOnLine(supports, o, fdir);
  if (supports.length > 0 && (!anchored || anchored.err > COINCIDE)) return false;
  const nf = copy(anchored ? anchored.p : o);
  const nn = copy(node);
  const [na, nb] = c.end === 'a' ? [nn, nf] : [nf, nn];
  // Not when the node slid past its far end (the moved wall then runs over it): it would turn round.
  if (dot(sub(nn, nf), unit(sub(p, F))) < MIN_WALL_LENGTH) return false;
  changes.set(f.id, { a: na, b: nb });
  tJunctionChanges(ctx, f.a, f.b, na, nb, wallStoreys(ctx, f), new Set([...skip, ...changes.keys()]), changes);
  return true;
}

/**
 * The largest fraction t ∈ [0, 1] of `delta` by which wall `w0` can move with every end that has a non-parallel support
 * still on one (anchorOnLine's error within 1 µm at every fraction up to t; bisection). Ends without such a support move
 * freely. (applyMoveWall: a move whose end would stay clamped is cut back to t·delta, so the wall keeps its direction.)
 */
function followableFraction(ctx: EditContext, w0: Wall, delta: Vec2, self: ReadonlySet<Id>): number {
  const dir = sub(w0.b, w0.a);
  const ends = (['a', 'b'] as const).map((end) => endClass(ctx, w0, w0[end], self).supports);
  const follows = (t: number) => ends.every((supports) => {
    const anchored = anchorOnLine(supports, add(w0.a, scale(delta, t)), dir);
    return anchored === null || anchored.err <= 1e-9;
  });
  if (follows(1)) return 1;
  if (!follows(0)) return 0;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 60; k++) {
    const m = (lo + hi) / 2;
    if (follows(m)) lo = m;
    else hi = m;
  }
  // Exactly onto the limiting support's end: just past the limit an end is clamped to that end point, so the fraction
  // that puts the moved line through it is exact (no bisection error, the wall stays exactly parallel).
  const n = leftNormal(unit(dir));
  const across = dot(delta, n);
  if (Math.abs(across) < TINY) return lo;
  let exact = Infinity;
  const past = Math.min(1, lo + 1e-4);
  for (const supports of ends) {
    const anchored = anchorOnLine(supports, add(w0.a, scale(delta, past)), dir);
    if (anchored && anchored.err > 1e-9) exact = Math.min(exact, dot(sub(anchored.p, w0.a), n) / across);
  }
  return Number.isFinite(exact) && exact >= 0 && exact <= 1 && Math.abs(exact - lo) < 1e-6 ? exact : lo;
}

/**
 * Drag one end of a stored wall to p (header: "Endpoint drags"). `opts.keep`: walls the drag must leave alone (no
 * support, follower or T-junction; "Ta tilbake" keeps the existing walls the forward step did not touch).
 */
export function applyMoveWallEndpoint(draft: Variant, ctx: EditContext, wallId: Id, end: 'a' | 'b', p: Vec2, opts: { keep?: ReadonlySet<Id> } = {}): boolean {
  const w0 = ctx.base.walls.find((w) => w.id === wallId);
  if (!w0 || w0.status === 'removed') return false;
  const storeys = wallStoreys(ctx, w0);
  const self = new Set([wallId, ...(opts.keep ?? [])]);
  const P = w0[end];
  const F = end === 'a' ? w0.b : w0.a;
  const changes = new Map<Id, WallChange>();
  const { supports, followers } = endClass(ctx, w0, P, self);
  const anchored = anchorToward(supports, sub(P, F), p);
  const target = copy(anchored ?? p);
  if (!anchored) {
    for (const c of followers) {
      const ch = changes.get(c.wall.id) ?? {};
      ch[c.end] = target;
      changes.set(c.wall.id, ch);
    }
  }
  if (dist(target, F) < MIN_WALL_LENGTH || samePoint(target, P, TINY)) return false;
  const na = end === 'a' ? target : w0.a;
  const nb = end === 'b' ? target : w0.b;
  tJunctionChanges(ctx, w0.a, w0.b, na, nb, storeys, new Set([...self, ...changes.keys()]), changes);
  touchExisting(draft, wallId);
  const w = draft.walls.find((x) => x.id === wallId);
  if (!w) return false;
  w.a = copy(na);
  w.b = copy(nb);
  delete w.carriedBy;
  keepWallOpenings(draft, wallId, w0.a, w0.b, true);
  pullBackOpenings(draft, ctx, [...changedWall(draft, wallId, w0.a, w0.b), ...applyWallChanges(draft, ctx, changes)]);
  markCarried(draft, ctx, wallId, changes.keys());
  return true;
}

/** A new stored wall (status new, the variant's interior thickness, 'auto' height). Null when shorter than 5 cm. */
export function applyAddWall(draft: Variant, a: Vec2, b: Vec2, levelId: Id, opts: { thickness?: number; kind?: WallKind; id?: Id } = {}): Id | null {
  if (dist(a, b) < MIN_WALL_LENGTH) return null;
  const kind = opts.kind ?? 'interior';
  const id = opts.id ?? newId('w');
  draft.walls.push({
    id,
    a: copy(a),
    b: copy(b),
    thickness: kind === 'divider' ? 0 : (opts.thickness ?? draft.settings.defaultInteriorThickness),
    levelId,
    status: 'new',
    kind,
    heightMode: 'auto',
  });
  return id;
}

/**
 * Split a stored wall at t ∈ (0, 1) along a→b: the first half keeps the id, the second gets a new one (same
 * properties and status — splitting changes nothing built); openings are re-hosted by their centre.
 */
export function applySplitWall(draft: Variant, wallId: Id, t: number, opts: { id?: Id } = {}): Id | null {
  const w = draft.walls.find((x) => x.id === wallId);
  if (!w || w.status === 'removed') return null;
  const L = dist(w.a, w.b);
  const s = Math.min(L - MIN_WALL_LENGTH, Math.max(MIN_WALL_LENGTH, t * L));
  if (L < 2 * MIN_WALL_LENGTH) return null;
  const p = pointAlong(w.a, w.b, s);
  const second = plain(w);
  second.id = opts.id ?? newId('w');
  second.a = copy(p);
  draft.walls.push(second);
  w.b = copy(p);
  for (const o of draft.openings) {
    if (o.host.kind !== 'wall' || o.host.wallId !== wallId || o.offset <= s) continue;
    o.host = { kind: 'wall', wallId: second.id };
    o.offset -= s;
  }
  return second.id;
}

/** Delete a stored wall (header: bookkeeping). False for an unknown or already removed wall. */
export function applyDeleteWall(draft: Variant, wallId: Id): boolean {
  const w = draft.walls.find((x) => x.id === wallId);
  if (!w || w.status === 'removed') return false;
  const onIt = (o: Opening) => o.host.kind === 'wall' && o.host.wallId === wallId;
  if (w.status === 'existing') {
    w.status = 'removed';
    draft.openings = draft.openings.filter((o) => !(onIt(o) && o.status === 'new'));
    for (const o of draft.openings) if (onIt(o) && o.status === 'existing') o.status = 'removed';
    return true;
  }
  draft.walls.splice(draft.walls.indexOf(w), 1);
  draft.openings = draft.openings.filter((o) => !onIt(o));
  return true;
}

export interface WallPatch {
  thickness?: number;
  heightMode?: Wall['heightMode'];
  height?: number;
  kind?: WallKind;
}

/**
 * Wall properties. A thickness or kind change of an existing wall is a rebuild (touch → new + ghost); heights are not.
 * Turning a wall into a divider deletes its new openings (existing ones go with the ghost as removed).
 */
export function applySetWallProps(draft: Variant, wallId: Id, patch: WallPatch): boolean {
  const w = draft.walls.find((x) => x.id === wallId);
  if (!w || w.status === 'removed') return false;
  const kindChange = patch.kind !== undefined && patch.kind !== w.kind;
  const thicknessChange = patch.thickness !== undefined && Math.abs(patch.thickness - w.thickness) > TINY && (patch.kind ?? w.kind) !== 'divider';
  let changed = false;
  if (kindChange || thicknessChange) touchExisting(draft, wallId);
  if (kindChange && patch.kind) {
    const wasDivider = w.kind === 'divider';
    w.kind = patch.kind;
    changed = true;
    if (patch.kind === 'divider') {
      w.thickness = 0;
      delete w.faceLeft;
      delete w.faceRight;
      const ghost = draft.walls.find((x) => x.id === ghostIdOf(wallId));
      draft.openings = draft.openings.filter((o) => !(o.host.kind === 'wall' && o.host.wallId === wallId && o.status === 'new'));
      for (const o of draft.openings) {
        if (o.host.kind !== 'wall' || o.host.wallId !== wallId) continue;
        if (ghost) o.host = { kind: 'wall', wallId: ghost.id };
        o.status = 'removed';
      }
    } else if (wasDivider) {
      w.thickness = patch.thickness ?? draft.settings.defaultInteriorThickness;
    }
  }
  if (thicknessChange && patch.thickness !== undefined && w.kind !== 'divider') {
    w.thickness = patch.thickness;
    delete w.faceLeft;
    delete w.faceRight;
    changed = true;
  }
  if (patch.heightMode !== undefined && patch.heightMode !== w.heightMode) {
    w.heightMode = patch.heightMode;
    if (patch.heightMode === 'fixed' && w.height === undefined) w.height = patch.height ?? 2.4;
    changed = true;
  }
  if (patch.height !== undefined && patch.height !== w.height) {
    w.height = patch.height;
    changed = true;
  }
  return changed || kindChange || thicknessChange;
}

// ---------------------------------------------------------------------------
// Restore ("Ta tilbake")
// ---------------------------------------------------------------------------

export type GhostRef =
  | { type: 'wall'; id: Id; original: Id | null }
  | { type: 'opening'; id: Id; original: Id | null }
  | { type: 'blockEdge'; id: Id; blockId: Id; edgeId: Id; a: Vec2; b: Vec2 };

/** What a ghost id refers to in a variant (see restoreGhost), or null. */
export function ghostRef(v: Variant, id: Id): GhostRef | null {
  // An edge ghost first: its host wall (see ensureGhostHost) has the same id and restores the edge, not a wall.
  const g = v.ghosts?.find((x) => x.id === id);
  const ref = g ? parseEdgeGhostId(g.id) : null;
  if (g && ref) return { type: 'blockEdge', id, ...ref, a: g.a, b: g.b };
  const w = v.walls.find((x) => x.id === id && x.status === 'removed');
  const hostRef = w && isGhostHost(v, id) ? parseEdgeGhostId(id) : null;
  if (w && hostRef) return { type: 'blockEdge', id, ...hostRef, a: w.a, b: w.b };
  if (w) return { type: 'wall', id, original: originalIdOf(id) };
  const o = v.openings.find((x) => x.id === id && x.status === 'removed');
  if (o) return { type: 'opening', id, original: originalIdOf(id) };
  return null;
}

/**
 * "Ta tilbake" on an edge ghost (header): the edge is moved back onto the ghost line — a stub of a shortened edge by
 * moving the adjacent edge at that end back out —, junction partners following; the ghosts that heal take their
 * host walls with them, and the opening ghosts that sat on those hosts are restored (the openings the edge edit
 * moved or clamped are back where they were, existing again). A ghost that cannot be reached is dropped (its opening
 * ghosts restored on the edge). A template unit standing against the edge where it goes back to is pushed away whole
 * first (`restoreEdgePushes`); one that cannot go, or one the edge would run into, refuses the restore: false, nothing
 * changed (`restoreEdgeOnBlock` tells the caller; last fix round, sixth review). False for an unknown id.
 */
export function applyRestoreEdgeGhost(draft: Variant, ctx: EditContext, id: Id): boolean {
  const ref = ghostRef(ctx.base, id);
  if (!ref || ref.type !== 'blockEdge') return false;
  // Opening ghosts parked on a removed wall (an edge ghost's host, or the ghost of a wall the edge edit stretched): the
  // ones whose host goes away with the restore are restored too.
  const parked = new Map<Id, Id>();
  for (const o of ctx.base.openings) {
    if (o.status !== 'removed' || o.host.kind !== 'wall' || originalIdOf(o.id) === null) continue;
    const hostId = o.host.wallId;
    if (ctx.base.walls.some((w) => w.id === hostId && w.status === 'removed')) parked.set(o.id, hostId);
  }
  const move = restoreEdgeMove(ctx, ref);
  if (move) {
    // Units standing against the edge on the side it goes back to are pushed away first (they are never dragged along:
    // `carriesThrough`); a unit that is still in the way refuses the restore (last fix round, sixth review).
    const { pushes, stuck } = restoreEdgePushes(ctx, move);
    if (stuck !== undefined) return false;
    const pushed = new Set(pushes.map((p) => p.blockId));
    // The edge's own plan first, before anything moves: a refusal leaves the draft untouched (final morning round: a
    // second unit in the edge's path refused the restore after the first had been pushed away and committed).
    const plan = edgePlan(pushed.size > 0 ? withoutBlocks(ctx, pushed) : ctx, move.blockId, move.edgeId, move.delta);
    if (plan?.onBlock) return false;
    for (const p of pushes) applyMoveBlock(draft, ctx, p.blockId, p.delta);
    if (plan) applyUnitPolygons(draft, ctx, plan.polys);
  }
  healGhosts(draft);
  // Hosts that healed away: their opening ghosts are restored. (A ghost the move could not reach is only dropped; its
  // opening ghosts stay ghosts, back on the edge.)
  const healed = new Set([...parked.values()].filter((h) => !draft.walls.some((w) => w.id === h)));
  // A ghost healGhosts clipped to the stretch a partner block still keeps open stays (that stretch of today's wall is
  // still gone; fix round after 2b); one the move could not reach at all is dropped.
  const left = draft.ghosts?.find((g) => g.id === id);
  const clipped = left !== undefined && (!samePoint(left.a, ref.a) || !samePoint(left.b, ref.b));
  if (left && !clipped && draft.ghosts) {
    draft.ghosts = draft.ghosts.filter((g) => g.id !== id);
    if (draft.ghosts.length === 0) delete draft.ghosts;
  }
  if (!clipped) dropGhostHost(draft, id);
  for (const [oid, hostId] of parked) if (healed.has(hostId)) restoreOpeningIn(draft, oid);
  healGhosts(draft);
  return true;
}

/** A block edge moved by `delta` (its component along the outward normal; `applyMoveBlockEdge`). */
interface EdgeMove {
  blockId: Id;
  edgeId: Id;
  delta: Vec2;
}

/**
 * The edge move of "Ta tilbake" on edge ghost `ref` (`applyRestoreEdgeGhost`): the edge back onto the ghost line; for a
 * stub of a shortened edge the adjacent edge at that end back out; for a stretch a partner block opened, the partner's
 * edge (`uncoverJunction`). Null when nothing moves.
 */
function restoreEdgeMove(ctx: EditContext, ref: Extract<GhostRef, { type: 'blockEdge' }>): EdgeMove | null {
  const block = ctx.base.blocks.find((b) => b.id === ref.blockId);
  const i = block ? block.polygon.findIndex((x) => x.id === ref.edgeId) : -1;
  if (!block || i < 0) return null;
  const pts = block.polygon.map((v) => v.p);
  const n = pts.length;
  const { a, b } = blockEdgeGeom(block, i);
  const shift = dot(sub(ref.a, a), outwardNormal(pts, i));
  if (Math.abs(shift) > 1e-9) return { blockId: ref.blockId, edgeId: ref.edgeId, delta: scale(outwardNormal(pts, i), shift) };
  // A stub: the edge got shorter at one end; the adjacent edge there moves back out to the stub's far end.
  const L = dist(a, b);
  const s = [along(a, b, ref.a), along(a, b, ref.b)];
  const lo = Math.min(...s);
  const hi = Math.max(...s);
  const k = lo < -SAME ? (i - 1 + n) % n : hi > L + SAME ? (i + 1) % n : -1;
  if (k < 0) return uncoverJunction(ctx, ref.blockId, i, lo, hi);
  const far = lo < -SAME ? pointAlong(a, b, lo) : pointAlong(a, b, hi);
  const nk = outwardNormal(pts, k);
  const sk = dot(sub(far, k === (i + 1) % n ? b : a), nk);
  return Math.abs(sk) > 1e-9 ? { blockId: ref.blockId, edgeId: block.polygon[k].id, delta: scale(nk, sk) } : null;
}

/** The context with the blocks `ids` left out of the base (for a plan that must not see units pushed away first). */
function withoutBlocks(ctx: EditContext, ids: ReadonlySet<Id>): EditContext {
  return { ...ctx, base: { ...ctx.base, blocks: ctx.base.blocks.filter((b) => !ids.has(b.id)) } };
}

/**
 * The template units a restore's edge move (`restoreEdgeMove`, junction partners included) would push into, each with
 * the move that keeps it against the edge — they stand against an edge that goes outward; `stuck`: one of them that
 * cannot go that far without standing on another building (`unitMoveFraction`), and `pushes` empty: the restore is
 * refused (last fix round, sixth review: «Ta tilbake» on the glass bump's south edge shrank the shed placed against it
 * from 2 m to 1 m).
 */
function restoreEdgePushes(ctx: EditContext, move: EdgeMove): { pushes: { blockId: Id; delta: Vec2 }[]; stuck?: Id } {
  const block = ctx.base.blocks.find((b) => b.id === move.blockId);
  const i = block ? block.polygon.findIndex((x) => x.id === move.edgeId) : -1;
  if (!block || i < 0) return { pushes: [] };
  const shift = dot(move.delta, outwardNormal(block.polygon.map((v) => v.p), i));
  const out: { blockId: Id; delta: Vec2 }[] = [];
  for (const [blockId, m] of propagateShifts(ctx, [{ blockId: move.blockId, edgeIndex: i, shift }])) {
    const b = ctx.base.blocks.find((x) => x.id === blockId);
    const db = ctx.derived.blocks.find((x) => x.block.id === blockId);
    if (!b || !db) continue;
    for (const [edgeIndex, s] of m) {
      if (s <= TINY) continue;
      const delta = scale(outwardNormal(b.polygon.map((v) => v.p), edgeIndex), s);
      for (const j of db.junctions) {
        const u = ctx.base.blocks.find((x) => x.id === j.otherBlockId);
        if (j.edgeIndex !== edgeIndex || !u || u.template === undefined || carriesThrough(ctx, blockId, u.id)) continue;
        if (out.some((p) => p.blockId === u.id)) continue;
        out.push({ blockId: u.id, delta });
      }
    }
  }
  for (const p of out) {
    const u = ctx.base.blocks.find((x) => x.id === p.blockId);
    if (!u || unitMoveFraction(ctx.base, u.polygon.map((v) => v.p), p.delta, u) < 1) return { pushes: [], stuck: p.blockId };
  }
  return { pushes: out };
}

/**
 * Whether "Ta tilbake" on edge ghost `id` is refused because a unit stands in the way (one that cannot be pushed away
 * along the edge's move, or one the edge would reach without standing against it): false when it is not, else the
 * unit in the way when it is known (`unitId`; fix round 3 after phase 3: the caller's toast names it, else the
 * general `unitOnBlock`).
 */
export function restoreEdgeOnBlock(ctx: EditContext, id: Id): false | { unitId?: Id } {
  const ref = ghostRef(ctx.base, id);
  if (!ref || ref.type !== 'blockEdge') return false;
  const move = restoreEdgeMove(ctx, ref);
  if (!move) return false;
  const { pushes, stuck } = restoreEdgePushes(ctx, move);
  if (stuck !== undefined) return { unitId: stuck };
  const plan = edgePlan(pushes.length > 0 ? withoutBlocks(ctx, new Set(pushes.map((p) => p.blockId))) : ctx, move.blockId, move.edgeId, move.delta);
  if (plan?.onBlock !== true) return false;
  return plan.unitId !== undefined ? { unitId: plan.unitId } : {};
}

/**
 * "Ta tilbake" on a ghost of a stretch [lo, hi] of edge `edgeIndex` that a partner block opened (addJunctionGhosts):
 * the partner's edge on that stretch is shortened back to the ghost's end by moving the partner's adjacent edge at the
 * end that reaches into the stretch (the glass bump's east edge back to x 9), junction partners following. Returns
 * that move (null: none).
 */
function uncoverJunction(ctx: EditContext, blockId: Id, edgeIndex: number, lo: number, hi: number): EdgeMove | null {
  const db = ctx.derived.blocks.find((x) => x.block.id === blockId);
  const own = ctx.base.blocks.find((x) => x.id === blockId);
  if (!db || !own) return null;
  const { a, b } = blockEdgeGeom(own, edgeIndex);
  for (const j of db.junctions) {
    if (j.edgeIndex !== edgeIndex || j.role === 'owner' || Math.min(hi, j.s1) - Math.max(lo, j.s0) <= SAME) continue;
    const partner = ctx.base.blocks.find((x) => x.id === j.otherBlockId);
    if (!partner) continue;
    const m = partner.polygon.length;
    const pe = blockEdgeGeom(partner, j.otherEdgeIndex);
    const ends = [
      { p: pe.a, s: along(a, b, pe.a), adj: (j.otherEdgeIndex - 1 + m) % m },
      { p: pe.b, s: along(a, b, pe.b), adj: (j.otherEdgeIndex + 1) % m },
    ];
    // The partner end inside the ghost's stretch goes to the ghost's end on the partner's side.
    const [low, high] = ends[0].s <= ends[1].s ? [ends[0], ends[1]] : [ends[1], ends[0]];
    const end = low.s >= lo - SAME && low.s < hi - SAME && high.s > hi + SAME ? { e: low, to: hi } : high.s <= hi + SAME && high.s > lo + SAME && low.s < lo - SAME ? { e: high, to: lo } : null;
    if (!end) continue;
    const pts = partner.polygon.map((v) => v.p);
    const nAdj = outwardNormal(pts, end.e.adj);
    const shift = dot(sub(pointAlong(a, b, end.to), end.e.p), nAdj);
    return Math.abs(shift) > 1e-9 ? { blockId: partner.id, edgeId: partner.polygon[end.e.adj].id, delta: scale(nAdj, shift) } : null;
  }
  return null;
}

/** Restore a removed opening: a moved one gets the ghost's place and size back, a deleted one becomes existing. */
function restoreOpeningIn(draft: Variant, id: Id): boolean {
  const g = draft.openings.find((x) => x.id === id && x.status === 'removed');
  if (!g) return false;
  const orig = originalIdOf(id);
  if (orig === null) {
    g.status = 'existing';
    return true;
  }
  const live = draft.openings.find((x) => x.id === orig);
  if (live) {
    const back = plain(g);
    back.id = orig;
    back.status = 'existing';
    draft.openings[draft.openings.indexOf(live)] = back;
    draft.openings.splice(draft.openings.indexOf(g), 1);
  } else {
    g.id = orig;
    g.status = 'existing';
  }
  return true;
}

/**
 * Restore a wall ghost in the draft (the "move back" cascade is applied by the caller first, see editActions): the
 * live wall gets the ghost's exact geometry and status 'existing', the ghost is dropped and openings on it come back.
 * A wall deleted in place becomes existing with the openings that the delete removed.
 */
export function applyRestoreWall(draft: Variant, id: Id): boolean {
  const g = draft.walls.find((x) => x.id === id && x.status === 'removed');
  if (!g) return false;
  const orig = originalIdOf(id);
  if (orig === null) {
    g.status = 'existing';
    for (const o of draft.openings) if (o.host.kind === 'wall' && o.host.wallId === id && o.status === 'removed' && originalIdOf(o.id) === null) o.status = 'existing';
    return true;
  }
  const live = draft.walls.find((x) => x.id === orig);
  if (live) {
    const oldA = copy(live.a);
    const oldB = copy(live.b);
    const back = plain(g);
    back.id = orig;
    back.status = 'existing';
    draft.walls[draft.walls.indexOf(live)] = back;
    draft.walls.splice(draft.walls.indexOf(g), 1);
    // Openings that stayed on the live wall keep their plan position on the restored line.
    keepWallOpenings(draft, orig, oldA, oldB);
  } else {
    g.id = orig;
    g.status = 'existing';
  }
  for (const o of [...draft.openings]) {
    if (o.host.kind !== 'wall' || o.host.wallId !== id) continue;
    o.host = { kind: 'wall', wallId: orig };
    if (originalIdOf(o.id) !== null) restoreOpeningIn(draft, o.id);
  }
  return true;
}

/** Restore an opening ghost (see restoreOpeningIn). */
export function applyRestoreOpening(draft: Variant, id: Id): boolean {
  return restoreOpeningIn(draft, id);
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

/** Add an opening (status new, defaults by type, offset clamped into the piece). Null on a divider / unknown host. */
export function applyAddOpening(
  draft: Variant,
  ctx: EditContext,
  host: OpeningHost,
  offset: number,
  type: OpeningType,
  opts: { id?: Id; width?: number; height?: number; sill?: number } = {},
): Id | null {
  const line = hostLine(ctx.base, host);
  if (!line || line.wall?.kind === 'divider') return null;
  const d = openingDefaults(type);
  const width = opts.width ?? d.width;
  const range = pieceRange(ctx, host, offset) ?? [0, line.length];
  const o: Opening = {
    id: opts.id ?? newId('op'),
    type,
    host: plain(host),
    offset: clampOffset(offset, width, range[0], range[1]),
    width,
    height: opts.height ?? d.height,
    sill: opts.sill ?? d.sill,
    style: plain(d.style),
    status: 'new',
  };
  if (d.swing) o.swing = { ...d.swing };
  draft.openings.push(o);
  return o.id;
}

/**
 * Move an opening along its host (clamped to the piece containing its current centre) or onto another host (clamped
 * to the piece containing the new offset), see the header for swing and level. False when nothing changed.
 */
export function applyMoveOpening(draft: Variant, ctx: EditContext, id: Id, offset: number, host?: OpeningHost): boolean {
  const o0 = ctx.base.openings.find((o) => o.id === id);
  if (!o0 || o0.status === 'removed') return false;
  const target = host ?? o0.host;
  const rehost = !sameHost(target, o0.host);
  const line = hostLine(ctx.base, target);
  if (!line || line.wall?.kind === 'divider' || line.wall?.status === 'removed') return false;
  const range = pieceRange(ctx, target, rehost ? offset : o0.offset) ?? [0, line.length];
  const clamped = clampOffset(offset, o0.width, range[0], range[1]);
  if (!rehost && Math.abs(clamped - o0.offset) < 1e-6) return false;
  touchExisting(draft, id);
  const o = draft.openings.find((x) => x.id === id);
  if (!o) return false;
  o.offset = clamped;
  if (rehost) {
    const oldLine = hostLine(ctx.base, o0.host);
    o.host = plain(target);
    if (o0.swing && oldLine) o.swing = swingOnNewHost(o0.swing, sub(oldLine.b, oldLine.a), sub(line.b, line.a));
    if (o0.levelId !== undefined) {
      const oldDefault = defaultOpeningLevel(ctx.base, o0.host, o0.offset);
      if (o0.levelId === oldDefault) {
        const lvl = defaultOpeningLevel(ctx.base, target, clamped);
        if (lvl) o.levelId = lvl;
      }
    }
  }
  return true;
}

export type OpeningPatch = Partial<Pick<Opening, 'type' | 'width' | 'height' | 'sill' | 'leaves' | 'swing' | 'style' | 'fullHeight' | 'levelId'>>;

/** Opening properties: a type / size change of an existing opening touches it (new + ghost); swing / style do not. */
export function applySetOpeningProps(draft: Variant, id: Id, patch: OpeningPatch): boolean {
  const o = draft.openings.find((x) => x.id === id);
  if (!o || o.status === 'removed') return false;
  const sized = (['type', 'width', 'height', 'sill', 'leaves', 'fullHeight'] as const).some((k) => patch[k] !== undefined && patch[k] !== o[k]);
  if (sized) touchExisting(draft, id);
  if (patch.type !== undefined && patch.type !== o.type) {
    const d = openingDefaults(patch.type);
    if (patch.type === 'window') {
      if (o.sill === 0) o.sill = d.sill;
      if (!o.style.mullions) o.style.mullions = d.style.mullions ? [...d.style.mullions] : undefined;
      delete o.swing;
      delete o.leaves;
    } else {
      o.sill = 0;
      delete o.style.mullions;
      if (SWINGING.has(patch.type)) o.swing = o.swing ?? (d.swing ? { ...d.swing } : undefined);
      else delete o.swing;
      if (o.swing === undefined) delete o.swing;
    }
    o.type = patch.type;
  }
  if (patch.width !== undefined) o.width = patch.width;
  if (patch.height !== undefined) o.height = patch.height;
  if (patch.sill !== undefined) o.sill = patch.sill;
  if (patch.leaves !== undefined) {
    if (patch.leaves === 2) o.leaves = 2;
    else delete o.leaves;
  }
  if (patch.fullHeight !== undefined) {
    if (patch.fullHeight) o.fullHeight = true;
    else delete o.fullHeight;
  }
  if (patch.swing !== undefined) o.swing = { ...patch.swing };
  if (patch.style !== undefined) o.style = { ...o.style, ...plain(patch.style) };
  if (patch.levelId !== undefined) o.levelId = patch.levelId;
  if (o.style.mullions === undefined) delete o.style.mullions;
  return true;
}

/** Delete an opening: existing → removed in place (ghost), new → deleted. False for a ghost or unknown id. */
export function applyDeleteOpening(draft: Variant, id: Id): boolean {
  const o = draft.openings.find((x) => x.id === id);
  if (!o || o.status === 'removed') return false;
  if (o.status === 'existing') o.status = 'removed';
  else draft.openings.splice(draft.openings.indexOf(o), 1);
  return true;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** A block with area that is part of today's cabin (cannot be deleted or moved as a whole). */
export function blockHasExistingArea(block: Block): boolean {
  return block.parts.length === 0 ? !block.isNew : block.parts.some((p) => !p.isNew);
}

/** Gable and mono blocks keep their shape (corner handles move both edges); flat blocks get free vertex drags. */
export function keepsRectangle(block: Block): boolean {
  return block.roof.type !== 'flat';
}

type ShiftMap = Map<Id, Map<number, number>>;

/**
 * Whether an edge shift of block `fromId` is carried through a junction to block `toId`: only between buildings that
 * are not template units — never between a unit and the house (last fix round, sixth review: a shed against the house
 * moved the house's outer wall when its Dybde changed, and «Ta tilbake» on a house edge shrank the shed), nor between
 * two units (fix round 3 after phase 3: Bredde of a shed squeezed the shed snapped against it, merging its room away).
 * Such an edit moves only its own block's edge; one that would push it into the other building is cut back by
 * `unitClampedPlan` (a unit's attached edge does not move outward at all: `withoutPushesIntoBuildings`), and one away
 * from it leaves the two apart.
 */
function carriesThrough(ctx: EditContext, fromId: Id, toId: Id): boolean {
  const from = ctx.base.blocks.find((b) => b.id === fromId);
  const to = ctx.base.blocks.find((b) => b.id === toId);
  return from?.template === undefined && to?.template === undefined;
}

/** Edge shifts (along the outward normal) carried through the junctions to partner edges (`carriesThrough`). */
function propagateShifts(ctx: EditContext, starts: { blockId: Id; edgeIndex: number; shift: number }[]): ShiftMap {
  const out: ShiftMap = new Map();
  const queue = [...starts];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const s = queue.shift();
    if (!s) break;
    const key = `${s.blockId}#${s.edgeIndex}`;
    if (seen.has(key) || Math.abs(s.shift) < TINY) continue;
    seen.add(key);
    const m = out.get(s.blockId) ?? new Map<number, number>();
    m.set(s.edgeIndex, (m.get(s.edgeIndex) ?? 0) + s.shift);
    out.set(s.blockId, m);
    const db = ctx.derived.blocks.find((b) => b.block.id === s.blockId);
    for (const j of db?.junctions ?? []) {
      if (j.edgeIndex !== s.edgeIndex || !carriesThrough(ctx, s.blockId, j.otherBlockId)) continue;
      queue.push({ blockId: j.otherBlockId, edgeIndex: j.otherEdgeIndex, shift: -s.shift });
    }
  }
  return out;
}

/**
 * Whether edge `edgeIndex` of template unit `blockId` stands against another building — the house or another unit (a
 * junction with it in `ctx.derived`, `carriesThrough`): the edge a unit placed against the house, or snapped against
 * another unit, shares with it.
 */
export function unitEdgeAttached(ctx: EditContext, blockId: Id, edgeIndex: number): boolean {
  const db = ctx.derived.blocks.find((b) => b.block.id === blockId);
  if (!db || db.block.template === undefined) return false;
  return db.junctions.some((j) => j.edgeIndex === edgeIndex && !carriesThrough(ctx, blockId, j.otherBlockId));
}

type EdgeShift = { blockId: Id; edgeIndex: number; shift: number };

/** Another template unit that edge `edgeIndex` of block `blockId` stands against (a junction in `ctx.derived`). */
function unitAgainst(ctx: EditContext, blockId: Id, edgeIndex: number): Id | undefined {
  const db = ctx.derived.blocks.find((b) => b.block.id === blockId);
  const j = db?.junctions.find((x) => x.edgeIndex === edgeIndex && x.otherBlockId !== blockId && ctx.base.blocks.some((b) => b.id === x.otherBlockId && b.template !== undefined));
  return j?.otherBlockId;
}

/**
 * The edge shifts of an edge / corner edit without those that would push a unit's attached edge (`unitEdgeAttached`)
 * outward into the building it stands against (last fix round, sixth review): a corner dragged into the house slides
 * along its wall, an attached edge dragged into it stays. `dropped`: one was left out (hint / toast); `unitId`: the
 * other unit such an edge stands against (fix round 3 after phase 3: the toast names it).
 */
function withoutPushesIntoBuildings(ctx: EditContext, starts: EdgeShift[]): { kept: EdgeShift[]; dropped: boolean; unitId?: Id } {
  const kept: EdgeShift[] = [];
  let unitId: Id | undefined;
  for (const s of starts) {
    if (s.shift > TINY && unitEdgeAttached(ctx, s.blockId, s.edgeIndex)) unitId ??= unitAgainst(ctx, s.blockId, s.edgeIndex);
    else kept.push(s);
  }
  const dropped = kept.length < starts.length;
  return unitId !== undefined ? { kept, dropped, unitId } : { kept, dropped };
}

/** `shiftsPlan` of the edge shifts `starts`, without the pushes into a building a unit stands against. */
function unitAwarePlan(ctx: EditContext, starts: EdgeShift[]): BlockEditPlan {
  const { kept, dropped, unitId } = withoutPushesIntoBuildings(ctx, starts);
  const named = (plan: BlockEditPlan): BlockEditPlan => (unitId !== undefined && plan.unitId === undefined ? { ...plan, unitId } : plan);
  if (!kept.some((s) => Math.abs(s.shift) >= TINY)) return named({ polys: new Map(), k: 0, onBlock: true });
  const plan = shiftsPlan(ctx, propagateShifts(ctx, kept));
  return dropped ? named({ ...plan, onBlock: true }) : plan;
}

/** Polygon with edges shifted along their outward normals (vertices = intersections of the shifted lines). */
function shiftedPolygon(points: Vec2[], shifts: Map<number, number>, k = 1): Vec2[] {
  const n = points.length;
  return points.map((v, i) => {
    const prev = (i - 1 + n) % n;
    const sp = (shifts.get(prev) ?? 0) * k;
    const sn = (shifts.get(i) ?? 0) * k;
    if (sp === 0 && sn === 0) return copy(v);
    const np = outwardNormal(points, prev);
    const nn = outwardNormal(points, i);
    const dPrev = sub(v, points[prev]);
    const dNext = sub(points[(i + 1) % n], v);
    const x = lineIntersection(add(v, scale(np, sp)), dPrev, add(v, scale(nn, sn)), dNext);
    return x ?? add(v, add(scale(np, sp), scale(nn, sn)));
  });
}

function validBlockPolygon(old: Vec2[], next: Vec2[]): boolean {
  const a0 = signedArea(old);
  const a1 = signedArea(next);
  return Math.sign(a0) === Math.sign(a1) && Math.abs(a1) >= MIN_BLOCK_AREA && !isSelfIntersecting(next);
}

/** What a block edge / corner edit applies (`shiftsPlan`, `vertexPlan`). */
interface BlockEditPlan {
  /** The new polygons of the blocks that change (empty: nothing). */
  polys: Map<Id, Vec2[]>;
  /** The fraction of the move they apply. */
  k: number;
  /** Cut back (or refused, k 0) because a template unit would end up on another block. */
  onBlock: boolean;
  /** With `onBlock`: a template unit that is not edited itself and stands in the way (`unitInTheWay`). */
  unitId?: Id;
}

/**
 * A template unit that does not change itself and that a changed block of `polys` would now stand on where the base
 * had them apart: the unit in the way of a house edge or corner (final morning round: the toast names it). Undefined
 * when the unit stopped is the edited one.
 */
function unitInTheWay(ctx: EditContext, polys: ReadonlyMap<Id, Vec2[]>): Id | undefined {
  const pieces = (b: Block, now: boolean) => convexPieces((now ? polys.get(b.id) : undefined) ?? b.polygon.map((x) => x.p));
  const blocking = (u: Block) =>
    ctx.base.blocks.some(
      (o) => o.id !== u.id && polys.has(o.id) && maxDepth(pieces(u, true), pieces(o, true)) > UNIT_OVERLAP_TOL && maxDepth(pieces(u, false), pieces(o, false)) <= UNIT_OVERLAP_TOL,
    );
  return ctx.base.blocks.find((u) => u.template !== undefined && !polys.has(u.id) && blocking(u))?.id;
}

/**
 * Whether the new polygons `polys` put a template unit on another block (or another block on one) deeper than `tol`
 * where the base had them apart (last fix round, fifth review).
 */
function unitsOnBlocks(ctx: EditContext, polys: ReadonlyMap<Id, Vec2[]>, tol: number): boolean {
  const pieces = (b: Block, now: boolean) => convexPieces((now ? polys.get(b.id) : undefined) ?? b.polygon.map((x) => x.p));
  for (const u of ctx.base.blocks) {
    if (u.template === undefined) continue;
    for (const o of ctx.base.blocks) {
      if (o.id === u.id || (!polys.has(u.id) && !polys.has(o.id))) continue;
      if (maxDepth(pieces(u, true), pieces(o, true)) <= tol) continue;
      if (maxDepth(pieces(u, false), pieces(o, false)) > UNIT_OVERLAP_TOL) continue;
      return true;
    }
  }
  return false;
}

/**
 * An edge / corner edit cut back so that no template unit ends up on another block (last fix round, fifth review):
 * the moving edge stops at the contact; refused (k 0) when it cannot move at all. `build(k)`: the polygons for the
 * fraction k of the move; `valid`: whether they are valid; `k0`: the largest valid fraction; `size`: the move (m).
 */
function unitClampedPlan(ctx: EditContext, build: (k: number) => Map<Id, Vec2[]>, valid: (polys: Map<Id, Vec2[]>) => boolean, k0: number, size: number): BlockEditPlan {
  const polys = k0 > 0 ? build(k0) : new Map<Id, Vec2[]>();
  if (k0 <= 0 || !unitsOnBlocks(ctx, polys, UNIT_OVERLAP_TOL)) return { polys, k: k0, onBlock: false };
  let lo = 0;
  let hi = k0;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    const p = build(m);
    if (valid(p) && !unitsOnBlocks(ctx, p, 1e-10)) lo = m;
    else hi = m;
  }
  const unitId = unitInTheWay(ctx, polys);
  const plan: BlockEditPlan = lo * size > SAME ? { polys: build(lo), k: lo, onBlock: true } : { polys: new Map(), k: 0, onBlock: true };
  if (unitId !== undefined) plan.unitId = unitId;
  return plan;
}

/**
 * New polygons of the blocks in `shifts`, scaled back to the largest valid fraction (binary search), then further where
 * a unit would end up on a block (`unitClampedPlan`).
 */
function shiftsPlan(ctx: EditContext, shifts: ShiftMap): BlockEditPlan {
  const build = (k: number) => {
    const out = new Map<Id, Vec2[]>();
    for (const [blockId, m] of shifts) {
      const block = ctx.base.blocks.find((b) => b.id === blockId);
      if (!block) continue;
      out.set(blockId, shiftedPolygon(block.polygon.map((v) => v.p), m, k));
    }
    return out;
  };
  const ok = (polys: Map<Id, Vec2[]>) =>
    [...polys].every(([id, p]) => {
      const block = ctx.base.blocks.find((b) => b.id === id);
      return block ? validBlockPolygon(block.polygon.map((v) => v.p), p) : false;
    });
  const size = Math.max(0, ...[...shifts.values()].flatMap((m) => [...m.values()].map(Math.abs)));
  if (ok(build(1))) return unitClampedPlan(ctx, build, ok, 1, size);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    if (ok(build(m))) lo = m;
    else hi = m;
  }
  return unitClampedPlan(ctx, build, ok, lo, size);
}

/** Point P on the old segment (oa, ob) mapped onto the new one: a translation keeps the along-coordinate, else affine. */
function mapOnEdge(p: Vec2, oa: Vec2, ob: Vec2, na: Vec2, nb: Vec2): Vec2 {
  const od = sub(ob, oa);
  const nd = sub(nb, na);
  if (isParallel(od, nd)) {
    const n = leftNormal(unit(od));
    return add(p, scale(n, dot(sub(na, oa), n)));
  }
  const L = len(od);
  const t = L < TINY ? 0 : dot(sub(p, oa), od) / (L * L);
  return add(na, scale(nd, t));
}

interface ChangedEdge {
  blockId: Id;
  edgeId: Id;
  oa: Vec2;
  ob: Vec2;
  na: Vec2;
  nb: Vec2;
  /** The edge's line moved (translated / rotated); false when it was only stretched along its own line. */
  moved: boolean;
}

/**
 * Apply new block polygons with all cascades (header: "Block edits"): ghosts, openings, collinear and attached
 * stored walls, floor zones, vertex positions, healing. `polys` holds every block that changes (partners included).
 */
function applyBlockPolygons(draft: Variant, ctx: EditContext, polys: Map<Id, Vec2[]>): boolean {
  const changed: ChangedEdge[] = [];
  for (const [blockId, nw] of polys) {
    const b0 = ctx.base.blocks.find((b) => b.id === blockId);
    if (!b0 || b0.polygon.length !== nw.length) continue;
    const old = b0.polygon.map((v) => v.p);
    const n = old.length;
    for (let i = 0; i < n; i++) {
      const oa = old[i];
      const ob = old[(i + 1) % n];
      const na = nw[i];
      const nb = nw[(i + 1) % n];
      if (samePoint(oa, na, TINY) && samePoint(ob, nb, TINY)) continue;
      const moved = lineDistance(na, oa, ob) > 1e-6 || lineDistance(nb, oa, ob) > 1e-6;
      changed.push({ blockId, edgeId: b0.polygon[i].id, oa, ob, na, nb, moved });
    }
  }
  if (changed.length === 0) return false;

  for (const blockId of new Set(changed.map((e) => e.blockId))) {
    const b0 = ctx.base.blocks.find((b) => b.id === blockId);
    const b = draft.blocks.find((x) => x.id === blockId);
    if (b0 && b && !b0.isNew && b0.parts.length === 0) b.parts = [todayPart(b0, ctx.base.ghosts)];
  }

  for (const e of changed) {
    const ghosts = e.moved ? addEdgeGhosts(draft, ctx, e.blockId, e.edgeId, e.oa, e.ob) : addStubGhosts(draft, ctx, e);
    keepEdgeOpenings(draft, ctx, e, ghosts);
  }
  if (draft.ghosts?.length === 0) delete draft.ghosts;

  // Stored walls: collinear with a moved edge → carried along; one end on a moved edge → extended / trimmed. A
  // template unit's edge takes only its own walls (`blockOwnership`; last fix round, sixth review: the house's
  // partitions ending on the wall a shed stands against were stretched when the shed's edge left it).
  const unitOwns = new Map<Id, (w: Wall) => boolean>();
  const follows = (e: ChangedEdge, w: Wall): boolean => {
    const b0 = ctx.base.blocks.find((b) => b.id === e.blockId);
    if (!b0 || b0.template === undefined) return true;
    let owns = unitOwns.get(b0.id);
    if (!owns) {
      owns = blockOwnership(ctx.base, ctx, b0).wall;
      unitOwns.set(b0.id, owns);
    }
    return owns(w);
  };
  const movedEdges = changed.filter((e) => e.moved);
  const carried = new Map<Id, { a: Vec2; b: Vec2; translated: boolean }>();
  const changes = new Map<Id, WallChange>();
  for (const w of ctx.base.walls) {
    if (w.status === 'removed') continue;
    const host = movedEdges.find(
      (e) => distancePointSegment(w.a, e.oa, e.ob) <= COINCIDE && distancePointSegment(w.b, e.oa, e.ob) <= COINCIDE && follows(e, w),
    );
    if (host) {
      carried.set(w.id, {
        a: mapOnEdge(w.a, host.oa, host.ob, host.na, host.nb),
        b: mapOnEdge(w.b, host.oa, host.ob, host.na, host.nb),
        translated: isParallel(sub(host.ob, host.oa), sub(host.nb, host.na)),
      });
      continue;
    }
    for (const end of ['a', 'b'] as const) {
      const p = w[end];
      const e = movedEdges.find((x) => distancePointSegment(p, x.oa, x.ob) <= COINCIDE && follows(x, w));
      if (!e) continue;
      const other = end === 'a' ? w.b : w.a;
      const wd = sub(p, other);
      if (isParallel(wd, sub(e.ob, e.oa), SUPPORT_PARALLEL_SIN)) continue;
      const x = lineIntersection(other, wd, e.na, sub(e.nb, e.na));
      if (!x) continue;
      const ch = changes.get(w.id) ?? {};
      ch[end] = x;
      changes.set(w.id, ch);
    }
  }
  const changedHosts: ChangedHost[] = changed.map((e) => ({ host: { kind: 'blockEdge', blockId: e.blockId, edgeId: e.edgeId }, oldA: e.oa, oldB: e.ob }));
  for (const [id, c] of carried) {
    const w0 = ctx.base.walls.find((w) => w.id === id);
    const w = draft.walls.find((x) => x.id === id);
    if (!w0 || !w) continue;
    if (c.translated) touchWallForMove(draft, id);
    else touchExisting(draft, id);
    w.a = copy(c.a);
    w.b = copy(c.b);
    if (!c.translated) keepWallOpenings(draft, id, w0.a, w0.b, true);
    changedHosts.push(...changedWall(draft, id, w0.a, w0.b));
  }
  changedHosts.push(...applyWallChanges(draft, ctx, changes, true));

  // Floor zones follow the block's vertices and moved edges; then the polygons.
  for (const [blockId, nw] of polys) {
    const b0 = ctx.base.blocks.find((b) => b.id === blockId);
    const b = draft.blocks.find((x) => x.id === blockId);
    if (!b0 || !b || b0.polygon.length !== nw.length) continue;
    const old = b0.polygon.map((v) => v.p);
    const own = movedEdges.filter((e) => e.blockId === blockId);
    b.floorZones.forEach((z, zi) => {
      const z0 = b0.floorZones[zi];
      if (!z0) return;
      z.polygon = z0.polygon.map((p) => {
        const k = old.findIndex((q) => dist(q, p) <= COINCIDE);
        if (k >= 0) return copy(nw[k]);
        const e = own.find((x) => distancePointSegment(p, x.oa, x.ob) <= COINCIDE);
        return copy(e ? mapOnEdge(p, e.oa, e.ob, e.na, e.nb) : p);
      });
    });
    b.polygon.forEach((v, i) => {
      v.p = copy(nw[i]);
    });
  }
  addJunctionGhosts(draft, ctx, changed);
  if (draft.ghosts?.length === 0) delete draft.ghosts;
  healGhosts(draft);
  pullBackOpenings(draft, ctx, changedHosts);
  return true;
}

/** The plan of `applyMoveBlockEdge` (null: nothing to move). */
function edgePlan(ctx: EditContext, blockId: Id, edgeId: Id, delta: Vec2): BlockEditPlan | null {
  const block = ctx.base.blocks.find((b) => b.id === blockId);
  const i = block ? block.polygon.findIndex((v) => v.id === edgeId) : -1;
  if (!block || i < 0) return null;
  const n = outwardNormal(block.polygon.map((v) => v.p), i);
  const shift = dot(delta, n);
  if (Math.abs(shift) < TINY) return null;
  return unitAwarePlan(ctx, [{ blockId, edgeIndex: i, shift }]);
}

/** Move block edge `edgeId` by `delta` (its component along the outward normal), junction partners following. */
export function applyMoveBlockEdge(draft: Variant, ctx: EditContext, blockId: Id, edgeId: Id, delta: Vec2): boolean {
  const plan = edgePlan(ctx, blockId, edgeId, delta);
  return plan !== null && applyUnitPolygons(draft, ctx, plan.polys);
}

/**
 * How much of an edge move `applyMoveBlockEdge` applies (last fix round, fifth review): `k` the fraction, `onBlock`
 * when it was cut back (or refused, k 0) because a template unit would end up on another block, `unitId` the unit in
 * the way when it is not the edited block (`unitInTheWay`: a house edge a shed stands against). The drag preview draws
 * the same clamp and shows the hint.
 */
export function blockEdgeMoveClamp(ctx: EditContext, blockId: Id, edgeId: Id, delta: Vec2): { k: number; onBlock: boolean; unitId?: Id } {
  const plan = edgePlan(ctx, blockId, edgeId, delta);
  if (!plan) return { k: 1, onBlock: false };
  return plan.unitId !== undefined ? { k: plan.k, onBlock: plan.onBlock, unitId: plan.unitId } : { k: plan.k, onBlock: plan.onBlock };
}

/** The plan of `applyMoveBlockVertex` (null: nothing to move). */
function vertexPlan(ctx: EditContext, blockId: Id, vertexId: Id, p: Vec2): BlockEditPlan | null {
  const block = ctx.base.blocks.find((b) => b.id === blockId);
  const i = block ? block.polygon.findIndex((v) => v.id === vertexId) : -1;
  if (!block || i < 0) return null;
  const pts = block.polygon.map((v) => v.p);
  const n = pts.length;
  const v = pts[i];
  if (samePoint(v, p, TINY)) return null;
  if (keepsRectangle(block)) {
    const prev = (i - 1 + n) % n;
    const d = sub(p, v);
    const starts = [
      { blockId, edgeIndex: prev, shift: dot(d, outwardNormal(pts, prev)) },
      { blockId, edgeIndex: i, shift: dot(d, outwardNormal(pts, i)) },
    ];
    return unitAwarePlan(ctx, starts);
  }
  const build = (k: number) => {
    const q = copy(add(v, scale(sub(p, v), k)));
    const polys = new Map<Id, Vec2[]>();
    polys.set(
      blockId,
      pts.map((x, j) => (j === i ? q : copy(x))),
    );
    for (const other of ctx.base.blocks) {
      if (other.id === blockId || !carriesThrough(ctx, blockId, other.id)) continue;
      const opts = other.polygon.map((x) => x.p);
      if (!opts.some((x) => dist(x, v) <= COINCIDE)) continue;
      const moved = opts.map((x) => (dist(x, v) <= COINCIDE ? q : copy(x)));
      if (validBlockPolygon(opts, moved)) polys.set(other.id, moved);
    }
    return polys;
  };
  const valid = (polys: Map<Id, Vec2[]>) => {
    const own = polys.get(blockId);
    return own !== undefined && validBlockPolygon(pts, own);
  };
  if (!valid(build(1))) return null;
  return unitClampedPlan(ctx, build, valid, 1, dist(v, p));
}

/** Move block vertex `vertexId` to p: both adjacent edges for gable / mono blocks, the vertex alone for flat ones. */
export function applyMoveBlockVertex(draft: Variant, ctx: EditContext, blockId: Id, vertexId: Id, p: Vec2): boolean {
  const plan = vertexPlan(ctx, blockId, vertexId, p);
  return plan !== null && applyUnitPolygons(draft, ctx, plan.polys);
}

/**
 * As `blockEdgeMoveClamp`, for `applyMoveBlockVertex`; `point`: where the corner goes when it moves (a unit's corner
 * dragged into the building it stands against slides along its wall: last fix round, sixth review).
 */
export function blockVertexMoveClamp(ctx: EditContext, blockId: Id, vertexId: Id, p: Vec2): { k: number; onBlock: boolean; point?: Vec2; unitId?: Id } {
  const plan = vertexPlan(ctx, blockId, vertexId, p);
  if (!plan) return { k: 1, onBlock: false };
  const i = ctx.base.blocks.find((b) => b.id === blockId)?.polygon.findIndex((v) => v.id === vertexId) ?? -1;
  const q = i >= 0 ? plan.polys.get(blockId)?.[i] : undefined;
  const out: { k: number; onBlock: boolean; point?: Vec2; unitId?: Id } = q ? { k: plan.k, onBlock: plan.onBlock, point: copy(q) } : { k: plan.k, onBlock: plan.onBlock };
  if (plan.unitId !== undefined) out.unitId = plan.unitId;
  return out;
}

/**
 * `applyBlockPolygons`, then the furniture that a template unit among the changed blocks now stands over and did not
 * own before goes out of it (`pushOutOfMoved`, toasted by the caller; last fix round, fifth review: a unit enlarged
 * by its edge over the terrace table owned it, carried it on the next move and deleted it with itself).
 */
function applyUnitPolygons(draft: Variant, ctx: EditContext, polys: Map<Id, Vec2[]>): boolean {
  const units = ctx.base.blocks.filter((b) => b.template !== undefined && polys.has(b.id));
  const owned = new Map(units.map((b) => [b.id, new Set(ctx.base.furniture.filter(blockOwnership(ctx.base, ctx, b).furniture).map((f) => f.id))]));
  if (!applyBlockPolygons(draft, ctx, polys)) return false;
  for (const b0 of units) pushOutOfMoved(draft, ctx, b0, owned.get(b0.id) ?? new Set());
  return true;
}

/** On or inside a polygon within `tol`. */
function insideOrOn(p: Vec2, poly: Vec2[], tol = COINCIDE): boolean {
  if (pointInPolygon(p, poly)) return true;
  for (let i = 0; i < poly.length; i++) if (distancePointSegment(p, poly[i], poly[(i + 1) % poly.length]) <= tol) return true;
  return false;
}

function structureInside(s: StructureElement, poly: Vec2[]): boolean {
  switch (s.kind) {
    case 'post':
      return insideOrOn(s.position, poly);
    case 'beam':
      return insideOrOn(s.a, poly) && insideOrOn(s.b, poly);
    default:
      return insideOrOn(s.min, poly) && insideOrOn(s.max, poly);
  }
}

function translateStructure(s: StructureElement, d: Vec2): void {
  switch (s.kind) {
    case 'post':
      s.position = addc(s.position, d);
      break;
    case 'beam':
      s.a = addc(s.a, d);
      s.b = addc(s.b, d);
      break;
    default:
      s.min = addc(s.min, d);
      s.max = addc(s.max, d);
  }
}

/**
 * The furniture that belongs to a block (fix round after 2b: units carried and deleted the terrace furniture that stood
 * there before them): on the block's storeys, and standing in one of the block's rooms or unnamed faces — its derived
 * room (DerivedFurniture.roomId in `ctx.derived`) is a room whose label point lies in the block (DerivedRoom.blockId).
 * An item in the block's wall or outside its rooms does not belong. Items the derived model does not know (or no
 * context): the centre strictly inside the axis polygon, as before.
 */
function furnitureOfBlock(v: Variant, ctx: Pick<EditContext, 'derived'> | undefined, block: Block, axis: Vec2[], storeys: ReadonlySet<Id>): (f: FurnitureItem) => boolean {
  const rooms = new Set((ctx?.derived.rooms ?? []).filter((r) => r.blockId === block.id).map((r) => r.id));
  const known = new Map((ctx?.derived.furniture ?? []).map((f) => [f.id, f]));
  return (f) => {
    const s = storeyOfLevel(v, f.levelId);
    if (s === undefined || !storeys.has(s)) return false;
    const df = known.get(f.id);
    if (df) return df.roomId !== undefined && rooms.has(df.roomId);
    return insideOrOn(f.position, axis, 0);
  };
}

/** Clearance (m) between a unit's cladding and the furniture `pushFurnitureOut` moves out of it. */
const PUSH_GAP = 0.02;

/** Farther pushes `pushFurnitureOut` tries past each side when the nearest spot is taken: steps (m) and how many. */
const PUSH_STEP = 0.05;
const PUSH_STEPS = 40;

/** What `pushFurnitureOut` leaves alone besides the house: the block that moves (moveBlock / rotateBlock) and its own items. */
interface PushOpts {
  /** The unit (new or moving): its pointer-down place, walls and doors are no obstacles; its doors where it now stands are. */
  blockId?: Id;
  /** Items that go with the block (its own, `furnitureOfBlock`): never pushed. */
  own?: (f: FurnitureItem) => boolean;
}

/**
 * A unit placed, moved or turned over furniture (fix round after 2b; final fix round: moves and turns too, never the
 * house's furniture): every item on the unit's storey whose centre lies inside the unit's outer outline (the axis
 * rectangle grown by the cladding), or whose footprint reaches into it (last fix round, sixth review: into its walls),
 * and that stands outside every block — on the deck or the ground: no derived room,
 * centre in no other block — is pushed straight out past one side, by the smallest move that clears the cladding by
 * PUSH_GAP and puts it into no other block, onto no other item of that storey (bounding boxes), into no wall and no door
 * swing (the house's, and the unit's own doors where it now stands); farther out past the same sides in PUSH_STEP steps
 * when the nearest spot is taken; else the smallest move into no block. A unit placed over the house therefore leaves
 * the house's furniture alone (its block-overlap warning shows it) but still pushes terrace furniture out, so it never
 * owns what stood there before it (`furnitureOfBlock`). Returns the ids of the items it moved.
 */
function pushFurnitureOut(draft: Variant, ctx: EditContext, poly: Vec2[], outerOffset: number, levelId: Id, opts: PushOpts = {}): Id[] {
  type Box = { min: Vec2; max: Vec2 };
  const storey = storeyOfLevel(draft, levelId);
  const ub = bbox(poly);
  const others = ctx.base.blocks.filter((b) => b.id !== opts.blockId).map((b) => ({ block: b, axis: b.polygon.map((x) => x.p) }));
  const lo: Vec2 = [ub.min[0] - outerOffset, ub.min[1] - outerOffset];
  const hi: Vec2 = [ub.max[0] + outerOffset, ub.max[1] + outerOffset];
  const onStorey = draft.furniture.filter((f) => storeyOfLevel(draft, f.levelId) === storey);
  const derivedOf = new Map(ctx.derived.furniture.map((f) => [f.id, f]));
  const outer: Vec2[] = [lo, [hi[0], lo[1]], hi, [lo[0], hi[1]]];
  const pushable = onStorey.filter((f) => {
    const c = f.position;
    // Also an item whose footprint reaches into the unit's walls (last fix round, sixth review: the Loungesofa beside a
    // Vedskjul set against the house stood in its wall).
    const inside = c[0] > lo[0] && c[0] < hi[0] && c[1] > lo[1] && c[1] < hi[1];
    if (!inside && !convexOverlap(furnitureFootprint(f), outer)) return false;
    // Only what stands outside every block: never the house's furniture, nor what is in another unit's room.
    return !opts.own?.(f) && derivedOf.get(f.id)?.roomId === undefined && !others.some((o) => pointInPolygon(c, o.axis));
  });
  if (pushable.length === 0) return [];
  const blocks: Box[] = others.map(({ block: b, axis }) => {
    const bb = bbox(axis);
    const o = b.wall.outerOffset;
    return { min: [bb.min[0] - o, bb.min[1] - o], max: [bb.max[0] + o, bb.max[1] + o] };
  });
  // Walls and door swings of the storey (not the moving unit's own at its old place), and the unit's doors where it is now.
  const solid: Vec2[][] = [];
  for (const w of ctx.derived.walls) {
    if (w.isGhost || (storey !== undefined && !w.storeyIds.includes(storey))) continue;
    if (w.source.kind === 'blockEdge' && w.source.blockId === opts.blockId) continue;
    if (!w.isDivider && w.footprint.length >= 3) solid.push(...convexPieces(w.footprint));
    for (const o of w.openings) {
      if (o.isGhost) continue;
      for (const s of [o.swing, o.swing2]) if (s) solid.push(swingSector(s));
    }
  }
  const unitBlock = opts.blockId === undefined ? undefined : draft.blocks.find((b) => b.id === opts.blockId);
  if (unitBlock) {
    const pts = unitBlock.polygon.map((v) => copy(v.p));
    for (const o of draft.openings) {
      if (o.host.kind !== 'blockEdge' || o.host.blockId !== unitBlock.id || !SWINGING.has(o.type)) continue;
      const edgeId = o.host.edgeId;
      const i = unitBlock.polygon.findIndex((v) => v.id === edgeId);
      if (i < 0) continue;
      const a = pts[i];
      const u = unit(sub(pts[(i + 1) % pts.length], a));
      const n = scale(outwardNormal(pts, i), outerOffset + o.width);
      const s0 = add(a, scale(u, o.offset - o.width / 2));
      const s1 = add(a, scale(u, o.offset + o.width / 2));
      solid.push([s0, s1, add(s1, n), add(s0, n)]);
    }
  }
  const solidBoxes = solid.map((p) => bbox(p));
  /** Every item's footprint box where it stands now (kept up to date as items are pushed). */
  const boxes = new Map<Id, Box>(onStorey.map((f) => [f.id, bbox(furnitureFootprint(f))]));
  const boxOf = (f: FurnitureItem): Box => boxes.get(f.id) ?? bbox(furnitureFootprint(f));
  const overlaps = (p: Box, q: Box) => p.min[0] < q.max[0] && p.max[0] > q.min[0] && p.min[1] < q.max[1] && p.max[1] > q.min[1];
  const moved: Id[] = [];
  for (const f of pushable) {
    const c = f.position;
    const fb = boxOf(f);
    const sides = [
      [hi[0] - fb.min[0] + PUSH_GAP, 0],
      [lo[0] - fb.max[0] - PUSH_GAP, 0],
      [0, hi[1] - fb.min[1] + PUSH_GAP],
      [0, lo[1] - fb.max[1] - PUSH_GAP],
    ] as Vec2[];
    const nearest = [...sides].sort((p, q) => len(p) - len(q));
    const moves: Vec2[] = [];
    for (const m of sides) for (let k = 0; k <= PUSH_STEPS; k++) moves.push(add(m, scale(unit(m), k * PUSH_STEP)));
    moves.sort((p, q) => len(p) - len(q));
    const inBlock = (d: Vec2) => {
      const nb: Box = { min: add(fb.min, d), max: add(fb.max, d) };
      return blocks.some((o) => overlaps(nb, o));
    };
    const clear = (d: Vec2) => {
      const nb: Box = { min: add(fb.min, d), max: add(fb.max, d) };
      if (inBlock(d) || onStorey.some((g) => g !== f && overlaps(nb, boxOf(g)))) return false;
      const ring: Vec2[] = [nb.min, [nb.max[0], nb.min[1]], nb.max, [nb.min[0], nb.max[1]]];
      return !solid.some((p, k) => overlaps(nb, solidBoxes[k]) && convexOverlap(ring, p));
    };
    const d = moves.find(clear) ?? moves.find((m) => !inBlock(m)) ?? nearest[0];
    f.position = addc(c, d);
    boxes.set(f.id, { min: add(fb.min, d), max: add(fb.max, d) });
    moved.push(f.id);
  }
  return moved;
}

/** Storey ids whose levels a block's floor reaches (its level and its zones' levels). */
function blockStoreys(v: Variant, block: Block): Set<Id> {
  const out = new Set<Id>();
  for (const id of [block.levelId, ...block.floorZones.map((z) => z.levelId)]) {
    const s = storeyOfLevel(v, id);
    if (s) out.add(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// A unit never stands on another block (last fix round, fifth review)
// ---------------------------------------------------------------------------

/**
 * How far (m) a template unit may reach into another block's axis polygon before it counts as standing on it: float
 * noise only. A unit attached along a wall (axis edge on axis edge) does not overlap.
 */
export const UNIT_OVERLAP_TOL = 0.001;

/** Unit normals of a polygon's edges (the separating axes of a convex piece). */
function edgeAxes(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const d = sub(poly[(i + 1) % poly.length], poly[i]);
    if (len(d) > TINY) out.push(leftNormal(unit(d)));
  }
  return out;
}

function projection(poly: Vec2[], n: Vec2): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    const s = dot(p, n);
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  return [lo, hi];
}

/** How deep two convex polygons overlap (separating axes): the least push that parts them; â‰¤ 0 when apart or touching. */
function convexDepth(p: Vec2[], q: Vec2[]): number {
  let depth = Infinity;
  for (const n of [...edgeAxes(p), ...edgeAxes(q)]) {
    const [p0, p1] = projection(p, n);
    const [q0, q1] = projection(q, n);
    depth = Math.min(depth, Math.min(p1, q1) - Math.max(p0, q0));
    if (depth <= 0) return depth;
  }
  return depth;
}

/** The convex pieces of the blocks a block (`self`; null: a unit not placed yet) must not stand on: a unit on none. */
function standOnPieces(v: Variant, self: Pick<Block, 'id' | 'template'> | null): Vec2[][] {
  const unitMoves = self === null || self.template !== undefined;
  return v.blocks
    .filter((b) => b.id !== self?.id && (unitMoves || b.template !== undefined))
    .flatMap((b) => convexPieces(b.polygon.map((x) => x.p)));
}

function maxDepth(pieces: Vec2[][], others: Vec2[][]): number {
  let d = -Infinity;
  for (const p of pieces) for (const q of others) d = Math.max(d, convexDepth(p, q));
  return d;
}

/**
 * Whether `poly` (the axis polygon of a template unit, or of a block moving near one) would stand on another block of
 * `v` (`self`: the block itself, or null for a unit being placed), deeper than UNIT_OVERLAP_TOL. A template unit may
 * stand on no block, any other block on no template unit.
 */
export function unitOverlaps(v: Variant, poly: Vec2[], self: Pick<Block, 'id' | 'template'> | null): boolean {
  return maxDepth(convexPieces(poly), standOnPieces(v, self)) > UNIT_OVERLAP_TOL;
}

/** The open range of t over which convex `p` moved by tÂ·d overlaps convex `q` (separating axes); null when never. */
function sweepRange(p: Vec2[], d: Vec2, q: Vec2[]): [number, number] | null {
  let lo = -Infinity;
  let hi = Infinity;
  for (const n of [...edgeAxes(p), ...edgeAxes(q)]) {
    const [p0, p1] = projection(p, n);
    const [q0, q1] = projection(q, n);
    const dn = dot(d, n);
    if (Math.abs(dn) < 1e-12) {
      if (Math.min(p1, q1) - Math.max(p0, q0) <= 0) return null;
      continue;
    }
    const a = (q0 - p1) / dn;
    const b = (q1 - p0) / dn;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
    if (lo >= hi) return null;
  }
  return [lo, hi];
}

/**
 * The part of `delta` that a block with axis polygon `axis` can move by without standing on another block
 * (`unitOverlaps`): 1 when it ends clear; else where the stretch of the move that ends on a block begins (exactly at
 * the contact, so the unit stops against that block's wall); 0 when that stretch begins at the start (refused).
 */
export function unitMoveFraction(v: Variant, axis: Vec2[], delta: Vec2, self: Pick<Block, 'id' | 'template'>): number {
  const pieces = convexPieces(axis);
  const others = standOnPieces(v, self);
  if (len(delta) < TINY || maxDepth(pieces.map((p) => p.map((q) => add(q, delta))), others) <= UNIT_OVERLAP_TOL) return 1;
  const ranges: [number, number][] = [];
  for (const p of pieces) {
    for (const q of others) {
      const r = sweepRange(p, delta, q);
      if (r) ranges.push(r);
    }
  }
  ranges.sort((x, y) => x[0] - y[0]);
  let start = 1;
  let end = -Infinity;
  for (const [a, b] of ranges) {
    if (a >= 1) break;
    if (a > end + 1e-12) start = a;
    end = Math.max(end, b);
  }
  return start > 1e-9 && start < 1 ? start : 0;
}

/**
 * The shortest shift of at most `reach` (m) that puts `poly` clear of every block it must not stand on
 * (`unitOverlaps`): straight out across a side of a block it overlaps, or out of a corner across two; [0, 0] when it is
 * clear already, null when no such shift is in reach (the step is then refused).
 */
export function unitClearShift(v: Variant, poly: Vec2[], reach: number, self: Pick<Block, 'id' | 'template'> | null): Vec2 | null {
  const pieces = convexPieces(poly);
  const others = standOnPieces(v, self);
  if (maxDepth(pieces, others) <= UNIT_OVERLAP_TOL) return [0, 0];
  const single: Vec2[] = [];
  for (const p of pieces) {
    for (const q of others) {
      if (convexDepth(p, q) <= 0) continue;
      for (const n of [...edgeAxes(p), ...edgeAxes(q)]) {
        const [p0, p1] = projection(p, n);
        const [q0, q1] = projection(q, n);
        single.push(scale(n, q1 - p0), scale(n, q0 - p1));
      }
    }
  }
  const candidates = [...single];
  for (let i = 0; i < single.length; i++) {
    for (let j = i + 1; j < single.length; j++) if (!isParallel(single[i], single[j])) candidates.push(add(single[i], single[j]));
  }
  const fits = candidates.filter((c) => len(c) <= reach + 1e-9).sort((a, b) => len(a) - len(b));
  return fits.find((c) => maxDepth(pieces.map((p) => p.map((q) => add(q, c))), others) <= UNIT_OVERLAP_TOL) ?? null;
}

/**
 * What a whole-block move, turn or delete takes along (last fix round, fifth review: a unit standing on the house took
 * the house's walls, room names and furniture when it was deleted, moved or turned): stored walls that are new, have
 * both ends on or inside its axis polygon and — for a template unit — lie in no other block (no end, nor the middle or
 * a point 2 cm to either side of it, strictly inside one: a wall along another block's edge is that block's; a drawn
 * block such as the wing keeps its walls on a shared edge, last fix round, sixth review); Room records created with it
 * (`Room.unitId`) or anchored in it and in no other block; furniture standing in its own faces (`furnitureOfBlock`)
 * whose centre is in no other block; structure inside it and in no other block. Never a ghost, and for a template unit
 * never an existing wall (a drawn new block keeps the existing walls inside it, as before).
 */
function blockOwnership(v: Variant, ctx: Pick<EditContext, 'derived'> | undefined, block: Block) {
  const axis = block.polygon.map((x) => x.p);
  const storeys = blockStoreys(v, block);
  const others = v.blocks.filter((b) => b.id !== block.id).map((b) => b.polygon.map((x) => x.p));
  const inOther = (p: Vec2) =>
    others.some((ax) => pointInPolygon(p, ax) && ax.every((q, i) => distancePointSegment(p, q, ax[(i + 1) % ax.length]) > COINCIDE));
  const onStoreys = (levelId: Id) => {
    const s = storeyOfLevel(v, levelId);
    return s !== undefined && storeys.has(s);
  };
  const ownItem = furnitureOfBlock(v, ctx, block, axis, storeys);
  const structurePoint = (s: StructureElement): Vec2 =>
    s.kind === 'post' ? s.position : s.kind === 'beam' ? scale(add(s.a, s.b), 0.5) : scale(add(s.min, s.max), 0.5);
  return {
    axis,
    storeys,
    wall: (w: Wall): boolean => {
      if (w.status === 'removed' || (block.template !== undefined && w.status !== 'new')) return false;
      if (!onStoreys(w.levelId) || !insideOrOn(w.a, axis) || !insideOrOn(w.b, axis)) return false;
      // A drawn block keeps the walls on its edges shared with another block (last fix round, sixth review: the wing
      // left w-wing-w and its door behind when it was moved or deleted); only a unit leaves them to that block.
      if (block.template === undefined) return true;
      const m = scale(add(w.a, w.b), 0.5);
      const side = scale(leftNormal(unit(sub(w.b, w.a))), 0.02);
      return ![w.a, w.b, m, add(m, side), sub(m, side)].some(inOther);
    },
    room: (r: Room): boolean =>
      onStoreys(r.levelId) && (r.unitId === block.id || (insideOrOn(r.anchor, axis, 0) && !others.some((ax) => insideOrOn(r.anchor, ax, 0)))),
    furniture: (f: FurnitureItem): boolean => ownItem(f) && !others.some((ax) => pointInPolygon(f.position, ax)),
    structure: (s: StructureElement): boolean => structureInside(s, axis) && !inOther(structurePoint(s)),
  };
}

/**
 * Move a whole block (header: "moveBlock"). Returns 'existing' (refused) for a block with existing area, false when
 * nothing moved.
 */
export function applyMoveBlock(draft: Variant, ctx: EditContext, blockId: Id, delta: Vec2): boolean | 'existing' {
  const b0 = ctx.base.blocks.find((b) => b.id === blockId);
  const b = draft.blocks.find((x) => x.id === blockId);
  if (!b0 || !b) return false;
  if (blockHasExistingArea(b0)) return 'existing';
  if (len(delta) < TINY) return false;
  // Only what is its own (blockOwnership): never the house's walls, names or furniture under a unit standing on it.
  const owns = blockOwnership(ctx.base, ctx, b0);
  b.polygon.forEach((v) => (v.p = addc(v.p, delta)));
  for (const p of b.parts) p.polygon = p.polygon.map((q) => addc(q, delta));
  for (const z of b.floorZones) z.polygon = z.polygon.map((q) => addc(q, delta));
  for (const w0 of ctx.base.walls) {
    if (!owns.wall(w0)) continue;
    touchWallForMove(draft, w0.id);
    const w = draft.walls.find((x) => x.id === w0.id);
    if (!w) continue;
    w.a = addc(w0.a, delta);
    w.b = addc(w0.b, delta);
  }
  for (const r of draft.rooms) {
    if (!owns.room(r)) continue;
    r.anchor = addc(r.anchor, delta);
    ctx.carried?.set(r.id, (p) => add(p, delta));
  }
  // Only its own furniture (in its rooms), not what stood on the terrace before it (furnitureOfBlock).
  const own = new Set(draft.furniture.filter(owns.furniture).map((f) => f.id));
  for (const f of draft.furniture) if (own.has(f.id)) f.position = addc(f.position, delta);
  for (const s of draft.structure) if (owns.structure(s)) translateStructure(s, delta);
  // What it now stands on and did not own goes out of it, as at placement (final fix round after 2b: a unit moved onto
  // the terrace table took it over, carried it on the next move and deleted it with itself).
  pushOutOfMoved(draft, ctx, b0, own);
  healGhosts(draft);
  return true;
}

/**
 * Centre of a quarter turn of a block: a point near the axis bounding-box centre about which a quarter turn maps the
 * 0.1 m grid onto itself (both coordinates on the 0.05 m grid, their sum on the 0.1 m grid), picked so that the turn
 * and its inverse use the same point (+90° then −90°, or four +90°, give back the same footprint).
 */
function quarterTurnCentre(points: Vec2[]): Vec2 {
  const box = bbox(points);
  const I = Math.round((box.min[0] + box.max[0]) / 2 / 0.05);
  const J = Math.round((box.min[1] + box.max[1]) / 2 / 0.05);
  const even = (k: number) => ((k % 2) + 2) % 2 === 0;
  let c: [number, number] = [I, J];
  if (!even(I + J)) {
    // Each such point has exactly one neighbour whose (i + j) / 2 and (i − j) / 2 are both even: the turn about it
    // maps this point's star of four onto itself, so the inverse turn picks the same centre.
    const options: [number, number][] = [
      [I + 1, J],
      [I - 1, J],
      [I, J + 1],
      [I, J - 1],
    ];
    c = options.find(([i, j]) => even((i + j) / 2) && even((i - j) / 2)) ?? [I + 1, J];
  }
  return [clean(c[0] * 0.05), clean(c[1] * 0.05)];
}

const roundGrid = (v: number): number => clean(Math.round(v * 10) / 10);

/** A quarter turn (+1 counter-clockwise, −1 clockwise) about c. */
const quarterTurn = (c: Vec2, turns: 1 | -1) => (p: Vec2): Vec2 => {
  const d = sub(p, c);
  return add(c, turns === 1 ? [-d[1], d[0]] : [d[1], -d[0]]);
};

/** A free unit: the quarter turn about `quarterTurnCentre`, snapped to the 0.1 m grid. */
function gridTurn(axis: Vec2[], turns: 1 | -1): (p: Vec2) => Vec2 {
  const turn = quarterTurn(quarterTurnCentre(axis), turns);
  // Snap: the first vertex onto the 0.1 m grid (a no-op for footprints on the grid), the same shift for everything.
  const v0 = turn(axis[0]);
  const shift: Vec2 = [roundGrid(v0[0]) - v0[0], roundGrid(v0[1]) - v0[1]];
  return (p: Vec2): Vec2 => {
    const q = add(turn(p), shift);
    const r: Vec2 = [Math.abs(q[0] - roundGrid(q[0])) < 1e-9 ? roundGrid(q[0]) : q[0], Math.abs(q[1] - roundGrid(q[1])) < 1e-9 ? roundGrid(q[1]) : q[1]];
    return copy(r);
  };
}

/** Every vertex on the 0.1 m grid (within 1 µm). */
const onGrid = (pts: Vec2[]): boolean => pts.every((p) => Math.abs(p[0] - roundGrid(p[0])) < 1e-6 && Math.abs(p[1] - roundGrid(p[1])) < 1e-6);

/**
 * A free unit OFF the 0.1 m grid (polish round, phase 2b; e.g. a Vedskjul centred on (13, 9): y 8.25..9.75): the
 * quarter turn about its bounding-box centre, without a grid snap. The centre stays and the footprint keeps its own
 * offset from the grid, so +90 then −90 (or four turns) give exactly the same footprint back; snapping it to the grid
 * moved it 5 cm per turn.
 */
function centreTurn(axis: Vec2[], turns: 1 | -1): (p: Vec2) => Vec2 {
  const box = bbox(axis);
  const turn = quarterTurn([(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2], turns);
  return (p: Vec2): Vec2 => copy(turn(p));
}

/** A line a unit stands against: the outward normal of its touching edge and that line's offset along it. */
interface Contact {
  n: Vec2;
  level: number;
}

/**
 * The lines a block stands against (fix round 2 after 2a): edges of its axis polygon that lie on an edge of another
 * block's axis polygon or of a deck outline (collinear within 1 cm, overlapping by more than 1 cm). Block contacts
 * first, then deck edges.
 */
function contactsOf(ctx: EditContext, block: Block): Contact[] {
  const pts = block.polygon.map((v) => v.p);
  const lines: Vec2[][] = [
    ...ctx.base.blocks.filter((o) => o.id !== block.id).map((o) => o.polygon.map((v) => v.p)),
    ...ctx.base.outdoor.decks.map((d) => d.polygon.map((v) => v.p)),
  ];
  const out: Contact[] = [];
  for (const poly of lines) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (dist(a, b) < COINCIDE || collinearRanges(a, b, poly).length === 0) continue;
      const n = outwardNormal(pts, i);
      if (!out.some((c) => isParallel(c.n, n) && dot(c.n, n) > 0)) out.push({ n, level: dot(a, n) });
    }
  }
  return out;
}

/**
 * A unit standing against a wall or a deck edge (`contactsOf`) turns about its bounding-box centre and is then
 * shifted back onto the line it stood against (its extreme along that line's normal = the line), and onto a second,
 * non-parallel one when it stood in a corner. So it keeps touching the wall (or stays inside the deck edge), +90
 * then −90 — or two turns of a rectangle — give the same footprint back, and its middle along the line stays put. No
 * grid snap (the turned footprint is centred on the same point of the line).
 */
function contactTurn(axis: Vec2[], turns: 1 | -1, contacts: Contact[]): (p: Vec2) => Vec2 {
  const box = bbox(axis);
  const turn = quarterTurn([(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2], turns);
  const turned = axis.map(turn);
  const extreme = (n: Vec2, shift: Vec2) => Math.max(...turned.map((p) => dot(add(p, shift), n)));
  const [c1] = contacts;
  let shift = scale(c1.n, c1.level - extreme(c1.n, [0, 0]));
  const c2 = contacts.find((c) => !isParallel(c.n, c1.n, SUPPORT_PARALLEL_SIN));
  if (c2) {
    const along1 = leftNormal(c1.n);
    shift = add(shift, scale(along1, (c2.level - extreme(c2.n, shift)) / dot(along1, c2.n)));
  }
  return (p: Vec2): Vec2 => copy(add(turn(p), shift));
}

/**
 * The quarter turn `applyRotateBlock` gives block `b0`: about its centre on the grid (`gridTurn`), keeping a contact
 * (`contactTurn`) or about its own centre off the grid (`centreTurn`).
 */
function blockTurn(ctx: EditContext, b0: Block, deg: 90 | -90): (p: Vec2) => Vec2 {
  const turns = deg === 90 ? 1 : -1;
  const axis = b0.polygon.map((v) => v.p);
  const contacts = contactsOf(ctx, b0);
  return contacts.length > 0 ? contactTurn(axis, turns, contacts) : onGrid(axis) ? gridTurn(axis, turns) : centreTurn(axis, turns);
}

/**
 * The axis polygon `applyRotateBlock(â€¦, blockId, deg)` gives the block (without a `shift`); null for an unknown block.
 * state/editActions.ts `rotateBlock` checks it against the other blocks first (last fix round, fifth review).
 */
export function turnedAxis(ctx: EditContext, blockId: Id, deg: 90 | -90): Vec2[] | null {
  const b0 = ctx.base.blocks.find((b) => b.id === blockId);
  if (!b0) return null;
  const T = blockTurn(ctx, b0, deg);
  return b0.polygon.map((v) => T(v.p));
}

/**
 * Turn a whole block with a template (a placed unit) a quarter turn (`deg` 90 = counter-clockwise) about its centre
 * (`quarterTurnCentre`), snapped to the 0.1 m grid — a unit against a wall or deck edge keeps that contact
 * (`contactTurn`), a free unit off the grid turns about its own centre without a snap (`centreTurn`) —, carrying what
 * `moveBlock` carries (parts, zones, stored walls
 * with their openings, room anchors, furniture — turned with it —, structure); openings on its edges turn with their
 * edges; the roof's ridge axis / slope side and its manual extensions turn too. Returns 'existing' (refused) for a
 * block with existing area, 'no-template' for a drawn block, false when nothing turned.
 */
export function applyRotateBlock(
  draft: Variant,
  ctx: EditContext,
  blockId: Id,
  deg: 90 | -90,
  opts: { shift?: Vec2 } = {},
): boolean | 'existing' | 'no-template' {
  const b0 = ctx.base.blocks.find((b) => b.id === blockId);
  const b = draft.blocks.find((x) => x.id === blockId);
  if (!b0 || !b) return false;
  if (blockHasExistingArea(b0)) return 'existing';
  if (!b0.template) return 'no-template';
  const turns = deg === 90 ? 1 : -1;
  const turn = blockTurn(ctx, b0, deg);
  const T = opts.shift ? (p: Vec2): Vec2 => addc(turn(p), opts.shift as Vec2) : turn;
  const owns = blockOwnership(ctx.base, ctx, b0);
  b.polygon.forEach((v) => (v.p = T(v.p)));
  for (const p of b.parts) p.polygon = p.polygon.map(T);
  for (const z of b.floorZones) z.polygon = z.polygon.map(T);
  const roof = b.roof;
  if (roof.type === 'gable' && roof.ridgeAxis) {
    const from = roof.ridgeAxis;
    roof.ridgeAxis = from === 'x' ? 'y' : 'x';
    // The low end along the old ridge axis lands on the low end of the new one unless the turn reverses it.
    const reverses = (from === 'y' && turns === 1) || (from === 'x' && turns === -1);
    if (roof.extend && reverses) roof.extend = { start: roof.extend.end, end: roof.extend.start };
    if (roof.extend) {
      if (roof.extend.start === undefined) delete roof.extend.start;
      if (roof.extend.end === undefined) delete roof.extend.end;
    }
  } else if (roof.type === 'mono' && roof.slopeTo) {
    roof.slopeTo = cardinalOf(roof.slopeTo, turns === 1 ? 1 : 3);
  }
  for (const w0 of ctx.base.walls) {
    if (!owns.wall(w0)) continue;
    touchWallForMove(draft, w0.id);
    const w = draft.walls.find((x) => x.id === w0.id);
    if (!w) continue;
    w.a = T(w0.a);
    w.b = T(w0.b);
  }
  for (const r of draft.rooms) {
    if (!owns.room(r)) continue;
    r.anchor = T(r.anchor);
    ctx.carried?.set(r.id, T);
  }
  const own = new Set(draft.furniture.filter(owns.furniture).map((f) => f.id));
  for (const f of draft.furniture) {
    if (!own.has(f.id)) continue;
    f.position = T(f.position);
    f.rotationDeg = (((f.rotationDeg + deg) % 360) + 360) % 360;
  }
  for (const s of draft.structure) {
    if (!owns.structure(s)) continue;
    if (s.kind === 'post') s.position = T(s.position);
    else if (s.kind === 'beam') {
      s.a = T(s.a);
      s.b = T(s.b);
    } else {
      const p = T(s.min);
      const q = T(s.max);
      s.min = [Math.min(p[0], q[0]), Math.min(p[1], q[1])];
      s.max = [Math.max(p[0], q[0]), Math.max(p[1], q[1])];
    }
  }
  // Turned onto terrace furniture: pushed out as at placement (final fix round after 2b).
  pushOutOfMoved(draft, ctx, b0, own);
  healGhosts(draft);
  return true;
}

/**
 * After a whole-block move or turn (final fix round after 2b): the items the block did not own (`own`, its furniture
 * before the edit) that now stand in it are pushed out (`pushFurnitureOut`), recorded in `ctx.pushed`.
 */
function pushOutOfMoved(draft: Variant, ctx: EditContext, b0: Block, own: ReadonlySet<Id>): void {
  const b = draft.blocks.find((x) => x.id === b0.id);
  if (!b) return;
  const pushed = pushFurnitureOut(draft, ctx, b.polygon.map((v) => copy(v.p)), b0.wall.outerOffset, b0.levelId, { blockId: b0.id, own: (f) => own.has(f.id) });
  if (pushed.length > 0) ctx.pushed?.push(...pushed);
}

/**
 * Delete a block: refused ('existing') for a block with existing area; a new block goes with the openings on its
 * edges, the stored walls on / inside it (and their openings), furniture and room anchors inside it, the junction
 * entries of other blocks that name it and its edge ghosts.
 */
export function applyDeleteBlock(draft: Variant, blockId: Id, ctx?: Pick<EditContext, 'derived'>): boolean | 'existing' {
  const b = draft.blocks.find((x) => x.id === blockId);
  if (!b) return false;
  if (blockHasExistingArea(b)) return 'existing';
  // Only its own walls, rooms and furniture (blockOwnership): a unit deleted from over the house leaves the house's.
  const owns = blockOwnership(draft, ctx, b);
  const goneWalls = new Set(draft.walls.filter(owns.wall).map((w) => w.id));
  draft.walls = draft.walls.filter((w) => !goneWalls.has(w.id));
  draft.openings = draft.openings.filter(
    (o) => !(o.host.kind === 'blockEdge' && o.host.blockId === blockId) && !(o.host.kind === 'wall' && goneWalls.has(o.host.wallId)),
  );
  draft.rooms = draft.rooms.filter((r) => !owns.room(r));
  // Its own furniture (in its rooms; with `ctx`, see furnitureOfBlock), not what stood there before it.
  draft.furniture = draft.furniture.filter((f) => !owns.furniture(f));
  for (const other of draft.blocks) other.junctions = other.junctions.filter((j) => j.otherBlockId !== blockId);
  if (draft.ghosts) {
    draft.ghosts = draft.ghosts.filter((g) => parseEdgeGhostId(g.id)?.blockId !== blockId);
    if (draft.ghosts.length === 0) delete draft.ghosts;
  }
  // Host walls of its edge ghosts (and the opening ghosts on them).
  const hosts = new Set(draft.walls.filter((w) => w.status === 'removed' && parseEdgeGhostId(w.id)?.blockId === blockId).map((w) => w.id));
  if (hosts.size > 0) {
    draft.walls = draft.walls.filter((w) => !hosts.has(w.id));
    draft.openings = draft.openings.filter((o) => !(o.host.kind === 'wall' && hosts.has(o.host.wallId)));
  }
  draft.blocks.splice(draft.blocks.indexOf(b), 1);
  return true;
}

/**
 * Duplicate a block `delta` away: new ids for the block, its vertices, parts, zones, and copies of the stored walls,
 * openings and rooms inside / on it. Everything in the copy is new; no junction entries.
 */
export function applyDuplicateBlock(draft: Variant, blockId: Id, delta: Vec2): Id | null {
  const b = draft.blocks.find((x) => x.id === blockId);
  if (!b) return null;
  const axis = b.polygon.map((v) => copy(v.p));
  const storeys = blockStoreys(draft, b);
  const onStoreys = (levelId: Id) => {
    const s = storeyOfLevel(draft, levelId);
    return s !== undefined && storeys.has(s);
  };
  const copyB = plain(b);
  copyB.id = newId('blk');
  const vid = new Map<Id, Id>();
  copyB.polygon.forEach((v) => {
    const id = newId('v');
    vid.set(v.id, id);
    v.id = id;
    v.p = addc(v.p, delta);
  });
  if (copyB.templateFrontEdgeId) copyB.templateFrontEdgeId = vid.get(copyB.templateFrontEdgeId) ?? copyB.templateFrontEdgeId;
  copyB.parts = copyB.parts.map((p) => ({ ...p, id: newId('part'), isNew: true, polygon: p.polygon.map((q) => addc(q, delta)) }));
  copyB.floorZones = copyB.floorZones.map((z) => ({ ...z, id: newId('zone'), polygon: z.polygon.map((q) => addc(q, delta)) }));
  copyB.isNew = true;
  copyB.junctions = [];
  copyB.name = nb.editor.copyName(b.name);
  draft.blocks.push(copyB);
  const wallIds = new Map<Id, Id>();
  for (const w of [...draft.walls]) {
    if (w.status === 'removed' || !onStoreys(w.levelId) || !insideOrOn(w.a, axis) || !insideOrOn(w.b, axis)) continue;
    const c = plain(w);
    c.id = newId('w');
    c.a = addc(c.a, delta);
    c.b = addc(c.b, delta);
    c.status = 'new';
    wallIds.set(w.id, c.id);
    draft.walls.push(c);
  }
  for (const o of [...draft.openings]) {
    if (o.status === 'removed') continue;
    let host: OpeningHost | null = null;
    if (o.host.kind === 'blockEdge' && o.host.blockId === blockId) host = { kind: 'blockEdge', blockId: copyB.id, edgeId: vid.get(o.host.edgeId) ?? o.host.edgeId };
    else if (o.host.kind === 'wall' && wallIds.has(o.host.wallId)) host = { kind: 'wall', wallId: wallIds.get(o.host.wallId) ?? o.host.wallId };
    if (!host) continue;
    const c = plain(o);
    c.id = newId('op');
    c.host = host;
    c.status = 'new';
    draft.openings.push(c);
  }
  for (const r of [...draft.rooms]) {
    if (!onStoreys(r.levelId) || !insideOrOn(r.anchor, axis, 0)) continue;
    const c: Room = { ...plain(r), id: newId('room'), anchor: addc(r.anchor, delta) };
    // The copy of a unit owns the copies of its rooms (`Room.unitId`).
    if (copyB.template !== undefined) c.unitId = copyB.id;
    else delete c.unitId;
    draft.rooms.push(c);
  }
  return copyB.id;
}

export interface BlockPatch {
  name?: string;
  roof?: Partial<Block['roof']>;
  eaveHeight?: number;
  wall?: Partial<Block['wall']>;
  /** null = no flat ceiling. */
  ceilingHeight?: number | null;
  /** Template units: add (true) / remove (false) the full-height opening on `templateFrontEdgeId`. */
  openFront?: boolean;
  isNew?: boolean;
  floorMaterial?: FloorMaterial | null;
}

/** Block properties; Takvinkel sets drive 'pitch', Mønehøyde drive 'height' (unless the patch names a drive). */
export function applySetBlockProps(draft: Variant, blockId: Id, patch: BlockPatch, newOpeningId?: Id): boolean {
  const b = draft.blocks.find((x) => x.id === blockId);
  if (!b) return false;
  if (patch.name !== undefined && patch.name.trim()) b.name = patch.name.trim();
  if (patch.roof) {
    const r = patch.roof;
    Object.assign(b.roof, plain(r));
    if (r.drive === undefined) {
      if (r.pitchDeg !== undefined && r.ridgeHeight === undefined) b.roof.drive = 'pitch';
      else if (r.ridgeHeight !== undefined && r.pitchDeg === undefined) b.roof.drive = 'height';
    }
  }
  if (patch.eaveHeight !== undefined) b.eaveHeight = patch.eaveHeight;
  if (patch.wall) Object.assign(b.wall, plain(patch.wall));
  if (patch.ceilingHeight !== undefined) {
    if (patch.ceilingHeight === null) delete b.ceilingHeight;
    else b.ceilingHeight = patch.ceilingHeight;
  }
  if (patch.isNew !== undefined) b.isNew = patch.isNew;
  if (patch.floorMaterial !== undefined) {
    if (patch.floorMaterial === null) delete b.floorMaterial;
    else b.floorMaterial = patch.floorMaterial;
  }
  if (patch.openFront !== undefined && b.templateFrontEdgeId) {
    const front = b.templateFrontEdgeId;
    const isFront = (o: Opening) => o.host.kind === 'blockEdge' && o.host.blockId === blockId && o.host.edgeId === front && o.type === 'opening' && o.fullHeight === true;
    const has = draft.openings.some(isFront);
    if (patch.openFront && !has) {
      const i = b.polygon.findIndex((v) => v.id === front);
      if (i >= 0) {
        const { a, b: e } = blockEdgeGeom(b, i);
        draft.openings.push(openFrontOpening(blockId, front, dist(a, e), b.eaveHeight, newOpeningId));
      }
    } else if (!patch.openFront && has) {
      draft.openings = draft.openings.filter((o) => !isFront(o));
    }
  }
  return true;
}

function openFrontOpening(blockId: Id, edgeId: Id, length: number, eave: number, id?: Id): Opening {
  const post = Math.min(0.1, length / 4);
  return {
    id: id ?? newId('op'),
    type: 'opening',
    host: { kind: 'blockEdge', blockId, edgeId },
    offset: length / 2,
    width: Math.max(0.1, length - 2 * post),
    height: eave,
    fullHeight: true,
    sill: 0,
    style: { frameColour: 'wood' },
    status: 'new',
  };
}

/**
 * The edge move of `applySetBlockSize`: the edge on `side` whose outward normal points that way most, moved by the
 * change of size. For a template unit whose edge there stands against a building that is not a unit
 * (`unitEdgeAttached`) the opposite edge moves when it is free (last fix round, sixth review: Dybde on a shed south of
 * the house moved its north edge, and with it the house). Null when the block has no such edge or the value is wrong.
 */
export function blockSizeMove(ctx: EditContext, blockId: Id, axis: 'w' | 'd', value: number, side: 'min' | 'max' = 'max'): { edgeId: Id; delta: Vec2 } | null {
  const block = ctx.base.blocks.find((b) => b.id === blockId);
  if (!block || !(value > 0)) return null;
  const pts = block.polygon.map((v) => v.p);
  const box = bbox(pts);
  const current = axis === 'w' ? box.max[0] - box.min[0] : box.max[1] - box.min[1];
  const edgeTowards = (s: 'min' | 'max') => {
    const dir: Vec2 = axis === 'w' ? [s === 'max' ? 1 : -1, 0] : [0, s === 'max' ? 1 : -1];
    let best = -1;
    let bestDot = 0.5;
    pts.forEach((_, i) => {
      const d = dot(outwardNormal(pts, i), dir);
      if (d > bestDot) {
        bestDot = d;
        best = i;
      }
    });
    return { best, dir };
  };
  let e = edgeTowards(side);
  if (e.best >= 0 && unitEdgeAttached(ctx, blockId, e.best)) {
    const other = edgeTowards(side === 'max' ? 'min' : 'max');
    if (other.best >= 0 && !unitEdgeAttached(ctx, blockId, other.best)) e = other;
  }
  if (e.best < 0) return null;
  return { edgeId: block.polygon[e.best].id, delta: scale(e.dir, value - current) };
}

/**
 * Set a block's width ('w', along x) or depth ('d', along y) by moving the edge on `side` ('max' = east / north,
 * default; 'min' = west / south) — for a unit standing against a building with that edge, the free one opposite
 * (`blockSizeMove`).
 */
export function applySetBlockSize(draft: Variant, ctx: EditContext, blockId: Id, axis: 'w' | 'd', value: number, side: 'min' | 'max' = 'max'): boolean {
  const m = blockSizeMove(ctx, blockId, axis, value, side);
  return m !== null && applyMoveBlockEdge(draft, ctx, blockId, m.edgeId, m.delta);
}

/** The widest opening an edge of `length` takes: posts at both ends like an open front (`openFrontOpening`). */
function fitWidth(length: number): number {
  return Math.max(0.1, length - 2 * Math.min(0.1, length / 4));
}

/** How far (m) from the middle of its edge the template's own opening may be and still count as where it was put. */
const TEMPLATE_CENTRED = 0.01;

/**
 * The template's width of opening `o` of a unit made from template `t` while it is still where the template put it:
 * its open front on the front edge, or its door (the unit's first opening of the door's type; the edge the door went
 * on is not stored), centred on the edge as it was before the change (`offset0` on an edge `L0` long). Else null: an
 * opening the user added, or the template's one the user moved (fix round 4 after phase 3: Bredde put a door the user
 * had moved to 0,6 m back in the middle, on the window beside it).
 */
function templateOpeningWidth(t: UnitTemplate | undefined, draft: Variant, block: Block, o: Opening, L0: number, offset0: number): number | null {
  if (!t || o.host.kind !== 'blockEdge' || Math.abs(offset0 - L0 / 2) > TEMPLATE_CENTRED) return null;
  if (t.openFront && o.type === 'opening' && o.fullHeight === true && o.host.edgeId === block.templateFrontEdgeId) return fitWidth(t.w);
  if (!t.door || o.type !== t.door.type) return null;
  const door = t.door.type;
  const first = draft.openings.find((x) => x.status !== 'removed' && x.host.kind === 'blockEdge' && x.host.blockId === block.id && x.type === door);
  return first === o ? t.door.width : null;
}

/**
 * After Bredde / Dybde of a template unit (`base`: the variant before): on every edge whose length changed, its own
 * openings that no longer fit (wider than the edge less a post at each end, `fitWidth`) are made narrower, centred —
 * final morning round: a Vedskjul narrowed from 3 m to 1,5 m kept its 1,8 m open front, outside its wall
 * (`opening-outside-host`). The template's own opening (the open front, the door) while still where the template put
 * it, centred on its edge (`templateOpeningWidth`), is centred on the edge again on every such change, and one that
 * filled its edge grows back towards the template's width when the edge gets longer (fix round 3 after phase 3: Bredde
 * 1,5 then 2 m left the 1,3 m front off-centre; with the posts there is no jump at the template's own width). Others
 * — added by the user, or moved — keep their place (`keepEdgeOpenings`) unless they no longer fit (fix round 4).
 * Returns the ids of the openings it narrowed (the caller toasts).
 */
export function fitUnitOpenings(draft: Variant, blockId: Id, base: Variant): Id[] {
  const block = draft.blocks.find((b) => b.id === blockId);
  if (!block || block.template === undefined) return [];
  const t = unitTemplate(block.template);
  const out: Id[] = [];
  for (const o of draft.openings) {
    if (o.status === 'removed' || o.host.kind !== 'blockEdge' || o.host.blockId !== blockId) continue;
    const line = hostLine(draft, o.host);
    if (!line) continue;
    const o0 = base.openings.find((x) => x.id === o.id);
    const L0 = o0 ? (hostLine(base, o.host)?.length ?? line.length) : line.length;
    if (!o0 || Math.abs(line.length - L0) <= 1e-6) continue;
    const fit = fitWidth(line.length);
    const own = templateOpeningWidth(t, draft, block, o, L0, o0.offset);
    let width = o.width;
    // It filled its edge before (as placed, or narrowed to fit): it grows back with a longer edge.
    if (own !== null && line.length > L0 && width < own && width >= fitWidth(L0) - 1e-6) width = Math.min(own, fit);
    const narrowed = width > fit + TINY;
    if (narrowed) width = fit;
    if (own === null && !narrowed) continue;
    o.width = clean(width);
    o.offset = clean(line.length / 2);
    if (narrowed) out.push(o.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export interface PlacedUnit {
  blockId: Id;
  roomId: Id;
  openingId: Id | null;
  /** Furniture that stood where the unit went and was pushed out of it (`pushFurnitureOut`). */
  pushedFurniture?: Id[];
}

function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(name)) return name;
  for (let k = 2; ; k++) if (!set.has(`${name} ${k}`)) return `${name} ${k}`;
}

/** On a deck piece (outer ring, not in a hole). */
function onDeck(derived: DerivedVariant, p: Vec2): boolean {
  return derived.outdoor.decks.some((d) => d.pieces.some((piece) => piece[0] && pointInPolygon(p, piece[0]) && !piece.slice(1).some((h) => pointInPolygon(p, h))));
}

/**
 * Place a unit from a template (header: "Units"). `at` is the centre, `rotation90` quarter turns. Null for an
 * unknown template. A unit with an open front placed with that front against another block (a shed attached to the
 * wing by its front) is turned half round, which keeps its footprint: the front faces away from the block (final fix
 * round after 2b; a door goes on a free deck-facing edge anyway, `deckFacingEdge`).
 */
export function applyPlaceUnit(draft: Variant, ctx: EditContext, templateId: string, at: Vec2, rotation90: number, ids: Partial<PlacedUnit> = {}): PlacedUnit | null {
  const t = unitTemplate(templateId);
  if (!t) return null;
  let rot = quarterTurns(rotation90);
  let poly = unitFootprint(t, at, rot);
  let leanTo = false;
  if (t.openFront) {
    const axes = ctx.base.blocks.map((b) => b.polygon.map((v) => v.p));
    const against = (i: number) => axes.some((ax) => collinearRanges(poly[i], poly[(i + 1) % poly.length], ax).length > 0);
    if (against(0) && !against(2)) {
      rot = quarterTurns(rot + 2);
      poly = unitFootprint(t, at, rot);
    }
    // Its back against a block (turned so, or placed so): a lean-to (last fix round, fifth review).
    leanTo = against(2) && !against(0);
  }
  const blockId = ids.blockId ?? newId('blk');
  const vertexIds = poly.map(() => newId('v'));
  const levelId = draft.levels.some((l) => l.id === 'main') ? 'main' : (draft.levels[0]?.id ?? 'main');
  const wall = t.wall ?? draft.settings.defaultExteriorWall;
  const roofBase = { drive: 'pitch' as const, pitchDeg: t.pitchDeg, thickness: 0.25, overhangEave: 0.3, overhangGable: 0.3, material: 'turf' as const };
  let roof: Block['roof'];
  if (t.roofType === 'gable') {
    const alongLocalX = t.w >= t.d;
    const ridgeAxis: 'x' | 'y' = alongLocalX === (rot % 2 === 0) ? 'x' : 'y';
    const half = Math.min(t.w, t.d) / 2;
    roof = { type: 'gable', ridgeAxis, ...roofBase, ridgeHeight: round3(t.eaveHeight + Math.tan((t.pitchDeg * Math.PI) / 180) * half) };
  } else if (t.roofType === 'mono') {
    // With its back against a block, a lean-to: high against that wall and draining away from it, to the open front
    // (last fix round, fifth review: the low eave and its overhang stood against the wing). Else down to the back.
    const slopeTo = cardinalOf('N', leanTo ? quarterTurns(rot + 2) : rot);
    roof = { type: 'mono', slopeTo, ...roofBase, ridgeHeight: round3(t.eaveHeight + Math.tan((t.pitchDeg * Math.PI) / 180) * t.d) };
  } else {
    roof = { type: 'flat', ...roofBase, drive: 'height', ridgeHeight: t.eaveHeight };
  }
  const block: Block = {
    id: blockId,
    name: uniqueName(t.name, draft.blocks.map((b) => b.name)),
    polygon: poly.map((p, i) => ({ id: vertexIds[i], p: copy(p) })),
    levelId,
    floorZones: [],
    parts: [],
    isNew: true,
    wall: plain(wall),
    eaveHeight: t.eaveHeight,
    roof,
    junctions: [],
    template: t.id,
    templateFrontEdgeId: vertexIds[0],
  };
  if (t.floorMaterial) block.floorMaterial = t.floorMaterial;
  draft.blocks.push(block);

  const room: Room = {
    id: ids.roomId ?? newId('room'),
    name: uniqueName(t.roomName, draft.rooms.map((r) => r.name)),
    type: t.roomType,
    levelId,
    anchor: copy(centroid(poly)),
    unitId: blockId,
  };
  if (t.floorMaterial) room.floorMaterial = t.floorMaterial;
  draft.rooms.push(room);

  let openingId: Id | null = null;
  if (t.openFront) {
    const o = openFrontOpening(blockId, vertexIds[0], t.w, t.eaveHeight, ids.openingId ?? undefined);
    draft.openings.push(o);
    openingId = o.id;
  } else if (t.door) {
    const edge = deckFacingEdge(ctx, poly);
    const a = poly[edge];
    const b = poly[(edge + 1) % poly.length];
    const o: Opening = {
      id: ids.openingId ?? newId('op'),
      type: t.door.type,
      host: { kind: 'blockEdge', blockId, edgeId: vertexIds[edge] },
      offset: dist(a, b) / 2,
      width: t.door.width,
      height: t.door.height,
      sill: 0,
      swing: { hinge: 'start', side: 'right' },
      style: { frameColour: t.door.type === 'saunaDoor' ? 'wood' : 'white' },
      status: 'new',
    };
    draft.openings.push(o);
    openingId = o.id;
  }
  // What stood there goes out of the unit, so the unit never carries or deletes it later (fix round after 2b).
  const pushed = pushFurnitureOut(draft, ctx, poly, wall.outerOffset, levelId, { blockId });
  return pushed.length > 0 ? { blockId, roomId: room.id, openingId, pushedFurniture: pushed } : { blockId, roomId: room.id, openingId };
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Index of the unit edge facing the deck: the front (0) when its outside probe is on a deck, else the first that is;
 * with none on a deck, the first whose probe is in no block (final fix round after 2b: not the edge against the wing).
 */
function deckFacingEdge(ctx: EditContext, poly: Vec2[]): number {
  const order = [0, 2, 1, 3].filter((i) => i < poly.length);
  const axes = ctx.base.blocks.map((b) => b.polygon.map((v) => v.p));
  let free = -1;
  for (const i of order) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const probe = add(scale(add(a, b), 0.5), scale(outwardNormal(poly, i), DECK_PROBE));
    const inBlock = axes.some((ax) => pointInPolygon(probe, ax));
    if (onDeck(ctx.derived, probe) && !inBlock) return i;
    if (free < 0 && !inBlock) free = i;
  }
  return Math.max(0, free);
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export interface RoomMerge {
  kept: Room;
  removed: Room;
}

export interface ReconcileResult {
  /** The reconciled room list (same objects where nothing changed). */
  rooms: Room[];
  changed: boolean;
  merges: RoomMerge[];
}

const sameFaceShape = (a: DerivedRoom, b: DerivedRoom): boolean =>
  Math.abs(a.area - b.area) < 1e-6 &&
  a.storeyId === b.storeyId &&
  samePoint(a.bbox.min, b.bbox.min, 1e-6) &&
  samePoint(a.bbox.max, b.bbox.max, 1e-6);

const boxesOverlap = (a: { min: Vec2; max: Vec2 }, b: { min: Vec2; max: Vec2 }): boolean =>
  a.min[0] < b.max[0] && b.min[0] < a.max[0] && a.min[1] < b.max[1] && b.min[1] < a.max[1];

/** The area (m²) two polygons share. */
export function overlapArea(a: Vec2[], b: Vec2[]): number {
  if (a.length < 3 || b.length < 3) return 0;
  return withClipFallback(
    'room overlap',
    () => intersectPolygons([a], [b]).reduce((s, p) => s + area(p[0] ?? []) - p.slice(1).reduce((h, r) => h + area(r), 0), 0),
    () => (pointInPolygon(labelPoint(a), b) ? Math.min(area(a), area(b)) : 0),
  );
}

/** An anchor closer than this (m) to a face's boundary does not count as inside it (derive may give it to the neighbour). */
const ANCHOR_MARGIN = 0.01;

/** Strictly inside the face: inside its polygon, outside its holes, and more than ANCHOR_MARGIN from every ring. */
function anchorInFace(anchor: Vec2, face: DerivedRoom): boolean {
  if (!pointInPolygon(anchor, face.polygon)) return false;
  if (face.holes.some((h) => h.length >= 3 && pointInPolygon(anchor, h))) return false;
  for (const ring of [face.polygon, ...face.holes]) {
    for (let i = 0; i < ring.length; i++) if (distancePointSegment(anchor, ring[i], ring[(i + 1) % ring.length]) <= ANCHOR_MARGIN) return false;
  }
  return true;
}

/** Overlaps below this (m²) do not tie a room to a face. */
const MIN_OVERLAP = 0.01;

/** Components with more rooms than this are matched greedily (largest overlap first) instead of exactly. */
const EXACT_MATCH_MAX_ROOMS = 10;

/**
 * One face per room and one room per face, maximising first the number of rooms that keep a face and then the total
 * overlap. `pairs` must be sorted by overlap, largest first. Exact per connected component of the room ↔ face overlap
 * graph (branch and bound; components are a handful of rooms around the edit), greedy for very large ones.
 */
export function matchRoomsToFaces<R, F, P extends { room: R; face: F; ov: number }>(pairs: readonly P[]): P[] {
  // Union-find over rooms and faces.
  const parent = new Map<unknown, unknown>();
  const find = (x: unknown): unknown => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r);
    return r;
  };
  for (const pr of pairs) {
    if (!parent.has(pr.room)) parent.set(pr.room, pr.room);
    if (!parent.has(pr.face)) parent.set(pr.face, pr.face);
    const a = find(pr.room);
    const b = find(pr.face);
    if (a !== b) parent.set(a, b);
  }
  const components = new Map<unknown, P[]>();
  for (const pr of pairs) {
    const k = find(pr.room);
    const list = components.get(k);
    if (list) list.push(pr);
    else components.set(k, [pr]);
  }
  const out: P[] = [];
  for (const comp of components.values()) {
    const rooms: R[] = [];
    for (const pr of comp) if (!rooms.includes(pr.room)) rooms.push(pr.room);
    if (rooms.length > EXACT_MATCH_MAX_ROOMS) {
      const roomsDone = new Set<R>();
      const facesDone = new Set<F>();
      for (const pr of comp) {
        if (roomsDone.has(pr.room) || facesDone.has(pr.face)) continue;
        roomsDone.add(pr.room);
        facesDone.add(pr.face);
        out.push(pr);
      }
      continue;
    }
    // Score = rooms kept × KEEP + total overlap (overlaps are far below KEEP).
    const KEEP = 1e6;
    const options = rooms.map((r) => comp.filter((pr) => pr.room === r));
    const best = options.map((o) => o[0]?.ov ?? 0);
    const rest: number[] = [];
    for (let i = rooms.length - 1, acc = 0; i >= 0; i--) rest[i] = acc += KEEP + best[i];
    let bestScore = -1;
    let bestPick: (P | null)[] = [];
    const pick: (P | null)[] = [];
    const used = new Set<F>();
    const search = (i: number, score: number): void => {
      if (i === rooms.length) {
        if (score > bestScore + 1e-9) {
          bestScore = score;
          bestPick = [...pick];
        }
        return;
      }
      if (score + rest[i] <= bestScore + 1e-9) return;
      for (const pr of options[i]) {
        if (used.has(pr.face)) continue;
        used.add(pr.face);
        pick.push(pr);
        search(i + 1, score + KEEP + pr.ov);
        pick.pop();
        used.delete(pr.face);
      }
      pick.push(null);
      search(i + 1, score);
      pick.pop();
    };
    search(0, 0);
    for (const pr of bestPick) if (pr) out.push(pr);
  }
  return out;
}

/**
 * Rooms under edits (header: "Rooms"). `nextDerived` = deriveVariant(next, …). Assignment: rooms whose face kept its
 * shape keep it; the others are matched to the free faces by overlap with their previous inner polygon
 * (`matchRoomsToFaces`: as many rooms as possible keep a face, then the largest total overlap), so a room that shrank
 * past its anchor keeps its own smaller face even when a neighbour grew into most of its old area. A room left without
 * a free face but overlapping a taken one is merged there (the room with the larger previous area stays); a room
 * overlapping nothing keeps whatever face its anchor gives it.
 */
export function reconcileRooms(
  baseDerived: DerivedVariant,
  next: Variant,
  nextDerived: DerivedVariant,
  opts: { carried?: ReadonlyMap<Id, PlanTransform> } = {},
): ReconcileResult {
  const prevById = new Map<Id, DerivedRoom>();
  for (const r of baseDerived.rooms) {
    if (!r.room) continue;
    // A room the edit carried (moveBlock / rotateBlock) is matched by its previous face carried the same way.
    const T = opts.carried?.get(r.room.id);
    if (!T) {
      prevById.set(r.room.id, r);
      continue;
    }
    const polygon = r.polygon.map(T);
    prevById.set(r.room.id, { ...r, polygon, holes: r.holes.map((h) => h.map(T)), bbox: bbox(polygon) });
  }
  const curById = new Map<Id, DerivedRoom>();
  for (const r of nextDerived.rooms) if (r.room) curById.set(r.room.id, r);

  const owner = new Map<DerivedRoom, { room: Room; prevArea: number }>();
  const faceOf = new Map<Id, DerivedRoom>();
  const assign = (room: Room, prevArea: number, face: DerivedRoom) => {
    owner.set(face, { room, prevArea });
    faceOf.set(room.id, face);
  };
  const pending: { room: Room; prev: DerivedRoom }[] = [];
  for (const room of next.rooms) {
    const prev = prevById.get(room.id);
    if (!prev) continue;
    const cur = curById.get(room.id);
    if (cur && sameFaceShape(prev, cur) && !owner.has(cur)) assign(room, prev.area, cur);
    else pending.push({ room, prev });
  }

  const pairs: { room: Room; prev: DerivedRoom; face: DerivedRoom; ov: number }[] = [];
  for (const p of pending) {
    const prevBox = bbox(p.prev.polygon);
    for (const f of nextDerived.rooms) {
      if (f.storeyId !== p.prev.storeyId || !boxesOverlap(prevBox, f.bbox)) continue;
      const ov = overlapArea(p.prev.polygon, f.polygon);
      if (ov > MIN_OVERLAP) pairs.push({ room: p.room, prev: p.prev, face: f, ov });
    }
  }
  pairs.sort((x, y) => y.ov - x.ov);
  for (const pr of matchRoomsToFaces(pairs.filter((pr) => !owner.has(pr.face)))) assign(pr.room, pr.prev.area, pr.face);

  const removed = new Set<Id>();
  const merges: RoomMerge[] = [];
  for (const p of pending) {
    if (faceOf.has(p.room.id)) continue;
    const best = pairs.find((pr) => pr.room.id === p.room.id);
    if (!best) {
      const cur = curById.get(p.room.id);
      if (cur && !owner.has(cur)) assign(p.room, p.prev.area, cur);
      continue;
    }
    const holder = owner.get(best.face);
    if (!holder) {
      assign(p.room, p.prev.area, best.face);
      continue;
    }
    if (p.prev.area > holder.prevArea + 1e-9) {
      removed.add(holder.room.id);
      faceOf.delete(holder.room.id);
      merges.push({ kept: p.room, removed: holder.room });
      assign(p.room, p.prev.area, best.face);
    } else {
      removed.add(p.room.id);
      merges.push({ kept: holder.room, removed: p.room });
    }
  }

  const anchors = new Map<Id, Vec2>();
  for (const [face, { room }] of owner) {
    if (removed.has(room.id)) continue;
    if (!anchorInFace(room.anchor, face) && !samePoint(room.anchor, face.labelPoint, 1e-9)) anchors.set(room.id, copy(face.labelPoint));
  }
  if (removed.size === 0 && anchors.size === 0) return { rooms: next.rooms, changed: false, merges };
  const rooms = next.rooms
    .filter((r) => !removed.has(r.id))
    .map((r) => {
      const a = anchors.get(r.id);
      return a ? { ...r, anchor: a } : r;
    });
  return { rooms, changed: true, merges };
}

/**
 * Bring back deleted Room records (`candidates`, newest first) whose anchor lies in an unnamed face of `derived` on
 * their storey. Returns the records to add (anchor moved to the label point when it is not inside the face).
 */
export function reviveRooms(v: Variant, derived: DerivedVariant, candidates: Room[]): Room[] {
  return reviveRoomRecords(v, derived, candidates).add;
}

/**
 * A Room record a merge deleted (fix round after 2b): the record and the anchors of the rooms that were alive with it
 * in the newest earlier state that still had it (state/editActions.ts reads both from the undo history). The room it
 * was merged into (`mergedInto`) is the one whose face now holds its anchor and that stood elsewhere then.
 */
export interface RoomTombstone {
  room: Room;
  peers?: ReadonlyMap<Id, Vec2>;
}

/** What `reviveRoomRecords` gives back: records to add, and new anchors for live rooms that move to another face. */
export interface RevivedRooms {
  add: Room[];
  anchors: Map<Id, Vec2>;
}

/**
 * `reviveRooms` with tombstones (fix round after 2b). First, as before, a deleted record whose anchor lies in an
 * unnamed face comes back there. Then a tombstone whose anchor lies in a face named by the room it was merged into
 * (`mergedInto`: that room's anchor, among the tombstone's peers, lies in an unnamed face of the same storey — it took
 * the tombstone's face when a later edit split the merged face again) comes back in its own face, and that room goes
 * back to the face its anchor was in (blk-bod west +0.2, "Ta tilbake" on w-bod-gavl/ghost and w-mellom-boder/ghost,
 * then on the edge ghost: «Bod (ny)» had taken Mellombygg's face and left its own unnamed; now 27 named rooms again).
 * Anchors that are not strictly inside their face go to its label point. `inFace` limits both to the faces it accepts
 * (state/editActions.ts: the faces the restore changed; last fix round, fifth review).
 */
export function reviveRoomRecords(
  v: Variant,
  derived: DerivedVariant,
  candidates: readonly (Room | RoomTombstone)[],
  inFace: (face: DerivedRoom) => boolean = () => true,
): RevivedRooms {
  const have = new Set(v.rooms.map((r) => r.id));
  const add: Room[] = [];
  const anchors = new Map<Id, Vec2>();
  const used = new Set<DerivedRoom>();
  const stones: RoomTombstone[] = candidates.map((c) => ('anchor' in c ? { room: c } : c));
  const placed = (c: Room, face: DerivedRoom): Room => (anchorInFace(c.anchor, face) ? plain(c) : { ...plain(c), anchor: copy(face.labelPoint) });
  for (const { room: c } of stones) {
    if (have.has(c.id) || add.some((r) => r.id === c.id)) continue;
    const storey = storeyOfLevel(v, c.levelId);
    const face = derived.rooms.find((f) => !f.room && !used.has(f) && f.storeyId === storey && inFace(f) && pointInPolygon(c.anchor, f.facePolygon));
    if (!face) continue;
    used.add(face);
    add.push(placed(c, face));
  }
  for (const { room: c, peers } of stones) {
    if (!peers || have.has(c.id) || add.some((r) => r.id === c.id)) continue;
    const storey = storeyOfLevel(v, c.levelId);
    const taken = derived.rooms.find((f) => f.room && !used.has(f) && f.storeyId === storey && inFace(f) && pointInPolygon(c.anchor, f.facePolygon));
    const holder = taken?.room;
    const was = holder ? peers.get(holder.id) : undefined;
    if (!taken || !holder || !was || anchors.has(holder.id) || pointInPolygon(was, taken.facePolygon)) continue;
    const back = derived.rooms.find((f) => !f.room && !used.has(f) && f.storeyId === storey && inFace(f) && pointInPolygon(was, f.facePolygon));
    if (!back) continue;
    used.add(taken);
    used.add(back);
    add.push(placed(c, taken));
    anchors.set(holder.id, anchorInFace(was, back) ? copy(was) : copy(back.labelPoint));
  }
  return { add, anchors };
}

/**
 * Give an unnamed face a Room record (anchor = the face's label point). Returns the new Room id — which is also the
 * derived room's id once named (deriveRooms ids a named face by its record); null when the face is unknown or
 * already named. state/editActions.ts `nameFace` returns both ids, checked against the derived result.
 */
export function applyNameFace(draft: Variant, derived: DerivedVariant, faceId: Id, name: string, opts: { type?: RoomType; levelId?: Id; id?: Id } = {}): Id | null {
  const face = derived.rooms.find((r) => r.id === faceId && !r.room);
  const trimmed = name.trim();
  if (!face || !trimmed) return null;
  const id = opts.id ?? newId('room');
  draft.rooms.push({ id, name: trimmed, type: opts.type ?? 'annet', levelId: opts.levelId ?? face.levelId, anchor: copy(face.labelPoint) });
  return id;
}

export interface RoomPatch {
  name?: string;
  /** A name that only says the old type (`typeOnlyName`) follows the new type unless `name` is given too. */
  type?: RoomType;
  /** null = back to the type's default. */
  floorMaterial?: FloorMaterial | null;
  /** '' removes the note. */
  note?: string;
}

/**
 * A room name that only says what kind of room it is: the word of its type or of its unit template's room («Bod»,
 * «Vedskjul», «Rom»), alone or numbered («Bod 2», «Soverom 1»). Such a name follows a type change (the plan label,
 * Egenskaper and Romskjema show the name, not the type: a placed Bod set to Soverom still read «Bod 2» everywhere);
 * a name the user wrote («Korridor (nedre)», «Ved», «Kontor») is kept.
 */
function typeOnlyName(draft: Variant, r: Room): boolean {
  const unit = r.unitId !== undefined ? draft.blocks.find((b) => b.id === r.unitId) : undefined;
  const words = [nb.roomTypes[r.type], unitTemplate(unit?.template)?.roomName];
  return words.some((w) => w !== undefined && (r.name === w || (r.name.startsWith(`${w} `) && /^\d+$/.test(r.name.slice(w.length + 1)))));
}

export function applySetRoomProps(draft: Variant, roomId: Id, patch: RoomPatch): boolean {
  const r = draft.rooms.find((x) => x.id === roomId);
  if (!r) return false;
  let changed = false;
  if (patch.name !== undefined && patch.name.trim() && patch.name.trim() !== r.name) {
    r.name = patch.name.trim();
    changed = true;
  }
  if (patch.type !== undefined && patch.type !== r.type) {
    const rename = patch.name === undefined && typeOnlyName(draft, r);
    r.type = patch.type;
    if (rename) r.name = uniqueName(nb.roomTypes[patch.type], draft.rooms.filter((x) => x.id !== r.id).map((x) => x.name));
    changed = true;
  }
  if (patch.floorMaterial !== undefined) {
    if (patch.floorMaterial === null) {
      if (r.floorMaterial !== undefined) {
        delete r.floorMaterial;
        changed = true;
      }
    } else if (patch.floorMaterial !== r.floorMaterial) {
      r.floorMaterial = patch.floorMaterial;
      changed = true;
    }
  }
  if (patch.note !== undefined) {
    const note = patch.note.trim();
    if (!note && r.note !== undefined) {
      delete r.note;
      changed = true;
    } else if (note && note !== r.note) {
      r.note = note;
      changed = true;
    }
  }
  return changed;
}

export interface ResizeTarget {
  side: 'min' | 'max';
  kind: 'wall' | 'blockEdge';
  /** Stored wall id (kind 'wall') or the derived exterior piece id (kind 'blockEdge'). */
  wallId: Id;
  blockId?: Id;
  edgeId?: Id;
}

/**
 * The walls that bound a room on each side of an axis (§3.7): 'w' → the walls along y at the west ('min') and east
 * ('max') of the face, 'd' → the walls along x at the south / north. Stored walls (dividers too) are preferred over
 * block edges on each side; `preferred` = the side to move: both stored → 'max' (north / east), one → that one,
 * none → null ("Endres under bygningsdelen").
 */
export function roomResizeTargets(
  derived: DerivedVariant,
  roomId: Id,
  axis: 'w' | 'd',
): { min: ResizeTarget | null; max: ResizeTarget | null; preferred: 'min' | 'max' | null } {
  const room = derived.rooms.find((r) => r.room?.id === roomId) ?? derived.rooms.find((r) => r.id === roomId);
  if (!room) return { min: null, max: null, preferred: null };
  const k = axis === 'w' ? 0 : 1; // coordinate that changes
  const o = 1 - k; // coordinate along the bounding walls
  const box = bbox(room.facePolygon.length >= 3 ? room.facePolygon : room.polygon);
  const pick = (side: 'min' | 'max'): ResizeTarget | null => {
    const coord = side === 'min' ? box.min[k] : box.max[k];
    let best: { w: DerivedWall; overlap: number; stored: boolean } | null = null;
    for (const id of room.wallIds) {
      const w = derived.walls.find((x) => x.id === id);
      if (!w || w.isGhost) continue;
      const d = sub(w.b, w.a);
      if (Math.abs(d[k]) > PARALLEL_SIN * len(d) + 1e-9) continue; // must run along the other axis
      if (Math.abs(w.a[k] - coord) > 0.02) continue;
      const lo = Math.max(Math.min(w.a[o], w.b[o]), box.min[o]);
      const hi = Math.min(Math.max(w.a[o], w.b[o]), box.max[o]);
      const overlap = hi - lo;
      if (overlap <= 0.01) continue;
      const stored = w.source.kind === 'wall';
      if (!best || (stored && !best.stored) || (stored === best.stored && overlap > best.overlap)) best = { w, overlap, stored };
    }
    if (!best) return null;
    if (best.w.source.kind === 'wall') return { side, kind: 'wall', wallId: best.w.source.wallId };
    return { side, kind: 'blockEdge', wallId: best.w.id, blockId: best.w.source.blockId, edgeId: best.w.source.edgeId };
  };
  const min = pick('min');
  const max = pick('max');
  const preferred = max?.kind === 'wall' ? 'max' : min?.kind === 'wall' ? 'min' : null;
  return { min, max, preferred };
}

/** The wall move (delta) that sets a room's inner width / depth to `value` on `side`, or why it cannot. */
export function roomResizeMove(
  derived: DerivedVariant,
  roomId: Id,
  axis: 'w' | 'd',
  value: number,
  side?: 'min' | 'max',
): { wallId: Id; delta: Vec2; side: 'min' | 'max' } | { refused: 'block-edge' | 'no-room' | 'no-wall' } {
  const room = derived.rooms.find((r) => r.room?.id === roomId) ?? derived.rooms.find((r) => r.id === roomId);
  if (!room) return { refused: 'no-room' };
  const targets = roomResizeTargets(derived, roomId, axis);
  const s = side ?? targets.preferred;
  if (!s) return { refused: targets.min || targets.max ? 'block-edge' : 'no-wall' };
  const t = targets[s];
  if (!t) return { refused: 'no-wall' };
  if (t.kind !== 'wall') return { refused: 'block-edge' };
  const current = axis === 'w' ? room.dims.w : room.dims.h;
  const change = value - current;
  const signed = s === 'max' ? change : -change;
  return { wallId: t.wallId, delta: axis === 'w' ? [signed, 0] : [0, signed], side: s };
}

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

export function deckOfEdge(v: Variant, edgeId: Id): Deck | null {
  return v.outdoor.decks.find((d) => d.polygon.some((x) => x.id === edgeId)) ?? null;
}

function validDeckPolygon(points: Vec2[]): boolean {
  return points.length >= 3 && Math.abs(signedArea(points)) >= MIN_DECK_AREA && !isSelfIntersecting(points);
}

/** Steps on changed deck edges keep their plan position (clamped to the edge). */
function keepStepsPositions(deck: Deck, oldPts: Vec2[]): void {
  const n = deck.polygon.length;
  if (oldPts.length !== n) return;
  for (const s of deck.steps) {
    const i = deck.polygon.findIndex((x) => x.id === s.edgeId);
    if (i < 0) continue;
    const oa = oldPts[i];
    const ob = oldPts[(i + 1) % n];
    const na = deck.polygon[i].p;
    const nb = deck.polygon[(i + 1) % n].p;
    if (samePoint(oa, na, TINY) && samePoint(ob, nb, TINY)) continue;
    const centre = pointAlong(oa, ob, s.offset);
    s.offset = clampOffset(along(na, nb, centre), s.width, 0, dist(na, nb));
  }
}

function setDeckPoints(draft: Variant, deckId: Id, next: Vec2[]): boolean {
  const deck = draft.outdoor.decks.find((d) => d.id === deckId);
  if (!deck || next.length !== deck.polygon.length || !validDeckPolygon(next)) return false;
  const old = deck.polygon.map((x) => copy(x.p));
  deck.polygon.forEach((x, i) => (x.p = copy(next[i])));
  keepStepsPositions(deck, old);
  return true;
}

export function applyMoveDeckVertex(draft: Variant, deckId: Id, vertexId: Id, p: Vec2): boolean {
  const deck = draft.outdoor.decks.find((d) => d.id === deckId);
  const i = deck ? deck.polygon.findIndex((x) => x.id === vertexId) : -1;
  if (!deck || i < 0 || samePoint(deck.polygon[i].p, p, TINY)) return false;
  return setDeckPoints(
    draft,
    deckId,
    deck.polygon.map((x, k) => (k === i ? copy(p) : copy(x.p))),
  );
}

export function applyMoveDeckEdge(draft: Variant, deckId: Id, edgeId: Id, delta: Vec2): boolean {
  const deck = draft.outdoor.decks.find((d) => d.id === deckId);
  const i = deck ? deck.polygon.findIndex((x) => x.id === edgeId) : -1;
  if (!deck || i < 0) return false;
  const pts = deck.polygon.map((x) => copy(x.p));
  const n = outwardNormal(pts, i);
  const shift = scale(n, dot(delta, n));
  if (len(shift) < TINY) return false;
  const j = (i + 1) % pts.length;
  const next = pts.map((p, k) => (k === i || k === j ? add(p, shift) : p));
  return setDeckPoints(draft, deckId, next);
}

/** Move a whole deck (and the hot tubs standing on it). */
export function applyMoveDeck(draft: Variant, deckId: Id, delta: Vec2): boolean {
  const deck = draft.outdoor.decks.find((d) => d.id === deckId);
  if (!deck || len(delta) < TINY) return false;
  const old = deck.polygon.map((x) => copy(x.p));
  for (const t of draft.outdoor.hotTubs) if (pointInPolygon(t.centre, old)) t.centre = addc(t.centre, delta);
  deck.polygon.forEach((x) => (x.p = addc(x.p, delta)));
  return true;
}

/** Insert a vertex on edge `edgeId` at p (default: the edge midpoint; projected on the edge). Returns its id. */
export function applyInsertDeckVertex(draft: Variant, deckId: Id, edgeId: Id, p?: Vec2, id?: Id): Id | null {
  const deck = draft.outdoor.decks.find((d) => d.id === deckId);
  const i = deck ? deck.polygon.findIndex((x) => x.id === edgeId) : -1;
  if (!deck || i < 0) return null;
  const n = deck.polygon.length;
  const a = deck.polygon[i].p;
  const b = deck.polygon[(i + 1) % n].p;
  const L = dist(a, b);
  if (L < 2 * MIN_WALL_LENGTH) return null;
  const s = Math.min(L - MIN_WALL_LENGTH, Math.max(MIN_WALL_LENGTH, p ? along(a, b, p) : L / 2));
  const at = pointAlong(a, b, s);
  const vid = id ?? newId('dv');
  deck.polygon.splice(i + 1, 0, { id: vid, p: at });
  for (const st of deck.steps) {
    if (st.edgeId !== edgeId || st.offset <= s) continue;
    st.edgeId = vid;
    st.offset -= s;
  }
  if (deck.noRailingEdges.includes(edgeId)) deck.noRailingEdges.push(vid);
  return vid;
}

/**
 * Delete a deck vertex (min 3 remain): the two edges merge into the previous one; their steps are re-hosted on it.
 * Refusals: false (unknown vertex, three corners left), 'self-intersecting' (the outline would cross itself or
 * become too small without the corner).
 */
export function applyDeleteDeckVertex(draft: Variant, deckId: Id, vertexId: Id): boolean | 'self-intersecting' {
  const deck = draft.outdoor.decks.find((d) => d.id === deckId);
  const i = deck ? deck.polygon.findIndex((x) => x.id === vertexId) : -1;
  if (!deck || i < 0 || deck.polygon.length <= 3) return false;
  const n = deck.polygon.length;
  const prev = deck.polygon[(i - 1 + n) % n];
  const pts = deck.polygon.map((x) => x.p);
  const next = pts.filter((_, k) => k !== i);
  if (!validDeckPolygon(next)) return 'self-intersecting';
  const oldEdges = new Map<Id, { a: Vec2; b: Vec2 }>([
    [prev.id, { a: copy(prev.p), b: copy(deck.polygon[i].p) }],
    [vertexId, { a: copy(deck.polygon[i].p), b: copy(deck.polygon[(i + 1) % n].p) }],
  ]);
  const mergedA = copy(prev.p);
  const mergedB = copy(deck.polygon[(i + 1) % n].p);
  deck.polygon.splice(i, 1);
  for (const st of deck.steps) {
    const e = oldEdges.get(st.edgeId);
    if (!e) continue;
    const centre = pointAlong(e.a, e.b, st.offset);
    st.edgeId = prev.id;
    st.offset = clampOffset(along(mergedA, mergedB, centre), st.width, 0, dist(mergedA, mergedB));
  }
  deck.noRailingEdges = deck.noRailingEdges.filter((id) => id !== vertexId);
  return true;
}

export interface DeckPatch {
  topHeight?: number;
  /** null = no railing. */
  railing?: Deck['railing'] | null;
  isNew?: boolean;
}

export function applySetDeckProps(draft: Variant, deckId: Id, patch: DeckPatch): boolean {
  const deck = draft.outdoor.decks.find((d) => d.id === deckId);
  if (!deck) return false;
  if (patch.topHeight !== undefined) deck.topHeight = patch.topHeight;
  if (patch.railing !== undefined) {
    if (patch.railing === null) delete deck.railing;
    else deck.railing = { ...(deck.railing ?? { style: 'glass', height: 1.05 }), ...plain(patch.railing) };
  }
  if (patch.isNew !== undefined) deck.isNew = patch.isNew;
  return true;
}

/** Railing on / off along one deck edge. */
export function applyToggleRailingEdge(draft: Variant, edgeId: Id): boolean {
  const deck = deckOfEdge(draft, edgeId);
  if (!deck) return false;
  if (deck.noRailingEdges.includes(edgeId)) deck.noRailingEdges = deck.noRailingEdges.filter((x) => x !== edgeId);
  else deck.noRailingEdges.push(edgeId);
  return true;
}

export const DEFAULT_STEPS_WIDTH = 1.4;

/**
 * New steps on deck edge `edgeId`: at `offset` (centre), else the middle of the longest free run of that edge, else the
 * edge middle; clamped to the edge.
 */
export function applyAddSteps(draft: Variant, derived: DerivedVariant | null, edgeId: Id, offset?: number, width = DEFAULT_STEPS_WIDTH, id?: Id): Id | null {
  const deck = deckOfEdge(draft, edgeId);
  const i = deck ? deck.polygon.findIndex((x) => x.id === edgeId) : -1;
  if (!deck || i < 0) return null;
  const a = deck.polygon[i].p;
  const b = deck.polygon[(i + 1) % deck.polygon.length].p;
  const L = dist(a, b);
  let at = offset;
  if (at === undefined) {
    const runs = derived?.outdoor.decks.find((d) => d.id === deck.id)?.freeRuns.filter((r) => r.edgeId === edgeId) ?? [];
    const longest = runs.reduce<{ s0: number; s1: number } | null>((m, r) => (!m || r.s1 - r.s0 > m.s1 - m.s0 ? r : m), null);
    at = longest ? (longest.s0 + longest.s1) / 2 : L / 2;
  }
  const steps: DeckSteps = { id: id ?? newId('steps'), edgeId, offset: clampOffset(at, width, 0, L), width };
  deck.steps.push(steps);
  return steps.id;
}

function stepsById(v: Variant, id: Id): { deck: Deck; steps: DeckSteps } | null {
  for (const deck of v.outdoor.decks) {
    const steps = deck.steps.find((s) => s.id === id);
    if (steps) return { deck, steps };
  }
  return null;
}

/** Move steps along their edge (or onto another edge of the same deck), clamped to the edge. */
export function applyMoveSteps(draft: Variant, stepsId: Id, offset: number, edgeId?: Id): boolean {
  const hit = stepsById(draft, stepsId);
  if (!hit) return false;
  const { deck, steps } = hit;
  const target = edgeId ?? steps.edgeId;
  const i = deck.polygon.findIndex((x) => x.id === target);
  if (i < 0) return false;
  const L = dist(deck.polygon[i].p, deck.polygon[(i + 1) % deck.polygon.length].p);
  const next = clampOffset(offset, steps.width, 0, L);
  if (target === steps.edgeId && Math.abs(next - steps.offset) < 1e-9) return false;
  steps.edgeId = target;
  steps.offset = next;
  return true;
}

export function applySetStepsProps(draft: Variant, stepsId: Id, patch: { width?: number }): boolean {
  const hit = stepsById(draft, stepsId);
  if (!hit || patch.width === undefined || !(patch.width > 0)) return false;
  hit.steps.width = patch.width;
  return true;
}

export function applyDeleteSteps(draft: Variant, stepsId: Id): boolean {
  const hit = stepsById(draft, stepsId);
  if (!hit) return false;
  hit.deck.steps = hit.deck.steps.filter((s) => s.id !== stepsId);
  return true;
}

// ---------------------------------------------------------------------------
// Furniture (phase 2b refines; simple bodies now)
// ---------------------------------------------------------------------------

/** A new furniture item (size from the caller, else the catalogue preset fallback of model/migrate.ts). */
export function applyAddFurniture(
  draft: Variant,
  item: { catalogId: string; position: Vec2; levelId: Id; size?: FurnitureItem['size']; rotationDeg?: number; sizeVariant?: string; colour?: string; id?: Id },
): Id {
  const f: FurnitureItem = {
    id: item.id ?? newId('f'),
    catalogId: item.catalogId,
    position: copy(item.position),
    rotationDeg: item.rotationDeg ?? 0,
    levelId: item.levelId,
    size: { ...(item.size ?? furnitureSizeFallback(item.catalogId, item.sizeVariant)) },
    isNew: true,
  };
  if (item.sizeVariant) f.sizeVariant = item.sizeVariant;
  if (item.colour) f.colour = item.colour;
  draft.furniture.push(f);
  return f.id;
}
