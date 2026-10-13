/**
 * «Avløp og sluk» in the plan (the original brief §5; the rules live in geometry/plumbing.ts): the drain stacks of the
 * storey, a dashed run from every fixture that needs a drain to its stack with the distance in metres, and the
 * fixtures that are too far outlined in red with their distance. Fixtures that use one of today's drains get a small
 * grey mark and no run.
 *
 *  - Stacks: a white circle with a blue ring and dot, screen-constant (STACK_R_PX, larger on touch); a suggested stack
 *    (the proposal stores none on this storey) has a dashed ring.
 *  - Editing (`editable`, an unlocked proposal): a stack is dragged along the walls — every move snaps it to the
 *    nearest wall (`snapStackToWall`, out of openings) and the runs and distances follow live (computed here; no store
 *    change during the drag), and the release calls `onMoveStack(id, p)` once (one undo step; a suggested stack is
 *    stored there). A tap picks a stack: a stored one gets a delete button (`onDeleteStack`), a suggested one its
 *    hint in the plan's hint line (`onHint`); a press anywhere else drops the pick. A press on a stack (with a finger:
 *    on the picked stack only) or the delete button is held for the plan's gesture tracker (usePanZoom.ts
 *    `holdPointer`): it neither pans nor taps, and a second finger still pinches.
 *  - Touch, like furniture («Trykk for å velge, dra det valgte for å flytte»): a finger on a stack that is not picked
 *    is the plan's (a drag pans, a second finger pinches); lifted as a tap (under the plan's 10 px) it picks the
 *    stack. Its touch target is never smaller than the drawn stack (STACK_TOUCH_MIN_PX, so it can be picked at the
 *    starting zoom; fix round 3 after phase 3: 0,25 m was 2,9 px there) and, above that, at most STACK_HIT_MAX_M
 *    around it, so zoomed in a tap on the toilets next to the stack reaches them; the picked stack keeps the larger
 *    target, so it is easy to drag.
 *  - Read-only (Forslag D, a shared link): drawn without hit areas, so taps reach the plan.
 *
 * Drawn in the plan's flipped root group (plan metres), above the walls; screen sizes are divided by `scale`.
 * Distances are written from LABEL_MIN_SCALE px/m on, a far fixture's always.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { nb } from '../../i18n/nb';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { analysePlumbing, snapStackToWall } from '../../geometry/plumbing';
import type { PlumbingFixture, PlumbingStack, VariantPlumbing } from '../../geometry/plumbing';
import type { DerivedVariant } from '../../model/derived';
import type { Id, Vec2 } from '../../model/types';
import { polygonPath } from '../svg';
import { FONT_PX, NSS, PAPER } from '../style';
import { dragThresholdPx } from '../editModel';
import { holdPointer } from '../usePanZoom';
import { COLLISION } from './furnitureLayerModel';
import { ScreenText } from './ScreenText';

/** Ink of stacks and fine runs. */
export const DRAIN_INK = '#2c6e9b';
/** Ink of a fixture on today's drain. */
const TODAY_INK = '#7b8a80';
/** Stack radius (screen px), mouse / touch. */
export const STACK_R_PX = 7;
export const STACK_R_COARSE_PX = 9;
/** Radius (px) of a stack's hit area, mouse / touch. */
export const STACK_HIT_PX = 12;
export const STACK_HIT_COARSE_PX = 16;
/**
 * …but never more than this many metres around the stack, nor less than the drawn stack plus a few px: zoomed out, a
 * full-size hit circle would cover the toilets beside it (the WC's is 0,5 m from the seed's stack), so a press on them
 * picked the stack instead of the toilet.
 */
export const STACK_HIT_MAX_M = 0.25;
const STACK_HIT_MIN_EXTRA_PX = 3;
/** The least radius (px) of a finger's target on a stack that is not picked: the drawn stack (9 px) with its ring. */
const STACK_TOUCH_MIN_PX = 10;
/** The delete button of a picked stack: radius and offset from the stack (px), mouse / touch. */
const DELETE_R_PX = 9;
const DELETE_R_COARSE_PX = 14;
const DELETE_OFFSET_PX = 20;
const DELETE_OFFSET_COARSE_PX = 30;
/** Movement (px) before a press on a stack drags it, mouse / touch. */
const DRAG_PX = 4;
const DRAG_TOUCH_PX = 6;
/** Distances on fine runs are written from this zoom (px/m) on. */
export const LABEL_MIN_SCALE = 20;

