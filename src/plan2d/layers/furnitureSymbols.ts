/**
 * 2D furniture symbols (docs/phase2-plan.md §4 "2D symbols"): a registry from catalogue id to a recognisable plan
 * symbol, as plain drawing primitives (pure, no React; FurnitureSymbol.tsx renders them, in the plan and in the
 * library's small icons).
 *
 * Local frame of an item (metres): origin at the item's centre (`FurnitureItem.position`), x along the width `w`, y
 * along the depth `d` (the frame `DerivedFurniture.footprint` is built in, before `rotationDeg` turns it CCW). The
 * FRONT is the local south edge (y = −d/2; where you sit, open or stand), the BACK the local north edge
 * (y = +d/2; what stands against a wall: a bed's head, a sofa's back, a WC's cistern) — the convention of
 * model/unitTemplates.ts. Every symbol is built from the item's own size, so a stretched item keeps its look.
 *
 * Primitives stay inside the footprint (`symbolOverflow` is 0 for every entry). A dining table is the table alone: its
 * chairs are items of their own (Stol), as in 3D, so the plan never shows a seat that is not there.
 *
 * Styles (FurnitureSymbol.tsx maps them to strokes / fills): 'outline' the body (paper fill, main stroke), 'line' a
 * detail line, 'thin' a hairline, 'dashed' a dashed hairline (things above the cut: wall cabinets, a bunk's upper
 * bed), 'soft' a softly filled part (pillows, cushions, backrests, a cistern), 'paper' a paper-filled part drawn over
 * other parts, 'glass' a glass pane (blue).
 */
import { catalogItem } from '../../furniture/catalog';
import type { Vec2 } from '../../model/types';

export type SymbolStyle = 'outline' | 'line' | 'thin' | 'dashed' | 'soft' | 'paper' | 'glass';

export type SymbolPrim =
  | { k: 'rect'; x: number; y: number; w: number; h: number; r?: number; s: SymbolStyle }
  | { k: 'circle'; cx: number; cy: number; r: number; s: SymbolStyle }
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number; s: SymbolStyle }
  | { k: 'line'; a: Vec2; b: Vec2; s: SymbolStyle }
  | { k: 'poly'; pts: Vec2[]; closed: boolean; s: SymbolStyle };

export type SymbolKind =
  | 'bed'
  | 'bunk'
  | 'nightstand'
  | 'wardrobe'
  | 'drawers'
  | 'sofa'
  | 'cornerSofa'
  | 'armchair'
  | 'coffeeTable'
  | 'rug'
  | 'tvBench'
  | 'bookcase'
  | 'stove'
  | 'baseCabinet'
  | 'wallCabinet'
  | 'tallCabinet'
  | 'fridge'
  | 'island'
  | 'diningTable'
  | 'chair'
  | 'toilet'
  | 'sink'
  | 'shower'
  | 'showerScreen'
  | 'bathtub'
  | 'washer'
  | 'dryer'
  | 'washerTower'
  | 'towelRail'
  | 'drain'
  | 'waterHeater'
  | 'saunaBench'
  | 'saunaStove'
  | 'shelf'
  | 'shoeRack'
  | 'bench'
  | 'skiRack'
  | 'logStack'
  | 'lounge'
  | 'outdoorTable'
  | 'outdoorChair'
  | 'grill'
  /** Unknown catalogue id ('furniture-unknown'): a box with a cross. */
  | 'box';

export interface SymbolDef {
  kind: SymbolKind;
  /** Seats of a dining table / cushions of a sofa (by id; otherwise from the width). */
  count?: number;
  /** Short code written in the symbol when it is big enough on screen (appliances: "KJ", "VM", "TT", "VV"). */
  code?: string;
}

/**
 * Every catalogue id (append-only, the furniture core's list) → its symbol. The symbol tests check this covers the
 * whole catalogue.
 */
