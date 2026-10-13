/**
 * The last sheet(s) of the PDF: the room schedule (Romskjema, ui/schedule.ts `buildSchedule`: one group per level with
 * its sum, rows sorted by name) and the area totals (BYA with buildings / decks, BRA per level, axis area, rooms net)
 * as a table, in the drawing area of a portrait sheet (paper.ts `drawingArea`). A schedule longer than one sheet
 * continues on the next one, with the column heads repeated and «(fortsatt)» after the heading.
 *
 * Returned as SVG markup in sheet millimetres (y down); `data-schedule-*` attributes mark rows for the tests.
 */
import type { DerivedVariant } from '../model/derived';
import { nb } from '../i18n/nb';
import { buildingSplit } from '../ui/areaFigures';
import { formatM2, formatNumber } from '../ui/format';
import { buildSchedule, sortByLevelElevation } from '../ui/schedule';
import type { ScheduleRow } from '../ui/schedule';
import type { MmRect } from './paper';
import { esc, fitText, textWidthMm } from './titleBlock';

const S = nb.export;

const INK = '#1f2620';
const MUTED = '#5b665d';
const SHADE = '#eef1ec';
const RULE = '#9aa39c';

const ROW_H = 5.4;
const GROUP_H = 8;
const HEAD_H = 6;
const FONT = 2.9;
const SMALL = 2.3;

/** Column layout (mm from the area's left edge): name, block, dims, area (right edge), part. */
export interface ScheduleColumns {
  name: number;
  block: number;
  dims: number;
  areaRight: number;
  part: number;
  right: number;
}

export function scheduleColumns(width: number): ScheduleColumns {
  // Proportions of a 190 mm wide A4 frame; wider sheets give the extra room to the name and block columns.
  const extra = Math.max(0, width - 190);
  const name = 0;
  const block = 62 + extra * 0.45;
  const dims = block + 42 + extra * 0.3;
  const areaRight = dims + 52 + extra * 0.1;
  const part = areaRight + 6;
  return { name, block, dims, areaRight, part, right: width };
}

type Item =
  | { kind: 'group'; name: string; total: number }
  | { kind: 'row'; row: ScheduleRow; shade: boolean }
  | { kind: 'sum'; total: number }
  | { kind: 'totals'; lines: { label: string; value: string; strong?: boolean; indent?: boolean }[] }
  | { kind: 'note'; lines: string[] };

const n2 = (v: number) => String(Math.round(v * 100) / 100);

function t(x: number, y: number, s: string, size: number, o: { bold?: boolean; fill?: string; anchor?: 'end' | 'middle'; max?: number; attr?: string } = {}): string {
  const text = o.max !== undefined ? fitText(s, o.max, size, o.bold) : s;
  return `<text x="${n2(x)}" y="${n2(y)}" font-size="${size}"${o.bold ? ' font-weight="bold"' : ''} fill="${o.fill ?? INK}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.attr ?? ''}>${esc(text)}</text>`;
}

