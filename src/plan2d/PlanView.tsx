/**
 * 2D SVG plan view (docs/architecture.md "2D plan" + "Component contracts").
 *
 * - Root `<svg data-testid="plan-view">` with viewBox `0 0 w h` in CSS pixels; all plan geometry sits in one
 *   flipped group `matrix(s 0 0 -s tx ty)` (viewport.ts) so plan +y is up on screen. Text is counter-flipped
 *   per label (ScreenText) so it reads correctly and keeps its pixel size.
 * - Pan by dragging (any pointer), wheel zoom around the cursor, two-finger pinch; `touch-action: none`.
 * - Layers bottom → top: grid, decks/hot tubs/trees, block hit areas, floors, room hit areas, other storeys'
 *   walls (faint), walls (union, opening cuts clipped out) + wall hit areas, dividers, openings, structure,
 *   railings/steps, selection outline (room/block), roof plan (optional), room labels, dimension lines;
 *   screen-space north arrow (in the viewport corner that covers the least of the drawing) and scale bar.
 * - Selection: a tap resolves the nearest `data-sel-kind` ancestor (mapping in selection.ts) and calls
 *   `onSelect`; a tap on empty paper calls `onSelect(null)`. Esc is the app's job.
 * - View: fitted to `derived.bounds`, grown by the dimension lines when they are shown, plus a 1.5 m margin —
 *   on mount, when the viewport is first measured and when the variant changes (not on every edit); a
 *   container resize refits while the user has not panned or zoomed since the last fit, else keeps the plan
 *   point at the viewport centre fixed.
 * - Performance: every layer is memoised on data that does not change while panning, so a pan only rewrites
 *   the root transform (the grid re-renders only when the visible rect crosses a 5 m boundary); zooming also
 *   re-renders the scale-dependent layers (labels, dimensions, structure).
 * - In jsdom (no layout) the viewport falls back to 1000 × 700 px so tests see a deterministic zoom.
 */
import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import type { DerivedVariant } from '../model/derived';
import type { Site, Vec2 } from '../model/types';
import type { Selection } from '../state/selection';
import { BlockLayer } from './layers/BlockLayer';
import { DimensionLayer } from './layers/DimensionLayer';
import { FloorLayer } from './layers/FloorLayer';
import { GridLayer } from './layers/GridLayer';
import { LabelLayer } from './layers/LabelLayer';
import { OpeningLayer } from './layers/OpeningLayer';
import { OtherStoreyLayer } from './layers/OtherStoreyLayer';
import { OutdoorLayer } from './layers/OutdoorLayer';
import { NorthArrow, ScaleBar } from './layers/Overlays';
import { RailingLayer } from './layers/RailingLayer';
import { RoofPlanLayer } from './layers/RoofPlanLayer';
import { RoomLayer } from './layers/RoomLayer';
import { SelectionLayer } from './layers/SelectionLayer';
import { StructureLayer } from './layers/StructureLayer';
import { WallLayer } from './layers/WallLayer';
import { NORTH_ARROW_BOX, NORTH_ARROW_MARGIN, fitBounds, placeCornerOverlay, scaleBarBox } from './drawing';
import { selectionFromTarget } from './selection';
import { storeyData } from './storeyData';
import { planStrings } from './strings';
import { FAINT_OPACITY, FONT, PAPER } from './style';
import { useElementSize } from './useElementSize';
import { usePanZoom } from './usePanZoom';
import type { TapInfo } from './usePanZoom';
import type { View } from './viewport';
import { fitView, pan, planToScreen, rootTransform, snapRectOut, visiblePlanRect } from './viewport';

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
}

export interface PlanViewHandle {
  fitView(): void;
  getSvg(): SVGSVGElement | null;
}

export const FALLBACK_W = 1000;
export const FALLBACK_H = 700;
export const FIT_MARGIN_M = 1.5;
/** Deck boards are drawn from this zoom (px/m) on. */
const DECK_HATCH_MIN_SCALE = 30;
/** Grid extent is snapped to this step (m) so small pans do not rebuild the grid. */
const GRID_SNAP_M = 5;

