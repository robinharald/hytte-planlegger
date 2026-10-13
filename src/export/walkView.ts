/**
 * The PNG of a walk (a tiny module of its own: the PNG code and the 3D view both use it without loading each other):
 *  - `saveWalkPhoto()`: the P key and the walk overlay's camera button (view3d/WalkControls.tsx,
 *    WalkControlsPhoto.tsx) save what the walker sees through pngExport.ts `savePng3d` (a lazy chunk; once
 *    `loadWalkPhoto()` has brought it, the call is synchronous, so a phone's share sheet still counts the tap), and
 *    the walk goes on;
 *  - `walkViewKept()`: the 3D camera still shows the view of a walk that was ended with Esc (WalkControls.tsx keeps
 *    the camera where the walker stood instead of easing back), so the PNG caption names it «Gå rundt». Cleared when
 *    the camera moves again (the orbit controls' change: a drag, a camera angle) and when a new walk starts.
 */
type PngModule = typeof import('./pngExport');

let png: PngModule | null = null;
let kept = false;

/** Loads the PNG code (call it when the camera button appears). */
export function loadWalkPhoto(): Promise<PngModule> {
  return import('./pngExport').then((m) => (png = m));
}

/** Saves what the walker sees now as a PNG (the walk goes on). */
export function saveWalkPhoto(): void {
  if (png) void png.savePng3d();
  else void loadWalkPhoto().then((m) => m.savePng3d(), () => undefined);
}

export function setWalkViewKept(on: boolean): void {
  kept = on;
}

export function walkViewKept(): boolean {
  return kept;
}
