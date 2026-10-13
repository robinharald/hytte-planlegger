/**
 * Final fix round after phase 2b, editor core (the fourth review's EDITOR findings and the shed-attach item), on the
 * real seed through the edit actions:
 *  - «Ta tilbake» brings back only the continuations the restored wall's own step carried (not a wall in line that the
 *    user moved in a step of its own, also on another floor; also after a reload);
 *  - a unit placed next to (or over) the house never pushes the house's furniture;
 *  - a unit moved, dragged or turned onto terrace furniture pushes it out (with the toast) instead of taking it over;
 *  - pushed furniture lands in no door swing and no wall;
 *  - a clamped or refused wall drag: the outline stops where the wall does, with a hint;
 *  - merged-away room names are kept on the variant (`mergedRooms`), so they come back after a reload too;
 *  - a shed attached by its open front turns half round.
 */
import { describe, expect, it } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import { migrateProject } from '../model/migrate';
import { createForslagD } from '../model/seed/forslagD';
import type { Variant, Vec2, Wall } from '../model/types';
import * as A from './editActions';
import { nb } from '../i18n/nb';
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
const SEED_DERIVED = deriveForState(proposal().getState());
const J = (x: unknown) => JSON.stringify(x);
const V = (s: Store): Variant => selectActiveVariant(s.getState());
const D = (s: Store): DerivedVariant => deriveForState(s.getState());
const wall = (s: Store, id: string): Wall => V(s).walls.find((w) => w.id === id)!;
const item = (s: Store, id: string) => V(s).furniture.find((f) => f.id === id);
const toastTexts = (s: Store) => s.getState().toasts.map((t) => t.text);
const LAPTOP = { snapRadiusM: 12 / 23.5 };
const PHONE = { snapRadiusM: 24 / 11.56, coarse: true };
const storeyOf = (levelId: string) => SEED.levels.find((l) => l.id === levelId)?.storeyId ?? 'ground';
const normalOf = (w: Pick<Wall, 'a' | 'b'>): Vec2 => {
  const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  return [-(w.b[1] - w.a[1]) / L, (w.b[0] - w.a[0]) / L];
};
const box = (pts: Vec2[]) => ({
  x0: Math.min(...pts.map((p) => p[0])),
  y0: Math.min(...pts.map((p) => p[1])),
  x1: Math.max(...pts.map((p) => p[0])),
  y1: Math.max(...pts.map((p) => p[1])),
});
const blockPts = (s: Store, id: string): Vec2[] => V(s).blocks.find((b) => b.id === id)?.polygon.map((v) => v.p) ?? [];

/** Wall `id` dragged k m across itself in four frames at the laptop's snap radius (one undo step). */
function dragWall(s: Store, id: string, k: number): void {
  const w = wall(s, id);
  const n = normalOf(w);
  const mid: Vec2 = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
  const session = A.beginDrag(s, { kind: 'wall', id }, mid, undefined, { snapRadiusM: LAPTOP.snapRadiusM, storeyId: storeyOf(w.levelId) });
  for (const t of [0.25, 0.5, 0.75, 1]) A.updateDrag(s, session, [mid[0] + n[0] * k * t, mid[1] + n[1] * k * t], LAPTOP);
  A.endDrag(s, session);
}

// ---------------------------------------------------------------------------------------------------------------
// 1. «Ta tilbake» and the walls in line
// ---------------------------------------------------------------------------------------------------------------

