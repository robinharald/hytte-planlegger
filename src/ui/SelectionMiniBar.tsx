/**
 * Phone mini-bar (docs/phase2-plan.md §3.1): "Egenskaper · Roter · Slett" floating by the selected element.
 *
 *  - Position (miniBarPlacement.ts `placeMiniBar`, pure): from the selection's screen box, which the plan reports (overlay `anchor`,
 *    PlanView `onSelectionBar`) and reports again when the plan is panned or zoomed and when the page scrolls or
 *    resizes. The bar sits 12 px above the box; when there is no room above it (it would cover the toolbar or the
 *    hint line, or leave the screen) it flips below the box; it never covers the toolbar / hint line or an open
 *    bottom sheet, and stays 8 px inside the screen sideways.
 *  - Hidden while the plan has nothing to anchor to: during a drag (the plan reports null then) and when the
 *    selection is out of view. Only the 3D view (no plan on screen) uses the bottom-centre fallback.
 *  - Shown on phones while something resolvable is selected, not while read-only and not while the Egenskaper
 *    sheet is open (the sheet already covers that).
 *  - Only with Velg (final fix round): while another tool is active (Nytt bygg, Vegg, Dør/vindu, Mål, Møbler with or
 *    without an armed item) the bar is not shown, so a tap meant to place something never lands on its Slett (before:
 *    move a door, then Nytt bygg → Vedskjul, and the tap on the deck deleted the door).
 *  - Egenskaper opens the bottom sheet; Roter for furniture and placed "Nytt bygg" units (commands.ts `canRotate`);
 *    Slett only for what can be deleted. On the locked base proposal Roter / Slett show the refusal toast.
 *  - The room of a placed single-room unit (a Vedskjul's room, commands.ts `unitOfRoom`) also gets the unit's
 *    "Roter 90°" and "Velg bygningsdelen" (selects the unit, which can then be dragged). With four buttons the bar
 *    is compact (`data-compact`: icon above a short label) so it fits a 390 px phone.
 *  - Two fingers reach the plan through the bar (sixth review: the bar of a shed set against the wing covered the
 *    bedroom, and a pinch there did nothing): a touch on the bar stays the bar's (a tap on a button) until a second
 *    finger lands on the bar or the plan, or one already rests on the plan; then each of the bar's fingers is handed
 *    to the plan under it as a pointer-down there (`usePlanPassThrough`), the plan captures it (its own handler,
 *    usePanZoom.ts) and pinches / pans with both fingers. Where the capture does not take, the bar relays the
 *    finger's moves and release. The bar has `touch-action: none` (the browser would otherwise zoom the page and
 *    cancel the fingers), and a click on it is dropped while such a gesture runs and just after it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { nb } from '../i18n/nb';
import { appStore, useAppStore } from '../state/appStore';
import { useDerived } from '../state/useDerived';
import { canRotate, deleteCall, deleteResolved, rotateResolved, rotateUnit, unitOfRoom } from './commands';
import { IconHouse, IconRotate, IconSliders, IconTrash } from './common';
import { useUiEditActions } from './editorBridge';
import { BAR_HEIGHT, BAR_WIDTH, placeMiniBar } from './miniBarPlacement';
import { setPropertiesSheet, usePropertiesSheet, useSelectionAnchor, useSheetInset } from './overlay';
import { toolbarBottom } from './reveal';
import { resolveUiSelection } from './uiSelection';

/** The plan's svg (PlanView.tsx). */
const PLAN_SELECTOR = 'svg[data-testid="plan-view"]';
/** How long (ms) after a gesture handed to the plan a click on the bar is still dropped. */
const CLICK_MUTE_MS = 400;

/** Touch pointers down on the page: id → whether it went down on the plan. Kept while a mini-bar is mounted. */
const touchesDown = new Map<number, boolean>();
/** Pointer events the bar sent to the plan (the trackers ignore them). */
const handedOver = new WeakSet<Event>();
let trackers = 0;

function onTouchDown(e: PointerEvent): void {
  if (e.pointerType !== 'touch' || handedOver.has(e)) return;
  // The first finger of a new touch: anything left over (a release the page never heard) is stale.
  if (e.isPrimary) touchesDown.clear();
  touchesDown.set(e.pointerId, e.target instanceof Element && !!e.target.closest(PLAN_SELECTOR));
}

