/**
 * Keyboard shortcut matching (pure, unit-tested). Phase 1: Ctrl/Cmd+Z undo, Ctrl/Cmd+Y and Ctrl/Cmd+Shift+Z redo,
 * Esc clears the selection. Shortcuts other than Esc are ignored while typing in a text field.
 */

export type ShortcutAction = 'undo' | 'redo' | 'escape';

type KeyInfo = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

export function shortcutFor(e: KeyInfo): ShortcutAction | null {
  if (e.key === 'Escape') return 'escape';
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && !e.shiftKey) return 'redo';
  return null;
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
