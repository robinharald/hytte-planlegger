/**
 * What is visible in each 3D mode (pure, unit-testable).
 *
 *  - `ute`: everything, no cut.
 *  - `inne`: roofs hidden; storeys ranked by the lowest elevation of their levels, storeys above the active one
 *    hidden; each remaining wall piece is cut at (elevation of its highest visible level) + cutHeight, so a
 *    wall that spans several storeys is cut relative to the storey being looked at. Floors, rooms and
 *    structure follow the same level set; structure above the cut plane is clipped.
 */
import type { DerivedVariant, DerivedWall } from '../model/derived';
import type { Id } from '../model/types';

export interface Visibility {
  mode: 'ute' | 'inne';
  /** Levels whose contents are drawn. */
  levelIds: Set<Id>;
  showRoofs: boolean;
  /** Absolute cut plane for a wall, or null when uncut. */
  cutZFor(wall: DerivedWall): number | null;
  isWallVisible(wall: DerivedWall): boolean;
  isLevelVisible(levelId: Id): boolean;
  /** Absolute cut plane for free-standing structure (null in exterior mode). */
  structureCutZ: number | null;
}

export function storeyRank(derived: DerivedVariant): Map<Id, number> {
  const minZ = new Map<Id, number>();
  for (const s of derived.storeys) {
    const zs = s.levelIds.map((id) => derived.levels.find((l) => l.id === id)?.elevation ?? 0);
    minZ.set(s.id, zs.length ? Math.min(...zs) : 0);
  }
  const sorted = [...minZ.entries()].sort((a, b) => a[1] - b[1]);
  return new Map(sorted.map(([id], i) => [id, i]));
}

export function computeVisibility(derived: DerivedVariant, mode: 'ute' | 'inne', activeStoreyId: Id, cutHeight: number): Visibility {
  const levelsById = new Map(derived.levels.map((l) => [l.id, l]));
  const all = new Set(derived.levels.map((l) => l.id));
  if (mode === 'ute') {
    return {
      mode,
      levelIds: all,
      showRoofs: true,
      cutZFor: () => null,
      isWallVisible: () => true,
      isLevelVisible: () => true,
      structureCutZ: null,
    };
  }
  const rank = storeyRank(derived);
  const activeRank = rank.get(activeStoreyId) ?? Math.max(0, ...rank.values());
  const levelIds = new Set<Id>();
  for (const s of derived.storeys) {
    if ((rank.get(s.id) ?? 0) <= activeRank) for (const id of s.levelIds) levelIds.add(id);
  }
  // levels without a storey entry (defensive): visible when their storey is unknown
  for (const l of derived.levels) if (!derived.storeys.some((s) => s.levelIds.includes(l.id))) levelIds.add(l.id);
  let topVisible = -Infinity;
  for (const id of levelIds) topVisible = Math.max(topVisible, levelsById.get(id)?.elevation ?? 0);
  if (!Number.isFinite(topVisible)) topVisible = 0;

  const wallLevels = (w: DerivedWall): Id[] => (w.levelIds.length ? w.levelIds : [w.levelId]);
  const cutZFor = (w: DerivedWall): number | null => {
    let z = -Infinity;
    for (const id of wallLevels(w)) if (levelIds.has(id)) z = Math.max(z, levelsById.get(id)?.elevation ?? 0);
    if (!Number.isFinite(z)) return null;
    return z + cutHeight;
  };
  return {
    mode,
    levelIds,
    showRoofs: false,
    cutZFor,
    isWallVisible: (w) => wallLevels(w).some((id) => levelIds.has(id)),
    isLevelVisible: (id) => levelIds.has(id),
    structureCutZ: topVisible + cutHeight,
  };
}

/** Walls that get a mesh: not dividers, not removed, with a footprint, on a visible level. */
export function wallIsDrawn(w: DerivedWall, vis: Visibility): boolean {
  return !w.isDivider && w.status !== 'removed' && w.footprint.length >= 3 && vis.isWallVisible(w);
}
