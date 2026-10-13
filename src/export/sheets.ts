/**
 * Which sheets a PDF export makes (light: no rendering, so the dialog can preview the page count without loading
 * jsPDF). The plan rectangle of a storey is the derived model's bounds, grown by the storey's dimension lines when they
 * are printed (plan2d/drawing.ts `fitBounds`, as the plan's own fit), plus PLAN_MARGIN_M.
 */
import { nb } from '../i18n/nb';
import type { DerivedVariant } from '../model/derived';
import { fitBounds } from '../plan2d/drawing';
import { planLayerData } from '../plan2d/storeyData';
import type { PlanLayerData } from '../plan2d/storeyData';
import { chooseLayout, withMargin } from './paper';
import type { PaperSize, PlanRect, PrintScale, SheetLayout } from './paper';

export type PlanStorey = 'ground' | 'loft';
export type StoreyChoice = PlanStorey | 'both';

export interface PdfOptions {
  paper: PaperSize;
  scale: PrintScale;
  storeys: StoreyChoice;
  /** Room names, dimensions and areas. */
  labels: boolean;
  /** Dimension lines. */
  dims: boolean;
  furniture: boolean;
  /** "Vis hva som er nytt" colours; false = black and white (greys). */
  colour: boolean;
}

export const DEFAULT_PDF_OPTIONS: PdfOptions = { paper: 'A3', scale: 100, storeys: 'both', labels: true, dims: true, furniture: true, colour: true };

export interface StoreySheets {
  storey: PlanStorey;
  data: PlanLayerData;
  layout: SheetLayout;
}

/** «Plan 1» / «Hems». */
export function storeyName(storey: PlanStorey): string {
  return storey === 'loft' ? nb.views.loft : nb.views.ground;
}

/** The storeys asked for that the model has (a storey without walls and rooms is left out). */
export function storeysOf(derived: DerivedVariant, choice: StoreyChoice): PlanStorey[] {
  const wanted: PlanStorey[] = choice === 'both' ? ['ground', 'loft'] : [choice];
  return wanted.filter((s) => {
    const d = planLayerData(derived, s);
    return d.ctx !== null && (d.pieces.length > 0 || d.rooms.length > 0);
  });
}

/** The plan rectangle printed for a storey (m, margin included). */
export function planRectOf(derived: DerivedVariant, data: PlanLayerData, dims: boolean): PlanRect {
  return withMargin(dims ? fitBounds(derived.bounds, data.dimensions) : derived.bounds);
}

export function storeySheets(derived: DerivedVariant, opts: PdfOptions): StoreySheets[] {
  return storeysOf(derived, opts.storeys).map((storey) => {
    const data = planLayerData(derived, storey);
    return { storey, data, layout: chooseLayout(planRectOf(derived, data, opts.dims), opts.scale, opts.paper) };
  });
}

/** Rooms per schedule sheet are decided by schedulePage.ts; this is the count of plan sheets only. */
export function planSheetCount(sheets: readonly StoreySheets[]): number {
  return sheets.reduce((n, s) => n + s.layout.cols * s.layout.rows, 0);
}
