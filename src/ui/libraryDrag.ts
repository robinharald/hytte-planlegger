/**
 * The gesture of a furniture library item (docs/phase2-plan.md §3.1–3.2: tap to place, or drag into the plan with
 * pointer events — no HTML5 drag-and-drop, it does not work with touch on iOS). A small state machine, no DOM:
 * FurnitureLibrary.tsx feeds it the item's pointer events and does what the callbacks say.
 *
 *  - Mouse / pen: a press that moves DRAG_PX or more is a drag; less is a tap (the button's click places the item).
 *  - Touch: the list must still scroll with a finger, so a drag starts with a LONG PRESS: the finger rests
 *    LONG_PRESS_MS within TOUCH_SLOP_PX (`armed`; the component then stops the page from scrolling), and the next move
 *    drags. A finger that moves before that scrolls the list (the browser cancels the pointer) and is no tap.
 *  - While dragging, every move calls `move`; the release calls `drop`; pointercancel / Esc call `cancel`. The click
 *    that follows a drag is swallowed (`takeClick()` false).
 */

/** Movement (px) of a mouse / pen press before it becomes a drag. */
export const DRAG_PX = 5;
/** A finger resting this long (ms) on an item arms a drag. */
export const LONG_PRESS_MS = 280;
/** A finger may wander this far (px) during the long press. */
export const TOUCH_SLOP_PX = 8;

export interface DragPointer {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  button?: number;
}

export interface LibraryDragCallbacks {
  /** A touch long press armed a drag (feedback: the item lifts). */
  armed?(catalogId: string): void;
  start(catalogId: string, x: number, y: number): void;
  move(catalogId: string, x: number, y: number): void;
  drop(catalogId: string, x: number, y: number): void;
  cancel(catalogId: string): void;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const DEFAULT_TIMERS: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

interface Press {
  catalogId: string;
  pointerId: number;
  touch: boolean;
  x0: number;
  y0: number;
  armed: boolean;
  dragging: boolean;
  timer: unknown;
}

export interface LibraryDrag {
  /** Pointer down on an item. */
  down(catalogId: string, e: DragPointer): void;
  /** Pointer move; true while a drag is (now) in progress — the caller then prevents the default. */
  move(e: DragPointer): boolean;
  /** Pointer up: 'drop' (a drag ended: `drop` was called), 'tap' (a press that stayed put), 'none'. */
  up(e: DragPointer): 'drop' | 'tap' | 'none';
  /** pointercancel / lostpointercapture / Esc / unmount. */
  cancel(): void;
  /** A long press is armed or a drag runs: scrolling must be stopped. */
  holding(): boolean;
  dragging(): boolean;
  /** Should the click that follows this press place the item? False right after a drag (and once only). */
  takeClick(): boolean;
}

export function createLibraryDrag(cb: LibraryDragCallbacks, timers: Timers = DEFAULT_TIMERS): LibraryDrag {
  let press: Press | null = null;
  let swallowClick = false;

  const clearTimer = () => {
    if (press?.timer !== undefined && press.timer !== null) timers.clear(press.timer);
    if (press) press.timer = null;
  };

  return {
    down(catalogId, e) {
      if (press) this.cancel();
      if (e.pointerType === 'mouse' && e.button !== undefined && e.button !== 0) return;
      swallowClick = false;
      const touch = e.pointerType === 'touch';
      const p: Press = { catalogId, pointerId: e.pointerId, touch, x0: e.clientX, y0: e.clientY, armed: !touch, dragging: false, timer: null };
      press = p;
      if (touch) {
        p.timer = timers.set(() => {
          if (press !== p) return;
          p.timer = null;
          p.armed = true;
          cb.armed?.(catalogId);
        }, LONG_PRESS_MS);
      }
    },
    move(e) {
      const p = press;
      if (!p || e.pointerId !== p.pointerId) return false;
      if (p.dragging) {
        cb.move(p.catalogId, e.clientX, e.clientY);
        return true;
      }
      const dist = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
      if (p.touch && !p.armed) {
        // Moved before the long press: the list scrolls, this press is neither a drag nor a tap.
        if (dist > TOUCH_SLOP_PX) {
          clearTimer();
          press = null;
        }
        return false;
      }
      if (!p.touch && dist < DRAG_PX) return false;
      if (p.touch && dist < 1) return true;
      p.dragging = true;
      cb.start(p.catalogId, e.clientX, e.clientY);
      cb.move(p.catalogId, e.clientX, e.clientY);
      return true;
    },
    up(e) {
      const p = press;
      if (!p || e.pointerId !== p.pointerId) return 'none';
      clearTimer();
      press = null;
      if (p.dragging) {
        swallowClick = true;
        cb.drop(p.catalogId, e.clientX, e.clientY);
        return 'drop';
      }
      return 'tap';
    },
    cancel() {
      const p = press;
      if (!p) return;
      clearTimer();
      press = null;
      if (p.dragging) {
        swallowClick = true;
        cb.cancel(p.catalogId);
      }
    },
    holding() {
      return !!press && (press.dragging || (press.touch && press.armed));
    },
    dragging() {
      return !!press && press.dragging;
    },
    takeClick() {
      if (swallowClick) {
        swallowClick = false;
        return false;
      }
      return true;
    },
  };
}