export interface PlumbingLayerProps {
  derived: DerivedVariant;
  /** `Variant.plumbing` of the shown proposal. */
  plumbing?: VariantPlumbing | null;
  /** state/plumbingActions.ts `todayWetRoomIds()`. */
  todayRoomIds?: ReadonlySet<Id> | null;
  /** The plan's storey. */
  storeyId: Id;
  /** px per metre. */
  scale: number;
  coarse?: boolean;
  /** Stacks can be dragged, picked and deleted (an unlocked proposal). */
  editable?: boolean;
  clientToPlan?: (clientX: number, clientY: number) => Vec2 | null;
  onMoveStack?: (id: Id, p: Vec2) => void;
  onDeleteStack?: (id: Id) => void;
  /** The hint line's text while a suggested stack is picked (null when none is). */
  onHint?: (text: string | null) => void;
}

interface StackGesture {
  id: Id;
  pointerId: number;
  x: number;
  y: number;
  touch: boolean;
  moved: boolean;
  p: Vec2;
}

const pts = (run: readonly Vec2[]): string => run.map((p) => `${p[0]},${p[1]}`).join(' ');

/** The point halfway along a polyline. */
function midOf(run: readonly Vec2[]): Vec2 {
  const lens = run.slice(1).map((p, i) => Math.hypot(p[0] - run[i][0], p[1] - run[i][1]));
  let left = lens.reduce((s, l) => s + l, 0) / 2;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) {
      const k = lens[i] > 0 ? Math.min(1, left / lens[i]) : 0;
      return [run[i][0] + (run[i + 1][0] - run[i][0]) * k, run[i][1] + (run[i + 1][1] - run[i][1]) * k];
    }
    left -= lens[i];
  }
  return run[0];
}

/** The stored stacks with the dragged one at `p` (a dragged suggestion is added under its own id). */
function withStackAt(plumbing: VariantPlumbing | null | undefined, drag: { id: Id; p: Vec2 }, storeyId: Id): VariantPlumbing {
  const stacks = plumbing?.stacks ?? [];
  if (stacks.some((s) => s.id === drag.id)) return { stacks: stacks.map((s) => (s.id === drag.id ? { ...s, p: drag.p } : s)) };
  return { stacks: [...stacks, { id: drag.id, p: drag.p, storeyId }] };
}

const preventAndHold = (e: ReactPointerEvent<SVGElement>, cancel: () => void) => {
  e.preventDefault();
  holdPointer(e.nativeEvent, cancel);
  try {
    e.currentTarget.setPointerCapture?.(e.pointerId);
  } catch {
    // jsdom, or the pointer is already gone
  }
};

