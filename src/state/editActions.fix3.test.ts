/**
 * Fix round after phase 2b, editor core (the third review's EDITOR findings and the furniture-carry finding), on the
 * real seed through the edit actions:
 *  - Nytt bygg on the phone: the placement reach is capped at max(0,25 m, 10 px) on touch (`unitPlacementReach`);
 *  - units carry and delete only their own furniture; a unit placed over furniture pushes it out;
 *  - openings coming back in uneven steps; ghost wall ends as snap targets of endpoint drags;
 *  - junction / stub ghosts clipped to the stretch another block still covers after a restore;
 *  - walls that turned when dragged stay parallel (the move is clamped where an end's support runs out);
 *  - room names after restoring carried wall ghosts before the edge ghost (merged-away rooms come back).
 */
import { describe, expect, it } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import type { Variant, Vec2, Wall } from '../model/types';
import * as A from './editActions';
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
const J = (x: unknown) => JSON.stringify(x);
const V = (s: Store): Variant => selectActiveVariant(s.getState());
const D = (s: Store): DerivedVariant => deriveForState(s.getState());
const blockPts = (s: Store, id: string): Vec2[] => V(s).blocks.find((b) => b.id === id)?.polygon.map((v) => v.p) ?? [];
const box = (pts: Vec2[]) => ({
  x0: Math.min(...pts.map((p) => p[0])),
  y0: Math.min(...pts.map((p) => p[1])),
  x1: Math.max(...pts.map((p) => p[0])),
  y1: Math.max(...pts.map((p) => p[1])),
});
const centreOf = (pts: Vec2[]): Vec2 => {
  const b = box(pts);
  return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
};

// ---------------------------------------------------------------------------------------------------------------
// Nytt bygg on the phone: the placement reach
// ---------------------------------------------------------------------------------------------------------------