export const FURNITURE_SYMBOLS: Readonly<Record<string, SymbolDef>> = {
  'seng-90': { kind: 'bed', count: 1 },
  'seng-120': { kind: 'bed', count: 2 },
  'seng-150': { kind: 'bed', count: 2 },
  'seng-180': { kind: 'bed', count: 2 },
  koyeseng: { kind: 'bunk', count: 1 },
  nattbord: { kind: 'nightstand' },
  garderobeskap: { kind: 'wardrobe' },
  kommode: { kind: 'drawers' },
  'sofa-2': { kind: 'sofa', count: 2 },
  'sofa-3': { kind: 'sofa', count: 3 },
  hjornesofa: { kind: 'cornerSofa' },
  lenestol: { kind: 'armchair' },
  salongbord: { kind: 'coffeeTable' },
  teppe: { kind: 'rug' },
  'tv-benk': { kind: 'tvBench' },
  bokhylle: { kind: 'bookcase' },
  vedovn: { kind: 'stove' },
  benkeskap: { kind: 'baseCabinet' },
  overskap: { kind: 'wallCabinet' },
  hoyskap: { kind: 'tallCabinet' },
  kjoleskap: { kind: 'fridge', code: 'KJ' },
  kjokkenoy: { kind: 'island' },
  'spisebord-4': { kind: 'diningTable', count: 4 },
  'spisebord-6': { kind: 'diningTable', count: 6 },
  'spisebord-8': { kind: 'diningTable', count: 8 },
  stol: { kind: 'chair' },
  toalett: { kind: 'toilet' },
  servant: { kind: 'sink' },
  'dusj-80': { kind: 'shower' },
  'dusj-90': { kind: 'shower' },
  'dusj-100': { kind: 'shower' },
  dusjvegg: { kind: 'showerScreen' },
  badekar: { kind: 'bathtub' },
  vaskemaskin: { kind: 'washer', code: 'VM' },
  torketrommel: { kind: 'dryer', code: 'TT' },
  vaskesoyle: { kind: 'washerTower', code: 'VM' },
  handkletorker: { kind: 'towelRail' },
  sluk: { kind: 'drain' },
  varmtvannsbereder: { kind: 'waterHeater', code: 'VV' },
  badstubenk: { kind: 'saunaBench' },
  badstuovn: { kind: 'saunaStove' },
  hylle: { kind: 'shelf' },
  skohylle: { kind: 'shoeRack' },
  benk: { kind: 'bench' },
  skistativ: { kind: 'skiRack' },
  vedstabel: { kind: 'logStack' },
  loungesofa: { kind: 'lounge', count: 2 },
  utebord: { kind: 'outdoorTable' },
  utestol: { kind: 'outdoorChair' },
  grill: { kind: 'grill' },
};

const UNKNOWN: SymbolDef = { kind: 'box' };

/**
 * The catalogue's `symbol` keys (furniture/catalog.ts) → symbol kinds, so an entry appended to the catalogue later
 * draws with the symbol it names even before it gets its own line in FURNITURE_SYMBOLS.
 */
export const CATALOG_SYMBOL_KINDS: Readonly<Record<string, SymbolKind>> = {
  bed: 'bed',
  bunk: 'bunk',
  nightstand: 'nightstand',
  wardrobe: 'wardrobe',
  chest: 'drawers',
  sofa: 'sofa',
  'corner-sofa': 'cornerSofa',
  armchair: 'armchair',
  'coffee-table': 'coffeeTable',
  rug: 'rug',
  'tv-bench': 'tvBench',
  bookshelf: 'bookcase',
  stove: 'stove',
  'base-cabinet': 'baseCabinet',
  'wall-cabinet': 'wallCabinet',
  'tall-cabinet': 'tallCabinet',
  fridge: 'fridge',
  island: 'island',
  'dining-table': 'diningTable',
  chair: 'chair',
  toilet: 'toilet',
  sink: 'sink',
  shower: 'shower',
  'shower-screen': 'showerScreen',
  bathtub: 'bathtub',
  washer: 'washer',
  dryer: 'dryer',
  'washer-tower': 'washerTower',
  'towel-rail': 'towelRail',
  drain: 'drain',
  'water-heater': 'waterHeater',
  'sauna-bench': 'saunaBench',
  'sauna-stove': 'saunaStove',
  shelf: 'shelf',
  'shoe-rack': 'shoeRack',
  bench: 'bench',
  'ski-rack': 'skiRack',
  'log-stack': 'logStack',
  'lounge-sofa': 'lounge',
  'outdoor-table': 'outdoorTable',
  'outdoor-chair': 'outdoorChair',
  grill: 'grill',
};

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** The symbol of a catalogue id: its own entry, else the catalogue's symbol key, else a box with a cross. */
export function symbolFor(catalogId: string): SymbolDef {
  if (own(FURNITURE_SYMBOLS, catalogId)) return FURNITURE_SYMBOLS[catalogId];
  const key = catalogItem(catalogId)?.symbol;
  return key && own(CATALOG_SYMBOL_KINDS, key) ? { kind: CATALOG_SYMBOL_KINDS[key] } : UNKNOWN;
}

