/**
 * Saving status of the family's proposals (docs/phase2-plan.md §5) and the notices that go with it, all in the top bar:
 *
 *  - `StatusPill`: "Lagret for alle" / "Lagret her – sendes når du er på nett" / "Kun på denne enheten (ingen delt
 *    plass satt opp)" (or "(familiens plass kan ikke nås nå)" when Firebase could not be loaded, appStore.ts fallback),
 *    plus the passing states "Lagrer …" / "Kobler til …", "Ikke lagret – velg Hent endringene eller Lagre over" while
 *    a conflict is open, «Ikke startet – plassen i lenken er tom» while the start link's space is not this device's
 *    yet, and the failures (`pillState`). The long text is the pill's label (a short one on narrow screens); the
 *    tooltip explains it (familyUi.ts `pillState`).
 *  - `FamilyBanners`: the conflict guard ("«X» ble endret av Pappa for 2 min siden. [Hent endringene] [Lagre over]"),
 *    a version of this device overwritten by an offline save (kept under Tidligere versjoner) or deleted by a device
 *    that had not seen it ([Hent tilbake] from the Papirkurv), proposals from a newer app version ([Oppdater] looks
 *    for the new version), a family link opened where there is no shared space, a family link that is not whole, and
 *    after a family switch the offer to bring along this device's proposals from the previous space (not highlighted,
 *    and saying the family there will not see them any more, when that space has proposals made on other devices); a
 *    family link to another space («Denne lenken går til en annen delt plass. Plassen i lenken har N forslag (…);
 *    plassen du bruker nå har M. [Bytt dit] [Bli her]», the space with proposals made on other devices highlighted,
 *    else «Bli her»; a link to one proposal there: [Hent «…» som en kopi hit] [Bytt dit] [Bli her] with the same
 *    rule for «Bytt dit», else the copy highlighted); a link's space that is empty on a device without a family
 *    («Denne plassen er tom. Er lenken hel?» [Begynn her]); another tab switched this device to another space
 *    («… [Last på nytt]»: this tab is read-only and saves nothing); «Hva heter du?» after the first save without a
 *    name ([Skriv navnet] [Hopp over]; a banner, never a dialog during editing). A «Lagre over» from another device
 *    over a version saved here uses the overwritten banner. The conflict banner says what each button keeps (the
 *    other version goes under Tidligere versjoner).
 *  - `NameDialog`: "Hva heter du?" when asked for (Mer → «Endre navnet ditt», «Skriv navnet» on the banner); opened by
 *    «+ Nytt forslag» while the name is unknown, it is the two-field «Nytt forslag» dialog (Dialogs.tsx).
 */
import { useState } from 'react';
import { nb } from '../i18n/nb';
import {
  acceptCarryOver,
  askForName,
  copyLinkedProposal,
  declineCarryOver,
  dismissEmptyFamily,
  dismissFamilyNotice,
  dismissOverwritten,
  familyId,
  familyUiStore,
  reloadInCurrentFamily,
  resolveConflict,
  restoreFromTrash,
  setMyName,
  startEmptyFamily,
  stayInFamily,
  switchToLinkedFamily,
  useAppStore,
  useFamily,
} from '../state/appStore';
import type { OtherFamilyLink } from '../state/appStore';
import { Modal } from './common';
import { NewProposalDialog } from './Dialogs';
import { pillState, requestAppUpdateCheck, useMinuteClock } from './familyUi';

