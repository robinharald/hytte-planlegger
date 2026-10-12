/**
 * What the 3D labels say, where they sit and which of them win when they compete for screen space (pure; rendered
 * by Labels.tsx).
 *
 * - Mode 'inne': named rooms of the active storey (not 'apning'): name + "b × d m · areal", anchored above the
 *   storey's cut plane (top level elevation of the storey + cutHeight + 0.3 m) so cut walls never hide them.
 * - Mode 'ute': blocks: name + BYA area of the block, 0.6 m above the roof top at the ridge.
 * - Density by distance, the plan's rule: ≥ 25 px/m full, 12–25 px/m name only, < 12 px/m none; ≤ 30 labels.
 * - Priority (overlaps and the 30-label cap): the label of the room the camera stands in comes first and is never
 *   hidden (no occlusion test, clamped into the view, pinned to the bottom-right corner when its anchor is out of
 *   view, kept clear of reserved rectangles such as the navigation hint); the others by importance = weight (room
 *   net area / block BYA area) reduced with distance (`labelScore`): mildly for rooms, so the big rooms keep their
 *   labels and closets yield; strongly for blocks (cube of the distance), so the nearest block wins against a
 *   bigger one behind it. Any other tag is shown only when its whole rectangle fits inside the label layer (no
 *   fragments at the edges).
 * - Blocks: a block label is shown only while the block itself can be seen — a ray from the camera reaches at
 *   least one of three points just above its roof ridge without hitting another block first (`LabelBlock.probes`,
 *   tested in Labels.tsx; the anchor floats above the roof, so testing it would let hidden blocks' labels float
 *   over the block in front); a partly hidden block's tag moves over its visible part (`blockAnchor`). A block tag
 *   that would overlap a placed one first tries nudged positions (`tagCandidates`: ±8 / ±16 px sideways, then one
 *   and two tag heights higher, then below the anchor) before it is hidden.
 */
import { centroid, pointInPolygon } from '../geometry/polygon';
import type { DerivedBlock, DerivedRoof, DerivedVariant } from '../model/derived';
import type { Id, Vec2, Vec3 } from '../model/types';
import type { Selection } from '../state/selection';
import { formatM2 } from '../ui/format';
import { formatRoomDetail, STRINGS } from './strings';

export const MAX_LABELS = 30;
export type LabelDensity = 'full' | 'name' | 'none';

export interface LabelDef {
  key: string;
  title: string;
  detail: string;
  isNew: boolean;
  /** Anchor in plan coordinates (the label's bottom centre sits on it). */
  at: Vec3;
  /** Importance when labels compete for space: the room's net area or the block's BYA area (m²). */
  weight: number;
  /** Room labels: the room's volume (inner polygon, floor to ceiling), to tell whether the camera stands in it. */
  room?: LabelRoom;
  /** Block labels: the block and the points whose visibility decides whether its label shows. */
  block?: LabelBlock;
}

export interface LabelBlock {
  id: Id;
  /** Points PROBE_LIFT above the roof's top along its ridge (25 / 50 / 75 % of the ridge within the block). */
  probes: Vec3[];
  /** Axis polygon and the roof's top: a camera within both stands inside the block (its own roof then hides it). */
  axis: Vec2[];
  topZ: number;
}

export interface LabelRoom {
  polygon: Vec2[];
  holes: Vec2[][];
  zMin: number;
  zMax: number;
}

/** Height (m above its floor) of a room on a level without a ceiling, for "the camera stands in it". */
export const ROOM_HEIGHT = 3;
/** Distance (m) at which a room label's importance has dropped to half. */
export const LABEL_DISTANCE_SCALE = 15;
/** Block labels: importance = BYA area / distance^this, so the nearest block wins against a bigger one behind it. */
export const BLOCK_DISTANCE_POWER = 3;
/** Inset (px) of a pinned tag from the right and bottom edges of the layer. */
export const PIN_MARGIN = 12;
/** Minimum gap (px) between two shown tags (and between a tag and a reserved rectangle). */
export const LABEL_GAP = 2;
/** Sideways nudges (px) a block tag tries, in order, before it moves above or below its anchor. */
export const NUDGE_X: readonly number[] = [0, 8, -8, 16, -16];
/** Height (m) of a block's occlusion probes above the top of its roof. */
export const PROBE_LIFT = 0.05;

