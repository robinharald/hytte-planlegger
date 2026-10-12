/**
 * The furniture library slot (docs/phase2-plan.md §3.2: "Møbler replaces the left column (heading «Møbler», «Lukk»);
 * bottom sheet on phones"). App.tsx passes the library (ui/FurnitureLibrary.tsx) as `children`: `<LibraryPanel>` on
 * desktop and tablet, `<LibrarySheet>` (variant "sheet") on phones. "Lukk" goes back to Velg.
 */
import type { ReactNode } from 'react';
import { nb } from '../i18n/nb';
import { BottomSheet } from './BottomSheet';
import { setTool } from './editorBridge';

const close = () => setTool('select');

/** Desktop / tablet: in place of the left column while the Møbler tool is active. */
export function LibraryPanel(props: { children: ReactNode }) {
  return (
    <aside className="controls library" data-testid="furniture-library">
      <div className="library-head">
        <h2 className="panel-title">{nb.library.heading}</h2>
        <button type="button" className="btn btn-small" onClick={close} title={nb.library.closeTitle} data-testid="library-close">
          {nb.library.close}
        </button>
      </div>
      {props.children}
    </aside>
  );
}

/** Phone: the library as a bottom sheet while the Møbler tool is active. */
export function LibrarySheet(props: { children: ReactNode }) {
  return (
    <BottomSheet title={nb.library.heading} onClose={close} testId="furniture-library-sheet">
      {props.children}
    </BottomSheet>
  );
}
