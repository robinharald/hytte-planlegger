// @vitest-environment jsdom
/**
 * The 3D panel's camera presets (Controls.tsx) after a walk ended with Esc (fix round 3 after phase 3): while the
 * walker's view is kept no preset is shown pressed, and a tap on the preset already chosen asks the camera rig to go
 * there (walkState `presetRequest`) — before, it did nothing. `deriveVariant` mocked as in controlsWalkSun.test.tsx.
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDerived } from './testDerived';

vi.mock('../geometry/derive', () => ({ deriveVariant: () => makeDerived() }));

const { appStore } = await import('../state/appStore');
const { Controls } = await import('./Controls');
const { resetView3dLocal, setViewKept, startWalk, stopWalk, view3dLocal } = await import('../view3d/walkState');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const initialProject = appStore.getState().project;

function render(node: ReactNode) {
  act(() => root.render(node));
}
const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null) => {
  if (!el) throw new Error('element not found');
  act(() => (el as HTMLElement).click());
};
const pressed = () => [...container.querySelectorAll('[data-testid^="preset-"][aria-pressed="true"]')].map((b) => b.getAttribute('data-testid'));

beforeEach(() => {
  resetView3dLocal();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  appStore.getState().replaceProject(initialProject, { readOnly: false, source: 'local', activeView: '3d', mode3d: 'ute', selection: null });
  appStore.getState().setUi({ preset: 'oversikt' });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetView3dLocal();
});

describe('camera presets after a walk ended with Esc', () => {
  it('no preset is pressed while the view is kept; a tap on «Oversikt» asks for it again and presses it', () => {
    render(<Controls isPhone={false} />);
    expect(pressed()).toEqual(['preset-oversikt']);
    // Esc: the walk ends and WalkControls keeps the walker's view.
    act(() => {
      startWalk();
      stopWalk();
      setViewKept(true);
    });
    expect(pressed()).toEqual([]);
    const before = view3dLocal.getState().presetRequest;
    click(byTestId('preset-oversikt'));
    expect(view3dLocal.getState().presetRequest).toBe(before + 1);
    expect(view3dLocal.getState().viewKept).toBe(false);
    expect(appStore.getState().ui.preset).toBe('oversikt');
    expect(pressed()).toEqual(['preset-oversikt']);
    // Any tap asks again, also on the pressed one (after orbiting away).
    click(byTestId('preset-oversikt'));
    expect(view3dLocal.getState().presetRequest).toBe(before + 2);
  });
});
