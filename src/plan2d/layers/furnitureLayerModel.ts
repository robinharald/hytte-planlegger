/**
 * Pure helpers of the plan's furniture layer (FurnitureLayer.tsx): which items get the red collision outline, where
 * the rotate handle sits and what a drag on it turns the item to, when a name label fits, colours. No React.
 *
 *  - Red outline ("kolliderer"): the item overlaps another item or a wall, or stands in a door's swing — its own
 *    `collisions` / `blocksDoors`, or a 'furniture-overlap' / 'furniture-in-wall' / 'door-blocked' warning naming it.
 *  - Rotate handle (docs/phase2-plan.md §3.1 handles: a white circle with an accent border, 7 px / 14 px coarse): on
 *    the FRONT edge of the selected item (the local south edge, furnitureSymbols.ts), one handle radius plus a 6 px
 *    stem outside it, joined to the edge's midpoint. A tap turns the item 90° (like «Roter 90°»); a drag turns it so
 *    its front faces the pointer, in ROTATE_STEP_DEG steps (1° with Alt), applied as ONE rotation on release.
 */
import { catalogItem } from '../../furniture/catalog';
import type { DerivedFurniture, ModelWarning } from '../../model/derived';
import type { Id, Vec2 } from '../../model/types';
import { convexOverlap } from '../furniturePlacement';
import { boxFitsRegion, labelFitHalfSize, labelVariants, layoutRoomLabels } from '../labelLayout';
import type { LabelFont, LabelRegion, PlacedRoomLabel } from '../labelLayout';
import type { LabelDensity } from '../svg';
import { FONT_PX } from '../style';

/** Main line colour of furniture (a little lighter than the walls, so the building still reads first). */
export const FURNITURE_INK = '#4b544d';
/** Fill of cushions, pillows, backrests, cisterns. */
export const FURNITURE_SOFT = '#e4e8e1';
export const FURNITURE_GLASS = '#4d7da0';

/** Light body fills of the colour names the phase-2a Møbel editor stored (before the catalogue's swatches). */
export const COLOUR_FILLS: Readonly<Record<string, string>> = {
  white: '#ffffff',
  wood: '#f1e4cf',
  grey: '#e6e8e6',
  green: '#e1ebdf',
  black: '#d5d8d5',
};

/** Share of the item colour in a symbol's body fill (the rest is paper), so symbols stay light and readable. */
export const COLOUR_TINT = 0.32;

/**
 * Body fill of a symbol for `FurnitureItem.colour`: a catalogue swatch ('#rrggbb') mixed with `paper`, an old colour
 * name its light fill, anything else (none) `paper`.
 */
export function bodyFill(colour: string | undefined, paper: string): string {
  if (!colour) return paper;
  const m = /^#([0-9a-f]{6})$/i.exec(colour);
  const p = /^#([0-9a-f]{6})$/i.exec(paper);
  if (m && p) {
    const c = parseInt(m[1], 16);
    const q = parseInt(p[1], 16);
    const mix = (shift: number) => Math.round(((c >> shift) & 255) * COLOUR_TINT + ((q >> shift) & 255) * (1 - COLOUR_TINT));
    return `#${[16, 8, 0].map((s) => mix(s).toString(16).padStart(2, '0')).join('')}`;
  }
  return Object.prototype.hasOwnProperty.call(COLOUR_FILLS, colour) ? COLOUR_FILLS[colour] : paper;
}

/** Outline colour of an item that collides (the app's danger red). */
export const COLLISION = '#b3261e';
/** Rotation steps (degrees) of a rotate-handle drag. */
export const ROTATE_STEP_DEG = 15;
export const ROTATE_STEP_FINE_DEG = 1;
/** Pixels between the front edge and the rotate handle's rim. */
export const ROTATE_STEM_PX = 6;
/** A name label is drawn only on items at least this many pixels across on screen. */
export const MIN_LABEL_PX = 18;
/** An appliance code ("VM", "KJ") is drawn from this size (px) on. */
export const MIN_CODE_PX = 14;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Local point (item frame) → plan point. */
export function toPlan(item: { position: Vec2; rotationDeg: number }, local: Vec2): Vec2 {
  const a = rad(item.rotationDeg);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [item.position[0] + c * local[0] - s * local[1], item.position[1] + s * local[0] + c * local[1]];
}

/** Ids of items drawn with the red collision outline (see the header), sorted. */
export function collidingFurnitureIds(items: readonly DerivedFurniture[], warnings: readonly ModelWarning[]): Id[] {
  const ids = new Set<Id>();
  const known = new Set(items.map((f) => f.id));
  for (const f of items) if (f.collisions.length > 0 || f.blocksDoors.length > 0) ids.add(f.id);
  for (const w of warnings) {
    if (w.kind === 'furniture-overlap') for (const id of w.furnitureIds) ids.add(id);
    else if (w.kind === 'furniture-in-wall') ids.add(w.furnitureId);
    else if (w.kind === 'door-blocked' && known.has(w.by)) ids.add(w.by);
  }
  return [...ids].filter((id) => known.has(id)).sort();
}

