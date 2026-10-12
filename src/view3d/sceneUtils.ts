/**
 * Small React/three helpers shared by the 3D components: geometry lifetime and pick tagging.
 *
 * - `useGeometry` turns builder output (MeshData, plan frame; the caller memoises it) into a BufferGeometry,
 *   rebuilt when the data changes and disposed when replaced or unmounted. Materials are shared singletons
 *   (materials.ts) and are never disposed here.
 * - Pickable objects carry `userData.pick: PickTags` (selection3d.ts) on the mesh or any ancestor; `pickTagsOf`
 *   walks up to the nearest tagged object (its tags decide, even when they select nothing) and `selectionOf` returns
 *   what a click on the object selects. `isShown` checks the whole ancestor chain, because raycasting does not skip
 *   invisible objects.
 */
import { useEffect, useMemo } from 'react';
import type { BufferGeometry, Object3D } from 'three';
import type { Selection } from '../state/selection';
import { isEmpty, toBufferGeometry } from './geometryBuilders';
import type { MeshData } from './geometryBuilders';
import type { PickTags } from './selection3d';

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

/** `userData` for a pickable object. */
export function pickable(tags: PickTags): { pick: PickTags } {
  return { pick: tags };
}

/** Tags of the nearest tagged object at or above `obj`, or null. */
export function pickTagsOf(obj: Object3D | null): PickTags | null {
  for (let o: Object3D | null = obj; o; o = o.parent) {
    const t = (o.userData as { pick?: PickTags }).pick;
    if (t) return t;
  }
  return null;
}

/** What a click on `obj` selects (null: nothing). */
export function selectionOf(obj: Object3D | null): Selection | null {
  return pickTagsOf(obj)?.select ?? null;
}

/** True when the object and all its ancestors are visible. */
export function isShown(obj: Object3D): boolean {
  for (let o: Object3D | null = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}
