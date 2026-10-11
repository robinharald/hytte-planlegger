/**
 * Which derived elements belong on which plan storey. Pure, unit-tested.
 *
 * Rule for structure (posts, chimney, stairs, beams), which is not tagged with a storey: an element is drawn
 * on a storey when it crosses the conventional plan cut 1.2 m above the floor of any level of that storey,
 * i.e. bottomZ < elevation + CUT_HEIGHT and topZ > elevation. A stair main → loft therefore appears on the
 * ground plan in full (with its arrow). A stair is also drawn on the storey of its top level (`toLevelId`), where
 * it ARRIVES: there it is drawn in 'upper' mode (drawing.ts `stairPlan`: the flight beyond the lower plan's cut,
 * a break line and the arrow), like the architect's loft plan.
 */
import type { DerivedStructure, DerivedVariant } from '../model/derived';
import type { Id, Level } from '../model/types';
import type { StairMode } from './drawing';

export const CUT_HEIGHT = 1.2;

export interface StoreyContext {
  storeyId: Id;
  levelIds: Id[];
  levels: Level[];
}

/** Resolve the plan tab to a storey of the derived model (falls back to the first storey). */
export function storeyContext(derived: Pick<DerivedVariant, 'storeys' | 'levels'>, planStorey: string): StoreyContext | null {
  const storey = derived.storeys.find((s) => s.id === planStorey) ?? derived.storeys[0];
  if (!storey) return null;
  const levels = derived.levels.filter((l) => storey.levelIds.includes(l.id));
  return { storeyId: storey.id, levelIds: storey.levelIds, levels };
}

export function zRangeOf(el: DerivedStructure): { bottom: number; top: number } {
  switch (el.kind) {
    case 'stair':
      return { bottom: Math.min(el.fromZ, el.toZ), top: Math.max(el.fromZ, el.toZ) };
    default:
      return { bottom: el.bottomZ, top: el.topZ };
  }
}

export function crossesCut(bottom: number, top: number, levels: Level[], cut = CUT_HEIGHT): boolean {
  return levels.some((l) => bottom < l.elevation + cut && top > l.elevation);
}

/**
 * How a stair is drawn on a storey, or null when it is not drawn there: 'full' where it crosses the plan cut
 * (it starts on, or runs through, the storey), 'upper' on the storey of its top level when it does not cross
 * that storey's cut (it arrives from below).
 */
export function stairModeOnStorey(el: Extract<DerivedStructure, { kind: 'stair' }>, ctx: StoreyContext): StairMode | null {
  const { bottom, top } = zRangeOf(el);
  if (crossesCut(bottom, top, ctx.levels)) return 'full';
  const toLevelId = el.element.kind === 'stair' ? el.element.toLevelId : undefined;
  return toLevelId !== undefined && ctx.levelIds.includes(toLevelId) ? 'upper' : null;
}

export function structureOnStorey(el: DerivedStructure, ctx: StoreyContext): boolean {
  if (el.kind === 'stair') return stairModeOnStorey(el, ctx) !== null;
  const { bottom, top } = zRangeOf(el);
  return crossesCut(bottom, top, ctx.levels);
}