export const PlanView = forwardRef<PlanViewHandle, PlanViewProps>(function PlanView(props, ref) {
  const { derived, site, planStorey, selection, onSelect, showLabels, showDims, showGrid, showRoofPlan, highlightNew } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const size = useElementSize(wrapRef);
  const measured = size.w > 0 && size.h > 0;
  const w = measured ? size.w : FALLBACK_W;
  const h = measured ? size.h : FALLBACK_H;
  const bounds = derived.bounds;
  const dimensions = derived.dimensions;
  const fitRect = useMemo(() => (showDims ? fitBounds(bounds, dimensions) : bounds), [showDims, bounds, dimensions]);

  const onSelectRef = useRef(onSelect);
  useLayoutEffect(() => {
    onSelectRef.current = onSelect;
  });
  const onTap = useCallback((info: TapInfo) => onSelectRef.current(selectionFromTarget(info.target)), []);

  const { view, setView, getView, handlers } = usePanZoom(svgRef, fitView(fitRect, w, h, FIT_MARGIN_M), onTap);
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

  useImperativeHandle(ref, () => ({ fitView: fit, getSvg: () => svgRef.current }), [fit]);

  const data = useMemo(() => storeyData(derived, planStorey), [derived, planStorey]);

  const vis = snapRectOut(visiblePlanRect(view, w, h), GRID_SNAP_M);
  const [gx0, gy0, gx1, gy1] = [vis.min[0], vis.min[1], vis.max[0], vis.max[1]];
  const gridRect = useMemo(() => ({ min: [gx0, gy0] as Vec2, max: [gx1, gy1] as Vec2 }), [gx0, gy0, gx1, gy1]);
  const outdoorActive = data.outdoorActive;

  // North arrow: the corner whose box covers the least of the drawing (the fitted rectangle on screen) and never
  // the scale bar.
  const scaleBarAt: Vec2 = [16, h - 16];
  const m0 = planToScreen(view, fitRect.min);
  const m1 = planToScreen(view, fitRect.max);
  const north = placeCornerOverlay(
    { x0: Math.min(m0[0], m1[0]), y0: Math.min(m0[1], m1[1]), x1: Math.max(m0[0], m1[0]), y1: Math.max(m0[1], m1[1]) },
    w,
    h,
    NORTH_ARROW_BOX,
    NORTH_ARROW_MARGIN,
    [scaleBarBox(view.s, scaleBarAt[0], scaleBarAt[1])],
  );

  return (
    <div ref={wrapRef} data-plan-wrap style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden', background: PAPER }}>
      <svg
        ref={svgRef}
        data-testid="plan-view"
        data-plan-storey={data.ctx?.storeyId ?? planStorey}
        data-scale={Math.round(view.s * 100) / 100}
        aria-label={planStrings.planTitle}
        width="100%"
        height="100%"
        viewBox={`0 0 ${w} ${h}`}
        style={{ display: 'block', touchAction: 'none', userSelect: 'none', cursor: 'grab', fontFamily: FONT }}
        {...handlers}
      >
        <rect data-plan-paper x={0} y={0} width={w} height={h} fill={PAPER} />
        <g data-plan-root transform={rootTransform(view)}>
          {showGrid && <GridLayer rect={gridRect} scale={view.s} />}
          <g opacity={outdoorActive ? undefined : FAINT_OPACITY}>
            <OutdoorLayer
              decks={derived.outdoor.decks}
              hotTubs={derived.outdoor.hotTubs}
              trees={derived.site.trees}
              selection={selection}
              hatch={view.s >= DECK_HATCH_MIN_SCALE}
              selectable={outdoorActive}
            />
          </g>
          <BlockLayer blocks={derived.blocks} />
          <FloorLayer floors={data.floors} highlightNew={highlightNew} />
          <RoomLayer rooms={data.rooms} selection={selection} />
          <OtherStoreyLayer unions={data.otherUnions} />
          <WallLayer unions={data.unions} pieces={data.pieces} dividers={data.dividers} cuts={data.cuts} bounds={bounds} highlightNew={highlightNew} selection={selection} />
          <OpeningLayer openings={data.openings} highlightNew={highlightNew} selection={selection} />
          <StructureLayer elements={data.structure} selection={selection} scale={view.s} stairModes={data.stairModes} />
          <g opacity={outdoorActive ? undefined : FAINT_OPACITY}>
            <RailingLayer railings={derived.outdoor.railings} selection={selection} selectable={outdoorActive} />
          </g>
          <SelectionLayer rooms={data.rooms} blocks={derived.blocks} selection={selection} />
          {showRoofPlan && <RoofPlanLayer roofs={derived.roofs} />}
          {showLabels && <LabelLayer rooms={data.rooms} scale={view.s} highlightNew={highlightNew} obstacles={data.labelObstacles} />}
          {showDims && <DimensionLayer dimensions={data.dimensions} scale={view.s} />}
        </g>
        <NorthArrow bearing={site.planNorthBearing} cx={north[0]} cy={north[1]} />
        <ScaleBar scale={view.s} x={scaleBarAt[0]} y={scaleBarAt[1]} />
      </svg>
    </div>
  );
});

PlanView.displayName = 'PlanView';
