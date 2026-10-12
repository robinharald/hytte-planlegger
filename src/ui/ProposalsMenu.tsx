/**
 * "Forslag: <navn> ▾" in the top bar (docs/phase2-plan.md §5–§6): the list of proposals — Forslag D first with its
 * "Grunnlag" tag, then the family's proposals in the order they were made, each with "sist endret av Mamma, i dag
 * 14.30" — plus "+ Nytt forslag" (a copy of Forslag D), "Kopier «X»" (a copy of the one on screen) and the Papirkurv.
 * Choosing a proposal shows it (no undo step). Also the two-step delete dialog ("Vil du slette «X»?" → "Er du sikker?
 * Forslaget forsvinner for alle. [Slett for alle]") that the top bar's Slett opens.
 *
 * The menu is a disclosure like the "Mer" menu: Esc, a choice or a click outside closes it; arrow keys move between
 * the items.
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { nb } from '../i18n/nb';
import { activateProposal, appStore, deleteProposal, familyMode, useAppStore, useFamily } from '../state/appStore';
import type { Id, Variant } from '../model/types';
import { selectActiveVariant } from '../state/store';
import { IconChevronDown, Modal } from './common';
import { createNewProposal, nextProposalName } from './editorBridge';
import { menuOrder, metaLine, useMinuteClock } from './familyUi';

/** Ask for the name, then copy `fromId` (default: the proposal on screen) and show the copy. */
function askNameAndCopy(fromId?: Id): void {
  const name = window.prompt(nb.prompts.newProposalName, nextProposalName(appStore.getState().project));
  if (name === null) return;
  if (fromId && appStore.getState().project.activeVariantId !== fromId) activateProposal(fromId);
  createNewProposal(name);
}

export function ProposalsMenu(props: { onOpenTrash: () => void }) {
  const project = useAppStore((s) => s.project);
  const readOnly = useAppStore((s) => s.ui.readOnly);
  const meta = useFamily((s) => s.meta);
  const trashCount = useFamily((s) => s.trash.length);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const now = useMinuteClock();
  const active = selectActiveVariant({ project });
  const f = nb.family;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      ref.current?.querySelector<HTMLElement>('.proposals-trigger')?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    // Focus the item on screen, so arrow keys start there.
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const choose = (id: Id) => {
    setOpen(false);
    if (id !== project.activeVariantId) activateProposal(id);
  };
  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('.menu-item') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next?.focus();
  };
  const base = project.variants.find((v) => v.locked);

  return (
    <div className="proposals-menu" ref={ref}>
      <button
        type="button"
        className="btn proposals-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title={f.menuTitle}
        data-testid="proposals-menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="variant-label">{nb.topbar.variant}:</span>
        <span className="proposals-current">{active.name}</span>
        <IconChevronDown />
      </button>
      {open && (
        <div className="menu-list proposals-list" role="menu" aria-label={f.menu} onKeyDown={onListKey} data-testid="proposals-list">
          {menuOrder(project.variants, meta).map((v) => (
            <button
              key={v.id}
              type="button"
              role="menuitemradio"
              aria-checked={v.id === active.id}
              className="menu-item proposal-item"
              data-testid={`proposal-item-${v.id}`}
              onClick={() => choose(v.id)}
            >
              <span className="proposal-name">
                {v.name}
                {v.locked && <span className="tag lock-tag">{nb.topbar.lockedTag}</span>}
              </span>
              <span className="proposal-meta">{metaLine(v, meta[v.id], now)}</span>
            </button>
          ))}
          <div className="menu-sep" role="separator" />
          {!readOnly && base && (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              data-testid="menu-new-proposal"
              onClick={() => {
                setOpen(false);
                askNameAndCopy(base.id);
              }}
            >
              {f.newFromBase}
            </button>
          )}
          {!readOnly && !active.locked && (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              data-testid="menu-copy-proposal"
              onClick={() => {
                setOpen(false);
                askNameAndCopy();
              }}
            >
              {f.copyActive(active.name)}
            </button>
          )}
          {!readOnly && (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              data-testid="menu-trash"
              onClick={() => {
                setOpen(false);
                props.onOpenTrash();
              }}
            >
              {f.trashItem(trashCount)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Slett, asked twice (docs/phase2-plan.md §5): "Vil du slette «X»?" → "Er du sikker? Forslaget forsvinner for alle.
 * [Slett for alle]" (locally: "… forsvinner fra listen. [Slett]"); then it goes to the Papirkurv.
 */
export function DeleteProposalDialog(props: { proposal: Variant; onClose: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const d = nb.family.delete;
  const shared = familyMode === 'shared';
  return (
    <Modal title={d.heading} onClose={props.onClose} testId="delete-dialog">
      {step === 1 ? (
        <>
          <p data-testid="delete-step-1">{d.first(props.proposal.name)}</p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={props.onClose} data-autofocus>
              {d.cancel}
            </button>
            <button type="button" className="btn btn-danger" data-testid="delete-next" onClick={() => setStep(2)}>
              {d.next}
            </button>
          </div>
        </>
      ) : (
        <>
          <p data-testid="delete-step-2">
            <strong>{shared ? d.sureShared : d.sureLocal}</strong> {d.trashNote}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={props.onClose}>
              {d.cancel}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-danger-fill"
              data-testid="delete-confirm"
              onClick={() => {
                deleteProposal(props.proposal.id);
                props.onClose();
              }}
            >
              {shared ? d.confirmShared : d.confirmLocal}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
