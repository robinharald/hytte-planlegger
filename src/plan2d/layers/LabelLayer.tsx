/**
 * Room labels at `labelPoint`: name, `b × d m` and `m²` (comma decimals via ui/format.ts). Density by the
 * current px/m (architecture.md): ≥ 25 full label, 12–25 name only, < 12 none. Rooms of type 'apning' get the
 * name only at any density. Faces without a Room record show "Uten navn" (italic, muted) with dims and area.
 * Labels are fitted to their rooms and to each other (drawing.ts `layoutRoomLabels`: details dropped, name wrapped,
 * or no label until the user zooms in), so the labels of small neighbouring rooms never overlap.
 * Text is laid out in screen pixels through ScreenText, so it stays the same size at any zoom.
 */
import { memo } from 'react';
import type { DerivedRoom } from '../../model/derived';
import { layoutRoomLabels } from '../drawing';
import { labelDensity } from '../svg';
import { COLORS, FONT_PX, PAPER } from '../style';
import { ScreenText } from './ScreenText';

export interface LabelLayerProps {
  rooms: DerivedRoom[];
  scale: number;
  highlightNew: boolean;
}

const LINE_PX = 13;
const FIT_FONT = { name: FONT_PX.name, detail: FONT_PX.detail, line: LINE_PX };

export const LabelLayer = memo(function LabelLayer({ rooms, scale, highlightNew }: LabelLayerProps) {
  const density = labelDensity(scale);
  return (
    <g data-layer="labels" pointerEvents="none">
      {density !== 'none' &&
        layoutRoomLabels(rooms, density, scale, FIT_FONT).map(({ room: r, label: { lines, nameLines } }) => {
          const unnamed = !r.room;
          const nameColour = unnamed ? COLORS.labelMuted : r.isNew && highlightNew ? COLORS.labelNew : COLORS.labelName;
          const y0 = (-(lines.length - 1) / 2) * LINE_PX;
          return (
            <ScreenText key={`${r.levelId}/${r.id}`} x={r.labelPoint[0]} y={r.labelPoint[1]} scale={scale} data-room-label={r.id}>
              {lines.map((text, i) => {
                const isName = i < nameLines;
                return (
                  <text
                    key={i}
                    x={0}
                    y={y0 + i * LINE_PX}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={isName ? FONT_PX.name : FONT_PX.detail}
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
