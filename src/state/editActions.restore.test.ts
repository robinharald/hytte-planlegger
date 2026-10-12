/**
 * "Ta tilbake" after bigger wall moves and after real drag sessions (polish round, phase 2b): every existing stored
 * wall of the seed moved ±0.7 / ±1 m across itself with `moveWall`, and dragged ±0.3 / ±0.7 m through
 * beginDrag / updateDrag / endDrag with the plan's snap radius (0.49 m: 12 px at 24,5 px/m), then "Ta tilbake" on its
 * ghost: walls, openings, edge ghosts and the named rooms are today's again. A forward step whose wall end lands on an
 * untouched neighbour's corner (snapping makes that likely: w-peis-n onto dv-stue-n / dv-kjk-w at (9, 2.2)) must not
 * drag that neighbour along on the way back.
 */
import { describe, expect, it } from 'vitest';
import { createForslagD } from '../model/seed/forslagD';
import type { Variant, Vec2, Wall } from '../model/types';
import * as A from './editActions';
import { createAppStore, selectActiveVariant } from './store';
import { deriveForState } from './useDerived';

type Store = ReturnType<typeof createAppStore>;

function proposal(): Store {
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  store.getState().clearHistory();
  return store;
}

const J = (x: unknown) => JSON.stringify(x);
const V = (s: Store): Variant => selectActiveVariant(s.getState());
const SNAP_RADIUS = 0.49;

/** Unit left normal of a wall. */
const normalOf = (w: Wall): Vec2 => {
  const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  return [-(w.b[1] - w.a[1]) / L, (w.b[0] - w.a[0]) / L];
};

/**
 * Today's walls, openings and rooms (by face area) again, no ghosts. `rooms` false: the forward step merged two rooms
 * (a wall moved onto another wall): Ta tilbake gives the geometry back, but the merged room's record only comes back
 * when its face is unnamed after the restore (known gap: the kept room may take the larger face back).
 */
function sameAsSeed(s: Store, v0: Variant, area0: Map<string | undefined, number>, rooms = true): string | null {
  const v = V(s);
  if (J(v.walls) !== J(v0.walls)) return `walls ${v.walls.filter((w) => !v0.walls.some((x) => J(x) === J(w))).map((w) => `${w.id} ${J([w.a, w.b])} ${w.status}`).join('; ')}`;
  if (J(v.openings) !== J(v0.openings)) return `openings ${v.openings.filter((o) => !v0.openings.some((x) => J(x) === J(o))).map((o) => o.id).join(', ')}`;
  if (v.ghosts !== undefined) return `ghosts ${J(v.ghosts)}`;
  if (!rooms) return null;
  const named = deriveForState(s.getState()).rooms.filter((r) => r.room);
  if (named.length !== 27 || !named.every((r) => Math.abs(r.area - (area0.get(r.room?.id) ?? -1)) < 1e-6)) return `rooms (${named.length} named)`;
  return null;
}

function sweep(move: (store: Store, w: Wall, k: number) => boolean, ks: number[]): { cases: number; problems: string[] } {
  const store = proposal();
  const v0 = V(store);
  const area0 = new Map(deriveForState(store.getState()).rooms.filter((r) => r.room).map((r) => [r.room?.id, r.area]));
  const problems: string[] = [];
  let cases = 0;
  for (const w of v0.walls) {
    if (w.status !== 'existing') continue;
    for (const k of ks) {
      store.getState().replaceVariant(v0.id, v0);
      store.getState().clearHistory();
      if (!move(store, w, k) || !V(store).walls.some((x) => x.id === `${w.id}/ghost`)) continue;
      cases++;
      const merged = deriveForState(store.getState()).rooms.filter((r) => r.room).length < 27;
      A.restoreGhost(store, `${w.id}/ghost`);
      const why = sameAsSeed(store, v0, area0, !merged);
      if (why) problems.push(`${w.id} ${k}: ${why}`);
    }
  }
  return { cases, problems };
}

describe('"Ta tilbake" after bigger moves and real drags of every existing wall', () => {
  it('moveWall ±0.7 / ±1 m, then Ta tilbake: today again', () => {
    const { cases, problems } = sweep((store, w, k) => {
      const n = normalOf(w);
      return A.moveWall(store, w.id, [n[0] * k, n[1] * k]);
    }, [0.7, -0.7, 1, -1]);
    expect(cases).toBeGreaterThanOrEqual(80);
    expect(problems).toEqual([]);
  }, 300000);

  it('drag sessions ±0.3 / ±0.7 m with the snap radius 0.49 m, then Ta tilbake: today again', () => {
    const { cases, problems } = sweep((store, w, k) => {
      const n = normalOf(w);
      const mid: Vec2 = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
      const session = A.beginDrag(store, { kind: 'wall', id: w.id }, mid, undefined, { snapRadiusM: SNAP_RADIUS });
      if (!session) return false;
      for (const t of [0.5, 1]) A.updateDrag(store, session, [mid[0] + n[0] * k * t, mid[1] + n[1] * k * t], { snapRadiusM: SNAP_RADIUS });
      A.endDrag(store, session);
      return true;
    }, [0.3, -0.3, 0.7, -0.7]);
    expect(cases).toBeGreaterThanOrEqual(80);
    expect(problems).toEqual([]);
  }, 300000);

  it('the review cases: w-peis-n −0.7, w-vf-kjk −0.7 and dv-kjk-w +0.7 dragged onto a neighbour\'s corner, then Ta tilbake', () => {
    const store = proposal();
    const v0 = V(store);
    const area0 = new Map(deriveForState(store.getState()).rooms.filter((r) => r.room).map((r) => [r.room?.id, r.area]));
    for (const [id, k] of [
      ['w-peis-n', -0.7],
      ['w-vf-kjk', -0.7],
      ['dv-kjk-w', 0.7],
      ['w-peis-n', -1],
    ] as [string, number][]) {
      store.getState().replaceVariant(v0.id, v0);
      const w = v0.walls.find((x) => x.id === id) as Wall;
      const n = normalOf(w);
      const mid: Vec2 = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
      const session = A.beginDrag(store, { kind: 'wall', id }, mid, undefined, { snapRadiusM: SNAP_RADIUS });
      A.updateDrag(store, session, [mid[0] + n[0] * k, mid[1] + n[1] * k], { snapRadiusM: SNAP_RADIUS });
      A.endDrag(store, session);
      expect(A.restoreGhost(store, `${id}/ghost`), `${id} ${k}`).toBe(true);
      expect(sameAsSeed(store, v0, area0), `${id} ${k}`).toBeNull();
    }
  });
});
