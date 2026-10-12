/**
 * Saving status of the family's proposals (docs/phase2-plan.md §5) and the notices that go with it, all in the top bar:
 *
 *  - `StatusPill`: "Lagret for alle" / "Lagret her – sendes når du er på nett" / "Kun på denne enheten (ingen delt
 *    plass satt opp)" (or "(familiens plass kan ikke nås nå)" when Firebase could not be loaded, appStore.ts fallback),
 *    plus the passing states "Lagrer …" / "Kobler til …" and the failures (`pillState`). The long text
 *    is the pill's label (a short one on narrow screens); the tooltip explains it (familyUi.ts `pillState`).
 *  - `FamilyBanners`: the conflict guard ("«X» ble endret av Pappa for 2 min siden. [Hent endringene] [Lagre over]"),
 *    a version of this device overwritten by an offline save (kept under Tidligere versjoner), proposals from a newer
 *    app version ([Oppdater] looks for the new version), a family link opened where there is no shared space.
 *  - `NameDialog`: "Hva heter du?" the first time this device saves something in the shared space.
 */
import { useState } from 'react';
import { nb } from '../i18n/nb';
import {
  dismissFamilyNotice,
  dismissOverwritten,
  familyUiStore,
  resolveConflict,
  setMyName,
  useAppStore,
  useFamily,
} from '../state/appStore';
import { Modal } from './common';
import { pillState, requestAppUpdateCheck, useMinuteClock } from './familyUi';

export function StatusPill() {
  const mode = useFamily((s) => s.mode);
  const phase = useFamily((s) => s.phase);
  const saving = useFamily((s) => s.saving);
  const pending = useFamily((s) => s.pending);
  const online = useFamily((s) => s.online);
  const failed = useFamily((s) => s.failed);
  const fallback = useFamily((s) => s.fallback);
  const state = pillState({ mode, phase, saving, pending, online, failed, fallback });
  const text = nb.family.pill[state];
  return (
    <span className="status-pill" data-state={state} data-testid="status-pill" role="status" aria-label={text} title={nb.family.pillTitle[state]}>
      <span className="pill-long" aria-hidden="true">
        {text}
      </span>
      <span className="pill-short" aria-hidden="true">
        {nb.family.pillShort[state]}
      </span>
    </span>
  );
}

export function FamilyBanners(props: { onShowRevisions?: () => void }) {
  const conflicts = useFamily((s) => s.conflicts);
  const overwritten = useFamily((s) => s.overwritten);
  const tooNew = useFamily((s) => s.tooNew.length);
  const notices = useFamily((s) => s.notices);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const now = useMinuteClock();
  const f = nb.family;
  if (conflicts.length === 0 && overwritten.length === 0 && tooNew === 0 && notices.length === 0) return null;
  return (
    <div className="family-banners" data-testid="family-banners">
      {!readOnly &&
        conflicts.map((c) => {
          const by = c.by || f.someone;
          const at = c.at ? f.ago(c.at, now) : '';
          return (
            <div key={c.id} className="banner warn" role="alert" data-testid="conflict-banner">
              <div className="msg">
                <strong>{c.kind === 'deleted' ? f.conflictDeleted(c.name, by, at) : f.conflict(c.name, by, at)}</strong> <span>{f.conflictHint}</span>
              </div>
              <div className="actions">
                <button type="button" className="btn btn-small btn-primary" data-testid="conflict-fetch" onClick={() => void resolveConflict(c.id, 'fetch')}>
                  {f.fetchChanges}
                </button>
                <button type="button" className="btn btn-small" data-testid="conflict-overwrite" onClick={() => void resolveConflict(c.id, 'overwrite')}>
                  {f.saveOver}
                </button>
              </div>
            </div>
          );
        })}
      {overwritten.map((o) => (
        <div key={o.id} className="banner" role="status" data-testid="overwritten-banner">
          <div className="msg">{f.overwritten(o.name, o.by || f.someone)}</div>
          <div className="actions">
            {props.onShowRevisions && (
              <button type="button" className="btn btn-small" onClick={props.onShowRevisions}>
                {f.showRevisions}
              </button>
            )}
            <button type="button" className="btn btn-small btn-ghost" onClick={() => dismissOverwritten(o.id)}>
              {f.dismiss}
            </button>
          </div>
        </div>
      ))}
      {tooNew > 0 && (
        <div className="banner" role="status" data-testid="too-new-banner">
          <div className="msg">{f.tooNew(tooNew)}</div>
          <div className="actions">
            <button type="button" className="btn btn-small btn-primary" onClick={requestAppUpdateCheck}>
              {nb.family.update.button}
            </button>
          </div>
        </div>
      )}
      {notices.includes('family-unavailable') && (
        <div className="banner warn" role="status" data-testid="family-unavailable">
          <div className="msg">{f.familyUnavailable}</div>
          <div className="actions">
            <button type="button" className="btn btn-small btn-ghost" onClick={() => dismissFamilyNotice('family-unavailable')}>
              {f.dismiss}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Hva heter du?" — shown while `askName` (shared mode, first save on this device); "Hopp over" never asks again. */
export function NameDialog(props: { onClose?: () => void }) {
  const [name, setName] = useState('');
  const n = nb.family.name;
  const close = () => {
    familyUiStore.setState({ askName: false });
    props.onClose?.();
  };
  const save = () => {
    setMyName(name);
    props.onClose?.();
  };
  return (
    <Modal title={n.heading} onClose={close} testId="name-dialog">
      <p>{n.intro}</p>
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) save();
        }}
      >
        <span>{n.label}</span>
        <input
          className="text-input"
          value={name}
          maxLength={40}
          autoComplete="nickname"
          placeholder={n.placeholder}
          onChange={(e) => setName(e.target.value)}
          data-autofocus
          data-testid="name-input"
        />
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setMyName('');
              props.onClose?.();
            }}
          >
            {n.skip}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()} data-testid="name-save">
            {n.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
