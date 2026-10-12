/**
 * The 3D scene's groups and what each one is keyed on (pure; docs/phase2-plan.md §2 "memo split").
 *
 * derive.ts assembles the DerivedVariant from three memoised stages, so an edit of the furniture keeps every building
 * and outdoor array as the same instance, and an outdoor edit (decks, hot tubs) keeps the building's. The scene
 * mirrors that: each group gets one object holding exactly the derived sub-objects it renders, and `sceneParts`
 * hands back the PREVIOUS group object whenever all of its members are unchanged (===). The group components are
 * React.memo'd on that object, so a furniture or deck edit re-renders neither the walls nor the roofs (and rebuilds
 * no geometry), and a building edit leaves the furniture alone.
 *
 *  - building: blocks, walls (with their openings), roofs, floors (incl. ceilings), rooms, foundations, structure.
 *  - outdoor: decks, railings, steps, hot tubs (`derived.outdoor`) and `bounds` (the hot-tub step faces its centre).
 *  - furniture: `derived.furniture`.
 *  - site: terrain cuts (`groundWorks`), trees and water (`derived.site`), and the blocks (flat ground without terrain).
 *  - levels: `levels` + `storeys`, the visibility's input (visibility.ts).
 */
import type { DerivedVariant } from '../model/derived';

export interface BuildingParts {
  blocks: DerivedVariant['blocks'];
  walls: DerivedVariant['walls'];
  roofs: DerivedVariant['roofs'];
  floors: DerivedVariant['floors'];
  rooms: DerivedVariant['rooms'];
  foundations: DerivedVariant['foundations'];
  structure: DerivedVariant['structure'];
}

export interface OutdoorParts {
  outdoor: DerivedVariant['outdoor'];
  bounds: DerivedVariant['bounds'];
}

export interface FurnitureParts {
  furniture: DerivedVariant['furniture'];
}

export interface SiteParts {
  site: DerivedVariant['site'];
  groundWorks: DerivedVariant['groundWorks'];
  blocks: DerivedVariant['blocks'];
}

export interface LevelParts {
  levels: DerivedVariant['levels'];
  storeys: DerivedVariant['storeys'];
}

export interface SceneParts {
  building: BuildingParts;
  outdoor: OutdoorParts;
  furniture: FurnitureParts;
  site: SiteParts;
  levels: LevelParts;
}

export type SceneGroup = keyof SceneParts;

export const SCENE_GROUPS: readonly SceneGroup[] = ['building', 'outdoor', 'furniture', 'site', 'levels'];

function fresh(d: DerivedVariant): SceneParts {
  return {
    building: {
      blocks: d.blocks,
      walls: d.walls,
      roofs: d.roofs,
      floors: d.floors,
      rooms: d.rooms,
      foundations: d.foundations,
      structure: d.structure,
    },
    outdoor: { outdoor: d.outdoor, bounds: d.bounds },
    furniture: { furniture: d.furniture },
    site: { site: d.site, groundWorks: d.groundWorks, blocks: d.blocks },
    levels: { levels: d.levels, storeys: d.storeys },
  };
}

/** Same members (===) in both group objects. */
export function sameMembers(a: object, b: object): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** The scene's group objects for `derived`, reusing `prev`'s object for every group whose members are unchanged. */
export function sceneParts(derived: DerivedVariant, prev?: SceneParts | null): SceneParts {
  const next = fresh(derived);
  if (!prev) return next;
  return {
    building: sameMembers(prev.building, next.building) ? prev.building : next.building,
    outdoor: sameMembers(prev.outdoor, next.outdoor) ? prev.outdoor : next.outdoor,
    furniture: sameMembers(prev.furniture, next.furniture) ? prev.furniture : next.furniture,
    site: sameMembers(prev.site, next.site) ? prev.site : next.site,
    levels: sameMembers(prev.levels, next.levels) ? prev.levels : next.levels,
  };
}

/** Groups whose object changed between two `sceneParts` results (what the scene re-renders). */
export function changedGroups(prev: SceneParts | null, next: SceneParts): SceneGroup[] {
  if (!prev) return [...SCENE_GROUPS];
  return SCENE_GROUPS.filter((g) => prev[g] !== next[g]);
}
