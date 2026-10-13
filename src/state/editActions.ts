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
 * its derive (the plan's render derives the stored result once). Drag preview (polish round, phase 2b):
 * `previewDrag(session, pointer, modifiers)` (no store; bound the same way) is the cheap part of a frame — the same snap
 * and overlay as updateDrag (chips from the nominal geometry) plus `target`, the dragged element's outline at the
 * snapped pointer — without a store change or a derive (≈ 0.02–0.06 ms on the seed against ≈ 55 ms for a wall / edge /
 * unit updateDrag); the plan calls it every frame and updateDrag at most every T ms, and once more before endDrag.
 * Unit and block moves reach contact targets as far as the pointer's drag threshold (`DragModifiers.dragThresholdM`,
 * default 10 / 24 of the snap radius = 5 px / 10 px), so a phone can attach a unit (geometry/snap.ts snapPolygon).
 * `snapPoint(store, p, opts)` serves the placement tools (Vegg / Mål with `from`, Dør/vindu → the host under the
 * point, Nytt bygg → the snapped unit centre with its footprint as `ghost`, reaching the pointer radius but on touch
 * at most max(0.25 m, 10 px) (`unitPlacementReach`, fix round after 2b), Møbler → grid).
 *
 * Where the plan is silent: `insertDeckVertex` takes (edgeId, p) or (deckId, edgeId, p) (the two UI sides use
 * both); `resizeRoom` returns the refusal ('block-edge' → "Endres under bygningsdelen", also as a toast); `nudge` of a
 * wall moves it across itself like a drag; `restoreGhost` also brings back Room records deleted earlier in this
 * session (found in the undo history) or merged away earlier (kept on the variant, `Variant.mergedRooms`) whose
 * anchor lies in a face that is unnamed after the restore, and for a wall that is not just its ghost translated (an endpoint drag) it first drags each end back with the endpoint cascades
 * (leaving alone the existing walls the forward step did not touch: no ghost); a translated wall is moved back the
 * same way (`keep`: the untouched existing walls, the walls no step since the first touch changed — from the undo
 * history, `unchangedSince` — and new walls on its end whose line misses the ghost's end, `keepOnMoveBack`), so a
 * move that ended on a neighbour's corner does not drag that neighbour back with it; after a wall restore it also drags back
 * the ends of neighbours the forward step left just beside the wall's line (`neighbourEnds`: their ghost end is on the
 * restored ghost, their live end within 5 cm of the moved wall or on the line it was moved to);
 * `moveBlock` / a whole-block drag of a block with existing area is refused like `deleteBlock`; `rotateBlock(store,
 * id, 90 | −90)` turns a placed unit (template blocks only; one standing against a wall or a deck edge keeps that
 * contact, geometry/edit.ts `contactTurn`); `nameFace` returns the derived room id to select;
 * `deleteDeckVertex` toasts EDIT_STRINGS.deckVertexCrosses when the outline would cross itself.
 *
 * Last fix round, fifth review: a template unit never ends up on another building. `snapPoint` (Nytt bygg) shifts
 * the ghost clear within its reach (a tap outside every building: within half the unit's size), else sets `hint` and
 * `placeUnit` refuses with the toast `EDIT_STRINGS.unitOnBlock`; a block drag shifts the unit clear within that
 * reach or stops it at the contact with `DragFeedback.hint`; `moveBlock`, `rotateBlock`, `moveBlockEdge` and
 * `moveBlockVertex` stop or refuse with the toast; `duplicateBlock` puts a unit's copy beside it. Whole-block moves and
 * turns run with `follow: false` (nothing follows the block's walls). "Ta tilbake" carries back only walls whose
 * `Wall.carriedBy` names the restored wall and still holds (`carriedBy`), never a wall moved on its own (`notCarriedBy`,
 * kept out of every cascade back, and a neighbour end such a wall meets stays); merged-away names revive only into
 * faces the restore changed (with the toast `roomsBack`), and a `Variant.mergedRooms` record goes when another edit
 * redraws its face.
 *
 * Last fix round, sixth review: a carried wall goes back to where it stood before the restored wall's moves carried it
 * (`Wall.carriedBy.from`), not to its ghost; a corner or T-junction the restored wall had with another moved wall is
 * closed again where the lines cross (`keptJunctions` / `closeJunctions`); a moved new wall without a ghost counts as
 * moved (`movedNewWalls`). A merged-room record goes only when its face is split or its anchor lies in another room's
 * face. Bredde / Dybde of a unit against a building change its free side; «Ta tilbake» on a house edge pushes a unit
 * against it away or is refused with the toast `unitOnBlock` (geometry/edit.ts `restoreEdgeOnBlock`).
 *
 * Final morning round: no geometric fallback for a variant without any `carriedBy` (it fired in today's proposals
 * whenever nothing happened to be carried, and slanted the user's own walls; wall editing went live with `carriedBy`
 * already written, so no published proposal needs it). A merged-room record is dropped by a split only when two or
 * more of the new pieces are substantial (`substantialPiece`), not for a sliver. A house edge that cannot move because
 * a unit stands against it names the unit (`unitInTheWayToast`). Bredde / Dybde that narrows a unit narrows its own
 * openings to fit the new wall, with a toast (geometry/edit.ts `fitUnitOpenings`).
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
  applyWallEnds,
  applySetBlockProps,
  applySetBlockSize,
  applySetDeckProps,
  applySetOpeningProps,
  applySetRoomProps,
  applySetStepsProps,
  applySetWallProps,
  applySplitWall,
  applyToggleRailingEdge,
  blockEdgeMoveClamp,
  blockHasExistingArea,
  blockSizeMove,
  blockVertexMoveClamp,
  deckOfEdge,
  fitUnitOpenings,
  ghostRef,
  healGhosts,
  hostLine,
  isLocked,
  pieceRange,
  overlapArea,
  reconcileRooms,
  restoreEdgeOnBlock,
  reviveRoomRecords,
  roomResizeMove,
  turnedAxis,
  unitClearShift,
  unitMoveFraction,
  unitOverlaps,
  wallEndsFree,
  wallMoveFraction,
} from '../geometry/edit';
import type { BlockPatch, DeckPatch, EditContext, OpeningPatch, PlanTransform, RoomMerge, RoomPatch, RoomTombstone, WallPatch } from '../geometry/edit';
import { backEdge } from '../geometry/furnitureDerive';
import { levelAt } from '../geometry/levels';
import { buildSnapContext, chipsAcross, gridStep, rayToWall, roundTo, snap, snapCircle, snapFootprint, snapLineOffset, snapPolygon } from '../geometry/snap';
import type { DimensionChip, SnapContext, SnapIndicator, SnapResult } from '../geometry/snap';
import { area, distancePointSegment, pointInPolygon } from '../geometry/polygon';
import type { DerivedRoom, DerivedVariant } from '../model/derived';
import { catalogPlacementSpec, convexOverlap, insideRoom, placementObstacles, rectFootprint, tapPlacement } from '../plan2d/furniturePlacement';
import type { Obstacle, PlacementSpec } from '../plan2d/furniturePlacement';
import { WET_ROOM_TYPES, catalogItem, clampSize, placementSize } from '../furniture/catalog';
import type { FurnitureItem, Id, MergedRoom, OpeningHost, OpeningType, Project, Room, RoomType, Site, Tree, Variant, Vec2, Wall } from '../model/types';
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
   * Let furniture backed onto a moved wall face follow it (`followWallFaces`, default true). Off for whole-block moves
   * and turns (last fix round, fifth review): the block carries its own furniture, and nothing else follows its walls
   * (the house's armchair backed onto a unit standing on the house went along with it).
   */
  follow?: boolean;
  /**
   * Reconcile the rooms (default true). Off for edits that cannot change a room face (openings, the deck, steps, hot
   * tubs, trees, furniture): no derive of the result and no matching inside the action.
   */
  reconcile?: boolean;
  /**
   * Deleted Room records that may come back into unnamed faces (restoreGhost), with the anchors of the rooms alive
   * with them (tombstones from the undo history: a room that took a merged-away room's face gives it back).
   */
  revive?: () => RoomTombstone[];
}

interface RunResult<R> {
  result: R;
  merges: RoomMerge[];
  variant: Variant;
  /** Furniture a whole-block edit pushed out of the block (EditContext.pushed). */
  pushed: Id[];
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
  const pushed: Id[] = [];
  let revived: string[] = [];
  let result: R | undefined;
  const next = produce(from.variant, (draft) => {
    result = recipe(draft as Variant, { base: from.variant, derived: from.derived, carried, pushed });
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
      // Furniture backed onto a wall face that moved goes with it (§4, `followWallFaces`).
      if (opts.follow !== false) final = followWallFaces(base, derived, final, nextDerived);
      if (opts.revive) {
        const fd = deriveOf(site, final);
        // Only into faces this restore changed (last fix round, fifth review: a name merged away days ago came back
        // into a face drawn since, on an unrelated «Ta tilbake»).
        const changedFace = (f: DerivedRoom) => !derived.rooms.some((b) => sameFaceShape(b, f));
        const back = fd ? reviveRoomRecords(final, fd, opts.revive(), changedFace) : { add: [], anchors: new Map<Id, Vec2>() };
        revived = back.add.map((r) => r.name);
        if (back.add.length > 0 || back.anchors.size > 0) {
          final = produce(final, (d) => {
            for (const r of d.rooms) {
              const a = back.anchors.get(r.id);
              if (a) r.anchor = a;
            }
            d.rooms.push(...back.add);
          });
        }
      }
      final = withMergedRooms(final, base, merges, nextDerived, !opts.revive, derived);
    }
  }
  if (final !== current) store.getState().replaceVariant(current.id, final, { transaction: opts.transaction });
  if (opts.toastMerges !== false) mergeToasts(store, merges);
  if (revived.length > 0) store.getState().showToast({ text: EDIT_STRINGS.roomsBack(revived), undo: true });
  return { result: result as R, merges, variant: final, pushed };
}

/** Faces with the same outline (area, bounding box and storey within 1 µm). */
const sameFaceShape = (a: Pick<DerivedRoom, 'area' | 'bbox' | 'storeyId'>, b: Pick<DerivedRoom, 'area' | 'bbox' | 'storeyId'>): boolean =>
  a.storeyId === b.storeyId &&
  Math.abs(a.area - b.area) < 1e-6 &&
  dist(a.bbox.min, b.bbox.min) < 1e-6 &&
  dist(a.bbox.max, b.bbox.max) < 1e-6;

/** The face of `derived` on the storey of `room` whose outline holds its anchor (for `Variant.mergedRooms`). */
function faceAt(v: Variant, derived: DerivedVariant, room: Room): DerivedRoom | undefined {
  const storey = v.levels.find((l) => l.id === room.levelId)?.storeyId;
  return derived.rooms.find((f) => f.storeyId === storey && pointInPolygon(room.anchor, f.facePolygon));
}

/** Whether two bounding boxes meet (touching counts). */
const boxesMeet = (a: { min: Vec2; max: Vec2 }, b: { min: Vec2; max: Vec2 }): boolean =>
  a.min[0] <= b.max[0] && b.min[0] <= a.max[0] && a.min[1] <= b.max[1] && b.min[1] <= a.max[1];

/** How many merged-away rooms a variant keeps (`Variant.mergedRooms`), newest first. */
const MERGED_ROOMS_KEPT = 40;

/** A piece of a split face counts when it holds at least this much of the old face (m²) … */
const SPLIT_PIECE_MIN_AREA = 0.5;
/** … or this share of it. */
const SPLIT_PIECE_MIN_SHARE = 0.15;

/**
 * Whether a new face holding `overlap` m² of an old face of `oldArea` m² is a real piece of a split of it (final
 * morning round): at least SPLIT_PIECE_MIN_AREA or SPLIT_PIECE_MIN_SHARE of it, or with another named room's anchor in
 * it (`named`). A sliver a wall move leaves (w-103-102 0,2 east: 0,39 m² of «Kjøkken» with «Vindfang» merged in) is not.
 */
function substantialPiece(overlap: number, oldArea: number, named: boolean): boolean {
  return named || overlap >= SPLIT_PIECE_MIN_AREA || overlap >= SPLIT_PIECE_MIN_SHARE * oldArea;
}

/**
 * The rooms a merge removed are kept on the variant with the anchors of the rooms of their storey alive with them
 * before the edit (`Variant.mergedRooms`, final fix round after 2b), so "Ta tilbake" can give a merged-away name its
 * face back also after a reload, when the undo history is gone (`roomsFromHistory` covers the session). Rooms that are
 * back are dropped from the list; at most MERGED_ROOMS_KEPT are kept. An edit other than a restore (`prune`; `baseDerived`
 * the model before it, `derived` after it) drops a record only when it splits the face that holds the record's anchor
 * (two or more substantial faces now lie mostly in it — `substantialPiece` —, and the storey has more faces than
 * before) or leaves the anchor in the face
 * of another room that is still there — not when it only reshapes that face (last fix round, sixth review: moving a
 * wall of the merged room dropped the record, so the name was lost after a reload; the revival only into faces the
 * restore changed already keeps an old name out of unrelated faces).
 */
function withMergedRooms(v: Variant, before: Variant, merges: readonly RoomMerge[], derived: DerivedVariant, prune: boolean, baseDerived?: DerivedVariant): Variant {
  const live = new Set(v.rooms.map((r) => r.id));
  const gone = merges.map((m) => m.removed).filter((r, i, all) => !live.has(r.id) && all.findIndex((x) => x.id === r.id) === i);
  const old = v.mergedRooms ?? [];
  const storeyOf = (levelId: Id) => before.levels.find((l) => l.id === levelId)?.storeyId;
  const facesOn = (d: DerivedVariant, storeyId: Id) => d.rooms.filter((f) => f.storeyId === storeyId);
  const roomIn = (x: Variant, f: DerivedRoom) => x.rooms.find((r) => storeyOf(r.levelId) === f.storeyId && pointInPolygon(r.anchor, f.facePolygon));
  const outdated = (m: MergedRoom): boolean => {
    if (!prune || !baseDerived) return false;
    const f0 = faceAt(before, baseDerived, m.room);
    if (!f0) return false;
    const after = facesOn(derived, f0.storeyId);
    if (after.length > facesOn(baseDerived, f0.storeyId).length) {
      const a0 = area(f0.facePolygon);
      const inside = after.filter((g) => {
        const a = area(g.facePolygon);
        if (!(a > 1e-6) || !boxesMeet(g.bbox, f0.bbox)) return false;
        const ov = overlapArea(g.facePolygon, f0.facePolygon);
        return ov >= 0.5 * a && substantialPiece(ov, a0, roomIn(v, g) !== undefined);
      });
      if (inside.length >= 2) return true;
    }
    const f1 = faceAt(before, derived, m.room);
    const r0 = roomIn(before, f0);
    const r1 = f1 ? roomIn(v, f1) : undefined;
    return r0 !== undefined && r1 !== undefined && r1.id !== r0.id && live.has(r0.id);
  };
  const kept = old.filter((m) => !live.has(m.room.id) && !gone.some((r) => r.id === m.room.id) && !outdated(m));
  if (gone.length === 0 && kept.length === old.length) return v;
  const peersOf = (room: Room): Record<Id, Vec2> => {
    const out: Record<Id, Vec2> = {};
    for (const r of before.rooms) if (storeyOf(r.levelId) === storeyOf(room.levelId)) out[r.id] = copy(r.anchor);
    return out;
  };
  const record = (r: Room): MergedRoom => {
    const f = faceAt(before, derived, r);
    const m: MergedRoom = { room: JSON.parse(JSON.stringify(r)) as Room, peers: peersOf(r) };
    if (f) m.face = { area: f.area, min: copy(f.bbox.min), max: copy(f.bbox.max) };
    return m;
  };
  const next: MergedRoom[] = [...gone.map(record), ...kept].slice(0, MERGED_ROOMS_KEPT);
  return produce(v, (d) => {
    if (next.length > 0) d.mergedRooms = next;
    else delete d.mergedRooms;
  });
}

/** The undo history's tombstones (`roomsFromHistory`) and then the variant's stored ones (`Variant.mergedRooms`). */
function roomTombstones(store: EditStore, v: Variant): RoomTombstone[] {
  const out = roomsFromHistory(store);
  const have = new Set([...v.rooms.map((r) => r.id), ...out.map((t) => t.room.id)]);
  for (const m of v.mergedRooms ?? []) {
    if (have.has(m.room.id)) continue;
    have.add(m.room.id);
    out.push({ room: m.room, peers: new Map(Object.entries(m.peers)) });
  }
  return out;
}

/** "«Utebord» er flyttet ut av «Vedskjul»." with Angre: furniture an edit of block `blockId` pushed out of it. */
function pushedToast(store: EditStore, v: Variant, blockId: Id, pushed: readonly Id[]): void {
  if (pushed.length === 0) return;
  const unitName = v.blocks.find((b) => b.id === blockId)?.name ?? '';
  const names = pushed.map((id) => {
    const f = v.furniture.find((x) => x.id === id);
    return f ? (catalogItem(f.catalogId)?.name ?? f.catalogId) : id;
  });
  store.getState().showToast({ text: EDIT_STRINGS.furniturePushedOut(unitName, names), undo: true });
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

/**
 * Deleted Room records of the active variant found in the undo history, newest first, as tombstones: each with the
 * anchors of the rooms alive in the newest past state that still had it (fix round after 2b: geometry/edit.ts
 * `reviveRoomRecords` gives a merged-away room its face back from the room that took it).
 */
function roomsFromHistory(store: EditStore): RoomTombstone[] {
  const s = store.getState();
  const v = selectActiveVariant(s);
  const have = new Set(v.rooms.map((r) => r.id));
  const seen = new Set<Id>();
  const out: RoomTombstone[] = [];
  const past = s.history().past;
  for (let i = past.length - 1; i >= 0; i--) {
    const pv = past[i].variants.find((x) => x.id === v.id);
    let peers: Map<Id, Vec2> | null = null;
    for (const r of pv?.rooms ?? []) {
      if (have.has(r.id) || seen.has(r.id)) continue;
      seen.add(r.id);
      peers ??= new Map((pv?.rooms ?? []).map((x) => [x.id, x.anchor]));
      out.push({ room: r, peers });
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
  let onBlock = false;
  let from: RunOpts['from'];
  let neighbours: NeighbourEnd[] = [];
  let carried: Id[] = [];
  let carriedTo = new Map<Id, { a: Vec2; b: Vec2 }>();
  let newBack = new Map<Id, { a: Vec2; b: Vec2 }>();
  // Corners and T-junctions with other moved walls that stay closed (last fix round, sixth review).
  let junctions: KeptJunction[] = [];
  // Walls no step since the wall was first touched has changed (the undo history): the way back leaves them alone.
  let still: ReadonlySet<Id> = new Set();
  // Moved walls the restored wall's move did not carry (last fix round, fifth review): never moved by the way back.
  let own: ReadonlySet<Id> = new Set();
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
      // end with the endpoint cascades (coincident ends, T-junctions), one end after the other. Continuations the
      // forward step carried sideways stay out of that and go back whole afterwards (fix round after 2b).
      carried = carriedSideways(v, live, g);
      // Walls moved on their own (or carried by another wall's move) stay where they are (last fix round, fifth review).
      // New walls without a ghost that the user moved count as such too (last fix round, sixth review).
      const movedNew = movedNewWalls(v, s.project.variants.find((x) => isLocked(x)), live);
      own = new Set([...notCarriedBy(v, live), ...movedNew.keys()]);
      // New walls without a ghost that this wall's move carried go straight back to where they stood before it.
      newBack = carriedFrom(
        v,
        v.walls.filter((w) => w.status === 'new' && carriedBy(w, live.id) && !v.walls.some((x) => x.id === `${w.id}/ghost`)).map((w) => w.id),
      );
      still = new Set([...unchangedSince(store, v, id), ...carried, ...own, ...joinedOwn(v, live, own), ...newBack.keys()]);
      if (!parallelSame) from = endpointsBack(s.project.site, v, live.id, g, still);
      neighbours = neighbourEnds(v, live, g).filter((n) => !carried.includes(n.wallId));
      carriedTo = carriedFrom(v, carried);
      let shared: ((p: Id, q: Id) => boolean) | undefined;
      const meet = (p: Id, q: Id) => {
        if (!shared) {
          const vd = deriveOf(s.project.site, v);
          shared = vd ? shareStorey(vd) : () => false;
        }
        return shared(p, q);
      };
      junctions = keptJunctions(v, live, g, new Map([...movedNew, ...newBack]), meet);
    }
  }
  const r = run(
    store,
    (d, ctx) => {
      if (ref.type === 'wall') {
        if (parallelSame && ref.original) {
          const g = ctx.base.walls.find((w) => w.id === id);
          const live = ctx.base.walls.find((w) => w.id === ref.original);
          // Like endpointsBack: the walls the forward step did not touch stay (polish round 2b: a move that snapped the
          // wall's end onto a neighbour's corner dragged that neighbour along on the way back).
          if (g && live) applyMoveWall(d, ctx, live.id, sub(g.a, live.a), { keep: new Set([...keepOnMoveBack(ctx.base, live, g), ...still]) });
        }
        const had = d.walls.some((w) => w.id === id && w.status === 'removed');
        const ok = applyRestoreWall(d, id);
        healGhosts(d);
        // Neighbours the forward step left just off the wall's line: their ends back onto the junction too.
        bringBackNeighbours(d, s.project.site, neighbours, own);
        // Continuations it carried along sideways: back whole.
        bringBackCarried(d, s.project.site, carried, own, carriedTo);
        setWallEnds(d, s.project.site, newBack);
        // A corner or T-junction with a wall that stays where the user put it (or goes back to before this wall's move
        // carried it) is closed again: the restored wall ends on its line, its end slides onto the restored wall.
        if (ref.original) closeJunctions(d, s.project.site, ref.original, junctions);
        // The way back is no carry: what its cascades recorded goes (a later move of the wall would chain onto it).
        for (const w of d.walls) {
          const c = w.carriedBy;
          const c0 = v.walls.find((x) => x.id === w.id)?.carriedBy;
          if (c && !(c0 && c0.by === c.by && dist(c0.a, c.a) < 1e-9 && dist(c0.b, c.b) < 1e-9)) delete w.carriedBy;
        }
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
      // A unit against the edge is pushed away with it, or the restore is refused (last fix round, sixth review).
      onBlock = restoreEdgeOnBlock(ctx, id);
      // Refused before anything changes (final morning round: the unit against the edge was pushed away regardless).
      return !onBlock && applyRestoreEdgeGhost(d, ctx, id);
    },
    { revive: () => roomTombstones(store, v), from },
  );
  if (onBlock) unitOnBlockToast(store);
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
 * Each goes to where it stood before `live`'s moves carried it (`Wall.carriedBy.from`), else to its ghost's end
 * (last fix round, sixth review: w-103-korr, moved by the user and then shortened by w-103-102's move, went back to
 * the seed).
 */
function neighbourEnds(v: Variant, live: Wall, g: Wall): NeighbourEnd[] {
  const out: NeighbourEnd[] = [];
  for (const w of v.walls) {
    // Only walls the forward move of `live` carried and that still stand where it left them (final fix round, fourth
    // review: w-103-korr, moved by itself onto w-vf-korr's line, was turned by «Ta tilbake» on w-vf-korr).
    if (w.id === live.id || w.status === 'removed' || !carriedBy(w, live.id)) continue;
    const wg = v.walls.find((x) => x.id === `${w.id}/ghost` && x.status === 'removed');
    if (!wg) continue;
    const from = w.carriedBy?.from;
    for (const end of ['a', 'b'] as const) {
      const to = from ? from[end] : wg[end];
      if (dist(w[end], to) < 1e-9) continue;
      if (distancePointSegment(to, g.a, g.b) > 0.01) continue;
      if (distancePointSegment(w[end], live.a, live.b) > NEIGHBOUR_REACH && !onNominalLine(w[end], live, g)) continue;
      out.push({ wallId: w.id, end, to: copy(to) });
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

/** Wall ends closer than this (m) coincide (geometry/edit.ts COINCIDE). */
const COINCIDE_M = 0.01;
/** How near (m) a coincident wall's line must pass the ghost's end to be one the forward step may have carried. */
const CARRIED_LINE = 0.01;

/**
 * The walls moving `live` back onto its ghost `g` must leave alone (polish round, phase 2b): the untouched existing
 * walls, and NEW walls with an end on one of live's ends whose line does not pass the ghost's matching end — a follower
 * of the forward step kept its direction, so its line still runs through where the end was; one whose line does not
 * was not carried there (the move ended on its corner: w-peis-n −0.7 onto dv-stue-n at (9, 2.2)).
 */
function keepOnMoveBack(v: Variant, live: Wall, g: Wall): Set<Id> {
  const keep = untouched(v);
  for (const w of v.walls) {
    if (w.id === live.id || w.status !== 'new') continue;
    for (const end of ['a', 'b'] as const) {
      const e = (['a', 'b'] as const).find((le) => dist(w[end], live[le]) <= COINCIDE_M);
      if (!e) continue;
      const other = end === 'a' ? w.b : w.a;
      const d = sub(w[end], other);
      const l = Math.hypot(d[0], d[1]);
      const off = l < 1e-12 ? dist(g[e], other) : Math.abs(d[0] * (g[e][1] - other[1]) - d[1] * (g[e][0] - other[0])) / l;
      if (off > CARRIED_LINE) keep.add(w.id);
    }
  }
  return keep;
}

/**
 * Walls whose ends are the same now as in the latest undo-history state from before the ghost `ghostId` existed:
 * neither the step that first touched the wall nor any later one changed them, so the way back must not either (a new
 * divider such as dv-stue-n whose corner the moved w-peis-n landed on). Empty when the history does not reach back.
 */
function unchangedSince(store: EditStore, v: Variant, ghostId: Id): Set<Id> {
  const past = store.getState().history().past;
  for (let i = past.length - 1; i >= 0; i--) {
    const pv = past[i].variants.find((x) => x.id === v.id);
    if (!pv) break;
    if (pv.walls.some((w) => w.id === ghostId)) continue;
    const before = new Map(pv.walls.map((w) => [w.id, w]));
    const out = new Set<Id>();
    for (const w of v.walls) {
      const w0 = before.get(w.id);
      if (w0 && w0.status === w.status && dist(w0.a, w.a) < 1e-9 && dist(w0.b, w.b) < 1e-9) out.add(w.id);
    }
    return out;
  }
  return new Set();
}

/** Drag each neighbour end (that is not back yet) to its ghost end with the endpoint cascades, then heal. */
function bringBackNeighbours(d: Variant, site: Site, neighbours: NeighbourEnd[], own: ReadonlySet<Id> = new Set()): void {
  for (const n of neighbours) {
    const w = d.walls.find((x) => x.id === n.wallId && x.status !== 'removed');
    if (!w || dist(w[n.end], n.to) < 1e-9) continue;
    // An end that a wall moved on its own (`own`) now meets stays with it (last fix round, fifth review: w-103-102
    // dragged back turned w-vf-korr, which the user had moved onto that corner).
    const end = w[n.end];
    if (d.walls.some((x) => own.has(x.id) && x.status !== 'removed' && (dist(x.a, end) <= COINCIDE_M || dist(x.b, end) <= COINCIDE_M))) continue;
    const base = isDraft(d) ? current(d) : (JSON.parse(JSON.stringify(d)) as Variant);
    const derived = deriveOf(site, base);
    if (!derived) continue;
    applyMoveWallEndpoint(d, { base, derived }, n.wallId, n.end, n.to, { keep: new Set([...untouched(base), ...own]) });
    healGhosts(d);
  }
}

/**
 * Whether wall `w` was last moved by a carry of wall `byId`'s move and still stands where that left it (`Wall.carriedBy`,
 * recorded by geometry/edit.ts applyMoveWall / applyMoveWallEndpoint; last fix round, fifth review).
 */
function carriedBy(w: Wall, byId: Id): boolean {
  const c = w.carriedBy;
  return c !== undefined && c.by === byId && dist(c.a, w.a) < 1e-9 && dist(c.b, w.b) < 1e-9;
}

/**
 * Moved walls (new, with a ghost) that `live`'s own move did not leave where they are (`carriedBy`): the user moved them
 * in a step of their own, or another wall's move carried them. "Ta tilbake" on `live` never moves them — in particular
 * not the wall whose move carried `live` (last fix round, fifth review).
 */
function notCarriedBy(v: Variant, live: Wall): Set<Id> {
  const ghosts = new Set(v.walls.filter((w) => w.status === 'removed').map((w) => w.id));
  return new Set(v.walls.filter((w) => w.id !== live.id && w.status === 'new' && ghosts.has(`${w.id}/ghost`) && !carriedBy(w, live.id)).map((w) => w.id));
}

/**
 * Walls the forward step of `live` (ghost `g`) carried along sideways (fix round after 2b, geometry/edit.ts
 * `carryParallel`: a continuation in line, such as the loft piece lw-106-top beside w-106-korr): new, with a ghost
 * that ends on one of g's ends, parallel to that ghost but off its line. "Ta tilbake" keeps them out of the cascades
 * back (an endpoint drag back would turn them) and then moves each back whole (`bringBackCarried`). Only walls that
 * `live`'s move carried and that still stand where it left them (`Wall.carriedBy`, last fix round, fifth review: also
 * after a reload; a wall in line that the user moved in a step of its own — also on another floor — stays where they
 * put it, and so does the wall whose move carried `live`).
 */
function carriedSideways(v: Variant, live: Wall, g: Wall): Id[] {
  const out: Id[] = [];
  for (const w of v.walls) {
    if (w.id === live.id || w.status !== 'new' || !carriedBy(w, live.id)) continue;
    const wg = v.walls.find((x) => x.id === `${w.id}/ghost` && x.status === 'removed');
    const e = wg ? (['a', 'b'] as const).find((k) => dist(wg.a, g[k]) <= COINCIDE_M || dist(wg.b, g[k]) <= COINCIDE_M) : undefined;
    if (!wg || !e) continue;
    const u = sub(w.b, w.a);
    const ug = sub(wg.b, wg.a);
    const lu = Math.hypot(u[0], u[1]);
    const lg = Math.hypot(ug[0], ug[1]);
    if (lu < 1e-9 || lg < 1e-9 || Math.abs(u[0] * ug[1] - u[1] * ug[0]) > 1e-9 * lu * lg) continue;
    const n = leftNormal(unit(ug));
    const across = dot(sub(w.a, wg.a), n);
    if (Math.abs(across) <= 1e-9) continue;
    out.push(w.id);
  }
  return out;
}

/**
 * Where each carried wall among `ids` goes back to: where it stood before the restored wall's moves carried it
 * (`Wall.carriedBy.from`, last fix round, sixth review); a wall without it goes back to its ghost.
 */
function carriedFrom(v: Variant, ids: readonly Id[]): Map<Id, { a: Vec2; b: Vec2 }> {
  const out = new Map<Id, { a: Vec2; b: Vec2 }>();
  for (const w of v.walls) {
    const from = ids.includes(w.id) ? w.carriedBy?.from : undefined;
    if (from) out.set(w.id, { a: copy(from.a), b: copy(from.b) });
  }
  return out;
}

/**
 * Move each carried wall (`carriedSideways`) back across itself onto its ghost's line (applyMoveWall: walls with a
 * T-junction on it follow), then give it its ghost's exact geometry (applyRestoreWall) and heal. A wall with a place
 * from before the carry (`from`, `carriedFrom`) goes back there instead (healed only when that is its ghost).
 */
function bringBackCarried(d: Variant, site: Site, ids: readonly Id[], own: ReadonlySet<Id> = new Set(), from: ReadonlyMap<Id, { a: Vec2; b: Vec2 }> = new Map()): void {
  for (const id of ids) {
    const w = d.walls.find((x) => x.id === id && x.status !== 'removed');
    const wg = d.walls.find((x) => x.id === `${id}/ghost` && x.status === 'removed');
    if (!w || !wg) continue;
    const back = from.get(id);
    const to = back ?? { a: wg.a, b: wg.b };
    const n = leftNormal(unit(sub(to.b, to.a)));
    const across = dot(sub(to.a, w.a), n);
    if (Math.abs(across) > 1e-9) {
      const base = isDraft(d) ? current(d) : (JSON.parse(JSON.stringify(d)) as Variant);
      const derived = deriveOf(site, base);
      if (derived) applyMoveWall(d, { base, derived }, id, scale(n, across), { keep: new Set([...untouched(base), ...own]) });
    }
    const now = d.walls.find((x) => x.id === id && x.status !== 'removed');
    if (back && now) {
      now.a = copy(back.a);
      now.b = copy(back.b);
      delete now.carriedBy;
    } else applyRestoreWall(d, `${id}/ghost`);
    healGhosts(d);
  }
}

/**
 * The variant with the ends of `wallId` dragged back to the ends of its ghost `g` (applyMoveWallEndpoint with its
 * cascades, each end from the state after the other one), and its derived model; undefined when nothing moved.
 */
function endpointsBack(site: Site, v: Variant, wallId: Id, g: Wall, still: ReadonlySet<Id> = new Set()): RunOpts['from'] {
  let cur = v;
  let curDerived = deriveOf(site, cur);
  for (const end of ['a', 'b'] as const) {
    const w = cur.walls.find((x) => x.id === wallId);
    if (!w || !curDerived || dist(w[end], g[end]) < 1e-9) continue;
    const ctx: EditContext = { base: cur, derived: curDerived };
    const keep = new Set([...untouched(cur), ...still]);
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

/**
 * How two walls meet: an end of each at one point ('corner'), an end of the first on the second ('onOther') or an end
 * of the second on the first ('onFirst'), within 1 cm; null when they do not meet or run in line.
 */
type Meeting = { kind: 'corner'; end: 'a' | 'b'; otherEnd: 'a' | 'b' } | { kind: 'onOther'; end: 'a' | 'b' } | { kind: 'onFirst'; otherEnd: 'a' | 'b' };

function meeting(w: Pick<Wall, 'a' | 'b'>, x: Pick<Wall, 'a' | 'b'>): Meeting | null {
  const dw = sub(w.b, w.a);
  const dx = sub(x.b, x.a);
  const lw = Math.hypot(dw[0], dw[1]);
  const lx = Math.hypot(dx[0], dx[1]);
  if (lw < 1e-9 || lx < 1e-9 || Math.abs(dw[0] * dx[1] - dw[1] * dx[0]) <= Math.sin((5 * Math.PI) / 180) * lw * lx) return null;
  for (const end of ['a', 'b'] as const) for (const otherEnd of ['a', 'b'] as const) if (dist(w[end], x[otherEnd]) <= COINCIDE_M) return { kind: 'corner', end, otherEnd };
  for (const end of ['a', 'b'] as const) if (distancePointSegment(w[end], x.a, x.b) <= COINCIDE_M) return { kind: 'onOther', end };
  for (const otherEnd of ['a', 'b'] as const) if (distancePointSegment(x[otherEnd], w.a, w.b) <= COINCIDE_M) return { kind: 'onFirst', otherEnd };
  return null;
}

/**
 * Whether two stored walls reach a common storey (their derived pieces): a partition running on through the loft meets
 * the loft's walls there.
 */
function shareStorey(derived: DerivedVariant): (p: Id, q: Id) => boolean {
  const storeys = new Map<Id, Set<Id>>();
  for (const dw of derived.walls) {
    if (dw.source.kind !== 'wall') continue;
    const set = storeys.get(dw.source.wallId) ?? new Set<Id>();
    for (const st of dw.storeyIds) set.add(st);
    storeys.set(dw.source.wallId, set);
  }
  return (p, q) => [...(storeys.get(p) ?? [])].some((st) => storeys.get(q)?.has(st) === true);
}

/** A meeting of the restored wall with another moved wall that "Ta tilbake" keeps closed (`closeJunctions`). */
type KeptJunction = Meeting & { wallId: Id };

/**
 * The corners and T-junctions of the moved wall `live` (ghost `g`) with other moved walls (new, with a ghost, on a
 * storey `live` reaches too: `meet`; not in line) that were there before the move (the two ghosts meet) and still are:
 * "Ta tilbake" keeps them closed (`closeJunctions`; last fix round, sixth review). A meeting the move made (its end
 * snapped onto a corner) is not one. A moved new wall without a ghost (`movedNew`) counts with its place in the base proposal, or where it stood
 * before this wall's move carried it; an end of that place on the ghost's line, no farther from the ghost than the
 * wall moved, counts as meeting it (the ghost is from before an earlier carry: dv-kjk-w, carried by dv-stue-n).
 */
function keptJunctions(v: Variant, live: Wall, g: Wall, movedNew: ReadonlyMap<Id, Pick<Wall, 'a' | 'b'>>, meet: (p: Id, q: Id) => boolean): KeptJunction[] {
  const reach = Math.max(dist(live.a, g.a), dist(live.b, g.b)) + COINCIDE_M;
  const gn = leftNormal(unit(sub(g.b, g.a)));
  const nearLine = (p: Vec2) => Math.abs(dot(sub(p, g.a), gn)) <= COINCIDE_M && distancePointSegment(p, g.a, g.b) <= reach;
  const out: KeptJunction[] = [];
  for (const x of v.walls) {
    if (x.id === live.id || x.status !== 'new') continue;
    const xg = v.walls.find((y) => y.id === `${x.id}/ghost` && y.status === 'removed');
    const xo = xg ?? movedNew.get(x.id);
    if (!xo || !(meeting(g, xo) || (!xg && (nearLine(xo.a) || nearLine(xo.b))))) continue;
    const m = meeting(live, x);
    if (m && meet(live.id, x.id)) out.push({ ...m, wallId: x.id });
  }
  return out;
}

/**
 * New walls without a ghost (in the base proposal already, such as the divider dv-stue-n) that the user moved: their
 * place in the locked base proposal `reference` (Forslag D) differs, and no move of `live` left them where they are;
 * each with that place. "Ta tilbake" on `live` treats them as moved walls with a ghost (last fix round, sixth review).
 */
function movedNewWalls(v: Variant, reference: Variant | undefined, live: Wall): Map<Id, Wall> {
  const out = new Map<Id, Wall>();
  if (!reference || reference.id === v.id) return out;
  const ghosts = new Set(v.walls.filter((w) => w.status === 'removed').map((w) => w.id));
  for (const w of v.walls) {
    if (w.id === live.id || w.status !== 'new' || ghosts.has(`${w.id}/ghost`) || carriedBy(w, live.id)) continue;
    const r = reference.walls.find((x) => x.id === w.id && x.status === 'new');
    if (r && (dist(r.a, w.a) > 1e-9 || dist(r.b, w.b) > 1e-9)) out.set(w.id, r);
  }
  return out;
}

/**
 * Walls the move of `live` carried whose carried end (on `live`) another moved wall in `own` now also ends at: they
 * stay with that wall on the way back (last fix round, sixth review: w-103-102, carried by w-103-korr, went back and
 * left w-vf-korr — moved in line by the user — dangling at their corner).
 */
function joinedOwn(v: Variant, live: Wall, own: ReadonlySet<Id>): Id[] {
  const ownEnds = v.walls.filter((w) => own.has(w.id) && w.status !== 'removed').flatMap((w) => [w.a, w.b]);
  return v.walls
    .filter(
      (x) =>
        x.id !== live.id &&
        x.status === 'new' &&
        !own.has(x.id) &&
        (['a', 'b'] as const).some((e) => distancePointSegment(x[e], live.a, live.b) <= COINCIDE_M && ownEnds.some((p) => dist(p, x[e]) <= COINCIDE_M)),
    )
    .map((x) => x.id);
}

/**
 * After "Ta tilbake" on wall `wallId`: each junction of `junctions` that came apart is closed again (last fix round,
 * sixth review: «Ta tilbake» on one of two walls meeting at a corner, both moved by the user, opened the corner — two
 * rooms merged and a wall dangled). A corner: both ends go to where the two lines cross (the restored wall keeps its
 * line, the other its place); the restored wall's end on the other: onto its line; the other's end on the restored
 * wall: along its own line onto it. Never turns a wall round or makes it shorter than 5 cm.
 */
function closeJunctions(d: Variant, site: Site, wallId: Id, junctions: readonly KeptJunction[]): void {
  if (junctions.length === 0) return;
  const base = isDraft(d) ? current(d) : (JSON.parse(JSON.stringify(d)) as Variant);
  const w0 = base.walls.find((x) => x.id === wallId && x.status !== 'removed');
  if (!w0) return;
  // The derived model, only when a junction came apart (most restores leave every one closed).
  let derived: DerivedVariant | null | undefined;
  const derivedNow = () => (derived === undefined ? (derived = deriveOf(site, base)) : derived);
  let shared: ((p: Id, q: Id) => boolean) | undefined;
  const meet = (p: Id, q: Id) => {
    const dv = derivedNow();
    shared ??= dv ? shareStorey(dv) : () => false;
    return shared(p, q);
  };
  // The live walls as the closing so far leaves them (each junction sees the ones before it).
  const now = new Map(base.walls.filter((x) => x.status !== 'removed').map((x) => [x.id, { a: copy(x.a), b: copy(x.b) }]));
  const ends = new Map<Id, { a?: Vec2; b?: Vec2 }>();
  const set = (id: Id, end: 'a' | 'b', p: Vec2) => {
    ends.set(id, { ...ends.get(id), [end]: copy(p) });
    const g = now.get(id);
    if (g) g[end] = copy(p);
  };
  // The end `end` of `x` at p: still pointing the same way from its other end, and at least 5 cm long.
  const fits = (x: Pick<Wall, 'a' | 'b'>, end: 'a' | 'b', p: Vec2) => {
    const other = end === 'a' ? x.b : x.a;
    return dot(sub(p, other), sub(x[end], other)) > 0 && dist(p, other) >= 0.05;
  };
  // Another wall on a storey that wall `of` reaches, not in line with it, ends at q (an end there does not dangle).
  const heldAt = (q: Vec2, of: Id, not: readonly Id[]) => {
    const g = now.get(of);
    return (
      g !== undefined &&
      [...now].some(([id, y]) => !not.includes(id) && meet(of, id) && meeting(g, y) !== null && (dist(y.a, q) <= COINCIDE_M || dist(y.b, q) <= COINCIDE_M))
    );
  };
  const on = (p: Vec2, s: Pick<Wall, 'a' | 'b'>) => distancePointSegment(p, s.a, s.b) <= COINCIDE_M;
  for (const j of junctions) {
    const w = now.get(wallId);
    const x = now.get(j.wallId);
    if (!w || !x) continue;
    const pair = [wallId, j.wallId];
    if (j.kind === 'corner') {
      const we = w[j.end];
      const xe = x[j.otherEnd];
      // Closed: the ends still meet, or one ends on the other while another wall holds the end left over (a corner of
      // three: w-104-diag and w-105-106 at w-106-korr's end).
      if (dist(we, xe) <= COINCIDE_M || (on(xe, w) && heldAt(we, wallId, pair)) || (on(we, x) && heldAt(xe, j.wallId, pair))) continue;
    } else if (j.kind === 'onOther' ? on(w[j.end], x) : on(x[j.otherEnd], w)) continue;
    const p = intersectLines(w.a, sub(w.b, w.a), x.a, sub(x.b, x.a));
    if (!p) continue;
    if (j.kind === 'corner') {
      // The other wall's end is held by another wall (w-103-102 meeting w-vf-korr, moved in line by the user): it stays;
      // the restored wall's end goes onto the other wall where the crossing lies on it.
      if (heldAt(x[j.otherEnd], j.wallId, pair)) {
        if (!heldAt(w[j.end], wallId, pair) && fits(w, j.end, p) && on(p, x)) set(wallId, j.end, p);
        continue;
      }
      if (!fits(x, j.otherEnd, p)) continue;
      // Another wall still holds the restored wall's end (w-104-diag at w-104-103's end): where the crossing lies on the
      // restored wall, only the other wall's end goes onto it (a T-junction).
      if (heldAt(w[j.end], wallId, pair) && on(p, w)) {
        set(j.wallId, j.otherEnd, p);
        continue;
      }
      if (!fits(w, j.end, p)) continue;
      set(wallId, j.end, p);
      set(j.wallId, j.otherEnd, p);
    } else if (j.kind === 'onOther') {
      if (fits(w, j.end, p) && on(p, x)) set(wallId, j.end, p);
    } else if (fits(x, j.otherEnd, p) && on(p, w)) {
      set(j.wallId, j.otherEnd, p);
    }
  }
  if (ends.size === 0) return;
  const dv = derivedNow();
  if (dv) setWallEnds(d, site, ends, { base, derived: dv });
}

/**
 * Give stored walls of the draft new ends (geometry/edit.ts `applyWallEnds`, from the draft as it is: `ctx` when the
 * caller has it), then heal.
 */
function setWallEnds(d: Variant, site: Site, ends: ReadonlyMap<Id, { a?: Vec2; b?: Vec2 }>, ctx?: EditContext): void {
  if (ends.size === 0) return;
  const base = ctx?.base ?? (isDraft(d) ? current(d) : (JSON.parse(JSON.stringify(d)) as Variant));
  const derived = ctx?.derived ?? deriveOf(site, base);
  if (!derived) return;
  applyWallEnds(d, { base, derived }, ends);
  for (const id of ends.keys()) {
    const w = d.walls.find((x) => x.id === id && x.status !== 'removed');
    if (w) delete w.carriedBy;
  }
  healGhosts(d);
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/**
 * "Bygget kan ikke stå oppå et annet bygg." (no Angre): a unit edit refused or stopped against another building; or
 * `text` (`onBlockText`).
 */
function unitOnBlockToast(store: EditStore, text: string = EDIT_STRINGS.unitOnBlock): void {
  store.getState().showToast({ text: `${text}.` });
}

/**
 * The hint / toast text for a block edit stopped by a unit (`blockEdgeMoveClamp`, `blockVertexMoveClamp`): a house edge
 * or corner that cannot move at all because a unit stands against it names the unit and what to do (final morning
 * round: «Vedskjul» står inntil veggen – flytt det først); otherwise EDIT_STRINGS.unitOnBlock.
 */
function onBlockText(base: Variant, clamp: { k: number; unitId?: Id }): string {
  const unit = clamp.k === 0 && clamp.unitId !== undefined ? base.blocks.find((b) => b.id === clamp.unitId) : undefined;
  return unit ? EDIT_STRINGS.unitInTheWay(unit.name) : EDIT_STRINGS.unitOnBlock;
}

/**
 * Move a block edge. Where a template unit would end up on another building the edge stops against it, or the move is
 * refused, with the toast (last fix round, fifth review; geometry/edit.ts `blockEdgeMoveClamp`; a house edge a unit
 * stands against names the unit: `onBlockText`); terrace furniture a unit's edge now covers is pushed out of it, with
 * the `placeUnit` toast.
 */
export function moveBlockEdge(store: EditStore, blockId: Id, edgeId: Id, delta: Vec2, opts: { transaction?: string } = {}): boolean {
  let onBlock = false;
  let text: string = EDIT_STRINGS.unitOnBlock;
  const r = run(
    store,
    (d, ctx) => {
      const clamp = blockEdgeMoveClamp(ctx, blockId, edgeId, delta);
      onBlock = clamp.onBlock;
      text = onBlockText(ctx.base, clamp);
      return applyMoveBlockEdge(d, ctx, blockId, edgeId, delta);
    },
    opts,
  );
  if (onBlock) unitOnBlockToast(store, text);
  if (r?.result === true) pushedToast(store, r.variant, blockId, r.pushed);
  return changed(r);
}

/** Move a block corner; as `moveBlockEdge` for a unit that would end up on another building and for terrace furniture. */
export function moveBlockVertex(store: EditStore, blockId: Id, vertexId: Id, p: Vec2, opts: { transaction?: string } = {}): boolean {
  let onBlock = false;
  let text: string = EDIT_STRINGS.unitOnBlock;
  const r = run(
    store,
    (d, ctx) => {
      const clamp = blockVertexMoveClamp(ctx, blockId, vertexId, p);
      onBlock = clamp.onBlock;
      text = onBlockText(ctx.base, clamp);
      return applyMoveBlockVertex(d, ctx, blockId, vertexId, p);
    },
    opts,
  );
  if (onBlock) unitOnBlockToast(store, text);
  if (r?.result === true) pushedToast(store, r.variant, blockId, r.pushed);
  return changed(r);
}

/**
 * Move a whole block; refused (toast) for a block with existing area. Furniture it now stands on and did not own is
 * pushed out of it, with the toast of `placeUnit` (final fix round after 2b; geometry/edit.ts `pushFurnitureOut`). A
 * template unit never ends up on another building (last fix round, fifth review): the move stops at the contact, or
 * is refused, with the toast `unitOnBlock` (geometry/edit.ts `unitMoveFraction`); nothing follows its walls.
 */
export function moveBlock(store: EditStore, blockId: Id, delta: Vec2, opts: { transaction?: string } = {}): boolean {
  const v = editable(store);
  if (!v) return false;
  const block = v.blocks.find((b) => b.id === blockId);
  if (block && blockHasExistingArea(block)) {
    store.getState().showToast({ text: EDIT_STRINGS.existingBlockMove });
    return false;
  }
  let onBlock = false;
  const r = run(
    store,
    (d, ctx) => {
      const b0 = ctx.base.blocks.find((b) => b.id === blockId);
      const t = b0 ? unitMoveFraction(ctx.base, b0.polygon.map((x) => x.p), delta, b0) : 1;
      onBlock = t < 1;
      return t > 0 ? applyMoveBlock(d, ctx, blockId, scale(delta, t)) : false;
    },
    { ...opts, follow: false },
  );
  if (onBlock) unitOnBlockToast(store);
  if (r?.result === true) pushedToast(store, r.variant, blockId, r.pushed);
  return changed(r, (x) => x === true);
}

/** How far (m) "Roter 90°" shifts a turned unit to keep it off another building (else the turn is refused). */
const TURN_CLEAR_REACH = 0.25;

/**
 * Turn a placed unit (a block with a template) a quarter turn about its centre: 90 = counter-clockwise, −90 =
 * clockwise; snapped to the 0.1 m grid (one off the grid keeps its centre and offset: +90 / −90 give it back
 * exactly; one against a wall or deck edge keeps that contact); its walls, openings, rooms and furniture turn with it
 * (geometry/edit.ts applyRotateBlock). Refused with the toast for a block with existing area (like moveBlock); false for a drawn block
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
  const turn = q === 1 ? 90 : -90;
  let onBlock = false;
  const r = run(
    store,
    (d, ctx) => {
      // Never onto another building (last fix round, fifth review): shifted clear when that is a short way, else refused.
      const b0 = ctx.base.blocks.find((b) => b.id === blockId);
      const turned = turnedAxis(ctx, blockId, turn);
      let shift: Vec2 | undefined;
      if (b0 && turned && unitOverlaps(ctx.base, turned, b0)) {
        shift = unitClearShift(ctx.base, turned, TURN_CLEAR_REACH, b0) ?? undefined;
        if (!shift) {
          onBlock = true;
          return false;
        }
      }
      return applyRotateBlock(d, ctx, blockId, turn, { shift });
    },
    { follow: false },
  );
  if (onBlock) unitOnBlockToast(store);
  if (r?.result === true) pushedToast(store, r.variant, blockId, r.pushed);
  return changed(r, (x) => x === true);
}

/**
 * Place a unit from a template, centred on `at`, turned by `rotation90` quarter turns. Returns the new block id.
 * Furniture that stood there is pushed out of the unit (geometry/edit.ts `pushFurnitureOut`; only what stands outside
 * every block, never the house's furniture), with a toast that names it ("«Utebord» er flyttet ut av
 * «Vedskjul».", Angre undoes the placement). A shed placed with its open front against a block turns half round.
 */
export function placeUnit(store: EditStore, templateId: string, at: Vec2, rotation90 = 0): Id | null {
  const v = editable(store);
  if (!v) return null;
  // Never on another building (last fix round, fifth review): `snapPoint` shifts the ghost clear when it can; a unit
  // that would still stand on one is refused with the toast (attached along a wall is fine).
  const t = unitTemplate(templateId);
  if (t && unitOverlaps(v, unitFootprint(t, at, rotation90), null)) {
    unitOnBlockToast(store);
    return null;
  }
  const r = run(store, (d, ctx) => applyPlaceUnit(d, ctx, templateId, at, rotation90));
  if (r?.result) pushedToast(store, r.variant, r.result.blockId, r.result.pushedFurniture ?? []);
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
  const ok = changed(run(store, (d, ctx) => applyDeleteBlock(d, blockId, ctx)), (x) => x === true);
  if (ok) deletedToast(store);
  return ok;
}

export function setBlockProps(store: EditStore, blockId: Id, patch: BlockPatch): boolean {
  return changed(run(store, (d) => applySetBlockProps(d, blockId, patch)));
}

/**
 * Bredde / Dybde of a block: moves the east / north edge (`side` 'max', default) or the west / south one. A unit grown
 * over terrace furniture pushes it out, with the `placeUnit` toast (last fix round, fifth review). A unit standing
 * against a building with that edge changes on its free side instead and never moves the building; growing into one
 * is refused with the toast `unitOnBlock` (geometry/edit.ts `blockSizeMove`; last fix round, sixth review). A unit made
 * narrower than its own opening narrows that opening to fit, with a toast (geometry/edit.ts `fitUnitOpenings`).
 */
export function setBlockSize(store: EditStore, blockId: Id, axis: 'w' | 'd', value: number, side: 'min' | 'max' = 'max'): boolean {
  let onBlock = false;
  let text: string = EDIT_STRINGS.unitOnBlock;
  let narrowed: Id[] = [];
  const r = run(store, (d, ctx) => {
    const m = blockSizeMove(ctx, blockId, axis, value, side);
    const clamp = m !== null ? blockEdgeMoveClamp(ctx, blockId, m.edgeId, m.delta) : null;
    onBlock = clamp?.onBlock === true;
    if (clamp) text = onBlockText(ctx.base, clamp);
    const ok = applySetBlockSize(d, ctx, blockId, axis, value, side);
    // A unit made narrower: its own openings narrower too, to fit its walls (final morning round).
    if (ok) narrowed = fitUnitOpenings(d, blockId);
    return ok;
  });
  if (onBlock) unitOnBlockToast(store, text);
  if (r?.result === true) pushedToast(store, r.variant, blockId, r.pushed);
  if (r?.result === true && narrowed.length > 0) {
    const name = r.variant.blocks.find((b) => b.id === blockId)?.name ?? '';
    store.getState().showToast({ text: EDIT_STRINGS.unitOpeningsNarrowed(name, narrowed.length), undo: true });
  }
  return changed(r);
}

/** Gap (m) between a unit and its copy when the copy goes beside it (`duplicateBlock`). */
const COPY_GAP = 0.5;

/**
 * Copy a block (and what stands in it) `delta` away (default 1 m east and 1 m north); returns the copy's id. A copy of
 * a template unit that would stand on a building there (the unit itself, at the default delta) goes beside the unit
 * instead — east, south, west or north, COPY_GAP away — or is refused with the toast `unitOnBlock` (last fix round,
 * fifth review: a unit never stands on another building).
 */
export function duplicateBlock(store: EditStore, blockId: Id, delta: Vec2 = [1, 1]): Id | null {
  const v = editable(store);
  if (!v) return null;
  const b = v.blocks.find((x) => x.id === blockId);
  let at = delta;
  if (b) {
    const axis = b.polygon.map((x) => x.p);
    // The copy is another block: the original is in its way too.
    const clear = (d: Vec2) => !unitOverlaps(v, axis.map((p) => add(p, d)), { id: '', template: b.template });
    if (!clear(at)) {
      const xs = axis.map((p) => p[0]);
      const ys = axis.map((p) => p[1]);
      const w = Math.max(...xs) - Math.min(...xs) + COPY_GAP;
      const h = Math.max(...ys) - Math.min(...ys) + COPY_GAP;
      const beside = ([[w, 0], [0, -h], [-w, 0], [0, h]] as Vec2[]).find(clear);
      if (!beside) {
        unitOnBlockToast(store);
        return null;
      }
      at = beside;
    }
  }
  return run(store, (d) => applyDuplicateBlock(d, blockId, at))?.result ?? null;
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
// Furniture (docs/phase2-plan.md §4; derived by geometry/furnitureDerive.ts)
// ---------------------------------------------------------------------------

/** Furniture edits never change a room face: no room reconciliation (and no derive of the result) in the action. */
const FURNITURE_RUN: RunOpts = { reconcile: false };

const normDeg = (deg: number): number => ((deg % 360) + 360) % 360;

/** The storey an item is on (its stored level's storey), else the first storey. */
function storeyOfItem(derived: DerivedVariant, levelId: Id): Id {
  return derived.levels.find((l) => l.id === levelId)?.storeyId ?? derived.storeys[0]?.id ?? '';
}

/**
 * Move an item to `p` inside a recipe: the position, and the level of the floor under it on the item's storey
 * (`levelAt`; a bed dragged from Korridor (øvre) into Soverom 1 goes to 'lower'). The furniture drag uses it too.
 * False when unchanged or unknown.
 */
export function applyFurnitureMove(draft: Variant, derived: DerivedVariant, furnitureId: Id, p: Vec2): boolean {
  const f = draft.furniture.find((x) => x.id === furnitureId);
  if (!f || dist(f.position, p) < 1e-9) return false;
  f.position = copy(p);
  const levelId = levelAt(derived, storeyOfItem(derived, f.levelId), p);
  if (levelId !== f.levelId) f.levelId = levelId;
  return true;
}

/** New size of an item keeping its back edge (local +y) in place: the centre moves by half the depth change. */
function resizeKeepingBack(f: FurnitureItem, size: FurnitureItem['size']): boolean {
  const old = f.size;
  if (old && Math.abs(old.w - size.w) < 1e-9 && Math.abs(old.d - size.d) < 1e-9 && Math.abs(old.h - size.h) < 1e-9) return false;
  const shift = ((old?.d ?? size.d) - size.d) / 2;
  if (Math.abs(shift) > 1e-12) {
    const t = (f.rotationDeg * Math.PI) / 180;
    f.position = [f.position[0] - shift * Math.sin(t), f.position[1] + shift * Math.cos(t)];
  }
  f.size = { w: size.w, d: size.d, h: size.h };
  return true;
}

/**
 * Place an item. Size: `opts.size`, else the catalogue preset `opts.sizeVariant` (else the entry's default preset;
 * written into the item, so later catalogue changes never resize it). An unknown catalogue id gets 1 × 1 × 1 m and
 * derives as a plain box with 'furniture-unknown'. Level: `opts.levelId`, else the floor under `position` on the plan
 * storey (`levelAt`). Returns the new id (null when refused: read-only, or the locked Forslag D with its toast).
 */
export function addFurniture(
  store: EditStore,
  catalogId: string,
  position: Vec2,
  opts: { levelId?: Id; size?: FurnitureItem['size']; rotationDeg?: number; sizeVariant?: string; colour?: string } = {},
): Id | null {
  const storeyId = store.getState().ui.planStorey;
  const preset = placementSize(catalogId, opts.sizeVariant);
  return (
    run(
      store,
      (d, ctx) =>
        applyAddFurniture(d, {
          catalogId,
          position,
          levelId: opts.levelId ?? levelAt(ctx.derived, storeyId, position),
          size: opts.size ?? preset?.size,
          rotationDeg: normDeg(opts.rotationDeg ?? 0),
          sizeVariant: opts.sizeVariant ?? preset?.sizeVariant,
          colour: opts.colour,
        }),
      FURNITURE_RUN,
    )?.result ?? null
  );
}

/** Move an item's centre to `p` (its level follows the floor under it, see `applyFurnitureMove`). */
export function moveFurniture(store: EditStore, furnitureId: Id, p: Vec2, opts: { transaction?: string } = {}): boolean {
  return changed(run(store, (d, ctx) => applyFurnitureMove(d, ctx.derived, furnitureId, p), { ...FURNITURE_RUN, ...opts }));
}

/** Turn an item about its centre by `degrees` (counter-clockwise; default a quarter turn), kept in [0, 360). */
export function rotateFurniture(store: EditStore, furnitureId: Id, degrees = 90): boolean {
  return changed(
    run(
      store,
      (d) => {
        const f = d.furniture.find((x) => x.id === furnitureId);
        if (!f || !Number.isFinite(degrees) || normDeg(degrees) === 0) return false;
        f.rotationDeg = normDeg(f.rotationDeg + degrees);
        return true;
      },
      FURNITURE_RUN,
    ),
  );
}

export interface FurniturePatch {
  /** Bredde / Dybde (/ height): stretchable dimensions are clamped into the catalogue's ranges. */
  size?: FurnitureItem['size'];
  /** null removes the colour. */
  colour?: string | null;
  /** A preset key: the item takes the preset's size (unless `size` is given too). */
  sizeVariant?: string;
  /** Another catalogue entry: the item takes its default preset (unless `size` / `sizeVariant` say otherwise). */
  catalogId?: string;
  levelId?: Id;
}

/**
 * Egenskaper for an item. Size changes keep the item's back edge where it is (a cabinet stays against its wall when
 * its depth changes; the width grows about the centre). False when nothing changed (no undo step).
 */
export function setFurnitureProps(store: EditStore, furnitureId: Id, patch: FurniturePatch): boolean {
  return changed(
    run(
      store,
      (d) => {
        const f = d.furniture.find((x) => x.id === furnitureId);
        if (!f) return false;
        let did = false;
        if (patch.catalogId !== undefined && patch.catalogId !== f.catalogId) {
          f.catalogId = patch.catalogId;
          did = true;
          const preset = patch.size ? null : placementSize(patch.catalogId, patch.sizeVariant);
          if (preset) {
            resizeKeepingBack(f, preset.size);
            f.sizeVariant = preset.sizeVariant;
          } else if (!patch.size && patch.sizeVariant === undefined) delete f.sizeVariant;
        }
        if (patch.sizeVariant !== undefined && patch.sizeVariant !== f.sizeVariant) {
          f.sizeVariant = patch.sizeVariant;
          did = true;
          const preset = patch.size ? null : placementSize(f.catalogId, patch.sizeVariant);
          if (preset) resizeKeepingBack(f, preset.size);
        }
        if (patch.size) {
          const wanted = clampSize(catalogItem(f.catalogId), patch.size, f.size ?? patch.size);
          if (resizeKeepingBack(f, wanted)) did = true;
        }
        if (patch.colour !== undefined) {
          if (patch.colour === null) {
            if (f.colour !== undefined) {
              delete f.colour;
              did = true;
            }
          } else if (patch.colour !== f.colour) {
            f.colour = patch.colour;
            did = true;
          }
        }
        if (patch.levelId !== undefined && patch.levelId !== f.levelId) {
          f.levelId = patch.levelId;
          did = true;
        }
        return did;
      },
      FURNITURE_RUN,
    ),
  );
}

/** Grid step (m) and reach (m) of the free-spot search beside an item being duplicated (`duplicatePlacement`). */
const DUP_STEP_M = 0.05;
const DUP_REACH_M = 3;

/** Grid offsets (steps, in the item's own frame) within DUP_REACH_M, nearest first, beside (local x) before in front / behind. */
let dupOffsets: readonly (readonly [number, number])[] | null = null;
function duplicateOffsets(): readonly (readonly [number, number])[] {
  if (dupOffsets) return dupOffsets;
  const n = Math.round(DUP_REACH_M / DUP_STEP_M);
  const out: [number, number][] = [];
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if ((i !== 0 || j !== 0) && i * i + j * j <= n * n) out.push([i, j]);
  out.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]) || Math.abs(a[1]) - Math.abs(b[1]) || b[0] - a[0] || b[1] - a[1]);
  dupOffsets = out;
  return out;
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6 || 0;

/** A copy goes to a neighbouring room only this close (m, centre to centre) to the original (last fix round). */
const DUP_NEIGHBOUR_REACH_M = 3;
/** Openings that lead from one room to another: every door and the frameless opening (not windows). */
const DUP_PASSAGES: ReadonlySet<OpeningType> = new Set<OpeningType>(['door', 'glassDoor', 'slidingDoor', 'saunaDoor', 'opening']);
/** How far (m) beyond each side of an opening's cut through the wall the room there is probed. */
const DUP_PASSAGE_PROBE_M = 0.05;

type DupRoom = DerivedVariant['rooms'][number];

/**
 * The rooms of the storey a door or opening of `room` leads to (no ghosts, no windows): the rooms 5 cm beyond the
 * sides of the opening's cut through the wall, when `room` is one of them. Rooms that only share a wall or a divider
 * with `room` are not among them.
 */
function roomsThroughPassages(derived: DerivedVariant, room: DupRoom, storeyId: Id): DupRoom[] {
  const same = (a: DupRoom, b: DupRoom) => a.id === b.id && a.levelId === b.levelId;
  const rooms = derived.rooms.filter((r) => r.storeyId === storeyId && r.polygon.length >= 3);
  const out: DupRoom[] = [];
  for (const w of derived.walls) {
    if (w.isGhost) continue;
    for (const o of w.openings) {
      const fp = o.footprint;
      if (o.isGhost || !DUP_PASSAGES.has(o.type) || fp.length < 3) continue;
      const c = scale(fp.reduce((s, q) => add(s, q), [0, 0] as Vec2), 1 / fp.length);
      const probes = fp.map((q, i) => {
        const m = scale(add(q, fp[(i + 1) % fp.length]), 0.5);
        return add(m, scale(unit(sub(m, c)), DUP_PASSAGE_PROBE_M));
      });
      const sides = rooms.filter((r) => probes.some((p) => pointInPolygon(p, r.polygon)));
      if (!sides.some((r) => same(r, room))) continue;
      for (const r of sides) if (!same(r, room) && !out.some((x) => same(x, r))) out.push(r);
    }
  }
  return out;
}

/**
 * Where a copy of `item` goes (`duplicateFurniture`): the nearest free spot beside the original, "free" as for a tap
 * in the library (plan2d/furniturePlacement.ts): inside the original's room, clear of the walls, structure, door zones,
 * the other furniture whose height range meets its own, and the original itself.
 *  - back-to-wall / corner items: `tapPlacement` started from the original (the room's wall edges, the free spot
 *    nearest the original first: usually the next spot along the same wall);
 *  - free and flat items, and wall items without a free wall spot: the original's turn, on a 5 cm grid in the item's
 *    own frame around it, nearest first (beside before in front / behind), within DUP_REACH_M; outside the rooms on the
 *    deck the original stands on, if any;
 *  - nothing free in the room (final fix round): the same in a room a door or opening of the room leads to
 *    (`roomsThroughPassages`; last fix round: not a room behind a wall or a divider), nearest the original first, the
 *    copy within DUP_NEIGHBOUR_REACH_M of the original, and never a dry room for an item that needs a drain (no new
 *    'furniture-needs-wet-room'; door zones are obstacles anyway). The copy then gets that room's level (`levelId`),
 *    and `room` names the room (for the toast).
 * Null when nothing is free (`duplicateFurniture` refuses with a toast): a copy never stands in a wall or on another
 * item (before, a full room fell back to a spot that overlapped other furniture, or to a fixed offset into the walls).
 */
export function duplicatePlacement(derived: DerivedVariant, item: FurnitureItem): { position: Vec2; rotationDeg: number; levelId?: Id; room?: DupRoom } | null {
  const df = derived.furniture.find((x) => x.id === item.id);
  if (!df || df.footprint.length < 3) return null;
  const size = { w: item.size?.w ?? 1, d: item.size?.d ?? 1, h: item.size?.h ?? 1 };
  const room = df.roomId === undefined ? null : (derived.rooms.find((r) => r.id === df.roomId && r.levelId === df.levelId) ?? null);
  const storeyId = room?.storeyId ?? derived.levels.find((l) => l.id === df.levelId)?.storeyId;
  if (!storeyId) return null;
  const spec: PlacementSpec = { ...catalogPlacementSpec(item.catalogId, item.sizeVariant), size };
  const z0 = spec.elevation ?? 0;
  const xs = df.footprint.map((q) => q[0]);
  const ys = df.footprint.map((q) => q[1]);
  const own: Obstacle = { id: item.id, polygon: df.footprint, box: { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] } };
  const deck = room ? null : (derived.outdoor.decks.find((dk) => dk.polygon.length >= 3 && pointInPolygon(item.position, dk.polygon)) ?? null);
  const t = (item.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const sn = Math.sin(t);
  const obstacles = [...placementObstacles(derived, storeyId, [z0, z0 + size.h], new Set([item.id]), spec.flat), own];
  const clear = (fp: Vec2[]) => {
    const bx0 = Math.min(...fp.map((q) => q[0]));
    const bx1 = Math.max(...fp.map((q) => q[0]));
    const by0 = Math.min(...fp.map((q) => q[1]));
    const by1 = Math.max(...fp.map((q) => q[1]));
    return !obstacles.some((o) => bx0 < o.box.max[0] && o.box.min[0] < bx1 && by0 < o.box.max[1] && o.box.min[1] < by1 && convexOverlap(fp, o.polygon));
  };
  type DRoom = DerivedVariant['rooms'][number];
  // A free spot in room `r` (null: outside the rooms, on the original's deck if any), nearest the original first;
  // `anywhere`: else wherever the room has one (a neighbouring room beyond the grid's reach); `ok`: where it may stand.
  const spotIn = (r: DRoom | null, anywhere: boolean, ok: (p: Vec2) => boolean = () => true): { position: Vec2; rotationDeg: number } | null => {
    if (r && !spec.flat && spec.mode !== 'free') {
      // Tap placement searches from the room's label point: start it at the original instead.
      const p = tapPlacement(derived, storeyId, spec, item.position, { ...r, labelPoint: item.position });
      if (p.free && ok(p.position)) return { position: p.position, rotationDeg: p.rotationDeg };
    }
    for (const [i, j] of duplicateOffsets()) {
      const u = i * DUP_STEP_M;
      const v = j * DUP_STEP_M;
      const at: Vec2 = [round6(item.position[0] + c * u - sn * v), round6(item.position[1] + sn * u + c * v)];
      if (r && !pointInPolygon(at, r.polygon)) continue;
      if (!ok(at)) continue;
      const fp = rectFootprint(at, item.rotationDeg, size.w, size.d);
      if (r ? !insideRoom(fp, r) : deck && !fp.every((q) => pointInPolygon(q, deck.polygon))) continue;
      if (clear(fp)) return { position: at, rotationDeg: item.rotationDeg };
    }
    if (r && anywhere) {
      const p = tapPlacement(derived, storeyId, spec, r.labelPoint, r);
      if (p.free && ok(p.position)) return { position: p.position, rotationDeg: p.rotationDeg };
    }
    return null;
  };
  const here = spotIn(room, false);
  if (here || !room) return here;
  const away = (r: DRoom) => (pointInPolygon(item.position, r.polygon) ? 0 : Math.min(...r.polygon.map((q, i) => distancePointSegment(item.position, q, r.polygon[(i + 1) % r.polygon.length]))));
  const drain = catalogItem(item.catalogId)?.needsDrain === true;
  const wet = (r: DRoom) => r.room?.type !== undefined && WET_ROOM_TYPES.has(r.room.type);
  const neighbours = roomsThroughPassages(derived, room, storeyId)
    .filter((r) => !drain || wet(r))
    .map((r) => ({ r, d: away(r) }))
    .sort((a, b) => a.d - b.d);
  const close = (p: Vec2) => dist(p, item.position) <= DUP_NEIGHBOUR_REACH_M + 1e-9;
  for (const { r } of neighbours) {
    const there = spotIn(r, true, close);
    if (there) return { ...there, levelId: r.levelId, room: r };
  }
  return null;
}

/**
 * Copy an item (same size, colour and level) to the nearest free spot beside the original (`duplicatePlacement`: a
 * back-to-wall item against the nearest free wall spot, anything else with the original's turn), else in a
 * neighbouring room (with that room's level); returns the copy's id. Final fix round: with no free spot there either,
 * nothing is added and the toast EDIT_STRINGS.duplicateNoSpace says so (before: a fixed 0,3 m offset, into the walls).
 * Last fix round: a copy in another room says where it is (EDIT_STRINGS.copyIn: «Kopien står i «Gang».»).
 */
export function duplicateFurniture(store: EditStore, furnitureId: Id): Id | null {
  let noSpace = false as boolean;
  let elsewhere: DupRoom | null = null;
  const id =
    run(
      store,
      (d, ctx) => {
        const f = d.furniture.find((x) => x.id === furnitureId);
        if (!f) return null;
        const src = ctx.base.furniture.find((x) => x.id === furnitureId);
        const at = src ? duplicatePlacement(ctx.derived, src) : null;
        if (!at) {
          noSpace = true;
          return null;
        }
        elsewhere = at.room ?? null;
        return applyAddFurniture(d, {
          catalogId: f.catalogId,
          position: at.position,
          levelId: at.levelId ?? f.levelId,
          size: { ...f.size },
          rotationDeg: at.rotationDeg,
          sizeVariant: f.sizeVariant,
          colour: f.colour,
        });
      },
      FURNITURE_RUN,
    )?.result ?? null;
  if (noSpace) store.getState().showToast({ text: EDIT_STRINGS.duplicateNoSpace });
  const there = elsewhere as DupRoom | null;
  if (id && there) store.getState().showToast({ text: EDIT_STRINGS.copyIn(there.room?.name?.trim() || null) });
  return id;
}

export function deleteFurniture(store: EditStore, furnitureId: Id): boolean {
  const ok = changed(
    run(
      store,
      (d) => {
        const i = d.furniture.findIndex((x) => x.id === furnitureId);
        if (i < 0) return false;
        d.furniture.splice(i, 1);
        return true;
      },
      FURNITURE_RUN,
    ),
  );
  if (ok) deletedToast(store);
  return ok;
}

/** How near (m) an item's back edge must be to a wall face to move with it, and the overlap it needs along the face. */
const FACE_REACH = 0.01;

/** One identity per physical wall line: a stored wall, or a block edge (all its pieces lie on one line). */
function faceKey(w: DerivedVariant['walls'][number]): string | null {
  if (w.isGhost || w.isDivider || w.footprint.length < 3) return null;
  return w.source.kind === 'wall' ? `w:${w.source.wallId}` : `e:${w.source.blockId}/${w.source.edgeId}`;
}

/**
 * §4 "items following a moved wall face": every item the recipe left alone (same position and turn) whose back edge
 * lies on a face of a wall (≤ 1 cm, overlapping it along the wall by ≥ 1 cm, the item on the room side) moves with that
 * face when the wall's line moves across itself or its thickness changes — stored walls and block edges alike, in the
 * same step (`run` applies it to every reconciled edit, comparing the action's base with its result: wall and edge
 * moves, Bredde / Dybde of rooms, "Ta tilbake" — which so brings the furniture back too). Walls that turned are left
 * alone, and an item never moves onto another level's floor. Pure; returns `after` when nothing moves.
 */
export function followWallFaces(before: Variant, beforeDerived: DerivedVariant, after: Variant, afterDerived: DerivedVariant): Variant {
  if (after.furniture.length === 0) return after;
  const old = new Map(before.furniture.map((f) => [f.id, f]));
  const still = after.furniture.filter((f) => {
    const b = old.get(f.id);
    return b !== undefined && dist(b.position, f.position) < 1e-9 && b.rotationDeg === f.rotationDeg;
  });
  if (still.length === 0) return after;
  const nextByKey = new Map<string, DerivedVariant['walls'][number]>();
  for (const w of afterDerived.walls) {
    const k = faceKey(w);
    if (k && !nextByKey.has(k)) nextByKey.set(k, w);
  }
  const levelOf = new Map(beforeDerived.furniture.map((df) => [df.id, df.levelId]));
  const moves = new Map<Id, Vec2>();
  for (const w of beforeDerived.walls) {
    const k = faceKey(w);
    const nw = k ? nextByKey.get(k) : undefined;
    if (!nw) continue;
    const len = dist(w.a, w.b);
    if (len < 1e-9 || dist(nw.a, nw.b) < 1e-9) continue;
    const u = unit(sub(w.b, w.a));
    const nu = unit(sub(nw.b, nw.a));
    if (Math.abs(u[0] * nu[1] - u[1] * nu[0]) > 1e-6 || dot(u, nu) < 0) continue;
    const n = leftNormal(u);
    const shift = dot(sub(nw.a, w.a), n);
    for (const side of [1, -1] as const) {
      const off = side > 0 ? w.faceLeft : -w.faceRight;
      const delta = shift + (side > 0 ? nw.faceLeft : -nw.faceRight) - off;
      if (Math.abs(delta) < 1e-9) continue;
      for (const f of still) {
        if (moves.has(f.id) || !w.levelIds.includes(levelOf.get(f.id) ?? f.levelId)) continue;
        const [p, q] = backEdge(f);
        if (Math.abs(dot(sub(p, w.a), n) - off) > FACE_REACH || Math.abs(dot(sub(q, w.a), n) - off) > FACE_REACH) continue;
        if (side * (dot(sub(f.position, w.a), n) - off) <= 0) continue;
        const tp = dot(sub(p, w.a), u);
        const tq = dot(sub(q, w.a), u);
        if (Math.min(Math.max(tp, tq), len) - Math.max(Math.min(tp, tq), 0) < FACE_REACH) continue;
        // Never onto another floor (a lower-level bathroom's toilet stays when the edge moves past the floor zone).
        const level = levelOf.get(f.id) ?? f.levelId;
        const to = add(f.position, scale(n, delta));
        if (levelAt(afterDerived, storeyOfItem(afterDerived, f.levelId), to) !== level) continue;
        moves.set(f.id, scale(n, delta));
      }
    }
  }
  if (moves.size === 0) return after;
  // Rounded to the micrometre, so a wall moved there and back puts its furniture back on the same numbers.
  const um = (v: number) => Math.round(v * 1e6) / 1e6;
  return produce(after, (d) => {
    for (const f of d.furniture) {
      const m = moves.get(f.id);
      if (m) f.position = [um(f.position[0] + m[0]), um(f.position[1] + m[1])];
    }
  });
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
  /**
   * The pointer's drag threshold in plan metres at the current zoom (5 px mouse / 10 px touch): unit and block moves
   * reach contact targets that far (geometry/snap.ts `snapPolygon` `contactReach`). Default: 10 / 24 of the snap radius.
   */
  dragThresholdM?: number;
}

export interface DragFeedback {
  indicators: SnapIndicator[];
  chips: DimensionChip[];
  /** The dragged element's outline at the pointer-down base (rings; 2-point rings are segments). */
  ghost: Vec2[][];
  /**
   * A short hint for the plan to show while the drag lasts (final fix round after 2b): a wall drag that is cut short or
   * refused because an end cannot follow (EDIT_STRINGS.wallStuck). Undefined = none.
   */
  hint?: string;
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
  /** Furniture the last update pushed out of a dragged block (toasted by endDrag; final fix round after 2b). */
  pushed?: Id[];
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
  const origin = ((): { point?: Vec2; polygon?: Vec2[]; levelId?: Id } | undefined => {
    switch (target.kind) {
      case 'wall':
      case 'wallEndpoint': {
        const w = variant.walls.find((x) => x.id === target.targetId);
        return w ? { point: copy(target.kind === 'wallEndpoint' && handle === 'b' ? w.b : w.a), levelId: w.levelId } : undefined;
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
  // An end dragged back by hand finds today's point: the ghost walls' ends are point targets (fix round after 2b).
  return buildSnapContext(derived, { storeyId, exclude: target.exclude, origin, ghostEnds: target.kind === 'wallEndpoint' });
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

/**
 * The pointer's drag threshold (5 px mouse, 10 px touch) as a fraction of the snap radius (12 / 24 px), both from
 * plan2d/editModel.ts: the default of `DragModifiers.dragThresholdM`.
 */
const DRAG_THRESHOLD_PER_SNAP_RADIUS = 10 / 24;

/**
 * One drag frame, computed from the base without touching the store (polish round, phase 2b; shared by updateDrag and
 * previewDrag): the snap's overlay, the dragged element's target outline at the snapped pointer, and the edit.
 */
interface DragPlan {
  /** Indicators, chips and the base outline, from the snap alone. */
  feedback: DragFeedback;
  /** The dragged element where this frame puts it (nominally: before the cascades), rings or 2-point segments. */
  target: Vec2[][];
  /** The edit, applied from the base by updateDrag. */
  recipe: (draft: Variant, c: EditContext) => unknown;
  /** updateDrag: the chips from the applied result instead, where a cascade may put the element off its nominal place. */
  resultChips?: (v: Variant) => DimensionChip[];
}

/** previewDrag's answer: the overlay of the frame (as updateDrag returns it) plus the dragged element's target outline. */
export interface DragPreview extends DragFeedback {
  /** The dragged element at the snapped pointer (rings; 2-point rings are segments), to draw until the next updateDrag. */
  target: Vec2[][];
}

export const EMPTY_PREVIEW: DragPreview = { indicators: [], chips: [], ghost: [], target: [] };

/** Intersection of the lines p1 + t·d1 and p2 + s·d2, or null when they are parallel. */
function intersectLines(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}

/** A rectangle-keeping block's polygon with vertex i moved to p (both adjacent edges shift), else the vertex alone. */
function vertexMoved(points: Vec2[], i: number, p: Vec2, keepRect: boolean): Vec2[] {
  const n = points.length;
  if (!keepRect) return points.map((q, k) => (k === i ? copy(p) : copy(q)));
  const v = points[i];
  const d = sub(p, v);
  const prev = (i - 1 + n) % n;
  const sign = signedAreaOf(points) >= 0 ? 1 : -1;
  const out = (k: number): Vec2 => {
    const u = unit(sub(points[(k + 1) % n], points[k]));
    return [u[1] * sign, -u[0] * sign];
  };
  const shift = new Map<number, Vec2>([
    [prev, scale(out(prev), dot(d, out(prev)))],
    [i, scale(out(i), dot(d, out(i)))],
  ]);
  return points.map((q, k) => {
    const sp = shift.get((k - 1 + n) % n);
    const sn = shift.get(k);
    if (!sp && !sn) return copy(q);
    const x = intersectLines(add(q, sp ?? [0, 0]), sub(q, points[(k - 1 + n) % n]), add(q, sn ?? [0, 0]), sub(points[(k + 1) % n], q));
    return x ?? add(add(q, sp ?? [0, 0]), sn ?? [0, 0]);
  });
}

/** Chips of a moved block edge a → b: from its inner face, at the middle, to the nearest wall inside the block. */
function edgeChips(session: DragSession, ctx: SnapContext, blockId: Id, inner: number, sign: number, a: Vec2, b: Vec2): DimensionChip[] {
  const pieces = new Set(
    session.baseDerived.walls.filter((w) => w.source.kind === 'blockEdge' && w.source.blockId === blockId && w.source.edgeId === session.targetId).map((w) => w.id),
  );
  // Inside (left of a CCW edge): from the inner face to the nearest wall.
  const nIn = scale(leftNormal(unit(sub(b, a))), sign);
  const from = add(scale(add(a, b), 0.5), scale(nIn, inner));
  const hit = rayToWall(ctx, from, nIn, { exclude: pieces });
  return hit ? [{ a: from, b: hit.hit, length: hit.t }] : [];
}

/** The frame of a drag for the pointer (see DragPlan), or null when the dragged element is gone. */
function dragPlan(session: DragSession, pointer: Vec2, modifiers: DragModifiers): DragPlan | null {
  const radius = modifiers.snapRadiusM ?? session.radius;
  const fine = modifiers.alt === true;
  const delta = sub(pointer, session.start);
  const ctx = session.snapCtx;
  const base = session.baseVariant;
  switch (session.kind) {
    case 'wall': {
      const w = base.walls.find((x) => x.id === session.targetId);
      const dw = session.baseDerived.walls.find((x) => x.id === session.targetId);
      if (!w) return null;
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
      const fl = dw?.faceLeft ?? w.thickness / 2;
      const fr = dw?.faceRight ?? w.thickness / 2;
      const exclude = new Set([w.id]);
      // The clamp applyMoveWall applies where an end's support runs out (final fix round after 2b): the outline stops
      // where the wall will (or stays, when the move is refused), and the plan gets a hint saying why.
      const t = wallMoveFraction({ base, derived: session.baseDerived }, w.id, d);
      const moved = t < 1 ? scale(d, t) : d;
      const na = add(w.a, moved);
      const nb = add(w.b, moved);
      const feedback: DragFeedback = { indicators, chips: chipsAcross(ctx, na, nb, fl, fr, { exclude }), ghost: [[copy(w.a), copy(w.b)]] };
      if (t < 1) feedback.hint = EDIT_STRINGS.wallStuck;
      return {
        feedback,
        target: [[na, nb]],
        recipe: (dr, c) => applyMoveWall(dr, c, w.id, d),
        resultChips: (v) => {
          const nw = v.walls.find((x) => x.id === w.id) ?? w;
          return chipsAcross(ctx, nw.a, nw.b, fl, fr, { exclude });
        },
      };
    }
    case 'wallEndpoint': {
      const w = base.walls.find((x) => x.id === session.targetId);
      const end = session.handle === 'b' ? 'b' : 'a';
      if (!w) return null;
      const fixed = end === 'a' ? w.b : w.a;
      const sres = snap(ctx, add(w[end], delta), { radius, fine, from: fixed });
      const chipTo = (moved: Vec2): DimensionChip[] => [{ a: copy(fixed), b: copy(moved), length: dist(fixed, moved) }];
      return {
        feedback: { indicators: sres.indicators, chips: chipTo(sres.point), ghost: [[copy(w.a), copy(w.b)]] },
        target: [end === 'a' ? [copy(sres.point), copy(fixed)] : [copy(fixed), copy(sres.point)]],
        recipe: (dr, c) => applyMoveWallEndpoint(dr, c, w.id, end, sres.point),
        resultChips: (v) => chipTo((v.walls.find((x) => x.id === w.id) ?? w)[end]),
      };
    }
    case 'blockEdge': {
      const block = base.blocks.find((b) => b.id === session.ownerId);
      const i = block ? block.polygon.findIndex((x) => x.id === session.targetId) : -1;
      if (!block || i < 0) return null;
      const a = block.polygon[i].p;
      const b = block.polygon[(i + 1) % block.polygon.length].p;
      const nL = leftNormal(unit(sub(b, a)));
      const sres = snapLineOffset(ctx, a, b, dot(delta, nL), { radius, fine, axisOnly: true });
      const shift = scale(nL, sres.offset);
      const inner = block.wall.thickness - block.wall.outerOffset;
      const sign = signedAreaOf(block.polygon.map((x) => x.p)) >= 0 ? 1 : -1;
      // A unit's edge stops against another building (last fix round, fifth review): the outline stops there too.
      const clamp = blockEdgeMoveClamp({ base, derived: session.baseDerived }, block.id, session.targetId, shift);
      const shown = clamp.onBlock ? scale(shift, clamp.k) : shift;
      const [na, nb] = [add(a, shown), add(b, shown)];
      const hint = clamp.onBlock ? { hint: onBlockText(base, clamp) } : {};
      return {
        feedback: { indicators: sres.indicators, chips: edgeChips(session, ctx, block.id, inner, sign, na, nb), ghost: [[copy(a), copy(b)]], ...hint },
        target: [[na, nb]],
        recipe: (dr, c) => applyMoveBlockEdge(dr, c, block.id, session.targetId, shift),
        resultChips: (v) => {
          const moved = v.blocks.find((x) => x.id === block.id);
          const j = moved ? moved.polygon.findIndex((x) => x.id === session.targetId) : -1;
          if (!moved || j < 0) return [];
          return edgeChips(session, ctx, block.id, inner, sign, moved.polygon[j].p, moved.polygon[(j + 1) % moved.polygon.length].p);
        },
      };
    }
    case 'blockVertex': {
      const block = base.blocks.find((b) => b.id === session.ownerId);
      const i = block ? block.polygon.findIndex((x) => x.id === session.targetId) : -1;
      if (!block || i < 0) return null;
      const v = block.polygon[i];
      const sres = snap(ctx, add(v.p, delta), { radius, fine });
      const pts = block.polygon.map((x) => x.p);
      // A unit's corner stops against another building (last fix round, fifth review): the outline stops there too.
      const clamp = blockVertexMoveClamp({ base, derived: session.baseDerived }, block.id, v.id, sres.point);
      // A corner pushed into the building a unit stands against slides along its wall (last fix round, sixth review).
      const shown = clamp.onBlock ? (clamp.point ?? add(v.p, scale(sub(sres.point, v.p), clamp.k))) : sres.point;
      const hint = clamp.onBlock ? { hint: onBlockText(base, clamp) } : {};
      // Gable / mono blocks keep their rectangle (geometry/edit.ts keepsRectangle): both adjacent edges move.
      return {
        feedback: { indicators: sres.indicators, chips: [], ghost: [pts.map(copy)], ...hint },
        target: [vertexMoved(pts, i, shown, block.roof.type !== 'flat')],
        recipe: (dr, c) => applyMoveBlockVertex(dr, c, block.id, v.id, sres.point),
      };
    }
    case 'block': {
      const block = base.blocks.find((b) => b.id === session.ownerId);
      if (!block) return null;
      const poly = block.polygon.map((x) => add(x.p, delta));
      // Contact targets (a block edge it would touch, a deck edge it would stand on) reach the drag threshold too: a
      // shorter drag is a tap, so a phone could not attach a unit otherwise (polish round 2b).
      const contactReach = modifiers.dragThresholdM ?? radius * DRAG_THRESHOLD_PER_SNAP_RADIUS;
      const sres = snapPolygon(ctx, poly, { radius, fine, contactReach });
      let d = add(delta, sres.delta);
      // Never onto another building (last fix round, fifth review): shifted clear within the placement reach (a unit
      // slides along the wall it is pushed into), else stopped where it touches it, with the hint.
      const axis = block.polygon.map((x) => x.p);
      let hint: { hint?: string } = {};
      const at = axis.map((p) => add(p, d));
      if (unitOverlaps(base, at, block)) {
        const clear = unitClearShift(base, at, unitPlacementReach(radius, modifiers.coarse === true), block);
        if (clear) d = add(d, clear);
        else {
          d = scale(d, unitMoveFraction(base, axis, d, block));
          hint = { hint: EDIT_STRINGS.unitOnBlock };
        }
      }
      return {
        feedback: { indicators: sres.indicators, chips: [], ghost: [block.polygon.map((x) => copy(x.p))], ...hint },
        target: [block.polygon.map((x) => add(x.p, d))],
        recipe: (dr, c) => applyMoveBlock(dr, c, block.id, d),
      };
    }
    case 'opening':
      return openingPlan(session, delta, radius, fine);
    case 'openingResize':
      return resizePlan(session, pointer, fine);
    case 'deckVertex': {
      const deck = base.outdoor.decks.find((d) => d.id === session.ownerId);
      const i = deck ? deck.polygon.findIndex((x) => x.id === session.targetId) : -1;
      if (!deck || i < 0) return null;
      const v = deck.polygon[i];
      const sres = snap(ctx, add(v.p, delta), { radius, fine });
      return {
        feedback: { indicators: sres.indicators, chips: sres.chips, ghost: [deck.polygon.map((x) => copy(x.p))] },
        target: [deck.polygon.map((x, k) => (k === i ? copy(sres.point) : copy(x.p)))],
        recipe: (dr) => applyMoveDeckVertex(dr, deck.id, v.id, sres.point),
      };
    }
    case 'deckEdge': {
      const deck = base.outdoor.decks.find((d) => d.id === session.ownerId);
      const i = deck ? deck.polygon.findIndex((x) => x.id === session.targetId) : -1;
      if (!deck || i < 0) return null;
      const a = deck.polygon[i].p;
      const b = deck.polygon[(i + 1) % deck.polygon.length].p;
      const nL = leftNormal(unit(sub(b, a)));
      const sres = snapLineOffset(ctx, a, b, dot(delta, nL), { radius, fine, axisOnly: true });
      const shift = scale(nL, sres.offset);
      return {
        feedback: { indicators: sres.indicators, chips: [], ghost: [[copy(a), copy(b)]] },
        target: [[add(a, shift), add(b, shift)]],
        recipe: (dr) => applyMoveDeckEdge(dr, deck.id, session.targetId, shift),
      };
    }
    case 'deck': {
      const deck = base.outdoor.decks.find((d) => d.id === session.targetId);
      if (!deck) return null;
      const sres = snapPolygon(ctx, deck.polygon.map((x) => add(x.p, delta)), { radius, fine });
      const d = add(delta, sres.delta);
      return {
        feedback: { indicators: sres.indicators, chips: [], ghost: [deck.polygon.map((x) => copy(x.p))] },
        target: [deck.polygon.map((x) => add(x.p, d))],
        recipe: (dr) => applyMoveDeck(dr, deck.id, d),
      };
    }
    case 'steps': {
      const deck = base.outdoor.decks.find((d) => d.id === session.ownerId);
      const st = deck?.steps.find((x) => x.id === session.targetId);
      const i = deck && st ? deck.polygon.findIndex((x) => x.id === st.edgeId) : -1;
      if (!deck || !st || i < 0) return null;
      const a = deck.polygon[i].p;
      const b = deck.polygon[(i + 1) % deck.polygon.length].p;
      const u = unit(sub(b, a));
      const offset = roundTo(st.offset + dot(delta, u), gridStep(fine));
      const c0 = add(a, scale(u, st.offset - st.width / 2));
      const c1 = add(a, scale(u, st.offset + st.width / 2));
      return {
        feedback: { indicators: [], chips: [], ghost: [[c0, c1]] },
        target: [[add(a, scale(u, offset - st.width / 2)), add(a, scale(u, offset + st.width / 2))]],
        recipe: (dr) => applyMoveSteps(dr, st.id, offset),
      };
    }
    case 'hotTub': {
      const t = base.outdoor.hotTubs.find((x) => x.id === session.targetId);
      if (!t) return null;
      const sres = snapCircle(ctx, add(t.centre, delta), t.diameter / 2, { radius, fine });
      return {
        feedback: { indicators: sres.indicators, chips: [], ghost: [circleRing(t.centre, t.diameter / 2)] },
        target: [circleRing(sres.point, t.diameter / 2)],
        recipe: (dr) => {
          const x = dr.outdoor.hotTubs.find((h) => h.id === t.id);
          if (!x) return false;
          x.centre = copy(sres.point);
          return true;
        },
      };
    }
    case 'tree': {
      const t = treesOf(session.base, base).find((x) => x.id === session.targetId);
      if (!t) return null;
      const step = gridStep(fine);
      const p: Vec2 = [roundTo(t.position[0] + delta[0], step), roundTo(t.position[1] + delta[1], step)];
      return {
        feedback: { indicators: [], chips: [], ghost: [circleRing(t.position, 0.5)] },
        target: [circleRing(p, 0.5)],
        recipe: (dr) => {
          if (dist(t.position, p) < 1e-9) return false;
          const x = ownTrees(dr, session.base.site).find((tr) => tr.id === t.id);
          if (x) x.position = p;
          return true;
        },
      };
    }
    case 'furniture': {
      const f = base.furniture.find((x) => x.id === session.targetId);
      const df = session.baseDerived.furniture.find((x) => x.id === session.targetId);
      if (!f) return null;
      const fp = (df?.footprint ?? []).map((q) => add(q, delta));
      const sres = snapFootprint(ctx, fp, { radius, excludeIds: new Set([f.id]) });
      const p = add(add(f.position, delta), sres.delta);
      return {
        feedback: { indicators: sres.indicators, chips: [], ghost: df ? [df.footprint.map(copy)] : [] },
        target: df ? [df.footprint.map((q) => add(add(q, delta), sres.delta))] : [],
        // The stored level follows the floor under the item (Korridor (øvre) → Soverom 1 goes to 'lower'); the base
        // derive is right for it, since a furniture drag changes no floor.
        recipe: (dr) => applyFurnitureMove(dr, session.baseDerived, f.id, p),
      };
    }
  }
}

/**
 * Apply the drag for the pointer position (from the base) and return the feedback to draw. The plan calls it at most
 * every few frames and `previewDrag` in between (the drag-preview contract of the polish round), and always once more
 * before `endDrag`.
 */
export function updateDrag(store: EditStore, session: DragSession | null, pointer: Vec2, modifiers: DragModifiers = {}): DragFeedback {
  if (!session || session.done) return EMPTY_FEEDBACK;
  const plan = dragPlan(session, pointer, modifiers);
  if (!plan) return EMPTY_FEEDBACK;
  // Openings and outdoor things never change a room face: no room reconciliation (and no derive) per frame.
  const runOpts: RunOpts = {
    base: session.baseVariant,
    baseDerived: session.baseDerived,
    toastMerges: false,
    reconcile: !NO_ROOM_DRAGS.has(session.kind),
    // A whole block carries its own furniture; nothing else follows its walls (moveBlock).
    follow: session.kind !== 'block',
  };
  const r = run(store, plan.recipe, runOpts);
  if (r) {
    session.merges = r.merges;
    session.pushed = r.pushed;
  }
  return { ...plan.feedback, chips: plan.resultChips ? plan.resultChips(variantOf(r, session)) : plan.feedback.chips };
}

/**
 * The cheap part of `updateDrag` for every animation frame (drag-preview contract, polish round 2b): the same snap and
 * overlay (`indicators`, `chips`, `ghost` — the chips from the nominal geometry, before the cascades updateDrag
 * applies) plus `target`, the dragged element's outline at the snapped pointer. No store change, no derive (well under
 * 2 ms on the seed). Null / ended sessions give EMPTY_PREVIEW. Bound as `previewDrag(session, pointer, modifiers)`.
 */
export function previewDrag(session: DragSession | null, pointer: Vec2, modifiers: DragModifiers = {}): DragPreview {
  if (!session || session.done) return EMPTY_PREVIEW;
  const plan = dragPlan(session, pointer, modifiers);
  return plan ? { ...plan.feedback, target: plan.target } : EMPTY_PREVIEW;
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

/** An opening dragged along its host, or re-hosted onto another wall / edge near the pointer (see the header). */
function openingPlan(session: DragSession, delta: Vec2, radius: number, fine: boolean): DragPlan | null {
  const base = session.baseVariant;
  const o = base.openings.find((x) => x.id === session.targetId);
  const line = o ? hostLine(base, o.host) : null;
  if (!o || !line) return null;
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
  // Nominally: within the piece of the host under the new centre (applyMoveOpening clamps the same way).
  const [lo, hi] = pieceRange({ base, derived: session.baseDerived }, host, offset) ?? [0, dist(a, b)];
  const nominal = hi - lo >= o.width ? Math.min(hi - o.width / 2, Math.max(lo + o.width / 2, offset)) : (lo + hi) / 2;
  const chipsAt = (h: OpeningHost, at: number): DimensionChip[] => {
    const ids = hostPieceIds(session.baseDerived, h);
    const dw = session.baseDerived.walls.find((w) => ids.has(w.id));
    const hl = hostLine(base, h);
    return hl ? openingChips(session.snapCtx, hl.a, hl.b, at, o.width, ids, dw?.faceLeft ?? 0) : [];
  };
  const u = unit(sub(b, a));
  return {
    feedback: { indicators: [], chips: chipsAt(host, nominal), ghost: derivedOpening && derivedOpening.footprint.length >= 3 ? [derivedOpening.footprint.map(copy)] : [] },
    target: [[add(a, scale(u, nominal - o.width / 2)), add(a, scale(u, nominal + o.width / 2))]],
    recipe: (dr, c) => applyMoveOpening(dr, c, o.id, offset, host),
    resultChips: (v) => {
      const no = v.openings.find((x) => x.id === o.id) ?? o;
      return chipsAt(no.host, no.offset);
    },
  };
}

/** An opening's jamb dragged ('start' / 'end' handle): the other jamb stays, the width changes (min 0.3 m). */
function resizePlan(session: DragSession, pointer: Vec2, fine: boolean): DragPlan | null {
  const base = session.baseVariant;
  const o = base.openings.find((x) => x.id === session.targetId);
  const line = o ? hostLine(base, o.host) : null;
  if (!o || !line) return null;
  const u = unit(sub(line.b, line.a));
  const startSide = session.handle === 'start';
  const fixed = startSide ? o.offset + o.width / 2 : o.offset - o.width / 2;
  const [lo, hi] = pieceRange({ base, derived: session.baseDerived }, o.host, o.offset) ?? [0, line.length];
  let s = roundTo(dot(sub(pointer, line.a), u), gridStep(fine));
  s = startSide ? Math.min(s, fixed - MIN_OPENING_WIDTH) : Math.max(s, fixed + MIN_OPENING_WIDTH);
  s = Math.min(hi, Math.max(lo, s));
  // The width in whole centimetres (fix round after 2b: 0.91 − 0.61 stored 0.3000000000000007); the fixed jamb stays
  // where it was, the centre follows from it (to the micrometre).
  // (Half a centimetre rounds up, after the float noise is gone: 6.5 − 4.855 → 1.65.)
  const width = Math.round(Math.round(Math.abs(fixed - s) * 1e6) / 1e4) / 100;
  if (width < MIN_OPENING_WIDTH - 1e-9) return null;
  const centre = Math.round((startSide ? fixed - width / 2 : fixed + width / 2) * 1e6) / 1e6;
  const j0 = add(line.a, scale(u, o.offset - o.width / 2));
  const j1 = add(line.a, scale(u, o.offset + o.width / 2));
  const n0 = add(line.a, scale(u, centre - width / 2));
  const n1 = add(line.a, scale(u, centre + width / 2));
  return {
    feedback: { indicators: [], chips: [{ a: n0, b: n1, length: width }], ghost: [[j0, j1]] },
    target: [[n0, n1]],
    recipe: (dr) => {
      applySetOpeningProps(dr, o.id, { width });
      const x = dr.openings.find((it) => it.id === o.id);
      if (x) x.offset = centre;
      return true;
    },
  };
}

/** Commit the drag (one undo step) and toast room merges and furniture a dragged block pushed out of it. */
export function endDrag(store: EditStore, session: DragSession | null): void {
  if (!session || session.done) return;
  session.done = true;
  store.getState().commitTransaction();
  mergeToasts(store, session.merges);
  if ((session.kind === 'block' || session.kind === 'blockEdge' || session.kind === 'blockVertex') && session.ownerId && session.pushed?.length) {
    pushedToast(store, selectActiveVariant(store.getState()), session.ownerId, session.pushed);
  }
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
  /**
   * Nytt bygg: the ghost stands on another building and cannot be shifted clear within reach, so a tap there is
   * refused (`placeUnit`): EDIT_STRINGS.unitOnBlock for the hint line (last fix round, fifth review).
   */
  hint?: string;
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

/** The phone's starting zoom is 11,56 px/m; a tap there is no more precise than about this many pixels. */
const UNIT_TOUCH_REACH_PX = 10;
/** … nor than this (m) when zoomed in. */
const UNIT_TOUCH_REACH_MIN_M = 0.25;

/**
 * How far the Nytt bygg placement snaps the unit (m): the pointer's snap radius (12 px / 24 px coarse), but on touch at
 * most max(UNIT_TOUCH_REACH_MIN_M, UNIT_TOUCH_REACH_PX) — fix round after 2b: the full 24 px is 2,07 m at the phone's
 * starting zoom, so a shed tapped anywhere on the deck jumped up to 2 m onto a wall or the deck edge; 10 px (0,87 m
 * there) still attaches a shed tapped 0,4 m from the wing. `radius` = the snap radius in metres (24 px when coarse).
 */
export function unitPlacementReach(radius: number, coarse: boolean): number {
  if (!coarse) return radius;
  const tenPx = radius * (UNIT_TOUCH_REACH_PX / 24);
  return Math.min(radius, Math.max(UNIT_TOUCH_REACH_MIN_M, tenPx));
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
      const reach = unitPlacementReach(radius, opts.modifiers?.coarse === true);
      const sres = snapPolygon(ctx, poly, { radius: reach, fine });
      let at = add(p, sres.delta);
      let indicators = sres.indicators;
      // Never on another building (last fix round, fifth review): shifted clear when that is within reach — or, for a
      // tap outside every building, within half the unit's size, so it stands against the wall it was tapped beside —
      // from the snapped place, else from the tapped one (a snap may have pulled it in); else `placeUnit` refuses it, and
      // `hint` says so while the ghost stands there.
      const v = selectActiveVariant(s);
      let hint: { hint?: string } = {};
      if (unitOverlaps(v, unitFootprint(t, at, opts.rotation90 ?? 0), null)) {
        const outside = !v.blocks.some((b) => pointInPolygon(p, b.polygon.map((x) => x.p)));
        const far = outside ? Math.max(reach, Math.max(t.w, t.d) / 2) : reach;
        const clearOf = (c: Vec2): Vec2 | null => {
          const shift = unitClearShift(v, unitFootprint(t, c, opts.rotation90 ?? 0), far, null);
          return shift ? add(c, shift) : null;
        };
        const snapped = clearOf(at);
        const tapped = snapped ? null : clearOf(p);
        if (snapped) at = snapped;
        else if (tapped) {
          at = tapped;
          indicators = [];
        } else hint = { hint: EDIT_STRINGS.unitOnBlock };
      }
      return {
        point: at,
        kind: indicators.length > 0 ? 'line' : 'grid',
        indicators,
        chips: [],
        ghost: [unitFootprint(t, at, opts.rotation90 ?? 0)],
        ...hint,
      };
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
  // Needs no store (drag-preview contract): bound as previewDrag(session, pointer, modifiers) like the others.
  previewDrag: (_store: EditStore, session: DragSession | null, pointer: Vec2, modifiers?: DragModifiers): DragPreview => previewDrag(session, pointer, modifiers),
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
