/**
 * Picking in the 3D view (pure; docs/phase2-plan.md §3, phase 2a "3D view editing hooks"): what a click on an object
 * selects, which selections light the object up, and when a press counts as a click.
 *
 * Every pickable object carries `PickTags` in `userData` (on the mesh or an ancestor; see sceneUtils.ts):
 * `select` is what a click selects (null: the object is in the way but selects nothing, so a click on it clears the
 * selection), `also` lists further selections made elsewhere (the plan, the schedule) that highlight it too.
 *
 *  - exterior wall piece (DerivedWall.source 'blockEdge') → { kind: 'blockEdge', id: edgeId }: every piece of the edge
 *    lights up; also lit by the plan's piece selection { kind: 'wall', id: piece id } and by its block.
 *  - stored wall (source 'wall') → { kind: 'wall', id: wallId, levelId }.
 *  - opening → { kind: 'opening', id, levelId } (as the plan does).
 *  - room floor → { kind: 'room', id: roomId, levelId }; a door threshold (`${openingId}/threshold…`) → its opening; a
 *    flat ceiling (`${blockId}/ceiling`) → its block; slabs and stairwell floors select nothing.
 *  - roof (slopes and trims) and foundation → { kind: 'block', id: blockId }.
 *  - deck → { kind: 'deck', id }; railing → { kind: 'railing', id: `${deckId}/railing` }; steps → { kind: 'steps', id }
 *    (also lit by their deck); hot tub, structure, tree, furniture → { kind, id }.
 * Ghosts (status 'removed') are never built in 3D, so they can never be picked.
 *
 * Click vs. orbit: a press is a click when only one pointer was down and it moved at most CLICK_TOLERANCE_PX (mouse,
 * pen) / TOUCH_CLICK_TOLERANCE_PX (touch) between down and up (the plan's 5 / 10 px drag thresholds), so orbiting,
 * panning and pinching never select. There is no dragging in 3D in this phase.
 */
import type {
  DerivedDeck,
  DerivedFloor,
  DerivedFurniture,
  DerivedHotTub,
  DerivedOpening,
  DerivedRailing,
  DerivedStructure,
  DerivedSteps,
  DerivedWall,
} from '../model/derived';
import type { Id } from '../model/types';
import type { Selection } from '../state/selection';


export interface PickTags {
  /** What a click on the object selects; null = nothing (a click on it clears the selection). */
  select: Selection | null;
  /** Further selections that highlight the object. */
  also?: Selection[];
}

/** Pointer travel (CSS px) above which a mouse/pen press is a drag (orbit), not a click (plan §3.1: 5 px). */
export const CLICK_TOLERANCE_PX = 5;
/** The same for touch (plan §3.1: 10 px). */
export const TOUCH_CLICK_TOLERANCE_PX = 10;

export function clickTolerancePx(pointerType: string | undefined): number {
  return pointerType === 'touch' ? TOUCH_CLICK_TOLERANCE_PX : CLICK_TOLERANCE_PX;
}

/** Whether a press released at `up` (after starting at `down`) is a click. */
export function isClick(down: { x: number; y: number }, up: { x: number; y: number }, pointerType: string | undefined): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= clickTolerancePx(pointerType);
}

// ---------------------------------------------------------------------------
// Tags per derived object
// ---------------------------------------------------------------------------

export function wallPick(w: Pick<DerivedWall, 'id' | 'source' | 'levelId'>): PickTags {
  if (w.source.kind === 'blockEdge') {
    return {
      select: { kind: 'blockEdge', id: w.source.edgeId },
      also: [
        { kind: 'wall', id: w.id },
        { kind: 'block', id: w.source.blockId },
      ],
    };
  }
  return { select: { kind: 'wall', id: w.source.wallId, levelId: w.levelId } };
}

export function openingPick(o: Pick<DerivedOpening, 'id' | 'levelId'>): PickTags {
  return { select: { kind: 'opening', id: o.id, levelId: o.levelId } };
}

export interface FloorPickContext {
  /** Ids of the openings in the model (thresholds map to them). */
  openingIds: ReadonlySet<Id>;
  /** Ids of the blocks in the model (flat ceilings map to them). */
  blockIds: ReadonlySet<Id>;
}

/** Id stripped of a `/<marker>` suffix and anything after it (`door-1/threshold/2` → `door-1`), or null. */
function ownerOf(id: Id, marker: string): Id | null {
  const i = id.lastIndexOf(`/${marker}`);
  if (i <= 0) return null;
  const rest = id.slice(i + marker.length + 1);
  return rest === '' || rest.startsWith('/') ? id.slice(0, i) : null;
}

export function floorPick(f: Pick<DerivedFloor, 'id' | 'kind' | 'roomId' | 'levelId'>, ctx: FloorPickContext): PickTags {
  switch (f.kind) {
    case 'room':
      return { select: f.roomId ? { kind: 'room', id: f.roomId, levelId: f.levelId } : null };
    case 'threshold': {
      const id = ownerOf(f.id, 'threshold');
      return { select: id && ctx.openingIds.has(id) ? { kind: 'opening', id } : null };
    }
    case 'ceiling': {
      const id = ownerOf(f.id, 'ceiling');
      return { select: id && ctx.blockIds.has(id) ? { kind: 'block', id } : null };
    }
    default:
      return { select: null };
  }
}

export function blockPick(blockId: Id): PickTags {
  return { select: { kind: 'block', id: blockId } };
}

export function deckPick(d: Pick<DerivedDeck, 'id'>): PickTags {
  return { select: { kind: 'deck', id: d.id } };
}

export function railingPick(r: Pick<DerivedRailing, 'id'>): PickTags {
  return { select: { kind: 'railing', id: r.id } };
}

export function stepsPick(s: Pick<DerivedSteps, 'id' | 'deckId'>): PickTags {
  return { select: { kind: 'steps', id: s.id }, also: [{ kind: 'deck', id: s.deckId }] };
}

export function hotTubPick(t: Pick<DerivedHotTub, 'id'>): PickTags {
  return { select: { kind: 'hotTub', id: t.id } };
}

export function structurePick(s: Pick<DerivedStructure, 'id'>): PickTags {
  return { select: { kind: 'structure', id: s.id } };
}

export function treePick(id: Id): PickTags {
  return { select: { kind: 'tree', id } };
}

export function furniturePick(f: Pick<DerivedFurniture, 'id' | 'levelId'>): PickTags {
  return { select: { kind: 'furniture', id: f.id, levelId: f.levelId } };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Same element: kind and id equal, and levelId equal when both name one. */
export function matchesSelection(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;
  return !a.levelId || !b.levelId || a.levelId === b.levelId;
}

/** Whether an object tagged `tags` is highlighted by `selection` (its own selection or one of `also`). */
export function highlightMatches(tags: PickTags | null, selection: Selection | null): boolean {
  if (!tags || !selection) return false;
  if (tags.select && matchesSelection(tags.select, selection)) return true;
  return (tags.also ?? []).some((s) => matchesSelection(s, selection));
}
