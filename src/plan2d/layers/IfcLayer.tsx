/**
 * IFC overlay in the plan (brief §4 «optional layer», src/ifc): semi-transparent blue outlines of the architect's walls
 * (1.25 px), windows (0.75 px) and doors (0.75 px, dashed), cut at the storey's section height (Plan 1 at 0.9 m, Hems at
 * 2.1 m above the main floor). Drawn in the IFC's own frame under one transform (the calibration plus the panel's
 * nudge, src/ifc/transform.ts), so a nudge changes one attribute. No pointer events. Nothing is drawn until a model is
 * loaded and «Vis i planen» is on; on mount it asks the overlay store to bring back the last model from this device.
 *
 * Mount inside the plan's root group, above the walls and openings: `<IfcLayer storey={planStorey} />`.
 */
import { memo, useEffect, useMemo } from 'react';
import { IFC_BLUE, sectionPaths } from '../../ifc/overlayData';
import { ifcOverlay, useIfcOverlay } from '../../ifc/store';
import { IFC_CALIBRATION, svgMatrix, withNudge } from '../../ifc/transform';
import type { IfcStorey } from '../../ifc/types';
import { NSS, STROKE } from '../style';

export const IfcLayer = memo(function IfcLayer({ storey }: { storey: IfcStorey }) {
  useEffect(() => {
    void ifcOverlay.ensureRestored();
  }, []);
  const model = useIfcOverlay((s) => s.model);
  const show = useIfcOverlay((s) => s.prefs.showPlan);
  const opacity = useIfcOverlay((s) => s.prefs.opacity);
  const nudge = useIfcOverlay((s) => s.prefs.nudge);
  const paths = useMemo(() => (model ? sectionPaths(model, storey) : null), [model, storey]);
  if (!model || !show || !paths) return null;
  return (
    <g data-layer="ifc" data-testid="ifc-plan-layer" pointerEvents="none" transform={svgMatrix(withNudge(IFC_CALIBRATION, nudge))} opacity={opacity} fill="none" stroke={IFC_BLUE}>
      {paths.wall && <path d={paths.wall} strokeWidth={STROKE.wall} strokeLinecap="round" data-ifc="wall" {...NSS} />}
      {paths.window && <path d={paths.window} strokeWidth={STROKE.hair} data-ifc="window" {...NSS} />}
      {paths.door && <path d={paths.door} strokeWidth={STROKE.hair} strokeDasharray="4 3" data-ifc="door" {...NSS} />}
    </g>
  );
});
