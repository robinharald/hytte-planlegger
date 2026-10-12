/**
 * Selection commands shared by the keyboard (Delete, R, Ctrl+D, arrows), the phone mini-bar (Roter · Slett) and the
 * Egenskaper action buttons. Each takes the edit actions (editorBridge `UiEditActions`) explicitly.
 *
 *  - Nothing happens while read-only (shared link). On the locked base proposal every command shows the refusal
 *    toast with "Nytt forslag" instead of calling an action (so there is exactly one toast).
 *  - Delete (docs/phase2-plan.md §3.5 "every delete toasts «Slettet. [Angre]»"): the toast appears only when the
 *    project actually changed. Deleting an existing wall or opening only marks it 'removed' (same id), so the
 *    selection stays and the panel shows the ghost with "Ta tilbake"; anything else is deselected.
 *  - What can be deleted: named rooms (the Room record), stored walls, openings, new blocks (an existing block shows
 *    "Hytta i dag kan ikke slettes som helhet …"), deck corners (a deck keeps at least 3), steps, hot tubs, trees,
 *    furniture. Exterior walls, decks, railings, structure and ghosts cannot.
 *  - Rotate (90°): furniture, and new template units ("Nytt bygg": a placed Vedskjul turned around its centre,
 *    `rotateBlock`). Duplicate: furniture and new blocks.
 *  - The room of a placed single-room unit (`unitOfRoom`): the phone mini-bar also offers the unit's "Roter 90°"
 *    (`rotateUnit`) and "Velg bygningsdelen", so the unit can be turned and moved again without a detour.
 */
import { nb } from '../i18n/nb';
import type { DerivedBlock, DerivedVariant } from '../model/derived';
import { appStore } from '../state/appStore';
import type { Selection } from '../state/selection';
import { selectActiveVariant } from '../state/store';
import { deriveForState } from '../state/useDerived';
import { isVariantLocked, showLockedToast, showToast } from './editorBridge';
import type { UiEditActions } from './editorBridge';
import { resolveUiSelection } from './uiSelection';
import type { UiResolved } from './uiSelection';

type Gate = 'read-only' | 'locked' | 'ok';

function gate(): Gate {
  const s = appStore.getState();
  if (s.ui.readOnly) return 'read-only';
  return isVariantLocked(selectActiveVariant(s)) ? 'locked' : 'ok';
}

/** Run `fn` unless read-only; on the locked base proposal show the refusal toast instead. */
export function guarded(fn: () => void): void {
  const g = gate();
  if (g === 'read-only') return;
  if (g === 'locked') {
    showLockedToast();
    return;
  }
  fn();
}

/** The delete call for a resolved selection, or null when it cannot be deleted. */
export function deleteCall(r: UiResolved, actions: UiEditActions): (() => void) | null {
  switch (r.kind) {
    case 'room':
      return r.room.room ? () => actions.deleteRoom(r.room.id) : null;
    case 'wall':
      return r.wall.source.kind === 'wall' && !r.wall.isGhost ? () => actions.deleteWall(r.wall.id) : null;
    case 'opening':
      return r.opening.isGhost ? null : () => actions.deleteOpening(r.opening.id);
    case 'block':
      return r.block.block.isNew ? () => actions.deleteBlock(r.block.block.id) : () => void showToast({ text: nb.editor.existingBlockDelete });
    case 'deckVertex':
      return r.deck.polygon.length > 3 ? () => actions.deleteDeckVertex(r.vertexId) : () => void showToast({ text: nb.editor.deckMinVertices });
    case 'steps':
      return () => actions.deleteSteps(r.steps.id);
    case 'hotTub':
      return () => actions.deleteHotTub(r.hotTub.id);
    case 'tree':
      return () => actions.deleteTree(r.tree.id);
    case 'furniture':
      return () => actions.deleteFurniture(r.furniture.id);
    default:
      return null;
  }
}

/** Deleting an existing wall / opening keeps it as a ghost with the same id (the selection stays). */
function staysAsGhost(r: UiResolved): boolean {
  if (r.kind === 'wall') return r.wall.status === 'existing';
  if (r.kind === 'opening') return r.opening.status === 'existing';
  return false;
}

/** Delete what `r` is; "Slettet. [Angre]" when the project changed. Returns whether anything was deleted. */
export function deleteResolved(r: UiResolved, actions: UiEditActions): boolean {
  const call = deleteCall(r, actions);
  if (!call) return false;
  let changed = false;
  guarded(() => {
    const before = appStore.getState().project;
    call();
    changed = appStore.getState().project !== before;
    if (!changed) return;
    showToast({ text: nb.toasts.deleted, undo: true });
    if (!staysAsGhost(r)) appStore.getState().select(null);
  });
  return changed;
}

/** A placed "Nytt bygg" unit (a new block made from a template) can be turned. */
export function isRotatableBlock(r: UiResolved | null): boolean {
  return r?.kind === 'block' && r.block.block.isNew && !!r.block.block.template;
}

export function canRotate(r: UiResolved | null): boolean {
  return r?.kind === 'furniture' || isRotatableBlock(r);
}

/**
 * The placed "Nytt bygg" unit (a new block from a template) whose only room `r` is, e.g. a Vedskjul's room; else null.
 */
export function unitOfRoom(r: UiResolved | null, derived: DerivedVariant): DerivedBlock | null {
  if (r?.kind !== 'room' || !r.room.blockId) return null;
  const id = r.room.blockId;
  const unit = derived.blocks.find((b) => b.block.id === id);
  if (!unit || !unit.block.isNew || !unit.block.template) return null;
  return derived.rooms.filter((x) => x.blockId === id).length === 1 ? unit : null;
}

/** Turn a placed unit 90° (the mini-bar's "Roter 90°" for the room of a unit, `unitOfRoom`). */
export function rotateUnit(unit: DerivedBlock, actions: UiEditActions): void {
  guarded(() => actions.rotateBlock(unit.block.id, 90));
}

export function rotateResolved(r: UiResolved, actions: UiEditActions): void {
  if (r.kind === 'furniture') guarded(() => actions.rotateFurniture(r.furniture.id, 90));
  else if (r.kind === 'block' && isRotatableBlock(r)) guarded(() => actions.rotateBlock(r.block.block.id, 90));
}

export function duplicateResolved(r: UiResolved, actions: UiEditActions): void {
  if (r.kind === 'furniture') guarded(() => actions.duplicateFurniture(r.furniture.id));
  else if (r.kind === 'block' && r.block.block.isNew) guarded(() => actions.duplicateBlock(r.block.block.id));
}

export function nudgeSelection(sel: Selection, dx: number, dy: number, actions: UiEditActions): void {
  guarded(() => actions.nudge(sel, dx, dy));
}

/** The current selection resolved against the current derived model (outside React, e.g. key handlers). */
export function resolveCurrent(): UiResolved | null {
  const state = appStore.getState();
  return resolveUiSelection(deriveForState(state), state.ui.selection);
}
