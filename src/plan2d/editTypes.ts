/**
 * Types of the plan's editing side (docs/phase2-plan.md §3.1–3.6). Only types, no code.
 *
 * The plan codes against `PlanEditActions`, a STRUCTURAL view of the bound edit API (`useEditActions()` in
 * state/editActions.ts). Every member is an optional METHOD, so:
 *  - parameter types are compared bivariantly (a bound API taking the narrower `Selection` / `DragSession` types is
 *    assignable), and return types are `unknown` (the plan only reads ids and feedback defensively, editFeedback.ts);
 *  - a partly finished API still works: a missing member just disables that interaction.
 *
 * Selection kinds: phase 2 adds 'deckVertex' | 'deckEdge' | 'steps' | 'ghost' (§3.6). Until state/selection.ts has
 * them, the plan uses `PlanSelection` (a superset) and casts at the `onSelect` boundary; once it has them the two
 * types are identical.
 */
import type { Id, OpeningHost, OpeningType, Vec2 } from '../model/types';
import type { Selection } from '../state/selection';

export type PlanSelKind = Selection['kind'] | 'deckVertex' | 'deckEdge' | 'steps' | 'ghost';

/** A selection as the plan emits it (`Selection` plus the phase-2 kinds). */
export interface PlanSelection {
  kind: PlanSelKind;
  id: Id;
  levelId?: Id;
}

/** Toolbar tools (§3.2): Velg · Vegg · Dør/vindu · Nytt bygg · Møbler · Mål. */
export type PlanTool = 'select' | 'wall' | 'opening' | 'unit' | 'furniture' | 'measure';

export interface PlanToolOptions {
  /** Dør/vindu: the opening type the next click places (default 'window'). */
  openingType?: OpeningType;
  /** Nytt bygg: template id ('vedskjul' | 'bod' | 'badstue' | 'anneks' | 'eget'); nothing is placed without one. */
  unitTemplate?: string;
  /** Møbler: catalogue id placed by a click in the plan (`onDropFurniture`). */
  furnitureItem?: string;
  /** Nytt bygg: quarter turns of the ghost; when absent the plan keeps its own (the R key turns it). */
  unitRotation90?: number;
}

/** Which part of the selected element a drag starts from (third argument of `beginDrag`). */
export type PlanDragHandle =
  /** Stored wall endpoint a / b (`moveWallEndpoint`). */
  | 'a'
  | 'b'
  /** Opening jamb nearer the host start / end (resize the width). */
  | 'start'
  | 'end'
  /**
   * The "+" midpoint handle of a deck edge (selection `{ kind: 'deckEdge', id: edgeId }`): insert a vertex at the
   * pointer and drag it in ONE undo step. The session names the new vertex in `selection`; when the actions return no
   * such session the plan falls back to `insertDeckVertex` + a drag of the new vertex.
   */
  | 'insert';

export interface PlanDragModifiers {
  /** Fine grid (0.01 m instead of 0.10 m, §3.3). */
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  /** Snap radius in metres at the current zoom: 12 px (24 px on a coarse pointer). */
  snapRadiusM: number;
  /** Touch or `(pointer: coarse)`. */
  coarse: boolean;
}

/** What a placement tool asks the snapper for (`PlanEditActions.snapPoint`). */
export interface PlanSnapOptions {
  purpose: 'wall' | 'opening' | 'unit' | 'measure' | 'furniture';
  storeyId: Id;
  /** The level whose floor is under the point (model/derived.ts `levelAt`). */
  levelId: Id;
  /** Vegg / Mål: the first point (perpendicular and collinear snaps, length chip). */
  from?: Vec2;
  /** Nytt bygg: template, quarter turns and footprint size (w along the rotated x, d along y) of the ghost. */
  templateId?: string;
  rotation90?: number;
  size?: Vec2;
  modifiers: PlanDragModifiers;
}

