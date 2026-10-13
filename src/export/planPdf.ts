/**
 * PDF plan export (brief §6): «Eksporter plan som PDF». Loaded lazily by the dialog (ExportDialog.tsx) — it pulls in
 * jsPDF, svg2pdf.js and react-dom/server.
 *
 *  - One or more sheets per storey (Plan 1, Hems or both) at true scale on A4 / A3, orientation automatic, a storey
 *    larger than a sheet split over several overlapping sheets (paper.ts); each sheet has the plan (planSheet.tsx),
 *    the frame and the title block (titleBlock.ts).
 *  - Then the room schedule and the area totals (schedulePage.ts) on portrait sheets of the same paper.
 *  - Every sheet is one SVG document in sheet millimetres, rendered with svg2pdf.js onto a jsPDF page in mm, so 1 user
 *    unit is 1 mm on paper and 1 m in the plan is 20 mm at 1:50, 10 mm at 1:100.
 *  - File name «hytta-<forslag>-<dato>.pdf» (fileNames.ts).
 *  - `pdfPages` is the pure part (the SVG of every sheet), unit-tested; `renderPdf` turns them into PDF bytes.
 */
import type { DerivedVariant } from '../model/derived';
import { nb } from '../i18n/nb';
import type { Site } from '../model/types';
import { formatDate, formatM2, formatNumber } from '../ui/format';
import { PRINT_PX_MM, drawingArea, frameRect, mmPerMetre, pageSize, sheetsPlanRect, tilesOf, titleBlockRect } from './paper';
import type { Orientation, PaperSize, SheetLayout, Tile } from './paper';
import { parseSvg, planDrawing } from './planSheet';
import type { PlanDrawing } from './planSheet';
import { scheduleBodies } from './schedulePage';
import { planRectOf, storeyName, storeySheets } from './sheets';
import type { PdfOptions, PlanStorey } from './sheets';
import { pdfFileName } from './fileNames';
import { titleBlockSvg } from './titleBlock';
import type { TitleBlockFields } from './titleBlock';

const S = nb.export;

export interface PdfInput {
  derived: DerivedVariant;
  site: Site;
  /** «Hytta ved Merkesvatnet». */
  project: string;
  /** The proposal's name. */
  proposal: string;
  /** Who changed the proposal last (shared proposals), when known. */
  author?: string | null;
  date: Date;
}

