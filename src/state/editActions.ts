/**
 * Edit actions (docs/phase2-plan.md §3.6) and the drag protocol (§3.5), on a store (`createAppStore`): every function
 * takes the store first, e.g. `moveWall(store, id, delta)`; `useEditActions()` returns them bound to the app store
 * (`bindEditActions(store)` for any other store). The geometry lives in geometry/edit.ts and geometry/snap.ts.
 *
 * Every action
 *  1. is a no-op while `ui.readOnly`, and is REFUSED on a locked variant (`isLocked`, the bundled Forslag D) with the
 *     toast EDIT_STRINGS.locked and the "Nytt forslag" button (`action: 'newProposal'`) — nothing changes;
 *  2. computes `produce(base, recipe)` on the active variant (drags: on the pointer-down base), heals ghosts (anything
 *     back on its ghost is existing again), derives the result and runs `reconcileRooms` against the base's derived
 *     model (merges toast "«A» og «B» er nå ett rom («A»)." with [Angre]), and stores the result with
 *     `replaceVariant` — one undo step (drags and nudges: one per gesture / run);
 *  3. returns the new id for creations, true / false (changed or not) otherwise; null when refused.
 * Deletes toast "Slettet." with [Angre]. Trees belong to the proposal: `addTree` / `moveTree` / `deleteTree` (and
 * tree drags / nudges) copy the site's trees into `Variant.trees` on the first tree edit (copy-on-write) and edit
 * that copy; the site and Forslag D never change (`treesOf(project, variant)` reads them).
 *
 * Drag protocol (plan2d → actions): `beginDrag(store, selection, pointer, handle?, opts?)` starts a transaction from
 * the current project and returns a `DragSession` (null when nothing is draggable: rooms, railings, structure,
 * ghosts; refused on the locked variant and for whole blocks with existing area). `updateDrag(store, session,
 * pointer, modifiers)` applies the move FROM THE BASE (so every update is exact and reversible) with snapping and
 * returns `{ indicators, chips, ghost }` (ghost = the base outline of the dragged element). `endDrag` commits (one
 * undo step, merge toasts); `cancelDrag` restores the base. Handles: 'a' / 'b' = a stored wall's endpoint, 'start' /
 * 'end' = an opening's jamb (resize), 'insert' on a deck edge = the "+" midpoint handle (inserts a vertex at the pointer
 * and drags it, one undo step). Kinds: wall (perpendicular move with line snapping; a wall with two free ends
 * moves freely), wallEndpoint, blockEdge, blockVertex, block, opening (re-hosted onto another wall / edge within the
 * snap radius, min 0.25 m, of the pointer), openingResize, deckVertex, deckEdge, deck, steps (along their edge),
 * hotTub (touches deck edges), tree, furniture (back to wall). Opening and outdoor drags (opening, openingResize,
 * deck*, steps, hotTub, tree, furniture) cannot change a room face: their frames skip the room reconciliation and
 * its derive (the plan's render derives the stored result once).
 * `snapPoint(store, p, opts)` serves the placement tools (Vegg / Mål with `from`, Dør/vindu → the host under the
 * point, Nytt bygg → the snapped unit centre with its footprint as `ghost`, Møbler → grid).
 *
 * Where the plan is silent: `insertDeckVertex` takes (edgeId, p) or (deckId, edgeId, p) (the two UI sides use
 * both); `resizeRoom` returns the refusal ('block-edge' → "Endres under bygningsdelen", also as a toast); `nudge` of a
 * wall moves it across itself like a drag; `restoreGhost` also brings back Room records deleted earlier in this
 * session (found in the undo history) whose anchor lies in a face that is unnamed after the restore, and for a wall
 * that is not just its ghost translated (an endpoint drag) it first drags each end back with the endpoint cascades
 * (leaving alone the existing walls the forward step did not touch: no ghost); after a wall restore it also drags back
 * the ends of neighbours the forward step left just beside the wall's line (`neighbourEnds`: their ghost end is on the
 * restored ghost, their live end within 5 cm of the moved wall or on the line it was moved to);
 * `moveBlock` / a whole-block drag of a block with existing area is refused like `deleteBlock`; `rotateBlock(store,
 * id, 90 | −90)` turns a placed unit (template blocks only; one standing against a wall or a deck edge keeps that
 * contact, geometry/edit.ts `contactTurn`); `nameFace` returns the derived room id to select;
 * `deleteDeckVertex` toasts EDIT_STRINGS.deckVertexCrosses when the outline would cross itself.
 */
import { current, isDraft, produce } from 'immer';
import { useMemo } from 'react';
import { deriveVariant, treesOf } from '../geometry/derive';
import {
  applyAddFurniture,
  applyAddOpening,
  applyAddSteps,
  applyAddWall,
  applyDeleteBlock,
  applyDeleteDeckVertex,
  applyDeleteOpening,
  applyDeleteSteps,
  applyDeleteWall,
  applyDuplicateBlock,
  applyInsertDeckVertex,
  applyMoveBlock,
  applyMoveBlockEdge,
  applyMoveBlockVertex,
  applyMoveDeck,
  applyMoveDeckEdge,
  applyMoveDeckVertex,
  applyMoveOpening,
  applyMoveSteps,
  applyMoveWall,
  applyMoveWallEndpoint,
  applyNameFace,
  applyPlaceUnit,
  applyRestoreEdgeGhost,
  applyRestoreOpening,
  applyRestoreWall,
  applyRotateBlock,
  applySetBlockProps,
  applySetBlockSize,
  applySetDeckProps,
  applySetOpeningProps,
  applySetRoomProps,
  applySetStepsProps,
  applySetWallProps,
  applySplitWall,
  applyToggleRailingEdge,
  blockHasExistingArea,
  deckOfEdge,
  ghostRef,
  healGhosts,
  hostLine,
  isLocked,
  pieceRange,
  reconcileRooms,
  reviveRooms,
  roomResizeMove,
  wallEndsFree,
} from '../geometry/edit';
import type { BlockPatch, DeckPatch, EditContext, OpeningPatch, PlanTransform, RoomMerge, RoomPatch, WallPatch } from '../geometry/edit';
import { levelAt } from '../geometry/levels';
import { buildSnapContext, chipsAcross, gridStep, rayToWall, roundTo, snap, snapCircle, snapFootprint, snapLineOffset, snapPolygon } from '../geometry/snap';
import type { DimensionChip, SnapContext, SnapIndicator, SnapResult } from '../geometry/snap';
import { distancePointSegment } from '../geometry/polygon';
import type { DerivedVariant } from '../model/derived';
import type { FurnitureItem, Id, OpeningHost, OpeningType, Project, Room, RoomType, Site, Tree, Variant, Vec2, Wall } from '../model/types';
import { unitFootprint, unitTemplate } from '../model/unitTemplates';
import { appStore } from './appStore';
import { EDIT_STRINGS } from './editStrings';
import type { Selection } from './selection';
import { selectActiveVariant } from './store';
import type { AppStore } from './store';
import { terrainFor } from './useDerived';

/** The part of the store the actions use. */
export type EditStore = Pick<AppStore, 'getState'>;

/** Snap radius (m) when the caller gives none (12 px at ~80 px/m). */
export const DEFAULT_SNAP_RADIUS = 0.15;
/** An opening dragged farther than this (m, or the snap radius if larger) from its host looks for another host. */
const REHOST_DISTANCE = 0.25;
/** Narrowest opening the end handles leave (m). */
const MIN_OPENING_WIDTH = 0.3;

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a: Vec2): Vec2 => {
  const l = Math.hypot(a[0], a[1]);
  return l < 1e-12 ? [1, 0] : [a[0] / l, a[1] / l];
};
const leftNormal = (u: Vec2): Vec2 => [-u[1], u[0]];
const copy = (p: Vec2): Vec2 => [p[0], p[1]];

// ---------------------------------------------------------------------------
// Core: derive, toasts, run
// ---------------------------------------------------------------------------

function deriveOf(site: Site, variant: Variant): DerivedVariant | null {
  try {
    return deriveVariant(variant, site, terrainFor(site));
  } catch {
    return null;
  }
}

function lockedToast(store: EditStore): void {
  store.getState().showToast({ text: EDIT_STRINGS.locked, action: 'newProposal' });
}

function deletedToast(store: EditStore): void {
  store.getState().showToast({ text: EDIT_STRINGS.deleted, undo: true });
}

function mergeToasts(store: EditStore, merges: RoomMerge[]): void {
  for (const m of merges) store.getState().showToast({ text: EDIT_STRINGS.merged(m.kept.name, m.removed.name), undo: true });
}

/** Editable active variant, or null (read-only: silently; locked: with the toast). */
function editable(store: EditStore): Variant | null {
  const s = store.getState();
  if (s.ui.readOnly) return null;
  const v = selectActiveVariant(s);
  if (isLocked(v)) {
    lockedToast(store);
    return null;
  }
  return v;
}

interface RunOpts {
  transaction?: string;
  /** Drags: the pointer-down variant and its derived model. */
  base?: Variant;
  baseDerived?: DerivedVariant;
  /**
   * Apply the recipe to this variant (and context) instead of the base — an intermediate state computed by earlier
   * steps of the same action (restoreGhost's endpoint cascade); the rooms are still reconciled against the base.
   */
  from?: { variant: Variant; derived: DerivedVariant };
  /** Toast room merges right away (default true; drags toast on endDrag). */
  toastMerges?: boolean;
  /**
   * Reconcile the rooms (default true). Off for edits that cannot change a room face (openings, the deck, steps, hot
   * tubs, trees, furniture): no derive of the result and no matching inside the action.
   */
  reconcile?: boolean;
  /** Deleted Room records that may come back into unnamed faces (restoreGhost). */
  revive?: () => Room[];
}

interface RunResult<R> {
  result: R;
  merges: RoomMerge[];
  variant: Variant;
}

