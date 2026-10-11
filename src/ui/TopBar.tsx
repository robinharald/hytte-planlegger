/**
 * Top bar: title, variant selector + duplicate/rename/delete, undo/redo, Lagre versjon / Versjoner / Eksporter /
 * Importer, and Del lenke / Hjelp. Edit actions are hidden while read-only (shared link); the variant selector stays
 * (viewing another variant is not an edit). Names are asked for with window.prompt in phase 1.
 *
 * Narrow screens (< 600 px): Del lenke and Hjelp stay in the title row as icon buttons (the label is kept for
 * screen readers), and Lagre versjon / Versjoner / Eksporter / Importer fold into a "Mer" menu.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { nb } from '../i18n/nb';
import { appStore, applyImportedProject, exportProjectFile, readImportFile, saveNamedVersion, useAppStore } from '../state/appStore';
import { copyName, selectActiveVariant } from '../state/store';
import { IconChevronDown, IconHelp, IconRedo, IconShare, IconUndo } from './common';
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
  const canUndo = useAppStore((s) => s.canUndo);
  const canRedo = useAppStore((s) => s.canRedo);
  const narrow = useMediaQuery(NARROW_QUERY);
  const active = selectActiveVariant({ project });
  const fileInputId = useId();
  const t = nb.topbar;

  const duplicate = () => {
    const name = window.prompt(nb.prompts.duplicateName, copyName(active.name));
    if (name !== null) appStore.getState().duplicateVariant(active.id, name);
  };
  const rename = () => {
    const name = window.prompt(nb.prompts.renameVariant, active.name);
    if (name !== null) appStore.getState().renameVariant(active.id, name);
  };
  const remove = () => {
    if (window.confirm(nb.prompts.deleteVariant(active.name))) appStore.getState().deleteVariant(active.id);
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
        <label className="sr-only" htmlFor="variant-select">
          {t.variant}
        </label>
        <select id="variant-select" value={active.id} onChange={(e) => appStore.getState().setActiveVariant(e.target.value)} data-testid="variant-select">
          {project.variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        {!readOnly && (
          <>
            <button type="button" className="btn" onClick={duplicate} title={t.duplicateTitle}>
              {t.duplicate}
            </button>
            <button type="button" className="btn" onClick={rename} title={t.renameTitle}>
              {t.rename}
            </button>
            {project.variants.length > 1 && (
              <button type="button" className="btn btn-danger" onClick={remove} title={t.deleteTitle}>
                {t.delete}
              </button>
            )}
          </>
        )}
      </div>

      {!readOnly && (
        <div className="toolgroup history-actions">
          <button type="button" className="btn" onClick={() => appStore.getState().undo()} disabled={!canUndo} title={t.undoTitle} aria-label={t.undo}>
            <IconUndo />
          </button>
          <button type="button" className="btn" onClick={() => appStore.getState().redo()} disabled={!canRedo} title={t.redoTitle} aria-label={t.redo}>
            <IconRedo />
          </button>
        </div>
      )}

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
