/**
 * Modal dialog Hjelp ("Slik bruker du planleggeren": how-to, the six tools, the shortcuts). Send forslaget, Tidligere
 * versjoner and Papirkurv are the top bar's own (ShareDialog.tsx, RevisionsPanel.tsx, TrashPanel.tsx).
 *
 * And the name prompt of «+ Nytt forslag» (`promptNewProposal`): the browser's prompt for the proposal's name, or —
 * in the family's shared space while this device's name is unknown — one dialog with two fields, «Navn på forslaget»
 * and «Hva heter du?» (`NewProposalDialog`, rendered by StatusPill.tsx `NameDialog`), so «Hva heter du?» never pops
 * up on its own while the person edits.
 */
import { useState } from 'react';
import { nb } from '../i18n/nb';
import type { Id } from '../model/types';
import { activateProposal, appStore, askNameWithProposal, familyUiStore, nameUnknown, setMyName, skipNameForNow } from '../state/appStore';
import { Modal } from './common';
import { createNewProposal, nextProposalName } from './editorBridge';

// ---------------------------------------------------------------------------
// «+ Nytt forslag»
// ---------------------------------------------------------------------------

/**
 * «+ Nytt forslag» (top bar), «+ Nytt forslag (kopi av Forslag D)» and «Kopier «X»» (proposals menu): asks for the
 * name, then copies `fromId` (default: the proposal on screen) and shows the copy. While this device's name is unknown
 * in the shared space, the name prompt asks for both names in one dialog (`askNameWithProposal`); otherwise the
 * browser's prompt asks for the proposal's name, as before.
 */
// eslint-disable-next-line react/only-export-components
export function promptNewProposal(fromId?: Id): void {
  if (appStore.getState().ui.readOnly) return;
  if (nameUnknown()) {
    askNameWithProposal(fromId ?? null);
    return;
  }
  const name = window.prompt(nb.prompts.newProposalName, nextProposalName(appStore.getState().project));
  if (name !== null) makeProposal(fromId ?? null, name);
}

function makeProposal(from: Id | null, name: string): void {
  if (from && appStore.getState().project.activeVariantId !== from) activateProposal(from);
  createNewProposal(name);
}

/** iOS Safari zooms the page into a text field whose text is smaller than 16 px. */
const NO_ZOOM = { fontSize: 16 } as const;

/**
 * «Nytt forslag» with «Hva heter du?» (two fields). «Lag forslaget» stores the name (left empty: not asked again in
 * this session) and makes the proposal; «Avbryt» / Esc makes nothing.
 */
export function NewProposalDialog(props: { from: Id | null; onClose?: () => void }) {
  const [proposal, setProposal] = useState(() => nextProposalName(appStore.getState().project));
  const [person, setPerson] = useState('');
  const n = nb.family.name;
  const close = () => {
    familyUiStore.setState({ askName: false, nameForProposal: null });
    props.onClose?.();
  };
  const create = () => {
    if (person.trim()) setMyName(person);
    else skipNameForNow();
    close();
    makeProposal(props.from, proposal);
  };
  return (
    <Modal title={n.newHeading} onClose={close} testId="new-proposal-dialog">
      <form
        className="new-proposal-form"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <label className="field">
          <span>{n.proposalLabel}</span>
          <input
            className="text-input"
            style={NO_ZOOM}
            value={proposal}
            maxLength={80}
            onChange={(e) => setProposal(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            data-autofocus
            data-testid="new-proposal-name"
          />
        </label>
        <label className="field">
          <span>{n.personLabel}</span>
          <input
            className="text-input"
            style={NO_ZOOM}
            value={person}
            maxLength={40}
            autoComplete="nickname"
            placeholder={n.placeholder}
            onChange={(e) => setPerson(e.target.value)}
            data-testid="new-proposal-person"
          />
          <small className="muted">{n.personHint}</small>
        </label>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={close}>
            {n.cancel}
          </button>
          <button type="submit" className="btn btn-primary" data-testid="new-proposal-create">
            {n.create}
          </button>
        </div>
      </form>
    </Modal>
  );
}

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
