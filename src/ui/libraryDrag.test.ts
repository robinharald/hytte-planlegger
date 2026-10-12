/**
 * The library item gesture (libraryDrag.ts): mouse drags after 5 px, taps, touch long press before a drag, a finger
 * that moves first scrolls instead, cancel, and the click after a drag swallowed.
 */
import { describe, expect, it, vi } from 'vitest';
import { DRAG_PX, LONG_PRESS_MS, TOUCH_SLOP_PX, createLibraryDrag } from './libraryDrag';
import type { DragPointer, Timers } from './libraryDrag';

function fakeTimers() {
  let pending: { fn: () => void; at: number } | null = null;
  let now = 0;
  const t: Timers & { advance(ms: number): void } = {
    set: (fn, ms) => {
      pending = { fn, at: now + ms };
      return 1;
    },
    clear: () => {
      pending = null;
    },
    advance(ms) {
      now += ms;
      if (pending && pending.at <= now) {
        const p = pending;
        pending = null;
        p.fn();
      }
    },
  };
  return t;
}

const mouse = (x: number, y: number, extra: Partial<DragPointer> = {}): DragPointer => ({ pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, button: 0, ...extra });
const touch = (x: number, y: number): DragPointer => ({ pointerId: 7, pointerType: 'touch', clientX: x, clientY: y });

function setup() {
  const cb = { armed: vi.fn(), start: vi.fn(), move: vi.fn(), drop: vi.fn(), cancel: vi.fn() };
  const timers = fakeTimers();
  return { cb, timers, drag: createLibraryDrag(cb, timers) };
}

describe('mouse', () => {
  it('a press that stays within 5 px is a tap; the click places', () => {
    const { cb, drag } = setup();
    drag.down('stol', mouse(10, 10));
    expect(drag.move(mouse(10 + DRAG_PX - 1, 10))).toBe(false);
    expect(drag.up(mouse(14, 10))).toBe('tap');
    expect(cb.start).not.toHaveBeenCalled();
    expect(drag.takeClick()).toBe(true);
  });

  it('a press that moves 5 px drags: start, moves, drop; the click after it is swallowed once', () => {
    const { cb, drag } = setup();
    drag.down('seng-150', mouse(10, 10));
    expect(drag.move(mouse(10, 10 + DRAG_PX))).toBe(true);
    expect(cb.start).toHaveBeenCalledWith('seng-150', 10, 15);
    expect(drag.dragging()).toBe(true);
    expect(drag.holding()).toBe(true);
    expect(drag.move(mouse(300, 200))).toBe(true);
    expect(cb.move).toHaveBeenLastCalledWith('seng-150', 300, 200);
    expect(drag.up(mouse(310, 210))).toBe('drop');
    expect(cb.drop).toHaveBeenCalledWith('seng-150', 310, 210);
    expect(drag.takeClick()).toBe(false);
    expect(drag.takeClick()).toBe(true);
    expect(drag.dragging()).toBe(false);
  });

  it('ignores other buttons and other pointers', () => {
    const { cb, drag } = setup();
    drag.down('stol', mouse(0, 0, { button: 2 }));
    expect(drag.move(mouse(50, 0))).toBe(false);
    drag.down('stol', mouse(0, 0));
    expect(drag.move({ ...mouse(50, 0), pointerId: 9 })).toBe(false);
    expect(drag.up({ ...mouse(50, 0), pointerId: 9 })).toBe('none');
    expect(cb.start).not.toHaveBeenCalled();
  });

  it('cancel (Esc, pointercancel) ends a drag without a drop', () => {
    const { cb, drag } = setup();
    drag.down('stol', mouse(0, 0));
    drag.move(mouse(20, 0));
    drag.cancel();
    expect(cb.cancel).toHaveBeenCalledWith('stol');
    expect(cb.drop).not.toHaveBeenCalled();
    expect(drag.up(mouse(20, 0))).toBe('none');
    expect(drag.takeClick()).toBe(false);
  });
});

describe('touch', () => {
  it('a long press arms the drag; the next move drags', () => {
    const { cb, timers, drag } = setup();
    drag.down('toalett', touch(100, 500));
    expect(drag.move(touch(102, 501))).toBe(false); // within the slop, not armed yet
    expect(drag.holding()).toBe(false);
    timers.advance(LONG_PRESS_MS);
    expect(cb.armed).toHaveBeenCalledWith('toalett');
    expect(drag.holding()).toBe(true);
    expect(drag.move(touch(150, 300))).toBe(true);
    expect(cb.start).toHaveBeenCalledWith('toalett', 150, 300);
    expect(drag.up(touch(160, 250))).toBe('drop');
    expect(cb.drop).toHaveBeenCalledWith('toalett', 160, 250);
  });

  it('a finger that moves before the long press scrolls the list: no drag, no tap', () => {
    const { cb, timers, drag } = setup();
    drag.down('toalett', touch(100, 500));
    expect(drag.move(touch(100, 500 - TOUCH_SLOP_PX - 1))).toBe(false);
    timers.advance(LONG_PRESS_MS);
    expect(cb.armed).not.toHaveBeenCalled();
    expect(drag.move(touch(100, 300))).toBe(false);
    expect(drag.up(touch(100, 300))).toBe('none');
    expect(cb.start).not.toHaveBeenCalled();
  });

  it('a quick tap is a tap; a long press released in place is a tap too', () => {
    const { cb, timers, drag } = setup();
    drag.down('stol', touch(10, 10));
    expect(drag.up(touch(10, 10))).toBe('tap');
    drag.down('stol', touch(10, 10));
    timers.advance(LONG_PRESS_MS + 50);
    expect(drag.up(touch(10, 10))).toBe('tap');
    expect(cb.start).not.toHaveBeenCalled();
    expect(drag.takeClick()).toBe(true);
  });
});
