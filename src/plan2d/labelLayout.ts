/**
 * Room label layout for the plan — pure, unit-tested (labelLayout.test.ts), no React.
 *
 * Density (svg.ts `labelDensity`): ≥ 20 px/m full labels, 8–20 px/m names only (small font below 12 px/m),
 * < 8 px/m none. Each room gets the most complete label variant that fits, in this order:
 *   1. full: name / `b × d m` / `m²`, or name / `b × d m · m²` (long, narrow rooms) — normal font, then small
 *   2. compact: name / `m²`                                                     — normal font, then small
 *   3. the name alone                                                           — normal font, then small
 * each with the name on one line, then wrapped onto two (at 'name' density only 3; rooms of type 'apning' always
 * get the name only; below 12 px/m only the small font is used).
 *
 * A variant fits when its actual text rectangle (estimated from Barlow's glyph advances) lies inside the room's
 * inner polygon, outside its holes and outside the obstacles (stair, chimney and post footprints of the storey),
 * and does not overlap a label placed before it. The rectangle is centred on the room's `labelPoint` when it
 * fits there; otherwise the anchor moves towards the bounding-box centre, then to the nearest free spot inside
 * the room (a grid over the bounding box), and is then centred in the free span around that spot (so a label
 * pushed off a stair or a wall does not hug it). Rooms are placed largest first; a room where nothing fits gets no
 * label at this zoom. The text never reaches into a wall (LABEL_CLEARANCE_PX).
 */
import { pointInPolygon } from '../geometry/polygon';
import type { DerivedRoom } from '../model/derived';
import type { Vec2 } from '../model/types';
import { formatDims, formatM2 } from '../ui/format';
import { planStrings } from './strings';
import { FONT_PX } from './style';
import { SMALL_TEXT_BELOW } from './svg';
import type { LabelDensity } from './svg';

// ---------------------------------------------------------------------------
// Text metrics
// ---------------------------------------------------------------------------

/**
 * Advance widths of Barlow (public/fonts, the plan's font) in 1/100 em, rounded up, for the characters of GLYPHS
 * in order: REGULAR_CEM for weight 400 (details), BOLD_CEM for weight 600 (names). Read from the woff2 files'
 * hmtx tables.
 */
const GLYPHS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~æøåÆØÅéÉèüÜöÖäÄ×²·–—’«»…°";
const REGULAR_CEM = [
  20, 32, 27, 66, 56, 85, 66, 14, 27, 27, 40, 50, 27, 40, 28, 40, 57, 35, 54, 52, 56, 52, 52, 48,
  53, 53, 34, 32, 50, 50, 50, 47, 83, 61, 63, 61, 62, 61, 57, 62, 66, 26, 58, 62, 57, 72, 68, 63,
  60, 58, 62, 59, 57, 65, 59, 88, 59, 57, 55, 38, 40, 38, 45, 49, 20, 52, 55, 52, 55, 54, 36, 54,
  54, 26, 25, 51, 23, 83, 54, 55, 56, 56, 37, 49, 37, 54, 48, 73, 48, 47, 45, 31, 17, 31, 51, 84,
  53, 51, 93, 63, 61, 54, 61, 54, 54, 65, 54, 63, 51, 61, 43, 33, 21, 45, 69, 14, 54, 54, 80, 39,
];
const BOLD_CEM = [
  20, 34, 33, 68, 57, 84, 69, 16, 32, 32, 40, 50, 27, 41, 28, 45, 57, 36, 56, 54, 59, 53, 53, 49,
  54, 53, 36, 32, 50, 50, 50, 50, 83, 65, 63, 61, 62, 60, 57, 62, 64, 27, 59, 62, 58, 72, 67, 63,
  60, 59, 62, 60, 58, 64, 61, 88, 62, 60, 56, 41, 45, 41, 47, 51, 22, 53, 56, 54, 56, 55, 38, 55,
  55, 26, 26, 53, 24, 83, 55, 56, 57, 57, 38, 50, 38, 55, 51, 77, 52, 49, 46, 35, 19, 35, 53, 84,
  54, 53, 95, 63, 65, 54, 60, 54, 55, 64, 55, 63, 53, 65, 44, 34, 23, 47, 67, 19, 52, 52, 84, 38,
];
const toMap = (cem: number[]) => new Map([...GLYPHS].map((ch, i) => [ch, cem[i] / 100]));
const REGULAR_EM = toMap(REGULAR_CEM);
const BOLD_EM = toMap(BOLD_CEM);
/** Width assumed for characters missing from the tables (wider than most Barlow glyphs). */
const FALLBACK_EM = 0.62;

