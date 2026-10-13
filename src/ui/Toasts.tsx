/**
 * Toasts (store `toasts`, docs/phase2-plan.md §3.5 "every delete toasts «Slettet. [Angre]»", §1 rule 1 refusal with
 * "Nytt forslag"): bottom centre (on phones at the top, just below the toolbar and hint line so they never cover the
 * tools or Angre: toastLayout.ts `phoneToastTop`, kept current while the page scrolls or what is above the toolbar
 * changes height: `watchToolbarMoves`), newest last, at most three
 * (store TOAST_LIMIT). Each closes by itself
 * after 6 s, 10 s when it has a button (the timer restarts when the same text is shown again: `seq`), or with ×.
 *
 *  - ONE message per user action: the undo toasts of one undo step are merged, the action's own text first
 *    ("Slettet. «Soverom 1» og «Bad» er nå ett rom.", toastRegistry.ts `groups`).
 *  - [Angre] undoes exactly the step the toast was shown for, and only while that step is the last one: any later
 *    step (an edit, Angre / Gjør om in the toolbar) closes the toast, and a button whose step is no longer on top is
 *    disabled (toastRegistry.ts).
 *  - "Nytt forslag" copies the active proposal and switches to it; "Vis" (a new warning, warningToasts.ts) opens
 *    Advarsler.
 *  - While the first-run card is open the toasts sit above it where they would cover it (its "Skjønner" button).
 */
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { nb } from '../i18n/nb';
import { appStore } from '../state/appStore';
import { IconClose } from './common';
import { createNewProposal, dismissToast, toastOffersNewProposal, useToasts } from './editorBridge';
import { useFirstRunOpen } from './firstRun';
import { PHONE_QUERY, useMediaQuery } from './hooks';
import { revealWarnings, toolbarBottom } from './reveal';
import { phoneToastTop, toastBottomAvoiding, watchToolbarMoves } from './toastLayout';
import { topEntry, toastRegistry } from './toastRegistry';
import type { UndoGroup } from './toastRegistry';

export const TOAST_MS = 6000;
export const TOAST_ACTION_MS = 10000;

const registry = toastRegistry();

const subscribeHistory = (onChange: () => void) => appStore.temporal.subscribe(onChange);
const getTop = () => topEntry(appStore);

function ToastView(props: { group: UndoGroup }) {
  const { toasts } = props.group;
  // Re-render when the undo stack changes (the Angre button follows whether its step is still on top).
  useSyncExternalStore(subscribeHistory, getTop, getTop);
  const undoToast = toasts.find((t) => t.undo);
  const undoCurrent = undoToast ? registry.isCurrent(undoToast) : false;
  const newProposal = toasts.some((t) => toastOffersNewProposal(t));
  const showWarnings = toasts.some((t) => registry.showsWarnings(t.id));
  const ms = undoToast || newProposal || showWarnings ? TOAST_ACTION_MS : TOAST_MS;
  const timerKey = toasts.map((t) => `${t.id}:${t.seq ?? 0}`).join(',');
  const dismissAll = () => {
    for (const t of toasts) dismissToast(t.id);
  };

  useEffect(() => {
    const ids = timerKey.split(',').map((k) => k.split(':')[0]);
    const timer = setTimeout(() => {
      for (const id of ids) dismissToast(id);
    }, ms);
    return () => clearTimeout(timer);
  }, [timerKey, ms]);

  return (
    <div className="toast" role="status" data-testid="toast">
      <span className="toast-text">{toasts.map((t) => t.text).join(' ')}</span>
      {undoToast && (
        <button
          type="button"
          className="btn btn-small toast-btn"
          data-testid="toast-undo"
          disabled={!undoCurrent}
          onClick={() => registry.undo(toasts)}
        >
          {nb.toasts.undo}
        </button>
      )}
      {showWarnings && (
        <button
          type="button"
          className="btn btn-small toast-btn"
          data-testid="toast-show-warnings"
          title={nb.toasts.showTitle}
          onClick={() => {
            revealWarnings();
            dismissAll();
          }}
        >
          {nb.toasts.show}
        </button>
      )}
      {newProposal && (
        <button type="button" className="btn btn-small btn-primary" data-testid="toast-new-proposal" onClick={() => createNewProposal()}>
          {nb.proposals.newProposal}
        </button>
      )}
      <button type="button" className="btn btn-ghost btn-small icon-btn toast-close" aria-label={nb.toasts.close} title={nb.toasts.close} onClick={dismissAll}>
        <IconClose />
      </button>
    </div>
  );
}

function measureCardOffset(): number | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  // Phones: the toasts are at the top of the screen (CSS), the card at the bottom.
  if (typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches) return null;
  const card = document.querySelector('[data-testid="first-run"]');
  if (!card) return null;
  return toastBottomAvoiding(card.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
}

export function Toasts() {
  const toasts = useToasts();
  const cardOpen = useFirstRunOpen();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [bottom, setBottom] = useState<number | null>(null);
  const [phoneTop, setPhoneTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const update = () => setBottom(cardOpen ? measureCardOffset() : null);
    update();
    if (!cardOpen || typeof window === 'undefined') return;
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [cardOpen, toasts]);

  // Phones: below the toolbar and hint line, wherever the page has scrolled them.
  const shown = toasts.length > 0;
  useLayoutEffect(() => {
    const active = isPhone && shown && typeof window !== 'undefined';
    const update = () => setPhoneTop(active ? phoneToastTop(toolbarBottom()) : null);
    update();
    if (!active) return;
    // Also when what is above the toolbar changes height (a banner whose facts arrive late, Nøkkeltall wrapping).
    return watchToolbarMoves(update);
  }, [isPhone, shown, toasts]);

  const groups = registry.groups(toasts);
  const style = isPhone ? (phoneTop !== null ? { top: phoneTop } : undefined) : bottom !== null ? { bottom } : undefined;
  return (
    <div
      className="toasts"
      role="region"
      aria-label={nb.toasts.region}
      aria-live="polite"
      data-testid="toasts"
      style={style}
    >
      {groups.map((g) => (
        <ToastView key={g.key} group={g} />
      ))}
    </div>
  );
}
