/**
 * IFC → overlay data (types.ts) with web-ifc. The caller passes the web-ifc module and an initialised `IfcAPI` (the
 * browser build with the wasm URL in loader.ts, the Node build with web-ifc-node.wasm in the tests), so this file
 * imports web-ifc only as types and stays out of the app's main chunk.
 *
 * Kinds: walls (incl. curtain walls), windows, doors, roof (IfcRoof and IfcSlab .ROOF.; an untyped slab more than
 * 0.5 m high is a sloped roof slab), slabs (the other IfcSlabs), other (columns, beams, stairs, railings, the chimney,
 * members, plates, footings, proxies such as window trims). Spaces, openings, furniture and annotations are left out.
 * Plan sections of walls, windows and doors are cut at SECTION_HEIGHTS (plan heights above the main floor), element
 * by element: Plan 1 takes everything the plane cuts; Hems only the elements of an upper storey (contained in an
 * IfcBuildingStorey at least UPPER_STOREY_MIN above the main floor, or with no storey and starting that high), so the
 * main level's tall walls under the open roof are not drawn on the Hems tab.
 */
import type * as WebIfc from 'web-ifc';
import { sliceTriangles } from './slice';
import { IFC_CALIBRATION, ifcHeight } from './transform';
import type { IfcTransform } from './transform';
import { IFC_KINDS, IFC_SECTION_KINDS, PARSER_VERSION } from './types';
import type { IfcKind, IfcMesh, IfcSection, IfcSectionKind, IfcStorey, ParsedIfc } from './types';

export type WebIfcModule = typeof WebIfc;
export type WebIfcApi = InstanceType<WebIfcModule['IfcAPI']>;

/** In types.ts, so the cache (in the start bundle) need not import this lazily loaded module. */
export { PARSER_VERSION } from './types';

/**
 * Plan heights of the section cuts (m above the main floor). Plan 1 at 0.9: through the lower level's windows
 * (sill −0.2, head 1.01), its doors (−1 … 1.01) and the main level's windows (sill 0.4 / 0.8) and doors. Hems at 2.1:
 * 0.63 above the hems floor (1.47), under the top of the knee walls (2.22) and above the gable windows' sill (2.0).
 */
export const SECTION_HEIGHTS: Readonly<Record<IfcStorey, number>> = { ground: 0.9, loft: 2.1 };

/** An IFC storey this high above the main floor (m) is an upper storey (the architect's «Plan 2» is at 2.5). */
export const UPPER_STOREY_MIN = 1.0;

const SI_PREFIX: Record<string, number> = { KILO: 1e3, HECTO: 1e2, DECA: 10, DECI: 0.1, CENTI: 0.01, MILLI: 0.001, MICRO: 1e-6 };

const TYPES: Record<IfcKind, string[]> = {
  wall: ['IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCWALLELEMENTEDCASE', 'IFCCURTAINWALL'],
  window: ['IFCWINDOW', 'IFCWINDOWSTANDARDCASE'],
  door: ['IFCDOOR', 'IFCDOORSTANDARDCASE'],
  roof: ['IFCROOF'],
  slab: ['IFCSLAB', 'IFCSLABSTANDARDCASE', 'IFCSLABELEMENTEDCASE'],
  other: [
    'IFCCOLUMN',
    'IFCBEAM',
    'IFCSTAIR',
    'IFCSTAIRFLIGHT',
    'IFCRAILING',
    'IFCCHIMNEY',
    'IFCMEMBER',
    'IFCPLATE',
    'IFCFOOTING',
    'IFCRAMP',
    'IFCRAMPFLIGHT',
    'IFCBUILDINGELEMENTPROXY',
  ],
};

/** A slab without .ROOF. that spans more than this in height is taken as a sloped roof slab. */
const SLOPED_SLAB_RISE = 0.5;

interface Acc {
  positions: number[];
  indices: number[];
}

function attrValue(v: unknown): unknown {
  return v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : undefined;
}

/** Metres per length unit of the file (SI prefixes only; anything else counts as metres). */
function lengthScale(mod: WebIfcModule, api: WebIfcApi, id: number): number {
  const units = api.GetLineIDsWithType(id, mod.IFCSIUNIT);
  for (let i = 0; i < units.size(); i++) {
    const u = api.GetLine(id, units.get(i)) as { UnitType?: unknown; Prefix?: unknown };
    if (attrValue(u.UnitType) !== 'LENGTHUNIT') continue;
    const prefix = attrValue(u.Prefix);
    return typeof prefix === 'string' ? (SI_PREFIX[prefix] ?? 1) : 1;
  }
  return 1;
}

/** Elevation (m, IFC frame) of the storey each element is contained in. */
function storeyElevations(mod: WebIfcModule, api: WebIfcApi, id: number): Map<number, number> {
  const scale = lengthScale(mod, api, id);
  const elevation = new Map<number, number>();
  const storeys = api.GetLineIDsWithType(id, mod.IFCBUILDINGSTOREY);
  for (let i = 0; i < storeys.size(); i++) {
    const e = attrValue((api.GetLine(id, storeys.get(i)) as { Elevation?: unknown }).Elevation);
    if (typeof e === 'number') elevation.set(storeys.get(i), e * scale);
  }
  const out = new Map<number, number>();
  const rels = api.GetLineIDsWithType(id, mod.IFCRELCONTAINEDINSPATIALSTRUCTURE);
  for (let i = 0; i < rels.size(); i++) {
    const r = api.GetLine(id, rels.get(i)) as { RelatedElements?: unknown[]; RelatingStructure?: unknown };
    const z = elevation.get(attrValue(r.RelatingStructure) as number);
    if (z === undefined) continue;
    for (const e of r.RelatedElements ?? []) {
      const ref = attrValue(e);
      if (typeof ref === 'number') out.set(ref, z);
    }
  }
  return out;
}

