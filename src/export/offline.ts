/**
 * The lazy libraries (the PDF code with jsPDF and svg2pdf.js, the IFC reader web-ifc and its wasm) are not precached
 * by the service worker (vite.config.ts `LAZY_LIBS_*`): on a device that has never used them, without network, their
 * dynamic import fails. `offlineFirstUse(e)` tells that case apart from a real error, so the dialog and the IFC panel
 * can say «Første gang trenger dette nett …» instead of a raw «Failed to fetch dynamically imported module …» or
 * «IFC-fila kunne ikke leses».
 */

/**
 * Messages of a failed dynamic import / module script / fetch in Chromium, Firefox and Safari, Vite's preload, and
 * web-ifc's (Emscripten's) wasm download.
 */
const CHUNK_FAILED = [
  /dynamically imported module/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
  /unable to preload/i,
  /failed to fetch/i,
  /fetching of the wasm failed/i,
  /failed to asynchronously prepare wasm/i,
  /load failed/i,
  /networkerror/i,
];

/** A dynamic import (or a fetch of a library file) failed for want of the file. */
export function isChunkLoadError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const text = `${e.name}: ${e.message}`;
  return CHUNK_FAILED.some((re) => re.test(text));
}

/** The browser says it has no network (undefined outside a browser). */
function browserOffline(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    return false;
  }
}

/** The failure is a library that could not be downloaded: a failed chunk load, or any failure while offline. */
export function offlineFirstUse(e: unknown, offline: boolean = browserOffline()): boolean {
  return offline || isChunkLoadError(e);
}
