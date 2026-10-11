/** Faint outlines of the walls of the storeys that are not shown (orientation help between Plan 1 and Hems). */
import { memo } from 'react';
import type { DerivedVariant } from '../../model/derived';
import { multiPolygonPath } from '../svg';
import { COLORS, NSS, STROKE } from '../style';

export const OtherStoreyLayer = memo(function OtherStoreyLayer({ unions }: { unions: DerivedVariant['wallUnion'] }) {
  return (
    <g data-layer="other-storeys" pointerEvents="none">
      {unions.map((u, i) => (
        <path key={`${u.storeyId}/${u.status}/${i}`} d={multiPolygonPath(u.polygons)} fill="none" fillRule="evenodd" stroke={COLORS.otherStorey} strokeWidth={STROKE.hair} {...NSS} />
      ))}
    </g>
  );
});
