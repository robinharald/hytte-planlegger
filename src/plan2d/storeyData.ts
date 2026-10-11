/**
 * Splits a DerivedVariant into what the plan draws for one storey. Pure (memoised by PlanView per
 * (derived, planStorey)), unit-tested with the fixture (storeyData.test.ts).
 *
 * Decisions where architecture.md is silent:
 *  - Walls are drawn on every storey listed in `storeyIds`; openings only on the storey of their level
 *    (`opening.levelId`, else the host wall's level), so a loft window in a gable wall does not cut the wall on
 *    Plan 1 and vice versa.
 *  - Wall unions are ordered removed → existing → new, so new work is painted on top.
 *  - Other storeys' walls (faint outlines) leave out removed walls.
 *  - Outdoor elements (decks, railings, steps, hot tubs, trees) belong to the storey containing the level at
 *    elevation 0 (the main floor); on other storeys they are drawn faint and are not selectable.
 *  - Dimensions without a levelId are shown on every storey; others only on the storey of their level.
 */
import type { DerivedDimension, DerivedFloor, DerivedOpening, DerivedRoom, DerivedStructure, DerivedVariant, DerivedWall } from '../model/derived';
import type { ElementStatus, Id, Vec2 } from '../model/types';
import { storeyContext, structureOnStorey } from './visibility';
import type { StoreyContext } from './visibility';

export interface PlacedOpening {
  wall: DerivedWall;
  opening: DerivedOpening;
}

export interface StoreyData {
  ctx: StoreyContext | null;
  /** All walls taking part in the storey (exterior pieces, stored walls, dividers). */
  walls: DerivedWall[];
  /** Walls with a footprint (hit areas). */
  pieces: DerivedWall[];
  dividers: DerivedWall[];
  /** Openings of the pieces that belong to this storey's levels. */
  openings: PlacedOpening[];
  unions: DerivedVariant['wallUnion'];
  otherUnions: DerivedVariant['wallUnion'];
  /** Footprints of the (not removed) openings to cut out of the wall fill. */
  cuts: Vec2[][];
  rooms: DerivedRoom[];
  floors: DerivedFloor[];
  structure: DerivedStructure[];
  dimensions: DerivedDimension[];
  /** False on storeys without the main floor: outdoor elements are drawn faint there. */
  outdoorActive: boolean;
}

const STATUS_ORDER: Record<ElementStatus, number> = { removed: 0, existing: 1, new: 2 };

const EMPTY: Omit<StoreyData, 'ctx'> = {
  walls: [],
  pieces: [],
  dividers: [],
  openings: [],
  unions: [],
  otherUnions: [],
  cuts: [],
  rooms: [],
  floors: [],
  structure: [],
  dimensions: [],
  outdoorActive: true,
};

/** Level an opening is drawn on: its own `levelId` when that level exists, else the host wall's level. */
export function openingLevelId(o: DerivedOpening, wall: DerivedWall, knownLevelIds: readonly Id[]): Id {
  const own = o.opening.levelId;
  return own !== undefined && knownLevelIds.includes(own) ? own : wall.levelId;
}

export function storeyOpenings(pieces: DerivedWall[], levelIds: readonly Id[], knownLevelIds: readonly Id[]): PlacedOpening[] {
  const out: PlacedOpening[] = [];
  for (const wall of pieces) {
    for (const opening of wall.openings) {
      if (levelIds.includes(openingLevelId(opening, wall, knownLevelIds))) out.push({ wall, opening });
    }
  }
  return out;
}

export function openingCuts(openings: PlacedOpening[]): Vec2[][] {
  return openings.filter(({ opening: o }) => o.status !== 'removed' && o.footprint.length >= 3).map(({ opening: o }) => o.footprint);
}

const isMainFloor = (elevation: number) => Math.abs(elevation) < 1e-6;

export function storeyData(derived: DerivedVariant, planStorey: string): StoreyData {
  const ctx = storeyContext(derived, planStorey);
  if (!ctx) return { ctx, ...EMPTY };
  const { storeyId, levelIds } = ctx;
  const walls = derived.walls.filter((w) => w.storeyIds.includes(storeyId));
  const pieces = walls.filter((w) => !w.isDivider && w.footprint.length >= 3);
  const openings = storeyOpenings(
    pieces,
    levelIds,
    derived.levels.map((l) => l.id),
  );
  const byStatus = (a: { status: ElementStatus }, b: { status: ElementStatus }) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  return {
    ctx,
    walls,
    pieces,
    dividers: walls.filter((w) => w.isDivider),
    openings,
    unions: derived.wallUnion.filter((u) => u.storeyId === storeyId).sort(byStatus),
    otherUnions: derived.wallUnion.filter((u) => u.storeyId !== storeyId && u.status !== 'removed'),
    cuts: openingCuts(openings),
    rooms: derived.rooms.filter((r) => r.storeyId === storeyId),
    floors: derived.floors.filter((f) => levelIds.includes(f.levelId)),
    structure: derived.structure.filter((s) => structureOnStorey(s, ctx)),
    dimensions: derived.dimensions.filter((d) => d.levelId === undefined || levelIds.includes(d.levelId)),
    outdoorActive: ctx.levels.some((l) => isMainFloor(l.elevation)) || !derived.levels.some((l) => isMainFloor(l.elevation)),
  };
}
