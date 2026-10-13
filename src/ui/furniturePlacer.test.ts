/**
 * Placing a library item (furniturePlacer.ts) on the real Forslag D model with mock actions: the selected room (a
 * room, an item's room, a placed unit's room), else the plan's centre, the catalogue's default preset and the
 * placement's turn and level passed to addFurniture, the new item selected; drops (plan point, 3D floor level); a
 * refusal places and selects nothing. Sixth review: a selected unit's room only with the plan's middle inside it (a
 * Vedskjul against the bedroom wing no longer takes the bedroom's Kommode); a toast whenever an item lands in a unit's
 * room while another room is in the middle; with no free spot in or near the room in the middle, the closest room of
 * the storey with one (Seng 180 with Gang, Do or Bad in the middle goes to Stue, with the toast).
 */
import { describe, expect, it, vi } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import type { Vec2 } from '../model/types';
import { insideRoom, roomAt } from '../plan2d/furniturePlacement';
import type { Selection } from '../state/selection';
import { dropReach, placeFurniture, roomForSelection, unitNearMiddle } from './furniturePlacer';
import type { PlacerEnv, PlanMiddle } from './furniturePlacer';
import { nb } from '../i18n/nb';
import { createForslagD } from '../model/seed/forslagD';
import { placeUnit } from '../state/editActions';
import { createAppStore } from '../state/store';
import { deriveForState } from '../state/useDerived';
import { seedFixture } from './testSeed';

const seed = seedFixture();
const derived: DerivedVariant = { ...seed.derived, furniture: [] };

function env(over: Partial<PlacerEnv> = {}) {
  const addFurniture = vi.fn((..._args: unknown[]) => 'f-new' as unknown);
  const select = vi.fn();
  const planCentre = vi.fn((_catalogId: string): { centre: Vec2; storeyId?: string | null } | null => ({ centre: [19.7, 0.3], storeyId: 'ground' }));
  const e: PlacerEnv = { derived, storeyId: 'ground', selection: null, addFurniture, select, planCentre, ...over };
  return { e, addFurniture: e.addFurniture as typeof addFurniture, select: e.select as typeof select, planCentre: e.planCentre as typeof planCentre };
}

const room = (id: string) => derived.rooms.find((r) => r.id === id)!;

describe('tap in the library', () => {
  it('places in the selected room with the default preset, turned to its wall, and selects it', () => {
    const { e, addFurniture, select, planCentre } = env({ selection: { kind: 'room', id: 'room-hovedbad', levelId: 'main' } });
    const r = placeFurniture(e, 'toalett', { kind: 'tap' });
    expect(r).not.toBeNull();
    expect(r!.room?.id).toBe('room-hovedbad');
    expect(planCentre).not.toHaveBeenCalled();
    expect(addFurniture).toHaveBeenCalledTimes(1);
    const [id, p, opts] = addFurniture.mock.calls[0] as [string, Vec2, { size: unknown; sizeVariant: string; rotationDeg: number; levelId: string }];
    expect(id).toBe('toalett');
    expect(opts.size).toEqual({ w: 0.4, d: 0.65, h: 0.8 });
    expect(opts.sizeVariant).toBe('gulv');
    expect(opts.levelId).toBe('main');
    expect(opts.rotationDeg % 90).toBe(0);
    expect(insideRoom(r!.placement.footprint, room('room-hovedbad'))).toBe(true);
    expect(p).toEqual(r!.placement.position);
    expect(select).toHaveBeenCalledWith({ kind: 'furniture', id: 'f-new', levelId: 'main' });
  });

  it('without a selected room: in the room at the middle of the plan', () => {
    const { e, addFurniture, planCentre } = env();
    const r = placeFurniture(e, 'servant', { kind: 'tap' });
    expect(planCentre).toHaveBeenCalledWith('servant');
    expect(r!.room?.id).toBe('room-hovedbad');
    expect((addFurniture.mock.calls[0][2] as { levelId: string }).levelId).toBe('main');
  });

  it('without a shown plan: the middle of the building', () => {
    const { e, addFurniture } = env({ planCentre: () => null });
    const r = placeFurniture(e, 'stol', { kind: 'tap' });
    expect(r).not.toBeNull();
    expect(addFurniture).toHaveBeenCalled();
  });

  it('the lower-level rooms put the item on their level', () => {
    const { e, addFurniture } = env({ selection: { kind: 'room', id: 'room-sov1' } });
    placeFurniture(e, 'seng-90', { kind: 'tap' });
    expect((addFurniture.mock.calls[0][2] as { levelId: string }).levelId).toBe('lower');
  });

  it('a refused placement (Forslag D) selects nothing', () => {
    const { e, select } = env({ addFurniture: () => null, selection: { kind: 'room', id: 'room-stue' } });
    expect(placeFurniture(e, 'sofa-3', { kind: 'tap' })).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });
});

