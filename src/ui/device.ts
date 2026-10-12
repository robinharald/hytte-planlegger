/**
 * What kind of device the user is on, for the few texts that differ (nb.ts wording rules): a touch screen has no
 * Ctrl+Z, so a text that mentions undo names only the Angre button there. Pure apart from `matchMedia`; without it
 * (tests, old browsers) the keyboard texts apply.
 */
import { nb } from '../i18n/nb';

/** The primary pointer is a finger (phones, tablets): `(pointer: coarse)`. */
export function usesTouch(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** How to undo on this device: "Angre" by touch, "Angre eller Ctrl+Z" with a keyboard (for nb.prompts texts). */
export function undoHow(touch: boolean = usesTouch()): string {
  return touch ? nb.prompts.undoTouch : nb.prompts.undoKeyboard;
}
