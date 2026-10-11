/**
 * Screen-space overlays (outside the flipped root, in CSS pixels): the north arrow from Site.planNorthBearing
 * (planDirOfBearing(0), see svg.ts northInPlan) on a small round backdrop of NORTH_ARROW_BOX px — PlanView puts
 * it in the viewport corner that covers the least of the drawing (drawing.ts placeCornerOverlay) — and a scale
 * bar with a "nice" length for the current zoom.
 */
import { memo } from 'react';
import { NORTH_ARROW_BOX, scaleBarLabel } from '../drawing';
import { arrowHead, niceScaleLength, northOnScreen, ringPath } from '../svg';
import { planStrings } from '../strings';
import { COLORS, FONT_PX, PAPER } from '../style';

/** Arrow length (px); the "N" sits beyond the tip, all inside the NORTH_ARROW_BOX backdrop. */
const ARROW_PX = 24;

export const NorthArrow = memo(function NorthArrow({ bearing, cx, cy }: { bearing: number; cx: number; cy: number }) {
  const [dx, dy] = northOnScreen(bearing);
  const half = ARROW_PX / 2;
  const tail: [number, number] = [cx - dx * half, cy - dy * half];
  const tip: [number, number] = [cx + dx * half, cy + dy * half];
  const head = arrowHead(tail, tip, 8);
  return (
    <g data-overlay="north" pointerEvents="none" fill={COLORS.north} stroke={COLORS.north}>
      <circle cx={cx} cy={cy} r={NORTH_ARROW_BOX / 2} fill={PAPER} fillOpacity={0.85} stroke="none" />
      <line x1={tail[0]} y1={tail[1]} x2={tip[0]} y2={tip[1]} strokeWidth={1.5} />
      {head.length === 3 && <path d={ringPath(head)} stroke="none" />}
      <text x={cx + dx * (half + 8)} y={cy + dy * (half + 8)} textAnchor="middle" dominantBaseline="central" fontSize={FONT_PX.name} fontWeight={600} stroke="none">
        {planStrings.north}
      </text>
    </g>
  );
});

export const ScaleBar = memo(function ScaleBar({ scale, x, y }: { scale: number; x: number; y: number }) {
  const metres = niceScaleLength(scale);
  const px = metres * scale;
  return (
    <g data-overlay="scale" pointerEvents="none" stroke={COLORS.scaleBar}>
      <rect x={x - 6} y={y - 22} width={px + 12} height={30} fill={PAPER} fillOpacity={0.85} stroke="none" rx={3} />
      <line x1={x} y1={y} x2={x + px} y2={y} strokeWidth={1.5} />
      <line x1={x} y1={y - 5} x2={x} y2={y + 5} strokeWidth={1.5} />
      <line x1={x + px} y1={y - 5} x2={x + px} y2={y + 5} strokeWidth={1.5} />
      <line x1={x + px / 2} y1={y - 3} x2={x + px / 2} y2={y + 3} strokeWidth={1} />
      <text x={x + px / 2} y={y - 10} textAnchor="middle" fontSize={FONT_PX.small} fill={COLORS.scaleBar} stroke="none">
        {scaleBarLabel(metres)}
      </text>
    </g>
  );
});