/** One edit of the active variant (see the header). Null when read-only or locked. */
function run<R>(store: EditStore, recipe: (draft: Variant, ctx: EditContext) => R, opts: RunOpts = {}): RunResult<R> | null {
  const current = editable(store);
  if (!current) return null;
  const site = store.getState().project.site;
  const base = opts.base ?? current;
  const derived = opts.baseDerived ?? deriveOf(site, base);
  if (!derived) return null;
  const from = opts.from ?? { variant: base, derived };
  const carried = new Map<Id, PlanTransform>();
  let result: R | undefined;
  const next = produce(from.variant, (draft) => {
    result = recipe(draft as Variant, { base: from.variant, derived: from.derived, carried });
    // Anything back on its ghost is existing again (geometry/edit.ts healGhosts).
    healGhosts(draft as Variant);
  });
  let final = next;
  let merges: RoomMerge[] = [];
  if (next !== base && opts.reconcile !== false) {
    const nextDerived = deriveOf(site, next);
    if (nextDerived) {
      const rec = reconcileRooms(derived, next, nextDerived, { carried });
      merges = rec.merges;
      if (rec.changed) {
        final = produce(next, (d) => {
          d.rooms = rec.rooms as Room[];
        });
      }
      if (opts.revive) {
        const fd = deriveOf(site, final);
        const back = fd ? reviveRooms(final, fd, opts.revive()) : [];
        if (back.length > 0) {
          final = produce(final, (d) => {
            d.rooms.push(...back);
          });
        }
      }
    }
  }
  if (final !== current) store.getState().replaceVariant(current.id, final, { transaction: opts.transaction });
  if (opts.toastMerges !== false) mergeToasts(store, merges);
  return { result: result as R, merges, variant: final };
}

/**
 * The trees of the variant being edited, copied from the site on the first tree edit of a proposal (copy-on-write,
 * `Variant.trees`): a proposal's trees are its own, the site (and Forslag D) never change.
 */
function ownTrees(draft: Variant, site: Site): Tree[] {
  if (!draft.trees) draft.trees = site.trees.map((t) => ({ ...t, position: copy(t.position) }));
  return draft.trees;
}

/** Current derived model of the active variant. */
function currentDerived(store: EditStore): DerivedVariant | null {
  const s = store.getState();
  return deriveOf(s.project.site, selectActiveVariant(s));
}

const changed = <R>(r: RunResult<R> | null, ok: (x: R) => boolean = (x) => x !== false && x !== null): boolean => r !== null && ok(r.result);

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

/** New stored wall a → b (levelId default: the floor at its midpoint on the plan storey). Returns its id. */
export function addWall(store: EditStore, a: Vec2, b: Vec2, levelId?: Id): Id | null {
  const s = store.getState();
  const storeyId = s.ui.planStorey;
  const r = run(store, (d, ctx) => applyAddWall(d, a, b, levelId ?? levelAt(ctx.derived, storeyId, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])));
  return r?.result ?? null;
}

export function moveWall(store: EditStore, wallId: Id, delta: Vec2, opts: { transaction?: string } = {}): boolean {
  return changed(run(store, (d, ctx) => applyMoveWall(d, ctx, wallId, delta), opts));
}

export function moveWallEndpoint(store: EditStore, wallId: Id, end: 'a' | 'b', p: Vec2): boolean {
  return changed(run(store, (d, ctx) => applyMoveWallEndpoint(d, ctx, wallId, end, p)));
}

/** Split at t ∈ (0, 1) along a→b; returns the second half's id. */
export function splitWall(store: EditStore, wallId: Id, t: number): Id | null {
  return run(store, (d) => applySplitWall(d, wallId, t))?.result ?? null;
}

export function deleteWall(store: EditStore, wallId: Id): boolean {
  const ok = changed(run(store, (d) => applyDeleteWall(d, wallId)));
  if (ok) deletedToast(store);
  return ok;
}

export function setWallProps(store: EditStore, wallId: Id, patch: WallPatch): boolean {
  return changed(run(store, (d) => applySetWallProps(d, wallId, patch)));
}

