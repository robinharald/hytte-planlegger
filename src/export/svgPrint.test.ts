// @vitest-environment jsdom
/** The rewrite of screen SVG for svg2pdf (svgPrint.ts). */
import { describe, expect, it } from 'vitest';
import { applyAffine, ctmOf, greyOf, parseTransform, pdfSafeText, printify, transformScale } from './svgPrint';

function svg(body: string): Element {
  return new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`, 'image/svg+xml').documentElement;
}

describe('transforms', () => {
  it('reads the uniform scale of a transform list', () => {
    expect(transformScale(null)).toBe(1);
    expect(transformScale('matrix(80 0 0 -80 204 1172)')).toBe(80);
    expect(transformScale('translate(3 4) scale(0.0125 -0.0125) rotate(30)')).toBeCloseTo(0.0125, 12);
    expect(transformScale('scale(2,3)')).toBeCloseTo(Math.sqrt(6), 12);
  });

  it('composes matrices outermost first', () => {
    const m = parseTransform('translate(10 20) scale(0.25)');
    expect(applyAffine(m, [4, 8])).toEqual([11, 22]);
    const root = svg('<g transform="translate(10 0)"><g transform="matrix(2 0 0 -2 0 100)"><path id="p" d="M0 0"/></g></g>');
    const p = root.querySelector('#p')!;
    expect(applyAffine(ctmOf(p, root), [1, 1])).toEqual([12, 98]);
    const r = parseTransform('rotate(90)');
    const q = applyAffine(r, [1, 0]);
    expect(q[0]).toBeCloseTo(0, 12);
    expect(q[1]).toBeCloseTo(1, 12);
  });
});

describe('printify', () => {
  it('turns non-scaling strokes into strokes in the drawing\'s own pixels', () => {
    const root = svg(
      '<g transform="matrix(80 0 0 -80 0 0)">' +
        '<path id="wall" d="M0 0L1 0" stroke="#000" stroke-width="1.25" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>' +
        '<g transform="translate(1 1) scale(0.0125 -0.0125)"><line id="text-line" x1="0" y1="0" x2="5" y2="0" stroke="#000" stroke-width="2" vector-effect="non-scaling-stroke"/></g>' +
        '<path id="plain" d="M0 0L1 1" stroke="#000" stroke-width="0.012"/>' +
        '</g>',
    );
    printify(root);
    const wall = root.querySelector('#wall')!;
    expect(wall.getAttribute('stroke-width')).toBe('0.015625');
    expect(wall.getAttribute('stroke-dasharray')).toBe('0.05 0.0375');
    expect(wall.hasAttribute('vector-effect')).toBe(false);
    // Inside a counter-scaled group (ScreenText) the scale is 1 again.
    expect(root.querySelector('#text-line')!.getAttribute('stroke-width')).toBe('2');
    expect(root.querySelector('#plain')!.getAttribute('stroke-width')).toBe('0.012');
  });

  it('removes hit areas that paint nothing and keeps what paints', () => {
    const root = svg(
      '<path id="a" d="M0 0" fill="none" pointer-events="fill"/>' +
        '<line id="b" x1="0" y1="0" x2="1" y2="1" stroke="transparent" stroke-width="12"/>' +
        '<path id="c" d="M0 0" fill="#fafaf7" fill-opacity="0" stroke="none"/>' +
        '<path id="d" d="M0 0" fill="none" stroke="#fafaf7" stroke-opacity="0" stroke-width="12"/>' +
        '<g stroke="#123456"><line id="e" x1="0" y1="0" x2="1" y2="0"/></g>' +
        '<path id="f" d="M0 0"/>' +
        '<defs><clipPath id="clip"><path id="g" d="M0 0"/></clipPath></defs>',
    );
    printify(root);
    const ids = [...root.querySelectorAll('[id]')].map((e) => e.id);
    expect(ids).toEqual(['e', 'f', 'clip', 'g']);
  });

  it('gives text a separate halo, an alignment baseline svg2pdf reads, bold weights and safe characters', () => {
    const root = svg('<text id="t" x="0" y="0" font-weight="600" dominant-baseline="central" fill="#1f2620" stroke="#fafaf7" stroke-width="3" paint-order="stroke">2,2 × 4,2 m − 13,4 m² → ok</text>');
    printify(root);
    const texts = [...root.querySelectorAll('text')];
    expect(texts).toHaveLength(2);
    const [halo, text] = texts;
    expect(halo.getAttribute('data-print-halo')).toBe('true');
    expect(halo.getAttribute('fill')).toBe('none');
    expect(halo.getAttribute('stroke-width')).toBe('2');
    expect(text.hasAttribute('stroke')).toBe(false);
    expect(text.getAttribute('fill')).toBe('#1f2620');
    for (const t of texts) {
      expect(t.getAttribute('alignment-baseline')).toBe('central');
      expect(t.hasAttribute('dominant-baseline')).toBe(false);
      expect(t.getAttribute('font-weight')).toBe('bold');
      expect(t.textContent).toBe('2,2 × 4,2 m - 13,4 m² -> ok');
    }
  });

  it('greys every colour in black and white', () => {
    const root = svg('<path id="p" d="M0 0" fill="#c8742a" stroke="#4d7da0"/><path id="q" d="M0 0" fill="url(#x)" stroke="#fff"/>');
    printify(root, { greyscale: true });
    const p = root.querySelector('#p')!;
    expect(p.getAttribute('fill')).toBe(greyOf('#c8742a'));
    expect(p.getAttribute('fill')).toMatch(/^#([0-9a-f]{2})\1\1$/);
    expect(root.querySelector('#q')!.getAttribute('fill')).toBe('url(#x)');
    expect(root.querySelector('#q')!.getAttribute('stroke')).toBe('#ffffff');
  });
});

describe('helpers', () => {
  it('greys by luminance', () => {
    expect(greyOf('#000000')).toBe('#000000');
    expect(greyOf('#ffffff')).toBe('#ffffff');
    expect(greyOf('#ff0000')).toBe('#4c4c4c');
    expect(greyOf('none')).toBe('none');
  });

  it('keeps Latin-1 and the Windows-1252 extras, replaces the rest', () => {
    expect(pdfSafeText('Øvre «bod» – 2,5 m² … 3×4')).toBe('Øvre «bod» – 2,5 m² … 3×4');
    expect(pdfSafeText('−1 000 ≈ 2 ✓')).toBe('-1 000 ~ 2 ?');
  });
});
