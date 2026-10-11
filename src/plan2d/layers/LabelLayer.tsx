/**
 * Room labels: name, `b × d m` and `m²` (comma decimals via ui/format.ts). Density by the current px/m (svg.ts
 * `labelDensity`): ≥ 20 full label, 8–20 name only (small font below 12), < 8 none. Rooms of type 'apning' get
 * the name only. Faces without a Room record show "Uten navn" (italic, muted) with dims and area.
 * Labels are fitted to their rooms and to each other (labelLayout.ts `layoutRoomLabels`: the actual text
 * rectangle must lie inside the room, clear of stairs, chimney and posts; the anchor moves off the label point
 * when needed; details are compacted to "name / m²", then dropped, then the name is wrapped, else no label until
 * the user zooms in), so labels never cross a wall or overlap each other.
 * Text is laid out in screen pixels through ScreenText, so it stays the same size at any zoom.
 */
import { memo } from 'react';
import type { DerivedRoom } from '../../model/derived';
import type { Vec2 } from '../../model/types';
import { labelFonts, layoutRoomLabels } from '../labelLayout';
import { labelDensity } from '../svg';
import { COLORS, PAPER } from '../style';
import { ScreenText } from './ScreenText';

export interface LabelLayerProps {
  rooms: DerivedRoom[];
  scale: number;
  highlightNew: boolean;
  /** Footprints the labels keep clear of (storeyData.ts `labelObstacles`). */
  obstacles?: Vec2[][];
}

const NO_OBSTACLES: Vec2[][] = [];

export const LabelLayer = memo(function LabelLayer({ rooms, scale, highlightNew, obstacles = NO_OBSTACLES }: LabelLayerProps) {
  const density = labelDensity(scale);
  return (
    <g data-layer="labels" pointerEvents="none">
      {density !== 'none' &&
        layoutRoomLabels(rooms, density, scale, labelFonts(scale), obstacles).map(({ room: r, label: { lines, nameLines, kind, font, ys }, at }) => {
          const unnamed = !r.room;
          const nameColour = unnamed ? COLORS.labelMuted : r.isNew && highlightNew ? COLORS.labelNew : COLORS.labelName;
          return (
            <ScreenText key={`${r.levelId}/${r.id}`} x={at[0]} y={at[1]} scale={scale} data-room-label={r.id} data-label-kind={kind}>
              {lines.map((text, i) => {
                const isName = i < nameLines;
                return (
                  <text
                    key={i}
                    x={0}
                    y={ys[i]}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={isName ? font.name : font.detail}
                    fontWeight={isName ? 600 : 400}
                    fontStyle={unnamed && isName ? 'italic' : undefined}
                    fill={isName ? nameColour : COLORS.labelMuted}
                    stroke={PAPER}
                    strokeWidth={3}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                  >
                    {text}
                  </text>
                );
              })}
            </ScreenText>
          );
        })}
    </g>
  );
});
