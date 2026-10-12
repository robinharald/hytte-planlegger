import { describe, expect, it } from 'vitest';
import type { DerivedFurniture } from '../model/derived';
import {
  CORRIDOR_COARSE_PX,
  CORRIDOR_PX,
  HANDLE_RADIUS_COARSE_PX,
  HANDLE_RADIUS_PX,
  bodyDragTarget,
  dragThresholdPx,
  ghostIdOfWall,
  gridSnap,
  handlesFor,
  hitsSelection,
  openingCornerDimension,
  pointerSizes,
  selectionBounds,
  tapSelection,
  unitFootprint,
  unitSize,
  wallAt,
  wallsById,
} from './editModel';
import { createPlanFixture } from './fixture';

const d = createPlanFixture();
const PIECE_SW = 'blk-a/a-sw/blk-a-rest/base';

describe('sizes, grid and units', () => {
  it('uses 7 / 14 px handles, 12 / 24 px corridors and 5 / 10 px thresholds', () => {
    expect(pointerSizes(false)).toEqual({ handleR: HANDLE_RADIUS_PX, corridor: CORRIDOR_PX, snap: 12 });
    expect(pointerSizes(true)).toEqual({ handleR: HANDLE_RADIUS_COARSE_PX, corridor: CORRIDOR_COARSE_PX, snap: 24 });
    expect([HANDLE_RADIUS_PX, HANDLE_RADIUS_COARSE_PX, CORRIDOR_PX, CORRIDOR_COARSE_PX]).toEqual([7, 14, 12, 24]);
    expect(dragThresholdPx('mouse')).toBe(5);
    expect(dragThresholdPx('pen')).toBe(5);
    expect(dragThresholdPx('touch')).toBe(10);
  });

  it('snaps to 0.10 m, or 0.01 m when fine', () => {
    expect(gridSnap([1.234, -0.06], false)).toEqual([1.2, -0.1]);
    expect(gridSnap([1.234, -0.004], true)).toEqual([1.23, 0]);
    expect(gridSnap([0.36, 0.249], false)).toEqual([0.4, 0.2]);
  });

  it('centres unit ghosts on the point and turns them by quarter turns', () => {
    expect(unitSize('vedskjul', 0)).toEqual([2, 1.5]);
    expect(unitSize('vedskjul', 1)).toEqual([1.5, 2]);
    expect(unitSize('vedskjul', -1)).toEqual([1.5, 2]);
    expect(unitSize('badstue', 2)).toEqual([2.4, 2.2]);
    expect(unitSize('nope', 0)).toEqual([3, 3]);
    expect(unitFootprint('bod', [5, 5], 0)).toEqual([
      [4, 3.5],
      [6, 3.5],
      [6, 6.5],
      [4, 6.5],
    ]);
  });
});

