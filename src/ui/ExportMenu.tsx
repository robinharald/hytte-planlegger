/**
 * «Eksporter ▾» in the top bar, next to «Mer» (a disclosure like «Mer»: closes on a choice, Esc or a click outside):
 *  - «Eksporter plan som PDF …» opens the dialog (ui/ExportDialog.tsx);
 *  - «Lagre 3D-bildet som PNG» saves the picture (export/pngExport.ts).
 *
 * Neither is in the start bundle: the dialog (with the sheet preview) is a lazy chunk loaded when it is first opened,
 * and jsPDF / svg2pdf.js only when «Lag PDF» is pressed. The PNG code is fetched as soon as the menu opens, so the tap
 * on the entry runs it at once — on a phone the share sheet only opens from the user's own tap. If it is not loaded
 * yet (a very fast tap), it runs when it arrives and downloads instead (export/deliver.ts falls back to a download).
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { nb } from '../i18n/nb';
import { IconChevronDown } from './common';

const S = nb.export;

const ExportDialog = lazy(() => import('./ExportDialog').then((m) => ({ default: m.ExportDialog })));

type PngModule = typeof import('../export/pngExport');
let pngModule: PngModule | null = null;
let pngLoading: Promise<PngModule> | null = null;

/** Starts loading the PNG export (once). */
function loadPng(): Promise<PngModule> {
  pngLoading ??= import('../export/pngExport').then((m) => (pngModule = m));
  return pngLoading;
}

/** «Lagre 3D-bildet som PNG»: synchronously from the tap when the module is there, else when it has loaded. */
function savePng(): void {
  if (pngModule) void pngModule.savePng3d();
  else void loadPng().then((m) => m.savePng3d());
}

export function ExportMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const close = () => {
    if (ref.current) ref.current.open = false;
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    void loadPng().catch(() => {
      pngLoading = null; // offline without the chunk: try again on the next open
    });
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
  const items = [
    { key: 'pdf', label: S.menuPdf, title: S.menuPdfTitle, testId: 'export-menu-pdf', run: () => setDialog(true) },
    { key: 'png', label: S.menuPng, title: S.menuPngTitle, testId: 'export-menu-png', run: savePng },
  ];
  return (
    <>
      <details className="menu" ref={ref} open={open} onToggle={(e) => setOpen(e.currentTarget.open)} data-testid="export-menu">
        <summary className="btn" title={S.menuTitle}>
          {S.menu}
          <IconChevronDown />
        </summary>
        <div className="menu-list" role="menu">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className="menu-item"
              title={it.title}
              data-testid={it.testId}
              onClick={() => {
                close();
                it.run();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      </details>
      {dialog && (
        <Suspense fallback={null}>
          <ExportDialog onClose={() => setDialog(false)} />
        </Suspense>
      )}
    </>
  );
}
