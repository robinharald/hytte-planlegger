/**
 * The furniture library slot (docs/phase2-plan.md §3.2: "Møbler replaces the left column (heading «Møbler», «Lukk»);
 * bottom sheet on phones"). Phase 2a has no catalogue: the slot shows a placeholder; phase 2b passes the library as
 * `children` (App.tsx renders `<LibraryPanel />` and `<LibrarySheet />`). "Lukk" goes back to Velg.
 */
import type { ReactNode } from 'react';
import { nb } from '../i18n/nb';
import { BottomSheet } from './BottomSheet';
import { setTool } from './editorBridge';

const close = () => setTool('select');

function LibraryContent(props: { children?: ReactNode }) {
  return <>{props.children ?? <p className="muted">{nb.library.placeholder}</p>}</>;
}

/** Desktop / tablet: in place of the left column while the Møbler tool is active. */
export function LibraryPanel(props: { children?: ReactNode }) {
  return (
    <aside className="controls library" data-testid="furniture-library">
      <div className="library-head">
        <h2 className="panel-title">{nb.library.heading}</h2>
        <button type="button" className="btn btn-small" onClick={close} title={nb.library.closeTitle} data-testid="library-close">
          {nb.library.close}
        </button>
      </div>
      <LibraryContent>{props.children}</LibraryContent>
    </aside>
  );
}

/** Phone: the library as a bottom sheet while the Møbler tool is active. */
export function LibrarySheet(props: { children?: ReactNode }) {
  return (
    <BottomSheet title={nb.library.heading} onClose={close} testId="furniture-library-sheet">
      <LibraryContent>{props.children}</LibraryContent>
    </BottomSheet>
  );
}
