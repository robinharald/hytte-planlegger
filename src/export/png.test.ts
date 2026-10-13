/** The 3D picture's caption strip and pixel ratio (png.ts, view3d/capture.ts), and its file name. */
import { describe, expect, it } from 'vitest';
import { MAX_CAPTURE_PIXELS, MAX_CAPTURE_SIDE, captureRatio } from '../view3d/capture';
import { pngFileName } from './fileNames';
import { CAPTION, captionLayout, truncateToWidth } from './png';
import type { Measure } from './png';

/** Half an em per character, 10 % wider in bold. */
const measure: Measure = (text, px, bold) => text.length * px * 0.5 * (bold ? 1.1 : 1);
const texts = { title: 'Hytta ved Merkesvatnet – Mitt forslag', sub: '3D · Ute · Oversikt · 13.10.2026', brand: 'Hytteplanlegger' };

describe('caption strip', () => {
  it('scales with the pixel ratio', () => {
    const one = captionLayout(1400, 1, texts, measure);
    const three = captionLayout(4200, 3, texts, measure);
    expect(one.pad).toBe(CAPTION.pad);
    expect(one.title.font).toBe(CAPTION.title);
    expect(one.sub.font).toBe(CAPTION.sub);
    expect(one.stripH).toBe(2 * 10 + Math.round(15 * 1.15) + 5 + Math.round(12 * 1.15));
    expect(three.pad).toBe(30);
    expect(three.title.font).toBe(45);
    expect(Math.abs(three.stripH - 3 * one.stripH)).toBeLessThanOrEqual(3);
  });

  it('puts the title and the brand on line 1, the view and date on line 2, under the image', () => {
    const l = captionLayout(1400, 1, texts, measure, 800);
    expect(l.title).toMatchObject({ text: texts.title, x: 10, y: 810, bold: true, align: 'left' });
    expect(l.sub).toMatchObject({ text: texts.sub, x: 10, align: 'left', bold: false });
    expect(l.sub.y).toBeGreaterThan(l.title.y + l.title.font);
    expect(l.sub.y + l.sub.font).toBeLessThanOrEqual(800 + l.stripH);
    expect(l.brand).toMatchObject({ text: 'Hytteplanlegger', x: 1390, align: 'right' });
  });

  it('drops the brand and shortens the texts on a narrow phone picture', () => {
    // An iPhone in portrait: 390 CSS px at 3×.
    const l = captionLayout(1170, 3, { ...texts, title: 'Hytta ved Merkesvatnet – Familiens store forslag med anneks' }, measure);
    expect(l.brand).toBeNull();
    const room = 1170 - 2 * l.pad;
    expect(l.title.text.endsWith('…')).toBe(true);
    expect(measure(l.title.text, l.title.font, true)).toBeLessThanOrEqual(room);
    expect(measure(l.sub.text, l.sub.font, false)).toBeLessThanOrEqual(room);
  });

  it('shortens text to a width', () => {
    expect(truncateToWidth('abcdef', 100, 10, false, measure)).toBe('abcdef');
    expect(truncateToWidth('abcdefghij', 30, 10, false, measure)).toBe('abcde…');
    expect(truncateToWidth('abc', 2, 10, false, measure)).toBe('');
  });
});

describe('capture pixel ratio', () => {
  it('uses the device ratio within the limits', () => {
    expect(captureRatio(390, 600, 3)).toBe(3);
    expect(captureRatio(1366, 600, 1)).toBe(1);
    expect(captureRatio(1366, 600, 1.25)).toBe(1.25);
    expect(captureRatio(800, 600, 0.5)).toBe(1);
    expect(captureRatio(800, 600, Number.NaN)).toBe(1);
    expect(captureRatio(800, 600, 4)).toBe(3);
  });

  it('stays under the canvas limits', () => {
    const r = captureRatio(2560, 1400, 3);
    expect(2560 * r * 1400 * r).toBeLessThanOrEqual(MAX_CAPTURE_PIXELS + 1);
    expect(2560 * r).toBeLessThanOrEqual(MAX_CAPTURE_SIDE);
    const wide = captureRatio(5000, 300, 2);
    expect(5000 * wide).toBeLessThanOrEqual(MAX_CAPTURE_SIDE + 1e-9);
  });
});

describe('file name', () => {
  it('is «hytta-3d-<dato>.png»', () => {
    expect(pngFileName(new Date(2026, 9, 13, 23, 59))).toBe('hytta-3d-2026-10-13.png');
  });
});
