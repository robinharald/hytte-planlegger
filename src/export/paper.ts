/**
 * Paper, scale and sheet layout of the PDF plan export (brief §6). Pure, unit-tested (paper.test.ts).
 *
 * Units: millimetres on the sheet (y down), metres in the plan (y up). The plan is drawn by the plan's own layers,
 * whose sizes (strokes, text) are "screen pixels"; on paper one such pixel is PRINT_PX_MM, so a 12 px room name is
 * 3 mm (8.5 pt) and a 1.25 px wall outline 0.31 mm. At 1:50 one metre is 20 mm = 80 print px, at 1:100 10 mm = 40 px.
 *
 * Sheet: PAGE_MARGIN_MM all round; inside it the frame; the title block is a strip TITLE_BLOCK_MM high along the
 * bottom of the frame; the drawing area is the rest of the frame (less AREA_GAP_MM). Orientation is automatic: the
 * one that needs fewer sheets, on a tie the one matching the plan's shape. A plan larger than the drawing area is
 * split into a grid of sheets ("tiles") that overlap by TILE_OVERLAP_MM, centred on the whole grid.
 */
import type { Vec2 } from '../model/types';

export type PaperSize = 'A4' | 'A3';
export type Orientation = 'portrait' | 'landscape';
export type PrintScale = 50 | 100;

/** Portrait sheet sizes (mm). */
export const PAPER_MM: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
};
export const PAGE_MARGIN_MM = 10;
export const TITLE_BLOCK_MM = 30;
export const AREA_GAP_MM = 2;
export const TILE_OVERLAP_MM = 10;
/** One plan-layer pixel on paper (mm). */
export const PRINT_PX_MM = 0.25;
/** Paper kept round the drawing (m): the dimension texts sit outside the dimension lines. */
export const PLAN_MARGIN_M = 0.75;

export interface MmRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlanRect {
  min: Vec2;
  max: Vec2;
}

/** Millimetres per plan metre at 1:`scale`. */
export function mmPerMetre(scale: PrintScale): number {
  return 1000 / scale;
}

/** Plan-layer pixels per metre at 1:`scale` (the `scale` the layers get: 80 at 1:50, 40 at 1:100). */
export function pxPerMetre(scale: PrintScale): number {
  return mmPerMetre(scale) / PRINT_PX_MM;
}

export function pageSize(paper: PaperSize, orientation: Orientation): { w: number; h: number } {
  const p = PAPER_MM[paper];
  return orientation === 'portrait' ? { w: p.w, h: p.h } : { w: p.h, h: p.w };
}

export function frameRect(page: { w: number; h: number }): MmRect {
  return { x: PAGE_MARGIN_MM, y: PAGE_MARGIN_MM, w: page.w - 2 * PAGE_MARGIN_MM, h: page.h - 2 * PAGE_MARGIN_MM };
}

/** The title strip at the bottom of the frame. */
export function titleBlockRect(page: { w: number; h: number }): MmRect {
  const f = frameRect(page);
  return { x: f.x, y: f.y + f.h - TITLE_BLOCK_MM, w: f.w, h: TITLE_BLOCK_MM };
}

/** Where the plan goes: the frame above the title strip. */
export function drawingArea(page: { w: number; h: number }): MmRect {
  const f = frameRect(page);
  return { x: f.x, y: f.y, w: f.w, h: f.h - TITLE_BLOCK_MM - AREA_GAP_MM };
}

/** Sheets needed along one axis for `size` mm in `room` mm with TILE_OVERLAP_MM overlap. */
export function sheetsAlong(size: number, room: number): number {
  if (size <= room + 1e-6) return 1;
  return Math.ceil((size - TILE_OVERLAP_MM) / (room - TILE_OVERLAP_MM) - 1e-9);
}

export interface SheetLayout {
  paper: PaperSize;
  orientation: Orientation;
  scale: PrintScale;
  page: { w: number; h: number };
  area: MmRect;
  cols: number;
  rows: number;
  /** The plan rectangle drawn (m), margin included. */
  plan: PlanRect;
  /** Its size on paper (mm). */
  planMm: { w: number; h: number };
  /** Where the plan's top-left corner (min x, max y) sits in the grid of sheets (mm from the first sheet's area corner). */
  origin: Vec2;
  /** Distance (mm) from one sheet's area to the next one's: the area less the overlap. */
  step: Vec2;
}