/** Whether the catalogue id draws a symbol of its own (not the unknown box). */
export function hasSymbol(catalogId: string): boolean {
  return symbolFor(catalogId).kind !== 'box';
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

const clampPos = (v: number) => (v > 0 ? v : 0);

function rect(x0: number, y0: number, x1: number, y1: number, s: SymbolStyle, r?: number): SymbolPrim {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  const rr = r === undefined ? undefined : Math.max(0, Math.min(r, w / 2, h / 2));
  return rr ? { k: 'rect', x, y, w, h, r: rr, s } : { k: 'rect', x, y, w, h, s };
}

const line = (ax: number, ay: number, bx: number, by: number, s: SymbolStyle = 'line'): SymbolPrim => ({ k: 'line', a: [ax, ay], b: [bx, by], s });
const circle = (cx: number, cy: number, r: number, s: SymbolStyle): SymbolPrim => ({ k: 'circle', cx, cy, r: clampPos(r), s });
const ellipse = (cx: number, cy: number, rx: number, ry: number, s: SymbolStyle): SymbolPrim => ({ k: 'ellipse', cx, cy, rx: clampPos(rx), ry: clampPos(ry), s });
const poly = (pts: Vec2[], s: SymbolStyle, closed = true): SymbolPrim => ({ k: 'poly', pts, closed, s });

/** n evenly spaced values strictly between a and b. */
function between(a: number, b: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push(a + ((b - a) * i) / (n + 1));
  return out;
}

/** Chord of a circle (centre c, radius r) along a horizontal line at y (null outside). */
function chordAtY(cx: number, cy: number, r: number, y: number): [number, number] | null {
  const dy = y - cy;
  if (Math.abs(dy) >= r) return null;
  const h = Math.sqrt(r * r - dy * dy);
  return [cx - h, cx + h];
}

// ---------------------------------------------------------------------------
// Symbols (W = w / 2, D = d / 2; front y = −D, back y = +D)
// ---------------------------------------------------------------------------

function bed(w: number, d: number, pillows: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline', Math.min(0.03, w * 0.05))];
  const head = Math.min(0.06, d * 0.04);
  out.push(rect(-W, D - head, W, D, 'soft'));
  const n = w >= 1.1 ? Math.max(1, pillows) : 1;
  const gap = 0.06;
  const side = Math.min(0.06, w * 0.06);
  const pw = (w - 2 * side - (n - 1) * gap) / n;
  const pd = Math.min(0.34, d * 0.17);
  const pTop = D - head - Math.min(0.05, d * 0.03);
  for (let i = 0; i < n; i++) {
    const x0 = -W + side + i * (pw + gap);
    out.push(rect(x0, pTop - pd, x0 + pw, pTop, 'soft', Math.min(0.06, pd / 3)));
  }
  // Duvet: its top edge below the pillows, with the folded-down corner.
  const yd = pTop - pd - Math.min(0.08, d * 0.04);
  out.push(line(-W, yd, W, yd));
  const fold = Math.min(0.4, w * 0.3, (yd + D) * 0.5);
  out.push(poly([[W - fold, yd], [W, yd - fold]], 'thin', false));
  return out;
}

function bunk(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const out = bed(w, d, 1);
  const inset = Math.min(0.05, w * 0.06, d * 0.03);
  // The upper bed (above the cut) and the ladder at the foot end.
  out.push(rect(-W + inset, -D + inset, W - inset, D - inset, 'dashed'));
  const lx0 = -W + inset;
  const lx1 = lx0 + Math.min(0.08, w * 0.12);
  const ly0 = -D + Math.min(0.15, d * 0.08);
  const ly1 = ly0 + Math.min(0.45, d * 0.25);
  out.push(line(lx0, ly0, lx0, ly1, 'thin'), line(lx1, ly0, lx1, ly1, 'thin'));
  for (const y of between(ly0, ly1, 3)) out.push(line(lx0, y, lx1, y, 'thin'));
  return out;
}

function nightstand(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const front = Math.min(0.03, d * 0.08);
  return [rect(-W, -D, W, D, 'outline', Math.min(0.02, w * 0.05)), line(-W, -D + front, W, -D + front, 'thin'), circle(0, D * 0.15, Math.min(w, d) * 0.24, 'thin')];
}

function wardrobe(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const t = Math.min(0.03, d * 0.06);
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline'), line(-W, -D + t, W, -D + t)];
  // Door joints across the front strip, about 0.5 m apart.
  const doors = Math.max(1, Math.round(w / 0.5));
  for (const x of between(-W, W, doors - 1)) out.push(line(x, -D, x, -D + t * 2, 'thin'));
  // Hanging rail with hangers.
  const yr = (D - (-D + t)) / 2 + (-D + t);
  out.push(line(-W + 0.04 * Math.min(1, w), yr, W - 0.04 * Math.min(1, w), yr, 'dashed'));
  const hangers = Math.max(1, Math.floor((w - 0.1) / 0.12));
  const hl = Math.min(0.2, d * 0.35);
  for (const x of between(-W + 0.05, W - 0.05, hangers)) out.push(line(x - hl * 0.25, yr - hl / 2, x + hl * 0.25, yr + hl / 2, 'thin'));
  return out;
}

function drawers(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const t = Math.min(0.03, d * 0.07);
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline', Math.min(0.015, w * 0.03)), line(-W, -D + t, W, -D + t)];
  const cols = w > 0.9 ? 2 : 1;
  for (const x of between(-W, W, cols - 1)) out.push(line(x, -D, x, -D + t, 'thin'));
  const hw = Math.min(0.1, w * 0.12);
  for (let c = 0; c < cols; c++) {
    const cx = -W + (w * (c + 0.5)) / cols;
    out.push(line(cx - hw / 2, -D + t * 0.5, cx + hw / 2, -D + t * 0.5, 'thin'));
  }
  return out;
}

/** Seat cushions side by side between x0 and x1 (y from y0 to y1). */
function cushions(x0: number, x1: number, y0: number, y1: number, n: number, s: SymbolStyle = 'line'): SymbolPrim[] {
  const out: SymbolPrim[] = [];
  const gap = 0.02;
  const cw = (x1 - x0 - (n - 1) * gap) / n;
  if (cw <= 0 || y1 <= y0) return out;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * (cw + gap);
    out.push(rect(a, y0, a + cw, y1, s, Math.min(0.05, cw / 4, (y1 - y0) / 4)));
  }
  return out;
}

