/**
 * Phone bottom sheet (docs/phase2-plan.md §3.1 / §3.2: the properties panel and the furniture library open as bottom
 * sheets on phones). A panel fixed to the bottom of the screen, in a portal, WITHOUT a backdrop so the plan above it
 * stays usable (tap another element and the sheet shows its properties). × closes. Esc closes it unless a text field
 * inside has the focus (the field's own Esc restores its value first).
 *
 * Two stops (UX finding "the sheet hides what you edit"): it opens LOW, with only the basic fields (the editors'
 * "Mer" part and their read-only rows are hidden, CSS `[data-stop='basic']`), so most of the plan stays visible; the
 * handle or "Vis mer" opens it to almost full height with everything. Its height is reported to the overlay store
 * (`setSheetHeight`), which the plan gets as its bottom inset (Stage.tsx `viewportInsets`).
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { nb } from '../i18n/nb';
import { IconClose } from './common';
import { isEditableTarget } from './keys';
import { setSheetHeight } from './overlay';

export type SheetStop = 'basic' | 'full';

export function BottomSheet(props: { title: string; onClose: () => void; children: ReactNode; testId?: string }) {
  const [stop, setStop] = useState<SheetStop>('basic');
  const expanded = stop === 'full';
  const toggle = () => setStop((x) => (x === 'full' ? 'basic' : 'full'));
  const titleId = useId();
  const sheetId = useId();
  const ref = useRef<HTMLElement>(null);
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

  // Report the height while open (it changes with the stop and the content), and nothing once closed.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => setSheetHeight(sheetId, Math.round(el.getBoundingClientRect().height));
    report();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(report) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      setSheetHeight(sheetId, null);
    };
  }, [sheetId]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setSheetHeight(sheetId, Math.round(el.getBoundingClientRect().height));
  }, [sheetId, stop]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <section
      ref={ref}
      className="sheet"
      data-stop={stop}
      data-expanded={expanded || undefined}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid={props.testId}
    >
      <button type="button" className="sheet-handle" aria-label={expanded ? nb.sheet.collapse : nb.sheet.expand} aria-expanded={expanded} onClick={toggle}>
        <span aria-hidden="true" />
      </button>
      <div className="sheet-head">
        <h2 id={titleId} className="panel-title">
          {props.title}
        </h2>
        <button type="button" className="btn btn-ghost btn-small sheet-stop" onClick={toggle} aria-expanded={expanded} data-testid="sheet-stop">
          {expanded ? nb.sheet.collapse : nb.sheet.expand}
        </button>
        <button type="button" className="btn btn-ghost btn-small icon-btn" onClick={props.onClose} aria-label={nb.sheet.close} title={nb.sheet.close}>
          <IconClose />
        </button>
      </div>
      <div className="sheet-body">{props.children}</div>
    </section>,
    document.body,
  );
}
