// @vitest-environment jsdom
/**
 * Egenskaper editors (docs/phase2-plan.md §3.7) rendered per selection kind with the REAL Forslag D derived model and
 * mock edit actions: the fields and buttons of each kind, the actions they call (with the UI's arguments), the room
 * size field choosing the right wall and publishing the highlight, "Avstand fra hjørne", ghosts with "Ta tilbake",
 * and the locked base proposal (nothing is called, every attempt asks for "Nytt forslag").
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { DerivedVariant } from '../model/derived';
import type { Variant } from '../model/types';
import type { Selection } from '../state/selection';
import { NOOP_EDIT_ACTIONS } from './editorBridge';
import type { UiEditActions } from './editorBridge';
import { PropertiesEditor } from './PropertiesEditor';
import type { PropertiesEditorProps } from './PropertiesEditor';
import { seedFixture } from './testSeed';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MockActions = { [K in keyof UiEditActions]: Mock };

function mockActions(): MockActions {
  const out: Record<string, Mock> = {};
  for (const k of Object.keys(NOOP_EDIT_ACTIONS)) out[k] = vi.fn();
  return out as MockActions;
}

const seed = seedFixture();

let container: HTMLDivElement;
let root: Root;
let actions: MockActions;
let cb: { onLocked: Mock; onNewProposal: Mock; onHighlight: Mock; onSelect: Mock; onTool: Mock; onDelete: Mock };

function render(selection: Selection | null, opts: { derived?: DerivedVariant; variant?: Variant; locked?: boolean; readOnly?: boolean } = {}) {
  const props: PropertiesEditorProps = {
    derived: opts.derived ?? (opts.locked ? seed.derivedLocked : seed.derived),
    variant: opts.variant ?? (opts.locked ? seed.locked : seed.variant),
    selection,
    actions: actions as unknown as UiEditActions,
    locked: opts.locked ?? false,
    readOnly: opts.readOnly ?? false,
    ...cb,
  };
  act(() => root.render(<PropertiesEditor {...props} />));
}

const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel);
const byTestId = (id: string) => q(`[data-testid="${id}"]`);
const input = (testId: string) => q<HTMLInputElement>(`[data-testid="${testId}"] input`) as HTMLInputElement;
const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) ?? null;
const click = (el: Element | null) => {
  if (!el) throw new Error('element not found');
  act(() => (el as HTMLElement).click());
};

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  act(() => el.focus());
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function press(el: Element, key: string) {
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
}
function choose(el: HTMLSelectElement, value: string) {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  actions = mockActions();
  cb = { onLocked: vi.fn(), onNewProposal: vi.fn(), onHighlight: vi.fn(), onSelect: vi.fn(), onTool: vi.fn(), onDelete: vi.fn() };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('header and nothing selected', () => {
  it('nothing selected: a hint and the proposal notes', () => {
    render(null);
    expect(container.textContent).toContain('Ingenting er valgt');
    const notes = q<HTMLTextAreaElement>('[data-testid="variant-notes"] textarea') as HTMLTextAreaElement;
    typeInto(notes, 'Gang mot nord');
    act(() => notes.blur());
    expect(actions.setVariantNotes).toHaveBeenCalledWith('Gang mot nord');
  });

  it('a gone selection says so', () => {
    render({ kind: 'wall', id: 'finnes-ikke' });
    expect(container.textContent).toContain('Det som var valgt finnes ikke lenger.');
  });

  it('shows kind, name and status ("Nytt" / "Hytta i dag" / mixed)', () => {
    render({ kind: 'room', id: 'room-sov-ny', levelId: 'main' });
    expect(byTestId('properties-title')?.textContent).toBe('Soverom (ny fløy)');
    expect(byTestId('properties-status')?.textContent).toBe('Nytt');
    render({ kind: 'room', id: 'room-vindfang', levelId: 'main' });
    expect(byTestId('properties-status')?.textContent).toBe('Hytta i dag');
    render({ kind: 'room', id: 'room-stue', levelId: 'main' });
    expect(byTestId('properties-status')?.textContent).toBe('Hytta i dag + nytt');
    click(q('.editor-head button'));
    expect(cb.onSelect).toHaveBeenCalledWith(null);
  });
});

describe('Rom', () => {
  it('name, type, sizes; the Dybde field moves w-gang-n and highlights it while focused', () => {
    render({ kind: 'room', id: 'room-sov-ny', levelId: 'main' });
    const name = input('room-name');
    expect(name.value).toBe('Soverom (ny fløy)');
    typeInto(name, 'Soverom 4');
    press(name, 'Enter');
    expect(actions.setRoomProps).toHaveBeenCalledWith('room-sov-ny', { name: 'Soverom 4' });
    choose(q<HTMLSelectElement>('[data-testid="room-type"] select') as HTMLSelectElement, 'bod');
    expect(actions.setRoomProps).toHaveBeenCalledWith('room-sov-ny', { type: 'bod' });

    const depth = input('room-size-d');
    expect(depth.value).toBe('2,58');
    act(() => depth.focus());
    expect(cb.onHighlight).toHaveBeenLastCalledWith({ kind: 'wall', wallId: 'w-gang-n', arrow: [0, -1] });
    typeInto(depth, '2,40');
    press(depth, 'Enter');
    expect(actions.resizeRoom).toHaveBeenCalledWith('room-sov-ny', 'd', 2.4, 'min');
    act(() => depth.blur());
    expect(cb.onHighlight).toHaveBeenLastCalledWith(null);
    expect(byTestId('room-side-d')).toBeNull(); // only one movable side: no switch
  });

  it('both sides movable: north by default, the switch picks the other wall', () => {
    render({ kind: 'room', id: 'room-gang', levelId: 'main' });
    const depth = input('room-size-d');
    act(() => depth.focus());
    expect(cb.onHighlight).toHaveBeenLastCalledWith({ kind: 'wall', wallId: 'w-gang-n', arrow: [0, 1] });
    const sw = byTestId('room-side-d');
    expect(sw?.textContent).toContain('nedre vegg');
    click([...(sw?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'nedre vegg') ?? null);
    expect(cb.onHighlight).toHaveBeenLastCalledWith({ kind: 'wall', wallId: 'w-gang-s', arrow: [0, -1] });
    typeInto(input('room-size-d'), '1,5');
    press(input('room-size-d'), 'Enter');
    expect(actions.resizeRoom).toHaveBeenCalledWith('room-gang', 'd', 1.5, 'min');
  });

  it('only exterior walls on a side: read-only "Endres under bygningsdelen" and a way to the block', () => {
    render({ kind: 'room', id: 'room-leseskrok', levelId: 'main' });
    expect(input('room-size-w').readOnly).toBe(true);
    expect(byTestId('room-size-w')?.textContent).toContain('Endres under bygningsdelen');
    click(button('Velg bygningsdelen'));
    expect(cb.onSelect).toHaveBeenCalledWith({ kind: 'block', id: 'blk-glass' });
  });

  it('Mer: floor and note; [Slett rom] goes through onDelete', () => {
    render({ kind: 'room', id: 'room-wc', levelId: 'main' });
    choose(q<HTMLSelectElement>('[data-testid="room-floor"] select') as HTMLSelectElement, 'tile');
    expect(actions.setRoomProps).toHaveBeenCalledWith('room-wc', { floorMaterial: 'tile' });
    const note = q<HTMLTextAreaElement>('[data-testid="room-note"] textarea') as HTMLTextAreaElement;
    typeInto(note, 'Fliser til tak');
    act(() => note.blur());
    expect(actions.setRoomProps).toHaveBeenCalledWith('room-wc', { note: 'Fliser til tak' });
    click(byTestId('room-delete'));
    expect(cb.onDelete).toHaveBeenCalledWith(expect.objectContaining({ kind: 'room' }));
  });

  it('a face without a name offers "Gi navn"', () => {
    const variant: Variant = { ...seed.variant, id: 'uten-pantry', rooms: seed.variant.rooms.filter((r) => r.id !== 'room-pantry') };
    const derived = seed.derive(variant);
    const face = derived.rooms.find((r) => !r.room && r.levelId === 'main');
    if (!face) throw new Error('no unnamed face');
    render({ kind: 'room', id: face.id, levelId: 'main' }, { derived, variant });
    expect(byTestId('properties-title')?.textContent).toBe('Rom uten navn');
    typeInto(byTestId('name-face-input') as HTMLInputElement, 'Pantry');
    choose(q<HTMLSelectElement>('.name-face select') as HTMLSelectElement, 'pantry');
    click(byTestId('name-face'));
    expect(actions.nameFace).toHaveBeenCalledWith(face.id, 'Pantry', { type: 'pantry', levelId: 'main' });
  });

  it('"Gi navn" selects the new room (the face id it had is gone), so Egenskaper shows it', () => {
    const variant: Variant = { ...seed.variant, id: 'uten-pantry', rooms: seed.variant.rooms.filter((r) => r.id !== 'room-pantry') };
    const derived = seed.derive(variant);
    const face = derived.rooms.find((r) => !r.room && r.levelId === 'main');
    if (!face) throw new Error('no unnamed face');
    actions.nameFace.mockReturnValue('room-ny');
    render({ kind: 'room', id: face.id, levelId: 'main' }, { derived, variant });
    typeInto(byTestId('name-face-input') as HTMLInputElement, 'Pantry');
    click(byTestId('name-face'));
    expect(cb.onSelect).toHaveBeenCalledWith({ kind: 'room', id: 'room-ny', levelId: 'main' });
    // Refused (null): the selection stays.
    cb.onSelect.mockClear();
    actions.nameFace.mockReturnValue(null);
    click(byTestId('name-face'));
    expect(cb.onSelect).not.toHaveBeenCalled();
  });
});

describe('Vegg', () => {
  it('a stored wall: Lengde moves end b, Tykkelse, [Del i to], [Slett], Høyde and "Usynlig romdeler" under Mer', () => {
    render({ kind: 'wall', id: 'w-gang-n' });
    expect(byTestId('properties-title')?.textContent).toBe('Innervegg');
    expect(byTestId('properties-status')?.textContent).toBe('Nytt');
    const len = input('wall-length');
    expect(len.value).toBe('4,80');
    typeInto(len, '4');
    press(len, 'Enter');
    expect(actions.moveWallEndpoint).toHaveBeenCalledWith('w-gang-n', 'b', [20, 3.4]);
    typeInto(input('wall-thickness'), '0,15');
    press(input('wall-thickness'), 'Enter');
    expect(actions.setWallProps).toHaveBeenCalledWith('w-gang-n', { thickness: 0.15 });
    click(byTestId('wall-split'));
    expect(actions.splitWall).toHaveBeenCalledWith('w-gang-n', 0.5);
    click(byTestId('wall-delete'));
    expect(cb.onDelete).toHaveBeenCalledWith(expect.objectContaining({ kind: 'wall' }));
    choose(q<HTMLSelectElement>('[data-testid="wall-height-mode"] select') as HTMLSelectElement, 'roof');
    expect(actions.setWallProps).toHaveBeenCalledWith('w-gang-n', { heightMode: 'roof' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    click(byTestId('wall-divider'));
    expect(confirm).toHaveBeenCalled(); // w-gang-n carries d-sov-ny
    expect(actions.setWallProps).toHaveBeenCalledWith('w-gang-n', { kind: 'divider' });
    confirm.mockRestore();
  });

  it('a divider has no thickness and can become a wall again', () => {
    render({ kind: 'wall', id: 'dv-stue-n' });
    expect(byTestId('properties-title')?.textContent).toBe('Romdeler');
    expect(byTestId('wall-thickness')).toBeNull();
    click(byTestId('wall-divider'));
    expect(actions.setWallProps).toHaveBeenCalledWith('dv-stue-n', { kind: 'interior', thickness: seed.variant.settings.defaultInteriorThickness });
  });

  it('an exterior wall piece: derived from the block, [Legg til dør/vindu] picks the tool', () => {
    const piece = seed.derived.walls.find((w) => w.source.kind === 'blockEdge' && w.source.blockId === 'blk-wing');
    render({ kind: 'wall', id: piece?.id ?? '' });
    expect(byTestId('properties-title')?.textContent).toBe('Yttervegg (Ny tverrfløy)');
    expect(container.textContent).toContain('Dra veggen i planen');
    click(byTestId('wall-add-opening'));
    expect(cb.onTool).toHaveBeenCalledWith('opening');
  });
});

describe('Åpning', () => {
  it('a door: type, sizes, "Avstand fra hjørne", swing buttons, Mer', () => {
    render({ kind: 'opening', id: 'd-sov-ny' });
    expect(byTestId('properties-title')?.textContent).toBe('Dør');
    expect(input('opening-width').value).toBe('0,80');
    expect(byTestId('opening-sill')).toBeNull(); // windows only
    const corner = input('opening-corner');
    expect(corner.value).toBe('0,84');
    act(() => corner.focus());
    expect(cb.onHighlight).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'dimension', text: '0,8 m' }));
    typeInto(corner, '1');
    press(corner, 'Enter');
    expect(actions.moveOpening).toHaveBeenCalledTimes(1);
    expect(actions.moveOpening.mock.calls[0][0]).toBe('d-sov-ny');
    expect(actions.moveOpening.mock.calls[0][1]).toBeCloseTo(1.46, 9);
    click(byTestId('opening-flip-hinge'));
    expect(actions.setOpeningProps).toHaveBeenCalledWith('d-sov-ny', { swing: { hinge: 'end', side: 'left' } });
    click(byTestId('opening-flip-side'));
    expect(actions.setOpeningProps).toHaveBeenCalledWith('d-sov-ny', { swing: { hinge: 'start', side: 'right' } });
    choose(q<HTMLSelectElement>('[data-testid="opening-leaves"] select') as HTMLSelectElement, '2');
    expect(actions.setOpeningProps).toHaveBeenCalledWith('d-sov-ny', { leaves: 2 });
    typeInto(input('opening-width'), '0,9');
    press(input('opening-width'), 'Enter');
    expect(actions.setOpeningProps).toHaveBeenCalledWith('d-sov-ny', { width: 0.9 });
    click(byTestId('opening-delete'));
    expect(cb.onDelete).toHaveBeenCalledWith(expect.objectContaining({ kind: 'opening' }));
  });

  it('a window: "Høyde over gulv" and Sprosser', () => {
    render({ kind: 'opening', id: 'win-sov-n' });
    expect(input('opening-sill').value).toBe('0,50');
    typeInto(input('opening-sill'), '0,8');
    press(input('opening-sill'), 'Enter');
    expect(actions.setOpeningProps).toHaveBeenCalledWith('win-sov-n', { sill: 0.8 });
    choose(q<HTMLSelectElement>('[data-testid="opening-muntins"] select') as HTMLSelectElement, '3x2');
    expect(actions.setOpeningProps).toHaveBeenCalledWith('win-sov-n', expect.objectContaining({ style: expect.objectContaining({ mullions: [3, 2] }) }));
    expect(byTestId('opening-flip-hinge')).toBeNull();
  });

  it('a removed opening is a ghost: "Fjernet" and [Ta tilbake]', () => {
    render({ kind: 'opening', id: 'win-stue-s-old' });
    expect(byTestId('properties-status')?.textContent).toBe('Fjernet');
    expect(byTestId('properties-title')?.textContent).toBe('Vindu');
    // The header reads "Fra hytta i dag · Vindu · Fjernet", not "Fjernet Vindu Fjernet".
    expect(q('.editor-title .tag')?.textContent).toBe('Fra hytta i dag');
    expect(q('.editor-title')?.textContent?.match(/Fjernet/g)).toHaveLength(1);
    click(byTestId('ghost-restore'));
    expect(actions.restoreGhost).toHaveBeenCalledWith('win-stue-s-old');
    expect(cb.onSelect).toHaveBeenCalledWith({ kind: 'opening', id: 'win-stue-s-old' });
  });
});

describe('Bygningsdel', () => {
  it('a new block: name, Bredde/Dybde (setBlockSize, east/north), roof, [Dupliser] [Slett], Mer', () => {
    render({ kind: 'block', id: 'blk-wing' });
    expect(byTestId('properties-status')?.textContent).toBe('Nytt');
    expect(input('block-width').value).toBe('4,80');
    typeInto(input('block-width'), '5,8');
    press(input('block-width'), 'Enter');
    expect(actions.setBlockSize).toHaveBeenCalledWith('blk-wing', 'w', 5.8, 'max');
    typeInto(input('block-depth'), '9');
    press(input('block-depth'), 'Enter');
    expect(actions.setBlockSize).toHaveBeenCalledWith('blk-wing', 'd', 9, 'max');
    typeInto(input('block-pitch'), '30');
    press(input('block-pitch'), 'Enter');
    expect(actions.setBlockProps).toHaveBeenCalledWith('blk-wing', { roof: { pitchDeg: 30, drive: 'pitch' } });
    typeInto(input('block-ridge'), '4');
    press(input('block-ridge'), 'Enter');
    expect(actions.setBlockProps).toHaveBeenCalledWith('blk-wing', { roof: { ridgeHeight: 4, drive: 'height' } });
    expect(container.textContent).not.toMatch(/drive/i);
    click(byTestId('block-duplicate'));
    expect(actions.duplicateBlock).toHaveBeenCalledWith('blk-wing');
    click(byTestId('block-delete'));
    expect(cb.onDelete).toHaveBeenCalledWith(expect.objectContaining({ kind: 'block' }));
  });

  it('a placed "Nytt bygg" unit: [Roter 90°] turns it (rotateBlock); blocks without a template have no such button', () => {
    const variant: Variant = { ...seed.variant, id: 'med-vedskjul', blocks: seed.variant.blocks.map((b) => (b.id === 'blk-wing' ? { ...b, template: 'vedskjul' } : b)) };
    render({ kind: 'block', id: 'blk-wing' }, { derived: seed.derive(variant), variant });
    expect(byTestId('block-rotate')?.textContent).toBe('Roter 90°');
    click(byTestId('block-rotate'));
    expect(actions.rotateBlock).toHaveBeenCalledWith('blk-wing', 90);
    render({ kind: 'block', id: 'blk-wing' });
    expect(byTestId('block-rotate')).toBeNull();
  });

  it('today\'s cabin: the parts are listed and it cannot be deleted', () => {
    render({ kind: 'block', id: 'blk-main' });
    expect(byTestId('properties-status')?.textContent).toBe('Hytta i dag');
    const parts = byTestId('block-parts')?.textContent ?? '';
    expect(parts).toContain('Eksisterende: 12,00 × 6,20 m');
    expect(parts).toContain('Stue forlenget: lengde 4,00 m');
    expect(byTestId('block-delete')).toBeNull();
  });

  it('a block corner and a block edge', () => {
    render({ kind: 'blockVertex', id: 'v-wing-ne' });
    expect(container.textContent).toContain('Dra hjørnet i planen');
    render({ kind: 'blockEdge', id: 'v-wing-se' });
    expect(byTestId('properties-title')?.textContent).toBe('Yttervegg (Ny tverrfløy)');
  });
});

describe('Terrasse, trapp, badestamp, tre, konstruksjon', () => {
  it('the deck: height, railing, [Legg til trapp] on the longest free run, per-edge railing under Mer', () => {
    render({ kind: 'deck', id: 'deck-terrasse' });
    expect(input('deck-height').value).toBe('-0,02');
    expect((q<HTMLSelectElement>('[data-testid="deck-railing"] select') as HTMLSelectElement).value).toBe('glass');
    expect(input('deck-railing-height').value).toBe('1,05');
    choose(q<HTMLSelectElement>('[data-testid="deck-railing"] select') as HTMLSelectElement, 'none');
    expect(actions.setDeckProps).toHaveBeenCalledWith('deck-terrasse', { railing: null });
    click(byTestId('deck-add-steps'));
    expect(actions.addSteps).toHaveBeenCalledTimes(1);
    const [edgeId, offset] = actions.addSteps.mock.calls[0];
    const run = seed.derived.outdoor.decks[0].freeRuns.reduce((a, b) => (b.s1 - b.s0 > a.s1 - a.s0 ? b : a));
    expect(edgeId).toBe(run.edgeId);
    expect(offset).toBeCloseTo((run.s0 + run.s1) / 2, 9);
    click(byTestId('deck-edge-railing-deck-terrasse-v0'));
    expect(actions.toggleRailingEdge).toHaveBeenCalledWith('deck-terrasse-v0');
  });

  it('a deck corner and a deck edge', () => {
    render({ kind: 'deckVertex', id: 'deck-terrasse-v1' });
    click(byTestId('deck-vertex-delete'));
    expect(cb.onDelete).toHaveBeenCalledWith(expect.objectContaining({ kind: 'deckVertex', vertexId: 'deck-terrasse-v1' }));
    render({ kind: 'deckEdge', id: 'deck-terrasse-v0' });
    expect((q<HTMLInputElement>('[data-testid="deck-edge-railing"]') as HTMLInputElement).checked).toBe(true);
    click(byTestId('deck-edge-railing'));
    expect(actions.toggleRailingEdge).toHaveBeenCalledWith('deck-terrasse-v0');
    click(byTestId('deck-edge-add-corner'));
    expect(actions.insertDeckVertex).toHaveBeenCalledWith('deck-terrasse-v0', [16.1, -4.6]);
  });

  it('railing, steps, hot tub, tree and structure', () => {
    render({ kind: 'railing', id: 'deck-terrasse/railing' });
    expect(byTestId('deck-railing')).not.toBeNull();
    render({ kind: 'steps', id: 'rail-terrasse/steps/0' });
    expect(input('steps-width').value).toBe('1,40');
    typeInto(input('steps-width'), '1,8');
    press(input('steps-width'), 'Enter');
    expect(actions.setStepsProps).toHaveBeenCalledWith('rail-terrasse/steps/0', { width: 1.8 });
    render({ kind: 'hotTub', id: 'tub-1' });
    typeInto(input('hottub-diameter'), '2,4');
    press(input('hottub-diameter'), 'Enter');
    expect(actions.setHotTubDiameter).toHaveBeenCalledWith('tub-1', 2.4);
    click(byTestId('hottub-delete'));
    expect(cb.onDelete).toHaveBeenCalledWith(expect.objectContaining({ kind: 'hotTub' }));
    render({ kind: 'tree', id: 'tree-1' });
    click(byTestId('tree-delete'));
    expect(cb.onDelete).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tree' }));
    render({ kind: 'structure', id: 'chimney-1' });
    expect(byTestId('properties-title')?.textContent).toBe('Pipe');
    expect(container.textContent).toContain('kan ikke endres her');
  });
});

describe('Møbel', () => {
  it('size, colour, [Roter 90°] [Dupliser] [Slett], the room it stands in', () => {
    const variant: Variant = {
      ...seed.variant,
      id: 'med-seng',
      furniture: [{ id: 'f-1', catalogId: 'seng-150', position: [18.4, 4.8], rotationDeg: 0, levelId: 'main', size: { w: 1.5, d: 2, h: 0.5 }, isNew: true }],
    };
    const derived = seed.derive(variant);
    render({ kind: 'furniture', id: 'f-1' }, { derived, variant });
    expect(byTestId('properties-title')?.textContent).toBe('seng-150');
    expect(container.textContent).toContain('Rom: Soverom (ny fløy)');
    typeInto(input('furniture-width'), '1,8');
    press(input('furniture-width'), 'Enter');
    expect(actions.setFurnitureProps).toHaveBeenCalledWith('f-1', { size: { w: 1.8, d: 2, h: 0.5 } });
    click(byTestId('furniture-rotate'));
    expect(actions.rotateFurniture).toHaveBeenCalledWith('f-1', 90);
    click(byTestId('furniture-duplicate'));
    expect(actions.duplicateFurniture).toHaveBeenCalledWith('f-1');
    click(byTestId('furniture-delete'));
    expect(cb.onDelete).toHaveBeenCalledWith(expect.objectContaining({ kind: 'furniture' }));
  });
});

describe('the locked base proposal (Forslag D)', () => {
  it('shows "Nytt forslag", keeps every value read-only and calls no action', () => {
    render({ kind: 'room', id: 'room-sov-ny', levelId: 'main' }, { locked: true });
    expect(byTestId('locked-notice')?.textContent).toContain('Forslag D er grunnlaget');
    click(byTestId('locked-new-proposal'));
    expect(cb.onNewProposal).toHaveBeenCalledTimes(1);

    const name = input('room-name');
    expect(name.readOnly).toBe(true);
    press(name, 'x');
    const depth = input('room-size-d');
    press(depth, '3');
    click(container.querySelector('[data-testid="room-size-d"] .nf-step'));
    act(() => {
      const sel = q<HTMLSelectElement>('[data-testid="room-type"] select') as HTMLSelectElement;
      sel.value = 'bod';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(byTestId('room-delete'));
    expect(cb.onLocked.mock.calls.length).toBeGreaterThanOrEqual(5);
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
    expect(cb.onDelete).not.toHaveBeenCalled();
  });

  it('navigation still works ("Velg bygningsdelen")', () => {
    render({ kind: 'room', id: 'room-leseskrok', levelId: 'main' }, { locked: true });
    click(button('Velg bygningsdelen'));
    expect(cb.onSelect).toHaveBeenCalledWith({ kind: 'block', id: 'blk-glass' });
    expect(cb.onLocked).not.toHaveBeenCalled();
  });

  it('read-only (shared link): no action buttons, no notice', () => {
    render({ kind: 'wall', id: 'w-gang-n' }, { readOnly: true });
    expect(byTestId('wall-split')).toBeNull();
    expect(byTestId('locked-notice')).toBeNull();
    expect(input('wall-length').readOnly).toBe(true);
  });
});
