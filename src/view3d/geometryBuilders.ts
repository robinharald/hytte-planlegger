/**
 * Pure geometry builders for the 3D view. No React, no WebGL — only plain arrays (plus three's ShapeUtils
 * triangulation and BufferGeometry, which both run in node), so everything here is unit-testable.
 *
 * All builders work in the PLAN frame (x, y, z above the main floor) and emit `MeshData`; `toBufferGeometry`
 * maps positions and normals to the world frame (X = x, Y = z, Z = −y) at the very end. That map is a proper
 * rotation, so winding and normals carry over unchanged.
 *
 * Conventions
 *  - Rings may come in either winding; builders normalise (outer CCW seen from the face's front, holes CW).
 *    Faces are flat-shaded (own vertices per face), normals point out of solids.
 *  - UVs are in metres: vertical faces (distance along the face, z); horizontal faces (x, y); roof slopes
 *    (along the eave, up the slope). Textures therefore carry `repeat = 1 / tile size`.
 *  - Material slots: each builder documents its slot indices (`WALL_MAT`, `ROOF_MAT`, ...). `toBufferGeometry`
 *    turns the slots into BufferGeometry groups with `materialIndex` = slot, so meshes take a material array.
 *  - Walls: a piece is split along its reference line into slices at opening jambs, top-profile breakpoints and
 *    cut-plane crossings. Each slice becomes sub-prisms (pier / sill / lintel) whose vertices take their top z
 *    from the profile at their own t (linearly extrapolated past the ends so mitred corners stay planar).
 *    Sub-prisms never overlap, so no coplanar faces fight.
 *  - Choices where the architecture doc is silent: room/threshold floors are lifted a few mm above the level
 *    (slabs are not) and their extrusion stops 1 cm short of the slab underside, so coincident floors never
 *    z-fight; railings are centred on the railing path; stair/step treads are solid blocks (as the old model's
 *    steps); exterior openings get a sage-green surround on the outer wall face (the old model's window trim).
 */
import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Uint16BufferAttribute, Uint32BufferAttribute, Vector2 } from 'three';
import type {
  DerivedDeck,
  DerivedFloor,
  DerivedFoundation,
  DerivedOpening,
  DerivedRailing,
  DerivedRoof,
  DerivedSteps,
  DerivedStructure,
  DerivedWall,
  RoofSlope,
} from '../model/derived';
import type { TerrainGrid, Vec2, Vec3 } from '../model/types';

export interface MeshData {
  /** Plan frame x, y, z. */
  positions: number[];
  normals: number[];
  uvs: number[];
  /** Triangle indices per material slot. */
  indices: number[][];
}

export const WALL_MAT = { outside: 0, inside: 1, reveal: 2, cap: 3 } as const;
export const ROOF_MAT = { turf: 0, underside: 1 } as const;
export const ROOF_TRIM_MAT = { trim: 0, cap: 1 } as const;
export const FLOOR_MAT = { top: 0, under: 1 } as const;
export const DECK_MAT = { top: 0, side: 1 } as const;
export const OPENING_MAT = { frame: 0, leaf: 1, trim: 2 } as const;
export const STRUCT_MAT = { wood: 0, chimney: 1, chimneyCap: 2 } as const;

const UP: Vec3 = [0, 0, 1];
/** Slices thinner than this (metres along the wall) are dropped. */
const MIN_SLICE = 0.001;
/** Prisms lower than this (metres) are dropped. */
const MIN_HEIGHT = 0.005;

/** Opening detail sizes (metres). */
export const OPENING_DIMS = { frame: 0.06, mullion: 0.04, leaf: 0.045, trimWidth: 0.07, trimDepth: 0.025 } as const;
/** Seam (m) between the two solid leaves of a double door. */
export const DOUBLE_LEAF_GAP = 0.006;
/** Railing detail sizes (metres). */
export const RAILING_DIMS = { post: 0.08, capWidth: 0.12, capHeight: 0.04, bottomRail: 0.05, slat: 0.09, slatGap: 0.035, slatDepth: 0.022 } as const;

// ---------------------------------------------------------------------------
// Small vector helpers (plan frame)
// ---------------------------------------------------------------------------

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function len3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
function norm3(a: Vec3): Vec3 {
  const l = len3(a);
  return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}
