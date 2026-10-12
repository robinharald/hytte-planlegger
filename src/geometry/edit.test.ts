/**
 * geometry/edit.ts on small fixtures (state/testProject.ts: one existing gable block 6 × 4 m, wall w-1 at x 3 between
 * room-1 and room-2). The seed scenarios of docs/phase2-plan.md §3.4 / §3.5 are in state/editActions.test.ts.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import type { Deck, Variant, Vec2, Wall } from '../model/types';
import { cardinalOf, quarterTurns, unitFootprint, unitSize, unitTemplate, UNIT_TEMPLATES } from '../model/unitTemplates';
import { makeTestProject, makeVariant } from '../state/testProject';
import { deriveVariant } from './derive';
import {
  applyAddOpening,
  applyAddSteps,
  applyAddWall,
  applyDeleteDeckVertex,
  applyDeleteWall,
  applyInsertDeckVertex,
  applyMoveBlock,
  applyMoveBlockEdge,
  applyMoveBlockVertex,
  applyMoveDeckEdge,
  applyMoveDeckVertex,
  applyMoveOpening,
  applyMoveSteps,
  applyMoveWall,
  applyMoveWallEndpoint,
  applyPlaceUnit,
  applyRestoreWall,
  applySetOpeningProps,
  applySplitWall,
  blockHasExistingArea,
  defaultOpeningLevel,
  ghostIdOf,
  ghostRef,
  healGhosts,
  isLocked,
  keepsRectangle,
  openingDefaults,
  originalIdOf,
  parseEdgeGhostId,
  pieceRange,
  matchRoomsToFaces,
  reconcileRooms,
  reviveRooms,
  roomResizeMove,
  roomResizeTargets,
  swingOnNewHost,
  touchExisting,
  wallEndsFree,
} from './edit';
import type { EditContext } from './edit';

const site = makeTestProject().site;
const derive = (v: Variant): DerivedVariant => deriveVariant(v, site, null);
const ctxOf = (v: Variant): EditContext => ({ base: v, derived: derive(v) });

/** produce + recipe with the context of the base. */
function edit<R>(v: Variant, recipe: (d: Variant, ctx: EditContext) => R): { next: Variant; result: R } {
  const ctx = ctxOf(v);
  let result: R | undefined;
  const next = produce(v, (d) => {
    result = recipe(d as Variant, ctx);
  });
  return { next, result: result as R };
}

const base = (): Variant => makeVariant('v-1', 'Test');
const wallOf = (v: Variant, id: string): Wall | undefined => v.walls.find((w) => w.id === id);
const extraWall = (id: string, a: Vec2, b: Vec2, status: Wall['status'] = 'new'): Wall => ({ id, a, b, thickness: 0.1, levelId: 'main', status, kind: 'interior', heightMode: 'auto' });

describe('lock and ids', () => {
  it('isLocked is the variant flag only', () => {
    expect(isLocked({ locked: true })).toBe(true);
    expect(isLocked({})).toBe(false);
    expect(isLocked(null)).toBe(false);
  });

  it('ghost ids', () => {
    expect(ghostIdOf('w-1')).toBe('w-1/ghost');
    expect(originalIdOf('w-1/ghost')).toBe('w-1');
    expect(originalIdOf('w-1')).toBeNull();
    expect(parseEdgeGhostId('blk-1/v-se/ghost')).toEqual({ blockId: 'blk-1', edgeId: 'v-se' });
    expect(parseEdgeGhostId('blk-1/v-se/ghost/2')).toEqual({ blockId: 'blk-1', edgeId: 'v-se' });
    expect(parseEdgeGhostId('w-1/ghost')).toBeNull();
  });
});

