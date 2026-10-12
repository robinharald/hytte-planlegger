// @vitest-environment jsdom
/**
 * The furniture library (FurnitureLibrary.tsx): the category accordion with Norwegian names, items with their symbol,
 * name and default size, the search, tap-to-place (and the phone sheet closing afterwards), and a pointer drag that
 * talks to the plan through DOM events (preview while moving, drop on release, Esc cancels; the click after a drag
 * places nothing).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { FURNITURE_DRAG_EVENT, FURNITURE_DROP_EVENT } from '../plan2d/furnitureDrop';
import type { FurnitureDragDetail } from '../plan2d/furnitureDrop';
import { appStore } from '../state/appStore';
import { FurnitureLibrary } from './FurnitureLibrary';
import type { PlaceHow, Placed } from './furniturePlacer';
import { libraryEntries } from './furnitureLibraryModel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let place: Mock<(catalogId: string, how: PlaceHow) => Placed | null>;
let target: HTMLDivElement;
const realElementFromPoint = document.elementFromPoint;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  target = document.createElement('div');
  document.body.appendChild(target);
  root = createRoot(container);
  place = vi.fn((catalogId: string): Placed | null => ({
    id: `f-${catalogId}`,
    placement: { position: [0, 0], rotationDeg: 0, footprint: [], free: true },
    room: { room: { name: 'Soverom 1' } } as unknown as Placed['room'],
  }));
  document.elementFromPoint = () => target;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  target.remove();
  document.elementFromPoint = realElementFromPoint;
});

function render(props: Partial<Parameters<typeof FurnitureLibrary>[0]> = {}) {
  act(() => root.render(<FurnitureLibrary place={place} initialCategory="soverom" {...props} />));
}

const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const catButton = (id: string) => byTestId(`furniture-category-${id}`)!.querySelector('button')!;
const shownItems = () => [...container.querySelectorAll('[data-testid^="furniture-item-"]')].map((e) => e.getAttribute('data-testid')!.slice('furniture-item-'.length));

function typeSearch(text: string) {
  const el = byTestId('furniture-search') as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pointer(el: Element, type: string, x: number, y: number, pointerType = 'mouse') {
  act(() => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, pointerType, button: 0, clientX: x, clientY: y }));
  });
}

const frame = () => act(() => new Promise<void>((r) => setTimeout(r, 40)));

describe('list', () => {
  it('shows the categories with their Norwegian names and counts; the first open category lists symbol, name and size', () => {
    render();
    const names = [...container.querySelectorAll('.flib-cat-name')].map((e) => e.textContent);
    expect(names).toEqual(['Soverom', 'Stue', 'Kjøkken', 'Bad / WC', 'Badstue', 'Annet', 'Ute']);
    expect(catButton('soverom').getAttribute('aria-expanded')).toBe('true');
    expect(catButton('stue').getAttribute('aria-expanded')).toBe('false');
    const bed = byTestId('furniture-item-seng-90')!;
    expect(bed.querySelector('svg[data-icon="seng-90"] [data-symbol="seng-90"]')).not.toBeNull();
    expect(bed.querySelector('.flib-item-name')!.textContent).toBe('Seng 90');
    expect(bed.querySelector('.flib-item-size')!.textContent).toBe('90 × 200 cm');
    expect(shownItems()).toEqual(libraryEntries().filter((e) => e.category === 'soverom').map((e) => e.id));
  });

  it('is an accordion: opening a category closes the other; a second click closes it', () => {
    render();
    act(() => catButton('bad').click());
    expect(catButton('bad').getAttribute('aria-expanded')).toBe('true');
    expect(catButton('soverom').getAttribute('aria-expanded')).toBe('false');
    expect(shownItems()).toContain('toalett');
    expect(shownItems()).not.toContain('seng-90');
    act(() => catButton('bad').click());
    expect(shownItems()).toEqual([]);
  });

  it('search shows the matches in every category, and says so when nothing matches', () => {
    render();
    typeSearch('dusj');
    expect(shownItems()).toEqual(['dusj-80', 'dusj-90', 'dusj-100', 'dusjvegg']);
    expect(container.querySelectorAll('.flib-cat')).toHaveLength(1);
    typeSearch('stol');
    expect(shownItems()).toEqual(expect.arrayContaining(['lenestol', 'stol', 'utestol']));
    typeSearch('flygel');
    expect(shownItems()).toEqual([]);
    expect(container.textContent).toContain('Ingen møbler passer «flygel».');
    typeSearch('');
    expect(shownItems()).toContain('seng-90');
  });
});

describe('tap to place', () => {
  it('a click places the item (the placer picks the room and the wall) and says where', () => {
    render();
    act(() => byTestId('furniture-item-seng-90')!.click());
    expect(place).toHaveBeenCalledWith('seng-90', { kind: 'tap' });
    expect(container.querySelector('[role="status"]')!.textContent).toBe('Seng 90 er satt inn i Soverom 1.');
  });

  it('a refused placement says nothing', () => {
    place.mockReturnValueOnce(null);
    render();
    act(() => byTestId('furniture-item-kommode')!.click());
    expect(container.querySelector('[role="status"]')!.textContent).toBe('');
  });

  it('the phone sheet closes after a placement (back to Velg); the side column stays', () => {
    act(() => appStore.getState().setUi({ tool: 'furniture' }));
    render();
    act(() => byTestId('furniture-item-seng-90')!.click());
    expect(appStore.getState().ui.tool).toBe('furniture');
    render({ variant: 'sheet' });
    act(() => byTestId('furniture-item-seng-90')!.click());
    expect(appStore.getState().ui.tool).toBe('select');
  });
});

describe('drag into the plan', () => {
  it('a mouse drag sends the item to the element under the pointer, drops it on release, and does not also place it', async () => {
    const drags: FurnitureDragDetail[] = [];
    const onDrag = (e: Event) => {
      drags.push((e as CustomEvent<FurnitureDragDetail>).detail);
      if ((e as CustomEvent<FurnitureDragDetail>).detail.catalogId) e.preventDefault(); // "a plan is under the pointer"
    };
    const onDrop = vi.fn((e: Event) => e.preventDefault());
    document.addEventListener(FURNITURE_DRAG_EVENT, onDrag);
    target.addEventListener(FURNITURE_DROP_EVENT, onDrop);
    try {
      render();
      const item = byTestId('furniture-item-seng-150')!;
      pointer(item, 'pointerdown', 10, 10);
      pointer(item, 'pointermove', 40, 10);
      await frame();
      expect(byTestId('furniture-drag-chip') ?? document.querySelector('[data-testid="furniture-drag-chip"]')).not.toBeNull();
      pointer(item, 'pointermove', 400, 300);
      await frame();
      expect(drags.at(-1)).toEqual({ catalogId: 'seng-150', clientX: 400, clientY: 300 });
      expect(document.querySelector('[data-testid="furniture-drag-chip"]')!.getAttribute('data-over-plan')).toBe('true');
      pointer(item, 'pointerup', 410, 310);
      act(() => item.click());
      expect(onDrop).toHaveBeenCalledTimes(1);
      expect((onDrop.mock.calls[0][0] as CustomEvent).detail).toEqual({ catalogId: 'seng-150', clientX: 410, clientY: 310 });
      expect(drags.at(-1)!.catalogId).toBeNull();
      expect(place).not.toHaveBeenCalled();
      expect(document.querySelector('[data-testid="furniture-drag-chip"]')).toBeNull();
      expect(container.querySelector('[role="status"]')!.textContent).toBe('Seng 150 er satt inn.');
    } finally {
      document.removeEventListener(FURNITURE_DRAG_EVENT, onDrag);
    }
  });

  it('Esc cancels a drag: nothing is dropped and the plan hides its preview', async () => {
    const drags: FurnitureDragDetail[] = [];
    const onDrag = (e: Event) => drags.push((e as CustomEvent<FurnitureDragDetail>).detail);
    const onDrop = vi.fn();
    document.addEventListener(FURNITURE_DRAG_EVENT, onDrag);
    target.addEventListener(FURNITURE_DROP_EVENT, onDrop);
    try {
      render();
      const item = byTestId('furniture-item-kommode')!;
      pointer(item, 'pointerdown', 10, 10);
      pointer(item, 'pointermove', 60, 10);
      await frame();
      act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
      expect(drags.at(-1)!.catalogId).toBeNull();
      pointer(item, 'pointerup', 60, 10);
      expect(onDrop).not.toHaveBeenCalled();
      expect(document.querySelector('[data-testid="furniture-drag-chip"]')).toBeNull();
    } finally {
      document.removeEventListener(FURNITURE_DRAG_EVENT, onDrag);
    }
  });

  it('a drop nobody takes places nothing and says nothing', async () => {
    render();
    const item = byTestId('furniture-item-kommode')!;
    pointer(item, 'pointerdown', 10, 10);
    pointer(item, 'pointermove', 60, 10);
    await frame();
    pointer(item, 'pointerup', 60, 10);
    expect(place).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')!.textContent).toBe('');
  });
});
