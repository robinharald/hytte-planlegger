/**
 * Old places of moved existing block edges (`derived.ghosts`, docs/phase2-plan.md §3.4) as dashed grey lines on
 * the axis, drawn only while "highlight new" ("Vis hva som er nytt") is on, like the removed walls and openings.
 * Each one is selectable as { kind: 'ghost', id: VariantGhost.id } through an invisible corridor `corridorPx` wide
 * on screen (the properties panel offers "Ta tilbake"); the selected ghost is drawn in the accent colour.
 * Block-edge ghosts carry no storey, so they are drawn on every storey.
 */
import { memo } from 'react';
import type { DerivedVariant } from '../../model/derived';
import type { PlanSelection } from '../editTypes';
import { isSelected, selAttrs } from '../selection';
import { ACCENT, COLORS, NSS, STROKE } from '../style';

export interface GhostLayerProps {
  ghosts: DerivedVariant['ghosts'];
  highlightNew: boolean;
  selection?: PlanSelection | null;
  corridorPx?: number;
}

export const GhostLayer = memo(function GhostLayer({ ghosts, highlightNew, selection = null, corridorPx = 12 }: GhostLayerProps) {
  if (!highlightNew || ghosts.length === 0) return null;
  return (
    <g data-layer="ghosts">
      {ghosts.map((g) => {
        const on = isSelected(selection, 'ghost', g.id);
        return (
          <g key={g.id} {...selAttrs('ghost', g.id)}>
            <line
              data-ghost-id={g.id}
              x1={g.a[0]}
              y1={g.a[1]}
              x2={g.b[0]}
              y2={g.b[1]}
              stroke={on ? ACCENT : COLORS.wallRemoved}
              strokeWidth={on ? STROKE.selected : 2}
              strokeDasharray="5 3"
              pointerEvents="none"
              {...NSS}
            />
            <line x1={g.a[0]} y1={g.a[1]} x2={g.b[0]} y2={g.b[1]} stroke="transparent" strokeWidth={corridorPx} pointerEvents="stroke" data-ghost-corridor={g.id} {...NSS} />
          </g>
        );
      })}
    </g>
  );
});
