/**
 * Modal dialog Hjelp ("Slik bruker du planleggeren": how-to, the six tools, the shortcuts). Send forslaget, Tidligere
 * versjoner and Papirkurv are the top bar's own (ShareDialog.tsx, RevisionsPanel.tsx, TrashPanel.tsx).
 */
import { nb } from '../i18n/nb';
import { Modal } from './common';

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
