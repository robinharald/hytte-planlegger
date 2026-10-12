/**
 * Parametric 3D furniture models (docs/phase2-plan.md §4, phase 2b). Pure: no React, no WebGL — plain part lists
 * and MeshData (geometryBuilders.ts), so every model is unit-testable.
 *
 * Every catalogue id maps to a model (`CATALOG_MODELS`); a model is a list of solid parts in the ITEM's local frame,
 * built for the item's stored size (FurnitureItem.size), in the look of the old three.js model (forrige-modell-v16
 * .html): its bed() (wooden frame, mattress, duvet in one of three colours), toilet() (white porcelain bowl + tank),
 * chair() (wooden seat on four legs), kitchen counters with a dark worktop, sofa blocks, the black stove with its flue,
 * sauna benches and sauna stove (black body, grey stones), the bathtub with a water surface, the log stack with the
 * logs texture, the water heater cylinder. Its `F` colour table is materials.ts FURNITURE_PALETTE.
 *
 * Local frame (plan units, metres): x along the item's width w, y along its depth d, z up; the origin is the centre
 * of the footprint on the item's bottom, so a model fills x ∈ [−w/2, w/2], y ∈ [−d/2, d/2], z ∈ [0, h].
 *  - FRONT is local −y (FURNITURE_FRONT): seats, doors, drawers, the toilet bowl, washer doors and the stove door face
 *    −y; backs, headboards, tanks, shower heads and the flue sit at +y (the side that goes against a wall). The old
 *    model's toilet() used the same frame (tank at +y).
 *  - The item is placed by `furnitureTransform`: rotated by rotationDeg (CCW in plan, as derive's furnitureFootprint)
 *    about its position, its bottom at DerivedFurniture.z (floorZ + the catalogue elevation).
 *  - Every model reaches the size box on all six sides (within 5 %, tested) and stays inside it, except parts marked
 *    `extra`: the vedovn flue (to FLUE_TOP when the stored height is the stove body alone) and the servant tap,
 *    which only rise above h inside the footprint.
 *
 * Parts: axis-aligned boxes, vertical prisms over any plan ring (with holes: bathtub, basin), and profiles extruded
 * along local x or y (washer doors, the grill lid). Each part has a material slot (FURNITURE_SLOTS; the material
 * array is materials.ts getFurnitureMaterials) or 'glass' (shower walls: a separate transparent mesh that casts no
 * shadow). `emitFurnitureModel` merges all parts of an item into one solid MeshData (one material group per used
 * slot) plus one glass MeshData, so an item is one or two meshes and one draw call per material: merged rather than
 * instanced, because picking and the selection highlight (Scene.tsx) work per mesh. Parts above a clip height (the
 * interior mode's cut plane, in local z) are cut there.
 *
 * Colour: an item's `colour` ('#rrggbb' from the catalogue's swatches, '#rgb' or a palette slot name) replaces the
 * materials of its model's `colourSlots` (duvets, sofa fabric, cabinet fronts and carcass, wooden furniture);
 * unknown values are ignored.
 *
 * The catalogue (furniture/catalog.ts) uses the same frame (back at +y) and names a model key per entry; ids it adds
 * later are drawn through `MODEL_KEYS` from that key (DerivedFurniture.catalog.model), and the corner sofa reads its
 * `seat` from the entry.
 *
 * Unknown catalogue ids (and models the catalogue names but this file lacks) fall back to the placeholder box (pine).
 */
import { levelAt } from '../geometry/levels';
import type { DerivedFurniture, DerivedVariant } from '../model/derived';
import type { Id, Vec2, Vec3 } from '../model/types';
import { toWorldTuple } from './coords';
import type { DropHit } from './drop';
import { appendPolygon, appendPrism, appendQuad, createMeshData, signedArea2 } from './geometryBuilders';
import type { MeshData } from './geometryBuilders';

// ---------------------------------------------------------------------------
// Slots, ids, conventions
// ---------------------------------------------------------------------------

/** Material slots of the solid furniture mesh, in material-array order (materials.ts FURNITURE_PALETTE). */
export const FURNITURE_SLOTS = [
  'wood',
  'pine',
  'dark',
  'mattress',
  'duvetA',
  'duvetB',
  'duvetC',
  'counter',
  'top',
  'sofa',
  'porcelain',
  'black',
  'rug',
  'metal',
  'water',
  'sauna',
  'logs',
  'fire',
] as const;
export type FurnitureSlot = (typeof FURNITURE_SLOTS)[number];
/** A part's slot: a solid material slot or the separate glass mesh. */
export type FurniturePartSlot = FurnitureSlot | 'glass';

/** Slot name → material index. */
export const FURNITURE_MAT = Object.fromEntries(FURNITURE_SLOTS.map((s, i) => [s, i])) as Record<FurnitureSlot, number>;

/** The side of the local frame an item faces: −y (see the header). */
export const FURNITURE_FRONT: Vec2 = [0, -1];

/** Every catalogue id (append-only, docs/workflows/phase2b; phase 2b catalogue). */
export const FURNITURE_CATALOG_IDS = [
  'seng-90',
  'seng-120',
  'seng-150',
  'seng-180',
  'koyeseng',
  'nattbord',
  'garderobeskap',
  'kommode',
  'sofa-2',
  'sofa-3',
  'hjornesofa',
  'lenestol',
  'salongbord',
  'teppe',
  'tv-benk',
  'bokhylle',
  'vedovn',
  'benkeskap',
  'overskap',
  'hoyskap',
  'kjoleskap',
  'kjokkenoy',
  'spisebord-4',
  'spisebord-6',
  'spisebord-8',
  'stol',
  'toalett',
  'servant',
  'dusj-80',
  'dusj-90',
  'dusj-100',
  'dusjvegg',
  'badekar',
  'vaskemaskin',
  'torketrommel',
  'vaskesoyle',
  'handkletorker',
  'sluk',
  'varmtvannsbereder',
  'badstubenk',
  'badstuovn',
  'hylle',
  'skohylle',
  'benk',
  'skistativ',
  'vedstabel',
  'loungesofa',
  'utebord',
  'utestol',
  'grill',
] as const;

/** Top of the vedovn flue above the item's bottom (m) when the stored height is the stove body alone (old model: TOP − FLOOR). */
export const FLUE_TOP = 2.2;
/** A stored vedovn height from which the height is taken to include the flue. */
export const STOVE_WITH_FLUE_MIN_H = 1.5;
/** Parts thinner than this (m) after clipping are dropped. */
const MIN_PART = 0.002;

export interface FurnitureSize {
  w: number;
  d: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

export type FurniturePart =
  | { kind: 'box'; min: Vec3; max: Vec3; slot: FurniturePartSlot; extra?: boolean }
  | {
      kind: 'prism';
      /** Plan ring in the local frame (any winding). */
      ring: Vec2[];
      holes?: Vec2[][];
      z0: number;
      z1: number;
      slot: FurniturePartSlot;
      /** Slot per side edge a→b (default `slot`). */
      sideSlot?: (a: Vec2, b: Vec2) => FurniturePartSlot;
      /** Default `slot`; null = no cap. */
      topSlot?: FurniturePartSlot | null;
      bottomSlot?: FurniturePartSlot | null;
      extra?: boolean;
    }
  | {
      kind: 'extrude';
      /** Local axis of the extrusion. */
      axis: 'x' | 'y';
      /** Profile in the perpendicular vertical plane: (y, z) for axis x, (x, z) for axis y; any winding. */
      profile: Vec2[];
      a0: number;
      a1: number;
      slot: FurniturePartSlot;
      extra?: boolean;
    };

function box(slot: FurniturePartSlot, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, extra = false): FurniturePart {
  const p: FurniturePart = {
    kind: 'box',
    min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    slot,
  };
  if (extra) p.extra = true;
  return p;
}

function prism(slot: FurniturePartSlot, ring: Vec2[], z0: number, z1: number, more: Partial<Extract<FurniturePart, { kind: 'prism' }>> = {}): FurniturePart {
  return { kind: 'prism', ring, z0, z1, slot, ...more };
}

/** n-gon approximating an ellipse, first vertex at angle 0 (n divisible by 4 → exact extents ±rx, ±ry). */
export function ellipseRing(cx: number, cy: number, rx: number, ry: number, n = 24): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return out;
}

/** Rectangle with rounded corners (radius clamped to the half sides), CCW. */
export function roundedRect(x0: number, x1: number, y0: number, y1: number, r: number, steps = 4): Vec2[] {
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  if (rr < 1e-6) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const corners: [number, number, number][] = [
    [x1 - rr, y0 + rr, -Math.PI / 2],
    [x1 - rr, y1 - rr, 0],
    [x0 + rr, y1 - rr, Math.PI / 2],
    [x0 + rr, y0 + rr, Math.PI],
  ];
  const out: Vec2[] = [];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (k / steps) * (Math.PI / 2);
      out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  }
  return out;
}

