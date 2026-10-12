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
 *
 * Small things at small zooms (UX review of phase 2a, second fix round):
 *  - Handles never hide what they belong to: with the screen scale given, the end handles of walls and openings sit
 *    just OUTSIDE their ends (`anchor` = the end / jamb they act on; the plan maps the pointer by anchor − p, so a
 *    drag acts as if the end itself was grabbed), so they are left out only when the two would run into each other:
 *    a length under END_HANDLE_MIN_DIAMETERS handle diameter on screen (`endHandlesShown`). Corner and edge handles
 *    drawn ON the object (a block's vertices and edge midpoints, an exterior piece's two corners) still need
 *    HANDLE_MIN_DIAMETERS diameters (the smaller side of the block's box, the piece's edge length;
 *    `cornerHandlesShown`). Decks keep their handles.
 *  - `pressTarget` decides what a press on the selection grabs: a press inside the object's own body
 *    (`pressInBody`: an opening's footprint, a stored wall's footprint between its ends, an exterior piece away from
 *    its end vertices, a block's axis polygon away from its outline by one handle radius) moves the object even when
 *    it lands on a handle; handles win only outside the body.
 *  - Touch: the wall / opening hit band (`hitBandPx`) is TOUCH_BAND_MAX_M wide in plan metres, but never narrower than
 *    TOUCH_BAND_MIN_PX (a finger must be able to hit a wall at the starting zoom) nor wider than 24 px. The plan draws
 *    the room-label hit areas BELOW the walls, openings and ghosts, so inside that band the wall wins and elsewhere a
 *    tap on a room's name selects the room.
 *  - Placed units (`tapSelection`): a tap on the room of a block made from a template that holds one room selects the
 *    block first (Roter 90° · Slett, body drag), the next tap the room; without it the unit could only be reselected
 *    through Egenskaper → "Velg bygningsdelen".
 *  - Dør/vindu: `freeOpeningOffset` moves a new opening that would overlap an existing one on the same wall piece (along
 *    the wall and in height, like the 'opening-overlap' warning) to the nearest free centre on the 10 cm grid (1 cm
 *    with Alt) within the piece; with no free place it keeps the tapped centre (the warning shows the overlap).
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

/** Touch: the wall / opening hit band is this wide (plan metres) between its pixel floor and ceiling. */
export const TOUCH_BAND_MAX_M = 0.25;
/**
 * Touch: … but never narrower than this on screen (px, ±5 px around the line), so a finger can select a wall, a door
 * or a ghost at the phone's starting zoom (11,6 px/m). 10 rather than 12: at 11,6 px/m all of «Bod (ny)» lies within
 * 5,5 px of a wall line, so with ±6 px its name could no longer be tapped (touchTaps.test.tsx).
 */
export const TOUCH_BAND_MIN_PX = 10;
/** Corner / edge handles drawn ON an object are left out while it is shorter on screen than this many handle diameters. */
export const HANDLE_MIN_DIAMETERS = 3;
/** End handles (just outside a wall's ends / an opening's jambs) are left out below this many diameters of length. */
export const END_HANDLE_MIN_DIAMETERS = 1;

/**
 * Width (screen px) of the invisible wall / opening / ghost hit bands at `scale` px/m: 12 px with a fine pointer; on a
 * coarse pointer TOUCH_BAND_MAX_M in plan metres clamped to [TOUCH_BAND_MIN_PX, 24 px] (zoomed out, 24 px would be
 * metres wide and catch every tap inside a room; 0,25 m alone is ±1,4 px at the phone's starting zoom). Rounded to
 * 0.1 px so the layers only re-render when it changes visibly. The plan shows it as `data-hit-band` on its svg.
 */
export function hitBandPx(coarse: boolean, scale: number): number {
  if (!coarse) return CORRIDOR_PX;
  if (!(Number.isFinite(scale) && scale > 0)) return CORRIDOR_COARSE_PX;
  const band = Math.min(CORRIDOR_COARSE_PX, Math.max(TOUCH_BAND_MIN_PX, TOUCH_BAND_MAX_M * scale));
  return Math.round(band * 10) / 10;
}

/** Snap radius in plan metres for the pointer kind at `scale` px/m (12 px, 24 px coarse; geometry/snap.ts caps lines). */
export function snapRadiusM(coarse: boolean, scale: number): number {
  return pointerSizes(coarse).snap / scale;
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
  /**
   * The point the handle acts on when it is drawn away from it (wall ends and opening jambs sit just outside the
   * object): a drag maps the pointer by `anchor − p`. Absent: `p` itself.
   */
  anchor?: Vec2;
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

/** The screen the handles are drawn on: zoom (px/m) and handle radius (px). */
export interface HandleScreen {
  scale: number;
  handleR: number;
}

/**
 * Are the END handles of a wall or an opening `lengthM` long drawn at this screen? They sit one handle radius outside
 * the ends, so they never cover the object; they are left out only when its length on screen is under
 * END_HANDLE_MIN_DIAMETERS handle diameter (the two would run into each other). Without a screen: always.
 */
export function endHandlesShown(lengthM: number, screen?: HandleScreen): boolean {
  return !screen || !(screen.scale > 0) || lengthM * screen.scale >= END_HANDLE_MIN_DIAMETERS * 2 * screen.handleR;
}

/**
 * Are the CORNER / edge handles drawn on an object of size `sizeM` (a block's smaller side, an exterior piece's edge
 * length) shown at this screen? They sit on the object, so it needs HANDLE_MIN_DIAMETERS handle diameters. Without a
 * screen: always.
 */
export function cornerHandlesShown(sizeM: number, screen?: HandleScreen): boolean {
  return !screen || !(screen.scale > 0) || sizeM * screen.scale >= HANDLE_MIN_DIAMETERS * 2 * screen.handleR;
}

/** The smaller side (m) of a polygon's bounding box. */
function minSide(points: readonly Vec2[]): number {
  const b = boundsOf(points);
  return b ? Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1]) : 0;
}

