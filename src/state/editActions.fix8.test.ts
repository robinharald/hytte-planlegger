/**
 * Fix round 3 after phase 3 (editor core), on the real seed through the edit actions:
 *  1. two template units snapped side by side: an edit of one never squeezes the other — Bredde changes the free side,
 *     an edge pushed into the neighbour is refused with the toast naming it (as against the house);
 *  2. Bredde / Dybde centres the unit's own opening and lets it grow back towards the template's width (no jump near
 *     it: a post stays at each end);
 *  3. a refused «Ta tilbake» on a house edge names the unit in the way.
 */
import { describe, expect, it } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import { migrateProject } from '../model/migrate';
import { createForslagD } from '../model/seed/forslagD';
import type { Project, Variant, Vec2 } from '../model/types';
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

const proposal = (): Store => createAppStore(JSON.parse(BASE) as Project);
const J = (x: unknown) => JSON.stringify(x);
const V = (s: Store): Variant => selectActiveVariant(s.getState());
const D = (s: Store): DerivedVariant => deriveForState(s.getState());
const toastTexts = (s: Store) => s.getState().toasts.map((t) => t.text);
const warnings = (s: Store) => D(s).warnings.map((w) => w.kind);
const named = (s: Store) =>
  D(s)
    .rooms.filter((r) => r.room)
    .map((r) => r.room?.name ?? '');
const undoSteps = (s: Store) => s.temporal.getState().pastStates.length;
const reload = (s: Store): Store => createAppStore(migrateProject(JSON.parse(J(s.getState().project)) as Project));
const LAPTOP = { snapRadiusM: 12 / 23.5 };
const PHONE = { snapRadiusM: 24 / 11.56, coarse: true };
const box = (pts: Vec2[]) => ({
  x0: Math.min(...pts.map((p) => p[0])),
  y0: Math.min(...pts.map((p) => p[1])),
  x1: Math.max(...pts.map((p) => p[0])),
  y1: Math.max(...pts.map((p) => p[1])),
});
const blockPts = (s: Store, id: string): Vec2[] => V(s).blocks.find((b) => b.id === id)?.polygon.map((v) => v.p) ?? [];
const width = (s: Store, id: string) => box(blockPts(s, id)).x1 - box(blockPts(s, id)).x0;
/** The unit's openings as [offset, width]. */
const own = (s: Store, id: string) => V(s).openings.filter((o) => o.host.kind === 'blockEdge' && o.host.blockId === id).map((o) => [o.offset, o.width]);
/** Block `id` with everything that belongs to it (its polygon, room, openings). */
const unitState = (s: Store, id: string) =>
  J({
    block: V(s).blocks.find((b) => b.id === id),
    rooms: V(s).rooms.filter((r) => r.unitId === id),
    openings: V(s).openings.filter((o) => o.host.kind === 'blockEdge' && o.host.blockId === id),
  });

