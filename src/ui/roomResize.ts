/**
 * Which wall a room size field moves (docs/phase2-plan.md §3.7, Rom: "Bredde ↔, Dybde ↕ … a change moves the bounding
 * stored interior wall on that side (prefer stored walls over block edges; both movable → north/east; switch
 * «Flytt: venstre / høyre vegg»); the wall is highlighted with an arrow while the field has focus; only block edges
 * on that side → «Endres under bygningsdelen»").
 *
 * A thin view of the editor core's `roomResizeTargets` (geometry/edit.ts), which `resizeRoom` itself uses, so the wall
 * the field highlights is always the wall the action moves. Bredde (`'w'`) is the room's extent along plan x, Dybde
 * (`'d'`) along plan y (DerivedRoom.dims); 'min' = west / south (left / lower in the plan), 'max' = east / north.
 */
import { roomResizeTargets } from '../geometry/edit';
import type { DerivedRoom, DerivedVariant } from '../model/derived';
import type { Id, Vec2 } from '../model/types';
import type { RoomSide } from './editorBridge';

export type RoomAxis = 'w' | 'd';

export interface SideCandidate {
  /** Derived wall id (a stored wall's id, or an exterior piece's id). */
  wallId: Id;
  /** A stored wall (movable from the room panel); false = an exterior block-edge piece. */
  stored: boolean;
}

export interface RoomResizePlan {
  axis: RoomAxis;
  min: SideCandidate | null;
  max: SideCandidate | null;
  /** Sides whose wall the field can move (stored walls). */
  movable: RoomSide[];
  /** Side moved by default: 'max' (north / east) when it can move, else 'min'; null when neither can. */
  defaultSide: RoomSide | null;
}

/** Unit vector the wall on `side` moves in when the value grows (away from the room). */
export function sideArrow(axis: RoomAxis, side: RoomSide): Vec2 {
  const s = side === 'max' ? 1 : -1;
  return axis === 'w' ? [s, 0] : [0, s];
}

export function roomResizePlan(derived: DerivedVariant, room: DerivedRoom, axis: RoomAxis): RoomResizePlan {
  const t = roomResizeTargets(derived, room.room?.id ?? room.id, axis);
  const cand = (x: (typeof t)['min']): SideCandidate | null => (x ? { wallId: x.wallId, stored: x.kind === 'wall' } : null);
  const min = cand(t.min);
  const max = cand(t.max);
  const movable: RoomSide[] = [];
  if (min?.stored) movable.push('min');
  if (max?.stored) movable.push('max');
  return { axis, min, max, movable, defaultSide: t.preferred };
}

/** The candidate on `side` of a plan (null when that side has none). */
export function candidateOn(plan: RoomResizePlan, side: RoomSide): SideCandidate | null {
  return side === 'min' ? plan.min : plan.max;
}