/**
 * The bound edit API as the plan uses it (§3.6 names). Results are read loosely:
 *  - `beginDrag` returns the DragSession, or null/undefined/false when nothing can be dragged (the plan then pans);
 *  - `updateDrag` returns `{ indicators, chips, ghost }` (shapes: editFeedback.ts `normalizeFeedback`);
 *  - `addWall` / `addOpening` / `placeUnit` / `insertDeckVertex` return the new id (a string, or `{ id }`), or
 *    null when refused (locked variant: the action itself shows the toast); without an id the plan still works
 *    (it cannot select the new element; a "+" drag picks the new deck vertex up from the next derived model);
 *  - `insertDeckVertex(edgeId, p)`: the edge's deck follows from the vertex id (ids are unique per variant), as in
 *    ui/editorBridge.ts;
 *  - `snapPoint` returns a SnapResult `{ point, indicators, chips }`; without it the plan uses geometry/snap.ts itself
 *    (planSnap.ts), so wiring it is optional.
 */
export interface PlanEditActions {
  beginDrag?(selection: PlanSelection, pointerPlan: Vec2, handle?: PlanDragHandle): unknown;
  updateDrag?(session: unknown, pointerPlan: Vec2, modifiers: PlanDragModifiers): unknown;
  endDrag?(session: unknown): unknown;
  cancelDrag?(session: unknown): unknown;
  addWall?(a: Vec2, b: Vec2, levelId?: Id): unknown;
  addOpening?(host: OpeningHost, offset: number, type: OpeningType): unknown;
  placeUnit?(templateId: string, at: Vec2, rotation90: number): unknown;
  insertDeckVertex?(edgeId: Id, p: Vec2): unknown;
  snapPoint?(p: Vec2, opts: PlanSnapOptions): unknown;
}

/**
 * The properties panel's focus highlight (§3.7), the same shape as ui/overlay.ts `PanelHighlight`, so
 * `overlay={{ highlight: usePanelHighlight() }}` needs no adapter: a wall to highlight with the direction (plan unit
 * vector) it moves in, or a temporary dimension.
 */
export type PlanPanelHighlight = { kind: 'wall'; wallId: Id; arrow?: Vec2 } | { kind: 'dimension'; a: Vec2; b: Vec2; text?: string };

/**
 * Temporary drawings asked for from outside the plan (properties panel focus, §3.7).
 */
export interface PlanOverlay {
  /** The panel's current focus highlight (see PlanPanelHighlight). */
  highlight?: PlanPanelHighlight | null;
  /** Opening id whose "Avstand fra hjørne" is drawn as a temporary dimension (editModel.ts `openingCornerDimension`). */
  cornerDimensionFor?: Id | null;
  /** Extra temporary dimensions in plan metres; `text` defaults to the length ("1,20 m"). */
  dimensions?: readonly { a: Vec2; b: Vec2; text?: string }[];
  /** Walls to highlight (derived wall id or stored wall id), optionally with an arrow in a plan direction (Rom: Bredde/Dybde focus). */
  highlightWalls?: readonly { wallId: Id; arrow?: Vec2 }[];
}

/**
 * Where the phone mini-bar (Egenskaper · Roter · Slett) goes: above the selected element (§3.1). `x` / `y` are
 * viewport (client) pixels, like ui/overlay.ts `ScreenPoint` (`onSelectionBar={setSelectionAnchor}` works as is).
 */
export interface SelectionBarAnchor {
  /** Top-centre of the element's screen box (clamped to the plan), viewport pixels. */
  x: number;
  y: number;
  /** The same point relative to the plan's wrapper element. */
  localX: number;
  localY: number;
  /** The element's screen box (px, wrapper-relative, y down). */
  box: { x0: number; y0: number; x1: number; y1: number };
}

// ---------------------------------------------------------------------------
// Normalised drag / snap feedback (what the overlay draws)
// ---------------------------------------------------------------------------

export interface PlanMarker {
  /** Snap kind for styling ('grid', 'endpoint', 'midpoint', …); free text. */
  kind: string;
  p: Vec2;
}

export interface PlanGuide {
  kind: string;
  a: Vec2;
  b: Vec2;
}

/** Dimension chip: a measured span a → b (optional) with its text, drawn at `at`. */
export interface PlanChip {
  a?: Vec2;
  b?: Vec2;
  at: Vec2;
  text: string;
}

export interface PlanFeedback {
  markers: PlanMarker[];
  guides: PlanGuide[];
  chips: PlanChip[];
  /** Outline(s) of the moving element: rings of 3+ points are drawn closed, 2-point rings as segments. */
  ghost: Vec2[][];
}
