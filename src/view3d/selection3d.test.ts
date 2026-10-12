import { describe, expect, it } from 'vitest';
import type { DerivedFloor } from '../model/derived';
import type { Selection } from '../state/selection';
import { FIXTURE_DERIVED, fixtureWall } from './fixture';
import {
  blockPick,
  CLICK_TOLERANCE_PX,
  clickTolerancePx,
  deckPick,
  floorPick,
  furniturePick,
  highlightMatches,
  isClick,
  matchesSelection,
  openingPick,
  railingPick,
  stepsPick,
  TOUCH_CLICK_TOLERANCE_PX,
  wallPick,
} from './selection3d';

const ctx = {
  openingIds: new Set(FIXTURE_DERIVED.walls.flatMap((w) => w.openings.map((o) => o.id))),
  blockIds: new Set(FIXTURE_DERIVED.blocks.map((b) => b.block.id)),
};

function floor(over: Partial<DerivedFloor>): DerivedFloor {
  return { id: 'f', levelId: 'main', polygon: [], holes: [], z: 0, thickness: 0, material: 'wood', isNew: false, kind: 'room', ...over };
}

describe('selection mapping (3D picks)', () => {
  it('picks an exterior wall piece as its block edge, a stored wall as the wall', () => {
    const south = fixtureWall('v-s');
    expect(wallPick(south).select).toEqual({ kind: 'blockEdge', id: 'v-s' });
    const inner = fixtureWall('w-int');
    expect(wallPick(inner).select).toEqual({ kind: 'wall', id: 'w-int', levelId: 'main' });
    expect(wallPick(inner).also ?? []).toEqual([]);
  });

  it('lights a piece up for its edge, its own piece id (the plan) and its block', () => {
    const south = wallPick(fixtureWall('v-s'));
    expect(highlightMatches(south, { kind: 'blockEdge', id: 'v-s' })).toBe(true);
    expect(highlightMatches(south, { kind: 'wall', id: 'blk/v-s/blk-rest/base', levelId: 'main' })).toBe(true);
    expect(highlightMatches(south, { kind: 'block', id: 'blk' })).toBe(true);
    expect(highlightMatches(south, { kind: 'blockEdge', id: 'v-e' })).toBe(false);
    expect(highlightMatches(south, { kind: 'wall', id: 'w-int' })).toBe(false);
    // every piece of one edge shares the edge selection
    const pieceA = wallPick({ id: 'blk/v-s/part-a/base', levelId: 'main', source: { kind: 'blockEdge', blockId: 'blk', edgeId: 'v-s', partId: 'part-a', zoneId: null, s0: 0, s1: 2 } });
    const pieceB = wallPick({ id: 'blk/v-s/part-b/base', levelId: 'main', source: { kind: 'blockEdge', blockId: 'blk', edgeId: 'v-s', partId: 'part-b', zoneId: null, s0: 2, s1: 6 } });
    const edge: Selection = { kind: 'blockEdge', id: 'v-s' };
    expect(highlightMatches(pieceA, edge) && highlightMatches(pieceB, edge)).toBe(true);
  });

  it('matches levels leniently, but not across different levels', () => {
    const inner = wallPick(fixtureWall('w-int'));
    expect(highlightMatches(inner, { kind: 'wall', id: 'w-int' })).toBe(true);
    expect(highlightMatches(inner, { kind: 'wall', id: 'w-int', levelId: 'main' })).toBe(true);
    expect(highlightMatches(inner, { kind: 'wall', id: 'w-int', levelId: 'loft' })).toBe(false);
    expect(matchesSelection({ kind: 'room', id: 'r' }, { kind: 'room', id: 'r', levelId: 'x' })).toBe(true);
    expect(highlightMatches(null, { kind: 'wall', id: 'w-int' })).toBe(false);
    expect(highlightMatches(inner, null)).toBe(false);
  });

  it('picks openings with their level', () => {
    const win = fixtureWall('v-s').openings.find((o) => o.id === 'win-s')!;
    expect(openingPick(win).select).toEqual({ kind: 'opening', id: 'win-s', levelId: 'main' });
  });

  it('picks room floors as the room, thresholds as their opening, ceilings as their block, slabs as nothing', () => {
    const stue = FIXTURE_DERIVED.floors.find((f) => f.roomId === 'rom-stue')!;
    expect(floorPick(stue, ctx).select).toEqual({ kind: 'room', id: 'rom-stue', levelId: 'main' });
    const threshold = FIXTURE_DERIVED.floors.find((f) => f.kind === 'threshold')!;
    expect(floorPick(threshold, ctx).select).toEqual({ kind: 'opening', id: 'door-int' });
    expect(floorPick(floor({ id: 'door-int/threshold/2', kind: 'threshold' }), ctx).select).toEqual({ kind: 'opening', id: 'door-int' });
    expect(floorPick(floor({ id: 'gone/threshold', kind: 'threshold' }), ctx).select).toBeNull();
    expect(floorPick(floor({ id: 'blk/ceiling', kind: 'ceiling' }), ctx).select).toEqual({ kind: 'block', id: 'blk' });
    expect(floorPick(floor({ id: 'other/ceiling', kind: 'ceiling' }), ctx).select).toBeNull();
    const slab = FIXTURE_DERIVED.floors.find((f) => f.kind === 'slab')!;
    expect(floorPick(slab, ctx).select).toBeNull();
    expect(floorPick(floor({ kind: 'room', roomId: undefined }), ctx).select).toBeNull();
  });

  it('picks the outdoor things and furniture by id; steps are their own kind, lit by their deck too', () => {
    const { decks, railings, steps } = FIXTURE_DERIVED.outdoor;
    expect(deckPick(decks[0]).select).toEqual({ kind: 'deck', id: 'deck-1' });
    expect(railingPick(railings[0]).select).toEqual({ kind: 'railing', id: 'deck-1/railing' });
    const st = stepsPick(steps[0]);
    expect(st.select).toEqual({ kind: 'steps', id: 'deck-1/steps/0' });
    expect(highlightMatches(st, { kind: 'deck', id: 'deck-1' })).toBe(true);
    expect(highlightMatches(st, { kind: 'railing', id: 'deck-1/railing' })).toBe(false);
    expect(blockPick('blk').select).toEqual({ kind: 'block', id: 'blk' });
    expect(furniturePick({ id: 'f1', levelId: 'main' }).select).toEqual({ kind: 'furniture', id: 'f1', levelId: 'main' });
  });
});

describe('click vs. orbit', () => {
  it('uses 5 px for mouse and pen, 10 px for touch', () => {
    expect(clickTolerancePx('mouse')).toBe(CLICK_TOLERANCE_PX);
    expect(clickTolerancePx('pen')).toBe(5);
    expect(clickTolerancePx(undefined)).toBe(5);
    expect(clickTolerancePx('touch')).toBe(TOUCH_CLICK_TOLERANCE_PX);
    expect(TOUCH_CLICK_TOLERANCE_PX).toBe(10);
  });

  it('counts a press as a click within the tolerance only', () => {
    const down = { x: 100, y: 100 };
    expect(isClick(down, { x: 103, y: 104 }, 'mouse')).toBe(true); // 5 px
    expect(isClick(down, { x: 106, y: 100 }, 'mouse')).toBe(false);
    expect(isClick(down, { x: 108, y: 100 }, 'touch')).toBe(true);
    expect(isClick(down, { x: 106, y: 108 }, 'touch')).toBe(true); // 10 px
    expect(isClick(down, { x: 111, y: 100 }, 'touch')).toBe(false);
  });
});
