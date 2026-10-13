/**
 * Final morning round (editor core), on the real seed through the edit actions:
 *  1. «Ta tilbake» has no geometric fallback for a proposal without any `Wall.carriedBy` (it fired in today's proposals
 *     whenever nothing happened to be carried, and slanted the user's own walls): those walls stay straight, their ends
 *     closed on the restored wall;
 *  2. a «Ta tilbake» on a house edge that is refused changes nothing — the unit against the edge is not pushed first;
 *  3. a merged-away room record survives a wall move that only adds a sliver face (also across a reload);
 *  4. a house edge or corner that cannot move because a unit stands against it names the unit (toast and drag hint);
 *  5. Bredde / Dybde that makes a unit narrower than its own opening narrows the opening to fit, with a toast.
 */
import { describe, expect, it } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import { migrateProject } from '../model/migrate';
import { createForslagD } from '../model/seed/forslagD';
import type { Project, Variant, Vec2, Wall } from '../model/types';
import * as A from './editActions';
import { EDIT_STRINGS } from './editStrings';
import { createAppStore, selectActiveVariant } from './store';
import { deriveForState } from './useDerived';

type Store = ReturnType<typeof createAppStore>;

/** The seed project with an unlocked copy of Forslag D active (JSON, so each store starts from a fresh copy). */
const BASE = (() => {
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  return JSON.stringify(store.getState().project);
})();

/** A store on the seed with an unlocked copy of Forslag D active and an empty history. */
const proposal = (): Store => createAppStore(JSON.parse(BASE) as Project);

const SEED = selectActiveVariant(proposal().getState());
const J = (x: unknown) => JSON.stringify(x);
const V = (s: Store): Variant => selectActiveVariant(s.getState());
const D = (s: Store): DerivedVariant => deriveForState(s.getState());
const wall = (s: Store, id: string): Wall => V(s).walls.find((w) => w.id === id)!;
const seedWall = (id: string) => J(SEED.walls.find((w) => w.id === id));
const ends = (s: Store, id: string) => [wall(s, id).a, wall(s, id).b];
const toastTexts = (s: Store) => s.getState().toasts.map((t) => t.text);
const warnings = (s: Store) => D(s).warnings.map((w) => w.kind);
const named = (s: Store) =>
  D(s)
    .rooms.filter((r) => r.room)
    .map((r) => r.room?.name ?? '');
const undoSteps = (s: Store) => s.temporal.getState().pastStates.length;
const LAPTOP = { snapRadiusM: 12 / 23.5 };
const PHONE = { snapRadiusM: 24 / 11.56, coarse: true };
const ON_BLOCK = `${EDIT_STRINGS.unitOnBlock}.`;
const box = (pts: Vec2[]) => ({
  x0: Math.min(...pts.map((p) => p[0])),
  y0: Math.min(...pts.map((p) => p[1])),
  x1: Math.max(...pts.map((p) => p[0])),
  y1: Math.max(...pts.map((p) => p[1])),
});
const blockPts = (s: Store, id: string): Vec2[] => V(s).blocks.find((b) => b.id === id)?.polygon.map((v) => v.p) ?? [];
const normalOf = (w: Pick<Wall, 'a' | 'b'>): Vec2 => {
  const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  return [-(w.b[1] - w.a[1]) / L, (w.b[0] - w.a[0]) / L];
};
/** Wall `id` moved by k m along its left normal. */
const moveAcross = (s: Store, id: string, k: number) => {
  const n = normalOf(wall(s, id));
  return A.moveWall(s, id, [n[0] * k, n[1] * k]);
};
/** A reload: the project through JSON and the migration, a new store, no undo history. */
const reload = (s: Store): Store => createAppStore(migrateProject(JSON.parse(J(s.getState().project)) as Project));

/** A unit tapped on the phone at `at` (snapped like the Nytt bygg tool); the toasts cleared. */
function tapped(s: Store, template: string, at: Vec2, rotation = 0): string {
  const r = A.snapPoint(s, at, { purpose: 'unit', templateId: template, rotation90: rotation, modifiers: PHONE });
  const id = A.placeUnit(s, template, r.point, rotation);
  expect(id, `${template} at ${J(at)}`).not.toBeNull();
  s.setState({ toasts: [] });
  return id as string;
}

