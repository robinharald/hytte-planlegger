/**
 * Pure drawing decisions used by the layer components (kept out of the .tsx files so React fast refresh
 * works and so they can be unit-tested without rendering).
 */
import type { DerivedDimension, DerivedStructure } from '../model/derived';
import type { ElementStatus, FloorMaterial, Vec2 } from '../model/types';
import { formatNumber } from '../ui/format';
import { boxFitsRegion, textWidthPx } from './labelLayout';
import { planStrings } from './strings';
import { COLORS, FLOOR_NEW_MIX, FLOOR_TINT, FONT_PX, NEW } from './style';
import { DIM_TEXT_MIN, SMALL_TEXT_BELOW, dimensionGeometry, niceScaleLength, ringPath } from './svg';
import type { Rect } from './viewport';

/** Opacity of the grey fill of removed ("Fjernet") wall unions and opening ghosts. */
export const REMOVED_FILL_OPACITY = 0.18;

/** Wall union paint: existing dark; new tinted only with "highlight new"; removed dashed grey over a faint grey fill. */
export function wallPaint(status: ElementStatus, highlightNew: boolean): { fill: string; stroke: string; dash?: string; fillOpacity?: number } {
  if (status === 'removed') return { fill: COLORS.wallRemoved, fillOpacity: REMOVED_FILL_OPACITY, stroke: COLORS.wallRemoved, dash: '4 3' };
  if (status === 'new' && highlightNew) return { fill: COLORS.wallNewFill, stroke: COLORS.wallNewStroke };
  return { fill: COLORS.wallExisting, stroke: COLORS.wallExisting };
}

/** Margin (m) of the wall clip region around the bounds. */
const CLIP_PAD = 25;

/** Even-odd clip region for the wall fill: a rectangle around `bounds` with every opening cut as a hole. */
export function cutClipPath(bounds: Rect, cuts: Vec2[][], pad = CLIP_PAD): string {
  const x0 = bounds.min[0] - pad;
  const y0 = bounds.min[1] - pad;
  const x1 = bounds.max[0] + pad;
  const y1 = bounds.max[1] + pad;
  let d = ringPath([
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]);
  for (const c of cuts) d += ringPath(c);
  return d;
}

/** Scale bar text: "5 m", "0,5 m". */
export function scaleBarLabel(metres: number): string {
  return `${formatNumber(metres, Number.isInteger(metres) ? 0 : 1)} ${planStrings.metre}`;
}

/**
 * Rectangle the view is fitted to: the built bounds, grown to include the dimension lines (offset a–b) when
 * they are shown, so the default view shows the whole drawing.
 */
