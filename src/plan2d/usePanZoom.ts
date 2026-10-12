/**
 * Pointer gestures of the plan SVG: pan (one-pointer drag), wheel zoom around the cursor, two-finger pinch, taps,
 * and — through an optional `GestureController` — element drags (docs/phase2-plan.md §3.1). The view math lives
 * in viewport.ts.
 *
 * One pointer:
 *  - pointer-down asks `controller.claim(down)` whether the press is on something draggable (the selected element
 *    or a handle); the down target is kept (pointer capture retargets later events to the SVG);
 *  - nothing happens until the pointer moves more than the threshold (5 px mouse / pen, 10 px touch, editModel.ts
 *    `dragThresholdPx`); then a claimed press calls `controller.start(down, now)` — true starts an element drag
 *    (`move` per pointer move, `end` on pointer-up), false (or an unclaimed press) pans, 'block' swallows the rest of
 *    the gesture (no pan, no tap: a refused drag on the locked base proposal);
 *  - a release below the threshold is a tap (`onTap`, with the down target).
 * A second pointer turns the gesture into a pinch (never a tap); an element drag in progress is cancelled first.
 * pointercancel, lostpointercapture (while the pointer is still tracked) and `cancelGesture()` (Esc) cancel: an
 * element drag gets `controller.cancel()`. Mouse/pen moves without a pressed pointer go to `controller.hover`
 * (null when the pointer leaves the SVG). Right-button presses are left to the context menu. No HTML5 drag-and-drop.
 *
 * The wheel listener is attached natively with `passive: false` (React registers wheel as passive, so
 * `preventDefault()` in `onWheel` would not stop the page from scrolling).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { Vec2 } from '../model/types';
import { dragThresholdPx } from './editModel';
import { pan, pinchUpdate, screenToPlan, wheelZoomFactor, zoomAround } from './viewport';
import type { View } from './viewport';

/** Movement (px) below which a mouse pointer down/up counts as a tap (touch: editModel.ts DRAG_THRESHOLD_TOUCH_PX). */
export const TAP_PX = 5;

