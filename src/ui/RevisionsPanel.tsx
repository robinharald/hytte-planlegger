/**
 * Tidligere versjoner (under Mer; docs/phase2-plan.md §5): the automatic revisions of the proposal on screen (up to 20,
 * at most one per five minutes of editing), newest first with when and by whom; "Gjenopprett" asks once, keeps what
 * is there now as a revision, and puts the old version back (for everyone in shared mode). Forslag D has none.
 *
 * Below, collapsed: versions the user saved by name on this device before the proposals were shared (phase 1 / 2a
 * "Lagre versjon"); "Legg til" adds their proposals as new proposals, so nothing from before is out of reach.
 */
import { useEffect, useMemo, useState } from 'react';
import { nb } from '../i18n/nb';
import { listRevisions, restoreRevision, restoreVersion, storage, useAppStore } from '../state/appStore';
import type { RevisionInfo } from '../state/familyStore';
import { readVersions } from '../state/persistence';
import { selectActiveVariant } from '../state/store';
import { Modal } from './common';
import { useMinuteClock } from './familyUi';
import { formatBytes, formatDateTime } from './format';

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ok'; revisions: RevisionInfo[] };

function LegacyVersions(props: { onAdded: () => void }) {
  const r = nb.family.revisions;
  const versions = useMemo(
    () =>
      readVersions(storage)
        .slice()
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
    [],
  );
  if (versions.length === 0) return null;
  return (
    <details className="explain" data-testid="legacy-versions">
      <summary>
        {r.legacyHeading} ({versions.length})
      </summary>
      <p>{r.legacyHint}</p>
      <ul className="revision-list">
        {versions.map((v) => (
          <li key={v.id} className="revision-item">
            <span>
              <strong>{v.name}</strong>
              <br />
              <span className="note">
                {formatDateTime(v.savedAt)} · {formatBytes(JSON.stringify(v).length)}
              </span>
            </span>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                if (restoreVersion(v.id)) props.onAdded();
              }}
            >
              {r.legacyAdd}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function RevisionsPanel(props: { onClose: () => void }) {
  const project = useAppStore((s) => s.project);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const active = selectActiveVariant({ project });
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const r = nb.family.revisions;
  const now = useMinuteClock();
  const locked = active.locked === true;

  useEffect(() => {
    if (locked) return;
    let live = true;
    listRevisions(active.id).then(
      (revisions) => live && setLoad({ state: 'ok', revisions }),
      () => live && setLoad({ state: 'failed' }),
    );
    return () => {
      live = false;
    };
  }, [active.id, locked]);

  const restore = async (rev: RevisionInfo) => {
    if (!window.confirm(r.confirm(nb.family.when(rev.savedAt, now)))) return;
    setBusy(true);
    const ok = await restoreRevision(active.id, rev.id);
    setBusy(false);
    if (ok) props.onClose();
    else setFailed(true);
  };

  return (
    <Modal title={r.heading} onClose={props.onClose} testId="revisions-panel">
      {locked ? (
        <p>{r.base}</p>
      ) : (
        <>
          <p>{r.intro(active.name)}</p>
          {load.state === 'loading' && <p className="muted">{r.loading}</p>}
          {load.state === 'failed' && <p className="banner warn">{r.failed}</p>}
          {load.state === 'ok' && load.revisions.length === 0 && <p className="muted">{r.empty}</p>}
          {load.state === 'ok' && load.revisions.length > 0 && (
            <ul className="revision-list">
              {load.revisions.map((rev) => (
                <li key={rev.id} className="revision-item" data-testid="revision-item">
                  <span>{r.savedBy(nb.family.when(rev.savedAt, now), rev.savedBy)}</span>
                  <button type="button" className="btn btn-small" disabled={busy || readOnly} onClick={() => void restore(rev)}>
                    {r.restore}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {failed && <p className="banner warn">{r.restoreFailed}</p>}
        </>
      )}
      {!readOnly && <LegacyVersions onAdded={props.onClose} />}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={props.onClose} data-autofocus>
          {r.close}
        </button>
      </div>
    </Modal>
  );
}
