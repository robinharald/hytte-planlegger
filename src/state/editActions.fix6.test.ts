/**
 * Last fix round, sixth review (editor core), on the real seed through the edit actions:
 *  1. a unit standing against the house never moves the house: Dybde / Bredde change its free side, its attached edge
 *     or corner dragged into the house stops (slides along the wall), and «Ta tilbake» on a house edge pushes the unit
 *     away (or is refused) instead of shrinking it;
 *  2. «Ta tilbake» on one of two walls meeting at a corner or a T, both moved by the user, keeps the corner closed, and
 *     a wall the restored wall's move carried goes back to where the user had put it (`Wall.carriedBy.from`);
 *  3. a merged-away room record survives an edit that only reshapes its face, also across a reload;
 *  4. a proposal saved without any `Wall.carriedBy` falls back to the geometric rules of before;
 *  5. moving or deleting the wing takes its own wall w-wing-w (and its opening) along;
 *  6. a unit placed beside terrace furniture whose footprint reaches into its walls pushes it out.
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
const toastTexts = (s: Store) => s.getState().toasts.map((t) => t.text);
const warnings = (s: Store) => D(s).warnings.map((w) => w.kind);
const named = (s: Store) =>
  D(s)
    .rooms.filter((r) => r.room)
    .map((r) => r.room?.name ?? '');
const LAPTOP = { snapRadiusM: 12 / 23.5 };
const PHONE = { snapRadiusM: 24 / 11.56, coarse: true };
const ON_BLOCK = `${EDIT_STRINGS.unitOnBlock}.`;
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
/** Wall `id` moved by k m along its left normal. */
const moveAcross = (s: Store, id: string, k: number) => {
  const n = normalOf(wall(s, id));
  return A.moveWall(s, id, [n[0] * k, n[1] * k]);
};

/** Everything of the variant but the unit `unitId` itself and the furniture (pushed items may move). */
const houseOf = (v: Variant, unitId: string) =>
  J({
    blocks: v.blocks.filter((b) => b.id !== unitId),
    walls: v.walls,
    rooms: v.rooms.filter((r) => r.unitId !== unitId),
    openings: v.openings.filter((o) => !(o.host.kind === 'blockEdge' && o.host.blockId === unitId)),
    structure: v.structure,
    ghosts: v.ghosts ?? null,
  });

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
const reload = (s: Store): Store => createAppStore(migrateProject(JSON.parse(J(s.getState().project)) as Project));

/** A unit tapped on the phone at `at` (snapped like the Nytt bygg tool); the toasts cleared. */
function tapped(s: Store, template: string, at: Vec2, rotation = 0): string {
  const r = A.snapPoint(s, at, { purpose: 'unit', templateId: template, rotation90: rotation, modifiers: PHONE });
  const id = A.placeUnit(s, template, r.point, rotation);
  expect(id, `${template} at ${J(at)}`).not.toBeNull();
  s.setState({ toasts: [] });
  return id as string;
}

// ---------------------------------------------------------------------------------------------------------------
// 1. A unit against the house never moves the house
// ---------------------------------------------------------------------------------------------------------------

