/**
 * Small shared UI building blocks: collapsible Panel, Modal (portal, Esc/overlay to close, focus handling),
 * ErrorBoundary and a few inline icons. Text comes from i18n/nb.ts.
 */
import { Component, useEffect, useId, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { nb } from '../i18n/nb';

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function Panel(props: { title: string; badge?: ReactNode; defaultOpen?: boolean; testId?: string; id?: string; children: ReactNode }) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  return (
    <details className="panel" id={props.id} open={open} onToggle={(e) => setOpen(e.currentTarget.open)} data-testid={props.testId}>
      <summary>
        <span className="panel-title">
          {props.title}
          {props.badge !== undefined && <span className="panel-badge">{props.badge}</span>}
        </span>
      </summary>
      <div className="panel-body">{props.children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

/**
 * Dialog in a portal. Esc and a click on the backdrop close it; Esc is caught in the capture phase so the
 * global Esc (clear selection) does not also fire. Focus moves into the dialog and back on close.
 */
export function Modal(props: { title: string; onClose: () => void; children: ReactNode; testId?: string }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(props.onClose);
  useEffect(() => {
    onCloseRef.current = props.onClose;
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]');
    (first ?? panel)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus();
    };
  }, []);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef} tabIndex={-1} data-testid={props.testId}>
        <div className="modal-head">
          <h2 id={titleId}>{props.title}</h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={props.onClose} aria-label={nb.a11y.closeDialog}>
            <IconClose />
          </button>
        </div>
        {props.children}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

interface BoundaryProps {
  fallback: (error: Error, reset: () => void) => ReactNode;
  children: ReactNode;
  /** Changing this value clears a caught error (e.g. the variant id). */
  resetKey?: unknown;
}

interface BoundaryState {
  error: Error | null;
  resetKey: unknown;
}

export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, resetKey: undefined };

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('UI error', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error) return this.props.fallback(error, () => this.setState({ error: null }));
    return this.props.children;
  }
}

/** Fallback for one pane (plan or 3D): message + retry. */
export function PaneError(props: { error: Error; reset: () => void }) {
  return (
    <div className="pane-message" role="alert">
      <p>{nb.error.paneBody}</p>
      <p className="note">{props.error.message}</p>
      <div>
        <button type="button" className="btn" onClick={props.reset}>
          {nb.error.retry}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons (inline, currentColor)
// ---------------------------------------------------------------------------

function Svg(props: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {props.children}
    </svg>
  );
}

export const IconUndo = () => (
  <Svg>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);
export const IconRedo = () => (
  <Svg>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Svg>
);
export const IconClose = () => (
  <Svg>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);
export const IconHelp = () => (
  <Svg>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M9.2 9.3a3 3 0 0 1 5.6 1.2c0 2-3 2.5-3 4.3" />
    <path d="M12 17.6h.01" />
  </Svg>
);
export const IconShare = () => (
  <Svg>
    <path d="M10 14a4 4 0 0 0 5.7 0l3.2-3.2a4 4 0 0 0-5.7-5.7l-1.1 1.1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3.2 3.2a4 4 0 0 0 5.7 5.7l1.1-1.1" />
  </Svg>
);
export const IconChevronDown = () => (
  <Svg>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

// Toolbar and mini-bar icons (phase 2).
export const IconSelect = () => (
  <Svg>
    <path d="M5 3l6.5 17 2.3-7.2L21 10.5z" />
  </Svg>
);
export const IconWall = () => (
  <Svg>
    <path d="M3 9.5h18v5H3z" />
    <path d="M8 9.5v5M13 9.5v5M18 9.5v5" />
  </Svg>
);
export const IconDoor = () => (
  <Svg>
    <path d="M3 20h18" />
    <path d="M6 20V5" />
    <path d="M6 5a15 15 0 0 1 15 15" />
  </Svg>
);
export const IconHouse = () => (
  <Svg>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5.5 10v10h13V10" />
    <path d="M10 20v-5h4v5" />
  </Svg>
);
export const IconSofa = () => (
  <Svg>
    <path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11" />
    <path d="M3 11h18v6H3z" />
    <path d="M5.5 17v2.5M18.5 17v2.5" />
  </Svg>
);
export const IconRuler = () => (
  <Svg>
    <path d="M3 16.5 16.5 3 21 7.5 7.5 21z" />
    <path d="M7.5 12l2 2M10.5 9l2 2M13.5 6l2 2" />
  </Svg>
);
export const IconRotate = () => (
  <Svg>
    <path d="M20 12a8 8 0 1 1-2.4-5.7" />
    <path d="M20 4v5h-5" />
  </Svg>
);
export const IconTrash = () => (
  <Svg>
    <path d="M4 7h16" />
    <path d="M9 7V4.5h6V7" />
    <path d="M6.5 7l1 13h9l1-13" />
  </Svg>
);
export const IconWarning = () => (
  <Svg>
    <path d="M12 3.5 2.5 20h19z" />
    <path d="M12 10v4.5M12 17.4h.01" />
  </Svg>
);
export const IconSliders = () => (
  <Svg>
    <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="17" cy="18" r="2" />
  </Svg>
);