export function StatusPill() {
  const mode = useFamily((s) => s.mode);
  const phase = useFamily((s) => s.phase);
  const saving = useFamily((s) => s.saving);
  const pending = useFamily((s) => s.pending);
  const online = useFamily((s) => s.online);
  const failed = useFamily((s) => s.failed);
  const fallback = useFamily((s) => s.fallback);
  const conflicts = useFamily((s) => s.conflicts);
  const noFamily = useFamily((s) => s.noFamily);
  const elsewhere = useFamily((s) => s.elsewhere);
  const unconfirmed = useFamily((s) => s.unconfirmed);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const state = pillState({ mode, phase, saving, pending, online, failed, fallback, conflicts: readOnly ? [] : conflicts, noFamily, elsewhere, unconfirmed });
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
  const carryOver = useFamily((s) => s.carryOver);
  const otherFamily = useFamily((s) => s.otherFamily);
  const emptyFamily = useFamily((s) => s.emptyFamily);
  const elsewhere = useFamily((s) => s.elsewhere);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const nameBanner = useFamily((s) => s.nameBanner) && !readOnly;
  const [carrying, setCarrying] = useState(false);
  const now = useMinuteClock();
  const f = nb.family;
  if (
    conflicts.length === 0 &&
    overwritten.length === 0 &&
    tooNew === 0 &&
    notices.length === 0 &&
    !carryOver &&
    !otherFamily &&
    !emptyFamily &&
    !elsewhere &&
    !nameBanner
  ) {
    return null;
  }
  return (
    <div className="family-banners" data-testid="family-banners">
      {elsewhere && (
        <div className="banner warn" role="alert" data-testid="family-elsewhere-banner">
          <div className="msg">
            <strong>{f.elsewhere.text}</strong> <span>{f.elsewhere.hint}</span>
          </div>
          <div className="actions">
            <button type="button" className="btn btn-small btn-primary" data-testid="family-elsewhere-reload" onClick={reloadInCurrentFamily}>
              {f.elsewhere.reload}
            </button>
          </div>
        </div>
      )}
      {!readOnly &&
        conflicts.map((c) => {
          const by = c.by || f.someone;
          const at = c.at ? f.ago(c.at, now) : '';
          return (
            <div key={c.id} className="banner warn" role="alert" data-testid="conflict-banner">
              <div className="msg">
                <strong>{c.kind === 'deleted' ? f.conflictDeleted(c.name, by, at) : f.conflict(c.name, by, at)}</strong> <span>
                  {f.conflictHint} {c.kind === 'deleted' ? f.conflictKeepsDeleted : f.conflictKeeps}
                </span>
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
        <div key={o.id} className="banner" role="status" data-testid="overwritten-banner" data-kind={o.kind ?? 'changed'}>
          <div className="msg">
            {o.kind === 'deleted'
              ? f.overwrittenDeleted(o.name, o.by || f.someone)
              : o.kind === 'savedOver'
                ? f.overwrittenSavedOver(o.name, o.by || f.someone)
                : f.overwritten(o.name, o.by || f.someone)}
          </div>
          <div className="actions">
            {o.kind === 'deleted' && (
              <button
                type="button"
                className="btn btn-small"
                data-testid="overwritten-restore"
                onClick={() => {
                  dismissOverwritten(o.id);
                  void restoreFromTrash(o.id);
                }}
              >
                {f.trash.restore}
              </button>
            )}
            {o.kind !== 'deleted' && props.onShowRevisions && (
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
      {notices.includes('family-link-invalid') && (
        <div className="banner warn" role="status" data-testid="family-link-invalid">
          <div className="msg">{f.linkInvalid(familyId !== null)}</div>
          <div className="actions">
            <button type="button" className="btn btn-small btn-ghost" onClick={() => dismissFamilyNotice('family-link-invalid')}>
              {f.dismiss}
            </button>
          </div>
        </div>
      )}
      {otherFamily && <OtherFamilyBanner link={otherFamily} />}
      {emptyFamily && (
        <div className="banner warn" role="status" data-testid="empty-family-banner">
          <div className="msg">
            <strong>{f.emptyFamily.text}</strong> <span>{f.emptyFamily.hint}</span>
          </div>
          <div className="actions">
            <button type="button" className="btn btn-small" data-testid="empty-family-start" onClick={startEmptyFamily}>
              {f.emptyFamily.start}
            </button>
            <button type="button" className="btn btn-small btn-ghost" onClick={dismissEmptyFamily}>
              {f.dismiss}
            </button>
          </div>
        </div>
      )}
      {carryOver && (
        <div className="banner" role="status" data-testid="carry-over-banner" data-others-there={carryOver.othersThere ? 'true' : 'false'}>
          <div className="msg">
            <strong>{f.carryOver.text(carryOver.names)}</strong> <span>{f.carryOver.hint(carryOver.names.length)}</span>
            {carryOver.othersThere && <span> {f.carryOver.othersThere(carryOver.names.length)}</span>}
          </div>
          <div className="actions">
            <button
              type="button"
              className={`btn btn-small${carryOver.othersThere ? '' : ' btn-primary'}`}
              disabled={carrying}
              data-testid="carry-over-accept"
              onClick={() => {
                setCarrying(true);
                void acceptCarryOver().finally(() => setCarrying(false));
              }}
            >
              {f.carryOver.accept(carryOver.names.length)}
            </button>
            <button type="button" className="btn btn-small btn-ghost" disabled={carrying} data-testid="carry-over-decline" onClick={declineCarryOver}>
              {f.carryOver.decline}
            </button>
          </div>
        </div>
      )}
      {nameBanner && (
        <div className="banner" role="status" data-testid="name-banner">
          <div className="msg">
            <strong>{f.name.heading}</strong> <span>{f.name.bannerHint}</span>
          </div>
          <div className="actions">
            <button type="button" className="btn btn-small btn-primary" data-testid="name-banner-write" onClick={askForName}>
              {f.name.bannerWrite}
            </button>
            <button type="button" className="btn btn-small btn-ghost" data-testid="name-banner-skip" onClick={() => setMyName('')}>
              {f.name.skip}
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

/**
 * A family link to another space than this device's. Nothing changes until the user answers. The highlighted button is
 * the space that holds proposals made on other devices («Bytt dit» only when the link's space has some and this one
 * has none; else «Bli her»). A link to one proposal there offers a copy into this space and «Bytt dit» with the same
 * rule (a device stuck in a space of its own can join the family through a proposal link); otherwise the copy is the
 * highlighted button (or «Bli her» when the proposal is not there).
 */
function OtherFamilyBanner(props: { link: OtherFamilyLink }) {
  const f = nb.family.otherFamily;
  const { info, proposal } = props.link;
  const switchFirst = info !== null && info.others && !info.hereOthers;
  if (proposal) {
    const name = info?.proposalName ?? null;
    const primary = switchFirst ? 'switch' : name ? 'copy' : 'stay';
    return (
      <div className="banner warn" role="status" data-testid="other-family-banner" data-kind="proposal" data-primary={primary}>
        <div className="msg">
          <strong>{f.proposalText(name)}</strong> {info && <span>{f.counts(info.count, info.names, info.hereCount)} </span>}
          <span>{info && !name ? f.proposalMissing : f.proposalHint}</span>
        </div>
        <div className="actions">
          {name && (
            <button
              type="button"
              className={`btn btn-small${primary === 'copy' ? ' btn-primary' : ''}`}
              data-testid="other-family-copy"
              onClick={() => copyLinkedProposal()}
            >
              {f.copy(name)}
            </button>
          )}
          <button
            type="button"
            className={`btn btn-small${primary === 'switch' ? ' btn-primary' : ''}`}
            data-testid="other-family-switch"
            onClick={switchToLinkedFamily}
          >
            {f.switch}
          </button>
          <button type="button" className={`btn btn-small${primary === 'stay' ? ' btn-primary' : ''}`} data-testid="other-family-stay" onClick={stayInFamily}>
            {f.stay}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="banner warn" role="status" data-testid="other-family-banner" data-kind="space" data-primary={switchFirst ? 'switch' : 'stay'}>
      <div className="msg">
        <strong>{f.text}</strong> <span>{info ? f.counts(info.count, info.names, info.hereCount) : f.hint}</span>
      </div>
      <div className="actions">
        <button type="button" className={`btn btn-small${switchFirst ? ' btn-primary' : ''}`} data-testid="other-family-switch" onClick={switchToLinkedFamily}>
          {f.switch}
        </button>
        <button type="button" className={`btn btn-small${switchFirst ? '' : ' btn-primary'}`} data-testid="other-family-stay" onClick={stayInFamily}>
          {f.stay}
        </button>
      </div>
    </div>
  );
}

/**
 * The name prompt, shown while `askName`: "Hva heter du?" ("Hopp over" never asks again), or — opened by
 * «+ Nytt forslag» while the name is unknown (`nameForProposal`) — the «Nytt forslag» dialog asking for both names.
 */
export function NameDialog(props: { onClose?: () => void }) {
  const forProposal = useFamily((s) => s.nameForProposal);
  return forProposal ? <NewProposalDialog from={forProposal.from} onClose={props.onClose} /> : <PersonNameDialog onClose={props.onClose} />;
}

/** "Hva heter du?" on its own. */
function PersonNameDialog(props: { onClose?: () => void }) {
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
