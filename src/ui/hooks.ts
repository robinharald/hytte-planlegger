/**
 * App-level hooks: media queries, sun position for the chosen date/time, keyboard shortcuts and the `window.__hytte` test hook.
 *
 * Shortcuts (keys.ts): Ctrl/Cmd+Z undo, Ctrl/Cmd+Y and Ctrl/Cmd+Shift+Z redo; Esc leaves a tool (back to Velg), else
 * clears the selection; R turns the Nytt bygg ghost while that tool is active; Delete / Backspace, R, Ctrl/Cmd+D
 * and the arrow keys act on the selection through the edit
 * actions (commands.ts: refused with the toast on the locked base proposal, nothing while read-only). They are ignored
 * while typing in a text field (the browser's own undo applies there) and inside a dialog; open dialogs catch Esc
 * first, and a field's own Esc (restore) prevents the app's.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { localInstant, sunInPlan } from '../geometry/geo';
import type { DerivedVariant } from '../model/derived';
import type { Project, Site, Vec3 } from '../model/types';
import { lastExport } from '../export/hook';
import type { LastExport } from '../export/hook';
import { appStore, useAppStore } from '../state/appStore';
import { walkProbe } from '../view3d/walkState';
import type { WalkProbe } from '../view3d/walkState';
import type { Selection } from '../state/selection';
import { useDerived } from '../state/useDerived';
import { canRotate, deleteCall, deleteResolved, duplicateResolved, nudgeSelection, resolveCurrent, rotateResolved } from './commands';
import { NOOP_EDIT_ACTIONS, setTool, setToolOptions } from './editorBridge';
import type { UiEditActions } from './editorBridge';
import { isEditableTarget, isInDialog, nudgeDelta, shortcutFor } from './keys';

// ---------------------------------------------------------------------------
// Media queries
// ---------------------------------------------------------------------------

/** Phone layout (architecture.md: < 800 px). */
export const PHONE_QUERY = '(max-width: 799px)';
/** Narrow phones: the top bar folds its file actions into a menu and shows Del lenke / Hjelp as icons. */
export const NARROW_QUERY = '(max-width: 599px)';
/** "Begge" side by side from 1100 px, stacked below. */
export const WIDE_QUERY = '(min-width: 1100px)';

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const m = window.matchMedia(query);
      m.addEventListener('change', onChange);
      return () => m.removeEventListener('change', onChange);
    },
    [query],
  );
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  return useSyncExternalStore(subscribe, get, () => false);
}

// ---------------------------------------------------------------------------
// Sun
// ---------------------------------------------------------------------------

export interface SunInfo {
  /** Unit vector towards the sun, plan frame (x, y, z up). */
  dir: Vec3;
  isUp: boolean;
  altitudeDeg: number;
  bearingDeg: number;
}

const NO_SUN: SunInfo = { dir: [0, 0, 1], isUp: false, altitudeDeg: -90, bearingDeg: 0 };

/** Sun for a local wall-clock date/time at the site (Site.timezone). Never throws. */
export function computeSun(site: Site, sun: { date: string; minutes: number }): SunInfo {
  try {
    const s = sunInPlan(site, localInstant(site, sun.date, sun.minutes));
    if (!s.dir.every(Number.isFinite)) return NO_SUN;
    return { dir: s.dir, isUp: s.isUp, altitudeDeg: s.altitudeDeg, bearingDeg: s.bearingDeg };
  } catch {
    return NO_SUN;
  }
}

export function useSun(): SunInfo {
  const site = useAppStore((s) => s.project.site);
  const sun = useAppStore((s) => s.ui.sun);
  return useMemo(() => computeSun(site, sun), [site, sun]);
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

export function useKeyboardShortcuts(actions: UiEditActions = NOOP_EDIT_ACTIONS): void {
  // The handler is registered once; it always calls the latest actions.
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor(e);
      if (!action || e.defaultPrevented) return;
      if (action !== 'escape' && (isEditableTarget(e.target) || isInDialog(e.target))) return;
      const s = appStore.getState();
      if (action === 'escape') {
        if (s.ui.tool !== 'select') setTool('select');
        else if (s.ui.selection) s.select(null);
        return;
      }
      if (action === 'undo' || action === 'redo') {
        e.preventDefault();
        if (action === 'undo') s.undo();
        else s.redo();
        return;
      }
      if (action === 'rotate' && s.ui.tool === 'unit') {
        e.preventDefault();
        setToolOptions({ unitRotation90: ((s.ui.toolOptions.unitRotation90 ?? 0) + 1) % 4 });
        return;
      }
      const sel = s.ui.selection;
      if (!sel || s.ui.readOnly) return;
      const r = resolveCurrent();
      if (!r) return;
      const acts = actionsRef.current;
      if (action === 'delete') {
        if (!deleteCall(r, acts)) return;
        e.preventDefault();
        deleteResolved(r, acts);
      } else if (action === 'rotate') {
        if (!canRotate(r)) return;
        e.preventDefault();
        rotateResolved(r, acts);
      } else if (action === 'duplicate') {
        if (r.kind !== 'furniture' && !(r.kind === 'block' && r.block.block.isNew)) return;
        e.preventDefault();
        duplicateResolved(r, acts);
      } else {
        const d = nudgeDelta(e);
        if (!d || r.kind === 'ghost' || r.kind === 'structure') return;
        e.preventDefault();
        nudgeSelection(sel, d[0], d[1], acts);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

// ---------------------------------------------------------------------------
// window.__hytte
// ---------------------------------------------------------------------------

export interface HytteHook {
  ready: boolean;
  project: Project;
  derived: DerivedVariant;
  /** The current selection (for the Playwright editing tests). */
  selection: Selection | null;
  /** Phase 3: the last PDF / PNG export (src/export/hook.ts), null before the first. */
  lastExport: LastExport | null;
  /** Phase 3: the walker's pose while «Gå rundt» is on (view3d/walkState.ts `walkProbe`), else null. */
  walk: WalkProbe | null;
}

declare global {
  interface Window {
    __hytte?: HytteHook;
  }
}

/**
 * Keeps `window.__hytte = { ready, project, derived, selection, lastExport, walk }` current (architecture.md "Component
 * contracts"); an export sets `lastExport` on the current object itself (export/hook.ts `publishLastExport`), and a
 * new object carries it over.
 */
export function useTestHook(ready: boolean): void {
  const project = useAppStore((s) => s.project);
  const selection = useAppStore((s) => s.ui.selection);
  const derived = useDerived();
  useEffect(() => {
    window.__hytte = { ready, project, derived, selection, lastExport: lastExport(), walk: walkProbe() };
  }, [ready, project, derived, selection]);
}
