/** Room hit areas (inner polygons with holes); the selected room gets a light accent fill (outline: SelectionLayer). */
import { memo } from 'react';
import type { DerivedRoom } from '../../model/derived';
import type { PlanSelection } from '../editTypes';
import { polygonPath } from '../svg';
import { isRoomSelected, selAttrs } from '../selection';
import { ACCENT } from '../style';

/** One room's hit area (memoised per room). */
const RoomHit = memo(function RoomHit({ r, sel }: { r: DerivedRoom; sel: boolean }) {
  return (
    <path
      d={polygonPath(r.polygon, r.holes)}
      fillRule="evenodd"
      fill={sel ? ACCENT : 'none'}
      fillOpacity={sel ? 0.12 : undefined}
      pointerEvents="fill"
      data-room-id={r.id}
      {...selAttrs('room', r.id, r.levelId)}
    />
  );
});

export const RoomLayer = memo(function RoomLayer({ rooms, selection }: { rooms: DerivedRoom[]; selection: PlanSelection | null }) {
  return (
    <g data-layer="rooms">
      {rooms.map((r) => (
        <RoomHit key={`${r.levelId}/${r.id}`} r={r} sel={isRoomSelected(selection, r)} />
      ))}
    </g>
  );
});