describe('«Ta tilbake» leaves a wall in line alone that the user moved in a step of its own', () => {
  const cases: { label: string; other: string; k: number }[] = [
    { label: 'w-vf-korr (main level) +0,3', other: 'w-vf-korr', k: 0.3 },
    { label: 'lw-hems2-s (loft) +0,3', other: 'lw-hems2-s', k: 0.3 },
  ];
  for (const { label, other, k } of cases) {
    for (const reload of [false, true]) {
      it(`${label}, then w-103-korr −0,3, Ta tilbake on w-103-korr${reload ? ' after a reload' : ''}: ${other} stays (before: reset)`, () => {
        const s = proposal();
        expect(A.moveWall(s, other, [0, k])).toBe(true);
        const moved = J(wall(s, other));
        expect(wall(s, other).a[1]).toBeCloseTo(4.24 + k, 9);
        expect(A.moveWall(s, 'w-103-korr', [0, -0.3])).toBe(true);
        expect(J(wall(s, other))).toBe(moved);
        if (reload) s.getState().clearHistory();
        expect(A.restoreGhost(s, 'w-103-korr/ghost')).toBe(true);
        expect(J(wall(s, 'w-103-korr'))).toBe(J(SEED.walls.find((w) => w.id === 'w-103-korr')));
        expect(J(wall(s, other))).toBe(moved);
        expect(V(s).walls.some((w) => w.id === `${other}/ghost`)).toBe(true);
      });
    }
  }

  it('the review\'s drags: w-vf-korr dragged north 0,3, w-103-korr dragged south 0,3, Ta tilbake → w-vf-korr stays', () => {
    const s = proposal();
    dragWall(s, 'w-vf-korr', 0.3);
    const moved = J(wall(s, 'w-vf-korr'));
    expect(wall(s, 'w-vf-korr').status).toBe('new');
    dragWall(s, 'w-103-korr', -0.3);
    expect(A.restoreGhost(s, 'w-103-korr/ghost')).toBe(true);
    expect(J(wall(s, 'w-vf-korr'))).toBe(moved);
    expect(J(wall(s, 'w-103-korr'))).toBe(J(SEED.walls.find((w) => w.id === 'w-103-korr')));
  });

  it('a continuation the step itself carried still goes back: w-106-korr ±0,3 carries lw-106-top, one Ta tilbake gives the seed', () => {
    for (const k of [0.3, -0.3]) {
      for (const reload of [false, true]) {
        const s = proposal();
        expect(A.moveWall(s, 'w-106-korr', [0, k])).toBe(true);
        expect(wall(s, 'lw-106-top').a[1]).toBeCloseTo(2.18 + k, 9);
        if (reload) s.getState().clearHistory();
        expect(A.restoreGhost(s, 'w-106-korr/ghost'), `${k} ${reload}`).toBe(true);
        expect(J(V(s).walls), `${k} ${reload}`).toBe(J(SEED.walls));
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2. A unit next to the house never pushes the house's furniture
// ---------------------------------------------------------------------------------------------------------------

describe('a unit placed against or over the house leaves the house\'s furniture where it is', () => {
  const place = (s: Store, tap: Vec2, template = 'vedskjul', mods: { snapRadiusM: number; coarse?: boolean } | null = LAPTOP) => {
    const at = mods ? A.snapPoint(s, tap, { purpose: 'unit', templateId: template, rotation90: 0, modifiers: mods }).point : tap;
    return A.placeUnit(s, template, at, 0);
  };

  it('a Vedskjul clicked 0,2 m south of the sauna wall: every item stays (before: the sauna stove went onto the terrace)', () => {
    const s = proposal();
    expect(place(s, [18.1, -2.2])).not.toBeNull();
    expect(J(V(s).furniture)).toBe(J(SEED.furniture));
    expect(toastTexts(s).join(' ')).not.toContain('er flyttet ut av');
  });

  it('the review\'s other cases: north of the main house, at Hovedbad, over Pantry, over Stue — every item stays', () => {
    // Over Pantry and over Stue (unsnapped) the unit would stand on the house: refused since the last fix round
    // (fifth review), so nothing changes there either.
    const cases: [Vec2, boolean, boolean][] = [
      [[14.4, 6.4], true, true],
      [[21.0, 1.1], true, true],
      [[17.2, -1.2], false, false],
      [[16, 0.8], false, false],
    ];
    for (const [tap, snapped, placed] of cases) {
      const s = proposal();
      const id = place(s, tap, 'vedskjul', snapped ? LAPTOP : null);
      if (placed) expect(id, J(tap)).not.toBeNull();
      else expect(id, J(tap)).toBeNull();
      expect(J(V(s).furniture), J(tap)).toBe(J(SEED.furniture));
    }
  });

  it('sweep: units clicked 0,2 / 0,6 m outside every edge of the house\'s blocks (laptop and phone): no item that stands in a room moves', () => {
    const inRoom = new Set(SEED_DERIVED.furniture.filter((f) => f.roomId !== undefined).map((f) => f.id));
    const problems: string[] = [];
    let placed = 0;
    for (const b of SEED.blocks) {
      const pts = b.polygon.map((v) => v.p);
      for (let i = 0; i < pts.length; i++) {
        const [p, q] = [pts[i], pts[(i + 1) % pts.length]];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 1) continue;
        const out: Vec2 = [(q[1] - p[1]) / L, -(q[0] - p[0]) / L];
        for (const gap of [0.2, 0.6]) {
          for (const template of ['vedskjul', 'bod']) {
            for (const mods of [LAPTOP, PHONE]) {
              const s = proposal();
              const tap: Vec2 = [(p[0] + q[0]) / 2 + out[0] * gap, (p[1] + q[1]) / 2 + out[1] * gap];
              if (!place(s, tap, template, mods)) continue;
              placed++;
              for (const f of V(s).furniture) {
                const f0 = SEED.furniture.find((x) => x.id === f.id);
                if (inRoom.has(f.id) && J(f) !== J(f0)) problems.push(`${b.id} edge ${i} ${gap} ${template}: ${f.id}`);
              }
            }
          }
        }
      }
    }
    expect(placed).toBeGreaterThanOrEqual(40);
    expect(problems).toEqual([]);
  }, 300000);

  it('a shed moved into the house by moveBlock pushes no house item either', () => {
    const s = proposal();
    const id = A.placeUnit(s, 'vedskjul', [18.1, -3.6], 0) as string;
    const before = J(V(s).furniture);
    expect(A.moveBlock(s, id, [0, 1.5])).toBe(true);
    expect(J(V(s).furniture)).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 3. A unit moved, dragged or turned onto terrace furniture
// ---------------------------------------------------------------------------------------------------------------

describe('a unit moved, dragged or turned onto terrace furniture pushes it out instead of taking it over', () => {
  const roomOf = (s: Store, blockId: string) => D(s).rooms.find((r) => r.blockId === blockId)?.id;
  const furnitureRoom = (s: Store, id: string) => D(s).furniture.find((f) => f.id === id)?.roomId;

  it('a shed dragged onto the terrace table pushes it out (toast); moving the shed leaves it, deleting the shed keeps it', () => {
    const s = proposal();
    const id = A.placeUnit(s, 'vedskjul', [10.6, -3.6], 0) as string;
    // The chair whose footprint reached into the shed's north wall is pushed out too (last fix round, sixth review).
    expect(toastTexts(s).join(' ')).toContain('«Utestol» er flyttet ut av «Vedskjul»');
    expect(D(s).warnings.map((w) => w.kind)).not.toContain('furniture-in-wall');
    s.setState({ toasts: [] });
    const from: Vec2 = [10.6, -3.6];
    const to: Vec2 = [12.8, -2.0];
    const session = A.beginDrag(s, { kind: 'block', id }, from, undefined, { snapRadiusM: LAPTOP.snapRadiusM });
    expect(session).not.toBeNull();
    for (let k = 1; k <= 8; k++) A.updateDrag(s, session, [from[0] + ((to[0] - from[0]) * k) / 8, from[1] + ((to[1] - from[1]) * k) / 8], LAPTOP);
    A.endDrag(s, session);
    expect(s.temporal.getState().pastStates).toHaveLength(2);
    // The shed now stands where the table stood; the table is out of it, in no room, with the toast.
    const shed = box(blockPts(s, id));
    expect(shed.x0 < 12.8 && shed.x1 > 12.8 && shed.y0 < -2.3 && shed.y1 > -2.3).toBe(true);
    expect(furnitureRoom(s, 'fu-terrasse-2')).toBeUndefined();
    expect(toastTexts(s).join(' ')).toContain('«Utebord» er flyttet ut av «Vedskjul»');
    const table = J(item(s, 'fu-terrasse-2'));
    // Before: the next move took the table along to (16,8, −3,3), and deleting the shed deleted it.
    expect(A.moveBlock(s, id, [4, -1])).toBe(true);
    expect(J(item(s, 'fu-terrasse-2'))).toBe(table);
    expect(A.deleteBlock(s, id)).toBe(true);
    expect(J(item(s, 'fu-terrasse-2'))).toBe(table);
    expect(V(s).furniture).toHaveLength(SEED.furniture.length);
  });

  it('moveBlock onto the table: pushed out with the toast, one undo step; Angre puts both back', () => {
    const s = proposal();
    const id = A.placeUnit(s, 'vedskjul', [10.6, -3.6], 0) as string;
    const placed = J(V(s));
    s.setState({ toasts: [] });
    expect(A.moveBlock(s, id, [2.2, 1.6])).toBe(true);
    expect(furnitureRoom(s, 'fu-terrasse-2')).toBeUndefined();
    expect(toastTexts(s).join(' ')).toContain('«Utebord» er flyttet ut av «Vedskjul»');
    s.getState().undo();
    expect(J(V(s))).toBe(placed);
  });

  it('a shed turned onto the table pushes it out; the turn back and a move leave it, the delete keeps it', () => {
    const s = proposal();
    const id = A.placeUnit(s, 'vedskjul', [12.8, -3.2], 0) as string;
    expect(furnitureRoom(s, 'fu-terrasse-2')).toBeUndefined();
    s.setState({ toasts: [] });
    expect(A.rotateBlock(s, id, 90)).toBe(true);
    // The turned shed covers the table's place (12,8, −2,3).
    const shed = box(blockPts(s, id));
    expect(shed.x0 < 12.8 && shed.x1 > 12.8 && shed.y0 < -2.3 && shed.y1 > -2.3).toBe(true);
    expect(furnitureRoom(s, 'fu-terrasse-2')).toBeUndefined();
    expect(toastTexts(s).join(' ')).toContain('«Utebord» er flyttet ut av «Vedskjul»');
    const table = J(item(s, 'fu-terrasse-2'));
    expect(A.rotateBlock(s, id, -90)).toBe(true);
    expect(A.moveBlock(s, id, [-3, 0])).toBe(true);
    expect(J(item(s, 'fu-terrasse-2'))).toBe(table);
    expect(A.deleteBlock(s, id)).toBe(true);
    expect(J(item(s, 'fu-terrasse-2'))).toBe(table);
  });

  it('its own furniture still goes with it, and a turned Anneks over the terrace owns none of the terrace furniture', () => {
    const s = proposal();
    // (At 14,5 the Anneks reached 0,5 m into the wing, which is refused since the final fix round.)
    const id = A.placeUnit(s, 'anneks', [13.9, -1.5], 0) as string;
    expect(A.rotateBlock(s, id, 90)).toBe(true);
    for (const f of ['fu-terrasse-1', 'fu-terrasse-2', 'fu-terrasse-3', 'fu-terrasse-4']) expect(furnitureRoom(s, f), f).toBeUndefined();
    const shed = A.placeUnit(s, 'vedskjul', [13, 9.35], 0) as string;
    const own = A.addFurniture(s, 'kubbe', [13.3, 9.35]) as string;
    expect(furnitureRoom(s, own)).toBe(roomOf(s, shed));
    expect(A.moveBlock(s, shed, [1, 0])).toBe(true);
    expect(item(s, own)?.position).toEqual([14.3, 9.35]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Pushed furniture lands in no door swing and no wall
// ---------------------------------------------------------------------------------------------------------------

describe('furniture pushed out of a unit lands in no door swing and no wall', () => {
  it('placeUnit(\'vedskjul\', [12,8, −1,6]) pushes the sofa and the table out and leaves 0 warnings (before: the sofa blocked door-stue-s)', () => {
    const s = proposal();
    const id = A.placeUnit(s, 'vedskjul', [12.8, -1.6], 0) as string;
    expect(toastTexts(s).join(' ')).toContain('«Loungesofa» og «Utebord» er flyttet ut av «Vedskjul»');
    const d = D(s);
    expect(d.warnings).toEqual([]);
    const shed = box(blockPts(s, id));
    for (const fid of ['fu-terrasse-1', 'fu-terrasse-2']) {
      const df = d.furniture.find((f) => f.id === fid)!;
      const p = df.item.position;
      expect(p[0] > shed.x0 - 0.03 && p[0] < shed.x1 + 0.03 && p[1] > shed.y0 - 0.03 && p[1] < shed.y1 + 0.03, fid).toBe(false);
      expect(df.blocksDoors, fid).toEqual([]);
      expect(df.collisions, fid).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 5. Clamped or refused wall drags
// ---------------------------------------------------------------------------------------------------------------

describe('a clamped or refused wall drag: the outline stops where the wall does, with a hint', () => {
  const frame = (id: string, k: number) => {
    const s = proposal();
    const w = wall(s, id);
    const n = normalOf(w);
    const mid: Vec2 = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    const session = A.beginDrag(s, { kind: 'wall', id }, mid, undefined, { snapRadiusM: LAPTOP.snapRadiusM, storeyId: storeyOf(w.levelId) });
    const p: Vec2 = [mid[0] + n[0] * k, mid[1] + n[1] * k];
    const preview = A.previewDrag(session, p, LAPTOP);
    const feedback = A.updateDrag(s, session, p, LAPTOP);
    const model = wall(s, id);
    A.endDrag(s, session);
    return { s, preview, feedback, model };
  };
  const near = (a: Vec2[], b: Vec2[]) => a.every((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]) < 1e-6);

  it('lw-split north (refused): the outline stays on the wall, the hint is set, nothing changes', () => {
    for (const k of [0.3, 1]) {
      const { s, preview, feedback, model } = frame('lw-split', k);
      expect(near(preview.target[0], [model.a, model.b]), `${k}`).toBe(true);
      expect(J(model)).toBe(J(SEED.walls.find((w) => w.id === 'lw-split')));
      expect(preview.hint).toBe(nb.editor.wallStuck);
      expect(feedback.hint).toBe(nb.editor.wallStuck);
      expect(s.temporal.getState().pastStates).toHaveLength(0);
    }
  });

  it('the review\'s clamped drags (lw-hems2-w −1, lw-landing +1, w-vf-kjk −1): the outline equals the moved wall, with the hint', () => {
    for (const [id, k] of [
      ['lw-hems2-w', -1],
      ['lw-landing', 1],
      ['w-vf-kjk', -1],
    ] as const) {
      const { preview, model } = frame(id, k);
      expect(near(preview.target[0], [model.a, model.b]), `${id} ${J(preview.target)} vs ${J([model.a, model.b])}`).toBe(true);
      expect(preview.hint, id).toBe(nb.editor.wallStuck);
    }
  });

  it('a wall that follows the pointer gets no hint (w-gang-n +0,3, w-peis-n −0,3)', () => {
    for (const [id, k] of [
      ['w-gang-n', 0.3],
      ['w-peis-n', -0.3],
    ] as const) {
      const { preview, model } = frame(id, k);
      expect(near(preview.target[0], [model.a, model.b]), id).toBe(true);
      expect(preview.hint, id).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 6. Room names after a reload between restores
// ---------------------------------------------------------------------------------------------------------------

describe('merged-away room names are kept on the variant and come back after a reload', () => {
  const named = (s: Store) =>
    D(s)
      .rooms.filter((r) => r.room)
      .map((r) => `${r.room?.name}: ${r.area.toFixed(3)}`)
      .sort();
  const seedRooms = named(proposal());

  it('blk-bod west +0,2, Ta tilbake on both wall ghosts, a reload, then the edge ghost: the seed\'s 27 names (before: 25)', () => {
    for (const order of [
      ['w-bod-gavl/ghost', 'w-mellom-boder/ghost'],
      ['w-mellom-boder/ghost', 'w-bod-gavl/ghost'],
    ]) {
      const s = proposal();
      expect(A.moveBlockEdge(s, 'blk-bod', 'v-bod-nw', [-0.2, 0])).toBe(true);
      for (const id of order) expect(A.restoreGhost(s, id)).toBe(true);
      expect(named(s)).toHaveLength(25);
      // Two merges (which name each kept depends on the order), both on the variant.
      expect(V(s).mergedRooms).toHaveLength(2);
      // A reload: the project through JSON and the migration, a new store, no undo history.
      const reloaded = createAppStore(migrateProject(JSON.parse(JSON.stringify(s.getState().project))));
      expect(V(reloaded).id).toBe(V(s).id);
      expect(A.restoreGhost(reloaded, 'blk-bod/v-bod-nw/ghost')).toBe(true);
      expect(J(V(reloaded).walls)).toBe(J(SEED.walls));
      expect(named(reloaded)).toEqual(seedRooms);
      expect(V(reloaded).mergedRooms).toBeUndefined();
    }
  });

  it('clearHistory between the restores (as after a reload) gives the 27 names too; within one session nothing changes', () => {
    for (const clear of [true, false]) {
      const s = proposal();
      A.moveBlockEdge(s, 'blk-bod', 'v-bod-nw', [-0.2, 0]);
      A.restoreGhost(s, 'w-bod-gavl/ghost');
      if (clear) s.getState().clearHistory();
      A.restoreGhost(s, 'w-mellom-boder/ghost');
      if (clear) s.getState().clearHistory();
      A.restoreGhost(s, 'blk-bod/v-bod-nw/ghost');
      expect(named(s), `${clear}`).toEqual(seedRooms);
      expect(J(V(s).walls), `${clear}`).toBe(J(SEED.walls));
      expect(V(s).mergedRooms, `${clear}`).toBeUndefined();
    }
  });

  it('a merge records the removed room with the anchors of its storey\'s rooms; Angre takes the record away again', () => {
    const s = proposal();
    const before = V(s);
    expect(A.moveBlockEdge(s, 'blk-bod', 'v-bod-nw', [-0.2, 0])).toBe(true);
    expect(V(s).mergedRooms).toBeUndefined();
    const rooms = V(s).rooms;
    expect(A.restoreGhost(s, 'w-bod-gavl/ghost')).toBe(true);
    const rec = V(s).mergedRooms ?? [];
    expect(rec).toHaveLength(1);
    const ground = rooms.filter((r) => storeyOf(r.levelId) === storeyOf(rec[0].room.levelId));
    expect(Object.keys(rec[0].peers).sort()).toEqual(ground.map((r) => r.id).sort());
    expect(ground.length).toBeLessThan(before.rooms.length);
    for (const r of ground) expect(rec[0].peers[r.id]).toEqual(r.anchor);
    s.getState().undo();
    expect(V(s).mergedRooms).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 7. A shed attached by its open front
// ---------------------------------------------------------------------------------------------------------------

describe('a shed attached with its open front against a building turns half round', () => {
  const WING_N = 6.2;
  /** The edge of the block that carries its full-height open front, as [a, b]. */
  const frontEdge = (s: Store, id: string): [Vec2, Vec2] => {
    const b = V(s).blocks.find((x) => x.id === id)!;
    const o = V(s).openings.find((x) => x.host.kind === 'blockEdge' && x.host.blockId === id && x.fullHeight)!;
    const i = b.polygon.findIndex((v) => o.host.kind === 'blockEdge' && v.id === o.host.edgeId);
    return [b.polygon[i].p, b.polygon[(i + 1) % b.polygon.length].p];
  };

  it('a Vedskjul tapped 0,4 m north of the wing on the phone attaches with the open front north, away from the wing', () => {
    for (const gap of [0.2, 0.4, 0.8]) {
      const s = proposal();
      const r = A.snapPoint(s, [18.4, WING_N + gap + 0.75], { purpose: 'unit', templateId: 'vedskjul', rotation90: 0, modifiers: PHONE });
      const id = A.placeUnit(s, 'vedskjul', r.point, 0) as string;
      expect(box(blockPts(s, id)).y0, `${gap}`).toBeCloseTo(WING_N, 9);
      const [a, b] = frontEdge(s, id);
      expect(a[1], `${gap}`).toBeCloseTo(WING_N + 1.5, 9);
      expect(b[1], `${gap}`).toBeCloseTo(WING_N + 1.5, 9);
      const kinds = D(s).warnings.map((w) => w.kind);
      expect(kinds, `${gap}`).not.toContain('opening-on-removed-edge');
      // The wing's gable end rises above the shed (a placed unit never asks the wing's ridge to meet it): no warning.
      expect(D(s).warnings, `${gap}`).toEqual([]);
      // A lean-to against the wing: high against its wall, draining north, away from it (final fix round, fourth
      // review; before, the low eave stood against the wing).
      expect(V(s).blocks.find((x) => x.id === id)?.roof).toMatchObject({ type: 'mono', slopeTo: 'N' });
    }
  });

  it('turned the other way already (rotation 2), or free on the deck, it keeps the rotation it was given', () => {
    const s = proposal();
    const r = A.snapPoint(s, [18.4, WING_N + 0.4 + 0.75], { purpose: 'unit', templateId: 'vedskjul', rotation90: 2, modifiers: PHONE });
    const id = A.placeUnit(s, 'vedskjul', r.point, 2) as string;
    expect(frontEdge(s, id)[0][1]).toBeCloseTo(WING_N + 1.5, 9);
    const free = A.placeUnit(s, 'vedskjul', [14, 9.35], 0) as string;
    const [a, b] = frontEdge(s, free);
    expect(a[1]).toBeCloseTo(9.35 - 0.75, 9);
    expect(b[1]).toBeCloseTo(9.35 - 0.75, 9);
    expect(V(s).blocks.find((x) => x.id === free)?.roof).toMatchObject({ slopeTo: 'N' });
  });

  it('against the wing\'s long east side with the front towards it (rotation 3): turned to face east, no warning', () => {
    const s = proposal();
    const at: Vec2 = [20.8 + 0.75, 2];
    const id = A.placeUnit(s, 'vedskjul', at, 3) as string;
    expect(box(blockPts(s, id)).x0).toBeCloseTo(20.8, 9);
    const [a, b] = frontEdge(s, id);
    expect(a[0]).toBeCloseTo(20.8 + 1.5, 9);
    expect(b[0]).toBeCloseTo(20.8 + 1.5, 9);
    expect(D(s).warnings).toEqual([]);
  });
});
