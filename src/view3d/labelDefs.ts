/**
 * What the 3D labels say, where they sit and which of them win when they compete for screen space (pure; rendered
 * by Labels.tsx).
 *
 * - Mode 'inne': named rooms of the active storey (not 'apning'): name + "b × d m · areal", anchored above the
 *   storey's cut plane (top level elevation of the storey + cutHeight + 0.3 m) so cut walls never hide them.
 * - Mode 'ute': blocks: name + BYA area of the block, 0.6 m above the roof top at the ridge.
 * - Density by distance, the plan's rule: ≥ 25 px/m full, 12–25 px/m name only, < 12 px/m none; ≤ 30 labels.
 * - Priority (overlaps and the 30-label cap): the label of the room the camera stands in comes first and is never
 *   hidden (no occlusion test, clamped into the view, pinned to the bottom centre when its anchor is out of view);
 *   the others by importance = weight (room net area / block BYA area) mildly reduced with distance
 *   (`labelScore`), so the big rooms keep their labels and closets yield. Any other tag is shown only when its
 *   whole rectangle fits inside the label layer (no fragments at the edges).
 */
import { centroid, pointInPolygon } from '../geometry/polygon';
import type { DerivedVariant } from '../model/derived';
import type { Id, Vec2, Vec3 } from '../model/types';
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
}

export interface LabelRoom {
  polygon: Vec2[];
  holes: Vec2[][];
  zMin: number;
  zMax: number;
}

/** Height (m above its floor) of a room on a level without a ceiling, for "the camera stands in it". */
export const ROOM_HEIGHT = 3;
/** Distance (m) at which a label's importance has dropped to half. */
export const LABEL_DISTANCE_SCALE = 15;
/** Gap (px) between a pinned tag and the bottom edge of the layer. */
export const PIN_MARGIN = 12;

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
    return {
      key: `block:${b.block.id}`,
      title: b.block.name,
      detail: area !== undefined ? formatM2(area) : '',
      isNew: b.block.isNew,
      at: [c[0], c[1], b.ridgeZ + (roof?.thickness ?? 0.3) + 0.6],
      weight: area ?? 0,
    };
  });
}

/** True when the camera (plan coordinates) stands inside the label's room (never for block labels). */
export function cameraInRoom(def: Pick<LabelDef, 'room'>, camera: Vec3): boolean {
  const r = def.room;
  if (!r || camera[2] < r.zMin || camera[2] > r.zMax) return false;
  const p: Vec2 = [camera[0], camera[1]];
  return pointInPolygon(p, r.polygon) && !r.holes.some((h) => pointInPolygon(p, h));
}

/** Importance of a label: its weight, halved at LABEL_DISTANCE_SCALE metres, a third at twice that. */
export function labelScore(weight: number, distance: number): number {
  return Math.max(0, weight) / (1 + Math.max(0, distance) / LABEL_DISTANCE_SCALE);
}

/**
 * Order in which labels claim screen space: pinned labels (the camera's own room) first, then by score (highest
 * first); ties go to the nearer label, then to the lower index.
 */
export function labelOrder(weights: number[], distances: number[], pinned: boolean[] = []): number[] {
  const score = weights.map((w, i) => labelScore(w, distances[i]));
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

/**
 * Where a tag of `size` goes (its bottom centre on the projected anchor), or null when it is not shown:
 * - normal tags: only when the anchor is in front of the camera (`anchor` not null) and the whole rectangle fits
 *   inside the layer;
 * - pinned tags (the camera's own room): always — clamped into the layer, or at the bottom centre when the anchor
 *   is behind the camera or outside the layer.
 */
export function placeTag(
  anchor: { x: number; y: number } | null,
  size: { w: number; h: number },
  layer: { width: number; height: number },
  pinned = false,
): ScreenRect | null {
  const { width: W, height: H } = layer;
  if (!pinned) {
    if (!anchor) return null;
    const r = { x0: anchor.x - size.w / 2, x1: anchor.x + size.w / 2, y0: anchor.y - size.h, y1: anchor.y };
    return r.x0 >= 0 && r.y0 >= 0 && r.x1 <= W && r.y1 <= H ? r : null;
  }
  const inView = anchor !== null && anchor.x >= 0 && anchor.x <= W && anchor.y >= 0 && anchor.y <= H;
  const a = inView ? anchor : { x: W / 2, y: H - PIN_MARGIN };
  const x0 = Math.max(0, Math.min(a.x - size.w / 2, W - size.w));
  const y0 = Math.max(0, Math.min(a.y - size.h, H - size.h));
  return { x0, x1: x0 + size.w, y0, y1: y0 + size.h };
}
