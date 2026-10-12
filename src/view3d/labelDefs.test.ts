import { describe, expect, it } from 'vitest';
import { FIXTURE_DERIVED } from './fixture';
import type { DerivedFloor } from '../model/derived';
import {
  blockAnchor,
  blockLabels,
  blockOwners,
  cameraInBlock,
  cameraInRoom,
  labelDensities,
  labelDensity,
  labelOrder,
  labelScore,
  MAX_LABELS,
  PIN_MARGIN,
  placeTag,
  PROBE_LIFT,
  pxPerMetre,
  roomLabels,
  selectionBlock,
  tagCandidates,
} from './labelDefs';
import { computeVisibility, floorIsDrawn, wallIsDrawn } from './visibility';

describe('label definitions', () => {
  it('labels the named rooms of the active storey above its cut plane', () => {
    const ground = roomLabels(FIXTURE_DERIVED, 'ground', 1.6);
    expect(ground.map((l) => l.title)).toEqual(['Stue', 'Kjøkken', 'Soverom']);
    expect(ground[0].detail).toBe('3,3 × 1,8 m · 6,0 m²');
    expect(ground[0].at[2]).toBeCloseTo(0 + 1.6 + 0.3, 9);
    expect(ground[2].isNew).toBe(true);
    expect(ground[0].weight).toBeCloseTo(3.28 * 1.84, 9);
    expect(ground[0].room?.zMin).toBe(0);
    expect(ground[0].room?.zMax).toBe(3);
    const loft = roomLabels(FIXTURE_DERIVED, 'loft', 1.6);
    expect(loft.map((l) => l.title)).toEqual(['Hems']);
    expect(loft[0].at[2]).toBeCloseTo(1.47 + 1.6 + 0.3, 9);
    expect(roomLabels(FIXTURE_DERIVED, 'nope', 1.6)).toEqual([]);
  });

  it('labels blocks above the roof with their BYA area', () => {
    const [b] = blockLabels(FIXTURE_DERIVED);
    expect(b.title).toBe('Hytta');
    expect(b.detail).toBe('25,6 m²');
    expect(b.at[0]).toBeCloseTo(3, 9);
    expect(b.at[1]).toBeCloseTo(2, 9);
    expect(b.at[2]).toBeCloseTo(3.2 + 0.31 + 0.6, 9);
    expect(b.weight).toBeCloseTo(25.64, 9);
    expect(b.room).toBeUndefined();
  });

  it('probes a block at 25 / 50 / 75 % of its ridge over the block, just above the roof top', () => {
    const [b] = blockLabels(FIXTURE_DERIVED);
    // the ridge runs on over the gable overhangs (x −0.35 … 6.35); the block's axis spans x 0 … 6
    const probes = [...b.block!.probes].sort((p, q) => p[0] - q[0]);
    expect(probes).toHaveLength(3);
    [1.5, 3, 4.5].forEach((x, i) => {
      expect(probes[i][0]).toBeCloseTo(x, 9);
      expect(probes[i][1]).toBeCloseTo(2, 9);
      expect(probes[i][2]).toBeCloseTo(3.2 + 0.31 + PROBE_LIFT, 9);
    });
    expect(b.block!.topZ).toBeCloseTo(3.51, 9);
    expect(cameraInBlock(b.block!, [3, 2, 1.5])).toBe(true);
    expect(cameraInBlock(b.block!, [3, 2, 4])).toBe(false); // above the roof
    expect(cameraInBlock(b.block!, [9, 2, 1.5])).toBe(false);
  });

  it('anchors a block tag over its visible probes, or hides it when none can be seen', () => {
    const [b] = blockLabels(FIXTURE_DERIVED);
    const p = b.block!.probes;
    expect(blockAnchor(b, [true, true, true])).toBe(b.at);
    expect(blockAnchor(b, [false, false, false])).toBeNull();
    const part = blockAnchor(b, [false, true, true])!;
    expect(part[0]).toBeCloseTo((p[1][0] + p[2][0]) / 2, 9);
    expect(part[1]).toBeCloseTo(2, 9);
    expect(part[2]).toBe(b.at[2]);
    expect(blockAnchor({ at: [1, 2, 3] }, [])).toEqual([1, 2, 3]); // no probes: the anchor itself
  });

  it('knows which block a hit object belongs to (roof, foundation, exterior walls and their openings)', () => {
    const owners = blockOwners(FIXTURE_DERIVED);
    const ext = FIXTURE_DERIVED.walls.find((w) => w.isExterior && w.openings.length > 0)!;
    const inner = FIXTURE_DERIVED.walls.find((w) => !w.isExterior && !w.isDivider)!;
    expect(selectionBlock({ kind: 'block', id: 'blk' }, owners)).toBe('blk');
    expect(selectionBlock({ kind: 'wall', id: ext.id }, owners)).toBe('blk');
    expect(selectionBlock({ kind: 'opening', id: ext.openings[0].id }, owners)).toBe('blk');
    expect(selectionBlock({ kind: 'wall', id: inner.id }, owners)).toBeNull();
    expect(selectionBlock({ kind: 'deck', id: 'x' }, owners)).toBeNull();
    expect(selectionBlock(null, owners)).toBeNull();
  });

  it('applies the plan density rule by pixels per metre', () => {
    expect(labelDensity(30)).toBe('full');
    expect(labelDensity(25)).toBe('full');
    expect(labelDensity(20)).toBe('name');
    expect(labelDensity(11.9)).toBe('none');
    const near = pxPerMetre(700, 42, 10);
    expect(near).toBeCloseTo(700 / (20 * Math.tan((21 * Math.PI) / 180)), 9);
    expect(pxPerMetre(700, 42, 0)).toBeGreaterThan(1e4);
  });

  it('shows at most 30 labels, nearest first by default, else in the given order', () => {
    const distances = Array.from({ length: 40 }, (_, i) => 40 - i * 0.5);
    const d = labelDensities(distances, 2000, 42);
    expect(d.filter((x) => x !== 'none').length).toBe(MAX_LABELS);
    expect(d[0]).toBe('none'); // the farthest
    expect(d[39]).not.toBe('none'); // the nearest
    const order = distances.map((_, i) => i); // farthest first
    const e = labelDensities(distances, 2000, 42, order);
    expect(e[0]).not.toBe('none');
    expect(e[39]).toBe('none');
  });

  it('always shows a pinned label in full, even far away and beyond the cap', () => {
    const distances = [500, 1, 2];
    const d = labelDensities(distances, 700, 42, [0, 1, 2], [true, false, false]);
    expect(d[0]).toBe('full');
    const many = Array.from({ length: 40 }, () => 5);
    const pinned = many.map((_, i) => i === 39);
    const order = many.map((_, i) => i);
    expect(labelDensities(many, 2000, 42, order, pinned)[39]).toBe('full');
  });
});