/** Deleted Room records of the active variant found in the undo history, newest first. */
function roomsFromHistory(store: EditStore): Room[] {
  const s = store.getState();
  const v = selectActiveVariant(s);
  const have = new Set(v.rooms.map((r) => r.id));
  const seen = new Set<Id>();
  const out: Room[] = [];
  const past = s.history().past;
  for (let i = past.length - 1; i >= 0; i--) {
    const pv = past[i].variants.find((x) => x.id === v.id);
    for (const r of pv?.rooms ?? []) {
      if (have.has(r.id) || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

/**
 * "Ta tilbake" on a ghost (a removed wall / opening id or a `Variant.ghosts` id): see geometry/edit.ts. A moved wall
 * is first moved back with the wall cascades; a block edge is moved back onto its ghost line. Rooms deleted by a merge
 * come back from the undo history when their face reappears. An opening ghost that stands on a removed wall (a moved
 * or deleted wall's ghost, a moved block edge's old place) cannot come back alone: its wall / edge is restored with it.
 */
export function restoreGhost(store: EditStore, id: Id): boolean {
  const s = store.getState();
  const v = selectActiveVariant(s);
  const ref = ghostRef(v, id);
  if (!ref) return false;
  if (ref.type === 'opening') {
    const g = v.openings.find((o) => o.id === id);
    const hostId = g?.host.kind === 'wall' ? g.host.wallId : null;
    if (hostId && hostId !== id && v.walls.some((w) => w.id === hostId && w.status === 'removed')) return restoreGhost(store, hostId);
  }
  let parallelSame = false;
  let from: RunOpts['from'];
  let neighbours: NeighbourEnd[] = [];
  // Opening ghosts parked on removed walls (the ghost being restored, or the ghosts of walls a cascade touched): restored
  // when their host goes (the endpoint cascade back may already have healed the wall itself).
  const parked = new Map<Id, Id>();
  for (const o of v.openings) {
    if (o.status !== 'removed' || o.host.kind !== 'wall' || !o.id.endsWith('/ghost')) continue;
    const hostId = o.host.wallId;
    if (v.walls.some((w) => w.id === hostId && w.status === 'removed')) parked.set(o.id, hostId);
  }
  if (ref.type === 'wall' && !isLocked(v) && !s.ui.readOnly) {
    const g = v.walls.find((w) => w.id === id);
    const live = ref.original ? v.walls.find((w) => w.id === ref.original && w.status !== 'removed') : undefined;
    if (g && live) {
      const ud = unit(sub(live.b, live.a));
      const ug = unit(sub(g.b, g.a));
      parallelSame = Math.abs(dot(ud, ug) - 1) < 1e-6 && Math.abs(dist(live.a, live.b) - dist(g.a, g.b)) < 1e-6;
      // Not just translated (an endpoint drag, or a move and an endpoint drag): drag each end back to the ghost's
      // end with the endpoint cascades (coincident ends, T-junctions), one end after the other.
      if (!parallelSame) from = endpointsBack(s.project.site, v, live.id, g);
      neighbours = neighbourEnds(v, live, g);
    }
  }
  const r = run(
    store,
    (d, ctx) => {
      if (ref.type === 'wall') {
        if (parallelSame && ref.original) {
          const g = ctx.base.walls.find((w) => w.id === id);
          const live = ctx.base.walls.find((w) => w.id === ref.original);
          if (g && live) applyMoveWall(d, ctx, live.id, sub(g.a, live.a));
        }
        const had = d.walls.some((w) => w.id === id && w.status === 'removed');
        const ok = applyRestoreWall(d, id);
        healGhosts(d);
        // Neighbours the forward step left just off the wall's line: their ends back onto the junction too.
        bringBackNeighbours(d, s.project.site, neighbours);
        // Openings the cascade moved on the walls it touched (their ghosts sat on those walls' ghosts): back too.
        for (const [oid, hostId] of parked) if (!d.walls.some((w) => w.id === hostId)) applyRestoreOpening(d, oid);
        healGhosts(d);
        // The cascade back (endpoints, or the move with its clamped openings pulled back) may already have healed the
        // ghost: the wall is back on it.
        return ok || (!had && (from !== undefined || parallelSame));
      }
      if (ref.type === 'opening') {
        const ok = applyRestoreOpening(d, id);
        healGhosts(d);
        return ok;
      }
      return applyRestoreEdgeGhost(d, ctx, id);
    },
    { revive: () => roomsFromHistory(store), from },
  );
  return changed(r);
}

/** A neighbour's end that "Ta tilbake" drags back onto its ghost's end (see neighbourEnds). */
interface NeighbourEnd {
  wallId: Id;
  end: 'a' | 'b';
  to: Vec2;
}

/** How near (m) the moved wall's live line a neighbour's end must be to count as carried by it. */
const NEIGHBOUR_REACH = 0.05;

/**
 * The ends of OTHER walls that the forward step of the moved wall `live` (ghost `g`) carried and that its cascades
 * back would not catch: walls with their own ghost whose ghost end lies on `g` (the junction the restored wall
 * returns to) while their live end is elsewhere, within 5 cm of `live`. (A free node's followers end on the nominal
 * moved line; when the wall's other end was clamped by its support the wall itself turned a little, so they end ~1–3
 * cm beside it — neither coincident nor on it: w-104-103 after w-103-korr −0.2, w-104-diag after w-105-diag +0.2.)
 */
function neighbourEnds(v: Variant, live: Wall, g: Wall): NeighbourEnd[] {
  const out: NeighbourEnd[] = [];
  for (const w of v.walls) {
    if (w.id === live.id || w.status === 'removed') continue;
    const wg = v.walls.find((x) => x.id === `${w.id}/ghost` && x.status === 'removed');
    if (!wg) continue;
    for (const end of ['a', 'b'] as const) {
      if (dist(w[end], wg[end]) < 1e-9) continue;
      if (distancePointSegment(wg[end], g.a, g.b) > 0.01) continue;
      if (distancePointSegment(w[end], live.a, live.b) > NEIGHBOUR_REACH && !onNominalLine(w[end], live, g)) continue;
      out.push({ wallId: w.id, end, to: copy(wg[end]) });
    }
  }
  return out;
}

/**
 * Whether p lies on the line the forward step moved the wall to (the ghost's direction through one of the live ends,
 * within 1 cm), within the live wall's span: where a free node's followers end when the wall turned.
 */
function onNominalLine(p: Vec2, live: Wall, g: Wall): boolean {
  const u = unit(sub(g.b, g.a));
  const n = leftNormal(u);
  const tb = dot(sub(live.b, live.a), u);
  const t = dot(sub(p, live.a), u);
  if (t < Math.min(0, tb) - 0.01 || t > Math.max(0, tb) + 0.01) return false;
  return (['a', 'b'] as const).some((e) => Math.abs(dot(sub(p, live[e]), n)) <= 0.01);
}

/** Existing walls without a ghost: the forward step did not touch them, so a drag back must not either. */
function untouched(v: Variant): Set<Id> {
  const ghosts = new Set(v.walls.filter((w) => w.status === 'removed').map((w) => w.id));
  return new Set(v.walls.filter((w) => w.status === 'existing' && !ghosts.has(`${w.id}/ghost`)).map((w) => w.id));
}

/** Drag each neighbour end (that is not back yet) to its ghost end with the endpoint cascades, then heal. */
function bringBackNeighbours(d: Variant, site: Site, neighbours: NeighbourEnd[]): void {
  for (const n of neighbours) {
    const w = d.walls.find((x) => x.id === n.wallId && x.status !== 'removed');
    if (!w || dist(w[n.end], n.to) < 1e-9) continue;
    const base = isDraft(d) ? current(d) : (JSON.parse(JSON.stringify(d)) as Variant);
    const derived = deriveOf(site, base);
    if (!derived) continue;
    applyMoveWallEndpoint(d, { base, derived }, n.wallId, n.end, n.to, { keep: untouched(base) });
    healGhosts(d);
  }
}

/**
 * The variant with the ends of `wallId` dragged back to the ends of its ghost `g` (applyMoveWallEndpoint with its
 * cascades, each end from the state after the other one), and its derived model; undefined when nothing moved.
 */
function endpointsBack(site: Site, v: Variant, wallId: Id, g: Wall): RunOpts['from'] {
  let cur = v;
  let curDerived = deriveOf(site, cur);
  for (const end of ['a', 'b'] as const) {
    const w = cur.walls.find((x) => x.id === wallId);
    if (!w || !curDerived || dist(w[end], g[end]) < 1e-9) continue;
    const ctx: EditContext = { base: cur, derived: curDerived };
    const keep = untouched(cur);
    const next = produce(cur, (d) => {
      applyMoveWallEndpoint(d as Variant, ctx, wallId, end, g[end], { keep });
      healGhosts(d as Variant);
    });
    if (next === cur) continue;
    cur = next;
    curDerived = deriveOf(site, cur);
  }
  return cur !== v && curDerived ? { variant: cur, derived: curDerived } : undefined;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export function moveBlockEdge(store: EditStore, blockId: Id, edgeId: Id, delta: Vec2, opts: { transaction?: string } = {}): boolean {
  return changed(run(store, (d, ctx) => applyMoveBlockEdge(d, ctx, blockId, edgeId, delta), opts));
}

export function moveBlockVertex(store: EditStore, blockId: Id, vertexId: Id, p: Vec2, opts: { transaction?: string } = {}): boolean {
  return changed(run(store, (d, ctx) => applyMoveBlockVertex(d, ctx, blockId, vertexId, p), opts));
}

/** Move a whole block; refused (toast) for a block with existing area. */
export function moveBlock(store: EditStore, blockId: Id, delta: Vec2, opts: { transaction?: string } = {}): boolean {
  const v = editable(store);
  if (!v) return false;
  const block = v.blocks.find((b) => b.id === blockId);
  if (block && blockHasExistingArea(block)) {
    store.getState().showToast({ text: EDIT_STRINGS.existingBlockMove });
    return false;
  }
  return changed(run(store, (d, ctx) => applyMoveBlock(d, ctx, blockId, delta), opts), (x) => x === true);
}

/**
 * Turn a placed unit (a block with a template) a quarter turn about its centre: 90 = counter-clockwise, −90 =
 * clockwise; snapped to the 0.1 m grid; its walls, openings, rooms and furniture turn with it (geometry/edit.ts
 * applyRotateBlock). Refused with the toast for a block with existing area (like moveBlock); false for a drawn block
 * without a template and (with the locked toast) on Forslag D. (270 is taken as −90; other angles do nothing.)
 */
export function rotateBlock(store: EditStore, blockId: Id, deg: 90 | -90): boolean {
  const q = ((Math.round(deg / 90) % 4) + 4) % 4;
  if (q !== 1 && q !== 3) return false;
  const v = editable(store);
  if (!v) return false;
  const block = v.blocks.find((b) => b.id === blockId);
  if (!block) return false;
  if (blockHasExistingArea(block)) {
    store.getState().showToast({ text: EDIT_STRINGS.existingBlockMove });
    return false;
  }
  if (!block.template) return false;
  return changed(run(store, (d, ctx) => applyRotateBlock(d, ctx, blockId, q === 1 ? 90 : -90)), (x) => x === true);
}

/** Place a unit from a template, centred on `at`, turned by `rotation90` quarter turns. Returns the new block id. */
export function placeUnit(store: EditStore, templateId: string, at: Vec2, rotation90 = 0): Id | null {
  const r = run(store, (d, ctx) => applyPlaceUnit(d, ctx, templateId, at, rotation90));
  return r?.result?.blockId ?? null;
}

/** Delete a block; refused (toast) for a block with existing area. */
export function deleteBlock(store: EditStore, blockId: Id): boolean {
  const v = editable(store);
  if (!v) return false;
  const block = v.blocks.find((b) => b.id === blockId);
  if (!block) return false;
  if (blockHasExistingArea(block)) {
    store.getState().showToast({ text: EDIT_STRINGS.existingBlockDelete });
    return false;
  }
  const ok = changed(run(store, (d) => applyDeleteBlock(d, blockId)), (x) => x === true);
  if (ok) deletedToast(store);
  return ok;
}

export function setBlockProps(store: EditStore, blockId: Id, patch: BlockPatch): boolean {
  return changed(run(store, (d) => applySetBlockProps(d, blockId, patch)));
}

/** Bredde / Dybde of a block: moves the east / north edge (`side` 'max', default) or the west / south one. */
export function setBlockSize(store: EditStore, blockId: Id, axis: 'w' | 'd', value: number, side: 'min' | 'max' = 'max'): boolean {
  return changed(run(store, (d, ctx) => applySetBlockSize(d, ctx, blockId, axis, value, side)));
}

/** Copy a block (and what stands in it) `delta` away (default 1 m east and 1 m north); returns the copy's id. */
export function duplicateBlock(store: EditStore, blockId: Id, delta: Vec2 = [1, 1]): Id | null {
  return run(store, (d) => applyDuplicateBlock(d, blockId, delta))?.result ?? null;
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

export function addOpening(store: EditStore, host: OpeningHost, offset: number, type: OpeningType): Id | null {
  return run(store, (d, ctx) => applyAddOpening(d, ctx, host, offset, type))?.result ?? null;
}

/** `offset` along the stored host (block edge from its start vertex, wall from a) to the centre; optional new host. */
export function moveOpening(store: EditStore, openingId: Id, offset: number, host?: OpeningHost, opts: { transaction?: string } = {}): boolean {
  return changed(run(store, (d, ctx) => applyMoveOpening(d, ctx, openingId, offset, host), opts));
}

export function setOpeningProps(store: EditStore, openingId: Id, patch: OpeningPatch): boolean {
  return changed(run(store, (d) => applySetOpeningProps(d, openingId, patch)));
}

export function deleteOpening(store: EditStore, openingId: Id): boolean {
  const ok = changed(run(store, (d) => applyDeleteOpening(d, openingId)));
  if (ok) deletedToast(store);
  return ok;
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

/**
 * Name an unnamed face (a derived room id `face-…`). Returns the id of the DERIVED room that now shows the name —
 * what the UI selects (`{ kind: 'room', id }`) after "Gi navn" (the old `face-…` id is gone). A named face's derived
 * id is its Room record's id, so this is the new Room id whenever the record attached to its face (it does: its
 * anchor is the face's label point); it is looked up in the derived result to be sure. Null when refused or the face
 * is unknown / already named.
 */
export function nameFace(store: EditStore, faceId: Id, name: string, opts: { type?: RoomType; levelId?: Id } = {}): Id | null {
  const r = run(store, (d, ctx) => applyNameFace(d, ctx.derived, faceId, name, opts));
  const roomId = r?.result ?? null;
  if (!r || !roomId) return null;
  const derived = deriveOf(store.getState().project.site, r.variant);
  const record = r.variant.rooms.find((x) => x.id === roomId);
  const room =
    derived?.rooms.find((x) => x.room?.id === roomId) ??
    (record ? derived?.rooms.find((x) => x.levelId === record.levelId && dist(record.anchor, x.labelPoint) < 1e-9) : undefined);
  return room?.id ?? roomId;
}

export function setRoomProps(store: EditStore, roomId: Id, patch: RoomPatch): boolean {
  return changed(run(store, (d) => applySetRoomProps(d, roomId, patch)));
}

/** Delete a Room record (its face becomes unnamed). */
export function deleteRoom(store: EditStore, roomId: Id): boolean {
  const ok = changed(
    run(store, (d) => {
      const i = d.rooms.findIndex((r) => r.id === roomId);
      if (i < 0) return false;
      d.rooms.splice(i, 1);
      return true;
    }),
  );
  if (ok) deletedToast(store);
  return ok;
}

export type ResizeRoomResult = { ok: true; wallId: Id; side: 'min' | 'max' } | { ok: false; reason: 'block-edge' | 'no-room' | 'no-wall' | 'refused' };

/**
 * §3.7: set a room's inner width ('w', along x) or depth ('d', along y) to `value` by moving the bounding stored wall
 * on `side` ('min' = west / south, 'max' = east / north; default: the preferred side, see `roomResizeTargets`).
 * A side with only block edges is refused ('block-edge': "Endres under bygningsdelen", also toasted).
 */
export function resizeRoom(store: EditStore, roomId: Id, axis: 'w' | 'd', value: number, side?: 'min' | 'max'): ResizeRoomResult {
  if (!editable(store)) return { ok: false, reason: 'refused' };
  const derived = currentDerived(store);
  if (!derived) return { ok: false, reason: 'no-room' };
  const move = roomResizeMove(derived, roomId, axis, value, side);
  if ('refused' in move) {
    if (move.refused === 'block-edge') store.getState().showToast({ text: EDIT_STRINGS.resizeBlockEdge });
    return { ok: false, reason: move.refused };
  }
  const ok = moveWall(store, move.wallId, move.delta);
  return ok ? { ok: true, wallId: move.wallId, side: move.side } : { ok: false, reason: 'no-wall' };
}

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

function deckIdOf(v: Variant, vertexOrEdgeId: Id): Id | null {
  return deckOfEdge(v, vertexOrEdgeId)?.id ?? null;
}

export function moveDeckVertex(store: EditStore, vertexId: Id, p: Vec2, opts: { transaction?: string } = {}): boolean {
  return changed(
    run(
      store,
      (d) => {
        const deckId = deckIdOf(d, vertexId);
        return deckId ? applyMoveDeckVertex(d, deckId, vertexId, p) : false;
      },
      opts,
    ),
  );
}

export function moveDeckEdge(store: EditStore, edgeId: Id, delta: Vec2, opts: { transaction?: string } = {}): boolean {
  return changed(
    run(
      store,
      (d) => {
        const deckId = deckIdOf(d, edgeId);
        return deckId ? applyMoveDeckEdge(d, deckId, edgeId, delta) : false;
      },
      opts,
    ),
  );
}

export function moveDeck(store: EditStore, deckId: Id, delta: Vec2, opts: { transaction?: string } = {}): boolean {
  return changed(run(store, (d) => applyMoveDeck(d, deckId, delta), opts));
}

/** Insert a deck vertex on an edge: (edgeId, p?) or (deckId, edgeId, p?). Returns the new vertex id. */
export function insertDeckVertex(store: EditStore, first: Id, second?: Id | Vec2, third?: Vec2): Id | null {
  const edgeId = typeof second === 'string' ? second : first;
  const p = typeof second === 'string' ? third : second;
  return (
    run(store, (d) => {
      const deckId = deckIdOf(d, edgeId);
      return deckId ? applyInsertDeckVertex(d, deckId, edgeId, p) : null;
    })?.result ?? null
  );
}

/**
 * "Fjern hjørne": refused with a toast when the deck has three corners (EDIT_STRINGS.deckMinVertices) or when the
 * outline without the corner would cross itself (EDIT_STRINGS.deckVertexCrosses).
 */
export function deleteDeckVertex(store: EditStore, vertexId: Id): boolean {
  const v = editable(store);
  if (!v) return false;
  const deck = deckOfEdge(v, vertexId);
  if (!deck) return false;
  if (deck.polygon.length <= 3) {
    store.getState().showToast({ text: EDIT_STRINGS.deckMinVertices });
    return false;
  }
  const r = run(store, (d) => applyDeleteDeckVertex(d, deck.id, vertexId));
  if (r?.result === 'self-intersecting') {
    store.getState().showToast({ text: EDIT_STRINGS.deckVertexCrosses });
    return false;
  }
  const ok = changed(r, (x) => x === true);
  if (ok) deletedToast(store);
  return ok;
}

export function setDeckProps(store: EditStore, deckId: Id, patch: DeckPatch): boolean {
  return changed(run(store, (d) => applySetDeckProps(d, deckId, patch)));
}

export function toggleRailingEdge(store: EditStore, edgeId: Id): boolean {
  return changed(run(store, (d) => applyToggleRailingEdge(d, edgeId)));
}

/** "Legg til trapp" on a deck edge (offset of the centre from the edge start; default: the longest free run's middle). */
export function addSteps(store: EditStore, edgeId: Id, offset?: number, width?: number): Id | null {
  return run(store, (d, ctx) => applyAddSteps(d, ctx.derived, edgeId, offset, width))?.result ?? null;
}

export function moveSteps(store: EditStore, stepsId: Id, offset: number, edgeId?: Id, opts: { transaction?: string } = {}): boolean {
  return changed(run(store, (d) => applyMoveSteps(d, stepsId, offset, edgeId), opts));
}

export function setStepsProps(store: EditStore, stepsId: Id, patch: { width?: number }): boolean {
  return changed(run(store, (d) => applySetStepsProps(d, stepsId, patch)));
}

export function deleteSteps(store: EditStore, stepsId: Id): boolean {
  const ok = changed(run(store, (d) => applyDeleteSteps(d, stepsId)));
  if (ok) deletedToast(store);
  return ok;
}

// ---------------------------------------------------------------------------
// Other: hot tub, trees, notes
// ---------------------------------------------------------------------------

export function moveHotTub(store: EditStore, hotTubId: Id, p: Vec2, opts: { transaction?: string } = {}): boolean {
  return changed(
    run(
      store,
      (d) => {
        const t = d.outdoor.hotTubs.find((x) => x.id === hotTubId);
        if (!t || dist(t.centre, p) < 1e-9) return false;
        t.centre = copy(p);
        return true;
      },
      opts,
    ),
  );
}

export function setHotTubDiameter(store: EditStore, hotTubId: Id, diameter: number): boolean {
  if (!(diameter > 0)) return false;
  return changed(
    run(store, (d) => {
      const t = d.outdoor.hotTubs.find((x) => x.id === hotTubId);
      if (!t || t.diameter === diameter) return false;
      t.diameter = diameter;
      return true;
    }),
  );
}

export function deleteHotTub(store: EditStore, hotTubId: Id): boolean {
  const ok = changed(
    run(store, (d) => {
      const i = d.outdoor.hotTubs.findIndex((x) => x.id === hotTubId);
      if (i < 0) return false;
      d.outdoor.hotTubs.splice(i, 1);
      return true;
    }),
  );
  if (ok) deletedToast(store);
  return ok;
}

/** A birch at p in the active proposal (its own trees, see `ownTrees`). Returns its id. */
export function addTree(store: EditStore, p: Vec2, height = 6): Id | null {
  const id = `tree-${Math.random().toString(36).slice(2, 10)}`;
  const site = store.getState().project.site;
  const r = run(
    store,
    (d) => {
      ownTrees(d, site).push({ id, position: copy(p), height, kind: 'bjork' });
      return true;
    },
    { reconcile: false },
  );
  return changed(r) ? id : null;
}

export function moveTree(store: EditStore, treeId: Id, p: Vec2, opts: { transaction?: string } = {}): boolean {
  const s = store.getState();
  if (!treesOf(s.project, selectActiveVariant(s)).some((t) => t.id === treeId)) return false;
  return changed(
    run(
      store,
      (d) => {
        const t0 = treesOf(s.project, d).find((x) => x.id === treeId);
        if (!t0 || dist(t0.position, p) < 1e-9) return false;
        const t = ownTrees(d, s.project.site).find((x) => x.id === treeId);
        if (t) t.position = copy(p);
        return true;
      },
      { ...opts, reconcile: false },
    ),
  );
}

export function deleteTree(store: EditStore, treeId: Id): boolean {
  const s = store.getState();
  if (!treesOf(s.project, selectActiveVariant(s)).some((t) => t.id === treeId)) return false;
  const ok = changed(
    run(
      store,
      (d) => {
        const trees = ownTrees(d, s.project.site);
        const i = trees.findIndex((t) => t.id === treeId);
        if (i < 0) return false;
        trees.splice(i, 1);
        return true;
      },
      { reconcile: false },
    ),
  );
  if (ok) deletedToast(store);
  return ok;
}

export function setVariantNotes(store: EditStore, notes: string): boolean {
  return changed(
    run(store, (d) => {
      const text = notes.trim();
      if ((d.notes ?? '') === text) return false;
      if (text) d.notes = text;
      else delete d.notes;
      return true;
    }),
  );
}

// ---------------------------------------------------------------------------
// Furniture (phase 2b refines the bodies)
// ---------------------------------------------------------------------------

/** Place an item (size from `opts.size`, else the 1 × 1 × 1 m fallback until the catalogue exists). Returns its id. */
export function addFurniture(
  store: EditStore,
  catalogId: string,
  position: Vec2,
  opts: { levelId?: Id; size?: FurnitureItem['size']; rotationDeg?: number; sizeVariant?: string; colour?: string } = {},
): Id | null {
  const storeyId = store.getState().ui.planStorey;
  return (
    run(store, (d, ctx) =>
      applyAddFurniture(d, {
        catalogId,
        position,
        levelId: opts.levelId ?? levelAt(ctx.derived, storeyId, position),
        size: opts.size,
        rotationDeg: opts.rotationDeg,
        sizeVariant: opts.sizeVariant,
        colour: opts.colour,
      }),
    )?.result ?? null
  );
}

export function moveFurniture(store: EditStore, furnitureId: Id, p: Vec2, opts: { transaction?: string } = {}): boolean {
  return changed(
    run(
      store,
      (d) => {
        const f = d.furniture.find((x) => x.id === furnitureId);
        if (!f || dist(f.position, p) < 1e-9) return false;
        f.position = copy(p);
        return true;
      },
      opts,
    ),
  );
}

export function rotateFurniture(store: EditStore, furnitureId: Id, degrees = 90): boolean {
  return changed(
    run(store, (d) => {
      const f = d.furniture.find((x) => x.id === furnitureId);
      if (!f || degrees % 360 === 0) return false;
      f.rotationDeg = (((f.rotationDeg + degrees) % 360) + 360) % 360;
      return true;
    }),
  );
}

export interface FurniturePatch {
  size?: FurnitureItem['size'];
  /** null removes the colour. */
  colour?: string | null;
  sizeVariant?: string;
  catalogId?: string;
  levelId?: Id;
}

export function setFurnitureProps(store: EditStore, furnitureId: Id, patch: FurniturePatch): boolean {
  return changed(
    run(store, (d) => {
      const f = d.furniture.find((x) => x.id === furnitureId);
      if (!f) return false;
      if (patch.size) f.size = { ...patch.size };
      if (patch.colour !== undefined) {
        if (patch.colour === null) delete f.colour;
        else f.colour = patch.colour;
      }
      if (patch.sizeVariant !== undefined) f.sizeVariant = patch.sizeVariant;
      if (patch.catalogId !== undefined) f.catalogId = patch.catalogId;
      if (patch.levelId !== undefined) f.levelId = patch.levelId;
      return true;
    }),
  );
}

/** Copy an item 0.3 m east and south; returns the copy's id. */
export function duplicateFurniture(store: EditStore, furnitureId: Id): Id | null {
  return (
    run(store, (d) => {
      const f = d.furniture.find((x) => x.id === furnitureId);
      if (!f) return null;
      return applyAddFurniture(d, {
        catalogId: f.catalogId,
        position: [f.position[0] + 0.3, f.position[1] - 0.3],
        levelId: f.levelId,
        size: { ...f.size },
        rotationDeg: f.rotationDeg,
        sizeVariant: f.sizeVariant,
        colour: f.colour,
      });
    })?.result ?? null
  );
}

export function deleteFurniture(store: EditStore, furnitureId: Id): boolean {
  const ok = changed(
    run(store, (d) => {
      const i = d.furniture.findIndex((x) => x.id === furnitureId);
      if (i < 0) return false;
      d.furniture.splice(i, 1);
      return true;
    }),
  );
  if (ok) deletedToast(store);
  return ok;
}

// ---------------------------------------------------------------------------
// Nudge
// ---------------------------------------------------------------------------

/** Exterior piece id → its block edge. */
function edgeOfPiece(derived: DerivedVariant, wallId: Id): { blockId: Id; edgeId: Id } | null {
  const w = derived.walls.find((x) => x.id === wallId);
  return w && w.source.kind === 'blockEdge' ? { blockId: w.source.blockId, edgeId: w.source.edgeId } : null;
}

function blockOfVertex(v: Variant, vertexId: Id): Id | null {
  return v.blocks.find((b) => b.polygon.some((x) => x.id === vertexId))?.id ?? null;
}

/**
 * Arrow keys (1 cm, Shift 10 cm): move the selection by (dx, dy). Consecutive nudges of the same element are ONE undo
 * step (transaction `nudge:<kind>:<id>`). Rooms, railings, structure and ghosts do not move. A stored wall moves only
 * across itself (as in a drag) unless both its ends are free.
 */
export function nudge(store: EditStore, selection: Selection, dx: number, dy: number): boolean {
  const d: Vec2 = [dx, dy];
  const transaction = `nudge:${selection.kind}:${selection.id}`;
  const opts = { transaction };
  const s = store.getState();
  const v = selectActiveVariant(s);
  switch (selection.kind) {
    case 'wall': {
      const w = v.walls.find((x) => x.id === selection.id);
      if (w) {
        // Like a drag: across the wall (a wall attached at an end cannot slide along itself), freely when both ends are free.
        const derived = currentDerived(store);
        const free = derived ? wallEndsFree({ base: v, derived }, w.id) : false;
        const n = leftNormal(unit(sub(w.b, w.a)));
        return moveWall(store, w.id, free ? d : scale(n, dot(d, n)), opts);
      }
      const derived = currentDerived(store);
      const e = derived ? edgeOfPiece(derived, selection.id) : null;
      return e ? moveBlockEdge(store, e.blockId, e.edgeId, d, opts) : false;
    }
    case 'blockEdge': {
      const blockId = blockOfVertex(v, selection.id);
      return blockId ? moveBlockEdge(store, blockId, selection.id, d, opts) : false;
    }
    case 'blockVertex': {
      const blockId = blockOfVertex(v, selection.id);
      const p = v.blocks.find((b) => b.id === blockId)?.polygon.find((x) => x.id === selection.id)?.p;
      return blockId && p ? moveBlockVertex(store, blockId, selection.id, add(p, d), opts) : false;
    }
    case 'block':
      return moveBlock(store, selection.id, d, opts);
    case 'opening': {
      const o = v.openings.find((x) => x.id === selection.id);
      const line = o ? hostLine(v, o.host) : null;
      if (!o || !line) return false;
      return moveOpening(store, o.id, o.offset + dot(d, unit(sub(line.b, line.a))), undefined, opts);
    }
    case 'deck':
      return moveDeck(store, selection.id, d, opts);
    case 'deckVertex': {
      const deck = deckOfEdge(v, selection.id);
      const p = deck?.polygon.find((x) => x.id === selection.id)?.p;
      return p ? moveDeckVertex(store, selection.id, add(p, d), opts) : false;
    }
    case 'deckEdge':
      return moveDeckEdge(store, selection.id, d, opts);
    case 'steps': {
      for (const deck of v.outdoor.decks) {
        const st = deck.steps.find((x) => x.id === selection.id);
        const i = st ? deck.polygon.findIndex((x) => x.id === st.edgeId) : -1;
        if (!st || i < 0) continue;
        const a = deck.polygon[i].p;
        const b = deck.polygon[(i + 1) % deck.polygon.length].p;
        return moveSteps(store, st.id, st.offset + dot(d, unit(sub(b, a))), undefined, opts);
      }
      return false;
    }
    case 'hotTub': {
      const t = v.outdoor.hotTubs.find((x) => x.id === selection.id);
      return t ? moveHotTub(store, t.id, add(t.centre, d), opts) : false;
    }
    case 'tree': {
      const t = treesOf(s.project, v).find((x) => x.id === selection.id);
      return t ? moveTree(store, t.id, add(t.position, d), opts) : false;
    }
    case 'furniture': {
      const f = v.furniture.find((x) => x.id === selection.id);
      return f ? moveFurniture(store, f.id, add(f.position, d), opts) : false;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Drag protocol
// ---------------------------------------------------------------------------

/**
 * 'a' / 'b': a stored wall's endpoint; 'start' / 'end': an opening's jamb (resize); 'insert': on a deck edge, insert a
 * vertex at the pointer and drag it (one undo step with the insertion).
 */
export type DragHandle = 'a' | 'b' | 'start' | 'end' | 'insert';

export type DragKind =
  | 'wall'
  | 'wallEndpoint'
  | 'blockEdge'
  | 'blockVertex'
  | 'block'
  | 'opening'
  | 'openingResize'
  | 'deckVertex'
  | 'deckEdge'
  | 'deck'
  | 'steps'
  | 'hotTub'
  | 'tree'
  | 'furniture';

export interface DragModifiers {
  /** Alt: fine grid (0.01 m). */
  alt?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  /** Snap radius in plan metres at the current zoom (12 px, 24 px coarse). */
  snapRadiusM?: number;
  coarse?: boolean;
}

export interface DragFeedback {
  indicators: SnapIndicator[];
  chips: DimensionChip[];
  /** The dragged element's outline at the pointer-down base (rings; 2-point rings are segments). */
  ghost: Vec2[][];
}

export interface DragSession {
  kind: DragKind;
  selection: Selection;
  handle?: DragHandle;
  /** Transaction label. */
  label: string;
  variantId: Id;
  /** The project at pointer-down (`transactionBase()`). */
  base: Project;
  baseVariant: Variant;
  baseDerived: DerivedVariant;
  snapCtx: SnapContext;
  start: Vec2;
  storeyId: Id;
  radius: number;
  /** The dragged element: wall / opening / steps / … id; vertex or edge id for blocks and decks. */
  targetId: Id;
  /** Its block / deck id where relevant. */
  ownerId?: Id;
  /** Room merges of the last update (toasted by endDrag). */
  merges: RoomMerge[];
  done: boolean;
}

export const EMPTY_FEEDBACK: DragFeedback = { indicators: [], chips: [], ghost: [] };

interface DragTarget {
  kind: DragKind;
  targetId: Id;
  ownerId?: Id;
  exclude: Id[];
}

function dragTarget(v: Variant, derived: DerivedVariant, sel: Selection, handle: DragHandle | undefined): DragTarget | 'existing' | null {
  switch (sel.kind) {
    case 'wall': {
      const w = v.walls.find((x) => x.id === sel.id);
      if (w) {
        if (w.status === 'removed') return null;
        if (handle === 'a' || handle === 'b') return { kind: 'wallEndpoint', targetId: w.id, exclude: [w.id] };
        return { kind: 'wall', targetId: w.id, exclude: [w.id] };
      }
      const e = edgeOfPiece(derived, sel.id);
      return e ? edgeTarget(derived, e.blockId, e.edgeId) : null;
    }
    case 'blockEdge': {
      const blockId = blockOfVertex(v, sel.id);
      return blockId ? edgeTarget(derived, blockId, sel.id) : null;
    }
    case 'blockVertex': {
      const block = v.blocks.find((b) => b.polygon.some((x) => x.id === sel.id));
      if (!block) return null;
      const n = block.polygon.length;
      const i = block.polygon.findIndex((x) => x.id === sel.id);
      const prev = block.polygon[(i - 1 + n) % n].id;
      return { kind: 'blockVertex', targetId: sel.id, ownerId: block.id, exclude: [`${block.id}/${sel.id}`, `${block.id}/${prev}`] };
    }
    case 'block': {
      const block = v.blocks.find((b) => b.id === sel.id);
      if (!block) return null;
      if (blockHasExistingArea(block)) return 'existing';
      return { kind: 'block', targetId: block.id, ownerId: block.id, exclude: [block.id] };
    }
    case 'opening': {
      const o = v.openings.find((x) => x.id === sel.id);
      if (!o || o.status === 'removed') return null;
      return { kind: handle === 'start' || handle === 'end' ? 'openingResize' : 'opening', targetId: o.id, exclude: [o.id] };
    }
    case 'deckVertex': {
      const deck = deckOfEdge(v, sel.id);
      if (!deck) return null;
      const n = deck.polygon.length;
      const i = deck.polygon.findIndex((x) => x.id === sel.id);
      const prev = deck.polygon[(i - 1 + n) % n].id;
      return { kind: 'deckVertex', targetId: sel.id, ownerId: deck.id, exclude: [sel.id, `${deck.id}/${sel.id}`, `${deck.id}/${prev}`] };
    }
    case 'deckEdge': {
      const deck = deckOfEdge(v, sel.id);
      return deck ? { kind: 'deckEdge', targetId: sel.id, ownerId: deck.id, exclude: [`${deck.id}/${sel.id}`] } : null;
    }
    case 'deck':
      return v.outdoor.decks.some((d) => d.id === sel.id) ? { kind: 'deck', targetId: sel.id, ownerId: sel.id, exclude: [sel.id] } : null;
    case 'steps': {
      const deck = v.outdoor.decks.find((d) => d.steps.some((s) => s.id === sel.id));
      return deck ? { kind: 'steps', targetId: sel.id, ownerId: deck.id, exclude: [] } : null;
    }
    case 'hotTub':
      return v.outdoor.hotTubs.some((t) => t.id === sel.id) ? { kind: 'hotTub', targetId: sel.id, exclude: [] } : null;
    case 'tree':
      return { kind: 'tree', targetId: sel.id, exclude: [] };
    case 'furniture':
      return v.furniture.some((f) => f.id === sel.id) ? { kind: 'furniture', targetId: sel.id, exclude: [sel.id] } : null;
    default:
      return null;
  }
}

function edgeTarget(derived: DerivedVariant, blockId: Id, edgeId: Id): DragTarget | null {
  const db = derived.blocks.find((b) => b.block.id === blockId);
  if (!db) return null;
  const i = db.block.polygon.findIndex((x) => x.id === edgeId);
  if (i < 0) return null;
  const exclude = [`${blockId}/${edgeId}`];
  for (const j of db.junctions) {
    if (j.edgeIndex !== i) continue;
    const other = derived.blocks.find((b) => b.block.id === j.otherBlockId);
    const oe = other?.block.polygon[j.otherEdgeIndex];
    if (oe) exclude.push(`${j.otherBlockId}/${oe.id}`);
  }
  return { kind: 'blockEdge', targetId: edgeId, ownerId: blockId, exclude };
}

/**
 * The snap context of a drag session: the storey's targets without the dragged element (`target.exclude`) and the
 * dragged element's start (`origin`: the point `updateDrag` snaps — a wall end, a free wall's end a, a block / deck
 * vertex, the hot tub's centre — or the polygon it moves — a block, a deck, a furniture footprint), so geometry/snap.ts
 * never pulls a short drag back to where it started, nor adds or takes back much of it (fix round 2 after phase 2a).
 */
function dragSnapContext(variant: Variant, derived: DerivedVariant, storeyId: Id, target: DragTarget, handle: DragHandle | undefined): SnapContext {
  const origin = ((): { point?: Vec2; polygon?: Vec2[] } | undefined => {
    switch (target.kind) {
      case 'wall':
      case 'wallEndpoint': {
        const w = variant.walls.find((x) => x.id === target.targetId);
        return w ? { point: copy(target.kind === 'wallEndpoint' && handle === 'b' ? w.b : w.a) } : undefined;
      }
      case 'blockVertex': {
        const v = variant.blocks.find((b) => b.id === target.ownerId)?.polygon.find((x) => x.id === target.targetId);
        return v ? { point: copy(v.p) } : undefined;
      }
      case 'block': {
        const b = variant.blocks.find((x) => x.id === target.ownerId);
        return b ? { polygon: b.polygon.map((x) => copy(x.p)) } : undefined;
      }
      case 'deckVertex': {
        const v = variant.outdoor.decks.find((d) => d.id === target.ownerId)?.polygon.find((x) => x.id === target.targetId);
        return v ? { point: copy(v.p) } : undefined;
      }
      case 'deck': {
        const d = variant.outdoor.decks.find((x) => x.id === target.targetId);
        return d ? { polygon: d.polygon.map((x) => copy(x.p)) } : undefined;
      }
      case 'hotTub': {
        const t = variant.outdoor.hotTubs.find((x) => x.id === target.targetId);
        return t ? { point: copy(t.centre) } : undefined;
      }
      case 'furniture': {
        const f = derived.furniture.find((x) => x.id === target.targetId);
        return f ? { polygon: f.footprint.map(copy) } : undefined;
      }
      default:
        return undefined;
    }
  })();
  return buildSnapContext(derived, { storeyId, exclude: target.exclude, origin });
}

/**
 * Start dragging the selection (or one of its handles) at `pointer` (plan metres). Opens a transaction; returns null
 * when nothing can be dragged (the plan then pans) or when refused (locked variant / whole existing block: toast).
 */
export function beginDrag(
  store: EditStore,
  selection: Selection | null,
  pointer: Vec2,
  handle?: DragHandle,
  opts: { snapRadiusM?: number; storeyId?: Id } = {},
): DragSession | null {
  if (!selection) return null;
  const s = store.getState();
  if (s.ui.readOnly) return null;
  const variant = selectActiveVariant(s);
  if (isLocked(variant)) {
    lockedToast(store);
    return null;
  }
  let derived = deriveOf(s.project.site, variant);
  if (!derived) return null;
  const storeyId = opts.storeyId ?? s.ui.planStorey;
  if (handle === 'insert' && selection.kind === 'deckEdge') {
    // "+" midpoint handle: the insertion and the drag of the new vertex are one transaction.
    const deck = deckOfEdge(variant, selection.id);
    if (!deck) return null;
    s.beginTransaction(`drag:deckVertex:insert:${selection.id}`);
    const base = store.getState().transactionBase() ?? s.project;
    const vid = run(store, (d) => applyInsertDeckVertex(d, deck.id, selection.id, pointer))?.result ?? null;
    const inserted = selectActiveVariant(store.getState());
    derived = vid ? deriveOf(store.getState().project.site, inserted) : null;
    if (!vid || !derived) {
      store.getState().cancelTransaction();
      return null;
    }
    const n = inserted.outdoor.decks.find((x) => x.id === deck.id)?.polygon ?? [];
    const i = n.findIndex((x) => x.id === vid);
    const prev = n[(i - 1 + n.length) % n.length]?.id ?? vid;
    return {
      kind: 'deckVertex',
      selection: { kind: 'deckVertex', id: vid },
      handle,
      label: `drag:deckVertex:${vid}`,
      variantId: inserted.id,
      base,
      baseVariant: inserted,
      baseDerived: derived,
      snapCtx: buildSnapContext(derived, { storeyId, exclude: [vid, `${deck.id}/${vid}`, `${deck.id}/${prev}`], origin: { point: copy(pointer) } }),
      start: copy(pointer),
      storeyId,
      radius: opts.snapRadiusM ?? DEFAULT_SNAP_RADIUS,
      targetId: vid,
      ownerId: deck.id,
      merges: [],
      done: false,
    };
  }
  const target = dragTarget(variant, derived, selection, handle);
  if (!target) return null;
  if (target === 'existing') {
    s.showToast({ text: EDIT_STRINGS.existingBlockMove });
    return null;
  }
  const label = `drag:${target.kind}:${target.targetId}`;
  s.beginTransaction(label);
  return {
    kind: target.kind,
    selection,
    handle,
    label,
    variantId: variant.id,
    base: store.getState().transactionBase() ?? s.project,
    baseVariant: variant,
    baseDerived: derived,
    snapCtx: dragSnapContext(variant, derived, storeyId, target, handle),
    start: copy(pointer),
    storeyId,
    radius: opts.snapRadiusM ?? DEFAULT_SNAP_RADIUS,
    targetId: target.targetId,
    ownerId: target.ownerId,
    merges: [],
    done: false,
  };
}

/** Drag kinds that cannot change a room face (updateDrag skips reconcileRooms for them). */
const NO_ROOM_DRAGS: ReadonlySet<DragKind> = new Set<DragKind>(['opening', 'openingResize', 'deckVertex', 'deckEdge', 'deck', 'steps', 'hotTub', 'tree', 'furniture']);

function variantOf(r: RunResult<unknown> | null, session: DragSession): Variant {
  return r?.variant ?? session.baseVariant;
}

/** Apply the drag for the pointer position (from the base) and return the feedback to draw. */
export function updateDrag(store: EditStore, session: DragSession | null, pointer: Vec2, modifiers: DragModifiers = {}): DragFeedback {
  if (!session || session.done) return EMPTY_FEEDBACK;
  const radius = modifiers.snapRadiusM ?? session.radius;
  const fine = modifiers.alt === true;
  const delta = sub(pointer, session.start);
  const ctx = session.snapCtx;
  const base = session.baseVariant;
  // Openings and outdoor things never change a room face: no room reconciliation (and no derive) per frame.
  const runOpts: RunOpts = { base, baseDerived: session.baseDerived, toastMerges: false, reconcile: !NO_ROOM_DRAGS.has(session.kind) };
  const apply = <R>(recipe: (draft: Variant, c: EditContext) => R): RunResult<R> | null => {
    const r = run(store, recipe, runOpts);
    if (r) session.merges = r.merges;
    return r;
  };

  switch (session.kind) {
    case 'wall': {
      const w = base.walls.find((x) => x.id === session.targetId);
      const dw = session.baseDerived.walls.find((x) => x.id === session.targetId);
      if (!w) return EMPTY_FEEDBACK;
      let d: Vec2;
      let indicators: SnapIndicator[] = [];
      if (wallEndsFree({ base, derived: session.baseDerived }, w.id)) {
        const sres = snap(ctx, add(w.a, delta), { radius, fine });
        d = sub(sres.point, w.a);
        indicators = sres.indicators;
      } else {
        const nL = leftNormal(unit(sub(w.b, w.a)));
        const sres = snapLineOffset(ctx, w.a, w.b, dot(delta, nL), { radius, fine, excludeIds: new Set([w.id]) });
        d = scale(nL, sres.offset);
        indicators = sres.indicators;
      }
      const r = apply((dr, c) => applyMoveWall(dr, c, w.id, d));
      const nw = variantOf(r, session).walls.find((x) => x.id === w.id) ?? w;
      const chips = chipsAcross(ctx, nw.a, nw.b, dw?.faceLeft ?? w.thickness / 2, dw?.faceRight ?? w.thickness / 2, { exclude: new Set([w.id]) });
      return { indicators, chips, ghost: [[copy(w.a), copy(w.b)]] };
    }
    case 'wallEndpoint': {
      const w = base.walls.find((x) => x.id === session.targetId);
      const end = session.handle === 'b' ? 'b' : 'a';
      if (!w) return EMPTY_FEEDBACK;
      const fixed = end === 'a' ? w.b : w.a;
      const sres = snap(ctx, add(w[end], delta), { radius, fine, from: fixed });
      const r = apply((dr, c) => applyMoveWallEndpoint(dr, c, w.id, end, sres.point));
      const nw = variantOf(r, session).walls.find((x) => x.id === w.id) ?? w;
      const moved = nw[end];
      return { indicators: sres.indicators, chips: [{ a: copy(fixed), b: copy(moved), length: dist(fixed, moved) }], ghost: [[copy(w.a), copy(w.b)]] };
    }
    case 'blockEdge': {
      const block = base.blocks.find((b) => b.id === session.ownerId);
      const i = block ? block.polygon.findIndex((x) => x.id === session.targetId) : -1;
      if (!block || i < 0) return EMPTY_FEEDBACK;
      const a = block.polygon[i].p;
      const b = block.polygon[(i + 1) % block.polygon.length].p;
      const nL = leftNormal(unit(sub(b, a)));
      const sres = snapLineOffset(ctx, a, b, dot(delta, nL), { radius, fine, axisOnly: true });
      const r = apply((dr, c) => applyMoveBlockEdge(dr, c, block.id, session.targetId, scale(nL, sres.offset)));
      const nb = variantOf(r, session).blocks.find((x) => x.id === block.id);
      const j = nb ? nb.polygon.findIndex((x) => x.id === session.targetId) : -1;
      const chips: DimensionChip[] = [];
      if (nb && j >= 0) {
        const na = nb.polygon[j].p;
        const nbp = nb.polygon[(j + 1) % nb.polygon.length].p;
        const pieces = new Set(
          session.baseDerived.walls.filter((w) => w.source.kind === 'blockEdge' && w.source.blockId === block.id && w.source.edgeId === session.targetId).map((w) => w.id),
        );
        // Inside (left of a CCW edge): from the inner face to the nearest wall.
        const inner = block.wall.thickness - block.wall.outerOffset;
        const sign = signedAreaOf(block.polygon.map((x) => x.p)) >= 0 ? 1 : -1;
        const nIn = scale(leftNormal(unit(sub(nbp, na))), sign);
        const from = add(scale(add(na, nbp), 0.5), scale(nIn, inner));
        const hit = rayToWall(ctx, from, nIn, { exclude: pieces });
        if (hit) chips.push({ a: from, b: hit.hit, length: hit.t });
      }
      return { indicators: sres.indicators, chips, ghost: [[copy(a), copy(b)]] };
    }
    case 'blockVertex': {
      const block = base.blocks.find((b) => b.id === session.ownerId);
      const v = block?.polygon.find((x) => x.id === session.targetId);
      if (!block || !v) return EMPTY_FEEDBACK;
      const sres = snap(ctx, add(v.p, delta), { radius, fine });
      apply((dr, c) => applyMoveBlockVertex(dr, c, block.id, v.id, sres.point));
      return { indicators: sres.indicators, chips: [], ghost: [block.polygon.map((x) => copy(x.p))] };
    }
    case 'block': {
      const block = base.blocks.find((b) => b.id === session.ownerId);
      if (!block) return EMPTY_FEEDBACK;
      const poly = block.polygon.map((x) => add(x.p, delta));
      const sres = snapPolygon(ctx, poly, { radius, fine });
      const d = add(delta, sres.delta);
      apply((dr, c) => applyMoveBlock(dr, c, block.id, d));
      return { indicators: sres.indicators, chips: [], ghost: [block.polygon.map((x) => copy(x.p))] };
    }
    case 'opening':
      return dragOpening(session, delta, radius, fine, apply);
    case 'openingResize':
      return resizeOpening(session, pointer, fine, apply);
    case 'deckVertex': {
      const deck = base.outdoor.decks.find((d) => d.id === session.ownerId);
      const v = deck?.polygon.find((x) => x.id === session.targetId);
      if (!deck || !v) return EMPTY_FEEDBACK;
      const sres = snap(ctx, add(v.p, delta), { radius, fine });
      apply((dr) => applyMoveDeckVertex(dr, deck.id, v.id, sres.point));
      return { indicators: sres.indicators, chips: sres.chips, ghost: [deck.polygon.map((x) => copy(x.p))] };
    }
    case 'deckEdge': {
      const deck = base.outdoor.decks.find((d) => d.id === session.ownerId);
      const i = deck ? deck.polygon.findIndex((x) => x.id === session.targetId) : -1;
      if (!deck || i < 0) return EMPTY_FEEDBACK;
      const a = deck.polygon[i].p;
      const b = deck.polygon[(i + 1) % deck.polygon.length].p;
      const nL = leftNormal(unit(sub(b, a)));
      const sres = snapLineOffset(ctx, a, b, dot(delta, nL), { radius, fine, axisOnly: true });
      apply((dr) => applyMoveDeckEdge(dr, deck.id, session.targetId, scale(nL, sres.offset)));
      return { indicators: sres.indicators, chips: [], ghost: [[copy(a), copy(b)]] };
    }
    case 'deck': {
      const deck = base.outdoor.decks.find((d) => d.id === session.targetId);
      if (!deck) return EMPTY_FEEDBACK;
      const sres = snapPolygon(ctx, deck.polygon.map((x) => add(x.p, delta)), { radius, fine });
      const d = add(delta, sres.delta);
      apply((dr) => applyMoveDeck(dr, deck.id, d));
      return { indicators: sres.indicators, chips: [], ghost: [deck.polygon.map((x) => copy(x.p))] };
    }
    case 'steps': {
      const deck = base.outdoor.decks.find((d) => d.id === session.ownerId);
      const st = deck?.steps.find((x) => x.id === session.targetId);
      const i = deck && st ? deck.polygon.findIndex((x) => x.id === st.edgeId) : -1;
      if (!deck || !st || i < 0) return EMPTY_FEEDBACK;
      const a = deck.polygon[i].p;
      const b = deck.polygon[(i + 1) % deck.polygon.length].p;
      const u = unit(sub(b, a));
      const offset = roundTo(st.offset + dot(delta, u), gridStep(fine));
      apply((dr) => applyMoveSteps(dr, st.id, offset));
      const c0 = add(a, scale(u, st.offset - st.width / 2));
      const c1 = add(a, scale(u, st.offset + st.width / 2));
      return { indicators: [], chips: [], ghost: [[c0, c1]] };
    }
    case 'hotTub': {
      const t = base.outdoor.hotTubs.find((x) => x.id === session.targetId);
      if (!t) return EMPTY_FEEDBACK;
      const sres = snapCircle(ctx, add(t.centre, delta), t.diameter / 2, { radius, fine });
      apply((dr) => {
        const x = dr.outdoor.hotTubs.find((h) => h.id === t.id);
        if (!x) return false;
        x.centre = copy(sres.point);
        return true;
      });
      return { indicators: sres.indicators, chips: [], ghost: [circleRing(t.centre, t.diameter / 2)] };
    }
    case 'tree': {
      const t = treesOf(session.base, base).find((x) => x.id === session.targetId);
      if (!t) return EMPTY_FEEDBACK;
      const step = gridStep(fine);
      const p: Vec2 = [roundTo(t.position[0] + delta[0], step), roundTo(t.position[1] + delta[1], step)];
      apply((dr) => {
        if (dist(t.position, p) < 1e-9) return false;
        const x = ownTrees(dr, session.base.site).find((tr) => tr.id === t.id);
        if (x) x.position = p;
        return true;
      });
      return { indicators: [], chips: [], ghost: [circleRing(t.position, 0.5)] };
    }
    case 'furniture': {
      const f = base.furniture.find((x) => x.id === session.targetId);
      const df = session.baseDerived.furniture.find((x) => x.id === session.targetId);
      if (!f) return EMPTY_FEEDBACK;
      const fp = (df?.footprint ?? []).map((q) => add(q, delta));
      const sres = snapFootprint(ctx, fp, { radius, excludeIds: new Set([f.id]) });
      const p = add(add(f.position, delta), sres.delta);
      apply((dr) => {
        const x = dr.furniture.find((it) => it.id === f.id);
        if (!x) return false;
        x.position = p;
        return true;
      });
      return { indicators: sres.indicators, chips: [], ghost: df ? [df.footprint.map(copy)] : [] };
    }
  }
}

const signedAreaOf = (poly: Vec2[]): number => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - a[1] * b[0];
  }
  return s / 2;
};

function circleRing(c: Vec2, r: number, n = 24): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return out;
}

/** Host under a plan point: the nearest non-ghost, non-divider derived wall of the storey within `maxDist`. */
function hostNear(derived: DerivedVariant, storeyId: Id, p: Vec2, maxDist: number): { host: OpeningHost; offset: number; a: Vec2; b: Vec2 } | null {
  let best: { host: OpeningHost; offset: number; a: Vec2; b: Vec2; d: number } | null = null;
  for (const w of derived.walls) {
    if (w.isGhost || w.isDivider || !w.storeyIds.includes(storeyId)) continue;
    const d = distancePointSegment(p, w.a, w.b);
    if (d > maxDist || (best && d >= best.d)) continue;
    const s = dot(sub(p, w.a), unit(sub(w.b, w.a)));
    if (w.source.kind === 'wall') best = { host: { kind: 'wall', wallId: w.source.wallId }, offset: s, a: w.a, b: w.b, d };
    else best = { host: { kind: 'blockEdge', blockId: w.source.blockId, edgeId: w.source.edgeId }, offset: w.source.s0 + s, a: w.a, b: w.b, d };
  }
  return best ? { host: best.host, offset: best.offset, a: best.a, b: best.b } : null;
}

/** Chips from an opening's jambs along its host to the nearest crossing wall face (the room side). */
function openingChips(ctx: SnapContext, a: Vec2, b: Vec2, centre: number, width: number, hostWallIds: ReadonlySet<Id>, faceLeft: number): DimensionChip[] {
  const u = unit(sub(b, a));
  const n = leftNormal(u);
  const lift = faceLeft + 0.005;
  const j0 = add(add(a, scale(u, centre - width / 2)), scale(n, lift));
  const j1 = add(add(a, scale(u, centre + width / 2)), scale(n, lift));
  const out: DimensionChip[] = [];
  const h0 = rayToWall(ctx, j0, scale(u, -1), { exclude: hostWallIds });
  if (h0) out.push({ a: j0, b: h0.hit, length: h0.t });
  const h1 = rayToWall(ctx, j1, u, { exclude: hostWallIds });
  if (h1) out.push({ a: j1, b: h1.hit, length: h1.t });
  return out;
}

function hostPieceIds(derived: DerivedVariant, host: OpeningHost): Set<Id> {
  return new Set(
    derived.walls
      .filter((w) =>
        host.kind === 'wall'
          ? w.source.kind === 'wall' && w.source.wallId === host.wallId
          : w.source.kind === 'blockEdge' && w.source.blockId === host.blockId && w.source.edgeId === host.edgeId,
      )
      .map((w) => w.id),
  );
}

function dragOpening(
  session: DragSession,
  delta: Vec2,
  radius: number,
  fine: boolean,
  apply: <R>(recipe: (draft: Variant, c: EditContext) => R) => RunResult<R> | null,
): DragFeedback {
  const base = session.baseVariant;
  const o = base.openings.find((x) => x.id === session.targetId);
  const line = o ? hostLine(base, o.host) : null;
  if (!o || !line) return EMPTY_FEEDBACK;
  const derivedOpening = session.baseDerived.walls.flatMap((w) => w.openings).find((x) => x.id === o.id);
  const centre0 = add(line.a, scale(unit(sub(line.b, line.a)), o.offset));
  const centre = add(centre0, delta);
  const step = gridStep(fine);
  let host = o.host;
  let offset = o.offset + dot(delta, unit(sub(line.b, line.a)));
  let a = line.a;
  let b = line.b;
  if (distancePointSegment(centre, line.a, line.b) > Math.max(radius, REHOST_DISTANCE)) {
    const near = hostNear(session.baseDerived, session.storeyId, centre, Math.max(radius, REHOST_DISTANCE));
    if (near) {
      host = near.host;
      offset = near.offset;
      const nl = hostLine(base, host);
      if (nl) {
        a = nl.a;
        b = nl.b;
      }
    }
  }
  offset = roundTo(offset, step);
  const r = apply((dr, c) => applyMoveOpening(dr, c, o.id, offset, host));
  const no = variantOf(r, session).openings.find((x) => x.id === o.id) ?? o;
  const dw = session.baseDerived.walls.find((w) => hostPieceIds(session.baseDerived, no.host).has(w.id));
  const chips = openingChips(session.snapCtx, a, b, no.offset, no.width, hostPieceIds(session.baseDerived, no.host), dw?.faceLeft ?? 0);
  return { indicators: [], chips, ghost: derivedOpening && derivedOpening.footprint.length >= 3 ? [derivedOpening.footprint.map(copy)] : [] };
}

function resizeOpening(
  session: DragSession,
  pointer: Vec2,
  fine: boolean,
  apply: <R>(recipe: (draft: Variant, c: EditContext) => R) => RunResult<R> | null,
): DragFeedback {
  const base = session.baseVariant;
  const o = base.openings.find((x) => x.id === session.targetId);
  const line = o ? hostLine(base, o.host) : null;
  if (!o || !line) return EMPTY_FEEDBACK;
  const u = unit(sub(line.b, line.a));
  const startSide = session.handle === 'start';
  const fixed = startSide ? o.offset + o.width / 2 : o.offset - o.width / 2;
  const [lo, hi] = pieceRange({ base, derived: session.baseDerived }, o.host, o.offset) ?? [0, line.length];
  let s = roundTo(dot(sub(pointer, line.a), u), gridStep(fine));
  s = startSide ? Math.min(s, fixed - MIN_OPENING_WIDTH) : Math.max(s, fixed + MIN_OPENING_WIDTH);
  s = Math.min(hi, Math.max(lo, s));
  const width = Math.abs(fixed - s);
  if (width < MIN_OPENING_WIDTH - 1e-9) return EMPTY_FEEDBACK;
  const centre = (fixed + s) / 2;
  apply((dr) => {
    applySetOpeningProps(dr, o.id, { width });
    const x = dr.openings.find((it) => it.id === o.id);
    if (x) x.offset = centre;
    return true;
  });
  const j0 = add(line.a, scale(u, o.offset - o.width / 2));
  const j1 = add(line.a, scale(u, o.offset + o.width / 2));
  const n0 = add(line.a, scale(u, centre - width / 2));
  const n1 = add(line.a, scale(u, centre + width / 2));
  return { indicators: [], chips: [{ a: n0, b: n1, length: width }], ghost: [[j0, j1]] };
}

/** Commit the drag (one undo step) and toast room merges. */
export function endDrag(store: EditStore, session: DragSession | null): void {
  if (!session || session.done) return;
  session.done = true;
  store.getState().commitTransaction();
  mergeToasts(store, session.merges);
}

/** Abandon the drag: back to the pointer-down project, no history entry. */
export function cancelDrag(store: EditStore, session: DragSession | null): void {
  if (!session || session.done) return;
  session.done = true;
  store.getState().cancelTransaction();
}

// ---------------------------------------------------------------------------
// Tool snapping
// ---------------------------------------------------------------------------

export interface ToolSnapOptions {
  purpose: 'wall' | 'opening' | 'unit' | 'measure' | 'furniture';
  storeyId?: Id;
  levelId?: Id;
  /** Vegg / Mål: the first point. */
  from?: Vec2;
  templateId?: string;
  rotation90?: number;
  modifiers?: DragModifiers;
}

export interface ToolSnapResult extends SnapResult {
  /** Nytt bygg: the unit's footprint at the snapped centre. */
  ghost?: Vec2[][];
  /** Dør/vindu: the host under the point and the offset of the point along it. */
  host?: { host: OpeningHost; offset: number };
}

const contextCache = new WeakMap<DerivedVariant, Map<Id, SnapContext>>();

function cachedContext(derived: DerivedVariant, storeyId: Id): SnapContext {
  let m = contextCache.get(derived);
  if (!m) {
    m = new Map();
    contextCache.set(derived, m);
  }
  let ctx = m.get(storeyId);
  if (!ctx) {
    ctx = buildSnapContext(derived, { storeyId });
    m.set(storeyId, ctx);
  }
  return ctx;
}

/** Snapping for the placement tools (header). */
export function snapPoint(store: EditStore, p: Vec2, opts: ToolSnapOptions): ToolSnapResult {
  const s = store.getState();
  const derived = currentDerived(store);
  const radius = opts.modifiers?.snapRadiusM ?? DEFAULT_SNAP_RADIUS;
  const fine = opts.modifiers?.alt === true;
  if (!derived) return { point: copy(p), kind: 'none', indicators: [], chips: [] };
  const storeyId = opts.storeyId ?? s.ui.planStorey;
  const ctx = cachedContext(derived, storeyId);
  switch (opts.purpose) {
    case 'unit': {
      const t = unitTemplate(opts.templateId);
      if (!t) return snap(ctx, p, { radius, fine, points: false, lines: false });
      const poly = unitFootprint(t, p, opts.rotation90 ?? 0);
      const sres = snapPolygon(ctx, poly, { radius, fine });
      const at = add(p, sres.delta);
      return { point: at, kind: sres.indicators.length > 0 ? 'line' : 'grid', indicators: sres.indicators, chips: [], ghost: [unitFootprint(t, at, opts.rotation90 ?? 0)] };
    }
    case 'opening': {
      const near = hostNear(derived, storeyId, p, Math.max(radius * 2, REHOST_DISTANCE));
      if (!near) return { point: copy(p), kind: 'none', indicators: [], chips: [] };
      const u = unit(sub(near.b, near.a));
      const sAlong = roundTo(dot(sub(p, near.a), u), gridStep(fine));
      const point = add(near.a, scale(u, sAlong));
      const offset = near.host.kind === 'wall' ? sAlong : near.offset - dot(sub(p, near.a), u) + sAlong;
      return { point, kind: 'line', indicators: [{ kind: 'line', a: near.a, b: near.b }], chips: [], host: { host: near.host, offset } };
    }
    case 'furniture':
      return snap(ctx, p, { radius, fine: true, points: false, lines: false });
    default:
      return snap(ctx, p, { radius, fine, from: opts.from });
  }
}

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

type Bound<F> = F extends (store: EditStore, ...args: infer A) => infer R ? (...args: A) => R : never;

const ACTIONS = {
  addWall,
  moveWall,
  moveWallEndpoint,
  splitWall,
  deleteWall,
  setWallProps,
  restoreGhost,
  moveBlockEdge,
  moveBlockVertex,
  moveBlock,
  rotateBlock,
  placeUnit,
  deleteBlock,
  setBlockProps,
  setBlockSize,
  duplicateBlock,
  addOpening,
  moveOpening,
  setOpeningProps,
  deleteOpening,
  nameFace,
  setRoomProps,
  deleteRoom,
  resizeRoom,
  moveDeckVertex,
  moveDeckEdge,
  moveDeck,
  insertDeckVertex,
  deleteDeckVertex,
  setDeckProps,
  toggleRailingEdge,
  addSteps,
  moveSteps,
  setStepsProps,
  deleteSteps,
  moveHotTub,
  setHotTubDiameter,
  deleteHotTub,
  addTree,
  moveTree,
  deleteTree,
  setVariantNotes,
  addFurniture,
  moveFurniture,
  rotateFurniture,
  setFurnitureProps,
  duplicateFurniture,
  deleteFurniture,
  nudge,
  beginDrag,
  updateDrag,
  endDrag,
  cancelDrag,
  snapPoint,
} as const;

export type EditActions = { [K in keyof typeof ACTIONS]: Bound<(typeof ACTIONS)[K]> };

/** Every action bound to `store`. */
export function bindEditActions(store: EditStore): EditActions {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(ACTIONS)) {
    out[name] = (...args: unknown[]) => (fn as (s: EditStore, ...a: unknown[]) => unknown)(store, ...args);
  }
  return out as EditActions;
}

const appActions = bindEditActions(appStore);

/** The edit actions bound to the app store (a stable object). */
export function useEditActions(): EditActions {
  return useMemo(() => appActions, []);
}

/** Whether the active variant may be edited (not read-only, not the locked base proposal). */
export function canEdit(store: EditStore): boolean {
  const s = store.getState();
  return !s.ui.readOnly && !isLocked(selectActiveVariant(s));
}