/** Four square posts of side t in the corners of the rectangle [x0, x1] × [y0, y1]. */
function posts(slot: FurniturePartSlot, x0: number, x1: number, y0: number, y1: number, t: number, z0: number, z1: number): FurniturePart[] {
  return [
    box(slot, x0, x0 + t, y0, y0 + t, z0, z1),
    box(slot, x1 - t, x1, y0, y0 + t, z0, z1),
    box(slot, x0, x0 + t, y1 - t, y1, z0, z1),
    box(slot, x1 - t, x1, y1 - t, y1, z0, z1),
  ];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Mirrors a part in the plane x = y (swaps local x and y). Boxes and prisms only (beds use it). */
function swapXY(p: FurniturePart): FurniturePart {
  if (p.kind === 'box') return { ...p, min: [p.min[1], p.min[0], p.min[2]], max: [p.max[1], p.max[0], p.max[2]] };
  if (p.kind === 'prism') return { ...p, ring: p.ring.map(([x, y]): Vec2 => [y, x]), holes: p.holes?.map((h) => h.map(([x, y]): Vec2 => [y, x])) };
  return { ...p, axis: p.axis === 'x' ? 'y' : 'x' };
}

/** Front panels (doors / drawers) in a grid on the front face, with handles; see `cabinetFronts`. */
interface FrontsOptions {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  cols: number;
  rows: number;
  /** y of the panels' back face (the carcass front). */
  backY: number;
  slot: FurniturePartSlot;
  /** Where each panel's handle goes; null = no handles. */
  handle: 'top' | 'bottom' | 'centre' | 'inner' | null;
  /** Per-row heights as fractions (bottom first), default equal. */
  rowFractions?: number[];
}

/** Panel thickness and handle depth (m). */
const FRONT_T = 0.018;
const HANDLE_T = 0.012;
const FRONT_GAP = 0.004;

function cabinetFronts(o: FrontsOptions): FurniturePart[] {
  const parts: FurniturePart[] = [];
  const fy1 = o.backY;
  const fy0 = fy1 - FRONT_T;
  const hy0 = fy0 - HANDLE_T;
  const fractions = o.rowFractions ?? Array.from({ length: o.rows }, () => 1 / o.rows);
  const colW = (o.x1 - o.x0) / o.cols;
  let zr = o.z0;
  fractions.forEach((f, r) => {
    const zA = zr;
    const zB = r === fractions.length - 1 ? o.z1 : zr + (o.z1 - o.z0) * f;
    zr = zB;
    for (let c = 0; c < o.cols; c++) {
      const xa = o.x0 + c * colW + FRONT_GAP / 2;
      const xb = o.x0 + (c + 1) * colW - FRONT_GAP / 2;
      const za = zA + FRONT_GAP / 2;
      const zb = zB - FRONT_GAP / 2;
      if (xb - xa < 0.01 || zb - za < 0.01) continue;
      parts.push(box(o.slot, xa, xb, fy0, fy1, za, zb));
      if (!o.handle) continue;
      const pw = xb - xa;
      const ph = zb - za;
      if (o.handle === 'inner' || (o.handle === 'centre' && ph > 0.5)) {
        // vertical bar near the edge towards the cabinet's centre (single doors: the edge at +x)
        const mid = (o.x0 + o.x1) / 2;
        const atLeft = o.cols > 1 && (xa + xb) / 2 > mid;
        const hx = atLeft ? xa + Math.min(0.05, pw * 0.15) : xb - Math.min(0.05, pw * 0.15);
        const hl = Math.min(0.18, ph * 0.3);
        const hz = o.handle === 'centre' ? (za + zb) / 2 : clamp(1.0, za + hl / 2 + 0.02, zb - hl / 2 - 0.02);
        parts.push(box('metal', hx - 0.006, hx + 0.006, hy0, fy0, hz - hl / 2, hz + hl / 2));
      } else {
        const hw = Math.min(0.14, pw * 0.5);
        const hz = o.handle === 'top' ? zb - Math.min(0.05, ph * 0.25) : o.handle === 'bottom' ? za + Math.min(0.05, ph * 0.25) : (za + zb) / 2;
        const cx = (xa + xb) / 2;
        parts.push(box('metal', cx - hw / 2, cx + hw / 2, hy0, fy0, hz - 0.006, hz + 0.006));
      }
    }
  });
  return parts;
}

/** Depth of the fronts (panels + handles) in front of a carcass. */
const FRONTS_DEPTH = FRONT_T + HANDLE_T;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

interface Ctx {
  w: number;
  d: number;
  h: number;
  /** Half width / half depth. */
  W: number;
  D: number;
}

export type ModelOptions = {
  duvet?: FurnitureSlot;
  /** Seats of a sofa (default: from the width). */
  seats?: number;
  laundry?: 'washer' | 'dryer' | 'stack';
  /** Corner sofa: depth of the back strip and width of the chaise (the catalogue's `seat`, default 0.9). */
  seat?: number;
};

type Builder = (c: Ctx, o: ModelOptions) => FurniturePart[];

function bed(c: Ctx, o: ModelOptions): FurniturePart[] {
  // built with the length along y and the head at +y; turned when the item is wider than deep
  const swap = c.w > c.d;
  const X = (swap ? c.d : c.w) / 2;
  const Y = (swap ? c.w : c.d) / 2;
  const h = c.h;
  const k = Math.min(1, h / 0.6);
  const fz = 0.3 * k;
  const mz = 0.45 * k;
  const dz = 0.52 * k;
  const hb = Math.min(0.06, 0.05 * Y * 2);
  const inset = Math.min(0.03, X * 0.1);
  const pz = Math.min(0.5, 0.28 * Y * 2);
  const parts: FurniturePart[] = [
    box('wood', -X, X, -Y, Y - hb, 0, fz),
    box('wood', -X, X, Y - hb, Y, 0, h),
    box('mattress', -X + inset, X - inset, -Y + inset, Y - hb, fz, mz),
    box(o.duvet ?? 'duvetA', -X + inset * 0.6, X - inset * 0.6, -Y + inset * 0.6, Y - hb - pz, mz, dz),
  ];
  const py0 = Y - hb - pz + 0.06;
  const py1 = Y - hb - 0.05;
  const ptop = Math.min(h, mz + 0.11 * k);
  const inner = 2 * (X - inset) - 0.06;
  if (py1 - py0 > 0.05 && inner > 0.1) {
    const n = inner > 1.0 ? 2 : 1;
    const pw = (inner - (n - 1) * 0.04) / n;
    for (let i = 0; i < n; i++) {
      const x0 = -X + inset + 0.03 + i * (pw + 0.04);
      parts.push(box('mattress', x0, x0 + pw, py0, py1, mz, ptop));
    }
  }
  return swap ? parts.map(swapXY) : parts;
}

function bunkBed(c: Ctx, o: ModelOptions): FurniturePart[] {
  const swap = c.w > c.d;
  const X = (swap ? c.d : c.w) / 2;
  const Y = (swap ? c.w : c.d) / 2;
  const h = c.h;
  const k = h / 1.7;
  const t = Math.min(0.06, X * 0.12);
  const inset = Math.min(0.03, X * 0.1);
  const level = (z: number, duvet: FurnitureSlot): FurniturePart[] => [
    box('wood', -X + t, X - t, -Y + t, Y - t, z, z + 0.15 * k),
    box('mattress', -X + t + inset, X - t - inset, -Y + t + inset, Y - t - inset, z + 0.15 * k, z + 0.3 * k),
    box(duvet, -X + t + inset * 0.6, X - t - inset * 0.6, -Y + t + inset * 0.6, Y - t - Math.min(0.5, 0.28 * Y * 2), z + 0.3 * k, z + 0.37 * k),
  ];
  const upper = 1.1 * k;
  const parts: FurniturePart[] = [
    ...posts('wood', -X, X, -Y, Y, t, 0, h),
    ...level(0.15 * k, o.duvet ?? 'duvetA'),
    ...level(upper, 'duvetC'),
    // guard board on the +x long side of the upper bunk
    box('wood', X - 0.025, X, -Y + t, Y - t, upper + 0.3 * k, Math.min(h, upper + 0.55 * k)),
  ];
  // ladder at the foot end (−y), towards +x
  const lx0 = Math.max(-X + t, X - t - 0.42);
  const lx1 = X - t;
  parts.push(box('wood', lx0, lx0 + 0.035, -Y, -Y + 0.035, 0, upper + 0.3 * k));
  for (let z = 0.55 * k; z < upper; z += 0.28 * k) parts.push(box('wood', lx0, lx1, -Y, -Y + 0.03, z, z + 0.03));
  return swap ? parts.map(swapXY) : parts;
}

function nightstand(c: Ctx): FurniturePart[] {
  const { W, D, h } = c;
  const tt = Math.min(0.025, 0.05 * h);
  const backY = -D + FRONTS_DEPTH;
  return [
    box('wood', -W + 0.005, W - 0.005, backY, D, 0, h - tt),
    box('wood', -W, W, -D + HANDLE_T, D, h - tt, h),
    ...cabinetFronts({ x0: -W + 0.01, x1: W - 0.01, z0: 0.04, z1: h - tt - 0.004, cols: 1, rows: 2, backY, slot: 'pine', handle: 'centre' }),
  ];
}

function chestOfDrawers(c: Ctx): FurniturePart[] {
  const { W, D, h, w } = c;
  const tt = Math.min(0.025, 0.04 * h);
  const ph = Math.min(0.06, 0.08 * h);
  const backY = -D + FRONTS_DEPTH;
  const rows = clamp(Math.round((h - ph) / 0.2), 2, 6);
  return [
    box('dark', -W + 0.03, W - 0.03, backY + 0.03, D - 0.02, 0, ph),
    box('wood', -W + 0.005, W - 0.005, backY, D, ph, h - tt),
    box('wood', -W, W, -D + HANDLE_T, D, h - tt, h),
    ...cabinetFronts({ x0: -W + 0.01, x1: W - 0.01, z0: ph, z1: h - tt - 0.003, cols: w > 1.1 ? 2 : 1, rows, backY, slot: 'pine', handle: 'centre' }),
  ];
}

function wardrobe(c: Ctx): FurniturePart[] {
  const { W, D, h, w } = c;
  const ph = Math.min(0.08, 0.05 * h);
  const backY = -D + FRONTS_DEPTH;
  return [
    box('wood', -W, W, backY, D, 0, h),
    ...cabinetFronts({ x0: -W + 0.01, x1: W - 0.01, z0: ph, z1: h - 0.01, cols: Math.max(1, Math.round(w / 0.5)), rows: 1, backY, slot: 'pine', handle: 'inner' }),
  ];
}

function sofa(c: Ctx, o: ModelOptions): FurniturePart[] {
  const { W, D, h, w, d } = c;
  const k = h / 0.8;
  const legH = 0.06 * k;
  const at = clamp(0.12 * w, 0.08, 0.18);
  const bt = clamp(0.22 * d, 0.12, 0.22);
  const seatZ = 0.36 * k;
  const cushZ = 0.45 * k;
  const armZ = Math.min(h, 0.62 * k);
  const seats = Math.max(1, Math.round(o.seats ?? (w - 2 * at) / 0.7));
  const parts: FurniturePart[] = [
    ...posts('black', -W + 0.03, W - 0.03, -D + 0.03, D - 0.03, 0.04, 0, legH),
    box('sofa', -W, W, D - bt, D, legH, h),
    box('sofa', -W, -W + at, -D, D - bt, legH, armZ),
    box('sofa', W - at, W, -D, D - bt, legH, armZ),
    box('sofa', -W + at, W - at, -D, D - bt, legH, seatZ),
  ];
  const sw = (2 * (W - at) - (seats - 1) * 0.012) / seats;
  for (let i = 0; i < seats; i++) {
    const x0 = -W + at + i * (sw + 0.012);
    parts.push(box('sofa', x0, x0 + sw, -D + 0.01, D - bt, seatZ, cushZ));
    parts.push(box('sofa', x0 + 0.01, x0 + sw - 0.01, D - bt - Math.min(0.12, 0.15 * d), D - bt, cushZ, Math.min(h - 0.03, 0.74 * k)));
  }
  return parts;
}

/** Default depth of a corner sofa's back strip and width of its chaise (furniture/catalog.ts `seat`). */
export const CORNER_SOFA_SEAT = 0.9;

/**
 * Corner sofa, the catalogue's 'l' outline (furniture/catalog.ts localParts): a back strip of depth `seat` over the
 * whole width and a chaise of width `seat` at the local +x end down to the front; the corner −x/−y stays free (a
 * coffee table may stand there). A seat that fills the width or the depth gives a plain sofa.
 */
function cornerSofa(c: Ctx, o: ModelOptions): FurniturePart[] {
  const { W, D, h, w, d } = c;
  const sd = Math.min(o.seat ?? CORNER_SOFA_SEAT, w, d);
  if (!(sd < d - 1e-9 && sd < w - 1e-9)) return sofa(c, {});
  const k = h / 0.8;
  const legH = 0.06 * k;
  const bt = clamp(0.22 * sd, 0.12, 0.22);
  const at = clamp(0.12 * sd, 0.08, 0.18);
  const seatZ = 0.36 * k;
  const cushZ = 0.45 * k;
  const armZ = Math.min(h, 0.62 * k);
  const ys = D - sd; // front edge of the back strip
  const xc = W - sd; // inner edge of the chaise
  const leg = (x: number, y: number) => box('black', x - 0.02, x + 0.02, y - 0.02, y + 0.02, 0, legH);
  const parts: FurniturePart[] = [
    leg(-W + 0.05, ys + 0.05),
    leg(-W + 0.05, D - 0.05),
    leg(W - 0.05, D - 0.05),
    leg(W - 0.05, -D + 0.05),
    leg(xc + 0.05, -D + 0.05),
    // backs along +y and along +x
    box('sofa', -W, W, D - bt, D, legH, h),
    box('sofa', W - bt, W, -D, D - bt, legH, h),
    // arms at the two free ends
    box('sofa', -W, -W + at, ys, D - bt, legH, armZ),
    box('sofa', xc, W - bt, -D, -D + at, legH, armZ),
    // seat bases
    box('sofa', -W + at, W - bt, ys, D - bt, legH, seatZ),
    box('sofa', xc, W - bt, -D + at, ys, legH, seatZ),
  ];
  // cushions: the strip in seats of about 0.7 m up to the chaise, the chaise as one long cushion
  const runEnd = xc - 0.006;
  const n = Math.max(1, Math.round((runEnd - (-W + at)) / 0.7));
  const cw = (runEnd - (-W + at) - (n - 1) * 0.012) / n;
  for (let i = 0; i < n; i++) {
    const x0 = -W + at + i * (cw + 0.012);
    parts.push(box('sofa', x0, x0 + cw, ys + 0.01, D - bt, seatZ, cushZ));
    parts.push(box('sofa', x0 + 0.01, x0 + cw - 0.01, D - bt - Math.min(0.12, 0.15 * sd), D - bt, cushZ, Math.min(h - 0.03, 0.74 * k)));
  }
  parts.push(box('sofa', xc, W - bt, -D + at, D - bt, seatZ, cushZ));
  parts.push(box('sofa', W - bt - Math.min(0.12, 0.15 * sd), W - bt, -D + at + 0.01, D - bt - Math.min(0.12, 0.15 * sd), cushZ, Math.min(h - 0.03, 0.74 * k)));
  return parts;
}

function coffeeTable(c: Ctx): FurniturePart[] {
  const { W, D, h } = c;
  const tt = Math.min(0.04, 0.1 * h);
  const t = Math.min(0.05, 0.1 * Math.min(c.w, c.d));
  const i = Math.min(0.04, 0.1 * Math.min(c.w, c.d));
  return [
    box('wood', -W, W, -D, D, h - tt, h),
    ...posts('wood', -W + i, W - i, -D + i, D - i, t, 0, h - tt),
    box('wood', -W + i + t, W - i - t, -D + i + t * 0.5, D - i - t * 0.5, 0.15 * h, 0.15 * h + Math.min(0.02, 0.05 * h)),
  ];
}

function rug(c: Ctx): FurniturePart[] {
  return [box('rug', -c.W, c.W, -c.D, c.D, 0, c.h)];
}

function tvBench(c: Ctx): FurniturePart[] {
  const { W, D, h, w } = c;
  const legH = 0.12 * h;
  const backY = -D + FRONTS_DEPTH;
  return [
    ...posts('black', -W + 0.03, W - 0.03, backY + 0.02, D - 0.03, 0.035, 0, legH),
    box('dark', -W, W, backY, D, legH, h),
    ...cabinetFronts({ x0: -W + 0.01, x1: W - 0.01, z0: legH + 0.01, z1: h - 0.01, cols: Math.max(2, Math.round(w / 0.6)), rows: 1, backY, slot: 'wood', handle: 'top' }),
  ];
}

/** Books on a shelf: deterministic widths/heights/colours (no randomness: identical items build identical meshes). */
const BOOK_SLOTS: FurnitureSlot[] = ['duvetA', 'duvetB', 'duvetC', 'top', 'counter', 'sofa', 'wood', 'duvetB', 'rug'];

function books(x0: number, x1: number, y0: number, y1: number, z: number, maxH: number, seed: number): FurniturePart[] {
  const parts: FurniturePart[] = [];
  const end = x0 + (x1 - x0) * 0.78;
  let x = x0 + 0.01;
  let i = seed;
  while (x < end) {
    const bw = 0.025 + ((i * 7) % 5) * 0.006;
    const bh = maxH * (0.62 + ((i * 3) % 4) * 0.08);
    if (x + bw > end) break;
    parts.push(box(BOOK_SLOTS[i % BOOK_SLOTS.length], x, x + bw, y0, y1, z, z + bh));
    x += bw + 0.002;
    i++;
  }
  return parts;
}

function bookcase(c: Ctx): FurniturePart[] {
  const { W, D, h } = c;
  const t = Math.min(0.02, 0.05 * c.w);
  const levels = Math.max(2, Math.round(h / 0.36));
  const sp = (h - 2 * t) / levels;
  const parts: FurniturePart[] = [
    box('wood', -W, -W + t, -D, D, 0, h),
    box('wood', W - t, W, -D, D, 0, h),
    box('wood', -W + t, W - t, -D, D, h - t, h),
    box('wood', -W + t, W - t, -D, D, 0, t + 0.05),
    box('dark', -W + t, W - t, D - 0.01, D, t + 0.05, h - t),
  ];
  for (let i = 1; i < levels; i++) {
    const z = t + i * sp;
    parts.push(box('wood', -W + t, W - t, -D + 0.01, D - 0.01, z - t, z));
  }
  for (let i = 0; i < levels; i++) {
    const z = i === 0 ? t + 0.05 : t + i * sp;
    parts.push(...books(-W + t, W - t, -D + Math.max(0.03, 0.2 * c.d), D - 0.012, z, Math.max(0.05, sp - t - 0.04), i * 5));
  }
  return parts;
}

function octagon(cx: number, cy: number, r: number): Vec2[] {
  return ellipseRing(cx, cy, r, r, 8);
}

function woodStove(c: Ctx): FurniturePart[] {
  const { W, D, h, w, d } = c;
  const withFlue = h >= STOVE_WITH_FLUE_MIN_H;
  const bh = withFlue ? Math.min(1.0, 0.55 * h) : h;
  const legH = 0.12 * bh;
  const r = Math.min(0.075, 0.2 * Math.min(w, d));
  const flueY = D - Math.max(r + 0.04, 0.3 * d);
  const parts: FurniturePart[] = [
    ...posts('black', -W + 0.03, W - 0.03, -D + 0.04, D - 0.03, 0.04, 0, legH),
    box('black', -W + 0.01, W - 0.01, -D + 0.012, D, legH, bh - 0.03),
    box('black', -W, W, -D + 0.008, D, bh - 0.03, bh),
  ];
  // door: a frame of four bars around a recessed window with the fire behind it
  const fx0 = -0.36 * w;
  const fx1 = 0.36 * w;
  const wx = 0.28 * w;
  const fz0 = legH + 0.12 * bh;
  const fz1 = legH + 0.68 * bh;
  const wz0 = legH + 0.18 * bh;
  const wz1 = legH + 0.62 * bh;
  parts.push(
    box('black', fx0, fx1, -D, -D + 0.012, fz0, wz0),
    box('black', fx0, fx1, -D, -D + 0.012, wz1, fz1),
    box('black', fx0, -wx, -D, -D + 0.012, wz0, wz1),
    box('black', wx, fx1, -D, -D + 0.012, wz0, wz1),
    box('fire', -wx, wx, -D + 0.005, -D + 0.012, wz0, wz1),
  );
  const flueTop = withFlue ? h : Math.max(h, FLUE_TOP);
  if (flueTop - bh > MIN_PART) parts.push(prism('black', octagon(0, flueY, r), bh, flueTop, { extra: !withFlue }));
  return parts;
}

function baseCabinet(c: Ctx): FurniturePart[] {
  const { W, D, h, w } = c;
  const ph = Math.min(0.1, 0.12 * h);
  const tt = Math.min(0.04, 0.06 * h);
  const backY = -D + 0.02 + FRONTS_DEPTH;
  return [
    box('black', -W + 0.005, W - 0.005, backY + 0.04, D - 0.02, 0, ph),
    box('counter', -W + 0.002, W - 0.002, backY, D, ph, h - tt),
    box('top', -W, W, -D, D, h - tt, h),
    ...cabinetFronts({ x0: -W + 0.004, x1: W - 0.004, z0: ph, z1: h - tt - 0.002, cols: Math.max(1, Math.round(w / 0.6)), rows: 1, backY, slot: 'counter', handle: 'top' }),
  ];
}

function wallCabinet(c: Ctx): FurniturePart[] {
  const { W, D, h, w } = c;
  const backY = -D + FRONTS_DEPTH;
  return [
    box('counter', -W, W, backY, D, 0, h),
    ...cabinetFronts({ x0: -W + 0.004, x1: W - 0.004, z0: 0, z1: h, cols: Math.max(1, Math.round(w / 0.6)), rows: 1, backY, slot: 'counter', handle: 'bottom' }),
  ];
}

function tallCabinet(c: Ctx): FurniturePart[] {
  const { W, D, h, w } = c;
  const ph = Math.min(0.1, 0.05 * h);
  const backY = -D + FRONTS_DEPTH;
  return [
    box('black', -W + 0.005, W - 0.005, backY + 0.04, D - 0.02, 0, ph),
    box('counter', -W, W, backY, D, ph, h),
    ...cabinetFronts({ x0: -W + 0.004, x1: W - 0.004, z0: ph, z1: h - 0.002, cols: Math.max(1, Math.round(w / 0.6)), rows: 2, rowFractions: [0.42, 0.58], backY, slot: 'counter', handle: 'inner' }),
  ];
}

function fridge(c: Ctx): FurniturePart[] {
  const { W, D, h, w } = c;
  const ph = Math.min(0.06, 0.04 * h);
  const backY = -D + FRONTS_DEPTH;
  const tall = h > 1.2;
  return [
    box('black', -W + 0.01, W - 0.01, backY + 0.03, D - 0.02, 0, ph),
    box('counter', -W, W, backY, D, ph, h),
    ...cabinetFronts({
      x0: -W + 0.003,
      x1: W - 0.003,
      z0: ph,
      z1: h - 0.002,
      cols: w > 0.85 ? 2 : 1,
      rows: tall ? 2 : 1,
      rowFractions: tall ? [0.36, 0.64] : undefined,
      backY,
      slot: 'porcelain',
      handle: 'inner',
    }),
  ];
}

function kitchenIsland(c: Ctx): FurniturePart[] {
  const { W, D, h, w, d } = c;
  const ph = Math.min(0.1, 0.12 * h);
  const tt = Math.min(0.04, 0.06 * h);
  const ov = Math.min(0.3, 0.3 * d);
  const backY = -D + 0.02 + FRONTS_DEPTH;
  const cx0 = -W + Math.min(0.02, 0.05 * w);
  const cx1 = -cx0;
  return [
    box('black', cx0 + 0.04, cx1 - 0.04, backY + 0.04, D - ov - 0.04, 0, ph),
    box('counter', cx0, cx1, backY, D - ov, ph, h - tt),
    box('top', -W, W, -D, D, h - tt, h),
    ...cabinetFronts({ x0: cx0 + 0.003, x1: cx1 - 0.003, z0: ph, z1: h - tt - 0.002, cols: Math.max(1, Math.round((cx1 - cx0) / 0.6)), rows: 1, backY, slot: 'counter', handle: 'top' }),
  ];
}

function diningTable(c: Ctx): FurniturePart[] {
  const { W, D, h, w, d } = c;
  const tt = Math.min(0.05, 0.07 * h);
  const t = clamp(0.08 * Math.min(w, d), 0.03, 0.07);
  const i = Math.min(0.06, 0.08 * Math.min(w, d));
  const ah = Math.min(0.08, 0.1 * h);
  const parts: FurniturePart[] = [box('wood', -W, W, -D, D, h - tt, h), ...posts('wood', -W + i, W - i, -D + i, D - i, t, 0, h - tt)];
  // aprons between the legs
  const az0 = h - tt - ah;
  parts.push(box('wood', -W + i + t, W - i - t, -D + i + t * 0.3, -D + i + t * 0.6, az0, h - tt));
  parts.push(box('wood', -W + i + t, W - i - t, D - i - t * 0.6, D - i - t * 0.3, az0, h - tt));
  parts.push(box('wood', -W + i + t * 0.3, -W + i + t * 0.6, -D + i + t, D - i - t, az0, h - tt));
  parts.push(box('wood', W - i - t * 0.6, W - i - t * 0.3, -D + i + t, D - i - t, az0, h - tt));
  return parts;
}

function chair(c: Ctx): FurniturePart[] {
  const { W, D, h, w } = c;
  const k = h / 0.9;
  const seatTop = Math.min(h - 0.05, 0.47 * k);
  const st = Math.min(0.05, 0.1 * seatTop);
  const t = Math.min(0.04, 0.1 * w);
  const i = Math.min(0.02, 0.05 * w);
  const backY0 = D - t;
  return [
    box('wood', -W, W, -D, D, seatTop - st, seatTop),
    ...posts('wood', -W + i, W - i, -D + i, D, t, 0, seatTop - st),
    // back posts continue the back legs; top rail and a middle slat
    box('wood', -W + i, -W + i + t, backY0, D, seatTop, h),
    box('wood', W - i - t, W - i, backY0, D, seatTop, h),
    box('wood', -W + i + t, W - i - t, backY0 + t * 0.2, D - t * 0.2, h - Math.min(0.12, 0.3 * (h - seatTop)), h),
    box('wood', -W + i + t, W - i - t, backY0 + t * 0.3, D - t * 0.3, seatTop + 0.35 * (h - seatTop), seatTop + 0.42 * (h - seatTop)),
  ];
}

function toilet(c: Ctx): FurniturePart[] {
  const { W, D, h, d } = c;
  const td = 0.33 * d;
  const by0 = -D;
  const by1 = D - td;
  const cy = (by0 + by1) / 2;
  const ry = (by1 - by0) / 2;
  return [
    box('porcelain', -W, W, D - td, D, 0.25 * h, h - 0.006),
    box('porcelain', -0.55 * W, 0.55 * W, D - td, D - 0.02, 0, 0.25 * h),
    prism('porcelain', ellipseRing(0, cy + 0.15 * ry, 0.55 * W, 0.7 * ry), 0, 0.3 * h),
    prism('porcelain', ellipseRing(0, cy, 0.9 * W, ry), 0.3 * h, 0.5 * h),
    prism('porcelain', ellipseRing(0, cy, 0.86 * W, 0.95 * ry), 0.5 * h, 0.525 * h),
    box('metal', -0.03, 0.03, D - td / 2 - 0.02, D - td / 2 + 0.02, h - 0.012, h),
  ];
}

function basin(c: Ctx): FurniturePart[] {
  const { W, D, h, w, d } = c;
  const st = Math.min(0.06, 0.08 * h);
  const rim = Math.min(0.06, 0.12 * Math.min(w, d));
  const hole = roundedRect(-W + rim, W - rim, -D + rim, D - Math.max(rim, 0.12 * d), 0.06);
  const cabTop = h - st;
  const backY = -D + 0.03 + FRONTS_DEPTH;
  const tapY = D - Math.max(rim, 0.12 * d) / 2;
  return [
    prism('porcelain', [[-W, -D], [W, -D], [W, D], [-W, D]], cabTop, h, { holes: [hole] }),
    prism('porcelain', hole, Math.max(0, h - 0.16), h - Math.min(0.05, 0.6 * st)),
    box('counter', -W + 0.01, W - 0.01, backY, D, 0, cabTop),
    ...cabinetFronts({ x0: -W + 0.014, x1: W - 0.014, z0: 0.03, z1: cabTop - 0.004, cols: w > 0.8 ? 2 : 1, rows: 1, backY, slot: 'counter', handle: 'top' }),
    // tap (rises above the rim: extra)
    box('metal', -0.014, 0.014, tapY - 0.014, tapY + 0.014, h, h + 0.15, true),
    box('metal', -0.012, 0.012, tapY - 0.12, tapY, h + 0.12, h + 0.15, true),
  ];
}

function shower(c: Ctx): FurniturePart[] {
  const { W, D, h } = c;
  const tz = Math.min(0.04, 0.03 * h);
  const g = 0.008;
  const p = 0.02;
  const headZ = 0.92 * h;
  return [
    box('porcelain', -W, W, -D, D, 0, tz),
    box('metal', -0.06, 0.06, -0.06, 0.06, tz, tz + 0.003),
    // glass on the front and the +x side, metal corner post and top rails
    box('glass', -W, W - p, -D, -D + g, tz, h - p),
    box('glass', W - g, W, -D + p, D, tz, h - p),
    box('metal', W - p, W, -D, -D + p, tz, h),
    box('metal', -W, W - p, -D, -D + p, h - p, h),
    box('metal', W - p, W, -D + p, D, h - p, h),
    // riser, head and mixer on the back wall
    box('metal', -0.012, 0.012, D - 0.03, D - 0.006, 0.45 * h, headZ),
    box('metal', -0.1, 0.1, D - 0.26, D - 0.006, headZ - 0.025, headZ),
    box('metal', -0.08, 0.08, D - 0.06, D - 0.006, 0.5 * h, 0.5 * h + 0.03),
  ];
}

function showerScreen(c: Ctx): FurniturePart[] {
  const { W, D, h } = c;
  const g = Math.min(0.004, D);
  const p = Math.min(0.025, 0.1 * c.w);
  return [box('metal', -W, -W + p, -D, D, 0, h), box('glass', -W + p, W - 0.015, -g, g, 0, h - 0.01), box('metal', W - 0.015, W, -Math.min(0.01, D), Math.min(0.01, D), 0, h)];
}

function bathtub(c: Ctx): FurniturePart[] {
  const { W, D, h, w, d } = c;
  const rw = Math.min(0.07, 0.15 * Math.min(w, d));
  const zb = 0.3 * h;
  const r = Math.min(0.18, 0.3 * Math.min(w - 2 * rw, d - 2 * rw));
  const hole = roundedRect(-W + rw, W - rw, -D + rw, D - rw, r);
  const water = roundedRect(-W + rw + 0.003, W - rw - 0.003, -D + rw + 0.003, D - rw - 0.003, Math.max(0, r - 0.003));
  return [
    box('porcelain', -W, W, -D, D, 0, zb),
    prism('porcelain', [[-W, -D], [W, -D], [W, D], [-W, D]], zb, h, { holes: [hole], bottomSlot: null }),
    prism('water', water, zb, 0.72 * h, { bottomSlot: null }),
  ];
}

/** One washer or dryer between z0 and z1: white body, control strip, round door (metal ring, glass/dark centre). */
function laundryUnit(c: Ctx, z0: number, z1: number, kind: 'washer' | 'dryer'): FurniturePart[] {
  const { W, D, w } = c;
  const H = z1 - z0;
  const r = Math.min(0.3 * w, 0.3 * H);
  const cz = z0 + 0.45 * H;
  const ring = ellipseRing(0, cz, r, r, 24);
  const inner = ellipseRing(0, cz, 0.72 * r, 0.72 * r, 24);
  return [
    box('porcelain', -W, W, -D + 0.02, D, z0, z1),
    box('top', -W + 0.02, W - 0.02, -D + 0.012, -D + 0.02, z1 - 0.14 * H, z1 - 0.03 * H),
    { kind: 'extrude', axis: 'y', profile: ring, a0: -D + 0.006, a1: -D + 0.02, slot: 'metal' },
    { kind: 'extrude', axis: 'y', profile: inner, a0: -D, a1: -D + 0.006, slot: kind === 'washer' ? 'water' : 'black' },
  ];
}

function laundry(c: Ctx, o: ModelOptions): FurniturePart[] {
  if (o.laundry === 'stack') return [...laundryUnit(c, 0, c.h / 2, 'washer'), ...laundryUnit(c, c.h / 2, c.h, 'dryer')];
  return laundryUnit(c, 0, c.h, o.laundry === 'dryer' ? 'dryer' : 'washer');
}

function towelWarmer(c: Ctx): FurniturePart[] {
  const { W, D, h } = c;
  const r = Math.min(0.015, 0.2 * c.w, 0.3 * c.d);
  const ry = -D + r;
  const parts: FurniturePart[] = [prism('metal', octagon(-W + r, ry, r), 0, h), prism('metal', octagon(W - r, ry, r), 0, h)];
  const bt = Math.min(0.008, r * 0.6);
  for (let z = 0.08 * h; z < h - 0.03; z += 0.1) parts.push(box('metal', -W + r, W - r, ry - bt, ry + bt, z, z + 2 * bt));
  for (const z of [0.25 * h, 0.8 * h]) {
    parts.push(box('metal', -W + r - 0.006, -W + r + 0.006, ry, D, z, z + 0.012));
    parts.push(box('metal', W - r - 0.006, W - r + 0.006, ry, D, z, z + 0.012));
  }
  return parts;
}

function floorDrain(c: Ctx): FurniturePart[] {
  const { W, D, h } = c;
  const f = Math.min(0.012, 0.1 * Math.min(c.w, c.d));
  const zm = 0.5 * h;
  const parts: FurniturePart[] = [
    box('black', -W, W, -D, D, 0, zm),
    box('metal', -W, W, -D, -D + f, zm, h),
    box('metal', -W, W, D - f, D, zm, h),
    box('metal', -W, -W + f, -D + f, D - f, zm, h),
    box('metal', W - f, W, -D + f, D - f, zm, h),
  ];
  const n = 4;
  for (let i = 1; i <= n; i++) {
    const x = -W + (i * c.w) / (n + 1);
    parts.push(box('metal', x - f / 3, x + f / 3, -D + f, D - f, zm, h));
  }
  return parts;
}

function waterHeater(c: Ctx): FurniturePart[] {
  const { W, D, h } = c;
  const bodyTop = 0.95 * h;
  return [
    prism('porcelain', ellipseRing(0, 0, W, D, 24), 0, bodyTop),
    prism('porcelain', ellipseRing(0, 0, 0.9 * W, 0.9 * D, 24), bodyTop, 0.965 * h),
    prism('metal', octagon(-0.3 * W, 0, Math.min(0.015, 0.1 * W)), bodyTop, h),
    prism('metal', octagon(0.3 * W, 0, Math.min(0.015, 0.1 * W)), bodyTop, h),
  ];
}

/** One bench tier: front board, end boards and slats on top, between y0 (front) and y1, top at z. */
function benchTier(W: number, y0: number, y1: number, z: number): FurniturePart[] {
  const st = Math.min(0.03, 0.2 * z);
  const depth = y1 - y0;
  const n = Math.max(2, Math.round(depth / 0.095));
  const gap = 0.01;
  const sw = (depth - (n - 1) * gap) / n;
  const parts: FurniturePart[] = [
    box('sauna', -W, W, y0, y0 + 0.022, 0, z - st),
    box('sauna', -W, -W + 0.022, y0, y1, 0, z - st),
    box('sauna', W - 0.022, W, y0, y1, 0, z - st),
  ];
  for (let i = 0; i < n; i++) {
    const a = y0 + i * (sw + gap);
    parts.push(box('sauna', -W, W, a, a + sw, z - st, z));
  }
  return parts;
}

function saunaBench(c: Ctx): FurniturePart[] {
  const { W, D, h, d } = c;
  const yb = -D + clamp(0.45 * d, 0.2, 0.55);
  return [...benchTier(W, -D, yb, 0.47 * h), ...benchTier(W, yb, D, h)];
}

function saunaStove(c: Ctx): FurniturePart[] {
  const { W, D, h } = c;
  const bodyTop = 0.84 * h;
  const parts: FurniturePart[] = [box('black', -W, W, -D, D, 0, bodyTop)];
  const n = 3;
  const sx = (2 * (W - 0.03)) / n;
  const sy = (2 * (D - 0.03)) / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const top = i === 1 && j === 1 ? h : bodyTop + (h - bodyTop) * (0.55 + ((i * 2 + j) % 3) * 0.15);
      const x0 = -W + 0.03 + i * sx;
      const y0 = -D + 0.03 + j * sy;
      parts.push(box((i + j) % 2 === 0 ? 'metal' : 'top', x0 + 0.004, x0 + sx - 0.004, y0 + 0.004, y0 + sy - 0.004, bodyTop, top));
    }
  }
  return parts;
}

