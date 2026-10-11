/**
 * Structure of the current storey: posts as filled squares, the chimney as a hatched rectangle, stairs as
 * outline + tread lines + walking-line arrow from DerivedStructure.arrow (dot at the bottom step, head at the
 * top) with an "opp" label when labels are at full density, beams as dashed lines.
 */
import { memo } from 'react';
import type { DerivedStructure } from '../../model/derived';
import type { Selection } from '../../state/selection';
import { arrowHead, hatchSegments, labelDensity, polygonPath, ringPath, segmentsPath } from '../svg';
import { isSelected, selAttrs } from '../selection';
import { planStrings } from '../strings';
import { ACCENT, COLORS, FONT_PX, NSS, PAPER, STROKE } from '../style';
import { ScreenText } from './ScreenText';

export interface StructureLayerProps {
  elements: DerivedStructure[];
  selection: Selection | null;
  /** Current zoom (px/m): arrow heads and the "opp" label keep a constant screen size. */
  scale: number;
}

const CHIMNEY_HATCH_M = 0.08;

type Stair = Extract<DerivedStructure, { kind: 'stair' }>;

function StairSymbol({ el, stroke, sw, scale }: { el: Stair; stroke: string; sw: number; scale: number }) {
  const head = arrowHead(el.arrow.a, el.arrow.b, 10 / scale);
  return (
    <>
      <path d={polygonPath(el.footprint)} fill={PAPER} fillOpacity={0.6} stroke={stroke} strokeWidth={sw} pointerEvents="fill" {...NSS} />
      <g pointerEvents="none">
        {el.treads.map((t, i) => (
          <path key={i} d={ringPath(t.polygon)} fill="none" stroke={COLORS.structure} strokeWidth={STROKE.hair} {...NSS} />
        ))}
        <line x1={el.arrow.a[0]} y1={el.arrow.a[1]} x2={el.arrow.b[0]} y2={el.arrow.b[1]} stroke={COLORS.structure} strokeWidth={STROKE.thin} {...NSS} />
        <circle cx={el.arrow.a[0]} cy={el.arrow.a[1]} r={2.5 / scale} fill={COLORS.structure} />
        {head.length === 3 && <path d={ringPath(head)} fill={COLORS.structure} stroke="none" data-stair-arrow={el.id} />}
        {labelDensity(scale) === 'full' && (
          <ScreenText x={el.arrow.b[0]} y={el.arrow.b[1]} scale={scale} data-stair-label={el.id}>
            <text x={0} y={-10} textAnchor="middle" fontSize={FONT_PX.small} fill={COLORS.structure} stroke={PAPER} strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
              {planStrings.up}
            </text>
          </ScreenText>
        )}
      </g>
    </>
  );
}

export const StructureLayer = memo(function StructureLayer({ elements, selection, scale }: StructureLayerProps) {
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
                <StairSymbol el={el} stroke={stroke} sw={sw} scale={scale} />
              </g>
            );
          default:
            return null;
        }
      })}
    </g>
  );
});