describe('touchExisting / healGhosts', () => {
  it('an existing wall becomes new with a removed copy; idempotent; new walls untouched', () => {
    const v = produce(base(), (d) => {
      d.walls.push(extraWall('w-new', [1, 1], [2, 1]));
      d.openings.push({ id: 'o-old', type: 'window', host: { kind: 'wall', wallId: 'w-1' }, offset: 1, width: 0.6, height: 1, sill: 0.8, style: { frameColour: 'white' }, status: 'removed' });
    });
    const next = produce(v, (d) => {
      expect(touchExisting(d, 'w-1')).toBe(true);
      expect(touchExisting(d, 'w-1')).toBe(false);
      expect(touchExisting(d, 'w-new')).toBe(false);
      expect(touchExisting(d, 'nope')).toBe(false);
    });
    expect(wallOf(next, 'w-1')?.status).toBe('new');
    expect(wallOf(next, 'w-1/ghost')).toMatchObject({ status: 'removed', a: [3, 0], b: [3, 4] });
    expect(next.walls.filter((w) => w.id === 'w-1/ghost')).toHaveLength(1);
    // The demolition marker stays with the old wall.
    expect(next.openings.find((o) => o.id === 'o-old')?.host).toEqual({ kind: 'wall', wallId: 'w-1/ghost' });
  });

  it('healGhosts: a wall back on its ghost is existing again; an edge ghost covered by its edge goes', () => {
    const v = produce(base(), (d) => {
      touchExisting(d, 'w-1');
      d.ghosts = [{ id: 'blk-1/v-se/ghost', a: [6, 0], b: [6, 4] }];
    });
    const healed = produce(v, (d) => healGhosts(d));
    expect(wallOf(healed, 'w-1')?.status).toBe('existing');
    expect(wallOf(healed, 'w-1/ghost')).toBeUndefined();
    expect(healed.ghosts).toBeUndefined();
    const moved = produce(v, (d) => {
      const w = wallOf(d, 'w-1') as Wall;
      w.a = [3.5, 0];
      healGhosts(d);
    });
    expect(wallOf(moved, 'w-1')?.status).toBe('new');
    expect(wallOf(moved, 'w-1/ghost')).toBeDefined();
  });
});

describe('walls', () => {
  it('an anchored wall slides along its supports; the existing wall leaves a ghost; rooms are reconciled', () => {
    const v = base();
    const { next, result } = edit(v, (d, ctx) => applyMoveWall(d, ctx, 'w-1', [0.5, 0.2]));
    expect(result).toBe(true);
    // Both ends sit on the block's south / north edges: they slide along them (only x changes).
    expect(wallOf(next, 'w-1')).toMatchObject({ a: [3.5, 0], b: [3.5, 4], status: 'new' });
    expect(wallOf(next, 'w-1/ghost')).toMatchObject({ a: [3, 0], b: [3, 4], status: 'removed' });
    const rec = reconcileRooms(derive(v), next, derive(next));
    expect(rec.merges).toEqual([]);
    expect(wallEndsFree(ctxOf(v), 'w-1')).toBe(false);
  });

  it('a free node moves as a node: the coincident wall keeps its direction; T-junction walls follow', () => {
    const v = produce(base(), (d) => {
      d.walls.push(extraWall('w-a', [0.5, 1], [2, 1]), extraWall('w-b', [2, 1], [2, 3]), extraWall('w-t', [3, 2], [5, 2]));
    });
    const { next } = edit(v, (d, ctx) => applyMoveWall(d, ctx, 'w-a', [0, 0.5]));
    expect(wallOf(next, 'w-a')).toMatchObject({ a: [0.5, 1.5], b: [2, 1.5] });
    expect(wallOf(next, 'w-b')).toMatchObject({ a: [2, 1.5], b: [2, 3] });
    // w-t starts on the interior of w-1: moving w-1 trims / extends it along its own line.
    const { next: n2 } = edit(v, (d, ctx) => applyMoveWall(d, ctx, 'w-1', [-0.4, 0]));
    expect(wallOf(n2, 'w-t')).toMatchObject({ a: [2.6, 2], b: [5, 2] });
  });

  it('endpoint drags: an anchored end slides along its support, a free end goes to the pointer', () => {
    const v = produce(base(), (d) => {
      d.walls.push(extraWall('w-a', [0.5, 1], [2, 1]));
    });
    const { next } = edit(v, (d, ctx) => applyMoveWallEndpoint(d, ctx, 'w-1', 'b', [3.7, 4.3]));
    expect(wallOf(next, 'w-1')?.b).toEqual([3.7, 4]);
    const { next: n2 } = edit(v, (d, ctx) => applyMoveWallEndpoint(d, ctx, 'w-a', 'b', [2.5, 1.5]));
    expect(wallOf(n2, 'w-a')?.b).toEqual([2.5, 1.5]);
    expect(wallEndsFree(ctxOf(v), 'w-a')).toBe(true);
  });

  it('add / split / delete', () => {
    const v = base();
    const { next, result: id } = edit(v, (d) => applyAddWall(d, [1, 1], [1, 3], 'main'));
    expect(wallOf(next, id as string)).toMatchObject({ thickness: 0.12, status: 'new', kind: 'interior', heightMode: 'auto' });
    expect(edit(v, (d) => applyAddWall(d, [1, 1], [1, 1.02], 'main')).result).toBeNull();
    const { next: split, result: second } = edit(v, (d) => applySplitWall(d, 'w-1', 0.25));
    expect(wallOf(split, 'w-1')).toMatchObject({ a: [3, 0], b: [3, 1], status: 'existing' });
    expect(wallOf(split, second as string)).toMatchObject({ a: [3, 1], b: [3, 4], status: 'existing' });
    const { next: del } = edit(v, (d) => applyDeleteWall(d, 'w-1'));
    expect(wallOf(del, 'w-1')?.status).toBe('removed');
    const { next: back } = edit(del, (d) => applyRestoreWall(d, 'w-1'));
    expect(wallOf(back, 'w-1')?.status).toBe('existing');
    expect(ghostRef(del, 'w-1')).toEqual({ type: 'wall', id: 'w-1', original: null });
  });
});

