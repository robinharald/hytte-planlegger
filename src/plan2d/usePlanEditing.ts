/**
 * The plan's editing behaviour (docs/phase2-plan.md §3.1–3.2): element drags through the edit API's drag protocol,
 * the placement tools, hover previews, the hint line and Esc. PlanView owns the rendering; usePanZoom calls the
 * `controller` returned here.
 *
 * Gestures ("Trykk for å velge, dra det valgte for å flytte"), tool Velg with `editable`:
 *  - a press on a drag handle, or on the SELECTED element (editModel.ts `hitsSelection`, or its own hit area), is
 *    claimed (editModel.ts `pressTarget`: a press inside the element's own body moves it even over a handle);
 *    past the threshold `beginDrag(target, pointerDownPlan, handle?)` starts a session — null/false from
 *    `beginDrag` (nothing to drag) lets the gesture pan instead; pointer moves are coalesced to ONE
 *    `updateDrag(session, p, modifiers)` per animation frame (the overlay keeps the last feedback in between; the
 *    first update right at the start, the last position flushed on pointer-up before `endDrag`); pointer-up
 *    `endDrag`; Esc, pointercancel, lostpointercapture and a second finger `cancelDrag` (a queued update is dropped);
 *  - a handle drawn away from the point it acts on (`PlanHandle.anchor`: wall ends and opening jambs sit just outside
 *    the object) shifts every pointer position it passes by `anchor − p`;
 *  - the locked base proposal (`derived.locked`, not editable): a drag that starts on the selected element is an edit
 *    attempt — once it passes the threshold it calls `onLocked()` (else `beginDrag`, which refuses with the locked
 *    toast) once, and the gesture neither pans nor drags;
 *  - a "+" handle inserts a deck vertex (`insertDeckVertex(edgeId, midpoint)`) on a tap (the new vertex is selected
 *    when the action returns its id); a drag from it calls `beginDrag({ kind: 'deckEdge', id: edgeId }, p, 'insert')`,
 *    which inserts and drags in one undo step (the session's `selection` is the new vertex, selected right away);
 *    without such a session it falls back to `insertDeckVertex` and a drag of the new vertex (two undo steps), and
 *    when that action returns no id the drag waits for the next derived model and takes the vertex id that is new there;
 *  - any other press pans; a tap selects (handles: their `tap` selection; a tap on the room of a placed unit selects
 *    the unit first and its room on the next tap, editModel.ts `tapSelection`).
 * Placement tools tap, never drag (a drag pans), and need `editable` (Mål works on the locked base too):
 *  - Vegg: the 1st tap sets the start, the 2nd calls `addWall(start, end, levelAt(midpoint))`, selects the new wall
 *    and waits for the next start (the tool stays until Esc / Velg); a zero-length wall (< 1 cm) is ignored;
 *  - Dør/vindu: a tap on a wall or block edge (editModel.ts `wallAt`, hit corridor) calls
 *    `addOpening(host, offset, toolOptions.openingType ?? 'window')` with the centre on the 10 cm grid along the host
 *    (1 cm with Alt), moved to the nearest free centre when the new opening (its type's default size) would overlap
 *    an opening already in that wall piece (editModel.ts `freeOpeningOffset`); a tap elsewhere does nothing;
 *  - Nytt bygg: a ghost of the template follows the mouse (snapped); a tap calls `placeUnit(template, centre,
 *    rotation90)`; the R key turns the ghost when the toolbar does not set `unitRotation90`;
 *  - Mål: two taps measure (snapped); the result stays until the next tap starts a new one, Esc clears it;
 *  - Møbler: a tap calls `onDropFurniture(toolOptions.furnitureItem, point)` (the UI places, pushes to a wall and
 *    decides about the tool);
 *  - Dør/vindu and Nytt bygg return to Velg (`onToolChange('select')`) after a placement that was not refused
 *    (result not null/false), selecting the new element when its id comes back.
 * The tools' state (wall start, measurement, hover) belongs to the active tool: another tool, or losing `editable`,
 * drops it.
 * Snapping: `editActions.snapPoint(p, opts)` when present, else planSnap.ts (geometry/snap.ts on the derived model).
 * Esc (window keydown, capture phase, only while something is in progress: a drag, a wall start, a measurement)
 * cancels that and calls `preventDefault()` so the app's own Esc (which checks `defaultPrevented`) skips; with
 * nothing in progress the app handles Esc (tool → Velg, clear the selection).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { DerivedVariant, DerivedWall } from '../model/derived';
import { levelAt } from '../model/derived';
import type { Id, Vec2 } from '../model/types';
import { openingDefaults } from '../geometry/edit';
import { isEditableTarget } from '../ui/keys';
import { EMPTY_FEEDBACK, normalizeFeedback, normalizeSnap, resultId, sessionOrNull } from './editFeedback';
import {
  bodyDragTarget,
  freeOpeningOffset,
  gridSnap,
  hitsSelection,
  pointerSizes,
  pressTarget,
  quarterTurns,
  snapRadiusM,
  tapSelection,
  unitFootprint,
  unitSize,
  wallAt,
} from './editModel';
import type { PlanHandle, WallHit } from './editModel';
import { editStrings } from './editStrings';
import type { PlanDragModifiers, PlanEditActions, PlanFeedback, PlanSelection, PlanSnapOptions, PlanTool, PlanToolOptions } from './editTypes';
import { defaultSnapPoint } from './planSnap';
import { sameElement, selectionFromTarget } from './selection';
import type { GestureController, PointerInfo } from './usePanZoom';
import type { View } from './viewport';

/** What the hook needs from usePanZoom and the rendered view (filled in by PlanView after both hooks ran). */
export interface PanZoomBridge {
  getView(): View;
  cancelGesture(): boolean;
  /** The drag handles drawn now (they depend on the zoom, so PlanView computes them after usePanZoom). */
  getHandles(): readonly PlanHandle[];
}