describe('handlesFor', () => {
  it('gives a block a handle on every vertex and edge midpoint, vertices last', () => {
    const hs = handlesFor(d, { kind: 'block', id: 'blk-a' });
    expect(hs.map((h) => h.key)).toEqual(['be:a-sw', 'be:a-se', 'be:a-ne', 'be:a-nw', 'bv:a-sw', 'bv:a-se', 'bv:a-ne', 'bv:a-nw']);
    const mid = hs.find((h) => h.key === 'be:a-sw')!;
    expect(mid.p).toEqual([5, 0]);
    expect(mid.drag).toEqual({ kind: 'blockEdge', id: 'a-sw' });
    const v = hs.find((h) => h.key === 'bv:a-ne')!;
    expect(v.p).toEqual([10, 6]);
    expect(v.tap).toEqual({ kind: 'blockVertex', id: 'a-ne' });
    expect(hs.every((h) => !h.active)).toBe(true);
  });

  it('keeps the block handles for a selected vertex or edge and marks it active', () => {
    expect(handlesFor(d, { kind: 'blockVertex', id: 'a-se' }).filter((h) => h.active).map((h) => h.key)).toEqual(['bv:a-se']);
    expect(handlesFor(d, { kind: 'blockEdge', id: 'b-ne' }).filter((h) => h.active).map((h) => h.key)).toEqual(['be:b-ne']);
  });

  it('gives an exterior wall piece its edge vertices, a stored wall its ends, an opening its jambs', () => {
    expect(handlesFor(d, { kind: 'wall', id: PIECE_SW }).map((h) => [h.key, h.p])).toEqual([
      ['bv:a-sw', [0, 0]],
      ['bv:a-se', [10, 0]],
    ]);
    const ends = handlesFor(d, { kind: 'wall', id: 'w-bad-s' });
    expect(ends.map((h) => [h.key, h.handle, h.p])).toEqual([
      ['we:a', 'a', [7, 3]],
      ['we:b', 'b', [10, 3]],
    ]);
    expect(ends[0].drag).toEqual({ kind: 'wall', id: 'w-bad-s' });
    expect(ends[0].tap).toBeNull();
    const jambs = handlesFor(d, { kind: 'opening', id: 'd-bad' });
    expect(jambs.map((h) => h.handle)).toEqual(['start', 'end']);
    expect(jambs[0].p[0]).toBeCloseTo(7, 9);
    expect(jambs[0].p[1]).toBeCloseTo(3.8, 9);
    expect(jambs[1].p[1]).toBeCloseTo(4.6, 9);
  });

  it('gives no handles to ghosts, removed openings, rooms or nothing', () => {
    expect(handlesFor(d, { kind: 'wall', id: 'w-rives' })).toEqual([]);
    expect(handlesFor(d, { kind: 'opening', id: 'win-old' })).toEqual([]);
    expect(handlesFor(d, { kind: 'room', id: 'rom-bad' })).toEqual([]);
    expect(handlesFor(d, null)).toEqual([]);
  });

  it('gives a deck edge corridors, "+" midpoints and vertex handles', () => {
    const hs = handlesFor(d, { kind: 'deck', id: 'deck-1' });
    expect(hs.filter((h) => h.shape === 'edge')).toHaveLength(4);
    expect(hs.filter((h) => h.shape === 'vertex').map((h) => h.tap)).toEqual(['v0', 'v1', 'v2', 'v3'].map((v) => ({ kind: 'deckVertex', id: `deck-1-${v}` })));
    const plus = hs.find((h) => h.key === 'di:deck-1-v0')!;
    expect(plus.shape).toBe('insert');
    expect(plus.p).toEqual([12, -3]);
    expect(plus.insert).toEqual({ deckId: 'deck-1', edgeId: 'deck-1-v0' });
    expect(plus.drag).toBeNull();
    expect(hs.findIndex((h) => h.shape === 'vertex')).toBeGreaterThan(hs.findIndex((h) => h.shape === 'insert'));
    const edgeSel = handlesFor(d, { kind: 'deckEdge', id: 'deck-1-v1' });
    expect(edgeSel.filter((h) => h.active).map((h) => h.key)).toEqual(['de:deck-1-v1']);
    expect(handlesFor(d, { kind: 'deckVertex', id: 'deck-1-v2' }).filter((h) => h.active).map((h) => h.key)).toEqual(['dv:deck-1-v2']);
  });
});