/** Words of `text` in lines no wider than `maxMm`. */
export function wrapText(text: string, maxMm: number, fontMm: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && textWidthMm(next, fontMm) > maxMm) {
      out.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

function partText(r: ScheduleRow): string {
  if (r.mixed) return S.scheduleBoth;
  return r.part === 'new' ? nb.schedule.newTag : nb.schedule.existingTag;
}

function itemHeight(it: Item): number {
  switch (it.kind) {
    case 'group':
      return GROUP_H;
    case 'row':
      return ROW_H;
    case 'sum':
      return ROW_H + 2;
    case 'totals':
      return 9 + it.lines.length * 5;
    case 'note':
      return 3 + it.lines.length * 3.6;
  }
}

function items(derived: DerivedVariant, width: number): Item[] {
  const schedule = buildSchedule(derived);
  const out: Item[] = [];
  for (const g of schedule.groups) {
    out.push({ kind: 'group', name: g.levelName, total: g.total });
    g.rows.forEach((row, i) => out.push({ kind: 'row', row, shade: i % 2 === 1 }));
  }
  out.push({ kind: 'sum', total: schedule.total });
  const a = derived.areas;
  const split = buildingSplit(a.bya, derived.outdoor.decks);
  const lines: { label: string; value: string; strong?: boolean; indent?: boolean }[] = [
    { label: S.totalsBya, value: formatM2(a.bya.total), strong: true },
    { label: S.totalsByaBuildings, value: `${formatM2(a.bya.buildings)}${split ? ` (${nb.areas.existingShort} ${formatNumber(split.existing)} · ${nb.areas.newShort} ${formatNumber(split.new)})` : ''}`, indent: true },
    { label: S.totalsByaDecks, value: formatM2(a.bya.decks), indent: true },
    { label: S.totalsBra, value: `${formatM2(a.bra.total)} (${nb.areas.existingShort} ${formatNumber(a.bra.existing)} · ${nb.areas.newShort} ${formatNumber(a.bra.new)})`, strong: true },
    ...sortByLevelElevation(a.bra.perLevel, derived.levels).map((l) => ({
      label: l.name,
      value: `${formatM2(l.area)} (${nb.areas.gross.toLowerCase()} ${formatNumber(l.gross)})`,
      indent: true,
    })),
    { label: S.totalsAxis, value: formatM2(a.axis.total) },
    { label: S.totalsRooms, value: formatM2(schedule.total) },
  ];
  out.push({ kind: 'totals', lines });
  out.push({ kind: 'note', lines: wrapText(S.totalsNote, width, SMALL) });
  return out;
}

function columnHeads(c: ScheduleColumns, x: number, y: number): string {
  const s = nb.schedule;
  let out = `<g data-schedule-head="">`;
  out += t(x + c.name, y, s.room, SMALL, { bold: true, fill: MUTED });
  out += t(x + c.block, y, s.block, SMALL, { bold: true, fill: MUTED });
  out += t(x + c.dims, y, s.dims, SMALL, { bold: true, fill: MUTED });
  out += t(x + c.areaRight, y, `${s.area} (m²)`, SMALL, { bold: true, fill: MUTED, anchor: 'end' });
  out += t(x + c.part, y, S.schedulePart, SMALL, { bold: true, fill: MUTED });
  out += `<line x1="${n2(x)}" y1="${n2(y + 1.6)}" x2="${n2(x + c.right)}" y2="${n2(y + 1.6)}" stroke="${INK}" stroke-width="0.25"/>`;
  return `${out}</g>`;
}

function drawItem(it: Item, c: ScheduleColumns, x: number, y: number): string {
  const w = c.right;
  switch (it.kind) {
    case 'group':
      return (
        `<g data-schedule-group="${esc(it.name)}">` +
        t(x, y + 5.6, it.name, 3.4, { bold: true, max: w * 0.6 }) +
        t(x + c.areaRight, y + 5.6, `${nb.schedule.levelSum} ${formatM2(it.total)}`, FONT, { anchor: 'end', fill: MUTED }) +
        `<line x1="${n2(x)}" y1="${n2(y + 7.2)}" x2="${n2(x + w)}" y2="${n2(y + 7.2)}" stroke="${RULE}" stroke-width="0.2"/>` +
        '</g>'
      );
    case 'row': {
      const r = it.row;
      const base = y + ROW_H - 1.5;
      const dims = r.approx ? `${nb.schedule.approxPrefix} ${r.dimsShort}` : r.dimsShort;
      const area = r.isVoid ? `(${formatNumber(r.area)})` : formatNumber(r.area);
      let out = `<g data-schedule-row="${esc(r.name)}" data-schedule-area="${formatNumber(r.area)}">`;
      if (it.shade) out += `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${ROW_H}" fill="${SHADE}" stroke="none"/>`;
      out += t(x + c.name + 1, base, r.isVoid ? `${r.name} ${S.scheduleVoidNote}` : r.name, FONT, { fill: r.unnamed ? MUTED : INK, max: c.block - c.name - 2 });
      out += t(x + c.block, base, r.blockName, FONT, { fill: MUTED, max: c.dims - c.block - 2 });
      out += t(x + c.dims, base, dims, FONT, { max: c.areaRight - c.dims - 14 });
      out += t(x + c.areaRight, base, area, FONT, { anchor: 'end', fill: r.isVoid ? MUTED : INK });
      out += t(x + c.part, base, partText(r), SMALL, { fill: MUTED, max: c.right - c.part });
      return `${out}</g>`;
    }
    case 'sum':
      return (
        '<g data-schedule-sum="">' +
        `<line x1="${n2(x)}" y1="${n2(y + 0.6)}" x2="${n2(x + w)}" y2="${n2(y + 0.6)}" stroke="${INK}" stroke-width="0.35"/>` +
        t(x + 1, y + ROW_H, S.scheduleTotal, FONT, { bold: true }) +
        t(x + c.areaRight, y + ROW_H, formatNumber(it.total), FONT, { bold: true, anchor: 'end' }) +
        '</g>'
      );
    case 'totals': {
      let out = '<g data-schedule-totals="">' + t(x, y + 6, S.totalsHeading, 3.6, { bold: true });
      it.lines.forEach((l, i) => {
        const by = y + 11 + i * 5;
        out += t(x + (l.indent ? 5 : 0), by, l.label, l.indent ? SMALL + 0.2 : FONT, { bold: l.strong, fill: l.indent ? MUTED : INK, max: w * 0.45 });
        out += t(x + w * 0.5, by, l.value, l.indent ? SMALL + 0.2 : FONT, { bold: l.strong, max: w * 0.5 });
      });
      return `${out}</g>`;
    }
    case 'note':
      return `<g data-schedule-note="">${it.lines.map((l, i) => t(x, y + 3 + i * 3.6, l, SMALL, { fill: MUTED })).join('')}</g>`;
  }
}

/** The schedule as one SVG body per sheet, laid out in `area` (sheet mm). */
export function scheduleBodies(derived: DerivedVariant, area: MmRect): string[] {
  const c = scheduleColumns(area.w);
  const all = items(derived, area.w);
  const pages: string[] = [];
  let i = 0;
  while (i < all.length) {
    const first = pages.length === 0;
    let out = t(area.x, area.y + 7, first ? S.scheduleHeading : `${S.scheduleHeading} ${S.scheduleContinued}`, 5, { bold: true });
    let y = area.y + 12;
    const tableLeft = all.slice(i).some((it) => it.kind === 'row' || it.kind === 'group');
    if (tableLeft) {
      out += columnHeads(c, area.x, y + 4);
      y += HEAD_H + 1;
    }
    const bottom = area.y + area.h;
    let placed = 0;
    while (i < all.length) {
      const it = all[i];
      // A group heading never ends a sheet on its own; the totals start after a little space.
      const h = itemHeight(it) + (it.kind === 'group' ? ROW_H : 0) + (it.kind === 'totals' ? 4 : 0);
      if (placed > 0 && y + h > bottom) break;
      if (it.kind === 'totals') y += 4;
      out += drawItem(it, c, area.x, y);
      y += itemHeight(it);
      placed++;
      i++;
    }
    pages.push(`<g data-schedule-page="${pages.length + 1}">${out}</g>`);
  }
  return pages;
}
