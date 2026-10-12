/**
 * Terrain heights for the 3D view with the derived model's ground works.
 *
 * `DerivedVariant.groundWorks` is the list every terrain query must apply (the site's cuts plus the implicit
 * `gw-<blockId>` cut under every block, so the ground never rises into a floor). It is passed to geometry/terrain.ts
 * `terrainZAt` as its `extra` list; the site's own cuts are in both lists, which is harmless (a cut only lowers).
 */
import { terrainZAt } from '../geometry/terrain';
import type { DerivedBlock } from '../model/derived';
import type { GroundWork, Site, TerrainAsset, Vec2 } from '../model/types';

/** Terrain height (relative to the main floor) at a plan point, after the site's cuts and `groundWorks`. */
export function groundZFn(terrain: TerrainAsset | null, site: Site, groundWorks: GroundWork[]): (x: number, y: number) => number {
  return (x, y) => terrainZAt(terrain, site, x, y, groundWorks);
}

/** Height of the flat ground drawn without a terrain asset: 2 cm below the lowest block ground level (−0.5 without blocks). */
export function flatGroundZ(blocks: Pick<DerivedBlock, 'groundZ'>[]): number {
  const z = blocks.length ? Math.min(...blocks.map((b) => b.groundZ)) : -0.5;
  return (Number.isFinite(z) ? z : -0.5) - 0.02;
}

/** Centre of the blocks' outer outlines (the flat ground is centred there), [0, 0] without blocks. */
export function blocksCentre(blocks: Pick<DerivedBlock, 'outer'>[]): Vec2 {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of blocks) {
    for (const [x, y] of b.outer) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return Number.isFinite(x0) && Number.isFinite(x1) ? [(x0 + x1) / 2, (y0 + y1) / 2] : [0, 0];
}

/**
 * The ground the 3D view shows, as a height function: the terrain asset with the ground works, the flat ground
 * without an asset, or null when the terrain is switched off.
 */
export function shownGroundFn(
  terrain: TerrainAsset | null,
  site: Site,
  groundWorks: GroundWork[],
  blocks: Pick<DerivedBlock, 'groundZ'>[],
  showTerrain: boolean,
): ((x: number, y: number) => number) | null {
  if (!showTerrain) return null;
  if (terrain && terrain.grids.length > 0) return groundZFn(terrain, site, groundWorks);
  const z = flatGroundZ(blocks);
  return () => z;
}
