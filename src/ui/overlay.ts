/**
 * Transient overlay state shared between the Egenskaper editors and the plan, kept out of the app store (never
 * saved, never in the undo history):
 *  - `highlight`: while a room size field has focus, the wall that will move and the direction it moves in
 *    (docs/phase2-plan.md §3.7 "the wall is highlighted with an arrow while the field has focus"); while
 *    "Avstand fra hjørne" has focus, a temporary dimension line. The plan draws it (PlanView `overlay`, wired by
 *    the integrator from `usePanelHighlight()`).
 *  - `anchor`: where the phone mini-bar should float — the selection's top centre in viewport (client) pixels,
 *    reported by the plan (PlanView `onSelectionBar`, wired to `setSelectionAnchor`). null = unknown (the bar then
 *    sits at the bottom of the stage).
 *  - `propertiesSheet`: the phone's Egenskaper bottom sheet is open (the mini-bar's "Egenskaper", a schedule row).
 */
import { create } from 'zustand';
import type { Id, Vec2 } from '../model/types';

export type PanelHighlight =
  /** `arrow`: unit vector (plan frame) the wall moves in when the value grows. */
  | { kind: 'wall'; wallId: Id; arrow: Vec2 }
  /** Temporary dimension from `a` to `b` (plan frame) labelled `text`. */
  | { kind: 'dimension'; a: Vec2; b: Vec2; text: string };

export interface ScreenPoint {
  x: number;
  y: number;
}

interface OverlayState {
  highlight: PanelHighlight | null;
  anchor: ScreenPoint | null;
  propertiesSheet: boolean;
}

export const overlayStore = create<OverlayState>()(() => ({ highlight: null, anchor: null, propertiesSheet: false }));

export function setPanelHighlight(highlight: PanelHighlight | null): void {
  overlayStore.setState({ highlight });
}

export function usePanelHighlight(): PanelHighlight | null {
  return overlayStore((s) => s.highlight);
}

export function setSelectionAnchor(anchor: ScreenPoint | null): void {
  const cur = overlayStore.getState().anchor;
  if (cur === anchor || (cur && anchor && cur.x === anchor.x && cur.y === anchor.y)) return;
  overlayStore.setState({ anchor });
}

export function useSelectionAnchor(): ScreenPoint | null {
  return overlayStore((s) => s.anchor);
}

export function setPropertiesSheet(open: boolean): void {
  if (overlayStore.getState().propertiesSheet !== open) overlayStore.setState({ propertiesSheet: open });
}

export function usePropertiesSheet(): boolean {
  return overlayStore((s) => s.propertiesSheet);
}