/** Everything of the variant but the furniture (the house and every unit). */
const buildings = (v: Variant) => J({ blocks: v.blocks, walls: v.walls, rooms: v.rooms, openings: v.openings, ghosts: v.ghosts ?? null });

// ---------------------------------------------------------------------------------------------------------------
// 1. No geometric fallback without carriedBy
// ---------------------------------------------------------------------------------------------------------------

describe('«Ta tilbake» in a proposal where no wall holds carriedBy leaves the user\'s own walls straight', () => {
  for (const reloaded of [false, true]) {
    const label = reloaded ? ' (after a reload)' : '';
    const restore = (s0: Store, id: string): Store => {
      // Nothing is carried any more: the case the fallback took for a proposal saved before carriedBy.
      expect(V(s0).walls.some((w) => w.carriedBy !== undefined)).toBe(false);
      const s = reloaded ? reload(s0) : s0;
      s.setState({ toasts: [] });
      expect(A.restoreGhost(s, `${id}/ghost`)).toBe(true);
      expect(named(s)).toHaveLength(27);
      expect(warnings(s)).not.toContain('wall-dangling');
      return s;
    };

    it(`dv-leseskrok −0,3, w-106-stue +0,3, Ta tilbake on dv-leseskrok: w-106-stue stays at x 5, its end on y 0${label}`, () => {
      const s0 = proposal();
      expect(moveAcross(s0, 'dv-leseskrok', -0.3)).toBe(true);
      expect(moveAcross(s0, 'w-106-stue', 0.3)).toBe(true);
      expect(ends(s0, 'w-106-stue')).toEqual([
        [5, -0.3],
        [5, 2.18],
      ]);
      const s = restore(s0, 'dv-leseskrok');
      expect(J(wall(s, 'dv-leseskrok'))).toBe(seedWall('dv-leseskrok'));
      // Before: [[5,1, 0], [5, 2,18]] — turned, no toast.
      expect(ends(s, 'w-106-stue')).toEqual([
        [5, 0],
        [5, 2.18],
      ]);
    });

    it(`…Ta tilbake on w-106-stue: dv-leseskrok stays at y −0,3, its end on x 5,1${label}`, () => {
      const s0 = proposal();
      expect(moveAcross(s0, 'dv-leseskrok', -0.3)).toBe(true);
      expect(moveAcross(s0, 'w-106-stue', 0.3)).toBe(true);
      const s = restore(s0, 'w-106-stue');
      // Before: [[5,1, 0], [9, −0,3]] — turned.
      expect(ends(s, 'dv-leseskrok')).toEqual([
        [5.1, -0.3],
        [9, -0.3],
      ]);
      expect(ends(s, 'w-106-stue')).toEqual([
        [5.1, -0.3],
        [5.1, 2.18],
      ]);
    });

    it(`w-mellom-boder +0,3, w-do-109 and w-109-108 0,2 east, Ta tilbake: both straight at x 6,4 and 7,8 to y 7,62${label}`, () => {
      const s0 = proposal();
      expect(moveAcross(s0, 'w-mellom-boder', 0.3)).toBe(true);
      expect(A.moveWall(s0, 'w-do-109', [0.2, 0])).toBe(true);
      expect(A.moveWall(s0, 'w-109-108', [0.2, 0])).toBe(true);
      const s = restore(s0, 'w-mellom-boder');
      expect(J(wall(s, 'w-mellom-boder'))).toBe(seedWall('w-mellom-boder'));
      // Before: [[6,2, 7,62], [6,4, 10,1]] and [[7,6, 7,62], [7,8, 10,1]] — turned.
      expect(ends(s, 'w-do-109')).toEqual([
        [6.4, 7.62],
        [6.4, 10.1],
      ]);
      expect(ends(s, 'w-109-108')).toEqual([
        [7.8, 7.62],
        [7.8, 10.1],
      ]);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 2. A refused «Ta tilbake» on a house edge changes nothing
// ---------------------------------------------------------------------------------------------------------------

describe('a refused «Ta tilbake» on a house edge changes nothing', () => {
  it('the review\'s case: a shed against the moved south edge, another in its path → false, toast, no change, no undo step', () => {
    for (const reloaded of [false, true]) {
      let s = proposal();
      expect(A.moveBlockEdge(s, 'blk-main', 'v-main-sw', [0, 0.5])).toBe(true);
      const shed = tapped(s, 'vedskjul', [12.8, -0.4]);
      expect(box(blockPts(s, shed))).toEqual({ x0: 11.8, y0: -1, x1: 13.8, y1: 0.5 });
      const other = A.placeUnit(s, 'vedskjul', [15, -0.5], 0);
      expect(other).not.toBeNull();
      expect(box(blockPts(s, other as string))).toEqual({ x0: 14, y0: -1.25, x1: 16, y1: 0.25 });
      if (reloaded) s = reload(s);
      s.setState({ toasts: [] });
      const before = J(s.getState().project);
      const steps = undoSteps(s);
      expect(A.restoreGhost(s, 'blk-main/v-main-sw/ghost')).toBe(false);
      // The second shed, in the old edge's way, is named (fix round 3 after phase 3; before: the general ON_BLOCK).
      expect(toastTexts(s)).toEqual([`${EDIT_STRINGS.restoreUnitInTheWay('Vedskjul 2')}.`]);
      // Before: the first shed was pushed 0,5 m off the house and that was saved as an undo step.
      expect(J(s.getState().project)).toBe(before);
      expect(undoSteps(s)).toBe(steps);
      expect(box(blockPts(s, shed))).toEqual({ x0: 11.8, y0: -1, x1: 13.8, y1: 0.5 });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 3. A sliver face does not split a merged-away room's face
// ---------------------------------------------------------------------------------------------------------------

describe('a merged-away room record survives a wall move that only adds a sliver face', () => {
  it('deleteWall w-vf-kjk, w-103-102 0,2 east, a reload, Ta tilbake: «Vindfang» is back (and the review\'s other cases)', () => {
    for (const [del, moved, d, names] of [
      ['w-vf-kjk', 'w-103-102', [0.2, 0], ['Vindfang']],
      ['w-104-103', 'w-103-102', [-0.2, 0], ['Bad']],
      ['w-vf-korr', 'w-103-102', [0.2, 0], ['Korridor (øvre)', 'Vindfang']],
      ['w-106-korr', 'w-106-stue', [-0.2, 0], ['Korridor (nedre)', 'Trapperepos']],
    ] as const) {
      let s = proposal();
      expect(A.deleteWall(s, del)).toBe(true);
      expect(V(s).mergedRooms?.map((m) => m.room.name).sort(), del).toEqual([...names]);
      expect(A.moveWall(s, moved, [d[0], d[1]])).toBe(true);
      // The move leaves an unnamed sliver (0,39–0,44 m²) beside the merged face: no split, the record stays.
      expect(V(s).mergedRooms?.map((m) => m.room.name).sort(), del).toEqual([...names]);
      s = reload(s);
      s.setState({ toasts: [] });
      const unnamed = warnings(s).filter((k) => k === 'room-unnamed').length;
      expect(A.restoreGhost(s, del), del).toBe(true);
      expect(named(s), del).toHaveLength(27);
      for (const n of names) {
        expect(named(s), del).toContain(n);
        expect(toastTexts(s).join(' '), del).toContain(`«${n}»`);
      }
      // Only the sliver of the user's own move stays unnamed (before: the restored room too).
      expect(warnings(s).filter((k) => k === 'room-unnamed').length, del).toBeLessThanOrEqual(unnamed);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 4. A house edge with a unit against it names the unit
// ---------------------------------------------------------------------------------------------------------------

describe('a house edge or corner that cannot move because a unit stands against it names the unit', () => {
  const NAMED = `${EDIT_STRINGS.unitInTheWay('Vedskjul')}.`;

  it('the review\'s Vedskjul at (12,8, −0,9): the south edge 5 cm or 0,5 m out, by action and by drag', () => {
    const s = proposal();
    const shed = tapped(s, 'vedskjul', [12.8, -0.9]);
    expect(box(blockPts(s, shed))).toEqual({ x0: 11.8, y0: -1.5, x1: 13.8, y1: 0 });
    const before = buildings(V(s));
    expect(NAMED).toBe('«Vedskjul» står inntil veggen – flytt det først.');
    for (const d of [-0.05, -0.5]) {
      s.setState({ toasts: [] });
      expect(A.moveBlockEdge(s, 'blk-main', 'v-main-sw', [0, d]), `${d}`).toBe(false);
      expect(toastTexts(s), `${d}`).toEqual([NAMED]);
      expect(buildings(V(s)), `${d}`).toBe(before);
    }
    // A laptop drag of the 16 m edge 0,6 m south: the hint names the shed; nothing changes.
    const session = A.beginDrag(s, { kind: 'blockEdge', id: 'v-main-sw' }, [8, 0], undefined, { snapRadiusM: LAPTOP.snapRadiusM });
    let hint: string | undefined;
    for (const k of [0.25, 0.5, 0.75, 1]) hint = A.updateDrag(s, session, [8, -0.6 * k], LAPTOP).hint;
    expect(hint).toBe(EDIT_STRINGS.unitInTheWay('Vedskjul'));
    expect(A.previewDrag(session, [8, -0.6], LAPTOP).hint).toBe(EDIT_STRINGS.unitInTheWay('Vedskjul'));
    A.endDrag(s, session);
    expect(buildings(V(s))).toBe(before);
  });

  it('the main house\'s south-west corner with a shed on the west side, and the wing\'s south edge with a Bod against it', () => {
    const s = proposal();
    tapped(s, 'vedskjul', [-0.9, 4], 1);
    expect(A.moveBlockVertex(s, 'blk-main', 'v-main-sw', [-0.3, -0.3])).toBe(false);
    expect(toastTexts(s)).toEqual([NAMED]);
    const t = proposal();
    const bod = tapped(t, 'bod', [18.4, -3.4]);
    expect(box(blockPts(t, bod)).y1).toBeCloseTo(-2, 9);
    expect(A.moveBlockEdge(t, 'blk-wing', 'v-wing-sw', [0, -0.3])).toBe(false);
    expect(toastTexts(t)).toEqual([`${EDIT_STRINGS.unitInTheWay('Bod')}.`]);
  });

  it('the shed\'s own edge pushed into the house keeps the general message', () => {
    const s = proposal();
    const shed = tapped(s, 'vedskjul', [12.8, -0.9]);
    const north = V(s).blocks.find((b) => b.id === shed)!.polygon[2].id;
    expect(A.moveBlockEdge(s, shed, north, [0, 1])).toBe(false);
    expect(toastTexts(s)).toEqual([ON_BLOCK]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 5. A narrowed unit narrows its own opening
// ---------------------------------------------------------------------------------------------------------------

describe('Bredde / Dybde that makes a unit narrower than its own opening narrows the opening to fit', () => {
  it('Vedskjul Bredde 3,0 → 1,5 (north of the wing, south of the main house): no opening-outside-host, with a toast', () => {
    for (const at of [
      [18.4, 7],
      [12.8, -0.9],
    ] as Vec2[]) {
      const s = proposal();
      const shed = tapped(s, 'vedskjul', at);
      const own = () => V(s).openings.filter((o) => o.host.kind === 'blockEdge' && o.host.blockId === shed);
      expect(own().map((o) => o.width)).toEqual([1.8]);
      expect(A.setBlockSize(s, shed, 'd', 1.0)).toBe(true);
      expect(A.setBlockSize(s, shed, 'w', 3.0)).toBe(true);
      expect(toastTexts(s).join(' '), J(at)).not.toContain('smalere');
      s.setState({ toasts: [] });
      expect(A.setBlockSize(s, shed, 'w', 1.5), J(at)).toBe(true);
      expect(box(blockPts(s, shed)).x1 - box(blockPts(s, shed)).x0, J(at)).toBeCloseTo(1.5, 9);
      // Narrowed to the new front, 0,1 m posts at both ends, centred.
      expect(own().map((o) => [o.offset, o.width]), J(at)).toEqual([[0.75, 1.3]]);
      expect(warnings(s), J(at)).not.toContain('opening-outside-host');
      expect(toastTexts(s), J(at)).toContain(EDIT_STRINGS.unitOpeningsNarrowed('Vedskjul', 1));
      expect(EDIT_STRINGS.unitOpeningsNarrowed('Vedskjul', 1)).toBe('Åpningen i «Vedskjul» er gjort smalere, så den får plass i veggen.');
    }
  });
});
