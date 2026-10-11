/**
 * Railings as a double line (thin band around each panel) with small square posts; steps in railing gaps as
 * filled treads with tread lines. Selectable unless `selectable` is false.
 */
import { memo } from 'react';
import type { DerivedRailing } from '../../model/derived';
import type { Selection } from '../../state/selection';
import { bandRect, ringPath } from '../svg';
import { isSelected, selAttrs } from '../selection';
import { ACCENT, COLORS, NSS, STROKE } from '../style';

/** Half the plan width of the railing symbol (m). */
const HALF = 0.03;
/** Post size in plan (m). */
const POST = 0.09;

export const RailingLayer = memo(function RailingLayer({ railings, selection, selectable }: { railings: DerivedRailing[]; selection: Selection | null; selectable: boolean }) {
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
                  <line x1={p.a[0]} y1={p.a[1]} x2={p.b[0]} y2={p.b[1]} stroke="transparent" strokeWidth={12} pointerEvents={selectable ? 'stroke' : 'none'} {...NSS} />
                </g>
              );
            })}
            {r.posts.map((p, i) => (
              <rect key={`p${i}`} x={p[0] - POST / 2} y={p[1] - POST / 2} width={POST} height={POST} fill={stroke} pointerEvents="none" />
            ))}
            {r.steps.map((s) => (
              <g key={s.id} data-steps-id={s.id} pointerEvents="none">
                {s.treads.map((t, i) => (
                  <path key={i} d={ringPath(t.polygon)} fill={COLORS.deck} stroke={COLORS.railing} strokeWidth={STROKE.hair} {...NSS} />
                ))}
              </g>
            ))}
          </g>
        );
      })}
    </g>
  );
});
