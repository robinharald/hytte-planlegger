/**
 * Makes the plan layers' SVG printable through svg2pdf.js (planSheet.tsx). The layers are drawn for a screen; svg2pdf
 * and PDF lack a few of the things they rely on, so the parsed markup is rewritten in place:
 *
 *  - `vector-effect: non-scaling-stroke` (stroke widths in screen px whatever the zoom) is not supported: each such
 *    stroke width and dash array is divided by the element's scale relative to the drawing's own pixel space (the
 *    product of the transforms from the root down to it), and the attribute is dropped.
 *  - Hit areas (no fill and no stroke, a transparent stroke, zero opacity) are removed: they draw nothing and only
 *    make the PDF bigger.
 *  - Text: `dominant-baseline` becomes `alignment-baseline` (what svg2pdf reads); a text with a paper-coloured halo
 *    (`paint-order: stroke`, which svg2pdf would paint over the letters) becomes two texts, the halo first; font weights
 *    become `bold` / `normal` (the PDF's Helvetica has no 600); characters outside the PDF fonts' Latin-1 encoding are
 *    replaced (the minus sign, thin spaces, arrows).
 *  - Greyscale (the black/white export): every #rgb / #rrggbb paint becomes its grey of the same luminance.
 *
 * Pure DOM work (no layout), unit-tested in jsdom (svgPrint.test.ts).
 */

const SHAPES = new Set(['path', 'line', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'text']);
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

/** The uniform scale factor (√|det|) of an SVG transform list; 1 for none. */
export function transformScale(transform: string | null | undefined): number {
  if (!transform) return 1;
  let det = 1;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (let m = re.exec(transform); m; m = re.exec(transform)) {
    const args = (m[2].match(NUMBER) ?? []).map(Number);
    if (m[1] === 'matrix' && args.length >= 4) det *= args[0] * args[3] - args[1] * args[2];
    else if (m[1] === 'scale' && args.length >= 1) det *= args[0] * (args.length >= 2 ? args[1] : args[0]);
  }
  return Math.sqrt(Math.abs(det));
}

