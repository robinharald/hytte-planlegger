/** Where the toasts go: clear of the first-run card (PC, tablet) and of the toolbar and hint line (phones). Pure. */

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
