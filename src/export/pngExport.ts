/**
 * «Lagre 3D-bildet som PNG» (brief §6), the top bar's menu entry: the 3D view as it is now with its caption strip
 * (png.ts), saved as «hytta-3d-<dato>.png». On a phone the share sheet gets the file (navigator.share), elsewhere it
 * is downloaded (deliver.ts); `window.__hytte.lastExport` tells the e2e tests (hook.ts).
 *
 * Everything from the tap to the share call is synchronous (capture, caption, PNG encoding), so iOS still counts it
 * as the user's tap. When no 3D view has been shown yet, the view switches to 3D first and the image is taken once it
 * has drawn (then a download: the tap is used up).
 */
import { nb } from '../i18n/nb';
import { appStore } from '../state/appStore';
import type { AppState } from '../state/store';
import { selectActiveVariant } from '../state/store';
import { showToast } from '../ui/editorBridge';
import { formatDate } from '../ui/format';
import { capture3d, hasCapture, whenCaptureReady } from '../view3d/capture';
import { coarsePointer, deliverFile } from './deliver';
import { pngFileName } from './fileNames';
import { publishLastExport } from './hook';
import { canvasToPngBlob, composeCaptioned } from './png';
import type { CaptionTexts } from './png';

const S = nb.export;

/** The caption texts for the app's state now. */
export function captionTexts(state: Pick<AppState, 'project' | 'ui'>, date: Date): CaptionTexts {
  const project = state.project;
  const variant = selectActiveVariant({ project });
  const mode = state.ui.mode3d === 'inne' ? nb.mode3d.inne : nb.mode3d.ute;
  const preset = nb.mode3d.presetNames[state.ui.preset] ?? state.ui.preset;
  return { title: `${project.name} – ${variant.name}`, sub: `${S.pngView(mode, preset)} · ${formatDate(date.toISOString())}`, brand: S.tbMadeWith };
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Wait for a 3D view that was just switched on to draw its scene. */
async function settle(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await new Promise((resolve) => setTimeout(resolve, 600));
}

/** The menu entry «Lagre 3D-bildet som PNG». */
export async function savePng3d(): Promise<void> {
  try {
    let fresh = false;
    if (!hasCapture()) {
      const state = appStore.getState();
      if (state.ui.activeView === 'plan') state.setUi({ activeView: '3d' });
      showToast({ text: S.pngOpening3d });
      if (!(await whenCaptureReady())) {
        showToast({ text: S.pngNo3d });
        return;
      }
      await settle();
      fresh = true;
    }
    const shot = capture3d();
    if (!shot) {
      showToast({ text: S.pngNo3d });
      return;
    }
    const date = new Date();
    const image = composeCaptioned(shot, captionTexts(appStore.getState(), date));
    const blob = canvasToPngBlob(image);
    const fileName = pngFileName(date);
    publishLastExport({ kind: 'png', bytes: blob.size, pages: 1, fileName, width: image.width, height: image.height });
    const how = await deliverFile(blob, fileName, { share: coarsePointer() && !fresh, title: fileName });
    if (how === 'downloaded' || how === 'opened') showToast({ text: S.pngSaved(fileName) });
  } catch (e) {
    showToast({ text: S.pngFailed(e instanceof Error ? e.message : String(e)) });
  }
}
