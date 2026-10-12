/**
 * Top bar (docs/phase2-plan.md §5–§6): title, "Forslag: <navn> ▾" (ProposalsMenu: Forslag D first, then the family's
 * proposals with "sist endret av …", "+ Nytt forslag", Papirkurv), "+ Nytt forslag", Gi nytt navn / Slett, the saving
 * status (StatusPill), Mer (Tidligere versjoner, Papirkurv, Lagre som fil, Åpne fil, Eksporter JSON, and in shared
 * mode "Endre navnet ditt"), "Send forslaget" and Hjelp. Angre / Gjør om live in the toolbar (§3.2).
 *
 *  - The locked base proposal (Forslag D) shows a "Grunnlag" tag; it cannot be renamed or deleted, and
 *    "+ Nytt forslag" is the primary button there.
 *  - "+ Nytt forslag" asks for a name (default "Mitt forslag", numbered when taken) and copies the proposal on screen.
 *  - Slett asks twice in a dialog ("Vil du slette «X»?" → "Er du sikker? Forslaget forsvinner for alle. [Slett for
 *    alle]"); the proposal goes to the Papirkurv (30 days), and the toast's Angre brings it back.
 *  - The top bar owns its dialogs (Send forslaget, Papirkurv, Tidligere versjoner, Slett, "Hva heter du?"), the family
 *    banners (conflict guard, …) as a full-width row, and the app-update toast; Hjelp is App's (`onOpen('help')`).
 *  - Edit actions are hidden while read-only; the proposal list stays (viewing another proposal is not an edit).
 *
 * Narrow screens (< 600 px): Send forslaget and Hjelp stay in the title row as icon buttons (the label is kept for
 * screen readers); the status pill shows a short text.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { nb } from '../i18n/nb';
import {
  appStore,
  applyImportedProject,
  askForName,
  downloadActiveProposal,
  exportProjectFile,
  familyMode,
  readImportFile,
  useAppStore,
  useFamily,
} from '../state/appStore';
import { selectActiveVariant } from '../state/store';
import { IconChevronDown, IconHelp, IconShare } from './common';
import { createNewProposal, isVariantLocked, nextProposalName } from './editorBridge';
import { projectSubtitle } from './labels';
import { DeleteProposalDialog, ProposalsMenu } from './ProposalsMenu';
import { RevisionsPanel } from './RevisionsPanel';
import { ShareDialog } from './ShareDialog';
import { FamilyBanners, NameDialog, StatusPill } from './StatusPill';
import { TrashPanel } from './TrashPanel';
import { UpdateToast } from './UpdateToast';
import './family.css';

/** Dialogs the app shell renders for the top bar (Hjelp). */
export type DialogKind = 'help';

/** Dialogs the top bar renders itself. */
type OwnDialog = 'share' | 'trash' | 'revisions' | 'delete';

interface MenuAction {
  key: string;
  label: string;
  title: string;
  onClick: () => void;
  testId?: string;
}