/** Plan rule: ≥ 25 px/m full, 12–25 name only, < 12 none. */
export function labelDensity(pxPerMetre: number): LabelDensity {
  if (pxPerMetre >= 25) return 'full';
  if (pxPerMetre >= 12) return 'name';
  return 'none';
}

/** Screen pixels per metre at distance `d` for a perspective camera with vertical field of view `fovDeg`. */
export function pxPerMetre(viewportHeightPx: number, fovDeg: number, d: number): number {
  return viewportHeightPx / (2 * Math.max(d, 1e-3) * Math.tan((fovDeg * Math.PI) / 360));
}

export function roomLabels(derived: DerivedVariant, activeStoreyId: Id, cutHeight: number): LabelDef[] {
  const storey = derived.storeys.find((s) => s.id === activeStoreyId);
  if (!storey || storey.levelIds.length === 0) return [];
  const levels = new Map(derived.levels.map((l) => [l.id, l]));
  const top = Math.max(...storey.levelIds.map((id) => levels.get(id)?.elevation ?? 0));
  return derived.rooms
    .filter((r) => r.room && r.room.type !== 'apning' && storey.levelIds.includes(r.levelId))
    .map((r): LabelDef => {
      const level = levels.get(r.levelId);
      const zMin = level?.elevation ?? 0;
      return {
        key: `room:${r.levelId}:${r.id}`,
        title: r.room?.name?.trim() || STRINGS.unnamedRoom,
        detail: formatRoomDetail(r.dims.w, r.dims.h, r.dims.approx, r.area),
        isNew: r.isNew,
        at: [r.labelPoint[0], r.labelPoint[1], top + cutHeight + 0.3],
        weight: r.area,
        room: { polygon: r.polygon, holes: r.holes, zMin, zMax: zMin + (level?.ceilingHeight ?? ROOM_HEIGHT) },
      };
    });
}

export function blockLabels(derived: DerivedVariant): LabelDef[] {
  return derived.blocks.map((b) => {
    const roof = derived.roofs.find((r) => r.blockId === b.block.id);
    const area = derived.areas.bya.perBlock.find((p) => p.blockId === b.block.id)?.area;
    const c = centroid(b.axis);
    const top = b.ridgeZ + (roof?.thickness ?? 0.3);
    return {
      key: `block:${b.block.id}`,
      title: b.block.name,
      detail: area !== undefined ? formatM2(area) : '',
      isNew: b.block.isNew,
      at: [c[0], c[1], top + 0.6],
      weight: area ?? 0,
      block: { id: b.block.id, probes: roofProbes(b, roof), axis: b.axis, topZ: top },
    };
  });
}

/**
 * Occlusion probes of a block: PROBE_LIFT above the highest line of its roof's top surface (the ridge of a gable;
 * the high edge of a mono roof; a diagonal of a flat one: the two farthest-apart top vertices within 1 cm of the
 * highest), at 25 / 50 / 75 % of the part of that line that lies over the block (ridges run on over the gable
 * overhangs and into other roofs). Without slopes: the axis centroid at the ridge top.
 */
