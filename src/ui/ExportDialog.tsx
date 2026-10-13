/**
 * The dialog «Eksporter plan som PDF» (brief §6), opened from the top bar's «Eksporter» menu (ui/ExportMenu.tsx, which
 * loads this module only when the dialog is first opened).
 *
 * Choices: paper A4 / A3, scale 1:50 / 1:100, storeys Plan 1 / Hems / Begge, what to include (room names and areas,
 * dimensions, furniture) and colours («Vis hva som er nytt» or black and white). The orientation is automatic; the
 * dialog says how many sheets that makes (export/sheets.ts, schedulePage.ts — no PDF code loaded for that) and warns
 * when a storey has to be split over several sheets. The choices are remembered on this device.
 *
 * «Lag PDF» loads the PDF code (export/planPdf.ts: jsPDF, svg2pdf.js, react-dom/server) and builds the file
 * «hytta-<forslag>-<dato>.pdf». On a PC it is downloaded at once; on a phone or tablet whose share sheet takes files the
 * dialog offers «Del …» and «Last ned» instead (a share sheet needs a fresh tap after the wait). `window.__hytte.lastExport`
 * tells the e2e tests what was made (export/hook.ts).
 */
import { useMemo, useState } from 'react';
import { canShareFile, coarsePointer, deliverFile, downloadBlob } from '../export/deliver';
import { publishLastExport } from '../export/hook';
import { drawingArea, pageSize } from '../export/paper';
import type { PaperSize, PrintScale } from '../export/paper';
import { scheduleBodies } from '../export/schedulePage';
import { DEFAULT_PDF_OPTIONS, planSheetCount, storeyName, storeySheets, storeysOf } from '../export/sheets';
import type { PdfOptions, StoreyChoice } from '../export/sheets';
import { nb } from '../i18n/nb';
import { appStore, storage } from '../state/appStore';
import { selectActiveVariant } from '../state/store';
import { deriveForState, useDerived } from '../state/useDerived';
import { Modal } from './common';
import './ExportDialog.css';

const S = nb.export;

const PREFS_KEY = 'hytte-planlegger:export.pdf';

function loadOptions(): PdfOptions {
  try {
    const raw = storage?.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PDF_OPTIONS;
    const v = JSON.parse(raw) as Partial<PdfOptions>;
    return {
      paper: v.paper === 'A4' || v.paper === 'A3' ? v.paper : DEFAULT_PDF_OPTIONS.paper,
      scale: v.scale === 50 || v.scale === 100 ? v.scale : DEFAULT_PDF_OPTIONS.scale,
      storeys: v.storeys === 'ground' || v.storeys === 'loft' || v.storeys === 'both' ? v.storeys : DEFAULT_PDF_OPTIONS.storeys,
      labels: typeof v.labels === 'boolean' ? v.labels : DEFAULT_PDF_OPTIONS.labels,
      dims: typeof v.dims === 'boolean' ? v.dims : DEFAULT_PDF_OPTIONS.dims,
      furniture: typeof v.furniture === 'boolean' ? v.furniture : DEFAULT_PDF_OPTIONS.furniture,
      colour: typeof v.colour === 'boolean' ? v.colour : DEFAULT_PDF_OPTIONS.colour,
    };
  } catch {
    return DEFAULT_PDF_OPTIONS;
  }
}

function saveOptions(o: PdfOptions): void {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(o));
  } catch {
    // Private mode or full storage: the choices are just not remembered.
  }
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; blob: Blob; fileName: string; pages: number; share: boolean }
  | { kind: 'error'; message: string };

interface SegOption<T> {
  value: T;
  label: string;
  title: string;
  testId: string;
  disabled?: boolean;
}

