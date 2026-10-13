/**
 * IFC overlay (brief §4 «optional layer»): what the parser keeps of the architect's IFC model of the cabin today. It is
 * read from the user's own disk, cached on this device only (cache.ts) and drawn semi-transparent over the plan
 * (plan2d/layers/IfcLayer.tsx) and in 3D (view3d/IfcOverlay.tsx). It is never part of a project, a share link, the
 * family's proposals or the published site (the model is the architect's work and private).
 *
 * Frame: everything here is in the IFC's own frame after the model's placements, Z up, metres:
 * (u, v, h) = IFC (X, Y, Z). web-ifc returns a Y-up world (x, y, z) = (u, h, −v). transform.ts maps (u, v, h) to the
 * plan frame.
 */

/** Bump when the parsed data changes, so cached models are parsed again (cache.ts drops other versions). */
export const PARSER_VERSION = 1;

export type IfcKind = 'wall' | 'window' | 'door' | 'roof' | 'slab' | 'other';

export const IFC_KINDS: readonly IfcKind[] = ['wall', 'window', 'door', 'roof', 'slab', 'other'];

/** The kinds drawn as outlines in the plan. */
export type IfcSectionKind = 'wall' | 'window' | 'door';

export const IFC_SECTION_KINDS: readonly IfcSectionKind[] = ['wall', 'window', 'door'];

/** The app's plan storeys ('ground' = Plan 1 with the lower and main levels, 'loft' = Hems). */
export type IfcStorey = 'ground' | 'loft';

/** All triangles of one kind, merged: `positions` are (u, v, h) triples, `indices` index them (3 per triangle). */
export interface IfcMesh {
  kind: IfcKind;
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Horizontal section of one kind for one storey, cut at the plan height `planH` (metres above the main floor):
 * line segments [u0, v0, u1, v1, …] in the IFC frame.
 */
export interface IfcSection {
  storey: IfcStorey;
  kind: IfcSectionKind;
  planH: number;
  segments: Float32Array;
}

export interface ParsedIfc {
  /** PARSER_VERSION when it was parsed; a cached model of another version is not used. */
  version: number;
  fileName: string;
  fileSize: number;
  /** IFC schema of the file ('IFC2X3', 'IFC4', …). */
  schema: string;
  meshes: IfcMesh[];
  sections: IfcSection[];
  /** Elements per kind that had geometry. */
  counts: Record<IfcKind, number>;
  /** Bounds of every mesh, (u, v, h). */
  min: [number, number, number];
  max: [number, number, number];
}
