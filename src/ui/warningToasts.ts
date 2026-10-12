/**
 * New warnings as a toast (UX finding "Warnings are hard to see"): when an edit gives a warning that was not there
 * before (a new kind, or a new element: `warningKey`), it is shown ONCE as a toast "Ny advarsel: …" (or "2 nye
 * advarsler.") with "Vis", which opens Advarsler (toastRegistry.ts `markShowsWarnings`, Toasts.tsx).
 *
 *  - Compared with the warnings before the edit; a warning that stays is not shown again on later edits.
 *  - Not for an undo (or a cleared / replaced history), not when another proposal is shown, not while read-only.
 *  - A drag (a transaction) is compared when it ends, against the warnings from before it started.
 *  - The toast goes as soon as it is out of date, so "Vis" never opens an empty panel and two warning toasts never
 *    contradict each other: when none of the warnings it announced is left (`retireResolved`), on the next step in
 *    the undo history (the next edit, an undo or redo: toastRegistry.ts, like an undo toast), and when a newer
 *    warning toast replaces it (one warning toast at a time).
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { nb, warningText } from '../i18n/nb';
import type { DerivedVariant } from '../model/derived';
import type { Id, Site, Variant } from '../model/types';
import { appStore, useAppStore } from '../state/appStore';
import type { AppStore } from '../state/store';
import { useActiveVariant, useDerived } from '../state/useDerived';
import { dismissToast, showToast } from './editorBridge';
import { formatM2 } from './format';
import { toastRegistry, topEntry } from './toastRegistry';
import { makeNameLookup, warningKey } from './warnings';

/** Counts the steps back in the undo history (undo, clear) of a store, so a change caused by them is not "new". */
export function createBackCounter(store: Pick<AppStore, 'temporal'>): { count(): number; dispose(): void } {
  let back = 0;
  let past = store.temporal.getState().pastStates.length;
  let future = store.temporal.getState().futureStates.length;
  const unsub = store.temporal.subscribe((t) => {
    const p = t.pastStates.length;
    const f = t.futureStates.length;
    if (f > future || (p === 0 && f === 0 && (past > 0 || future > 0))) back++;
    past = p;
    future = f;
  });
  return { count: () => back, dispose: unsub };
}

let appBack: ReturnType<typeof createBackCounter> | null = null;
const backCount = () => (appBack ??= createBackCounter(appStore)).count();

/** The toast for the warnings that are not in `before` (its text and their keys), or null when there are none. */
export function newWarnings(
  before: ReadonlySet<string>,
  derived: DerivedVariant,
  variant: Variant,
  site?: Pick<Site, 'planNorthBearing'>,
): { text: string; keys: string[] } | null {
  const fresh = derived.warnings.filter((w) => !before.has(warningKey(w)));
  if (fresh.length === 0) return null;
  const keys = fresh.map(warningKey);
  if (fresh.length > 1) return { text: nb.toasts.newWarnings(fresh.length), keys };
  return { text: nb.toasts.newWarning(warningText(fresh[0], makeNameLookup(derived, variant, site), formatM2)), keys };
}

/** The text of the toast for these new warnings, or null when there are none. */
export function newWarningsText(
  before: ReadonlySet<string>,
  derived: DerivedVariant,
  variant: Variant,
  site?: Pick<Site, 'planNorthBearing'>,
): string | null {
  return newWarnings(before, derived, variant, site)?.text ?? null;
}

/** The warning toasts (with "Vis") on screen. */
function warningToastIds(): string[] {
  const registry = toastRegistry();
  return appStore
    .getState()
    .toasts.filter((t) => registry.showsWarnings(t.id))
    .map((t) => t.id);
}

/** Close the warning toasts none of whose warnings is among `current` any more (nothing left for "Vis" to show). */
export function retireResolved(current: ReadonlySet<string>): void {
  const registry = toastRegistry();
  for (const id of warningToastIds()) {
    const keys = registry.warningKeysOf(id);
    if (keys.size > 0 && ![...keys].some((k) => current.has(k))) dismissToast(id);
  }
}

const subscribeHistory = (onChange: () => void) => appStore.temporal.subscribe(onChange);
const getTop = () => topEntry(appStore);

/** Watches the active proposal's warnings and toasts the new ones (mounted once, in the app shell). */
export function useNewWarningToasts(): void {
  const derived = useDerived();
  const variant = useActiveVariant();
  const site = useAppStore((s) => s.project.site);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  // The step on top of the history: a drag's commit changes it without changing the model.
  const top = useSyncExternalStore(subscribeHistory, getTop, getTop);
  const prev = useRef<{ variantId: Id; keys: Set<string>; back: number } | null>(null);

  useEffect(() => {
    if (appStore.getState().inTransaction()) return;
    backCount(); // start counting before the first comparison
    const keys = new Set(derived.warnings.map(warningKey));
    const back = backCount();
    const p = prev.current;
    prev.current = { variantId: derived.variantId, keys, back };
    retireResolved(keys);
    if (!p || readOnly || p.variantId !== derived.variantId || p.back !== back) return;
    const fresh = newWarnings(p.keys, derived, variant, site);
    if (!fresh) return;
    // One warning toast at a time: the new one replaces any older one.
    for (const id of warningToastIds()) dismissToast(id);
    toastRegistry().markShowsWarnings(showToast({ text: fresh.text }), fresh.keys);
  }, [derived, variant, site, readOnly, top]);
}
