/**
 * Phone mini-bar (docs/phase2-plan.md §3.1): "Egenskaper · Roter · Slett" floating by the selected element.
 *
 *  - Position (miniBarPlacement.ts `placeMiniBar`, pure): from the selection's screen box, which the plan reports (overlay `anchor`,
 *    PlanView `onSelectionBar`) and reports again when the plan is panned or zoomed and when the page scrolls or
 *    resizes. The bar sits 12 px above the box; when there is no room above it (it would cover the toolbar or the
 *    hint line, or leave the screen) it flips below the box; it never covers the toolbar / hint line or an open
 *    bottom sheet, and stays 8 px inside the screen sideways.
 *  - Hidden while the plan has nothing to anchor to: during a drag (the plan reports null then) and when the
 *    selection is out of view. Only the 3D view (no plan on screen) uses the bottom-centre fallback.
 *  - Shown on phones while something resolvable is selected, not while read-only and not while the Egenskaper
 *    sheet is open (the sheet already covers that).
 *  - Egenskaper opens the bottom sheet; Roter for furniture and placed "Nytt bygg" units (commands.ts `canRotate`);
 *    Slett only for what can be deleted. On the locked base proposal Roter / Slett show the refusal toast.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { nb } from '../i18n/nb';
import { useAppStore } from '../state/appStore';
import { useDerived } from '../state/useDerived';
import { canRotate, deleteCall, deleteResolved, rotateResolved } from './commands';
import { IconRotate, IconSliders, IconTrash } from './common';
import { useUiEditActions } from './editorBridge';
import { BAR_HEIGHT, BAR_WIDTH, placeMiniBar } from './miniBarPlacement';
import { setPropertiesSheet, usePropertiesSheet, useSelectionAnchor, useSheetInset } from './overlay';
import { toolbarBottom } from './reveal';
import { resolveUiSelection } from './uiSelection';

export function SelectionMiniBar() {
  const derived = useDerived();
  const selection = useAppStore((s) => s.ui.selection);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const planShown = useAppStore((s) => s.ui.activeView !== '3d');
  const anchor = useSelectionAnchor();
  const sheetOpen = usePropertiesSheet();
  const sheetInset = useSheetInset();
  const actions = useUiEditActions();
  const resolved = useMemo(() => resolveUiSelection(derived, selection), [derived, selection]);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: BAR_WIDTH, height: BAR_HEIGHT });
  // Measure the bar once it is on screen (its buttons depend on the selection); jsdom measures 0 and keeps the default.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    if (width > 0 && height > 0 && (width !== size.width || height !== size.height)) setSize({ width, height });
  }, [resolved, anchor, size.width, size.height]);

  if (!resolved || readOnly || sheetOpen) return null;
  // The plan is on screen but reports no anchor: a drag is in progress or the selection is out of view.
  if (planShown && !anchor) return null;

  const deletable = deleteCall(resolved, actions) !== null;
  const placed =
    anchor && typeof window !== 'undefined'
      ? placeMiniBar({
          anchor,
          bar: size,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          chromeBottom: toolbarBottom(),
          floor: window.innerHeight - sheetInset,
        })
      : null;

  return (
    <div
      ref={ref}
      className="mini-bar"
      data-anchored={placed ? true : undefined}
      data-below={placed?.below || undefined}
      style={placed ? { left: placed.left, top: placed.top } : undefined}
      role="toolbar"
      aria-label={nb.miniBar.label}
      data-testid="mini-bar"
    >
      <button type="button" onClick={() => setPropertiesSheet(true)} data-testid="mini-properties">
        <IconSliders />
        <span>{nb.miniBar.properties}</span>
      </button>
      {canRotate(resolved) && (
        <button type="button" onClick={() => rotateResolved(resolved, actions)} data-testid="mini-rotate">
          <IconRotate />
          <span>{resolved.kind === 'block' ? nb.edit.block.rotate : nb.miniBar.rotate}</span>
        </button>
      )}
      {deletable && (
        <button type="button" className="danger" onClick={() => deleteResolved(resolved, actions)} data-testid="mini-delete">
          <IconTrash />
          <span>{nb.miniBar.delete}</span>
        </button>
      )}
    </div>
  );
}