function sofa(w: number, d: number, n: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const back = Math.min(0.22, d * 0.26);
  const arm = Math.min(0.18, w * 0.1);
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline', Math.min(0.06, d * 0.08))];
  out.push(rect(-W, D - back, W, D, 'soft', Math.min(0.05, back / 3)));
  out.push(rect(-W, -D, -W + arm, D - back, 'soft', Math.min(0.04, arm / 3)), rect(W - arm, -D, W, D - back, 'soft', Math.min(0.04, arm / 3)));
  const count = n > 0 ? n : Math.max(1, Math.round((w - 2 * arm) / 0.6));
  out.push(...cushions(-W + arm + 0.02, W - arm - 0.02, -D + Math.min(0.04, d * 0.05), D - back - 0.02, count));
  return out;
}

/**
 * Corner sofa, the catalogue's 'l' outline (furniture/catalog.ts `localParts`): a back strip of depth `seat` over the
 * whole width and a chaise of width `seat` at the local +x end reaching the front; the free corner is front-left.
 */
function cornerSofa(w: number, d: number, seatDepth = 0.9): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const seat = Math.min(seatDepth, w, d);
  if (seat >= d - 1e-9 || seat >= w - 1e-9) return sofa(w, d, 0);
  const back = Math.min(0.22, seat * 0.26);
  const arm = Math.min(0.18, w * 0.08);
  const out: SymbolPrim[] = [
    poly(
      [
        [-W, D - seat],
        [W - seat, D - seat],
        [W - seat, -D],
        [W, -D],
        [W, D],
        [-W, D],
      ],
      'outline',
    ),
  ];
  // Backrests along the back and the +x side, an arm at the −x end of the long leg.
  out.push(rect(-W, D - back, W, D, 'soft'), rect(W - back, -D, W, D - back, 'soft'), rect(-W, D - seat, -W + arm, D - back, 'soft'));
  const longN = Math.max(1, Math.round((w - seat - arm) / 0.65));
  out.push(...cushions(-W + arm + 0.02, W - seat - 0.02, D - seat + 0.03, D - back - 0.02, longN));
  // The corner seat and the chaise.
  out.push(rect(W - seat + 0.01, D - seat + 0.03, W - back - 0.02, D - back - 0.02, 'line', 0.04));
  out.push(rect(W - seat + 0.01, -D + 0.03, W - back - 0.02, D - seat - 0.01, 'line', 0.04));
  return out;
}

function armchair(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const back = Math.min(0.18, d * 0.24);
  const arm = Math.min(0.14, w * 0.17);
  return [
    rect(-W, -D, W, D, 'outline', Math.min(0.08, w * 0.1)),
    rect(-W, D - back, W, D, 'soft', Math.min(0.06, back / 2)),
    rect(-W, -D, -W + arm, D - back, 'soft', Math.min(0.05, arm / 2)),
    rect(W - arm, -D, W, D - back, 'soft', Math.min(0.05, arm / 2)),
    rect(-W + arm + 0.02, -D + 0.04, W - arm - 0.02, D - back - 0.02, 'line', 0.05),
  ];
}

function coffeeTable(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const i = Math.min(0.05, w * 0.08, d * 0.08);
  return [rect(-W, -D, W, D, 'outline', Math.min(0.06, w * 0.1, d * 0.1)), rect(-W + i, -D + i, W - i, D - i, 'thin', Math.min(0.04, w * 0.08, d * 0.08))];
}

function rug(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const fringe = Math.min(0.06, Math.max(w, d) * 0.04);
  const out: SymbolPrim[] = [];
  // Fringes on the short ends.
  if (w >= d) {
    out.push(rect(-W + fringe, -D, W - fringe, D, 'thin'));
    const ys = between(-D, D, Math.max(2, Math.floor(d / 0.1)));
    for (const y of ys) out.push(line(-W, y, -W + fringe, y, 'thin'), line(W - fringe, y, W, y, 'thin'));
    const i = Math.min(0.1, d * 0.12);
    out.push(rect(-W + fringe + i, -D + i, W - fringe - i, D - i, 'dashed'));
  } else {
    out.push(rect(-W, -D + fringe, W, D - fringe, 'thin'));
    const xs = between(-W, W, Math.max(2, Math.floor(w / 0.1)));
    for (const x of xs) out.push(line(x, -D, x, -D + fringe, 'thin'), line(x, D - fringe, x, D, 'thin'));
    const i = Math.min(0.1, w * 0.12);
    out.push(rect(-W + i, -D + fringe + i, W - i, D - fringe - i, 'dashed'));
  }
  return out;
}

function tvBench(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const tvW = Math.min(1.4, w * 0.8);
  const tvD = Math.min(0.06, d * 0.18);
  const y1 = D - Math.min(0.06, d * 0.15);
  return [
    rect(-W, -D, W, D, 'outline'),
    line(-W, -D + Math.min(0.03, d * 0.08), W, -D + Math.min(0.03, d * 0.08), 'thin'),
    rect(-tvW / 2, y1 - tvD, tvW / 2, y1, 'soft'),
    line(0, y1 - tvD, 0, y1 - tvD - Math.min(0.08, d * 0.2), 'thin'),
  ];
}