function onTouchEnd(e: PointerEvent): void {
  if (e.pointerType === 'touch' && !handedOver.has(e)) touchesDown.delete(e.pointerId);
}

function trackTouches(): () => void {
  if (trackers++ === 0) {
    document.addEventListener('pointerdown', onTouchDown, true);
    document.addEventListener('pointerup', onTouchEnd, true);
    document.addEventListener('pointercancel', onTouchEnd, true);
  }
  return () => {
    if (--trackers > 0) return;
    document.removeEventListener('pointerdown', onTouchDown, true);
    document.removeEventListener('pointerup', onTouchEnd, true);
    document.removeEventListener('pointercancel', onTouchEnd, true);
    touchesDown.clear();
  };
}

/** The plan under a viewport point (below the bar), or null; without layout (jsdom) the plan on the page. */
function planUnder(x: number, y: number): SVGSVGElement | null {
  const hits = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
  for (const el of hits) {
    const svg = el.closest<SVGSVGElement>(PLAN_SELECTOR);
    if (svg) return svg;
  }
  return hits.length === 0 ? document.querySelector<SVGSVGElement>(PLAN_SELECTOR) : null;
}

/** Send a touch pointer event to the plan (marked, so the trackers leave it alone). */
function sendToPlan(svg: Element, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', pointerId: number, x: number, y: number): void {
  const pressed = type === 'pointerdown' || type === 'pointermove';
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId, pointerType: 'touch', isPrimary: false, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: pressed ? 1 : 0 });
  handedOver.add(e);
  svg.dispatchEvent(e);
}

/** A finger on the bar: where it is, and the plan it was handed to (`relay`: the bar passes its events on). */
interface BarTouch {
  x: number;
  y: number;
  plan: Element | null;
  relay: boolean;
}

/** Two-finger gestures through the bar to the plan (see the header): the bar's pointer and click handlers. */
function usePlanPassThrough() {
  const touches = useRef(new Map<number, BarTouch>());
  /** Clicks on the bar are dropped until this time (performance.now(); Infinity while a handed-over finger is down). */
  const mute = useRef(0);
  const handOver = () => {
    for (const [id, t] of touches.current) {
      if (t.plan) continue;
      const svg = planUnder(t.x, t.y);
      if (!svg) continue;
      t.plan = svg;
      sendToPlan(svg, 'pointerdown', id, t.x, t.y);
      // The plan captures the pointer in its handler; where that did not take (no capture), the bar relays.
      t.relay = !(typeof svg.hasPointerCapture === 'function' && svg.hasPointerCapture(id));
      mute.current = Infinity;
    }
  };
  const release = (id: number) => {
    touches.current.delete(id);
    if (touches.current.size === 0 && mute.current === Infinity) mute.current = performance.now() + CLICK_MUTE_MS;
  };
  useEffect(() => {
    const untrack = trackTouches();
    const bar = touches.current;
    // A finger lands on the plan while one rests on the bar (after the plan has seen it): the plan gets both.
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || handedOver.has(e) || bar.size === 0) return;
      if (e.target instanceof Element && e.target.closest(PLAN_SELECTOR)) handOver();
    };
    // A handed-over finger the plan captured is released there.
    const onEnd = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && !handedOver.has(e) && bar.has(e.pointerId)) release(e.pointerId);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      // Gone mid-gesture: the plan must not keep a finger it will never hear about again.
      for (const [id, t] of bar) if (t.plan && t.relay) sendToPlan(t.plan, 'pointercancel', id, t.x, t.y);
      bar.clear();
      untrack();
    };
  }, []);
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== 'touch') return;
      if (e.isPrimary) touches.current.clear();
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, plan: null, relay: false });
      // A second finger on the bar, or one already on the plan: the plan gets the gesture.
      for (const [id, onPlan] of touchesDown) if (id !== e.pointerId && (onPlan || touches.current.has(id))) return handOver();
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      const t = touches.current.get(e.pointerId);
      if (!t) return;
      t.x = e.clientX;
      t.y = e.clientY;
      if (t.plan && t.relay) sendToPlan(t.plan, 'pointermove', e.pointerId, t.x, t.y);
    },
    onPointerEnd: (e: ReactPointerEvent<HTMLDivElement>) => {
      const t = touches.current.get(e.pointerId);
      if (!t) return;
      if (t.plan && t.relay) sendToPlan(t.plan, e.type === 'pointercancel' ? 'pointercancel' : 'pointerup', e.pointerId, e.clientX, e.clientY);
      release(e.pointerId);
    },
    onClickCapture: (e: ReactMouseEvent<HTMLDivElement>) => {
      if (performance.now() >= mute.current) return;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}