describe('label priority', () => {
  it('ranks by area, mildly weighted by distance', () => {
    expect(labelScore(24, 0)).toBe(24);
    expect(labelScore(24, 15)).toBeCloseTo(12, 9);
    expect(labelScore(-1, 3)).toBe(0);
    // a 24 m² living room 15 m away beats a 2.7 m² pantry 3 m away
    expect(labelOrder([2.66, 24.1], [3, 15])).toEqual([1, 0]);
    // equal areas: the nearer first; equal everything: the lower index
    expect(labelOrder([5, 5], [10, 4])).toEqual([1, 0]);
    expect(labelOrder([5, 5], [4, 4])).toEqual([0, 1]);
    // a much nearer room of similar size still wins
    expect(labelOrder([10, 12], [2, 40])).toEqual([0, 1]);
  });

  it('weights distance strongly for blocks, so the nearest block wins against a bigger one behind it', () => {
    // Forslag D from 'framsiden': the new wing (41.5 m², 19.6 m) in front of the main house (102.5 m², 30 m)
    expect(labelOrder([102.5, 41.5], [30, 19.6], [], [true, true])).toEqual([1, 0]);
    // … while rooms keep the mild rule (the big one wins)
    expect(labelOrder([102.5, 41.5], [30, 19.6])).toEqual([0, 1]);
    // from 'oversikt' (main 44.9 m, wing 38.6 m away) the main house still comes first
    expect(labelOrder([102.5, 41.5], [44.9, 38.6], [], [true, true])).toEqual([0, 1]);
    expect(labelScore(27, 3, true)).toBeCloseTo(1, 9);
    expect(labelScore(5, 0.2, true)).toBe(5); // at least 1 m
  });

  it('puts the camera room first whatever its size', () => {
    expect(labelOrder([24, 2, 10], [5, 30, 3], [false, true, false])).toEqual([1, 0, 2]);
  });

  it('tells whether the camera stands in a room (plan polygon, holes, floor-to-ceiling)', () => {
    const [stue] = roomLabels(FIXTURE_DERIVED, 'ground', 1.6);
    expect(cameraInRoom(stue, [1, 1, 1.55])).toBe(true);
    expect(cameraInRoom(stue, [1, 1, 3.5])).toBe(false); // above the room
    expect(cameraInRoom(stue, [1, 1, -0.5])).toBe(false); // below its floor
    expect(cameraInRoom(stue, [5, 1, 1.55])).toBe(false); // in the bedroom
    const holed = { room: { ...stue.room!, holes: [[[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5]] as [number, number][]] } };
    expect(cameraInRoom(holed, [1, 1, 1.55])).toBe(false);
    const [block] = blockLabels(FIXTURE_DERIVED);
    expect(cameraInRoom(block, [3, 2, 1.55])).toBe(false);
  });
});