function bookcase(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const t = Math.min(0.02, d * 0.06);
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline'), line(-W, -D + t, W, -D + t, 'thin')];
  // Book spines, alternately deep and shallow.
  const n = Math.max(2, Math.floor((w - 0.04) / 0.07));
  between(-W + 0.02, W - 0.02, n).forEach((x, i) => out.push(line(x, D - t, x, D - t - (d - 2 * t) * (i % 3 === 1 ? 0.62 : 0.85), 'thin')));
  return out;
}

function stove(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const m = Math.min(w, d);
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline', Math.min(0.05, m * 0.12))];
  // Fire door at the front, the flue at the back.
  const dw = w * 0.6;
  out.push(rect(-dw / 2, -D + m * 0.08, dw / 2, -D + m * 0.3, 'thin', 0.01));
  out.push(circle(0, D - m * 0.32, m * 0.17, 'line'), circle(0, D - m * 0.32, m * 0.09, 'soft'));
  return out;
}

function baseCabinet(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  // The counter top (outline), its front edge over the doors (dashed counter line) and the unit joints.
  const t = Math.min(0.04, d * 0.07);
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline'), line(-W, -D + t, W, -D + t, 'dashed')];
  const units = Math.max(1, Math.round(w / 0.6));
  for (const x of between(-W, W, units - 1)) out.push(line(x, -D + t, x, -D + t + Math.min(0.08, d * 0.15), 'thin'));
  return out;
}

function wallCabinet(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  return [rect(-W, -D, W, D, 'dashed'), line(-W, -D, W, D, 'dashed'), line(-W, D, W, -D, 'dashed')];
}

function tallCabinet(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  return [rect(-W, -D, W, D, 'outline'), line(-W, -D, W, D, 'thin'), line(-W, D, W, -D, 'thin')];
}

function fridge(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const t = Math.min(0.05, d * 0.08);
  const r = Math.min(w, d - t) * 0.18;
  const cy = t / 2;
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline'), line(-W, -D + t, W, -D + t)];
  // A snowflake.
  for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
    const dx = Math.cos(a) * r;
    const dy = Math.sin(a) * r;
    out.push(line(-dx, cy - dy, dx, cy + dy, 'thin'));
  }
  return out;
}

function island(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const i = Math.min(0.04, w * 0.05, d * 0.05);
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline'), rect(-W + i, -D + i, W - i, D - i, 'thin')];
  // The cabinets under the back half (the front half is the bar side).
  out.push(line(-W + i, 0, W - i, 0, 'dashed'));
  return out;
}

/** A dining table: the table top alone (its chairs are items of their own, see the header). */
function diningTable(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const i = Math.min(0.03, w * 0.05, d * 0.05);
  return [rect(-W, -D, W, D, 'outline', Math.min(0.03, w * 0.05, d * 0.05)), rect(-W + i, -D + i, W - i, D - i, 'thin')];
}

function chair(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const back = Math.min(0.07, d * 0.16);
  return [rect(-W, -D, W, D, 'outline', Math.min(0.06, w * 0.12)), rect(-W, D - back, W, D, 'soft', Math.min(0.03, back / 2))];
}

function toilet(w: number, d: number): SymbolPrim[] {
  const D = d / 2;
  const tank = Math.min(0.2, d * 0.3);
  const tw = Math.min(0.44, w * 0.95);
  const out: SymbolPrim[] = [rect(-tw / 2, D - tank, tw / 2, D, 'soft', Math.min(0.03, tank / 4))];
  // The bowl in front of the cistern, and the seat opening.
  const by0 = -D;
  const by1 = D - tank;
  const cy = (by0 + by1) / 2;
  const rx = Math.min(0.2, w * 0.45);
  const ry = Math.max(0.01, (by1 - by0) / 2);
  out.push(ellipse(0, cy, rx, ry, 'outline'), ellipse(0, cy - ry * 0.08, rx * 0.62, ry * 0.66, 'thin'));
  return out;
}

function sink(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline', Math.min(0.03, d * 0.06))];
  const rx = Math.min(0.24, w * 0.36);
  const ry = Math.min(0.17, d * 0.32);
  const cy = -D + d * 0.45;
  out.push(ellipse(0, cy, rx, ry, 'line'), circle(0, cy, Math.min(0.02, ry * 0.2), 'thin'));
  out.push(circle(0, D - Math.min(0.06, d * 0.14), Math.min(0.025, d * 0.06), 'soft'));
  return out;
}

function shower(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const i = Math.min(0.03, w * 0.04, d * 0.04);
  const g = Math.min(0.015, d * 0.02);
  return [
    rect(-W, -D, W, D, 'outline'),
    rect(-W + i, -D + i, W - i, D - i, 'thin'),
    line(-W + i, -D + i, W - i, D - i, 'thin'),
    line(-W + i, D - i, W - i, -D + i, 'thin'),
    circle(0, 0, Math.min(0.045, w * 0.06, d * 0.06), 'line'),
    // Glass along the front.
    line(-W, -D, W, -D, 'glass'),
    line(-W, -D + g, W, -D + g, 'glass'),
  ];
}

