/**
 * Putting a library item into the proposal (docs/phase2-plan.md §3.2): ONE function for every way in, so the drop
 * preview in the plan, a tap in the library, a drop on the plan, the plan's Møbler tool and a drop on the 3D view all
 * land an item the same way (plan2d/furniturePlacement.ts):
 *
 *  - tap in the library: in the selected room — a selected room, the room of a selected item, or the room of a
 *    selected one-room unit (a placed Bod or Badstue) — else at the middle of the visible plan (its room if it is in
 *    one; the plan answers through plan2d/furnitureDrop.ts `requestPlanCentre`; without a shown plan the middle of
 *    the building), pushed to the nearest free wall (`tapPlacement`). Last fix round: a selected unit gives its room
 *    only while that room is on screen near the plan's middle (within UNIT_NEAR_MIDDLE_PX, `unitNearMiddle`) — Nytt
 *    bygg leaves the new shed selected, and a bedroom zoomed into the middle afterwards got its furniture in the shed.
 *    When the item lands in another room than the one picked (the selection's) or, without one, the one in the
 *    middle of the plan (a full room gives way to a neighbour), the toast says where («Kommode er satt inn i
 *    «Gang».», `env.toast`);
 *  - drop at a plan point (the plan's `onDropFurniture`, the 3D view's drop with the floor it hit): `dropPlacement`,
 *    with the plan's snap reach (12 px, 24 px on touch, at the plan's zoom; at most 0.25 m).
 * The item gets the catalogue's default preset (`size` + `sizeVariant`), the placement's turn and the room's level,
 * through the edit API's `addFurniture` (one undo step; refused with the toast on Forslag D), and is selected.
 *
 * `placeFurniture(env, …)` is pure apart from the env's callbacks (unit-tested; `env.planMiddle` defaults to asking
 * the shown plan through `requestPlanCentre`); useFurniturePlacer.ts binds it to the app store and the editor core.
 */
import type { DerivedRoom, DerivedVariant } from '../model/derived';
import type { Id, Vec2 } from '../model/types';
import { catalogItem } from '../furniture/catalog';
import { distancePointSegment, pointInPolygon } from '../geometry/polygon';
import { requestPlanCentre } from '../plan2d/furnitureDrop';
import { catalogPlacementSpec, dropPlacement, roomAt, tapPlacement } from '../plan2d/furniturePlacement';
import type { FurniturePlacement } from '../plan2d/furniturePlacement';
import { SNAP_RADIUS_COARSE_PX, SNAP_RADIUS_PX } from '../plan2d/editModel';
import { LINE_SNAP_MAX_M } from '../geometry/snap';
import type { Selection } from '../state/selection';
import { nb } from '../i18n/nb';

export type PlaceHow =
  /** The library's tap. */
  | { kind: 'tap' }
  /** A drop at a plan point; `levelId`: the floor the 3D view hit; `reach`: snap reach (m). */
  | { kind: 'drop'; at: Vec2; levelId?: Id; reach?: number };

export interface AddFurnitureOpts {
  levelId?: Id;
  size?: { w: number; d: number; h: number };
  rotationDeg?: number;
  sizeVariant?: string;
}

export interface PlacerEnv {
  derived: DerivedVariant;
  /** The plan's storey ('ground' / 'loft'). */
  storeyId: Id;
  selection: Selection | null;
  /** The edit API's addFurniture: the new id, or null when refused. */
  addFurniture: (catalogId: string, position: Vec2, opts: AddFurnitureOpts) => unknown;
  select: (sel: Selection | null) => void;
  /** The middle of the shown plan (and its storey) for placing `catalogId` there, or null. */
  planCentre: (catalogId: string) => { centre: Vec2; storeyId?: Id | null } | null;
  /**
   * The shown plan's middle without an item (the room point there: the visible middle when it lies in a room), its
   * storey and zoom (px per metre), or null when no plan is shown. Absent: asked through `requestPlanCentre`.
   */
  planMiddle?: () => PlanMiddle | null;
  /** Shows a short message (the app's toast); absent: none. */
  toast?: (text: string) => void;
}

/** See `PlacerEnv.planMiddle`. */
export interface PlanMiddle {
  centre: Vec2;
  storeyId?: Id | null;
  scale?: number | null;
}

/** A selected unit's room takes a library tap only while it lies this close (screen px) to the plan's middle. */
export const UNIT_NEAR_MIDDLE_PX = 100;

/** The shown plan's middle, asked through the DOM (furnitureDrop.ts); null without a document or a shown plan. */
function domPlanMiddle(): PlanMiddle | null {
  if (typeof document === 'undefined') return null;
  const d = requestPlanCentre(document);
  return d?.centre ? { centre: d.centre, storeyId: d.storeyId, scale: d.scale } : null;
}

/**
 * Is the (unit's) room on screen near the plan's middle: on the plan's storey, and its outline within
 * UNIT_NEAR_MIDDLE_PX of the middle (the middle inside it, without a zoom)? True when no plan is shown.
 */
export function unitNearMiddle(room: DerivedRoom, middle: PlanMiddle | null): boolean {
  if (!middle) return true;
  if (middle.storeyId && middle.storeyId !== room.storeyId) return false;
  const poly = room.polygon;
  const away = pointInPolygon(middle.centre, poly) ? 0 : Math.min(...poly.map((q, i) => distancePointSegment(middle.centre, q, poly[(i + 1) % poly.length])));
  const scale = middle.scale ?? 0;
  return scale > 0 ? away * scale <= UNIT_NEAR_MIDDLE_PX : away === 0;
}

