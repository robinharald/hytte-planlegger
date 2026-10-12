// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isEditableTarget, isInDialog, nudgeDelta, shortcutFor } from './keys';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('shortcutFor', () => {
  it('maps undo/redo with Ctrl or Cmd', () => {
    expect(shortcutFor(key('z', { ctrlKey: true }))).toBe('undo');
    expect(shortcutFor(key('Z', { metaKey: true }))).toBe('undo');
    expect(shortcutFor(key('y', { ctrlKey: true }))).toBe('redo');
    expect(shortcutFor(key('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(shortcutFor(key('z', { metaKey: true, shiftKey: true }))).toBe('redo');
  });

  it('maps Esc and ignores everything else', () => {
    expect(shortcutFor(key('Escape'))).toBe('escape');
    expect(shortcutFor(key('z'))).toBeNull();
    expect(shortcutFor(key('z', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(shortcutFor(key('y', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(shortcutFor(key('Delete', { altKey: true }))).toBeNull();
    expect(shortcutFor(key('d', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(shortcutFor(key('a'))).toBeNull();
  });

  it('phase 2: Delete / Backspace, R, Ctrl+D and the arrows', () => {
    expect(shortcutFor(key('Delete'))).toBe('delete');
    expect(shortcutFor(key('Backspace'))).toBe('delete');
    expect(shortcutFor(key('r'))).toBe('rotate');
    expect(shortcutFor(key('R', { shiftKey: true }))).toBe('rotate');
    expect(shortcutFor(key('r', { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key('d', { ctrlKey: true }))).toBe('duplicate');
    expect(shortcutFor(key('d', { metaKey: true }))).toBe('duplicate');
    expect(shortcutFor(key('ArrowLeft'))).toBe('nudge');
    expect(shortcutFor(key('ArrowUp', { shiftKey: true }))).toBe('nudge');
  });

  it('arrow keys nudge 1 cm, 10 cm with Shift; up is plan +y', () => {
    expect(nudgeDelta({ key: 'ArrowLeft', shiftKey: false })).toEqual([-0.01, 0]);
    expect(nudgeDelta({ key: 'ArrowRight', shiftKey: true })).toEqual([0.1, 0]);
    expect(nudgeDelta({ key: 'ArrowUp', shiftKey: false })).toEqual([0, 0.01]);
    expect(nudgeDelta({ key: 'ArrowDown', shiftKey: true })).toEqual([0, -0.1]);
    expect(nudgeDelta({ key: 'Enter', shiftKey: false })).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it('text fields are editable, toggles and buttons are not', () => {
    const make = (html: string) => {
      const div = document.createElement('div');
      div.innerHTML = html;
      return div.firstElementChild;
    };
    expect(isEditableTarget(make('<input type="text">'))).toBe(true);
    expect(isEditableTarget(make('<input type="date">'))).toBe(true);
    expect(isEditableTarget(make('<textarea></textarea>'))).toBe(true);
    expect(isEditableTarget(make('<select></select>'))).toBe(true);
    expect(isEditableTarget(make('<input type="checkbox">'))).toBe(false);
    expect(isEditableTarget(make('<input type="range">'))).toBe(false);
    expect(isEditableTarget(make('<button>x</button>'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });

  it('targets inside a modal dialog are recognised', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('aria-modal', 'true');
    dlg.innerHTML = '<button>x</button>';
    expect(isInDialog(dlg.querySelector('button'))).toBe(true);
    expect(isInDialog(document.createElement('button'))).toBe(false);
    expect(isInDialog(null)).toBe(false);
  });
});
