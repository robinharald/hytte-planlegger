/**
 * Test helper: SVG hit testing for jsdom, which has none. `svgElementAt(svg, client)` returns the element a pointer at
 * a client point would hit in a rendered plan, following the browser's rules as far as the plan uses them:
 *  - topmost first: the last element in document order wins (the plan has no z-index);
 *  - the `pointer-events` property, inherited from the ancestors: 'none'; 'fill' / 'visibleFill' (the fill area,
 *    painted or not); 'stroke' / 'visibleStroke' (the stroke area); 'all' / 'visible' (both); 'visiblePainted' /
 *    'painted' (the default: the fill area when `fill` is not 'none', the stroke area when `stroke` is not 'none');
 *  - fill areas of path / polygon / rect / circle with `fill-rule` nonzero or evenodd; stroke areas of line / path /
 *    polyline / polygon / rect / circle, half the `stroke-width` on each side (screen px with
 *    `vector-effect: non-scaling-stroke`, else scaled by the element's transform), butt ends;
 *  - every ancestor's `transform` (matrix, translate, scale, rotate about the origin).
 * Paths: M, L, H, V, Z (absolute and relative); curves and arcs count with their end points only (the plan's curves
 * take no pointer events). The svg is assumed at the client origin with a viewBox equal to its pixel size (jsdom).
 * Not part of the app; used by the plan's tests (touchTaps.test.tsx, PlanView.fixes2.test.tsx).
 */
import type { Vec2 } from '../model/types';

/** 2D affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const apply = (m: Matrix, p: Vec2): Vec2 => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

/** Parse an SVG transform list (matrix, translate, scale, rotate). */
export function parseTransform(t: string | null): Matrix {
  let m: Matrix = IDENTITY;
  if (!t) return m;
  const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g;
  for (let r = re.exec(t); r; r = re.exec(t)) {
    const v = r[2]
      .split(/[\s,]+/)
      .filter((x) => x !== '')
      .map(Number);
    let n: Matrix = IDENTITY;
    if (r[1] === 'matrix' && v.length === 6) n = v as Matrix;
    else if (r[1] === 'translate') n = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
    else if (r[1] === 'scale') n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    else if (r[1] === 'rotate') {
      const a = ((v[0] ?? 0) * Math.PI) / 180;
      n = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
    }
    m = mul(m, n);
  }
  return m;
}

/** Subpaths (point lists, and whether each is closed) of path data. */
export function parsePath(d: string | null): { pts: Vec2[]; closed: boolean }[] {
  const out: { pts: Vec2[]; closed: boolean }[] = [];
  if (!d) return out;
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  let i = 0;
  let cmd = '';
  let cur: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  let sub: { pts: Vec2[]; closed: boolean } | null = null;
  const num = () => Number(tokens[i++]);
  const counts: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, z: 0, c: 6, s: 4, q: 4, t: 2, a: 7 };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const lower = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    if (lower === 'z') {
      if (sub) sub.closed = true;
      cur = start;
      sub = null;
      continue;
    }
    const n = counts[lower];
    if (n === undefined || i + n > tokens.length) break;
    const v = Array.from({ length: n }, num);
    let p: Vec2;
    if (lower === 'h') p = [rel ? cur[0] + v[0] : v[0], cur[1]];
    else if (lower === 'v') p = [cur[0], rel ? cur[1] + v[0] : v[0]];
    else p = rel ? [cur[0] + v[n - 2], cur[1] + v[n - 1]] : [v[n - 2], v[n - 1]];
    if (lower === 'm') {
      sub = { pts: [p], closed: false };
      out.push(sub);
      start = p;
      cmd = rel ? 'l' : 'L';
    } else {
      if (!sub) {
        sub = { pts: [cur], closed: false };
        out.push(sub);
      }
      sub.pts.push(p);
    }
    cur = p;
  }
  return out;
}

/** The value of an inherited presentation property: the element's attribute or style, else its ancestors'. */
function inherited(el: Element, attr: string, css: string): string | null {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const style = (e as HTMLElement).style as CSSStyleDeclaration | undefined;
    const s = style?.getPropertyValue(css);
    if (s) return s.trim();
    const a = e.getAttribute(attr);
    if (a !== null) return a.trim();
  }
  return null;
}

function ctm(el: Element, root: Element, cache: Map<Element, Matrix>): Matrix {
  const hit = cache.get(el);
  if (hit) return hit;
  const parent = el === root || !el.parentElement ? IDENTITY : ctm(el.parentElement, root, cache);
  const m = el === root ? IDENTITY : mul(parent, parseTransform(el.getAttribute('transform')));
  cache.set(el, m);
  return m;
}

const distToSegment = (p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  const c = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p[0] - (a[0] + c * dx), p[1] - (a[1] + c * dy)), t };
};

