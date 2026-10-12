/**
 * Furniture of the current storey (docs/phase2-plan.md §4; placeholder until phase 2b brings symbols): each
 * `DerivedFurniture.footprint` as a light rectangle with the catalogue name (`catalog.name`, else the catalogue id)
 * when the item is at least 18 px across on screen; selectable as { kind: 'furniture', id, levelId }; items with
 * collisions get a red outline; with `showClearances` the clearance zones are drawn as faint hatching.
 */
import { memo, useId } from 'react';
import type { DerivedFurniture } from '../../model/derived';
import type { PlanSelection } from '../editTypes';
import { domId, polygonPath } from '../svg';
import { isSelected, selAttrs } from '../selection';
import { ACCENT, COLORS, FONT_PX, NSS, PAPER, STROKE } from '../style';
import { ScreenText } from './ScreenText';

export interface FurnitureLayerProps {
  items: DerivedFurniture[];
  selection: PlanSelection | null;
  scale: number;
  showClearances: boolean;
}

/** Outline of an item that collides with another one. */
const COLLISION = '#b3261e';
const MIN_LABEL_PX = 18;

function centreOf(poly: DerivedFurniture['footprint']): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
}

export const FurnitureLayer = memo(function FurnitureLayer({ items, selection, scale, showClearances }: FurnitureLayerProps) {
  const hatchId = domId('furn-clear', useId());
  if (items.length === 0) return null;
  return (
    <g data-layer="furniture">
      {showClearances && (
        <>
          <defs>
            <pattern id={hatchId} patternUnits="userSpaceOnUse" width={0.12} height={0.12} patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={0.12} stroke={ACCENT} strokeWidth={0.015} />
            </pattern>
          </defs>
          <g data-layer="clearances" pointerEvents="none">
            {items.flatMap((f) =>
              f.clearances.map((c, i) => <path key={`${f.id}/${i}`} d={polygonPath(c)} fill={`url(#${hatchId})`} fillOpacity={0.5} stroke={ACCENT} strokeOpacity={0.35} strokeWidth={STROKE.hair} strokeDasharray="3 3" data-clearance-of={f.id} {...NSS} />),
            )}
          </g>
        </>
      )}
      {items.map((f) => {
        if (f.footprint.length < 3) return null;
        const on = isSelected(selection, 'furniture', f.id);
        const stroke = on ? ACCENT : f.collisions.length > 0 ? COLLISION : COLORS.labelMuted;
        const w = f.bbox.max[0] - f.bbox.min[0];
        const h = f.bbox.max[1] - f.bbox.min[1];
        const name = f.catalog?.name ?? f.item.catalogId;
        const [cx, cy] = centreOf(f.footprint);
        return (
          <g key={f.id} data-furniture-id={f.id} {...selAttrs('furniture', f.id, f.levelId)}>
            <path
              d={polygonPath(f.footprint)}
              fill={on ? ACCENT : '#ffffff'}
              fillOpacity={on ? 0.18 : 0.85}
              stroke={stroke}
              strokeWidth={on ? STROKE.selected : STROKE.thin}
              pointerEvents="fill"
              {...NSS}
            />
            {Math.min(w, h) * scale >= MIN_LABEL_PX && (
              <ScreenText x={cx} y={cy} scale={scale} data-furniture-label={f.id}>
                <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={FONT_PX.small} fill={COLORS.labelMuted} stroke={PAPER} strokeWidth={2.5} paintOrder="stroke" strokeLinejoin="round">
                  {name}
                </text>
              </ScreenText>
            )}
          </g>
        );
      })}
    </g>
  );
});
