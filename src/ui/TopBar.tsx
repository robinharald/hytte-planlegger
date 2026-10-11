/**
 * Top bar: title, variant selector + duplicate/rename/delete, undo/redo, Lagre versjon / Versjoner / Eksporter /
 * Importer / Del lenke, Hjelp. Edit actions are hidden while read-only (shared link); the variant selector stays
 * (viewing another variant is not an edit). Names are asked for with window.prompt in phase 1.
 */
import { useRef } from 'react';
import { nb } from '../i18n/nb';
import { appStore, applyImportedProject, exportProjectFile, readImportFile, saveNamedVersion, useAppStore } from '../state/appStore';
import { copyName, selectActiveVariant } from '../state/store';
import { IconHelp, IconRedo, IconShare, IconUndo } from './common';
import { formatDateTime } from './format';

export type DialogKind = 'help' | 'share' | 'versions';

export function TopBar(props: { onOpen: (d: DialogKind) => void }) {
  const project = useAppStore((s) => s.project);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const canUndo = useAppStore((s) => s.canUndo);
  const canRedo = useAppStore((s) => s.canRedo);
  const active = selectActiveVariant({ project });
  const fileInput = useRef<HTMLInputElement>(null);

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

  return (
    <header className="topbar">
      <div className="brand">
        <h1>
          {nb.app.title}
          {readOnly && <span className="tag ro-tag">{nb.app.readOnlyTag}</span>}
        </h1>
        <p>
          {project.name} · {nb.app.place}
        </p>
      </div>

      <div className="toolgroup" role="group" aria-label={nb.topbar.variantActions}>
        <label className="sr-only" htmlFor="variant-select">
          {nb.topbar.variant}
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
            <button type="button" className="btn" onClick={duplicate} title={nb.topbar.duplicateTitle}>
              {nb.topbar.duplicate}
            </button>
            <button type="button" className="btn" onClick={rename}>
              {nb.topbar.rename}
            </button>
            {project.variants.length > 1 && (
              <button type="button" className="btn btn-danger" onClick={remove}>
                {nb.topbar.delete}
              </button>
            )}
          </>
        )}
      </div>

      {!readOnly && (
        <div className="toolgroup">
          <button type="button" className="btn" onClick={() => appStore.getState().undo()} disabled={!canUndo} title={nb.topbar.undoTitle} aria-label={nb.topbar.undo}>
            <IconUndo />
          </button>
          <button type="button" className="btn" onClick={() => appStore.getState().redo()} disabled={!canRedo} title={nb.topbar.redoTitle} aria-label={nb.topbar.redo}>
            <IconRedo />
          </button>
        </div>
      )}

      <div className="spacer" />

      <div className="toolgroup file-actions" role="group" aria-label={nb.topbar.fileActions}>
        {!readOnly && (
          <>
            <button type="button" className="btn" onClick={saveVersion}>
              {nb.topbar.saveVersion}
            </button>
            <button type="button" className="btn" onClick={() => props.onOpen('versions')}>
              {nb.topbar.versions}
            </button>
          </>
        )}
        <button type="button" className="btn" onClick={exportProjectFile} title={nb.topbar.exportTitle}>
          {nb.topbar.export}
        </button>
        {!readOnly && (
          <>
            <button type="button" className="btn" onClick={() => fileInput.current?.click()} title={nb.topbar.importTitle}>
              {nb.topbar.import}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </>
        )}
        <button type="button" className="btn" onClick={() => props.onOpen('share')}>
          <IconShare />
          {nb.topbar.share}
        </button>
        <button type="button" className="btn" onClick={() => props.onOpen('help')}>
          <IconHelp />
          {nb.topbar.help}
        </button>
      </div>
    </header>
  );
}
