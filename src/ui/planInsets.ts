/**
 * The parts of the plan's box that other UI covers on a phone (PlanView `viewportInsets`: screen px of the plan's own
 * box, top / right / bottom / left). Pure.
 *  - bottom: below the top of an open bottom sheet (`sheet` px high, fixed to the bottom of the screen), or below
 *    the screen;
 *  - top: above the screen, or under the toolbar + hint line where they overlap the plan (`toolbarBottom`, viewport
 *    px; in the page flow they sit above the plan, so this only counts if they ever float over it).
 */
import type { ViewportInsets } from '../plan2d/PlanView';

export function planInsets(plan: { top: number; bottom: number }, viewportHeight: number, sheet: number, toolbarBottom: number): ViewportInsets {
  const top = Math.max(0, -plan.top, toolbarBottom - plan.top);
  const bottom = Math.max(0, plan.bottom - (viewportHeight - Math.max(0, sheet)));
  return { top: Math.round(top), right: 0, bottom: Math.round(bottom), left: 0 };
}
