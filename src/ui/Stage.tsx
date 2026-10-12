/**
 * Centre of the app: the 2D plan and/or the 3D view. "Begge" = side by side from 1100 px (plan left), stacked
 * below (3D first). The 3D view is lazy-loaded and mounted the first time it is shown; after that both panes
 * stay mounted (a hidden pane keeps its size, so the 3D camera and WebGL context survive tab switches).
 * Each pane subscribes only to the ui fields it uses, so e.g. dragging the sun slider does not re-render the plan.
 * `onReady3d` is View3D's onReady (first frame rendered).
 *
 * Phase 2: the plan gets the editing props (docs/phase2-plan.md §3.6 `PlanViewProps` += editable, tool, toolOptions,
 * editActions, overlay): editable unless read-only or on the locked base proposal; the tool and its options from the
 * store; the editor core's bound actions; the Egenskaper focus highlight (overlay.ts); the phone mini-bar anchor
 * (`setSelectionAnchor`); the plan's own hint texts (`ui.hint`) and its "back to Velg" after a placement.
 *
 * Phase 2b: a library item dropped on the plan (or placed with the plan's Møbler tool) and one dropped on the 3D view
 * go through the same placer as the library's tap (`useFurniturePlacer`, ui/furniturePlacer.ts): back to the nearest
 * wall within the snap reach, the room's level, selected. A 3D drop passes the level of the floor it hit
 * (view3d/furnitureBuilders.ts `furnitureDropLevel`, imported lazily so three.js stays out of the main bundle).
 *
 * Fix round after 2a:
 *  - 3D colours: the 3D view has its own switch, `highlightNew3d` ("Vis hva som er nytt i 3D", off by default:
 *    natural colours); the plan keeps `highlightNew` (on by default).
 *  - Phones: while a bottom sheet is open the plan gets `viewportInsets` (the parts of its box the sheet, the screen
 *    edges or the toolbar cover; planInsets.ts), so it keeps the selection in the part that is still visible.
 */
import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { nb } from '../i18n/nb';
import { PlanView } from '../plan2d/PlanView';
import type { ViewportInsets } from '../plan2d/PlanView';
import { appStore, useAppStore } from '../state/appStore';
import { useEditActions } from '../state/editActions';
import type { Selection } from '../state/selection';
import { cutHeightFor, selectActiveVariant } from '../state/store';
import { terrainFor, useDerived } from '../state/useDerived';
import { ErrorBoundary, PaneError } from './common';
import { isVariantLocked, setTool, showLockedToast } from './editorBridge';
import type { ToolKind } from './editorBridge';
import { PHONE_QUERY, useMediaQuery, useSun, WIDE_QUERY } from './hooks';
import { setSelectionAnchor, usePanelHighlight, useSheetInset } from './overlay';
import { useFurniturePlacer } from './useFurniturePlacer';
import type { DropHit } from '../view3d/drop';
import { planInsets } from './planInsets';
import { toolbarBottom } from './reveal';
import type { Vec2 } from '../model/types';

const View3D = lazy(() => import('../view3d/View3D').then((m) => ({ default: m.View3D })));

const onSelect = (sel: Selection | null) => appStore.getState().select(sel);
const onToolChange = (tool: ToolKind) => setTool(tool);
const onHint = (hint: string | null) => {
  if (appStore.getState().ui.hint !== hint) appStore.getState().setUi({ hint });
};

/**
 * Phones, while a bottom sheet is open: the parts of the plan's own box that are covered (PlanView `viewportInsets`,
 * screen px): at the bottom by the sheet (and the screen's bottom edge), at the top by the screen's top edge or the
 * toolbar + hint line where they overlap the plan. Kept current while the page scrolls or resizes; undefined when no
 * sheet is open (the plan then never pans by itself).
 */
