/**
 * Editing overlay in SCREEN space (outside the flipped plan root, CSS pixels), so handles and hit corridors keep
 * their pixel sizes at any zoom (docs/phase2-plan.md §3.1): drag handles (white circles with an accent border,
 * radius 7 px / 14 px on a coarse pointer; "+" on deck edge midpoints, skipped when the edge is shorter on screen
 * than four handle radii; deck edges as invisible corridors of the hit-corridor width), drag and snap feedback
 * (dashed ghost outline of the element at pointer-down, and during a previewed drag the dragged element's moving
 * outline solid over it (`data-edit-moving`), guide lines, snap markers, dimension chips), the placement tools' previews (Vegg rubber
 * band with its length (unless the snapper sends its own length chip), the Nytt bygg ghost, the wall a Dør/vindu click would hit, the Mål line), the furniture
 * drop marker, and temporary dimensions asked for by the properties panel ("Avstand fra hjørne", room-size wall
 * highlights with an arrow).
 *
 * Only the handles and deck-edge corridors take pointer events (`data-handle` = PlanHandle.key); everything else
 * is `pointer-events: none`.
 */
import { memo } from 'react';
import type { ReactNode } from 'react';
import type { Vec2 } from '../../model/types';
import { chipText, mid } from '../editFeedback';
import type { PlanHandle, PointerSizes } from '../editModel';
import type { PlanChip, PlanFeedback } from '../editTypes';
import { arrowHead } from '../svg';
import { ACCENT, COLORS, FONT_PX, PAPER } from '../style';
import type { EditOverlayState } from '../usePlanEditing';
import type { View } from '../viewport';
import { planToScreen } from '../viewport';

export interface TempDimension {
  a: Vec2;
  b: Vec2;
  text: string;
  kind: 'corner' | 'extra' | 'measure';
}

export interface EditOverlayProps {
  view: View;
  handles: PlanHandle[];
  sizes: PointerSizes;
  state: EditOverlayState;
  dimensions: TempDimension[];
  /** Footprints to highlight and arrows (plan direction) from their midpoints. */
  highlights: { footprint: Vec2[]; at: Vec2; arrow?: Vec2 }[];
}

const pathOf = (pts: Vec2[], closed: boolean) => (pts.length < 2 ? '' : `M${pts.map((p) => `${r1(p[0])} ${r1(p[1])}`).join('L')}${closed ? 'Z' : ''}`);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Text width estimate (px) for chips: Barlow at 11 px is about 0.55 em per character. */
const chipWidth = (text: string) => Math.max(28, text.length * 6.2 + 12);
const CHIP_H = 18;

function ChipLabel({ at, text, dataKind }: { at: Vec2; text: string; dataKind: string }) {
  const w = chipWidth(text);
  return (
    <g data-edit-chip={dataKind} transform={`translate(${r1(at[0])} ${r1(at[1])})`}>
      <rect x={-w / 2} y={-CHIP_H / 2} width={w} height={CHIP_H} rx={4} fill={PAPER} stroke={ACCENT} strokeWidth={1} />
      <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={FONT_PX.dim} fill={COLORS.labelName}>
        {text}
      </text>
    </g>
  );
}

/** Dimension line a → b (screen px) with end ticks and a chip in the middle. */
function SpanDimension({ a, b, text, kind, colour = ACCENT }: { a: Vec2; b: Vec2; text: string; kind: string; colour?: string }) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  const n: Vec2 = l > 1e-6 ? [-dy / l, dx / l] : [0, 1];
  const t = 5;
  const tick = (p: Vec2) => `M${r1(p[0] - n[0] * t)} ${r1(p[1] - n[1] * t)}L${r1(p[0] + n[0] * t)} ${r1(p[1] + n[1] * t)}`;
  return (
    <g data-edit-dimension={kind}>
      <path d={`M${r1(a[0])} ${r1(a[1])}L${r1(b[0])} ${r1(b[1])}${tick(a)}${tick(b)}`} stroke={colour} strokeWidth={1.25} fill="none" />
      <ChipLabel at={mid(a, b)} text={text} dataKind={kind} />
    </g>
  );
}

function Chips({ chips, view }: { chips: PlanChip[]; view: View }) {
  return (
    <>
      {chips.map((c, i) =>
        c.a && c.b ? (
          <SpanDimension key={i} a={planToScreen(view, c.a)} b={planToScreen(view, c.b)} text={c.text} kind="chip" />
        ) : (
          <ChipLabel key={i} at={planToScreen(view, c.at)} text={c.text} dataKind="chip" />
        ),
      )}
    </>
  );
}