function shelving(c: Ctx): FurniturePart[] {
  const { W, D, h } = c;
  const t = Math.min(0.03, 0.1 * Math.min(c.w, c.d));
  const levels = Math.max(2, Math.round(h / 0.4));
  const parts: FurniturePart[] = [...posts('wood', -W, W, -D, D, t, 0, h)];
  const st = 0.02;
  const zs: number[] = [];
  for (let i = 0; i <= levels; i++) zs.push(i === 0 ? 0.08 : i === levels ? h : 0.08 + (i * (h - 0.08)) / levels);
  for (const z of zs) parts.push(box('pine', -W + t, W - t, -D, D, Math.max(0, z - st), z));
  // a few boxes and jars on the lower shelves
  zs.slice(0, -1).forEach((z, i) => {
    const sp = zs[i + 1] - st - z;
    if (sp < 0.12) return;
    const slots: FurnitureSlot[] = ['counter', 'top', 'duvetC', 'rug'];
    let x = -W + t + 0.03;
    for (let k = 0; k < 3 && x < W - t - 0.2; k++) {
      const bw = Math.min(0.28, 0.25 * c.w);
      parts.push(box(slots[(i + k) % slots.length], x, x + bw, -D + 0.04, D - 0.04, z, z + sp * (0.45 + 0.15 * ((i + k) % 3))));
      x += bw + 0.08;
    }
  });
  return parts;
}