describe('the room of the selection', () => {
  it('a room, the room of an item, the room of a placed one-room unit, nothing else', () => {
    expect(roomForSelection(derived, { kind: 'room', id: 'room-wc' }, 'ground')?.id).toBe('room-wc');
    const withItem: DerivedVariant = { ...derived, furniture: seed.derived.furniture };
    const f = seed.derived.furniture.find((x) => x.roomId);
    if (f) expect(roomForSelection(withItem, { kind: 'furniture', id: f.id } as Selection, 'ground')?.id).toBe(f.roomId);
    expect(roomForSelection(derived, { kind: 'wall', id: 'w-gang-n' }, 'ground')).toBeNull();
    expect(roomForSelection(derived, null, 'ground')).toBeNull();
    const block = derived.rooms.find((r) => r.blockId)!;
    const fromBlock = roomForSelection(derived, { kind: 'block', id: block.blockId! }, 'ground');
    expect(fromBlock?.blockId).toBe(block.blockId);
  });
});

describe('drops', () => {
  it('a drop near a wall stands against it; the 3D view’s floor level is kept outside rooms', () => {
    const { e, addFurniture } = env();
    const r = room('room-sov-ny');
    const p: Vec2 = [r.bbox.max[0] - 0.8, (r.bbox.min[1] + r.bbox.max[1]) / 2];
    const placed = placeFurniture(e, 'seng-90', { kind: 'drop', at: p });
    expect(placed!.placement.wall).toBeDefined();
    expect(placed!.room?.id).toBe('room-sov-ny');
    expect((addFurniture.mock.calls[0][2] as { levelId: string }).levelId).toBe('main');
    const outside = placeFurniture(e, 'utebord', { kind: 'drop', at: [11, -3], levelId: 'main' });
    expect(outside!.room).toBeNull();
    expect((addFurniture.mock.calls[1][2] as { levelId?: string }).levelId).toBe('main');
  });

  it('the snap reach follows the plan zoom (12 px, 24 px on touch), at most 0.25 m', () => {
    expect(dropReach(120, false)).toBeCloseTo(0.1, 9);
    expect(dropReach(120, true)).toBeCloseTo(0.2, 9);
    expect(dropReach(20, false)).toBe(0.25);
    expect(dropReach(null, false)).toBe(0.25);
  });
});