/** The rotate handle of an item at plan scale `scale` (px/m) with handle radius `handleR` (px). */
export function rotateHandle(item: { position: Vec2; rotationDeg: number; size: { w: number; d: number } }, scale: number, handleR: number): { edge: Vec2; centre: Vec2; r: number } {
  const s = scale > 0 ? scale : 1;
  const edge = toPlan(item, [0, -item.size.d / 2]);
  const out = (handleR + ROTATE_STEM_PX) / s;
  const centre = toPlan(item, [0, -item.size.d / 2 - out]);
  return { edge, centre, r: handleR / s };
}

/** Degrees normalised to (−180, 180]. */
export function wrap180(deg: number): number {
  let v = deg % 360;
  if (v <= -180) v += 360;
  if (v > 180) v -= 360;
  return Math.abs(v) < 1e-9 ? 0 : v;
}

/**
 * A rotate-handle drag: the turn (degrees, CCW, in (−180, 180]) that makes the item's front face the plan point
 * `pointer`, snapped to `step` degrees of absolute rotation. 0 when the pointer is on the item's centre.
 */
export function rotationToward(item: { position: Vec2; rotationDeg: number }, pointer: Vec2, step = ROTATE_STEP_DEG): number {
  const dx = pointer[0] - item.position[0];
  const dy = pointer[1] - item.position[1];
  if (Math.hypot(dx, dy) < 1e-9) return 0;
  // The front (local −y) points along rotation − 90°: a front towards the pointer means rotation = angle + 90°.
  const target = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  const snapped = step > 0 ? Math.round(target / step) * step : target;
  return wrap180(snapped - item.rotationDeg);
}

/** Can the name label (font FONT_PX.small) sit inside the item's screen box? */
export function labelFits(name: string, bbox: { min: Vec2; max: Vec2 }, scale: number): boolean {
  const wPx = (bbox.max[0] - bbox.min[0]) * scale;
  const hPx = (bbox.max[1] - bbox.min[1]) * scale;
  if (Math.min(wPx, hPx) < MIN_LABEL_PX) return false;
  return name.length * FONT_PX.small * 0.56 <= wPx - 6;
}

/**
 * Label obstacles of the furniture (room names keep clear of it, see `layoutLabelsClearOfFurniture`): the footprints
 * of every item that is not flat (rugs and drains may lie under a name). `flat: true`: every footprint (the hit test
 * of `labelsOverFurniture`: a name on a rug must win over the rug too).
 */
export function furnitureLabelObstacles(items: readonly DerivedFurniture[], opts: { flat?: boolean } = {}): Vec2[][] {
  return items.filter((f) => f.footprint.length >= 3 && (opts.flat || ((f.item.size?.h ?? 1) >= 0.05 && catalogItem(f.item.catalogId)?.mount !== 'flat'))).map((f) => f.footprint);
}

/** Anchor grid of a label moved off furniture: step (px) and steps per axis at most. */
const MOVE_STEP_PX = 4;
const MOVE_MAX_STEPS = 16;

/**
 * Room labels that keep clear of the furniture where they can (the plan draws the furniture's hit areas above the
 * labels' so a tap on a sofa under a name selects the sofa; a name moved off the furniture stays tappable): the labels
 * are laid out as before (labelLayout.ts); a label that lands on furniture moves to the nearest place in its room that
 * is clear of the walls, the furniture, the other obstacles and the other labels — with the same text, else a shorter
 * one ("name / m²", the name alone) — and keeps its first place when there is none (no room loses its name to its
 * furniture). A furnished plan therefore shows fewer areas in the labels (11 of 21 at the desktop's starting zoom;
 * Romskjema and Egenskaper have them all), but the bed under a bedroom's name can be tapped.
 */
export function layoutLabelsClearOfFurniture<R extends Parameters<typeof layoutRoomLabels>[0][number]>(
  rooms: R[],
  density: LabelDensity,
  scale: number,
  fonts: readonly LabelFont[],
  obstacles: Vec2[][],
  furniture: Vec2[][],
): PlacedRoomLabel<R>[] {
  const base = layoutRoomLabels(rooms, density, scale, fonts, obstacles);
  if (furniture.length === 0 || !(scale > 0)) return base;
  const onFurniture = new Set(labelsOverFurniture(base, furniture, scale));
  if (onFurniture.size === 0) return base;
  const placed = base.map((l) => fitBoxRing(l, scale));
  const blockers = [...obstacles, ...furniture];
  return base.map((l, i) => {
    if (!onFurniture.has(l)) return l;
    const others = placed.filter((_, j) => j !== i);
    // The same text first, then the shorter ones of its font ("name / m²", the name alone).
    const area = l.label.w * l.label.h;
    const shorter = labelVariants(l.room, density, fonts).filter((v) => v.font === l.label.font && v.kind !== 'full' && v.w * v.h < area - 1e-9);
    for (const label of [l.label, ...shorter]) {
      const at = freeSpotFor({ ...l, label }, scale, blockers, others);
      if (!at) continue;
      placed[i] = fitBoxRing({ label, at }, scale);
      return { ...l, label, at };
    }
    return l;
  });
}