/** Text width (px) of `text` at `fontPx` in Barlow, regular (400) or bold (600). */
export function textWidthPx(text: string, fontPx: number, bold = false): number {
  const table = bold ? BOLD_EM : REGULAR_EM;
  let em = 0;
  for (const ch of text) em += table.get(ch) ?? FALLBACK_EM;
  return em * fontPx;
}

// ---------------------------------------------------------------------------
// Label variants
// ---------------------------------------------------------------------------

export interface LabelFont {
  /** Font sizes (px) of the name lines and the detail lines. */
  name: number;
  detail: number;
  /** Line heights (px) of the name lines and the detail lines. */
  line: number;
  detailLine: number;
}

export const LABEL_FONT: LabelFont = { name: FONT_PX.name, detail: FONT_PX.detail, line: 13, detailLine: 12 };
export const LABEL_FONT_SMALL: LabelFont = { name: FONT_PX.nameSmall, detail: FONT_PX.detailSmall, line: 11, detailLine: 10 };

/**
 * The label fonts to try at a zoom (px/m), preferred first: below SMALL_TEXT_BELOW only the small sizes; above it
 * the normal sizes, then the small ones for rooms where a label does not fit otherwise.
 */
export function labelFonts(scale: number): LabelFont[] {
  return scale < SMALL_TEXT_BELOW ? [LABEL_FONT_SMALL] : [LABEL_FONT, LABEL_FONT_SMALL];
}

/** 'full' = name, dimensions and area; 'compact' = name and area; 'name' = name only. */
export type LabelKind = 'full' | 'compact' | 'name';

export interface FittedLabel {
  lines: string[];
  /** The first `nameLines` lines are the (possibly wrapped) name; the rest are details. */
  nameLines: number;
  kind: LabelKind;
  /** Font sizes and line heights the label is laid out with. */
  font: LabelFont;
  /** Size on screen (px). */
  w: number;
  h: number;
  /** Screen offset (px, y down) of each line's centre from the label centre. */
  ys: number[];
}

type LabelText = Pick<DerivedRoom, 'room' | 'dims' | 'area'>;

const roomName = (room: LabelText) => room.room?.name?.trim() || planStrings.unnamedRoom;

/**
 * Text lines of one room label at a given density (empty for 'none'): name, `b × d m` and area in m² with
 * comma decimals. Rooms of type 'apning' get the name only; faces without a Room record are "Uten navn".
 */
export function roomLabelLines(room: LabelText, density: LabelDensity): string[] {
  if (density === 'none') return [];
  const name = roomName(room);
  if (density === 'name' || room.room?.type === 'apning') return [name];
  return [name, formatDims(room.dims.w, room.dims.h, room.dims.approx), formatM2(room.area)];
}

/** Shortest line a wrapped name may have ("Soverom 3" is not split into "Soverom" / "3"). */
const MIN_WRAP_LINE = 3;

/**
 * A name split into two balanced lines at a space, or null when it cannot be split: no space, or every split
 * leaves a line shorter than MIN_WRAP_LINE characters. A token without letters or digits ("/", "&") stays at the
 * end of the line before it ("Teknisk /" / "vask").
 */
export function wrapName(name: string): [string, string] | null {
  const words: string[] = [];
  for (const w of name.split(' ')) {
    if (w.length === 0) continue;
    if (words.length > 0 && !/[\p{L}\p{N}]/u.test(w)) words[words.length - 1] += ` ${w}`;
    else words.push(w);
  }
  let best: [string, string] | null = null;
  for (let i = 1; i < words.length; i++) {
    const pair: [string, string] = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    if (Math.min(pair[0].length, pair[1].length) < MIN_WRAP_LINE) continue;
    if (!best || Math.max(pair[0].length, pair[1].length) < Math.max(best[0].length, best[1].length)) best = pair;
  }
  return best;
}

/** Joins dimensions and area on one line in the wide full variant. */
const DETAIL_JOIN = ' · ';

function makeLabel(nameLines: string[], details: string[], kind: LabelKind, font: LabelFont): FittedLabel {
  const lines = [...nameLines, ...details];
  const heights = lines.map((_, i) => (i < nameLines.length ? font.line : font.detailLine));
  const h = heights.reduce((a, b) => a + b, 0);
  let top = -h / 2;
  const ys = heights.map((lh) => {
    const y = top + lh / 2;
    top += lh;
    return y;
  });
  const w = Math.max(...lines.map((t, i) => (i < nameLines.length ? textWidthPx(t, font.name, true) : textWidthPx(t, font.detail))));
  return { lines, nameLines: nameLines.length, kind, font, w, h, ys };
}

/**
 * All label variants of a room at a density, most complete first (see the file comment): the full layouts, then
 * the compact one, then the name alone; within each kind every layout in the first of `fonts` before any in the
 * next (a smaller font only where the label does not fit otherwise), the name on one line before it is wrapped.
 * Empty for 'none'.
 */
