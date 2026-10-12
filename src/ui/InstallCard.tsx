/**
 * "Legg planleggeren på Hjem-skjermen" (docs/phase2-plan.md §5): a card like the first-run card, shown after it, once
 * per browser ("Skjønner" hides it for good), never when the app already runs from the home screen.
 *
 *  - iPhone / iPad in Safari: how to add it (Del-knappen → «Legg til på Hjem-skjerm»). In shared mode it adds that this
 *    should be done with the family link open: a home-screen app on iOS has its own storage, and the address it opens
 *    is the page's address — which keeps `#f=<family>` (state/appStore.ts) — so it lands in the family's proposals.
 *  - Browsers that offer installation (`beforeinstallprompt`, Chrome / Edge / Android): an "Installer" button.
 * The user-agent check stays on the device (nothing is stored or sent).
 */
import { useSyncExternalStore } from 'react';
import { nb } from '../i18n/nb';
import { familyMode, storage, useAppStore } from '../state/appStore';
import { readRaw, writeRaw } from '../state/persistence';
import { installCardKind } from './familyUi';
import type { InstallEnv } from './familyUi';

export const INSTALL_CARD_KEY = 'hytte-planlegger:install-card-seen';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

let deferredPrompt: InstallPromptEvent | null = null;
let dismissed = readRaw(storage, INSTALL_CARD_KEY) !== null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

function currentEnv(): InstallEnv {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return { userAgent: '', platform: '', maxTouchPoints: 0, standalone: false };
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return { userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints ?? 0, standalone };
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const snapshot = () => `${dismissed}:${deferredPrompt !== null}`;

function dismiss(): void {
  dismissed = true;
  writeRaw(storage, INSTALL_CARD_KEY, new Date().toISOString());
  notify();
}

export function InstallCard() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const kind = installCardKind(currentEnv(), deferredPrompt !== null, dismissed);
  if (!kind || readOnly) return null;
  const t = nb.family.install;
  const install = async () => {
    const p = deferredPrompt;
    if (!p) return;
    deferredPrompt = null;
    await p.prompt().catch(() => {});
    dismiss();
  };
  return (
    <section className="first-run install-card" aria-label={t.heading} data-testid="install-card">
      <h2>{t.heading}</h2>
      <p>{kind === 'ios' ? t.ios : t.prompt}</p>
      {kind === 'ios' && familyMode === 'shared' && <p className="note">{t.iosShared}</p>}
      <div className="first-run-actions">
        {kind === 'prompt' && (
          <button type="button" className="btn btn-primary btn-small" onClick={() => void install()}>
            {t.install}
          </button>
        )}
        <button type="button" className={`btn btn-small${kind === 'ios' ? ' btn-primary' : ''}`} data-testid="install-ok" onClick={dismiss}>
          {t.ok}
        </button>
      </div>
    </section>
  );
}
