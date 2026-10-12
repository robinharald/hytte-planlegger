import { describe, expect, it } from 'vitest';
import { createForslagD } from '../model/seed/forslagD';
import * as A from '../state/editActions';
import { createAppStore } from '../state/store';
import { deriveForState } from '../state/useDerived';
import { shareEqual } from './stable';
import { planLayerData } from './storeyData';
import type { PlanLayerData } from './storeyData';

describe('shareEqual', () => {
  it('returns the previous value when the next one is deep-equal', () => {
    const prev = { a: [1, 2, { b: [3, 4] }], c: 'x' };
    const next = { a: [1, 2, { b: [3, 4] }], c: 'x' };
    expect(shareEqual(prev, next)).toBe(prev);
    expect(shareEqual(null, next)).toBe(next);
    expect(shareEqual(prev, prev)).toBe(prev);
  });

  it('keeps the unchanged parts and copies the changed path only', () => {
    const prev = { walls: [{ id: 'a', p: [0, 0] }, { id: 'b', p: [1, 1] }], rooms: [{ id: 'r', area: 2 }] };
    const next = { walls: [{ id: 'a', p: [0, 0] }, { id: 'b', p: [1, 2] }], rooms: [{ id: 'r', area: 2 }] };
    const out = shareEqual(prev, next);
    expect(out).toEqual(next);
    expect(out).not.toBe(prev);
    expect(out.rooms).toBe(prev.rooms);
    expect(out.walls).not.toBe(prev.walls);
    expect(out.walls[0]).toBe(prev.walls[0]);
    expect(out.walls[1]).not.toBe(prev.walls[1]);
  });

  it('matches items by id when every item has one (an inserted item does not shift the others)', () => {
    const prev = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
    const next = [{ id: 'new', v: 0 }, { id: 'a', v: 1 }, { id: 'b', v: 2 }];
    const out = shareEqual(prev, next);
    expect(out[1]).toBe(prev[0]);
    expect(out[2]).toBe(prev[1]);
    expect(out[0]).toBe(next[0]);
    // Without ids: by index.
    expect(shareEqual([[1], [2]], [[0], [1], [2]])[1]).not.toBeUndefined();
  });

  it('numbers with Object.is; keys added or removed count as changes; class instances by identity', () => {
    expect(shareEqual({ x: 0 }, { x: -0 })).toEqual({ x: -0 });
    const nan = { x: Number.NaN };
    expect(shareEqual(nan, { x: Number.NaN })).toBe(nan);
    const prev = { a: 1 };
    expect(shareEqual(prev, { a: 1, b: undefined })).not.toBe(prev);
    expect(shareEqual({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
    const d1 = new Date(0);
    const d2 = new Date(0);
    expect(shareEqual({ d: d1 }, { d: d2 }).d).toBe(d2);
  });
});

describe('planLayerData shared across the frames of a wall drag (the layers only re-render what changed)', () => {
  it('w-gang-n dragged 0,1 m: walls, openings, unions, cuts, rooms and floors change; nothing else', () => {
    const store = createAppStore(createForslagD());
    store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
    let prev: PlanLayerData = planLayerData(deriveForState(store.getState()), 'ground');
    const session = A.beginDrag(store, { kind: 'wall', id: 'w-gang-n' }, [18, 3.4], undefined, { snapRadiusM: 0.5 });
    for (let i = 1; i <= 2; i++) {
      // South, into the corridor: north it would run into the bedroom's nightstand (the seed is furnished, revision 6).
      A.updateDrag(store, session, [18, 3.4 - 0.1 * i], { snapRadiusM: 0.5 });
      const next = shareEqual(prev, planLayerData(deriveForState(store.getState()), 'ground'));
      const changed = (Object.keys(next) as (keyof PlanLayerData)[]).filter((k) => next[k] !== prev[k]).sort();
      expect(changed).toEqual(['cuts', 'floors', 'openings', 'pieces', 'rooms', 'unions', 'walls']);
      // Within the changed arrays only the moved items are new: the wall itself, its door, the rooms on both sides.
      expect(next.pieces.filter((w, j) => w !== prev.pieces[j]).map((w) => w.id)).toEqual(['w-gang-n']);
      expect(next.openings.filter((o, j) => o !== prev.openings[j]).map((o) => o.opening.id)).toEqual(['d-sov-ny']);
      expect(next.rooms.filter((r, j) => r !== prev.rooms[j]).length).toBeLessThanOrEqual(3);
      prev = next;
    }
    A.endDrag(store, session);
  });
});
