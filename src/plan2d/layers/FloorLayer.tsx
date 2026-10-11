/** Floors tinted very lightly by material: slabs first, then room floors, then thresholds. */
import { memo } from 'react';
import type { DerivedFloor } from '../../model/derived';
import { polygonPath } from '../svg';
import { FLOOR_TINT } from '../style';

const ORDER: Record<DerivedFloor['kind'], number> = { slab: 0, room: 1, threshold: 2 };

export const FloorLayer = memo(function FloorLayer({ floors }: { floors: DerivedFloor[] }) {
  const sorted = [...floors].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  return (
    <g data-layer="floors" pointerEvents="none">
      {sorted.map((f) => (
        <path key={f.id} d={polygonPath(f.polygon, f.holes)} fill={FLOOR_TINT[f.material] ?? FLOOR_TINT.wood} fillRule="evenodd" data-floor-kind={f.kind} />
      ))}
    </g>
  );
});
