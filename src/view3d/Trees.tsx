/**
 * Birches built exactly like the old model's trees: a white tapering trunk (r 0.07 → 0.13, 6 sides) and seven
 * thin dark branches whose length, height and direction follow the old formulas (a = k·2.3 + x). Placed at the
 * tree position on the terrain (`baseZ` from the derived site). Geometries are shared by all trees (trunks are a
 * unit-height cylinder scaled to the tree height) and live for the page. Pickable as { kind: 'tree', id }.
 */
import { memo } from 'react';
import { CylinderGeometry } from 'three';
import type { DerivedVariant } from '../model/derived';
import { toWorldTuple } from './coords';
import { getMaterials } from './materials';
import { pickable } from './sceneUtils';
import { treePick } from './selection3d';

const BRANCHES = 7;

/** Old model: branch length for branch k. */
function branchLength(k: number): number {
  return 0.9 + (((k * 37) % 10) / 10) * 1.3;
}

let shared: { trunk: CylinderGeometry; branches: CylinderGeometry[] } | null = null;
function geometries() {
  if (!shared) {
    shared = {
      trunk: new CylinderGeometry(0.07, 0.13, 1, 6),
      branches: Array.from({ length: BRANCHES }, (_, k) => new CylinderGeometry(0.015, 0.04, branchLength(k), 4)),
    };
  }
  return shared;
}

export interface TreesProps {
  trees: DerivedVariant['site']['trees'];
}

export const Trees = memo(function Trees({ trees }: TreesProps) {
  return (
    <group name="trees">
      {trees.map(({ tree, baseZ }) => (
        <Birch key={tree.id} id={tree.id} x={tree.position[0]} y={tree.position[1]} z={baseZ} h={tree.height} />
      ))}
    </group>
  );
});

const Birch = memo(function Birch({ id, x, y, z, h }: { id: string; x: number; y: number; z: number; h: number }) {
  if (!(h > 0)) return null;
  const g = geometries();
  const m = getMaterials();
  return (
    <group position={toWorldTuple(x, y, Number.isFinite(z) ? z : 0)} userData={pickable(treePick(id))}>
      <mesh geometry={g.trunk} material={m.trunk} position={[0, h / 2, 0]} scale={[1, h, 1]} castShadow />
      {g.branches.map((geo, k) => {
        const bl = branchLength(k);
        const a = k * 2.3 + x;
        const hy = h * (0.45 + k * 0.07);
        return (
          <mesh
            key={k}
            geometry={geo}
            material={m.branch}
            position={[Math.cos(a) * bl * 0.35, hy + bl * 0.35, Math.sin(a) * bl * 0.35]}
            rotation={[Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8]}
            castShadow
          />
        );
      })}
    </group>
  );
});
