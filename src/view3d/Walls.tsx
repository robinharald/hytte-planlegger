/**
 * Wall pieces: one mesh per derived wall (sub-prisms from geometryBuilders.buildWallPieces), rebuilt when the
 * wall or its cut height changes. Exterior pieces: dark board cladding on the outside (right) face and on the
 * reveals/ends, pine inside (left); interior and old-exterior walls: pine on both sides; cut tops in the cap
 * colour. Dividers and removed walls draw nothing. Selectable as { kind: 'wall', id }.
 */
import { memo, useMemo } from 'react';
import type { DerivedWall } from '../model/derived';
import { buildWallPieces } from './geometryBuilders';
import { getMaterials, materialSet } from './materials';
import { selectable, useGeometry } from './sceneUtils';
import { wallIsDrawn } from './visibility';
import type { Visibility } from './visibility';

export interface WallsProps {
  walls: DerivedWall[];
  vis: Visibility;
  highlightNew: boolean;
  /** Which walls this instance draws (exterior and interior walls live in different scene groups). */
  exterior: boolean;
}

export const Walls = memo(function Walls({ walls, vis, highlightNew, exterior }: WallsProps) {
  return (
    <group name={exterior ? 'exterior-walls' : 'interior-walls'}>
      {walls
        .filter((w) => w.isExterior === exterior && wallIsDrawn(w, vis))
        .map((w) => (
          <WallMesh key={w.id} wall={w} cutZ={vis.cutZFor(w)} highlightNew={highlightNew} />
        ))}
    </group>
  );
});

const WallMesh = memo(function WallMesh({ wall, cutZ, highlightNew }: { wall: DerivedWall; cutZ: number | null; highlightNew: boolean }) {
  const data = useMemo(() => buildWallPieces(wall, cutZ).data, [wall, cutZ]);
  const geometry = useGeometry(data);
  const set = materialSet(getMaterials(), wall.isNew, highlightNew);
  const materials = useMemo(
    () => (wall.isExterior ? [set.board, set.pine, set.board, set.cut] : [set.pine, set.pine, set.pine, set.cut]),
    [set, wall.isExterior],
  );
  if (!geometry) return null;
  return <mesh geometry={geometry} material={materials} castShadow receiveShadow userData={selectable({ kind: 'wall', id: wall.id })} />;
});
