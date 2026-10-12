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

// ---------------------------------------------------------------------------------------------------------------
// Second fix round: moves of whole units / blocks / the hot tub (snapPolygon, snapCircle) and wall-end drags (point
// targets) used the full pointer radius (about 2 m on the phone): a Vedskjul dragged 2 m west moved 4 m, one dragged
// 1 m north snapped back, the wing could not be moved 0,4 m, and a wall end dragged 0,36 m stayed where it was.
// ---------------------------------------------------------------------------------------------------------------

type Sel = { kind: 'block' | 'wall' | 'hotTub'; id: string };

/** Drag `sel` (or one of its handles) from `from` by `delta` on `store` at a zoom, like the plan does. */
function dragOn(store: Store, sel: Sel, from: Vec2, delta: Vec2, scale: number, o: { coarse?: boolean; alt?: boolean; handle?: 'a' | 'b' } = {}) {
  const radius = snapRadiusM(!!o.coarse, scale);
  const session = A.beginDrag(store, sel, from, o.handle, { snapRadiusM: radius });
  expect(session).not.toBeNull();
  A.updateDrag(store, session, [from[0] + delta[0], from[1] + delta[1]], { snapRadiusM: radius, alt: !!o.alt, coarse: !!o.coarse });
  A.endDrag(store, session);
}

const blockMin = (s: Store, id: string): Vec2 => {
  const ps = selectActiveVariant(s.getState()).blocks.find((b) => b.id === id)!.polygon.map((v) => v.p);
  return [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1]))];
};

/** A proposal with a Vedskjul (2 × 1,5 m) centred on `at` (on the terrace by the wing: [13, 10,6]–[15, 12,1]). */
function withShed(at: Vec2 = [14, 11.35]): { store: Store; id: string } {
  const store = proposal();
  const id = A.placeUnit(store, 'vedskjul', at, 0);
  expect(id).toBeTruthy();
  store.getState().clearHistory();
  return { store, id: id! };
}

describe('moving a whole unit or block follows the finger (snapPolygon)', () => {
  it('phone (11,6 px/m): a Vedskjul dragged 2 m west moves 2,0 ± 0,25 m (it moved 4 m to the bod and deck edge)', () => {
    const { store, id } = withShed();
    const [x0] = blockMin(store, id);
    dragOn(store, { kind: 'block', id }, [14, 11.35], [-2, 0], PHONE, { coarse: true });
    expect(blockMin(store, id)[0] - x0).toBeGreaterThan(-2.25);
    expect(blockMin(store, id)[0] - x0).toBeLessThan(-1.75);
    // 2,5 m west as well (it also landed 4 m west).
    const b = withShed();
    dragOn(b.store, { kind: 'block', id: b.id }, [14, 11.35], [-2.5, 0], PHONE, { coarse: true });
    expect(blockMin(b.store, b.id)[0] - x0).toBeCloseTo(-2.5, 1);
  });

  it('phone: dragged 1 m north, away from the deck edge it stands on, it moves about 1 m (it snapped all the way back)', () => {
    const { store, id } = withShed();
    const [, y0] = blockMin(store, id);
    dragOn(store, { kind: 'block', id }, [14, 11.35], [0, 1], PHONE, { coarse: true });
    expect(blockMin(store, id)[1] - y0).toBeCloseTo(1, 1);
    // A purely horizontal drag keeps its y (no grid jump, no sideways snap).
    const b = withShed();
    dragOn(b.store, { kind: 'block', id: b.id }, [14, 11.35], [-1, 0.02], PHONE, { coarse: true });
    expect(blockMin(b.store, b.id)[1]).toBeCloseTo(y0, 9);
    expect(blockMin(b.store, b.id)[0] - blockMin(store, id)[0]).toBeCloseTo(-1, 1);
  });

  it('laptop (23,5 px/m): the wing dragged 0,4 m east moves (it snapped back against the cabin at x 16)', () => {
    const store = proposal();
    const [x0] = blockMin(store, 'blk-wing');
    dragOn(store, { kind: 'block', id: 'blk-wing' }, [18, 2], [0.4, 0], LAPTOP);
    expect(blockMin(store, 'blk-wing')[0] - x0).toBeCloseTo(0.4, 6);
  });

  it('a drag ending within 5 cm of the deck edge still snaps onto it', () => {
    // A shed 1 m south of the deck's north edge (y 12,1), dragged 0,96 m north: its north edge lands on 12,1.
    const { store, id } = withShed([14, 10.35]);
    const top = () => Math.max(...selectActiveVariant(store.getState()).blocks.find((b) => b.id === id)!.polygon.map((v) => v.p[1]));
    expect(top()).toBeCloseTo(11.1, 9);
    dragOn(store, { kind: 'block', id }, [14, 10.35], [0, 0.96], PHONE, { coarse: true });
    expect(top()).toBeCloseTo(12.1, 9);
  });

  it('phone: the hot tub dragged 1 m moves about 1 m', () => {
    const store = proposal();
    const c0 = selectActiveVariant(store.getState()).outdoor.hotTubs[0].centre;
    dragOn(store, { kind: 'hotTub', id: 'tub-1' }, c0, [-1, 0], PHONE, { coarse: true });
    const c1 = selectActiveVariant(store.getState()).outdoor.hotTubs[0].centre;
    expect(c1[0] - c0[0]).toBeCloseTo(-1, 1);
  });
});

describe('wall-end drags: point targets do not pull them back (snap with the drag origin)', () => {
  const korrB = (s: Store) => selectActiveVariant(s.getState()).walls.find((w) => w.id === 'w-vf-korr')!.b;

  it('laptop (24,7 px/m): w-vf-korr end b dragged from (9; 4,24) to (9; 4,6) lands there', () => {
    const store = proposal();
    dragOn(store, { kind: 'wall', id: 'w-vf-korr' }, [9, 4.24], [0, 0.36], 24.7, { handle: 'b' });
    expect(korrB(store)[0]).toBeCloseTo(9, 9);
    expect(korrB(store)[1]).toBeCloseTo(4.6, 9);
  });

  it('phone (11,6 px/m): a drag to (9; 4,8) lands within 0,1 m of it (it stayed at 4,24)', () => {
    const store = proposal();
    dragOn(store, { kind: 'wall', id: 'w-vf-korr' }, [9, 4.24], [0, 0.56], PHONE, { coarse: true, handle: 'b' });
    expect(Math.hypot(korrB(store)[0] - 9, korrB(store)[1] - 4.8)).toBeLessThan(0.1);
  });

  it('Alt turns point targets off too (1 cm grid)', () => {
    // 3 cm from the end of dv-kjk-w's line: with Alt the end stays at 4,61 instead of snapping.
    const store = proposal();
    dragOn(store, { kind: 'wall', id: 'w-vf-korr' }, [9, 4.24], [0.03, 0.37], 24.7, { handle: 'b', alt: true });
    expect(korrB(store)[0]).toBeCloseTo(9.03, 9);
    expect(korrB(store)[1]).toBeCloseTo(4.61, 9);
  });
});
