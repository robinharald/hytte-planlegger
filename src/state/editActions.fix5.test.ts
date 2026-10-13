/**
 * Last fix round, fifth review (editor core), on the real seed through the edit actions:
 *  1. a unit standing on the house (an old saved state, built here directly) takes nothing of the house when it is
 *     deleted, dragged away or turned; and a template unit never ends up on another building (placement, drag, turn,
 *     edge drag, Dupliser): it is shifted clear, stops against the wall, or is refused with «Bygget kan ikke stå oppå et
 *     annet bygg»;
 *  2. a unit enlarged by its edge over terrace furniture pushes it out, so it never owns it;
 *  3. «Ta tilbake» moves only the walls the restored wall's own move carried and that still stand where it left them
 *     (`Wall.carriedBy`), also after a reload;
 *  4. a merged-away room name comes back only into a face the restore changed, and says so;
 *  5. a Vedskjul with its back against a building gets a lean-to roof (high against the wall).
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyPlaceUnit, applyRotateBlock } from '../geometry/edit';
import type { DerivedVariant } from '../model/derived';
import { migrateProject } from '../model/migrate';
import { createForslagD } from '../model/seed/forslagD';
import type { Variant, Vec2, Wall } from '../model/types';
import * as A from './editActions';
import { EDIT_STRINGS } from './editStrings';
import { createAppStore, selectActiveVariant } from './store';
import { deriveForState } from './useDerived';

type Store = ReturnType<typeof createAppStore>;

/** A store on the seed with an unlocked copy of Forslag D active and an empty history. */
function proposal(): Store {
  const store = createAppStore(createForslagD());
  store.getState().duplicateVariant('forslag-d', 'Mitt forslag');
  store.getState().clearHistory();
  return store;
}

const SEED = selectActiveVariant(proposal().getState());
/** The derived room of each seed item (undefined: on the terrace or the ground). */
const SEED_ROOM = new Map(deriveForState(proposal().getState()).furniture.map((f) => [f.id, f.roomId]));
const J = (x: unknown) => JSON.stringify(x);
const V = (s: Store): Variant => selectActiveVariant(s.getState());
const D = (s: Store): DerivedVariant => deriveForState(s.getState());
const wall = (s: Store, id: string): Wall => V(s).walls.find((w) => w.id === id)!;
const item = (s: Store, id: string) => V(s).furniture.find((f) => f.id === id);
const toastTexts = (s: Store) => s.getState().toasts.map((t) => t.text);
const steps = (s: Store) => s.temporal.getState().pastStates.length;
const named = (s: Store) =>
  D(s)
    .rooms.filter((r) => r.room)
    .map((r) => r.room?.name ?? '');
const overlapWarnings = (s: Store) => D(s).warnings.filter((w) => w.kind === 'block-overlap');
const LAPTOP = { snapRadiusM: 12 / 23.5 };
const PHONE = { snapRadiusM: 24 / 11.56, coarse: true };
const ON_BLOCK = EDIT_STRINGS.unitOnBlock;
const storeyOf = (levelId: string) => SEED.levels.find((l) => l.id === levelId)?.storeyId ?? 'ground';
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

/**
 * A unit standing on the house as an old saved proposal could have it (placement refuses that now): placed with the
 * geometry function directly, with no undo step.
 */
function forced(s: Store, template: string, at: Vec2): string {
  const v = V(s);
  let id = '';
  const next = produce(v, (d) => {
    id = applyPlaceUnit(d as Variant, { base: v, derived: D(s) }, template, at, 0)?.blockId ?? '';
  });
  s.getState().replaceVariant(v.id, next);
  s.getState().clearHistory();
  return id;
}

/** Everything of the variant but the unit `unitId` itself (its block, the room made with it, its edge openings). */
const houseOf = (v: Variant, unitId: string) =>
  J({
    blocks: v.blocks.filter((b) => b.id !== unitId),
    walls: v.walls,
    rooms: v.rooms.filter((r) => r.unitId !== unitId),
    furniture: v.furniture,
    openings: v.openings.filter((o) => !(o.host.kind === 'blockEdge' && o.host.blockId === unitId)),
    structure: v.structure,
    ghosts: v.ghosts ?? null,
  });