function showerScreen(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const t = Math.min(0.012, d * 0.3);
  const post = Math.min(0.03, w * 0.05);
  return [
    line(-W, -t / 2, W, -t / 2, 'glass'),
    line(-W, t / 2, W, t / 2, 'glass'),
    rect(-W, -Math.min(D, 0.02), -W + post, Math.min(D, 0.02), 'soft'),
  ];
}

function bathtub(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const i = Math.min(0.07, w * 0.06, d * 0.1);
  const long = w >= d;
  const r = Math.min(0.2, (long ? d : w) * 0.3);
  const drain: Vec2 = long ? [-W + i + Math.min(0.15, w * 0.1), 0] : [0, -D + i + Math.min(0.15, d * 0.1)];
  return [rect(-W, -D, W, D, 'outline', Math.min(0.03, w * 0.03)), rect(-W + i, -D + i, W - i, D - i, 'line', r), circle(drain[0], drain[1], Math.min(0.03, d * 0.05), 'thin')];
}

function washer(w: number, d: number, dashedInner: boolean): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const m = Math.min(w, d);
  const t = Math.min(0.03, d * 0.06);
  return [
    rect(-W, -D, W, D, 'outline', Math.min(0.03, m * 0.05)),
    line(-W, -D + t, W, -D + t, 'thin'),
    circle(0, t / 2, m * 0.33, 'line'),
    circle(0, t / 2, m * 0.2, dashedInner ? 'dashed' : 'thin'),
  ];
}

function washerTower(w: number, d: number): SymbolPrim[] {
  const out = washer(w, d, false);
  const m = Math.min(w, d);
  // The dryer on top (above the cut): a dashed drum offset towards the back.
  out.push(circle(0, m * 0.08, m * 0.27, 'dashed'));
  return out;
}

function towelRail(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline', Math.min(0.01, d * 0.2))];
  for (const x of between(-W, W, Math.max(1, Math.floor(w / 0.12)))) out.push(line(x, -D, x, D, 'thin'));
  return out;
}

function drain(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const r = Math.min(w, d) * 0.36;
  return [rect(-W, -D, W, D, 'outline'), circle(0, 0, r, 'line'), line(-r * 0.7, 0, r * 0.7, 0, 'thin'), line(0, -r * 0.7, 0, r * 0.7, 'thin')];
}

function waterHeater(w: number, d: number): SymbolPrim[] {
  const r = (Math.min(w, d) / 2) * 0.96;
  return [circle(0, 0, r, 'outline'), circle(0, 0, r * 0.78, 'thin'), circle(0, 0, Math.min(0.03, r * 0.15), 'soft')];
}

/** Sauna benches: one tier, or (deeper than 0.8 m) a lower front tier and an upper back tier. */
function saunaBench(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline')];
  const tiers: [number, number][] = d > 0.8 ? [[-D, 0], [0, D]] : [[-D, D]];
  if (tiers.length > 1) out.push(rect(-W, 0, W, D, 'soft'), line(-W, 0, W, 0));
  for (const [y0, y1] of tiers) {
    const slats = Math.max(1, Math.floor((y1 - y0) / 0.095) - 1);
    for (const y of between(y0, y1, slats)) out.push(line(-W, y, W, y, 'thin'));
  }
  return out;
}

function saunaStove(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const m = Math.min(w, d);
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline', Math.min(0.03, m * 0.06)), rect(-W + m * 0.1, -D + m * 0.1, W - m * 0.1, D - m * 0.1, 'thin')];
  // Stones.
  const n = Math.max(2, Math.min(4, Math.floor((m * 0.8) / 0.09)));
  const r = Math.min(0.035, (m * 0.8) / n / 2.6);
  for (const x of between(-W + m * 0.1, W - m * 0.1, n)) for (const y of between(-D + m * 0.1, D - m * 0.1, n)) out.push(circle(x, y, r, 'soft'));
  return out;
}

function shelf(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const t = Math.min(0.02, d * 0.06);
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline'), line(-W, -D + t, W, -D + t, 'thin')];
  // Uprights.
  const bays = Math.max(1, Math.round(w / 0.8));
  for (const x of between(-W, W, bays - 1)) out.push(line(x, -D, x, D, 'thin'));
  return out;
}

function shoeRack(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline')];
  const pairs = Math.max(1, Math.floor(w / 0.24));
  const ry = Math.max(0.01, d * 0.36);
  const rx = Math.min(0.045, w / pairs / 5);
  for (const x of between(-W, W, pairs)) out.push(ellipse(x - rx * 1.2, 0, rx, ry, 'thin'), ellipse(x + rx * 1.2, 0, rx, ry, 'thin'));
  return out;
}

function bench(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline', Math.min(0.02, d * 0.06))];
  for (const y of between(-D, D, Math.max(1, Math.floor(d / 0.1) - 1))) out.push(line(-W, y, W, y, 'thin'));
  return out;
}

