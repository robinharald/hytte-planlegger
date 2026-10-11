/**
 * What the 3D labels say and where they sit (pure; rendered by Labels.tsx).
 *
 * - Mode 'inne': named rooms of the active storey (not 'apning'): name + "b × d m · areal", anchored above the
 *   storey's cut plane (top level elevation of the storey + cutHeight + 0.3 m) so cut walls never hide them.
 * - Mode 'ute': blocks: name + BYA area of the block, 0.6 m above the roof top at the ridge.
 * - Density by distance, the plan's rule: ≥ 25 px/m full, 12–25 px/m name only, < 12 px/m none; ≤ 30 labels.
 */
import { centroid } from '../geometry/polygon';
import type { DerivedVariant } from '../model/derived';
import type { Id, Vec3 } from '../model/types';
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
}

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
  const elev = new Map(derived.levels.map((l) => [l.id, l.elevation]));
  const top = Math.max(...storey.levelIds.map((id) => elev.get(id) ?? 0));
  return derived.rooms
    .filter((r) => r.room && r.room.type !== 'apning' && storey.levelIds.includes(r.levelId))
    .map((r) => ({
      key: `room:${r.levelId}:${r.id}`,
      title: r.room?.name?.trim() || STRINGS.unnamedRoom,
      detail: formatRoomDetail(r.dims.w, r.dims.h, r.dims.approx, r.area),
      isNew: r.isNew,
      at: [r.labelPoint[0], r.labelPoint[1], top + cutHeight + 0.3],
    }));
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
    };
  });
}

/** Density per label: nearest first, at most MAX_LABELS shown. `distances[i]` belongs to label i. */
export function labelDensities(distances: number[], viewportHeightPx: number, fovDeg: number): LabelDensity[] {
  const out: LabelDensity[] = distances.map(() => 'none');
  distances
    .map((d, i) => ({ d, i }))
    .sort((a, b) => a.d - b.d)
    .forEach(({ d, i }, rank) => {
      out[i] = rank < MAX_LABELS ? labelDensity(pxPerMetre(viewportHeightPx, fovDeg, d)) : 'none';
    });
  return out;
}
