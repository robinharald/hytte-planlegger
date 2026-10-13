/** Title block text fitting and the schedule's sheet split (titleBlock.ts, schedulePage.ts). */
import { describe, expect, it } from 'vitest';
import { deriveVariant } from '../geometry/derive';
import { createForslagD } from '../model/seed/forslagD';
import terrainJson from '../model/seed/terrain-merkesvatnet.json';
import type { TerrainAsset } from '../model/types';
import { drawingArea, pageSize, titleBlockRect } from './paper';
import { scheduleBodies, scheduleColumns, wrapText } from './schedulePage';
import { esc, fitText, scaleBarMetres, textWidthMm, titleBlockSvg } from './titleBlock';
import type { TitleBlockFields } from './titleBlock';

const fields: TitleBlockFields = {
  project: 'Hytta ved Merkesvatnet',
  proposal: 'Et svært langt forslagsnavn som ikke får plass i feltet på et A4-ark <med tegn> & sånn',
  madeWith: 'Hytteplanlegger',
  storey: 'Plan 1',
  scale: '1:50 (A4)',
  date: '13.10.2026',
  sheet: { index: 2, count: 7, tile: { row: 1, col: 2 } },
  bya: 'BYA 235,5 m²',
  byaDetail: 'bygg 178,3 · terrasse 57,2',
  bra: 'BRA 170,1 m²',
  braDetail: 'i dag 103,5 · nytt 66,6',
  northBearing: 106,
  mmPerMetre: 20,
  legend: false,
};

describe('title block', () => {
  it('shortens text that does not fit and escapes it', () => {
    expect(fitText('Kort', 50, 3)).toBe('Kort');
    const long = fitText(fields.proposal, 40, 3.4, true);
    expect(long.endsWith('…')).toBe(true);
    expect(textWidthMm(long, 3.4, true)).toBeLessThanOrEqual(40);
    expect(esc('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
  });

  it('picks a scale bar of at most 20 mm', () => {
    expect(scaleBarMetres(20)).toBe(1);
    expect(scaleBarMetres(10)).toBe(2);
    expect(scaleBarMetres(4)).toBe(5);
  });

  it('keeps the full values in data attributes and draws the sheet position', () => {
    const svg = titleBlockSvg(titleBlockRect(pageSize('A4', 'portrait')), fields);
    expect(svg).toContain(`data-tb-proposal="${esc(fields.proposal)}"`);
    expect(svg).toContain('data-tb-sheet="2 av 7"');
    expect(svg).toContain('data-tb-tile="rad 1, kolonne 2"');
    expect(svg).toContain('data-tb-scalebar="1"');
    expect(svg).not.toContain('data-tb-legend');
    // Well-formed XML.
    expect(() => new DOMParserLike().check(`<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`)).not.toThrow();
  });
});

/** A tiny well-formedness check without a DOM: balanced tags, escaped text. */
class DOMParserLike {
  check(xml: string): void {
    const stack: string[] = [];
    for (const m of xml.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
      if (m[3] === '/') continue;
      if (m[1] === '/') {
        if (stack.pop() !== m[2]) throw new Error(`unbalanced ${m[2]}`);
      } else stack.push(m[2]);
    }
    if (stack.length) throw new Error(`unclosed ${stack.join(',')}`);
    if (/&(?!amp;|lt;|gt;|quot;|#)/.test(xml)) throw new Error('unescaped &');
  }
}

describe('schedule sheets', () => {
  const project = createForslagD();
  const derived = deriveVariant(project.variants[0], project.site, terrainJson as unknown as TerrainAsset);

  it('fits Forslag D on one A3 sheet and continues on a second A4 sheet', () => {
    expect(scheduleBodies(derived, drawingArea(pageSize('A3', 'portrait')))).toHaveLength(1);
    const a4 = scheduleBodies(derived, drawingArea(pageSize('A4', 'portrait')));
    expect(a4.length).toBeGreaterThanOrEqual(1);
    const all = a4.join('');
    expect((all.match(/data-schedule-row=/g) ?? []).length).toBe(derived.rooms.length);
    expect(all).toContain('data-schedule-totals');
    if (a4.length > 1) expect(a4[1]).toContain('(fortsatt)');
  });

  it('splits a long schedule over sheets without losing rows', () => {
    const short = { ...drawingArea(pageSize('A4', 'portrait')), h: 90 };
    const pages = scheduleBodies(derived, short);
    expect(pages.length).toBeGreaterThan(2);
    expect((pages.join('').match(/data-schedule-row=/g) ?? []).length).toBe(derived.rooms.length);
    for (const p of pages.slice(0, -1)) expect(p).toContain('data-schedule-head');
  });

  it('wraps notes and lays out the columns', () => {
    const lines = wrapText('ord '.repeat(60).trim(), 50, 2.3);
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(textWidthMm(l, 2.3)).toBeLessThanOrEqual(50);
    const c = scheduleColumns(190);
    expect(c.name).toBeLessThan(c.block);
    expect(c.block).toBeLessThan(c.dims);
    expect(c.dims).toBeLessThan(c.areaRight);
    expect(c.part).toBeLessThan(c.right);
  });
});
