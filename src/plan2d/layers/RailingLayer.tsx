/**
 * Railings as a double line (thin band around each panel) with small square posts; deck steps (derived.outdoor.steps,
 * schema 2: hosted on a deck edge, in the railing gap) as filled treads with tread lines. Selectable unless
 * `selectable` is false: a railing panel through a corridor `corridorPx` wide on screen, steps
 * ({ kind: 'steps', id: DeckSteps.id }, phase 2) through their treads. Blocked steps (`DerivedSteps.blocked`: a
 * building stands where they are) are drawn with a dashed red outline so they can be found and dragged away.
 */
import { memo } from 'react';
import type { DerivedRailing, DerivedSteps } from '../../model/derived';
import type { PlanSelection } from '../editTypes';
import { bandRect, ringPath } from '../svg';
import { isSelected, selAttrs } from '../selection';
import { ACCENT, COLORS, NSS, STROKE } from '../style';

/** Half the plan width of the railing symbol (m). */
const HALF = 0.03;
/** Post size in plan (m). */
const POST = 0.09;

export interface RailingLayerProps {
  railings: DerivedRailing[];
  steps: DerivedSteps[];
  selection: PlanSelection | null;
  selectable: boolean;
  /** Width (screen px) of a railing's hit corridor (default 12). */
  corridorPx?: number;
}

/** Outline of blocked steps. */
const BLOCKED = '#b3261e';

export const RailingLayer = memo(function RailingLayer({ railings, steps, selection, selectable, corridorPx = 12 }: RailingLayerProps) {
  return (
    <g data-layer="railings">
      {railings.map((r) => {
        const on = isSelected(selection, 'railing', r.id);
        const stroke = on ? ACCENT : COLORS.railing;
        return (
          <g key={r.id} data-railing-id={r.id} {...(selectable ? selAttrs('railing', r.id) : {})}>
            {r.panels.map((p, i) => {
              const band = bandRect(p.a, p.b, HALF);
              if (band.length === 0) return null;
              return (
                <g key={i}>
                  <path d={ringPath(band)} fill={COLORS.deck} stroke={stroke} strokeWidth={on ? STROKE.medium : STROKE.hair} pointerEvents="none" {...NSS} />
                  <line x1={p.a[0]} y1={p.a[1]} x2={p.b[0]} y2={p.b[1]} stroke="transparent" strokeWidth={corridorPx} pointerEvents={selectable ? 'stroke' : 'none'} {...NSS} />
                </g>
              );
            })}
            {r.posts.map((p, i) => (
              <rect key={`p${i}`} x={p[0] - POST / 2} y={p[1] - POST / 2} width={POST} height={POST} fill={stroke} pointerEvents="none" />
            ))}
          </g>
        );
      })}
      {steps.map((s) => {
        const on = isSelected(selection, 'steps', s.id);
        const stroke = on ? ACCENT : s.blocked ? BLOCKED : COLORS.railing;
        return (
          <g key={s.id} data-steps-id={s.id} data-steps-blocked={s.blocked ? 'true' : undefined} {...(selectable ? selAttrs('steps', s.id) : {})}>
            {s.treads.map((t, i) => (
              <path
                key={i}
                d={ringPath(t.polygon)}
                fill={COLORS.deck}
                stroke={stroke}
                strokeWidth={on ? STROKE.medium : STROKE.hair}
                strokeDasharray={s.blocked && !on ? '3 2' : undefined}
                pointerEvents={selectable ? 'fill' : 'none'}
                {...NSS}
              />
            ))}
          </g>
        );
      })}
    </g>
  );
});
