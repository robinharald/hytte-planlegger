/**
 * Capture of the 3D view for «Lagre 3D-bildet som PNG» (export/png.ts, brief §6).
 *
 * View3D registers its R3F root once it is created (`<Canvas onCreated={registerCapture}>`); `capture3d()` then
 * renders the current scene from the current camera on demand at the device's pixel ratio (the canvas itself runs at
 * most 1.5×), copies the frame into a 2D canvas in the same task and puts the renderer back to its own ratio with a
 * fresh frame — so the copy never depends on `preserveDrawingBuffer` and never shows a half-drawn frame. The ratio is
 * capped (`captureRatio`) to stay inside the iPhone's canvas limit (16.7 M pixels) and common texture sizes.
 *
 * Type-only imports: this module is also loaded by the main bundle (the export menu), and must not pull three.js or
 * R3F into it. The 3D view stays mounted once shown (Stage.tsx), so a registration stays valid; one whose canvas has
 * left the document counts as none.
 */
import type { RootState } from '@react-three/fiber';

export interface Captured3D {
  /** The frame, `ratio` device pixels per CSS pixel. */
  canvas: HTMLCanvasElement;
  ratio: number;
  cssWidth: number;
  cssHeight: number;
}

/** Most pixels in a capture (iOS Safari refuses canvases over 16 777 216 pixels). */
export const MAX_CAPTURE_PIXELS = 16_000_000;
/** Longest side of a capture (px). */
export const MAX_CAPTURE_SIDE = 8192;
/** Highest pixel ratio used (an iPhone is 3). */
export const MAX_CAPTURE_RATIO = 3;

/** The pixel ratio a `cssW` × `cssH` view is captured at on a `dpr` screen: the device ratio within the limits. */
export function captureRatio(cssW: number, cssH: number, dpr: number): number {
  let r = Math.min(Math.max(1, Number.isFinite(dpr) ? dpr : 1), MAX_CAPTURE_RATIO);
  if (cssW > 0 && cssH > 0) r = Math.min(r, MAX_CAPTURE_SIDE / cssW, MAX_CAPTURE_SIDE / cssH, Math.sqrt(MAX_CAPTURE_PIXELS / (cssW * cssH)));
  return r;
}

let getState: (() => RootState) | null = null;

/** View3D's `<Canvas onCreated>`: remember the root so the view can be captured. */
export function registerCapture(state: RootState): void {
  getState = state.get;
}

function live(): RootState | null {
  const s = getState?.();
  if (!s || !s.gl?.domElement?.isConnected || !(s.size.width > 0 && s.size.height > 0)) return null;
  return s;
}

/** A 3D view is mounted and can be captured. */
export function hasCapture(): boolean {
  return live() !== null;
}

/** Resolves true once a 3D view can be captured (at once when one can), false after `timeoutMs`. */
export function whenCaptureReady(timeoutMs = 10000): Promise<boolean> {
  if (hasCapture()) return Promise.resolve(true);
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (hasCapture()) resolve(true);
      else if (Date.now() - start >= timeoutMs) resolve(false);
      else setTimeout(tick, 100);
    };
    setTimeout(tick, 100);
  });
}

/**
 * The 3D view as it is now, rendered at `dpr` (default the device's pixel ratio, see `captureRatio`). Null when no
 * 3D view is mounted or the frame cannot be copied.
 */
export function capture3d(dpr: number = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1): Captured3D | null {
  const s = live();
  if (!s) return null;
  const { gl, scene, camera, size } = s;
  const prev = gl.getPixelRatio();
  const ratio = captureRatio(size.width, size.height, dpr);
  const resize = Math.abs(ratio - prev) > 1e-3;
  try {
    if (resize) gl.setPixelRatio(ratio);
    gl.render(scene, camera);
    const src = gl.domElement;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d');
    if (!ctx || out.width === 0 || out.height === 0) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    return { canvas: out, ratio: src.width / size.width, cssWidth: size.width, cssHeight: size.height };
  } finally {
    if (resize) {
      gl.setPixelRatio(prev);
      gl.render(scene, camera);
    }
    s.invalidate();
  }
}