export interface PointerInfo {
  /** For gestures: the element under the pointer at pointer-down; for hover: the current one. */
  target: Element | null;
  /** SVG-local pixels. */
  screen: Vec2;
  plan: Vec2;
  pointerType: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export type TapInfo = PointerInfo;

/** Element drags on top of pan/zoom (usePlanEditing.ts implements it). */
export interface GestureController {
  /** Pointer-down with one pointer: true when the press may start an element drag. */
  claim(down: PointerInfo): boolean;
  /** A claimed press passed the threshold: start the drag (true), let the gesture pan (false) or swallow it ('block'). */
  start(down: PointerInfo, now: PointerInfo): boolean | 'block';
  move(now: PointerInfo): void;
  end(now: PointerInfo): void;
  cancel(): void;
  hover(now: PointerInfo | null): void;
}

export interface PanZoomHandlers {
  onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onLostPointerCapture: (e: ReactPointerEvent<SVGSVGElement>) => void;
}

interface Gesture {
  down: PointerInfo;
  moved: boolean;
  /** True once a second pointer took part; the gesture then never counts as a tap. */
  multi: boolean;
  /** The controller claimed the press (may become an element drag). */
  claimed: boolean;
  /** An element drag is in progress. */
  dragging: boolean;
  /** The controller swallowed the gesture: it neither pans nor taps. */
  blocked: boolean;
}

function capture(el: Element, id: number, on: boolean): void {
  try {
    if (on && typeof el.setPointerCapture === 'function') el.setPointerCapture(id);
    if (!on && typeof el.hasPointerCapture === 'function' && el.hasPointerCapture(id)) el.releasePointerCapture(id);
  } catch {
    /* capture is best effort (jsdom, detached nodes) */
  }
}

export function usePanZoom(svgRef: RefObject<SVGSVGElement | null>, initial: View, onTap?: (info: TapInfo) => void, controller?: GestureController) {
  const [view, setViewState] = useState<View>(initial);
  /** Source of truth between renders (handlers read it; only `setView` writes it). */
  const viewRef = useRef(initial);
  const pointers = useRef(new Map<number, Vec2>());
  const gesture = useRef<Gesture | null>(null);
  const onTapRef = useRef(onTap);
  const controllerRef = useRef(controller);
  useLayoutEffect(() => {
    onTapRef.current = onTap;
    controllerRef.current = controller;
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

  const info = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>, target: Element | null): PointerInfo => {
      const screen = local(e.clientX, e.clientY);
      return {
        target,
        screen,
        plan: screenToPlan(viewRef.current, screen),
        pointerType: e.pointerType || 'mouse',
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      };
    },
    [local],
  );

  const setView = useCallback((next: View) => {
    viewRef.current = next;
    setViewState(next);
  }, []);

  const getView = useCallback(() => viewRef.current, []);

  /** Cancel an element drag in progress (if any); the gesture is over. */
  const abort = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.dragging) controllerRef.current?.cancel();
    return !!g?.dragging;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      // Mouse: left or middle button; the right button is left to the context menu.
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
      const p = local(e.clientX, e.clientY);
      const wasEmpty = pointers.current.size === 0;
      pointers.current.set(e.pointerId, p);
      if (wasEmpty) {
        const down = info(e, e.target instanceof Element ? e.target : null);
        // Only the primary (left) button grabs elements; the middle button always pans.
        const claimed = e.button === 0 && !!controllerRef.current && controllerRef.current.claim(down);
        gesture.current = { down, moved: false, multi: false, claimed, dragging: false, blocked: false };
      } else if (gesture.current) {
        const g = gesture.current;
        if (g.dragging) controllerRef.current?.cancel();
        g.dragging = false;
        g.blocked = false;
        g.claimed = false;
        g.multi = true;
      }
      capture(e.currentTarget, e.pointerId, true);
    },
    [local, info],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) {
        if (e.pointerType !== 'touch' && pointers.current.size === 0) controllerRef.current?.hover(info(e, e.target instanceof Element ? e.target : null));
        return;
      }
      const p = local(e.clientX, e.clientY);
      const g = gesture.current;
      if (pointers.current.size >= 2) {
        const otherId = [...pointers.current.keys()].find((id) => id !== e.pointerId);
        if (otherId !== undefined) {
          const other = pointers.current.get(otherId)!;
          pointers.current.set(e.pointerId, p);
          setView(pinchUpdate(viewRef.current, prev, other, p, other));
          return;
        }
      }
      if (!g) return;
      if (!g.moved && Math.hypot(p[0] - g.down.screen[0], p[1] - g.down.screen[1]) > dragThresholdPx(g.down.pointerType)) {
        g.moved = true;
        if (g.claimed && controllerRef.current) {
          const started = controllerRef.current.start(g.down, info(e, g.down.target));
          g.dragging = started === true;
          g.blocked = started === 'block';
        }
      }
      if (g.blocked) {
        pointers.current.set(e.pointerId, p);
        return;
      }
      // Below the threshold the stored position stays at pointer-down, so a pan starts without losing the first
      // few pixels.
      if (!g.moved) return;
      pointers.current.set(e.pointerId, p);
      if (g.dragging) {
        controllerRef.current?.move(info(e, g.down.target));
        return;
      }
      setView(pan(viewRef.current, p[0] - prev[0], p[1] - prev[1]));
    },
    [setView, local, info],
  );

  const finish = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) => {
      const had = pointers.current.delete(e.pointerId);
      capture(e.currentTarget, e.pointerId, false);
      if (!had) return;
      const g = gesture.current;
      if (cancelled) {
        // Any cancelled pointer ends the whole gesture (a drag is restored to its base).
        if (g?.dragging) controllerRef.current?.cancel();
        if (g) {
          g.dragging = false;
          g.claimed = false;
          g.multi = true;
        }
        if (pointers.current.size === 0) gesture.current = null;
        return;
      }
      if (pointers.current.size > 0) return;
      gesture.current = null;
      if (!g) return;
      if (g.dragging) {
        controllerRef.current?.end(info(e, g.down.target));
        return;
      }
      if (!g.moved && !g.multi && onTapRef.current) onTapRef.current({ ...info(e, g.down.target) });
    },
    [info],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<SVGSVGElement>) => finish(e, false), [finish]);
  const onPointerCancel = useCallback((e: ReactPointerEvent<SVGSVGElement>) => finish(e, true), [finish]);
  /** Fired after our own release on pointer-up too; it only cancels while the pointer is still tracked. */
  const onLostPointerCapture = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) finish(e, true);
  }, [finish]);
  const onPointerLeave = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    if (pointers.current.size === 0 && e.pointerType !== 'touch') controllerRef.current?.hover(null);
  }, []);

  /** Esc: drop the gesture in progress (an element drag is cancelled). True when a drag was cancelled. */
  const cancelGesture = useCallback(() => {
    const el = svgRef.current;
    if (el) for (const id of pointers.current.keys()) capture(el, id, false);
    pointers.current.clear();
    return abort();
  }, [abort, svgRef]);

  const isDragging = useCallback(() => !!gesture.current?.dragging, []);

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

  const handlers: PanZoomHandlers = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, onLostPointerCapture };
  return { view, setView, getView, handlers, cancelGesture, isDragging };
}
