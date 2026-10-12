// @vitest-environment jsdom
/**
 * Toolbar, hint line, toasts, keyboard and the phone mini-bar against the app store singleton (bootstrapped from the
 * seed, so the active proposal is the LOCKED Forslag D) with `deriveVariant` mocked to the UI fixture:
 *  - the locked base proposal: editing tools greyed, a click shows the refusal toast whose "Nytt forslag" copies the
 *    proposal and switches to it;
 *  - tool switching, the opening / unit choosers, the hint texts, 3D-only → plan for plan tools;
 *  - Angre / Gjør om; toasts ([Angre], auto-dismiss, no duplicates);
 *  - keyboard: Esc leaves the tool, Delete deletes with "Slettet. [Angre]", arrows nudge; refused on the base;
 *  - the mini-bar (Egenskaper · Roter · Slett) and its anchor.
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
const { nb } = await import('../i18n/nb');
const { Toolbar } = await import('./Toolbar');
const { HintLine } = await import('./HintLine');
const { Toasts, TOAST_MS } = await import('./Toasts');
const { SelectionMiniBar } = await import('./SelectionMiniBar');
const { useKeyboardShortcuts } = await import('./hooks');
const { EditActionsProvider, NOOP_EDIT_ACTIONS, showToast } = await import('./editorBridge');
const { overlayStore, setPropertiesSheet, setSelectionAnchor } = await import('./overlay');
type UiEditActions = import('./editorBridge').UiEditActions;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialProject = appStore.getState().project;
const baseId = initialProject.activeVariantId;

let container: HTMLDivElement;
let root: Root;

const render = (node: ReactNode) => act(() => root.render(node));
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null) => {
  if (!el) throw new Error('element not found');
  act(() => (el as HTMLElement).click());
};
const keydown = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })));
const ui = () => appStore.getState().ui;
const toastTexts = () => appStore.getState().toasts.map((t) => t.text);

/** Edit actions whose calls are recorded; the delete actions change the project, like the real ones. */
function recordingActions(): UiEditActions & Record<string, Mock> {
  const out: Record<string, Mock> = {};
  for (const k of Object.keys(NOOP_EDIT_ACTIONS)) out[k] = vi.fn();
  const touch = () => appStore.getState().updateActiveVariant((v) => void (v.notes = `${v.notes ?? ''}x`));
  out.deleteOpening = vi.fn(touch);
  out.deleteWall = vi.fn(touch);
  return out as unknown as UiEditActions & Record<string, Mock>;
}

function Keys(props: { actions: UiEditActions }) {
  useKeyboardShortcuts(props.actions);
  return null;
}

