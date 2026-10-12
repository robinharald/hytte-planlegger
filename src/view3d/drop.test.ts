/** Drop raycast math on the 3D fixture: floors, decks and terrain under the pointer's camera ray. */
import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { terrainZAt } from '../geometry/terrain';
import type { Vec2, Vec3 } from '../model/types';
import { toWorld } from './coords';
import { DROP_FLOOR_KINDS, dropHit, dropSurfaces, ndcOf, planRayFromNdc, rayPlaneFromAbove } from './drop';
import type { PlanRay } from './drop';
import { FIXTURE_DERIVED, FIXTURE_SITE, FIXTURE_TERRAIN } from './fixture';
import { flatGroundZ, shownGroundFn } from './ground';
import { computeVisibility } from './visibility';

const ute = computeVisibility(FIXTURE_DERIVED, 'ute', 'ground', 1.3);
const inne = computeVisibility(FIXTURE_DERIVED, 'inne', 'ground', 1.3);
const surfacesUte = dropSurfaces(FIXTURE_DERIVED.floors, FIXTURE_DERIVED.outdoor.decks, ute);
const surfacesInne = dropSurfaces(FIXTURE_DERIVED.floors, FIXTURE_DERIVED.outdoor.decks, inne);
const terrainZ = (x: number, y: number) => terrainZAt(FIXTURE_TERRAIN, FIXTURE_SITE, x, y, FIXTURE_DERIVED.groundWorks);

/** Straight down from 20 m above a plan point. */
function down(p: Vec2): PlanRay {
  return { origin: [p[0], p[1], 20], dir: [0, 0, -1] };
}

function unit(v: Vec3): Vec3 {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}

describe('drop surfaces', () => {
  it('takes room floors, thresholds and slabs of visible levels plus the deck pieces, never ceilings', () => {
    expect(DROP_FLOOR_KINDS).not.toContain('ceiling');
    expect(surfacesUte.filter((s) => s.kind === 'floor').length).toBe(FIXTURE_DERIVED.floors.length);
    expect(surfacesUte.filter((s) => s.kind === 'deck').map((s) => s.id)).toEqual(['deck-1']);
    // the loft (room + slab) is hidden in the interior mode on the ground storey
    expect(surfacesInne.filter((s) => s.levelId === 'loft')).toEqual([]);
    const ceiling = { ...FIXTURE_DERIVED.floors[0], id: 'blk/ceiling', kind: 'ceiling' as const, z: 2.45 };
    expect(dropSurfaces([ceiling], [], ute)).toEqual([]);
  });
});