export function roofProbes(b: DerivedBlock, roof: DerivedRoof | undefined): Vec3[] {
  const pts = roof?.slopes.flatMap((s) => s.polygon) ?? [];
  if (pts.length === 0) {
    const c = centroid(b.axis);
    return [[c[0], c[1], b.ridgeZ + (roof?.thickness ?? 0.3) + PROBE_LIFT]];
  }
  const zMax = Math.max(...pts.map((p) => p[2]));
  const high = pts.filter((p) => p[2] >= zMax - 0.01);
  let a = high[0];
  let e = high[0];
  let best = -1;
  for (let i = 0; i < high.length; i++) {
    for (let j = i + 1; j < high.length; j++) {
      const d = (high[i][0] - high[j][0]) ** 2 + (high[i][1] - high[j][1]) ** 2;
      if (d > best) [best, a, e] = [d, high[i], high[j]];
    }
  }
  const dx = e[0] - a[0];
  const dy = e[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t0 = 0;
  let t1 = 1;
  if (len2 > 1e-12 && b.axis.length >= 3) {
    const ts = b.axis.map((p) => ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2);
    const lo = Math.max(0, Math.min(...ts));
    const hi = Math.min(1, Math.max(...ts));
    if (hi > lo) [t0, t1] = [lo, hi];
  }
  return [0.25, 0.5, 0.75].map((f): Vec3 => {
    const t = t0 + (t1 - t0) * f;
    return [a[0] + dx * t, a[1] + dy * t, a[2] + (e[2] - a[2]) * t + PROBE_LIFT];
  });
}

/**
 * Which block each pickable 3D object belongs to, keyed `${selection.kind}:${selection.id}`: the exterior wall
 * pieces of a block (picked as their block edge, selection3d.wallPick; the piece id is kept for older tags) and the
 * openings in them (roofs and foundations carry the block itself as their selection).
 */
export function blockOwners(derived: Pick<DerivedVariant, 'walls'>): Map<string, Id> {
  const out = new Map<string, Id>();
  for (const w of derived.walls) {
    if (w.source.kind !== 'blockEdge') continue;
    out.set(`blockEdge:${w.source.edgeId}`, w.source.blockId);
    out.set(`wall:${w.id}`, w.source.blockId);
    for (const o of w.openings) out.set(`opening:${o.id}`, w.source.blockId);
  }
  return out;
}

/** The block a hit object's selection belongs to (see `blockOwners`), or null (stored walls, floors, decks …). */
export function selectionBlock(sel: Selection | null, owners: Map<string, Id>): Id | null {
  if (!sel) return null;
  if (sel.kind === 'block') return sel.id;
  return owners.get(`${sel.kind}:${sel.id}`) ?? null;
}

/**
 * Anchor of a block label given which of its probes can be seen (`seen[i]` for `block.probes[i]`): `def.at` (the
 * same object) when all can (or the label has no probes), null when none can, else above the visible ones (their
 * mean, at the anchor's height) so a partly hidden block's tag sits over the part that shows.
 */
export function blockAnchor(def: Pick<LabelDef, 'at' | 'block'>, seen: readonly boolean[]): Vec3 | null {
  const probes = def.block?.probes ?? [];
  const visible = probes.filter((_, i) => seen[i]);
  if (visible.length === probes.length) return def.at;
  if (visible.length === 0) return null;
  const n = visible.length;
  return [visible.reduce((s, p) => s + p[0], 0) / n, visible.reduce((s, p) => s + p[1], 0) / n, def.at[2]];
}

/** True when the camera (plan coordinates) is inside the block: within its axis polygon and below its roof top. */
export function cameraInBlock(block: LabelBlock, camera: Vec3): boolean {
  return camera[2] < block.topZ && block.axis.length >= 3 && pointInPolygon([camera[0], camera[1]], block.axis);
}

/** True when the camera (plan coordinates) stands inside the label's room (never for block labels). */
export function cameraInRoom(def: Pick<LabelDef, 'room'>, camera: Vec3): boolean {
  const r = def.room;
  if (!r || camera[2] < r.zMin || camera[2] > r.zMax) return false;
  const p: Vec2 = [camera[0], camera[1]];
  return pointInPolygon(p, r.polygon) && !r.holes.some((h) => pointInPolygon(p, h));
}

/**
 * Importance of a label. Rooms: the weight, halved at LABEL_DISTANCE_SCALE metres, a third at twice that. Blocks:
 * the weight over the distance (at least 1 m) to the power BLOCK_DISTANCE_POWER, so a block 1.5 times farther
 * away needs more than 3.4 times the area to win (from 'framsiden' the new wing beats the main house behind it,
 * from 'oversikt' the main house wins).
 */
export function labelScore(weight: number, distance: number, block = false): number {
  const w = Math.max(0, weight);
  if (block) return w / Math.max(1, distance) ** BLOCK_DISTANCE_POWER;
  return w / (1 + Math.max(0, distance) / LABEL_DISTANCE_SCALE);
}

/**
 * Order in which labels claim screen space: pinned labels (the camera's own room) first, then by score (highest
 * first; `blocks[i]` selects the block scoring); ties go to the nearer label, then to the lower index.
 */
export function labelOrder(weights: number[], distances: number[], pinned: boolean[] = [], blocks: boolean[] = []): number[] {
  const score = weights.map((w, i) => labelScore(w, distances[i], !!blocks[i]));
  return weights
    .map((_, i) => i)
    .sort((a, b) => Number(!!pinned[b]) - Number(!!pinned[a]) || score[b] - score[a] || distances[a] - distances[b] || a - b);
}

/**
 * Density per label (`distances[i]` belongs to label i): the plan rule by distance; only the first MAX_LABELS
 * labels of `order` (default: nearest first) can show; pinned labels are always 'full'.
 */
export function labelDensities(
  distances: number[],
  viewportHeightPx: number,
  fovDeg: number,
  order?: number[],
  pinned: boolean[] = [],
): LabelDensity[] {
  const out: LabelDensity[] = distances.map(() => 'none');
  const ranked = order ?? distances.map((_, i) => i).sort((a, b) => distances[a] - distances[b]);
  ranked.forEach((i, rank) => {
    if (pinned[i]) out[i] = 'full';
    else if (rank < MAX_LABELS) out[i] = labelDensity(pxPerMetre(viewportHeightPx, fovDeg, distances[i]));
  });
  return out;
}

/** Screen rectangle of a tag (px, layer coordinates, y down). */
export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** True when two rectangles come closer than LABEL_GAP. */
export function rectsOverlap(a: ScreenRect, b: ScreenRect): boolean {
  return a.x0 < b.x1 + LABEL_GAP && b.x0 < a.x1 + LABEL_GAP && a.y0 < b.y1 + LABEL_GAP && b.y0 < a.y1 + LABEL_GAP;
}

/**
 * Positions a tag tries, in order: its bottom centre on the anchor; with `nudge` (block tags) then shifted by
 * NUDGE_X sideways, then the same one and two tag heights (+ gap) higher, then hanging below the anchor.
 */
export function tagCandidates(anchor: { x: number; y: number }, size: { w: number; h: number }, nudge = false): ScreenRect[] {
  const at = (dx: number, dy: number): ScreenRect => {
    const x0 = anchor.x - size.w / 2 + dx;
    const y1 = anchor.y + dy;
    return { x0, x1: x0 + size.w, y0: y1 - size.h, y1 };
  };
  if (!nudge) return [at(0, 0)];
  const step = size.h + LABEL_GAP;
  return [0, -step, -2 * step, step].flatMap((dy) => NUDGE_X.map((dx) => at(dx, dy)));
}

/**
 * Where a tag of `size` goes, or null when it is not shown:
 * - normal tags: only when the anchor is in front of the camera (`anchor` not null), at the first of
 *   `tagCandidates` whose whole rectangle fits inside the layer and keeps LABEL_GAP from every rectangle in
 *   `taken` (tags placed before it, reserved areas);
 * - pinned tags (the camera's own room): always — clamped into the layer, or in the bottom-right corner (PIN_MARGIN
 *   from both edges) when the anchor is behind the camera or outside the layer; moved up above any rectangle of
 *   `taken` it would overlap (the navigation hint in the bottom-left corner of a narrow pane).
 */
export function placeTag(
  anchor: { x: number; y: number } | null,
  size: { w: number; h: number },
  layer: { width: number; height: number },
  pinned = false,
  taken: readonly ScreenRect[] = [],
  nudge = false,
): ScreenRect | null {
  const { width: W, height: H } = layer;
  if (!pinned) {
    if (!anchor) return null;
    const fits = (r: ScreenRect) => r.x0 >= 0 && r.y0 >= 0 && r.x1 <= W && r.y1 <= H && !taken.some((t) => rectsOverlap(t, r));
    return tagCandidates(anchor, size, nudge).find(fits) ?? null;
  }
  const inView = anchor !== null && anchor.x >= 0 && anchor.x <= W && anchor.y >= 0 && anchor.y <= H;
  const a = inView ? anchor : { x: W - PIN_MARGIN - size.w / 2, y: H - PIN_MARGIN };
  const x0 = Math.max(0, Math.min(a.x - size.w / 2, W - size.w));
  let y0 = Math.max(0, Math.min(a.y - size.h, H - size.h));
  for (const t of taken) {
    const r = { x0, x1: x0 + size.w, y0, y1: y0 + size.h };
    if (rectsOverlap(t, r)) y0 = Math.max(0, t.y0 - LABEL_GAP - size.h);
  }
  return { x0, x1: x0 + size.w, y0, y1: y0 + size.h };
}
