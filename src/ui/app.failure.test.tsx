// @vitest-environment jsdom
/**
 * Smoke test of the shell when the geometry pipeline throws: the app must still render (plan, panels, headline)
 * with an empty model and the derive-failed warning from nb.ts, in edit mode and read-only.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../geometry/derive', () => ({
  deriveVariant: () => {
    throw new Error('boom');
  },
}));

const { appStore } = await import('../state/appStore');
const { default: App } = await import('../App');
const { nb } = await import('../i18n/nb');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let consoleError: ReturnType<typeof vi.spyOn>;
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeAll(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => consoleError.mockRestore());

beforeEach(() => {
  appStore.getState().setUi({ activeView: 'plan', selection: null, readOnly: false, source: 'local' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('App shell when derivation fails', () => {
  it('renders the plan, the panels and the derive-failed warning', () => {
    act(() => root.render(<App />));
    expect(byTestId('plan-view')).not.toBeNull();
    expect(byTestId('room-schedule')?.textContent).toContain(nb.schedule.empty);
    expect(byTestId('headline')?.textContent).toContain('BYA0,0 m²');
    expect(container.textContent).toContain(nb.warnings.deriveFailed('boom'));
    expect(window.__hytte?.derived.warnings).toEqual([{ kind: 'generic', message: nb.warnings.deriveFailed('boom') }]);
  });

  it('works read-only too (shared link)', () => {
    appStore.getState().replaceProject(appStore.getState().project, { readOnly: true, source: 'link' });
    act(() => root.render(<App />));
    expect(byTestId('banner-shared')).not.toBeNull();
    expect(container.textContent).not.toContain(nb.topbar.saveVersion);
    expect(container.textContent).toContain(nb.warnings.deriveFailed('boom'));
    expect(byTestId('open-share')).not.toBeNull();
  });
});