function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Newell normal (not normalised); zero for degenerate rings. */
function newell(pts: Vec3[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return [nx, ny, nz];
}

export function signedArea2(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

function ensureCCW2(poly: Vec2[]): Vec2[] {
  return signedArea2(poly) < 0 ? [...poly].reverse() : poly;
}
function ensureCW2(poly: Vec2[]): Vec2[] {
  return signedArea2(poly) > 0 ? [...poly].reverse() : poly;
}

/** Removes consecutive duplicate points (and a closing point equal to the first). */
function cleanRing<T extends number[]>(ring: T[], eps = 1e-9): T[] {
  const out: T[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || p.some((v, k) => Math.abs(v - last[k]) > eps)) out.push(p);
  }
  while (out.length > 1 && out[0].every((v, k) => Math.abs(v - out[out.length - 1][k]) <= eps)) out.pop();
  return out;
}

/**
 * Orthonormal frame (u, v) spanning the plane with normal n such that u × v = n. u is horizontal when
 * possible (so vertical faces get u along the face and v = up; horizontal faces get u = ±x, v = ±y).
 */
function planeFrame(n: Vec3): { u: Vec3; v: Vec3 } {
  let u = cross3(UP, n);
  if (len3(u) < 1e-9) u = [1, 0, 0];
  u = norm3(u);
  const v = norm3(cross3(n, u));
  return { u, v };
}

/** Unit horizontal vector perpendicular to the segment a→b (UP × dir); [1, 0, 0] for vertical segments. */
export function horizontalNormal(a: Vec3, b: Vec3): Vec3 {
  const h = cross3(UP, norm3(sub3(b, a)));
  return len3(h) < 1e-9 ? [1, 0, 0] : norm3(h);
}

// ---------------------------------------------------------------------------
// MeshData primitives
// ---------------------------------------------------------------------------

export function createMeshData(slots = 1): MeshData {
  const indices: number[][] = [];
  for (let i = 0; i < slots; i++) indices.push([]);
  return { positions: [], normals: [], uvs: [], indices };
}

function slotArray(d: MeshData, slot: number): number[] {
  while (d.indices.length <= slot) d.indices.push([]);
  return d.indices[slot];
}

function pushVertex(d: MeshData, p: Vec3, n: Vec3, uv: Vec2): number {
  const i = d.positions.length / 3;
  d.positions.push(p[0], p[1], p[2]);
  d.normals.push(n[0], n[1], n[2]);
  d.uvs.push(uv[0], uv[1]);
  return i;
}

export function vertexCount(d: MeshData): number {
  return d.positions.length / 3;
}

/**
 * Appends a planar polygon (with optional holes) as a flat-shaded face. The face points along the ring's own
 * Newell normal; `flip` reverses it (use for the bottom caps of prisms built from CCW-from-above rings).
 * Earcut (ShapeUtils) returns CCW triangles in the face's (u, v) frame whatever the input winding.
 */
export function appendPolygon(d: MeshData, ringIn: Vec3[], holesIn: Vec3[][], slot: number, flip = false): void {
  const ring = cleanRing(ringIn);
  if (ring.length < 3) return;
  let n = norm3(newell(ring));
  if (len3(n) < 1e-9) return;
  if (flip) n = scale3(n, -1);
  const holes = holesIn.map((h) => cleanRing(h)).filter((h) => h.length >= 3);
  const { u, v } = planeFrame(n);
  const to2 = (p: Vec3) => new Vector2(dot3(p, u), dot3(p, v));
  const tris = ShapeUtils.triangulateShape(ring.map(to2), holes.map((h) => h.map(to2)));
  if (!tris.length) return;
  const all = [ring, ...holes].flat();
  const base = vertexCount(d);
  for (const p of all) pushVertex(d, p, n, [dot3(p, u), dot3(p, v)]);
  const out = slotArray(d, slot);
  for (const [a, b, c] of tris) out.push(base + a, base + b, base + c);
}

/** Appends a quad given CCW as seen from the side it should face. Degenerate quads are skipped. */
export function appendQuad(d: MeshData, pts: [Vec3, Vec3, Vec3, Vec3], slot: number): void {
  const n = norm3(newell(pts));
  if (len3(n) < 1e-9) return;
  const { u, v } = planeFrame(n);
  const base = vertexCount(d);
  for (const p of pts) pushVertex(d, p, n, [dot3(p, u), dot3(p, v)]);
  slotArray(d, slot).push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export interface PrismOptions {
  /** Plan ring (any winding). */
  ring: Vec2[];
  holes?: Vec2[][];
  bottomZ: number | ((p: Vec2) => number);
  topZ: number | ((p: Vec2) => number);
  /** null = no cap. */
  topSlot: number | null;
  bottomSlot: number | null;
  /** Slot of the side quad on ring edge a→b (after normalisation to CCW / holes CW); null = no sides. */
  sideSlot: number | ((a: Vec2, b: Vec2) => number) | null;
}

/** Vertical prism over a plan ring with per-vertex bottom/top z (caps + one quad per ring edge). */
export function appendPrism(d: MeshData, o: PrismOptions): void {
  const cleaned = cleanRing(o.ring);
  if (cleaned.length < 3 || Math.abs(signedArea2(cleaned)) < 1e-12) return;
  const ring = ensureCCW2(cleaned);
  const holes = (o.holes ?? [])
    .map((h) => cleanRing(h))
    .filter((h) => h.length >= 3)
    .map(ensureCW2);
  const bz = typeof o.bottomZ === 'number' ? () => o.bottomZ as number : o.bottomZ;
  const tz = typeof o.topZ === 'number' ? () => o.topZ as number : o.topZ;
  const lift = (r: Vec2[], f: (p: Vec2) => number): Vec3[] => r.map((p) => [p[0], p[1], f(p)]);
  if (o.sideSlot !== null) {
    for (const r of [ring, ...holes]) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        const ta = tz(a);
        const tb = tz(b);
        const ba = bz(a);
        const bb = bz(b);
        if (ta - ba < 1e-9 && tb - bb < 1e-9) continue;
        const slot = typeof o.sideSlot === 'number' ? o.sideSlot : o.sideSlot(a, b);
        appendQuad(d, [[a[0], a[1], ta], [a[0], a[1], ba], [b[0], b[1], bb], [b[0], b[1], tb]], slot);
      }
    }
  }
  if (o.topSlot !== null) appendPolygon(d, lift(ring, tz), holes.map((h) => lift(h, tz)), o.topSlot);
  if (o.bottomSlot !== null) appendPolygon(d, lift(ring, bz), holes.map((h) => lift(h, bz)), o.bottomSlot, true);
}

/** Axis-aligned box in the plan frame. */
export function appendBox(d: MeshData, min: Vec3, max: Vec3, slot: number): void {
  if (max[0] - min[0] <= 1e-9 || max[1] - min[1] <= 1e-9 || max[2] - min[2] <= 1e-9) return;
  appendPrism(d, {
    ring: [[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]],
    bottomZ: min[2],
    topZ: max[2],
    topSlot: slot,
    bottomSlot: slot,
    sideSlot: slot,
  });
}

/** Box of `width` centred on the plan segment a→b, between z0 and z1. */
export function appendOrientedBox(d: MeshData, a: Vec2, b: Vec2, width: number, z0: number, z1: number, slot: number): void {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-9 || width <= 0 || z1 - z0 <= 1e-9) return;
  const dx = (b[0] - a[0]) / L;
  const dy = (b[1] - a[1]) / L;
  const nx = (-dy * width) / 2;
  const ny = (dx * width) / 2;
  appendPrism(d, {
    ring: [[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]],
    bottomZ: z0,
    topZ: z1,
    topSlot: slot,
    bottomSlot: slot,
    sideSlot: slot,
  });
}

/**
 * Box along an arbitrary 3D segment (roof trims, ridge cap): `width` horizontally across the segment (centre
 * shifted by `shift` along `horizontalNormal(a, b)`), `vLow..vHigh` along the segment's "up" axis (perpendicular
 * to the segment inside its vertical plane; plain up for horizontal segments).
 */
export function appendSegmentBox(d: MeshData, a: Vec3, b: Vec3, width: number, vLow: number, vHigh: number, slot: number, shift = 0): void {
  const dir = norm3(sub3(b, a));
  if (len3(dir) < 1e-9 || width <= 0 || vHigh - vLow <= 1e-9) return;
  const h = horizontalNormal(a, b);
  const v = norm3(cross3(dir, h));
  const hw = scale3(h, width / 2);
  const off = scale3(h, shift);
  const corner = (p: Vec3, sh: number, sv: number): Vec3 => add3(add3(add3(p, off), scale3(hw, sh)), scale3(v, sv));
  const bottom: Vec3[] = [corner(a, -1, vLow), corner(b, -1, vLow), corner(b, 1, vLow), corner(a, 1, vLow)];
  const top: Vec3[] = [corner(a, -1, vHigh), corner(b, -1, vHigh), corner(b, 1, vHigh), corner(a, 1, vHigh)];
  appendHexahedron(d, bottom, top, slot);
}

/** 8-corner solid: `bottom` ring CCW seen from the top side, `top` ring in the same order. */
export function appendHexahedron(d: MeshData, bottom: Vec3[], top: Vec3[], slot: number): void {
  appendPolygon(d, top, [], slot);
  appendPolygon(d, bottom, [], slot, true);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    appendQuad(d, [bottom[i], bottom[j], top[j], top[i]], slot);
  }
}