function shoeRack(c: Ctx): FurniturePart[] {
  const { W, D, h } = c;
  const t = 0.02;
  const levels = Math.max(2, Math.round(h / 0.2));
  const parts: FurniturePart[] = [box('wood', -W, -W + t, -D, D, 0, h), box('wood', W - t, W, -D, D, 0, h)];
  for (let i = 0; i < levels; i++) {
    const z = i === levels - 1 ? h : 0.04 + (i * (h - 0.04)) / (levels - 1);
    parts.push(box('wood', -W + t, W - t, -D, D, Math.max(0, z - 0.018), z));
    if (i === levels - 1) break;
    const next = 0.04 + ((i + 1) * (h - 0.04)) / (levels - 1) - 0.018;
    const sh = Math.min(0.1, next - z - 0.01);
    if (sh < 0.03) continue;
    for (let x = -W + t + 0.02; x + 0.2 < W - t; x += 0.26) {
      const sd = Math.min(0.26, 2 * D - 0.02);
      parts.push(box(i % 2 ? 'dark' : 'black', x, x + 0.09, -D + 0.01, -D + 0.01 + sd, z, z + sh));
      parts.push(box(i % 2 ? 'dark' : 'black', x + 0.1, x + 0.19, -D + 0.01, -D + 0.01 + sd, z, z + sh));
    }
  }
  return parts;
}

