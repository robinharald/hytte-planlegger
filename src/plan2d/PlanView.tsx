/**
 * 2D SVG plan view (docs/architecture.md "2D plan" + "Component contracts"; editing: docs/phase2-plan.md §3).
 *
 * - Root `<svg data-testid="plan-view">` with viewBox `0 0 w h` in CSS pixels; all plan geometry sits in one
 *   flipped group `matrix(s 0 0 -s tx ty)` (viewport.ts) so plan +y is up on screen. Text is counter-flipped
 *   per label (ScreenText) so it reads correctly and keeps its pixel size.
 * - Pan by dragging, wheel zoom around the cursor, two-finger pinch; `touch-action: none` (usePanZoom.ts).
 * - Layers bottom → top: grid, decks/hot tubs/trees, block hit areas, floors, room hit areas, furniture (with
 *   clearances when `showClearances`), other storeys' walls (faint), room-label hit areas, walls (union, opening
 *   cuts clipped out) + wall hit areas and corridors, dividers, block-edge ghosts (dashed, with "highlight new" only,
 *   like removed walls and openings), openings, structure, railings/steps, selection outline (room/block), roof
 *   plan (optional), room label text, dimension lines; screen-space north arrow (in the viewport corner that covers
 *   the least of the drawing,
 *   clear of the scale bar and the legend), scale bar, the "Hytta i dag / Nytt / Fjernet" legend (with "highlight
 *   new"), and on top the editing overlay (layers/EditOverlay.tsx: handles, snap feedback, tool previews, temporary
 *   dimensions).
 * - Selection: a tap resolves the nearest `data-sel-kind` ancestor (mapping in selection.ts) and calls
 *   `onSelect`; a tap on empty paper calls `onSelect(null)`. Esc is the app's job, except while the plan has
 *   something in progress (a drag, a wall start, a measurement): then the plan cancels that and calls
 *   `preventDefault()` (usePlanEditing.ts).
 * - Editing (all props optional; without `editable` + `editActions` the plan is the phase-1 viewer, which is what
 *   the locked Forslag D gets — Mål still works there): gestures and tools in usePlanEditing.ts, handles and hit
 *   tests in editModel.ts. `overlay` draws temporary dimensions for the properties panel; `onSelectionBar` reports
 *   where the phone mini-bar goes (top-centre of the selection's screen box plus that box as `rect`, null while
 *   dragging or when nothing visible is selected; called only when it changes, re-checked after every render — so
 *   after every pan and zoom — and once per animation frame on window scroll and resize); `onHint` reports the hint
 *   line text of the active tool. On the locked base proposal a drag that starts on the selection calls `onLocked`
 *   (else the refusing `editActions.beginDrag`) instead of panning. `viewportInsets` keeps the selection out from
 *   under the toolbar / bottom sheet by panning minimally when the selection or the insets change.
 * - Touch: the invisible wall / opening / ghost hit bands are 0.25 m wide in plan metres, but 10–24 px on screen
 *   (editModel.ts `hitBandPx`, shown as `data-hit-band` on the svg), and each drawn room label is a hit area of its
 *   room BELOW them (LabelLayer.tsx `LabelHitLayer`): a tap within ±5 px of a wall, door or ghost selects it, a tap
 *   on a room's name elsewhere selects the room. With "Vis hva som er nytt" the labels keep clear of the ghosts.
 *   A tap on the room of a placed unit selects the unit first, the room on the next tap (editModel.ts
 *   `tapSelection`).
 * - Furniture library drags (no HTML5 drag-and-drop): the library tracks its own pointer and calls the handle's
 *   `furnitureDragOver(catalogId, clientX, clientY)` while moving (a drop marker) and `dropFurniture(…)` on release,
 *   which calls `onDropFurniture(catalogId, planPoint)` when the point is over the plan. `visibleCenter()` gives the
 *   plan point at the middle of the view (tap-to-place without a selected room).
 * - View: fitted to `derived.bounds`, grown by the dimension lines when they are shown, plus a 1.5 m margin —
 *   on mount, when the viewport is first measured and when the variant changes (not on every edit); a
 *   container resize refits while the user has not panned or zoomed since the last fit, else keeps the plan
 *   point at the viewport centre fixed.
 * - Performance: every layer is memoised on data that does not change while panning, so a pan only rewrites
 *   the root transform (the grid re-renders only when the visible rect crosses a 5 m boundary); zooming also
 *   re-renders the scale-dependent layers (labels, dimensions, structure, furniture). The layers' data
 *   (storeyData.ts `planLayerData`) shares every unchanged part with the previous model's (useShared.ts, stable.ts),
 *   so a drag, which derives a new model per frame, re-renders only the layers (and in the wall and opening layers
 *   only the items) whose geometry changed. The editing overlay is in screen space, memoised on its own state, and
 *   re-renders with the view and the drag feedback (it holds a handful of elements).
 * - In jsdom (no layout) the viewport falls back to 1000 × 700 px so tests see a deterministic zoom.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import type { DerivedVariant } from '../model/derived';
import type { Site, Vec2 } from '../model/types';
import type { Selection } from '../state/selection';
import { BlockLayer } from './layers/BlockLayer';
import { DimensionLayer } from './layers/DimensionLayer';
import { EditOverlay } from './layers/EditOverlay';
import type { TempDimension } from './layers/EditOverlay';
import { FloorLayer } from './layers/FloorLayer';
import { FurnitureLayer } from './layers/FurnitureLayer';
import { GridLayer } from './layers/GridLayer';
import { LabelHitLayer, LabelLayer } from './layers/LabelLayer';
import type { PlacedLabel } from './layers/LabelLayer';
import { Legend } from './layers/Legend';
import { OpeningLayer } from './layers/OpeningLayer';
import { OtherStoreyLayer } from './layers/OtherStoreyLayer';
import { OutdoorLayer } from './layers/OutdoorLayer';
import { NorthArrow, ScaleBar } from './layers/Overlays';
import { GhostLayer } from './layers/GhostLayer';
import { RailingLayer } from './layers/RailingLayer';
import { RoofPlanLayer } from './layers/RoofPlanLayer';
import { RoomLayer } from './layers/RoomLayer';
import { SelectionLayer } from './layers/SelectionLayer';
import { StructureLayer } from './layers/StructureLayer';
import { WallLayer } from './layers/WallLayer';
import { NORTH_ARROW_BOX, NORTH_ARROW_MARGIN, fitBounds, legendBox, placeCornerOverlay, scaleBarBox } from './drawing';
import { chipText, mid } from './editFeedback';
import { handlesFor, hitBandPx, openingCornerDimension, pointerSizes, selectionBounds, wallsById } from './editModel';
import type { PlanHandle } from './editModel';
import type { PlanEditActions, PlanOverlay, PlanSelection, PlanTool, PlanToolOptions, SelectionBarAnchor } from './editTypes';
import { labelFonts, layoutRoomLabels } from './labelLayout';
import { planLayerData } from './storeyData';
import { labelDensity } from './svg';
import { planStrings } from './strings';
import { FAINT_OPACITY, FONT, PAPER } from './style';
import { useCoarsePointer } from './useCoarsePointer';
import { useElementSize } from './useElementSize';
import { useShared } from './useShared';
import { usePanZoom } from './usePanZoom';
import { cancelFrame, effectiveTool, nextFrame, usePlanEditing } from './usePlanEditing';
import type { PanZoomBridge } from './usePlanEditing';
import type { View } from './viewport';
import { fitView, pan, planToScreen, revealPan, rootTransform, screenToPlan, snapRectOut, visiblePlanRect } from './viewport';

export interface PlanViewProps {
  derived: DerivedVariant;
  site: Site;
  planStorey: 'ground' | 'loft';
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  showLabels: boolean;
  showDims: boolean;
  showGrid: boolean;
  showRoofPlan: boolean;
  highlightNew: boolean;
  // ---- phase 2 (docs/phase2-plan.md §3); all optional --------------------------------------------------------
  /** Editing allowed (an unlocked proposal). Needs `editActions` too. */
  editable?: boolean;
  /** Active toolbar tool (default 'select'). */
  tool?: PlanTool;
  toolOptions?: PlanToolOptions;
  /** The bound edit API (`useEditActions()`), read structurally (editTypes.ts `PlanEditActions`). */
  editActions?: PlanEditActions;
  /** Draw furniture clearance zones. */
  showClearances?: boolean;
  /** Temporary drawings for the properties panel ("Avstand fra hjørne", room-size wall highlights). */
  overlay?: PlanOverlay;
  /** Phone mini-bar anchor above the selection (screen px), null to hide it. */
  onSelectionBar?: (anchor: SelectionBarAnchor | null) => void;
  /** A placement tool finished (Dør/vindu, Nytt bygg): switch the toolbar back to 'select'. */
  onToolChange?: (tool: PlanTool) => void;
  /** Hint line text for the active tool and its step (null for Velg). */
  onHint?: (hint: string | null) => void;
  /** A furniture item dropped / clicked onto the plan (tool Møbler, or a library drag through the handle). */
  onDropFurniture?: (catalogId: string, planPoint: Vec2) => void;
  /** Force the coarse-pointer sizes (default: the `(pointer: coarse)` media query). */
  coarsePointer?: boolean;
  /**
   * The locked base proposal (`derived.locked`) refused a drag that started on the selected element: show the locked
   * toast. Called once per such gesture, which then neither pans nor drags. Without it the plan asks
   * `editActions.beginDrag`, whose refusal shows the same toast.
   */
  onLocked?: () => void;
  /**
   * Parts of the plan's own box covered by other UI (screen px: the toolbar on top, the bottom sheet below, …). When
   * the selection or the insets change, the plan pans (never zooms) just enough to bring the selection's bounding box
   * into the uncovered part (with a 12 px margin), and does nothing when it already fits.
   */
  viewportInsets?: ViewportInsets;
}