function Feedback({ fb, view }: { fb: PlanFeedback; view: View }) {
  const s = (p: Vec2) => planToScreen(view, p);
  // The drag preview's moving outline (fb.target) is also in fb.ghost (after the base): drawn once, solid, on top.
  const moving = new Set<Vec2[]>(fb.target ?? []);
  return (
    <g data-edit-feedback>
      {fb.ghost.map((ring, i) => {
        const isMoving = moving.has(ring);
        return (
          <path
            key={`g${i}`}
            data-edit-ghost
            data-edit-moving={isMoving ? '' : undefined}
            d={pathOf(ring.map(s), ring.length >= 3)}
            fill={ring.length >= 3 ? ACCENT : 'none'}
            fillOpacity={isMoving ? 0.18 : 0.08}
            stroke={ACCENT}
            strokeWidth={isMoving ? 2 : 1.5}
            strokeDasharray={isMoving ? undefined : '5 4'}
          />
        );
      })}
      {fb.guides.map((g, i) => {
        const a = s(g.a);
        const b = s(g.b);
        return <line key={`l${i}`} data-edit-guide={g.kind} x1={r1(a[0])} y1={r1(a[1])} x2={r1(b[0])} y2={r1(b[1])} stroke={ACCENT} strokeWidth={1} strokeDasharray="4 3" />;
      })}
      <Chips chips={fb.chips} view={view} />
      {fb.markers.map((m, i) => {
        const p = s(m.p);
        return <circle key={`m${i}`} data-edit-marker={m.kind} cx={r1(p[0])} cy={r1(p[1])} r={4} fill="none" stroke={ACCENT} strokeWidth={1.5} />;
      })}
    </g>
  );
}

function Cross({ p, size = 6 }: { p: Vec2; size?: number }) {
  return (
    <path
      data-edit-cursor
      d={`M${r1(p[0] - size)} ${r1(p[1])}L${r1(p[0] + size)} ${r1(p[1])}M${r1(p[0])} ${r1(p[1] - size)}L${r1(p[0])} ${r1(p[1] + size)}`}
      stroke={ACCENT}
      strokeWidth={1.5}
    />
  );
}

function Handle({ h, view, sizes }: { h: PlanHandle; view: View; sizes: PointerSizes }) {
  const p = planToScreen(view, h.p);
  const r = sizes.handleR;
  const common = { 'data-handle': h.key, 'data-handle-shape': h.shape, style: { cursor: 'grab' } };
  if (h.shape === 'edge' && h.a && h.b) {
    const a = planToScreen(view, h.a);
    const b = planToScreen(view, h.b);
    return (
      <g {...common}>
        {h.active && <line x1={r1(a[0])} y1={r1(a[1])} x2={r1(b[0])} y2={r1(b[1])} stroke={ACCENT} strokeWidth={3} pointerEvents="none" />}
        <line x1={r1(a[0])} y1={r1(a[1])} x2={r1(b[0])} y2={r1(b[1])} stroke="transparent" strokeWidth={sizes.corridor} pointerEvents="stroke">
          <title>{h.title}</title>
        </line>
      </g>
    );
  }
  const plus = h.shape === 'insert';
  return (
    <g {...common}>
      <circle cx={r1(p[0])} cy={r1(p[1])} r={r} fill={h.active ? ACCENT : '#ffffff'} stroke={ACCENT} strokeWidth={2} pointerEvents="all">
        <title>{h.title}</title>
      </circle>
      {plus && (
        <path
          d={`M${r1(p[0] - r * 0.5)} ${r1(p[1])}L${r1(p[0] + r * 0.5)} ${r1(p[1])}M${r1(p[0])} ${r1(p[1] - r * 0.5)}L${r1(p[0])} ${r1(p[1] + r * 0.5)}`}
          stroke={ACCENT}
          strokeWidth={1.5}
          pointerEvents="none"
        />
      )}
    </g>
  );
}

