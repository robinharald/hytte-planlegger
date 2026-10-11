/** 1 m grid with darker 5 m lines, drawn only over the visible plan rectangle (two paths in total). */
import { memo, useMemo } from 'react';
import { gridPath, gridSteps } from '../svg';
import type { Rect } from '../viewport';
import { COLORS, NSS, STROKE } from '../style';

export const GridLayer = memo(function GridLayer({ rect, scale }: { rect: Rect; scale: number }) {
  const steps = gridSteps(scale);
  const fine = useMemo(() => (steps.fine ? gridPath(rect, 1, 5) : ''), [rect, steps.fine]);
  const coarse = useMemo(() => (steps.coarse ? gridPath(rect, 5) : ''), [rect, steps.coarse]);
  return (
    <g data-layer="grid" pointerEvents="none">
      {fine && <path d={fine} fill="none" stroke={COLORS.grid1} strokeWidth={STROKE.hair} {...NSS} />}
      {coarse && <path d={coarse} fill="none" stroke={COLORS.grid5} strokeWidth={STROKE.hair} {...NSS} />}
    </g>
  );
});
