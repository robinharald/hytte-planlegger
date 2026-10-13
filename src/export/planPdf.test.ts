// @vitest-environment jsdom
/**
 * The PDF plan export on the real Forslag D seed (planPdf.ts, planSheet.tsx, titleBlock.ts, schedulePage.ts): the
 * sheets and their sizes, a known wall at the right millimetres at 1:50 and 1:100 (read back from the generated SVG
 * through its transforms), the title block, the options, and the real PDF through jsPDF + svg2pdf.js.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { deriveVariant } from '../geometry/derive';
import { createForslagD } from '../model/seed/forslagD';
import terrainJson from '../model/seed/terrain-merkesvatnet.json';
import type { TerrainAsset, Vec2 } from '../model/types';
import { fitBounds } from '../plan2d/drawing';
import { planLayerData } from '../plan2d/storeyData';
import { pdfFileName } from './fileNames';
import { PAGE_MARGIN_MM, PLAN_MARGIN_M, planToSheetMm, tilesOf } from './paper';
import { pdfPages, renderPdf } from './planPdf';
import type { PdfInput, PdfPage } from './planPdf';
import { DEFAULT_PDF_OPTIONS, storeySheets } from './sheets';
import type { PdfOptions } from './sheets';
import { applyAffine, ctmOf } from './svgPrint';

const project = createForslagD();
const derived = deriveVariant(project.variants[0], project.site, terrainJson as unknown as TerrainAsset);
const input: PdfInput = { derived, site: project.site, project: project.name, proposal: 'Forslag D', author: 'Mamma', date: new Date(2026, 9, 13, 12) };
const opts = (o: Partial<PdfOptions> = {}): PdfOptions => ({ ...DEFAULT_PDF_OPTIONS, ...o });

function parse(page: PdfPage): Element {
  return new DOMParser().parseFromString(page.svg, 'image/svg+xml').documentElement;
}

/** The vertices of a path's d (M / L pairs). */
function vertices(d: string): Vec2[] {
  const nums = (d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi) ?? []).map(Number);
  const out: Vec2[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/** The existing walls' outline on a plan sheet, mapped to sheet millimetres. */
function existingWallsMm(page: PdfPage): { plan: Vec2[]; mm: Vec2[] } {
  const root = parse(page);
  const path = root.querySelector('[data-plan-sheet] [data-wall-status="existing"]');
  if (!path) throw new Error('no existing walls');
  const m = ctmOf(path, root);
  const plan = vertices(path.getAttribute('d') ?? '');
  return { plan, mm: plan.map((p) => applyAffine(m, p)) };
}

function nearest(points: Vec2[], p: Vec2): number {
  let best = 0;
  for (let i = 1; i < points.length; i++) if (Math.hypot(points[i][0] - p[0], points[i][1] - p[1]) < Math.hypot(points[best][0] - p[0], points[best][1] - p[1])) best = i;
  return best;
}

/** Outer corners of the main house (axis 0 / 6.2, cladding 0.11 m outside). */
const SW: Vec2 = [-0.11, -0.11];
const NW: Vec2 = [-0.11, 6.31];

describe('PDF sheets for Forslag D', () => {
  it('makes one A3 landscape sheet per storey at 1:100 and the schedule on a portrait sheet', () => {
    const pages = pdfPages(input, opts());
    expect(pages.map((p) => `${p.kind}:${p.storey ?? ''}:${p.orientation}:${p.size.w}x${p.size.h}`)).toEqual([
      'plan:ground:landscape:420x297',
      'plan:loft:landscape:420x297',
      'schedule::portrait:297x420',
    ]);
    const root = parse(pages[0]);
    expect(root.getAttribute('viewBox')).toBe('0 0 420 297');
    expect(root.getAttribute('width')).toBe('420');
  });

  for (const scale of [100, 50] as const) {
    it(`places the main house's west wall at the right millimetres at 1:${scale}`, () => {
      const o = opts({ scale, storeys: 'ground' });
      const pages = pdfPages(input, o).filter((p) => p.kind === 'plan');
      const [sheets] = storeySheets(derived, o);
      const tiles = tilesOf(sheets.layout);
      expect(pages).toHaveLength(tiles.length);
      const k = 1000 / scale;
      let checked = 0;
      pages.forEach((page, i) => {
        const { plan, mm } = existingWallsMm(page);
        const sw = nearest(plan, SW);
        const nw = nearest(plan, NW);
        // The outline really has those corners.
        expect(Math.hypot(plan[sw][0] - SW[0], plan[sw][1] - SW[1])).toBeLessThan(1e-6);
        expect(Math.hypot(plan[nw][0] - NW[0], plan[nw][1] - NW[1])).toBeLessThan(1e-6);
        // Where the SVG puts them is where the layout says, and 6.42 m apart at scale, the north one above.
        const want = planToSheetMm(sheets.layout, tiles[i], SW);
        expect(mm[sw][0]).toBeCloseTo(want[0], 6);
        expect(mm[sw][1]).toBeCloseTo(want[1], 6);
        expect(mm[nw][0]).toBeCloseTo(mm[sw][0], 6);
        expect(mm[sw][1] - mm[nw][1]).toBeCloseTo(6.42 * k, 6);
        const a = sheets.layout.area;
        if (mm[sw][0] >= a.x && mm[sw][0] <= a.x + a.w && mm[sw][1] >= a.y && mm[sw][1] <= a.y + a.h) checked++;
      });
      expect(checked).toBeGreaterThanOrEqual(1);
      if (scale === 100) {
        // From first principles: one sheet, the plan rectangle centred in the 400 mm wide drawing area.
        const fit = fitBounds(derived.bounds, planLayerData(derived, 'ground').dimensions);
        const x0 = fit.min[0] - PLAN_MARGIN_M;
        const planW = (fit.max[0] + PLAN_MARGIN_M - x0) * k;
        const { mm, plan } = existingWallsMm(pages[0]);
        expect(mm[nearest(plan, SW)][0]).toBeCloseTo(PAGE_MARGIN_MM + (400 - planW) / 2 + (SW[0] - x0) * k, 6);
      }
    });
  }

  it('fills in the title block', () => {
    const pages = pdfPages(input, opts());
    const root = parse(pages[0]);
    const field = (name: string) => root.querySelector(`[data-tb-${name}]`)?.getAttribute(`data-tb-${name}`);
    expect(field('project')).toBe('Hytta ved Merkesvatnet');
    expect(field('proposal')).toBe('Forslag D');
    expect(field('made-with')).toBe('Hytteplanlegger · sist endret av Mamma');
    expect(field('storey')).toBe('Plan 1');
    expect(field('scale')).toBe('1:100 (A3)');
    expect(field('date')).toBe('13.10.2026');
    expect(field('sheet')).toBe('1 av 3');
    expect(field('bya')).toBe('BYA 235,5 m²');
    expect(field('bra')).toBe('BRA 170,1 m²');
    expect(field('north')).toBe('106');
    expect(field('scalebar')).toBe('2');
    expect(root.querySelector('[data-tb-legend]')).not.toBeNull();
    expect(parse(pages[1]).querySelector('[data-tb-storey]')?.getAttribute('data-tb-storey')).toBe('Hems');
    const sched = parse(pages[2]);
    expect(sched.querySelector('[data-tb-storey]')?.getAttribute('data-tb-storey')).toBe('Romskjema');
    expect(sched.querySelector('[data-tb-sheet]')?.getAttribute('data-tb-sheet')).toBe('3 av 3');
    expect(sched.querySelector('[data-tb-north]')).toBeNull();
  });

  it('numbers the tiles of a split storey', () => {
    const pages = pdfPages(input, opts({ paper: 'A4', scale: 50, storeys: 'ground' }));
    const plans = pages.filter((p) => p.kind === 'plan');
    expect(plans).toHaveLength(6);
    const tiles = plans.map((p) => parse(p).querySelector('[data-tb-tile]')?.getAttribute('data-tb-tile'));
    expect(tiles).toEqual(['rad 1, kolonne 1', 'rad 1, kolonne 2', 'rad 2, kolonne 1', 'rad 2, kolonne 2', 'rad 3, kolonne 1', 'rad 3, kolonne 2']);
    expect(parse(plans[5]).querySelector('[data-tb-sheet]')?.getAttribute('data-tb-sheet')).toBe(`6 av ${pages.length}`);
  });

  it('lists every room on the schedule sheet with the totals', () => {
    const pages = pdfPages(input, opts({ storeys: 'ground' }));
    const sched = parse(pages[pages.length - 1]);
    const rows = [...sched.querySelectorAll('[data-schedule-row]')].map((r) => r.getAttribute('data-schedule-row'));
    expect(rows).toHaveLength(derived.rooms.length);
    expect(rows).toContain('Stue');
    expect(sched.querySelectorAll('[data-schedule-group]')).toHaveLength(3);
    expect(sched.querySelector('[data-schedule-totals]')?.textContent).toContain('235,5 m²');
  });

  it('follows the options', () => {
    const full = parse(pdfPages(input, opts({ storeys: 'ground' }))[0]);
    expect(full.querySelectorAll('[data-furniture-id]').length).toBeGreaterThan(40);
    expect(full.querySelectorAll('[data-dimension-kind]').length).toBeGreaterThan(5);
    expect(full.querySelectorAll('[data-room-label]').length).toBeGreaterThan(15);
    expect(full.querySelectorAll('[data-floor-kind]').length).toBeGreaterThan(0);
    expect(full.innerHTML).toContain('#e9b48c'); // new walls in the "new" tint
    const bare = parse(pdfPages(input, opts({ storeys: 'ground', furniture: false, dims: false, labels: false, colour: false }))[0]);
    expect(bare.querySelectorAll('[data-furniture-id]')).toHaveLength(0);
    expect(bare.querySelectorAll('[data-dimension-kind]')).toHaveLength(0);
    expect(bare.querySelectorAll('[data-room-label]')).toHaveLength(0);
    expect(bare.querySelectorAll('[data-floor-kind]')).toHaveLength(0);
    expect(bare.querySelector('[data-tb-legend]')).toBeNull();
    // Black and white: every colour in the drawing is a grey.
    const colours = new Set([...bare.querySelectorAll('[data-plan-sheet] *')].flatMap((e) => ['fill', 'stroke'].map((a) => e.getAttribute(a) ?? '')).filter((v) => v.startsWith('#')));
    expect(colours.size).toBeGreaterThan(0);
    for (const c of colours) expect(c, c).toMatch(/^#([0-9a-f]{2})\1\1$/);
  });

  it('leaves no screen-only markup for svg2pdf', () => {
    const svg = pdfPages(input, opts({ storeys: 'ground' }))[0].svg;
    expect(svg).not.toContain('vector-effect');
    expect(svg).not.toContain('paint-order');
    expect(svg).not.toContain('dominant-baseline');
    expect(svg).not.toContain('transparent');
    expect(svg).not.toMatch(/font-weight="[0-9]/);
  });

  it('names the file after the proposal and the day', () => {
    expect(pdfFileName('Mitt forslag (Mamma)', new Date(2026, 9, 3))).toBe('hytta-mitt-forslag-mamma-2026-10-03.pdf');
    expect(pdfFileName('Bod på østsiden – ærlig', new Date(2026, 0, 31))).toBe('hytta-bod-pa-ostsiden-aerlig-2026-01-31.pdf');
    expect(pdfFileName('…', new Date(2026, 0, 1))).toBe('hytta-forslag-2026-01-01.pdf');
  });
});

describe('PDF through jsPDF and svg2pdf.js', () => {
  beforeAll(() => {
    // jsdom has no layout: svg2pdf measures centred text with getBBox (and a 2D canvas jsdom lacks).
    (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = function (this: SVGElement) {
      const size = parseFloat(this.getAttribute('font-size') ?? '16') || 16;
      return { x: 0, y: 0, width: (this.textContent ?? '').length * size * 0.55, height: size } as DOMRect;
    };
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  });

  it('has the expected page count and page sizes', async () => {
    const pages = pdfPages(input, opts());
    const r = await renderPdf(pages, { title: 'Hytta ved Merkesvatnet – Forslag D' });
    expect(r.pages).toBe(3);
    const text = new TextDecoder('latin1').decode(new Uint8Array(r.bytes));
    expect(text.startsWith('%PDF-')).toBe(true);
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(3);
    const boxes = (text.match(/\/MediaBox \[([^\]]*)\]/g) ?? []).map((m) => m.replace(/\/MediaBox \[|\]/g, '').split(/\s+/).map((v) => Math.round(Number(v))));
    // A3 landscape twice, then A3 portrait (points).
    expect(boxes).toEqual([
      [0, 0, 1191, 842],
      [0, 0, 1191, 842],
      [0, 0, 842, 1191],
    ]);
  }, 30000);

  it('makes A4 sheets for A4', async () => {
    const pages = pdfPages(input, opts({ paper: 'A4', storeys: 'loft' }));
    const r = await renderPdf(pages);
    expect(r.pages).toBe(pages.length);
    const text = new TextDecoder('latin1').decode(new Uint8Array(r.bytes));
    const first = text.match(/\/MediaBox \[([^\]]*)\]/)?.[1].split(/\s+/).map((v) => Math.round(Number(v)));
    expect(first).toEqual(pages[0].orientation === 'landscape' ? [0, 0, 842, 595] : [0, 0, 595, 842]);
  }, 30000);
});
