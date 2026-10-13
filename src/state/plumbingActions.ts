/**
 * Drain stack actions and the «Avløp og sluk» overlay state (the original brief §5; the rules live in
 * geometry/plumbing.ts).
 *
 * Actions (store first, like state/editActions.ts; `bindPlumbingActions(store)` / `usePlumbingActions()` bind them):
 *  - `addDrainStack(store, storeyId, at?)`: a new stack on a wall — at `at` snapped to the nearest wall, else by the
 *    fixtures that are too far (geometry/plumbing.ts `newStackPoint`). On a storey that only had the suggested stack,
 *    the suggestion is stored too, so the new stack never takes the bathrooms' stack away. Returns the new id.
 *  - `moveDrainStack(store, id, p, { transaction })`: the stack to `p` snapped to the nearest wall (out of openings); a
 *    suggested stack (`suggested-<storeyId>`) is stored there with a new id, which is returned.
 *  - `deleteDrainStack(store, id)`: removes a stored stack (toast «Slettet.» with Angre); the storey's suggestion comes
 *    back when it was the last one there.
 * Every action is ONE undo step through the store's `updateVariant` (the plan's stack drag previews locally and calls
 * `moveDrainStack` once on release; a caller that updates during a drag passes `{ transaction }`, merged into one
 * step like the editor's slider edits), a no-op while `ui.readOnly`, and refused on the locked Forslag D with the
 * editor's toast (`EDIT_STRINGS.locked` + «Nytt forslag»), like every action in editActions.ts.
 *
 * Overlay state: `usePlumbingVisible` / `setPlumbingVisible` (the Vis toggle, a per-device preference kept in
 * localStorage `hytte-planlegger:plumbing`), `usePlumbingAnalysis()` (the active proposal's analysis, memoised),
 * `useDrainWarnings()` (the 'drain-far' warnings, empty while the overlay is off), `usePlumbingOverlay()` (the
 * PlumbingLayer's props for the plan, null while off) and `todayWetRoomIds()` (the Room records with a wet type in
 * Forslag D: only those can hold one of today's drains).
 */
import { nanoid } from 'nanoid';
import { useMemo } from 'react';
import { create } from 'zustand';
import { isLocked } from '../geometry/edit';
import { TODAY_DRAIN_ROOM_TYPES, analysePlumbing, drainWarnings, newStackPoint, snapStackToWall } from '../geometry/plumbing';
import type { DrainFarWarning, DrainStack, PlumbingAnalysis, VariantPlumbing } from '../geometry/plumbing';
import { createForslagDVariant } from '../model/seed/forslagD';
import type { Id, Variant, Vec2 } from '../model/types';
import { appStore, useAppStore } from './appStore';
import type { EditStore } from './editActions';
import { EDIT_STRINGS } from './editStrings';
import { getStorage, readRaw, writeRaw } from './persistence';
import { selectActiveVariant } from './store';
import type { AppState } from './store';
import { deriveForState } from './useDerived';

/** Prefix of a suggested stack's id (geometry/plumbing.ts: `suggested-<storeyId>`). */
export const SUGGESTED_PREFIX = 'suggested-';
/** localStorage key of the Vis toggle. */
export const PLUMBING_VISIBLE_KEY = 'hytte-planlegger:plumbing';

// ---------------------------------------------------------------------------
// Today's wet rooms
// ---------------------------------------------------------------------------

let todayIds: ReadonlySet<Id> | null = null;

/** Ids of the Room records that have a wet type (bad, wc, teknisk, kjøkken) in the bundled Forslag D. */
export function todayWetRoomIds(): ReadonlySet<Id> {
  if (!todayIds) todayIds = new Set(createForslagDVariant().rooms.filter((r) => TODAY_DRAIN_ROOM_TYPES.has(r.type)).map((r) => r.id));
  return todayIds;
}

