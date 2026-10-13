/**
 * The title block of every PDF sheet (brief §6): a strip along the bottom of the frame (paper.ts `titleBlockRect`)
 * with four cells, left to right:
 *
 *  1. Prosjekt «Hytta ved Merkesvatnet», Forslag «…», "Hytteplanlegger · sist endret av …" and, with the "new" colours,
 *     the legend (Hytta i dag / Nytt / Fjernet);
 *  2. Etasje, Målestokk (with the paper size), Dato, Ark («2 av 4», and «rad 1, kolonne 2» when a storey is split);
 *  3. Arealer: BYA (bygg · terrasse) and BRA (i dag · nytt);
 *  4. the north arrow (Site.planNorthBearing, the same direction as in the app's plan) and a scale bar.
 *
 * Returned as SVG markup in sheet millimetres (y down), with `data-tb-*` attributes on the fields so tests can read
 * them. Text is made printable (svgPrint.ts `pdfSafeText`) and fitted to its cell (shortened with "…") with a
 * Helvetica-like width estimate.
 */
import { textWidthPx } from '../plan2d/labelLayout';
import { nb } from '../i18n/nb';
import { COLORS } from '../plan2d/style';
import { REMOVED_FILL_OPACITY } from '../plan2d/drawing';
import { northOnScreen } from '../plan2d/svg';
import type { MmRect } from './paper';
import { pdfSafeText } from './svgPrint';

const S = nb.export;

export interface TitleBlockFields {
  project: string;
  proposal: string;
  /** "Hytteplanlegger · sist endret av Mamma". */
  madeWith: string;
  storey: string;
  /** "1:50 (A3)" or "–". */
  scale: string;
  date: string;
  sheet: { index: number; count: number; tile?: { row: number; col: number } };
  bya: string;
  byaDetail: string;
  bra: string;
  braDetail: string;
  /** Site.planNorthBearing; null leaves the arrow out. */
  northBearing: number | null;
  /** Millimetres per metre on this sheet for the scale bar; null leaves it out. */
  mmPerMetre: number | null;
  /** Draw the "Vis hva som er nytt" legend. */
  legend: boolean;
}

/** Cell widths (mm) of the fixed cells; the first cell takes the rest. */
export const TB_CELLS = { info: 52, areas: 54, north: 26 } as const;

const INK = '#1f2620';
const MUTED = '#5b665d';
const RULE = '#1f2620';