/** The nearest anchor (a grid over the room's box, by distance from the label's place) where the label fits. */
function freeSpotFor<R extends Parameters<typeof layoutRoomLabels>[0][number]>(l: PlacedRoomLabel<R>, scale: number, blockers: Vec2[][], others: Vec2[][]): Vec2 | null {
  const room = l.room;
  const [hw, hh] = labelFitHalfSize(l.label.w, l.label.h, scale);
  const { min, max } = room.bbox;
  const x0 = min[0] + hw;
  const x1 = max[0] - hw;
  const y0 = min[1] + hh;
  const y1 = max[1] - hh;
  if (x1 < x0 || y1 < y0) return null;
  const inRoom = (r: Vec2[]) => {
    let rx0 = Infinity;
    let ry0 = Infinity;
    let rx1 = -Infinity;
    let ry1 = -Infinity;
    for (const q of r) {
      rx0 = Math.min(rx0, q[0]);
      ry0 = Math.min(ry0, q[1]);
      rx1 = Math.max(rx1, q[0]);
      ry1 = Math.max(ry1, q[1]);
    }
    return rx0 <= max[0] && rx1 >= min[0] && ry0 <= max[1] && ry1 >= min[1];
  };
  const region: LabelRegion = { polygon: room.polygon, holes: room.holes, obstacles: [...blockers, ...others].filter(inRoom) };
  const step = MOVE_STEP_PX / scale;
  const nx = Math.min(MOVE_MAX_STEPS, Math.floor((x1 - x0) / step));
  const ny = Math.min(MOVE_MAX_STEPS, Math.floor((y1 - y0) / step));
  const pts: Vec2[] = [];
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) pts.push([nx === 0 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / nx, ny === 0 ? (y0 + y1) / 2 : y0 + ((y1 - y0) * j) / ny]);
  const d2 = (p: Vec2) => (p[0] - l.at[0]) ** 2 + (p[1] - l.at[1]) ** 2;
  pts.sort((a, b) => d2(a) - d2(b));
  const fits = (p: Vec2) => boxFitsRegion({ x0: p[0] - hw, y0: p[1] - hh, x1: p[0] + hw, y1: p[1] + hh }, region);
  const found = pts.find(fits);
  return found ? centreInSpan(found, fits, MOVE_STEP_PX / 2 / scale) : null;
}

/** Steps (each way) when centring a moved label in the free span around where it fits. */
const SPAN_STEPS = 40;

/** The middle of the free span around a fitting point, first along x, then along y (clear of walls and furniture). */
function centreInSpan(at: Vec2, fits: (p: Vec2) => boolean, step: number): Vec2 {
  let p = at;
  for (const axis of [0, 1] as const) {
    const reach = (dir: 1 | -1) => {
      let last = p[axis];
      for (let i = 1; i <= SPAN_STEPS; i++) {
        const q: Vec2 = [p[0], p[1]];
        q[axis] = p[axis] + dir * i * step;
        if (!fits(q)) break;
        last = q[axis];
      }
      return last;
    };
    const q: Vec2 = [p[0], p[1]];
    q[axis] = (reach(-1) + reach(1)) / 2;
    if (fits(q)) p = q;
  }
  return p;
}

/** A placed label's fit box (labelLayout.ts `labelFitHalfSize`) as a ring, plan metres. */
function fitBoxRing(l: { label: { w: number; h: number }; at: Vec2 }, scale: number): Vec2[] {
  const [hw, hh] = labelFitHalfSize(l.label.w, l.label.h, scale);
  return [
    [l.at[0] - hw, l.at[1] - hh],
    [l.at[0] + hw, l.at[1] - hh],
    [l.at[0] + hw, l.at[1] + hh],
    [l.at[0] - hw, l.at[1] + hh],
  ];
}

/**
 * The labels that had to be put on furniture (no free place in the room at this zoom): the plan gives their hit
 * areas precedence over the furniture's, so the name you see on top is what a tap on it selects (zoom in to reach
 * the item under it). Same order as `labels`.
 */
export function labelsOverFurniture<L extends { label: { w: number; h: number }; at: Vec2 }>(labels: readonly L[], furniture: readonly Vec2[][], scale: number): L[] {
  if (furniture.length === 0 || !(scale > 0)) return [];
  return labels.filter((l) => {
    const box = fitBoxRing(l, scale);
    return furniture.some((f) => convexOverlap(box, f, 0));
  });
}

/** Can an appliance code sit inside the item (its smaller side on screen)? */
export function codeFits(code: string, size: { w: number; d: number }, scale: number): boolean {
  const m = Math.min(size.w, size.d) * scale;
  return m >= MIN_CODE_PX && code.length * FONT_PX.small * 0.6 <= Math.max(size.w, size.d) * scale - 4;
}