/** Swaps u and v of every vertex used by `slot` (rotates a stripe texture by 90°). */
export function swapUVs(d: MeshData, slot: number): void {
  const seen = new Set<number>();
  for (const i of d.indices[slot] ?? []) {
    if (seen.has(i)) continue;
    seen.add(i);
    const u = d.uvs[i * 2];
    d.uvs[i * 2] = d.uvs[i * 2 + 1];
    d.uvs[i * 2 + 1] = u;
  }
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

export interface WallPrism {
  kind: 'pier' | 'sill' | 'lintel';
  t0: number;
  t1: number;
  bottomZ: number;
  /** Top entirely on the cut plane → cap material. */
  capped: boolean;
  openingId?: string;
}

export interface WallBuild {
  data: MeshData;
  prisms: WallPrism[];
}

/** z of a piecewise-linear profile at t, linearly extrapolated beyond its ends. */
export function profileZAt(profile: { t: number; z: number }[], t: number, fallback = 0): number {
  if (profile.length === 0) return fallback;
  if (profile.length === 1) return profile[0].z;
  let i = 0;
  while (i < profile.length - 2 && t > profile[i + 1].t) i++;
  const p = profile[i];
  const q = profile[i + 1];
  const dt = q.t - p.t;
  if (Math.abs(dt) < 1e-12) return t <= p.t ? p.z : q.z;
  return p.z + ((t - p.t) / dt) * (q.z - p.z);
}

/** Sutherland–Hodgman clip of a plan polygon to t0 ≤ ((p − a)·dir)/L ≤ t1 (use ±Infinity for open ends). */
export function sliceFootprint(footprint: Vec2[], a: Vec2, dir: Vec2, L: number, t0: number, t1: number): Vec2[] {
  const tOf = (p: Vec2) => ((p[0] - a[0]) * dir[0] + (p[1] - a[1]) * dir[1]) / L;
  const clip = (poly: Vec2[], inside: (t: number) => boolean, tEdge: number): Vec2[] => {
    if (!Number.isFinite(tEdge)) return poly;
    const out: Vec2[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const tp = tOf(p);
      const tq = tOf(q);
      const pin = inside(tp);
      const qin = inside(tq);
      if (pin) out.push(p);
      if (pin !== qin) {
        const s = (tEdge - tp) / (tq - tp);
        out.push([p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s]);
      }
    }
    return out;
  };
  let poly = clip(footprint, (t) => t >= t0 - 1e-12, t0);
  poly = clip(poly, (t) => t <= t1 + 1e-12, t1);
  const cleaned = cleanRing(poly, 1e-7);
  return cleaned.length >= 3 && Math.abs(signedArea2(cleaned)) > 1e-10 ? cleaned : [];
}

interface OpeningRange {
  id: string;
  t0: number;
  t1: number;
  sillZ: number;
  headZ: number;
  fullHeight: boolean;
}

/**
 * Openings that cut the wall: not removed, inside the host, sorted by offset. Openings may share a stretch of the
 * wall when they are stacked (a high gable window above a bedroom window); every slice cuts all openings over it.
 */
function openingRanges(wall: DerivedWall, L: number): OpeningRange[] {
  const out: OpeningRange[] = [];
  const sorted = [...wall.openings].filter((o) => o.status !== 'removed' && o.width > 0).sort((p, q) => p.offset - q.offset);
  for (const o of sorted) {
    const t0 = Math.max(0, (o.offset - o.width / 2) / L);
    const t1 = Math.min(1, (o.offset + o.width / 2) / L);
    if (t1 - t0 <= 0) continue;
    out.push({ id: o.id, t0, t1, sillZ: o.sillZ, headZ: o.headZ, fullHeight: !!o.opening.fullHeight });
  }
  return out;
}

/** Sorted, de-duplicated slice boundaries in t: ends, opening jambs, profile breakpoints, cut crossings. */
export function wallSliceBoundaries(wall: DerivedWall, cutZ: number | null): number[] {
  const L = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  if (L < 1e-9) return [0, 1];
  const ts = new Set<number>([0, 1]);
  for (const o of openingRanges(wall, L)) {
    ts.add(o.t0);
    ts.add(o.t1);
  }
  const prof = wall.topProfile;
  for (const p of prof) if (p.t > 0 && p.t < 1) ts.add(p.t);
  if (cutZ !== null) {
    for (let i = 0; i < prof.length - 1; i++) {
      const p = prof[i];
      const q = prof[i + 1];
      if ((p.z - cutZ) * (q.z - cutZ) < 0) {
        const t = p.t + ((cutZ - p.z) / (q.z - p.z)) * (q.t - p.t);
        if (t > 0 && t < 1) ts.add(t);
      }
    }
  }
  const sorted = [...ts].sort((x, y) => x - y);
  const out: number[] = [];
  for (const t of sorted) {
    if (out.length === 0 || (t - out[out.length - 1]) * L >= MIN_SLICE) out.push(t);
    else if (t === 1) out[out.length - 1] = 1;
  }
  return out;
}

/**
 * Builds all sub-prisms of one wall piece. `cutZ` (absolute) clips the top for the interior cut mode; a wall
 * entirely below the cut plane is returned unchanged, one entirely above it is empty. Dividers give nothing.
 * Slots: WALL_MAT (outside = right face, inside = left face, reveal = ends/jambs, cap = cut tops; uncut tops and
 * bottoms use `inside`).
 */
export function buildWallPieces(wall: DerivedWall, cutZ: number | null = null): WallBuild {
  const data = createMeshData(4);
  const prisms: WallPrism[] = [];
  if (wall.isDivider || wall.footprint.length < 3) return { data, prisms };
  const L = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  if (L < 1e-9) return { data, prisms };
  if (cutZ !== null && cutZ <= wall.baseZ + MIN_HEIGHT) return { data, prisms };

  const dir: Vec2 = [(wall.b[0] - wall.a[0]) / L, (wall.b[1] - wall.a[1]) / L];
  const nLeft: Vec2 = [-dir[1], dir[0]];
  const tOf = (p: Vec2) => ((p[0] - wall.a[0]) * dir[0] + (p[1] - wall.a[1]) * dir[1]) / L;
  const profileAt = (t: number) => profileZAt(wall.topProfile, t, wall.topZ);
  const topAt = (t: number) => (cutZ === null ? profileAt(t) : Math.min(profileAt(t), cutZ));

  const sideSlot = (a: Vec2, b: Vec2): number => {
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const el = Math.hypot(ex, ey);
    if (el < 1e-12) return WALL_MAT.reveal;
    if (Math.abs(ex * dir[1] - ey * dir[0]) / el > 1e-4) return WALL_MAT.reveal;
    const mx = (a[0] + b[0]) / 2 - wall.a[0];
    const my = (a[1] + b[1]) / 2 - wall.a[1];
    return mx * nLeft[0] + my * nLeft[1] > 0 ? WALL_MAT.inside : WALL_MAT.outside;
  };

  const emit = (kind: WallPrism['kind'], t0: number, t1: number, poly: Vec2[], bottomZ: number, top: (p: Vec2) => number, openingId?: string) => {
    let maxH = -Infinity;
    for (const p of poly) maxH = Math.max(maxH, top(p) - bottomZ);
    if (maxH < MIN_HEIGHT) return;
    const tm = (t0 + t1) / 2;
    const capped = cutZ !== null && profileAt(tm) >= cutZ - 1e-6 && top(poly[0]) >= cutZ - 1e-6;
    appendPrism(data, {
      ring: poly,
      bottomZ,
      topZ: (p) => Math.max(top(p), bottomZ),
      topSlot: capped ? WALL_MAT.cap : WALL_MAT.inside,
      bottomSlot: WALL_MAT.inside,
      sideSlot,
    });
    prisms.push({ kind, t0, t1, bottomZ, capped, ...(openingId ? { openingId } : {}) });
  };

  const openings = openingRanges(wall, L);
  const bounds = wallSliceBoundaries(wall, cutZ);
  for (let i = 0; i < bounds.length - 1; i++) {
    const t0 = bounds[i];
    const t1 = bounds[i + 1];
    const poly = sliceFootprint(wall.footprint, wall.a, dir, L, i === 0 ? -Infinity : t0, i === bounds.length - 2 ? Infinity : t1);
    if (poly.length < 3) continue;
    const tm = (t0 + t1) / 2;
    const ops = openings.filter((o) => tm >= o.t0 - 1e-9 && tm <= o.t1 + 1e-9).sort((p, q) => p.sillZ - q.sillZ);
    const profTop = (p: Vec2) => topAt(tOf(p));
    if (ops.length === 0) {
      emit('pier', t0, t1, poly, wall.baseZ, profTop);
      continue;
    }
    // Bottom up: wall below the first sill, between stacked openings (head of one to the sill of the next), and
    // above the last head.
    let z = wall.baseZ;
    let last = ops[0];
    let open = false;
    for (const [k, op] of ops.entries()) {
      if (op.sillZ - z >= MIN_HEIGHT) {
        const sillTop = cutZ === null ? op.sillZ : Math.min(op.sillZ, cutZ);
        const top = k === 0 ? () => sillTop : (p: Vec2) => Math.min(sillTop, profTop(p));
        emit(k === 0 ? 'sill' : 'lintel', t0, t1, poly, z, top, k === 0 ? op.id : last.id);
      }
      last = op;
      if (op.fullHeight) {
        open = true;
        break;
      }
      z = Math.max(z, op.headZ);
    }
    if (!open && (cutZ === null || z < cutZ - MIN_HEIGHT)) {
      emit('lintel', t0, t1, poly, z, profTop, last.id);
    }
  }
  return { data, prisms };
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

export interface OpeningHostLine {
  a: Vec2;
  b: Vec2;
  faceLeft: number;
  faceRight: number;
  isExterior: boolean;
}

export interface OpeningBuild {
  /** Frame, mullions, door leaf, exterior surround (OPENING_MAT slots). */
  solid: MeshData;
  /** Glass planes (one slot; render double-sided, no shadow casting). */
  glass: MeshData;
}

/**
 * Frame boxes (frameDepth deep, centred on the glass plane), glass plane + mullion bars from `panes`, a closed
 * door leaf for solid leaves, and (exterior walls only) a surround on the outer face. Frameless openings
 * (type 'opening') give nothing. `cutZ` clips everything at the cut plane (head members are then omitted).
 * A double door (`swing2` present) gets two closed leaves of half the clear width: solid leaves meet with a
 * DOUBLE_LEAF_GAP seam; glazed leaves are split by a meeting stile (two frame widths) and each leaf gets the
 * `panes` grid.
 */
export function buildOpening(o: DerivedOpening, host: OpeningHostLine, cutZ: number | null = null): OpeningBuild {
  const solid = createMeshData(3);
  const glass = createMeshData(1);
  const out = { solid, glass };
  const L = Math.hypot(host.b[0] - host.a[0], host.b[1] - host.a[1]);
  if (L < 1e-9 || o.width <= 0 || o.status === 'removed' || o.type === 'opening') return out;
  if (o.leaf === 'none' && !o.glazed) return out;
  const head = cutZ === null ? o.headZ : Math.min(o.headZ, cutZ);
  const sill = o.sillZ;
  if (head - sill < MIN_HEIGHT) return out;
  const headCut = cutZ !== null && o.headZ > cutZ + 1e-9;

  const dir: Vec2 = [(host.b[0] - host.a[0]) / L, (host.b[1] - host.a[1]) / L];
  const nL: Vec2 = [-dir[1], dir[0]];
  const c: Vec2 = [host.a[0] + dir[0] * o.offset, host.a[1] + dir[1] * o.offset];
  const at = (s: number, w: number): Vec2 => [c[0] + dir[0] * s + nL[0] * w, c[1] + dir[1] * s + nL[1] * w];
  const P = (s: number, w: number, z: number): Vec3 => [...at(s, w), z];
  const box = (d: MeshData, slot: number, sA: number, sB: number, wA: number, wB: number, zA: number, zB: number) => {
    const z1 = cutZ === null ? zB : Math.min(zB, cutZ);
    if (sB - sA <= 1e-6 || Math.abs(wB - wA) <= 1e-6 || z1 - zA <= 1e-6) return;
    const w0 = Math.min(wA, wB);
    const w1 = Math.max(wA, wB);
    appendPrism(d, { ring: [at(sA, w0), at(sB, w0), at(sB, w1), at(sA, w1)], bottomZ: zA, topZ: z1, topSlot: slot, bottomSlot: slot, sideSlot: slot });
  };

  const W = o.width;
  const s0 = -W / 2;
  const s1 = W / 2;
  const gp = o.glassPlane;
  const fd = Math.max(0.02, o.frameDepth);
  const ft = Math.min(OPENING_DIMS.frame, W / 6, (o.headZ - o.sillZ) / 6);
  const isDoor = o.leaf !== 'none';

  // frame: jambs full height, head and sill members between them
  box(solid, OPENING_MAT.frame, s0, s0 + ft, gp - fd / 2, gp + fd / 2, sill, head);
  box(solid, OPENING_MAT.frame, s1 - ft, s1, gp - fd / 2, gp + fd / 2, sill, head);
  if (!headCut) box(solid, OPENING_MAT.frame, s0 + ft, s1 - ft, gp - fd / 2, gp + fd / 2, head - ft, head);
  if (!isDoor) box(solid, OPENING_MAT.frame, s0 + ft, s1 - ft, gp - fd / 2, gp + fd / 2, sill, sill + ft);

  const iS0 = s0 + ft;
  const iS1 = s1 - ft;
  const iZ0 = isDoor ? sill : sill + ft;
  const iZ1full = o.headZ - ft;
  const iZ1 = headCut ? head : head - ft;
  if (iS1 - iS0 > 1e-3 && iZ1 - iZ0 > MIN_HEIGHT) {
    // clear width per leaf: one span, or two halves either side of the seam / meeting stile of a double door
    const double = isDoor && !!o.swing2;
    const mid = (iS0 + iS1) / 2;
    const half = o.leaf === 'solid' ? DOUBLE_LEAF_GAP / 2 : Math.min(ft, (iS1 - iS0) / 6);
    const spans: [number, number][] = double ? [[iS0, mid - half], [mid + half, iS1]] : [[iS0, iS1]];
    if (o.leaf === 'solid') {
      for (const [a, b] of spans) box(solid, OPENING_MAT.leaf, a, b, gp - OPENING_DIMS.leaf / 2, gp + OPENING_DIMS.leaf / 2, iZ0, iZ1);
    } else {
      if (double) box(solid, OPENING_MAT.frame, mid - half, mid + half, gp - fd / 2, gp + fd / 2, iZ0, iZ1);
      for (const [a, b] of spans) {
        appendQuad(glass, [P(a, gp, iZ0), P(b, gp, iZ0), P(b, gp, iZ1), P(a, gp, iZ1)], 0);
        appendMullions(o.panes, a, b, iZ0, iZ1full, iZ1, (sA, sB, zA, zB) =>
          box(solid, OPENING_MAT.frame, sA, sB, gp - fd / 4, gp + fd / 4, zA, zB),
        );
      }
    }
  }

  // surround on the outer face of exterior walls
  const outSign = outsideSign(o, host, nL);
  if (outSign !== 0) {
    const face = outSign < 0 ? -host.faceRight : host.faceLeft;
    const wA = face;
    const wB = face + outSign * OPENING_DIMS.trimDepth;
    const tw = OPENING_DIMS.trimWidth;
    box(solid, OPENING_MAT.trim, s0 - tw, s0, wA, wB, sill, head);
    box(solid, OPENING_MAT.trim, s1, s1 + tw, wA, wB, sill, head);
    if (!headCut) box(solid, OPENING_MAT.trim, s0 - tw, s1 + tw, wA, wB, o.headZ, o.headZ + tw);
    if (!isDoor) box(solid, OPENING_MAT.trim, s0 - tw, s1 + tw, wA, wB, sill - tw, sill);
  }
  return out;
}

/** −1 when the outside is on the right of the host line, +1 on the left, 0 for interior walls. */
function outsideSign(o: DerivedOpening, host: OpeningHostLine, nL: Vec2): number {
  if (o.outward) {
    const d = o.outward[0] * nL[0] + o.outward[1] * nL[1];
    if (Math.abs(d) > 1e-6) return d > 0 ? 1 : -1;
  }
  return host.isExterior ? -1 : 0;
}

/** Mullion bars for a [cols, rows] pane grid; horizontal bars are split between vertical ones (no overlaps). */
function appendMullions(
  panes: [number, number],
  s0: number,
  s1: number,
  z0: number,
  z1full: number,
  z1: number,
  box: (sA: number, sB: number, zA: number, zB: number) => void,
): void {
  const cols = Math.max(1, Math.round(panes[0] || 1));
  const rows = Math.max(1, Math.round(panes[1] || 1));
  const mw = OPENING_DIMS.mullion;
  const xs: number[] = [];
  for (let k = 1; k < cols; k++) xs.push(s0 + ((s1 - s0) * k) / cols);
  for (const x of xs) box(x - mw / 2, x + mw / 2, z0, z1);
  const edges = [s0, ...xs.flatMap((x) => [x - mw / 2, x + mw / 2]), s1];
  for (let k = 1; k < rows; k++) {
    const z = z0 + ((z1full - z0) * k) / rows;
    if (z + mw / 2 > z1) continue;
    for (let e = 0; e < edges.length; e += 2) box(edges[e], edges[e + 1], z - mw / 2, z + mw / 2);
  }
}

// ---------------------------------------------------------------------------
// Roofs
// ---------------------------------------------------------------------------

/**
 * Prism of one roof slope: top polygon as given, bottom offset −thickness vertically, side faces.
 * Slots: ROOF_MAT.turf for top + sides, ROOF_MAT.underside for the bottom. Caps are triangulated in the
 * slope's own plane (appendPolygon → planeFrame), so UVs run along the eave / up the slope in metres.
 */
export function buildRoofSlope(slope: RoofSlope, thickness: number): MeshData {
  const d = createMeshData(2);
  const poly = cleanRing(slope.polygon);
  if (poly.length < 3) return d;
  const plan: Vec2[] = poly.map((p) => [p[0], p[1]]);
  const area = signedArea2(plan);
  if (Math.abs(area) < 1e-9) return d;
  const top = area < 0 ? [...poly].reverse() : poly;
  appendPolygon(d, top, [], ROOF_MAT.turf);
  if (thickness > 0) {
    const bottom: Vec3[] = top.map((p) => [p[0], p[1], p[2] - thickness]);
    appendPolygon(d, bottom, [], ROOF_MAT.underside, true);
    for (let i = 0; i < top.length; i++) {
      const j = (i + 1) % top.length;
      appendQuad(d, [top[i], bottom[i], bottom[j], top[j]], ROOF_MAT.turf);
    }
  }
  return d;
}

/**
 * Trims (thin sage boxes on the top-surface edges, shifted outwards away from the roof outline's centre) and the
 * ridge cap (turf roll on the ridge). Slots: ROOF_TRIM_MAT.
 */
export function buildRoofTrims(roof: DerivedRoof): MeshData {
  const d = createMeshData(2);
  const c = averagePoint(roof.outline.length ? roof.outline : roof.slopes.flatMap((s) => s.polygon.map((p): Vec2 => [p[0], p[1]])));
  for (const t of roof.trims) {
    const h = horizontalNormal(t.a, t.b);
    const mid: Vec2 = [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2];
    const sign = h[0] * (mid[0] - c[0]) + h[1] * (mid[1] - c[1]) >= 0 ? 1 : -1;
    if (t.kind === 'barge') appendSegmentBox(d, t.a, t.b, 0.07, -0.33, 0.03, ROOF_TRIM_MAT.trim, sign * 0.035);
    else appendSegmentBox(d, t.a, t.b, 0.06, -roof.thickness - 0.01, 0.03, ROOF_TRIM_MAT.trim, sign * 0.03);
  }
  if (roof.ridge) {
    const lift = (p: Vec3): Vec3 => [p[0], p[1], p[2] + roof.thickness];
    appendSegmentBox(d, lift(roof.ridge.a), lift(roof.ridge.b), 0.6, -0.17, 0.05, ROOF_TRIM_MAT.cap);
  }
  return d;
}

function averagePoint(pts: Vec2[]): Vec2 {
  if (!pts.length) return [0, 0];
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

// ---------------------------------------------------------------------------
// Floors, decks, railings, steps, foundations, structure
// ---------------------------------------------------------------------------

export interface FloorOptions {
  /** Raise the top surface (m) to keep it off coincident surfaces. */
  lift?: number;
  /** Raise the underside (m) so it does not coincide with a slab underside. */
  bottomInset?: number;
  /**
   * For floors without thickness standing above the block's foundation top (main floor next to a lower floor
   * zone): fill down to this z with sides only, so the step between the levels shows a riser, not a void.
   */
  fillTo?: number;
}

/**
 * Floor: top cap at z + lift (FLOOR_MAT.top); when thickness > 0 an extrusion with sides + underside
 * (FLOOR_MAT.under); a zero-thickness floor with `fillTo` below it becomes a solid down to `fillTo` (no bottom).
 */
export function buildFloor(floor: Pick<DerivedFloor, 'polygon' | 'holes' | 'z' | 'thickness'>, opts: FloorOptions = {}): MeshData {
  const d = createMeshData(2);
  if (floor.polygon.length < 3) return d;
  const top = floor.z + (opts.lift ?? 0);
  const bottom = floor.z - floor.thickness + (opts.bottomInset ?? 0);
  if (floor.thickness > 0 && top - bottom > MIN_HEIGHT) {
    appendPrism(d, { ring: floor.polygon, holes: floor.holes, bottomZ: bottom, topZ: top, topSlot: FLOOR_MAT.top, bottomSlot: FLOOR_MAT.under, sideSlot: FLOOR_MAT.under });
  } else if (floor.thickness <= 0 && opts.fillTo !== undefined && floor.z - opts.fillTo > 0.01) {
    appendPrism(d, { ring: floor.polygon, holes: floor.holes, bottomZ: opts.fillTo, topZ: top, topSlot: FLOOR_MAT.top, bottomSlot: null, sideSlot: FLOOR_MAT.under });
  } else {
    const ring = ensureCCW2(cleanRing(floor.polygon));
    const holes = floor.holes.map((h) => cleanRing(h)).filter((h) => h.length >= 3).map(ensureCW2);
    const lift3 = (r: Vec2[]): Vec3[] => r.map((p) => [p[0], p[1], top]);
    appendPolygon(d, lift3(ring), holes.map(lift3), FLOOR_MAT.top);
  }
  return d;
}

/** Skirt boards: one quad per polygon edge from `underZ` down to the per-vertex skirt bottoms. Returns the quad count. */
export function appendDeckSkirt(d: MeshData, polygon: Vec2[], underZ: number, skirtBottomZ: number[], slot: number): number {
  const ccw = signedArea2(polygon) >= 0;
  const ring = ccw ? polygon : [...polygon].reverse();
  const bottoms = ccw ? skirtBottomZ : [...skirtBottomZ].reverse();
  const n = ring.length;
  let quads = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const b0 = Math.min(bottoms[i] ?? underZ, underZ);
    const b1 = Math.min(bottoms[j] ?? underZ, underZ);
    if (underZ - b0 < MIN_HEIGHT && underZ - b1 < MIN_HEIGHT) continue;
    const a = ring[i];
    const b = ring[j];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9) continue;
    appendQuad(d, [[a[0], a[1], underZ], [a[0], a[1], b0], [b[0], b[1], b1], [b[0], b[1], underZ]], slot);
    quads++;
  }
  return quads;
}

/**
 * Deck: its `pieces` (the outline trimmed by the buildings, with holes) as boards on top (DECK_MAT.top, UV swapped
 * for boards along y), edge + skirt along each piece's outer ring (DECK_MAT.side). No underside.
 */
export function buildDeck(deck: DerivedDeck): MeshData {
  const d = createMeshData(2);
  const underZ = deck.topZ - deck.thickness;
  deck.pieces.forEach((piece, i) => {
    const ring = piece[0];
    if (!ring || ring.length < 3 || Math.abs(signedArea2(ring)) < 1e-9) return;
    appendPrism(d, { ring, holes: piece.slice(1), bottomZ: underZ, topZ: deck.topZ, topSlot: DECK_MAT.top, bottomSlot: null, sideSlot: DECK_MAT.side });
    appendDeckSkirt(d, ring, underZ, deck.skirtBottomZ[i] ?? [], DECK_MAT.side);
  });
  if (deck.boardDirection === 'y') swapUVs(d, DECK_MAT.top);
  return d;
}

export interface RailingBuild {
  /** Posts, cap rails, bottom rails, slats (one slot). */
  solid: MeshData;
  /** Glass panels (one slot). */
  glass: MeshData;
}

/** Railing centred on its path: posts, cap rail, and glass panels (with a bottom rail) or vertical board slats. */
export function buildRailing(r: DerivedRailing): RailingBuild {
  const solid = createMeshData(1);
  const glass = createMeshData(1);
  if (r.height <= RAILING_DIMS.capHeight) return { solid, glass };
  const D = RAILING_DIMS;
  const capZ0 = r.height - D.capHeight;
  for (const p of r.posts) {
    const h = D.post / 2;
    appendBox(solid, [p[0] - h, p[1] - h, p[2]], [p[0] + h, p[1] + h, p[2] + capZ0], 0);
  }
  for (const { a, b } of r.panels) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const base = a[2];
    const a2: Vec2 = [a[0], a[1]];
    const b2: Vec2 = [b[0], b[1]];
    appendOrientedBox(solid, a2, b2, D.capWidth, base + capZ0, base + r.height, 0);
    if (r.style === 'glass') {
      appendOrientedBox(solid, a2, b2, D.bottomRail, base + 0.08, base + 0.08 + D.bottomRail, 0);
      const z0 = base + 0.08 + D.bottomRail;
      const z1 = base + capZ0;
      appendQuad(glass, [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]], 0);
    } else {
      const dx = (b[0] - a[0]) / L;
      const dy = (b[1] - a[1]) / L;
      const pitch = D.slat + D.slatGap;
      const n = Math.max(1, Math.floor((L - D.slatGap) / pitch));
      const used = n * D.slat + (n - 1) * D.slatGap;
      const start = (L - used) / 2;
      for (let k = 0; k < n; k++) {
        const s0 = start + k * pitch;
        const pa: Vec2 = [a[0] + dx * s0, a[1] + dy * s0];
        const pb: Vec2 = [a[0] + dx * (s0 + D.slat), a[1] + dy * (s0 + D.slat)];
        appendOrientedBox(solid, pa, pb, D.slatDepth, base + 0.05, base + capZ0, 0);
      }
    }
  }
  return { solid, glass };
}

