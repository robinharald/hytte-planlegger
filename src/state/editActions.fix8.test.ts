/**
 * Fix round 3 after phase 3 (editor core), on the real seed through the edit actions:
 *  1. two template units snapped side by side: an edit of one never squeezes the other — Bredde changes the free side,
 *     an edge pushed into the neighbour is refused with the toast naming it (as against the house);
 *  2. Bredde / Dybde centres the unit's own opening and lets it grow back towards the template's width (no jump near
 *     it: a post stays at each end) — only while it is still where the template put it (fix round 4: a door the user
 *     moved, or one the user added, keeps its place);
 *  3. a refused «Ta tilbake» on a house edge names the unit in the way;
 *  4. a room's Type (owner's report: «changing room type doesn't show») — the record always took it, but the plan
 *     label, Egenskaper and Romskjema show the NAME, so a placed Bod set to Soverom still read «Bod 2» everywhere. A
 *     name that only says the old type or the unit's template («Bod 2», «Vedskjul», «Stue») now follows the new type;
 *     a name the user wrote stays. Type, name and note hold through moving / turning the unit, a wall move
 *     (reconcileRooms), undo / redo and a JSON round trip.
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
/** Opening `id`'s block edge: its start, end and length. */
function edgeOf(s: Store, id: string): { a: Vec2; b: Vec2; length: number } {
  const host = V(s).openings.find((o) => o.id === id)?.host;
  if (host?.kind !== 'blockEdge') throw new Error(`${id}: not on a block edge`);
  const poly = V(s).blocks.find((b) => b.id === host.blockId)?.polygon ?? [];
  const i = poly.findIndex((v) => v.id === host.edgeId);
  const a = poly[i].p;
  const b = poly[(i + 1) % poly.length].p;
  return { a, b, length: Math.hypot(b[0] - a[0], b[1] - a[1]) };
}
/** Plan centre of opening `id` on its block edge. */
function planCentre(s: Store, id: string): Vec2 {
  const { a, b, length } = edgeOf(s, id);
  const t = (V(s).openings.find((o) => o.id === id)?.offset ?? 0) / length;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
const opening = (s: Store, id: string) => V(s).openings.find((o) => o.id === id)!;
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

describe('Bredde / Dybde leaves an opening the user moved or added where it is (fix round 4)', () => {
  /** The opening the template put in the unit: its door, or the Vedskjul's open front. */
  const templateDoor = (s: Store, unit: string) => V(s).openings.find((o) => o.host.kind === 'blockEdge' && o.host.blockId === unit)!;

  it('the template door moved to 0,6 m, a window added at L/2 + 0,5 on its edge: Bredde keeps both, no overlap', () => {
    for (const [template, w0, w1] of [
      ['anneks', 4, 4.6],
      ['anneks', 4, 3.6],
      ['eget', 3, 3.6],
      ['badstue', 2.4, 3],
    ] as [string, number, number][]) {
      const label = `${template} ${w0} → ${w1}`;
      const s = proposal();
      const unit = tapped(s, template, [18.4, 9]);
      const door = templateDoor(s, unit);
      expect(edgeOf(s, door.id).length, label).toBeCloseTo(w0, 9);
      expect(A.moveOpening(s, door.id, 0.6), label).toBe(true);
      const window = A.addOpening(s, door.host, w0 / 2 + 0.5, 'window');
      expect(window, label).not.toBeNull();
      const win = window as string;
      expect(opening(s, win).offset, label).toBeCloseTo(w0 / 2 + 0.5, 9);
      expect(warnings(s), label).not.toContain('opening-overlap');
      const doorAt = planCentre(s, door.id);
      const winAt = planCentre(s, win);
      s.setState({ toasts: [] });
      expect(A.setBlockSize(s, unit, 'w', w1), label).toBe(true);
      expect(edgeOf(s, door.id).length, label).toBeCloseTo(w1, 9);
      // Before: the door was centred again (Anneks 4,6 m: 2,30, beside the window at 2,50), on the window.
      expect(opening(s, door.id).offset, label).toBeCloseTo(0.6, 9);
      expect(opening(s, door.id).width, label).toBe(door.width);
      expect(planCentre(s, door.id), label).toEqual(doorAt);
      expect(planCentre(s, win), label).toEqual(winAt);
      expect(opening(s, win).offset, label).toBeCloseTo(w0 / 2 + 0.5, 9);
      expect(warnings(s), label).not.toContain('opening-overlap');
      expect(toastTexts(s), label).toEqual([]);
    }
  });

  it('a second door added at 0,6 m on the next edge stays at 0,6 m on Dybde 3 → 3,6 (Bod, Anneks, Eget bygg)', () => {
    for (const template of ['bod', 'anneks', 'eget']) {
      const s = proposal();
      const unit = tapped(s, template, [18.4, 9]);
      const door = templateDoor(s, unit);
      const host = door.host;
      if (host.kind !== 'blockEdge') throw new Error('door not on a block edge');
      const poly = V(s).blocks.find((b) => b.id === unit)!.polygon;
      const next = poly[(poly.findIndex((v) => v.id === host.edgeId) + 1) % poly.length].id;
      const side = A.addOpening(s, { kind: 'blockEdge', blockId: unit, edgeId: next }, 0.6, 'door');
      expect(side, template).not.toBeNull();
      const id = side as string;
      expect(edgeOf(s, id).length, template).toBeCloseTo(3, 9);
      expect(opening(s, id).offset, template).toBeCloseTo(0.6, 9);
      const doorBefore = J(templateDoor(s, unit));
      expect(A.setBlockSize(s, unit, 'd', 3.6), template).toBe(true);
      expect(edgeOf(s, id).length, template).toBeCloseTo(3.6, 9);
      // Before: 1,80, the middle of the longer edge.
      expect(opening(s, id).offset, template).toBeCloseTo(0.6, 9);
      expect(opening(s, id).width, template).toBe(0.9);
      // The template's door, on an edge Dybde does not change, is left as it was.
      expect(J(templateDoor(s, unit)), template).toBe(doorBefore);
    }
  });

  it('the template door where the template put it is still centred on Bredde (Anneks 4 → 4,6 m: 2,3)', () => {
    const s = proposal();
    const unit = tapped(s, 'anneks', [18.4, 9]);
    const door = templateDoor(s, unit);
    expect(opening(s, door.id).offset).toBeCloseTo(2, 9);
    expect(A.setBlockSize(s, unit, 'w', 4.6)).toBe(true);
    expect(opening(s, door.id).offset).toBeCloseTo(2.3, 9);
    expect(opening(s, door.id).width).toBe(0.9);
  });

  it('an open front the user moved keeps its place on Bredde; narrowed only when it no longer fits', () => {
    const s = proposal();
    const shed = tapped(s, 'vedskjul', [18.4, 9]);
    const front = templateDoor(s, shed);
    expect(A.setOpeningProps(s, front.id, { width: 1 })).toBe(true);
    expect(A.moveOpening(s, front.id, 0.7)).toBe(true);
    expect(A.setBlockSize(s, shed, 'w', 2.5)).toBe(true);
    // Before: back in the middle (1,25).
    expect(own(s, shed)).toEqual([[0.7, 1]]);
    expect(A.setBlockSize(s, shed, 'w', 1)).toBe(true);
    expect(own(s, shed)).toEqual([[0.5, 0.8]]);
    expect(toastTexts(s)).toContain(EDIT_STRINGS.unitOpeningsNarrowed('Vedskjul', 1));
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

// ---------------------------------------------------------------------------------------------------------------
// 4. A room's Type shows (it follows into a name that only said the old type)
// ---------------------------------------------------------------------------------------------------------------

describe("a room's Type: kept through edits, and a name that only said the old type follows it", () => {
  /** The record of the one room of unit `id`, as derived (what the label, Egenskaper and Romskjema show). */
  const unitRoom = (s: Store, id: string) => {
    const rooms = D(s).rooms.filter((r) => r.blockId === id);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].room, 'the unit room is named').toBeDefined();
    return rooms[0].room!;
  };
  const shown = (s: Store, roomId: string) => {
    const r = D(s).rooms.find((x) => x.room?.id === roomId)?.room;
    return r ? { name: r.name, type: r.type, note: r.note } : null;
  };

  const cases = [
    { template: 'vedskjul', before: { name: 'Vedskjul', type: 'bod' }, to: 'teknisk', after: 'Teknisk rom' },
    { template: 'bod', before: { name: 'Bod 2', type: 'bod' }, to: 'soverom', after: 'Soverom' },
    { template: 'anneks', before: { name: 'Anneks', type: 'soverom' }, to: 'bad', after: 'Bad 2' },
  ] as const;

  for (const c of cases) {
    it(`${c.template}: Type ${c.to} shows as «${c.after}» and holds through move, turn, undo / redo and a reload`, () => {
      let s = proposal();
      const id = tapped(s, c.template, [18.4, 9]);
      const room = unitRoom(s, id);
      expect({ name: room.name, type: room.type }).toEqual(c.before);
      const steps = undoSteps(s);
      expect(A.setRoomProps(s, room.id, { type: c.to })).toBe(true);
      expect(undoSteps(s), 'one undo step').toBe(steps + 1);
      const want = { name: c.after, type: c.to, note: undefined };
      expect(shown(s, room.id)).toEqual(want);
      expect(V(s).rooms.find((r) => r.id === room.id)).toMatchObject({ name: c.after, type: c.to, unitId: id });
      // A note on top, then the unit moved and turned: the same record keeps all of it.
      expect(A.setRoomProps(s, room.id, { note: 'Ved og verktøy' })).toBe(true);
      const kept = { ...want, note: 'Ved og verktøy' };
      expect(A.moveBlock(s, id, [0.5, 0])).toBe(true);
      expect(shown(s, room.id)).toEqual(kept);
      expect(A.rotateBlock(s, id, 90)).toBe(true);
      expect(shown(s, room.id)).toEqual(kept);
      expect(unitRoom(s, id).id).toBe(room.id);
      // Undo back to before the type change, then redo it all.
      for (let i = 0; i < 4; i++) s.getState().undo();
      expect(shown(s, room.id)).toEqual({ ...c.before, note: undefined });
      for (let i = 0; i < 4; i++) s.getState().redo();
      expect(shown(s, room.id)).toEqual(kept);
      // A JSON round trip (as a reload or another device).
      s = reload(s);
      expect(shown(s, room.id)).toEqual(kept);
      expect(warnings(s)).not.toContain('generic');
    });
  }

  it('a name the user wrote stays; a name given with the type wins; a unit room renamed keeps its name', () => {
    const s = proposal();
    const id = tapped(s, 'bod', [18.4, 9]);
    const room = unitRoom(s, id);
    expect(A.setRoomProps(s, room.id, { name: 'Verksted' })).toBe(true);
    expect(A.setRoomProps(s, room.id, { type: 'teknisk' })).toBe(true);
    expect(shown(s, room.id)).toMatchObject({ name: 'Verksted', type: 'teknisk' });
    expect(A.moveBlock(s, id, [0, 0.5])).toBe(true);
    expect(reload(s).getState().project).toEqual(s.getState().project);
    expect(shown(reload(s), room.id)).toMatchObject({ name: 'Verksted', type: 'teknisk' });
    expect(A.setRoomProps(s, room.id, { name: 'Gjestehus', type: 'soverom' })).toBe(true);
    expect(shown(s, room.id)).toMatchObject({ name: 'Gjestehus', type: 'soverom' });
    // Seed rooms: «Korridor (nedre)» is a name, «Stue» only says the type (the plan already has a «Spiseplass»).
    expect(A.setRoomProps(s, 'room-korr-nedre', { type: 'bod' })).toBe(true);
    expect(shown(s, 'room-korr-nedre')).toMatchObject({ name: 'Korridor (nedre)', type: 'bod' });
    expect(A.setRoomProps(s, 'room-stue', { type: 'spiseplass' })).toBe(true);
    expect(shown(s, 'room-stue')).toMatchObject({ name: 'Spiseplass 2', type: 'spiseplass' });
    expect(named(s)).toHaveLength(new Set(named(s)).size);
  });

  it('a «Gi navn» room keeps its Type and name when the partition that made it moves (reconcileRooms)', () => {
    const s = proposal();
    const wallId = A.addWall(s, [19.2, 3.4], [19.2, 6.2]) as string;
    const face = D(s).rooms.find((r) => !r.room);
    const id = A.nameFace(s, face?.id as string, 'Kontor', { type: 'annet' }) as string;
    const roomId = D(s).rooms.find((r) => r.id === id)?.room?.id as string;
    expect(A.setRoomProps(s, roomId, { type: 'soverom' })).toBe(true);
    expect(shown(s, roomId)).toMatchObject({ name: 'Kontor', type: 'soverom' });
    expect(A.moveWall(s, wallId, [-0.3, 0])).toBe(true);
    expect(shown(s, roomId)).toMatchObject({ name: 'Kontor', type: 'soverom' });
    expect(shown(s, 'room-sov-ny')).toMatchObject({ name: 'Soverom (ny fløy)', type: 'soverom' });
    expect(shown(reload(s), roomId)).toMatchObject({ name: 'Kontor', type: 'soverom' });
    // One named «Soverom» (only the type's word) follows a later type change.
    expect(A.setRoomProps(s, roomId, { name: 'Soverom' })).toBe(true);
    expect(A.setRoomProps(s, roomId, { type: 'bad' })).toBe(true);
    expect(shown(s, roomId)).toMatchObject({ name: 'Bad 2', type: 'bad' });
  });
});