/** See `PlanViewProps.viewportInsets`. */
export interface ViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PlanViewHandle {
  fitView(): void;
  getSvg(): SVGSVGElement | null;
  /** Plan point under a viewport (client) point, or null when it is outside the plan. */
  clientToPlan(clientX: number, clientY: number): Vec2 | null;
  /** Plan point at the centre of the visible plan. */
  visibleCenter(): Vec2;
  /** A furniture library drag moves (catalogId) or ends without a drop (null): shows / hides the drop marker. True when over the plan. */
  furnitureDragOver(catalogId: string | null, clientX: number, clientY: number): boolean;
  /** A furniture library drag is released: `onDropFurniture` when over the plan. True when it was. */
  dropFurniture(catalogId: string, clientX: number, clientY: number): boolean;
  /** Cancel a drag / wall start / measurement in progress (like Esc). True when something was cancelled. */
  cancelInteraction(): boolean;
}

export const FALLBACK_W = 1000;
export const FALLBACK_H = 700;
export const FIT_MARGIN_M = 1.5;
/** Deck boards are drawn from this zoom (px/m) on. */
const DECK_HATCH_MIN_SCALE = 30;
/** Grid extent is snapped to this step (m) so small pans do not rebuild the grid. */
const GRID_SNAP_M = 5;

