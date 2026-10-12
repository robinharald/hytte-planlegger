/**
 * Pure editing helpers of the plan (docs/phase2-plan.md §3.1–3.4, §3.7): pointer sizes, grid snap, unit ghosts,
 * the drag handles of a selection, what a drag of the selected element moves, hit tests in plan metres, the wall
 * under a click (Dør/vindu), the screen anchor of the phone mini-bar and the "Avstand fra hjørne" dimension.
 * No React, no DOM — unit-tested (editModel.test.ts).
 *
 * Decisions where the plan is silent:
 *  - Handles: a selected block (or one of its edges / vertices) shows a handle on every axis vertex and at every
 *    edge midpoint; a selected exterior wall piece shows only its block edge's two vertices; a stored wall its two
 *    endpoints (handle 'a' / 'b'); an opening its two jambs ('start' / 'end'); a selected deck (or deck vertex /
 *    edge) its vertices, a "+" at every edge midpoint and a drag corridor along every edge. A tap on a vertex or an
 *    edge selects it ('blockVertex', 'blockEdge', 'deckVertex', 'deckEdge'), the others keep the selection.
 *  - Body drags: the selected element moves when the pointer goes down on it (its DOM hit area, or within the hit
 *    corridor of its geometry, so a block can be grabbed through the rooms inside it). An exterior wall piece drags
 *    its block edge (`{ kind: 'blockEdge' }`), a stored wall `{ kind: 'wall', id: wallId }`. Rooms, decks, railings,
 *    structure and ghosts have no body drag: a drag over them pans.
 *  - Ghost ids: a removed stored wall → its wall id; a removed opening → its opening id; a moved block edge → the
 *    `Variant.ghosts` id. `restoreGhost(id)` takes that id.
 *  - Unit ghosts use model/unitTemplates.ts (the footprint `placeUnit` builds: centred on `at`, quarter turns CCW);
 *    an unknown template id gets a 3 × 3 m ghost.
 */
import type { DerivedBlock, DerivedDeck, DerivedOpening, DerivedVariant, DerivedWall } from '../model/derived';
import type { Id, OpeningHost, Vec2 } from '../model/types';
import { unitFootprint as templateFootprint, unitSize as templateSize, unitTemplate } from '../model/unitTemplates';
import { distancePointSegment, pointInPolygon, projectPointOnSegment } from '../geometry/polygon';
import { editStrings } from './editStrings';
import type { PlanDragHandle, PlanSelection } from './editTypes';
import type { Rect } from './viewport';

// ---------------------------------------------------------------------------
// Sizes (§3.1, §3.3)
// ---------------------------------------------------------------------------

/** Handle radius (px): 7, 14 on a coarse pointer. */
export const HANDLE_RADIUS_PX = 7;
export const HANDLE_RADIUS_COARSE_PX = 14;
/** Minimum width (px) of the wall / opening hit corridors at any zoom: 12, 24 coarse. */
export const CORRIDOR_PX = 12;
export const CORRIDOR_COARSE_PX = 24;
/** Snap radius (px): 12, 24 coarse. */
export const SNAP_RADIUS_PX = 12;
export const SNAP_RADIUS_COARSE_PX = 24;
/** Movement (px) before a press becomes a drag (move or pan): 5 with a mouse or pen, 10 with touch. */
export const DRAG_THRESHOLD_PX = 5;
export const DRAG_THRESHOLD_TOUCH_PX = 10;
/** Grid snap (m): 0.10, 0.01 with Alt. */
export const GRID_STEP = 0.1;
export const GRID_STEP_FINE = 0.01;

export interface PointerSizes {
  handleR: number;
  corridor: number;
  snap: number;
}

export function pointerSizes(coarse: boolean): PointerSizes {
  return coarse
    ? { handleR: HANDLE_RADIUS_COARSE_PX, corridor: CORRIDOR_COARSE_PX, snap: SNAP_RADIUS_COARSE_PX }
    : { handleR: HANDLE_RADIUS_PX, corridor: CORRIDOR_PX, snap: SNAP_RADIUS_PX };
}

export function dragThresholdPx(pointerType: string): number {
  return pointerType === 'touch' ? DRAG_THRESHOLD_TOUCH_PX : DRAG_THRESHOLD_PX;
}

