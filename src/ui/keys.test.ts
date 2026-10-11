// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isEditableTarget, shortcutFor } from './keys';

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
    expect(shortcutFor(key('Delete'))).toBeNull();
    expect(shortcutFor(key('d', { ctrlKey: true }))).toBeNull();
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
});