const sameRoom = (a: DerivedRoom | null, b: DerivedRoom | null) => !!a && !!b && a.id === b.id && a.levelId === b.levelId;

export interface Placed {
  id: Id;
  placement: FurniturePlacement;
  /** The room it went into (derived room), if any. */
  room: DerivedRoom | null;
}

/** The room a tap places into, from the selection (see the header); null when the selection names none. */
export function roomForSelection(derived: DerivedVariant, selection: Selection | null, storeyId: Id): DerivedRoom | null {
  if (!selection) return null;
  switch (selection.kind) {
    case 'room':
      return derived.rooms.find((r) => r.id === selection.id && (selection.levelId === undefined || r.levelId === selection.levelId)) ?? derived.rooms.find((r) => r.id === selection.id) ?? null;
    case 'furniture': {
      const f = derived.furniture.find((x) => x.id === selection.id);
      if (!f?.roomId) return null;
      return derived.rooms.find((r) => r.id === f.roomId && r.levelId === f.levelId) ?? derived.rooms.find((r) => r.id === f.roomId) ?? null;
    }
    case 'block': {
      const rooms = derived.rooms.filter((r) => r.blockId === selection.id && r.polygon.length >= 3);
      const own = rooms.filter((r) => r.storeyId === storeyId);
      const pool = own.length > 0 ? own : rooms;
      return pool.reduce<DerivedRoom | null>((best, r) => (!best || r.area > best.area ? r : best), null);
    }
    default:
      return null;
  }
}

const idOf = (r: unknown): Id | null => (typeof r === 'string' && r ? r : r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string' ? (r as { id: string }).id : null);

function boundsCentre(derived: DerivedVariant): Vec2 {
  const b = derived.blocks.length > 0 ? derived.blocks.flatMap((x) => x.axis) : [derived.bounds.min, derived.bounds.max];
  const xs = b.map((p) => p[0]);
  const ys = b.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** Place a library item (see the header). Null when nothing was added (refused, unknown storey). */
export function placeFurniture(env: PlacerEnv, catalogId: string, how: PlaceHow): Placed | null {
  const { derived } = env;
  const spec = catalogPlacementSpec(catalogId);
  let placement: FurniturePlacement;
  let room: DerivedRoom | null;
  let placedNote: string | null = null;
  if (how.kind === 'drop') {
    const storeyId = (how.levelId && derived.levels.find((l) => l.id === how.levelId)?.storeyId) || env.storeyId;
    placement = dropPlacement(derived, storeyId, spec, how.at, { reach: how.reach });
    room = placement.roomId ? (roomAt(derived, storeyId, how.at) ?? null) : null;
    if (!placement.levelId && how.levelId) placement = { ...placement, levelId: how.levelId };
  } else {
    room = roomForSelection(derived, env.selection, env.storeyId);
    // The plan's middle (no item asked): for a selected unit, and for the toast.
    let middle: PlanMiddle | null | undefined;
    const middleOf = () => (middle === undefined ? (middle = (env.planMiddle ?? domPlanMiddle)()) : middle);
    // A selected unit gives its room only while it is on screen near the middle (see the header).
    if (room && env.selection?.kind === 'block' && !unitNearMiddle(room, middleOf())) room = null;
    const picked = room;
    const plan = room ? null : env.planCentre(catalogId);
    const storeyId = room?.storeyId ?? plan?.storeyId ?? env.storeyId;
    const at = room ? room.labelPoint : (plan?.centre ?? boundsCentre(derived));
    placement = tapPlacement(derived, storeyId, spec, at, room);
    if (!room && placement.roomId) room = derived.rooms.find((r) => r.id === placement.roomId && r.levelId === placement.levelId) ?? null;
    // Not the room picked, or (without one) the room in the middle of the plan: say where it went.
    const m = picked ? null : middleOf();
    const expected = picked ?? (m ? roomAt(derived, m.storeyId ?? storeyId, m.centre) : null);
    if (env.toast && room && !sameRoom(room, expected)) placedNote = nb.library.placedInToast(catalogItem(catalogId)?.name ?? catalogId, room.room?.name?.trim() || null);
  }
  const opts: AddFurnitureOpts = { size: { ...spec.size }, rotationDeg: placement.rotationDeg };
  if (spec.sizeVariant) opts.sizeVariant = spec.sizeVariant;
  if (placement.levelId) opts.levelId = placement.levelId;
  const id = idOf(env.addFurniture(catalogId, placement.position, opts));
  if (!id) return null;
  env.select(placement.levelId ? { kind: 'furniture', id, levelId: placement.levelId } : { kind: 'furniture', id });
  if (placedNote) env.toast?.(placedNote);
  return { id, placement, room };
}

/** Snap reach (m) of a drop at the plan's zoom (12 px, 24 px on touch; at most LINE_SNAP_MAX_M). */
export function dropReach(scale: number | null | undefined, touch: boolean): number {
  if (!scale || !(scale > 0)) return LINE_SNAP_MAX_M;
  return Math.min(LINE_SNAP_MAX_M, (touch ? SNAP_RADIUS_COARSE_PX : SNAP_RADIUS_PX) / scale);
}
