/**
 * Transient overlay state shared between the Egenskaper editors and the plan, kept out of the app store (never
 * saved, never in the undo history):
 *  - `highlight`: while a room size field has focus, the wall that will move and the direction it moves in
 *    (docs/phase2-plan.md §3.7 "the wall is highlighted with an arrow while the field has focus"); while
 *    "Avstand fra hjørne" has focus, a temporary dimension line. The plan draws it (PlanView `overlay`, wired by
 *    the integrator from `usePanelHighlight()`).
 *  - `anchor`: where the phone mini-bar should float — the selection's top centre in viewport (client) pixels and
 *    its screen box, reported by the plan (PlanView `onSelectionBar`, wired to `setSelectionAnchor`; re-reported on
 *    pan, zoom, page scroll and resize). null = nothing visible to anchor to (or a drag in progress).
 *  - `propertiesSheet`: the phone's Egenskaper bottom sheet is open (the mini-bar's "Egenskaper", a schedule row).
 *  - `sheets`: the height (px) of each open bottom sheet (BottomSheet.tsx reports it); the plan's `viewportInsets` on
 *    phones (Stage.tsx), so the plan keeps the selection in the part of the screen the sheet does not cover.
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

/**
 * The mini-bar anchor as the plan reports it (plan2d/editTypes.ts `SelectionBarAnchor`): the top centre in viewport
 * pixels, the same point relative to the plan's wrapper, the selection's screen box relative to the wrapper, and that
 * box in viewport pixels (`rect`). All but x / y are optional here (older reports, tests).
 */
export interface SelectionAnchor extends ScreenPoint {
  localX?: number;
  localY?: number;
  box?: { x0: number; y0: number; x1: number; y1: number };
  rect?: { left: number; top: number; width: number; height: number };
}

interface OverlayState {
  highlight: PanelHighlight | null;
  anchor: SelectionAnchor | null;
  propertiesSheet: boolean;
  /** Height (px) of each open bottom sheet, by sheet id. */
  sheets: Record<string, number>;
}

export const overlayStore = create<OverlayState>()(() => ({ highlight: null, anchor: null, propertiesSheet: false, sheets: {} }));

export function setPanelHighlight(highlight: PanelHighlight | null): void {
  overlayStore.setState({ highlight });
}

export function usePanelHighlight(): PanelHighlight | null {
  return overlayStore((s) => s.highlight);
}

function sameAnchor(a: SelectionAnchor, b: SelectionAnchor): boolean {
  if (a.x !== b.x || a.y !== b.y || a.localX !== b.localX || a.localY !== b.localY) return false;
  const boxSame = !a.box || !b.box ? a.box === b.box : a.box.x0 === b.box.x0 && a.box.y0 === b.box.y0 && a.box.x1 === b.box.x1 && a.box.y1 === b.box.y1;
  const rectSame =
    !a.rect || !b.rect
      ? a.rect === b.rect
      : a.rect.left === b.rect.left && a.rect.top === b.rect.top && a.rect.width === b.rect.width && a.rect.height === b.rect.height;
  return boxSame && rectSame;
}

export function setSelectionAnchor(anchor: SelectionAnchor | null): void {
  const cur = overlayStore.getState().anchor;
  if (cur === anchor || (cur && anchor && sameAnchor(cur, anchor))) return;
  overlayStore.setState({ anchor });
}

export function useSelectionAnchor(): SelectionAnchor | null {
  return overlayStore((s) => s.anchor);
}

/** A bottom sheet's current height (px), or null when it closes. */
export function setSheetHeight(sheetId: string, height: number | null): void {
  const { sheets } = overlayStore.getState();
  if (height === null) {
    if (!(sheetId in sheets)) return;
    const next = { ...sheets };
    delete next[sheetId];
    overlayStore.setState({ sheets: next });
  } else if (sheets[sheetId] !== height) overlayStore.setState({ sheets: { ...sheets, [sheetId]: height } });
}

/** How much of the bottom of the screen the open sheets cover (px). */
export function useSheetInset(): number {
  return overlayStore((s) => Object.values(s.sheets).reduce((m, h) => Math.max(m, h), 0));
}


export function setPropertiesSheet(open: boolean): void {
  if (overlayStore.getState().propertiesSheet !== open) overlayStore.setState({ propertiesSheet: open });
}

export function usePropertiesSheet(): boolean {
  return overlayStore((s) => s.propertiesSheet);
}