function unlock() {
  act(() => void appStore.getState().duplicateVariant(baseId, 'Mitt forslag'));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  appStore.getState().replaceProject(initialProject, {
    readOnly: false,
    source: 'local',
    activeView: 'plan',
    tool: 'select',
    toolOptions: {},
    hint: null,
    selection: null,
  });
  appStore.setState({ toasts: [] });
  setPropertiesSheet(false);
  setSelectionAnchor(null);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('the locked base proposal', () => {
  it('greys the editing tools; a click shows the refusal toast and "Nytt forslag" makes an editable copy', () => {
    render(
      <>
        <Toolbar />
        <HintLine />
        <Toasts />
      </>,
    );
    expect(appStore.getState().project.variants.find((v) => v.id === baseId)?.locked).toBe(true);
    for (const t of ['wall', 'opening', 'unit', 'furniture']) expect(byTestId(`tool-${t}`)?.getAttribute('aria-disabled'), t).toBe('true');
    for (const t of ['select', 'measure']) expect(byTestId(`tool-${t}`)?.getAttribute('aria-disabled'), t).toBeNull();
    expect(byTestId('hint-line')?.textContent).toContain(nb.hints.locked);

    click(byTestId('tool-wall'));
    expect(ui().tool).toBe('select');
    expect(toastTexts()).toEqual([nb.proposals.locked]);
    click(byTestId('tool-unit'));
    expect(toastTexts()).toEqual([nb.proposals.locked]); // shown again, not twice

    click(byTestId('toast-new-proposal'));
    const { project } = appStore.getState();
    const active = project.variants.find((v) => v.id === project.activeVariantId);
    expect(project.variants).toHaveLength(initialProject.variants.length + 1);
    expect(active?.name).toBe('Mitt forslag');
    expect(active?.locked).toBeUndefined();
    expect(toastTexts()).toEqual([nb.proposals.created('Mitt forslag')]);
    expect(byTestId('tool-wall')?.getAttribute('aria-disabled')).toBeNull();
    expect(byTestId('hint-line')?.textContent).toBe(nb.hints.select);

    // The measuring tool works on the base too.
    act(() => appStore.getState().setActiveVariant(baseId));
    click(byTestId('tool-measure'));
    expect(ui().tool).toBe('measure');
  });

  it('the hint line\'s "Nytt forslag" also copies; a second copy is numbered', () => {
    render(<HintLine />);
    click(byTestId('hint-new-proposal'));
    act(() => appStore.getState().setActiveVariant(baseId));
    click(byTestId('hint-new-proposal'));
    const names = appStore.getState().project.variants.map((v) => v.name);
    expect(names).toContain('Mitt forslag');
    expect(names).toContain('Mitt forslag 2');
  });
});

describe('tools', () => {
  it('switch tools, choose types and templates, show the hint for each', () => {
    unlock();
    render(
      <>
        <Toolbar />
        <HintLine />
      </>,
    );
    click(byTestId('tool-wall'));
    expect(ui().tool).toBe('wall');
    expect(byTestId('tool-wall')?.getAttribute('aria-pressed')).toBe('true');
    expect(byTestId('hint-line')?.textContent).toBe('Trykk der veggen skal begynne');
    act(() => appStore.getState().setUi({ hint: nb.hints.wallEnd }));
    expect(byTestId('hint-line')?.textContent).toBe('Trykk der den skal slutte (Esc avbryter)');
    click(byTestId('tool-wall'));
    expect(ui().tool).toBe('select');
    expect(ui().hint).toBeNull();

    click(byTestId('tool-opening'));
    expect(ui().toolOptions.openingType).toBe('window');
    expect(byTestId('hint-line')?.textContent).toBe('Velg type, og trykk på en vegg');
    click(byTestId('opening-type-door'));
    expect(ui().toolOptions.openingType).toBe('door');
    expect(byTestId('opening-type-door')?.getAttribute('aria-pressed')).toBe('true');

    click(byTestId('tool-unit'));
    expect(ui().tool).toBe('unit');
    expect(ui().toolOptions.unitTemplate).toBe('vedskjul');
    expect(byTestId('tool-options-unit')?.textContent).toContain('Vedskjul2 × 1,5 m, åpen front');
    click(byTestId('unit-bod'));
    click(byTestId('unit-rotate'));
    expect(ui().toolOptions).toMatchObject({ unitTemplate: 'bod', unitRotation90: 1, openingType: 'door' });
    render(
      <>
        <Toolbar />
        <HintLine />
        <Keys actions={NOOP_EDIT_ACTIONS} />
      </>,
    );
    keydown('r');
    expect(ui().toolOptions.unitRotation90).toBe(2);
    expect(byTestId('hint-line')?.textContent).toBe('Trykk der bygget skal stå – det fester seg til terrassekanten og veggene');

    act(() => appStore.getState().setUi({ activeView: '3d' }));
    click(byTestId('tool-measure'));
    expect(ui()).toMatchObject({ tool: 'measure', activeView: 'plan' });
    expect(byTestId('hint-line')?.textContent).toBe('Trykk på to punkter');
    act(() => appStore.getState().setUi({ activeView: '3d' }));
    click(byTestId('tool-furniture'));
    expect(ui()).toMatchObject({ tool: 'furniture', activeView: '3d' });
  });

  it('Angre / Gjør om follow the history', () => {
    unlock();
    render(<Toolbar />);
    act(() => appStore.getState().clearHistory());
    expect((byTestId('undo') as HTMLButtonElement).disabled).toBe(true);
    const id = appStore.getState().project.activeVariantId;
    act(() => appStore.getState().renameVariant(id, 'Nytt navn'));
    expect((byTestId('undo') as HTMLButtonElement).disabled).toBe(false);
    click(byTestId('undo'));
    expect(appStore.getState().project.variants.find((v) => v.id === id)?.name).toBe('Mitt forslag');
    click(byTestId('redo'));
    expect(appStore.getState().project.variants.find((v) => v.id === id)?.name).toBe('Nytt navn');
  });

  it('a warning count badge before Angre opens Advarsler', async () => {
    unlock();
    const panel = document.createElement('details');
    panel.id = 'panel-warnings';
    document.body.appendChild(panel);
    render(<Toolbar />);
    // The UI fixture has three warnings.
    const badge = byTestId('toolbar-warnings');
    expect(badge?.textContent).toBe('3');
    expect(badge?.getAttribute('aria-label')).toBe(nb.tools.warnings(3));
    expect(badge?.parentElement?.classList.contains('toolbar-history')).toBe(true);
    click(badge);
    await act(async () => {
      await new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r(null)) : r(null)));
    });
    expect(panel.open).toBe(true);
    panel.remove();
  });

  it('is hidden while read-only (shared link)', () => {
    act(() => appStore.getState().setUi({ readOnly: true }));
    render(
      <>
        <Toolbar />
        <HintLine />
      </>,
    );
    expect(byTestId('toolbar')).toBeNull();
    expect(byTestId('hint-line')).toBeNull();
  });
});