function Seg<T extends string | number>(props: { label: string; value: T; options: SegOption<T>[]; onChange: (v: T) => void }) {
  return (
    <div className="field">
      <span>{props.label}</span>
      <div className="seg" role="group" aria-label={props.label}>
        {props.options.map((o) => (
          <button key={String(o.value)} type="button" aria-pressed={props.value === o.value} title={o.title} data-testid={o.testId} disabled={o.disabled} onClick={() => props.onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ExportDialog(props: { onClose: () => void }) {
  const derived = useDerived();
  const [opts, setOpts] = useState<PdfOptions>(loadOptions);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const hasLoft = useMemo(() => storeysOf(derived, 'loft').length > 0, [derived]);
  const effective = useMemo<PdfOptions>(() => (!hasLoft && opts.storeys !== 'ground' ? { ...opts, storeys: 'ground' } : opts), [opts, hasLoft]);

  const set = (patch: Partial<PdfOptions>) => {
    const next = { ...opts, ...patch };
    setOpts(next);
    saveOptions(next);
    if (status.kind !== 'busy') setStatus({ kind: 'idle' });
  };

  const sheets = useMemo(() => storeySheets(derived, effective), [derived, effective]);
  const schedulePages = useMemo(() => scheduleBodies(derived, drawingArea(pageSize(effective.paper, 'portrait'))).length, [derived, effective.paper]);
  const total = planSheetCount(sheets) + schedulePages;
  const tiled = sheets.some((s) => s.layout.cols * s.layout.rows > 1);
  const summary = S.summary(
    total,
    sheets.map((s) => S.summaryPart(storeyName(s.storey), s.layout.cols * s.layout.rows, effective.paper, S.orientation[s.layout.orientation])),
  );

  const make = async () => {
    setStatus({ kind: 'busy' });
    try {
      const { buildPlanPdf } = await import('../export/planPdf');
      const state = appStore.getState();
      const variant = selectActiveVariant(state);
      const r = await buildPlanPdf(
        {
          derived: deriveForState(state),
          site: state.project.site,
          project: state.project.name,
          proposal: variant.name,
          author: variant.meta?.updatedBy ?? variant.meta?.author ?? null,
          date: new Date(),
        },
        effective,
      );
      publishLastExport({ kind: 'pdf', bytes: r.bytes.byteLength, pages: r.pages, fileName: r.fileName });
      const share = coarsePointer() && typeof File !== 'undefined' && canShareFile(new File([r.blob], r.fileName, { type: 'application/pdf' }));
      if (!share) downloadBlob(r.blob, r.fileName);
      setStatus({ kind: 'done', blob: r.blob, fileName: r.fileName, pages: r.pages, share });
    } catch (e) {
      console.error('PDF export failed', e);
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const paperOptions: SegOption<PaperSize>[] = [
    { value: 'A4', label: 'A4', title: S.paperA4Title, testId: 'export-paper-A4' },
    { value: 'A3', label: 'A3', title: S.paperA3Title, testId: 'export-paper-A3' },
  ];
  const scaleOptions: SegOption<PrintScale>[] = [
    { value: 50, label: '1:50', title: S.scale50Title, testId: 'export-scale-50' },
    { value: 100, label: '1:100', title: S.scale100Title, testId: 'export-scale-100' },
  ];
  const storeyOptions: SegOption<StoreyChoice>[] = [
    { value: 'ground', label: nb.views.ground, title: nb.views.groundTitle, testId: 'export-storeys-ground' },
    { value: 'loft', label: nb.views.loft, title: nb.views.loftTitle, testId: 'export-storeys-loft', disabled: !hasLoft },
    { value: 'both', label: S.bothStoreys, title: S.bothStoreysTitle, testId: 'export-storeys-both', disabled: !hasLoft },
  ];
  const colourOptions: SegOption<'new' | 'bw'>[] = [
    { value: 'new', label: S.coloursNew, title: S.coloursNewTitle, testId: 'export-colour-new' },
    { value: 'bw', label: S.coloursBw, title: S.coloursBwTitle, testId: 'export-colour-bw' },
  ];
  const busy = status.kind === 'busy';

  return (
    <Modal title={S.heading} onClose={props.onClose} testId="export-dialog">
      <div className="export-dialog">
        <div className="export-row">
          <Seg label={S.paper} value={effective.paper} options={paperOptions} onChange={(paper) => set({ paper })} />
          <Seg label={S.scale} value={effective.scale} options={scaleOptions} onChange={(scale) => set({ scale })} />
        </div>
        <Seg label={S.storeys} value={effective.storeys} options={storeyOptions} onChange={(storeys) => set({ storeys })} />
        <fieldset className="export-include">
          <legend>{S.include}</legend>
          <label className="check">
            <input type="checkbox" checked={effective.labels} onChange={(e) => set({ labels: e.target.checked })} data-testid="export-labels" />
            <span>{S.labels}</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={effective.dims} onChange={(e) => set({ dims: e.target.checked })} data-testid="export-dims" />
            <span>{S.dims}</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={effective.furniture} onChange={(e) => set({ furniture: e.target.checked })} data-testid="export-furniture" />
            <span>{S.furniture}</span>
          </label>
        </fieldset>
        <Seg label={S.colours} value={effective.colour ? 'new' : 'bw'} options={colourOptions} onChange={(v) => set({ colour: v === 'new' })} />
        <p className="note" data-testid="export-summary">
          {summary} {tiled ? S.tiled : S.printTip}
        </p>
        {status.kind === 'done' && (
          <p className="export-status" role="status" data-testid="export-status">
            {S.done(status.fileName, status.pages)}
          </p>
        )}
        {status.kind === 'error' && (
          <p className="banner warn" role="alert" data-testid="export-error">
            {S.failed(status.message)}
          </p>
        )}
        <div className="modal-actions">
          {status.kind === 'done' && status.share && (
            <button type="button" className="btn" title={S.shareTitle} data-testid="export-share" onClick={() => void deliverFile(status.blob, status.fileName, { share: true, title: status.fileName })}>
              {S.share}
            </button>
          )}
          {status.kind === 'done' && (
            <button type="button" className="btn" title={S.downloadTitle} data-testid="export-download" onClick={() => downloadBlob(status.blob, status.fileName)}>
              {S.download}
            </button>
          )}
          <button type="button" className="btn btn-primary" data-autofocus disabled={busy} aria-busy={busy} data-testid="export-make" onClick={() => void make()}>
            {busy ? S.making : S.make}
          </button>
        </div>
      </div>
    </Modal>
  );
}
