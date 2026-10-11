/**
 * Pure drawing decisions used by the layer components (kept out of the .tsx files so React fast refresh
 * works and so they can be unit-tested without rendering).
 */
import type { DerivedDimension, DerivedRoom } from '../model/derived';
import type { ElementStatus, Vec2 } from '../model/types';
import { formatDims, formatM2, formatNumber } from '../ui/format';
import { planStrings } from './strings';
import { COLORS } from './style';
import { dimensionGeometry, ringPath } from './svg';
import type { LabelDensity } from './svg';
import type { Rect } from './viewport';

/** Wall union paint: existing dark; new tinted only with "highlight new"; removed dashed grey without fill. */
export function wallPaint(status: ElementStatus, highlightNew: boolean): { fill: string; stroke: string; dash?: string } {
  if (status === 'removed') return { fill: 'none', stroke: COLORS.wallRemoved, dash: '4 3' };
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

/**
 * Text lines of one room label at a given density (empty for 'none'): name, `b × d m` and area in m² with
 * comma decimals. Rooms of type 'apning' get the name only; faces without a Room record are "Uten navn".
 */
export function roomLabelLines(room: Pick<DerivedRoom, 'room' | 'dims' | 'area'>, density: LabelDensity): string[] {
  if (density === 'none') return [];
  const name = room.room?.name?.trim() || planStrings.unnamedRoom;
  if (density === 'name' || room.room?.type === 'apning') return [name];
  return [name, formatDims(room.dims.w, room.dims.h, room.dims.approx), formatM2(room.area)];
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

/** Rough text width (px) of `text` at `fontPx` (Barlow / Barlow Semi Condensed average advance ≈ 0.56 em). */
export function textWidthPx(text: string, fontPx: number): number {
  return text.length * fontPx * 0.56;
}

/** A name split into two balanced lines at a space, or null when it has no space. */
export function wrapName(name: string): [string, string] | null {
  const words = name.split(' ');
  if (words.length < 2) return null;
  let best: [string, string] | null = null;
  for (let i = 1; i < words.length; i++) {
    const pair: [string, string] = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    if (!best || Math.max(pair[0].length, pair[1].length) < Math.max(best[0].length, best[1].length)) best = pair;
  }
  return best;
}

/** How far (px) a label may reach into the walls on either side of its room. */
const LABEL_OVERHANG_PX = 4;

export interface FittedLabel {
  lines: string[];
  /** The first `nameLines` lines are the (possibly wrapped) name; the rest are details. */
  nameLines: number;
  /** Estimated size on screen (px). */
  w: number;
  h: number;
}

export interface LabelFont {
  name: number;
  detail: number;
  line: number;
}

/**
 * The room label variants that fit inside the room at the current zoom (`scale` px/m), most complete first: the
 * full label, the name wrapped onto two lines with the details, the name alone, the wrapped name alone — each kept
 * when its widest line fits the room's inner width (plus 4 px into each wall: the text has a paper halo) and its
 * height fits the room's depth. Empty when nothing fits (zoom in to read it).
 */
export function roomLabelCandidates(
  room: Pick<DerivedRoom, 'room' | 'dims' | 'area' | 'bbox'>,
  density: LabelDensity,
  scale: number,
  font: LabelFont,
): FittedLabel[] {
  const lines = roomLabelLines(room, density);
  if (lines.length === 0) return [];
  const [name, ...details] = lines;
  const wrapped = wrapName(name);
  const variants: Omit<FittedLabel, 'w' | 'h'>[] = [{ lines, nameLines: 1 }];
  if (wrapped && details.length > 0) variants.push({ lines: [...wrapped, ...details], nameLines: 2 });
  if (details.length > 0) variants.push({ lines: [name], nameLines: 1 });
  if (wrapped) variants.push({ lines: wrapped, nameLines: 2 });
  const availW = (room.bbox.max[0] - room.bbox.min[0]) * scale + 2 * LABEL_OVERHANG_PX;
  const availH = (room.bbox.max[1] - room.bbox.min[1]) * scale;
  const out: FittedLabel[] = [];
  for (const v of variants) {
    const w = Math.max(...v.lines.map((t, i) => textWidthPx(t, i < v.nameLines ? font.name : font.detail)));
    const h = v.lines.length * font.line;
    if (w <= availW && h <= availH) out.push({ ...v, w, h });
  }
  return out;
}

/** The most complete label variant that fits the room, or no lines (see `roomLabelCandidates`). */
export function fitRoomLabel(
  room: Pick<DerivedRoom, 'room' | 'dims' | 'area' | 'bbox'>,
  density: LabelDensity,
  scale: number,
  font: LabelFont,
): FittedLabel {
  return roomLabelCandidates(room, density, scale, font)[0] ?? { lines: [], nameLines: 0, w: 0, h: 0 };
}

type LabelRoom = Pick<DerivedRoom, 'id' | 'room' | 'dims' | 'area' | 'bbox' | 'labelPoint'>;

/**
 * Labels for all rooms of a storey that neither leave their room nor overlap each other: rooms are placed largest
 * first, each with its most complete variant that does not overlap a label placed before it (2 px gap); a room
 * whose variants all collide gets no label at this zoom.
 */
export function layoutRoomLabels<R extends LabelRoom>(rooms: R[], density: LabelDensity, scale: number, font: LabelFont): { room: R; label: FittedLabel }[] {
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const out: { room: R; label: FittedLabel }[] = [];
  const gap = 2;
  for (const room of [...rooms].sort((a, b) => b.area - a.area)) {
    const cx = room.labelPoint[0] * scale;
    const cy = room.labelPoint[1] * scale;
    for (const c of roomLabelCandidates(room, density, scale, font)) {
      const r = { x0: cx - c.w / 2, x1: cx + c.w / 2, y0: cy - c.h / 2, y1: cy + c.h / 2 };
      if (placed.some((p) => r.x0 < p.x1 + gap && p.x0 < r.x1 + gap && r.y0 < p.y1 + gap && p.y0 < r.y1 + gap)) continue;
      placed.push(r);
      out.push({ room, label: c });
      break;
    }
  }
  return out;
}