describe('matchRoomsToFaces', () => {
  const pr = (room: string, face: string, ov: number) => ({ room, face, ov });
  const sorted = <T extends { ov: number }>(xs: T[]) => [...xs].sort((x, y) => y.ov - x.ov);
  const ids = (xs: { room: string; face: string }[]) => xs.map((x) => `${x.room}→${x.face}`).sort();

  it('keeps as many rooms as possible before maximising the overlap (a wall dragged past the middle)', () => {
    // Greedy would give B the big face (7.4) and leave A without one.
    expect(ids(matchRoomsToFaces(sorted([pr('B', 'big', 7.4), pr('B', 'strip', 5.5), pr('A', 'big', 4.97)])))).toEqual(['A→big', 'B→strip']);
  });

  it('two rooms in one face: the larger overlap keeps it; one room over two faces: the larger piece', () => {
    expect(ids(matchRoomsToFaces(sorted([pr('A', 'F', 3), pr('B', 'F', 8)])))).toEqual(['B→F']);
    expect(ids(matchRoomsToFaces(sorted([pr('A', 'F1', 3), pr('A', 'F2', 5)])))).toEqual(['A→F2']);
  });

  it('separate components are matched independently', () => {
    const got = matchRoomsToFaces(sorted([pr('A', 'F1', 1), pr('B', 'F2', 2), pr('C', 'F2', 1), pr('C', 'F3', 0.5)]));
    expect(ids(got)).toEqual(['A→F1', 'B→F2', 'C→F3']);
  });
});