describe('a unit standing against the house never moves it', () => {
  /** The review's Vedskjul tapped at (12,8, −0,9): x 11,8–13,8, y −1,5–0, its north edge on the main house's wall. */
  const shed = (): [Store, string] => {
    const s = proposal();
    const id = tapped(s, 'vedskjul', [12.8, -0.9]);
    expect(box(blockPts(s, id))).toEqual({ x0: 11.8, y0: -1.5, x1: 13.8, y1: 0 });
    return [s, id];
  };

  it('Dybde 2,0 on the shed grows it south; blk-main and every house wall stay (before: the house moved 0,5 m)', () => {
    const [s, id] = shed();
    const house = houseOf(V(s), id);
    expect(A.setBlockSize(s, id, 'd', 2.0, 'max')).toBe(true);
    expect(box(blockPts(s, id))).toEqual({ x0: 11.8, y0: -2, x1: 13.8, y1: 0 });
    expect(houseOf(V(s), id)).toBe(house);
    expect(toastTexts(s)).not.toContain(ON_BLOCK);
    // Smaller again: from the free side too, still against the wall.
    expect(A.setBlockSize(s, id, 'd', 1.2, 'max')).toBe(true);
    expect(box(blockPts(s, id))).toEqual({ x0: 11.8, y0: -1.2, x1: 13.8, y1: 0 });
    expect(houseOf(V(s), id)).toBe(house);
  });

  it('the review\'s other Dybde / Bredde cases change the unit on its free side and leave the building', () => {
    const cases: { template: string; at: Vec2; axis: 'w' | 'd'; value: number; grows: 'x0' | 'y0' | 'x1' | 'y1'; block: string }[] = [
      { template: 'anneks', at: [12.5, -1.6], axis: 'd', value: 4, grows: 'y0', block: 'blk-main' },
      { template: 'bod', at: [18.4, -3.4], axis: 'd', value: 3.5, grows: 'y0', block: 'blk-wing' },
      { template: 'vedskjul', at: [7, -2.6], axis: 'd', value: 1.2, grows: 'y0', block: 'blk-glass' },
      { template: 'vedskjul', at: [-0.9, 4], axis: 'w', value: 2.5, grows: 'x0', block: 'blk-main' },
    ];
    for (const c of cases) {
      const s = proposal();
      const id = tapped(s, c.template, c.at, c.axis === 'w' ? 1 : 0);
      const b0 = box(blockPts(s, id));
      const house = houseOf(V(s), id);
      expect(A.setBlockSize(s, id, c.axis, c.value, 'max'), c.template).toBe(true);
      const b1 = box(blockPts(s, id));
      const size = c.axis === 'w' ? b1.x1 - b1.x0 : b1.y1 - b1.y0;
      expect(size, `${c.template} ${c.block}`).toBeCloseTo(c.value, 9);
      // Only the free side moved; the side against the building stays.
      for (const k of ['x0', 'y0', 'x1', 'y1'] as const) if (k !== c.grows) expect(b1[k], `${c.template} ${k}`).toBeCloseTo(b0[k], 9);
      expect(houseOf(V(s), id), `${c.template} ${c.block}`).toBe(house);
    }
  });

  it('the attached edge dragged or moved into the house is refused with the hint; away from it the shed detaches', () => {
    const [s, id] = shed();
    const house = houseOf(V(s), id);
    const north = V(s).blocks.find((b) => b.id === id)!.polygon[2].id;
    // A laptop drag 1 m north: the outline stays where it is, with the hint; nothing changes.
    const session = A.beginDrag(s, { kind: 'blockEdge', id: north }, [12.8, 0], undefined, { snapRadiusM: LAPTOP.snapRadiusM });
    let hint: string | undefined;
    for (const k of [0.25, 0.5, 0.75, 1]) hint = A.updateDrag(s, session, [12.8, k], LAPTOP).hint;
    expect(hint).toBe(EDIT_STRINGS.unitOnBlock);
    expect(A.previewDrag(session, [12.8, 1], LAPTOP).hint).toBe(EDIT_STRINGS.unitOnBlock);
    A.endDrag(s, session);
    expect(box(blockPts(s, id))).toEqual({ x0: 11.8, y0: -1.5, x1: 13.8, y1: 0 });
    expect(houseOf(V(s), id)).toBe(house);
    // By the action: refused with the toast.
    expect(A.moveBlockEdge(s, id, north, [0, 1])).toBe(false);
    expect(toastTexts(s)).toContain(ON_BLOCK);
    expect(houseOf(V(s), id)).toBe(house);
    // Away from the house: only the shed's edge moves.
    expect(A.moveBlockEdge(s, id, north, [0, -0.5])).toBe(true);
    expect(box(blockPts(s, id))).toEqual({ x0: 11.8, y0: -1.5, x1: 13.8, y1: -0.5 });
    expect(houseOf(V(s), id)).toBe(house);
  });

  it('its north-east corner dragged by (0,3, 0,4) slides along the wall: 0,3 m east, the house stays', () => {
    for (const how of ['action', 'drag'] as const) {
      const [s, id] = shed();
      const house = houseOf(V(s), id);
      const ne = V(s).blocks.find((b) => b.id === id)!.polygon[2];
      const to: Vec2 = [ne.p[0] + 0.3, ne.p[1] + 0.4];
      if (how === 'action') {
        expect(A.moveBlockVertex(s, id, ne.id, to)).toBe(true);
        expect(toastTexts(s)).toContain(ON_BLOCK);
      } else {
        const session = A.beginDrag(s, { kind: 'blockVertex', id: ne.id }, ne.p, undefined, { snapRadiusM: LAPTOP.snapRadiusM });
        for (const k of [0.25, 0.5, 0.75, 1]) A.updateDrag(s, session, [ne.p[0] + 0.3 * k, ne.p[1] + 0.4 * k], { ...LAPTOP, alt: true });
        const preview = A.previewDrag(session, to, { ...LAPTOP, alt: true });
        expect(preview.hint).toBe(EDIT_STRINGS.unitOnBlock);
        expect(box(preview.target[0]).y1, how).toBeCloseTo(0, 9);
        A.endDrag(s, session);
      }
      const b = box(blockPts(s, id));
      expect(b.x1, how).toBeCloseTo(14.1, 9);
      expect(b.y1, how).toBeCloseTo(0, 9);
      expect(houseOf(V(s), id), how).toBe(house);
    }
  });

  it('«Ta tilbake» on the glass bump\'s south edge pushes the shed against it away, whole (before: 2 m → 1 m deep)', () => {
    for (const reloaded of [false, true]) {
      let s = proposal();
      expect(A.moveBlockEdge(s, 'blk-glass', 'v-glass-sw', [0, 1])).toBe(true);
      const id = tapped(s, 'vedskjul', [6, -1.9]);
      expect(box(blockPts(s, id))).toEqual({ x0: 5, y0: -2.5, x1: 7, y1: -1 });
      if (reloaded) s = reload(s);
      expect(A.restoreGhost(s, 'blk-glass/v-glass-sw/ghost')).toBe(true);
      expect(box(blockPts(s, 'blk-glass')).y0).toBeCloseTo(-2, 9);
      expect(box(blockPts(s, id))).toEqual({ x0: 5, y0: -3.5, x1: 7, y1: -2 });
      expect(V(s).ghosts ?? []).toEqual([]);
      expect(warnings(s)).not.toContain('block-overlap');
    }
  });

  it('…and is refused with the hint when the shed cannot go (a Bod right behind it); nothing changes', () => {
    const s = proposal();
    A.moveBlockEdge(s, 'blk-glass', 'v-glass-sw', [0, 1]);
    tapped(s, 'vedskjul', [6, -1.9]);
    tapped(s, 'bod', [6, -4]);
    const before = J(V(s));
    expect(A.restoreGhost(s, 'blk-glass/v-glass-sw/ghost')).toBe(false);
    expect(toastTexts(s)).toContain(ON_BLOCK);
    expect(J(V(s))).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2. «Ta tilbake» at a corner or T of two walls the user moved
// ---------------------------------------------------------------------------------------------------------------

describe('«Ta tilbake» on one of two walls meeting at a corner or T, both moved by the user, keeps it closed', () => {
  for (const reloaded of [false, true]) {
    const label = reloaded ? ' (after a reload)' : '';
    /** The two moves, then (reloaded or not) «Ta tilbake» on `restored`; 27 names and no dangling wall after. */
    const restore = (s0: Store, restored: string): Store => {
      const s = reloaded ? reload(s0) : s0;
      s.setState({ toasts: [] });
      expect(A.restoreGhost(s, `${restored}/ghost`)).toBe(true);
      expect(named(s)).toHaveLength(27);
      expect(warnings(s)).not.toContain('wall-dangling');
      expect(toastTexts(s).join(' ')).not.toContain('er nå ett rom');
      return s;
    };

    it(`D1: drag w-peis-w 0,3 west, w-peis-n 0,3 north, Ta tilbake on w-peis-w: the corner meets w-peis-n where it is${label}`, () => {
      const s0 = proposal();
      dragWall(s0, 'w-peis-w', 0.3 * Math.sign(normalOf(wall(s0, 'w-peis-w'))[0]) * -1);
      dragWall(s0, 'w-peis-n', 0.3 * Math.sign(normalOf(wall(s0, 'w-peis-n'))[1]));
      const peisN = wall(s0, 'w-peis-n');
      expect(peisN.a[1]).toBeCloseTo(3.4, 9);
      const s = restore(s0, 'w-peis-w');
      expect(wall(s, 'w-peis-w').a).toEqual([6.97, 2.18]);
      expect(wall(s, 'w-peis-w').b[0]).toBeCloseTo(6.97, 9);
      expect(wall(s, 'w-peis-w').b[1]).toBeCloseTo(3.4, 9);
      expect(wall(s, 'w-peis-n').a).toEqual(wall(s, 'w-peis-w').b);
      expect(wall(s, 'w-peis-n').b).toEqual(peisN.b);
      expect(J(wall(s, 'w-korr-stue'))).toBe(seedWall('w-korr-stue'));
    });

    it(`D5: drag w-mellom-boder 0,3 north, w-do-109 0,3 east, Ta tilbake on w-mellom-boder: w-do-109 reaches it${label}`, () => {
      const s0 = proposal();
      dragWall(s0, 'w-mellom-boder', 0.3 * Math.sign(normalOf(wall(s0, 'w-mellom-boder'))[1]));
      dragWall(s0, 'w-do-109', 0.3 * Math.sign(normalOf(wall(s0, 'w-do-109'))[0]));
      const x = wall(s0, 'w-do-109').a[0];
      const s = restore(s0, 'w-mellom-boder');
      expect(J(wall(s, 'w-mellom-boder'))).toBe(seedWall('w-mellom-boder'));
      expect(J(wall(s, 'w-109-108'))).toBe(seedWall('w-109-108'));
      // The user's w-do-109 keeps its place; its end slides back onto w-mellom-boder.
      expect(wall(s, 'w-do-109').a[0]).toBeCloseTo(x, 9);
      expect(wall(s, 'w-do-109').a[1]).toBeCloseTo(7.62, 9);
    });

    it(`D3: drag w-104-103 0,4 east, w-103-korr 0,4 south, Ta tilbake on w-104-103: the corner follows w-103-korr${label}`, () => {
      const s0 = proposal();
      dragWall(s0, 'w-104-103', 0.4 * Math.sign(normalOf(wall(s0, 'w-104-103'))[0]));
      dragWall(s0, 'w-103-korr', -0.4 * Math.sign(normalOf(wall(s0, 'w-103-korr'))[1]));
      const korrY = wall(s0, 'w-103-korr').a[1];
      const s = restore(s0, 'w-104-103');
      expect(wall(s, 'w-104-103').a[0]).toBeCloseTo(3.05, 9);
      expect(wall(s, 'w-104-103').a[1]).toBeCloseTo(korrY, 9);
      expect(wall(s, 'w-103-korr').a).toEqual(wall(s, 'w-104-103').a);
      expect(wall(s, 'w-103-korr').b[1]).toBeCloseTo(korrY, 9);
    });

    it(`E2: w-103-korr +0,3 north, w-103-102 0,3 west, Ta tilbake on w-103-102: w-103-korr keeps the user's move${label}`, () => {
      const s0 = proposal();
      expect(A.moveWall(s0, 'w-103-korr', [0, 0.3])).toBe(true);
      expect(A.moveWall(s0, 'w-103-102', [-0.3, 0])).toBe(true);
      expect(wall(s0, 'w-103-korr').carriedBy?.from).toEqual({ a: [3.05, 4.54], b: [5.05, 4.54] });
      const s = restore(s0, 'w-103-102');
      expect(J(wall(s, 'w-103-102'))).toBe(seedWall('w-103-102'));
      expect(wall(s, 'w-103-korr').a).toEqual([3.05, 4.54]);
      expect(wall(s, 'w-103-korr').b).toEqual([5.05, 4.54]);
      expect(wall(s, 'w-104-103').a).toEqual([3.05, 4.54]);
      expect(warnings(s)).not.toContain('furniture-needs-wet-room');
    });

    it(`E3: w-peis-w 0,3 east, w-peis-n 0,3 north, Ta tilbake on w-peis-n: w-peis-w stays 0,3 east, the corner closed${label}`, () => {
      const s0 = proposal();
      expect(A.moveWall(s0, 'w-peis-w', [0.3, 0])).toBe(true);
      expect(A.moveWall(s0, 'w-peis-n', [0, 0.3])).toBe(true);
      const s = restore(s0, 'w-peis-n');
      expect(wall(s, 'w-peis-w').a).toEqual([7.27, 2.18]);
      expect(wall(s, 'w-peis-w').b).toEqual([7.27, 3.1]);
      expect(wall(s, 'w-peis-n').a).toEqual([7.27, 3.1]);
      expect(wall(s, 'w-peis-n').b).toEqual([9, 3.1]);
    });
  }

  it('a wall moved twice carries its neighbour back past both moves (the carry\'s `from` is kept)', () => {
    const s = proposal();
    expect(A.moveWall(s, 'w-peis-w', [0.1, 0])).toBe(true);
    expect(A.moveWall(s, 'w-peis-w', [0.1, 0])).toBe(true);
    expect(wall(s, 'w-korr-stue').carriedBy?.from).toEqual({ a: [5.1, 2.18], b: [6.97, 2.18] });
    expect(A.restoreGhost(s, 'w-peis-w/ghost')).toBe(true);
    for (const id of ['w-peis-w', 'w-peis-n', 'w-korr-stue']) expect(J(wall(s, id)), id).toBe(seedWall(id));
  });

  it('corner and T sweep: no merge or dangling wall that «only the other wall moved» does not have', () => {
    const live = SEED.walls.filter((w) => w.status !== 'removed');
    const near = (p: Vec2, w: Wall) => {
      const d: Vec2 = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
      const t = Math.max(0, Math.min(1, ((p[0] - w.a[0]) * d[0] + (p[1] - w.a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1])));
      return Math.hypot(p[0] - w.a[0] - d[0] * t, p[1] - w.a[1] - d[1] * t) <= 0.01;
    };
    const pairs: [Wall, Wall][] = [];
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const [w, x] = [live[i], live[j]];
        if (storeyOf(w.levelId) !== storeyOf(x.levelId)) continue;
        if (![w.a, w.b].some((p) => near(p, x)) && ![x.a, x.b].some((p) => near(p, w))) continue;
        const [nw, nx] = [normalOf(w), normalOf(x)];
        if (Math.abs(nw[0] * nx[1] - nw[1] * nx[0]) < 0.09) continue;
        pairs.push([w, x]);
      }
    }
    expect(pairs.length).toBeGreaterThan(30);
    const stateOf = (s: Store) => ({ names: new Set(named(s)), warns: new Set(warnings(s)) });
    const onlyMoved = new Map<string, ReturnType<typeof stateOf>>();
    const broken: string[] = [];
    for (const [p, q] of pairs) {
      for (const [first, second] of [
        [p, q],
        [q, p],
      ]) {
        const s = proposal();
        if (!moveAcross(s, first.id, 0.3) || !moveAcross(s, second.id, -0.3)) continue;
        if (!V(s).walls.some((w) => w.id === `${first.id}/ghost`)) continue;
        const before = stateOf(s);
        const key = second.id;
        if (!onlyMoved.has(key)) {
          const r = proposal();
          moveAcross(r, second.id, -0.3);
          onlyMoved.set(key, stateOf(r));
        }
        const ref = onlyMoved.get(key)!;
        A.restoreGhost(s, `${first.id}/ghost`);
        const after = stateOf(s);
        const lost = [...before.names].filter((n) => !after.names.has(n) && ref.names.has(n));
        const dangling = after.warns.has('wall-dangling') && !before.warns.has('wall-dangling') && !ref.warns.has('wall-dangling');
        if (lost.length > 0 || dangling) broken.push(`${first.id} +0,3, ${second.id} −0,3, Ta tilbake on ${first.id}: ${J(lost)}${dangling ? ' wall-dangling' : ''}`);
      }
    }
    expect(broken).toEqual([]);
  }, 300000);
});

// ---------------------------------------------------------------------------------------------------------------
// 3. A merged-away name survives a reshape of its face
// ---------------------------------------------------------------------------------------------------------------

describe('a merged-away room record survives an edit that only reshapes its face', () => {
  it('w-109-108 deleted, w-do-109 moved, a reload, Ta tilbake on w-109-108: «Teknisk / vask» is back, 27 names', () => {
    for (const [del, moved, d, name] of [
      ['w-109-108', 'w-do-109', [-0.2, 0], 'Teknisk / vask'],
      ['w-vf-kjk', 'w-vf-korr', [0, 0.2], 'Vindfang'],
    ] as const) {
      let s = proposal();
      expect(A.deleteWall(s, del)).toBe(true);
      expect(V(s).mergedRooms?.map((m) => m.room.name)).toEqual([name]);
      expect(A.moveWall(s, moved, [d[0], d[1]])).toBe(true);
      expect(V(s).mergedRooms?.map((m) => m.room.name), del).toEqual([name]);
      s = reload(s);
      s.setState({ toasts: [] });
      expect(A.restoreGhost(s, del)).toBe(true);
      expect(named(s), del).toHaveLength(27);
      expect(named(s), del).toContain(name);
      expect(toastTexts(s).join(' '), del).toContain(`«${name}»`);
      expect(warnings(s), del).not.toContain('room-unnamed');
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Proposals saved without any Wall.carriedBy
// ---------------------------------------------------------------------------------------------------------------

describe('a proposal saved without any Wall.carriedBy (before the fifth review) restores as before', () => {
  const stripped = (s: Store): Store => {
    const p = JSON.parse(J(s.getState().project)) as Project;
    for (const v of p.variants) for (const w of v.walls) delete w.carriedBy;
    return createAppStore(migrateProject(p));
  };

  it('the review\'s single-wall cases come back exactly, neighbours and continuations included', () => {
    for (const [id, k] of [
      ['w-peis-w', 0.3],
      ['w-mellom-boder', 0.3],
      ['w-106-korr', 0.3],
      ['w-106-korr', -0.3],
      ['w-103-korr', -0.3],
      ['dv-kjk-w', 0.3],
    ] as const) {
      const s0 = proposal();
      expect(moveAcross(s0, id, k), id).toBe(true);
      expect(V(s0).walls.some((w) => w.carriedBy), id).toBe(true);
      const s = stripped(s0);
      expect(V(s).walls.some((w) => w.carriedBy), id).toBe(false);
      expect(A.restoreGhost(s, `${id}/ghost`), id).toBe(true);
      expect(J(V(s).walls), `${id} ${k}`).toBe(J(SEED.walls));
      expect(named(s), id).toHaveLength(27);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 5. The wing takes its own walls along
// ---------------------------------------------------------------------------------------------------------------

describe('moving or deleting the wing takes w-wing-w and its opening along', () => {
  it('deleted: w-wing-w and o-stue-gang go with it', () => {
    const s = proposal();
    expect(A.deleteBlock(s, 'blk-wing')).toBe(true);
    expect(V(s).walls.some((w) => w.id === 'w-wing-w')).toBe(false);
    expect(V(s).openings.some((o) => o.id === 'o-stue-gang')).toBe(false);
  });

  it('moved 1 m east: w-wing-w moves with it, its opening on it', () => {
    const s = proposal();
    expect(A.moveBlock(s, 'blk-wing', [1, 0])).toBe(true);
    expect(wall(s, 'w-wing-w').a).toEqual([17, 0]);
    expect(wall(s, 'w-wing-w').b).toEqual([17, 6.2]);
    expect(V(s).openings.find((o) => o.id === 'o-stue-gang')?.host).toEqual({ kind: 'wall', wallId: 'w-wing-w' });
  });

  it('a unit still leaves a wall along another block\'s edge to that block', () => {
    const s = proposal();
    const id = tapped(s, 'anneks', [18, 8]);
    const shared = A.addWall(s, [18, 6.2], [19, 6.2]);
    expect(shared).not.toBeNull();
    const before = J(wall(s, shared as string));
    expect(A.moveBlock(s, id, [0, 1])).toBe(true);
    expect(J(wall(s, shared as string))).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 6. Terrace furniture reaching into a new unit's walls
// ---------------------------------------------------------------------------------------------------------------

describe('a unit placed beside terrace furniture that reaches into its walls pushes it out', () => {
  it('a Vedskjul tapped 0,5 m south of the main house at x 11: the Loungesofa is pushed out with the toast', () => {
    for (const x of [11, 14]) {
      const s = proposal();
      const r = A.snapPoint(s, [x, -0.5], { purpose: 'unit', templateId: 'vedskjul', rotation90: 0, modifiers: PHONE });
      const id = A.placeUnit(s, 'vedskjul', r.point, 0);
      expect(id, `${x}`).not.toBeNull();
      expect(box(blockPts(s, id as string)).y1, `${x}`).toBeCloseTo(0, 9);
      expect(toastTexts(s).join(' '), `${x}`).toContain('«Loungesofa» er flyttet ut av «Vedskjul»');
      expect(warnings(s), `${x}`).not.toContain('furniture-in-wall');
      expect(D(s).furniture.find((f) => f.id === 'fu-terrasse-1')?.roomId, `${x}`).toBeUndefined();
    }
  });
});