function skiRack(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline')];
  const pairs = Math.max(1, Math.floor(w / 0.16));
  const g = Math.min(0.025, w / pairs / 6);
  for (const x of between(-W, W, pairs)) out.push(line(x - g, -D + d * 0.1, x - g, D - d * 0.1, 'line'), line(x + g, -D + d * 0.1, x + g, D - d * 0.1, 'line'));
  return out;
}

function logStack(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline')];
  const r = Math.min(0.06, d / 4.6, w / 4.6);
  const cols = Math.max(1, Math.floor(w / (2.2 * r)));
  const rows = Math.max(1, Math.floor(d / (2.2 * r)));
  const ys = between(-D, D, rows);
  ys.forEach((y, j) => {
    const xs = between(-W, W, cols);
    for (let i = 0; i < xs.length; i++) {
      // Every other row shifted by half a log where there is room.
      const x = xs[i] + (j % 2 === 1 && i < xs.length - 1 ? (xs[i + 1] - xs[i]) / 2 : 0);
      if (j % 2 === 1 && i === xs.length - 1 && xs.length > 1) continue;
      out.push(circle(x, y, r, 'thin'));
    }
  });
  return out;
}

function lounge(w: number, d: number, n: number): SymbolPrim[] {
  const out = sofa(w, d, n);
  const W = w / 2;
  const D = d / 2;
  const back = Math.min(0.22, d * 0.26);
  // Slatted back.
  for (const x of between(-W, W, Math.max(2, Math.floor(w / 0.1)))) out.push(line(x, D - back, x, D, 'thin'));
  return out;
}

function outdoorTable(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline', Math.min(0.02, w * 0.03))];
  const long = w >= d;
  const planks = Math.max(1, Math.floor((long ? d : w) / 0.12));
  if (long) for (const y of between(-D, D, planks)) out.push(line(-W, y, W, y, 'thin'));
  else for (const x of between(-W, W, planks)) out.push(line(x, -D, x, D, 'thin'));
  return out;
}

function outdoorChair(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  const back = Math.min(0.1, d * 0.2);
  const out: SymbolPrim[] = [rect(-W, -D, W, D, 'outline', Math.min(0.04, w * 0.08)), rect(-W, D - back, W, D, 'soft')];
  for (const y of between(-D, D - back, Math.max(1, Math.floor((d - back) / 0.1)))) out.push(line(-W + 0.02, y, W - 0.02, y, 'thin'));
  return out;
}

/** A kettle grill (round), or a gas grill with side tables when the item is long. */
function grill(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  if (w > d * 1.4) {
    const body = Math.min(w * 0.55, d * 1.3) / 2;
    const out: SymbolPrim[] = [rect(-W, -D, W, D, 'thin', Math.min(0.02, d * 0.05)), rect(-body, -D, body, D, 'outline', Math.min(0.04, d * 0.08))];
    for (const x of between(-body, body, Math.max(2, Math.floor((2 * body) / 0.06)))) out.push(line(x, -D + d * 0.15, x, D - d * 0.12, 'thin'));
    out.push(line(-body * 0.5, -D + Math.min(0.01, d * 0.02), body * 0.5, -D + Math.min(0.01, d * 0.02)));
    return out;
  }
  const r = (Math.min(w, d) / 2) * 0.9;
  const out: SymbolPrim[] = [circle(0, 0, r, 'outline')];
  for (const y of between(-r, r, Math.max(2, Math.floor((2 * r) / 0.07)))) {
    const c = chordAtY(0, 0, r * 0.82, y);
    if (c) out.push(line(c[0], y, c[1], y, 'thin'));
  }
  // The handle at the front.
  const hw = Math.min(0.12, r * 0.5);
  out.push(line(-hw / 2, -D + Math.min(0.01, d * 0.02), hw / 2, -D + Math.min(0.01, d * 0.02), 'line'));
  return out;
}

function box(w: number, d: number): SymbolPrim[] {
  const W = w / 2;
  const D = d / 2;
  return [rect(-W, -D, W, D, 'outline'), line(-W, -D, W, D, 'thin'), line(-W, D, W, -D, 'thin')];
}

/**
 * The symbol's primitives for an item of the given catalogue id and size (metres, local frame: see the header).
 * Sizes below 1 cm are treated as 1 cm, so nothing degenerates.
 */
export function symbolPrims(catalogId: string, w: number, d: number): SymbolPrim[] {
  const sw = Math.max(0.01, Number.isFinite(w) ? w : 0.01);
  const sd = Math.max(0.01, Number.isFinite(d) ? d : 0.01);
  return fitInside(rawPrims(catalogId, sw, sd), sw, sd, symbolOverflow(catalogId, sw, sd));
}