describe('reconcileRooms / reviveRooms', () => {
  it('deleting the wall merges the rooms (the larger previous room stays)', () => {
    const v = produce(base(), (d) => {
      d.walls[0].a = [2.5, 0];
      d.walls[0].b = [2.5, 4];
    });
    const { next } = edit(v, (d) => applyDeleteWall(d, 'w-1'));
    const rec = reconcileRooms(derive(v), next, derive(next));
    expect(rec.merges.map((m) => [m.kept.id, m.removed.id])).toEqual([['room-2', 'room-1']]);
    expect(rec.rooms.map((r) => r.id)).toEqual(['room-2']);
    // Reviving: the deleted record comes back into the unnamed face once the wall is back.
    const merged = produce(next, (d) => {
      d.rooms = rec.rooms as typeof d.rooms;
    });
    const restored = produce(merged, (d) => {
      applyRestoreWall(d, 'w-1');
    });
    const back = reviveRooms(restored, derive(restored), [v.rooms[0]]);
    expect(back.map((r) => r.id)).toEqual(['room-1']);
  });

  it('a room shrunk past its anchor keeps its own face and gets its label point as anchor', () => {
    const v = base();
    const { next } = edit(v, (d, ctx) => applyMoveWall(d, ctx, 'w-1', [-1.8, 0])); // x 3 → 1.2, room-1's anchor is 1.5
    const nd = derive(next);
    const rec = reconcileRooms(derive(v), next, nd);
    expect(rec.merges).toEqual([]);
    const r1 = rec.rooms.find((r) => r.id === 'room-1');
    expect(r1?.anchor[0]).toBeLessThan(1.2);
    const after = produce(next, (d) => {
      d.rooms = rec.rooms as typeof d.rooms;
    });
    expect(derive(after).rooms.filter((r) => r.room).map((r) => r.room?.id).sort()).toEqual(['room-1', 'room-2']);
  });

  it('roomResizeTargets prefers stored walls; roomResizeMove gives the wall move', () => {
    const d = derive(base());
    const t = roomResizeTargets(d, 'room-1', 'w');
    expect(t.min?.kind).toBe('blockEdge');
    expect(t.max).toMatchObject({ kind: 'wall', wallId: 'w-1' });
    expect(t.preferred).toBe('max');
    const w = d.rooms.find((r) => r.room?.id === 'room-1')?.dims.w ?? 0;
    expect(roomResizeMove(d, 'room-1', 'w', w + 0.5)).toEqual({ wallId: 'w-1', delta: [0.5, 0], side: 'max' });
    expect(roomResizeMove(d, 'room-1', 'd', 3)).toEqual({ refused: 'block-edge' });
    expect(roomResizeMove(d, 'nope', 'd', 3)).toEqual({ refused: 'no-room' });
  });
});

describe('blocks', () => {
  it('an existing edge move leaves a ghost that heals when it comes back; parts never change', () => {
    const v = base();
    const { next } = edit(v, (d, ctx) => applyMoveBlockEdge(d, ctx, 'blk-1', 'v-se', [1, 0.3]));
    expect(next.blocks[0].polygon.map((p) => p.p)).toEqual([
      [0, 0],
      [7, 0],
      [7, 4],
      [0, 4],
    ]);
    expect(next.ghosts).toEqual([{ id: 'blk-1/v-se/ghost', a: [6, 0], b: [6, 4] }]);
    const { next: back } = edit(next, (d, ctx) => applyMoveBlockEdge(d, ctx, 'blk-1', 'v-se', [-1, 0]));
    expect(back.ghosts).toBeUndefined();
    expect(back.blocks[0].polygon).toEqual(v.blocks[0].polygon);
  });

  it('an edge move that would turn the block inside out is scaled back', () => {
    const { next } = edit(base(), (d, ctx) => applyMoveBlockEdge(d, ctx, 'blk-1', 'v-se', [-10, 0]));
    const xs = next.blocks[0].polygon.map((p) => p.p[0]);
    expect(Math.max(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs) * 4).toBeGreaterThanOrEqual(0.25 - 1e-6);
  });

  it('gable corners keep the rectangle; flat-roof corners move alone', () => {
    const v = base();
    expect(keepsRectangle(v.blocks[0])).toBe(true);
    const { next } = edit(v, (d, ctx) => applyMoveBlockVertex(d, ctx, 'blk-1', 'v-ne', [7, 5]));
    expect(next.blocks[0].polygon.map((p) => p.p)).toEqual([
      [0, 0],
      [7, 0],
      [7, 5],
      [0, 5],
    ]);
    const flat = produce(v, (d) => {
      d.blocks[0].roof.type = 'flat';
    });
    const { next: n2 } = edit(flat, (d, ctx) => applyMoveBlockVertex(d, ctx, 'blk-1', 'v-ne', [7, 5]));
    expect(n2.blocks[0].polygon.map((p) => p.p)).toEqual([
      [0, 0],
      [6, 0],
      [7, 5],
      [0, 4],
    ]);
  });

  it('existing blocks cannot be moved whole; new ones carry their walls and rooms', () => {
    const v = base();
    expect(blockHasExistingArea(v.blocks[0])).toBe(true);
    expect(edit(v, (d, ctx) => applyMoveBlock(d, ctx, 'blk-1', [1, 0])).result).toBe('existing');
    const fresh = produce(v, (d) => {
      d.blocks[0].isNew = true;
    });
    const { next, result } = edit(fresh, (d, ctx) => applyMoveBlock(d, ctx, 'blk-1', [1, 2]));
    expect(result).toBe(true);
    expect(wallOf(next, 'w-1')).toMatchObject({ a: [4, 2], b: [4, 6] });
    expect(next.rooms.map((r) => r.anchor)).toEqual([
      [2.5, 4],
      [5.5, 4],
    ]);
  });

  it('placeUnit: every template, front edge 0, rotations', () => {
    for (const t of UNIT_TEMPLATES) {
      const { next, result } = edit(base(), (d, ctx) => applyPlaceUnit(d, ctx, t.id, [20, 20], 1));
      const b = next.blocks.find((x) => x.id === result?.blockId);
      expect(b).toMatchObject({ template: t.id, isNew: true, levelId: 'main' });
      expect(b?.templateFrontEdgeId).toBe(b?.polygon[0].id);
      expect(next.rooms.find((r) => r.id === result?.roomId)).toMatchObject({ type: t.roomType, anchor: [20, 20] });
      expect(derive(next).warnings.filter((w) => w.kind !== 'roof-no-meet')).toEqual([]);
    }
  });
});