/** XML-escaped text. */
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Estimated width (mm) of `text` in Helvetica at `fontMm` (the plan's Barlow table, widened). */
export function textWidthMm(text: string, fontMm: number, bold = false): number {
  return textWidthPx(text, fontMm, bold) * 1.1;
}

/** `text`, shortened with "…" to fit `maxMm`. */
export function fitText(text: string, maxMm: number, fontMm: number, bold = false): string {
  if (textWidthMm(text, fontMm, bold) <= maxMm) return text;
  let t = text;
  while (t.length > 1 && textWidthMm(`${t}…`, fontMm, bold) > maxMm) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

const n2 = (v: number) => String(Math.round(v * 100) / 100);

function text(x: number, y: number, s: string, size: number, opts: { bold?: boolean; fill?: string; anchor?: 'start' | 'middle' | 'end'; field?: string; max?: number } = {}): string {
  // What the PDF's Helvetica (WinAnsi) can print: names typed by the family may hold emoji, arrows, ≈ or Ł.
  const safe = pdfSafeText(s);
  const t = opts.max !== undefined ? fitText(safe, opts.max, size, opts.bold) : safe;
  const field = opts.field ? ` data-tb-${opts.field}="${esc(s)}"` : '';
  const anchor = opts.anchor && opts.anchor !== 'start' ? ` text-anchor="${opts.anchor}"` : '';
  return `<text x="${n2(x)}" y="${n2(y)}" font-size="${size}"${opts.bold ? ' font-weight="bold"' : ''} fill="${opts.fill ?? INK}"${anchor}${field}>${esc(t)}</text>`;
}

function line(x1: number, y1: number, x2: number, y2: number, w: number, colour = RULE): string {
  return `<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="${colour}" stroke-width="${w}"/>`;
}

/** Scale bar length (m): the longest of 5, 2, 1, 0.5 m that is at most `maxMm` long. */
export function scaleBarMetres(mmPerMetre: number, maxMm = 20): number {
  return [5, 2, 1, 0.5].find((m) => m * mmPerMetre <= maxMm + 1e-9) ?? 0.5;
}

function legend(x: number, y: number): string {
  const rows = [
    { label: S.legendExisting, fill: COLORS.wallExisting, stroke: COLORS.wallExisting, extra: '' },
    { label: S.legendNew, fill: COLORS.wallNewFill, stroke: COLORS.wallNewStroke, extra: '' },
    { label: S.legendRemoved, fill: COLORS.wallRemoved, stroke: COLORS.wallRemoved, extra: ` fill-opacity="${REMOVED_FILL_OPACITY}" stroke-dasharray="0.8 0.5"` },
  ];
  let out = '<g data-tb-legend="">';
  let cx = x;
  for (const r of rows) {
    out += `<rect x="${n2(cx)}" y="${n2(y - 2.2)}" width="4" height="2.4" fill="${r.fill}" stroke="${r.stroke}" stroke-width="0.25"${r.extra}/>`;
    out += text(cx + 5, y, r.label, 2.2, { fill: MUTED });
    cx += 5 + textWidthMm(r.label, 2.2) + 3;
  }
  return `${out}</g>`;
}

function northArrow(cx: number, cy: number, bearing: number): string {
  const [dx, dy] = northOnScreen(bearing);
  const half = 5;
  const tail = [cx - dx * half, cy - dy * half];
  const tip = [cx + dx * half, cy + dy * half];
  // Arrow head: a triangle at the tip.
  const head = 2.4;
  const nx = -dy;
  const ny = dx;
  const base = [tip[0] - dx * head, tip[1] - dy * head];
  const tri = [tip, [base[0] + nx * head * 0.45, base[1] + ny * head * 0.45], [base[0] - nx * head * 0.45, base[1] - ny * head * 0.45]];
  const lx = cx + dx * (half + 3.2);
  const ly = cy + dy * (half + 3.2);
  return (
    `<g data-tb-north="${n2(bearing)}">` +
    line(tail[0], tail[1], base[0], base[1], 0.45, INK) +
    `<path d="M${tri.map((p) => `${n2(p[0])} ${n2(p[1])}`).join('L')}Z" fill="${INK}" stroke="none"/>` +
    `<text x="${n2(lx)}" y="${n2(ly)}" font-size="3.2" font-weight="bold" fill="${INK}" text-anchor="middle" alignment-baseline="middle">${esc(S.north)}</text>` +
    '</g>'
  );
}

function scaleBar(x: number, y: number, mmPerMetre: number): string {
  const m = scaleBarMetres(mmPerMetre);
  const len = m * mmPerMetre;
  const label = `${String(m).replace('.', ',')} ${S.scaleBarUnit}`;
  let out = `<g data-tb-scalebar="${m}">`;
  out += `<rect x="${n2(x)}" y="${n2(y - 0.6)}" width="${n2(len / 2)}" height="1.2" fill="${INK}" stroke="${INK}" stroke-width="0.2"/>`;
  out += `<rect x="${n2(x + len / 2)}" y="${n2(y - 0.6)}" width="${n2(len / 2)}" height="1.2" fill="#ffffff" stroke="${INK}" stroke-width="0.2"/>`;
  out += text(x, y + 3.4, '0', 2, { fill: MUTED, anchor: 'middle' });
  out += text(x + len, y + 3.4, label, 2, { fill: MUTED, anchor: 'end' });
  return `${out}</g>`;
}

/** The title block in `rect` (sheet mm) as SVG markup. */
export function titleBlockSvg(rect: MmRect, f: TitleBlockFields): string {
  const { x, y, w, h } = rect;
  const xNorth = x + w - TB_CELLS.north;
  const xAreas = xNorth - TB_CELLS.areas;
  const xInfo = xAreas - TB_CELLS.info;
  const pad = 2.5;
  let out = '<g data-title-block="">';
  out += `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" fill="#ffffff" stroke="${RULE}" stroke-width="0.35"/>`;
  for (const cx of [xInfo, xAreas, xNorth]) out += line(cx, y, cx, y + h, 0.2);

  // 1. Project, proposal, made with, legend.
  const mainW = xInfo - x - 2 * pad;
  out += text(x + pad, y + 3.6, S.tbProject, 2, { fill: MUTED });
  out += text(x + pad, y + 8.4, f.project, 4, { bold: true, field: 'project', max: mainW });
  out += text(x + pad, y + 12.6, S.tbProposal, 2, { fill: MUTED });
  out += text(x + pad, y + 17.2, f.proposal, 3.4, { bold: true, field: 'proposal', max: mainW });
  out += text(x + pad, y + 21.8, f.madeWith, 2.2, { fill: MUTED, field: 'made-with', max: mainW });
  if (f.legend) out += legend(x + pad, y + h - 2.6);

  // 2. Storey, scale, date, sheet.
  const labelW = 16;
  const valueW = TB_CELLS.info - labelW - 2 * pad;
  const sheet = S.tbSheetOf(f.sheet.index, f.sheet.count);
  const rows: [string, string, string][] = [
    [S.tbStorey, f.storey, 'storey'],
    [S.tbScale, f.scale, 'scale'],
    [S.tbDate, f.date, 'date'],
    [S.tbSheet, sheet, 'sheet'],
  ];
  rows.forEach(([label, value, field], i) => {
    const by = y + 6.4 + i * 6.6;
    out += text(xInfo + pad, by, label, 2, { fill: MUTED });
    out += text(xInfo + pad + labelW, by, value, 3, { bold: i === 0, field, max: valueW });
  });
  if (f.sheet.tile) {
    const tile = S.tbTile(f.sheet.tile.row, f.sheet.tile.col);
    const used = textWidthMm(sheet, 3) + 1.5;
    out += text(xInfo + pad + labelW + used, y + 6.4 + 3 * 6.6, tile, 2, { fill: MUTED, field: 'tile', max: Math.max(4, valueW - used) });
  }

  // 3. Areas.
  const areaW = TB_CELLS.areas - 2 * pad;
  out += text(xAreas + pad, y + 4.2, S.tbAreas, 2, { fill: MUTED });
  out += text(xAreas + pad, y + 9.8, f.bya, 3.2, { bold: true, field: 'bya', max: areaW });
  out += text(xAreas + pad, y + 13.6, f.byaDetail, 2.2, { fill: MUTED, field: 'bya-detail', max: areaW });
  out += text(xAreas + pad, y + 20.2, f.bra, 3.2, { bold: true, field: 'bra', max: areaW });
  out += text(xAreas + pad, y + 24, f.braDetail, 2.2, { fill: MUTED, field: 'bra-detail', max: areaW });

  // 4. North arrow and scale bar.
  const cx = xNorth + TB_CELLS.north / 2;
  if (f.northBearing !== null) out += northArrow(cx, y + (f.mmPerMetre !== null ? 11 : 15), f.northBearing);
  if (f.mmPerMetre !== null) {
    const len = scaleBarMetres(f.mmPerMetre) * f.mmPerMetre;
    out += scaleBar(cx - len / 2, y + h - 6.2, f.mmPerMetre);
  }
  return `${out}</g>`;
}