describe('toasts', () => {
  it('[Angre] undoes and closes; the same text is not shown twice; toasts close by themselves', () => {
    vi.useFakeTimers();
    unlock();
    render(<Toasts />);
    const undo = vi.spyOn(appStore.getState(), 'undo');
    act(() => void showToast({ text: nb.toasts.deleted, undo: true }));
    act(() => void showToast({ text: nb.toasts.deleted, undo: true }));
    expect(document.querySelectorAll('[data-testid="toast"]')).toHaveLength(1);
    click(byTestId('toast-undo'));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(byTestId('toast')).toBeNull();
    undo.mockRestore();

    act(() => void showToast({ text: 'Hei' }));
    expect(byTestId('toast')?.textContent).toContain('Hei');
    act(() => void vi.advanceTimersByTime(TOAST_MS + 1));
    expect(byTestId('toast')).toBeNull();
  });
});

describe('keyboard', () => {
  it('Esc leaves a tool first, then clears the selection', () => {
    unlock();
    render(<Keys actions={NOOP_EDIT_ACTIONS} />);
    act(() => appStore.getState().setUi({ tool: 'wall', selection: { kind: 'wall', id: 'w-1' } }));
    keydown('Escape');
    expect(ui().tool).toBe('select');
    expect(ui().selection).not.toBeNull();
    keydown('Escape');
    expect(ui().selection).toBeNull();
  });

  it('Delete deletes with "Slettet. [Angre]": a new element is deselected, an existing one stays (as a ghost)', () => {
    unlock();
    const actions = recordingActions();
    render(<Keys actions={actions} />);
    act(() => appStore.getState().select({ kind: 'opening', id: 'o-1' }));
    keydown('Delete');
    expect(actions.deleteOpening).toHaveBeenCalledWith('o-1');
    expect(toastTexts()).toEqual([nb.toasts.deleted]);
    expect(appStore.getState().toasts[0].undo).toBe(true);
    expect(ui().selection).toBeNull();

    act(() => appStore.getState().select({ kind: 'wall', id: 'w-1' }));
    keydown('Backspace');
    expect(actions.deleteWall).toHaveBeenCalledWith('w-1');
    expect(ui().selection).toEqual({ kind: 'wall', id: 'w-1' });

    // Exterior walls cannot be deleted; nothing happens.
    act(() => appStore.getState().select({ kind: 'wall', id: 'blk-1/v-sw/blk-1/base' }));
    keydown('Delete');
    expect(actions.deleteWall).toHaveBeenCalledTimes(1);
  });

  it('arrows nudge 1 cm (Shift 10 cm); typing in a field is left alone', () => {
    unlock();
    const actions = recordingActions();
    render(
      <>
        <Keys actions={actions} />
        <input data-testid="field" />
      </>,
    );
    act(() => appStore.getState().select({ kind: 'wall', id: 'w-1' }));
    keydown('ArrowRight');
    expect(actions.nudge).toHaveBeenLastCalledWith({ kind: 'wall', id: 'w-1' }, 0.01, 0);
    keydown('ArrowUp', { shiftKey: true });
    expect(actions.nudge).toHaveBeenLastCalledWith({ kind: 'wall', id: 'w-1' }, 0, 0.1);
    keydown('Delete', {}, byTestId('field') as HTMLElement);
    keydown('ArrowLeft', {}, byTestId('field') as HTMLElement);
    expect(actions.deleteWall).not.toHaveBeenCalled();
    expect(actions.nudge).toHaveBeenCalledTimes(2);
  });

  it('on the base proposal, Delete and the arrows are refused with the toast and call nothing', () => {
    const actions = recordingActions();
    render(<Keys actions={actions} />);
    act(() => appStore.getState().select({ kind: 'opening', id: 'o-1' }));
    keydown('Delete');
    keydown('ArrowLeft');
    expect(actions.deleteOpening).not.toHaveBeenCalled();
    expect(actions.nudge).not.toHaveBeenCalled();
    expect(toastTexts()).toEqual([nb.proposals.locked]);
  });
});

