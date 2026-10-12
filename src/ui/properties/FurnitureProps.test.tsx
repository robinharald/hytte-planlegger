// @vitest-environment jsdom
/**
 * Møbel in Egenskaper (FurnitureProps.tsx) on the real Forslag D rooms with mock actions: Navn, the room, the size
 * presets, Bredde / Dybde for stretchable entries (clamped), Farge from the entry's swatches, the three buttons, an
 * unknown catalogue id, and the locked base proposal.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { DerivedFurniture } from '../../model/derived';
import type { Vec2 } from '../../model/types';
import { rectFootprint } from '../../plan2d/furniturePlacement';
import { NOOP_EDIT_ACTIONS } from '../editorBridge';
import type { UiEditActions } from '../editorBridge';
import { EditorEnvContext } from '../editors/env';
import type { EditorEnv } from '../editors/env';
import { seedFixture } from '../testSeed';
import { FurnitureProps } from './FurnitureProps';
import { matchingPreset, presetLabel } from './furniturePropsModel';
import { catalogItem } from '../../furniture/catalog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const seed = seedFixture();

type MockActions = { [K in keyof UiEditActions]: Mock };

let container: HTMLDivElement;
let root: Root;
let actions: MockActions;
let onLocked: Mock;
let onDelete: Mock;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const out: Record<string, Mock> = {};
  for (const k of Object.keys(NOOP_EDIT_ACTIONS)) out[k] = vi.fn();
  actions = out as MockActions;
  onLocked = vi.fn();
  onDelete = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function item(id: string, catalogId: string, position: Vec2, size: { w: number; d: number; h: number }, extra: Partial<DerivedFurniture['item']> = {}, roomId?: string, levelId = 'main'): DerivedFurniture {
  const footprint = rectFootprint(position, 0, size.w, size.d);
  return {
    id,
    item: { id, catalogId, position, rotationDeg: 0, levelId, size, isNew: true, ...extra },
    catalog: catalogItem(catalogId) ?? null,
    footprint,
    bbox: { min: footprint[0], max: footprint[2] },
    levelId,
    roomId,
    floorZ: 0,
    z: 0,
    clearances: [],
    collisions: [],
    blocksDoors: [],
    needsDrain: false,
    isNew: true,
  };
}

function render(f: DerivedFurniture, opts: { locked?: boolean; readOnly?: boolean } = {}) {
  const env: EditorEnv = {
    derived: { ...seed.derived, furniture: [f] },
    variant: seed.variant,
    actions: actions as unknown as UiEditActions,
    locked: opts.locked ?? false,
    readOnly: opts.readOnly ?? false,
    onLocked,
    onHighlight: vi.fn(),
    onSelect: vi.fn(),
    onTool: vi.fn(),
    onDelete,
  };
  act(() =>
    root.render(
      <EditorEnvContext.Provider value={env}>
        <FurnitureProps furniture={f} />
      </EditorEnvContext.Provider>,
    ),
  );
}

const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel);
const byTestId = (id: string) => q(`[data-testid="${id}"]`);
const select = (testId: string) => q<HTMLSelectElement>(`[data-testid="${testId}"] select`)!;
const input = (testId: string) => q<HTMLInputElement>(`[data-testid="${testId}"] input`)!;
const optionLabels = (s: HTMLSelectElement) => [...s.options].map((o) => o.textContent);

function choose(el: HTMLSelectElement, value: string) {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function typeInto(el: HTMLInputElement, text: string) {
  act(() => el.focus());
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
}

const click = (el: Element | null) => {
  if (!el) throw new Error('not found');
  act(() => (el as HTMLElement).click());
};

const BED = item('f-bed', 'seng-90', [1.5, 5], { w: 0.9, d: 2, h: 0.5 }, { sizeVariant: '90x200' }, 'room-sov1', 'lower');
const COUNTER = item('f-benk', 'benkeskap', [10, 5], { w: 2.4, d: 0.6, h: 0.9 }, { sizeVariant: '240' }, 'room-kjokken');

describe('helpers', () => {
  it('labels presets with the size when their label has none, and finds the preset of a size', () => {
    expect(presetLabel({ label: '90 × 200', w: 0.9, d: 2 })).toBe('90 × 200');
    expect(presetLabel({ label: 'Gulvstående', w: 0.4, d: 0.65 })).toBe('Gulvstående (40 × 65 cm)');
    const bed = catalogItem('seng-90')!;
    expect(matchingPreset(bed, { w: 0.9, d: 1.9 })).toBe('90x190');
    expect(matchingPreset(bed, { w: 0.9, d: 2.0 }, '90x200')).toBe('90x200');
    expect(matchingPreset(bed, { w: 1, d: 2 })).toBeNull();
  });
});

describe('FurnitureProps', () => {
  it('shows the name and the room it stands in', () => {
    render(BED);
    expect(byTestId('furniture-name')!.textContent).toBe('Seng 90');
    expect(byTestId('furniture-room')!.textContent).toBe('Rom: Soverom 1');
    render(item('f-out', 'utebord', [11, -3], { w: 1.2, d: 0.8, h: 0.45 }));
    expect(byTestId('furniture-room')!.textContent).toBe('Rom: –');
  });

  it('chooses among the presets: sizeVariant and the preset size in one step', () => {
    render(BED);
    const s = select('furniture-size');
    expect(optionLabels(s)).toEqual(['90 × 200', '90 × 190']);
    expect(s.value).toBe('90x200');
    choose(s, '90x190');
    expect(actions.setFurnitureProps).toHaveBeenCalledWith('f-bed', { sizeVariant: '90x190', size: { w: 0.9, d: 1.9, h: 0.5 } });
    // A bed does not stretch: no Bredde / Dybde.
    expect(byTestId('furniture-width')).toBeNull();
    expect(byTestId('furniture-depth')).toBeNull();
  });

  it('stretchable entries get Bredde (and Dybde) clamped into their range; a stretched size shows as "Egen størrelse"', () => {
    render(COUNTER);
    expect(byTestId('furniture-width')).not.toBeNull();
    expect(byTestId('furniture-depth')).toBeNull();
    expect(byTestId('furniture-width')!.textContent).toContain('0,30–6,00 m');
    typeInto(input('furniture-width'), '3,15');
    expect(actions.setFurnitureProps).toHaveBeenLastCalledWith('f-benk', { size: { w: 3.15, d: 0.6, h: 0.9 } });
    render({ ...COUNTER, item: { ...COUNTER.item, size: { w: 1.8, d: 0.6, h: 0.9 } } });
    const s = select('furniture-size');
    expect(s.value).toBe('__custom');
    expect(optionLabels(s)).toContain('Egen størrelse (180 × 60 cm)');
    const rug = item('f-rug', 'teppe', [14, 1], { w: 2, d: 1.4, h: 0.01 });
    render(rug);
    expect(byTestId('furniture-width')).not.toBeNull();
    expect(byTestId('furniture-depth')).not.toBeNull();
  });

  it('Farge: the entry’s swatches or Standard (no colour)', () => {
    render(BED);
    const s = select('furniture-colour');
    expect(optionLabels(s)[0]).toBe('Standard');
    expect(optionLabels(s).slice(1)).toEqual(catalogItem('seng-90')!.colours!.map((c) => c.label));
    const blue = catalogItem('seng-90')!.colours![0];
    choose(s, blue.hex);
    expect(actions.setFurnitureProps).toHaveBeenLastCalledWith('f-bed', { colour: blue.hex });
    render({ ...BED, item: { ...BED.item, colour: blue.hex } });
    expect(select('furniture-colour').value).toBe(blue.hex);
    choose(select('furniture-colour'), '');
    expect(actions.setFurnitureProps).toHaveBeenLastCalledWith('f-bed', { colour: null });
    // A colour name stored by phase 2a stays selectable under its old label.
    render({ ...BED, item: { ...BED.item, colour: 'wood' } });
    expect(optionLabels(select('furniture-colour'))).toContain('Tre');
  });

  it('Roter 90°, Dupliser and Slett', () => {
    render(BED);
    click(byTestId('furniture-rotate'));
    expect(actions.rotateFurniture).toHaveBeenCalledWith('f-bed', 90);
    click(byTestId('furniture-duplicate'));
    expect(actions.duplicateFurniture).toHaveBeenCalledWith('f-bed');
    click(byTestId('furniture-delete'));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ kind: 'furniture' }));
  });

  it('an unknown catalogue id: a note, and free Bredde / Dybde', () => {
    render(item('f-x', 'flygel', [14, 1], { w: 1.5, d: 1.8, h: 1 }));
    expect(container.textContent).toContain('finnes ikke i møbellisten');
    expect(byTestId('furniture-name')!.textContent).toBe('flygel');
    expect(byTestId('furniture-size')).toBeNull();
    typeInto(input('furniture-depth'), '2');
    expect(actions.setFurnitureProps).toHaveBeenLastCalledWith('f-x', { size: { w: 1.5, d: 2, h: 1 } });
  });

  it('the locked base proposal changes nothing and asks for "Nytt forslag"', () => {
    render(BED, { locked: true });
    choose(select('furniture-size'), '90x190');
    click(byTestId('furniture-rotate'));
    click(byTestId('furniture-duplicate'));
    expect(actions.setFurnitureProps).not.toHaveBeenCalled();
    expect(actions.rotateFurniture).not.toHaveBeenCalled();
    expect(actions.duplicateFurniture).not.toHaveBeenCalled();
    expect(onLocked).toHaveBeenCalled();
  });
});