function bench(c: Ctx): FurniturePart[] {
  const { W, D, h } = c;
  const tt = Math.min(0.04, 0.1 * h);
  const e = Math.min(0.06, 0.1 * c.w);
  return [
    box('wood', -W, W, -D, D, h - tt, h),
    box('wood', -W + e, -W + e + 0.04, -D + 0.03, D - 0.03, 0, h - tt),
    box('wood', W - e - 0.04, W - e, -D + 0.03, D - 0.03, 0, h - tt),
    box('wood', -W + e + 0.04, W - e - 0.04, -0.02, 0.02, 0.15 * h, 0.15 * h + 0.05),
  ];
}

function skiRack(c: Ctx): FurniturePart[] {
  const { W, D, h, w } = c;
  const bh = Math.min(0.06, 0.05 * h);
  const ry = D - 0.04;
  const parts: FurniturePart[] = [
    box('wood', -W, W, -D, D, 0, bh),
    box('wood', -W, -W + 0.04, ry, D, bh, 0.66 * h),
    box('wood', W - 0.04, W, ry, D, bh, 0.66 * h),
    box('wood', -W, W, ry, D, 0.6 * h, 0.66 * h),
  ];
  const slots: FurnitureSlot[] = ['duvetB', 'duvetA', 'black', 'duvetC', 'sofa'];
  const n = Math.max(1, Math.floor((w - 0.12) / 0.13));
  const yc = Math.max(-D + 0.02, ry - 0.04);
  for (let i = 0; i < n; i++) {
    const x = -W + 0.08 + i * 0.13;
    parts.push(box(slots[i % slots.length], x, x + 0.07, yc - 0.012, yc + 0.012, bh, h));
    if (x + 0.1 < W - 0.04) parts.push(prism('metal', octagon(x + 0.095, yc, 0.009), bh, 0.75 * h));
  }
  return parts;
}

