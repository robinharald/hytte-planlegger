/**
 * Foundations: light-grey plinth prisms on the block's outer outline between bottomZ (ground − 0.3) and topZ
 * (lowest floor of the block). Where an exterior wall piece stands higher than the plinth top (the main floor
 * next to a lower floor zone), a plinth skirt fills the gap under that piece, so the cladding never floats.
 * Selectable as the block.
 */
import { memo, useMemo } from 'react';
import type { DerivedFoundation, DerivedVariant, DerivedWall } from '../model/derived';
import { buildFoundation } from './geometryBuilders';
import { getMaterials, materialSet } from './materials';
import { selectable, useGeometry } from './sceneUtils';

export interface FoundationsProps {
  foundations: DerivedFoundation[];
  walls: DerivedWall[];
  blocks: DerivedVariant['blocks'];
  highlightNew: boolean;
}

const NO_WALLS: DerivedWall[] = [];

export const Foundations = memo(function Foundations({ foundations, walls, blocks, highlightNew }: FoundationsProps) {
  const skirtsByBlock = useMemo(() => {
    const map = new Map<string, DerivedWall[]>();
    for (const w of walls) {
      if (!w.isExterior || w.isDivider || w.status === 'removed' || w.source.kind !== 'blockEdge') continue;
      const list = map.get(w.source.blockId) ?? [];
      list.push(w);
      map.set(w.source.blockId, list);
    }
    return map;
  }, [walls]);
  return (
    <group name="foundations">
      {foundations.map((f) => (
        <FoundationMesh
          key={f.blockId}
          foundation={f}
          skirts={skirtsByBlock.get(f.blockId) ?? NO_WALLS}
          isNew={blocks.find((b) => b.block.id === f.blockId)?.block.isNew ?? false}
          highlightNew={highlightNew}
        />
      ))}
    </group>
  );
});

interface FoundationMeshProps {
  foundation: DerivedFoundation;
  skirts: DerivedWall[];
  isNew: boolean;
  highlightNew: boolean;
}

const FoundationMesh = memo(function FoundationMesh({ foundation, skirts, isNew, highlightNew }: FoundationMeshProps) {
  const data = useMemo(() => buildFoundation(foundation, skirts), [foundation, skirts]);
  const geometry = useGeometry(data);
  const set = materialSet(getMaterials(), isNew, highlightNew);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={set.plinth} castShadow receiveShadow userData={selectable({ kind: 'block', id: foundation.blockId })} />;
});
