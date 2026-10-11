/**
 * Small React/three helpers shared by the 3D components: geometry lifetime and selection tagging.
 *
 * - `useGeometry` turns builder output (MeshData, plan frame; the caller memoises it) into a BufferGeometry,
 *   rebuilt when the data changes and disposed when replaced or unmounted. Materials are shared singletons
 *   (materials.ts) and are never disposed here.
 * - Selectable objects carry `userData.select: Selection` (on the mesh or any ancestor); `selectionOf` walks up
 *   to find it. `isShown` checks the whole ancestor chain, because raycasting does not skip invisible objects.
 */
import { useEffect, useMemo } from 'react';
import type { BufferGeometry, Object3D } from 'three';
import type { Selection } from '../state/selection';
import { isEmpty, toBufferGeometry } from './geometryBuilders';
import type { MeshData } from './geometryBuilders';

function toGeometry(d: MeshData | null | undefined): BufferGeometry | null {
  return d && !isEmpty(d) ? toBufferGeometry(d) : null;
}

/** BufferGeometry for memoised MeshData; null when empty. Disposed when the data changes and on unmount. */
export function useGeometry(data: MeshData | null): BufferGeometry | null {
  const geo = useMemo(() => toGeometry(data), [data]);
  useEffect(() => () => geo?.dispose(), [geo]);
  return geo;
}

/** Several geometries from one memoised build (e.g. solid + glass). */
export function useGeometries(datas: (MeshData | null)[]): (BufferGeometry | null)[] {
  const geos = useMemo(() => datas.map(toGeometry), [datas]);
  useEffect(() => () => geos.forEach((g) => g?.dispose()), [geos]);
  return geos;
}

/** `userData` for a selectable object. */
export function selectable(sel: Selection): { select: Selection } {
  return { select: sel };
}

export function selectionOf(obj: Object3D | null): Selection | null {
  for (let o: Object3D | null = obj; o; o = o.parent) {
    const s = (o.userData as { select?: Selection }).select;
    if (s) return s;
  }
  return null;
}

/** True when the object and all its ancestors are visible. */
export function isShown(obj: Object3D): boolean {
  for (let o: Object3D | null = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Same element: kind and id equal, and levelId equal when both name one. */
export function matchesSelection(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;
  return !a.levelId || !b.levelId || a.levelId === b.levelId;
}
