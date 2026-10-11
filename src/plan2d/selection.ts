/**
 * Selection plumbing for the plan. Selectable elements carry `data-sel-kind`, `data-sel-id` and optionally
 * `data-sel-level`; a tap resolves the nearest such ancestor to a `Selection` (src/state/selection.ts).
 *
 * Mapping used by the plan (the contract only fixes the Selection shape, so it is documented here):
 *  - room polygon             → { kind: 'room', id: DerivedRoom.id, levelId }  (unnamed faces: their `face-…` id)
 *  - any wall piece / divider → { kind: 'wall', id: DerivedWall.id, levelId }  (exterior pieces included: the
 *                               state module resolves 'wall' against derived.walls by DerivedWall.id)
 *  - opening                  → { kind: 'opening', id: DerivedOpening.id, levelId: its level, else the host's }
 *  - block area outside rooms → { kind: 'block', id: blockId }
 *  - deck / railing / hotTub / structure / tree → { kind, id }
 * Highlighting also accepts selections made elsewhere: a 'blockEdge' selection highlights every exterior piece
 * of that edge, a stored wall id every piece of that wall.
 */
import type { DerivedRoom, DerivedWall } from '../model/derived';
import type { Selection } from '../state/selection';

export type SelKind = Selection['kind'];

const SEL_KINDS: readonly SelKind[] = [
  'wall',
  'blockEdge',
  'blockVertex',
  'opening',
  'room',
  'block',
  'deck',
  'railing',
  'hotTub',
  'structure',
  'furniture',
  'tree',
];

export interface SelAttrs {
  'data-sel-kind': SelKind;
  'data-sel-id': string;
  'data-sel-level'?: string;
}

export function selAttrs(kind: SelKind, id: string, levelId?: string): SelAttrs {
  const a: SelAttrs = { 'data-sel-kind': kind, 'data-sel-id': id };
  if (levelId) a['data-sel-level'] = levelId;
  return a;
}

function isSelKind(v: string): v is SelKind {
  return (SEL_KINDS as readonly string[]).includes(v);
}

/** Selection for the element under a tap, or null when nothing selectable was hit. */
export function selectionFromTarget(target: Element | null): Selection | null {
  if (!target || typeof target.closest !== 'function') return null;
  const el = target.closest('[data-sel-kind]');
  if (!el) return null;
  const kind = el.getAttribute('data-sel-kind') ?? '';
  const id = el.getAttribute('data-sel-id');
  if (!isSelKind(kind) || !id) return null;
  const levelId = el.getAttribute('data-sel-level');
  return levelId ? { kind, id, levelId } : { kind, id };
}

export function isSelected(sel: Selection | null, kind: SelKind, id: string): boolean {
  return !!sel && sel.kind === kind && sel.id === id;
}

/** Selection emitted when a wall piece or divider is tapped. */
export function wallSelection(w: Pick<DerivedWall, 'id' | 'levelId'>): Selection {
  return { kind: 'wall', id: w.id, levelId: w.levelId };
}

/** Whether a wall piece is highlighted: selected itself, or its block edge / stored wall is selected. */
export function isWallHighlighted(sel: Selection | null, w: Pick<DerivedWall, 'id' | 'source'>): boolean {
  if (!sel) return false;
  if (sel.kind === 'wall') return sel.id === w.id || (w.source.kind === 'wall' && sel.id === w.source.wallId);
  if (sel.kind === 'blockEdge') return w.source.kind === 'blockEdge' && sel.id === w.source.edgeId;
  return false;
}

/** Room selection matches the id and, when the selection carries one, the level. */
export function isRoomSelected(sel: Selection | null, room: Pick<DerivedRoom, 'id' | 'levelId'>): boolean {
  return !!sel && sel.kind === 'room' && sel.id === room.id && (sel.levelId === undefined || sel.levelId === room.levelId);
}