/** Steps in a railing gap: one solid block per tread, from the foot of the stair up to the tread top. */
export function buildSteps(s: DerivedSteps): MeshData {
  const d = createMeshData(1);
  for (const t of s.treads) {
    if (t.z - s.bottomZ < MIN_HEIGHT) continue;
    appendPrism(d, { ring: t.polygon, bottomZ: s.bottomZ - 0.05, topZ: t.z, topSlot: 0, bottomSlot: null, sideSlot: 0 });
  }
  return d;
}

/**
 * Plinth prism between bottomZ and topZ (slot 0), plus a plinth skirt under each exterior wall piece standing
 * higher than the plinth top (the main floor above a lower floor zone), so no gap opens under the cladding.
 */
export function buildFoundation(f: DerivedFoundation, skirts: { footprint: Vec2[]; baseZ: number }[] = []): MeshData {
  const d = createMeshData(1);
  if (f.polygon.length >= 3 && f.topZ - f.bottomZ >= MIN_HEIGHT) {
    appendPrism(d, { ring: f.polygon, bottomZ: f.bottomZ, topZ: f.topZ, topSlot: 0, bottomSlot: null, sideSlot: 0 });
  }
  for (const s of skirts) {
    if (s.footprint.length < 3 || s.baseZ - f.topZ < 0.01) continue;
    appendPrism(d, { ring: s.footprint, bottomZ: f.topZ, topZ: s.baseZ, topSlot: null, bottomSlot: null, sideSlot: 0 });
  }
  return d;
}

