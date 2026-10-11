/**
 * App-level hooks: media queries, sun position for the chosen date/time, keyboard shortcuts and the `window.__hytte` test hook.
 *
 * Shortcuts (phase 1): Ctrl/Cmd+Z undo, Ctrl/Cmd+Y and Ctrl/Cmd+Shift+Z redo, Esc clears the selection. They are
 * ignored while typing in a text field (the browser's own undo applies there). Open dialogs catch Esc first.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { localInstant, sunInPlan } from '../geometry/geo';
import type { DerivedVariant } from '../model/derived';
import type { Project, Site, Vec3 } from '../model/types';
import { appStore, useAppStore } from '../state/appStore';
import { useDerived } from '../state/useDerived';
import { isEditableTarget, shortcutFor } from './keys';

// ---------------------------------------------------------------------------
// Media queries
// ---------------------------------------------------------------------------

/** Phone layout (architecture.md: < 800 px). */
export const PHONE_QUERY = '(max-width: 799px)';
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

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor(e);
      if (!action || e.defaultPrevented) return;
      if (action !== 'escape' && isEditableTarget(e.target)) return;
      const s = appStore.getState();
      if (action === 'escape') {
        if (s.ui.selection) s.select(null);
        return;
      }
      e.preventDefault();
      if (action === 'undo') s.undo();
      else s.redo();
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
}

declare global {
  interface Window {
    __hytte?: HytteHook;
  }
}

/** Keeps `window.__hytte = { ready, project, derived }` current (architecture.md "Component contracts"). */
export function useTestHook(ready: boolean): void {
  const project = useAppStore((s) => s.project);
  const derived = useDerived();
  useEffect(() => {
    window.__hytte = { ready, project, derived };
  }, [ready, project, derived]);
}
