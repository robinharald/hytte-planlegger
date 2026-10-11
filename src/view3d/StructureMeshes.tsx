/**
 * Structure: posts, beams and stair treads in wood, the chimney in dark masonry with a grey cap (old model's
 * colours). In the interior mode everything is clipped at the structure cut plane (top visible level +
 * cutHeight), which also hides what belongs to storeys above. Selectable as { kind: 'structure', id }.
 */
import { memo, useMemo } from 'react';
import type { DerivedStructure } from '../model/derived';
import { buildStructure } from './geometryBuilders';
import { getMaterials, materialSet } from './materials';
import { selectable, useGeometry } from './sceneUtils';

export interface StructureMeshesProps {
  structure: DerivedStructure[];
  cutZ: number | null;
  highlightNew: boolean;
}

export const StructureMeshes = memo(function StructureMeshes({ structure, cutZ, highlightNew }: StructureMeshesProps) {
  return (
    <group name="structure">
      {structure.map((s) => (
        <StructureMesh key={s.id} element={s} cutZ={cutZ} highlightNew={highlightNew} />
      ))}
    </group>
  );
});

const StructureMesh = memo(function StructureMesh({ element, cutZ, highlightNew }: { element: DerivedStructure; cutZ: number | null; highlightNew: boolean }) {
  const data = useMemo(() => buildStructure(element, cutZ), [element, cutZ]);
  const geometry = useGeometry(data);
  const set = materialSet(getMaterials(), element.isNew, highlightNew);
  const materials = useMemo(() => [set.wood, set.chimney, set.chimneyCap], [set]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={materials} castShadow receiveShadow userData={selectable({ kind: 'structure', id: element.id })} />;
});
