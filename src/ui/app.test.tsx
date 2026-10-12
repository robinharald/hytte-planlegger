// @vitest-environment jsdom
/**
 * Smoke test of the whole shell in plan-only view (the 3D view needs WebGL and is covered by the e2e test).
 * `deriveVariant` is mocked to the UI fixture so the test does not depend on the geometry pipeline.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDerived } from './testDerived';

vi.mock('../geometry/derive', () => ({ deriveVariant: () => makeDerived() }));

const { appStore } = await import('../state/appStore');
const { default: App } = await import('../App');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeEach(() => {
  appStore.getState().setUi({ activeView: 'plan', selection: null, readOnly: false, source: 'local' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<App />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('App shell (plan only)', () => {
  it('renders the contracted test ids and reports ready without the 3D view', () => {
    for (const id of ['view-tab-plan', 'view-tab-3d', 'view-tab-split', 'plan-storey-ground', 'plan-storey-loft', 'room-schedule', 'area-totals', 'toggle-labels', 'toggle-new', 'plan-view', 'headline']) {
      expect(byTestId(id), id).not.toBeNull();
    }
    expect(byTestId('view-3d')).toBeNull();
    expect(window.__hytte?.ready).toBe(true);
    expect(window.__hytte?.project).toBe(appStore.getState().project);
    expect(byTestId('area-totals')?.textContent).toContain('BYA');
  });

  it('help dialog opens, and Esc closes it without clearing the selection', () => {
    act(() => appStore.getState().select({ kind: 'room', id: 'room-1' }));
    const helpButton = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Hjelp'));
    act(() => helpButton?.click());
    expect(byTestId('help-dialog')?.textContent).toContain('Slik bruker du den');
    expect(byTestId('help-dialog')?.textContent).toContain('Ctrl+Z');
    act(() => void document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(byTestId('help-dialog')).toBeNull();
    expect(appStore.getState().ui.selection).toEqual({ kind: 'room', id: 'room-1' });
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(appStore.getState().ui.selection).toBeNull();
  });

  it('share dialog shows a #d= link and its size', () => {
    const shareButton = byTestId('open-share');
    act(() => shareButton?.click());
    const dialog = byTestId('share-dialog');
    const link = dialog?.querySelector('textarea')?.value ?? '';
    expect(link).toContain('#d=');
    expect(dialog?.textContent).toMatch(/Lengde: \d/);
    // Forslag D as bootstrapped is sent as a delta against the bundled seed: short, no "send JSON" warning.
    expect(link.length).toBeLessThan(1024);
    expect(dialog?.textContent).not.toContain('over 8 kB');
  });

  it('read-only (shared link): banner, view controls kept, edit actions and undo gone', () => {
    act(() => appStore.getState().replaceProject(appStore.getState().project, { readOnly: true, source: 'link' }));
    expect(byTestId('banner-shared')).not.toBeNull();
    expect(byTestId('make-copy')).not.toBeNull();
    expect(byTestId('view-tab-plan')).not.toBeNull();
    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Lagre versjon');
    expect(labels).not.toContain('+ Nytt forslag');
    expect(labels).toContain('Send forslaget');
    expect(labels).toContain('Hjelp');
    expect(document.querySelector('[aria-label="Angre"]')).toBeNull();
    act(() => appStore.getState().replaceProject(appStore.getState().project, { readOnly: false, source: 'local' }));
  });
});

describe('App shell, phase 2', () => {
  it('toolbar and hint line over the stage, Egenskaper on top of the right column, the first-run card once', () => {
    expect(byTestId('toolbar')).not.toBeNull();
    expect(byTestId('hint-line')).not.toBeNull();
    expect(document.querySelector('.side details.panel')?.getAttribute('data-testid')).toBe('properties');
    const card = byTestId('first-run');
    expect(card?.textContent).toContain('Forslag D er det faste grunnlaget og kan ikke endres. «+ Nytt forslag» lager en kopi');
    act(() => byTestId('first-run-ok')?.click());
    expect(byTestId('first-run')).toBeNull();
    expect(window.localStorage.getItem('hytte-planlegger:first-run-seen')).not.toBeNull();
  });

  it('Møbler swaps the left column for the library; "Lukk" goes back to Velg', () => {
    act(() => appStore.getState().setUi({ tool: 'furniture' }));
    expect(byTestId('furniture-library')?.textContent).toContain('Møbler');
    expect(byTestId('view-tab-plan')).toBeNull();
    act(() => byTestId('library-close')?.click());
    expect(appStore.getState().ui.tool).toBe('select');
    expect(byTestId('view-tab-plan')).not.toBeNull();
  });
});
