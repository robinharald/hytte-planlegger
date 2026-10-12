// @vitest-environment jsdom
/**
 * UpdateToast and the PWA register module (`virtual:pwa-register/react`, stubbed here): when one tab presses
 * Oppdater, the new version takes over every tab and the plugin calls `onNeedReload` in each (without it, it reloads
 * them all by itself). Only the tab that pressed Oppdater reloads; the others say «Appen er oppdatert i en annen
 * fane …» and reload when the user presses «Last på nytt».
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nb } from '../i18n/nb';

const pwa = vi.hoisted(() => ({ options: null as { onNeedReload?: () => void } | null, needRefresh: true, updates: 0 }));
const app = vi.hoisted(() => ({ reloads: 0, flushes: 0 }));

vi.mock('virtual:pwa-register/react', async () => {
  const { useState } = await import('react');
  return {
    useRegisterSW(options: { onNeedReload?: () => void }) {
      pwa.options = options;
      const needRefresh = useState(pwa.needRefresh);
      const offlineReady = useState(false);
      return {
        needRefresh,
        offlineReady,
        updateServiceWorker: async () => {
          pwa.updates++;
        },
      };
    },
  };
});

vi.mock('../state/appStore', () => ({
  flushProposalsAll: async () => {
    app.flushes++;
  },
  reloadPage: () => {
    app.reloads++;
  },
  useFamily: <T,>(select: (s: { tooNew: unknown[] }) => T) => select({ tooNew: [] }),
  useNotices: <T,>(select: (s: { notices: string[] }) => T) => select({ notices: [] }),
}));

const { UpdateToast } = await import('./UpdateToast');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const toast = () => document.querySelector<HTMLElement>('[data-testid="update-toast"]');
const button = () => document.querySelector<HTMLButtonElement>('[data-testid="update-now"]');

beforeEach(() => {
  pwa.options = null;
  pwa.needRefresh = true;
  pwa.updates = 0;
  app.reloads = 0;
  app.flushes = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('app update across tabs', () => {
  it('another tab pressed Oppdater: this one does not reload by itself, it says so and reloads on «Last på nytt»', async () => {
    act(() => root.render(<UpdateToast />));
    expect(toast()?.textContent).toContain(nb.family.update.ready);
    expect(typeof pwa.options?.onNeedReload).toBe('function');
    // The new version took over (pressed in another tab).
    act(() => pwa.options?.onNeedReload?.());
    expect(app.reloads).toBe(0);
    expect(toast()?.textContent).toContain(nb.family.update.updatedElsewhere);
    expect(button()?.textContent).toBe(nb.family.update.reload);
    await act(async () => button()?.click());
    expect(app.flushes).toBe(1);
    expect(app.reloads).toBe(1);
    expect(pwa.updates).toBe(0);
  });

  it('the tab that pressed Oppdater saves, activates the new version and reloads when it takes over', async () => {
    act(() => root.render(<UpdateToast />));
    expect(button()?.textContent).toBe(nb.family.update.button);
    await act(async () => button()?.click());
    expect(app.flushes).toBe(1);
    expect(pwa.updates).toBe(1);
    expect(app.reloads).toBe(0);
    act(() => pwa.options?.onNeedReload?.());
    expect(app.reloads).toBe(1);
  });
});