describe('unit templates', () => {
  it('sizes, footprints and rotations', () => {
    expect(unitTemplate('vedskjul')).toMatchObject({ w: 2, d: 1.5, openFront: true });
    expect(unitTemplate('bod')).toMatchObject({ w: 2, d: 3 });
    expect(unitTemplate('badstue')).toMatchObject({ w: 2.4, d: 2.2 });
    expect(unitTemplate('anneks')).toMatchObject({ w: 4, d: 3 });
    expect(unitTemplate('eget')).toMatchObject({ w: 3, d: 3, roofType: 'flat' });
    expect(quarterTurns(-1)).toBe(3);
    expect(quarterTurns(5)).toBe(1);
    expect(unitSize({ w: 2, d: 1.5 }, 1)).toEqual([1.5, 2]);
    expect(unitFootprint({ w: 2, d: 1.5 }, [0, 0], 0)).toEqual([
      [-1, -0.75],
      [1, -0.75],
      [1, 0.75],
      [-1, 0.75],
    ]);
    // A quarter turn: the front (edge 0) faces east.
    expect(unitFootprint({ w: 2, d: 1.5 }, [0, 0], 1)).toEqual([
      [0.75, -1],
      [0.75, 1],
      [-0.75, 1],
      [-0.75, -1],
    ]);
    expect(cardinalOf('N', 0)).toBe('N');
    expect(cardinalOf('N', 1)).toBe('W');
    expect(cardinalOf('S', 3)).toBe('W');
  });
});

describe('openings', () => {
  it('defaults by type', () => {
    expect(openingDefaults('window')).toMatchObject({ width: 1.1, sill: 0.8 });
    expect(openingDefaults('door').swing).toEqual({ hinge: 'start', side: 'left' });
    expect(openingDefaults('slidingDoor').swing).toBeUndefined();
  });

  it('swingOnNewHost keeps the swing in world terms', () => {
    const sw = { hinge: 'start' as const, side: 'left' as const };
    expect(swingOnNewHost(sw, [1, 0], [2, 0])).toEqual(sw);
    expect(swingOnNewHost(sw, [1, 0], [-1, 0])).toEqual({ hinge: 'end', side: 'right' });
    // Perpendicular host: turned with the host.
    expect(swingOnNewHost(sw, [1, 0], [0, 1])).toEqual({ hinge: 'start', side: 'left' });
  });

  it('a move is clamped to the host; re-hosting onto a wall; existing openings are touched', () => {
    const v = produce(base(), (d) => {
      d.openings.push({
        id: 'd-1',
        type: 'door',
        host: { kind: 'wall', wallId: 'w-1' },
        offset: 2,
        width: 0.8,
        height: 2,
        sill: 0,
        swing: { hinge: 'start', side: 'left' },
        style: { frameColour: 'white' },
        status: 'existing',
      });
    });
    const { next } = edit(v, (d, ctx) => applyMoveOpening(d, ctx, 'd-1', 10));
    expect(next.openings.find((o) => o.id === 'd-1')).toMatchObject({ offset: 3.6, status: 'new' });
    expect(next.openings.find((o) => o.id === 'd-1/ghost')).toMatchObject({ offset: 2, status: 'removed' });
    const host = { kind: 'blockEdge' as const, blockId: 'blk-1', edgeId: 'v-sw' };
    const { next: n2 } = edit(v, (d, ctx) => applyMoveOpening(d, ctx, 'd-1', 1.5, host));
    expect(n2.openings.find((o) => o.id === 'd-1')).toMatchObject({ host, offset: 1.5, swing: { hinge: 'start', side: 'left' } });
    expect(pieceRange(ctxOf(v), host, 1)).toEqual([0, 6]);
    expect(defaultOpeningLevel(v, host, 1)).toBe('main');
    const { next: n3 } = edit(v, (d) => applySetOpeningProps(d, 'd-1', { type: 'window' }));
    expect(n3.openings.find((o) => o.id === 'd-1')).toMatchObject({ type: 'window', sill: 0.8, style: { mullions: [2, 2] } });
    expect(n3.openings.find((o) => o.id === 'd-1')?.swing).toBeUndefined();
    expect(edit(v, (d, ctx) => applyAddOpening(d, ctx, { kind: 'wall', wallId: 'nope' }, 1, 'door')).result).toBeNull();
  });
});

