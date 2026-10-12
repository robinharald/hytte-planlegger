/**
 * Reads what the edit API hands back (drag feedback, snap results, new ids) into the plain shapes the overlay draws.
 * Pure, unit-tested (editFeedback.test.ts).
 *
 * The plan was built in parallel with state/editActions.ts and geometry/snap.ts, so these readers accept the
 * plausible shapes rather than one exact type (docs/phase2-plan.md §3.3/§3.6 name the fields, not their shapes):
 *  - indicators: items with a point (`p` | `point` | `at` | `position`) → marker, or two points (`a`/`b` |
 *    `from`/`to`) → guide line; `kind` (or `type`) is kept for styling;
 *  - chips: `{ a, b }` with `text`, or a number (`value` | `distance` | `length`, metres → "1,20 m"); an optional
 *    `at` places the chip (default: the middle of a–b); a chip with neither text nor number is dropped;
 *  - ghost: a ring `Vec2[]`, rings `Vec2[][]`, a MultiPolygon `Vec2[][][]`, `{ polygon }`, `{ polygons }`,
 *    `{ rings }`, `{ outline }` or a segment `{ a, b }`; a drag preview's `target` (the dragged element's moving
 *    outline) takes the same shapes (`normalizePreview`);
 *  - snap results: `{ point, indicators, chips }` (or `p` / `snapped` for the point), else a bare Vec2;
 *  - ids: a string, or `{ id }`.
 * Anything else is ignored; nothing here throws.
 */
import type { Id, Vec2 } from '../model/types';
import { formatLength } from '../ui/format';
import type { PlanChip, PlanFeedback, PlanGuide, PlanMarker } from './editTypes';

export const EMPTY_FEEDBACK: PlanFeedback = { markers: [], guides: [], chips: [], ghost: [] };

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export function isVec2(v: unknown): v is Vec2 {
  return Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && Number.isFinite(v[0]) && Number.isFinite(v[1]);
}

const vec = (v: unknown): Vec2 | null => (isVec2(v) ? [v[0], v[1]] : null);

function firstVec(r: Rec, keys: readonly string[]): Vec2 | null {
  for (const k of keys) {
    const v = vec(r[k]);
    if (v) return v;
  }
  return null;
}

function firstNumber(r: Rec, keys: readonly string[]): number | null {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

const kindOf = (r: Rec, fallback: string): string => (typeof r.kind === 'string' ? r.kind : typeof r.type === 'string' ? r.type : fallback);

export const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Chip text for a length in metres: two decimals with a comma ("1,20 m"). */
export function chipText(metres: number): string {
  return formatLength(metres, 2);
}

function readIndicators(raw: unknown): { markers: PlanMarker[]; guides: PlanGuide[] } {
  const markers: PlanMarker[] = [];
  const guides: PlanGuide[] = [];
  if (!Array.isArray(raw)) return { markers, guides };
  for (const item of raw) {
    if (!isRec(item)) continue;
    const a = firstVec(item, ['a', 'from', 'start']);
    const b = firstVec(item, ['b', 'to', 'end']);
    if (a && b) {
      guides.push({ kind: kindOf(item, 'line'), a, b });
      continue;
    }
    const p = firstVec(item, ['p', 'point', 'at', 'position']);
    if (p) markers.push({ kind: kindOf(item, 'point'), p });
  }
  return { markers, guides };
}

function readChips(raw: unknown): PlanChip[] {
  const out: PlanChip[] = [];
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!isRec(item)) continue;
    const a = firstVec(item, ['a', 'from', 'start']);
    const b = firstVec(item, ['b', 'to', 'end']);
    const n = firstNumber(item, ['value', 'distance', 'length']);
    const text = typeof item.text === 'string' && item.text.length > 0 ? item.text : typeof item.label === 'string' && item.label.length > 0 ? item.label : n !== null ? chipText(n) : a && b ? chipText(Math.hypot(b[0] - a[0], b[1] - a[1])) : null;
    const at = firstVec(item, ['at', 'p', 'position']) ?? (a && b ? mid(a, b) : null);
    if (text === null || !at) continue;
    const chip: PlanChip = { at, text };
    if (a && b) {
      chip.a = a;
      chip.b = b;
    }
    out.push(chip);
  }
  return out;
}

/** Rings from any of the ghost shapes (see the header). */
export function readGhost(raw: unknown): Vec2[][] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    if (raw.length === 0) return [];
    if (isVec2(raw[0])) {
      const ring = raw.map(vec).filter((p): p is Vec2 => p !== null);
      return ring.length >= 2 ? [ring] : [];
    }
    return raw.flatMap((x) => readGhost(x));
  }
  if (!isRec(raw)) return [];
  for (const k of ['polygon', 'polygons', 'rings', 'outline', 'footprint']) {
    if (raw[k] !== undefined) return readGhost(raw[k]);
  }
  const a = firstVec(raw, ['a', 'from']);
  const b = firstVec(raw, ['b', 'to']);
  return a && b ? [[a, b]] : [];
}

/** Drag feedback (`updateDrag`'s `{ indicators, chips, ghost }`), or the empty feedback. */
export function normalizeFeedback(raw: unknown): PlanFeedback {
  if (!isRec(raw)) return EMPTY_FEEDBACK;
  const { markers, guides } = readIndicators(raw.indicators);
  return { markers, guides, chips: readChips(raw.chips), ghost: readGhost(raw.ghost) };
}

/**
 * Drag feedback with the dragged element's MOVING outline kept apart from the base ghost: `target` holds the rings of
 * the element where the frame puts it (`previewDrag`'s `target`, state/editActions.ts `DragPreview`), `ghost` the base
 * outline (the element at pointer-down). The overlay draws both (usePlanEditing.ts `previewFeedback` appends the
 * target rings to `ghost`, after the base); `target` is kept so the overlay can style the moving outline apart.
 */
export interface PlanDragFeedback extends PlanFeedback {
  target: Vec2[][];
}

/**
 * A `previewDrag` answer `{ indicators, chips, ghost, target }` (fix round after 2b: `normalizeFeedback` alone dropped
 * `target`, so the per-frame preview never drew the dragged element). Missing / unreadable `target`: none.
 */
export function normalizePreview(raw: unknown): PlanDragFeedback {
  return { ...normalizeFeedback(raw), target: isRec(raw) ? readGhost(raw.target) : [] };
}

/** A snap result: the snapped point (else `fallback`) and its feedback. */
export function normalizeSnap(raw: unknown, fallback: Vec2): { point: Vec2; feedback: PlanFeedback } {
  if (isVec2(raw)) return { point: [raw[0], raw[1]], feedback: EMPTY_FEEDBACK };
  if (!isRec(raw)) return { point: fallback, feedback: EMPTY_FEEDBACK };
  const point = firstVec(raw, ['point', 'p', 'snapped', 'at']) ?? fallback;
  return { point, feedback: normalizeFeedback(raw) };
}

/** Id of a newly created element from an action's result, or null (refused / not reported). */
export function resultId(raw: unknown): Id | null {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (isRec(raw) && typeof raw.id === 'string' && raw.id.length > 0) return raw.id;
  return null;
}

/** A drag session handed back by `beginDrag`, or null when the drag was refused. */
export function sessionOrNull(raw: unknown): unknown {
  return raw === null || raw === undefined || raw === false ? null : raw;
}