function logStack(c: Ctx): FurniturePart[] {
  const { W, D, h } = c;
  // log ends (texture) on the faces along x (front and back), bark-dark ends and top
  const sideSlot = (a: Vec2, b: Vec2): FurniturePartSlot => (Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? 'logs' : 'dark');
  return [prism('dark', [[-W, -D], [W, -D], [W, D], [-W, D]], 0, h, { sideSlot, topSlot: 'dark', bottomSlot: null })];
}

function loungeSofa(c: Ctx): FurniturePart[] {
  const { W, D, h, d } = c;
  const k = h / 0.85;
  const fz = 0.42 * k;
  const bt = Math.min(0.15, 0.2 * d);
  return [
    box('wood', -W, W, -D, D, 0, fz),
    box('wood', -W, W, D - bt, D, fz, h),
    box('wood', -W, -W + 0.06, -D, D - bt, fz, Math.min(h, 0.6 * k)),
    box('wood', W - 0.06, W, -D, D - bt, fz, Math.min(h, 0.6 * k)),
    box('sofa', -W + 0.06, W - 0.06, -D + 0.04, D - bt, fz, Math.min(h, 0.52 * k)),
    box('sofa', -W + 0.07, W - 0.07, D - bt - Math.min(0.12, 0.15 * d), D - bt, Math.min(h, 0.52 * k), Math.min(h - 0.02, 0.8 * k)),
  ];
}

function outdoorTable(c: Ctx): FurniturePart[] {
  const { W, D, h, d } = c;
  const tt = Math.min(0.035, 0.07 * h);
  const n = Math.max(3, Math.round(d / 0.1));
  const gap = 0.01;
  const sw = (d - (n - 1) * gap) / n;
  const t = clamp(0.07 * Math.min(c.w, d), 0.03, 0.06);
  const i = Math.min(0.06, 0.1 * Math.min(c.w, d));
  const parts: FurniturePart[] = [...posts('wood', -W + i, W - i, -D + i, D - i, t, 0, h - tt)];
  for (let k = 0; k < n; k++) {
    const y = -D + k * (sw + gap);
    parts.push(box('wood', -W, W, y, y + sw, h - tt, h));
  }
  parts.push(box('wood', -W + i, W - i, -0.02, 0.02, h - tt - 0.05, h - tt));
  return parts;
}

function outdoorChair(c: Ctx): FurniturePart[] {
  const { W, D, h, w } = c;
  const k = h / 0.9;
  const sz = Math.min(h - 0.1, 0.42 * k);
  const t = Math.min(0.045, 0.08 * w);
  const parts: FurniturePart[] = [...posts('wood', -W + 0.04, W - 0.04, -D, D, t, 0, sz - 0.03)];
  const n = 4;
  const sw = (2 * D - 0.06 - (n - 1) * 0.01) / n;
  for (let i = 0; i < n; i++) {
    const y = -D + i * (sw + 0.01);
    parts.push(box('wood', -W + 0.04, W - 0.04, y, y + sw, sz - 0.03, sz));
  }
  // back: posts and horizontal slats at +y
  parts.push(box('wood', -W + 0.04, -W + 0.04 + t, D - 0.05, D, sz, h));
  parts.push(box('wood', W - 0.04 - t, W - 0.04, D - 0.05, D, sz, h));
  for (const f of [0.35, 0.6, 0.85]) {
    const z = sz + (h - sz) * f;
    parts.push(box('wood', -W + 0.04 + t, W - 0.04 - t, D - 0.04, D - 0.01, Math.min(z, h - 0.08), Math.min(z + 0.08, h)));
  }
  // armrests
  const az = Math.min(h - 0.02, sz + 0.22 * k);
  parts.push(box('wood', -W, -W + 0.05, -D, D, az, az + 0.025));
  parts.push(box('wood', W - 0.05, W, -D, D, az, az + 0.025));
  parts.push(box('wood', -W + 0.01, -W + 0.04, -D + 0.04, -D + 0.07, sz, az));
  parts.push(box('wood', W - 0.04, W - 0.01, -D + 0.04, -D + 0.07, sz, az));
  return parts;
}

/** Kettle grill (a square footprint, the catalogue's 'kule'): round bowl and domed lid on three legs. */
function kettleGrill(c: Ctx): FurniturePart[] {
  const { W, D, h } = c;
  const bz0 = 0.55 * h;
  const bz1 = 0.75 * h;
  const lr = Math.min(0.015, 0.05 * Math.min(W, D));
  const parts: FurniturePart[] = [];
  for (const a of [Math.PI / 2, (7 * Math.PI) / 6, (11 * Math.PI) / 6]) {
    parts.push(prism('metal', octagon(0.7 * W * Math.cos(a), 0.7 * D * Math.sin(a), lr), 0, bz0 + 0.02));
  }
  parts.push(prism('metal', ellipseRing(0, 0, 0.5 * W, 0.5 * D, 16), 0.2 * h, 0.2 * h + 0.012));
  parts.push(prism('black', ellipseRing(0, 0, 0.72 * W, 0.72 * D), bz0 - 0.06 * h, bz0));
  parts.push(prism('black', ellipseRing(0, 0, W, D), bz0, bz1));
  // domed lid in tiers, a handle on top
  const lid = h - 0.025 - bz1;
  const tiers: [number, number][] = [
    [0.97, 0.45],
    [0.85, 0.3],
    [0.6, 0.25],
  ];
  let z = bz1;
  for (const [r, f] of tiers) {
    parts.push(prism('black', ellipseRing(0, 0, r * W, r * D), z, z + f * lid));
    z += f * lid;
  }
  parts.push(box('metal', -0.08 * W, 0.08 * W, -0.25 * D, 0.25 * D, h - 0.025, h));
  return parts;
}

function grill(c: Ctx): FurniturePart[] {
  const { W, D, h, w, d } = c;
  if (Math.abs(w - d) < 0.15 * Math.max(w, d)) return kettleGrill(c);
  const fx = Math.min(0.32 * w, W - 0.02);
  const cz0 = 0.55 * h;
  const cz1 = 0.8 * h;
  const lidR = h - cz1;
  const lidProfile: Vec2[] = [];
  const ly = (D - 0.04 + -D + 0.06) / 2;
  const lry = (D - 0.04 - (-D + 0.06)) / 2;
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    lidProfile.push([ly + lry * Math.cos(a), cz1 + lidR * Math.sin(a)]);
  }
  return [
    ...posts('metal', -fx, fx, -D + 0.04, D - 0.03, 0.03, 0, cz0),
    box('metal', -fx + 0.03, fx - 0.03, -D + 0.06, D - 0.05, 0.15 * h, 0.15 * h + 0.015),
    box('black', -fx, fx, -D + 0.04, D, cz0, cz1),
    box('wood', -W, -fx, -D + 0.06, D - 0.06, cz1 - 0.035, cz1),
    box('wood', fx, W, -D + 0.06, D - 0.06, cz1 - 0.035, cz1),
    { kind: 'extrude', axis: 'x', profile: lidProfile, a0: -fx + 0.01, a1: fx - 0.01, slot: 'black' },
    box('metal', -0.6 * fx, 0.6 * fx, -D, -D + 0.022, cz1 + 0.35 * lidR, cz1 + 0.35 * lidR + 0.02),
    box('metal', -0.55 * fx, -0.55 * fx + 0.015, -D + 0.01, ly - lry + 0.02, cz1 + 0.3 * lidR, cz1 + 0.35 * lidR),
    box('metal', 0.55 * fx - 0.015, 0.55 * fx, -D + 0.01, ly - lry + 0.02, cz1 + 0.3 * lidR, cz1 + 0.35 * lidR),
  ];
}

/** The placeholder for unknown ids: the footprint × height in pine. */
function placeholder(c: Ctx): FurniturePart[] {
  return [box('pine', -c.W, c.W, -c.D, c.D, 0, c.h)];
}

/** Models by name; catalogue entries name one (`CATALOG_MODELS`, or the catalogue's own `model` for later ids). */
export const FURNITURE_MODELS = {
  bed,
  bunkBed,
  nightstand,
  chestOfDrawers,
  wardrobe,
  sofa,
  cornerSofa,
  coffeeTable,
  rug,
  tvBench,
  bookcase,
  woodStove,
  baseCabinet,
  wallCabinet,
  tallCabinet,
  fridge,
  kitchenIsland,
  diningTable,
  chair,
  toilet,
  basin,
  shower,
  showerScreen,
  bathtub,
  laundry,
  towelWarmer,
  floorDrain,
  waterHeater,
  saunaBench,
  saunaStove,
  shelving,
  shoeRack,
  bench,
  skiRack,
  logStack,
  loungeSofa,
  outdoorTable,
  outdoorChair,
  grill,
  placeholder,
} satisfies Record<string, Builder>;
export type FurnitureModelName = keyof typeof FURNITURE_MODELS;

export interface ModelSpec {
  model: FurnitureModelName;
  options?: ModelOptions;
  /**
   * Slots an item's `colour` replaces (empty: the model takes no colour). Matches the catalogue's swatches: duvets
   * (DUVETS), sofa fabric (TEXTILE), cabinet fronts and carcass (FRONTS), the whole piece of wooden furniture (WOOD).
   */
  colourSlots: FurnitureSlot[];
}

const NONE: FurnitureSlot[] = [];