describe('deck', () => {
  const withDeck = (): Variant =>
    produce(base(), (d) => {
      const deck: Deck = {
        id: 'deck-1',
        polygon: [
          { id: 'd0', p: [0, -4] },
          { id: 'd1', p: [6, -4] },
          { id: 'd2', p: [6, 0] },
          { id: 'd3', p: [0, 0] },
        ],
        topHeight: 0,
        isNew: true,
        railing: { style: 'glass', height: 1 },
        noRailingEdges: [],
        steps: [{ id: 's-1', edgeId: 'd0', offset: 4.5, width: 1 }],
      };
      d.outdoor.decks.push(deck);
    });

  it('insert / delete vertices re-host the steps by plan position; min three corners', () => {
    const v = withDeck();
    const { next, result: vid } = edit(v, (d) => applyInsertDeckVertex(d, 'deck-1', 'd0', [3, -4], 'dn'));
    expect(vid).toBe('dn');
    expect(next.outdoor.decks[0].steps[0]).toMatchObject({ edgeId: 'dn', offset: 1.5 });
    const { next: n2 } = edit(next, (d) => applyDeleteDeckVertex(d, 'deck-1', 'dn'));
    expect(n2.outdoor.decks[0].steps[0]).toMatchObject({ edgeId: 'd0', offset: 4.5 });
    const tri = produce(v, (d) => {
      d.outdoor.decks[0].polygon.pop();
    });
    expect(edit(tri, (d) => applyDeleteDeckVertex(d, 'deck-1', 'd0')).result).toBe(false);
  });

  it('vertex / edge moves keep steps in place; degenerate decks are refused; steps clamp to their edge', () => {
    const v = withDeck();
    const { next } = edit(v, (d) => applyMoveDeckVertex(d, 'deck-1', 'd0', [-1, -4]));
    expect(next.outdoor.decks[0].steps[0].offset).toBeCloseTo(5.5, 9);
    const { next: n2 } = edit(v, (d) => applyMoveDeckEdge(d, 'deck-1', 'd0', [3, -1]));
    expect(n2.outdoor.decks[0].polygon[0].p).toEqual([0, -5]);
    expect(edit(v, (d) => applyMoveDeckVertex(d, 'deck-1', 'd0', [6, 0])).result).toBe(false);
    const { next: n3 } = edit(v, (d) => applyMoveSteps(d, 's-1', 10));
    expect(n3.outdoor.decks[0].steps[0].offset).toBe(5.5);
    const { next: n4, result } = edit(v, (d, ctx) => applyAddSteps(d, ctx.derived, 'd1'));
    // The free run of d1 stops at the block's cladding (y −0.11): the steps go to its middle.
    expect(n4.outdoor.decks[0].steps.find((s) => s.id === result)?.offset).toBeCloseTo((4 - 0.11) / 2, 9);
  });
});