export function labelVariants(room: LabelText, density: LabelDensity, fonts: readonly LabelFont[]): FittedLabel[] {
  if (density === 'none') return [];
  const name = roomName(room);
  const wrapped = wrapName(name);
  const names: string[][] = wrapped ? [[name], wrapped] : [[name]];
  const kinds: [LabelKind, string[][]][] = [];
  if (density === 'full' && room.room?.type !== 'apning') {
    const dims = formatDims(room.dims.w, room.dims.h, room.dims.approx);
    const area = formatM2(room.area);
    kinds.push(['full', [[dims, area], [`${dims}${DETAIL_JOIN}${area}`]]], ['compact', [[area]]]);
  }
  kinds.push(['name', [[]]]);
  const out: FittedLabel[] = [];
  for (const [kind, layouts] of kinds) {
    for (const font of fonts) for (const details of layouts) for (const n of names) out.push(makeLabel(n, details, kind, font));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fitting a rectangle into a room
// ---------------------------------------------------------------------------

/** Axis-aligned box in plan metres. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where a label may go: the room's inner polygon minus its holes and the storey's obstacles. */
export interface LabelRegion {
  polygon: Vec2[];
  holes: Vec2[][];
  obstacles: Vec2[][];
}

/** True when the segment a–b has a part of positive length inside the box (or is a point strictly inside it). */
export function segmentEntersBox(a: Vec2, b: Vec2, box: Box): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - box.x0, box.x1 - a[0], a[1] - box.y0, box.y1 - a[1]];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] <= 0) return false;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r >= t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r <= t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t1 > t0;
}

function ringEntersBox(ring: Vec2[], box: Box): boolean {
  for (let i = 0; i < ring.length; i++) {
    if (segmentEntersBox(ring[i], ring[(i + 1) % ring.length], box)) return true;
  }
  return false;
}

/** True when the box lies inside the region: inside the polygon, clear of every hole and obstacle. */
export function boxFitsRegion(box: Box, region: LabelRegion): boolean {
  const corners: Vec2[] = [
    [box.x0, box.y0],
    [box.x1, box.y0],
    [box.x1, box.y1],
    [box.x0, box.y1],
  ];
  if (region.polygon.length < 3) return false;
  for (const c of corners) if (!pointInPolygon(c, region.polygon)) return false;
  if (ringEntersBox(region.polygon, box)) return false;
  const centre: Vec2 = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
  for (const list of [region.holes, region.obstacles]) {
    for (const ring of list) {
      if (ring.length < 3) continue;
      if (ringEntersBox(ring, box) || pointInPolygon(centre, ring)) return false;
    }
  }
  return true;
}

const boxesOverlap = (a: Box, b: Box, gap: number) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

/**
 * Clearance (px) between the text rectangle and the room's inner face: horizontally the text keeps 0.5 px off the
 * wall (glyph advances already include their side bearings); vertically the line boxes may reach 1 px into it
 * (their leading is empty), so the ink never touches a wall.
 */
export const LABEL_CLEARANCE_PX = { x: 0.5, y: -1 } as const;

/** Half size (plan metres) of the rectangle a label of w × h px must fit inside its room at `scale` px/m. */
export function labelFitHalfSize(w: number, h: number, scale: number): [number, number] {
  return [Math.max(w / 2 + LABEL_CLEARANCE_PX.x, 0.5) / scale, Math.max(h / 2 + LABEL_CLEARANCE_PX.y, 0.5) / scale];
}

/** Minimum gap (px) between two labels. */
const LABEL_GAP_PX = 2;
/** Spacing (px) of the grid of fallback anchors, and the maximum number of steps per axis. */
const GRID_STEP_PX = 4;
const GRID_MAX_STEPS = 16;

type LabelRoom = Pick<DerivedRoom, 'id' | 'room' | 'dims' | 'area' | 'bbox' | 'labelPoint' | 'polygon' | 'holes'>;

/**
 * Anchors to try for a label of half size (hw, hh) metres, best first: the label point, four steps towards the
 * bounding-box centre, then a grid over the bounding box (only where the box fits) by distance to the label point.
 */