/** Posts, beams, chimney (+ cap), stair treads; everything clipped at `cutZ` (null = uncut). Slots: STRUCT_MAT. */
export function buildStructure(s: DerivedStructure, cutZ: number | null = null): MeshData {
  const d = createMeshData(3);
  const clip = (z: number) => (cutZ === null ? z : Math.min(z, cutZ));
  switch (s.kind) {
    case 'post': {
      const h = s.size / 2;
      appendBox(d, [s.position[0] - h, s.position[1] - h, s.bottomZ], [s.position[0] + h, s.position[1] + h, clip(s.topZ)], STRUCT_MAT.wood);
      break;
    }
    case 'beam':
      appendOrientedBox(d, s.a, s.b, s.width, s.bottomZ, clip(s.topZ), STRUCT_MAT.wood);
      break;
    case 'chimney': {
      const top = clip(s.topZ);
      appendBox(d, [s.min[0], s.min[1], s.bottomZ], [s.max[0], s.max[1], top], STRUCT_MAT.chimney);
      if (top >= s.topZ - 1e-9) {
        appendBox(d, [s.min[0] - 0.1, s.min[1] - 0.1, s.topZ], [s.max[0] + 0.1, s.max[1] + 0.1, s.topZ + 0.08], STRUCT_MAT.chimneyCap);
      }
      break;
    }
    case 'stair':
      for (const t of s.treads) {
        if (cutZ !== null && t.z > cutZ) continue;
        appendPrism(d, { ring: t.polygon, bottomZ: t.z - 0.04, topZ: t.z, topSlot: STRUCT_MAT.wood, bottomSlot: STRUCT_MAT.wood, sideSlot: STRUCT_MAT.wood });
      }
      break;
  }
  return d;
}


