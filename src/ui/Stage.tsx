/**
 * Centre of the app: the 2D plan and/or the 3D view. "Begge" = side by side from 1100 px (plan left), stacked
 * below (3D first). The 3D view is lazy-loaded and mounted the first time it is shown; after that both panes
 * stay mounted (a hidden pane keeps its size, so the 3D camera and WebGL context survive tab switches).
 * Each pane subscribes only to the ui fields it uses, so e.g. dragging the sun slider does not re-render the plan.
 * `onReady3d` is View3D's onReady (first frame rendered).
 */
import { lazy, Suspense, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { nb } from '../i18n/nb';
import { PlanView } from '../plan2d/PlanView';
import { appStore, useAppStore } from '../state/appStore';
import type { Selection } from '../state/selection';
import { cutHeightFor } from '../state/store';
import { terrainFor, useDerived } from '../state/useDerived';
import { ErrorBoundary, PaneError } from './common';
import { useMediaQuery, useSun, WIDE_QUERY } from './hooks';

const View3D = lazy(() => import('../view3d/View3D').then((m) => ({ default: m.View3D })));

const onSelect = (sel: Selection | null) => appStore.getState().select(sel);

function Pane3D(props: { hidden: boolean; onReady: () => void }) {
  const derived = useDerived();
  const site = useAppStore((s) => s.project.site);
  const sun = useSun();
  const ui = useAppStore(
    useShallow((s) => ({
      mode3d: s.ui.mode3d,
      activeStoreyId: s.ui.activeStoreyId,
      showLabels: s.ui.showLabels,
      highlightNew: s.ui.highlightNew,
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
            highlightNew={ui.highlightNew}
            showTrees={ui.showTrees}
            showTerrain={ui.showTerrain}
            sun={sun}
            preset={ui.preset}
            selection={ui.selection}
            onSelect={onSelect}
            onReady={props.onReady}
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
    })),
  );
  return (
    <section className={`pane pane-plan${props.hidden ? ' is-hidden' : ''}`} aria-label={nb.a11y.planView} aria-hidden={props.hidden}>
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