function* anchors(room: LabelRoom, hw: number, hh: number, scale: number): Generator<Vec2> {
  const lp = room.labelPoint;
  const { min, max } = room.bbox;
  const c: Vec2 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  yield lp;
  for (const t of [0.25, 0.5, 0.75, 1]) yield [lp[0] + (c[0] - lp[0]) * t, lp[1] + (c[1] - lp[1]) * t];
  const x0 = min[0] + hw;
  const x1 = max[0] - hw;
  const y0 = min[1] + hh;
  const y1 = max[1] - hh;
  if (x1 < x0 || y1 < y0) return;
  const step = GRID_STEP_PX / scale;
  const nx = Math.min(GRID_MAX_STEPS, Math.floor((x1 - x0) / step));
  const ny = Math.min(GRID_MAX_STEPS, Math.floor((y1 - y0) / step));
  const pts: Vec2[] = [];
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) pts.push([nx === 0 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / nx, ny === 0 ? (y0 + y1) / 2 : y0 + ((y1 - y0) * j) / ny]);
  }
  const d2 = (p: Vec2) => (p[0] - lp[0]) ** 2 + (p[1] - lp[1]) ** 2;
  pts.sort((a, b) => d2(a) - d2(b));
  yield* pts;
}

export interface PlacedRoomLabel<R> {
  room: R;
  label: FittedLabel;
  /** Centre of the label in plan coordinates. */
  at: Vec2;
}

function ringBox(ring: Vec2[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

/**
 * Labels for all rooms of a storey that stay inside their rooms (clear of holes and `obstacles`) and do not
 * overlap each other: largest room first, each with its most complete variant that has a free anchor.
 * `fonts` are tried in order within each layout (see `labelFonts`).
 */
export function layoutRoomLabels<R extends LabelRoom>(
  rooms: R[],
  density: LabelDensity,
  scale: number,
  fonts: readonly LabelFont[],
  obstacles: Vec2[][] = [],
): PlacedRoomLabel<R>[] {
  const out: PlacedRoomLabel<R>[] = [];
  if (density === 'none' || !(scale > 0)) return out;
  const placed: Box[] = [];
  const gap = LABEL_GAP_PX / scale;
  const obstacleBoxes = obstacles.map((o) => ({ ring: o, box: ringBox(o) }));
  for (const room of [...rooms].sort((a, b) => b.area - a.area)) {
    const { min, max } = room.bbox;
    const roomBox: Box = { x0: min[0], y0: min[1], x1: max[0], y1: max[1] };
    const region: LabelRegion = {
      polygon: room.polygon,
      holes: room.holes,
      obstacles: obstacleBoxes.filter((o) => boxesOverlap(o.box, roomBox, 0)).map((o) => o.ring),
    };
    variants: for (const label of labelVariants(room, density, fonts)) {
      const [hw, hh] = labelFitHalfSize(label.w, label.h, scale);
      if (2 * hw > max[0] - min[0] || 2 * hh > max[1] - min[1]) continue;
      const fw = label.w / 2 / scale;
      const fh = label.h / 2 / scale;
      const free = (at: Vec2) =>
        !placed.some((p) => boxesOverlap({ x0: at[0] - fw, y0: at[1] - fh, x1: at[0] + fw, y1: at[1] + fh }, p, gap)) &&
        boxFitsRegion({ x0: at[0] - hw, y0: at[1] - hh, x1: at[0] + hw, y1: at[1] + hh }, region);
      for (const found of anchors(room, hw, hh, scale)) {
        if (!free(found)) continue;
        // Moved off the label point: centre the label in the free span around where it fits, so it does not hug a
        // wall or the stair it was pushed away from.
        const at = found === room.labelPoint ? found : centreInFreeSpan(found, free, roomBox, scale);
        placed.push({ x0: at[0] - fw, y0: at[1] - fh, x1: at[0] + fw, y1: at[1] + fh });
        out.push({ room, label, at });
        break variants;
      }
    }
  }
  return out;
}

/** Step (px) and maximum number of steps per direction when measuring the free span around an anchor. */
const SPAN_STEP_PX = 2;
const SPAN_MAX_STEPS = 100;

/**
 * Centre of the free span around a fitting anchor: first along x, then along y, each the midpoint between the
 * last free positions found stepping out from the anchor in both directions (contiguous, so the midpoint fits).
 */
function centreInFreeSpan(at: Vec2, free: (p: Vec2) => boolean, bounds: Box, scale: number): Vec2 {
  let p: Vec2 = at;
  for (const axis of [0, 1] as const) {
    const extent = axis === 0 ? bounds.x1 - bounds.x0 : bounds.y1 - bounds.y0;
    const step = Math.max(SPAN_STEP_PX / scale, extent / SPAN_MAX_STEPS);
    const reach = (dir: 1 | -1) => {
      let last = p[axis];
      for (let i = 1; i <= SPAN_MAX_STEPS; i++) {
        const q: Vec2 = [p[0], p[1]];
        q[axis] = p[axis] + dir * i * step;
        if (!free(q)) break;
        last = q[axis];
      }
      return last;
    };
    const mid = (reach(-1) + reach(1)) / 2;
    const q: Vec2 = [p[0], p[1]];
    q[axis] = mid;
    if (free(q)) p = q;
  }
  return p;
}
