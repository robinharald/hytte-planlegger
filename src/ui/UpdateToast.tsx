/// <reference types="vite-plugin-pwa/react" />
/**
 * App updates of the PWA (docs/phase2-plan.md §5; vite.config.ts: `registerType: 'prompt'`, `injectRegister: false`).
 *
 *  - `useRegisterSW` registers the service worker. When a new version is installed and waiting, a toast says "Ny
 *    versjon av appen er klar. [Oppdater]"; Oppdater first saves the proposals (`flushProposalsAll`), then activates
 *    the new worker, which reloads the page. Nothing ever reloads by itself.
 *  - Checks for a new version every hour and whenever the page becomes visible again (online only).
 *  - A "too new" notice (a link, a file or a stored proposal from a newer app version) checks right away
 *    (`registration.update()`), so the toast appears as soon as the newer app is found; `requestAppUpdateCheck` does
 *    the same for the "Oppdater" button of the too-new banner (familyUi.ts).
 *  - `controllerchange` while this page runs the old code (another tab updated the app): "Appen er oppdatert i en
 *    annen fane … [Last på nytt]" (saves first). Not on the very first install and not for this page's own update.
 * In `npm run dev` the plugin's register module is a stub: nothing registers, nothing shows.
 */
import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { nb } from '../i18n/nb';
import { flushProposalsAll, reloadPage, useFamily, useNotices } from '../state/appStore';
import { checkForUpdateSoon, requestAppUpdateCheck, setUpdateRegistration } from './familyUi';

/** How often to look for a new version while the app is open. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

export function UpdateToast() {
  const updating = useRef(false);
  const [elsewhere, setElsewhere] = useState(false);
  const [busy, setBusy] = useState(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, r) {
      setUpdateRegistration(r ?? null);
    },
  });
  const tooNew = useNotices((s) => s.notices.some((n) => n === 'link-too-new' || n === 'import-too-new' || n === 'schema-too-new'));
  const tooNewProposals = useFamily((s) => s.tooNew.length > 0);

  useEffect(() => {
    const id = setInterval(checkForUpdateSoon, UPDATE_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkForUpdateSoon();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (tooNew || tooNewProposals) requestAppUpdateCheck();
  }, [tooNew, tooNewProposals]);

  useEffect(() => {
    const sw = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (!sw) return;
    const hadController = sw.controller !== null;
    const onChange = () => {
      if (hadController && !updating.current) setElsewhere(true);
    };
    sw.addEventListener('controllerchange', onChange);
    return () => sw.removeEventListener('controllerchange', onChange);
  }, []);

  if (!needRefresh && !elsewhere) return null;
  const u = nb.family.update;

  const update = async () => {
    setBusy(true);
    updating.current = true;
    await flushProposalsAll(3000);
    await updateServiceWorker(true);
  };
  const reload = async () => {
    setBusy(true);
    await flushProposalsAll(3000);
    reloadPage();
  };

  return (
    <div className="update-toast" role="status" data-testid="update-toast">
      <span>{needRefresh ? u.ready : u.updatedElsewhere}</span>
      <button type="button" className="btn btn-small" disabled={busy} data-testid="update-now" onClick={() => void (needRefresh ? update() : reload())}>
        {needRefresh ? u.button : u.reload}
      </button>
    </div>
  );
}
