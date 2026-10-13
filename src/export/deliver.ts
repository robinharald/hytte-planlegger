/**
 * Handing an exported file to the user: the phone's share sheet with the file (navigator.share, iPhone and Android:
 * «Arkiver i Filer», e-post, meldinger …) where it can take files, else a download, and on an iPhone home-screen app
 * (where a download of a generated file does nothing in some iOS versions) the file opened in a new tab.
 *
 * `navigator.share` needs the user's tap: call `deliverFile` straight from the click handler, with nothing awaited
 * before it (it calls `share` synchronously).
 */
import { isIos } from '../ui/familyUi';

export type Delivery = 'shared' | 'cancelled' | 'downloaded' | 'opened';

/** A touch device whose share sheet takes this kind of file: offer «Del …» rather than a download. */
export function canShareFile(file: File): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** The pointer is a finger (phones, tablets). */
export function coarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

function standaloneIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone && isIos({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints });
}

/** Saves `blob` as `fileName` through a temporary link (or opens it on an iPhone home-screen app). */
export function downloadBlob(blob: Blob, fileName: string, doc: Document = document): Delivery {
  const url = URL.createObjectURL(blob);
  // Revoked late: Safari reads the blob after the click has returned.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  if (standaloneIos()) {
    window.open(url, '_blank');
    return 'opened';
  }
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  return 'downloaded';
}

/**
 * Share the file when `share` and the device can (a cancelled share sheet is 'cancelled', nothing else happens);
 * otherwise, or when sharing fails, download it.
 */
export async function deliverFile(blob: Blob, fileName: string, opts: { share: boolean; title?: string }): Promise<Delivery> {
  if (opts.share && typeof File !== 'undefined') {
    const file = new File([blob], fileName, { type: blob.type });
    if (canShareFile(file)) {
      try {
        await navigator.share({ files: [file], title: opts.title });
        return 'shared';
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
        // NotAllowedError (no tap left, e.g. after waiting for the 3D view) and the like: download instead.
      }
    }
  }
  return downloadBlob(blob, fileName);
}