/** Block `id` dragged by its body by `d` in `frames` frames at `mods` (one undo step); returns the last feedback. */
function dragBlock(s: Store, id: string, d: Vec2, mods: { snapRadiusM: number; coarse?: boolean } = LAPTOP, frames = 8) {
  const b = box(blockPts(s, id));
  const from: Vec2 = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  const session = A.beginDrag(s, { kind: 'block', id }, from, undefined, { snapRadiusM: mods.snapRadiusM });
  expect(session).not.toBeNull();
  let feedback = A.updateDrag(s, session, from, mods);
  let preview = A.previewDrag(session, from, mods);
  for (let k = 1; k <= frames; k++) {
    const p: Vec2 = [from[0] + (d[0] * k) / frames, from[1] + (d[1] * k) / frames];
    preview = A.previewDrag(session, p, mods);
    feedback = A.updateDrag(s, session, p, mods);
  }
  A.endDrag(s, session);
  return { feedback, preview };
}

/** Wall `id` dragged k m across itself in four frames at the laptop's snap radius (one undo step). */
function dragWall(s: Store, id: string, k: number): void {
  const w = wall(s, id);
  const n = normalOf(w);
  const mid: Vec2 = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
  const session = A.beginDrag(s, { kind: 'wall', id }, mid, undefined, { snapRadiusM: LAPTOP.snapRadiusM, storeyId: storeyOf(w.levelId) });
  for (const t of [0.25, 0.5, 0.75, 1]) A.updateDrag(s, session, [mid[0] + n[0] * k * t, mid[1] + n[1] * k * t], LAPTOP);
  A.endDrag(s, session);
}

/** A reload: the project through JSON and the migration, a new store, no undo history. */
const reload = (s: Store): Store => createAppStore(migrateProject(JSON.parse(J(s.getState().project))));

// ---------------------------------------------------------------------------------------------------------------
// 1a. A unit standing on the house takes nothing of the house
// ---------------------------------------------------------------------------------------------------------------

