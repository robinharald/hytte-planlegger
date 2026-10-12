/**
 * Placing a library item (furniturePlacer.ts) on the real Forslag D model with mock actions: the selected room (a
 * room, an item's room, a placed unit's room), else the plan's centre, the catalogue's default preset and the
 * placement's turn and level passed to addFurniture, the new item selected; drops (plan point, 3D floor level); a
 * refusal places and selects nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import type { Vec2 } from '../model/types';
import { insideRoom } from '../plan2d/furniturePlacement';
import type { Selection } from '../state/selection';
import { dropReach, placeFurniture, roomForSelection } from './furniturePlacer';
import type { PlacerEnv } from './furniturePlacer';
import { seedFixture } from './testSeed';

const seed = seedFixture();
const derived: DerivedVariant = { ...seed.derived, furniture: [] };

function env(over: Partial<PlacerEnv> = {}) {
  const addFurniture = vi.fn((..._args: unknown[]) => 'f-new' as unknown);
  const select = vi.fn();
  const planCentre = vi.fn((): { centre: Vec2; storeyId?: string | null } | null => ({ centre: [19.7, 0.3], storeyId: 'ground' }));
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
    expect(planCentre).toHaveBeenCalled();
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