/** Winding number (nonzero) / crossing parity (evenodd) of the rings around p. */
function insideRings(p: Vec2, rings: Vec2[][], evenodd: boolean): boolean {
  let winding = 0;
  let crossings = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (a[1] <= p[1] !== b[1] <= p[1]) {
        const x = a[0] + ((p[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
        if (x > p[0]) {
          crossings++;
          winding += b[1] > a[1] ? 1 : -1;
        }
      }
    }
  }
  return evenodd ? crossings % 2 === 1 : winding !== 0;
}

interface Shape {
  /** Rings of the fill area (screen px), empty for lines. */
  fill: Vec2[][];
  /** Segments of the stroke (screen px). */
  stroke: [Vec2, Vec2][];
  /** A circle (screen px). */
  circle?: { c: Vec2; r: number };
}

function shapeOf(el: Element, m: Matrix): Shape | null {
  const n = (a: string) => Number(el.getAttribute(a) ?? 0);
  const tag = el.tagName.toLowerCase();
  const ringSegments = (ring: Vec2[], closed: boolean): [Vec2, Vec2][] => {
    const s: [Vec2, Vec2][] = [];
    for (let i = 0; i + 1 < ring.length; i++) s.push([ring[i], ring[i + 1]]);
    if (closed && ring.length > 2) s.push([ring[ring.length - 1], ring[0]]);
    return s;
  };
  switch (tag) {
    case 'line': {
      const a = apply(m, [n('x1'), n('y1')]);
      const b = apply(m, [n('x2'), n('y2')]);
      return { fill: [], stroke: [[a, b]] };
    }
    case 'path': {
      const subs = parsePath(el.getAttribute('d')).map((s) => ({ pts: s.pts.map((p) => apply(m, p)), closed: s.closed }));
      return { fill: subs.filter((s) => s.pts.length >= 3).map((s) => s.pts), stroke: subs.flatMap((s) => ringSegments(s.pts, s.closed)) };
    }
    case 'polygon':
    case 'polyline': {
      const nums = (el.getAttribute('points') ?? '').split(/[\s,]+/).filter((x) => x !== '').map(Number);
      const pts: Vec2[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push(apply(m, [nums[i], nums[i + 1]]));
      return { fill: tag === 'polygon' ? [pts] : [pts], stroke: ringSegments(pts, tag === 'polygon') };
    }
    case 'rect': {
      const x = n('x');
      const y = n('y');
      const w = n('width');
      const h = n('height');
      const ring: Vec2[] = [apply(m, [x, y]), apply(m, [x + w, y]), apply(m, [x + w, y + h]), apply(m, [x, y + h])];
      return { fill: [ring], stroke: ringSegments(ring, true) };
    }
    case 'circle': {
      const c = apply(m, [n('cx'), n('cy')]);
      const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      return { fill: [], stroke: [], circle: { c, r: n('r') * k } };
    }
    default:
      return null;
  }
}

const SHAPES = 'line, path, polygon, polyline, rect, circle';

/** The topmost element of `svg` a pointer at the client point would hit (see the header), or null. */
export function svgElementAt(svg: SVGSVGElement, client: Vec2): Element | null {
  const cache = new Map<Element, Matrix>();
  const shapes = [...svg.querySelectorAll(SHAPES)].reverse();
  for (const el of shapes) {
    if (el.closest('defs, clipPath, mask, pattern')) continue;
    const pe = (inherited(el, 'pointer-events', 'pointer-events') ?? 'visiblePainted').toLowerCase();
    if (pe === 'none') continue;
    const fillPaint = (inherited(el, 'fill', 'fill') ?? 'black').toLowerCase();
    const strokePaint = (inherited(el, 'stroke', 'stroke') ?? 'none').toLowerCase();
    const useFill = pe === 'fill' || pe === 'visiblefill' || pe === 'all' || pe === 'visible' || ((pe === 'visiblepainted' || pe === 'painted') && fillPaint !== 'none');
    const useStroke = pe === 'stroke' || pe === 'visiblestroke' || pe === 'all' || pe === 'visible' || ((pe === 'visiblepainted' || pe === 'painted') && strokePaint !== 'none');
    if (!useFill && !useStroke) continue;
    const m = ctm(el, svg, cache);
    const shape = shapeOf(el, m);
    if (!shape) continue;
    const scaling = (inherited(el, 'vector-effect', 'vector-effect') ?? '') !== 'non-scaling-stroke';
    const k = scaling ? Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) : 1;
    const half = (Number(inherited(el, 'stroke-width', 'stroke-width') ?? 1) * k) / 2;
    const evenodd = (inherited(el, 'fill-rule', 'fill-rule') ?? 'nonzero') === 'evenodd';
    if (shape.circle) {
      const d = Math.hypot(client[0] - shape.circle.c[0], client[1] - shape.circle.c[1]);
      if ((useFill && d <= shape.circle.r) || (useStroke && Math.abs(d - shape.circle.r) <= half)) return el;
      continue;
    }
    if (useFill && shape.fill.length > 0 && insideRings(client, shape.fill, evenodd)) return el;
    if (useStroke && shape.stroke.some(([a, b]) => {
      const { d, t } = distToSegment(client, a, b);
      return d <= half + 1e-9 && t >= -1e-9 && t <= 1 + 1e-9;
    })) {
      return el;
    }
  }
  return null;
}