describe('bodyDragTarget and hitsSelection', () => {
  it('drags an exterior piece as its block edge, a stored wall as itself, nothing for rooms and ghosts', () => {
    expect(bodyDragTarget(d, { kind: 'wall', id: PIECE_SW, levelId: 'main' })).toEqual({ kind: 'blockEdge', id: 'a-sw' });
    expect(bodyDragTarget(d, { kind: 'wall', id: 'w-bad-s', levelId: 'main' })).toEqual({ kind: 'wall', id: 'w-bad-s' });
    expect(bodyDragTarget(d, { kind: 'wall', id: 'w-rives' })).toBeNull();
    expect(bodyDragTarget(d, { kind: 'opening', id: 'd-bad' })).toEqual({ kind: 'opening', id: 'd-bad' });
    expect(bodyDragTarget(d, { kind: 'opening', id: 'win-old' })).toBeNull();
    expect(bodyDragTarget(d, { kind: 'room', id: 'rom-bad' })).toBeNull();
    expect(bodyDragTarget(d, { kind: 'deck', id: 'deck-1' })).toBeNull();
    expect(bodyDragTarget(d, { kind: 'ghost', id: 'w-rives' })).toBeNull();
    expect(bodyDragTarget(d, { kind: 'hotTub', id: 'tub-1' })).toEqual({ kind: 'hotTub', id: 'tub-1' });
    expect(bodyDragTarget(d, { kind: 'steps', id: 'deck-1/steps/0' })).toEqual({ kind: 'steps', id: 'deck-1/steps/0' });
    expect(bodyDragTarget(d, null)).toBeNull();
  });

  it('hit-tests the selected element within the corridor', () => {
    expect(hitsSelection(d, { kind: 'wall', id: 'w-bad-s' }, [8.5, 3.02], 0.1)).toBe(true);
    expect(hitsSelection(d, { kind: 'wall', id: 'w-bad-s' }, [8.5, 3.12], 0.1)).toBe(false);
    expect(hitsSelection(d, { kind: 'wall', id: 'w-bad-s' }, [8.5, 3.12], 0.2)).toBe(true);
    expect(hitsSelection(d, { kind: 'blockEdge', id: 'a-sw' }, [5, -0.05], 0.1)).toBe(true);
    expect(hitsSelection(d, { kind: 'block', id: 'blk-a' }, [5, 5], 0.1)).toBe(true);
    expect(hitsSelection(d, { kind: 'block', id: 'blk-a' }, [12, 2], 0.1)).toBe(false);
    expect(hitsSelection(d, { kind: 'opening', id: 'd-bad' }, [7.02, 4.2], 0.1)).toBe(true);
    expect(hitsSelection(d, { kind: 'opening', id: 'd-bad' }, [7.02, 5.2], 0.1)).toBe(false);
    expect(hitsSelection(d, { kind: 'hotTub', id: 'tub-1' }, [14.5, -1.9], 0.1)).toBe(true);
    expect(hitsSelection(d, { kind: 'steps', id: 'deck-1/steps/0' }, [11.5, -3.5], 0.1)).toBe(true);
    expect(hitsSelection(d, { kind: 'deckEdge', id: 'deck-1-v1' }, [15.05, -1], 0.1)).toBe(true);
    expect(hitsSelection(d, { kind: 'deckVertex', id: 'deck-1-v0' }, [9.05, -3], 0.1)).toBe(true);
    expect(hitsSelection(d, { kind: 'tree', id: 'tree-1' }, [-3, 10], 0.1)).toBe(true);
    expect(hitsSelection(d, null, [0, 0], 1)).toBe(false);
  });

  it('hit-tests furniture footprints', () => {
    const item: DerivedFurniture = {
      id: 'f-1',
      item: { id: 'f-1', catalogId: 'seng-150', position: [2, 2], rotationDeg: 0, levelId: 'main', size: { w: 1.5, d: 2, h: 0.5 }, isNew: true },
      catalog: null,
      footprint: [
        [1.25, 1],
        [2.75, 1],
        [2.75, 3],
        [1.25, 3],
      ],
      bbox: { min: [1.25, 1], max: [2.75, 3] },
      levelId: 'main',
      floorZ: 0,
      z: 0,
      clearances: [],
      collisions: [],
      blocksDoors: [],
      needsDrain: false,
      isNew: true,
    };
    const withF = { ...d, furniture: [item] };
    expect(hitsSelection(withF, { kind: 'furniture', id: 'f-1' }, [2, 2], 0.1)).toBe(true);
    expect(hitsSelection(withF, { kind: 'furniture', id: 'f-1' }, [3.3, 2], 0.1)).toBe(false);
    expect(selectionBounds(withF, { kind: 'furniture', id: 'f-1' })).toEqual({ min: [1.25, 1], max: [2.75, 3] });
  });
});

describe('wallAt (Dør/vindu)', () => {
  it('finds a stored wall and the offset from its start', () => {
    const hit = wallAt(d.walls, [8.5, 3.04], 0.1)!;
    expect(hit.wall.id).toBe('w-bad-s');
    expect(hit.host).toEqual({ kind: 'wall', wallId: 'w-bad-s' });
    expect(hit.offset).toBeCloseTo(1.5, 9);
    expect(hit.point).toEqual([8.5, 3]);
  });

  it('finds a block edge and measures the offset along the edge', () => {
    const hit = wallAt(d.walls, [14.05, 1.5], 0.1)!;
    expect(hit.host).toEqual({ kind: 'blockEdge', blockId: 'blk-b', edgeId: 'b-se' });
    expect(hit.offset).toBeCloseTo(1.5, 9);
  });

  it('skips dividers and ghosts, and points away from every wall', () => {
    expect(wallAt(d.walls, [4, 3], 0.1)).toBeNull();
    expect(wallAt(d.walls, [0.8, 3.5], 0.1)).toBeNull();
    expect(wallAt(d.walls, [2, 2], 0.1)).toBeNull();
  });
});

