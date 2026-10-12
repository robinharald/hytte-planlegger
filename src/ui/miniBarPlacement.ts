/**
 * Where the phone mini-bar goes (SelectionMiniBar.tsx), pure: from the selection's screen box the plan reports
 * (overlay.ts `SelectionAnchor`), 12 px above it; below it when there is no room above (it would cover the toolbar /
 * hint line or leave the screen); never over the toolbar / hint line or an open bottom sheet; 8 px inside the screen.
 */
import type { SelectionAnchor } from './overlay';

/** Bar size used before it is measured (px). */
export const BAR_WIDTH = 260;
export const BAR_HEIGHT = 50;
/** Distance between the bar and the selection, and from the screen edges / the toolbar (px). */
const GAP = 12;
const MARGIN = 8;

export interface MiniBarInput {
  anchor: SelectionAnchor;
  bar: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Bottom of the toolbar + hint line in viewport px (0 when they are scrolled away). */
  chromeBottom: number;
  /** Top of an open bottom sheet in viewport px (default: the bottom of the viewport). */
  floor?: number;
}

export interface MiniBarPlacement {
  /** Centre x and top y of the bar, viewport px. */
  left: number;
  top: number;
  below: boolean;
}

/** The selection's screen box in viewport px (a point when the plan reports no box). */
function viewportBox(a: SelectionAnchor): { x0: number; y0: number; x1: number; y1: number } {
  if (a.rect) return { x0: a.rect.left, y0: a.rect.top, x1: a.rect.left + a.rect.width, y1: a.rect.top + a.rect.height };
  if (a.box && a.localX !== undefined && a.localY !== undefined) {
    const dx = a.x - a.localX;
    const dy = a.y - a.localY;
    return { x0: a.box.x0 + dx, y0: a.box.y0 + dy, x1: a.box.x1 + dx, y1: a.box.y1 + dy };
  }
  return { x0: a.x, y0: a.y, x1: a.x, y1: a.y };
}

/** Where the bar goes (see the header). Pure. */
export function placeMiniBar(input: MiniBarInput): MiniBarPlacement {
  const { bar, viewport } = input;
  const box = viewportBox(input.anchor);
  const minTop = Math.max(MARGIN, input.chromeBottom + MARGIN);
  const maxBottom = (input.floor ?? viewport.height) - MARGIN;
  const above = box.y0 - GAP - bar.height;
  const belowTop = box.y1 + GAP;
  let top: number;
  let below = false;
  if (above >= minTop) top = above;
  else if (belowTop + bar.height <= maxBottom) {
    top = belowTop;
    below = true;
  } else top = Math.max(minTop, Math.min(above, maxBottom - bar.height));
  const cx = input.anchor.rect || (input.anchor.box && input.anchor.localX !== undefined) ? (box.x0 + box.x1) / 2 : input.anchor.x;
  const half = bar.width / 2;
  const left = Math.min(Math.max(cx, half + MARGIN), Math.max(half + MARGIN, viewport.width - half - MARGIN));
  return { left, top, below };
}
