/** Bringing a side panel into view (used when a schedule row is chosen). */
import { setPropertiesSheet } from './overlay';

/** DOM id of the Egenskaper panel (the schedule reveals it when a row is chosen). */
export const PROPERTIES_PANEL_ID = 'panel-properties';

/** DOM id of the Advarsler panel (the toolbar's warning badge and a new-warning toast's "Vis" reveal it). */
export const WARNINGS_PANEL_ID = 'panel-warnings';

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

/** Open Advarsler and scroll it into view. */
export function revealWarnings(): void {
  revealPanel(WARNINGS_PANEL_ID);
}

/**
 * Phones, when the Egenskaper sheet opens: scroll the page so the toolbar is at the top of the screen and the plan
 * right under it (the sheet covers the bottom; the plan keeps the selection in between, Stage.tsx `viewportInsets`).
 * Instant, so the plan's pan is computed against the final page position. Without a toolbar (read-only) the stage.
 */
export function scrollPlanUnderToolbar(): void {
  if (typeof document === 'undefined') return;
  const el = document.querySelector('.toolbar-wrap') ?? document.querySelector('.stage');
  if (!el || typeof el.scrollIntoView !== 'function') return;
  el.scrollIntoView({ block: 'start', behavior: 'auto' });
}

/** Bottom of the toolbar + hint line in viewport px (0 when scrolled away or absent): the mini-bar and the plan's insets keep clear of it. */
export function toolbarBottom(): number {
  if (typeof document === 'undefined') return 0;
  const els = [document.querySelector('.toolbar-wrap'), document.querySelector('[data-testid="hint-line"]')];
  return Math.max(0, ...els.map((e) => (e ? e.getBoundingClientRect().bottom : 0)));
}