describe('selectionBounds and ghost ids', () => {
  it('boxes rooms, walls, ghosts and outdoor elements', () => {
    const room = selectionBounds(d, { kind: 'room', id: 'rom-bad', levelId: 'main' })!;
    expect(room.min[0]).toBeGreaterThan(6.9);
    expect(room.max[1]).toBeLessThan(6);
    expect(selectionBounds(d, { kind: 'ghost', id: 'w-rives' })!.max[0]).toBeCloseTo(1.6, 9);
    expect(selectionBounds(d, { kind: 'ghost', id: 'win-old' })).not.toBeNull();
    const withGhost = { ...d, ghosts: [{ id: 'g-1', a: [0, 0] as [number, number], b: [0, 6] as [number, number] }] };
    expect(selectionBounds(withGhost, { kind: 'ghost', id: 'g-1' })).toEqual({ min: [0, 0], max: [0, 6] });
    const tub = selectionBounds(d, { kind: 'hotTub', id: 'tub-1' })!;
    expect([...tub.min, ...tub.max].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([13.2, -2.7, 14.8, -1.1]);
    expect(selectionBounds(d, { kind: 'deckEdge', id: 'deck-1-v0' })).toEqual({ min: [9, -3], max: [15, -3] });
    expect(selectionBounds(d, { kind: 'structure', id: 'chimney-1' })).toEqual({ min: [5, 1.2], max: [5.55, 1.75] });
    expect(selectionBounds(d, { kind: 'room', id: 'nope' })).toBeNull();
    expect(selectionBounds(d, null)).toBeNull();
  });

  it('identifies removed stored walls by their wall id', () => {
    const ghost = d.walls.find((w) => w.id === 'w-rives')!;
    expect(ghostIdOfWall(ghost)).toBe('w-rives');
    expect(wallsById(d.walls, 'a-sw').map((w) => w.id)).toEqual([PIECE_SW]);
    expect(wallsById(d.walls, 'w-bad-s').map((w) => w.id)).toEqual(['w-bad-s']);
  });
});

describe('openingCornerDimension ("Avstand fra hjørne")', () => {
  it('measures from the face of the nearer crossing wall to the near jamb', () => {
    // d-bad sits on w-bad-w (7, 2.95) → (7, 6) at 0.85..1.65; w-bad-s (y 2.95..3.05) meets it on the east side.
    const c = openingCornerDimension(d, 'd-bad')!;
    expect(c.side).toBe('right');
    expect(c.distance).toBeCloseTo(0.75, 9);
    expect(c.a[0]).toBeCloseTo(7.055, 9);
    expect(c.a[1]).toBeCloseTo(3.05, 9);
    expect(c.b[1]).toBeCloseTo(3.8, 9);
  });

  it('measures an exterior wall on the inside, from the inner face of the corner wall', () => {
    // win-stue on the south edge (0,0) → (10,0) at 1.4..2.6; the west wall's inner face is at x = 0.16.
    const c = openingCornerDimension(d, 'win-stue')!;
    expect(c.side).toBe('left');
    expect(c.distance).toBeCloseTo(1.24, 9);
    expect(c.a[0]).toBeCloseTo(0.16, 9);
    expect(c.b[0]).toBeCloseTo(1.4, 9);
    expect(c.a[1]).toBeGreaterThan(0.16);
  });

  it('is null for an unknown opening', () => {
    expect(openingCornerDimension(d, 'nope')).toBeNull();
  });
});

describe('tapSelection (second fix round: a placed unit could only be reselected through Egenskaper)', () => {
  const unitD = { ...d, blocks: d.blocks.map((b) => (b.block.id === 'blk-b' ? { ...b, block: { ...b.block, template: 'bod' } } : b)) };
  const ROOM = { kind: 'room' as const, id: 'rom-soverom', levelId: 'main' };

  it('a tap on the room of a unit made from a template selects the unit, the next tap the room, then the unit again', () => {
    expect(tapSelection(unitD, null, ROOM)).toEqual({ kind: 'block', id: 'blk-b' });
    expect(tapSelection(unitD, { kind: 'wall', id: 'w-bad-s' }, ROOM)).toEqual({ kind: 'block', id: 'blk-b' });
    expect(tapSelection(unitD, { kind: 'block', id: 'blk-b' }, ROOM)).toBe(ROOM);
    expect(tapSelection(unitD, ROOM, ROOM)).toEqual({ kind: 'block', id: 'blk-b' });
  });

  it('rooms of blocks without a template, of units holding several rooms, and everything else: as tapped', () => {
    expect(tapSelection(d, null, ROOM)).toBe(ROOM);
    const twoRooms = { ...unitD, rooms: unitD.rooms.map((r) => (r.id === 'rom-bad' ? { ...r, blockId: 'blk-b' } : r)) };
    expect(tapSelection(twoRooms, null, ROOM)).toBe(ROOM);
    expect(tapSelection(unitD, null, { kind: 'wall', id: 'w-bad-s' })).toEqual({ kind: 'wall', id: 'w-bad-s' });
    expect(tapSelection(unitD, null, null)).toBeNull();
  });
});
