/**
 * "Send forslaget" (docs/phase2-plan.md §5).
 *
 * Shared mode (the family space): two labelled links — the proposal's deep link (`#f=<family>&p=<proposal>`, what
 * "Send …" sends) and the family link (`#f=<family>`, everyone's proposals) — and the family id. "Send …" uses
 * `navigator.share` (the phone's share sheet) and falls back to copying the link.
 *
 * Local mode (no shared space set up): today's `#d=` link that carries a copy of the proposal (opened, it is added as
 * a new proposal), its length, the "send as JSON file" fallback above 8 kB, and "Send alle forslagene".
 */
import { useMemo, useState } from 'react';
import { nb } from '../i18n/nb';
import { exportProjectFile, familyMode, familyId, familyShareLinks, shareLinkFor, useAppStore } from '../state/appStore';
import { selectActiveVariant } from '../state/store';
import { IconShare, Modal } from './common';
import { shareLink } from './familyUi';
import { formatBytes } from './format';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function LinkField(props: { label: string; note?: string; url: string; testId: string; copyTestId: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const s = nb.family.share;
  return (
    <div className="share-field">
      <label className="field">
        <span>{props.label}</span>
        <span className="share-row">
          <input className="text-input share-link" readOnly value={props.url} onFocus={(e) => e.currentTarget.select()} data-testid={props.testId} />
          <button type="button" className="btn" data-testid={props.copyTestId} onClick={() => void copyText(props.url).then((ok) => setState(ok ? 'copied' : 'failed'))}>
            {state === 'copied' ? s.copied : s.copy}
          </button>
        </span>
      </label>
      {props.note && <p className="note">{props.note}</p>}
      {state === 'failed' && <p className="note">{s.copyFailed}</p>}
    </div>
  );
}

function SharedShare(props: { name: string; links: { family: string; proposal: string } }) {
  const s = nb.family.share;
  const [message, setMessage] = useState<string | null>(null);
  const send = async () => {
    const r = await shareLink({ title: s.shareTitle(props.name), text: s.shareText, url: props.links.proposal });
    if (r !== 'unavailable') return;
    setMessage((await copyText(props.links.proposal)) ? s.copied : s.copyFailed);
  };
  return (
    <>
      <p>{s.introShared}</p>
      <LinkField label={s.proposalLink(props.name)} note={s.proposalNote} url={props.links.proposal} testId="share-proposal-link" copyTestId="share-copy-proposal" />
      <LinkField label={s.familyLink} note={s.familyNote} url={props.links.family} testId="share-family-link" copyTestId="share-copy-family" />
      <p className="note">
        {s.familyId}: <code className="family-id" data-testid="family-id">{familyId}</code>
      </p>
      {message && <p className="note">{message}</p>}
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={() => void send()} data-autofocus data-testid="share-send">
          <IconShare />
          {s.send}
        </button>
      </div>
    </>
  );
}

function LocalShare() {
  const project = useAppStore((s) => s.project);
  const [allVariants, setAllVariants] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const link = useMemo(() => shareLinkFor(project, allVariants), [project, allVariants]);
  const active = selectActiveVariant({ project });
  const s = nb.share;
  const f = nb.family.share;

  const send = async () => {
    const r = await shareLink({ title: f.shareTitle(active.name), text: f.shareText, url: link.url });
    if (r === 'unavailable') setCopyState((await copyText(link.url)) ? 'copied' : 'failed');
  };

  return (
    <>
      <p>{f.introLocal}</p>
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
          {f.localLink} <span className="range-value">{`${s.size}: ${formatBytes(link.bytes)}`}</span>
        </span>
        <textarea className="text-input share-link" readOnly rows={4} value={link.url} onFocus={(e) => e.currentTarget.select()} data-testid="share-local-link" />
      </label>
      {link.tooBig && <p className="banner warn">{s.tooBig}</p>}
      {copyState === 'failed' && <p className="note">{s.copyFailed}</p>}
      <div className="modal-actions">
        {link.tooBig && (
          <button type="button" className="btn" onClick={exportProjectFile}>
            {s.sendJson}
          </button>
        )}
        <button type="button" className="btn" onClick={() => void copyText(link.url).then((ok) => setCopyState(ok ? 'copied' : 'failed'))}>
          {copyState === 'copied' ? s.copied : s.copy}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void send()} data-autofocus data-testid="share-send">
          <IconShare />
          {f.send}
        </button>
      </div>
    </>
  );
}

/** `links` overrides the family links (tests render the shared view with them). */
export function ShareDialog(props: { onClose: () => void; links?: { family: string; proposal: string } }) {
  const project = useAppStore((s) => s.project);
  const active = selectActiveVariant({ project });
  const links = props.links ?? (familyMode === 'shared' ? familyShareLinks(active.id) : null);
  return (
    <Modal title={nb.family.share.heading} onClose={props.onClose} testId="share-dialog">
      {links ? <SharedShare name={active.name} links={links} /> : <LocalShare />}
    </Modal>
  );
}
