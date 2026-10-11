/**
 * Walls of the current storey: the per-status wall union (clean corners) filled by status, with the opening
 * footprints cut out through an even-odd clip path (cheaper than a mask while panning); invisible per-piece hit
 * areas on top (selection, accent outline when selected), and dividers as dashed hairlines.
 *
 * Paint: existing #2b2b2b; new with "highlight new" a light #c8742a tint outlined #8a4d1c (otherwise like
 * existing); removed dashed grey without fill.
 */
import { memo, useId } from 'react';
import type { DerivedVariant, DerivedWall } from '../../model/derived';
import type { Vec2 } from '../../model/types';
import type { Selection } from '../../state/selection';
import { cutClipPath, wallPaint } from '../drawing';
import { domId, multiPolygonPath, polygonPath } from '../svg';
import { isWallHighlighted, selAttrs, wallSelection } from '../selection';
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
  selection: Selection | null;
}

export const WallLayer = memo(function WallLayer({ unions, pieces, dividers, cuts, bounds, highlightNew, selection }: WallLayerProps) {
  const clipId = domId('wall-cut', useId());
  return (
    <g data-layer="walls">
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <path d={cutClipPath(bounds, cuts)} clipRule="evenodd" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`} pointerEvents="none">
        {unions.map((u, i) => {
          const p = wallPaint(u.status, highlightNew);
          return (
            <path
              key={`${u.storeyId}/${u.status}/${i}`}
              d={multiPolygonPath(u.polygons)}
              fill={p.fill}
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
      <g data-layer="wall-hits">
        {pieces.map((w) => {
          const sel = isWallHighlighted(selection, w);
          const s = wallSelection(w);
          return (
            <path
              key={w.id}
              d={polygonPath(w.footprint)}
              fill={sel ? ACCENT : 'none'}
              fillOpacity={sel ? 0.3 : undefined}
              stroke={sel ? ACCENT : 'none'}
              strokeWidth={STROKE.selected}
              pointerEvents="fill"
              data-wall-id={w.id}
              {...NSS}
              {...selAttrs(s.kind, s.id, s.levelId)}
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
              <line x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} stroke="transparent" strokeWidth={10} pointerEvents="stroke" {...NSS} />
            </g>
          );
        })}
      </g>
    </g>
  );
});
