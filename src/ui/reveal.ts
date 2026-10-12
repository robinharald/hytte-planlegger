/** Bringing a side panel into view (used when a schedule row is chosen). */
import { setPropertiesSheet } from './overlay';

/** DOM id of the Egenskaper panel (the schedule reveals it when a row is chosen). */
export const PROPERTIES_PANEL_ID = 'panel-properties';

/**
 * Open the collapsible panel with this DOM id and scroll it into view (nearest edge, smooth unless reduced motion),
 * on the next frame so the content of a new selection has rendered.
 */
export function revealPanel(id: string): void {
  if (typeof document === 'undefined') return;
  const run = () => {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLDetailsElement)) return;
    if (!el.open) el.open = true;
    if (typeof el.scrollIntoView !== 'function') return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else run();
}

/**
 * Show the Egenskaper of a new selection: the side panel when it is on the page (desktop, tablet), else the phone's
 * bottom sheet (on phones the side column has no Egenskaper panel).
 */
export function revealProperties(): void {
  if (typeof document !== 'undefined' && document.getElementById(PROPERTIES_PANEL_ID)) revealPanel(PROPERTIES_PANEL_ID);
  else setPropertiesSheet(true);
}
