/** Where the toasts go while the first-run card is open (Toasts.tsx). Pure. */

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
