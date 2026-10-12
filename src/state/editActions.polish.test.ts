/**
 * Editor polish, core side (phase 2b, the leftovers of the second review of 2a), on the real seed: junction and stub
 * ghosts on an already moved edge, the status of inward-moved edges, two-step returns of clamped openings, today's
 * outline of a part-less copy, turning a free unit off the grid, attaching units on the phone, guide extensions in
 * endpoint drags and a corridor wall moved across itself.
 */
import { describe, expect, it } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import type { Variant, Vec2 } from '../model/types';
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
const namedRooms = (s: Store) => D(s).rooms.filter((r) => r.room);
const opening = (s: Store, id: string) => V(s).openings.find((o) => o.id === id);
const kinds = (s: Store) => D(s).warnings.map((w) => w.kind);
const blockPts = (s: Store, id: string): Vec2[] => V(s).blocks.find((b) => b.id === id)?.polygon.map((v) => v.p) ?? [];
const box = (pts: Vec2[]) => ({
  x0: Math.min(...pts.map((p) => p[0])),
  y0: Math.min(...pts.map((p) => p[1])),
  x1: Math.max(...pts.map((p) => p[0])),
  y1: Math.max(...pts.map((p) => p[1])),
});
const edgePieces = (s: Store, blockId: string, edgeId: string) =>
  D(s).walls.filter((w) => w.source.kind === 'blockEdge' && w.source.blockId === blockId && w.source.edgeId === edgeId && !w.isGhost);

/** Today's cabin is back: blocks, walls and openings as in the seed, no ghosts, all 27 rooms named. */
function backToSeed(s: Store): string | null {
  const v = V(s);
  if (J(v.blocks) !== J(SEED.blocks)) return `blocks ${J(v.blocks.map((b) => [b.id, b.polygon.map((x) => x.p)]))}`;
  if (J(v.walls) !== J(SEED.walls)) return `walls ${J(v.walls.filter((w) => !SEED.walls.some((x) => J(x) === J(w))))}`;
  if (J(v.openings) !== J(SEED.openings)) return `openings ${J(v.openings.filter((o) => !SEED.openings.some((x) => J(x) === J(o))))}`;
  if (v.ghosts !== undefined) return `ghosts ${J(v.ghosts)}`;
  if (namedRooms(s).length !== 27) return `${namedRooms(s).length} named rooms`;
  return null;
}

