/**
 * Terrain heights for the 3D view with the derived model's ground works.
 *
 * `DerivedVariant.groundWorks` is the list every terrain query must apply (the site's cuts plus the implicit
 * `gw-<blockId>` cut under every block, so the ground never rises into a floor). It is passed to geometry/terrain.ts
 * `terrainZAt` as its `extra` list; the site's own cuts are in both lists, which is harmless (a cut only lowers).
 */
import { terrainZAt } from '../geometry/terrain';
import type { GroundWork, Site, TerrainAsset } from '../model/types';

/** Terrain height (relative to the main floor) at a plan point, after the site's cuts and `groundWorks`. */
export function groundZFn(terrain: TerrainAsset | null, site: Site, groundWorks: GroundWork[]): (x: number, y: number) => number {
  return (x, y) => terrainZAt(terrain, site, x, y, groundWorks);
}