describe('dropHit', () => {
  it('lands on the room floor straight below', () => {
    const hit = dropHit(down([1.5, 1]), surfacesUte, terrainZ)!;
    expect(hit.surface).toBe('floor');
    expect(hit.id).toBe('rom-stue/floor');
    expect(hit.levelId).toBe('main');
    expect(hit.point[0]).toBeCloseTo(1.5, 9);
    expect(hit.point[1]).toBeCloseTo(1, 9);
    expect(hit.z).toBe(0);
    expect(hit.t).toBeCloseTo(20, 9);
  });

  it('takes the nearest surface: the loft over the bedroom in the exterior mode, the bedroom inside', () => {
    expect(dropHit(down([5, 3]), surfacesUte, terrainZ)).toMatchObject({ surface: 'floor', levelId: 'loft', z: 1.47 });
    expect(dropHit(down([5, 3]), surfacesInne, terrainZ)).toMatchObject({ surface: 'floor', id: 'rom-sov/floor', levelId: 'main', z: 0 });
  });

  it('lands on the deck, and on the terrain outside the building', () => {
    expect(dropHit(down([1, -1.5]), surfacesUte, terrainZ)).toMatchObject({ surface: 'deck', id: 'deck-1', z: 0 });
    const hit = dropHit(down([12, 8]), surfacesUte, terrainZ)!;
    expect(hit.surface).toBe('terrain');
    expect(hit.point[0]).toBeCloseTo(12, 6);
    expect(hit.point[1]).toBeCloseTo(8, 6);
    expect(hit.z).toBeCloseTo(terrainZ(12, 8), 4);
    expect(hit.t).toBeCloseTo(20 - terrainZ(12, 8), 4);
    expect(hit.id).toBeUndefined();
  });

  it('follows a slanted ray onto the floor it reaches first', () => {
    // from the south, 6 m up, aiming at the kitchen floor (2, 3, 0): the ray passes over the deck and the stue
    const origin: Vec3 = [2, -9, 6];
    const dir = unit([0, 12, -6]);
    const hit = dropHit({ origin, dir }, surfacesUte, terrainZ)!;
    expect(hit.surface).toBe('floor');
    expect(hit.id).toBe('rom-kjokken/floor');
    expect(hit.point[0]).toBeCloseTo(2, 9);
    expect(hit.point[1]).toBeCloseTo(3, 9);
  });

  it('looks through a hole in a surface to what lies below', () => {
    const hole = { kind: 'floor' as const, id: 'with-hole', levelId: 'main', z: 1, ring: [[0, 0], [4, 0], [4, 4], [0, 4]] as Vec2[], holes: [[[1, 1], [3, 1], [3, 3], [1, 3]]] as Vec2[][] };
    const under = { kind: 'floor' as const, id: 'under', levelId: 'lower', z: -1, ring: [[0, 0], [4, 0], [4, 4], [0, 4]] as Vec2[], holes: [] };
    expect(dropHit(down([2, 2]), [hole, under], null)?.id).toBe('under');
    expect(dropHit(down([0.5, 0.5]), [hole, under], null)?.id).toBe('with-hole');
  });

  it('misses when the ray goes up or nothing is below, and never hits a floor from underneath', () => {
    expect(dropHit({ origin: [1, 1, 5], dir: [0, 0, 1] }, surfacesUte, null)).toBeNull();
    expect(dropHit(down([50, 50]), surfacesUte, null)).toBeNull();
    expect(rayPlaneFromAbove({ origin: [1, 1, -2], dir: [0, 0, -1] }, 0)).toBeNull();
    expect(rayPlaneFromAbove({ origin: [1, 1, -2], dir: [0, 0, 1] }, 0)).toBeNull();
    expect(rayPlaneFromAbove({ origin: [1, 1, 3], dir: unit([1, 0, -1]) }, 0)).toBeCloseTo(3 * Math.SQRT2, 9);
  });

  it('uses the flat ground without a terrain asset and nothing when the terrain is off', () => {
    const flat = shownGroundFn(null, FIXTURE_SITE, [], FIXTURE_DERIVED.blocks, true)!;
    expect(flat(100, 100)).toBeCloseTo(flatGroundZ(FIXTURE_DERIVED.blocks), 9);
    expect(flatGroundZ(FIXTURE_DERIVED.blocks)).toBeCloseTo(-0.62, 9);
    expect(dropHit(down([30, 30]), [], flat)).toMatchObject({ surface: 'terrain', z: -0.62 });
    expect(shownGroundFn(FIXTURE_TERRAIN, FIXTURE_SITE, [], FIXTURE_DERIVED.blocks, false)).toBeNull();
    expect(dropHit(down([30, 30]), [], null)).toBeNull();
  });
});

describe('camera ray', () => {
  it('maps a viewport point into NDC (null outside the canvas)', () => {
    const rect = { left: 100, top: 50, width: 800, height: 600 };
    expect(ndcOf(500, 350, rect)).toEqual({ x: 0, y: 0 });
    expect(ndcOf(100, 50, rect)).toEqual({ x: -1, y: 1 });
    expect(ndcOf(900, 650, rect)).toEqual({ x: 1, y: -1 });
    expect(ndcOf(99, 300, rect)).toBeNull();
    expect(ndcOf(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });

  it('builds the plan-frame ray of a perspective camera and drops through it onto the fixture', () => {
    const camera = new PerspectiveCamera(42, 4 / 3, 0.1, 1000);
    camera.position.copy(toWorld(3, -12, 14));
    camera.lookAt(toWorld(2, 1, 0));
    camera.updateMatrixWorld();
    const centre = planRayFromNdc(camera, 0, 0);
    expect(centre.origin[0]).toBeCloseTo(3, 6);
    expect(centre.origin[1]).toBeCloseTo(-12, 6);
    expect(centre.origin[2]).toBeCloseTo(14, 6);
    expect(Math.hypot(...centre.dir)).toBeCloseTo(1, 9);
    const hit = dropHit(centre, surfacesInne, terrainZ)!;
    expect(hit.surface).toBe('floor');
    expect(hit.id).toBe('rom-stue/floor');
    expect(hit.point[0]).toBeCloseTo(2, 6);
    expect(hit.point[1]).toBeCloseTo(1, 6);
    // the lower part of the screen looks nearer, onto the deck in front of the house
    const low = dropHit(planRayFromNdc(camera, 0, -0.3), surfacesInne, terrainZ)!;
    expect(low.surface).toBe('deck');
    expect(low.point[1]).toBeLessThan(-0.11);
  });
});