export const EditOverlay = memo(function EditOverlay({ view, handles, sizes, state, dimensions, highlights }: EditOverlayProps) {
  const s = (p: Vec2) => planToScreen(view, p);
  const parts: ReactNode[] = [];

  highlights.forEach((h, i) => {
    const at = s(h.at);
    const dir = h.arrow ? [h.arrow[0], -h.arrow[1]] : null;
    const l = dir ? Math.hypot(dir[0], dir[1]) : 0;
    const tip: Vec2 | null = dir && l > 1e-9 ? [at[0] + (dir[0] / l) * 28, at[1] + (dir[1] / l) * 28] : null;
    const head = tip ? arrowHead(at, tip, 8) : [];
    parts.push(
      <g key={`hl${i}`} data-edit-highlight>
        {h.footprint.length >= 3 && <path d={pathOf(h.footprint.map(s), true)} fill={ACCENT} fillOpacity={0.3} stroke={ACCENT} strokeWidth={2} />}
        {tip && <line x1={r1(at[0])} y1={r1(at[1])} x2={r1(tip[0])} y2={r1(tip[1])} stroke={ACCENT} strokeWidth={2} />}
        {head.length === 3 && <path d={pathOf(head, true)} fill={ACCENT} stroke="none" data-edit-arrow />}
      </g>,
    );
  });

  dimensions.forEach((d, i) => {
    parts.push(<SpanDimension key={`dim${i}`} a={s(d.a)} b={s(d.b)} text={d.text} kind={d.kind} />);
  });

  const { tool, hover, wallStart, measure, openingHover, unitGhost, dropPreview } = state;
  if (tool === 'opening' && openingHover) {
    const w = openingHover.wall;
    const p = s(openingHover.point);
    parts.push(
      <g key="oh" data-edit-opening-target={w.id}>
        <path d={pathOf(w.footprint.map(s), true)} fill={ACCENT} fillOpacity={0.25} stroke={ACCENT} strokeWidth={1.5} />
        <circle cx={r1(p[0])} cy={r1(p[1])} r={4} fill={ACCENT} />
      </g>,
    );
  }
  if (unitGhost) {
    parts.push(<path key="ug" data-edit-unit-ghost d={pathOf(unitGhost.map(s), true)} fill={ACCENT} fillOpacity={0.12} stroke={ACCENT} strokeWidth={1.5} strokeDasharray="6 4" />);
  }
  parts.push(<Feedback key="fb" fb={state.feedback} view={view} />);
  if (tool === 'wall' && wallStart) {
    const a = s(wallStart);
    parts.push(<circle key="ws" data-edit-wall-start cx={r1(a[0])} cy={r1(a[1])} r={4} fill={ACCENT} />);
    if (hover) {
      const b = s(hover);
      const len = Math.hypot(hover[0] - wallStart[0], hover[1] - wallStart[1]);
      parts.push(
        <g key="rb" data-edit-rubber>
          <line x1={r1(a[0])} y1={r1(a[1])} x2={r1(b[0])} y2={r1(b[1])} stroke={ACCENT} strokeWidth={3} strokeLinecap="round" opacity={0.85} />
          {len > 1e-6 && state.feedback.chips.length === 0 && <ChipLabel at={mid(a, b)} text={chipText(len)} dataKind="wall-length" />}
        </g>,
      );
    }
  }
  if (tool === 'measure' && measure) {
    const end = measure.b ?? hover;
    if (end && Math.hypot(end[0] - measure.a[0], end[1] - measure.a[1]) > 1e-6) parts.push(<SpanDimension key="ms" a={s(measure.a)} b={s(end)} text={chipText(Math.hypot(end[0] - measure.a[0], end[1] - measure.a[1]))} kind="measure" colour={COLORS.dimension} />);
    else {
      const a = s(measure.a);
      parts.push(<circle key="ma" data-edit-measure-start cx={r1(a[0])} cy={r1(a[1])} r={4} fill={COLORS.dimension} />);
    }
  }
  if (hover && (tool === 'wall' || tool === 'measure' || tool === 'unit' || tool === 'furniture')) parts.push(<Cross key="hc" p={s(hover)} />);
  if (dropPreview) {
    const p = s(dropPreview);
    parts.push(
      <g key="dp" data-edit-drop-preview>
        <circle cx={r1(p[0])} cy={r1(p[1])} r={12} fill={ACCENT} fillOpacity={0.12} stroke={ACCENT} strokeWidth={1.5} strokeDasharray="4 3" />
        <Cross p={p} />
      </g>,
    );
  }

  // Handles: "+" only where the edge leaves room for it between its vertex handles.
  const shown = handles.filter((h) => {
    if (h.shape !== 'insert' || !h.a || !h.b) return true;
    const a = s(h.a);
    const b = s(h.b);
    return Math.hypot(b[0] - a[0], b[1] - a[1]) >= 4 * sizes.handleR;
  });

  return (
    <g data-layer="edit-overlay">
      <g pointerEvents="none">{parts}</g>
      {shown.length > 0 && (
        <g data-layer="handles">
          {shown.map((h) => (
            <Handle key={h.key} h={h} view={view} sizes={sizes} />
          ))}
        </g>
      )}
    </g>
  );
});