export interface PlanEditingParams {
  derived: DerivedVariant;
  storeyId: Id;
  /** Walls with a footprint on the current storey (opening hosts). */
  pieces: DerivedWall[];
  selection: PlanSelection | null;
  editable: boolean;
  tool: PlanTool;
  toolOptions: PlanToolOptions;
  actions: PlanEditActions | undefined;
  coarse: boolean;
  bridge: RefObject<PanZoomBridge | null>;
  onSelect: (sel: PlanSelection | null) => void;
  onToolChange?: (tool: PlanTool) => void;
  onHint?: (hint: string | null) => void;
  onDropFurniture?: (catalogId: string, planPoint: Vec2) => void;
  /** The locked base proposal refused a drag of the selection (shows the locked toast); else `beginDrag` is asked. */
  onLocked?: () => void;
}

/** What the overlay draws for the editing state. */
export interface EditOverlayState {
  tool: PlanTool;
  dragging: boolean;
  feedback: PlanFeedback;
  /** Snapped pointer position of a placement tool (mouse hover or the last tap). */
  hover: Vec2 | null;
  wallStart: Vec2 | null;
  measure: { a: Vec2; b: Vec2 | null } | null;
  openingHover: WallHit | null;
  unitGhost: Vec2[] | null;
  dropPreview: Vec2 | null;
}

interface Pending {
  handle: PlanHandle | null;
  body: PlanSelection | null;
  /** A "+" drag whose new vertex id is read from the next derived model (the action returned none). */
  insert?: { deckId: Id; before: readonly Id[]; down: Vec2 };
  /** A press on the selection of the locked base proposal: the drag is refused (toast), it does not pan. */
  locked?: boolean;
}

/** One animation frame (falls back to a 16 ms timer where there is no requestAnimationFrame). */
export function nextFrame(cb: () => void): number {
  return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number);
}

export function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
}

/** Identity of a pointer update (position and the modifiers that change the result). */
const updateKey = (info: PointerInfo) => `${info.plan[0]},${info.plan[1]},${info.altKey},${info.shiftKey},${info.ctrlKey},${info.metaKey},${info.pointerType}`;

