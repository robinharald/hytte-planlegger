/**
 * What the two views draw of a parsed IFC model (pure, no React / three):
 * - `sectionPaths`: SVG path data per section kind for a plan storey, in the IFC frame (the layer's transform maps it
 *   to the plan), one "M x y L x y" per segment, millimetre precision;
 * - `overlayGroups`: the meshes grouped by the panel's 3D switches (walls with doors, windows and the other elements;
 *   roof; slabs).
 */
import type { IfcKind, IfcMesh, IfcSectionKind, IfcStorey, ParsedIfc } from './types';

export const IFC_BLUE = '#1f6fd1';

export type IfcGroup = 'walls' | 'roof' | 'slabs';

export const GROUP_OF_KIND: Record<IfcKind, IfcGroup> = {
  wall: 'walls',
  window: 'walls',
  door: 'walls',
  other: 'walls',
  roof: 'roof',
  slab: 'slabs',
};

const mm = (v: number) => String(Math.round(v * 1000) / 1000 || 0);

export function segmentsPath(segs: ArrayLike<number>): string {
  const parts: string[] = [];
  for (let i = 0; i + 3 < segs.length; i += 4) parts.push(`M${mm(segs[i])} ${mm(segs[i + 1])}L${mm(segs[i + 2])} ${mm(segs[i + 3])}`);
  return parts.join('');
}

export function sectionPaths(model: ParsedIfc, storey: IfcStorey): Partial<Record<IfcSectionKind, string>> {
  const out: Partial<Record<IfcSectionKind, string>> = {};
  for (const s of model.sections) if (s.storey === storey && s.segments.length > 0) out[s.kind] = segmentsPath(s.segments);
  return out;
}

export function overlayGroups(model: ParsedIfc): Record<IfcGroup, IfcMesh[]> {
  const out: Record<IfcGroup, IfcMesh[]> = { walls: [], roof: [], slabs: [] };
  for (const m of model.meshes) out[GROUP_OF_KIND[m.kind]].push(m);
  return out;
}
