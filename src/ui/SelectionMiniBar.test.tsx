// @vitest-environment jsdom
/**
 * SelectionMiniBar.tsx, final fix round: the phone mini-bar (Egenskaper · Slett) shows only with Velg. While a
 * placement tool is active (Nytt bygg, Vegg, Dør/vindu, Mål, Møbler with or without an armed item) it is not on the
 * plan, so the tap that places a shed where the bar of the moved door stood cannot hit its Slett. Sixth review: two
 * fingers on the bar (or one on it and one on the plan) are handed to the plan; a lone tap stays the bar's.
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

describe('two fingers through the mini-bar reach the plan (sixth review)', () => {
  type Seen = [type: string, id: number, x: number, y: number];
  /** A stand-in for the plan's svg that records the pointer events it gets; `captures`: hasPointerCapture says yes. */
  function fakePlan(captures: boolean) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-testid', 'plan-view');
    document.body.appendChild(svg);
    const seen: Seen[] = [];
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      svg.addEventListener(t, (e) => {
        const p = e as PointerEvent;
        expect(p.pointerType).toBe('touch');
        seen.push([t, p.pointerId, p.clientX, p.clientY]);
      });
    }
    Object.assign(svg, { hasPointerCapture: () => captures });
    return { svg, seen };
  }
  const touch = (el: Element, type: string, id: number, x: number, y: number, isPrimary: boolean) =>
    act(() => void el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0 })));
  let actions: UiEditActions & Record<string, Mock>;
  const showBar = () => {
    act(() => void appStore.getState().duplicateVariant(initialProject.activeVariantId, 'Mitt forslag'));
    actions = Object.fromEntries(Object.keys(NOOP_EDIT_ACTIONS).map((k) => [k, vi.fn()])) as unknown as UiEditActions & Record<string, Mock>;
    render(
      <EditActionsProvider actions={actions}>
        <SelectionMiniBar />
      </EditActionsProvider>,
    );
    act(() => setSelectionAnchor({ x: 200, y: 300 }));
    act(() => appStore.getState().select({ kind: 'opening', id: 'o-1' }));
    expect(byTestId('mini-bar')?.style.touchAction).toBe('none');
  };
  afterEach(() => document.querySelectorAll('[data-testid="plan-view"]').forEach((el) => el.remove()));

  it('a lone tap on a button stays the bar\'s: the plan gets nothing, Egenskaper opens', () => {
    const { seen } = fakePlan(true);
    showBar();
    const props = byTestId('mini-properties')!;
    touch(props, 'pointerdown', 1, 200, 320, true);
    touch(props, 'pointerup', 1, 200, 320, true);
    act(() => props.click());
    expect(seen).toEqual([]);
    // Egenskaper opened the sheet, so the bar steps aside.
    expect(byTestId('mini-bar')).toBeNull();
  });

  it('both fingers on the bar: the plan gets both presses, their moves and releases; the click after it is dropped', () => {
    const { seen } = fakePlan(false);
    showBar();
    const props = byTestId('mini-properties')!;
    const del = byTestId('mini-delete')!;
    touch(props, 'pointerdown', 1, 180, 320, true);
    expect(seen).toEqual([]);
    touch(del, 'pointerdown', 2, 230, 320, false);
    expect(seen).toEqual([
      ['pointerdown', 1, 180, 320],
      ['pointerdown', 2, 230, 320],
    ]);
    // Without the plan's capture the bar passes the fingers' moves and releases on.
    touch(props, 'pointermove', 1, 160, 320, true);
    touch(del, 'pointermove', 2, 250, 320, false);
    touch(props, 'pointerup', 1, 160, 320, true);
    touch(del, 'pointerup', 2, 250, 320, false);
    expect(seen.slice(2)).toEqual([
      ['pointermove', 1, 160, 320],
      ['pointermove', 2, 250, 320],
      ['pointerup', 1, 160, 320],
      ['pointerup', 2, 250, 320],
    ]);
    act(() => del.click());
    act(() => props.click());
    expect(actions.deleteOpening).not.toHaveBeenCalled();
    expect(byTestId('mini-bar'), 'Egenskaper did not open').not.toBeNull();
  });

  it('one finger on the plan, then one on the bar (or the other way round): the plan gets the bar\'s finger too', () => {
    const { svg, seen } = fakePlan(true);
    showBar();
    const props = byTestId('mini-properties')!;
    // Plan first.
    touch(svg, 'pointerdown', 1, 150, 380, true);
    touch(props, 'pointerdown', 2, 200, 320, false);
    expect(seen).toEqual([
      ['pointerdown', 1, 150, 380],
      ['pointerdown', 2, 200, 320],
    ]);
    // The plan captured it: the bar relays nothing more; the release comes to the plan itself.
    touch(props, 'pointermove', 2, 210, 320, false);
    expect(seen).toHaveLength(2);
    touch(svg, 'pointerup', 1, 150, 380, true);
    touch(svg, 'pointerup', 2, 210, 320, false);
    seen.length = 0;
    // Bar first: handed over as soon as the second finger lands on the plan.
    touch(props, 'pointerdown', 3, 200, 320, true);
    expect(seen).toEqual([]);
    touch(svg, 'pointerdown', 4, 150, 380, false);
    expect(seen).toEqual([
      ['pointerdown', 4, 150, 380],
      ['pointerdown', 3, 200, 320],
    ]);
    touch(svg, 'pointerup', 3, 200, 320, true);
    touch(svg, 'pointerup', 4, 150, 380, false);
    act(() => props.click());
    expect(byTestId('mini-bar'), 'Egenskaper did not open').not.toBeNull();
  });
});
