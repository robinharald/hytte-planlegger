/**
 * Which wall a room size field moves, on the real seed (docs/phase2-plan.md §3.7): stored walls before block edges,
 * both movable → north / east ('max'), only block edges → none ("Endres under bygningsdelen").
 */
import { describe, expect, it } from 'vitest';
import { roomResizePlan, sideArrow } from './roomResize';
import { seedFixture } from './testSeed';

const { derived } = seedFixture();
const room = (id: string) => {
  const r = derived.rooms.find((x) => x.id === id);
  if (!r) throw new Error(`no room ${id}`);
  return r;
};

describe('roomResizePlan on Forslag D', () => {
  it('Soverom (ny fløy) Dybde: only the corridor wall below can move → w-gang-n, side min', () => {
    const plan = roomResizePlan(derived, room('room-sov-ny'), 'd');
    expect(plan.min?.wallId).toBe('w-gang-n');
    expect(plan.min?.stored).toBe(true);
    expect(plan.max?.stored).toBe(false); // the wing's north exterior wall
    expect(plan.movable).toEqual(['min']);
    expect(plan.defaultSide).toBe('min');
  });

  it('Soverom (ny fløy) Bredde: w-wing-w on the west, the exterior wall on the east → min', () => {
    const plan = roomResizePlan(derived, room('room-sov-ny'), 'w');
    expect(plan.min?.wallId).toBe('w-wing-w');
    expect(plan.max?.stored).toBe(false);
    expect(plan.defaultSide).toBe('min');
  });

  it('Gang Dybde: stored walls on both sides → north (max) by default, both movable', () => {
    const plan = roomResizePlan(derived, room('room-gang'), 'd');
    expect(plan.min?.wallId).toBe('w-gang-s');
    expect(plan.max?.wallId).toBe('w-gang-n');
    expect(plan.movable).toEqual(['min', 'max']);
    expect(plan.defaultSide).toBe('max');
  });

  it('Leseskrok Bredde: only the glass bump exterior walls → nothing to move', () => {
    const plan = roomResizePlan(derived, room('room-leseskrok'), 'w');
    expect(plan.movable).toEqual([]);
    expect(plan.defaultSide).toBeNull();
    expect(plan.min?.stored).toBe(false);
    expect(plan.max?.stored).toBe(false);
  });

  it('Leseskrok Dybde: the divider to the Stue counts as a stored wall', () => {
    const plan = roomResizePlan(derived, room('room-leseskrok'), 'd');
    expect(plan.max?.wallId).toBe('dv-leseskrok');
    expect(plan.defaultSide).toBe('max');
  });

  it('arrows point away from the room', () => {
    expect(sideArrow('w', 'min')).toEqual([-1, 0]);
    expect(sideArrow('w', 'max')).toEqual([1, 0]);
    expect(sideArrow('d', 'min')).toEqual([0, -1]);
    expect(sideArrow('d', 'max')).toEqual([0, 1]);
  });
});
