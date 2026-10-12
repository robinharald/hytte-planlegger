/**
 * Walls of the current storey: the per-status wall union (clean corners) filled by status, with the opening
 * footprints cut out through an even-odd clip path (cheaper than a mask while panning); invisible per-piece hit
 * areas on top (selection, accent outline when selected), and dividers as dashed hairlines.
 *
 * Hit areas (docs/phase2-plan.md §3.1): each piece's footprint, plus an invisible corridor along its reference line
 * `corridorPx` wide on screen (12 px, 24 px on a coarse pointer; non-scaling stroke), so a wall can be tapped at any
 * zoom. Dividers get the same corridor.
 *
 * Paint: existing #2b2b2b; new with "highlight new" a light #c8742a tint outlined #8a4d1c (otherwise like
 * existing); removed walls ("ghosts", docs/phase2-plan.md §1.2) dashed grey without fill, and only while "highlight
 * new" ("Vis hva som er nytt") is on — with it off they are neither drawn nor hit-testable. A ghost is selected as
 * { kind: 'ghost', id: stored wall id } and then outlined dashed in the accent colour.
 */
import { memo, useId } from 'react';
import type { DerivedVariant, DerivedWall } from '../../model/derived';
import type { Vec2 } from '../../model/types';
import { cutClipPath, wallPaint } from '../drawing';
import { ghostIdOfWall } from '../editModel';
import type { PlanSelection } from '../editTypes';
import { domId, multiPolygonPath, polygonPath } from '../svg';
import { isSelected, isWallHighlighted, selAttrs, wallSelection } from '../selection';
import type { SelAttrs } from '../selection';
import { ACCENT, COLORS, NSS, STROKE } from '../style';
import type { Rect } from '../viewport';

export interface WallLayerProps {
  unions: DerivedVariant['wallUnion'];
  /** Pieces with a footprint (exterior + stored walls, not dividers). */
  pieces: DerivedWall[];
  dividers: DerivedWall[];
  /** Footprints of the openings to cut out of the wall fill (status ≠ removed). */
  cuts: Vec2[][];
  bounds: Rect;
  highlightNew: boolean;
  selection: PlanSelection | null;
  /** Width (screen px) of the invisible hit corridor along each wall (default 12). */
  corridorPx?: number;
}

function hitAttrs(w: DerivedWall): SelAttrs {
  if (w.isGhost) return selAttrs('ghost', ghostIdOfWall(w));
  const s = wallSelection(w);
  return selAttrs(s.kind, s.id, s.levelId);
}

export const WallLayer = memo(function WallLayer({ unions, pieces, dividers, cuts, bounds, highlightNew, selection, corridorPx = 12 }: WallLayerProps) {
  const clipId = domId('wall-cut', useId());
  const hittable = pieces.filter((w) => !w.isGhost || highlightNew);
  return (
    <g data-layer="walls">
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <path d={cutClipPath(bounds, cuts)} clipRule="evenodd" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`} pointerEvents="none">
        {unions.map((u, i) => {
          if (u.status === 'removed' && !highlightNew) return null;
          const p = wallPaint(u.status, highlightNew);
          return (
            <path
              key={`${u.storeyId}/${u.status}/${i}`}
              d={multiPolygonPath(u.polygons)}
              fill={p.fill}
              fillOpacity={p.fillOpacity}
              fillRule="evenodd"
              stroke={p.stroke}
              strokeWidth={STROKE.wall}
              strokeDasharray={p.dash}
              strokeLinejoin="miter"
              data-wall-status={u.status}
              {...NSS}
            />
          );
        })}
      </g>
      <g data-layer="wall-corridors">
        {hittable.map((w) => (
          <line key={w.id} x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} stroke="transparent" strokeWidth={corridorPx} pointerEvents="stroke" data-wall-corridor={w.id} {...NSS} {...hitAttrs(w)} />
        ))}
      </g>
      <g data-layer="wall-hits">
        {hittable.map((w) => {
          const ghostSel = w.isGhost && isSelected(selection, 'ghost', ghostIdOfWall(w));
          const sel = !w.isGhost && isWallHighlighted(selection, w);
          return (
            <path
              key={w.id}
              d={polygonPath(w.footprint)}
              fill={sel ? ACCENT : 'none'}
              fillOpacity={sel ? 0.3 : undefined}
              stroke={sel || ghostSel ? ACCENT : 'none'}
              strokeWidth={STROKE.selected}
              strokeDasharray={ghostSel ? '4 3' : undefined}
              pointerEvents="fill"
              data-wall-id={w.id}
              {...NSS}
              {...hitAttrs(w)}
            />
          );
        })}
      </g>
      <g data-layer="dividers">
        {dividers.map((w) => {
          const sel = isWallHighlighted(selection, w);
          const s = wallSelection(w);
          return (
            <g key={w.id} data-wall-id={w.id} {...selAttrs(s.kind, s.id, s.levelId)}>
              <line
                x1={w.a[0]}
                y1={w.a[1]}
                x2={w.b[0]}
                y2={w.b[1]}
                stroke={sel ? ACCENT : COLORS.divider}
                strokeWidth={sel ? STROKE.selected : STROKE.hair}
                strokeDasharray="5 4"
                pointerEvents="none"
                {...NSS}
              />
              <line x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} stroke="transparent" strokeWidth={corridorPx} pointerEvents="stroke" data-wall-corridor={w.id} {...NSS} />
            </g>
          );
        })}
      </g>
    </g>
  );
});