/** The catalogue's model keys (furniture/catalog.ts `model`) → models: catalogue ids added later reuse these. */
export const MODEL_KEYS: Record<string, ModelSpec> = {
  bed: { model: 'bed', colourSlots: ['duvetA'] },
  bunk: { model: 'bunkBed', options: { duvet: 'duvetA' }, colourSlots: ['duvetA', 'duvetC'] },
  nightstand: { model: 'nightstand', colourSlots: ['wood', 'pine'] },
  wardrobe: { model: 'wardrobe', colourSlots: ['pine'] },
  chest: { model: 'chestOfDrawers', colourSlots: ['wood', 'pine'] },
  sofa: { model: 'sofa', colourSlots: ['sofa'] },
  'corner-sofa': { model: 'cornerSofa', colourSlots: ['sofa'] },
  armchair: { model: 'sofa', options: { seats: 1 }, colourSlots: ['sofa'] },
  'coffee-table': { model: 'coffeeTable', colourSlots: ['wood'] },
  rug: { model: 'rug', colourSlots: ['rug'] },
  'tv-bench': { model: 'tvBench', colourSlots: ['wood', 'dark'] },
  bookshelf: { model: 'bookcase', colourSlots: ['wood'] },
  stove: { model: 'woodStove', colourSlots: NONE },
  'base-cabinet': { model: 'baseCabinet', colourSlots: ['counter'] },
  'wall-cabinet': { model: 'wallCabinet', colourSlots: ['counter'] },
  'tall-cabinet': { model: 'tallCabinet', colourSlots: ['counter'] },
  fridge: { model: 'fridge', colourSlots: NONE },
  island: { model: 'kitchenIsland', colourSlots: ['counter'] },
  'dining-table': { model: 'diningTable', colourSlots: ['wood'] },
  chair: { model: 'chair', colourSlots: ['wood'] },
  toilet: { model: 'toilet', colourSlots: NONE },
  sink: { model: 'basin', colourSlots: ['counter'] },
  shower: { model: 'shower', colourSlots: NONE },
  'shower-screen': { model: 'showerScreen', colourSlots: NONE },
  bathtub: { model: 'bathtub', colourSlots: NONE },
  washer: { model: 'laundry', options: { laundry: 'washer' }, colourSlots: NONE },
  dryer: { model: 'laundry', options: { laundry: 'dryer' }, colourSlots: NONE },
  'washer-tower': { model: 'laundry', options: { laundry: 'stack' }, colourSlots: NONE },
  'towel-rail': { model: 'towelWarmer', colourSlots: NONE },
  drain: { model: 'floorDrain', colourSlots: NONE },
  'water-heater': { model: 'waterHeater', colourSlots: NONE },
  'sauna-bench': { model: 'saunaBench', colourSlots: NONE },
  'sauna-stove': { model: 'saunaStove', colourSlots: NONE },
  shelf: { model: 'shelving', colourSlots: ['wood', 'pine'] },
  'shoe-rack': { model: 'shoeRack', colourSlots: ['wood'] },
  bench: { model: 'bench', colourSlots: ['wood'] },
  'ski-rack': { model: 'skiRack', colourSlots: NONE },
  'log-stack': { model: 'logStack', colourSlots: NONE },
  'lounge-sofa': { model: 'loungeSofa', colourSlots: ['sofa'] },
  'outdoor-table': { model: 'outdoorTable', colourSlots: ['wood'] },
  'outdoor-chair': { model: 'outdoorChair', colourSlots: ['wood'] },
  grill: { model: 'grill', colourSlots: NONE },
};

const bedWith = (duvet: FurnitureSlot): ModelSpec => ({ model: 'bed', options: { duvet }, colourSlots: [duvet] });

/** The model of every catalogue id (the old model's duvet colours per bed; sofas by seat count). */
export const CATALOG_MODELS: Record<(typeof FURNITURE_CATALOG_IDS)[number], ModelSpec> = {
  'seng-90': bedWith('duvetC'),
  'seng-120': bedWith('duvetA'),
  'seng-150': bedWith('duvetB'),
  'seng-180': bedWith('duvetA'),
  koyeseng: MODEL_KEYS.bunk,
  nattbord: MODEL_KEYS.nightstand,
  garderobeskap: MODEL_KEYS.wardrobe,
  kommode: MODEL_KEYS.chest,
  'sofa-2': { model: 'sofa', options: { seats: 2 }, colourSlots: ['sofa'] },
  'sofa-3': { model: 'sofa', options: { seats: 3 }, colourSlots: ['sofa'] },
  hjornesofa: MODEL_KEYS['corner-sofa'],
  lenestol: MODEL_KEYS.armchair,
  salongbord: MODEL_KEYS['coffee-table'],
  teppe: MODEL_KEYS.rug,
  'tv-benk': MODEL_KEYS['tv-bench'],
  bokhylle: MODEL_KEYS.bookshelf,
  vedovn: MODEL_KEYS.stove,
  benkeskap: MODEL_KEYS['base-cabinet'],
  overskap: MODEL_KEYS['wall-cabinet'],
  hoyskap: MODEL_KEYS['tall-cabinet'],
  kjoleskap: MODEL_KEYS.fridge,
  kjokkenoy: MODEL_KEYS.island,
  'spisebord-4': MODEL_KEYS['dining-table'],
  'spisebord-6': MODEL_KEYS['dining-table'],
  'spisebord-8': MODEL_KEYS['dining-table'],
  stol: MODEL_KEYS.chair,
  toalett: MODEL_KEYS.toilet,
  servant: MODEL_KEYS.sink,
  'dusj-80': MODEL_KEYS.shower,
  'dusj-90': MODEL_KEYS.shower,
  'dusj-100': MODEL_KEYS.shower,
  dusjvegg: MODEL_KEYS['shower-screen'],
  badekar: MODEL_KEYS.bathtub,
  vaskemaskin: MODEL_KEYS.washer,
  torketrommel: MODEL_KEYS.dryer,
  vaskesoyle: MODEL_KEYS['washer-tower'],
  handkletorker: MODEL_KEYS['towel-rail'],
  sluk: MODEL_KEYS.drain,
  varmtvannsbereder: MODEL_KEYS['water-heater'],
  badstubenk: MODEL_KEYS['sauna-bench'],
  badstuovn: MODEL_KEYS['sauna-stove'],
  hylle: MODEL_KEYS.shelf,
  skohylle: MODEL_KEYS['shoe-rack'],
  benk: MODEL_KEYS.bench,
  skistativ: MODEL_KEYS['ski-rack'],
  vedstabel: MODEL_KEYS['log-stack'],
  loungesofa: MODEL_KEYS['lounge-sofa'],
  utebord: MODEL_KEYS['outdoor-table'],
  utestol: MODEL_KEYS['outdoor-chair'],
  grill: MODEL_KEYS.grill,
};

function isModelName(v: unknown): v is FurnitureModelName {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(FURNITURE_MODELS, v);
}

const PLACEHOLDER: ModelSpec = { model: 'placeholder', colourSlots: NONE };

/**
 * The model spec for a catalogue id: `CATALOG_MODELS`, else the catalogue's own `model` key (`MODEL_KEYS`, or one of
 * FURNITURE_MODELS by name; a string, or an object with `kind` / `name` / `builder`), else the placeholder box.
 */
export function modelSpecFor(catalogId: string, hint?: unknown): ModelSpec {
  const known = (CATALOG_MODELS as Record<string, ModelSpec | undefined>)[catalogId];
  if (known) return known;
  const name = modelHintName(hint);
  if (name !== undefined && Object.prototype.hasOwnProperty.call(MODEL_KEYS, name)) return MODEL_KEYS[name];
  if (isModelName(name)) return { model: name, colourSlots: NONE };
  return PLACEHOLDER;
}

/** The model name a catalogue `model` hint gives: a string, or an object's `kind` / `name` / `builder` string. */
export function modelHintName(hint: unknown): string | undefined {
  if (typeof hint === 'string') return hint;
  if (!hint || typeof hint !== 'object') return undefined;
  const h = hint as { kind?: unknown; name?: unknown; builder?: unknown };
  const v = h.kind ?? h.name ?? h.builder;
  return typeof v === 'string' ? v : undefined;
}

/** Model name hinted by a derived item's catalogue entry (`catalog.model`, read loosely: the field is optional). */
export function catalogModelHint(f: Pick<DerivedFurniture, 'catalog'>): string | undefined {
  return modelHintName((f.catalog as { model?: unknown } | null)?.model);
}

/** A corner sofa's `seat` from a derived item's catalogue entry (read loosely), when it is a positive number. */
export function catalogSeat(f: Pick<DerivedFurniture, 'catalog'>): number | undefined {
  const v = (f.catalog as { seat?: unknown } | null)?.seat;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

function safeSize(s: FurnitureSize | undefined | null): FurnitureSize {
  const ok = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fb);
  return { w: ok(s?.w, 1), d: ok(s?.d, 1), h: ok(s?.h, 1) };
}

export interface FurnitureModel {
  name: FurnitureModelName;
  size: FurnitureSize;
  parts: FurniturePart[];
  /** Slots the item's `colour` replaces. */
  colourSlots: FurnitureSlot[];
  /** Highest z of any part (extras included). */
  top: number;
}

/**
 * The parts of an item's model at its size (local frame, see the header). `hint` is the catalogue's `model` key (used
 * for ids this file does not list); `extra` adds catalogue data a model reads (the corner sofa's `seat`).
 */
export function furnitureModel(catalogId: string, size: FurnitureSize | undefined | null, hint?: unknown, extra: Pick<ModelOptions, 'seat'> = {}): FurnitureModel {
  const spec = modelSpecFor(catalogId, hint);
  const s = safeSize(size);
  const ctx: Ctx = { ...s, W: s.w / 2, D: s.d / 2 };
  const parts = FURNITURE_MODELS[spec.model](ctx, { ...spec.options, ...(extra.seat !== undefined ? { seat: extra.seat } : {}) });
  const b = partsBounds(parts, true);
  return { name: spec.model, size: s, parts, colourSlots: spec.colourSlots, top: Number.isFinite(b.max[2]) ? b.max[2] : s.h };
}

// ---------------------------------------------------------------------------
// Bounds, clipping, emission
// ---------------------------------------------------------------------------