/** The analysis of the store's active proposal (memoised on the derived model and `Variant.plumbing`). */
export function plumbingOf(state: Pick<AppState, 'project'>): PlumbingAnalysis {
  return analysePlumbing(deriveForState(state), selectActiveVariant(state).plumbing, { todayRoomIds: todayWetRoomIds() });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** The editable active variant, or null (read-only: silently; locked: with the editor's toast). */
function editableVariant(store: EditStore): Variant | null {
  const s = store.getState();
  if (s.ui.readOnly) return null;
  const v = selectActiveVariant(s);
  if (isLocked(v)) {
    s.showToast({ text: EDIT_STRINGS.locked, action: 'newProposal' });
    return null;
  }
  return v;
}

const newStackId = (): Id => `stack-${nanoid(8)}`;
const samePoint = (a: Vec2, b: Vec2): boolean => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
const storedStacks = (v: Variant): DrainStack[] => v.plumbing?.stacks ?? [];

function setStacks(store: EditStore, v: Variant, stacks: DrainStack[], opts: { transaction?: string } = {}): void {
  store.getState().updateVariant(
    v.id,
    (d) => {
      d.plumbing = { stacks: stacks.map((s) => ({ id: s.id, p: [s.p[0], s.p[1]], storeyId: s.storeyId })) };
    },
    opts,
  );
}

/** Adds a stack on `storeyId` (see the header). Null when refused or the storey has no wall. */
export function addDrainStack(store: EditStore, storeyId: Id, at?: Vec2): Id | null {
  const v = editableVariant(store);
  if (!v) return null;
  const state = store.getState();
  const derived = deriveForState(state);
  const analysis = plumbingOf(state);
  const p = at ? (snapStackToWall(derived, storeyId, at)?.p ?? null) : newStackPoint(derived, analysis, storeyId);
  if (!p) return null;
  const id = newStackId();
  // The storey's suggestion is stored too (unless the new stack lands on it), so the bathrooms keep their stack.
  const kept = analysis.stacks
    .filter((s) => s.suggested && s.storeyId === storeyId && !samePoint(s.p, p))
    .map((s): DrainStack => ({ id: newStackId(), p: s.p, storeyId }));
  setStacks(store, v, [...storedStacks(v), ...kept, { id, p, storeyId }]);
  return id;
}

/** Moves a stack (a suggested one is stored) to `p` on the nearest wall. The stack's id, or null when refused. */
export function moveDrainStack(store: EditStore, id: Id, p: Vec2, opts: { transaction?: string } = {}): Id | null {
  const v = editableVariant(store);
  if (!v) return null;
  const stored = storedStacks(v);
  const existing = stored.find((s) => s.id === id);
  const storeyId = existing?.storeyId ?? (id.startsWith(SUGGESTED_PREFIX) ? id.slice(SUGGESTED_PREFIX.length) : null);
  if (!storeyId) return null;
  const derived = deriveForState(store.getState());
  const to: Vec2 = snapStackToWall(derived, storeyId, p)?.p ?? [p[0], p[1]];
  if (existing) {
    if (samePoint(existing.p, to)) return id;
    setStacks(
      store,
      v,
      stored.map((s) => (s.id === id ? { ...s, p: to } : s)),
      opts,
    );
    return id;
  }
  const created = newStackId();
  setStacks(store, v, [...stored, { id: created, p: to, storeyId }], opts);
  return created;
}

/** Deletes a stored stack (toast «Slettet.» with Angre). False for a suggestion or an unknown id; null when refused. */
export function deleteDrainStack(store: EditStore, id: Id): boolean | null {
  const v = editableVariant(store);
  if (!v) return null;
  const stored = storedStacks(v);
  if (!stored.some((s) => s.id === id)) return false;
  setStacks(
    store,
    v,
    stored.filter((s) => s.id !== id),
  );
  store.getState().showToast({ text: EDIT_STRINGS.deleted, undo: true });
  return true;
}

export interface PlumbingActions {
  addDrainStack(storeyId: Id, at?: Vec2): Id | null;
  moveDrainStack(id: Id, p: Vec2, opts?: { transaction?: string }): Id | null;
  deleteDrainStack(id: Id): boolean | null;
}

export function bindPlumbingActions(store: EditStore): PlumbingActions {
  return {
    addDrainStack: (storeyId, at) => addDrainStack(store, storeyId, at),
    moveDrainStack: (id, p, opts) => moveDrainStack(store, id, p, opts),
    deleteDrainStack: (id) => deleteDrainStack(store, id),
  };
}

/** The actions bound to the app store. */
export function usePlumbingActions(): PlumbingActions {
  return useMemo(() => bindPlumbingActions(appStore), []);
}

// ---------------------------------------------------------------------------
// Overlay state (the Vis toggle) and hooks
// ---------------------------------------------------------------------------

/** The Vis toggle «Avløp og sluk» (off by default; remembered on this device). */
export const plumbingView = create<{ visible: boolean }>(() => ({ visible: readRaw(getStorage(), PLUMBING_VISIBLE_KEY) === '1' }));

export function setPlumbingVisible(visible: boolean): void {
  plumbingView.setState({ visible });
  writeRaw(getStorage(), PLUMBING_VISIBLE_KEY, visible ? '1' : '0');
}

export function usePlumbingVisible(): boolean {
  return plumbingView((s) => s.visible);
}

/** The active proposal's drainage analysis (the same object until the proposal or its stacks change). */
export function usePlumbingAnalysis(): PlumbingAnalysis {
  return useAppStore(plumbingOf);
}

const NO_WARNINGS: readonly DrainFarWarning[] = [];
const warningMemo = new WeakMap<PlumbingAnalysis, readonly DrainFarWarning[]>();

/** The 'drain-far' warnings of an analysis, the same array for the same analysis (empty: one shared array). */
export function drainWarningsOf(analysis: PlumbingAnalysis): readonly DrainFarWarning[] {
  let w = warningMemo.get(analysis);
  if (!w) {
    const list = drainWarnings(analysis);
    w = list.length > 0 ? list : NO_WARNINGS;
    warningMemo.set(analysis, w);
  }
  return w;
}

/** The 'drain-far' warnings for Advarsler: only while «Avløp og sluk» is on. */
export function useDrainWarnings(): readonly DrainFarWarning[] {
  const visible = usePlumbingVisible();
  // Not analysed at all while the overlay is off (the toolbar's badge uses this on every edit).
  return useAppStore((s) => (visible ? drainWarningsOf(plumbingOf(s)) : NO_WARNINGS));
}

/**
 * A derived model with the drain warnings appended (the same object when there are none), for the Advarsler panel
 * and the toolbar's count once `ModelWarning` has the 'drain-far' member.
 */
export function withDrainWarnings<D extends { warnings: readonly unknown[] }>(derived: D, extra: readonly DrainFarWarning[]): D {
  return extra.length === 0 ? derived : ({ ...derived, warnings: [...derived.warnings, ...extra] } as D);
}

/** What the plan's PlumbingLayer needs besides the plan's own props (derived, storey, scale, …). */
export interface PlumbingOverlayProps {
  plumbing: VariantPlumbing | undefined;
  todayRoomIds: ReadonlySet<Id>;
  onMoveStack: (id: Id, p: Vec2) => void;
  onDeleteStack: (id: Id) => void;
}

/** The PlumbingLayer's props for the active proposal while «Avløp og sluk» is on, else null. */
export function usePlumbingOverlay(): PlumbingOverlayProps | null {
  const visible = usePlumbingVisible();
  const plumbing = useAppStore((s) => selectActiveVariant(s).plumbing);
  const actions = usePlumbingActions();
  return useMemo(
    () =>
      visible
        ? {
            plumbing,
            todayRoomIds: todayWetRoomIds(),
            onMoveStack: (id: Id, p: Vec2) => void actions.moveDrainStack(id, p),
            onDeleteStack: (id: Id) => void actions.deleteDrainStack(id),
          }
        : null,
    [visible, plumbing, actions],
  );
}
