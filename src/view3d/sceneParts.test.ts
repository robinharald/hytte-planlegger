/**
 * The 3D scene's group keys on the real Forslag D derive pipeline: a furniture edit or a deck edit must hand the
 * building group the same object (so its memoised component, and every wall and roof mesh, is left alone).
 */
import { describe, expect, it } from 'vitest';
import { deriveVariant } from '../geometry/derive';
import { FIXTURE_DERIVED } from './fixture';
import { createForslagD } from '../model/seed/forslagD';
import type { FurnitureItem, Variant } from '../model/types';
import { changedGroups, sameMembers, SCENE_GROUPS, sceneParts } from './sceneParts';

const project = createForslagD();
const base: Variant = project.variants[0];
const site = project.site;

const chair: FurnitureItem = { id: 'f-chair', catalogId: 'stol', position: [10, 3], rotationDeg: 0, levelId: 'main', size: { w: 0.5, d: 0.5, h: 0.9 }, isNew: true };

describe('sceneParts (group memo keys)', () => {
  const d0 = deriveVariant(base, site, null);
  const p0 = sceneParts(d0);

  it('keys each group on exactly the derived sub-objects it renders', () => {
    expect(p0.building.walls).toBe(d0.walls);
    expect(p0.building.roofs).toBe(d0.roofs);
    expect(p0.building.floors).toBe(d0.floors);
    expect(p0.outdoor.outdoor).toBe(d0.outdoor);
    expect(p0.outdoor.bounds).toBe(d0.bounds);
    expect(p0.furniture.furniture).toBe(d0.furniture);
    expect(p0.site.groundWorks).toBe(d0.groundWorks);
    expect(p0.levels.storeys).toBe(d0.storeys);
    expect(changedGroups(null, p0)).toEqual([...SCENE_GROUPS]);
  });

  it('reuses every group for the same derived model', () => {
    const again = sceneParts(d0, p0);
    expect(changedGroups(p0, again)).toEqual([]);
    expect(again.building).toBe(p0.building);
  });

  it('a furniture edit changes only the furniture group', () => {
    const d1 = deriveVariant({ ...base, furniture: [...base.furniture, chair] }, site, null);
    const p1 = sceneParts(d1, p0);
    expect(changedGroups(p0, p1)).toEqual(['furniture']);
    expect(p1.building).toBe(p0.building);
    expect(p1.outdoor).toBe(p0.outdoor);
    expect(p1.furniture.furniture.map((f) => f.id)).toContain('f-chair');
  });

  it('a deck edit changes the outdoor group but not the building (nor the furniture unless some stands on the deck)', () => {
    const deck = base.outdoor.decks[0];
    const moved = { ...deck, topHeight: deck.topHeight - 0.1 };
    const d2 = deriveVariant({ ...base, outdoor: { ...base.outdoor, decks: [moved, ...base.outdoor.decks.slice(1)] } }, site, null);
    const p2 = sceneParts(d2, p0);
    // The seed's outdoor lounge (revision 6) stands on the deck and goes down with it.
    expect(changedGroups(p0, p2)).toEqual(['outdoor', 'furniture']);
    expect(p2.building).toBe(p0.building);
    expect(p2.furniture.furniture.find((f) => f.id === 'fu-terrasse-1')?.floorZ).toBeCloseTo(deck.topHeight - 0.1, 9);
    // The furniture indoors is shared (the same derived objects).
    expect(p2.furniture.furniture.find((f) => f.id === 'fu-stue-2')).toBe(p0.furniture.furniture.find((f) => f.id === 'fu-stue-2'));
    // a hot-tub move too
    const tub = base.outdoor.hotTubs[0];
    const d3 = deriveVariant({ ...base, outdoor: { ...base.outdoor, hotTubs: [{ ...tub, centre: [tub.centre[0] + 1, tub.centre[1]] }] } }, site, null);
    expect(changedGroups(p0, sceneParts(d3, p0))).toEqual(['outdoor']);
  });

  it('a wall edit changes the building (and what depends on it), never reusing stale walls', () => {
    const wall = base.walls.find((w) => w.kind === 'interior')!;
    const walls = base.walls.map((w) => (w.id === wall.id ? { ...w, thickness: w.thickness + 0.02 } : w));
    const d4 = deriveVariant({ ...base, walls }, site, null);
    const p4 = sceneParts(d4, p0);
    const changed = changedGroups(p0, p4);
    expect(changed).toContain('building');
    expect(p4.building.walls).toBe(d4.walls);
    expect(p4.building.walls).not.toBe(p0.building.walls);
  });

  it('compares group objects member by member', () => {
    expect(sameMembers({ a: 1, b: FIXTURE_DERIVED.walls }, { a: 1, b: FIXTURE_DERIVED.walls })).toBe(true);
    expect(sameMembers({ a: 1, b: FIXTURE_DERIVED.walls }, { a: 1, b: [...FIXTURE_DERIVED.walls] })).toBe(false);
    expect(sameMembers({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});
