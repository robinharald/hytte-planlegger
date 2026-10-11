/**
 * Terrain and water.
 *
 * - One displaced grid per TerrainGrid (finest first). The finest grid (A) samples `terrainZAt` so the ground
 *   works (cuts) show; coarser grids (B, the horizon) sample `sampleTerrainAsl − floorElevation`, skip the cells
 *   lying inside the finer grids' extents and use a depth-offset material so A wins where they overlap at A's
 *   border. Grass texture (old model's grassTex), receives shadows; A also casts them.
 * - Water: one plane at waterZ (derived.site.waterZ, else site.waterLevel − floorElevation) + 2 cm over the
 *   coarsest grid's extent, in the old model's lake colour; the terrain hides it where it is higher.
 * - No terrain asset: a flat grass plane 2 cm below the lowest block ground level (like the old model's ground).
 *   `showTerrain` off: neither terrain, water nor the flat plane.
 */
import { memo, useMemo } from 'react';
import { sampleTerrainAsl, terrainZAt } from '../geometry/terrain';
import type { DerivedVariant } from '../model/derived';
import type { Site, TerrainAsset, Vec2 } from '../model/types';
import { buildHorizontalRect, buildTerrainGrid, gridsExtent } from './geometryBuilders';
import { getMaterials } from './materials';
import { useGeometry } from './sceneUtils';

export interface TerrainProps {
  terrain: TerrainAsset | null;
  site: Site;
  derived: Pick<DerivedVariant, 'site' | 'blocks' | 'bounds'>;
}

export const Terrain = memo(function Terrain({ terrain, site, derived }: TerrainProps) {
  const waterZ = derived.site.waterZ ?? (site.waterLevel !== undefined ? site.waterLevel - site.floorElevation : undefined);
  if (!terrain || terrain.grids.length === 0) {
    const groundZ = derived.blocks.length ? Math.min(...derived.blocks.map((b) => b.groundZ)) : -0.5;
    return <FlatGround bounds={derived.bounds} z={(Number.isFinite(groundZ) ? groundZ : -0.5) - 0.02} />;
  }
  return (
    <group name="terrain">
      {terrain.grids.map((_, i) => (
        <TerrainGridMesh key={i} terrain={terrain} index={i} site={site} />
      ))}
      {waterZ !== undefined && <Water terrain={terrain} z={waterZ} />}
    </group>
  );
});

const TerrainGridMesh = memo(function TerrainGridMesh({ terrain, index, site }: { terrain: TerrainAsset; index: number; site: Site }) {
  const data = useMemo(() => {
    const grid = terrain.grids[index];
    if (index === 0) return buildTerrainGrid(grid, (x, y) => terrainZAt(terrain, site, x, y));
    const finer = gridsExtent(terrain.grids.slice(0, index)) ?? undefined;
    return buildTerrainGrid(
      grid,
      (x, y, i, j) => (sampleTerrainAsl(terrain, x, y) ?? grid.z[j * grid.nx + i]) - site.floorElevation,
      finer,
    );
  }, [terrain, index, site]);
  const geometry = useGeometry(data);
  const m = getMaterials();
  if (!geometry) return null;
  return <mesh geometry={geometry} material={index === 0 ? m.grass : m.grassFar} receiveShadow castShadow={index === 0} />;
});

const Water = memo(function Water({ terrain, z }: { terrain: TerrainAsset; z: number }) {
  const data = useMemo(() => {
    const ex = gridsExtent(terrain.grids);
    return ex ? buildHorizontalRect(ex, z + 0.02) : null;
  }, [terrain, z]);
  const geometry = useGeometry(data);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={getMaterials().lake} receiveShadow />;
});

const FlatGround = memo(function FlatGround({ bounds, z }: { bounds: { min: Vec2; max: Vec2 }; z: number }) {
  const data = useMemo(() => {
    const cx = (bounds.min[0] + bounds.max[0]) / 2;
    const cy = (bounds.min[1] + bounds.max[1]) / 2;
    const ok = Number.isFinite(cx) && Number.isFinite(cy);
    const c: Vec2 = ok ? [cx, cy] : [0, 0];
    return buildHorizontalRect({ min: [c[0] - 250, c[1] - 250], max: [c[0] + 250, c[1] + 250] }, z);
  }, [bounds, z]);
  const geometry = useGeometry(data);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={getMaterials().grass} receiveShadow />;
});
