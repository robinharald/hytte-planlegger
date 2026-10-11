/** Dimension lines from `derived.dimensions`: offset line, extension lines, 45° ticks, text along the line. */
import { memo } from 'react';
import type { DerivedDimension } from '../../model/derived';
import { dimensionGeometry, textAngleAlong } from '../svg';
import { COLORS, FONT_PX, NSS, PAPER, STROKE } from '../style';
import { ScreenText } from './ScreenText';

export const DimensionLayer = memo(function DimensionLayer({ dimensions, scale }: { dimensions: DerivedDimension[]; scale: number }) {
  const tick = 7 / scale;
  const overshoot = 4 / scale;
  const textGap = (6 + FONT_PX.dim / 2) / scale;
  const showText = scale >= 12;
  return (
    <g data-layer="dimensions" pointerEvents="none">
      {dimensions.map((d, i) => {
        const g = dimensionGeometry(d, tick, overshoot);
        if (!g) return null;
        const colour = COLORS.dimension;
        const tx = g.mid[0] + g.outward[0] * textGap;
        const ty = g.mid[1] + g.outward[1] * textGap;
        const angle = textAngleAlong(d.b[0] - d.a[0], d.b[1] - d.a[1]);
        return (
          <g key={`${d.kind}/${i}`} data-dimension-kind={d.kind}>
            <line x1={g.line[0][0]} y1={g.line[0][1]} x2={g.line[1][0]} y2={g.line[1][1]} stroke={colour} strokeWidth={STROKE.hair} {...NSS} />
            {g.ext.map((e, j) => (
              <line key={`e${j}`} x1={e[0][0]} y1={e[0][1]} x2={e[1][0]} y2={e[1][1]} stroke={colour} strokeWidth={STROKE.hair} opacity={0.7} {...NSS} />
            ))}
            {g.ticks.map((t, j) => (
              <line key={`t${j}`} x1={t[0][0]} y1={t[0][1]} x2={t[1][0]} y2={t[1][1]} stroke={colour} strokeWidth={STROKE.medium} {...NSS} />
            ))}
            {showText && (
              <ScreenText x={tx} y={ty} scale={scale} rotate={angle}>
                <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={FONT_PX.dim} fill={colour} stroke={PAPER} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke">
                  {d.text}
                </text>
              </ScreenText>
            )}
          </g>
        );
      })}
    </g>
  );
});
