/**
 * Top bar: title, "Forslag: <navn>" (the proposal selector; a variant is a "forslag" in the UI), "+ Nytt forslag",
 * Gi nytt navn / Slett, Lagre versjon / Versjoner / Eksporter / Importer, and Send forslaget / Hjelp. Angre / Gjør om
 * live in the toolbar (docs/phase2-plan.md §3.2). Edit actions are hidden while read-only (shared link); the selector
 * stays (viewing another proposal is not an edit).
 *
 *  - The locked base proposal (Forslag D) shows a "Grunnlag" tag; it cannot be renamed or deleted here, and
 *    "+ Nytt forslag" is the primary button.
 *  - "+ Nytt forslag" asks for a name (default "Mitt forslag", numbered when taken) and copies the proposal on screen.
 *  - Slett asks twice (docs/phase2-plan.md §1 rule 5); it can still be undone with Angre.
 *  - "Send forslaget" opens today's share-link dialog (the shared family store comes in phase 2b).
 *
 * Narrow screens (< 600 px): Send forslaget and Hjelp stay in the title row as icon buttons (the label is kept for
 * screen readers), and Lagre versjon / Versjoner / Eksporter / Importer fold into a "Mer" menu.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { nb } from '../i18n/nb';
import { appStore, applyImportedProject, exportProjectFile, readImportFile, saveNamedVersion, useAppStore } from '../state/appStore';
import { selectActiveVariant } from '../state/store';
import { IconChevronDown, IconHelp, IconShare } from './common';
import { createNewProposal, isVariantLocked, nextProposalName } from './editorBridge';
import { formatDateTime } from './format';
import { NARROW_QUERY, useMediaQuery } from './hooks';
import { projectSubtitle } from './labels';

export type DialogKind = 'help' | 'share' | 'versions';

interface MenuAction {
  key: string;
  label: string;
  title: string;
  onClick: () => void;
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
  const narrow = useMediaQuery(NARROW_QUERY);
  const active = selectActiveVariant({ project });
  const locked = isVariantLocked(active);
  const fileInputId = useId();
  const t = nb.topbar;

  const newProposal = () => {
    const name = window.prompt(nb.prompts.newProposalName, nextProposalName(project));
    if (name !== null) createNewProposal(name);
  };
  const rename = () => {
    const name = window.prompt(nb.prompts.renameVariant, active.name);
    if (name !== null) appStore.getState().renameVariant(active.id, name);
  };
  const remove = () => {
    if (!window.confirm(nb.prompts.deleteVariant(active.name))) return;
    if (!window.confirm(nb.prompts.deleteVariantSure(active.name))) return;
    appStore.getState().deleteVariant(active.id);
  };
  const saveVersion = () => {
    const name = window.prompt(nb.prompts.versionName, nb.versions.defaultName(formatDateTime(new Date().toISOString())));
    if (name === null) return;
    const r = saveNamedVersion(name);
    window.alert(r.ok ? nb.versions.saved(r.version.name) : nb.versions.saveFailed);
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const r = await readImportFile(file);
    if (r.status === 'ok' && window.confirm(nb.prompts.importProject(r.project.name))) applyImportedProject(r.project);
  };

  const fileActions: MenuAction[] = [
    ...(readOnly
      ? []
      : [
          { key: 'save', label: t.saveVersion, title: t.saveVersionTitle, onClick: saveVersion },
          { key: 'versions', label: t.versions, title: t.versionsTitle, onClick: () => props.onOpen('versions') },
        ]),
    { key: 'export', label: t.export, title: t.exportTitle, onClick: exportProjectFile },
    ...(readOnly ? [] : [{ key: 'import', label: t.import, title: t.importTitle, onClick: () => document.getElementById(fileInputId)?.click() }]),
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
        <label className="variant-label" htmlFor="variant-select">
          {t.variant}:
        </label>
        <select id="variant-select" value={active.id} onChange={(e) => appStore.getState().setActiveVariant(e.target.value)} data-testid="variant-select">
          {project.variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
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
              <button type="button" className="btn btn-danger" onClick={remove} title={t.deleteTitle} data-testid="delete-proposal">
                {t.delete}
              </button>
            )}
          </>
        )}
      </div>

      <div className="spacer" />

      {narrow ? (
        <div className="toolgroup file-actions">
          <MoreMenu actions={fileActions} />
        </div>
      ) : (
        <div className="toolgroup file-actions" role="group" aria-label={t.fileActions}>
          {fileActions.map((a) => (
            <button key={a.key} type="button" className="btn" onClick={a.onClick} title={a.title}>
              {a.label}
            </button>
          ))}
        </div>
      )}
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
        <button type="button" className="btn" onClick={() => props.onOpen('share')} title={t.shareTitle} data-testid="open-share">
          <IconShare />
          <span className="btn-label">{t.share}</span>
        </button>
        <button type="button" className="btn" onClick={() => props.onOpen('help')} title={t.helpTitle} data-testid="open-help">
          <IconHelp />
          <span className="btn-label">{t.help}</span>
        </button>
      </div>
    </header>
  );
}