/** The tool that is effectively active: only Mål works without `editable`. */
export function effectiveTool(tool: PlanTool, editable: boolean): PlanTool {
  if (tool === 'measure') return 'measure';
  return editable ? tool : 'select';
}

/** Hint line text for a tool and its step (editStrings, §3.2); null for Velg. */
export function toolHint(tool: PlanTool, step: { wallStarted: boolean; measureStarted: boolean }): string | null {
  switch (tool) {
    case 'wall':
      return step.wallStarted ? editStrings.hintWallEnd : editStrings.hintWallStart;
    case 'opening':
      return editStrings.hintOpening;
    case 'unit':
      return editStrings.hintUnit;
    case 'measure':
      return step.measureStarted ? editStrings.hintMeasureEnd : editStrings.hintMeasure;
    case 'furniture':
      return editStrings.hintFurniture;
    default:
      return null;
  }
}

/** A placement counts as done unless the action said no (null / false). */
const placed = (r: unknown) => r !== null && r !== false;

export function handleFromTarget(target: Element | null, handles: readonly PlanHandle[]): PlanHandle | null {
  if (!target || typeof target.closest !== 'function') return null;
  const key = target.closest('[data-handle]')?.getAttribute('data-handle');
  return key ? (handles.find((h) => h.key === key) ?? null) : null;
}

/** Per-tool state; it belongs to `tool` and is dropped when the tool changes (or `editable` goes). */
interface ToolState {
  tool: PlanTool;
  /** Snapped pointer position (mouse hover or the last tap). */
  hover: Vec2 | null;
  wallStart: Vec2 | null;
  measure: { a: Vec2; b: Vec2 | null } | null;
  openingHover: WallHit | null;
  /** Snap feedback of the tool's last hover. */
  feedback: PlanFeedback;
}

const freshToolState = (tool: PlanTool): ToolState => ({ tool, hover: null, wallStart: null, measure: null, openingHover: null, feedback: EMPTY_FEEDBACK });

