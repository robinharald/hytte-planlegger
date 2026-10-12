/**
 * Furniture (placeholder until phase 2b's parametric models, docs/phase2-plan.md §4): one pine box per
 * DerivedFurniture — its plan footprint from the item's bottom z up by its stored height (geometryBuilders
 * .buildFurnitureBox). Items on levels hidden in the interior mode are not built; the rest are clipped at the
 * structure cut plane there. Tinted with "Marker det som er nytt" like everything else. Pickable as
 * { kind: 'furniture', id, levelId }.
 *
 * Lives in its own scene group (Scene.tsx), so a furniture edit never re-renders the building or the outdoor groups.
 */
import { memo, useMemo } from 'react';
import type { DerivedFurniture } from '../model/derived';
import { buildFurnitureBox } from './geometryBuilders';
import { getMaterials, materialSet } from './materials';
import { pickable, useGeometry } from './sceneUtils';
import { furniturePick } from './selection3d';
import type { Visibility } from './visibility';

export interface FurnitureMeshesProps {
  furniture: DerivedFurniture[];
  vis: Visibility;
  highlightNew: boolean;
}

export const FurnitureMeshes = memo(function FurnitureMeshes({ furniture, vis, highlightNew }: FurnitureMeshesProps) {
  return (
    <group name="furniture">
      {furniture
        .filter((f) => vis.isLevelVisible(f.levelId))
        .map((f) => (
          <FurnitureBox key={f.id} item={f} cutZ={vis.structureCutZ} highlightNew={highlightNew} />
        ))}
    </group>
  );
});

const FurnitureBox = memo(function FurnitureBox({ item, cutZ, highlightNew }: { item: DerivedFurniture; cutZ: number | null; highlightNew: boolean }) {
  const data = useMemo(() => buildFurnitureBox(item, cutZ), [item, cutZ]);
  const geometry = useGeometry(data);
  const set = materialSet(getMaterials(), item.isNew, highlightNew);
  const userData = useMemo(() => pickable(furniturePick(item)), [item]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={set.pine} castShadow receiveShadow userData={userData} />;
});