/**
 * End handles of a segment s→e (wall ends 'a' / 'b', opening jambs 'start' / 'end'): with a screen, drawn one handle
 * radius beyond the end (outside the object), acting on the end itself (`anchor`).
 */
function endHandle(end: Vec2, outward: Vec2, screen: HandleScreen | undefined): { p: Vec2; anchor?: Vec2 } {
  if (!screen || !(screen.scale > 0)) return { p: end };
  return { p: add(end, outward, screen.handleR / screen.scale), anchor: end };
}

/**
 * Drag handles of the selection, bottom to top (vertices last, so they win where handles overlap). With `screen`
 * (the plan always passes it), wall / opening end handles sit just outside the ends and are left out only below
 * `endHandlesShown`; corner and edge handles below `cornerHandlesShown` (see the header).
 */
export function handlesFor(derived: Pick<DerivedVariant, 'walls' | 'blocks' | 'outdoor'>, sel: PlanSelection | null, screen?: HandleScreen): PlanHandle[] {
  if (!sel) return [];
  switch (sel.kind) {
    case 'block': {
      const b = derived.blocks.find((x) => x.block.id === sel.id);
      return b && cornerHandlesShown(minSide(b.block.polygon.map((v) => v.p)), screen) ? blockHandles(b, sel) : [];
    }
    case 'blockEdge':
    case 'blockVertex': {
      const b = findBlockOfVertex(derived.blocks, sel.id);
      return b && cornerHandlesShown(minSide(b.block.polygon.map((v) => v.p)), screen) ? blockHandles(b, sel) : [];
    }
    case 'wall': {
      const w = derived.walls.find((x) => x.id === sel.id) ?? derived.walls.find((x) => x.source.kind === 'wall' && x.source.wallId === sel.id);
      if (!w || w.isGhost) return [];
      const src = w.source;
      if (src.kind === 'blockEdge') {
        const poly = derived.blocks.find((x) => x.block.id === src.blockId)?.block.polygon ?? [];
        const i = poly.findIndex((v) => v.id === src.edgeId);
        if (i < 0) return [];
        const ends = [poly[i], poly[(i + 1) % poly.length]];
        if (!cornerHandlesShown(dist(ends[0].p, ends[1].p), screen)) return [];
        return ends.map((v) => {
          const s: PlanSelection = { kind: 'blockVertex', id: v.id };
          return { key: `bv:${v.id}`, shape: 'vertex' as const, p: v.p, drag: s, tap: s, active: false, title: editStrings.handleVertex };
        });
      }
      if (!endHandlesShown(dist(w.a, w.b), screen)) return [];
      const u = unit(w.a, w.b) ?? [1, 0];
      const target: PlanSelection = { kind: 'wall', id: src.wallId };
      return (['a', 'b'] as const).map((end) => ({
        key: `we:${end}`,
        shape: 'end' as const,
        ...endHandle(w[end], end === 'a' ? [-u[0], -u[1]] : u, screen),
        drag: target,
        handle: end,
        tap: null,
        active: false,
        title: editStrings.handleWallEnd,
      }));
    }
    case 'opening': {
      const hit = findOpening(derived, sel.id);
      if (!hit || hit.opening.isGhost) return [];
      const { wall, opening } = hit;
      if (!endHandlesShown(opening.width, screen)) return [];
      const u = unit(wall.a, wall.b) ?? [1, 0];
      const target: PlanSelection = { kind: 'opening', id: opening.id };
      return (['start', 'end'] as const).map((end) => ({
        key: `oe:${end}`,
        shape: 'end' as const,
        ...endHandle(add(wall.a, u, opening.offset + (end === 'start' ? -1 : 1) * (opening.width / 2)), end === 'start' ? [-u[0], -u[1]] : u, screen),
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

/**
 * Tool Velg (editable): what a tap on `tapped` (the element under the pointer) selects. A placed unit — a block made
 * from a template (Nytt bygg) that holds exactly one room — is selected as a whole first, so its mini-bar offers
 * Roter 90° and Slett and a drag moves it; a tap on its room while the unit is selected selects the room (and the
 * next one the unit again). Anything else: `tapped` itself.
 */
export function tapSelection(derived: Pick<DerivedVariant, 'rooms' | 'blocks'>, current: PlanSelection | null, tapped: PlanSelection | null): PlanSelection | null {
  if (!tapped || tapped.kind !== 'room') return tapped;
  const room = derived.rooms.find((r) => r.id === tapped.id && (tapped.levelId === undefined || r.levelId === tapped.levelId));
  const blockId = room?.blockId;
  if (!blockId) return tapped;
  const block = derived.blocks.find((b) => b.block.id === blockId);
  if (!block?.block.template || derived.rooms.filter((r) => r.blockId === blockId).length !== 1) return tapped;
  return current?.kind === 'block' && current.id === blockId ? tapped : { kind: 'block', id: blockId };
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

/** Parameter (m) of p's projection along a → b, and the segment length. */
function along(p: Vec2, a: Vec2, b: Vec2): { s: number; L: number } {
  const L = dist(a, b);
  const u = unit(a, b);
  return { s: u ? (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1] : 0, L };
}

/**
 * Is plan point p inside the selected object's own BODY, where a press moves the object even over a handle?
 * `insetM` = one handle radius in metres: corner / vertex handles keep the band of that width along a block's outline
 * and at the ends of an exterior piece. Openings: their footprint (jamb to jamb); stored walls: their footprint
 * between the ends; other kinds: never (their handles always win).
 */
export function pressInBody(derived: DerivedVariant, sel: PlanSelection | null, p: Vec2, insetM: number): boolean {
  if (!sel) return false;
  switch (sel.kind) {
    case 'opening': {
      const hit = findOpening(derived, sel.id);
      if (!hit || hit.opening.isGhost) return false;
      const { wall, opening } = hit;
      if (opening.footprint.length >= 3) return pointInPolygon(p, opening.footprint);
      const { s } = along(p, wall.a, wall.b);
      const half = opening.width / 2;
      return s > opening.offset - half && s < opening.offset + half && distancePointSegment(p, wall.a, wall.b) <= Math.max(wall.faceLeft, wall.faceRight);
    }
    case 'wall':
    case 'blockEdge': {
      return selectedPieces(derived, sel).some((w) => {
        if (w.isGhost || w.footprint.length < 3 || !pointInPolygon(p, w.footprint)) return false;
        const { s, L } = along(p, w.a, w.b);
        const inset = w.source.kind === 'blockEdge' ? insetM : 0;
        return s > inset && s < L - inset;
      });
    }
    case 'block': {
      const b = derived.blocks.find((x) => x.block.id === sel.id);
      const poly = b?.block.polygon.map((v) => v.p) ?? [];
      if (poly.length < 3 || !pointInPolygon(p, poly)) return false;
      return poly.every((q, i) => distancePointSegment(p, q, poly[(i + 1) % poly.length]) > insetM);
    }
    default:
      return false;
  }
}

/** What a press on the selection grabs: a handle, the body (a move of `target`), or nothing (null: the press pans). */
export type PressTarget = { kind: 'handle'; handle: PlanHandle } | { kind: 'body'; target: PlanSelection } | null;

/**
 * Decide a press (tool Velg, editable): `handle` = the handle under the pointer (DOM), `onSelected` = the pointer is on
 * the selected element's own hit area (DOM). A press inside the object's body moves it even over a handle
 * (`pressInBody`, `insetM` = one handle radius in metres); otherwise a handle wins; otherwise the selected element
 * moves when the press is on it or within `tolM` of its geometry (`hitsSelection`).
 */
export function pressTarget(
  derived: DerivedVariant,
  selection: PlanSelection | null,
  handle: PlanHandle | null,
  onSelected: boolean,
  p: Vec2,
  tolM: number,
  insetM: number,
): PressTarget {
  const body = bodyDragTarget(derived, selection);
  if (handle) {
    if (!handle.drag && !handle.insert) return null;
    if (body && handle.shape !== 'insert' && handle.shape !== 'edge' && pressInBody(derived, selection, p, insetM)) return { kind: 'body', target: body };
    return { kind: 'handle', handle };
  }
  if (!body) return null;
  return onSelected || hitsSelection(derived, selection, p, tolM) ? { kind: 'body', target: body } : null;
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

/** Overlaps up to this much (m) are touching, not overlapping (the 'opening-overlap' warning's tolerance). */
const OPENING_TOUCH = 0.001;

const cleanStep = (v: number) => {
  const c = Math.round(v * 1e6) / 1e6;
  return c === 0 ? 0 : c;
};

/**
 * Dør/vindu: the centre (HOST offset, as `addOpening` takes it) for a new opening of `width` (m) wanted at
 * `hostOffset` on the derived wall piece `wall`, moved off the existing openings of that piece it would overlap
 * along the wall and in height (`z` = the new opening's absolute sill and head; null = every opening counts). The
 * nearest free centre on the `step` grid (clamped into the piece, like the action does) wins; with none free, or no
 * overlap to begin with, `hostOffset` comes back unchanged.
 */
export function freeOpeningOffset(wall: DerivedWall, hostOffset: number, width: number, z: [number, number] | null, step: number): number {
  const s0 = wall.source.kind === 'blockEdge' ? wall.source.s0 : 0;
  const lo = s0 + width / 2;
  const hi = s0 + dist(wall.a, wall.b) - width / 2;
  if (hi < lo - 1e-9) return hostOffset;
  const clamp = (c: number) => Math.min(hi, Math.max(lo, c));
  const busy: [number, number][] = wall.openings
    .filter((o) => !o.isGhost && (!z || Math.min(o.headZ, z[1]) - Math.max(o.sillZ, z[0]) > OPENING_TOUCH))
    .map((o) => [s0 + o.offset - o.width / 2 - width / 2, s0 + o.offset + o.width / 2 + width / 2]);
  const free = (c: number) => busy.every(([a, b]) => c <= a + OPENING_TOUCH || c >= b - OPENING_TOUCH);
  const want = clamp(hostOffset);
  if (free(want)) return hostOffset;
  let best: number | null = null;
  for (const [a, b] of busy) {
    for (const c of [cleanStep(Math.floor(a / step + 1e-9) * step), cleanStep(Math.ceil(b / step - 1e-9) * step)].map(clamp)) {
      if (free(c) && (best === null || Math.abs(c - want) < Math.abs(best - want) - 1e-9)) best = c;
    }
  }
  return best ?? hostOffset;
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