/** Plain 2D affine matrix [a, b, c, d, e, f] (SVG order). */
export type Affine = [number, number, number, number, number, number];

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function multiply(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** The matrix of an SVG transform list. */
export function parseTransform(transform: string | null | undefined): Affine {
  let out = IDENTITY;
  if (!transform) return out;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (let m = re.exec(transform); m; m = re.exec(transform)) {
    const a = (m[2].match(NUMBER) ?? []).map(Number);
    let t: Affine = IDENTITY;
    switch (m[1]) {
      case 'matrix':
        if (a.length >= 6) t = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case 'translate':
        t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case 'scale':
        t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180;
        const [c, s] = [Math.cos(r), Math.sin(r)];
        const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
        t = multiply(multiply([1, 0, 0, 1, cx, cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    out = multiply(out, t);
  }
  return out;
}

export function applyAffine(m: Affine, p: readonly [number, number]): [number, number] {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** The product of the transforms of `el` and its ancestors up to (excluding) `root`, outermost first. */
export function ctmOf(el: Element, root?: Element | null): Affine {
  const chain: Element[] = [];
  for (let n: Element | null = el; n && n !== root; n = n.parentElement) chain.push(n);
  return chain.reverse().reduce<Affine>((m, n) => multiply(m, parseTransform(n.getAttribute('transform'))), IDENTITY);
}

/** Characters the PDF's standard fonts (WinAnsi) lack, and what to print instead. */
const REPLACE: Record<string, string> = {
  '−': '-',
  '‐': '-',
  '‑': '-',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '→': '->',
  '←': '<-',
  '≈': '~',
  '≤': '<=',
  '≥': '>=',
};

/** Text the PDF fonts can print (Latin-1 plus the Windows-1252 extras: « » – — … € ² ×). */
export function pdfSafeText(text: string): string {
  let out = '';
  for (const ch of text) {
    const r = REPLACE[ch];
    if (r !== undefined) out += r;
    else if (ch.charCodeAt(0) <= 0xff || '–—…‘’“”•€™‚„†‡ˆ‰Š‹ŒŽšœžŸ'.includes(ch)) out += ch;
    else out += '?';
  }
  return out;
}

/** "#rrggbb" / "#rgb" → its grey (Rec. 601 luminance) as "#vvvvvv"; anything else unchanged. */
export function greyOf(colour: string): string {
  const c = colour.trim();
  let hex = /^#([0-9a-f]{6})$/i.exec(c)?.[1];
  if (!hex) {
    const short = /^#([0-9a-f]{3})$/i.exec(c)?.[1];
    if (short) hex = [...short].map((ch) => ch + ch).join('');
  }
  if (!hex) return colour;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const v = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  const h = Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
}

/** Widest text halo kept (px of the drawing; 0.5 mm on paper). */
const HALO_MAX = 2;

const isNone = (v: string | null | undefined) => v === 'none' || v === 'transparent';
const isZero = (v: string | null | undefined) => v != null && v.trim() !== '' && Number(v) === 0;

interface Paint {
  fill: string | null;
  stroke: string | null;
}

/** An element that paints nothing (a hit area). */
function invisible(el: Element, inherited: Paint): boolean {
  if (isZero(el.getAttribute('opacity'))) return true;
  const tag = el.localName;
  const fill = el.getAttribute('fill') ?? inherited.fill ?? 'black';
  const stroke = el.getAttribute('stroke') ?? inherited.stroke ?? 'none';
  const noFill = tag === 'line' || isNone(fill) || isZero(el.getAttribute('fill-opacity'));
  const noStroke = isNone(stroke) || isZero(el.getAttribute('stroke-opacity')) || isZero(el.getAttribute('stroke-width'));
  return noFill && noStroke;
}

function scaleList(value: string, k: number): string {
  return value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((v) => String(Math.round((Number(v) / k) * 1e5) / 1e5))
    .join(' ');
}

function fixText(el: Element): void {
  const base = el.getAttribute('dominant-baseline');
  if (base && !el.hasAttribute('alignment-baseline')) el.setAttribute('alignment-baseline', base);
  el.removeAttribute('dominant-baseline');
  const weight = el.getAttribute('font-weight');
  if (weight && /^\d+$/.test(weight)) el.setAttribute('font-weight', Number(weight) >= 600 ? 'bold' : 'normal');
  for (const node of [...el.childNodes]) if (node.nodeType === 3 && node.textContent) node.textContent = pdfSafeText(node.textContent);
  for (const span of [...el.querySelectorAll('tspan')]) for (const node of [...span.childNodes]) if (node.nodeType === 3 && node.textContent) node.textContent = pdfSafeText(node.textContent);
  if (el.getAttribute('paint-order') === 'stroke' && el.hasAttribute('stroke') && !isNone(el.getAttribute('stroke'))) {
    const halo = el.cloneNode(true) as Element;
    halo.setAttribute('fill', 'none');
    // A thinner halo than on screen: on paper it only has to part the letters from lines and hatches.
    const sw = Number(halo.getAttribute('stroke-width') ?? 1);
    if (sw > HALO_MAX) halo.setAttribute('stroke-width', String(HALO_MAX));
    halo.removeAttribute('paint-order');
    halo.setAttribute('data-print-halo', 'true');
    el.parentNode?.insertBefore(halo, el);
    for (const a of ['stroke', 'stroke-width', 'stroke-linejoin', 'paint-order']) el.removeAttribute(a);
  }
  el.removeAttribute('paint-order');
}

const PAINT_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color'];

export interface PrintOptions {
  /** Convert every colour to grey (the black/white export). */
  greyscale?: boolean;
}

/**
 * Rewrites the SVG subtree under `root` for svg2pdf (see the header). `root`'s own coordinate system is the
 * "screen" the layers' pixel sizes refer to.
 */
export function printify(root: Element, opts: PrintOptions = {}): void {
  const walk = (el: Element, scale: number, inherited: Paint, inDefs: boolean): void => {
    const k = el === root ? 1 : scale * transformScale(el.getAttribute('transform'));
    const tag = el.localName;
    const defs = inDefs || tag === 'defs' || tag === 'pattern' || tag === 'clipPath' || tag === 'mask';
    if (!defs && SHAPES.has(tag)) {
      if (invisible(el, inherited)) {
        el.remove();
        return;
      }
    }
    if (opts.greyscale) for (const a of PAINT_ATTRS) {
      const v = el.getAttribute(a);
      if (v) el.setAttribute(a, greyOf(v));
    }
    if (el.getAttribute('vector-effect') === 'non-scaling-stroke') {
      el.removeAttribute('vector-effect');
      if (k > 0 && Math.abs(k - 1) > 1e-12) {
        const sw = el.getAttribute('stroke-width');
        el.setAttribute('stroke-width', String(Math.round(((sw === null ? 1 : Number(sw)) / k) * 1e6) / 1e6));
        const dash = el.getAttribute('stroke-dasharray');
        if (dash && dash !== 'none') el.setAttribute('stroke-dasharray', scaleList(dash, k));
      }
    }
    if (tag === 'text') fixText(el);
    const next: Paint = { fill: el.getAttribute('fill') ?? inherited.fill, stroke: el.getAttribute('stroke') ?? inherited.stroke };
    for (const child of [...el.children]) walk(child, k, next, defs);
  };
  walk(root, 1, { fill: null, stroke: null }, false);
}
