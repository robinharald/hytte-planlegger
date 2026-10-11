/**
 * App shell (architecture.md "UI"): banners · top bar · headline numbers · [controls | stage | side panels],
 * dialogs, keyboard shortcuts and the `window.__hytte` test hook.
 *
 * `window.__hytte.ready` turns true after View3D's first frame (onReady), or right after mount when the 3D view
 * is not shown (plan only), and then stays true.
 */
import { useCallback, useState } from 'react';
import { nb } from './i18n/nb';
import { leaveSharedView, reloadPage, resetToSeed, useAppStore } from './state/appStore';
import { Headline } from './ui/AreaTotals';
import { Banners } from './ui/Banners';
import { ErrorBoundary } from './ui/common';
import { Controls } from './ui/Controls';
import { HelpDialog, ShareDialog, VersionsDialog } from './ui/Dialogs';
import { PHONE_QUERY, useKeyboardShortcuts, useMediaQuery, useTestHook } from './ui/hooks';
import { SidePanels } from './ui/SidePanels';
import { Stage } from './ui/Stage';
import { TopBar } from './ui/TopBar';
import type { DialogKind } from './ui/TopBar';

function AppError(props: { error: Error; reset: () => void }) {
  const readOnly = useAppStore((s) => s.ui.readOnly);
  return (
    <div className="error-box" role="alert">
      <h2>{nb.error.heading}</h2>
      <p>{nb.error.body}</p>
      <div className="toolgroup">
        <button type="button" className="btn btn-primary" onClick={reloadPage}>
          {nb.error.reload}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (readOnly) leaveSharedView();
            else resetToSeed();
            props.reset();
          }}
        >
          {nb.error.reset}
        </button>
      </div>
      <details className="explain">
        <summary>{nb.error.details}</summary>
        <pre>{props.error.stack ?? props.error.message}</pre>
      </details>
    </div>
  );
}

function Shell() {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const activeView = useAppStore((s) => s.ui.activeView);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [ready3d, setReady3d] = useState(false);
  // Plan-only view: ready right away (published to window.__hytte after mount by useTestHook).
  const [planOnlySeen, setPlanOnlySeen] = useState(activeView === 'plan');
  if (activeView === 'plan' && !planOnlySeen) setPlanOnlySeen(true);
  const ready = ready3d || planOnlySeen;
  const closeDialog = useCallback(() => setDialog(null), []);
  const onReady3d = useCallback(() => setReady3d(true), []);

  useKeyboardShortcuts();
  useTestHook(ready);

  return (
    <div className="app" data-readonly={readOnly || undefined}>
      <Banners />
      <TopBar onOpen={setDialog} />
      <Headline />
      <div className="workspace">
        <Controls isPhone={isPhone} />
        <Stage onReady3d={onReady3d} />
        <SidePanels isPhone={isPhone} />
      </div>
      {dialog === 'help' && <HelpDialog onClose={closeDialog} />}
      {dialog === 'share' && <ShareDialog onClose={closeDialog} />}
      {dialog === 'versions' && !readOnly && <VersionsDialog onClose={closeDialog} />}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary fallback={(error, reset) => <AppError error={error} reset={reset} />}>
      <Shell />
    </ErrorBoundary>
  );
}
