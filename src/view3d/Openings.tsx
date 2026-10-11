/**
 * Windows and doors: frame boxes, glass plane with mullion bars, closed door leaves coloured by `leafColour`, and
 * the sage surround on exterior walls (geometryBuilders.buildOpening). Glass is a separate, double-sided mesh that
 * casts no shadow: dark exterior glass (#27313a, 35 %) in exterior walls, light pane (0x9cc3dd, 45 %) inside.
 * Removed and frameless openings draw nothing (the wall builder already leaves frameless holes open and fills
 * removed ones). In the interior mode everything is clipped at the wall's cut plane. Selectable as
 * { kind: 'opening', id }.
 */
import { memo, useMemo } from 'react';
import type { DerivedOpening, DerivedWall } from '../model/derived';
import { buildOpening } from './geometryBuilders';
import { getMaterials, materialSet } from './materials';
import { selectable, useGeometries } from './sceneUtils';
import { wallIsDrawn } from './visibility';
import type { Visibility } from './visibility';

export interface OpeningsProps {
  walls: DerivedWall[];
  vis: Visibility;
  highlightNew: boolean;
  exterior: boolean;
}

export const Openings = memo(function Openings({ walls, vis, highlightNew, exterior }: OpeningsProps) {
  const items = walls
    .filter((w) => w.isExterior === exterior && wallIsDrawn(w, vis))
    .flatMap((w) => w.openings.filter((o) => o.status !== 'removed' && o.type !== 'opening').map((o) => ({ o, w })));
  return (
    <group name={exterior ? 'exterior-openings' : 'interior-openings'}>
      {items.map(({ o, w }) => (
        <OpeningMesh key={o.id} opening={o} wall={w} cutZ={vis.cutZFor(w)} highlightNew={highlightNew} />
      ))}
    </group>
  );
});

interface OpeningMeshProps {
  opening: DerivedOpening;
  wall: DerivedWall;
  cutZ: number | null;
  highlightNew: boolean;
}

const OpeningMesh = memo(function OpeningMesh({ opening, wall, cutZ, highlightNew }: OpeningMeshProps) {
  const datas = useMemo(() => {
    const b = buildOpening(opening, wall, cutZ);
    return [b.solid, b.glass];
  }, [opening, wall, cutZ]);
  const [solid, glass] = useGeometries(datas);
  const m = getMaterials();
  const set = materialSet(m, opening.isNew, highlightNew);
  const solidMaterials = useMemo(() => {
    const leaf = opening.leafColour === 'glass' ? set.frame[opening.frameColour] : set.leaf[opening.leafColour];
    return [set.frame[opening.frameColour], leaf, set.trim];
  }, [set, opening.frameColour, opening.leafColour]);
  const glassMaterial = wall.isExterior ? m.glassExterior : m.glassInterior;
  if (!solid && !glass) return null;
  return (
    <group userData={selectable({ kind: 'opening', id: opening.id })}>
      {solid && <mesh geometry={solid} material={solidMaterials} castShadow receiveShadow />}
      {glass && <mesh geometry={glass} material={glassMaterial} renderOrder={1} />}
    </group>
  );
});
