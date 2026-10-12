/**
 * Toasts (store `toasts`, docs/phase2-plan.md §3.5 "every delete toasts «Slettet. [Angre]»", §1 rule 1 refusal with
 * "Nytt forslag"): bottom centre, newest last, at most three (store TOAST_LIMIT). Each closes by itself after 6 s,
 * 10 s when it has a button (the timer restarts when the same text is shown again: `seq`), or with ×.
 * [Angre] undoes the last step; "Nytt forslag" copies the active proposal and switches to it.
 */
import { useEffect } from 'react';
import { nb } from '../i18n/nb';
import { appStore } from '../state/appStore';
import { IconClose } from './common';
import { createNewProposal, dismissToast, toastOffersNewProposal, useToasts } from './editorBridge';
import type { ToastItem } from './editorBridge';

export const TOAST_MS = 6000;
export const TOAST_ACTION_MS = 10000;

function ToastView(props: { toast: ToastItem }) {
  const { toast } = props;
  const newProposal = toastOffersNewProposal(toast);
  const ms = toast.undo || newProposal ? TOAST_ACTION_MS : TOAST_MS;
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(toast.id), ms);
    return () => clearTimeout(timer);
  }, [toast.id, toast.seq, ms]);

  return (
    <div className="toast" role="status" data-testid="toast">
      <span className="toast-text">{toast.text}</span>
      {toast.undo && (
        <button
          type="button"
          className="btn btn-small toast-btn"
          data-testid="toast-undo"
          onClick={() => {
            appStore.getState().undo();
            dismissToast(toast.id);
          }}
        >
          {nb.toasts.undo}
        </button>
      )}
      {newProposal && (
        <button type="button" className="btn btn-small btn-primary" data-testid="toast-new-proposal" onClick={() => createNewProposal()}>
          {nb.proposals.newProposal}
        </button>
      )}
      <button type="button" className="btn btn-ghost btn-small icon-btn toast-close" aria-label={nb.toasts.close} title={nb.toasts.close} onClick={() => dismissToast(toast.id)}>
        <IconClose />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="region" aria-label={nb.toasts.region} aria-live="polite" data-testid="toasts">
      {toasts.map((t) => (
        <ToastView key={t.id} toast={t} />
      ))}
    </div>
  );
}
