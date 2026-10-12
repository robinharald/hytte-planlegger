/**
 * Pan/zoom math for the 2D plan — pure, unit-tested, no React.
 *
 * A `View` maps plan metres to screen pixels: screen = (s·x + tx, −s·y + ty). The SVG root group uses exactly
 * this as `matrix(s 0 0 -s tx ty)`, so plan +y is up on screen (docs/architecture.md "SVG plan").
 */
import type { Vec2 } from '../model/types';

export interface View {
  /** Pixels per metre. */
  s: number;
  /** Screen x of the plan origin (px). */
  tx: number;
  /** Screen y of the plan origin (px). */
  ty: number;
}

export interface Rect {
  min: Vec2;
  max: Vec2;
}

/** Zoom limits in px/m: 2 px/m shows ~1 km on a laptop, 600 px/m shows a door handle. */
export const MIN_SCALE = 2;
export const MAX_SCALE = 600;

export function clampScale(s: number): number {
  if (!Number.isFinite(s) || s <= 0) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

export function planToScreen(v: View, p: Vec2): Vec2 {
  return [v.s * p[0] + v.tx, -v.s * p[1] + v.ty];
}

export function screenToPlan(v: View, q: Vec2): Vec2 {
  return [(q[0] - v.tx) / v.s, (v.ty - q[1]) / v.s];
}

export function rootTransform(v: View): string {
  return `matrix(${v.s} 0 0 ${-v.s} ${v.tx} ${v.ty})`;
}

/** Translate the view by a screen delta (px). */
export function pan(v: View, dx: number, dy: number): View {
  return { s: v.s, tx: v.tx + dx, ty: v.ty + dy };
}

/** Multiply the scale by `factor`, keeping the plan point under screen (cx, cy) fixed. */
export function zoomAround(v: View, factor: number, cx: number, cy: number): View {
  const s = clampScale(v.s * factor);
  const k = s / v.s;
  return { s, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
}

/**
 * Two-finger gesture step: previous and current screen positions of both pointers. Scales by the change in
 * finger distance around the current midpoint and pans by the midpoint movement.
 */
export function pinchUpdate(v: View, prevA: Vec2, prevB: Vec2, a: Vec2, b: Vec2): View {
  const d0 = Math.hypot(prevB[0] - prevA[0], prevB[1] - prevA[1]);
  const d1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const prevMid: Vec2 = [(prevA[0] + prevB[0]) / 2, (prevA[1] + prevB[1]) / 2];
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const factor = d0 > 1e-6 && d1 > 1e-6 ? d1 / d0 : 1;
  const panned = pan(v, mid[0] - prevMid[0], mid[1] - prevMid[1]);
  return zoomAround(panned, factor, mid[0], mid[1]);
}

/**
 * View that shows `bounds` (plan metres) centred in a width × height px viewport, with `marginM` metres of
 * plan around it and `padPx` pixels of screen padding. Degenerate bounds (zero size) still produce a view.
 */
export function fitView(bounds: Rect, width: number, height: number, marginM = 1.5, padPx = 24): View {
  const bw = Math.max(bounds.max[0] - bounds.min[0], 0) + 2 * marginM;
  const bh = Math.max(bounds.max[1] - bounds.min[1], 0) + 2 * marginM;
  const availW = Math.max(width - 2 * padPx, 1);
  const availH = Math.max(height - 2 * padPx, 1);
  const s = clampScale(Math.min(availW / Math.max(bw, 1e-6), availH / Math.max(bh, 1e-6)));
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cy = (bounds.min[1] + bounds.max[1]) / 2;
  return { s, tx: width / 2 - s * cx, ty: height / 2 + s * cy };
}

/** Plan rectangle currently visible in a width × height px viewport. */
export function visiblePlanRect(v: View, width: number, height: number): Rect {
  const a = screenToPlan(v, [0, 0]);
  const b = screenToPlan(v, [width, height]);
  return { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
}

/** Expand a rect outwards to whole multiples of `step` (so small pans do not change the grid extent). */
export function snapRectOut(r: Rect, step: number): Rect {
  return {
    min: [Math.floor(r.min[0] / step) * step, Math.floor(r.min[1] / step) * step],
    max: [Math.ceil(r.max[0] / step) * step, Math.ceil(r.max[1] / step) * step],
  };
}

/** Wheel delta → zoom factor. Pixel deltas (deltaMode 0) and line deltas (1) are both handled; clamped per event. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const k = deltaMode === 1 ? 0.05 : deltaMode === 2 ? 0.5 : 0.0015;
  const f = Math.exp(-deltaY * k);
  return Math.min(2, Math.max(0.5, f));
}

/**
 * Screen shift (px) along one axis that brings the span [a0, a1] into [lo, hi] with the least movement: none when it
 * already fits; a span larger than the range is moved until it covers the range (its nearer end on the range edge).
 */
function revealShift(a0: number, a1: number, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  if (a1 - a0 <= hi - lo) {
    if (a0 < lo) return lo - a0;
    if (a1 > hi) return hi - a1;
    return 0;
  }
  if (a0 > lo) return lo - a0;
  if (a1 < hi) return hi - a1;
  return 0;
}

/**
 * The smallest pan (screen px, y down) that brings a screen box into the visible area `area` (both
 * `{ x0, y0, x1, y1 }`): [0, 0] when it already lies inside (see `revealShift` for boxes larger than the area).
 */
export function revealPan(box: { x0: number; y0: number; x1: number; y1: number }, area: { x0: number; y0: number; x1: number; y1: number }): Vec2 {
  return [revealShift(box.x0, box.x1, area.x0, area.x1), revealShift(box.y0, box.y1, area.y0, area.y1)];
}
