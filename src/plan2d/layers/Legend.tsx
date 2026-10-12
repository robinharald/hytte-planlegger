/**
 * Legend for "Vis hva som er nytt" (docs/phase2-plan.md §3.4): "Hytta i dag" (existing wall fill), "Nytt" (the new
 * tint with its outline) and "Fjernet" (dashed grey ghost), screen-space in the bottom-right corner. PlanView draws
 * it only while highlightNew is on and keeps the north arrow clear of it (`legendBox`).
 */
import { memo } from 'react';
import { LEGEND_H, LEGEND_W, REMOVED_FILL_OPACITY, legendBox } from '../drawing';
import { editStrings } from '../editStrings';
import { COLORS, FONT_PX, PAPER } from '../style';

const ROW = 18;
const PAD = 8;
const SWATCH = 14;

export const Legend = memo(function Legend({ width, height }: { width: number; height: number }) {
  const box = legendBox(width, height);
  const rows = [
    { key: 'existing', label: editStrings.legendExisting, fill: COLORS.wallExisting, stroke: COLORS.wallExisting, dash: undefined },
    { key: 'new', label: editStrings.legendNew, fill: COLORS.wallNewFill, stroke: COLORS.wallNewStroke, dash: undefined },
    { key: 'removed', label: editStrings.legendRemoved, fill: COLORS.wallRemoved, fillOpacity: REMOVED_FILL_OPACITY, stroke: COLORS.wallRemoved, dash: '3 2' },
  ];
  return (
    <g data-overlay="legend" pointerEvents="none" transform={`translate(${box.x0} ${box.y0})`}>
      <rect x={0} y={0} width={LEGEND_W} height={LEGEND_H} rx={4} fill={PAPER} fillOpacity={0.9} stroke={COLORS.grid5} />
      {rows.map((r, i) => {
        const y = PAD + i * ROW;
        return (
          <g key={r.key} data-legend-item={r.key}>
            <rect x={PAD} y={y} width={SWATCH} height={SWATCH - 4} fill={r.fill} fillOpacity={'fillOpacity' in r ? r.fillOpacity : undefined} stroke={r.stroke} strokeWidth={1.25} strokeDasharray={r.dash} />
            <text x={PAD + SWATCH + 6} y={y + (SWATCH - 4) / 2} dominantBaseline="central" fontSize={FONT_PX.small} fill={COLORS.labelName}>
              {r.label}
            </text>
          </g>
        );
      })}
    </g>
  );
});