/** The plan rectangle with the paper margin round it. */
export function withMargin(rect: PlanRect, margin = PLAN_MARGIN_M): PlanRect {
  return { min: [rect.min[0] - margin, rect.min[1] - margin], max: [rect.max[0] + margin, rect.max[1] + margin] };
}

function layoutFor(plan: PlanRect, scale: PrintScale, paper: PaperSize, orientation: Orientation): SheetLayout {
  const page = pageSize(paper, orientation);
  const area = drawingArea(page);
  const k = mmPerMetre(scale);
  const planMm = { w: (plan.max[0] - plan.min[0]) * k, h: (plan.max[1] - plan.min[1]) * k };
  const cols = sheetsAlong(planMm.w, area.w);
  const rows = sheetsAlong(planMm.h, area.h);
  const step: Vec2 = [area.w - TILE_OVERLAP_MM, area.h - TILE_OVERLAP_MM];
  const gridW = cols === 1 ? area.w : cols * step[0] + TILE_OVERLAP_MM;
  const gridH = rows === 1 ? area.h : rows * step[1] + TILE_OVERLAP_MM;
  return { paper, orientation, scale, page, area, cols, rows, plan, planMm, origin: [(gridW - planMm.w) / 2, (gridH - planMm.h) / 2], step };
}

/**
 * The sheet layout for a plan rectangle (m, margin included) at 1:`scale` on `paper`: the orientation needing fewer
 * sheets; on a tie the one matching the plan's shape (wider than tall → landscape).
 */
export function chooseLayout(plan: PlanRect, scale: PrintScale, paper: PaperSize): SheetLayout {
  const land = layoutFor(plan, scale, paper, 'landscape');
  const port = layoutFor(plan, scale, paper, 'portrait');
  const n = (l: SheetLayout) => l.cols * l.rows;
  if (n(land) !== n(port)) return n(land) < n(port) ? land : port;
  return land.planMm.w >= land.planMm.h ? land : port;
}

export interface Tile {
  row: number;
  col: number;
  /** Offset (mm) of this sheet's area in the grid: the grid point drawn at the area's top-left corner. */
  offset: Vec2;
}

/** The sheets of a layout, row by row from the top (the plan's high y) and left to right. */
export function tilesOf(layout: SheetLayout): Tile[] {
  const out: Tile[] = [];
  for (let r = 0; r < layout.rows; r++) for (let c = 0; c < layout.cols; c++) out.push({ row: r, col: c, offset: [c * layout.step[0], r * layout.step[1]] });
  return out;
}

/** The plan rectangle (m) the whole grid of sheets shows: the drawing areas, overlaps counted once. */
export function sheetsPlanRect(layout: SheetLayout): PlanRect {
  const k = mmPerMetre(layout.scale);
  const gridW = layout.cols === 1 ? layout.area.w : layout.cols * layout.step[0] + TILE_OVERLAP_MM;
  const gridH = layout.rows === 1 ? layout.area.h : layout.rows * layout.step[1] + TILE_OVERLAP_MM;
  const x0 = layout.plan.min[0] - layout.origin[0] / k;
  const y1 = layout.plan.max[1] + layout.origin[1] / k;
  return { min: [x0, y1 - gridH / k], max: [x0 + gridW / k, y1] };
}

/** Where a plan point (m) lands on a sheet (mm from the sheet's top-left corner). */
export function planToSheetMm(layout: SheetLayout, tile: Tile, p: Vec2): Vec2 {
  const k = mmPerMetre(layout.scale);
  return [
    layout.area.x + layout.origin[0] - tile.offset[0] + (p[0] - layout.plan.min[0]) * k,
    layout.area.y + layout.origin[1] - tile.offset[1] + (layout.plan.max[1] - p[1]) * k,
  ];
}