/** A unit tapped on the phone at `at` (snapped like the Nytt bygg tool); the toasts cleared. */
function tapped(s: Store, template: string, at: Vec2, rotation = 0): string {
  const r = A.snapPoint(s, at, { purpose: 'unit', templateId: template, rotation90: rotation, modifiers: PHONE });
  const id = A.placeUnit(s, template, r.point, rotation);
  expect(id, `${template} at ${J(at)}`).not.toBeNull();
  s.setState({ toasts: [] });
  return id as string;
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Two units side by side
// ---------------------------------------------------------------------------------------------------------------

describe('a unit snapped against another unit is never squeezed by an edit of its neighbour', () => {
  /** The review's two Vedskjul: A at (18,4, 9), B tapped 1,05 m east of A's east side, snapped flush against it. */
  function twoSheds(): { s: Store; a: string; b: string } {
    const s = proposal();
    const a = tapped(s, 'vedskjul', [18.4, 9]);
    const ab = box(blockPts(s, a));
    const b = tapped(s, 'vedskjul', [ab.x1 + 1.05, (ab.y0 + ab.y1) / 2]);
    expect(box(blockPts(s, a))).toEqual({ x0: 17.4, y0: 8.3, x1: 19.4, y1: 9.8 });
    expect(box(blockPts(s, b))).toEqual({ x0: 19.4, y0: 8.3, x1: 21.4, y1: 9.8 });
    expect(D(s).blocks.find((x) => x.block.id === a)?.junctions.map((j) => j.otherBlockId)).toEqual([b]);
    expect(V(s).blocks.find((x) => x.id === b)?.name).toBe('Vedskjul 2');
    return { s, a, b };
  }
  const eastEdge = (s: Store, id: string) => V(s).blocks.find((x) => x.id === id)!.polygon[1].id;
  const westEdge = (s: Store, id: string) => V(s).blocks.find((x) => x.id === id)!.polygon[3].id;

  it('Bredde 3,0 (and 3,8, 5,0) on A: B is unchanged, A reaches the typed width on its free west side', () => {
    for (const w of [3, 3.8, 5]) {
      const { s, a, b } = twoSheds();
      const before = unitState(s, b);
      const rooms = named(s).length;
      expect(A.setBlockSize(s, a, 'w', w, 'max'), `${w}`).toBe(true);
      // Before: B shrank to 1,0 / 0,2 / 0,167 m, its open front outside its wall, its room merged into A's.
      expect(unitState(s, b), `${w}`).toBe(before);
      expect(width(s, a), `${w}`).toBeCloseTo(w, 9);
      expect(box(blockPts(s, a)).x1, `${w}`).toBeCloseTo(19.4, 9);
      expect(warnings(s), `${w}`).not.toContain('opening-outside-host');
      expect(named(s), `${w}`).toHaveLength(rooms);
      expect(toastTexts(s).join(' '), `${w}`).not.toContain('ett rom');
    }
  });

  it("A's east edge 0,3 m east (by action and by drag) is refused, naming «Vedskjul 2»; B's west edge into A names «Vedskjul»", () => {
    const { s, a, b } = twoSheds();
    const before = J(V(s));
    const steps = undoSteps(s);
    expect(A.moveBlockEdge(s, a, eastEdge(s, a), [0.3, 0])).toBe(false);
    expect(toastTexts(s)).toEqual([`${EDIT_STRINGS.unitInTheWay('Vedskjul 2')}.`]);
    expect(J(V(s))).toBe(before);
    expect(undoSteps(s)).toBe(steps);
    s.setState({ toasts: [] });
    expect(A.moveBlockEdge(s, b, westEdge(s, b), [-0.3, 0])).toBe(false);
    expect(toastTexts(s)).toEqual([`${EDIT_STRINGS.unitInTheWay('Vedskjul')}.`]);
    expect(J(V(s))).toBe(before);
    // A laptop drag of A's east edge: the hint names B, and nothing changes.
    const session = A.beginDrag(s, { kind: 'blockEdge', id: eastEdge(s, a) }, [19.4, 9], undefined, { snapRadiusM: LAPTOP.snapRadiusM });
    let hint: string | undefined;
    for (const k of [0.25, 0.5, 1]) hint = A.updateDrag(s, session, [19.4 + 0.3 * k, 9], LAPTOP).hint;
    expect(hint).toBe(EDIT_STRINGS.unitInTheWay('Vedskjul 2'));
    A.endDrag(s, session);
    expect(J(V(s))).toBe(before);
  });

  it("A's east edge 0,3 m west leaves B where it is (before: B grew with it)", () => {
    const { s, a, b } = twoSheds();
    const before = unitState(s, b);
    expect(A.moveBlockEdge(s, a, eastEdge(s, a), [-0.3, 0])).toBe(true);
    expect(box(blockPts(s, a)).x1).toBeCloseTo(19.1, 9);
    expect(unitState(s, b)).toBe(before);
  });

  it('A between two units: Bredde 3,0 is refused with the toast naming the neighbour, also after a reload', () => {
    for (const reloaded of [false, true]) {
      const two = twoSheds();
      let s = two.s;
      const { a, b } = two;
      const ab = box(blockPts(s, a));
      const c = tapped(s, 'vedskjul', [ab.x0 - 1.05, (ab.y0 + ab.y1) / 2]);
      expect(box(blockPts(s, c)).x1).toBeCloseTo(17.4, 9);
      if (reloaded) s = reload(s);
      s.setState({ toasts: [] });
      const before = J(V(s));
      expect(A.setBlockSize(s, a, 'w', 3, 'max')).toBe(false);
      expect(toastTexts(s)).toEqual([`${EDIT_STRINGS.unitInTheWay('Vedskjul 2')}.`]);
      expect(J(V(s))).toBe(before);
      expect(A.setBlockSize(s, a, 'w', 3, 'min')).toBe(false);
      expect(toastTexts(s).at(-1)).toBe(`${EDIT_STRINGS.unitInTheWay('Vedskjul 3')}.`);
      expect(J(V(s))).toBe(before);
      // Narrower still works, and only A changes.
      const others = [unitState(s, b), unitState(s, c)];
      expect(A.setBlockSize(s, a, 'w', 1.6, 'max')).toBe(true);
      expect(width(s, a)).toBeCloseTo(1.6, 9);
      expect([unitState(s, b), unitState(s, c)]).toEqual(others);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2. The unit's own opening follows Bredde both ways
// ---------------------------------------------------------------------------------------------------------------

describe("Bredde / Dybde centres the unit's own opening and lets it grow back", () => {
  it('Vedskjul at (18,4, 9): Bredde 1,5 then 2,0 restores the placed opening [offset 1, width 1,8]', () => {
    const s = proposal();
    const shed = tapped(s, 'vedskjul', [18.4, 9]);
    expect(own(s, shed)).toEqual([[1, 1.8]]);
    expect(A.setBlockSize(s, shed, 'w', 1.5)).toBe(true);
    expect(own(s, shed)).toEqual([[0.75, 1.3]]);
    expect(toastTexts(s)).toContain(EDIT_STRINGS.unitOpeningsNarrowed('Vedskjul', 1));
    s.setState({ toasts: [] });
    expect(A.setBlockSize(s, shed, 'w', 2)).toBe(true);
    // Before: still [0,75, 1,3], off-centre, with no warning.
    expect(own(s, shed)).toEqual([[1, 1.8]]);
    expect(toastTexts(s)).toEqual([]);
    expect(warnings(s)).not.toContain('opening-outside-host');
  });

  it("no jump near the template's width: a 0,1 m post at each end; wider than the template keeps 1,8 m, centred", () => {
    const s = proposal();
    const shed = tapped(s, 'vedskjul', [18.4, 9]);
    for (const [w, expected] of [
      [1.75, [0.875, 1.55]],
      [1.8, [0.9, 1.6]],
      [1.81, [0.905, 1.61]],
      [2, [1, 1.8]],
      [3, [1.5, 1.8]],
      [2, [1, 1.8]],
    ] as [number, number[]][]) {
      expect(A.setBlockSize(s, shed, 'w', w), `${w}`).toBe(true);
      const [[offset, ow]] = own(s, shed);
      expect(offset, `${w}`).toBeCloseTo(expected[0], 9);
      expect(ow, `${w}`).toBeCloseTo(expected[1], 9);
      expect(warnings(s), `${w}`).not.toContain('opening-outside-host');
    }
    // Dybde leaves the front (its length does not change) as it is.
    expect(A.setBlockSize(s, shed, 'd', 1.2)).toBe(true);
    expect(own(s, shed)).toEqual([[1, 1.8]]);
  });

  it('an opening the user made narrower keeps its width (centred) when the unit grows again', () => {
    const s = proposal();
    const shed = tapped(s, 'vedskjul', [18.4, 9]);
    const id = V(s).openings.find((o) => o.host.kind === 'blockEdge' && o.host.blockId === shed)!.id;
    expect(A.setOpeningProps(s, id, { width: 1 })).toBe(true);
    expect(A.setBlockSize(s, shed, 'w', 1.5)).toBe(true);
    expect(own(s, shed)).toEqual([[0.75, 1]]);
    expect(A.setBlockSize(s, shed, 'w', 2.5)).toBe(true);
    expect(own(s, shed)).toEqual([[1.25, 1]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 3. A refused «Ta tilbake» on a house edge names the unit in the way
// ---------------------------------------------------------------------------------------------------------------

describe('a refused «Ta tilbake» on a house edge names the unit in the way', () => {
  it("a shed against the moved south edge, another in the old edge's way: «Vedskjul 2» står i veien, nothing changes", () => {
    expect(EDIT_STRINGS.restoreUnitInTheWay('Vedskjul')).toBe('Ta tilbake går ikke: «Vedskjul» står i veien – flytt det først');
    // [15, −0,5]: the editor-core review's case; [2,5, −0,5]: e2e (ae)'s, west of the glass bump.
    for (const [reloaded, at] of [
      [false, [15, -0.5]],
      [true, [15, -0.5]],
      [false, [2.5, -0.5]],
    ] as [boolean, Vec2][]) {
      let s = proposal();
      expect(A.moveBlockEdge(s, 'blk-main', 'v-main-sw', [0, 0.5])).toBe(true);
      const shed = tapped(s, 'vedskjul', [12.8, -0.4]);
      const other = A.placeUnit(s, 'vedskjul', at, 0);
      expect(other).not.toBeNull();
      if (reloaded) s = reload(s);
      s.setState({ toasts: [] });
      const before = J(s.getState().project);
      const steps = undoSteps(s);
      expect(A.restoreGhost(s, 'blk-main/v-main-sw/ghost')).toBe(false);
      expect(toastTexts(s)).toEqual([`${EDIT_STRINGS.restoreUnitInTheWay('Vedskjul 2')}.`]);
      expect(J(s.getState().project)).toBe(before);
      expect(undoSteps(s)).toBe(steps);
      expect(box(blockPts(s, shed)).y1).toBeCloseTo(0.5, 9);
    }
  });

  it('a shed against the moved edge that cannot be pushed away (another shed against it) is the one named', () => {
    const s = proposal();
    expect(A.moveBlockEdge(s, 'blk-main', 'v-main-sw', [0, 0.5])).toBe(true);
    const shed = tapped(s, 'vedskjul', [12.8, -0.4]);
    const sb = box(blockPts(s, shed));
    const below = tapped(s, 'vedskjul', [(sb.x0 + sb.x1) / 2, sb.y0 - 0.8]);
    expect(box(blockPts(s, below)).y1).toBeCloseTo(sb.y0, 9);
    const before = J(s.getState().project);
    expect(A.restoreGhost(s, 'blk-main/v-main-sw/ghost')).toBe(false);
    expect(toastTexts(s)).toEqual([`${EDIT_STRINGS.restoreUnitInTheWay('Vedskjul')}.`]);
    expect(J(s.getState().project)).toBe(before);
  });
});