describe('phone mini-bar', () => {
  it('Egenskaper opens the sheet; Slett only for what can be deleted; placed by the selection, hidden without an anchor', () => {
    unlock();
    const actions = recordingActions();
    render(
      <EditActionsProvider actions={actions}>
        <SelectionMiniBar />
      </EditActionsProvider>,
    );
    expect(byTestId('mini-bar')).toBeNull();
    act(() => setSelectionAnchor({ x: 400, y: 300 }));
    act(() => appStore.getState().select({ kind: 'room', id: 'face-abc', levelId: 'main' }));
    expect(byTestId('mini-properties')).not.toBeNull();
    expect(byTestId('mini-delete')).toBeNull(); // an unnamed face cannot be deleted
    expect(byTestId('mini-rotate')).toBeNull();
    expect(byTestId('mini-bar')?.hasAttribute('data-anchored')).toBe(true);
    // The bar (50 px before it is measured) sits 12 px above the selection, centred on it.
    expect(byTestId('mini-bar')?.style.top).toBe('238px');
    expect(byTestId('mini-bar')?.style.left).toBe('400px');

    // While a drag is in progress the plan reports no anchor: the bar hides instead of jumping to the bottom.
    act(() => setSelectionAnchor(null));
    expect(byTestId('mini-bar')).toBeNull();
    // Only the 3D view (no plan on screen) uses the bottom-centre fallback.
    act(() => appStore.getState().setUi({ activeView: '3d' }));
    expect(byTestId('mini-bar')?.hasAttribute('data-anchored')).toBe(false);
    act(() => appStore.getState().setUi({ activeView: 'plan' }));
    act(() => setSelectionAnchor({ x: 400, y: 300 }));

    act(() => appStore.getState().select({ kind: 'opening', id: 'o-1' }));
    click(byTestId('mini-delete'));
    expect(actions.deleteOpening).toHaveBeenCalledWith('o-1');

    act(() => appStore.getState().select({ kind: 'wall', id: 'w-1' }));
    click(byTestId('mini-properties'));
    expect(overlayStore.getState().propertiesSheet).toBe(true);
    expect(byTestId('mini-bar')).toBeNull();
  });
});