export function usePlanEditing(params: PlanEditingParams) {
  const p = useRef(params);
  useLayoutEffect(() => {
    p.current = params;
  });
  const tool = effectiveTool(params.tool, params.editable);

  // Tool state, reset during render when the tool changes (React's "adjust state when a prop changes").
  const [ts, setTs] = useState<ToolState>(() => freshToolState(tool));
  let toolState = ts;
  if (ts.tool !== tool) {
    toolState = freshToolState(tool);
    setTs(toolState);
  }
  /** What the event handlers read (several events can arrive before a re-render). */
  const tsRef = useRef(toolState);
  useLayoutEffect(() => {
    tsRef.current = toolState;
  });

  const [drag, setDrag] = useState<{ on: boolean; feedback: PlanFeedback }>({ on: false, feedback: EMPTY_FEEDBACK });
  const [dropPreview, setDropPreview] = useState<Vec2 | null>(null);
  // The Nytt bygg ghost's own quarter turns (R key), reset when the template changes.
  const template = params.toolOptions.unitTemplate;
  const [rot, setRot] = useState<{ template: string | undefined; n: number }>({ template, n: 0 });
  let rotN = rot.n;
  if (rot.template !== template) {
    rotN = 0;
    setRot({ template, n: 0 });
  }
  const rotation = quarterTurns(params.toolOptions.unitRotation90 ?? rotN);

  const session = useRef<unknown>(null);
  const pending = useRef<Pending | null>(null);
  /** Pointer shift of the grabbed handle (`anchor − p`), [0, 0] for body drags. */
  const grab = useRef<Vec2>([0, 0]);
  /** The coalesced drag update: the queued frame, the newest pointer and the last one applied. */
  const frame = useRef<{ id: number | null; next: PointerInfo | null; last: string | null }>({ id: null, next: null, last: null });

  /** The current tool state (fresh when it belongs to another tool). */
  const currentTool = useCallback((): ToolState => {
    const active = effectiveTool(p.current.tool, p.current.editable);
    return tsRef.current.tool === active ? tsRef.current : freshToolState(active);
  }, []);
  const patchTool = useCallback(
    (patch: Partial<Omit<ToolState, 'tool'>>) => {
      const next = { ...currentTool(), ...patch };
      tsRef.current = next;
      setTs(next);
    },
    [currentTool],
  );

  const view = () => p.current.bridge.current?.getView() ?? { s: 1, tx: 0, ty: 0 };
  const handlesNow = (): readonly PlanHandle[] => p.current.bridge.current?.getHandles() ?? [];

  const modifiers = (info: PointerInfo): PlanDragModifiers => {
    const coarse = p.current.coarse || info.pointerType === 'touch';
    return { alt: info.altKey, shift: info.shiftKey, ctrl: info.ctrlKey, meta: info.metaKey, coarse, snapRadiusM: snapRadiusM(coarse, view().s) };
  };

  /** Half the hit corridor, in metres at the current zoom. */
  const tolM = () => pointerSizes(p.current.coarse).corridor / 2 / view().s;

  const snapFor = (purpose: PlanSnapOptions['purpose'], info: PointerInfo, extra: Partial<PlanSnapOptions> = {}) => {
    const { derived, storeyId, actions } = p.current;
    const mods = modifiers(info);
    const fallback = gridSnap(info.plan, mods.alt);
    const opts: PlanSnapOptions = { purpose, storeyId, levelId: levelAt(derived, storeyId, info.plan), modifiers: mods, ...extra };
    try {
      return normalizeSnap(actions?.snapPoint ? actions.snapPoint(info.plan, opts) : defaultSnapPoint(derived, info.plan, opts), fallback);
    } catch {
      // A snapper must never break a tool: fall back to the grid.
      return { point: fallback, feedback: EMPTY_FEEDBACK };
    }
  };

  /** Drop the queued drag update; returns the pointer it held (null when none). */
  const dropFrame = useCallback((): PointerInfo | null => {
    const f = frame.current;
    if (f.id !== null) cancelFrame(f.id);
    const next = f.next;
    f.id = null;
    f.next = null;
    return next;
  }, []);

  /** Apply one drag update now (reads refs and stable setters only, so a queued frame may call any render's copy). */
  const applyUpdate = (now: PointerInfo) => {
    const { actions } = p.current;
    if (session.current === null || !actions?.updateDrag) return;
    frame.current.last = updateKey(now);
    const g = grab.current;
    const at: Vec2 = [now.plan[0] + g[0], now.plan[1] + g[1]];
    setDrag({ on: true, feedback: normalizeFeedback(actions.updateDrag(session.current, at, modifiers(now))) });
  };

  /** Queue a drag update for the next animation frame (the newest pointer wins; an unchanged one is skipped). */
  const queueUpdate = (now: PointerInfo) => {
    const f = frame.current;
    if (f.id === null && f.last === updateKey(now)) return;
    f.next = now;
    if (f.id === null) {
      f.id = nextFrame(() => {
        frame.current.id = null;
        const n = frame.current.next;
        frame.current.next = null;
        if (n) applyUpdate(n);
      });
    }
  };

  /** End the drag session: commit (endDrag) or restore (cancelDrag). Reads refs and stable setters only. */
  const closeSession = useCallback(
    (commit: boolean) => {
      dropFrame();
      frame.current.last = null;
      grab.current = [0, 0];
      const s = session.current;
      session.current = null;
      pending.current = null;
      if (s !== null) {
        const actions = p.current.actions;
        if (commit) actions?.endDrag?.(s);
        else actions?.cancelDrag?.(s);
      }
      setDrag({ on: false, feedback: EMPTY_FEEDBACK });
    },
    [dropFrame],
  );
  useEffect(() => () => void dropFrame(), [dropFrame]);

  /** The locked base proposal: a drag of the selection is an edit attempt — the locked toast, once. */
  const refuseLocked = (body: PlanSelection | null, at: Vec2) => {
    const { onLocked, actions } = p.current;
    if (onLocked) {
      onLocked();
      return;
    }
    if (!body || !actions?.beginDrag) return;
    // The editor core refuses the locked variant with its toast; should it ever hand out a session, drop it.
    const s = sessionOrNull(actions.beginDrag(body, at));
    if (s !== null) actions.cancelDrag?.(s);
  };

  const controller: GestureController = {
    claim(down) {
      pending.current = null;
      const { editable, actions, selection, derived, onLocked } = p.current;
      if (effectiveTool(p.current.tool, editable) !== 'select') return false;
      const onSelected = sameElement(selectionFromTarget(down.target), selection);
      if (!editable) {
        // The locked base proposal: a drag starting on the selected element is refused with the toast, not panned.
        if (!derived.locked || (!onLocked && !actions?.beginDrag)) return false;
        const body = bodyDragTarget(derived, selection);
        if (!body || !(onSelected || hitsSelection(derived, selection, down.plan, tolM()))) return false;
        pending.current = { handle: null, body, locked: true };
        return true;
      }
      if (!actions?.beginDrag) return false;
      const insetM = pointerSizes(p.current.coarse).handleR / view().s;
      const t = pressTarget(derived, selection, handleFromTarget(down.target, handlesNow()), onSelected, down.plan, tolM(), insetM);
      if (!t) return false;
      pending.current = t.kind === 'handle' ? { handle: t.handle, body: null } : { handle: null, body: t.target };
      return true;
    },
    start(down, now) {
      const pend = pending.current;
      const { actions, onSelect } = p.current;
      if (pend?.locked) {
        pending.current = null;
        refuseLocked(pend.body, down.plan);
        return 'block';
      }
      if (!pend || !actions?.beginDrag) return false;
      let target: PlanSelection | null = pend.body;
      const h = pend.handle;
      frame.current.last = null;
      grab.current = [0, 0];
      if (h?.insert) {
        const { deckId, edgeId } = h.insert;
        // One undo step: the editor core inserts the vertex and drags it in one transaction.
        const one = sessionOrNull(actions.beginDrag({ kind: 'deckEdge', id: edgeId }, down.plan, 'insert'));
        const oneSel = one !== null && typeof one === 'object' ? (one as { selection?: PlanSelection }).selection : undefined;
        if (one !== null && oneSel?.kind === 'deckVertex') {
          onSelect(oneSel);
          session.current = one;
          setDrag({ on: true, feedback: EMPTY_FEEDBACK });
          applyUpdate(now);
          return true;
        }
        if (one !== null) actions.cancelDrag?.(one);
        if (!actions.insertDeckVertex) return false;
        const before = p.current.derived.outdoor.decks.find((d) => d.id === deckId)?.vertexIds ?? [];
        const r = actions.insertDeckVertex(edgeId, h.p);
        if (!placed(r)) return false;
        const id = resultId(r);
        if (!id) {
          pending.current = { ...pend, insert: { deckId, before: [...before], down: down.plan } };
          setDrag({ on: true, feedback: EMPTY_FEEDBACK });
          return true;
        }
        target = { kind: 'deckVertex', id };
        onSelect(target);
      } else if (h) {
        target = h.drag;
        // A handle drawn beside the point it acts on: drag as if that point itself was grabbed.
        if (h.anchor) grab.current = [h.anchor[0] - h.p[0], h.anchor[1] - h.p[1]];
      }
      if (!target) return false;
      const g = grab.current;
      const s = sessionOrNull(actions.beginDrag(target, [down.plan[0] + g[0], down.plan[1] + g[1]], h?.handle));
      if (s === null) {
        pending.current = null;
        grab.current = [0, 0];
        return false;
      }
      session.current = s;
      setDrag({ on: true, feedback: EMPTY_FEEDBACK });
      applyUpdate(now);
      return true;
    },
    move(now) {
      const { actions } = p.current;
      if (session.current === null) {
        // A "+" drag waiting for its new vertex: start dragging it once the derived model has it.
        const ins = pending.current?.insert;
        const newId = ins ? p.current.derived.outdoor.decks.find((d) => d.id === ins.deckId)?.vertexIds.find((v) => !ins.before.includes(v)) : undefined;
        if (!ins || !newId || !actions?.beginDrag) return;
        pending.current = null;
        p.current.onSelect({ kind: 'deckVertex', id: newId });
        const s = sessionOrNull(actions.beginDrag({ kind: 'deckVertex', id: newId }, ins.down, undefined));
        if (s === null) return;
        session.current = s;
        applyUpdate(now);
        return;
      }
      // One update per animation frame: a building drag derives the whole variant (≈ 40–60 ms).
      queueUpdate(now);
    },
    end() {
      // Flush the last position before committing.
      const last = dropFrame();
      if (last) applyUpdate(last);
      closeSession(true);
    },
    cancel() {
      closeSession(false);
    },
    hover(now) {
      const cur = currentTool();
      const { toolOptions, pieces } = p.current;
      if (cur.tool === 'select') return;
      if (!now) {
        if (cur.hover || cur.openingHover || cur.feedback !== EMPTY_FEEDBACK) patchTool({ hover: null, openingHover: null, feedback: EMPTY_FEEDBACK });
        return;
      }
      switch (cur.tool) {
        case 'wall': {
          const s = snapFor('wall', now, cur.wallStart ? { from: cur.wallStart } : {});
          patchTool({ hover: s.point, feedback: s.feedback });
          return;
        }
        case 'measure': {
          const m = cur.measure;
          const s = snapFor('measure', now, m && !m.b ? { from: m.a } : {});
          patchTool({ hover: s.point, feedback: s.feedback });
          return;
        }
        case 'unit': {
          const tpl = toolOptions.unitTemplate;
          if (!tpl) return;
          const s = snapFor('unit', now, { templateId: tpl, rotation90: rotation, size: unitSize(tpl, rotation) });
          patchTool({ hover: s.point, feedback: s.feedback });
          return;
        }
        case 'opening':
          patchTool({ openingHover: wallAt(pieces, now.plan, tolM()) });
          return;
        case 'furniture':
          patchTool({ hover: now.plan });
          return;
        default:
          return;
      }
    },
  };

  const onTap = (info: PointerInfo) => {
    const { editable, actions, toolOptions, derived, storeyId, pieces, selection, onSelect, onToolChange, onDropFurniture } = p.current;
    const cur = currentTool();
    switch (cur.tool) {
      case 'wall': {
        if (!actions?.addWall) return;
        const start = cur.wallStart;
        const s = snapFor('wall', info, start ? { from: start } : {});
        if (!start) {
          patchTool({ hover: s.point, wallStart: s.point, feedback: EMPTY_FEEDBACK });
          return;
        }
        if (Math.hypot(s.point[0] - start[0], s.point[1] - start[1]) < 0.01) return;
        const levelId = levelAt(derived, storeyId, [(start[0] + s.point[0]) / 2, (start[1] + s.point[1]) / 2]);
        const id = resultId(actions.addWall(start, s.point, levelId));
        patchTool({ hover: s.point, wallStart: null, feedback: EMPTY_FEEDBACK });
        if (id) onSelect({ kind: 'wall', id, levelId });
        return;
      }
      case 'opening': {
        if (!actions?.addOpening) return;
        const hit = wallAt(pieces, info.plan, tolM());
        if (!hit) return;
        // The centre on the 10 cm grid along the host (1 cm with Alt), like a drag (the action clamps it into the wall),
        // moved to the nearest free place when it would overlap an opening already in that wall (its default size,
        // the sill measured from the wall's level).
        const step = info.altKey ? 0.01 : 0.1;
        const type = toolOptions.openingType ?? 'window';
        const size = openingDefaults(type);
        const level = derived.levels.find((l) => l.id === hit.wall.levelId);
        const z: [number, number] | null = level ? [level.elevation + size.sill, level.elevation + size.sill + size.height] : null;
        const wanted = Math.round(Math.round(hit.offset / step) * step * 1000) / 1000;
        const offset = freeOpeningOffset(hit.wall, wanted, size.width, z, step);
        const r = actions.addOpening(hit.host, offset, type);
        if (!placed(r)) return;
        patchTool({ openingHover: null });
        const id = resultId(r);
        if (id) onSelect({ kind: 'opening', id });
        onToolChange?.('select');
        return;
      }
      case 'unit': {
        const tpl = toolOptions.unitTemplate;
        if (!tpl || !actions?.placeUnit) return;
        const s = snapFor('unit', info, { templateId: tpl, rotation90: rotation, size: unitSize(tpl, rotation) });
        const r = actions.placeUnit(tpl, s.point, rotation);
        if (!placed(r)) return;
        const id = resultId(r);
        if (id) onSelect({ kind: 'block', id });
        onToolChange?.('select');
        return;
      }
      case 'measure': {
        const m = cur.measure;
        const s = snapFor('measure', info, m && !m.b ? { from: m.a } : {});
        patchTool({ hover: s.point, measure: !m || m.b ? { a: s.point, b: null } : { a: m.a, b: s.point }, feedback: EMPTY_FEEDBACK });
        return;
      }
      case 'furniture': {
        const item = toolOptions.furnitureItem;
        if (item && onDropFurniture) onDropFurniture(item, info.plan);
        return;
      }
      default: {
        const h = editable ? handleFromTarget(info.target, handlesNow()) : null;
        if (h) {
          if (h.insert) {
            const id = resultId(actions?.insertDeckVertex?.(h.insert.edgeId, h.p));
            if (id) onSelect({ kind: 'deckVertex', id });
          } else if (h.tap) {
            onSelect(h.tap);
          }
          return;
        }
        // A placed unit is selected as a whole first, its room on the next tap (editModel.ts `tapSelection`).
        const tapped = selectionFromTarget(info.target);
        onSelect(editable ? tapSelection(derived, selection, tapped) : tapped);
      }
    }
  };

  /** Esc / the handle's cancelInteraction: cancel what is in progress; true when there was something. */
  const cancel = useCallback((): boolean => {
    if (session.current !== null) {
      // Drop the pointer gesture (usePanZoom calls controller.cancel); restore directly if it did not.
      p.current.bridge.current?.cancelGesture();
      if (session.current !== null) closeSession(false);
      return true;
    }
    const cur = currentTool();
    if (cur.wallStart || cur.measure) {
      patchTool({ wallStart: null, measure: null, feedback: EMPTY_FEEDBACK });
      return true;
    }
    return false;
  }, [closeSession, currentTool, patchTool]);

  const busy = drag.on || toolState.wallStart !== null || toolState.measure !== null;
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (cancel()) e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, cancel]);

  const rotates = tool === 'unit' && params.toolOptions.unitRotation90 === undefined;
  useEffect(() => {
    if (!rotates) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target)) setRot((r) => ({ template: r.template, n: r.n + 1 }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rotates]);

  const hint = toolHint(tool, { wallStarted: toolState.wallStart !== null, measureStarted: toolState.measure !== null && toolState.measure.b === null });
  useEffect(() => {
    p.current.onHint?.(hint);
  }, [hint]);

  const hover = toolState.hover;
  const unitGhost = useMemo(() => (tool === 'unit' && template && hover ? unitFootprint(template, hover, rotation) : null), [tool, template, hover, rotation]);

  // One object per change, so the (memoised) overlay re-renders only when its own state changes.
  const feedback = drag.on ? drag.feedback : toolState.feedback;
  const { wallStart, measure, openingHover } = toolState;
  const overlay = useMemo(
    (): EditOverlayState => ({ tool, dragging: drag.on, feedback, hover, wallStart, measure, openingHover, unitGhost, dropPreview }),
    [tool, drag.on, feedback, hover, wallStart, measure, openingHover, unitGhost, dropPreview],
  );
  return { controller, onTap, overlay, cancel, setDropPreview, busy };
}
