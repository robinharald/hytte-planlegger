// @vitest-environment jsdom
/**
 * The top bar's «Eksporter» menu (ui/ExportMenu.tsx) and the «Eksporter plan som PDF» dialog (ui/ExportDialog.tsx, a
 * lazy chunk) on the app's own store
 * (the bundled Forslag D): the sheet count preview, remembered choices, «Lag PDF» (the PDF module mocked) with the
 * download and `window.__hytte.lastExport`, and the PNG entry.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const buildPlanPdf = vi.fn(async (_input: unknown, _opts: unknown) => ({ bytes: new ArrayBuffer(1234), pages: 3, blob: new Blob(['%PDF-'], { type: 'application/pdf' }), fileName: 'hytta-forslag-d-2026-10-13.pdf' }));
vi.mock('./planPdf', () => ({ buildPlanPdf }));
const savePng3d = vi.fn(async () => undefined);
vi.mock('./pngExport', () => ({ savePng3d }));
const downloadBlob = vi.fn((_blob: Blob, _name: string) => 'downloaded' as const);
vi.mock('./deliver', () => ({ downloadBlob, canShareFile: () => false, coarsePointer: () => false, deliverFile: vi.fn() }));

const { ExportMenu } = await import('../ui/ExportMenu');
const { lastExport } = await import('./hook');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (id: string) => {
  const el = byTestId(id);
  if (!el) throw new Error(`no ${id}`);
  act(() => el.click());
};
/** Lets the lazy dialog chunk (and other pending imports) arrive. */
async function settle(until: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !until(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<ExportMenu />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('Eksporter menu', () => {
  it('has the PDF and PNG entries with tooltips', async () => {
    const items = [...document.querySelectorAll('[data-testid="export-menu"] .menu-item')];
    expect(items.map((e) => e.textContent)).toEqual(['Eksporter plan som PDF …', 'Lagre 3D-bildet som PNG']);
    for (const e of items) expect(e.getAttribute('title')).toBeTruthy();
    click('export-menu-png');
    await settle(() => savePng3d.mock.calls.length > 0);
    expect(savePng3d).toHaveBeenCalledTimes(1);
  });

  it('previews the sheets, remembers the choices and makes the PDF', async () => {
    click('export-menu-pdf');
    await settle(() => byTestId('export-dialog') !== null);
    expect(byTestId('export-dialog')).not.toBeNull();
    expect(byTestId('export-summary')?.textContent).toContain('Blir 3 sider: Plan 1 på 1 ark A3 liggende, Hems på 1 ark A3 liggende, romskjema til slutt.');
    for (const b of document.querySelectorAll('[data-testid="export-dialog"] .seg button')) expect(b.getAttribute('title')).toBeTruthy();
    click('export-paper-A4');
    click('export-scale-50');
    click('export-storeys-ground');
    expect(byTestId('export-summary')?.textContent).toMatch(/^Blir \d+ sider: Plan 1 på 6 ark A4 liggende, romskjema til slutt\. Planen er større enn arket/);
    expect(JSON.parse(localStorage.getItem('hytte-planlegger:export.pdf') ?? '{}')).toMatchObject({ paper: 'A4', scale: 50, storeys: 'ground' });
    click('export-furniture');
    click('export-colour-bw');
    await act(async () => {
      byTestId('export-make')?.click();
    });
    expect(buildPlanPdf).toHaveBeenCalledTimes(1);
    const [input, options] = buildPlanPdf.mock.calls[0] as unknown as [{ project: string; proposal: string }, unknown];
    expect(input).toMatchObject({ project: 'Hytta ved Merkesvatnet', proposal: 'Forslag D' });
    expect(options).toEqual({ paper: 'A4', scale: 50, storeys: 'ground', labels: true, dims: true, furniture: false, colour: false });
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'hytta-forslag-d-2026-10-13.pdf');
    expect(byTestId('export-status')?.textContent).toBe('Laget «hytta-forslag-d-2026-10-13.pdf» (3 sider).');
    expect(lastExport()).toEqual({ kind: 'pdf', bytes: 1234, pages: 3, fileName: 'hytta-forslag-d-2026-10-13.pdf' });
    expect((window as unknown as { __hytte?: { lastExport?: unknown } }).__hytte?.lastExport).toEqual(lastExport());
  });

  it('opens with the remembered choices and says what went wrong', async () => {
    localStorage.setItem('hytte-planlegger:export.pdf', JSON.stringify({ paper: 'A4', scale: 100, storeys: 'loft', colour: false }));
    click('export-menu-pdf');
    await settle(() => byTestId('export-dialog') !== null);
    expect(byTestId('export-paper-A4')?.getAttribute('aria-pressed')).toBe('true');
    expect(byTestId('export-storeys-loft')?.getAttribute('aria-pressed')).toBe('true');
    expect(byTestId('export-colour-bw')?.getAttribute('aria-pressed')).toBe('true');
    buildPlanPdf.mockRejectedValueOnce(new Error('tom'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => {
      byTestId('export-make')?.click();
    });
    expect(byTestId('export-error')?.textContent).toBe('Klarte ikke å lage PDF-en: tom');
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
