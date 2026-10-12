/**
 * Phone mini-bar (docs/phase2-plan.md §3.1): "Egenskaper · Roter · Slett" floating above the selected element.
 *
 *  - Position: the plan reports the selection's top centre in viewport pixels (overlay `anchor`, PlanView
 *    `onSelectionBar`); the bar sits 12 px above it, kept 8 px inside the screen. Without an anchor (3D view, or the
 *    plan has not reported one) it floats at the bottom centre.
 *  - Shown on phones while something resolvable is selected, not while read-only and not while the Egenskaper
 *    sheet is open (the sheet already covers that).
 *  - Egenskaper opens the bottom sheet; Roter only for furniture; Slett only for what can be deleted
 *    (commands.ts). On the locked base proposal Roter / Slett show the refusal toast.
 */
import { useMemo } from 'react';
import { nb } from '../i18n/nb';
import { useAppStore } from '../state/appStore';
import { useDerived } from '../state/useDerived';
import { canRotate, deleteCall, deleteResolved, rotateResolved } from './commands';
import { IconRotate, IconSliders, IconTrash } from './common';
import { useUiEditActions } from './editorBridge';
import { setPropertiesSheet, usePropertiesSheet, useSelectionAnchor } from './overlay';
import { resolveUiSelection } from './uiSelection';

/** Bar width used to keep it on screen before it is measured (px). */
const BAR_HALF_WIDTH = 130;

export function SelectionMiniBar() {
  const derived = useDerived();
  const selection = useAppStore((s) => s.ui.selection);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const anchor = useSelectionAnchor();
  const sheetOpen = usePropertiesSheet();
  const actions = useUiEditActions();
  const resolved = useMemo(() => resolveUiSelection(derived, selection), [derived, selection]);
  if (!resolved || readOnly || sheetOpen) return null;

  const deletable = deleteCall(resolved, actions) !== null;
  const style =
    anchor && typeof window !== 'undefined'
      ? {
          left: Math.min(Math.max(anchor.x, BAR_HALF_WIDTH + 8), window.innerWidth - BAR_HALF_WIDTH - 8),
          top: Math.max(8, anchor.y - 12),
        }
      : undefined;

  return (
    <div className="mini-bar" data-anchored={anchor ? true : undefined} style={style} role="toolbar" aria-label={nb.miniBar.label} data-testid="mini-bar">
      <button type="button" onClick={() => setPropertiesSheet(true)} data-testid="mini-properties">
        <IconSliders />
        <span>{nb.miniBar.properties}</span>
      </button>
      {canRotate(resolved) && (
        <button type="button" onClick={() => rotateResolved(resolved, actions)} data-testid="mini-rotate">
          <IconRotate />
          <span>{nb.miniBar.rotate}</span>
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
