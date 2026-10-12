// @vitest-environment jsdom
/**
 * SelectionMiniBar.tsx, final fix round: the phone mini-bar (Egenskaper · Slett) shows only with Velg. While a
 * placement tool is active (Nytt bygg, Vegg, Dør/vindu, Mål, Møbler with or without an armed item) it is not on the
 * plan, so the tap that places a shed where the bar of the moved door stood cannot hit its Slett.
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { makeDerived } from './testDerived';

vi.mock('../geometry/derive', () => ({ deriveVariant: () => makeDerived() }));

const { appStore } = await import('../state/appStore');
const { SelectionMiniBar } = await import('./SelectionMiniBar');
const { EditActionsProvider, NOOP_EDIT_ACTIONS, TOOL_KINDS, setTool } = await import('./editorBridge');
const { setPropertiesSheet, setSelectionAnchor } = await import('./overlay');
type UiEditActions = import('./editorBridge').UiEditActions;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialProject = appStore.getState().project;
let container: HTMLDivElement;
let root: Root;
const render = (node: ReactNode) => act(() => root.render(node));
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  appStore.getState().replaceProject(initialProject, { readOnly: false, source: 'local', activeView: 'plan', tool: 'select', toolOptions: {}, hint: null, selection: null });
  setPropertiesSheet(false);
  setSelectionAnchor(null);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the phone mini-bar with a placement tool', () => {
  it('is hidden while any tool but Velg is active (also Møbler with an armed item) and back with Velg', () => {
    act(() => void appStore.getState().duplicateVariant(initialProject.activeVariantId, 'Mitt forslag'));
    const actions = Object.fromEntries(Object.keys(NOOP_EDIT_ACTIONS).map((k) => [k, vi.fn()])) as unknown as UiEditActions & Record<string, Mock>;
    render(
      <EditActionsProvider actions={actions}>
        <SelectionMiniBar />
      </EditActionsProvider>,
    );
    // The door just moved is selected: its bar with Slett floats by it.
    act(() => setSelectionAnchor({ x: 200, y: 300 }));
    act(() => appStore.getState().select({ kind: 'opening', id: 'o-1' }));
    expect(byTestId('mini-delete')).not.toBeNull();
    // Nytt bygg (the selection stays): no bar, so nothing of it can take the placement tap.
    act(() => setTool('unit'));
    expect(appStore.getState().ui.selection).toEqual({ kind: 'opening', id: 'o-1' });
    expect(byTestId('mini-bar')).toBeNull();
    for (const tool of TOOL_KINDS.filter((t) => t !== 'select')) {
      act(() => setTool(tool));
      expect(byTestId('mini-bar'), tool).toBeNull();
    }
    act(() => setTool('furniture', { furnitureItem: 'stol' }));
    expect(byTestId('mini-bar')).toBeNull();
    // Back to Velg: the bar is there again (an option left over from Møbler does not hide it).
    act(() => setTool('select'));
    expect(byTestId('mini-delete')).not.toBeNull();
    expect(actions.deleteOpening).not.toHaveBeenCalled();
  });
});
