/**
 * Roofs: one prism per RoofSlope (top polygon, −thickness vertically, side faces; turf on top and sides, dark
 * soffit below), sage trims (barge boards, fascias) and a turf ridge roll. Metal / shingle roofs use plain
 * colours. Slopes tint individually for "new" (they are split at part boundaries). Hidden in the interior mode
 * (the caller does not mount them). Selectable as the block: { kind: 'block', id: blockId }.
 */
import { memo, useMemo } from 'react';
import type { DerivedRoof, RoofSlope } from '../model/derived';
import { buildRoofSlope, buildRoofTrims } from './geometryBuilders';
import { getMaterials, materialSet, roofSurface } from './materials';
import { selectable, useGeometry } from './sceneUtils';

export interface RoofsProps {
  roofs: DerivedRoof[];
  highlightNew: boolean;
}

export const Roofs = memo(function Roofs({ roofs, highlightNew }: RoofsProps) {
  return (
    <group name="roofs">
      {roofs.map((r) => (
        <group key={r.blockId} userData={selectable({ kind: 'block', id: r.blockId })}>
          {r.slopes.map((s, i) => (
            <SlopeMesh key={i} slope={s} roof={r} highlightNew={highlightNew} />
          ))}
          <TrimMesh roof={r} highlightNew={highlightNew} />
        </group>
      ))}
    </group>
  );
});

const SlopeMesh = memo(function SlopeMesh({ slope, roof, highlightNew }: { slope: RoofSlope; roof: DerivedRoof; highlightNew: boolean }) {
  const data = useMemo(() => buildRoofSlope(slope, roof.thickness), [slope, roof.thickness]);
  const geometry = useGeometry(data);
  const set = materialSet(getMaterials(), slope.isNew, highlightNew);
  const materials = useMemo(() => [roofSurface(set, roof.material), set.roofUnder], [set, roof.material]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={materials} castShadow receiveShadow />;
});

const TrimMesh = memo(function TrimMesh({ roof, highlightNew }: { roof: DerivedRoof; highlightNew: boolean }) {
  const data = useMemo(() => buildRoofTrims(roof), [roof]);
  const geometry = useGeometry(data);
  const isNew = roof.slopes.length > 0 && roof.slopes.every((s) => s.isNew);
  const set = materialSet(getMaterials(), isNew, highlightNew);
  const materials = useMemo(() => [set.trim, roofSurface(set, roof.material)], [set, roof.material]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={materials} castShadow receiveShadow />;
});
