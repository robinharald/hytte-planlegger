/**
 * Banners above the top bar: shared (read-only) link with "Lag min egen kopi", a newer Forslag D seed, another
 * tab's newer save, a too-new stored schema ("Last siden på nytt") and one-off problems (broken link, import,
 * storage). Texts in i18n/nb.ts.
 *
 * The shared-link banner says what "Lag min egen kopi" does: it adds the shared variant(s) to the user's own project,
 * or makes the link the user's project when there is none (then "Tilbake til mitt prosjekt" reads "Vis Forslag D").
 * The other-tab banner offers "Hent endringene" or "Behold mine endringer"; this tab saves nothing until one is chosen.
 */
import type { ReactNode } from 'react';
import { nb } from '../i18n/nb';
import {
  acceptExternalChange,
  dismissNotice,
  dismissSeedUpdate,
  fetchNewSeed,
  keepOwnChanges,
  leaveSharedView,
  makeMyOwnCopy,
  reloadPage,
  resetToSeed,
  seedUpdateAvailable,
  useAppStore,
  useNotices,
} from '../state/appStore';
import type { AppNotice } from '../state/appStore';
import { SEED_REVISION } from '../model/seed/forslagD';

function Banner(props: { tone?: 'info' | 'warn'; children: ReactNode; actions?: ReactNode; testId?: string }) {
  return (
    <div className={`banner${props.tone === 'warn' ? ' warn' : ''}`} role="status" data-testid={props.testId}>
      <div className="msg">{props.children}</div>
      {props.actions && <div className="actions">{props.actions}</div>}
    </div>
  );
}

const SIMPLE: Partial<Record<AppNotice, string>> = {
  'link-invalid': nb.banners.linkInvalid,
  'link-too-new': nb.banners.linkTooNew,
  'link-rebased': nb.banners.linkRebased,
  'autosave-invalid': nb.banners.autosaveInvalid,
  'storage-unavailable': nb.banners.storageUnavailable,
  'save-failed': nb.banners.saveFailed,
  'import-failed': nb.banners.importFailed,
  'import-too-new': nb.banners.importTooNew,
  'version-failed': nb.banners.versionFailed,
};

function DismissButton(props: { notice: AppNotice }) {
  return (
    <button type="button" className="btn btn-small btn-ghost" onClick={() => dismissNotice(props.notice)}>
      {nb.banners.dismiss}
    </button>
  );
}

export function Banners() {
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const source = useAppStore((s) => s.ui.source);
  const project = useAppStore((s) => s.project);
  const notices = useNotices((s) => s.notices);
  const dismissedSeed = useNotices((s) => s.dismissedSeedRevision);
  const sharedHasOwn = useNotices((s) => s.sharedHasOwn);
  const b = nb.banners;

  const items: ReactNode[] = [];

  if (readOnly && source === 'link') {
    items.push(
      <Banner
        key="shared"
        testId="banner-shared"
        actions={
          <>
            <button type="button" className="btn btn-primary btn-small" onClick={makeMyOwnCopy} data-testid="make-copy">
              {b.makeCopy}
            </button>
            <button type="button" className="btn btn-small btn-ghost" onClick={leaveSharedView} data-testid="leave-shared">
              {sharedHasOwn ? b.leaveShared : b.showSeed}
            </button>
          </>
        }
      >
        <strong>{b.readOnly}</strong>{' '}
        <span className="muted">{sharedHasOwn ? b.readOnlyHintMerge(project.variants.length) : b.readOnlyHintNew}</span>
      </Banner>,
    );
  }

  if (notices.includes('schema-too-new')) {
    items.push(
      <Banner
        key="too-new"
        tone="warn"
        actions={
          <button type="button" className="btn btn-small" onClick={reloadPage}>
            {b.reload}
          </button>
        }
      >
        {b.schemaTooNew}
      </Banner>,
    );
  }

  if (notices.includes('other-tab') && !readOnly) {
    items.push(
      <Banner
        key="other-tab"
        actions={
          <>
            <button type="button" className="btn btn-small btn-primary" onClick={acceptExternalChange}>
              {b.loadOtherTab}
            </button>
            <button type="button" className="btn btn-small btn-ghost" onClick={keepOwnChanges}>
              {b.keepMine}
            </button>
          </>
        }
      >
        {b.otherTab}
      </Banner>,
    );
  }

  if (!readOnly && seedUpdateAvailable(project, dismissedSeed)) {
    items.push(
      <Banner
        key="seed"
        actions={
          <>
            <button type="button" className="btn btn-small btn-primary" onClick={fetchNewSeed}>
              {b.fetchSeed}
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                if (window.confirm(nb.prompts.resetSeed)) resetToSeed();
              }}
            >
              {b.resetSeed}
            </button>
            <button type="button" className="btn btn-small btn-ghost" onClick={dismissSeedUpdate}>
              {b.dismiss}
            </button>
          </>
        }
      >
        {b.seedUpdated(SEED_REVISION)}
      </Banner>,
    );
  }

  for (const n of notices) {
    const text = SIMPLE[n];
    if (text) {
      items.push(
        <Banner key={n} tone="warn" actions={<DismissButton notice={n} />}>
          {text}
        </Banner>,
      );
    }
  }

  if (items.length === 0) return null;
  return <div className="banners">{items}</div>;
}