const NO_HANDLES: PlanHandle[] = [];
const NO_LABELS: readonly PlacedLabel[] = [];
const NO_OPTIONS: PlanToolOptions = {};

function anchorKey(a: SelectionBarAnchor | null): string {
  return a ? [a.x, a.y, a.localX, a.localY, a.box.x0, a.box.y0, a.box.x1, a.box.y1, a.rect.left, a.rect.top].map((v) => Math.round(v)).join(',') : 'none';
}

/** Margin (px) kept between the selection and the edge of the uncovered part of the plan (`viewportInsets`). */
const REVEAL_MARGIN_PX = 12;

const insetsKey = (i: ViewportInsets | undefined) => (i ? [i.top, i.right, i.bottom, i.left].map((v) => Math.round(Number(v) || 0)).join(',') : '');

export const PlanView = forwardRef<PlanViewHandle, PlanViewProps>(function PlanView(props, ref) {
  const { derived, site, planStorey, showLabels, showDims, showGrid, showRoofPlan, highlightNew } = props;
  const selection = (props.selection ?? null) as PlanSelection | null;
  const editActions = props.editActions;
  const editable = !!props.editable && !!editActions;
  const tool = props.tool ?? 'select';
  const toolOptions = props.toolOptions ?? NO_OPTIONS;
  const showClearances = !!props.showClearances;
  const overlay = props.overlay;
  const coarse = useCoarsePointer(props.coarsePointer);
  const sizes = pointerSizes(coarse);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const size = useElementSize(wrapRef);
  const measured = size.w > 0 && size.h > 0;
  const w = measured ? size.w : FALLBACK_W;
  const h = measured ? size.h : FALLBACK_H;
  const bounds = derived.bounds;
  const dimensions = derived.dimensions;
  const fitRect = useMemo(() => (showDims ? fitBounds(bounds, dimensions) : bounds), [showDims, bounds, dimensions]);

  const cb = useRef(props);
  useLayoutEffect(() => {
    cb.current = props;
  });
  const onSelectPlan = useCallback((s: PlanSelection | null) => cb.current.onSelect(s as Selection | null), []);
  const onToolChange = useCallback((t: PlanTool) => cb.current.onToolChange?.(t), []);
  const onHint = useCallback((text: string | null) => cb.current.onHint?.(text), []);
  const onDropFurniture = useCallback((id: string, p: Vec2) => cb.current.onDropFurniture?.(id, p), []);
  const onLocked = useCallback(() => cb.current.onLocked?.(), []);

  // What the layers draw, sharing every unchanged part with the previous model's (useShared.ts): a drag derives a new
  // model per frame, but only the layers whose part changed re-render.
  const data = useShared(useMemo(() => planLayerData(derived, planStorey), [derived, planStorey]));
  const storeyId = data.ctx?.storeyId ?? planStorey;
  const handlesOn = editable && effectiveTool(tool, editable) === 'select';

  const bridge = useRef<PanZoomBridge | null>(null);
  const editing = usePlanEditing({
    derived,
    storeyId,
    pieces: data.pieces,
    selection,
    editable,
    tool,
    toolOptions,
    actions: editActions,
    coarse,
    bridge,
    onSelect: onSelectPlan,
    onToolChange,
    onHint,
    onDropFurniture,
    onLocked: props.onLocked ? onLocked : undefined,
  });

  const { view, setView, getView, handlers, cancelGesture } = usePanZoom(svgRef, fitView(fitRect, w, h, FIT_MARGIN_M), editing.onTap, editing.controller);
  // Handles depend on the zoom: those of objects too small on screen are left out (editModel.ts `handlesFor`).
  const scale = view.s;
  const handles = useMemo(
    () => (handlesOn ? handlesFor(derived, selection, { scale, handleR: sizes.handleR }) : NO_HANDLES),
    [handlesOn, derived, selection, scale, sizes.handleR],
  );
  const handlesRef = useRef<readonly PlanHandle[]>(handles);
  useLayoutEffect(() => {
    handlesRef.current = handles;
  }, [handles]);
  useLayoutEffect(() => {
    bridge.current = { getView, cancelGesture, getHandles: () => handlesRef.current };
  }, [getView, cancelGesture]);
  // Touch: wall / opening / ghost hit bands 0.25 m wide in plan metres, 10–24 px on screen (editModel.ts `hitBandPx`).
  const band = hitBandPx(coarse, scale);

  /** The view the last fit produced; while it is still current the user has not panned or zoomed. */
  const fittedView = useRef<View | null>(null);
  const fit = useCallback(() => {
    const next = fitView(fitRect, w, h, FIT_MARGIN_M);
    fittedView.current = next;
    setView(next);
  }, [fitRect, w, h, setView]);

  // Fit on mount, when the viewport is first measured and when the variant changes (not on every edit). A
  // container resize (Plan / Begge, a hidden pane shown, a phone rotated) refits while the user has not panned or
  // zoomed since the last fit; otherwise it keeps the plan point at the viewport centre where it was.
  const fitKey = `${derived.variantId}|${measured}`;
  const lastFitKey = useRef<string | null>(null);
  const lastSize = useRef<Vec2 | null>(null);
  useLayoutEffect(() => {
    const prev = lastSize.current;
    lastSize.current = [w, h];
    if (lastFitKey.current !== fitKey) {
      lastFitKey.current = fitKey;
      fit();
    } else if (prev && (prev[0] !== w || prev[1] !== h) && getView() === fittedView.current) {
      fit();
    } else if (prev && (prev[0] !== w || prev[1] !== h)) {
      setView(pan(getView(), (w - prev[0]) / 2, (h - prev[1]) / 2));
    }
  }, [fitKey, w, h, fit, getView, setView]);

  const clientToPlan = useCallback(
    (clientX: number, clientY: number): Vec2 | null => {
      const el = svgRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const width = r.width || w;
      const height = r.height || h;
      const x = clientX - r.left;
      const y = clientY - r.top;
      if (!(x >= 0 && y >= 0 && x <= width && y <= height)) return null;
      return screenToPlan(getView(), [x, y]);
    },
    [w, h, getView],
  );

  const { setDropPreview, cancel } = editing;
  useImperativeHandle(
    ref,
    () => ({
      fitView: fit,
      getSvg: () => svgRef.current,
      clientToPlan,
      visibleCenter: () => screenToPlan(getView(), [w / 2, h / 2]),
      furnitureDragOver: (catalogId, clientX, clientY) => {
        const p = catalogId === null ? null : clientToPlan(clientX, clientY);
        setDropPreview(p);
        return p !== null;
      },
      dropFurniture: (catalogId, clientX, clientY) => {
        const p = clientToPlan(clientX, clientY);
        setDropPreview(null);
        if (!p || !cb.current.onDropFurniture) return false;
        cb.current.onDropFurniture(catalogId, p);
        return true;
      },
      cancelInteraction: cancel,
    }),
    [fit, clientToPlan, getView, w, h, setDropPreview, cancel],
  );

  // Phone mini-bar anchor: top-centre of the selection's screen box (clamped to the view) and the box itself in
  // viewport pixels, only when it changes; checked after every render (pans and zooms re-render) and once per frame
  // on window scroll / resize (the plan's box moves on the page without a render).
  const dragging = editing.overlay.dragging;
  const lastAnchor = useRef<string | null>(null);
  const anchorInput = useRef({ derived, selection, dragging, w, h });
  const reportAnchor = useCallback(() => {
    const report = cb.current.onSelectionBar;
    if (!report) return;
    const { derived: d, selection: sel, dragging: busy, w: W, h: H } = anchorInput.current;
    let anchor: SelectionBarAnchor | null = null;
    const b = busy ? null : selectionBounds(d, sel);
    if (b) {
      const v = getView();
      const p0 = planToScreen(v, b.min);
      const p1 = planToScreen(v, b.max);
      const box = { x0: Math.min(p0[0], p1[0]), y0: Math.min(p0[1], p1[1]), x1: Math.max(p0[0], p1[0]), y1: Math.max(p0[1], p1[1]) };
      if (box.x1 >= 0 && box.y1 >= 0 && box.x0 <= W && box.y0 <= H) {
        const localX = Math.min(W, Math.max(0, (box.x0 + box.x1) / 2));
        const localY = Math.min(H, Math.max(0, box.y0));
        const r = svgRef.current?.getBoundingClientRect();
        const left = r?.left ?? 0;
        const top = r?.top ?? 0;
        anchor = { x: left + localX, y: top + localY, localX, localY, box, rect: { left: left + box.x0, top: top + box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 } };
      }
    }
    const key = anchorKey(anchor);
    if (key === lastAnchor.current) return;
    lastAnchor.current = key;
    report(anchor);
  }, [getView]);
  useEffect(() => {
    anchorInput.current = { derived, selection, dragging, w, h };
    reportAnchor();
  });
  useEffect(() => {
    let id: number | null = null;
    const onMove = () => {
      if (id !== null) return;
      id = nextFrame(() => {
        id = null;
        reportAnchor();
      });
    };
    window.addEventListener('scroll', onMove, { capture: true, passive: true });
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
      if (id !== null) cancelFrame(id);
    };
  }, [reportAnchor]);

  // Keep the selection clear of the UI covering the plan (`viewportInsets`): when the selection or the insets change,
  // pan just enough to bring its bounding box into the uncovered part (never zoom; nothing when it already fits).
  const revealKey = `${selection ? `${selection.kind}:${selection.id}:${selection.levelId ?? ''}` : ''}|${insetsKey(props.viewportInsets)}`;
  const lastReveal = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (lastReveal.current === revealKey) return;
    const insets = cb.current.viewportInsets;
    if (!insets || !selection || dragging) {
      lastReveal.current = revealKey;
      return;
    }
    // A selection the derived model does not have yet (a new element) is revealed on a later render.
    const b = selectionBounds(derived, selection);
    if (!b) return;
    lastReveal.current = revealKey;
    const v = getView();
    const p0 = planToScreen(v, b.min);
    const p1 = planToScreen(v, b.max);
    const box = { x0: Math.min(p0[0], p1[0]), y0: Math.min(p0[1], p1[1]), x1: Math.max(p0[0], p1[0]), y1: Math.max(p0[1], p1[1]) };
    const m = REVEAL_MARGIN_PX;
    const area = { x0: insets.left + m, y0: insets.top + m, x1: w - insets.right - m, y1: h - insets.bottom - m };
    const [dx, dy] = revealPan(box, area);
    if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) setView(pan(v, dx, dy));
  });

  const cornerFor = overlay?.cornerDimensionFor ?? null;
  const extraDims = overlay?.dimensions;
  const panel = overlay?.highlight ?? null;
  const tempDims = useMemo((): TempDimension[] => {
    const out: TempDimension[] = [];
    const corner = cornerFor ? openingCornerDimension(derived, cornerFor) : null;
    if (corner) out.push({ a: corner.a, b: corner.b, text: chipText(corner.distance), kind: 'corner' });
    const extra = [...(extraDims ?? []), ...(panel?.kind === 'dimension' ? [panel] : [])];
    for (const d of extra) out.push({ a: d.a, b: d.b, text: d.text ?? chipText(Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1])), kind: 'extra' });
    return out;
  }, [derived, cornerFor, extraDims, panel]);
  const highlightWalls = overlay?.highlightWalls;
  const highlights = useMemo(
    () =>
      [...(highlightWalls ?? []), ...(panel?.kind === 'wall' ? [panel] : [])].flatMap((hl) =>
        wallsById(derived.walls, hl.wallId).map((wall, i) => ({ footprint: wall.footprint.length >= 3 ? wall.footprint : [wall.a, wall.b], at: mid(wall.a, wall.b), arrow: i === 0 ? hl.arrow : undefined })),
      ),
    [derived, highlightWalls, panel],
  );

  // Room labels, laid out once for the hit areas (below the walls) and the text (on top); with "Vis hva som er nytt"
  // they keep clear of the ghosts too.
  const density = labelDensity(scale);
  const { labelObstacles, ghostObstacles } = data;
  const obstacles = useMemo(() => (highlightNew && ghostObstacles.length > 0 ? [...labelObstacles, ...ghostObstacles] : labelObstacles), [highlightNew, labelObstacles, ghostObstacles]);
  const labels = useShared(
    useMemo(
      () => (showLabels && density !== 'none' ? layoutRoomLabels(data.rooms, density, scale, labelFonts(scale), obstacles) : NO_LABELS),
      [showLabels, density, data.rooms, scale, obstacles],
    ),
  );

  const vis = snapRectOut(visiblePlanRect(view, w, h), GRID_SNAP_M);
  const [gx0, gy0, gx1, gy1] = [vis.min[0], vis.min[1], vis.max[0], vis.max[1]];
  const gridRect = useMemo(() => ({ min: [gx0, gy0] as Vec2, max: [gx1, gy1] as Vec2 }), [gx0, gy0, gx1, gy1]);
  const outdoorActive = data.outdoorActive;

  // North arrow: the corner whose box covers the least of the drawing (the fitted rectangle on screen) and never
  // the scale bar or the legend.
  const scaleBarAt: Vec2 = [16, h - 16];
  const m0 = planToScreen(view, fitRect.min);
  const m1 = planToScreen(view, fitRect.max);
  const north = placeCornerOverlay(
    { x0: Math.min(m0[0], m1[0]), y0: Math.min(m0[1], m1[1]), x1: Math.max(m0[0], m1[0]), y1: Math.max(m0[1], m1[1]) },
    w,
    h,
    NORTH_ARROW_BOX,
    NORTH_ARROW_MARGIN,
    highlightNew ? [scaleBarBox(view.s, scaleBarAt[0], scaleBarAt[1]), legendBox(w, h)] : [scaleBarBox(view.s, scaleBarAt[0], scaleBarAt[1])],
  );

  const activeTool = editing.overlay.tool;

  return (
    <div ref={wrapRef} data-plan-wrap style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden', background: PAPER }}>
      <svg
        ref={svgRef}
        data-testid="plan-view"
        data-plan-storey={data.ctx?.storeyId ?? planStorey}
        data-plan-tool={activeTool}
        data-plan-editable={editable ? 'true' : 'false'}
        data-plan-dragging={dragging ? 'true' : undefined}
        data-scale={Math.round(view.s * 100) / 100}
        data-hit-band={band}
        aria-label={planStrings.planTitle}
        width="100%"
        height="100%"
        viewBox={`0 0 ${w} ${h}`}
        style={{ display: 'block', touchAction: 'none', userSelect: 'none', cursor: activeTool === 'select' ? 'grab' : 'crosshair', fontFamily: FONT }}
        {...handlers}
      >
        <rect data-plan-paper x={0} y={0} width={w} height={h} fill={PAPER} />
        <g data-plan-root transform={rootTransform(view)}>
          {showGrid && <GridLayer rect={gridRect} scale={view.s} />}
          <g opacity={outdoorActive ? undefined : FAINT_OPACITY}>
            <OutdoorLayer
              decks={data.decks}
              hotTubs={data.hotTubs}
              trees={data.trees}
              selection={selection}
              hatch={view.s >= DECK_HATCH_MIN_SCALE}
              selectable={outdoorActive}
            />
          </g>
          <BlockLayer blocks={data.blocks} />
          <FloorLayer floors={data.floors} highlightNew={highlightNew} />
          <RoomLayer rooms={data.rooms} selection={selection} />
          <FurnitureLayer items={data.furniture} selection={selection} scale={view.s} showClearances={showClearances} />
          <OtherStoreyLayer unions={data.otherUnions} />
          <LabelHitLayer labels={labels} scale={scale} />
          <WallLayer unions={data.unions} pieces={data.pieces} dividers={data.dividers} cuts={data.cuts} bounds={data.bounds} highlightNew={highlightNew} selection={selection} corridorPx={band} />
          <GhostLayer ghosts={data.ghosts} highlightNew={highlightNew} selection={selection} corridorPx={band} />
          <OpeningLayer openings={data.openings} highlightNew={highlightNew} selection={selection} corridorPx={band} />
          <StructureLayer elements={data.structure} selection={selection} scale={view.s} stairModes={data.stairModes} />
          <g opacity={outdoorActive ? undefined : FAINT_OPACITY}>
            <RailingLayer railings={data.railings} steps={data.steps} selection={selection} selectable={outdoorActive} corridorPx={sizes.corridor} />
          </g>
          <SelectionLayer rooms={data.rooms} blocks={data.blocks} selection={selection} />
          {showRoofPlan && <RoofPlanLayer roofs={data.roofs} />}
          <LabelLayer labels={labels} scale={scale} highlightNew={highlightNew} />
          {showDims && <DimensionLayer dimensions={data.dimensions} scale={view.s} />}
        </g>
        <NorthArrow bearing={site.planNorthBearing} cx={north[0]} cy={north[1]} />
        <ScaleBar scale={view.s} x={scaleBarAt[0]} y={scaleBarAt[1]} />
        {highlightNew && <Legend width={w} height={h} />}
        <EditOverlay view={view} handles={handles} sizes={sizes} state={editing.overlay} dimensions={tempDims} highlights={highlights} />
      </svg>
    </div>
  );
});

PlanView.displayName = 'PlanView';