export const PlumbingLayer = memo(function PlumbingLayer(props: PlumbingLayerProps) {
  const { derived, plumbing, todayRoomIds, storeyId, scale, coarse = false, editable = false, clientToPlan, onMoveStack, onDeleteStack, onHint } = props;
  const [drag, setDrag] = useState<{ id: Id; p: Vec2 } | null>(null);
  const [picked, setPicked] = useState<Id | null>(null);
  const gesture = useRef<StackGesture | null>(null);
  const groupRef = useRef<SVGGElement>(null);
  const s = scale > 0 ? scale : 1;

  const shown = useMemo(() => (drag ? withStackAt(plumbing, drag, storeyId) : (plumbing ?? undefined)), [plumbing, drag, storeyId]);
  const analysis = useMemo(() => analysePlumbing(derived, shown, { todayRoomIds }), [derived, shown, todayRoomIds]);
  const stacks = analysis.stacks.filter((x) => x.storeyId === storeyId);
  const fixtures = analysis.fixtures.filter((f) => f.storeyId === storeyId);

  // A press anywhere but on a stack or its delete button drops the pick.
  useEffect(() => {
    if (picked === null) return;
    const onDown = (e: Event) => {
      const g = groupRef.current;
      if (g && e.target instanceof Node && g.contains(e.target) && (e.target as Element).closest?.('[data-drain-hit],[data-drain-delete]')) return;
      setPicked(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [picked]);

  // The hint line says what a picked suggestion is (cleared again when the pick goes).
  const hintFor = editable && picked !== null && stacks.some((x) => x.id === picked && x.suggested) ? nb.plumbing.suggestedNote : null;
  const onHintRef = useRef(onHint);
  useEffect(() => {
    onHintRef.current = onHint;
  }, [onHint]);
  useEffect(() => {
    if (hintFor === null) return;
    onHintRef.current?.(hintFor);
    return () => onHintRef.current?.(null);
  }, [hintFor]);

  // A finger on a stack that is not picked: the plan pans; a tap (no second finger, under the plan's tap distance)
  // picks the stack once it is lifted. The plan's tracker has the pointer captured, so this listens on the window.
  const pending = useRef<{ id: Id; pointerId: number; x: number; y: number } | null>(null);
  useEffect(() => {
    const drop = () => {
      pending.current = null;
    };
    const onDown = (e: PointerEvent) => {
      if (pending.current && e.pointerId !== pending.current.pointerId) drop();
    };
    const onMove = (e: PointerEvent) => {
      const t = pending.current;
      if (t && t.pointerId === e.pointerId && Math.hypot(e.clientX - t.x, e.clientY - t.y) > dragThresholdPx('touch')) drop();
    };
    const onUp = (e: PointerEvent) => {
      const t = pending.current;
      if (!t || t.pointerId !== e.pointerId) return;
      drop();
      if (Math.hypot(e.clientX - t.x, e.clientY - t.y) <= dragThresholdPx('touch')) setPicked(t.id);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', drop, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', drop, true);
    };
  }, []);

  const stackR = (coarse ? STACK_R_COARSE_PX : STACK_R_PX) / s;
  const hitR = Math.max((coarse ? STACK_R_COARSE_PX : STACK_R_PX) + STACK_HIT_MIN_EXTRA_PX, Math.min(coarse ? STACK_HIT_COARSE_PX : STACK_HIT_PX, STACK_HIT_MAX_M * s)) / s;
  /** A finger's target on a stack that is not picked: the drawn stack at least, else at most STACK_HIT_MAX_M (header). */
  const touchHitR = Math.max(STACK_TOUCH_MIN_PX / s, Math.min(STACK_HIT_COARSE_PX / s, STACK_HIT_MAX_M));
  const delR = (coarse ? DELETE_R_COARSE_PX : DELETE_R_PX) / s;
  const delOff = (coarse ? DELETE_OFFSET_COARSE_PX : DELETE_OFFSET_PX) / s;

  const onStackDown = (stack: PlumbingStack) => (e: ReactPointerEvent<SVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const pointerId = e.pointerId;
    if (e.pointerType === 'touch' && picked !== stack.id) {
      // not picked: the plan's press (pan / pinch); a tap picks it (the window listeners above)
      pending.current = { id: stack.id, pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    gesture.current = { id: stack.id, pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch', moved: false, p: stack.p };
    preventAndHold(e, () => {
      if (gesture.current?.pointerId !== pointerId) return;
      gesture.current = null;
      setDrag(null);
    });
  };
  const onStackMove = (e: ReactPointerEvent<SVGElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < (g.touch ? DRAG_TOUCH_PX : DRAG_PX)) return;
    const p = clientToPlan?.(e.clientX, e.clientY);
    if (!p) return;
    g.moved = true;
    g.p = snapStackToWall(derived, storeyId, p)?.p ?? p;
    setDrag({ id: g.id, p: g.p });
  };
  const onStackUp = (e: ReactPointerEvent<SVGElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (g.moved) {
      setDrag(null);
      setPicked(null);
      onMoveStack?.(g.id, g.p);
    } else {
      setPicked((cur) => (cur === g.id ? null : g.id));
    }
  };
  const onStackCancel = (e: ReactPointerEvent<SVGElement>) => {
    if (!gesture.current || gesture.current.pointerId !== e.pointerId) return;
    gesture.current = null;
    setDrag(null);
  };

  if (stacks.length === 0 && fixtures.length === 0) return null;
  const pickedStack = editable && picked ? (stacks.find((x) => x.id === picked) ?? null) : null;

  const label = (f: PlumbingFixture) => {
    if (f.distance === null || f.run.length < 2) return null;
    if (f.state !== 'far' && s < LABEL_MIN_SCALE) return null;
    const at = midOf(f.run);
    const far = f.state === 'far';
    return (
      <ScreenText key={`l-${f.id}`} x={at[0]} y={at[1]} scale={s} data-drain-label={f.id}>
        <text
          x={0}
          y={-4}
          textAnchor="middle"
          fontSize={far ? FONT_PX.name : FONT_PX.detail}
          fontWeight={far ? 600 : 400}
          fill={far ? COLLISION : DRAIN_INK}
          stroke={PAPER}
          strokeWidth={3}
          paintOrder="stroke"
        >
          {nb.plumbing.distance(f.distance)}
        </text>
      </ScreenText>
    );
  };

  return (
    <g ref={groupRef} data-layer="plumbing">
      {fixtures.map((f) =>
        f.state === 'far' ? (
          <path
            key={`far-${f.id}`}
            d={polygonPath(f.footprint)}
            fill={COLLISION}
            fillOpacity={0.12}
            stroke={COLLISION}
            strokeWidth={2.5}
            pointerEvents="none"
            data-drain-far={f.id}
            {...NSS}
          />
        ) : null,
      )}
      {fixtures.map((f) =>
        f.run.length >= 2 ? (
          <polyline
            key={`run-${f.id}`}
            points={pts(f.run)}
            fill="none"
            stroke={f.state === 'far' ? COLLISION : DRAIN_INK}
            strokeWidth={f.state === 'far' ? 2 : 1.5}
            strokeDasharray="6 4"
            strokeLinejoin="round"
            pointerEvents="none"
            data-drain-run={f.id}
            data-drain-state={f.state}
            {...NSS}
          />
        ) : null,
      )}
      {fixtures.map((f) => (
        <circle
          key={`pt-${f.id}`}
          cx={f.point[0]}
          cy={f.point[1]}
          r={(f.state === 'today' ? 3.5 : 2.5) / s}
          fill={f.state === 'today' ? PAPER : f.state === 'far' ? COLLISION : DRAIN_INK}
          stroke={f.state === 'today' ? TODAY_INK : 'none'}
          strokeWidth={1.5}
          pointerEvents="none"
          data-drain-point={f.id}
          data-drain-state={f.state}
          {...NSS}
        >
          {f.state === 'today' && <title>{nb.plumbing.todayDrain}</title>}
        </circle>
      ))}
      {fixtures.map(label)}
      {stacks.map((st) => (
        <g key={st.id} data-drain-stack={st.id} data-drain-suggested={st.suggested ? 'true' : undefined}>
          <circle cx={st.p[0]} cy={st.p[1]} r={stackR} fill={PAPER} stroke={DRAIN_INK} strokeWidth={2} strokeDasharray={st.suggested ? '3 2' : undefined} pointerEvents="none" {...NSS} />
          <circle cx={st.p[0]} cy={st.p[1]} r={stackR * 0.4} fill={DRAIN_INK} pointerEvents="none" />
          {editable && (
            <circle
              cx={st.p[0]}
              cy={st.p[1]}
              r={coarse && picked !== st.id ? touchHitR : hitR}
              fill="transparent"
              // 'fill', not 'all': with 'all' the (unset, 1 m wide) stroke took presses half a metre beyond the circle
              pointerEvents="fill"
              style={{ cursor: drag?.id === st.id ? 'grabbing' : 'grab', touchAction: 'none' }}
              data-drain-hit={st.id}
              onPointerDown={onStackDown(st)}
              onPointerMove={onStackMove}
              onPointerUp={onStackUp}
              onPointerCancel={onStackCancel}
              onLostPointerCapture={onStackCancel}
            >
              <title>{st.suggested ? nb.plumbing.stackSuggested : nb.plumbing.stackStored}</title>
            </circle>
          )}
          {!editable && <title>{nb.plumbing.stackReadOnly}</title>}
        </g>
      ))}
      {pickedStack && !pickedStack.suggested && (
        <g
          data-drain-delete={pickedStack.id}
          style={{ cursor: 'pointer', touchAction: 'none' }}
          onPointerDown={(e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            preventAndHold(e, () => undefined);
          }}
          onPointerUp={() => {
            const id = pickedStack.id;
            setPicked(null);
            onDeleteStack?.(id);
          }}
        >
          <circle cx={pickedStack.p[0] + delOff} cy={pickedStack.p[1] + delOff} r={delR} fill={PAPER} stroke={COLLISION} strokeWidth={2} pointerEvents="all" {...NSS}>
            <title>{nb.plumbing.deleteStack}</title>
          </circle>
          <path
            d={`M${pickedStack.p[0] + delOff - delR * 0.45},${pickedStack.p[1] + delOff - delR * 0.45}L${pickedStack.p[0] + delOff + delR * 0.45},${pickedStack.p[1] + delOff + delR * 0.45}M${pickedStack.p[0] + delOff - delR * 0.45},${pickedStack.p[1] + delOff + delR * 0.45}L${pickedStack.p[0] + delOff + delR * 0.45},${pickedStack.p[1] + delOff - delR * 0.45}`}
            stroke={COLLISION}
            strokeWidth={2}
            strokeLinecap="round"
            pointerEvents="none"
            {...NSS}
          />
        </g>
      )}
    </g>
  );
});
