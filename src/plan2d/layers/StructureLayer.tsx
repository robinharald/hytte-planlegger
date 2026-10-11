/**
 * Structure of the current storey: posts as filled squares, the chimney as a hatched rectangle, stairs as
 * outline + tread lines + walking-line arrow from DerivedStructure.arrow (dot at the bottom step, head at the
 * top) with an "opp" label when labels are at full density, beams as dashed lines. On the storey a stair
 * arrives at ('upper' mode, storeyData.ts `stairModes`) only the flight beyond the lower plan's cut is solid:
 * the treads below it and the walking line up to it are dashed, with a diagonal break line at the cut.
 */
import { memo } from 'react';
import type { DerivedStructure } from '../../model/derived';
import type { Selection } from '../../state/selection';
import { STAIR_ARROW_PX, stairPlan, stairUpLabelAt } from '../drawing';
import type { StairMode } from '../drawing';
import { arrowHead, hatchSegments, labelDensity, polygonPath, ringPath, segmentsPath } from '../svg';
import { CUT_HEIGHT } from '../visibility';
import { isSelected, selAttrs } from '../selection';
import { planStrings } from '../strings';
import { ACCENT, COLORS, FONT_PX, NSS, PAPER, STROKE } from '../style';
import { ScreenText } from './ScreenText';

export interface StructureLayerProps {
  elements: DerivedStructure[];
  selection: Selection | null;
  /** Current zoom (px/m): arrow heads and the "opp" label keep a constant screen size. */
  scale: number;
  /** Drawing mode per stair id (default 'full'). */
  stairModes?: Record<string, StairMode>;
}

const NO_MODES: Record<string, StairMode> = {};

const CHIMNEY_HATCH_M = 0.08;

type Stair = Extract<DerivedStructure, { kind: 'stair' }>;

const DASH = '3 3';

function StairSymbol({ el, stroke, sw, scale, mode }: { el: Stair; stroke: string; sw: number; scale: number; mode: StairMode }) {
  const plan = stairPlan(el, mode, CUT_HEIGHT);
  const [c, b] = plan.walkSolid;
  const head = arrowHead(c, b, STAIR_ARROW_PX / scale);
  const up = mode === 'full' && labelDensity(scale) === 'full' ? stairUpLabelAt(el, scale) : null;
  const ink = COLORS.structure;
  return (
    <>
      <path d={polygonPath(el.footprint)} fill={PAPER} fillOpacity={0.6} stroke={stroke} strokeWidth={sw} pointerEvents="fill" data-stair-part={mode} {...NSS} />
      <g pointerEvents="none">
        {plan.solid.map((t, i) => (
          <path key={`s${i}`} d={ringPath(t)} fill="none" stroke={ink} strokeWidth={STROKE.hair} {...NSS} />
        ))}
        {plan.dashed.map((t, i) => (
          <path key={`d${i}`} d={ringPath(t)} fill="none" stroke={ink} strokeWidth={STROKE.hair} strokeDasharray={DASH} opacity={0.7} {...NSS} />
        ))}
        {plan.walkDashed && (
          <line x1={plan.walkDashed[0][0]} y1={plan.walkDashed[0][1]} x2={plan.walkDashed[1][0]} y2={plan.walkDashed[1][1]} stroke={ink} strokeWidth={STROKE.thin} strokeDasharray={DASH} {...NSS} />
        )}
        <line x1={c[0]} y1={c[1]} x2={b[0]} y2={b[1]} stroke={ink} strokeWidth={STROKE.thin} {...NSS} />
        {plan.breakLine && (
          <line x1={plan.breakLine[0][0]} y1={plan.breakLine[0][1]} x2={plan.breakLine[1][0]} y2={plan.breakLine[1][1]} stroke={ink} strokeWidth={STROKE.thin} data-stair-cut={el.id} {...NSS} />
        )}
        <circle cx={el.arrow.a[0]} cy={el.arrow.a[1]} r={2.5 / scale} fill={ink} />
        {head.length === 3 && <path d={ringPath(head)} fill={ink} stroke="none" data-stair-arrow={el.id} />}
        {up && (
          <ScreenText x={up[0]} y={up[1]} scale={scale} data-stair-label={el.id}>
            <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={FONT_PX.small} fill={ink} stroke={PAPER} strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
              {planStrings.up}
            </text>
          </ScreenText>
        )}
      </g>
    </>
  );
}

export const StructureLayer = memo(function StructureLayer({ elements, selection, scale, stairModes = NO_MODES }: StructureLayerProps) {
  return (
    <g data-layer="structure">
      {elements.map((el) => {
        const on = isSelected(selection, 'structure', el.id);
        const stroke = on ? ACCENT : COLORS.structure;
        const sw = on ? STROKE.selected : STROKE.thin;
        const attrs = { ...selAttrs('structure', el.id), 'data-structure-kind': el.kind };
        switch (el.kind) {
          case 'post': {
            const h = el.size / 2;
            return (
              <rect key={el.id} x={el.position[0] - h} y={el.position[1] - h} width={el.size} height={el.size} fill={COLORS.structure} stroke={stroke} strokeWidth={sw} pointerEvents="fill" {...NSS} {...attrs} />
            );
          }
          case 'chimney':
            return (
              <g key={el.id} {...attrs}>
                <rect x={el.min[0]} y={el.min[1]} width={el.max[0] - el.min[0]} height={el.max[1] - el.min[1]} fill={PAPER} stroke={stroke} strokeWidth={sw} pointerEvents="fill" {...NSS} />
                <path d={segmentsPath(hatchSegments(el.min, el.max, CHIMNEY_HATCH_M))} stroke={COLORS.structure} strokeWidth={STROKE.hair} fill="none" pointerEvents="none" {...NSS} />
              </g>
            );
          case 'beam':
            return (
              <g key={el.id} {...attrs}>
                <line x1={el.a[0]} y1={el.a[1]} x2={el.b[0]} y2={el.b[1]} stroke={stroke} strokeWidth={sw} strokeDasharray="6 3" pointerEvents="none" {...NSS} />
                <line x1={el.a[0]} y1={el.a[1]} x2={el.b[0]} y2={el.b[1]} stroke="transparent" strokeWidth={10} pointerEvents="stroke" {...NSS} />
              </g>
            );
          case 'stair':
            return (
              <g key={el.id} {...attrs}>
                <StairSymbol el={el} stroke={stroke} sw={sw} scale={scale} mode={stairModes[el.id] ?? 'full'} />
              </g>
            );
          default:
            return null;
        }
      })}
    </g>
  );
});