function usePlanInsets(isPhone: boolean, paneRef: RefObject<HTMLElement | null>): ViewportInsets | undefined {
  const sheet = useSheetInset();
  const active = isPhone && sheet > 0;
  const [insets, setInsets] = useState<ViewportInsets | undefined>(undefined);
  useLayoutEffect(() => {
    if (!active) return;
    const update = () => {
      const el = paneRef.current;
      if (!el) return;
      const next = planInsets(el.getBoundingClientRect(), window.innerHeight, sheet, toolbarBottom());
      setInsets((cur) => (cur && cur.top === next.top && cur.bottom === next.bottom ? cur : next));
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [active, sheet, paneRef]);
  return active ? insets : undefined;
}

function Pane3D(props: { hidden: boolean; onReady: () => void }) {
  const derived = useDerived();
  const place = useFurniturePlacer();
  const onDropFurniture = useCallback(
    (catalogId: string, at: Vec2, hit: DropHit) => {
      void import('../view3d/furnitureBuilders').then(({ furnitureDropLevel }) => {
        place(catalogId, { kind: 'drop', at, levelId: furnitureDropLevel(derived, hit) });
      });
    },
    [place, derived],
  );
  const site = useAppStore((s) => s.project.site);
  const sun = useSun();
  const ui = useAppStore(
    useShallow((s) => ({
      mode3d: s.ui.mode3d,
      activeStoreyId: s.ui.activeStoreyId,
      showLabels: s.ui.showLabels,
      highlightNew3d: s.ui.highlightNew3d,
      showTrees: s.ui.showTrees,
      showTerrain: s.ui.showTerrain,
      preset: s.ui.preset,
      selection: s.ui.selection,
    })),
  );
  return (
    <section className={`pane pane-3d${props.hidden ? ' is-hidden' : ''}`} aria-label={nb.a11y.view3d} aria-hidden={props.hidden}>
      <ErrorBoundary resetKey={derived.variantId} fallback={(error, reset) => <PaneError error={error} reset={reset} />}>
        <Suspense fallback={<div className="pane-message">{nb.app.loading3d}</div>}>
          <View3D
            derived={derived}
            site={site}
            terrain={terrainFor(site)}
            mode={ui.mode3d}
            activeStoreyId={ui.activeStoreyId}
            cutHeight={cutHeightFor(ui.preset)}
            showLabels={ui.showLabels}
            highlightNew={ui.highlightNew3d}
            showTrees={ui.showTrees}
            showTerrain={ui.showTerrain}
            sun={sun}
            preset={ui.preset}
            selection={ui.selection}
            onSelect={onSelect}
            onReady={props.onReady}
            onDropFurniture={onDropFurniture}
          />
        </Suspense>
      </ErrorBoundary>
    </section>
  );
}

function PanePlan(props: { hidden: boolean }) {
  const derived = useDerived();
  const site = useAppStore((s) => s.project.site);
  const ui = useAppStore(
    useShallow((s) => ({
      planStorey: s.ui.planStorey,
      selection: s.ui.selection,
      showLabels: s.ui.showLabels,
      showDims: s.ui.showDims,
      showGrid: s.ui.showGrid,
      showRoofPlan: s.ui.showRoofPlan,
      highlightNew: s.ui.highlightNew,
      tool: s.ui.tool,
      toolOptions: s.ui.toolOptions,
      showClearances: s.ui.showClearances,
      editable: !s.ui.readOnly && !isVariantLocked(selectActiveVariant(s)),
    })),
  );
  const actions = useEditActions();
  const place = useFurniturePlacer();
  const highlight = usePanelHighlight();
  const overlay = useMemo(() => ({ highlight }), [highlight]);
  const isPhone = useMediaQuery(PHONE_QUERY);
  const paneRef = useRef<HTMLElement>(null);
  const insets = usePlanInsets(isPhone, paneRef);
  const onDropFurniture = useCallback((catalogId: string, at: Vec2) => void place(catalogId, { kind: 'drop', at }), [place]);
  return (
    <section ref={paneRef} className={`pane pane-plan${props.hidden ? ' is-hidden' : ''}`} aria-label={nb.a11y.planView} aria-hidden={props.hidden}>
      <ErrorBoundary resetKey={derived.variantId} fallback={(error, reset) => <PaneError error={error} reset={reset} />}>
        <PlanView
          derived={derived}
          site={site}
          planStorey={ui.planStorey}
          selection={ui.selection}
          onSelect={onSelect}
          showLabels={ui.showLabels}
          showDims={ui.showDims}
          showGrid={ui.showGrid}
          showRoofPlan={ui.showRoofPlan}
          highlightNew={ui.highlightNew}
          editable={ui.editable}
          tool={ui.tool}
          toolOptions={ui.toolOptions}
          editActions={actions}
          showClearances={ui.showClearances}
          overlay={overlay}
          onSelectionBar={setSelectionAnchor}
          onToolChange={onToolChange}
          onHint={onHint}
          onLocked={showLockedToast}
          onDropFurniture={onDropFurniture}
          viewportInsets={insets}
        />
      </ErrorBoundary>
    </section>
  );
}

export function Stage(props: { onReady3d: () => void }) {
  const activeView = useAppStore((s) => s.ui.activeView);
  const wide = useMediaQuery(WIDE_QUERY);
  const showPlan = activeView !== '3d';
  const show3d = activeView !== 'plan';
  // Mount the 3D view the first time it is shown, then keep it (state adjusted during render, no effect).
  const [mounted3d, setMounted3d] = useState(show3d);
  if (show3d && !mounted3d) setMounted3d(true);
  const layout = activeView === 'split' ? (wide ? 'row' : 'column') : 'single';

  return (
    <main className="stage" data-view={activeView} data-layout={layout}>
      {mounted3d && <Pane3D hidden={!show3d} onReady={props.onReady3d} />}
      <PanePlan hidden={!showPlan} />
    </main>
  );
}