export function SelectionMiniBar() {
  const derived = useDerived();
  const selection = useAppStore((s) => s.ui.selection);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const planShown = useAppStore((s) => s.ui.activeView !== '3d');
  // An armed library item is the Møbler tool too (toolOptions.furnitureItem is read only with it, and outlives it).
  const placing = useAppStore((s) => s.ui.tool !== 'select');
  const anchor = useSelectionAnchor();
  const sheetOpen = usePropertiesSheet();
  const sheetInset = useSheetInset();
  const actions = useUiEditActions();
  const resolved = useMemo(() => resolveUiSelection(derived, selection), [derived, selection]);
  const unit = useMemo(() => unitOfRoom(resolved, derived), [resolved, derived]);
  const ref = useRef<HTMLDivElement>(null);
  const passThrough = usePlanPassThrough();
  const [size, setSize] = useState({ width: BAR_WIDTH, height: BAR_HEIGHT });
  // Measure the bar once it is on screen (its buttons depend on the selection); jsdom measures 0 and keeps the default.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    if (width > 0 && height > 0 && (width !== size.width || height !== size.height)) setSize({ width, height });
  }, [resolved, anchor, size.width, size.height]);

  if (!resolved || readOnly || sheetOpen || placing) return null;
  // The plan is on screen but reports no anchor: a drag is in progress or the selection is out of view.
  if (planShown && !anchor) return null;

  const deletable = deleteCall(resolved, actions) !== null;
  const rotatable = canRotate(resolved) || !!unit;
  const compact = 1 + Number(rotatable) + Number(!!unit) + Number(deletable) >= 4;
  const placed =
    anchor && typeof window !== 'undefined'
      ? placeMiniBar({
          anchor,
          bar: size,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          chromeBottom: toolbarBottom(),
          floor: window.innerHeight - sheetInset,
        })
      : null;

  return (
    <div
      ref={ref}
      className="mini-bar"
      data-anchored={placed ? true : undefined}
      data-below={placed?.below || undefined}
      data-compact={compact || undefined}
      style={placed ? { left: placed.left, top: placed.top, touchAction: 'none' } : { touchAction: 'none' }}
      role="toolbar"
      aria-label={nb.miniBar.label}
      data-testid="mini-bar"
      onPointerDown={passThrough.onPointerDown}
      onPointerMove={passThrough.onPointerMove}
      onPointerUp={passThrough.onPointerEnd}
      onPointerCancel={passThrough.onPointerEnd}
      onClickCapture={passThrough.onClickCapture}
    >
      <button type="button" onClick={() => setPropertiesSheet(true)} data-testid="mini-properties">
        <IconSliders />
        <span>{nb.miniBar.properties}</span>
      </button>
      {rotatable && (
        <button type="button" onClick={() => (unit ? rotateUnit(unit, actions) : rotateResolved(resolved, actions))} data-testid="mini-rotate">
          <IconRotate />
          <span>{resolved.kind === 'block' || unit ? nb.edit.block.rotate : nb.miniBar.rotate}</span>
        </button>
      )}
      {unit && (
        <button type="button" onClick={() => appStore.getState().select({ kind: 'block', id: unit.block.id })} data-testid="mini-select-block">
          <IconHouse />
          <span>{nb.edit.room.selectBlock}</span>
        </button>
      )}
      {deletable && (
        <button type="button" className="danger" onClick={() => deleteResolved(resolved, actions)} data-testid="mini-delete">
          <IconTrash />
          <span>{nb.miniBar.delete}</span>
        </button>
      )}
    </div>
  );
}
