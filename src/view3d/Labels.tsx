/**
 * 3D labels, styled with the old model's label CSS (white tag with a small second line; the orange variant for new
 * elements while "Marker det som er nytt" is on). Content, anchors and the density rule come from labelDefs.ts.
 *
 * The tags are plain DOM elements in one absolutely positioned layer next to the canvas (`[data-labels]`), created
 * and removed imperatively — no React root per label. (drei's <Html> creates a React root per label and unmounts
 * it synchronously from a layout effect; with React 19 that races with its own render when labels change —
 * "Attempted to synchronously unmount a root while React was already rendering" followed by an uncaught
 * removeChild error.) Every rendered frame (frameloop 'demand': camera moves, prop changes) each anchor is
 * projected to the screen, hidden when it is behind the camera, when the building group (`occluder`, never the
 * terrain) is hit by a ray from the camera before the anchor, or when its whole tag would not fit inside the layer,
 * and shown at the density of labelDensities(). Tags claim space in labelOrder(): the room the camera stands in
 * first (never hidden, see labelDefs.placeTag), then by importance (area, mildly weighted by distance); a tag that
 * would overlap an already placed one is hidden (tag sizes are measured once per density).
 */
import { useFrame, useThree } from '@react-three/fiber';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { PerspectiveCamera, Raycaster, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { DerivedVariant } from '../model/derived';
import type { Id } from '../model/types';
import { fromWorld, toWorld } from './coords';
import { blockLabels, cameraInRoom, labelDensities, labelOrder, placeTag, roomLabels } from './labelDefs';
import type { LabelDef, LabelDensity, ScreenRect } from './labelDefs';

type Style = Partial<Record<string, string>>;

const LAYER_STYLE: Style = {
  position: 'absolute',
  top: '0',
  left: '0',
  right: '0',
  bottom: '0',
  overflow: 'hidden',
  pointerEvents: 'none',
  zIndex: '40',
};
const LABEL_STYLE: Style = {
  position: 'absolute',
  left: '0',
  top: '0',
  display: 'none',
  font: '600 12px/1.2 var(--body, "Barlow", "Helvetica Neue", Arial, sans-serif)',
  color: '#1d241e',
  background: 'rgba(255,255,255,.9)',
  padding: '3px 7px',
  borderRadius: '4px',
  whiteSpace: 'nowrap',
  boxShadow: '0 1px 2px rgba(0,0,0,.18)',
  textAlign: 'center',
  pointerEvents: 'none',
  userSelect: 'none',
  willChange: 'transform',
};
const LABEL_NEW_STYLE: Style = { ...LABEL_STYLE, background: '#fff3e6', color: '#6b3a10', border: '1px solid #e3a868' };
const SMALL_STYLE: Style = { display: 'block', fontWeight: '500', fontSize: '11px', color: '#4b554d' };
const SMALL_NEW_STYLE: Style = { ...SMALL_STYLE, color: '#8a5a2c' };

/** An anchor hidden by geometry closer than its distance minus this (m) is occluded. */
const OCCLUSION_SLACK = 0.15;

function applyStyle(el: HTMLElement, style: Style): void {
  for (const [k, v] of Object.entries(style)) if (v !== undefined) (el.style as unknown as Record<string, string>)[k] = v;
}

interface LabelItem {
  def: LabelDef;
  el: HTMLDivElement;
  detail: HTMLElement | null;
  world: Vector3;
  /** Last written state, so the DOM is only touched when something changes. */
  shown: LabelDensity | 'hidden';
  x: number;
  y: number;
  /** Measured tag size (px) per density, cached once known (0 before layout, e.g. in jsdom). */
  size: Partial<Record<'full' | 'name', { w: number; h: number }>>;
}

/** Minimum gap (px) between two shown tags; a tag overlapping a more important one is hidden. */
const LABEL_GAP = 2;

const overlaps = (a: ScreenRect, b: ScreenRect): boolean =>
  a.x0 < b.x1 + LABEL_GAP && b.x0 < a.x1 + LABEL_GAP && a.y0 < b.y1 + LABEL_GAP && b.y0 < a.y1 + LABEL_GAP;

/** Size of the tag at a density (measured once by showing it briefly; the DOM state is restored). */
function measure(it: LabelItem, density: LabelDensity): { w: number; h: number } {
  const key = density === 'full' ? 'full' : 'name';
  const cached = it.size[key];
  if (cached) return cached;
  const display = it.el.style.display;
  const detailDisplay = it.detail?.style.display;
  it.el.style.display = 'block';
  if (it.detail) it.detail.style.display = key === 'full' ? 'block' : 'none';
  const s = { w: it.el.offsetWidth, h: it.el.offsetHeight };
  it.el.style.display = display;
  if (it.detail && detailDisplay !== undefined) it.detail.style.display = detailDisplay;
  if (s.w > 0 && s.h > 0) it.size[key] = s;
  return s;
}

export interface LabelsProps {
  derived: DerivedVariant;
  mode: 'ute' | 'inne';
  activeStoreyId: Id;
  cutHeight: number;
  highlightNew: boolean;
  occluder: RefObject<Object3D | null>;
}

export const Labels = memo(function Labels({ derived, mode, activeStoreyId, cutHeight, highlightNew, occluder }: LabelsProps) {
  const defs = useMemo(
    () => (mode === 'inne' ? roomLabels(derived, activeStoreyId, cutHeight) : blockLabels(derived)),
    [derived, mode, activeStoreyId, cutHeight],
  );
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const items = useRef<LabelItem[]>([]);
  const layer = useMemo(() => (typeof document === 'undefined' ? null : document.createElement('div')), []);
  /** Scratch vectors and the occlusion ray, reused every frame. */
  const scratch = useRef<{ ndc: Vector3; cam: Vector3; dir: Vector3; ray: Raycaster } | null>(null);

  useLayoutEffect(() => {
    const parent = gl.domElement.parentNode;
    if (!layer || !parent) return;
    layer.setAttribute('data-labels', '');
    applyStyle(layer, LAYER_STYLE);
    parent.appendChild(layer);
    return () => {
      layer.remove();
    };
  }, [gl, layer]);

  useLayoutEffect(() => {
    if (!layer) return;
    items.current = defs.map((d) => {
      const isNew = d.isNew && highlightNew;
      const el = document.createElement('div');
      el.setAttribute('data-label', d.key);
      applyStyle(el, isNew ? LABEL_NEW_STYLE : LABEL_STYLE);
      el.append(d.title);
      let detail: HTMLElement | null = null;
      if (d.detail) {
        detail = document.createElement('small');
        applyStyle(detail, isNew ? SMALL_NEW_STYLE : SMALL_STYLE);
        detail.textContent = d.detail;
        el.appendChild(detail);
      }
      layer.appendChild(el);
      const item: LabelItem = { def: d, el, detail, world: toWorld(d.at[0], d.at[1], d.at[2]), shown: 'hidden', x: NaN, y: NaN, size: {} };
      return item;
    });
    invalidate();
    return () => {
      for (const it of items.current) it.el.remove();
      items.current = [];
    };
  }, [layer, defs, highlightNew, invalidate]);

  useFrame((state) => {
    const list = items.current;
    scratch.current ??= { ndc: new Vector3(), cam: new Vector3(), dir: new Vector3(), ray: new Raycaster() };
    const tmp = scratch.current;
    if (list.length === 0) return;
    const { camera, size } = state;
    camera.updateMatrixWorld();
    camera.getWorldPosition(tmp.cam);
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 42;
    const camPlan = fromWorld(tmp.cam);
    const distances = list.map((it) => it.world.distanceTo(tmp.cam));
    const pinned = list.map((it) => cameraInRoom(it.def, camPlan));
    const order = labelOrder(list.map((it) => it.def.weight), distances, pinned);
    const densities = labelDensities(distances, size.height, fov, order, pinned);
    const occ = occluder.current;
    const layerSize = { width: size.width, height: size.height };
    const placed: ScreenRect[] = [];
    for (const i of order) {
      const it = list[i];
      const pin = pinned[i];
      let shown: LabelItem['shown'] = densities[i] === 'none' ? 'hidden' : densities[i];
      let rect: ScreenRect | null = null;
      if (shown !== 'hidden') {
        const ndc = tmp.ndc.copy(it.world).project(camera);
        let anchor: { x: number; y: number } | null =
          ndc.z <= 1 && ndc.z >= -1 ? { x: ((ndc.x + 1) / 2) * size.width, y: ((1 - ndc.y) / 2) * size.height } : null;
        // the camera's own room is never hidden by occlusion (its label point may be behind a post or the chimney)
        if (anchor && !pin && occ) {
          tmp.dir.copy(it.world).sub(tmp.cam).normalize();
          tmp.ray.set(tmp.cam, tmp.dir);
          tmp.ray.far = Math.max(0, distances[i] - OCCLUSION_SLACK);
          if (tmp.ray.intersectObject(occ, true).length > 0) anchor = null;
        }
        const r = placeTag(anchor, measure(it, shown), layerSize, pin);
        if (!r || (!pin && placed.some((p) => overlaps(p, r)))) shown = 'hidden';
        else {
          placed.push(r);
          rect = r;
        }
      }
      if (shown !== it.shown) {
        it.el.style.display = shown === 'hidden' ? 'none' : 'block';
        if (it.detail) it.detail.style.display = shown === 'full' ? 'block' : 'none';
        it.shown = shown;
      }
      if (!rect) continue;
      const x = Math.round((rect.x0 + rect.x1) / 2);
      const y = Math.round(rect.y1);
      if (x !== it.x || y !== it.y) {
        it.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        it.x = x;
        it.y = y;
      }
    }
  });

  return null;
});
