/**
 * Terrain sampling from the bundled heightmap asset (plan-aligned grids, metres above sea level) and conversion
 * to heights relative to the main floor with the site's ground works applied. Pure functions, no React/three.
 *
 * Rules (docs/architecture.md "Coordinate systems", types.ts `TerrainAsset`):
 *  - A point is sampled bilinearly from the FINEST grid covering it (smallest cell area dx·dy; ties keep the
 *    asset order, which is finest first by contract). A grid covers [x0, x0 + (nx−1)·dx] × [y0, y0 + (ny−1)·dy],
 *    boundary inclusive (1e-9 cell tolerance).
 *  - `terrainZAt` = sample − `site.floorElevation`, then every ground work containing the point (boundary inclusive)
 *    cuts it to at most its `maxZ` (cuts only, never fills; overlapping works → the lowest maxZ). Without terrain
 *    data at the point the height is −0.5 (TERRAIN_FALLBACK_Z) before the cuts.
 *
 * Decisions where the architecture is silent:
 *  - A grid whose four surrounding samples are not all finite (missing / NaN values, short `z` array) does not
 *    cover the point; the next finer-to-coarser grid is tried.
 *  - Grids with non-positive or non-finite spacing are ignored. A grid with nx = 1 (or ny = 1) covers only its
 *    single column (row) and is interpolated along the other axis.
 */
import type { Site, TerrainAsset, TerrainGrid } from '../model/types';
import { pointInPolygon } from './polygon';

/** Height (relative to the main floor) used where no terrain grid covers the point. */
export const TERRAIN_FALLBACK_Z = -0.5;

/** Tolerance (in cells) for "on the grid boundary". */
const COVER_TOL = 1e-9;

/** Bilinear sample of one grid (metres a.s.l.), or null when the grid does not cover the point. */
export function sampleGridAsl(g: TerrainGrid, x: number, y: number): number | null {
  if (!(g.dx > 0) || !(g.dy > 0) || !Number.isFinite(g.dx) || !Number.isFinite(g.dy)) return null;
  if (!(g.nx >= 1) || !(g.ny >= 1)) return null;
  const fi = axisParam((x - g.x0) / g.dx, g.nx);
  const fj = axisParam((y - g.y0) / g.dy, g.ny);
  if (fi === null || fj === null) return null;
  const at = (i: number, j: number): number => g.z[j * g.nx + i];
  const z00 = at(fi.i0, fj.i0);
  const z10 = at(fi.i1, fj.i0);
  const z01 = at(fi.i0, fj.i1);
  const z11 = at(fi.i1, fj.i1);
  if (![z00, z10, z01, z11].every((z) => typeof z === 'number' && Number.isFinite(z))) return null;
  const { t: tx } = fi;
  const { t: ty } = fj;
  return (1 - ty) * ((1 - tx) * z00 + tx * z10) + ty * ((1 - tx) * z01 + tx * z11);
}

/** Cell indices and fraction along one grid axis for the continuous index f, or null when outside. */
function axisParam(f: number, n: number): { i0: number; i1: number; t: number } | null {
  if (!Number.isFinite(f) || f < -COVER_TOL || f > n - 1 + COVER_TOL) return null;
  if (n === 1) return { i0: 0, i1: 0, t: 0 };
  const c = Math.min(Math.max(f, 0), n - 1);
  const i0 = Math.min(Math.floor(c), n - 2);
  return { i0, i1: i0 + 1, t: c - i0 };
}

/** Grids of an asset ordered finest first (stable), cached per asset object. */
const orderCache = new WeakMap<TerrainAsset, TerrainGrid[]>();

function gridsFinestFirst(terrain: TerrainAsset): TerrainGrid[] {
  let grids = orderCache.get(terrain);
  if (grids === undefined) {
    grids = terrain.grids
      .map((g, index) => ({ g, index, cell: Math.abs(g.dx * g.dy) }))
      .sort((a, b) => a.cell - b.cell || a.index - b.index)
      .map((e) => e.g);
    orderCache.set(terrain, grids);
  }
  return grids;
}

/** Terrain height in metres above sea level from the finest grid covering the point (bilinear), or null. */
export function sampleTerrainAsl(terrain: TerrainAsset, x: number, y: number): number | null {
  for (const g of gridsFinestFirst(terrain)) {
    const z = sampleGridAsl(g, x, y);
    if (z !== null) return z;
  }
  return null;
}

/** Applies the site's ground works (cuts) at a point to a height relative to the main floor. */
export function applyGroundWorks(site: Site, x: number, y: number, z: number): number {
  let out = z;
  for (const gw of site.groundWorks) {
    if (gw.maxZ < out && pointInPolygon([x, y], gw.polygon)) out = gw.maxZ;
  }
  return out;
}

/** Terrain height relative to the main floor after ground works; −0.5 (before cuts) where there is no terrain data. */
export function terrainZAt(terrain: TerrainAsset | null, site: Site, x: number, y: number): number {
  const asl = terrain === null ? null : sampleTerrainAsl(terrain, x, y);
  const z = asl === null ? TERRAIN_FALLBACK_Z : asl - site.floorElevation;
  return applyGroundWorks(site, x, y, z);
}