/** "Ta tilbake" on the first (or the last) edge ghost until none is left. */
function restoreAll(store: Store, last: boolean): void {
  for (let n = 0; V(store).ghosts && n < 10; n++) {
    const list = V(store).ghosts ?? [];
    expect(A.restoreGhost(store, (last ? list[list.length - 1] : list[0]).id)).toBe(true);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Junction and stub ghosts on an edge an earlier edit already moved
// ---------------------------------------------------------------------------------------------------------------

describe('junction and stub ghosts are never recorded on an edge whose line an earlier edit moved', () => {
  it('main south +0.3 (inward), then glass east +0.5: no stray ghost on the moved line; Ta tilbake in either order gives the seed', () => {
    for (const last of [false, true]) {
      const store = proposal();
      expect(A.moveBlockEdge(store, 'blk-main', 'v-main-sw', [0, 0.3])).toBe(true);
      expect(A.moveBlockEdge(store, 'blk-glass', 'v-glass-se', [0.5, 0])).toBe(true);
      // Every ghost lies on today's lines (y 0 for the main south wall), none on the moved line y 0.3.
      for (const g of V(store).ghosts ?? []) expect(g.a[1] === 0.3 && g.b[1] === 0.3, J(g)).toBe(false);
      restoreAll(store, last);
      expect(backToSeed(store), last ? 'last first' : 'first first').toBeNull();
    }
  });

  it('glass NE / NW corner dragged into the main house (x ∓ 0.5, +0.3): Ta tilbake on every ghost in either order gives the seed', () => {
    const problems: string[] = [];
    for (const [vertex, p] of [
      ['v-glass-ne', [8.5, 0.3]],
      ['v-glass-nw', [5.5, 0.3]],
    ] as [string, Vec2][]) {
      for (const last of [false, true]) {
        const store = proposal();
        expect(A.moveBlockVertex(store, 'blk-glass', vertex, p)).toBe(true);
        restoreAll(store, last);
        const why = backToSeed(store);
        if (why) problems.push(`${vertex} ${J(p)} ${last ? 'last' : 'first'}: ${why}`);
      }
    }
    expect(problems).toEqual([]);
  }, 60000);

  it('glass south +0.3 inward, then west +0.3 inward: first-ghost-first restores give the seed (no stray stub ghost)', () => {
    for (const last of [false, true]) {
      const store = proposal();
      expect(A.moveBlockEdge(store, 'blk-glass', 'v-glass-sw', [0, 0.3])).toBe(true);
      expect(A.moveBlockEdge(store, 'blk-glass', 'v-glass-nw', [0.3, 0])).toBe(true);
      for (const g of V(store).ghosts ?? []) expect(g.a[1] === -1.7 && g.b[1] === -1.7, J(g)).toBe(false);
      restoreAll(store, last);
      expect(backToSeed(store), last ? 'last first' : 'first first').toBeNull();
    }
  });

  it('every glass corner dragged out and in, then Ta tilbake on each ghost in either order: the seed again', () => {
    const corners: [string, Vec2, Vec2[]][] = [
      ['v-glass-sw', [5, -2], [[-0.5, -0.5], [0.5, 0.5]]],
      ['v-glass-se', [9, -2], [[0.5, -0.5], [-0.5, 0.3]]],
      ['v-glass-ne', [9, 0], [[0.5, 0.3], [-0.5, 0.3]]],
      ['v-glass-nw', [5, 0], [[-0.5, 0.3], [0.5, 0.3]]],
    ];
    const problems: string[] = [];
    for (const [vertex, at, offsets] of corners) {
      for (const d of offsets) {
        for (const last of [false, true]) {
          const store = proposal();
          const p: Vec2 = [at[0] + d[0], at[1] + d[1]];
          if (!A.moveBlockVertex(store, 'blk-glass', vertex, p)) {
            problems.push(`${vertex} ${J(p)}: refused`);
            continue;
          }
          restoreAll(store, last);
          const why = backToSeed(store);
          if (why) problems.push(`${vertex} ${J(p)} ${last ? 'last' : 'first'}: ${why}`);
        }
      }
    }
    expect(problems).toEqual([]);
  }, 180000);
});

// ---------------------------------------------------------------------------------------------------------------
// 3. An edge of today's cabin moved inward is new (it lies in the existing part, but it is a newly built wall)
// ---------------------------------------------------------------------------------------------------------------

describe('a moved edge of today\'s cabin is new wherever it lies', () => {
  it('glass south −0.5 (inward): the moved piece is new; the old line is a ghost', () => {
    const store = proposal();
    expect(A.moveBlockEdge(store, 'blk-glass', 'v-glass-sw', [0, 0.5])).toBe(true);
    expect(V(store).ghosts?.some((g) => g.id === 'blk-glass/v-glass-sw/ghost')).toBe(true);
    const pieces = edgePieces(store, 'blk-glass', 'v-glass-sw');
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.map((w) => w.isNew)).toEqual(pieces.map(() => true));
    expect(pieces.every((w) => w.status === 'new')).toBe(true);
    // The other glass walls keep their status: the stretches of today's east and west walls are still today's.
    expect(edgePieces(store, 'blk-glass', 'v-glass-se').some((w) => !w.isNew)).toBe(true);
  });

  it("blk-main's west gable +1 (inward): the moved gable is new; moved back by hand it is today's again", () => {
    const store = proposal();
    expect(A.moveBlockEdge(store, 'blk-main', 'v-main-nw', [1, 0])).toBe(true);
    const pieces = edgePieces(store, 'blk-main', 'v-main-nw');
    expect(pieces.length).toBeGreaterThan(0);
    for (const w of pieces) expect(w.isNew, w.id).toBe(true);
    expect(A.moveBlockEdge(store, 'blk-main', 'v-main-nw', [-1, 0])).toBe(true);
    expect(V(store).ghosts).toBeUndefined();
    for (const w of edgePieces(store, 'blk-main', 'v-main-nw')) expect(w.isNew, w.id).toBe(false);
  });

  it('a junction ghost or a stub ghost on the edge\'s own line changes nothing (glass east +0.5: main south stays today\'s)', () => {
    const store = proposal();
    expect(A.moveBlockEdge(store, 'blk-glass', 'v-glass-se', [0.5, 0])).toBe(true);
    expect(V(store).ghosts?.some((g) => g.id === 'blk-main/v-main-sw/ghost')).toBe(true);
    const south = edgePieces(store, 'blk-main', 'v-main-sw');
    expect(south.filter((w) => w.source.kind === 'blockEdge' && w.source.s1 <= 12 + 1e-9).every((w) => !w.isNew)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 6. Today's part of a part-less copy follows today's lines (the block's own edge ghosts)
// ---------------------------------------------------------------------------------------------------------------

describe("todayPart: a part-less copy's outline is taken from today's lines", () => {
  /** A revision-4 copy whose glass bump was grown 0.5 m east before revision 5: no parts, a ghost at x 9, edge at 9.5. */
  function grownRevision4(): Store {
    const store = proposal();
    const v = V(store);
    store.getState().replaceVariant(v.id, {
      ...v,
      blocks: v.blocks.map((b) =>
        b.id === 'blk-glass'
          ? { ...b, parts: [], polygon: b.polygon.map((x) => (x.p[0] === 9 ? { ...x, p: [9.5, x.p[1]] as Vec2 } : x)) }
          : b,
      ),
      ghosts: [{ id: 'blk-glass/v-glass-se/ghost', a: [9, -2], b: [9, 0] }],
    });
    store.getState().clearHistory();
    return store;
  }
  const todayOf = (s: Store) => V(s).blocks.find((b) => b.id === 'blk-glass')?.parts;

  it('any edit gives a today part that ends at the ghost line x 9, not at the grown edge', () => {
    const store = grownRevision4();
    expect(A.moveBlockEdge(store, 'blk-glass', 'v-glass-sw', [0, -0.3])).toBe(true);
    expect(todayOf(store)).toEqual([
      {
        id: 'blk-glass-today',
        name: 'Hytta i dag',
        polygon: [
          [5, -2],
          [9, -2],
          [9, 0],
          [5, 0],
        ],
        isNew: false,
      },
    ]);
  });

  it('moved back to x 9 and out again: the moved wall is new and the areas of today equal a revision-5 copy', () => {
    const store = grownRevision4();
    expect(A.moveBlockEdge(store, 'blk-glass', 'v-glass-se', [-0.5, 0])).toBe(true);
    expect(blockPts(store, 'blk-glass')).toEqual(SEED.blocks.find((b) => b.id === 'blk-glass')?.polygon.map((v) => v.p));
    expect(todayOf(store)?.[0].polygon).toEqual([
      [5, -2],
      [9, -2],
      [9, 0],
      [5, 0],
    ]);
    expect(V(store).ghosts).toBeUndefined();
    expect(A.moveBlockEdge(store, 'blk-glass', 'v-glass-se', [0.5, 0])).toBe(true);
    expect(edgePieces(store, 'blk-glass', 'v-glass-se').map((w) => w.isNew)).toEqual([true]);
    const seeded = proposal();
    expect(A.moveBlockEdge(seeded, 'blk-glass', 'v-glass-se', [0.5, 0])).toBe(true);
    const [a, b] = [D(store).areas, D(seeded).areas];
    expect(a.bya.existing).toBeCloseTo(b.bya.existing, 6);
    expect(a.bra.existing).toBeCloseTo(b.bra.existing, 6);
    expect(a.axis.existing).toBeCloseTo(b.axis.existing, 6);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 7. Roter 90° on a free unit off the 0.1 m grid
// ---------------------------------------------------------------------------------------------------------------

describe('rotateBlock: a free unit off the 0.1 m grid keeps its centre and does not drift', () => {
  it('a Vedskjul placed at (13, 9) (y 8.25..9.75): one turn keeps the centre; +90/−90 and four turns give it back exactly', () => {
    const store = proposal();
    const id = A.placeUnit(store, 'vedskjul', [13, 9], 0) as string;
    const start = V(store).blocks.find((b) => b.id === id)?.polygon;
    expect(box(blockPts(store, id))).toEqual({ x0: 12, y0: 8.25, x1: 14, y1: 9.75 });
    expect(A.rotateBlock(store, id, 90)).toBe(true);
    const b1 = box(blockPts(store, id));
    expect([(b1.x0 + b1.x1) / 2, (b1.y0 + b1.y1) / 2]).toEqual([13, 9]);
    expect([b1.x1 - b1.x0, b1.y1 - b1.y0]).toEqual([1.5, 2]);
    expect(A.rotateBlock(store, id, -90)).toBe(true);
    expect(V(store).blocks.find((b) => b.id === id)?.polygon).toEqual(start);
    for (let k = 0; k < 4; k++) expect(A.rotateBlock(store, id, 90)).toBe(true);
    expect(V(store).blocks.find((b) => b.id === id)?.polygon).toEqual(start);
    for (let k = 0; k < 4; k++) expect(A.rotateBlock(store, id, -90)).toBe(true);
    expect(V(store).blocks.find((b) => b.id === id)?.polygon).toEqual(start);
  });

  it('a unit on the grid still turns onto the grid (as before)', () => {
    const store = proposal();
    const id = A.placeUnit(store, 'vedskjul', [14, 9.35], 0) as string;
    expect(A.rotateBlock(store, id, 90)).toBe(true);
    for (const p of blockPts(store, id)) for (const c of p) expect(Math.abs(c * 10 - Math.round(c * 10))).toBeLessThan(1e-6);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 5. Doors and windows of today's cabin come back when their host returns in several steps or turned and back
// ---------------------------------------------------------------------------------------------------------------

describe('clamped openings of today come back: returns in several steps, hosts turned and back', () => {
  /** The openings of today's cabin (existing in the seed) that are not exactly as in the seed. */
  const todayOpeningsOff = (s: Store) =>
    V(s)
      .openings.filter((o) => {
        const seed = SEED.openings.find((x) => x.id === o.id);
        return seed?.status === 'existing' && J(seed) !== J(o);
      })
      .map((o) => `${o.id} ${o.status} ${o.offset}`);

  it('blk-bod south edge −0.5, then +0.25 and +0.25: door-green-e at 0.69 and door-green-w at 5.21, existing', () => {
    const store = proposal();
    expect(A.moveBlockEdge(store, 'blk-bod', 'v-bod-sw', [0, 0.5])).toBe(true);
    expect(opening(store, 'door-green-e')?.status).toBe('new');
    expect(A.moveBlockEdge(store, 'blk-bod', 'v-bod-sw', [0, -0.25])).toBe(true);
    // Halfway: still pressed against the edge's start, as near its ghost as fits.
    expect(opening(store, 'door-green-e')?.offset).toBeCloseTo(0.455, 9);
    expect(A.moveBlockEdge(store, 'blk-bod', 'v-bod-sw', [0, -0.25])).toBe(true);
    expect(opening(store, 'door-green-e')).toEqual(SEED.openings.find((o) => o.id === 'door-green-e'));
    expect(opening(store, 'door-green-w')).toEqual(SEED.openings.find((o) => o.id === 'door-green-w'));
    expect(backToSeed(store)).toBeNull();
  });

  it('the glass east edge −0.5 / west edge −1, then back in two halves: win-glass-s2 / win-glass-s1 are back', () => {
    for (const [edge, d, id] of [
      ['v-glass-se', [-0.5, 0], 'win-glass-s2'],
      ['v-glass-nw', [1, 0], 'win-glass-s1'],
      ['v-glass-sw', [0, 0.5], 'win-glass-e'],
    ] as [string, Vec2, string][]) {
      const store = proposal();
      expect(A.moveBlockEdge(store, 'blk-glass', edge, d)).toBe(true);
      expect(opening(store, id)?.status, id).toBe('new');
      expect(A.moveBlockEdge(store, 'blk-glass', edge, [-d[0] / 2, -d[1] / 2])).toBe(true);
      expect(A.moveBlockEdge(store, 'blk-glass', edge, [-d[0] / 2, -d[1] / 2])).toBe(true);
      expect(opening(store, id), id).toEqual(SEED.openings.find((o) => o.id === id));
      expect(backToSeed(store), id).toBeNull();
    }
  });

  it('every block edge moved in by 0.5 / 1 m and back in two halves: every door and window of today is back', () => {
    const problems: string[] = [];
    for (const b of SEED.blocks) {
      const pts = b.polygon.map((v) => v.p);
      for (let i = 0; i < pts.length; i++) {
        const [p, q] = [pts[i], pts[(i + 1) % pts.length]];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const out: Vec2 = [(q[1] - p[1]) / L, -(q[0] - p[0]) / L];
        for (const k of [0.5, 1]) {
          const s = proposal();
          if (!A.moveBlockEdge(s, b.id, b.polygon[i].id, [-out[0] * k, -out[1] * k])) continue;
          A.moveBlockEdge(s, b.id, b.polygon[i].id, [(out[0] * k) / 2, (out[1] * k) / 2]);
          A.moveBlockEdge(s, b.id, b.polygon[i].id, [(out[0] * k) / 2, (out[1] * k) / 2]);
          const off = todayOpeningsOff(s);
          if (off.length > 0 || J(V(s).blocks) !== J(SEED.blocks)) problems.push(`${b.id}/${b.polygon[i].id} −${k}: ${off.join(', ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  }, 120000);

  it("w-103-korr's end a shortened past its door and back (one step or two): d-bad and d-104 on the turned w-104-diag are back", () => {
    for (const two of [false, true]) {
      const store = proposal();
      expect(A.moveWallEndpoint(store, 'w-103-korr', 'a', [3.55, 4.24])).toBe(true);
      expect(opening(store, 'd-104')?.status).toBe('new');
      if (two) expect(A.moveWallEndpoint(store, 'w-103-korr', 'a', [3.3, 4.24])).toBe(true);
      expect(A.moveWallEndpoint(store, 'w-103-korr', 'a', [3.05, 4.24])).toBe(true);
      expect(opening(store, 'd-104'), two ? 'two steps' : 'one step').toEqual(SEED.openings.find((o) => o.id === 'd-104'));
      expect(opening(store, 'd-bad'), two ? 'two steps' : 'one step').toEqual(SEED.openings.find((o) => o.id === 'd-bad'));
      expect(backToSeed(store)).toBeNull();
    }
  });

  it('every end of a stored wall with doors shortened 0.3 / 0.5 / 0.7 m and moved back (one or two steps): walls and openings as in the seed', () => {
    const problems: string[] = [];
    let cases = 0;
    for (const w of SEED.walls) {
      if (w.status !== 'existing' || !SEED.openings.some((o) => o.host.kind === 'wall' && o.host.wallId === w.id)) continue;
      for (const end of ['a', 'b'] as const) {
        const P = w[end];
        const F = end === 'a' ? w.b : w.a;
        const L = Math.hypot(F[0] - P[0], F[1] - P[1]);
        for (const k of [0.3, 0.5, 0.7]) {
          if (k > L - 0.3) continue;
          const p: Vec2 = [P[0] + ((F[0] - P[0]) * k) / L, P[1] + ((F[1] - P[1]) * k) / L];
          for (const two of [false, true]) {
            const s = proposal();
            if (!A.moveWallEndpoint(s, w.id, end, p)) continue;
            cases++;
            if (two) A.moveWallEndpoint(s, w.id, end, [(P[0] + p[0]) / 2, (P[1] + p[1]) / 2]);
            A.moveWallEndpoint(s, w.id, end, P);
            const v = V(s);
            if (J(v.walls) !== J(SEED.walls) || J(v.openings) !== J(SEED.openings)) problems.push(`${w.id}.${end} ${k} ${two ? 'two' : 'one'}: ${todayOpeningsOff(s).join(', ')}`);
          }
        }
      }
    }
    expect(cases).toBeGreaterThanOrEqual(30);
    expect(problems).toEqual([]);
  }, 120000);

  it('a door the user moved along its wall by more than 0.15 m stays when the wall turns and comes back', () => {
    const store = proposal();
    // d-104 moved 0.3 m along w-104-diag (new, its ghost at 0.53); then w-103-korr's end a out and back turns w-104-diag.
    expect(A.moveOpening(store, 'd-104', 0.83)).toBe(true);
    expect(A.moveWallEndpoint(store, 'w-103-korr', 'a', [3.55, 4.24])).toBe(true);
    expect(A.moveWallEndpoint(store, 'w-103-korr', 'a', [3.05, 4.24])).toBe(true);
    expect(opening(store, 'd-104')?.status).toBe('new');
    expect(Math.abs((opening(store, 'd-104')?.offset ?? 0) - 0.83)).toBeLessThan(0.05);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 9. A corridor wall moved across itself keeps its direction
// ---------------------------------------------------------------------------------------------------------------

describe('a wall whose end support ends short of the moved line keeps its direction', () => {
  it('w-103-korr moved 0.5 m south stays axis-parallel; w-103-102 is carried, w-vf-korr stays; Ta tilbake gives the seed', () => {
    for (const d of [-0.5, -0.2, 0.3]) {
      const store = proposal();
      expect(A.moveWall(store, 'w-103-korr', [0, d])).toBe(true);
      const w = V(store).walls.find((x) => x.id === 'w-103-korr');
      expect(w?.a[1], `${d}`).toBeCloseTo(4.24 + d, 9);
      expect(w?.b[1], `${d}`).toBeCloseTo(4.24 + d, 9);
      if (d < 0) {
        expect(w?.b).toEqual([5.05, 4.24 + d]);
        expect(V(store).walls.find((x) => x.id === 'w-103-102')?.a).toEqual([5.05, 4.24 + d]);
        expect(V(store).walls.find((x) => x.id === 'w-vf-korr')).toEqual(SEED.walls.find((x) => x.id === 'w-vf-korr'));
      }
      expect(namedRooms(store), `${d}`).toHaveLength(27);
      // Its own door keeps its place in the (now longer) wall. (At −0.5 the west end slides 0.6 m down w-104-diag,
      // which then is too short for d-104: that warning is the move itself, not a tilt.)
      expect(D(store).warnings.filter((x) => x.kind.startsWith('opening') && 'openingId' in x && x.openingId === 'd-bad'), `${d}`).toEqual([]);
      if (d > -0.5) expect(kinds(store).filter((k) => k.startsWith('opening')), `${d}`).toEqual([]);
      expect(A.restoreGhost(store, 'w-103-korr/ghost')).toBe(true);
      expect(backToSeed(store), `${d}`).toBeNull();
    }
  });

  it('the same move as a drag (laptop snap radius) stays parallel too', () => {
    const store = proposal();
    const session = A.beginDrag(store, { kind: 'wall', id: 'w-103-korr' }, [4, 4.24], undefined, { snapRadiusM: 12 / 23.5 });
    A.updateDrag(store, session, [4, 3.74], { snapRadiusM: 12 / 23.5 });
    A.endDrag(store, session);
    const w = V(store).walls.find((x) => x.id === 'w-103-korr');
    expect(w && Math.abs(w.a[1] - w.b[1])).toBeLessThan(1e-9);
    expect(w?.a[1]).toBeLessThan(4);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Attaching a placed unit on the phone (11,6 px/m: 24 px snap radius, 10 px drag threshold)
// ---------------------------------------------------------------------------------------------------------------

describe('attaching a unit at the phone\'s starting zoom', () => {
  const PHONE = 11.6;
  const mods = { snapRadiusM: 24 / PHONE, coarse: true };
  /** The wing's north wall: y 6.2 for x 16..20.8. */
  const WING_N = 6.2;

  it('"Nytt bygg": a Vedskjul tapped 0.4 m from the wing\'s north wall attaches (tap → snapPoint → placeUnit)', () => {
    const store = proposal();
    const tap: Vec2 = [18.4, WING_N + 0.4 + 0.75];
    const r = A.snapPoint(store, tap, { purpose: 'unit', templateId: 'vedskjul', rotation90: 0, modifiers: mods });
    const id = A.placeUnit(store, 'vedskjul', r.point, 0) as string;
    expect(box(blockPts(store, id)).y0).toBeCloseTo(WING_N, 9);
    expect(kinds(store)).not.toContain('block-overlap');
    expect(D(store).blocks.find((b) => b.block.id === id)?.junctions.some((j) => j.otherBlockId === 'blk-wing')).toBe(true);
  });

  it('a shed 0.4 m away attaches with one 1 m drag towards the wall, without overlapping', () => {
    const store = proposal();
    const id = A.placeUnit(store, 'vedskjul', [18.4, WING_N + 0.4 + 0.75], 0) as string;
    expect(box(blockPts(store, id)).y0).toBeCloseTo(WING_N + 0.4, 9);
    const c: Vec2 = [18.4, WING_N + 1.15];
    const session = A.beginDrag(store, { kind: 'block', id }, c, undefined, { snapRadiusM: mods.snapRadiusM });
    A.updateDrag(store, session, [c[0], c[1] - 0.5], mods);
    A.updateDrag(store, session, [c[0], c[1] - 1], mods);
    A.endDrag(store, session);
    const b = box(blockPts(store, id));
    expect(b.y0).toBeCloseTo(WING_N, 9);
    expect(b.x0).toBeCloseTo(17.4, 9);
    expect(kinds(store)).not.toContain('block-overlap');
  });

  it('on the laptop (23,5 px/m) the same drag attaches too; a drag that ends 0.6 m short does not', () => {
    const LAPTOP = { snapRadiusM: 12 / 23.5 };
    const store = proposal();
    const id = A.placeUnit(store, 'vedskjul', [18.4, WING_N + 0.4 + 0.75], 0) as string;
    const c: Vec2 = [18.4, WING_N + 1.15];
    let session = A.beginDrag(store, { kind: 'block', id }, c, undefined, LAPTOP);
    A.updateDrag(store, session, [c[0], c[1] - 0.6], LAPTOP);
    A.endDrag(store, session);
    expect(box(blockPts(store, id)).y0).toBeCloseTo(WING_N, 9);
    const far = proposal();
    const id2 = A.placeUnit(far, 'vedskjul', [18.4, WING_N + 1.6 + 0.75], 0) as string;
    const c2: Vec2 = [18.4, WING_N + 2.35];
    session = A.beginDrag(far, { kind: 'block', id: id2 }, c2, undefined, LAPTOP);
    A.updateDrag(far, session, [c2[0], c2[1] - 1], LAPTOP);
    A.endDrag(far, session);
    expect(box(blockPts(far, id2)).y0).toBeCloseTo(WING_N + 0.6, 9);
  });

  it('the phone e2e scene still holds: a shed placed on the deck by a tap at (14, 11.3), dragged 2 m west and 1 m north', () => {
    const store = proposal();
    const r = A.snapPoint(store, [14, 11.3], { purpose: 'unit', templateId: 'vedskjul', rotation90: 0, modifiers: mods });
    const id = A.placeUnit(store, 'vedskjul', r.point, 0) as string;
    const b0 = box(blockPts(store, id));
    expect(b0.y1).toBeCloseTo(12.1, 9); // on the deck's north edge
    const drag = (from: Vec2, to: Vec2) => {
      const session = A.beginDrag(store, { kind: 'block', id }, from, undefined, { snapRadiusM: mods.snapRadiusM });
      for (const t of [0.25, 0.5, 0.75, 1]) A.updateDrag(store, session, [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t], mods);
      A.endDrag(store, session);
    };
    const c0: Vec2 = [(b0.x0 + b0.x1) / 2, (b0.y0 + b0.y1) / 2];
    drag(c0, [c0[0] - 2, c0[1]]);
    const b1 = box(blockPts(store, id));
    expect(Math.abs(b1.x0 - b0.x0 + 2)).toBeLessThanOrEqual(0.25);
    expect(b1.y0).toBeCloseTo(b0.y0, 1);
    const c1: Vec2 = [(b1.x0 + b1.x1) / 2, (b1.y0 + b1.y1) / 2];
    drag(c1, [c1[0], c1[1] + 1]);
    const b2 = box(blockPts(store, id));
    expect(Math.abs(b2.y0 - b1.y0 - 1)).toBeLessThanOrEqual(0.25);
    expect(b2.x0).toBeCloseTo(b1.x0, 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 8. Endpoint drags: guide extensions do not overshoot the reach
// ---------------------------------------------------------------------------------------------------------------

describe('endpoint drags land within 0.25 m of the pointer', () => {
  it('w-do-109 end a dragged 0.5 / 0.7 m west (laptop and phone) lands within 0.25 m of the pointer', () => {
    for (const [scale, px] of [
      [23.5, 12],
      [11.6, 24],
    ]) {
      for (const k of [0.5, 0.7]) {
        const store = proposal();
        const w = SEED.walls.find((x) => x.id === 'w-do-109');
        if (!w) throw new Error('w-do-109');
        const r = px / scale;
        const session = A.beginDrag(store, { kind: 'wall', id: w.id }, w.a, 'a', { snapRadiusM: r });
        const pointer: Vec2 = [w.a[0] - k, w.a[1]];
        A.updateDrag(store, session, pointer, { snapRadiusM: r, coarse: px === 24 });
        A.endDrag(store, session);
        const a = V(store).walls.find((x) => x.id === w.id)?.a as Vec2;
        expect(Math.hypot(a[0] - pointer[0], a[1] - pointer[1]), `${scale} px/m, ${k} m: ${J(a)}`).toBeLessThanOrEqual(0.25 + 1e-9);
      }
    }
  });
});
