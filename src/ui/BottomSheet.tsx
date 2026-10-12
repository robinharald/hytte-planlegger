/**
 * Phone bottom sheet (docs/phase2-plan.md §3.1 / §3.2: the properties panel and the furniture library open as bottom
 * sheets on phones). A panel fixed to the bottom of the screen, in a portal, WITHOUT a backdrop so the plan above it
 * stays usable (tap another element and the sheet shows its properties). The handle toggles between half height
 * and almost full height; × closes. Esc closes it unless a text field inside has the focus (the field's own Esc
 * restores its value first).
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { nb } from '../i18n/nb';
import { IconClose } from './common';
import { isEditableTarget } from './keys';

export function BottomSheet(props: { title: string; onClose: () => void; children: ReactNode; testId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const onCloseRef = useRef(props.onClose);
  useEffect(() => {
    onCloseRef.current = props.onClose;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isEditableTarget(e.target)) return;
      if (document.querySelector('.modal-overlay')) return;
      e.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <section className="sheet" data-expanded={expanded || undefined} role="dialog" aria-modal="false" aria-labelledby={titleId} data-testid={props.testId}>
      <button
        type="button"
        className="sheet-handle"
        aria-label={expanded ? nb.sheet.collapse : nb.sheet.expand}
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
      >
        <span aria-hidden="true" />
      </button>
      <div className="sheet-head">
        <h2 id={titleId} className="panel-title">
          {props.title}
        </h2>
        <button type="button" className="btn btn-ghost btn-small icon-btn" onClick={props.onClose} aria-label={nb.sheet.close} title={nb.sheet.close}>
          <IconClose />
        </button>
      </div>
      <div className="sheet-body">{props.children}</div>
    </section>,
    document.body,
  );
}
