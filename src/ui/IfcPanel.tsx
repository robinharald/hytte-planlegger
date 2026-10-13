/**
 * «IFC-modell» (brief §4 «optional layer», src/ifc): the panel section after «Vis» (Controls.tsx) that loads the
 * architect's IFC file from this device and controls the overlay. Its contents (ui/IfcPanelBody.tsx: «Last inn
 * IFC-fil», Vis i planen / Vis i 3D, Synlighet, «Juster plassering», «Bytt fil», «Fjern») are a lazy chunk loaded when
 * the panel is first opened, and the IFC parser (and web-ifc) only when a file is picked — nothing of it is in the
 * start bundle. A model loaded before comes back from the device cache after a reload (`ensureRestored`, here and in
 * the plan / 3D layers) without opening the panel.
 */
import { lazy, Suspense, useEffect } from 'react';
import { nb } from '../i18n/nb';
import { ifcOverlay } from '../ifc/store';
import { Panel } from './common';

const IfcPanelBody = lazy(() => import('./IfcPanelBody').then((m) => ({ default: m.IfcPanelBody })));

export function IfcPanel(props: { defaultOpen?: boolean }) {
  useEffect(() => {
    void ifcOverlay.ensureRestored();
  }, []);
  return (
    <Panel title={nb.ifc.heading} defaultOpen={props.defaultOpen ?? false} testId="ifc-panel" onlyWhenOpen>
      <Suspense fallback={null}>
        <IfcPanelBody />
      </Suspense>
    </Panel>
  );
}
