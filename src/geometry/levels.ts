/**
 * Which level's floor is at a plan point — the one rule shared by room detection (derive.ts) and the editor
 * (`levelAt`, re-exported from model/derived.ts). Pure.
 *
 * `locateLevel(p, storeyLevelIds, blocks)`: the first block (in `variant.blocks` order) whose axis polygon contains
 * p, then the first floor zone of that block on one of the storey's levels containing p (the zone's level), else the
 * block's base level when it is on the storey and no 'replace' zone carves p out. Null when no block on the storey
 * has a floor there.
 *
 * `levelAt(derived, storeyId, p)` (docs/phase2-plan.md §2): `locateLevel`, else — where the plan is silent — the
 * storey's level whose elevation is closest to the main floor (0; ties: the first listed), so a point on the deck or
 * on the terrain of storey 'ground' gives 'main'. An unknown storey gives the first level of the variant, or 'main'
 * when there are none.
 */
import type { DerivedBlock, DerivedVariant } from '../model/derived';
import type { Id, Vec2 } from '../model/types';
import { pointInPolygon } from './polygon';

export interface LocatedLevel {
  levelId: Id;
  blockId: Id;
}

/** Level (and block) of the floor at p among the given levels, or null when none of them has a floor there. */
export function locateLevel(p: Vec2, storeyLevelIds: ReadonlySet<Id>, blocks: readonly DerivedBlock[]): LocatedLevel | null {
  for (const db of blocks) {
    if (db.axis.length < 3 || !pointInPolygon(p, db.axis)) continue;
    for (const z of db.zones) {
      if (storeyLevelIds.has(z.levelId) && z.polygon.length >= 3 && pointInPolygon(p, z.polygon)) return { levelId: z.levelId, blockId: db.block.id };
    }
    if (storeyLevelIds.has(db.block.levelId)) {
      const carved = db.zones.some((z) => z.kind === 'replace' && z.polygon.length >= 3 && pointInPolygon(p, z.polygon));
      if (!carved) return { levelId: db.block.levelId, blockId: db.block.id };
    }
  }
  return null;
}

/** Level id of the floor at plan point p on storey `storeyId` (see the header for the fallback). */
export function levelAt(derived: Pick<DerivedVariant, 'storeys' | 'levels' | 'blocks'>, storeyId: Id, p: Vec2): Id {
  const storey = derived.storeys.find((s) => s.id === storeyId);
  if (!storey || storey.levelIds.length === 0) return derived.levels[0]?.id ?? 'main';
  const hit = locateLevel(p, new Set(storey.levelIds), derived.blocks);
  if (hit) return hit.levelId;
  let best = storey.levelIds[0];
  let bestD = Infinity;
  for (const id of storey.levelIds) {
    const d = Math.abs(derived.levels.find((l) => l.id === id)?.elevation ?? 0);
    if (d < bestD - 1e-9) {
      best = id;
      bestD = d;
    }
  }
  return best;
}