describe('a selected unit only while the middle is in it; a toast when the item lands elsewhere', () => {
  // The first-time flow: Nytt bygg → Vedskjul on the deck at (14, 9.35) leaves the new shed selected.
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  const shedId = placeUnit(store, 'vedskjul', [14, 9.35]) as string;
  const withShed: DerivedVariant = { ...deriveForState(store.getState()), furniture: [] };
  const shedRoom = withShed.rooms.find((r) => r.blockId === shedId)!;
  const BEDROOM_MIDDLE: Vec2 = [18.35, 4.75];
  const shedEnv = (middle: PlanMiddle | null, toast = vi.fn()) => {
    const planCentre = vi.fn((_catalogId: string): { centre: Vec2; storeyId?: string | null } | null => (middle ? { centre: middle.centre, storeyId: 'ground' } : null));
    const e: PlacerEnv = { derived: withShed, storeyId: 'ground', selection: { kind: 'block', id: shedId }, addFurniture: () => 'f-new', select: vi.fn(), planCentre, planMiddle: () => middle, toast };
    return { e, planCentre, toast };
  };

  it('the shed stays selected and Soverom (ny fløy) is zoomed into the middle (40.5 px/m): the kommode goes to the bedroom, without a toast', () => {
    expect(shedRoom).toBeDefined();
    const { e, planCentre, toast } = shedEnv({ centre: BEDROOM_MIDDLE, storeyId: 'ground', scale: 40.5 });
    const r = placeFurniture(e, 'kommode', { kind: 'tap' });
    expect(planCentre).toHaveBeenCalledWith('kommode');
    expect(r!.room?.id).toBe('room-sov-ny');
    expect(r!.placement.free).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });

  it('the plan\'s middle in the shed (zoomed onto it), or no plan shown: the shed\'s room; the whole plan at the starting zoom: the room in the middle', () => {
    for (const middle of [{ centre: shedRoom.labelPoint, storeyId: 'ground', scale: 60 }, { centre: shedRoom.labelPoint, storeyId: 'ground', scale: 11.6 }, null]) {
      const { e, planCentre, toast } = shedEnv(middle);
      const r = placeFurniture(e, 'vedstabel', { kind: 'tap' });
      expect(r!.room?.id, JSON.stringify(middle)).toBe(shedRoom.id);
      expect(planCentre).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
    }
    // Sixth review: at 11.6 px/m the shed's room is about 60 px from the building's middle, no longer enough.
    const whole = { centre: [11.5, 3.8] as Vec2, storeyId: 'ground', scale: 11.6 };
    const { e, planCentre, toast } = shedEnv(whole);
    const r = placeFurniture(e, 'kommode', { kind: 'tap' });
    expect(planCentre).toHaveBeenCalledWith('kommode');
    expect(r!.room?.id).toBe(roomAt(withShed, 'ground', whole.centre)?.id);
    expect(toast).not.toHaveBeenCalled();
    expect(unitNearMiddle(shedRoom, whole)).toBe(false);
    expect(unitNearMiddle(shedRoom, { centre: shedRoom.labelPoint, storeyId: 'ground', scale: 5 })).toBe(true);
    expect(unitNearMiddle(shedRoom, { centre: shedRoom.labelPoint, storeyId: 'loft', scale: 40 })).toBe(false);
  });

  it('nothing selected: a toast when the item goes to another room than the one in the middle (a full room gives way), none when it stays', () => {
    const hovedbad: Vec2 = [19.7, 0.3];
    const gang = room('room-sov-ny');
    // The middle is in Hovedbad, but the plan answers with Soverom (ny fløy) (its room for the item when Hovedbad is full).
    const toast = vi.fn();
    const { e } = env({ planMiddle: () => ({ centre: hovedbad, storeyId: 'ground', scale: 40 }), planCentre: () => ({ centre: gang.labelPoint, storeyId: 'ground' }), toast });
    const r = placeFurniture(e, 'kommode', { kind: 'tap' });
    expect(r!.room?.id).toBe('room-sov-ny');
    expect(toast).toHaveBeenCalledWith('Kommode er satt inn i «Soverom (ny fløy)».');
    // The room in the middle itself: no toast.
    const quiet = vi.fn();
    placeFurniture(env({ planMiddle: () => ({ centre: hovedbad, storeyId: 'ground', scale: 40 }), toast: quiet }).e, 'servant', { kind: 'tap' });
    expect(quiet).not.toHaveBeenCalled();
    // A selected room: never (the item stays in it).
    placeFurniture(env({ selection: { kind: 'room', id: 'room-wc', levelId: 'main' }, planMiddle: () => ({ centre: hovedbad, storeyId: 'ground', scale: 40 }), toast: quiet }).e, 'servant', { kind: 'tap' });
    expect(quiet).not.toHaveBeenCalled();
    // Refused (Forslag D): no toast either.
    placeFurniture(env({ addFurniture: () => null, planMiddle: () => ({ centre: hovedbad, storeyId: 'ground', scale: 40 }), planCentre: () => ({ centre: gang.labelPoint, storeyId: 'ground' }), toast: quiet }).e, 'kommode', { kind: 'tap' });
    expect(quiet).not.toHaveBeenCalled();
    expect(nb.library.placedInToast('Kommode', null)).toBe('Kommode er satt inn i et rom uten navn.');
  });
});

