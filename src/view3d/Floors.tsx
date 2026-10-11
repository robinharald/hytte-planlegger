/**
 * Floors: one mesh per DerivedFloor of a visible level — the polygon with holes, extruded by `thickness` when
 * > 0 (pine underside = the ceiling seen from below), UVs in metres, surface by FloorMaterial (pine boards, tiles,
 * sauna wood, concrete, deck boards). To keep coincident surfaces from z-fighting, room floors are lifted 6 mm
 * and thresholds 3 mm above the level (slabs are not), and extruded room floors stop 1 cm above the slab
 * underside. A zero-thickness room floor standing above its block's foundation top (the main floor next to the
 * lower bedroom zone) is filled down to it, so the step between the levels shows a riser instead of a void.
 * Room floors are selectable as { kind: 'room', id: roomId, levelId }.
 *
 * Flat ceilings (kind 'ceiling', `Block.ceilingHeight`): a thin pine slab (z = top of the board, `thickness` below
 * it) seen from below in the exterior mode, where the roofs are on and the interior is only seen through the
 * windows or from an eye-level preset; hidden in the interior mode, which looks down into the cut rooms.
 */
import { memo, useMemo } from 'react';
import type { DerivedFloor, DerivedFoundation, DerivedRoom } from '../model/derived';
import { buildFloor } from './geometryBuilders';
import { getMaterials, materialSet } from './materials';
import { selectable, useGeometry } from './sceneUtils';
import { floorIsDrawn } from './visibility';
import type { Visibility } from './visibility';

export interface FloorsProps {
  floors: DerivedFloor[];
  rooms: DerivedRoom[];
  foundations: DerivedFoundation[];
  vis: Visibility;
  highlightNew: boolean;
}

const LIFT: Record<DerivedFloor['kind'], number> = { room: 0.006, threshold: 0.003, slab: 0, ceiling: 0 };

/** Ceilings are drawn at least this thick (m), so a zero-thickness one still has a face seen from below. */
const MIN_CEILING_THICKNESS = 0.02;

export const Floors = memo(function Floors({ floors, rooms, foundations, vis, highlightNew }: FloorsProps) {
  const fillByRoom = useMemo(() => {
    const plinthTop = new Map(foundations.map((f) => [f.blockId, f.topZ]));
    const out = new Map<string, number>();
    for (const r of rooms) {
      const z = r.blockId !== undefined ? plinthTop.get(r.blockId) : undefined;
      if (z !== undefined) out.set(`${r.levelId}/${r.id}`, z);
    }
    return out;
  }, [rooms, foundations]);
  return (
    <group name="floors">
      {floors
        .filter((f) => floorIsDrawn(f, vis))
        .map((f) => (
          <FloorMesh
            key={f.id}
            floor={f}
            fillTo={f.kind === 'room' && f.roomId ? fillByRoom.get(`${f.levelId}/${f.roomId}`) : undefined}
            highlightNew={highlightNew}
          />
        ))}
    </group>
  );
});

const FloorMesh = memo(function FloorMesh({ floor, fillTo, highlightNew }: { floor: DerivedFloor; fillTo: number | undefined; highlightNew: boolean }) {
  const data = useMemo(() => {
    const f = floor.kind === 'ceiling' ? { ...floor, thickness: Math.max(floor.thickness, MIN_CEILING_THICKNESS) } : floor;
    return buildFloor(f, { lift: LIFT[floor.kind], bottomInset: floor.kind === 'room' || floor.kind === 'threshold' ? 0.01 : 0, fillTo });
  }, [floor, fillTo]);
  const geometry = useGeometry(data);
  const set = materialSet(getMaterials(), floor.isNew, highlightNew);
  const materials = useMemo(
    () => [floor.kind === 'ceiling' ? set.pine : (set.floor[floor.material] ?? set.floor.wood), set.pine],
    [set, floor.material, floor.kind],
  );
  if (!geometry) return null;
  const userData = floor.kind === 'room' && floor.roomId ? selectable({ kind: 'room', id: floor.roomId, levelId: floor.levelId }) : undefined;
  return <mesh geometry={geometry} material={materials} castShadow={floor.thickness > 0 || floor.kind === 'ceiling'} receiveShadow userData={userData} />;
});
