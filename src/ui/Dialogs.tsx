/**
 * Modal dialogs: Hjelp ("Slik bruker du den": how-to, the six tools, the shortcuts), Send forslaget (share link with
 * size, > 8 kB warning and the JSON-file fallback; today's `#d=` link) and Versjoner (named versions of this project,
 * other projects' versions, reset).
 */
import { useMemo, useState } from 'react';
import { nb } from '../i18n/nb';
import {
  shareLinkFor,
  exportProjectFile,
  resetToSeed,
  restoreVersion,
  saveNamedVersion,
  storage,
  useAppStore,
} from '../state/appStore';
import { deleteVersion, listVersions, VERSION_LIMIT, versionsBytes } from '../state/persistence';
import type { VersionInfo } from '../state/persistence';
import { selectActiveVariant } from '../state/store';
import { Modal } from './common';
import { undoHow } from './device';
import { formatBytes, formatDateTime } from './format';

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export function HelpDialog(props: { onClose: () => void }) {
  const h = nb.help;
  return (
    <Modal title={h.heading} onClose={props.onClose} testId="help-dialog">
      <p>{h.intro}</p>
      <ul>
        {h.items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <h3 className="panel-title">{h.tools}</h3>
      <dl className="kv help-tools" data-testid="help-tools">
        {h.toolList.map((t) => (
          <div key={t.name}>
            <dt>{t.name}</dt>
            <dd>{t.text}</dd>
          </div>
        ))}
      </dl>
      <h3 className="panel-title">{h.shortcuts}</h3>
      <table className="table">
        <tbody>
          {h.shortcutList.map((s) => (
            <tr key={s.keys}>
              <td>
                <span className="kbd">{s.keys}</span>
              </td>
              <td>
                {s.text}
                {!s.active && <span className="muted"> ({h.comingSoon})</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={props.onClose} data-autofocus>
          {h.close}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ShareDialog(props: { onClose: () => void }) {
  const project = useAppStore((s) => s.project);
  const [allVariants, setAllVariants] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const link = useMemo(() => shareLinkFor(project, allVariants), [project, allVariants]);
  const active = selectActiveVariant({ project });
  const s = nb.share;

  const copy = async () => setCopyState((await copyText(link.url)) ? 'copied' : 'failed');

  return (
    <Modal title={s.heading} onClose={props.onClose} testId="share-dialog">
      <p>{s.intro}</p>
      {project.variants.length > 1 && (
        <label className="check">
          <input
            type="checkbox"
            checked={allVariants}
            onChange={(e) => {
              setAllVariants(e.target.checked);
              setCopyState('idle');
            }}
          />
          <span>{s.allVariants}</span>
        </label>
      )}
      <p className="note">{allVariants ? s.allIncluded(project.variants.length) : s.activeOnly(active.name)}</p>
      <label className="field">
        <span>
          {s.link} <span className="range-value">{`${s.size}: ${formatBytes(link.bytes)}`}</span>
        </span>
        <textarea className="text-input share-link" readOnly rows={4} value={link.url} onFocus={(e) => e.currentTarget.select()} />
      </label>
      {link.tooBig && <p className="banner warn">{s.tooBig}</p>}
      {copyState === 'failed' && <p className="note">{s.copyFailed}</p>}
      <div className="modal-actions">
        {link.tooBig && (
          <button type="button" className="btn" onClick={exportProjectFile}>
            {s.sendJson}
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => void copy()} data-autofocus>
          {copyState === 'copied' ? s.copied : s.copy}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/** `revision` only forces a re-read after a save or delete. */
function readVersionLists(projectId: string, revision: number) {
  return {
    revision,
    mine: listVersions(storage, projectId),
    others: listVersions(storage, projectId, { others: true }),
    total: versionsBytes(storage),
  };
}

function VersionTable(props: { versions: VersionInfo[]; showProject?: boolean; onRestore: (v: VersionInfo) => void; onDelete: (v: VersionInfo) => void }) {
  const v = nb.versions;
  return (
    <div className="table-wrap">
      <table className="table">
        <tbody>
          {props.versions.map((ver) => (
            <tr key={ver.id}>
              <td>
                <strong>{ver.name}</strong>
                <br />
                <span className="note">
                  {props.showProject ? `${ver.projectName} · ` : ''}
                  {formatDateTime(ver.savedAt)} · {formatBytes(ver.bytes)}
                </span>
              </td>
              <td className="r">
                <button type="button" className="btn btn-small" onClick={() => props.onRestore(ver)}>
                  {v.restore}
                </button>{' '}
                <button type="button" className="btn btn-small btn-ghost btn-danger" onClick={() => props.onDelete(ver)}>
                  {v.delete}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VersionsDialog(props: { onClose: () => void }) {
  const projectId = useAppStore((s) => s.project.id);
  const [rev, setRev] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const { mine, others, total } = useMemo(() => readVersionLists(projectId, rev), [projectId, rev]);
  const v = nb.versions;

  const save = () => {
    const name = window.prompt(nb.prompts.versionName, v.defaultName(formatDateTime(new Date().toISOString())));
    if (name === null) return;
    const r = saveNamedVersion(name);
    setMessage(r.ok ? v.saved(r.version.name) : v.saveFailed);
    setRev((x) => x + 1);
  };
  const restore = (ver: VersionInfo) => {
    if (!window.confirm(nb.prompts.restoreVersion(ver.name, undoHow()))) return;
    if (restoreVersion(ver.id)) props.onClose();
  };
  const remove = (ver: VersionInfo) => {
    if (!window.confirm(nb.prompts.deleteVersion(ver.name))) return;
    deleteVersion(storage, ver.id);
    setRev((x) => x + 1);
  };
  const reset = () => {
    if (!window.confirm(nb.prompts.resetSeed(undoHow()))) return;
    resetToSeed();
    props.onClose();
  };

  return (
    <Modal title={v.heading} onClose={props.onClose} testId="versions-dialog">
      <div className="toolgroup">
        <button type="button" className="btn btn-primary" onClick={save} data-autofocus>
          {v.save}
        </button>
        {message && <span className="note">{message}</span>}
      </div>
      {mine.length === 0 ? <p className="muted">{v.empty}</p> : <VersionTable versions={mine} onRestore={restore} onDelete={remove} />}
      <p className="note">
        {v.limit(VERSION_LIMIT)} {v.totalSize}: {formatBytes(total)}.
      </p>
      {others.length > 0 && (
        <details className="explain">
          <summary>
            {v.otherProjects} ({others.length})
          </summary>
          <p>{v.otherProjectsHint}</p>
          <VersionTable versions={others} showProject onRestore={restore} onDelete={remove} />
        </details>
      )}
      <details className="explain">
        <summary>{v.danger}</summary>
        <p>
          <button type="button" className="btn btn-danger" onClick={reset}>
            {v.resetSeed}
          </button>
        </p>
      </details>
    </Modal>
  );
}