describe('placeTag', () => {
  const layer = { width: 800, height: 600 };
  const size = { w: 100, h: 30 };

  it('puts the bottom centre of the tag on the anchor', () => {
    expect(placeTag({ x: 400, y: 300 }, size, layer)).toEqual({ x0: 350, x1: 450, y0: 270, y1: 300 });
  });

  it('hides a tag unless its whole rectangle fits inside the layer', () => {
    expect(placeTag({ x: 40, y: 300 }, size, layer)).toBeNull(); // would stick out on the left
    expect(placeTag({ x: 770, y: 300 }, size, layer)).toBeNull(); // right
    expect(placeTag({ x: 400, y: 20 }, size, layer)).toBeNull(); // top
    expect(placeTag({ x: 400, y: 601 }, size, layer)).toBeNull(); // bottom
    expect(placeTag(null, size, layer)).toBeNull(); // behind the camera / occluded
    expect(placeTag({ x: 50, y: 30 }, size, layer)).not.toBeNull(); // exactly fits
  });

  it('clamps the camera room tag into the layer, or pins it to the bottom-right corner', () => {
    expect(placeTag({ x: 20, y: 10 }, size, layer, true)).toEqual({ x0: 0, x1: 100, y0: 0, y1: 30 });
    expect(placeTag({ x: 790, y: 590 }, size, layer, true)).toEqual({ x0: 700, x1: 800, y0: 560, y1: 590 });
    const corner = { x0: 800 - PIN_MARGIN - 100, x1: 800 - PIN_MARGIN, y0: 600 - PIN_MARGIN - 30, y1: 600 - PIN_MARGIN };
    expect(placeTag(null, size, layer, true)).toEqual(corner);
    expect(placeTag({ x: -300, y: 200 }, size, layer, true)).toEqual(corner);
  });

  it('moves a pinned tag up above a reserved rectangle (the hint in a narrow pane)', () => {
    const narrow = { width: 300, height: 600 };
    const wide = { w: 150, h: 30 };
    const hint = { x0: 10, x1: 205, y0: 566, y1: 590 };
    expect(placeTag(null, wide, narrow, true)).toEqual({ x0: 138, x1: 288, y0: 558, y1: 588 });
    expect(placeTag(null, wide, narrow, true, [hint])).toEqual({ x0: 138, x1: 288, y0: 534, y1: 564 });
    // clear of it in a wide pane: stays in the corner
    expect(placeTag(null, size, layer, true, [hint])).toEqual({ x0: 688, x1: 788, y0: 558, y1: 588 });
  });

  it('hides a tag that would overlap a taken rectangle, unless a nudged position is free', () => {
    const first = placeTag({ x: 400, y: 300 }, size, layer)!;
    expect(placeTag({ x: 500, y: 300 }, size, layer, false, [first])).toBeNull();
    // nudged 8 px to the right
    expect(placeTag({ x: 500, y: 300 }, size, layer, false, [first], true)).toEqual({ x0: 458, x1: 558, y0: 270, y1: 300 });
    // almost on top of it: no sideways nudge helps, one tag higher still touches, two tags higher is free
    expect(placeTag({ x: 410, y: 305 }, size, layer, false, [first], true)).toEqual({ x0: 360, x1: 460, y0: 211, y1: 241 });
    // … unless that leaves the layer: then below the anchor
    const top = placeTag({ x: 400, y: 70 }, size, layer)!;
    expect(placeTag({ x: 410, y: 75 }, size, layer, false, [top], true)).toEqual({ x0: 360, x1: 460, y0: 77, y1: 107 });
    // the candidates: on the anchor, ±8 / ±16 px, then the same one and two tags higher, then below
    const c = tagCandidates({ x: 400, y: 300 }, size, true);
    expect(c).toHaveLength(20);
    expect(c.slice(0, 5).map((r) => r.x0 - 350)).toEqual([0, 8, -8, 16, -16]);
    expect(c[5]).toEqual({ x0: 350, x1: 450, y0: 238, y1: 268 });
    expect(c[10]).toEqual({ x0: 350, x1: 450, y0: 206, y1: 236 });
    expect(c[15]).toEqual({ x0: 350, x1: 450, y0: 302, y1: 332 });
    expect(tagCandidates({ x: 400, y: 300 }, size)).toEqual([first]);
  });
});