// ---------------------------------------------------------------------------
// Terrain, water
// ---------------------------------------------------------------------------

/**
 * Displaced grid: one vertex per sample (z from `zAt`, plan frame), two CCW-from-above triangles per cell,
 * smooth normals, UV = (x, y) metres. Cells lying completely inside `hole` (another, finer grid's extent) are
 * skipped so the coarse grid never shows through the fine one.
 */
export function buildTerrainGrid(
  grid: Pick<TerrainGrid, 'x0' | 'y0' | 'dx' | 'dy' | 'nx' | 'ny'>,
  zAt: (x: number, y: number, i: number, j: number) => number,
  hole?: { min: Vec2; max: Vec2 },
): MeshData {
  const d = createMeshData(1);
  const { x0, y0, dx, dy, nx, ny } = grid;
  if (nx < 2 || ny < 2) return d;
  const pos: Vec3[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * dx;
      const y = y0 + j * dy;
      const z = zAt(x, y, i, j);
      pos.push([x, y, Number.isFinite(z) ? z : 0]);
    }
  }
  const acc: Vec3[] = pos.map(() => [0, 0, 0]);
  const idx = d.indices[0];
  const inHole = (p: Vec3) =>
    !!hole && p[0] >= hole.min[0] - 1e-6 && p[0] <= hole.max[0] + 1e-6 && p[1] >= hole.min[1] - 1e-6 && p[1] <= hole.max[1] + 1e-6;
  const tri = (a: number, b: number, c: number) => {
    idx.push(a, b, c);
    const n = cross3(sub3(pos[b], pos[a]), sub3(pos[c], pos[a]));
    for (const k of [a, b, c]) acc[k] = add3(acc[k], n);
  };
  const mirrored = dy < 0 !== dx < 0; // keep triangles CCW from above for negative spacings
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v00 = j * nx + i;
      const v10 = v00 + 1;
      const v01 = v00 + nx;
      const v11 = v01 + 1;
      if (hole && inHole(pos[v00]) && inHole(pos[v10]) && inHole(pos[v01]) && inHole(pos[v11])) continue;
      if (mirrored) {
        tri(v00, v11, v10);
        tri(v00, v01, v11);
      } else {
        tri(v00, v10, v11);
        tri(v00, v11, v01);
      }
    }
  }
  for (let k = 0; k < pos.length; k++) {
    const p = pos[k];
    let n = norm3(acc[k]);
    if (len3(n) < 1e-9) n = UP;
    d.positions.push(p[0], p[1], p[2]);
    d.normals.push(n[0], n[1], n[2]);
    d.uvs.push(p[0], p[1]);
  }
  return d;
}