describe('a unit standing on the house (an old state) takes none of the house\'s walls, names or furniture', () => {
  const SEED_NAMES = named(proposal()).sort();

  it('Anneks at (7, −1,5) deleted: dv-leseskrok, «Leseskrok» and every house item stay (before: both were deleted)', () => {
    const s = proposal();
    const id = forced(s, 'anneks', [7, -1.5]);
    const house = houseOf(V(s), id);
    expect(A.deleteBlock(s, id)).toBe(true);
    expect(houseOf(V(s), id)).toBe(house);
    expect(J(wall(s, 'dv-leseskrok'))).toBe(J(SEED.walls.find((w) => w.id === 'dv-leseskrok')));
    expect(named(s).sort()).toEqual(SEED_NAMES);
    expect(V(s).rooms.some((r) => r.unitId === id)).toBe(false);
  });

  it('Anneks at (7, −1,5) dragged 4 m south or moved by moveBlock: the house stays, the Anneks takes its own room along', () => {
    for (const how of ['drag', 'move'] as const) {
      const s = proposal();
      const id = forced(s, 'anneks', [7, -1.5]);
      const house = houseOf(V(s), id);
      if (how === 'drag') dragBlock(s, id, [0, -4]);
      else expect(A.moveBlock(s, id, [0, -4])).toBe(true);
      expect(box(blockPts(s, id)).y1, how).toBeCloseTo(-4, 9);
      expect(houseOf(V(s), id), how).toBe(house);
      // Its own room went with it and has its own face now; the house's names are all there.
      expect(V(s).rooms.find((r) => r.unitId === id)?.anchor, how).toEqual([7, -5.5]);
      expect(named(s).sort(), how).toEqual([...SEED_NAMES, 'Anneks'].sort());
      expect(toastTexts(s).join(' '), how).not.toContain('er nå ett rom');
    }
  });

  it('Anneks at (7, −1,5) turned: refused with the hint as a toast (it would stand on the house), nothing changes', () => {
    const s = proposal();
    const id = forced(s, 'anneks', [7, -1.5]);
    const before = J(V(s));
    expect(A.rotateBlock(s, id, 90)).toBe(false);
    expect(J(V(s))).toBe(before);
    expect(steps(s)).toBe(0);
    expect(toastTexts(s)).toEqual([`${ON_BLOCK}.`]);
  });

  it('the turn itself (applyRotateBlock) carries only the unit\'s own room: no house wall, name or item turns with it', () => {
    const s = proposal();
    const id = forced(s, 'anneks', [7, -1.5]);
    const v = V(s);
    const next = produce(v, (d) => {
      expect(applyRotateBlock(d as Variant, { base: v, derived: D(s) }, id, 90)).toBe(true);
    });
    expect(houseOf(next, id)).toBe(houseOf(v, id));
    expect(J(next.rooms.find((r) => r.unitId === id)?.anchor)).not.toBe(J(v.rooms.find((r) => r.unitId === id)?.anchor));
  });

  it('the review\'s other cases: Anneks at (9,6, −0,5) moved leaves the armchair; at (18, 0,6) w-sauna-n, Pantry and WC stay', () => {
    for (const [at, op] of [
      [[9.6, -0.5], 'move'],
      [[9.6, -0.5], 'delete'],
      [[18, 0.6], 'move'],
      [[18, 0.6], 'delete'],
    ] as [Vec2, string][]) {
      const s = proposal();
      const id = forced(s, 'anneks', at);
      const house = houseOf(V(s), id);
      if (op === 'move') expect(A.moveBlock(s, id, [0, -5]), J(at)).toBe(true);
      else expect(A.deleteBlock(s, id), J(at)).toBe(true);
      // The armchair fu-leseskrok-2 backed onto the Anneks's wall did not follow it (before: carried to y −5,44).
      expect(houseOf(V(s), id), `${J(at)} ${op}`).toBe(house);
      expect(named(s), `${J(at)} ${op}`).toEqual(expect.arrayContaining(['Leseskrok', 'Pantry', 'WC', 'Hovedbad', 'Badstue']));
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 1b. A template unit never ends up on another building
// ---------------------------------------------------------------------------------------------------------------

describe('a template unit never ends up on another building', () => {
  it('phone taps 0,2 m outside the sauna wall (y −2): each unit attaches (shifted clear) or is refused, never overlaps', () => {
    let placed = 0;
    for (const template of ['vedskjul', 'bod', 'badstue', 'anneks']) {
      for (const x of [16.6, 17.4, 18.1, 18.8, 19.6, 20.4]) {
        for (const mods of [PHONE, LAPTOP]) {
          const s = proposal();
          const before = J(V(s));
          const at = A.snapPoint(s, [x, -2.2], { purpose: 'unit', templateId: template, rotation90: 0, modifiers: mods }).point;
          const id = A.placeUnit(s, template, at, 0);
          const label = `${template} ${x} ${mods === PHONE ? 'phone' : 'laptop'}`;
          if (id === null) {
            expect(toastTexts(s), label).toEqual([`${ON_BLOCK}.`]);
            expect(J(V(s)), label).toBe(before);
            continue;
          }
          placed++;
          expect(overlapWarnings(s), label).toEqual([]);
          expect(box(blockPts(s, id)).y1, label).toBeLessThanOrEqual(-2 + 1e-9);
          // No house item moves; a terrace chair reaching into the unit's wall is pushed out (last fix round, sixth review).
          for (const f of V(s).furniture) {
            if (J(f) === J(SEED.furniture.find((g) => g.id === f.id))) continue;
            expect(SEED_ROOM.get(f.id), `${label} ${f.id}`).toBeUndefined();
            expect(toastTexts(s).join(' '), label).toContain('er flyttet ut av');
          }
        }
      }
    }
    // A tap outside the wall attaches the unit against it (the snap reaches half the unit there).
    expect(placed).toBe(48);
  }, 120000);

  it('a unit placed on the house (no snap) is refused with the toast; no undo step', () => {
    for (const [template, at] of [
      ['vedskjul', [17.2, -1.2]],
      ['anneks', [7, -1.5]],
      ['bod', [16, 0.8]],
    ] as [string, Vec2][]) {
      const s = proposal();
      const before = J(V(s));
      expect(A.placeUnit(s, template, at, 0), template).toBeNull();
      expect(toastTexts(s), template).toEqual([`${ON_BLOCK}.`]);
      expect(J(V(s)), template).toBe(before);
      expect(steps(s), template).toBe(0);
    }
  });

  it('the Nytt bygg ghost over the middle of the house says so (hint) and stays where it is', () => {
    const s = proposal();
    const r = A.snapPoint(s, [12, 3], { purpose: 'unit', templateId: 'bod', rotation90: 0, modifiers: LAPTOP });
    expect(r.hint).toBe(ON_BLOCK);
    expect(A.placeUnit(s, 'bod', r.point, 0)).toBeNull();
    const clear = A.snapPoint(s, [12, -4], { purpose: 'unit', templateId: 'bod', rotation90: 0, modifiers: LAPTOP });
    expect(clear.hint).toBeUndefined();
  });

  it('a shed dragged into the wing stops against its wall, with the hint in the preview and the frame', () => {
    const s = proposal();
    const id = A.placeUnit(s, 'vedskjul', [18.4, -4], 0) as string;
    const { feedback, preview } = dragBlock(s, id, [0, 2]);
    expect(feedback.hint).toBe(ON_BLOCK);
    expect(preview.hint).toBe(ON_BLOCK);
    expect(box(blockPts(s, id)).y1).toBeCloseTo(-2, 9);
    expect(box(preview.target[0]).y1).toBeCloseTo(-2, 9);
    expect(overlapWarnings(s)).toEqual([]);
    expect(steps(s)).toBe(2);
  });

  it('a shed against the wing dragged along it with the pointer 0,3 m into the wall slides along the wall', () => {
    const s = proposal();
    const id = A.placeUnit(s, 'vedskjul', [18, -2.75], 0) as string;
    expect(box(blockPts(s, id)).y1).toBeCloseTo(-2, 9);
    const { feedback } = dragBlock(s, id, [1, 0.3]);
    expect(feedback.hint).toBeUndefined();
    const b = box(blockPts(s, id));
    expect(b.y1).toBeCloseTo(-2, 9);
    expect(b.x0).toBeCloseTo(18, 1);
    expect(overlapWarnings(s)).toEqual([]);
  });

  it('moveBlock into the wing stops at the contact (toast); straight in from the contact it is refused', () => {
    const s = proposal();
    const id = A.placeUnit(s, 'vedskjul', [18.4, -4], 0) as string;
    expect(A.moveBlock(s, id, [0, 2])).toBe(true);
    expect(box(blockPts(s, id)).y1).toBeCloseTo(-2, 9);
    expect(toastTexts(s)).toContain(`${ON_BLOCK}.`);
    const at = J(V(s));
    s.setState({ toasts: [] });
    expect(A.moveBlock(s, id, [0, 0.5])).toBe(false);
    expect(J(V(s))).toBe(at);
    expect(toastTexts(s)).toEqual([`${ON_BLOCK}.`]);
  });

  it('a Bod\'s north edge dragged into the wing stops at its wall (hint); by moveBlockEdge with the toast', () => {
    const s = proposal();
    const id = A.placeUnit(s, 'bod', [18.4, -5], 0) as string;
    const b = V(s).blocks.find((x) => x.id === id)!;
    const north = b.polygon[2].id;
    const mid: Vec2 = [18.4, -3.5];
    const session = A.beginDrag(s, { kind: 'blockEdge', id: north }, mid, undefined, { snapRadiusM: LAPTOP.snapRadiusM });
    expect(session).not.toBeNull();
    const preview = A.previewDrag(session, [18.4, -1], LAPTOP);
    const feedback = A.updateDrag(s, session, [18.4, -1], LAPTOP);
    A.endDrag(s, session);
    expect(feedback.hint).toBe(ON_BLOCK);
    expect(preview.target[0][0][1]).toBeCloseTo(-2, 9);
    expect(box(blockPts(s, id)).y1).toBeCloseTo(-2, 9);
    expect(overlapWarnings(s)).toEqual([]);

    const t = proposal();
    const id2 = A.placeUnit(t, 'bod', [18.4, -5], 0) as string;
    const north2 = V(t).blocks.find((x) => x.id === id2)!.polygon[2].id;
    expect(A.moveBlockEdge(t, id2, north2, [0, 2.5])).toBe(true);
    expect(box(blockPts(t, id2)).y1).toBeCloseTo(-2, 9);
    expect(toastTexts(t)).toContain(`${ON_BLOCK}.`);
  });

  it('Dupliser on a unit puts the copy beside it, not on it', () => {
    const s = proposal();
    const id = A.placeUnit(s, 'vedskjul', [14, 9.35], 0) as string;
    const copy = A.duplicateBlock(s, id) as string;
    expect(copy).not.toBeNull();
    expect(overlapWarnings(s)).toEqual([]);
    const a = box(blockPts(s, id));
    const b = box(blockPts(s, copy));
    expect(b.x0).toBeCloseTo(a.x1 + 0.5, 9);
    expect(b.y0).toBeCloseTo(a.y0, 9);
    // The copy's room is the copy's own.
    expect(V(s).rooms.filter((r) => r.unitId === copy)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2. A unit enlarged by its edge over terrace furniture
// ---------------------------------------------------------------------------------------------------------------

describe('a unit enlarged by its edge over terrace furniture pushes it out', () => {
  const furnitureRoom = (s: Store, id: string) => D(s).furniture.find((f) => f.id === id)?.roomId;

  it('the review\'s Bod at (12,8, −5,2): its north edge to y −1,1 pushes the Utebord out; moved and deleted, the table stays', () => {
    for (const how of ['action', 'drag'] as const) {
      const s = proposal();
      const id = A.placeUnit(s, 'bod', [12.8, -5.2], 0) as string;
      const north = V(s).blocks.find((x) => x.id === id)!.polygon[2].id;
      s.setState({ toasts: [] });
      if (how === 'action') expect(A.moveBlockEdge(s, id, north, [0, 2.6])).toBe(true);
      else {
        const session = A.beginDrag(s, { kind: 'blockEdge', id: north }, [12.8, -3.7], undefined, { snapRadiusM: LAPTOP.snapRadiusM });
        for (const k of [0.25, 0.5, 0.75, 1]) A.updateDrag(s, session, [12.8, -3.7 + 2.6 * k], { ...LAPTOP, alt: true });
        A.endDrag(s, session);
      }
      expect(box(blockPts(s, id)).y1, how).toBeCloseTo(-1.1, 6);
      expect(furnitureRoom(s, 'fu-terrasse-2'), how).toBeUndefined();
      expect(toastTexts(s).join(' '), how).toContain('«Utebord» er flyttet ut av «Bod»');
      const table = J(item(s, 'fu-terrasse-2'));
      expect(A.moveBlock(s, id, [0, -3]), how).toBe(true);
      expect(J(item(s, 'fu-terrasse-2')), how).toBe(table);
      expect(A.deleteBlock(s, id), how).toBe(true);
      expect(J(item(s, 'fu-terrasse-2')), how).toBe(table);
      expect(V(s).furniture, how).toHaveLength(SEED.furniture.length);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 3. «Ta tilbake» and the walls another wall's move carried
// ---------------------------------------------------------------------------------------------------------------

describe('«Ta tilbake» moves only what the restored wall\'s own move carried and left where it is', () => {
  for (const reloaded of [false, true]) {
    const label = reloaded ? ' (after a reload)' : '';

    it(`w-106-korr +0,3 (carries lw-106-top), lw-106-top ±0,3, Ta tilbake on lw-106-top: w-106-korr stays${label}`, () => {
      for (const k of [0.3, -0.3]) {
        let s = proposal();
        expect(A.moveWall(s, 'w-106-korr', [0, 0.3])).toBe(true);
        expect(wall(s, 'lw-106-top').carriedBy?.by).toBe('w-106-korr');
        expect(A.moveWall(s, 'lw-106-top', [0, k])).toBe(true);
        expect(wall(s, 'lw-106-top').carriedBy, `${k}`).toBeUndefined();
        const korr = J(wall(s, 'w-106-korr'));
        if (reloaded) s = reload(s);
        expect(A.restoreGhost(s, 'lw-106-top/ghost'), `${k}`).toBe(true);
        expect(J(wall(s, 'lw-106-top')), `${k}`).toBe(J(SEED.walls.find((w) => w.id === 'lw-106-top')));
        expect(J(wall(s, 'w-106-korr')), `${k}`).toBe(korr);
      }
    });

    it(`w-106-korr +0,3, lw-106-top +0,2, Ta tilbake on w-106-korr: lw-106-top stays where the user put it${label}`, () => {
      let s = proposal();
      A.moveWall(s, 'w-106-korr', [0, 0.3]);
      A.moveWall(s, 'lw-106-top', [0, 0.2]);
      const top = J(wall(s, 'lw-106-top'));
      if (reloaded) s = reload(s);
      expect(A.restoreGhost(s, 'w-106-korr/ghost')).toBe(true);
      expect(J(wall(s, 'w-106-korr'))).toBe(J(SEED.walls.find((w) => w.id === 'w-106-korr')));
      expect(J(wall(s, 'lw-106-top'))).toBe(top);
    });

    it(`w-104-s −0,3, lw-split −0,3, Ta tilbake on lw-split: w-104-s stays, 27 names, no dangling wall${label}`, () => {
      let s = proposal();
      expect(A.moveWall(s, 'w-104-s', [0, -0.3])).toBe(true);
      expect(A.moveWall(s, 'lw-split', [0, -0.3])).toBe(true);
      const s104 = J(wall(s, 'w-104-s'));
      const diag = J(wall(s, 'w-104-diag'));
      if (reloaded) s = reload(s);
      expect(A.restoreGhost(s, 'lw-split/ghost')).toBe(true);
      expect(J(wall(s, 'lw-split'))).toBe(J(SEED.walls.find((w) => w.id === 'lw-split')));
      expect(J(wall(s, 'w-104-s'))).toBe(s104);
      expect(J(wall(s, 'w-104-diag'))).toBe(diag);
      expect(named(s)).toHaveLength(27);
      expect(D(s).warnings.map((w) => w.kind)).not.toContain('wall-dangling');
      expect(toastTexts(s).join(' ')).not.toContain('er nå ett rom');
    });

    it(`drag w-103-korr +0,5, drag w-vf-korr +0,3 onto the same line, Ta tilbake on w-vf-korr: w-103-korr stays${label}`, () => {
      let s = proposal();
      dragWall(s, 'w-103-korr', 0.5);
      dragWall(s, 'w-vf-korr', 0.3);
      expect(wall(s, 'w-vf-korr').a[1]).toBeCloseTo(wall(s, 'w-103-korr').b[1], 9);
      const korr = J(wall(s, 'w-103-korr'));
      const warnings = D(s).warnings.map((w) => w.kind);
      if (reloaded) s = reload(s);
      expect(A.restoreGhost(s, 'w-vf-korr/ghost')).toBe(true);
      expect(J(wall(s, 'w-vf-korr'))).toBe(J(SEED.walls.find((w) => w.id === 'w-vf-korr')));
      expect(J(wall(s, 'w-103-korr'))).toBe(korr);
      expect(named(s)).toHaveLength(27);
      for (const k of D(s).warnings.map((w) => w.kind)) expect(warnings).toContain(k);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Merged-away names come back only into a face the restore changed
// ---------------------------------------------------------------------------------------------------------------

describe('a merged-away room name comes back only into a face the restore changed', () => {
  it('WC merged into Pantry, a wall drawn there, a reload, an unrelated Ta tilbake: «WC» does not come back', () => {
    for (const reloaded of [true, false]) {
      let s = proposal();
      expect(A.deleteWall(s, 'w-pantry-wc')).toBe(true);
      expect(V(s).mergedRooms?.map((m) => m.room.name)).toEqual(['WC']);
      expect(A.addWall(s, [17, 0], [17, 2.2])).not.toBeNull();
      // The face it was merged into is redrawn: the record is gone.
      expect(V(s).mergedRooms).toBeUndefined();
      if (reloaded) s = reload(s);
      const before = named(s).sort();
      s.setState({ toasts: [] });
      expect(A.moveWall(s, 'w-vf-korr', [0, 0.3])).toBe(true);
      expect(A.restoreGhost(s, 'w-vf-korr/ghost')).toBe(true);
      expect(named(s).sort(), `${reloaded}`).toEqual(before);
      expect(named(s), `${reloaded}`).not.toContain('WC');
      expect(toastTexts(s).join(' '), `${reloaded}`).not.toContain('er tilbake');
    }
  });

  it('a record kept on the variant still gives the name back into the face its restore splits, with a toast naming it', () => {
    const s = proposal();
    expect(A.moveBlockEdge(s, 'blk-bod', 'v-bod-nw', [-0.2, 0])).toBe(true);
    expect(A.restoreGhost(s, 'w-bod-gavl/ghost')).toBe(true);
    expect(A.restoreGhost(s, 'w-mellom-boder/ghost')).toBe(true);
    const gone = (V(s).mergedRooms ?? []).map((m) => m.room.name);
    expect(gone).toHaveLength(2);
    const t = reload(s);
    expect(A.restoreGhost(t, 'blk-bod/v-bod-nw/ghost')).toBe(true);
    expect(named(t)).toHaveLength(27);
    expect(toastTexts(t).join(' ')).toMatch(/Rommene «.+» og «.+» er tilbake\./);
    for (const n of gone) expect(toastTexts(t).join(' ')).toContain(`«${n}»`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 5. A Vedskjul against a building: a lean-to
// ---------------------------------------------------------------------------------------------------------------

describe('a Vedskjul with its back against a building gets a lean-to roof, high against the wall', () => {
  const WING_N = 6.2;
  const roofOf = (s: Store, id: string) => V(s).blocks.find((b) => b.id === id)?.roof;

  it('on the wing\'s north wall, turned half round by the placement or placed so: slopes north, away from the wing', () => {
    for (const rotation of [0, 2]) {
      const s = proposal();
      const r = A.snapPoint(s, [18.4, WING_N + 0.4 + 0.75], { purpose: 'unit', templateId: 'vedskjul', rotation90: rotation, modifiers: PHONE });
      const id = A.placeUnit(s, 'vedskjul', r.point, rotation) as string;
      expect(box(blockPts(s, id)).y0, `${rotation}`).toBeCloseTo(WING_N, 9);
      expect(roofOf(s, id), `${rotation}`).toMatchObject({ type: 'mono', slopeTo: 'N' });
      expect(D(s).warnings, `${rotation}`).toEqual([]);
    }
  });

  it('free on the deck it keeps the template\'s roof (down to the back, away from the open front)', () => {
    const s = proposal();
    const id = A.placeUnit(s, 'vedskjul', [14, 9.35], 0) as string;
    expect(roofOf(s, id)).toMatchObject({ slopeTo: 'N' });
    const turned = A.placeUnit(s, 'vedskjul', [11, 9.35], 2) as string;
    expect(roofOf(s, turned)).toMatchObject({ slopeTo: 'S' });
  });
});
