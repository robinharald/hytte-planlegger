/**
 * The plan's editing behaviour (docs/phase2-plan.md §3.1–3.2): element drags through the edit API's drag protocol,
 * the placement tools, hover previews, the hint line and Esc. PlanView owns the rendering; usePanZoom calls the
 * `controller` returned here.
 *
 * Gestures ("Trykk for å velge, dra det valgte for å flytte"), tool Velg with `editable`:
 *  - a press on a drag handle, or on the SELECTED element (editModel.ts `hitsSelection`, or its own hit area), is
 *    claimed; past the threshold `beginDrag(target, pointerDownPlan, handle?)` starts a session — null/false from
 *    `beginDrag` (nothing to drag, locked variant) lets the gesture pan instead; every move calls
 *    `updateDrag(session, p, modifiers)` and draws the returned feedback; pointer-up `endDrag`; Esc, pointercancel,
 *    lostpointercapture and a second finger `cancelDrag`;
 *  - a "+" handle inserts a deck vertex (`insertDeckVertex(edgeId, midpoint)`) on a tap (the new vertex is selected
 *    when the action returns its id); a drag from it calls `beginDrag({ kind: 'deckEdge', id: edgeId }, p, 'insert')`,
 *    which inserts and drags in one undo step (the session's `selection` is the new vertex, selected right away);
 *    without such a session it falls back to `insertDeckVertex` and a drag of the new vertex (two undo steps), and
 *    when that action returns no id the drag waits for the next derived model and takes the vertex id that is new there;
 *  - any other press pans; a tap selects (handles: their `tap` selection).
 * Placement tools tap, never drag (a drag pans), and need `editable` (Mål works on the locked base too):
 *  - Vegg: the 1st tap sets the start, the 2nd calls `addWall(start, end, levelAt(midpoint))`, selects the new wall
 *    and waits for the next start (the tool stays until Esc / Velg); a zero-length wall (< 1 cm) is ignored;
 *  - Dør/vindu: a tap on a wall or block edge (editModel.ts `wallAt`, hit corridor) calls
 *    `addOpening(host, offset, toolOptions.openingType ?? 'window')` with the centre on the 10 cm grid along the host
 *    (1 cm with Alt); a tap elsewhere does nothing;
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
import { isEditableTarget } from '../ui/keys';
import { EMPTY_FEEDBACK, normalizeFeedback, normalizeSnap, resultId, sessionOrNull } from './editFeedback';
import { bodyDragTarget, gridSnap, hitsSelection, pointerSizes, quarterTurns, unitFootprint, unitSize, wallAt } from './editModel';
import type { PlanHandle, WallHit } from './editModel';
import { editStrings } from './editStrings';
import type { PlanDragModifiers, PlanEditActions, PlanFeedback, PlanSelection, PlanSnapOptions, PlanTool, PlanToolOptions } from './editTypes';
import { defaultSnapPoint } from './planSnap';
import { sameElement, selectionFromTarget } from './selection';
import type { GestureController, PointerInfo } from './usePanZoom';
import type { View } from './viewport';

/** What the hook needs from usePanZoom (filled in by PlanView after both hooks ran). */
export interface PanZoomBridge {
  getView(): View;
  cancelGesture(): boolean;
}

export interface PlanEditingParams {
  derived: DerivedVariant;
  storeyId: Id;
  /** Walls with a footprint on the current storey (opening hosts). */
  pieces: DerivedWall[];
  selection: PlanSelection | null;
  handles: PlanHandle[];
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
}

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

  const modifiers = (info: PointerInfo): PlanDragModifiers => {
    const coarse = p.current.coarse || info.pointerType === 'touch';
    return { alt: info.altKey, shift: info.shiftKey, ctrl: info.ctrlKey, meta: info.metaKey, coarse, snapRadiusM: pointerSizes(coarse).snap / view().s };
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

  /** End the drag session: commit (endDrag) or restore (cancelDrag). Reads refs and stable setters only. */
  const closeSession = useCallback((commit: boolean) => {
    const s = session.current;
    session.current = null;
    pending.current = null;
    if (s !== null) {
      const actions = p.current.actions;
      if (commit) actions?.endDrag?.(s);
      else actions?.cancelDrag?.(s);
    }
    setDrag({ on: false, feedback: EMPTY_FEEDBACK });
  }, []);

  const controller: GestureController = {
    claim(down) {
      pending.current = null;
      const { editable, actions, selection, handles, derived } = p.current;
      if (effectiveTool(p.current.tool, editable) !== 'select' || !editable || !actions?.beginDrag) return false;
      const h = handleFromTarget(down.target, handles);
      if (h) {
        if (!h.drag && !h.insert) return false;
        pending.current = { handle: h, body: null };
        return true;
      }
      const body = bodyDragTarget(derived, selection);
      if (!body) return false;
      const on = sameElement(selectionFromTarget(down.target), selection) || hitsSelection(derived, selection, down.plan, tolM());
      if (!on) return false;
      pending.current = { handle: null, body };
      return true;
    },
    start(down, now) {
      const pend = pending.current;
      const { actions, onSelect } = p.current;
      if (!pend || !actions?.beginDrag) return false;
      let target: PlanSelection | null = pend.body;
      const h = pend.handle;
      if (h?.insert) {
        const { deckId, edgeId } = h.insert;
        // One undo step: the editor core inserts the vertex and drags it in one transaction.
        const one = sessionOrNull(actions.beginDrag({ kind: 'deckEdge', id: edgeId }, down.plan, 'insert'));
        const oneSel = one !== null && typeof one === 'object' ? (one as { selection?: PlanSelection }).selection : undefined;
        if (one !== null && oneSel?.kind === 'deckVertex') {
          onSelect(oneSel);
          session.current = one;
          setDrag({ on: true, feedback: EMPTY_FEEDBACK });
          controller.move(now);
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
      }
      if (!target) return false;
      const s = sessionOrNull(actions.beginDrag(target, down.plan, h?.handle));
      if (s === null) {
        pending.current = null;
        return false;
      }
      session.current = s;
      setDrag({ on: true, feedback: EMPTY_FEEDBACK });
      controller.move(now);
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
      }
      if (!actions?.updateDrag) return;
      setDrag({ on: true, feedback: normalizeFeedback(actions.updateDrag(session.current, now.plan, modifiers(now))) });
    },
    end() {
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
    const { editable, actions, toolOptions, derived, storeyId, pieces, handles, onSelect, onToolChange, onDropFurniture } = p.current;
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
        // The centre on the 10 cm grid along the host (1 cm with Alt), like a drag (the action clamps it into the wall).
        const step = info.altKey ? 0.01 : 0.1;
        const offset = Math.round(Math.round(hit.offset / step) * step * 1000) / 1000;
        const r = actions.addOpening(hit.host, offset, toolOptions.openingType ?? 'window');
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
        const h = editable ? handleFromTarget(info.target, handles) : null;
        if (h) {
          if (h.insert) {
            const id = resultId(actions?.insertDeckVertex?.(h.insert.edgeId, h.p));
            if (id) onSelect({ kind: 'deckVertex', id });
          } else if (h.tap) {
            onSelect(h.tap);
          }
          return;
        }
        onSelect(selectionFromTarget(info.target));
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

  const overlay: EditOverlayState = {
    tool,
    dragging: drag.on,
    feedback: drag.on ? drag.feedback : toolState.feedback,
    hover,
    wallStart: toolState.wallStart,
    measure: toolState.measure,
    openingHover: toolState.openingHover,
    unitGhost,
    dropPreview,
  };
  return { controller, onTap, overlay, cancel, setDropPreview, busy };
}