export function fitBounds(bounds: Rect, dimensions: Pick<DerivedDimension, 'a' | 'b' | 'offset'>[]): Rect {
  let [x0, y0] = bounds.min;
  let [x1, y1] = bounds.max;
  for (const d of dimensions) {
    const g = dimensionGeometry(d, 0, 0);
    if (!g) continue;
    for (const p of g.line) {
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
  }
  return { min: [x0, y0], max: [x1, y1] };
}

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

/** Linear mix of two #rrggbb colours: t = 0 → a, t = 1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => hex2(v + (pb[i] - v) * t)).join('')}`;
}

/**
 * Floor fill: the material tint only; a new floor is mixed with NEW (#c8742a) only when "highlight new" is on, so
 * nothing reads as new work while the toggle is off.
 */
export function floorFill(material: FloorMaterial, isNew: boolean, highlightNew: boolean): string {
  const base = FLOOR_TINT[material] ?? FLOOR_TINT.wood;
  return isNew && highlightNew ? mixHex(base, NEW, FLOOR_NEW_MIX) : base;
}

// ---------------------------------------------------------------------------
// Dimension text
// ---------------------------------------------------------------------------

/**
 * Whether dimension chains are drawn at a zoom (px/m) and with which font size: nothing below DIM_TEXT_MIN (a chain
 * without its numbers is only noise), the small size below SMALL_TEXT_BELOW, the normal size above.
 */
export function dimensionStyle(scale: number): { show: boolean; fontPx: number } {
  if (!(scale >= DIM_TEXT_MIN)) return { show: false, fontPx: 0 };
  return { show: true, fontPx: scale < SMALL_TEXT_BELOW ? FONT_PX.dimSmall : FONT_PX.dim };
}

// ---------------------------------------------------------------------------
// Stairs
// ---------------------------------------------------------------------------

/**
 * How a stair is drawn on a storey: 'full' where it starts (all treads, walking line from the bottom step to the
 * arrow head at the top); 'upper' on the storey it arrives at (visibility.ts `stairModeOnStorey`): the treads
 * beyond the lower storey's plan cut solid, the ones below it dashed, a diagonal break line at the cut and the
 * walking line dashed up to the cut, solid from there to the arrow head (as on the architect's loft plan).
 */
export type StairMode = 'full' | 'upper';

type Stair = Extract<DerivedStructure, { kind: 'stair' }>;

export interface StairPlan {
  /** Tread outlines drawn solid / dashed. */
  solid: Vec2[][];
  dashed: Vec2[][];
  /** Walking line: dashed part (bottom → cut) and solid part (cut → top, arrow head at its end). */
  walkDashed: [Vec2, Vec2] | null;
  walkSolid: [Vec2, Vec2];
  /** Diagonal break line across the flight at the cut ('upper' only). */
  breakLine: [Vec2, Vec2] | null;
}

/**
 * Plan symbol parts of a stair. In 'upper' mode the cut lies `cutHeight` above the bottom of the flight (the lower
 * storey's plan cut), placed along the walking line in proportion to the rise.
 */
export function stairPlan(stair: Pick<Stair, 'footprint' | 'treads' | 'arrow' | 'fromZ' | 'toZ'>, mode: StairMode, cutHeight: number): StairPlan {
  const { a, b } = stair.arrow;
  if (mode === 'full') return { solid: stair.treads.map((t) => t.polygon), dashed: [], walkDashed: null, walkSolid: [a, b], breakLine: null };
  const bottom = Math.min(stair.fromZ, stair.toZ);
  const rise = Math.abs(stair.toZ - stair.fromZ);
  const cutZ = bottom + cutHeight;
  const t = rise > 1e-9 ? Math.min(1, Math.max(0, cutHeight / rise)) : 1;
  const cut: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const solid: Vec2[][] = [];
  const dashed: Vec2[][] = [];
  for (const tr of stair.treads) (tr.z > cutZ + 1e-9 ? solid : dashed).push(tr.polygon);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let breakLine: [Vec2, Vec2] | null = null;
  if (len > 1e-9 && stair.footprint.length >= 3) {
    // Across the footprint, perpendicular to the walking line, slanted by a quarter of the flight width.
    const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const n: Vec2 = [-u[1], u[0]];
    const across = stair.footprint.map((p) => (p[0] - cut[0]) * n[0] + (p[1] - cut[1]) * n[1]);
    const lo = Math.min(...across);
    const hi = Math.max(...across);
    const slant = (hi - lo) / 4;
    breakLine = [
      [cut[0] + n[0] * lo - u[0] * slant, cut[1] + n[1] * lo - u[1] * slant],
      [cut[0] + n[0] * hi + u[0] * slant, cut[1] + n[1] * hi + u[1] * slant],
    ];
  }
  return { solid, dashed, walkDashed: t > 1e-9 ? [a, cut] : null, walkSolid: [cut, b], breakLine };
}

// ---------------------------------------------------------------------------
// North arrow placement
// ---------------------------------------------------------------------------

/** Screen rectangle (px, y down). */
export interface ScreenBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlapArea = (a: ScreenBox, b: ScreenBox) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

function boxDistance(a: ScreenBox, b: ScreenBox): number {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  return Math.hypot(dx, dy);
}

/**
 * Centre (px) of a `size` × `size` overlay in one of the viewport's corners (`margin` px from the edges), chosen to
 * cover as little of the drawing (`model`, its screen rectangle) as possible and never the `avoid` boxes (the scale
 * bar): least overlap first, then farthest from the drawing, then top-right, top-left, bottom-right, bottom-left.
 */
export function placeCornerOverlay(model: ScreenBox, width: number, height: number, size: number, margin: number, avoid: ScreenBox[] = []): Vec2 {
  const r = size / 2;
  const right = width - margin - r;
  const left = margin + r;
  const top = margin + r;
  const bottom = height - margin - r;
  const corners: Vec2[] = [
    [right, top],
    [left, top],
    [right, bottom],
    [left, bottom],
  ];
  let best = corners[0];
  let bestScore = Infinity;
  let bestDist = -Infinity;
  for (const c of corners) {
    const box: ScreenBox = { x0: c[0] - r, y0: c[1] - r, x1: c[0] + r, y1: c[1] + r };
    const score = overlapArea(box, model) + (avoid.some((a) => overlapArea(box, a) > 0) ? 1e12 : 0);
    const dist = boxDistance(box, model);
    if (score < bestScore - 1e-6 || (Math.abs(score - bestScore) <= 1e-6 && dist > bestDist + 1e-6)) {
      best = c;
      bestScore = score;
      bestDist = dist;
    }
  }
  return best;
}

/** Size (px) of the north arrow's square box (its round backdrop's diameter) and its margin from the edges. */
export const NORTH_ARROW_BOX = 54;
export const NORTH_ARROW_MARGIN = 8;

/** Screen box of the scale bar drawn at (x, y) (layers/Overlays.tsx ScaleBar, backdrop included). */
export function scaleBarBox(scale: number, x: number, y: number): ScreenBox {
  const px = niceScaleLength(scale) * scale;
  return { x0: x - 6, y0: y - 22, x1: x + px + 6, y1: y + 8 };
}

/** Arrow head length (px) of a stair's walking line, and the gap (px) between it and the "opp" text. */
export const STAIR_ARROW_PX = 10;
const STAIR_UP_GAP_PX = 2;

/**
 * Centre (plan) of the stair's "opp" text: on the walking line just behind the arrow head, so the line runs into
 * the text and on to the head. Null when the text (with its halo) would not lie inside the stair's footprint or
 * would reach back to the bottom of the walking line at this zoom — then no text is drawn, and it can never cover
 * a room label (those keep clear of the footprint).
 */
export function stairUpLabelAt(stair: Pick<Stair, 'footprint' | 'arrow'>, scale: number): Vec2 | null {
  const { a, b } = stair.arrow;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(scale > 0) || len < 1e-9 || stair.footprint.length < 3) return null;
  const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const fontPx = FONT_PX.small;
  const halfW = textWidthPx(planStrings.up, fontPx) / 2 + 1.5;
  const halfH = (0.5 * fontPx + 1.5) * 1.1;
  // Half extent of the text box along the walking line (screen px).
  const along = Math.abs(u[0]) * halfW + Math.abs(u[1]) * halfH;
  const back = (STAIR_ARROW_PX + STAIR_UP_GAP_PX + along) / scale;
  if (back + (along + 3) / scale > len) return null;
  const c: Vec2 = [b[0] - u[0] * back, b[1] - u[1] * back];
  const box = { x0: c[0] - halfW / scale, y0: c[1] - halfH / scale, x1: c[0] + halfW / scale, y1: c[1] + halfH / scale };
  return boxFitsRegion(box, { polygon: stair.footprint, holes: [], obstacles: [] }) ? c : null;
}

/** Size (px) of the "Vis hva som er nytt" legend (layers/Legend.tsx) and its margin from the bottom-right corner. */
export const LEGEND_W = 108;
export const LEGEND_H = 3 * 18 + 2 * 8 - 4;
export const LEGEND_MARGIN = 12;

/** Screen box of the legend in a width × height viewport (bottom-right corner). */
export function legendBox(width: number, height: number): ScreenBox {
  const x1 = width - LEGEND_MARGIN;
  const y1 = height - LEGEND_MARGIN;
  return { x0: x1 - LEGEND_W, y0: y1 - LEGEND_H, x1, y1 };
}
