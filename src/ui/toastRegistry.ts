/**
 * What the toasts know beyond their store record (store.ts `Toast`), kept in the UI (never saved, never in the undo
 * history):
 *
 * 1. Undo toasts are tied to the undo step they were shown for (UX finding "Undo from toasts").
 *    - A toast with [Angre] (`undo: true`) remembers the entry on top of the undo stack when it appears or is shown
 *      again (`seq`): the step the action that showed it has just made (the editor core and commands.ts show the
 *      toast right after the step is stored).
 *    - Its Angre undoes only while that entry is still on top (`isCurrent`). Any other step on top (a new edit, an
 *      undo or redo, a cleared or replaced history) dismisses it, so a later click can never undo something else.
 *    - The toasts of one step form one message (`undoGroups`): "Slettet." and "«Soverom 1» og «Bad» er nå ett rom."
 *      read "Slettet. «Soverom 1» og «Bad» er nå ett rom." with one Angre.
 * 2. A toast can carry the "Vis" button that opens Advarsler (`markShowsWarnings`; warningToasts.ts).
 *
 * `createToastRegistry(store)` subscribes to the store and its temporal (zundo) store; the app's registry
 * (`toastRegistry()`) is created on first use, which Toasts.tsx does when it is imported, before any toast exists.
 */
import { nb } from '../i18n/nb';
import { appStore } from '../state/appStore';
import type { AppStore, Toast } from '../state/store';

/** One undo step: zundo's past-state object (a new object for every step). */
export type HistoryEntry = object;

/** The entry on top of the undo stack, or null when there is nothing to undo. */
export function topEntry(store: Pick<AppStore, 'temporal'>): HistoryEntry | null {
  const past = store.temporal.getState().pastStates;
  return past.length > 0 ? (past[past.length - 1] as HistoryEntry) : null;
}

export interface UndoGroup {
  /** Stable React key (the first toast's id). */
  key: string;
  toasts: Toast[];
  /** The step the group's Angre undoes (undefined: not an undo toast). */
  entry: HistoryEntry | null | undefined;
}

export interface ToastRegistry {
  /** The step an undo toast belongs to (tagged on first sight when the toast appeared before the registry). */
  entryOf(toast: Toast): HistoryEntry | null;
  /** Its step is still on top of the undo stack, so its Angre undoes exactly that step. */
  isCurrent(toast: Toast): boolean;
  /** Angre: undo the group's step if it is still on top, and close the group. Returns whether it undid. */
  undo(group: readonly Toast[]): boolean;
  /** Toasts in display order, those of one undo step merged (see the header). */
  groups(toasts: readonly Toast[]): UndoGroup[];
  markShowsWarnings(toastId: string): void;
  showsWarnings(toastId: string): boolean;
  dispose(): void;
}

export function createToastRegistry(store: AppStore, deletedText: string = nb.toasts.deleted): ToastRegistry {
  const tags = new Map<string, { seq: number; entry: HistoryEntry | null }>();
  const warningToasts = new Set<string>();
  let lastTop = topEntry(store);

  const tag = (t: Toast) => {
    const seq = t.seq ?? 0;
    const known = tags.get(t.id);
    if (!known || known.seq !== seq) tags.set(t.id, { seq, entry: topEntry(store) });
  };

  const unsubToasts = store.subscribe((s, prev) => {
    if (s.toasts === prev.toasts) return;
    const ids = new Set(s.toasts.map((t) => t.id));
    for (const t of s.toasts) if (t.undo) tag(t);
    for (const id of [...tags.keys()]) if (!ids.has(id)) tags.delete(id);
    for (const id of [...warningToasts]) if (!ids.has(id)) warningToasts.delete(id);
  });

  // zundo mutates its arrays in place (undo splices), so compare with our own copy of the top, not `prev`.
  const unsubHistory = store.temporal.subscribe(() => {
    const top = topEntry(store);
    if (top === lastTop) return;
    lastTop = top;
    for (const t of store.getState().toasts) {
      if (t.undo && tags.get(t.id)?.entry !== top) store.getState().dismissToast(t.id);
    }
  });

  /** The entry of a toast that is no longer on screen: never the top of the stack. */
  const GONE: HistoryEntry = {};

  const entryOf = (t: Toast): HistoryEntry | null => {
    if (!tags.has(t.id)) {
      // A toast that appeared before the registry existed is tagged now; one already closed is stale for good.
      if (!store.getState().toasts.some((x) => x.id === t.id)) return GONE;
      tag(t);
    }
    return tags.get(t.id)?.entry ?? null;
  };

  return {
    entryOf,
    isCurrent: (t) => !!t.undo && topEntry(store) !== null && entryOf(t) === topEntry(store),
    undo(group) {
      const head = group.find((t) => t.undo);
      const current = !!head && entryOf(head) === topEntry(store) && topEntry(store) !== null;
      if (current) store.getState().undo();
      for (const t of group) store.getState().dismissToast(t.id);
      return current;
    },
    groups(toasts) {
      const out: UndoGroup[] = [];
      const byEntry = new Map<HistoryEntry | null, UndoGroup>();
      for (const t of toasts) {
        if (!t.undo) {
          out.push({ key: t.id, toasts: [t], entry: undefined });
          continue;
        }
        const entry = entryOf(t);
        const g = byEntry.get(entry);
        if (g) g.toasts.push(t);
        else {
          const group: UndoGroup = { key: t.id, toasts: [t], entry };
          byEntry.set(entry, group);
          out.push(group);
        }
      }
      // The action's own text first ("Slettet."), then what followed from it (a room merge).
      for (const g of out) if (g.toasts.length > 1) g.toasts.sort((a, b) => Number(b.text === deletedText) - Number(a.text === deletedText));
      return out;
    },
    markShowsWarnings: (id) => void warningToasts.add(id),
    showsWarnings: (id) => warningToasts.has(id),
    dispose() {
      unsubToasts();
      unsubHistory();
    },
  };
}

let appRegistry: ToastRegistry | null = null;

/** The registry of the app store (created on first use). */
export function toastRegistry(): ToastRegistry {
  if (!appRegistry) appRegistry = createToastRegistry(appStore);
  return appRegistry;
}
