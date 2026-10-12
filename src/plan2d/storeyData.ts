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
 *  - 'ceiling' floors (flat ceilings of blocks with Block.ceilingHeight) are above the plan cut: not drawn.
 *  - Stairs are drawn where they cross the cut ('full') and on the storey they arrive at ('upper'), see
 *    visibility.ts; the footprints of stairs, chimneys and posts on the storey are label obstacles.
 *  - Furniture is drawn on the storey of its level (`DerivedFurniture.levelId`); items on a level that does not
 *    exist are drawn on the storey with the main floor (like the outdoor elements).
 *  - Ghosts ("Fjernet": removed walls and openings of the storey, moved block edges on every storey) are label
 *    obstacles while "Vis hva som er nytt" shows them (`ghostObstacles`), so a merged room's name never covers the
 *    removed wall it could be restored from (fix round 2 after phase 2a).
 *  - `planLayerData` adds what the layers take straight from the derived model (blocks, ghosts, outdoor, roofs,
 *    bounds); PlanView shares the whole object with the previous frame's (stable.ts), so a drag re-renders only the
 *    layers whose part changed.
 */
import type { DerivedBlock, DerivedDimension, DerivedFloor, DerivedFurniture, DerivedOpening, DerivedRoof, DerivedRoom, DerivedStructure, DerivedVariant, DerivedWall } from '../model/derived';
import type { ElementStatus, Id, Vec2 } from '../model/types';
import type { StairMode } from './drawing';
import { stairModeOnStorey, storeyContext, structureOnStorey } from './visibility';
import type { StoreyContext } from './visibility';
import type { Rect } from './viewport';

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
  /** Drawing mode of every stair in `structure` (by id). */
  stairModes: Record<Id, StairMode>;
  /** Footprints room labels must keep clear of (stairs, chimneys, posts on this storey). */
  labelObstacles: Vec2[][];
  dimensions: DerivedDimension[];
  /** Furniture standing on this storey's levels. */
  furniture: DerivedFurniture[];
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
  stairModes: {},
  labelObstacles: [],
  dimensions: [],
  furniture: [],
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

/** Plan footprint of a structure element that labels must avoid (beams run overhead: none). */
export function structureFootprint(el: DerivedStructure): Vec2[] | null {
  switch (el.kind) {
    case 'stair':
      return el.footprint.length >= 3 ? el.footprint : null;
    case 'chimney':
      return [el.min, [el.max[0], el.min[1]], el.max, [el.min[0], el.max[1]]];
    case 'post': {
      const h = el.size / 2;
      const [x, y] = el.position;
      return [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]];
    }
    default:
      return null;
  }
}

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
  const structure = derived.structure.filter((s) => structureOnStorey(s, ctx));
  const stairModes: Record<Id, StairMode> = {};
  for (const s of structure) if (s.kind === 'stair') stairModes[s.id] = stairModeOnStorey(s, ctx) ?? 'full';
  const outdoorActive = ctx.levels.some((l) => isMainFloor(l.elevation)) || !derived.levels.some((l) => isMainFloor(l.elevation));
  const known = new Set(derived.levels.map((l) => l.id));
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
    floors: derived.floors.filter((f) => f.kind !== 'ceiling' && levelIds.includes(f.levelId)),
    structure,
    stairModes,
    labelObstacles: structure.map(structureFootprint).filter((p): p is Vec2[] => p !== null),
    dimensions: derived.dimensions.filter((d) => d.levelId === undefined || levelIds.includes(d.levelId)),
    furniture: derived.furniture.filter((f) => (known.has(f.levelId) ? levelIds.includes(f.levelId) : outdoorActive)),
    outdoorActive,
  };
}

/** Half width (m) of the strip a block-edge ghost line keeps room labels off. */
const GHOST_LINE_HALF_M = 0.05;

/** Thin quad around a segment (a block-edge ghost as a label obstacle). */
function segmentQuad(a: Vec2, b: Vec2, half: number): Vec2[] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return null;
  const n: Vec2 = [(-dy / l) * half, (dx / l) * half];
  return [
    [a[0] + n[0], a[1] + n[1]],
    [b[0] + n[0], b[1] + n[1]],
    [b[0] - n[0], b[1] - n[1]],
    [a[0] - n[0], a[1] - n[1]],
  ];
}

/**
 * Label obstacles for the ghosts drawn on this storey: the footprints of its removed walls and removed openings, and
 * a thin strip along every moved block edge's old line.
 */
export function ghostObstacles(derived: Pick<DerivedVariant, 'ghosts'>, data: Pick<StoreyData, 'pieces' | 'openings'>): Vec2[][] {
  const out: Vec2[][] = [];
  for (const w of data.pieces) if (w.isGhost && w.footprint.length >= 3) out.push(w.footprint);
  for (const { opening } of data.openings) if (opening.status === 'removed' && opening.footprint.length >= 3) out.push(opening.footprint);
  for (const g of derived.ghosts) {
    const q = segmentQuad(g.a, g.b, GHOST_LINE_HALF_M);
    if (q) out.push(q);
  }
  return out;
}

/** Everything the plan's layers draw for one storey (see the header). */
export interface PlanLayerData extends StoreyData {
  blocks: DerivedBlock[];
  ghosts: DerivedVariant['ghosts'];
  decks: DerivedVariant['outdoor']['decks'];
  hotTubs: DerivedVariant['outdoor']['hotTubs'];
  railings: DerivedVariant['outdoor']['railings'];
  steps: DerivedVariant['outdoor']['steps'];
  trees: DerivedVariant['site']['trees'];
  roofs: DerivedRoof[];
  bounds: Rect;
  /** Label obstacles of the ghosts (`ghostObstacles`); used while "Vis hva som er nytt" is on. */
  ghostObstacles: Vec2[][];
}

export function planLayerData(derived: DerivedVariant, planStorey: string): PlanLayerData {
  const data = storeyData(derived, planStorey);
  return {
    ...data,
    blocks: derived.blocks,
    ghosts: derived.ghosts,
    decks: derived.outdoor.decks,
    hotTubs: derived.outdoor.hotTubs,
    railings: derived.outdoor.railings,
    steps: derived.outdoor.steps,
    trees: derived.site.trees,
    roofs: derived.roofs,
    bounds: derived.bounds,
    ghostObstacles: ghostObstacles(derived, data),
  };
}