describe('sixth review: a shed against the bedroom wing; the far fallback', () => {
  // The review's spot: a Vedskjul against the wing's north wall (y 6.2), x 17.4–19.4, still selected after Nytt bygg.
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  const shedId = placeUnit(store, 'vedskjul', [18.4, 6.95]) as string;
  const full = deriveForState(store.getState());
  const shedRoom = full.rooms.find((r) => r.blockId === shedId)!;
  const BEDROOM_MIDDLE: Vec2 = [18.35, 4.75];
  const placer = (over: Partial<PlacerEnv>) => {
    const toast = vi.fn();
    const planCentre = vi.fn((_catalogId: string): { centre: Vec2; storeyId?: string | null } | null => ({ centre: BEDROOM_MIDDLE, storeyId: 'ground' }));
    const e: PlacerEnv = { derived: full, storeyId: 'ground', selection: { kind: 'block', id: shedId }, addFurniture: () => 'f-new', select: vi.fn(), planCentre, toast, ...over };
    return { e, toast, planCentre };
  };

  it('the shed is against the wing, 1.4 m from the bedroom', () => {
    expect(shedRoom).toBeDefined();
    expect(Math.min(...shedRoom.polygon.map((q) => q[1]))).toBeLessThan(6.5);
    expect(roomAt(full, 'ground', BEDROOM_MIDDLE)?.id).toBe('room-sov-ny');
  });

  it('the bedroom pinched to the middle at 20–55 px/m: the Kommode goes to Soverom (ny fløy), free, without a toast', () => {
    for (const scale of [20, 30, 40, 55]) {
      const { e, toast } = placer({ planMiddle: () => ({ centre: BEDROOM_MIDDLE, storeyId: 'ground', scale }) });
      const r = placeFurniture(e, 'kommode', { kind: 'tap' });
      expect(r!.room?.id, `${scale} px/m`).toBe('room-sov-ny');
      expect(r!.placement.free, `${scale} px/m`).toBe(true);
      expect(toast, `${scale} px/m`).not.toHaveBeenCalled();
    }
  });

  it('the middle in the shed: the shed\'s room, no toast; an item selected in the shed with the bedroom in the middle: the shed\'s room, with the toast', () => {
    const inShed = placer({ planMiddle: () => ({ centre: shedRoom.labelPoint, storeyId: 'ground', scale: 40 }) });
    expect(placeFurniture(inShed.e, 'vedstabel', { kind: 'tap' })!.room?.id).toBe(shedRoom.id);
    expect(inShed.toast).not.toHaveBeenCalled();
    // A Vedstabel standing in the shed is selected (its room is the shed's); the bedroom is in the middle.
    const withItem: DerivedVariant = {
      ...full,
      furniture: [...full.furniture, { ...full.furniture[0], id: 'f-stack', roomId: shedRoom.id, levelId: shedRoom.levelId }],
    };
    const picked = placer({ derived: withItem, selection: { kind: 'furniture', id: 'f-stack' }, planMiddle: () => ({ centre: BEDROOM_MIDDLE, storeyId: 'ground', scale: 40 }) });
    const r = placeFurniture(picked.e, 'vedstabel', { kind: 'tap' });
    expect(r!.room?.id).toBe(shedRoom.id);
    expect(picked.toast).toHaveBeenCalledWith(nb.library.placedInToast('Vedstabel', shedRoom.room?.name ?? null));
    expect(picked.toast.mock.calls[0][0]).toBe('Vedstabel er satt inn i «Vedskjul».');
  });

  it('Seng 180 with Gang, Do or Bad in the middle (none of the nearest rooms has space): the closest room of the storey with space, with the toast', () => {
    const toastText = nb.library.placedFarToast('Seng 180', 'Stue');
    expect(toastText).toBe('Ingen plass i rommene i nærheten: Seng 180 er satt inn i «Stue».');
    for (const id of ['room-gang', 'room-do', 'room-bad']) {
      const mid = seed.derived.rooms.find((r) => r.id === id)!.labelPoint;
      // The plan answers with the middle itself when neither it nor its 6 nearest rooms have a free spot (PlanView.tsx).
      const { e, toast } = placer({ derived: seed.derived, selection: null, planCentre: () => ({ centre: mid, storeyId: 'ground' }), planMiddle: () => ({ centre: mid, storeyId: 'ground', scale: 46 }) });
      const r = placeFurniture(e, 'seng-180', { kind: 'tap' });
      expect(r!.placement.free, id).toBe(true);
      expect(r!.room?.id, id).toBe('room-stue');
      expect(insideRoom(r!.placement.footprint, room('room-stue')), id).toBe(true);
      expect(toast, id).toHaveBeenCalledWith(toastText);
    }
  });

  it('no room of the storey has space: the item stands in the middle room with its warnings, no far toast', () => {
    const tight: DerivedVariant = { ...seed.derived, rooms: seed.derived.rooms.filter((r) => ['room-gang', 'room-do', 'room-bad', 'room-wc'].includes(r.id)) };
    const mid = room('room-gang').labelPoint;
    const { e, toast } = placer({ derived: tight, selection: null, planCentre: () => ({ centre: mid, storeyId: 'ground' }), planMiddle: () => ({ centre: mid, storeyId: 'ground', scale: 46 }) });
    const r = placeFurniture(e, 'seng-180', { kind: 'tap' });
    expect(r!.placement.free).toBe(false);
    expect(r!.room?.id).toBe('room-gang');
    expect(toast).not.toHaveBeenCalled();
  });
});
