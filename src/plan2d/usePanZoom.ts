/**
 * Pointer-event pan (drag with any pointer), wheel zoom around the cursor and two-finger pinch for the plan
 * SVG; the math lives in viewport.ts. Taps (pointer down/up within TAP_PX, one pointer) are reported through
 * `onTap` with the element that was under the pointer at pointer-down time (pointer capture retargets later
 * events to the SVG, so the down target is kept).
 *
 * The wheel listener is attached natively with `passive: false` (React registers wheel as passive, so
 * `preventDefault()` in `onWheel` would not stop the page from scrolling).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { Vec2 } from '../model/types';
import { pan, pinchUpdate, screenToPlan, wheelZoomFactor, zoomAround } from './viewport';
import type { View } from './viewport';

/** Movement (px) below which a pointer down/up counts as a tap. */
export const TAP_PX = 5;

export interface TapInfo {
  target: Element | null;
  screen: Vec2;
  plan: Vec2;
  shiftKey: boolean;
}

export interface PanZoomHandlers {
  onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<SVGSVGElement>) => void;
}

interface Gesture {
  startX: number;
  startY: number;
  target: Element | null;
  moved: boolean;
  /** True once a second pointer took part; the gesture then never counts as a tap. */
  multi: boolean;
}

function capture(el: Element, id: number, on: boolean): void {
  try {
    if (on && typeof el.setPointerCapture === 'function') el.setPointerCapture(id);
    if (!on && typeof el.hasPointerCapture === 'function' && el.hasPointerCapture(id)) el.releasePointerCapture(id);
  } catch {
    /* capture is best effort (jsdom, detached nodes) */
  }
}

export function usePanZoom(svgRef: RefObject<SVGSVGElement | null>, initial: View, onTap?: (info: TapInfo) => void) {
  const [view, setViewState] = useState<View>(initial);
  /** Source of truth between renders (handlers read it; only `setView` writes it). */
  const viewRef = useRef(initial);
  const pointers = useRef(new Map<number, Vec2>());
  const gesture = useRef<Gesture | null>(null);
  const onTapRef = useRef(onTap);
  useLayoutEffect(() => {
    onTapRef.current = onTap;
  });

  const local = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const el = svgRef.current;
      if (!el || typeof el.getBoundingClientRect !== 'function') return [clientX, clientY];
      const r = el.getBoundingClientRect();
      return [clientX - r.left, clientY - r.top];
    },
    [svgRef],
  );

  const setView = useCallback((next: View) => {
    viewRef.current = next;
    setViewState(next);
  }, []);

  const getView = useCallback(() => viewRef.current, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      // Mouse: left or middle button pans; the right button is left to the context menu.
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
      const p = local(e.clientX, e.clientY);
      const wasEmpty = pointers.current.size === 0;
      pointers.current.set(e.pointerId, p);
      if (wasEmpty) {
        gesture.current = { startX: p[0], startY: p[1], target: e.target instanceof Element ? e.target : null, moved: false, multi: false };
      } else if (gesture.current) {
        gesture.current.multi = true;
      }
      capture(e.currentTarget, e.pointerId, true);
    },
    [local],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      const p = local(e.clientX, e.clientY);
      const g = gesture.current;
      if (g && !g.moved && Math.hypot(p[0] - g.startX, p[1] - g.startY) > TAP_PX) g.moved = true;
      if (pointers.current.size >= 2) {
        const otherId = [...pointers.current.keys()].find((id) => id !== e.pointerId);
        if (otherId !== undefined) {
          const other = pointers.current.get(otherId)!;
          pointers.current.set(e.pointerId, p);
          setView(pinchUpdate(viewRef.current, prev, other, p, other));
          return;
        }
      }
      // Below the tap threshold the stored position stays at pointer-down, so the drag starts without losing
      // the first few pixels.
      if (!g?.moved) return;
      pointers.current.set(e.pointerId, p);
      setView(pan(viewRef.current, p[0] - prev[0], p[1] - prev[1]));
    },
    [setView, local],
  );

  const finish = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) => {
      const had = pointers.current.delete(e.pointerId);
      capture(e.currentTarget, e.pointerId, false);
      if (!had || pointers.current.size > 0) return;
      const g = gesture.current;
      gesture.current = null;
      if (g && !cancelled && !g.moved && !g.multi && onTapRef.current) {
        const screen = local(e.clientX, e.clientY);
        onTapRef.current({ target: g.target, screen, plan: screenToPlan(viewRef.current, screen), shiftKey: e.shiftKey });
      }
    },
    [local],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<SVGSVGElement>) => finish(e, false), [finish]);
  const onPointerCancel = useCallback((e: ReactPointerEvent<SVGSVGElement>) => finish(e, true), [finish]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      setView(zoomAround(viewRef.current, wheelZoomFactor(e.deltaY, e.deltaMode), p[0], p[1]));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [svgRef, local, setView]);

  const handlers: PanZoomHandlers = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
  return { view, setView, getView, handlers };
}
