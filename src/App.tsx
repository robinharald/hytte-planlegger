/**
 * App shell (architecture.md "UI", docs/phase2-plan.md §3.2 / §6): banners · top bar · headline numbers ·
 * [controls | toolbar + hint line + stage | side panels], toasts, dialogs, keyboard shortcuts and the
 * `window.__hytte` test hook.
 *
 *  - The left column is the furniture library while the Møbler tool is active (desktop / tablet); on phones the
 *    library is a bottom sheet instead, and so are the properties (opened from the floating mini-bar).
 *  - The edit actions reach every component through `EditActionsProvider` (ui/editorBridge.ts): `EditorActionsRoot`
 *    provides the editor core's bound actions (state/editActions.ts) through `uiEditActionsFrom` (a typed no-op
 *    `rotateBlock` for a core without it).
 *  - An edit that gives a new warning shows it once as a toast with "Vis" (ui/warningToasts.ts).
 *
 * `window.__hytte.ready` turns true after View3D's first frame (onReady), or right after mount when the 3D view
 * is not shown (plan only), and then stays true.
 */
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { nb } from './i18n/nb';
import { leaveSharedView, reloadPage, resetToSeed, useAppStore } from './state/appStore';
import { Headline } from './ui/AreaTotals';
import { Banners } from './ui/Banners';
import { ErrorBoundary } from './ui/common';
import { Controls } from './ui/Controls';
import { HelpDialog } from './ui/Dialogs';
import { useEditActions } from './state/editActions';
import { EditActionsProvider, uiEditActionsFrom, useTool, useUiEditActions } from './ui/editorBridge';
import type { UiEditActions } from './ui/editorBridge';
import { FirstRunCard } from './ui/FirstRunCard';
import { FurnitureLibrary } from './ui/FurnitureLibrary';
import { HintLine } from './ui/HintLine';
import { PHONE_QUERY, useKeyboardShortcuts, useMediaQuery, useTestHook } from './ui/hooks';
import { LibraryPanel, LibrarySheet } from './ui/LibraryPanel';
import { PropertiesSheet } from './ui/PropertiesPanel';
import { SelectionMiniBar } from './ui/SelectionMiniBar';
import { SidePanels } from './ui/SidePanels';
import { Stage } from './ui/Stage';
import { Toasts } from './ui/Toasts';
import { Toolbar } from './ui/Toolbar';
import { TopBar } from './ui/TopBar';
import { useNewWarningToasts } from './ui/warningToasts';
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

/** Provides the editor core's bound actions (state/editActions.ts `useEditActions`) to the whole UI. */
function EditorActionsRoot(props: { children: ReactNode }) {
  const core = useEditActions();
  const actions: UiEditActions = useMemo(() => uiEditActionsFrom(core), [core]);
  return <EditActionsProvider actions={actions}>{props.children}</EditActionsProvider>;
}

function Shell() {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const activeView = useAppStore((s) => s.ui.activeView);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const tool = useTool();
  const actions = useUiEditActions();
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [ready3d, setReady3d] = useState(false);
  // Plan-only view: ready right away (published to window.__hytte after mount by useTestHook).
  const [planOnlySeen, setPlanOnlySeen] = useState(activeView === 'plan');
  if (activeView === 'plan' && !planOnlySeen) setPlanOnlySeen(true);
  const ready = ready3d || planOnlySeen;
  const closeDialog = useCallback(() => setDialog(null), []);
  const onReady3d = useCallback(() => setReady3d(true), []);
  const library = tool === 'furniture' && !readOnly;

  useKeyboardShortcuts(actions);
  useTestHook(ready);
  useNewWarningToasts();

  return (
    <div className="app" data-readonly={readOnly || undefined}>
      <Banners />
      <TopBar onOpen={setDialog} />
      <Headline />
      <div className="workspace" data-tool={tool}>
        {library && !isPhone ? (
          <LibraryPanel>
            <FurnitureLibrary />
          </LibraryPanel>
        ) : (
          <Controls isPhone={isPhone} />
        )}
        <div className="stage-col">
          <Toolbar />
          <HintLine />
          <Stage onReady3d={onReady3d} />
          <FirstRunCard />
        </div>
        <SidePanels isPhone={isPhone} />
      </div>
      {isPhone && <SelectionMiniBar />}
      {isPhone && <PropertiesSheet />}
      {isPhone && library && (
        <LibrarySheet>
          <FurnitureLibrary variant="sheet" />
        </LibrarySheet>
      )}
      <Toasts />
      {dialog === 'help' && <HelpDialog onClose={closeDialog} />}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary fallback={(error, reset) => <AppError error={error} reset={reset} />}>
      <EditorActionsRoot>
        <Shell />
      </EditorActionsRoot>
    </ErrorBoundary>
  );
}
