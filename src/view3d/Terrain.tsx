/**
 * Terrain and water.
 *
 * - One displaced grid per TerrainGrid (finest first). The finest grid (A) samples the terrain with the derived
 *   model's ground works (`derived.groundWorks` through ground.ts — the site's cuts plus the implicit ones under the
 *   blocks), so the ground never rises into a floor; where there are cuts, A is replaced by a fine patch
 *   (geometryBuilders.terrainPatch, ≤ 0.25 m cells) so a cut's edge is not smeared over a 2 m cell. Coarser grids
 *   (B, the horizon) sample `sampleTerrainAsl − floorElevation`, skip the cells lying inside the finer grids'
 *   extents and use a depth-offset material so A wins where they overlap at A's border. Grass texture (old model's
 *   grassTex), receives shadows; A and the patch also cast them. The ground works are compared by value, so a new
 *   derived model with the same cuts does not rebuild the terrain.
 * - Water: one plane at waterZ (derived.site.waterZ, else site.waterLevel − floorElevation) + 2 cm over the
 *   coarsest grid's extent, in the old model's lake colour; the terrain hides it where it is higher.
 * - No terrain asset: a flat grass plane 2 cm below the lowest block ground level (like the old model's ground),
 *   500 m square round the blocks' centre.
 *   `showTerrain` off: neither terrain, water nor the flat plane.
 */
import { memo, useMemo } from 'react';
import { sampleTerrainAsl } from '../geometry/terrain';
import type { DerivedVariant } from '../model/derived';
import type { GroundWork, Site, TerrainAsset, Vec2 } from '../model/types';
import { buildHorizontalRect, buildTerrainGrid, gridsExtent, terrainPatch } from './geometryBuilders';
import { blocksCentre, flatGroundZ, groundZFn } from './ground';
import { getMaterials } from './materials';
import { useGeometries, useGeometry } from './sceneUtils';

export interface TerrainProps {
  terrain: TerrainAsset | null;
  site: Site;
  /** Only these parts are read, so deck and furniture edits leave the terrain alone. */
  derived: Pick<DerivedVariant, 'site' | 'blocks' | 'groundWorks'>;
}

export const Terrain = memo(function Terrain({ terrain, site, derived }: TerrainProps) {
  const worksKey = JSON.stringify(derived.groundWorks ?? []);
  const works = useMemo(() => JSON.parse(worksKey) as GroundWork[], [worksKey]);
  const waterZ = derived.site.waterZ ?? (site.waterLevel !== undefined ? site.waterLevel - site.floorElevation : undefined);
  if (!terrain || terrain.grids.length === 0) {
    return <FlatGround centre={blocksCentre(derived.blocks)} z={flatGroundZ(derived.blocks)} />;
  }
  return (
    <group name="terrain">
      {terrain.grids.map((_, i) => (
        <TerrainGridMesh key={i} terrain={terrain} index={i} site={site} works={works} />
      ))}
      {waterZ !== undefined && <Water terrain={terrain} z={waterZ} />}
    </group>
  );
});

interface TerrainGridMeshProps {
  terrain: TerrainAsset;
  index: number;
  site: Site;
  works: GroundWork[];
}

const TerrainGridMesh = memo(function TerrainGridMesh({ terrain, index, site, works }: TerrainGridMeshProps) {
  const datas = useMemo(() => {
    const grid = terrain.grids[index];
    if (index === 0) {
      const zAt = groundZFn(terrain, site, works);
      const patch = terrainPatch(grid, works.map((w) => w.polygon));
      return [buildTerrainGrid(grid, zAt, patch?.extent), patch ? buildTerrainGrid(patch.grid, zAt) : null];
    }
    const finer = gridsExtent(terrain.grids.slice(0, index)) ?? undefined;
    return [
      buildTerrainGrid(grid, (x, y, i, j) => (sampleTerrainAsl(terrain, x, y) ?? grid.z[j * grid.nx + i]) - site.floorElevation, finer),
      null,
    ];
  }, [terrain, index, site, works]);
  const [geometry, patch] = useGeometries(datas);
  const m = getMaterials();
  return (
    <>
      {geometry && <mesh geometry={geometry} material={index === 0 ? m.grass : m.grassFar} receiveShadow castShadow={index === 0} />}
      {patch && <mesh name="terrain-patch" geometry={patch} material={m.grass} receiveShadow castShadow />}
    </>
  );
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

const FlatGround = memo(function FlatGround({ centre, z }: { centre: Vec2; z: number }) {
  const [cx, cy] = centre;
  const data = useMemo(() => buildHorizontalRect({ min: [cx - 250, cy - 250], max: [cx + 250, cy + 250] }, z), [cx, cy, z]);
  const geometry = useGeometry(data);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={getMaterials().grass} receiveShadow />;
});