function extrudePoint(axis: 'x' | 'y', a: number, p: Vec2): Vec3 {
  return axis === 'x' ? [a, p[0], p[1]] : [p[0], a, p[1]];
}

/** Bounds of the parts (local frame); `includeExtra` false leaves out the parts marked `extra`. */
export function partsBounds(parts: FurniturePart[], includeExtra = false): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const add = (p: Vec3) => {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  };
  for (const p of parts) {
    if (p.extra && !includeExtra) continue;
    if (p.kind === 'box') {
      add(p.min);
      add(p.max);
    } else if (p.kind === 'prism') {
      for (const q of p.ring) {
        add([q[0], q[1], p.z0]);
        add([q[0], q[1], p.z1]);
      }
    } else {
      for (const q of p.profile) {
        add(extrudePoint(p.axis, p.a0, q));
        add(extrudePoint(p.axis, p.a1, q));
      }
    }
  }
  return { min, max };
}

/** Clips a profile polygon (u, z) to z ≤ zMax (Sutherland–Hodgman against one half-plane). */
function clipProfile(profile: Vec2[], zMax: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i];
    const b = profile[(i + 1) % profile.length];
    const ina = a[1] <= zMax;
    const inb = b[1] <= zMax;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (zMax - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, zMax]);
    }
  }
  return out;
}

/** A part cut at local z = clip (null: unchanged), or null when nothing of it is left. */
export function clipPart(p: FurniturePart, clip: number | null): FurniturePart | null {
  if (clip === null) return p;
  if (p.kind === 'box') {
    if (p.max[2] <= clip) return p;
    if (clip - p.min[2] < MIN_PART) return null;
    return { ...p, max: [p.max[0], p.max[1], clip] };
  }
  if (p.kind === 'prism') {
    if (p.z1 <= clip) return p;
    if (clip - p.z0 < MIN_PART) return null;
    return { ...p, z1: clip };
  }
  const zs = p.profile.map((q) => q[1]);
  if (Math.max(...zs) <= clip) return p;
  if (clip - Math.min(...zs) < MIN_PART) return null;
  const profile = clipProfile(p.profile, clip);
  return profile.length >= 3 ? { ...p, profile } : null;
}

/** Appends a profile extruded along local x or y as a closed solid (outward normals). */
function appendExtrusion(d: MeshData, axis: 'x' | 'y', profileIn: Vec2[], a0In: number, a1In: number, slot: number): void {
  if (profileIn.length < 3 || Math.abs(signedArea2(profileIn)) < 1e-12 || Math.abs(a1In - a0In) < 1e-9) return;
  const profile = signedArea2(profileIn) < 0 ? [...profileIn].reverse() : profileIn; // CCW in (u, z)
  const a0 = Math.min(a0In, a1In);
  const a1 = Math.max(a0In, a1In);
  const P = (a: number, q: Vec2) => extrudePoint(axis, a, q);
  for (let i = 0; i < profile.length; i++) {
    const p = profile[i];
    const q = profile[(i + 1) % profile.length];
    // (u, z) CCW: for axis x (u = y) the outward winding runs a0→a1 along p→q; for axis y (u = x) the reverse
    if (axis === 'x') appendQuad(d, [P(a0, p), P(a0, q), P(a1, q), P(a1, p)], slot);
    else appendQuad(d, [P(a0, p), P(a1, p), P(a1, q), P(a0, q)], slot);
  }
  const ring0 = profile.map((q) => P(a0, q));
  const ring1 = profile.map((q) => P(a1, q));
  // a CCW (u, z) ring faces +x for axis x (y × z = x) and −y for axis y (x × z = −y)
  if (axis === 'x') {
    appendPolygon(d, ring0, [], slot, true);
    appendPolygon(d, ring1, [], slot);
  } else {
    appendPolygon(d, ring0, [], slot);
    appendPolygon(d, ring1, [], slot, true);
  }
}

function appendPart(solid: MeshData, glass: MeshData, p: FurniturePart): void {
  const target = p.slot === 'glass' ? glass : solid;
  const slotOf = (s: FurniturePartSlot) => (s === 'glass' ? 0 : FURNITURE_MAT[s]);
  const slot = slotOf(p.slot);
  if (p.kind === 'box') {
    if (p.max[0] - p.min[0] <= 1e-9 || p.max[1] - p.min[1] <= 1e-9 || p.max[2] - p.min[2] <= 1e-9) return;
    appendPrism(target, {
      ring: [
        [p.min[0], p.min[1]],
        [p.max[0], p.min[1]],
        [p.max[0], p.max[1]],
        [p.min[0], p.max[1]],
      ],
      bottomZ: p.min[2],
      topZ: p.max[2],
      topSlot: slot,
      bottomSlot: slot,
      sideSlot: slot,
    });
    return;
  }
  if (p.kind === 'prism') {
    if (p.z1 - p.z0 <= 1e-9) return;
    const side = p.sideSlot;
    appendPrism(target, {
      ring: p.ring,
      holes: p.holes,
      bottomZ: p.z0,
      topZ: p.z1,
      topSlot: p.topSlot === null ? null : slotOf(p.topSlot ?? p.slot),
      bottomSlot: p.bottomSlot === null ? null : slotOf(p.bottomSlot ?? p.slot),
      sideSlot: side ? (a, b) => slotOf(side(a, b)) : slot,
    });
    return;
  }
  appendExtrusion(target, p.axis, p.profile, p.a0, p.a1, slot);
}

export interface FurnitureMeshData {
  /** Solid parts, one index list per FURNITURE_SLOTS slot. */
  solid: MeshData;
  /** Glass parts (one slot). */
  glass: MeshData;
}

/** Merges a model's parts (cut at local z = clip; null = uncut) into a solid and a glass MeshData (local frame). */
export function emitFurnitureModel(model: Pick<FurnitureModel, 'parts'>, clip: number | null = null): FurnitureMeshData {
  const solid = createMeshData(FURNITURE_SLOTS.length);
  const glass = createMeshData(1);
  for (const p of model.parts) {
    const c = clipPart(p, clip);
    if (c) appendPart(solid, glass, c);
  }
  return { solid, glass };
}

/** Builds an item's model straight to MeshData (local frame). */
export function buildFurnitureModel(catalogId: string, size: FurnitureSize | undefined | null, clip: number | null = null, hint?: unknown): FurnitureMeshData {
  return emitFurnitureModel(furnitureModel(catalogId, size, hint), clip);
}

/**
 * Local clip height for an item whose bottom is at `z` under an absolute cut plane `cutZ` (null: none): null when the
 * cut misses the model (cutZ ≥ z + top), else cutZ − z rounded to the millimetre (≤ 0: nothing is left).
 */
export function furnitureClip(cutZ: number | null, z: number, top: number): number | null {
  if (cutZ === null) return null;
  const local = cutZ - z;
  if (local >= top - 1e-9) return null;
  return Math.max(0, Math.round(local * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export interface FurnitureTransform {
  /** World position of the local origin (centre of the footprint at the item's bottom). */
  position: [number, number, number];
  /** Rotation about world Y (radians) = rotationDeg: a CCW plan rotation (coords.ts: the map is a proper rotation). */
  rotationY: number;
}

/** Where the local frame of an item goes: its plan position at z, turned by rotationDeg (as derive's furnitureFootprint). */
export function furnitureTransform(f: Pick<DerivedFurniture, 'item' | 'z'>): FurnitureTransform {
  const [x, y] = f.item.position;
  const deg = Number.isFinite(f.item.rotationDeg) ? f.item.rotationDeg : 0;
  return { position: toWorldTuple(x, y, Number.isFinite(f.z) ? f.z : 0), rotationY: (deg * Math.PI) / 180 };
}

/** A local point of an item's model in the plan frame (the same map as furnitureTransform; for tests and tools). */
export function furnitureLocalToPlan(f: Pick<DerivedFurniture, 'item' | 'z'>, p: Vec3): Vec3 {
  const t = (f.item.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [f.item.position[0] + p[0] * c - p[1] * s, f.item.position[1] + p[0] * s + p[1] * c, f.z + p[2]];
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * An item's colour as a hex number: '#rrggbb' / 'rrggbb' / '#rgb', or a FURNITURE_SLOTS name (that slot's palette
 * colour, resolved by the caller through `palette`); null for anything else.
 */
export function parseFurnitureColour(colour: string | undefined | null, palette?: Partial<Record<FurnitureSlot, number>>): number | null {
  if (typeof colour !== 'string') return null;
  const s = colour.trim();
  const m6 = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m6) return parseInt(m6[1], 16);
  const m3 = /^#([0-9a-f]{3})$/i.exec(s);
  if (m3) {
    const [r, g, b] = m3[1].split('').map((ch) => parseInt(ch + ch, 16));
    return (r << 16) | (g << 8) | b;
  }
  const slot = palette && (FURNITURE_SLOTS as readonly string[]).includes(s) ? palette[s as FurnitureSlot] : undefined;
  return typeof slot === 'number' ? slot : null;
}

// ---------------------------------------------------------------------------
// 3D drop
// ---------------------------------------------------------------------------

/**
 * Level for a library item dropped in 3D (View3D `onDropFurniture(catalogId, planPoint, hit)` → editActions
 * `addFurniture(catalogId, planPoint, { levelId })`): a floor hit gives its own level; a deck or terrain hit gives
 * the ground storey's level there (`levelAt` on the storey holding the level closest to elevation 0, i.e. 'main').
 */
export function furnitureDropLevel(derived: Pick<DerivedVariant, 'storeys' | 'levels' | 'blocks'>, hit: Pick<DropHit, 'point' | 'surface' | 'levelId'>): Id {
  if (hit.surface === 'floor' && hit.levelId) return hit.levelId;
  let ground = derived.levels[0];
  for (const l of derived.levels) if (ground && Math.abs(l.elevation) < Math.abs(ground.elevation) - 1e-9) ground = l;
  const storey = ground ? derived.storeys.find((s) => s.levelIds.includes(ground.id)) : undefined;
  return storey ? levelAt(derived, storey.id, hit.point) : (ground?.id ?? 'main');
}