/** "Mer" menu (disclosure): closes on a choice, Esc or a click outside. */
function MoreMenu(props: { actions: MenuAction[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  // The DOM toggle event is asynchronous, so close the element directly as well as through state.
  const close = () => {
    if (ref.current) ref.current.open = false;
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      ref.current?.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <details className="menu" ref={ref} open={open} onToggle={(e) => setOpen(e.currentTarget.open)} data-testid="more-menu">
      <summary className="btn" title={nb.topbar.moreTitle}>
        {nb.topbar.more}
        <IconChevronDown />
      </summary>
      <div className="menu-list" role="menu">
        {props.actions.map((a) => (
          <button
            key={a.key}
            type="button"
            role="menuitem"
            className="menu-item"
            title={a.title}
            data-testid={a.testId}
            onClick={() => {
              close();
              a.onClick();
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </details>
  );
}

export function TopBar(props: { onOpen: (d: DialogKind) => void }) {
  const project = useAppStore((s) => s.project);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const trashCount = useFamily((s) => s.trash.length);
  const askName = useFamily((s) => s.askName);
  const [dialog, setDialog] = useState<OwnDialog | null>(null);
  const active = selectActiveVariant({ project });
  const locked = isVariantLocked(active);
  const fileInputId = useId();
  const t = nb.topbar;
  const m = nb.family.more;
  const close = () => setDialog(null);

  const newProposal = () => {
    const name = window.prompt(nb.prompts.newProposalName, nextProposalName(project));
    if (name !== null) createNewProposal(name);
  };
  const rename = () => {
    const name = window.prompt(nb.prompts.renameVariant, active.name);
    if (name !== null) appStore.getState().renameVariant(active.id, name);
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const r = await readImportFile(file);
    if (r.status !== 'ok') return;
    const proposals = r.project.variants.filter((v) => !v.locked);
    if (proposals.length > 0 && window.confirm(nb.family.importConfirm(proposals[0].name, proposals.length))) applyImportedProject(r.project);
  };

  const moreActions: MenuAction[] = [
    ...(readOnly
      ? []
      : [
          { key: 'revisions', label: m.revisions, title: m.revisionsTitle, onClick: () => setDialog('revisions'), testId: 'more-revisions' },
          { key: 'trash', label: nb.family.trashItem(trashCount), title: m.trashTitle, onClick: () => setDialog('trash'), testId: 'more-trash' },
        ]),
    { key: 'save-file', label: m.saveFile, title: m.saveFileTitle, onClick: downloadActiveProposal, testId: 'more-save-file' },
    ...(readOnly
      ? []
      : [{ key: 'open-file', label: m.openFile, title: m.openFileTitle, onClick: () => document.getElementById(fileInputId)?.click(), testId: 'more-open-file' }]),
    { key: 'export', label: m.exportJson, title: m.exportJsonTitle, onClick: exportProjectFile, testId: 'more-export' },
    ...(familyMode === 'shared' && !readOnly ? [{ key: 'name', label: m.changeName, title: m.changeNameTitle, onClick: askForName, testId: 'more-name' }] : []),
  ];

  return (
    <header className="topbar">
      <div className="brand">
        <h1>
          {nb.app.title}
          {readOnly && <span className="tag ro-tag">{nb.app.readOnlyTag}</span>}
        </h1>
        <p>{projectSubtitle(project.name)}</p>
      </div>

      <div className="toolgroup variant-actions" role="group" aria-label={t.variantActions}>
        <ProposalsMenu onOpenTrash={() => setDialog('trash')} />
        {locked && (
          <span className="tag lock-tag" title={t.lockedTitle} data-testid="locked-tag">
            {t.lockedTag}
          </span>
        )}
        {!readOnly && (
          <>
            <button
              type="button"
              className={`btn${locked ? ' btn-primary' : ''}`}
              onClick={newProposal}
              title={t.newProposalTitle}
              data-testid="new-proposal"
            >
              {t.newProposal}
            </button>
            {!locked && (
              <button type="button" className="btn" onClick={rename} title={t.renameTitle} data-testid="rename-proposal">
                {t.rename}
              </button>
            )}
            {!locked && project.variants.length > 1 && (
              <button type="button" className="btn btn-danger" onClick={() => setDialog('delete')} title={t.deleteTitle} data-testid="delete-proposal">
                {t.delete}
              </button>
            )}
          </>
        )}
      </div>

      <div className="toolgroup status-actions">
        <StatusPill />
      </div>

      <div className="spacer" />

      <div className="toolgroup file-actions">
        <MoreMenu actions={moreActions} />
      </div>
      {!readOnly && (
        <input
          id={fileInputId}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      )}

      <div className="toolgroup primary-actions">
        <button type="button" className="btn" onClick={() => setDialog('share')} title={t.shareTitle} data-testid="open-share">
          <IconShare />
          <span className="btn-label">{t.share}</span>
        </button>
        <button type="button" className="btn" onClick={() => props.onOpen('help')} title={t.helpTitle} data-testid="open-help">
          <IconHelp />
          <span className="btn-label">{t.help}</span>
        </button>
      </div>

      <FamilyBanners onShowRevisions={() => setDialog('revisions')} />

      {dialog === 'share' && <ShareDialog onClose={close} />}
      {dialog === 'trash' && <TrashPanel onClose={close} />}
      {dialog === 'revisions' && <RevisionsPanel onClose={close} />}
      {dialog === 'delete' && !locked && <DeleteProposalDialog proposal={active} onClose={close} />}
      {askName && dialog === null && !readOnly && <NameDialog />}
      <UpdateToast />
    </header>
  );
}