const roundTo = (v: number, step: number) => {
  const r = Math.round(v / step) * step;
  // Kill float noise (0.30000000000000004) and "-0".
  const c = Math.round(r * 1e6) / 1e6;
  return c === 0 ? 0 : c;
};

/** Nearest grid point (0.10 m, 0.01 m with `fine`). The fallback snap when the edit API has no `snapPoint`. */
export function gridSnap(p: Vec2, fine: boolean): Vec2 {
  const step = fine ? GRID_STEP_FINE : GRID_STEP;
  return [roundTo(p[0], step), roundTo(p[1], step)];
}

// ---------------------------------------------------------------------------
// Small vector helpers
// ---------------------------------------------------------------------------

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, v: Vec2, k: number): Vec2 => [a[0] + v[0] * k, a[1] + v[1] * k];
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const len = (v: Vec2) => Math.hypot(v[0], v[1]);
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const midpoint = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function unit(a: Vec2, b: Vec2): Vec2 | null {
  const d = sub(b, a);
  const l = len(d);
  return l > 1e-9 ? [d[0] / l, d[1] / l] : null;
}

function boundsOf(points: readonly Vec2[]): Rect | null {
  if (points.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return x0 <= x1 && y0 <= y1 ? { min: [x0, y0], max: [x1, y1] } : null;
}

const square = (p: Vec2, r: number): Vec2[] => [
  [p[0] - r, p[1] - r],
  [p[0] + r, p[1] + r],
];

// ---------------------------------------------------------------------------
// Units (Nytt bygg ghost)
// ---------------------------------------------------------------------------

/** Ghost size of an unknown template. */
const FALLBACK_UNIT = { w: 3, d: 3 };

/** Quarter turns normalised to 0..3. */
export function quarterTurns(r: number | undefined): number {
  const n = Math.round(r ?? 0);
  return ((n % 4) + 4) % 4;
}

/** Plan extents of a template's footprint after `rotation90` quarter turns. */
export function unitSize(templateId: string, rotation90: number): Vec2 {
  return templateSize(unitTemplate(templateId) ?? FALLBACK_UNIT, rotation90);
}

/** Axis polygon (CCW) of a template centred on `at` (model/unitTemplates.ts `unitFootprint`). */
export function unitFootprint(templateId: string, at: Vec2, rotation90: number): Vec2[] {
  return templateFootprint(unitTemplate(templateId) ?? FALLBACK_UNIT, at, rotation90);
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findOpening(derived: Pick<DerivedVariant, 'walls'>, id: Id): { opening: DerivedOpening; wall: DerivedWall } | null {
  for (const wall of derived.walls) {
    const opening = wall.openings.find((o) => o.id === id);
    if (opening) return { opening, wall };
  }
  return null;
}

export function findBlockOfVertex(blocks: readonly DerivedBlock[], vertexId: Id): DerivedBlock | null {
  return blocks.find((b) => b.block.polygon.some((v) => v.id === vertexId)) ?? null;
}

export function findDeckOfVertex(decks: readonly DerivedDeck[], vertexId: Id): DerivedDeck | null {
  return decks.find((d) => d.vertexIds.includes(vertexId)) ?? null;
}

/** The ghost id a removed wall is selected / restored by (stored wall id; a piece id otherwise). */
export function ghostIdOfWall(w: Pick<DerivedWall, 'id' | 'source'>): Id {
  return w.source.kind === 'wall' ? w.source.wallId : w.id;
}

/** Opening host of a derived wall piece. */
export function hostOf(w: Pick<DerivedWall, 'source'>): OpeningHost {
  return w.source.kind === 'blockEdge' ? { kind: 'blockEdge', blockId: w.source.blockId, edgeId: w.source.edgeId } : { kind: 'wall', wallId: w.source.wallId };
}

/** Pieces a wall id refers to: a derived piece id, a stored wall id or a block edge id. */
export function wallsById(walls: readonly DerivedWall[], id: Id): DerivedWall[] {
  return walls.filter((w) => w.id === id || (w.source.kind === 'wall' && w.source.wallId === id) || (w.source.kind === 'blockEdge' && w.source.edgeId === id));
}

/** Pieces of the selected element for highlights and hit tests ('wall' and 'blockEdge' selections). */
function selectedPieces(derived: Pick<DerivedVariant, 'walls'>, sel: PlanSelection): DerivedWall[] {
  if (sel.kind === 'wall') return derived.walls.filter((w) => w.id === sel.id || (w.source.kind === 'wall' && w.source.wallId === sel.id));
  if (sel.kind === 'blockEdge') return derived.walls.filter((w) => w.source.kind === 'blockEdge' && w.source.edgeId === sel.id);
  return [];
}

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

export type HandleShape = 'vertex' | 'mid' | 'insert' | 'end' | 'edge';

export interface PlanHandle {
  /** Unique within one selection (React key and `data-handle` value). */
  key: string;
  shape: HandleShape;
  /** Centre (for 'edge': the edge midpoint). */
  p: Vec2;
  /** The edge for 'edge' corridors and 'insert' handles. */
  a?: Vec2;
  b?: Vec2;
  /** `beginDrag` target, or null (an 'insert' handle first inserts the vertex, see `insert`). */
  drag: PlanSelection | null;
  handle?: PlanDragHandle;
  /** Selection a tap makes; null keeps the current selection. */
  tap: PlanSelection | null;
  /** "+" handle: a tap inserts a deck vertex at `p`, a drag inserts it and moves it. */
  insert?: { deckId: Id; edgeId: Id };
  /** The selected vertex / edge itself. */
  active: boolean;
  title: string;
}

function blockHandles(b: DerivedBlock, sel: PlanSelection): PlanHandle[] {
  const poly = b.block.polygon;
  const out: PlanHandle[] = [];
  for (let i = 0; i < poly.length; i++) {
    const v = poly[i];
    const next = poly[(i + 1) % poly.length];
    const s: PlanSelection = { kind: 'blockEdge', id: v.id };
    out.push({ key: `be:${v.id}`, shape: 'mid', p: midpoint(v.p, next.p), a: v.p, b: next.p, drag: s, tap: s, active: sel.kind === 'blockEdge' && sel.id === v.id, title: editStrings.handleEdge });
  }
  for (const v of poly) {
    const s: PlanSelection = { kind: 'blockVertex', id: v.id };
    out.push({ key: `bv:${v.id}`, shape: 'vertex', p: v.p, drag: s, tap: s, active: sel.kind === 'blockVertex' && sel.id === v.id, title: editStrings.handleVertex });
  }
  return out;
}

function deckHandles(d: DerivedDeck, sel: PlanSelection): PlanHandle[] {
  const n = d.polygon.length;
  const edges: PlanHandle[] = [];
  const inserts: PlanHandle[] = [];
  const vertices: PlanHandle[] = [];
  for (let i = 0; i < n; i++) {
    const edgeId = d.vertexIds[i];
    const a = d.polygon[i];
    const b = d.polygon[(i + 1) % n];
    const m = midpoint(a, b);
    const es: PlanSelection = { kind: 'deckEdge', id: edgeId };
    edges.push({ key: `de:${edgeId}`, shape: 'edge', p: m, a, b, drag: es, tap: es, active: sel.kind === 'deckEdge' && sel.id === edgeId, title: editStrings.handleEdge });
    inserts.push({ key: `di:${edgeId}`, shape: 'insert', p: m, a, b, drag: null, tap: null, insert: { deckId: d.id, edgeId }, active: false, title: editStrings.handleInsert });
    const vs: PlanSelection = { kind: 'deckVertex', id: edgeId };
    vertices.push({ key: `dv:${edgeId}`, shape: 'vertex', p: a, drag: vs, tap: vs, active: sel.kind === 'deckVertex' && sel.id === edgeId, title: editStrings.handleVertex });
  }
  return [...edges, ...inserts, ...vertices];
}

/** Drag handles of the selection, bottom to top (vertices last, so they win where handles overlap). */
export function handlesFor(derived: Pick<DerivedVariant, 'walls' | 'blocks' | 'outdoor'>, sel: PlanSelection | null): PlanHandle[] {
  if (!sel) return [];
  switch (sel.kind) {
    case 'block': {
      const b = derived.blocks.find((x) => x.block.id === sel.id);
      return b ? blockHandles(b, sel) : [];
    }
    case 'blockEdge':
    case 'blockVertex': {
      const b = findBlockOfVertex(derived.blocks, sel.id);
      return b ? blockHandles(b, sel) : [];
    }
    case 'wall': {
      const w = derived.walls.find((x) => x.id === sel.id) ?? derived.walls.find((x) => x.source.kind === 'wall' && x.source.wallId === sel.id);
      if (!w || w.isGhost) return [];
      const src = w.source;
      if (src.kind === 'blockEdge') {
        const poly = derived.blocks.find((x) => x.block.id === src.blockId)?.block.polygon ?? [];
        const i = poly.findIndex((v) => v.id === src.edgeId);
        if (i < 0) return [];
        return [poly[i], poly[(i + 1) % poly.length]].map((v) => {
          const s: PlanSelection = { kind: 'blockVertex', id: v.id };
          return { key: `bv:${v.id}`, shape: 'vertex' as const, p: v.p, drag: s, tap: s, active: false, title: editStrings.handleVertex };
        });
      }
      const target: PlanSelection = { kind: 'wall', id: src.wallId };
      return (['a', 'b'] as const).map((end) => ({ key: `we:${end}`, shape: 'end' as const, p: w[end], drag: target, handle: end, tap: null, active: false, title: editStrings.handleWallEnd }));
    }
    case 'opening': {
      const hit = findOpening(derived, sel.id);
      if (!hit || hit.opening.isGhost) return [];
      const { wall, opening } = hit;
      const u = unit(wall.a, wall.b) ?? [1, 0];
      const target: PlanSelection = { kind: 'opening', id: opening.id };
      return (['start', 'end'] as const).map((end) => ({
        key: `oe:${end}`,
        shape: 'end' as const,
        p: add(wall.a, u, opening.offset + (end === 'start' ? -1 : 1) * (opening.width / 2)),
        drag: target,
        handle: end,
        tap: null,
        active: false,
        title: editStrings.handleOpeningEnd,
      }));
    }
    case 'deck': {
      const d = derived.outdoor.decks.find((x) => x.id === sel.id);
      return d ? deckHandles(d, sel) : [];
    }
    case 'deckVertex':
    case 'deckEdge': {
      const d = findDeckOfVertex(derived.outdoor.decks, sel.id);
      return d ? deckHandles(d, sel) : [];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Body drags and hit tests
// ---------------------------------------------------------------------------

/** What a drag of the selected element itself moves (`beginDrag`'s first argument), or null: the drag pans. */
export function bodyDragTarget(derived: Pick<DerivedVariant, 'walls'>, sel: PlanSelection | null): PlanSelection | null {
  if (!sel) return null;
  switch (sel.kind) {
    case 'wall': {
      const w = derived.walls.find((x) => x.id === sel.id) ?? derived.walls.find((x) => x.source.kind === 'wall' && x.source.wallId === sel.id);
      if (!w || w.isGhost) return null;
      return w.source.kind === 'blockEdge' ? { kind: 'blockEdge', id: w.source.edgeId } : { kind: 'wall', id: w.source.wallId };
    }
    case 'opening': {
      const hit = findOpening(derived, sel.id);
      return hit && !hit.opening.isGhost ? { kind: 'opening', id: sel.id } : null;
    }
    case 'block':
    case 'blockEdge':
    case 'blockVertex':
    case 'deckEdge':
    case 'deckVertex':
    case 'steps':
    case 'hotTub':
    case 'tree':
    case 'furniture':
      return { kind: sel.kind, id: sel.id };
    default:
      return null;
  }
}

function nearWall(w: DerivedWall, p: Vec2, tolM: number): boolean {
  if (w.footprint.length >= 3 && pointInPolygon(p, w.footprint)) return true;
  return distancePointSegment(p, w.a, w.b) <= Math.max(tolM, w.faceLeft, w.faceRight);
}

function nearEdgeOfPolygon(poly: readonly Vec2[], i: number, p: Vec2, tolM: number): boolean {
  if (poly.length < 2) return false;
  return distancePointSegment(p, poly[i], poly[(i + 1) % poly.length]) <= tolM;
}

/** Is plan point p on the selected element? `tolM` = half the hit corridor in metres. */
export function hitsSelection(derived: DerivedVariant, sel: PlanSelection | null, p: Vec2, tolM: number): boolean {
  if (!sel) return false;
  switch (sel.kind) {
    case 'wall':
    case 'blockEdge': {
      const pieces = selectedPieces(derived, sel);
      if (pieces.length > 0) return pieces.some((w) => nearWall(w, p, tolM));
      if (sel.kind !== 'blockEdge') return false;
      for (const b of derived.blocks) {
        const e = b.edges.find((x) => x.edgeId === sel.id);
        if (e) return distancePointSegment(p, e.a, e.b) <= tolM;
      }
      return false;
    }
    case 'block': {
      const b = derived.blocks.find((x) => x.block.id === sel.id);
      return !!b && b.outer.length >= 3 && pointInPolygon(p, b.outer);
    }
    case 'blockVertex': {
      const b = findBlockOfVertex(derived.blocks, sel.id);
      const v = b?.block.polygon.find((x) => x.id === sel.id);
      return !!v && dist(v.p, p) <= tolM;
    }
    case 'opening': {
      const hit = findOpening(derived, sel.id);
      if (!hit) return false;
      const u = unit(hit.wall.a, hit.wall.b) ?? [1, 0];
      const s = add(hit.wall.a, u, hit.opening.offset - hit.opening.width / 2);
      const e = add(hit.wall.a, u, hit.opening.offset + hit.opening.width / 2);
      return distancePointSegment(p, s, e) <= Math.max(tolM, hit.wall.faceLeft, hit.wall.faceRight);
    }
    case 'deck': {
      const d = derived.outdoor.decks.find((x) => x.id === sel.id);
      return !!d && d.polygon.length >= 3 && pointInPolygon(p, d.polygon);
    }
    case 'deckEdge': {
      const d = findDeckOfVertex(derived.outdoor.decks, sel.id);
      return !!d && nearEdgeOfPolygon(d.polygon, d.vertexIds.indexOf(sel.id), p, tolM);
    }
    case 'deckVertex': {
      const d = findDeckOfVertex(derived.outdoor.decks, sel.id);
      return !!d && dist(d.polygon[d.vertexIds.indexOf(sel.id)], p) <= tolM;
    }
    case 'steps': {
      const s = derived.outdoor.steps.find((x) => x.id === sel.id);
      if (!s) return false;
      if (s.treads.some((t) => t.polygon.length >= 3 && pointInPolygon(p, t.polygon))) return true;
      const along: Vec2 = [s.outward[1], -s.outward[0]];
      return distancePointSegment(p, add(s.at, along, -s.width / 2), add(s.at, along, s.width / 2)) <= tolM;
    }
    case 'hotTub': {
      const t = derived.outdoor.hotTubs.find((x) => x.id === sel.id);
      return !!t && dist(t.centre, p) <= Math.max(t.diameter / 2, tolM);
    }
    case 'tree': {
      const t = derived.site.trees.find((x) => x.tree.id === sel.id);
      return !!t && dist(t.tree.position, p) <= Math.max(0.8, t.tree.height * 0.3);
    }
    case 'furniture': {
      const f = derived.furniture.find((x) => x.id === sel.id);
      return !!f && f.footprint.length >= 3 && (pointInPolygon(p, f.footprint) || f.footprint.some((_, i) => nearEdgeOfPolygon(f.footprint, i, p, tolM)));
    }
    case 'room': {
      const r = derived.rooms.find((x) => x.id === sel.id && (sel.levelId === undefined || x.levelId === sel.levelId));
      return !!r && r.polygon.length >= 3 && pointInPolygon(p, r.polygon);
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Dør/vindu: the wall under a click
// ---------------------------------------------------------------------------

export interface WallHit {
  wall: DerivedWall;
  host: OpeningHost;
  /** Distance from the HOST start (block edge start / stored wall a) to the clicked point, along the host. */
  offset: number;
  /** The clicked point projected on the wall's reference line. */
  point: Vec2;
}

/**
 * The wall that can host an opening nearest to p (dividers and ghosts cannot), within `tolM` of its reference line
 * or inside its footprint; null when none is that close. The offset is not clamped: `addOpening` fits the opening.
 */
export function wallAt(walls: readonly DerivedWall[], p: Vec2, tolM: number): WallHit | null {
  let best: WallHit | null = null;
  let bestD = Infinity;
  for (const w of walls) {
    if (w.isDivider || w.isGhost || w.footprint.length < 3) continue;
    const d = distancePointSegment(p, w.a, w.b);
    const inside = pointInPolygon(p, w.footprint);
    if (!inside && d > Math.max(tolM, w.faceLeft, w.faceRight)) continue;
    if (d >= bestD) continue;
    const { t, point } = projectPointOnSegment(p, w.a, w.b);
    const along = t * dist(w.a, w.b);
    const offset = w.source.kind === 'blockEdge' ? w.source.s0 + along : along;
    best = { wall: w, host: hostOf(w), offset, point };
    bestD = d;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Bounds of the selection (phone mini-bar anchor)
// ---------------------------------------------------------------------------

/** Plan bounding box of the selected element, or null when it is not in the derived model. */
export function selectionBounds(derived: DerivedVariant, sel: PlanSelection | null): Rect | null {
  if (!sel) return null;
  switch (sel.kind) {
    case 'room': {
      const r = derived.rooms.find((x) => x.id === sel.id && (sel.levelId === undefined || x.levelId === sel.levelId)) ?? derived.rooms.find((x) => x.id === sel.id);
      return r ? boundsOf(r.polygon) : null;
    }
    case 'wall':
    case 'blockEdge': {
      const pieces = selectedPieces(derived, sel);
      if (pieces.length > 0) return boundsOf(pieces.flatMap((w) => (w.footprint.length > 0 ? w.footprint : [w.a, w.b])));
      for (const b of derived.blocks) {
        const e = b.edges.find((x) => x.edgeId === sel.id);
        if (e) return boundsOf([e.a, e.b]);
      }
      return null;
    }
    case 'blockVertex': {
      const v = findBlockOfVertex(derived.blocks, sel.id)?.block.polygon.find((x) => x.id === sel.id);
      return v ? boundsOf(square(v.p, 0.05)) : null;
    }
    case 'opening':
    case 'ghost': {
      const hit = findOpening(derived, sel.id);
      if (hit) {
        const u = unit(hit.wall.a, hit.wall.b) ?? [1, 0];
        const pts = hit.opening.footprint.length > 0 ? hit.opening.footprint : [add(hit.wall.a, u, hit.opening.offset - hit.opening.width / 2), add(hit.wall.a, u, hit.opening.offset + hit.opening.width / 2)];
        return boundsOf(pts);
      }
      if (sel.kind === 'opening') return null;
      const w = derived.walls.find((x) => x.isGhost && ghostIdOfWall(x) === sel.id);
      if (w) return boundsOf(w.footprint.length > 0 ? w.footprint : [w.a, w.b]);
      const g = derived.ghosts.find((x) => x.id === sel.id);
      return g ? boundsOf([g.a, g.b]) : null;
    }
    case 'block': {
      const b = derived.blocks.find((x) => x.block.id === sel.id);
      return b ? boundsOf(b.outer) : null;
    }
    case 'deck': {
      const d = derived.outdoor.decks.find((x) => x.id === sel.id);
      return d ? boundsOf(d.polygon) : null;
    }
    case 'deckVertex':
    case 'deckEdge': {
      const d = findDeckOfVertex(derived.outdoor.decks, sel.id);
      if (!d) return null;
      const i = d.vertexIds.indexOf(sel.id);
      return sel.kind === 'deckVertex' ? boundsOf(square(d.polygon[i], 0.05)) : boundsOf([d.polygon[i], d.polygon[(i + 1) % d.polygon.length]]);
    }
    case 'railing': {
      const r = derived.outdoor.railings.find((x) => x.id === sel.id);
      return r ? boundsOf(r.panels.flatMap((pn) => [[pn.a[0], pn.a[1]] as Vec2, [pn.b[0], pn.b[1]] as Vec2])) : null;
    }
    case 'steps': {
      const s = derived.outdoor.steps.find((x) => x.id === sel.id);
      return s ? boundsOf([...s.treads.flatMap((t) => t.polygon), s.at]) : null;
    }
    case 'hotTub': {
      const t = derived.outdoor.hotTubs.find((x) => x.id === sel.id);
      return t ? boundsOf(square(t.centre, t.diameter / 2)) : null;
    }
    case 'tree': {
      const t = derived.site.trees.find((x) => x.tree.id === sel.id);
      return t ? boundsOf(square(t.tree.position, Math.max(0.8, t.tree.height * 0.3))) : null;
    }
    case 'furniture': {
      const f = derived.furniture.find((x) => x.id === sel.id);
      return f ? boundsOf(f.footprint) : null;
    }
    case 'structure': {
      const s = derived.structure.find((x) => x.id === sel.id);
      if (!s) return null;
      switch (s.kind) {
        case 'post':
          return boundsOf(square(s.position, s.size / 2));
        case 'beam':
          return boundsOf([s.a, s.b]);
        case 'chimney':
          return boundsOf([s.min, s.max]);
        case 'stair':
          return boundsOf(s.footprint);
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// "Avstand fra hjørne" (§3.7)
// ---------------------------------------------------------------------------

export interface CornerDimension {
  /** On the crossing wall's face (or the host's end when nothing crosses). */
  a: Vec2;
  /** On the opening's near jamb. */
  b: Vec2;
  /** |a − b| in metres. */
  distance: number;
  /** Which face line of the host the dimension runs along. */
  side: 'left' | 'right';
}

/** Parameter interval [t0, t1] along the line o + t·u where it crosses polygon `poly`, or null. */
function lineChord(o: Vec2, u: Vec2, poly: readonly Vec2[]): [number, number] | null {
  let t0 = Infinity;
  let t1 = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const q0 = poly[i];
    const e = sub(poly[(i + 1) % poly.length], q0);
    const denom = cross(u, e);
    if (Math.abs(denom) < 1e-12) continue;
    const w = sub(q0, o);
    const s = cross(w, u) / denom;
    if (s < -1e-9 || s > 1 + 1e-9) continue;
    const t = cross(w, e) / denom;
    t0 = Math.min(t0, t);
    t1 = Math.max(t1, t);
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/** How far beyond the host's ends a crossing wall may lie and still count. */
const CROSS_REACH = 0.6;
/** Distance (m) of the measuring line beyond the host's face, so it runs through the room, not the wall. */
const FACE_EPS = 0.005;

/**
 * "Avstand fra hjørne" of an opening: from the face of the nearer crossing wall (one that meets the host's line;
 * collinear and parallel walls do not count) to the opening's near jamb, measured along a line just beyond one of
 * the host's faces (the side where a crossing wall is nearest; the left side wins ties, which is the inside for an
 * exterior wall). Without any crossing wall the host's nearer end is used. Null for an unknown opening.
 */
export function openingCornerDimension(derived: Pick<DerivedVariant, 'walls' | 'levels'>, openingId: Id): CornerDimension | null {
  const hit = findOpening(derived, openingId);
  if (!hit) return null;
  const { wall: host, opening } = hit;
  const u = unit(host.a, host.b);
  if (!u) return null;
  const n: Vec2 = [-u[1], u[0]];
  const L = dist(host.a, host.b);
  const e0 = opening.offset - opening.width / 2;
  const e1 = opening.offset + opening.width / 2;
  const storeyId = derived.levels.find((l) => l.id === opening.levelId)?.storeyId;
  const others = derived.walls.filter(
    (w) => w.id !== host.id && !w.isDivider && !w.isGhost && w.footprint.length >= 3 && (storeyId === undefined || w.storeyIds.includes(storeyId)),
  );
  let best: CornerDimension | null = null;
  for (const side of ['left', 'right'] as const) {
    const d = (side === 'left' ? host.faceLeft : -host.faceRight) + (side === 'left' ? FACE_EPS : -FACE_EPS);
    const o = add(host.a, n, d);
    for (const w of others) {
      const uw = unit(w.a, w.b);
      if (!uw || Math.abs(cross(u, uw)) < 0.1) continue;
      const chord = lineChord(o, u, w.footprint);
      if (!chord) continue;
      const [t0, t1] = chord;
      if (t1 < -CROSS_REACH || t0 > L + CROSS_REACH) continue;
      if (t1 <= e0 + 1e-6) {
        const distance = e0 - t1;
        if (!best || distance < best.distance - 1e-9) best = { a: add(o, u, t1), b: add(o, u, e0), distance, side };
      } else if (t0 >= e1 - 1e-6) {
        const distance = t0 - e1;
        if (!best || distance < best.distance - 1e-9) best = { a: add(o, u, t0), b: add(o, u, e1), distance, side };
      }
    }
  }
  if (best) return best;
  const o = add(host.a, n, host.faceLeft + FACE_EPS);
  return e0 <= L - e1 ? { a: o, b: add(o, u, e0), distance: Math.max(0, e0), side: 'left' } : { a: add(o, u, L), b: add(o, u, e1), distance: Math.max(0, L - e1), side: 'left' };
}
