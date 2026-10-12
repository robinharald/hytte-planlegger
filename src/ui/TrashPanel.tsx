/**
 * Papirkurv (docs/phase2-plan.md §5): proposals deleted in the last 30 days, newest first, with who deleted them,
 * when, and how long they stay; "Hent tilbake" puts one back in the list (for everyone in shared mode) and shows it.
 */
import { useState } from 'react';
import { nb } from '../i18n/nb';
import { restoreFromTrash, useAppStore, useFamily } from '../state/appStore';
import type { ProposalMeta } from '../state/familyStore';
import { Modal } from './common';
import { daysLeft, useMinuteClock } from './familyUi';

function TrashRow(props: { item: ProposalMeta; disabled: boolean; onRestore: (id: string) => void; now: number }) {
  const t = nb.family.trash;
  const { item } = props;
  return (
    <li className="trash-item" data-testid={`trash-item-${item.id}`}>
      <div>
        <strong>{item.name}</strong>
        <br />
        <span className="note">
          {t.deleted(nb.family.when(item.deletedAt ?? item.updatedAt, props.now), item.updatedBy)} · {t.daysLeft(daysLeft(item.deletedAt, props.now))}
        </span>
      </div>
      <button type="button" className="btn btn-small" disabled={props.disabled} data-testid={`trash-restore-${item.id}`} onClick={() => props.onRestore(item.id)}>
        {t.restore}
      </button>
    </li>
  );
}

export function TrashPanel(props: { onClose: () => void }) {
  const trash = useFamily((s) => s.trash);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const [busy, setBusy] = useState(false);
  const t = nb.family.trash;
  const now = useMinuteClock();
  const restore = async (id: string) => {
    setBusy(true);
    const ok = await restoreFromTrash(id);
    setBusy(false);
    if (ok) props.onClose();
  };
  return (
    <Modal title={t.heading} onClose={props.onClose} testId="trash-panel">
      <p>{t.intro}</p>
      {trash.length === 0 ? (
        <p className="muted">{t.empty}</p>
      ) : (
        <ul className="trash-list">
          {trash.map((item) => (
            <TrashRow key={item.id} item={item} disabled={busy || readOnly} onRestore={(id) => void restore(id)} now={now} />
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={props.onClose} data-autofocus>
          {t.close}
        </button>
      </div>
    </Modal>
  );
}
