/**
 * Where the toasts go: clear of the first-run card (PC, tablet) and of the toolbar and hint line (phones). Pure, but
 * for `watchToolbarMoves` (when to measure again).
 */

/** Gap kept between the toasts and the first-run card (px). */
const CARD_GAP = 8;

/**
 * Bottom offset (px) that keeps the bottom-centred toasts above the first-run card where they would overlap it, or
 * null. Pure: the card's viewport rect, the viewport size and the toasts' width (CSS: min(560px, 100vw − 24px)).
 */
export function toastBottomAvoiding(card: { top: number; left: number; right: number } | null, viewport: { width: number; height: number }): number | null {
  if (!card) return null;
  const width = Math.min(560, viewport.width - 24);
  const left = (viewport.width - width) / 2;
  const right = left + width;
  if (card.right <= left || card.left >= right) return null;
  return Math.max(0, viewport.height - card.top + CARD_GAP);
}

/** Gap kept between the toasts and the toolbar + hint line on phones (px). */
const CHROME_GAP = 8;

/**
 * Phones: top (px) of the toast stack, just below the toolbar and the hint line (`chromeBottom`, their bottom in
 * viewport px: reveal.ts `toolbarBottom`), so a toast never covers Velg, Vegg, Dør/vindu or Angre. null while they
 * are scrolled out of view: the CSS default (the top of the screen, past the notch) then applies.
 */
export function phoneToastTop(chromeBottom: number): number | null {
  return chromeBottom > 0 ? Math.round(chromeBottom + CHROME_GAP) : null;
}

/**
 * What moves the toolbar and the hint line, or changes their size: the page (on phones its height follows its
 * content, so a banner added above them grows it), the top bar with the family banners, the Nøkkeltall line, and the
 * toolbar and the hint line themselves.
 */
const TOOLBAR_MOVERS = '.app, .topbar, [data-testid="headline"], .toolbar-wrap, [data-testid="hint-line"]';

/**
 * Calls `update` whenever the toolbar and hint line may have moved on screen: a scroll (the page or a panel), a resize
 * of the window, or a size change of what is above them (a family banner whose facts arrive a moment after it
 * appears, a second banner, Nøkkeltall wrapping differently) or of themselves. For what sits just below them on a
 * phone (the toasts, «Hva heter du?»), so it never ends up over the tools. Returns the unsubscribe.
 */
export function watchToolbarMoves(update: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('scroll', update, { capture: true, passive: true });
  window.addEventListener('resize', update);
  const observer = typeof ResizeObserver === 'function' && typeof document !== 'undefined' ? new ResizeObserver(() => update()) : null;
  if (observer) for (const el of document.querySelectorAll(TOOLBAR_MOVERS)) observer.observe(el);
  return () => {
    window.removeEventListener('scroll', update, { capture: true });
    window.removeEventListener('resize', update);
    observer?.disconnect();
  };
}