export interface PdfPage {
  kind: 'plan' | 'schedule';
  storey?: PlanStorey;
  paper: PaperSize;
  orientation: Orientation;
  /** Sheet size (mm). */
  size: { w: number; h: number };
  /** The whole sheet as an SVG document (mm). */
  svg: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const n2 = (v: number) => String(Math.round(v * 1000) / 1000);


function sheetSvg(size: { w: number; h: number }, body: string, titleBlock: string, attrs: string): string {
  const f = frameRect(size);
  return (
    `<svg xmlns="${SVG_NS}" width="${n2(size.w)}" height="${n2(size.h)}" viewBox="0 0 ${n2(size.w)} ${n2(size.h)}" font-family="helvetica"${attrs}>` +
    body +
    `<rect x="${n2(f.x)}" y="${n2(f.y)}" width="${n2(f.w)}" height="${n2(f.h)}" fill="none" stroke="#1f2620" stroke-width="0.5"/>` +
    titleBlock +
    '</svg>'
  );
}

/** The plan part of one sheet: the drawing clipped to the drawing area, placed for `tile`. */
export function planBody(layout: SheetLayout, tile: Tile, drawing: PlanDrawing, k = PRINT_PX_MM): string {
  const a = layout.area;
  const tx = a.x + layout.origin[0] - tile.offset[0];
  const ty = a.y + layout.origin[1] - tile.offset[1];
  return (
    `<defs><clipPath id="sheet-area"><rect x="${n2(a.x)}" y="${n2(a.y)}" width="${n2(a.w)}" height="${n2(a.h)}"/></clipPath></defs>` +
    `<g clip-path="url(#sheet-area)"><g data-plan-sheet="" transform="translate(${n2(tx)} ${n2(ty)}) scale(${k})">${drawing.markup}</g></g>`
  );
}

function commonFields(input: PdfInput): Omit<TitleBlockFields, 'storey' | 'scale' | 'sheet' | 'northBearing' | 'mmPerMetre' | 'legend'> {
  const a = input.derived.areas;
  return {
    project: input.project,
    proposal: input.proposal,
    madeWith: input.author ? `${S.tbMadeWith} · ${S.tbBy(input.author)}` : S.tbMadeWith,
    date: formatDate(input.date.toISOString()),
    bya: S.tbBya(formatM2(a.bya.total)),
    byaDetail: S.tbByaDetail(formatNumber(a.bya.buildings), formatNumber(a.bya.decks)),
    bra: S.tbBra(formatM2(a.bra.total)),
    braDetail: S.tbBraDetail(formatNumber(a.bra.existing), formatNumber(a.bra.new)),
  };
}

/** Every sheet of the export as SVG (pure apart from the DOM parsing of the plan markup). */
export function pdfPages(input: PdfInput, opts: PdfOptions): PdfPage[] {
  const storeys = storeySheets(input.derived, opts);
  const common = commonFields(input);
  const plans: { storey: PlanStorey; layout: SheetLayout; drawing: PlanDrawing; tile: Tile }[] = [];
  for (const s of storeys) {
    const drawing = planDrawing(s.data, planRectOf(input.derived, s.data, opts.dims), { ...opts, gridRect: sheetsPlanRect(s.layout) });
    for (const tile of tilesOf(s.layout)) plans.push({ storey: s.storey, layout: s.layout, drawing, tile });
  }
  // The schedule goes on portrait sheets of the same paper.
  const schedSize = pageSize(opts.paper, 'portrait');
  const bodies = scheduleBodies(input.derived, drawingArea(schedSize));
  const count = plans.length + bodies.length;
  const pages: PdfPage[] = [];
  plans.forEach((p, i) => {
    const { layout, tile } = p;
    const tiled = layout.cols * layout.rows > 1;
    const tb = titleBlockSvg(titleBlockRect(layout.page), {
      ...common,
      storey: storeyName(p.storey),
      scale: `1:${opts.scale} (${opts.paper})`,
      sheet: { index: i + 1, count, tile: tiled ? { row: tile.row + 1, col: tile.col + 1 } : undefined },
      northBearing: input.site.planNorthBearing,
      mmPerMetre: mmPerMetre(opts.scale),
      legend: opts.colour,
    });
    const attrs = ` data-sheet="${i + 1}" data-sheet-kind="plan" data-sheet-storey="${p.storey}"`;
    pages.push({ kind: 'plan', storey: p.storey, paper: opts.paper, orientation: layout.orientation, size: layout.page, svg: sheetSvg(layout.page, planBody(layout, tile, p.drawing), tb, attrs) });
  });
  bodies.forEach((body, j) => {
    const index = plans.length + j + 1;
    const tb = titleBlockSvg(titleBlockRect(schedSize), {
      ...common,
      storey: S.tbScheduleStorey,
      scale: S.tbNoScale,
      sheet: { index, count },
      northBearing: null,
      mmPerMetre: null,
      legend: false,
    });
    pages.push({ kind: 'schedule', paper: opts.paper, orientation: 'portrait', size: schedSize, svg: sheetSvg(schedSize, body, tb, ` data-sheet="${index}" data-sheet-kind="schedule"`) });
  });
  return pages;
}

export interface PdfResult {
  bytes: ArrayBuffer;
  pages: number;
}

/** Renders the sheets into one PDF (jsPDF in mm, each sheet's SVG through svg2pdf.js). */
export async function renderPdf(pages: readonly PdfPage[], meta: { title: string; subject?: string } = { title: '' }): Promise<PdfResult> {
  if (pages.length === 0) throw new Error('no pages');
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js/dist/svg2pdf.es.min.js')]);
  const first = pages[0];
  const doc = new jsPDF({ unit: 'mm', format: first.paper.toLowerCase(), orientation: first.orientation, compress: true });
  doc.setProperties({ title: meta.title, subject: meta.subject ?? '', creator: S.tbMadeWith });
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (i > 0) doc.addPage(p.paper.toLowerCase(), p.orientation);
    await svg2pdf(parseSvg(p.svg), doc, { x: 0, y: 0, width: p.size.w, height: p.size.h });
  }
  return { bytes: doc.output('arraybuffer'), pages: doc.getNumberOfPages() };
}

export interface PlanPdf extends PdfResult {
  blob: Blob;
  fileName: string;
}

/** The whole export: sheets, PDF, file name. */
export async function buildPlanPdf(input: PdfInput, opts: PdfOptions): Promise<PlanPdf> {
  const pages = pdfPages(input, opts);
  const r = await renderPdf(pages, { title: `${input.project} – ${input.proposal}`, subject: S.heading });
  return { ...r, blob: new Blob([r.bytes], { type: 'application/pdf' }), fileName: pdfFileName(input.proposal, input.date) };
}
