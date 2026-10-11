/**
 * Floors tinted very lightly by material only (slabs first, then room floors, then thresholds); new floors get
 * the orange "new" tint only when "Marker det som er nytt" is on (drawing.ts `floorFill`).
 */
import { memo } from 'react';
import type { DerivedFloor } from '../../model/derived';
import { floorFill } from '../drawing';
import { polygonPath } from '../svg';

const ORDER: Record<DerivedFloor['kind'], number> = { slab: 0, room: 1, threshold: 2, ceiling: 3 };

export const FloorLayer = memo(function FloorLayer({ floors, highlightNew = false }: { floors: DerivedFloor[]; highlightNew?: boolean }) {
  const sorted = [...floors].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  return (
    <g data-layer="floors" pointerEvents="none">
      {sorted.map((f) => (
        <path key={f.id} d={polygonPath(f.polygon, f.holes)} fill={floorFill(f.material, f.isNew, highlightNew)} fillRule="evenodd" data-floor-kind={f.kind} data-floor-id={f.id} />
      ))}
    </g>
  );
});