type GridSpec = Pick<TerrainGrid, 'x0' | 'y0' | 'dx' | 'dy' | 'nx' | 'ny'>;

/** Target cell size (m) of the fine terrain patch over the ground works. */
export const TERRAIN_PATCH_CELL = 0.25;
/** Vertex budget of the fine terrain patch (its cells grow when the ground works cover a large area). */
export const TERRAIN_PATCH_MAX_VERTICES = 60000;

/**
 * Fine patch of a terrain grid over the ground works. Cuts are applied per vertex, so on the finest asset grid
 * (2 m cells) a cut polygon's edge is smeared over a whole cell and the ground can rise through a floor next to it.
 * The patch covers the bounding box of `cuts` snapped outwards to the grid's lines, strictly outside every cut (so
 * its border carries no cut and its vertices there lie on the coarse cells' edges, where the bilinear terrain is
 * linear — no cracks), clamped to the grid, with cells of at most `maxCell` metres (coarser when the vertex budget
 * would be exceeded). Build the coarse grid with `extent` as its hole. Null when there is nothing to refine
 * (no cuts over the grid, non-positive spacing, or a patch no finer than the grid).
 */
export function terrainPatch(
  grid: GridSpec,
  cuts: Vec2[][],
  maxCell = TERRAIN_PATCH_CELL,
  maxVertices = TERRAIN_PATCH_MAX_VERTICES,
): { grid: GridSpec; extent: { min: Vec2; max: Vec2 } } | null {
  const { x0, y0, dx, dy, nx, ny } = grid;
  if (!(dx > 0) || !(dy > 0) || !Number.isFinite(dx) || !Number.isFinite(dy) || nx < 2 || ny < 2) return null;
  const pts = cuts.flat().filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const clampI = (i: number, n: number) => Math.min(n - 1, Math.max(0, i));
  const i0 = clampI(Math.ceil((Math.min(...xs) - x0) / dx) - 1, nx);
  const i1 = clampI(Math.floor((Math.max(...xs) - x0) / dx) + 1, nx);
  const j0 = clampI(Math.ceil((Math.min(...ys) - y0) / dy) - 1, ny);
  const j1 = clampI(Math.floor((Math.max(...ys) - y0) / dy) + 1, ny);
  if (i1 - i0 < 1 || j1 - j0 < 1) return null;
  let k = Math.max(1, Math.ceil(dx / maxCell - 1e-9));
  let m = Math.max(1, Math.ceil(dy / maxCell - 1e-9));
  const verts = () => ((i1 - i0) * k + 1) * ((j1 - j0) * m + 1);
  if (verts() > maxVertices) {
    const f = Math.sqrt(verts() / maxVertices);
    k = Math.max(1, Math.floor(k / f));
    m = Math.max(1, Math.floor(m / f));
    while (verts() > maxVertices && (k > 1 || m > 1)) {
      if (k >= m) k--;
      else m--;
    }
  }
  if (k === 1 && m === 1) return null;
  const min: Vec2 = [x0 + i0 * dx, y0 + j0 * dy];
  const max: Vec2 = [x0 + i1 * dx, y0 + j1 * dy];
  return {
    grid: { x0: min[0], y0: min[1], dx: dx / k, dy: dy / m, nx: (i1 - i0) * k + 1, ny: (j1 - j0) * m + 1 },
    extent: { min, max },
  };
}

