/**
 * Egenskaper connected to the app: the store (selection, read-only, the active proposal and its lock), the derived
 * model, the edit actions (editorBridge context), the overlay highlight and the selection commands. Rendered as the
 * first panel of the right column (desktop, tablet) and as a bottom sheet on phones (`PropertiesSheet`, opened by
 * the mini-bar's "Egenskaper" or a schedule row; it closes when the selection is cleared).
 */
import { useCallback, useEffect } from 'react';
import { nb } from '../i18n/nb';
import { appStore, useAppStore } from '../state/appStore';
import type { Selection } from '../state/selection';
import { useActiveVariant, useDerived } from '../state/useDerived';
import { BottomSheet } from './BottomSheet';
import { deleteResolved, guarded } from './commands';
import { Panel } from './common';
import { createNewProposal, isVariantLocked, setTool, showLockedToast, useUiEditActions } from './editorBridge';
import type { ToolKind } from './editorBridge';
import { setPanelHighlight, setPropertiesSheet, usePropertiesSheet } from './overlay';
import { PropertiesEditor } from './PropertiesEditor';
import { PROPERTIES_PANEL_ID } from './reveal';
import type { UiResolved } from './uiSelection';

const onSelect = (sel: Selection | null) => appStore.getState().select(sel);
const onTool = (tool: ToolKind) => guarded(() => setTool(tool));
const onNewProposal = () => void createNewProposal();

export function PropertiesBody(props: { hideClear?: boolean }) {
  const derived = useDerived();
  const variant = useActiveVariant();
  const selection = useAppStore((s) => s.ui.selection);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const actions = useUiEditActions();
  const onDelete = useCallback((r: UiResolved) => void deleteResolved(r, actions), [actions]);
  return (
    <PropertiesEditor
      derived={derived}
      variant={variant}
      selection={selection}
      actions={actions}
      locked={isVariantLocked(variant) && !readOnly}
      readOnly={readOnly}
      onLocked={showLockedToast}
      onNewProposal={onNewProposal}
      onHighlight={setPanelHighlight}
      onSelect={onSelect}
      onTool={onTool}
      onDelete={onDelete}
      hideClear={props.hideClear}
    />
  );
}

export function PropertiesPanel(props: { defaultOpen?: boolean }) {
  return (
    <Panel title={nb.properties.heading} defaultOpen={props.defaultOpen ?? true} id={PROPERTIES_PANEL_ID} testId="properties">
      <PropertiesBody />
    </Panel>
  );
}

/** Phone: Egenskaper as a bottom sheet while open and something is selected. */
export function PropertiesSheet() {
  const open = usePropertiesSheet();
  const hasSelection = useAppStore((s) => s.ui.selection !== null);
  // Clearing the selection closes the sheet, so the next tap does not pop it up again.
  useEffect(() => {
    if (!hasSelection) setPropertiesSheet(false);
  }, [hasSelection]);
  if (!open || !hasSelection) return null;
  return (
    <BottomSheet title={nb.properties.heading} onClose={() => setPropertiesSheet(false)} testId="properties-sheet">
      <PropertiesBody hideClear />
    </BottomSheet>
  );
}
