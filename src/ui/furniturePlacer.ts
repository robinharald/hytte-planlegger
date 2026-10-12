/**
 * Putting a library item into the proposal (docs/phase2-plan.md §3.2): ONE function for every way in, so the drop
 * preview in the plan, a tap in the library, a drop on the plan, the plan's Møbler tool and a drop on the 3D view all
 * land an item the same way (plan2d/furniturePlacement.ts):
 *
 *  - tap in the library: in the selected room — a selected room, the room of a selected item, or the room of a
 *    selected one-room unit (a placed Bod or Badstue) — else at the middle of the visible plan (its room if it is in
 *    one; the plan answers through plan2d/furnitureDrop.ts `requestPlanCentre`; without a shown plan the middle of
 *    the building), pushed to the nearest free wall (`tapPlacement`);
 *  - drop at a plan point (the plan's `onDropFurniture`, the 3D view's drop with the floor it hit): `dropPlacement`,
 *    with the plan's snap reach (12 px, 24 px on touch, at the plan's zoom; at most 0.25 m).
 * The item gets the catalogue's default preset (`size` + `sizeVariant`), the placement's turn and the room's level,
 * through the edit API's `addFurniture` (one undo step; refused with the toast on Forslag D), and is selected.
 *
 * `placeFurniture(env, …)` is pure apart from the env's callbacks (unit-tested); useFurniturePlacer.ts binds it to the
 * app store and the editor core.
 */
import type { DerivedRoom, DerivedVariant } from '../model/derived';
import type { Id, Vec2 } from '../model/types';
import { catalogPlacementSpec, dropPlacement, roomAt, tapPlacement } from '../plan2d/furniturePlacement';
import type { FurniturePlacement } from '../plan2d/furniturePlacement';
import { SNAP_RADIUS_COARSE_PX, SNAP_RADIUS_PX } from '../plan2d/editModel';
import { LINE_SNAP_MAX_M } from '../geometry/snap';
import type { Selection } from '../state/selection';

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
  /** The middle of the shown plan (and its storey), or null. */
  planCentre: () => { centre: Vec2; storeyId?: Id | null } | null;
}

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
  if (how.kind === 'drop') {
    const storeyId = (how.levelId && derived.levels.find((l) => l.id === how.levelId)?.storeyId) || env.storeyId;
    placement = dropPlacement(derived, storeyId, spec, how.at, { reach: how.reach });
    room = placement.roomId ? (roomAt(derived, storeyId, how.at) ?? null) : null;
    if (!placement.levelId && how.levelId) placement = { ...placement, levelId: how.levelId };
  } else {
    room = roomForSelection(derived, env.selection, env.storeyId);
    const plan = room ? null : env.planCentre();
    const storeyId = room?.storeyId ?? plan?.storeyId ?? env.storeyId;
    const at = room ? room.labelPoint : (plan?.centre ?? boundsCentre(derived));
    placement = tapPlacement(derived, storeyId, spec, at, room);
    if (!room && placement.roomId) room = derived.rooms.find((r) => r.id === placement.roomId && r.levelId === placement.levelId) ?? null;
  }
  const opts: AddFurnitureOpts = { size: { ...spec.size }, rotationDeg: placement.rotationDeg };
  if (spec.sizeVariant) opts.sizeVariant = spec.sizeVariant;
  if (placement.levelId) opts.levelId = placement.levelId;
  const id = idOf(env.addFurniture(catalogId, placement.position, opts));
  if (!id) return null;
  env.select(placement.levelId ? { kind: 'furniture', id, levelId: placement.levelId } : { kind: 'furniture', id });
  return { id, placement, room };
}

/** Snap reach (m) of a drop at the plan's zoom (12 px, 24 px on touch; at most LINE_SNAP_MAX_M). */
export function dropReach(scale: number | null | undefined, touch: boolean): number {
  if (!scale || !(scale > 0)) return LINE_SNAP_MAX_M;
  return Math.min(LINE_SNAP_MAX_M, (touch ? SNAP_RADIUS_COARSE_PX : SNAP_RADIUS_PX) / scale);
}