/** Extent of a grid in plan. */
export function gridExtent(grid: Pick<TerrainGrid, 'x0' | 'y0' | 'dx' | 'dy' | 'nx' | 'ny'>): { min: Vec2; max: Vec2 } {
  const xa = grid.x0;
  const xb = grid.x0 + (grid.nx - 1) * grid.dx;
  const ya = grid.y0;
  const yb = grid.y0 + (grid.ny - 1) * grid.dy;
  return { min: [Math.min(xa, xb), Math.min(ya, yb)], max: [Math.max(xa, xb), Math.max(ya, yb)] };
}

/** Plan extent of several grids together; null for none. */
export function gridsExtent(grids: Pick<TerrainGrid, 'x0' | 'y0' | 'dx' | 'dy' | 'nx' | 'ny'>[]): { min: Vec2; max: Vec2 } | null {
  if (!grids.length) return null;
  const ex = grids.map(gridExtent);
  return {
    min: [Math.min(...ex.map((e) => e.min[0])), Math.min(...ex.map((e) => e.min[1]))],
    max: [Math.max(...ex.map((e) => e.max[0])), Math.max(...ex.map((e) => e.max[1]))],
  };
}

/** Horizontal rectangle at z facing up (water surface, flat ground fallback). */
export function buildHorizontalRect(extent: { min: Vec2; max: Vec2 }, z: number): MeshData {
  const d = createMeshData(1);
  const { min, max } = extent;
  if (max[0] - min[0] <= 0 || max[1] - min[1] <= 0) return d;
  appendQuad(d, [[min[0], min[1], z], [max[0], min[1], z], [max[0], max[1], z], [min[0], max[1], z]], 0);
  return d;
}

// ---------------------------------------------------------------------------
// Conversion and inspection
// ---------------------------------------------------------------------------

/** MeshData (plan frame) → BufferGeometry (world frame X = x, Y = z, Z = −y) with one group per used slot. */
export function toBufferGeometry(d: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  const n = vertexCount(d);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = d.positions[i * 3];
    pos[i * 3 + 1] = d.positions[i * 3 + 2];
    pos[i * 3 + 2] = -d.positions[i * 3 + 1];
    nor[i * 3] = d.normals[i * 3];
    nor[i * 3 + 1] = d.normals[i * 3 + 2];
    nor[i * 3 + 2] = -d.normals[i * 3 + 1];
  }
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(d.uvs), 2));
  const total = d.indices.reduce((s, l) => s + l.length, 0);
  const index = n > 65535 ? new Uint32Array(total) : new Uint16Array(total);
  let start = 0;
  d.indices.forEach((list, slot) => {
    if (list.length === 0) return;
    for (let k = 0; k < list.length; k++) index[start + k] = list[k];
    g.addGroup(start, list.length, slot);
    start += list.length;
  });
  g.setIndex(index instanceof Uint32Array ? new Uint32BufferAttribute(index, 1) : new Uint16BufferAttribute(index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function isEmpty(d: MeshData): boolean {
  return d.indices.every((l) => l.length === 0);
}

export function triangleCount(d: MeshData, slot?: number): number {
  if (slot !== undefined) return (d.indices[slot]?.length ?? 0) / 3;
  return d.indices.reduce((s, l) => s + l.length, 0) / 3;
}

/** Bounds of all vertices in the plan frame. */
export function meshBounds(d: MeshData): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < d.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = d.positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/** Centroids of all triangles of a slot (plan frame) — for tests. */
export function triangleCentroids(d: MeshData, slot: number): Vec3[] {
  const out: Vec3[] = [];
  const idx = d.indices[slot] ?? [];
  for (let i = 0; i < idx.length; i += 3) {
    const c: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const v = idx[i + k] * 3;
      c[0] += d.positions[v] / 3;
      c[1] += d.positions[v + 1] / 3;
      c[2] += d.positions[v + 2] / 3;
    }
    out.push(c);
  }
  return out;
}

/** Normal of triangle `i` of a slot computed from its positions (plan frame) — for tests. */
export function triangleNormal(d: MeshData, slot: number, i: number): Vec3 {
  const idx = d.indices[slot];
  const p = (k: number): Vec3 => {
    const v = idx[i * 3 + k] * 3;
    return [d.positions[v], d.positions[v + 1], d.positions[v + 2]];
  };
  return norm3(cross3(sub3(p(1), p(0)), sub3(p(2), p(0))));
}

/** Total signed volume enclosed by the triangles of `d` (divergence theorem) — for tests; > 0 for outward normals. */
export function signedVolume(d: MeshData): number {
  let v = 0;
  for (const list of d.indices) {
    for (let i = 0; i < list.length; i += 3) {
      const p = (k: number): Vec3 => {
        const o = list[i + k] * 3;
        return [d.positions[o], d.positions[o + 1], d.positions[o + 2]];
      };
      v += dot3(p(0), cross3(p(1), p(2))) / 6;
    }
  }
  return v;
}
