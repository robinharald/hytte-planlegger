/**
 * Snapping during drags on the real seed, at the zooms the UX review used (laptop 23,5 px/m, iPhone 11,6 px/m), with
 * the snap radius the plan passes (editModel.ts `snapRadiusM`: 12 px, 24 px coarse) through the editor core's drag
 * protocol. Before the fix the dragged wall's own line (continued by a collinear divider) and lines up to 0,5 m / 2 m
 * away pulled short drags back (UX review of phase 2a, "snapping fights short drags").
 */
import { describe, expect, it } from 'vitest';
import { createForslagD } from '../model/seed/forslagD';
import type { Vec2 } from '../model/types';
import * as A from '../state/editActions';
import { createAppStore, selectActiveVariant } from '../state/store';
import { snapRadiusM } from './editModel';

type Store = ReturnType<typeof createAppStore>;

function proposal(): Store {
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  store.getState().clearHistory();
  return store;
}

const LAPTOP = 23.5;
const PHONE = 11.6;

/** Drag the selection from `from` to `from + delta` at a zoom, with the plan's modifiers; returns the store. */
function drag(sel: { kind: 'wall'; id: string }, from: Vec2, delta: Vec2, scale: number, o: { coarse?: boolean; alt?: boolean } = {}): Store {
  const store = proposal();
  const radius = snapRadiusM(!!o.coarse, scale);
  const session = A.beginDrag(store, sel, from, undefined, { snapRadiusM: radius });
  expect(session).not.toBeNull();
  A.updateDrag(store, session, [from[0] + delta[0], from[1] + delta[1]], { snapRadiusM: radius, alt: !!o.alt, coarse: !!o.coarse });
  A.endDrag(store, session);
  return store;
}

const wallY = (s: Store, id: string) => selectActiveVariant(s.getState()).walls.find((w) => w.id === id)?.a[1];
const wallX = (s: Store, id: string) => selectActiveVariant(s.getState()).walls.find((w) => w.id === id)?.a[0];
const GANG_N = { kind: 'wall' as const, id: 'w-gang-n' };

describe('wall drags are not pulled back to where they started', () => {
  it('laptop (23,5 px/m): w-gang-n dragged +0,2 / +0,3 / +0,7 m lands on the 10 cm grid (3,6 / 3,7 / 4,1)', () => {
    expect(wallY(drag(GANG_N, [18, 3.4], [0, 0.2], LAPTOP), 'w-gang-n')).toBeCloseTo(3.6, 9);
    expect(wallY(drag(GANG_N, [18, 3.4], [0, 0.3], LAPTOP), 'w-gang-n')).toBeCloseTo(3.7, 9);
    expect(wallY(drag(GANG_N, [18, 3.4], [0, 0.7], LAPTOP), 'w-gang-n')).toBeCloseTo(4.1, 9);
  });

  it('phone (11,6 px/m, coarse): w-gang-n dragged +0,5 m lands at 3,9', () => {
    expect(wallY(drag(GANG_N, [18, 3.4], [0, 0.5], PHONE, { coarse: true }), 'w-gang-n')).toBeCloseTo(3.9, 9);
    expect(wallY(drag(GANG_N, [18, 3.4], [0, 1.0], PHONE, { coarse: true }), 'w-gang-n')).toBeCloseTo(4.4, 9);
  });

  it("the wing's east edge dragged +0,3 m moves (20,8 → 21,1)", () => {
    const store = drag({ kind: 'wall', id: 'blk-wing/v-wing-se/blk-wing-implicit/base' }, [20.8, 4], [0.3, 0], LAPTOP);
    expect(selectActiveVariant(store.getState()).blocks.find((b) => b.id === 'blk-wing')?.polygon[1].p).toEqual([21.1, -2]);
  });

  it('w-104-103 dragged 0,3 m east does not fall back onto w-105-106 (x 3,10, 5 cm from its start)', () => {
    const x = wallX(drag({ kind: 'wall', id: 'w-104-103' }, [3.05, 5], [0.3, 0], LAPTOP), 'w-104-103');
    expect(x).toBeGreaterThan(3.25);
    expect(x).toBeLessThan(3.45);
  });

  it('a drag to within 5 cm of a parallel line still snaps to it (w-vf-kjk to 7,00 → w-peis-w at 6,97)', () => {
    expect(wallX(drag({ kind: 'wall', id: 'w-vf-kjk' }, [8.35, 5], [-1.35, 0], LAPTOP), 'w-vf-kjk')).toBeCloseTo(6.97, 9);
    // Without a line near, the same wall lands on the grid.
    expect(wallX(drag({ kind: 'wall', id: 'w-vf-kjk' }, [8.35, 5], [-0.42, 0], LAPTOP), 'w-vf-kjk')).toBeCloseTo(7.9, 9);
  });

  it('Alt turns line snapping off (1 cm grid only)', () => {
    // 6,98 is 1 cm from w-peis-w's line: without Alt it snaps to 6,97, with Alt it stays at 6,98.
    expect(wallX(drag({ kind: 'wall', id: 'w-vf-kjk' }, [8.35, 5], [-1.37, 0], LAPTOP), 'w-vf-kjk')).toBeCloseTo(6.97, 9);
    expect(wallX(drag({ kind: 'wall', id: 'w-vf-kjk' }, [8.35, 5], [-1.37, 0], LAPTOP, { alt: true }), 'w-vf-kjk')).toBeCloseTo(6.98, 9);
    expect(wallY(drag(GANG_N, [18, 3.4], [0, 0.43], LAPTOP, { alt: true }), 'w-gang-n')).toBeCloseTo(3.83, 9);
  });
});