describe('Nytt bygg on the phone: a tap snaps at most max(0,25 m, 10 px) away', () => {
  /** The phone's starting zoom: 11,56 px/m, a 24 px coarse snap radius (2,07 m). */
  const PHONE = { snapRadiusM: 24 / 11.56, coarse: true };
  const LAPTOP = { snapRadiusM: 12 / 23.5 };
  const WING_N = 6.2;
  const place = (store: Store, tap: Vec2, mods: { snapRadiusM: number; coarse?: boolean }) => {
    const r = A.snapPoint(store, tap, { purpose: 'unit', templateId: 'vedskjul', rotation90: 0, modifiers: mods });
    return A.placeUnit(store, 'vedskjul', r.point, 0) as string;
  };

  it('the reach: 10 px on touch (0,87 m at 11,56 px/m), never under 0,25 m, never over the radius; the mouse keeps its radius', () => {
    expect(A.unitPlacementReach(PHONE.snapRadiusM, true)).toBeCloseTo(10 / 11.56, 9);
    expect(A.unitPlacementReach(24 / 200, true)).toBeCloseTo(0.12, 9);
    expect(A.unitPlacementReach(24 / 60, true)).toBe(0.25);
    expect(A.unitPlacementReach(LAPTOP.snapRadiusM, false)).toBe(LAPTOP.snapRadiusM);
  });

  it('a shed tapped in the middle of the deck at (14, 9,35) stays within 0,3 m of the tap (before: 2 m north, y 10,6–12,1)', () => {
    const store = proposal();
    const id = place(store, [14, 9.35], PHONE);
    const c = centreOf(blockPts(store, id));
    expect(Math.hypot(c[0] - 14, c[1] - 9.35)).toBeLessThanOrEqual(0.3);
  });

  it('taps along x 12,5 on the north deck (y 7,4 … 11,0) move the shed less than 0,87 m + the grid', () => {
    for (let y = 7.4; y <= 11.0 + 1e-9; y += 0.4) {
      const store = proposal();
      const id = place(store, [12.5, y], PHONE);
      const c = centreOf(blockPts(store, id));
      expect(Math.hypot(c[0] - 12.5, c[1] - y), `y ${y.toFixed(1)}`).toBeLessThanOrEqual(10 / 11.56 + 0.08);
    }
  });

  it('one tapped 0,4 m from the wing\'s north wall still attaches (and 0,8 m too); the laptop is unchanged', () => {
    for (const gap of [0.4, 0.8]) {
      const store = proposal();
      const id = place(store, [18.4, WING_N + gap + 0.75], PHONE);
      expect(box(blockPts(store, id)).y0, `gap ${gap}`).toBeCloseTo(WING_N, 9);
    }
    const laptop = proposal();
    expect(box(blockPts(laptop, place(laptop, [18.4, WING_N + 0.4 + 0.75], LAPTOP))).y0).toBeCloseTo(WING_N, 9);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Units and the furniture that stood there first
// ---------------------------------------------------------------------------------------------------------------

describe('a unit carries and deletes only its own furniture', () => {
  const item = (s: Store, id: string) => V(s).furniture.find((f) => f.id === id);
  /** The Vedskjul's outer outline (axis ± its 3 cm cladding). */
  const outline = (s: Store, id: string) => {
    const b = box(blockPts(s, id));
    return { x0: b.x0 - 0.03, y0: b.y0 - 0.03, x1: b.x1 + 0.03, y1: b.y1 + 0.03 };
  };
  const inside = (p: Vec2, o: { x0: number; y0: number; x1: number; y1: number }) => p[0] > o.x0 && p[0] < o.x1 && p[1] > o.y0 && p[1] < o.y1;

  it('placeUnit over fu-terrasse-2 pushes the table out (with a toast); moveBlock then leaves it, deleteBlock keeps it', () => {
    const store = proposal();
    const table0 = item(store, 'fu-terrasse-2')!.position;
    const id = A.placeUnit(store, 'vedskjul', [12.8, -1.6], 0) as string;
    const shed = outline(store, id);
    const table = item(store, 'fu-terrasse-2')!.position;
    // Out of the shed (it stood with its centre in the shed's south wall), straight south past the cladding.
    expect(inside(table, shed)).toBe(false);
    expect(table[0]).toBe(table0[0]);
    expect(table[1]).toBeLessThan(table0[1]);
    const df = D(store).furniture.find((f) => f.id === 'fu-terrasse-2')!;
    expect(Math.max(...df.footprint.map((p) => p[1]))).toBeLessThanOrEqual(shed.y0 + 1e-9);
    expect(store.getState().toasts.map((t) => t.text).join(' ')).toContain('er flyttet ut av «Vedskjul»');
    // Moving the shed 3 m east leaves the table (before: it went along to (15,8, −3,3)).
    const before = J(item(store, 'fu-terrasse-2'));
    expect(A.moveBlock(store, id, [3, 0])).toBe(true);
    expect(J(item(store, 'fu-terrasse-2'))).toBe(before);
    // Deleting the shed keeps it (before: it was deleted with the shed).
    expect(A.deleteBlock(store, id)).toBe(true);
    expect(J(item(store, 'fu-terrasse-2'))).toBe(before);
  });

  it('even without the push (furniture in the unit\'s wall, from an older save): moveBlock and deleteBlock leave it', () => {
    const store = proposal();
    const id = A.placeUnit(store, 'vedskjul', [12.8, -1.6], 0) as string;
    // Put the table back where it stood, its centre in the shed's south wall (as a 2b save has it).
    const v = V(store);
    store.getState().replaceVariant(v.id, { ...v, furniture: v.furniture.map((f) => (f.id === 'fu-terrasse-2' ? { ...f, position: [12.8, -2.3] as Vec2 } : f)) });
    expect(D(store).furniture.find((f) => f.id === 'fu-terrasse-2')?.roomId).toBeUndefined();
    A.moveBlock(store, id, [3, 0]);
    expect(item(store, 'fu-terrasse-2')?.position).toEqual([12.8, -2.3]);
    A.deleteBlock(store, id);
    expect(item(store, 'fu-terrasse-2')?.position).toEqual([12.8, -2.3]);
  });

  it('furniture placed in the unit afterwards is its own: moved, turned and deleted with it', () => {
    const store = proposal();
    const id = A.placeUnit(store, 'vedskjul', [13, 9.35], 0) as string;
    const f = A.addFurniture(store, 'kubbe', [13.3, 9.35]) as string;
    expect(D(store).furniture.find((x) => x.id === f)?.roomId).toBe(D(store).rooms.find((r) => r.blockId === id)?.id);
    expect(A.moveBlock(store, id, [1, 0])).toBe(true);
    expect(item(store, f)?.position).toEqual([14.3, 9.35]);
    expect(A.rotateBlock(store, id, 90)).toBe(true);
    expect(item(store, f)?.rotationDeg).toBe(90);
    expect(A.deleteBlock(store, id)).toBe(true);
    expect(item(store, f)).toBeUndefined();
  });

  it('the lounge sofa under the shed\'s north wall is pushed out too, onto no block and no other item', () => {
    const store = proposal();
    const id = A.placeUnit(store, 'vedskjul', [12.8, -1.6], 0) as string;
    const shed = outline(store, id);
    const d = D(store);
    for (const fid of ['fu-terrasse-1', 'fu-terrasse-2']) {
      const df = d.furniture.find((f) => f.id === fid)!;
      expect(inside(df.item.position, shed), fid).toBe(false);
      expect(df.collisions.filter((c) => c.startsWith('fu-')), fid).toEqual([]);
    }
    expect(d.warnings.map((w) => w.kind)).not.toContain('block-overlap');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Junction / stub ghosts after a restore
// ---------------------------------------------------------------------------------------------------------------

describe('a restore that puts an edge back on today\'s line clips its other ghosts to the stretch still open', () => {
  /** Edge ghosts that lie on their live edge's line over a live piece of today's wall (the plan drew «Fjernet» there). */
  const ghostsOverLiveWalls = (s: Store): string[] => {
    const v = V(s);
    const d = D(s);
    const out: string[] = [];
    for (const g of v.ghosts ?? []) {
      const m = /^(.*)\/([^/]+)\/ghost(?:\/\d+)?$/.exec(g.id);
      const block = m ? v.blocks.find((b) => b.id === m[1]) : undefined;
      const i = block ? block.polygon.findIndex((x) => x.id === m![2]) : -1;
      if (!block || i < 0) continue;
      const a = block.polygon[i].p;
      const b = block.polygon[(i + 1) % block.polygon.length].p;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const u: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      const off = (p: Vec2) => Math.abs((p[0] - a[0]) * u[1] - (p[1] - a[1]) * u[0]);
      if (off(g.a) > 1e-6 || off(g.b) > 1e-6) continue;
      const s0 = Math.min((g.a[0] - a[0]) * u[0] + (g.a[1] - a[1]) * u[1], (g.b[0] - a[0]) * u[0] + (g.b[1] - a[1]) * u[1]);
      const s1 = Math.max((g.a[0] - a[0]) * u[0] + (g.a[1] - a[1]) * u[1], (g.b[0] - a[0]) * u[0] + (g.b[1] - a[1]) * u[1]);
      for (const w of d.walls) {
        if (w.isGhost || w.isNew || w.source.kind !== 'blockEdge' || w.source.blockId !== block.id || w.source.edgeId !== m![2]) continue;
        if (Math.min(s1, w.source.s1) - Math.max(s0, w.source.s0) > 1e-3) out.push(`${g.id} [${s0}, ${s1}] over ${w.id} [${w.source.s0}, ${w.source.s1}]`);
      }
    }
    return out;
  };
  const ghostLines = (s: Store, prefix: string) => (V(s).ghosts ?? []).filter((g) => g.id.startsWith(prefix)).map((g) => [g.a, g.b]);

  it('main south +0.3, glass east +0.5, then each ghost restored alone: no ghost over a live wall of today', () => {
    const store = proposal();
    expect(A.moveBlockEdge(store, 'blk-main', 'v-main-sw', [0, -0.3])).toBe(true);
    expect(A.moveBlockEdge(store, 'blk-glass', 'v-glass-se', [0.5, 0])).toBe(true);
    const fwd = V(store);
    const ids = (fwd.ghosts ?? []).map((g) => g.id);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    for (const id of ids) {
      store.getState().replaceVariant(fwd.id, fwd);
      expect(A.restoreGhost(store, id), id).toBe(true);
      expect(ghostsOverLiveWalls(store), id).toEqual([]);
    }
  });

  it('Ta tilbake on the main wall\'s ghost: its other ghost is [9, 0]–[9,5, 0], as from the seed with only glass +0.5', () => {
    const store = proposal();
    A.moveBlockEdge(store, 'blk-main', 'v-main-sw', [0, -0.3]);
    A.moveBlockEdge(store, 'blk-glass', 'v-glass-se', [0.5, 0]);
    expect(A.restoreGhost(store, 'blk-main/v-main-sw/ghost')).toBe(true);
    expect(ghostLines(store, 'blk-main/')).toEqual([
      [
        [9, 0],
        [9.5, 0],
      ],
    ]);
    // No ghost host wall is left over the live wall, and the old window marker is back on the edge (as in the seed).
    expect(V(store).walls.filter((w) => w.id.startsWith('blk-main/'))).toEqual([]);
    expect(V(store).openings.find((o) => o.id === 'win-stue-s-old')).toEqual(SEED.openings.find((o) => o.id === 'win-stue-s-old'));
    const ref = proposal();
    A.moveBlockEdge(ref, 'blk-glass', 'v-glass-se', [0.5, 0]);
    expect(ghostLines(store, 'blk-main/')).toEqual(ghostLines(ref, 'blk-main/'));
    const areas = (s: Store) => J(D(s).areas);
    expect(areas(store)).toBe(areas(ref));
    // Ta tilbake on that ghost takes the glass back: the seed.
    expect(A.restoreGhost(store, (V(store).ghosts ?? []).find((g) => g.id.startsWith('blk-main/'))!.id)).toBe(true);
    expect(J(V(store).blocks)).toBe(J(SEED.blocks));
    expect(J(V(store).walls)).toBe(J(SEED.walls));
    expect(J(V(store).openings)).toBe(J(SEED.openings));
    expect(V(store).ghosts).toBeUndefined();
  });

  it('the main wall\'s second ghost restored first: the stretch the glass keeps open stays a ghost, the rest heals', () => {
    const store = proposal();
    A.moveBlockEdge(store, 'blk-main', 'v-main-sw', [0, -0.3]);
    A.moveBlockEdge(store, 'blk-glass', 'v-glass-se', [0.5, 0]);
    expect(A.restoreGhost(store, 'blk-main/v-main-sw/ghost/2')).toBe(true);
    expect(ghostLines(store, 'blk-main/')).toEqual([
      [
        [9, 0],
        [9.5, 0],
      ],
    ]);
    for (let n = 0; V(store).ghosts && n < 10; n++) expect(A.restoreGhost(store, V(store).ghosts![0].id)).toBe(true);
    expect(J(V(store).blocks)).toBe(J(SEED.blocks));
    expect(J(V(store).walls)).toBe(J(SEED.walls));
    expect(J(V(store).openings)).toBe(J(SEED.openings));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Openings coming back in uneven steps; ends dragged back by hand
// ---------------------------------------------------------------------------------------------------------------

describe('openings come back on uneven multi-step returns', () => {
  const opening = (s: Store, id: string) => V(s).openings.find((o) => o.id === id);
  /** The openings of today's cabin that are not exactly as in the seed. */
  const todayOpeningsOff = (s: Store) =>
    V(s)
      .openings.filter((o) => {
        const seed = SEED.openings.find((x) => x.id === o.id);
        return seed?.status === 'existing' && J(seed) !== J(o);
      })
      .map((o) => `${o.id} ${o.status} ${o.offset}`);

  it('the glass east edge −1, back +0,2 / +0,8 (and +0,3 / +0,7, +0,4 / +0,6): win-glass-s2 is back at 2,94, existing', () => {
    for (const first of [0.2, 0.3, 0.4]) {
      const store = proposal();
      expect(A.moveBlockEdge(store, 'blk-glass', 'v-glass-se', [-1, 0])).toBe(true);
      expect(opening(store, 'win-glass-s2')?.status).toBe('new');
      A.moveBlockEdge(store, 'blk-glass', 'v-glass-se', [first, 0]);
      A.moveBlockEdge(store, 'blk-glass', 'v-glass-se', [1 - first, 0]);
      expect(opening(store, 'win-glass-s2'), `+${first}`).toEqual(SEED.openings.find((o) => o.id === 'win-glass-s2'));
      expect(opening(store, 'win-glass-s2/ghost')).toBeUndefined();
      expect(todayOpeningsOff(store), `+${first}`).toEqual([]);
      expect(V(store).ghosts).toBeUndefined();
    }
  });

  it('the glass west edge and the bod west edge −1, back +0,2 / +0,8: win-glass-s1 and d-do are back', () => {
    for (const [block, edge, d] of [
      ['blk-glass', 'v-glass-nw', [1, 0]],
      ['blk-bod', 'v-bod-nw', [1, 0]],
    ] as [string, string, Vec2][]) {
      const store = proposal();
      expect(A.moveBlockEdge(store, block, edge, d)).toBe(true);
      A.moveBlockEdge(store, block, edge, [-d[0] * 0.2, -d[1] * 0.2]);
      A.moveBlockEdge(store, block, edge, [-d[0] * 0.8, -d[1] * 0.8]);
      expect(todayOpeningsOff(store), `${block}/${edge}`).toEqual([]);
      expect(J(V(store).blocks)).toBe(J(SEED.blocks));
    }
  });

  it('every block edge moved in by 0,5 / 1 m and back in thirds or 0,2 + 0,8 or 0,3 + 0,7: every door and window of today is back', () => {
    const problems: string[] = [];
    for (const b of SEED.blocks) {
      const pts = b.polygon.map((v) => v.p);
      for (let i = 0; i < pts.length; i++) {
        const [p, q] = [pts[i], pts[(i + 1) % pts.length]];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const out: Vec2 = [(q[1] - p[1]) / L, -(q[0] - p[0]) / L];
        for (const k of [0.5, 1]) {
          for (const steps of [[0.3, 0.3, 0.4], [0.2, 0.8], [0.3, 0.7]]) {
            const s = proposal();
            if (!A.moveBlockEdge(s, b.id, b.polygon[i].id, [-out[0] * k, -out[1] * k])) continue;
            for (const f of steps) A.moveBlockEdge(s, b.id, b.polygon[i].id, [out[0] * k * f, out[1] * k * f]);
            const off = todayOpeningsOff(s);
            const blocksBack = V(s).blocks.every((x, j) => x.polygon.every((v, n) => Math.hypot(v.p[0] - SEED.blocks[j].polygon[n].p[0], v.p[1] - SEED.blocks[j].polygon[n].p[1]) < 1e-6));
            if (off.length > 0 || !blocksBack) problems.push(`${b.id}/${b.polygon[i].id} −${k} ${J(steps)}: ${off.join(', ')}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  }, 180000);
});

describe('an end dragged out and back by hand lands on today\'s point (ghost wall ends are snap targets)', () => {
  const LAPTOP = { snapRadiusM: 12 / 24.5 };
  const wall = (s: Store, id: string) => V(s).walls.find((w) => w.id === id)!;
  const dragEnd = (s: Store, id: string, end: 'a' | 'b', to: Vec2) => {
    const from = wall(s, id)[end];
    const session = A.beginDrag(s, { kind: 'wall', id }, from, end, LAPTOP);
    expect(session).not.toBeNull();
    A.updateDrag(s, session, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], LAPTOP);
    A.updateDrag(s, session, to, LAPTOP);
    A.endDrag(s, session);
  };

  it('w-103-korr.a out 0,3 m and back by drag (to within a few cm) lands at 3,05: the wall and its doors are today\'s again', () => {
    for (const back of [
      [3.05, 4.24],
      [3.09, 4.26],
      [3.01, 4.22],
      [3.12, 4.24],
    ] as Vec2[]) {
      const store = proposal();
      dragEnd(store, 'w-103-korr', 'a', [2.75, 4.24]);
      expect(wall(store, 'w-103-korr').status).toBe('new');
      dragEnd(store, 'w-103-korr', 'a', back);
      expect(wall(store, 'w-103-korr').a, J(back)).toEqual([3.05, 4.24]);
      expect(J(V(store).walls), J(back)).toBe(J(SEED.walls));
      expect(J(V(store).openings), J(back)).toBe(J(SEED.openings));
    }
  });

  it('the ghost end is a point target only in endpoint drags; a body drag of the wall snaps as before', () => {
    const store = proposal();
    dragEnd(store, 'w-103-korr', 'a', [2.75, 4.24]);
    const d = D(store);
    const end = A.beginDrag(store, { kind: 'wall', id: 'w-103-korr' }, wall(store, 'w-103-korr').a, 'a', LAPTOP)!;
    expect(end.snapCtx.points.some((p) => p.kind === 'ghostEnd' && p.p[0] === 3.05 && p.p[1] === 4.24)).toBe(true);
    A.cancelDrag(store, end);
    const body = A.beginDrag(store, { kind: 'wall', id: 'w-103-korr' }, [4, 4.24], undefined, LAPTOP)!;
    expect(body.snapCtx.points.some((p) => p.kind === 'ghostEnd')).toBe(false);
    A.cancelDrag(store, body);
    expect(d.walls.some((w) => w.isGhost && w.source.kind === 'wall' && w.source.wallId === 'w-103-korr/ghost')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Room names after restoring carried wall ghosts before the edge ghost
// ---------------------------------------------------------------------------------------------------------------

describe('a room merged away by a restore comes back when a later restore splits the face again', () => {
  /** Named rooms as "name: area" (the seed has 27). */
  const named = (s: Store) =>
    D(s)
      .rooms.filter((r) => r.room)
      .map((r) => `${r.room?.name}: ${r.area.toFixed(3)}`)
      .sort();

  it('blk-bod west +0,2, Ta tilbake on w-bod-gavl/ghost, w-mellom-boder/ghost, then the edge ghost: 27 rooms incl. «Mellombygg»', () => {
    const store = proposal();
    const seedRooms = named(store);
    expect(seedRooms).toHaveLength(27);
    expect(A.moveBlockEdge(store, 'blk-bod', 'v-bod-nw', [-0.2, 0])).toBe(true);
    expect(A.restoreGhost(store, 'w-bod-gavl/ghost')).toBe(true);
    expect(A.restoreGhost(store, 'w-mellom-boder/ghost')).toBe(true);
    // The two restores merged «Do» and «Mellombygg» into «Bod (ny)» (each with its toast).
    expect(named(store)).toHaveLength(25);
    expect(A.restoreGhost(store, 'blk-bod/v-bod-nw/ghost')).toBe(true);
    expect(J(V(store).walls)).toBe(J(SEED.walls));
    expect(V(store).ghosts).toBeUndefined();
    // Every name on its own face again (before: «Mellombygg» gone, «Bod (ny)» on its face, a 3,05 m² face unnamed).
    expect(named(store)).toEqual(seedRooms);
    expect(named(store).some((r) => r.startsWith('Mellombygg:'))).toBe(true);
    expect(D(store).rooms.filter((r) => !r.room && r.area > 1)).toEqual([]);
  });

  it('the same with the wall ghosts restored in the other order', () => {
    const store = proposal();
    const seedRooms = named(store);
    A.moveBlockEdge(store, 'blk-bod', 'v-bod-nw', [-0.2, 0]);
    A.restoreGhost(store, 'w-mellom-boder/ghost');
    A.restoreGhost(store, 'w-bod-gavl/ghost');
    A.restoreGhost(store, 'blk-bod/v-bod-nw/ghost');
    expect(named(store)).toEqual(seedRooms);
  });
});

describe('carried wall ghosts restored before the edge ghost, every edge of the bod, both orders: the seed\'s names', () => {
  it('blk-bod edges ±0,2 / 0,5 / 1 m: wall ghosts first (both orders), then the edge ghosts → 27 rooms on their own faces', () => {
    const named = (s: Store) =>
      D(s)
        .rooms.filter((r) => r.room)
        .map((r) => `${r.room?.name}: ${r.area.toFixed(3)}`)
        .sort();
    const seedRooms = named(proposal());
    const bod = SEED.blocks.find((b) => b.id === 'blk-bod')!;
    const pts = bod.polygon.map((v) => v.p);
    const problems: string[] = [];
    let cases = 0;
    for (let i = 0; i < pts.length; i++) {
      const [p, q] = [pts[i], pts[(i + 1) % pts.length]];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const out: Vec2 = [(q[1] - p[1]) / L, -(q[0] - p[0]) / L];
      for (const k of [0.2, 0.5, 1]) {
        for (const reverse of [false, true]) {
          const s = proposal();
          if (!A.moveBlockEdge(s, 'blk-bod', bod.polygon[i].id, [out[0] * k, out[1] * k])) continue;
          const walls = V(s).walls.filter((w) => w.status === 'removed' && w.id.endsWith('/ghost') && !w.id.startsWith('blk-')).map((w) => w.id);
          if (walls.length === 0) continue;
          cases++;
          for (const id of reverse ? [...walls].reverse() : walls) if (V(s).walls.some((w) => w.id === id)) A.restoreGhost(s, id);
          for (let n = 0; V(s).ghosts && n < 10; n++) A.restoreGhost(s, V(s).ghosts![0].id);
          const now = named(s);
          if (J(now) !== J(seedRooms)) problems.push(`${bod.polygon[i].id} ${k}${reverse ? ' reversed' : ''}: ${J(seedRooms.filter((r) => !now.includes(r)))}`);
        }
      }
    }
    expect(cases).toBeGreaterThanOrEqual(8);
    expect(problems).toEqual([]);
  }, 120000);
});

// ---------------------------------------------------------------------------------------------------------------
// Walls that turned when dragged
// ---------------------------------------------------------------------------------------------------------------

describe('a moved wall never turns: an end whose support runs out clamps the move, continuations are carried', () => {
  const LAPTOP = 12 / 24.5;
  const normalOf = (w: Wall): Vec2 => {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    return [-(w.b[1] - w.a[1]) / L, (w.b[0] - w.a[0]) / L];
  };
  const axisParallel = (w: Pick<Wall, 'a' | 'b'>) => Math.abs(w.a[0] - w.b[0]) < 1e-7 || Math.abs(w.a[1] - w.b[1]) < 1e-7;
  const wall = (s: Store, id: string) => V(s).walls.find((w) => w.id === id)!;
  const storeyOf = (levelId: string) => SEED.levels.find((l) => l.id === levelId)?.storeyId ?? 'ground';
  /** Wall `w` moved k m across itself: by moveWall, or by a drag in two frames at the laptop's snap radius. */
  const move = (s: Store, w: Wall, k: number, drag: boolean) => {
    const n = normalOf(w);
    if (!drag) return A.moveWall(s, w.id, [n[0] * k, n[1] * k]);
    const mid: Vec2 = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    const session = A.beginDrag(s, { kind: 'wall', id: w.id }, mid, undefined, { snapRadiusM: LAPTOP, storeyId: storeyOf(w.levelId) });
    if (!session) return false;
    for (const t of [0.5, 1]) A.updateDrag(s, session, [mid[0] + n[0] * k * t, mid[1] + n[1] * k * t], { snapRadiusM: LAPTOP });
    A.endDrag(s, session);
    return true;
  };

  it('every existing wall (loft walls included) ±0,3 / ±1 m, moved and dragged: every axis-parallel wall stays axis-parallel', () => {
    const store = proposal();
    const v0 = V(store);
    const problems: string[] = [];
    let cases = 0;
    for (const w of SEED.walls) {
      if (w.status !== 'existing') continue;
      for (const k of [0.3, -0.3, 1, -1]) {
        for (const drag of [false, true]) {
          store.getState().replaceVariant(v0.id, v0);
          move(store, w, k, drag);
          cases++;
          for (const x of V(store).walls) {
            const x0 = SEED.walls.find((y) => y.id === x.id);
            if (x0 && x.status !== 'removed' && axisParallel(x0) && !axisParallel(x)) problems.push(`${drag ? 'drag' : 'move'} ${w.id} ${k}: ${x.id} ${J([x.a, x.b])}`);
          }
        }
      }
    }
    expect(cases).toBeGreaterThanOrEqual(200);
    expect(problems).toEqual([]);
  }, 300000);

  it('the review\'s cases: w-peis-n 1 m south stops on y 2,2; w-vf-kjk 1 m east on x 9; lw-landing and lw-hems2-w at their supports\' ends', () => {
    const cases: [string, number, (w: Wall) => boolean][] = [
      ['w-peis-n', -1, (w) => w.a[1] === 2.2 && w.b[1] === 2.2],
      ['w-vf-kjk', -1, (w) => w.a[0] === 9 && w.b[0] === 9],
      ['lw-landing', 0.3, (w) => w.a[0] === 2.6 && w.b[0] === 2.6],
      ['lw-landing', -1, (w) => w.a[0] === 3.1 && w.b[0] === 3.1],
      ['lw-hems2-w', -0.3, (w) => w.a[0] === 3.85 && w.b[0] === 3.85],
    ];
    for (const [id, k, ok] of cases) {
      for (const drag of [false, true]) {
        const store = proposal();
        expect(move(store, SEED.walls.find((w) => w.id === id)!, k, drag), `${id} ${k}`).toBe(true);
        expect(ok(wall(store, id)), `${drag ? 'drag' : 'move'} ${id} ${k}: ${J([wall(store, id).a, wall(store, id).b])}`).toBe(true);
      }
    }
  });

  it('lw-split north: its east end is pinned at the stairwell corner, so the move is refused (before: it turned)', () => {
    const store = proposal();
    expect(move(store, SEED.walls.find((w) => w.id === 'lw-split')!, 0.3, false)).toBe(false);

    expect(J(V(store).walls)).toBe(J(SEED.walls));
    // South it slides on both ends as before.
    expect(move(store, SEED.walls.find((w) => w.id === 'lw-split')!, -0.3, false)).toBe(true);
    expect(wall(store, 'lw-split').a[1]).toBeCloseTo(2.8, 9);
    expect(wall(store, 'lw-split').b[1]).toBeCloseTo(2.8, 9);
  });

  it('w-wing-w moved east (Soverom (ny fløy) narrowed to 4,2 m) stays upright: its south end slides onto w-sauna-n, which stays', () => {
    const store = proposal();
    const sauna = J(wall(store, 'w-sauna-n'));
    expect(A.resizeRoom(store, 'room-sov-ny', 'w', 4.2)).toMatchObject({ ok: true, wallId: 'w-wing-w' });
    const w = wall(store, 'w-wing-w');
    expect(w.a[0]).toBeGreaterThan(16);
    expect(w.a[0]).toBe(w.b[0]);
    expect(J(wall(store, 'w-sauna-n'))).toBe(sauna);
  });

  it('w-106-korr ±0,3: the loft piece lw-106-top in line with it is carried along level (before: it turned), the loft keeps its rooms', () => {
    for (const k of [0.3, -0.3]) {
      const store = proposal();
      const named = D(store).rooms.filter((r) => r.room).length;
      expect(move(store, SEED.walls.find((w) => w.id === 'w-106-korr')!, k, false)).toBe(true);
      const top = wall(store, 'lw-106-top');
      expect(top.a[1], `${k}`).toBeCloseTo(2.18 + k, 9);
      expect(top.b[1], `${k}`).toBeCloseTo(2.18 + k, 9);
      if (k < 0) expect(D(store).rooms.filter((r) => r.room).length).toBe(named);
    }
  });
});
