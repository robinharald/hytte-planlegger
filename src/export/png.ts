/**
 * The PNG of the 3D view (brief §6): the captured frame (view3d/capture.ts, at the device's pixel ratio) with a
 * caption strip under it — line 1 the proposal (bold) and «Hytteplanlegger» at the right when there is room, line 2
 * «3D · Ute · Oversikt · 13.10.2026». The menu action that takes, names and hands over the image is pngExport.ts.
 *
 * `captionLayout` is the pure part (unit-tested): sizes scale with the pixel ratio, texts are shortened to fit.
 * The PNG is encoded synchronously (toDataURL), so a share sheet can still open from the user's tap.
 */
import type { Captured3D } from '../view3d/capture';

export interface CaptionTexts {
  /** Line 1, bold: the proposal («Hytta ved Merkesvatnet – Mitt forslag»). */
  title: string;
  /** Line 2: view and date. */
  sub: string;
  /** Line 1, right: «Hytteplanlegger» (left out when it does not fit). */
  brand: string;
}

export interface CaptionText {
  text: string;
  x: number;
  /** Top of the text (textBaseline 'top'). */
  y: number;
  font: number;
  bold: boolean;
  align: 'left' | 'right';
}

export interface CaptionLayout {
  /** Height of the strip under the image (device px). */
  stripH: number;
  pad: number;
  title: CaptionText;
  sub: CaptionText;
  brand: CaptionText | null;
}

/** Text width (px) at a font size, bold or not. */
export type Measure = (text: string, fontPx: number, bold: boolean) => number;

/** CSS-pixel sizes of the caption (multiplied by the capture's pixel ratio). */
export const CAPTION = { pad: 10, title: 15, sub: 12, gap: 5, brandGap: 16 } as const;

/** `text` shortened with "…" so that it is at most `max` px wide. */
export function truncateToWidth(text: string, max: number, font: number, bold: boolean, measure: Measure): string {
  if (measure(text, font, bold) <= max) return text;
  let t = text;
  while (t.length > 0 && measure(`${t}…`, font, bold) > max) t = t.slice(0, -1);
  return t.length > 0 ? `${t.trimEnd()}…` : '';
}

/** The caption strip for an image `width` device px wide at `ratio` device px per CSS px, its top at `top`. */
export function captionLayout(width: number, ratio: number, texts: CaptionTexts, measure: Measure, top = 0): CaptionLayout {
  const r = Math.max(0.5, ratio);
  const pad = Math.round(CAPTION.pad * r);
  const titleFont = Math.round(CAPTION.title * r);
  const subFont = Math.round(CAPTION.sub * r);
  const gap = Math.round(CAPTION.gap * r);
  const stripH = pad * 2 + Math.round(titleFont * 1.15) + gap + Math.round(subFont * 1.15);
  const room = Math.max(0, width - 2 * pad);
  const brandW = measure(texts.brand, subFont, false);
  const titleW = measure(texts.title, titleFont, true);
  const brandFits = texts.brand !== '' && titleW + Math.round(CAPTION.brandGap * r) + brandW <= room;
  const y1 = top + pad;
  const y2 = y1 + Math.round(titleFont * 1.15) + gap;
  return {
    stripH,
    pad,
    title: { text: truncateToWidth(texts.title, room, titleFont, true, measure), x: pad, y: y1, font: titleFont, bold: true, align: 'left' },
    sub: { text: truncateToWidth(texts.sub, room, subFont, false, measure), x: pad, y: y2, font: subFont, bold: false, align: 'left' },
    brand: brandFits ? { text: texts.brand, x: width - pad, y: y1 + Math.round((titleFont - subFont) / 2), font: subFont, bold: false, align: 'right' } : null,
  };
}

const FONT_FAMILY = "'Barlow', 'Barlow Semi Condensed', system-ui, sans-serif";
const fontOf = (px: number, bold: boolean) => `${bold ? '600 ' : ''}${px}px ${FONT_FAMILY}`;

/** The captured frame with the caption strip under it. */
export function composeCaptioned(shot: Pick<Captured3D, 'canvas' | 'ratio'>, texts: CaptionTexts, doc: Document = document): HTMLCanvasElement {
  const src = shot.canvas;
  const probe = doc.createElement('canvas').getContext('2d');
  const measure: Measure = (t, px, bold) => {
    if (!probe) return t.length * px * 0.55;
    probe.font = fontOf(px, bold);
    return probe.measureText(t).width;
  };
  const layout = captionLayout(src.width, shot.ratio, texts, measure, src.height);
  const out = doc.createElement('canvas');
  out.width = src.width;
  out.height = src.height + layout.stripH;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('canvas 2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0);
  ctx.fillStyle = '#d5dbd3';
  ctx.fillRect(0, src.height, out.width, Math.max(1, Math.round(shot.ratio)));
  ctx.textBaseline = 'top';
  for (const t of [layout.title, layout.sub, layout.brand]) {
    if (!t || !t.text) continue;
    ctx.font = fontOf(t.font, t.bold);
    ctx.fillStyle = t.bold ? '#1f2620' : '#5b665d';
    ctx.textAlign = t.align;
    ctx.fillText(t.text, t.x, t.y);
  }
  return out;
}

/** A canvas as a PNG blob, synchronously (toDataURL), so a share sheet can still open from the same tap. */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Blob {
  const url = canvas.toDataURL('image/png');
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}