/** Scale the primitives about the centre (per axis) so that they stay within the footprint plus `over`. */
function fitInside(prims: SymbolPrim[], w: number, d: number, over: number): SymbolPrim[] {
  const b = primsBounds(prims);
  if (!b) return prims;
  const hx = w / 2 + over;
  const hy = d / 2 + over;
  const ex = Math.max(-b.min[0], b.max[0]);
  const ey = Math.max(-b.min[1], b.max[1]);
  const sx = ex > hx + 1e-12 ? hx / ex : 1;
  const sy = ey > hy + 1e-12 ? hy / ey : 1;
  if (sx === 1 && sy === 1) return prims;
  const m = Math.min(sx, sy);
  const pt = (p: Vec2): Vec2 => [p[0] * sx, p[1] * sy];
  return prims.map((p): SymbolPrim => {
    switch (p.k) {
      case 'rect':
        return { ...p, x: p.x * sx, y: p.y * sy, w: p.w * sx, h: p.h * sy, ...(p.r ? { r: p.r * m } : {}) };
      case 'circle':
        return { ...p, cx: p.cx * sx, cy: p.cy * sy, r: p.r * m };
      case 'ellipse':
        return { ...p, cx: p.cx * sx, cy: p.cy * sy, rx: p.rx * sx, ry: p.ry * sy };
      case 'line':
        return { ...p, a: pt(p.a), b: pt(p.b) };
      case 'poly':
        return { ...p, pts: p.pts.map(pt) };
    }
  });
}

function rawPrims(catalogId: string, sw: number, sd: number): SymbolPrim[] {
  const def = symbolFor(catalogId);
  switch (def.kind) {
    case 'bed':
      return bed(sw, sd, def.count ?? 2);
    case 'bunk':
      return bunk(sw, sd);
    case 'nightstand':
      return nightstand(sw, sd);
    case 'wardrobe':
      return wardrobe(sw, sd);
    case 'drawers':
      return drawers(sw, sd);
    case 'sofa':
      return sofa(sw, sd, def.count ?? 0);
    case 'cornerSofa':
      return cornerSofa(sw, sd, catalogItem(catalogId)?.seat ?? 0.9);
    case 'armchair':
      return armchair(sw, sd);
    case 'coffeeTable':
      return coffeeTable(sw, sd);
    case 'rug':
      return rug(sw, sd);
    case 'tvBench':
      return tvBench(sw, sd);
    case 'bookcase':
      return bookcase(sw, sd);
    case 'stove':
      return stove(sw, sd);
    case 'baseCabinet':
      return baseCabinet(sw, sd);
    case 'wallCabinet':
      return wallCabinet(sw, sd);
    case 'tallCabinet':
      return tallCabinet(sw, sd);
    case 'fridge':
      return fridge(sw, sd);
    case 'island':
      return island(sw, sd);
    case 'diningTable':
      return diningTable(sw, sd);
    case 'chair':
      return chair(sw, sd);
    case 'toilet':
      return toilet(sw, sd);
    case 'sink':
      return sink(sw, sd);
    case 'shower':
      return shower(sw, sd);
    case 'showerScreen':
      return showerScreen(sw, sd);
    case 'bathtub':
      return bathtub(sw, sd);
    case 'washer':
      return washer(sw, sd, false);
    case 'dryer':
      return washer(sw, sd, true);
    case 'washerTower':
      return washerTower(sw, sd);
    case 'towelRail':
      return towelRail(sw, sd);
    case 'drain':
      return drain(sw, sd);
    case 'waterHeater':
      return waterHeater(sw, sd);
    case 'saunaBench':
      return saunaBench(sw, sd);
    case 'saunaStove':
      return saunaStove(sw, sd);
    case 'shelf':
      return shelf(sw, sd);
    case 'shoeRack':
      return shoeRack(sw, sd);
    case 'bench':
      return bench(sw, sd);
    case 'skiRack':
      return skiRack(sw, sd);
    case 'logStack':
      return logStack(sw, sd);
    case 'lounge':
      return lounge(sw, sd, def.count ?? 2);
    case 'outdoorTable':
      return outdoorTable(sw, sd);
    case 'outdoorChair':
      return outdoorChair(sw, sd);
    case 'grill':
      return grill(sw, sd);
    default:
      return box(sw, sd);
  }
}

/** How far (m) the symbol may reach outside the footprint: nowhere (dining tables no longer draw chairs). */
export function symbolOverflow(_catalogId: string, _w: number, _d: number): number {
  return 0;
}

/** Bounding box of a primitive list (local frame), or null when empty. */
export function primsBounds(prims: readonly SymbolPrim[]): { min: Vec2; max: Vec2 } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const p of prims) {
    switch (p.k) {
      case 'rect':
        add(p.x, p.y);
        add(p.x + p.w, p.y + p.h);
        break;
      case 'circle':
        add(p.cx - p.r, p.cy - p.r);
        add(p.cx + p.r, p.cy + p.r);
        break;
      case 'ellipse':
        add(p.cx - p.rx, p.cy - p.ry);
        add(p.cx + p.rx, p.cy + p.ry);
        break;
      case 'line':
        add(p.a[0], p.a[1]);
        add(p.b[0], p.b[1]);
        break;
      case 'poly':
        for (const q of p.pts) add(q[0], q[1]);
        break;
    }
  }
  return Number.isFinite(x0) ? { min: [x0, y0], max: [x1, y1] } : null;
}
