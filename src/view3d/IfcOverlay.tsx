/**
 * IFC overlay in 3D (brief §4 «optional layer», src/ifc): the architect's model as semi-transparent blue meshes with
 * blue edges, in three switchable groups (walls with doors, windows and the other elements; roof; slabs; the panel's
 * «Vis i 3D» switches). Mounted inside the <Canvas> next to the scene (View3D.tsx: `<IfcOverlay {...props} />`); not
 * part of the scene's root, so it is never selected by a click and never hides labels.
 *
 * - One group carries the IFC → three.js matrix (src/ifc/transform.ts `worldMatrix`, the calibration plus the
 *   panel's nudge); the geometry is built once per model (positions as stored, flat normals) and reused.
 * - Translucent (opacity = the panel's value × 0.45, edges at the full value), no depth writes, pulled slightly towards
 *   the camera (polygon offset) so faces that coincide with the model's walls show instead of flickering.
 * - Interior mode ('inne'): no roof, and everything above the active storey's floor + the cut height is clipped (one
 *   material clipping plane; the renderer's `localClippingEnabled` is switched on for it).
 * - frameloop 'demand': every change calls `invalidate()`.
 */
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { JSX } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide, EdgesGeometry, LineBasicMaterial, Matrix4, MeshLambertMaterial, Plane, Vector3 } from 'three';
import { GROUP_OF_KIND, IFC_BLUE } from '../ifc/overlayData';
import type { IfcGroup } from '../ifc/overlayData';
import { ifcOverlay, useIfcOverlay } from '../ifc/store';
import { IFC_CALIBRATION, withNudge, worldMatrix } from '../ifc/transform';
import type { IfcKind, ParsedIfc } from '../ifc/types';
import type { View3DProps } from './View3D';

/** Share of the panel's opacity used for the faces (the edges use all of it). */
const FACE_OPACITY = 0.45;
/** Edges between faces meeting at more than this angle (degrees). */
const EDGE_ANGLE = 30;
const NO_RAYCAST = () => {};

interface Part {
  kind: IfcKind;
  group: IfcGroup;
  faces: BufferGeometry;
  edges: EdgesGeometry;
}

function buildParts(model: ParsedIfc): Part[] {
  return model.meshes.map((m) => {
    const faces = new BufferGeometry();
    faces.setAttribute('position', new BufferAttribute(m.positions, 3));
    faces.setIndex(new BufferAttribute(m.indices, 1));
    faces.computeVertexNormals();
    faces.computeBoundingSphere();
    return { kind: m.kind, group: GROUP_OF_KIND[m.kind], faces, edges: new EdgesGeometry(faces, EDGE_ANGLE) };
  });
}

/** Height of the storey's highest level floor (the main floor 0 for Plan 1, the hems 1.47 for Hems). */
function storeyFloor(derived: View3DProps['derived'], storeyId: string): number {
  const storey = derived.storeys.find((s) => s.id === storeyId);
  const zs = (storey?.levelIds ?? []).map((id) => derived.levels.find((l) => l.id === id)?.elevation).filter((z): z is number => typeof z === 'number');
  return zs.length > 0 ? Math.max(...zs) : 0;
}

export function IfcOverlay({ derived, mode, cutHeight, activeStoreyId }: Pick<View3DProps, 'derived' | 'mode' | 'cutHeight' | 'activeStoreyId'>): JSX.Element | null {
  useEffect(() => {
    void ifcOverlay.ensureRestored();
  }, []);
  const model = useIfcOverlay((s) => s.model);
  const prefs = useIfcOverlay((s) => s.prefs);
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);

  const parts = useMemo(() => (model ? buildParts(model) : null), [model]);
  useEffect(
    () => () => {
      for (const p of parts ?? []) {
        p.faces.dispose();
        p.edges.dispose();
      }
    },
    [parts],
  );

  const inne = mode === 'inne';
  const cutZ = storeyFloor(derived, activeStoreyId) + cutHeight;
  const opacity = prefs.opacity;
  const materials = useMemo(() => {
    const clippingPlanes = inne ? [new Plane(new Vector3(0, -1, 0), cutZ)] : [];
    return {
      faces: new MeshLambertMaterial({
        color: IFC_BLUE,
        transparent: true,
        opacity: opacity * FACE_OPACITY,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        clippingPlanes,
      }),
      edges: new LineBasicMaterial({ color: IFC_BLUE, transparent: true, opacity, depthWrite: false, clippingPlanes }),
    };
  }, [opacity, inne, cutZ]);
  useEffect(() => {
    // material clipping planes need the renderer's local clipping (it changes nothing for materials without planes)
    if (inne) get().gl.localClippingEnabled = true;
    invalidate();
    return () => {
      materials.faces.dispose();
      materials.edges.dispose();
    };
  }, [materials, inne, get, invalidate]);

  const { dx, dy } = prefs.nudge;
  const matrix = useMemo(() => new Matrix4().set(...(worldMatrix(withNudge(IFC_CALIBRATION, { dx, dy })) as Parameters<Matrix4['set']>)), [dx, dy]);

  const shown: Record<IfcGroup, boolean> = { walls: prefs.walls3d, roof: prefs.roof3d && !inne, slabs: prefs.slabs3d };
  useEffect(() => {
    invalidate();
  }, [parts, matrix, prefs.show3d, prefs.walls3d, prefs.roof3d, prefs.slabs3d, inne, invalidate]);

  // Test hook (e2e/phase3.spec.ts): how many element groups the overlay draws, on the canvas element.
  const drawn = parts && prefs.show3d ? parts.filter((p) => shown[p.group]).length : 0;
  const canvas = useThree((s) => s.gl.domElement);
  useEffect(() => {
    if (drawn === 0) return;
    canvas.setAttribute('data-ifc-meshes', String(drawn));
    return () => canvas.removeAttribute('data-ifc-meshes');
  }, [canvas, drawn]);

  if (!parts || !prefs.show3d) return null;
  return (
    <group name="ifc-overlay" matrixAutoUpdate={false} matrix={matrix}>
      {parts
        .filter((p) => shown[p.group])
        .map((p) => (
          <group key={p.kind} name={`ifc-${p.kind}`}>
            <mesh geometry={p.faces} material={materials.faces} renderOrder={10} raycast={NO_RAYCAST} />
            <lineSegments geometry={p.edges} material={materials.edges} renderOrder={11} raycast={NO_RAYCAST} />
          </group>
        ))}
    </group>
  );
}
