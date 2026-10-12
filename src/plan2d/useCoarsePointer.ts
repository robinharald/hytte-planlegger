/**
 * `(pointer: coarse)` as a React value (docs/phase2-plan.md §3.1: handles 14 px, corridors and snap radius 24 px on
 * touch screens). `override` (PlanView's `coarsePointer` prop) wins; without matchMedia (jsdom) it is false.
 */
import { useCallback, useSyncExternalStore } from 'react';

export const COARSE_QUERY = '(pointer: coarse)';

function matches(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(COARSE_QUERY).matches : false;
}

export function useCoarsePointer(override?: boolean): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const m = window.matchMedia(COARSE_QUERY);
    if (typeof m.addEventListener !== 'function') return () => {};
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, []);
  const media = useSyncExternalStore(subscribe, matches, () => false);
  return override ?? media;
}