describe('wallIsDrawn', () => {
  it('skips dividers and walls of hidden storeys', () => {
    const ute = computeVisibility(FIXTURE_DERIVED, 'ute', 'ground', 1.6);
    const drawn = FIXTURE_DERIVED.walls.filter((w) => wallIsDrawn(w, ute)).map((w) => w.id);
    expect(drawn).not.toContain('w-div');
    expect(drawn.length).toBe(5);
    const hiddenLoft = computeVisibility(FIXTURE_DERIVED, 'inne', 'ground', 1.6);
    expect(wallIsDrawn({ ...FIXTURE_DERIVED.walls[4], levelId: 'loft', levelIds: ['loft'] }, hiddenLoft)).toBe(false);
    expect(wallIsDrawn({ ...FIXTURE_DERIVED.walls[0], status: 'removed' }, ute)).toBe(false);
    // a ghost is never drawn, whatever its status says
    expect(wallIsDrawn({ ...FIXTURE_DERIVED.walls[0], isGhost: true }, ute)).toBe(false);
  });
});

describe('floorIsDrawn', () => {
  const ceiling: DerivedFloor = { ...FIXTURE_DERIVED.floors[0], id: 'blk/ceiling', roomId: undefined, z: 2.4, thickness: 0.05, kind: 'ceiling' };

  it('draws flat ceilings in the exterior mode only', () => {
    expect(floorIsDrawn(ceiling, computeVisibility(FIXTURE_DERIVED, 'ute', 'ground', 1.6))).toBe(true);
    expect(floorIsDrawn(ceiling, computeVisibility(FIXTURE_DERIVED, 'inne', 'ground', 1.6))).toBe(false);
    expect(floorIsDrawn(ceiling, computeVisibility(FIXTURE_DERIVED, 'inne', 'loft', 1.6))).toBe(false);
  });

  it('draws floors of visible levels with a real polygon', () => {
    const inne = computeVisibility(FIXTURE_DERIVED, 'inne', 'ground', 1.6);
    expect(floorIsDrawn(FIXTURE_DERIVED.floors[0], inne)).toBe(true);
    expect(floorIsDrawn(FIXTURE_DERIVED.floors[3], inne)).toBe(false); // loft room
    expect(floorIsDrawn({ ...FIXTURE_DERIVED.floors[0], polygon: [[0, 0], [1, 0]] }, inne)).toBe(false);
  });
});
