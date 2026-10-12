/**
 * Keyboard shortcut matching (pure, unit-tested):
 *  - Ctrl/Cmd+Z undo, Ctrl/Cmd+Y and Ctrl/Cmd+Shift+Z redo, Esc (leave the tool, else clear the selection);
 *  - phase 2 (docs/phase2-plan.md §3.5, Hjelp): Delete / Backspace delete the selection, R rotates furniture,
 *    Ctrl/Cmd+D duplicates, the arrow keys nudge the selection 1 cm (Shift: 10 cm; plan +y is up on screen).
 * Shortcuts other than Esc are ignored while typing in a text field.
 */

export type ShortcutAction = 'undo' | 'redo' | 'escape' | 'delete' | 'rotate' | 'duplicate' | 'nudge';

type KeyInfo = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/** Nudge steps (m). */
export const NUDGE_STEP = 0.01;
export const NUDGE_STEP_SHIFT = 0.1;

export function shortcutFor(e: KeyInfo): ShortcutAction | null {
  if (e.key === 'Escape') return 'escape';
  const mod = e.ctrlKey || e.metaKey;
  if (e.altKey) return null;
  if (!mod) {
    if (e.key === 'Delete' || e.key === 'Backspace') return 'delete';
    if (e.key === 'r' || e.key === 'R') return 'rotate';
    if (e.key.startsWith('Arrow')) return 'nudge';
    return null;
  }
  const k = e.key.toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && !e.shiftKey) return 'redo';
  if (k === 'd' && !e.shiftKey) return 'duplicate';
  return null;
}

/** Plan delta (m) of an arrow key, or null. */
export function nudgeDelta(e: Pick<KeyboardEvent, 'key' | 'shiftKey'>): [number, number] | null {
  const s = e.shiftKey ? NUDGE_STEP_SHIFT : NUDGE_STEP;
  switch (e.key) {
    case 'ArrowLeft':
      return [-s, 0];
    case 'ArrowRight':
      return [s, 0];
    case 'ArrowUp':
      return [0, s];
    case 'ArrowDown':
      return [0, -s];
    default:
      return null;
  }
}

/** Text inputs, selects and contenteditable keep their own keyboard handling. */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!t || typeof (t as Element).closest !== 'function') return false;
  const el = t as HTMLElement;
  if (el.isContentEditable) return true;
  if (el.closest('textarea, select, [contenteditable="true"]')) return true;
  const input = el.closest('input');
  if (!input) return false;
  return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color'].includes(input.type);
}

/** Inside a modal dialog: the selection shortcuts must not act on what is behind it. */
export function isInDialog(t: EventTarget | null): boolean {
  return !!t && typeof (t as Element).closest === 'function' && !!(t as Element).closest('[aria-modal="true"]');
}
