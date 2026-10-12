/**
 * Furniture in 3D (docs/phase2-plan.md §4, phase 2b): every DerivedFurniture as its parametric model
 * (furnitureBuilders.ts) in the old model's materials (materials.ts FURNITURE_PALETTE). Replaces the phase-2a
 * placeholder boxes (FurnitureMeshes.tsx) with the same props, so Scene.tsx swaps one component for the other.
 *
 * - Each item is one group placed by `furnitureTransform` (its plan position at DerivedFurniture.z = floorZ +
 *   elevation, turned by rotationDeg) holding one merged solid mesh (one material group per slot) and, for shower
 *   walls, one glass mesh that casts no shadow. The geometry is built in the item's local frame and memoised on the
 *   catalogue id, the size and the clip height only, so moving or turning an item (and every edit of other items)
 *   reuses its geometry; identical items cost one small build each.
 * - Interior mode: items on hidden levels are not built; the rest are cut at the structure cut plane like the
 *   placeholder (`furnitureClip`).
 * - Pickable as { kind: 'furniture', id, levelId } (selection3d.furniturePick on the group): a click selects the
 *   item, and Scene's selection overlay highlights both meshes.
 * - Tint: red when the item collides with another (DerivedFurniture.collisions), else the orange "new" tint with
 *   "Vis hva som er nytt i 3D"; the item's `colour` replaces its model's colour slots.
 * - Catalogue data read from DerivedFurniture.catalog (loosely, it is the furniture/catalog.ts entry): the `model`
 *   key for ids the builders do not list, and the corner sofa's `seat`.
 */
import { memo, useMemo } from 'react';
import type { DerivedFurniture } from '../model/derived';
import { catalogModelHint, catalogSeat, emitFurnitureModel, furnitureClip, furnitureModel, furnitureTransform, parseFurnitureColour } from './furnitureBuilders';
import { FURNITURE_PALETTE, furnitureTint, getFurnitureGlass, getFurnitureMaterials } from './materials';
import { pickable, useGeometries } from './sceneUtils';
import { furniturePick } from './selection3d';
import type { Visibility } from './visibility';

export interface FurnitureProps {
  furniture: DerivedFurniture[];
  vis: Visibility;
  highlightNew: boolean;
}

export const Furniture = memo(function Furniture({ furniture, vis, highlightNew }: FurnitureProps) {
  return (
    <group name="furniture">
      {furniture
        .filter((f) => vis.isLevelVisible(f.levelId))
        .map((f) => (
          <FurnitureItem3D key={f.id} item={f} cutZ={vis.structureCutZ} highlightNew={highlightNew} />
        ))}
    </group>
  );
});

interface ItemProps {
  item: DerivedFurniture;
  cutZ: number | null;
  highlightNew: boolean;
}

const FurnitureItem3D = memo(function FurnitureItem3D({ item, cutZ, highlightNew }: ItemProps) {
  const { catalogId, size, colour } = item.item;
  const w = size?.w;
  const d = size?.d;
  const h = size?.h;
  const hint = catalogModelHint(item);
  const seat = catalogSeat(item);
  const model = useMemo(
    () => furnitureModel(catalogId, w !== undefined && d !== undefined && h !== undefined ? { w, d, h } : null, hint, { seat }),
    [catalogId, w, d, h, hint, seat],
  );
  const clip = furnitureClip(cutZ, item.z, model.top);
  const datas = useMemo(() => {
    const m = emitFurnitureModel(model, clip);
    return [m.solid, m.glass];
  }, [model, clip]);
  const [solid, glass] = useGeometries(datas);

  const tint = furnitureTint(item.isNew, highlightNew, item.collisions.length > 0);
  const hex = model.colourSlots.length ? parseFurnitureColour(colour, FURNITURE_PALETTE) : null;
  const materials = getFurnitureMaterials(tint, hex !== null ? { slots: model.colourSlots, hex } : null);
  const glassMaterial = getFurnitureGlass(tint);

  const { id, levelId } = item;
  const userData = useMemo(() => pickable(furniturePick({ id, levelId })), [id, levelId]);
  const t = furnitureTransform(item);
  if (!solid && !glass) return null;
  return (
    <group name={`furniture:${id}`} position={t.position} rotation-y={t.rotationY} userData={userData}>
      {solid && <mesh geometry={solid} material={materials} castShadow receiveShadow />}
      {glass && <mesh geometry={glass} material={glassMaterial} renderOrder={1} />}
    </group>
  );
});