function enumValue(v: unknown): string | null {
  if (v && typeof v === 'object' && 'value' in v) {
    const value = (v as { value: unknown }).value;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

export function parseIfcModel(
  mod: WebIfcModule,
  api: WebIfcApi,
  bytes: Uint8Array,
  file: { name: string; size: number },
  transform: IfcTransform = IFC_CALIBRATION,
): ParsedIfc {
  try {
    api.SetLogLevel(mod.LogLevel.LOG_LEVEL_OFF);
  } catch {
    /* older builds without log levels */
  }
  const id = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
  if (id < 0) throw new Error('OpenModel failed');
  try {
    const constants = mod as unknown as Record<string, unknown>;
    const kindOfType = new Map<number, IfcKind>();
    for (const kind of IFC_KINDS) {
      for (const name of TYPES[kind]) {
        const code = constants[name];
        if (typeof code === 'number') kindOfType.set(code, kind);
      }
    }
    const slabTypes = new Set(TYPES.slab.map((n) => constants[n]).filter((c): c is number => typeof c === 'number'));
    const storeyOf = storeyElevations(mod, api, id);
    const sectionKinds = new Set<IfcKind>(IFC_SECTION_KINDS);
    const storeys = Object.keys(SECTION_HEIGHTS) as IfcStorey[];
    const cuts = Object.fromEntries(storeys.map((st) => [st, Object.fromEntries(IFC_SECTION_KINDS.map((k) => [k, [] as number[]]))])) as Record<
      IfcStorey,
      Record<IfcSectionKind, number[]>
    >;
    const acc = Object.fromEntries(IFC_KINDS.map((k) => [k, { positions: [], indices: [] } as Acc])) as Record<IfcKind, Acc>;
    const counts = Object.fromEntries(IFC_KINDS.map((k) => [k, 0])) as Record<IfcKind, number>;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

    api.StreamAllMeshesWithTypes(id, [...kindOfType.keys()], (mesh) => {
      const line = api.GetLine(id, mesh.expressID) as { type: number; PredefinedType?: unknown };
      let kind = kindOfType.get(line.type) ?? 'other';
      const pos: number[] = [];
      const idx: number[] = [];
      let hMin = Infinity;
      let hMax = -Infinity;
      for (let g = 0; g < mesh.geometries.size(); g++) {
        const placed = mesh.geometries.get(g);
        const geom = api.GetGeometry(id, placed.geometryExpressID);
        try {
          const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
          const tris = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
          const m = placed.flatTransformation;
          const base = pos.length / 3;
          // vertex = position (3) + normal (3)
          for (let j = 0; j + 5 < verts.length; j += 6) {
            const x = verts[j];
            const y = verts[j + 1];
            const z = verts[j + 2];
            const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
            const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
            const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
            // web-ifc's Y-up world back to the IFC's Z-up frame: (u, v, h) = (x, −z, y)
            pos.push(wx, -wz, wy);
            if (wy < hMin) hMin = wy;
            if (wy > hMax) hMax = wy;
          }
          for (let j = 0; j < tris.length; j++) idx.push(tris[j] + base);
        } finally {
          geom.delete();
        }
      }
      if (idx.length === 0) return;
      if (slabTypes.has(line.type)) {
        const pre = enumValue(line.PredefinedType);
        if (pre === 'ROOF' || ((pre === null || pre === 'NOTDEFINED' || pre === 'USERDEFINED') && hMax - hMin > SLOPED_SLAB_RISE)) kind = 'roof';
      }
      if (sectionKinds.has(kind)) {
        const z = storeyOf.get(mesh.expressID);
        const upper = (z ?? hMin) + transform.dz >= UPPER_STOREY_MIN;
        for (const st of storeys) {
          if (st === 'loft' && !upper) continue;
          sliceTriangles(pos, idx, ifcHeight(transform, SECTION_HEIGHTS[st]), cuts[st][kind as IfcSectionKind]);
        }
      }
      const into = acc[kind];
      const offset = into.positions.length / 3;
      for (let j = 0; j < pos.length; j += 3) {
        into.positions.push(pos[j], pos[j + 1], pos[j + 2]);
        for (let a = 0; a < 3; a++) {
          if (pos[j + a] < min[a]) min[a] = pos[j + a];
          if (pos[j + a] > max[a]) max[a] = pos[j + a];
        }
      }
      for (const i of idx) into.indices.push(i + offset);
      counts[kind]++;
    });

    const meshes: IfcMesh[] = IFC_KINDS.filter((k) => acc[k].indices.length > 0).map((k) => ({
      kind: k,
      positions: Float32Array.from(acc[k].positions),
      indices: Uint32Array.from(acc[k].indices),
    }));
    const sections: IfcSection[] = [];
    for (const storey of storeys) {
      for (const kind of IFC_SECTION_KINDS) {
        const segs = cuts[storey][kind];
        if (segs.length > 0) sections.push({ storey, kind, planH: SECTION_HEIGHTS[storey], segments: Float32Array.from(segs) });
      }
    }
    if (meshes.length === 0) {
      min.fill(0);
      max.fill(0);
    }
    return { version: PARSER_VERSION, fileName: file.name, fileSize: file.size, schema: api.GetModelSchema(id) ?? '', meshes, sections, counts, min, max };
  } finally {
    api.CloseModel(id);
  }
}
