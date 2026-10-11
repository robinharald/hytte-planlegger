/** Optional roof plan: outlines (with overhangs) and ridge lines, dashed. */
import { memo } from 'react';
import type { DerivedRoof } from '../../model/derived';
import { ringPath } from '../svg';
import { COLORS, NSS, STROKE } from '../style';

export const RoofPlanLayer = memo(function RoofPlanLayer({ roofs }: { roofs: DerivedRoof[] }) {
  return (
    <g data-layer="roof-plan" pointerEvents="none">
      {roofs.map((r) => (
        <g key={r.blockId}>
          <path d={ringPath(r.outline)} fill="none" stroke={COLORS.roofPlan} strokeWidth={STROKE.thin} strokeDasharray="8 4" {...NSS} />
          {r.ridge && <line x1={r.ridge.a[0]} y1={r.ridge.a[1]} x2={r.ridge.b[0]} y2={r.ridge.b[1]} stroke={COLORS.roofPlan} strokeWidth={STROKE.thin} strokeDasharray="12 4 2 4" {...NSS} />}
        </g>
      ))}
    </g>
  );
});
