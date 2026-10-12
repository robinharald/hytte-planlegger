/**
 * Fix round after 2a, UX finding "nb.ts wording consistency" and "Warnings use internal ids": one device verb, one
 * rotate verb, no Ctrl+Z on a touch screen, one source per text, the ghost header, "i dag" / "nytt" everywhere, the
 * Møbler hint, the Forslag D explanation; and warnings that name walls and openings by type and place.
 */
import { describe, expect, it } from 'vitest';
import { nb, warningText } from '../i18n/nb';
import type { ModelWarning } from '../model/derived';
import type { Variant } from '../model/types';
import { placeUnit, rotateBlock } from '../state/editActions';
import { createAppStore, selectActiveVariant } from '../state/store';
import { undoHow } from './device';
import { hintFor } from './hints';
import { seedFixture } from './testSeed';
import { formatM2 } from './format';
import { compassWord, makeNameLookup, warningItems, warningKey } from './warnings';

/** Every user-visible string in nb (functions called with sample arguments). */
function allTexts(): string[] {
  const out: string[] = [];
  const visit = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') {
      try {
        out.push(String((v as (...a: unknown[]) => unknown)('A', 'B', 'C')));
      } catch {
        /* a function that needs other arguments */
      }
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(nb);
  return out;
}

describe('nb.ts wording', () => {
  it('"Trykk" for every pointer, never "Klikk"; one rotate verb, "Roter"', () => {
    const texts = allTexts();
    expect(texts.filter((t) => /\b[Kk]likk/.test(t))).toEqual([]);
    expect(texts.filter((t) => /\b[Dd]rei\b/.test(t))).toEqual([]);
    expect(nb.tools.rotateUnit).toBe('Roter');
    expect(nb.miniBar.rotate).toBe('Roter');
    expect(nb.edit.block.rotate).toBe('Roter 90°');
  });

  it('undo texts: "Angre" on a touch screen, "Angre eller Ctrl+Z" with a keyboard', () => {
    expect(nb.prompts.deleteVariantSure('Mitt forslag', undoHow(true))).toBe('Er du sikker? «Mitt forslag» forsvinner fra listen. (Du kan angre med Angre.)');
    expect(nb.prompts.deleteVariantSure('X', undoHow(true))).not.toContain('Ctrl');
    expect(nb.prompts.deleteVariantSure('X', undoHow(false))).toContain('Angre eller Ctrl+Z');
    for (const t of [nb.prompts.resetSeed(undoHow(true)), nb.prompts.restoreVersion('X', undoHow(true)), nb.prompts.importProject('X', undoHow(true))]) {
      expect(t).not.toContain('Ctrl');
    }
    // Without matchMedia (no touch information) the keyboard text applies.
    expect(undoHow()).toBe(nb.prompts.undoKeyboard);
  });

  it('one source per text: hints, legend, the lock refusal and the existing-block refusal', () => {
    const e = nb.plan2d.edit;
    expect([e.hintWallStart, e.hintWallEnd, e.hintOpening, e.hintUnit, e.hintMeasure, e.hintMeasureEnd, e.hintFurniture]).toEqual([
      nb.hints.wall,
      nb.hints.wallEnd,
      nb.hints.opening,
      nb.hints.unit,
      nb.hints.measure,
      nb.hints.measureEnd,
      nb.hints.furniture,
    ]);
    expect([e.legendExisting, e.legendNew, e.legendRemoved]).toEqual([nb.status.existing, nb.status.new, nb.status.removed]);
    expect({ existing: nb.legend.existing, new: nb.legend.new, removed: nb.legend.removed }).toEqual(nb.status);
    expect(nb.editor.locked).toBe(nb.proposals.locked);
    expect(nb.topbar.lockedTitle).toBe(nb.proposals.locked);
    expect(nb.editor.existingBlockDelete).toBe(nb.edit.block.existingNoDelete);
    expect(nb.editor.existingBlockDelete.endsWith('.')).toBe(true);
  });

  it('the Møbler hint says how to use the library; the ghost header has a neutral kind tag', () => {
    expect(hintFor('furniture')).toBe('Trykk på et møbel i listen for å sette det inn, eller dra det inn i planen.');
    expect(nb.plan2d.edit.hintFurniture).toBe(hintFor('furniture'));
    expect(nb.help.toolList.find((t) => t.name === 'Møbler')?.text).toBe(hintFor('furniture'));
    expect(nb.selectionKinds.ghost).toBe('Fra hytta i dag');
    expect(nb.selectionKinds.ghost).not.toBe(nb.status.removed);
  });

  it('Romskjema, headline and Arealer say "i dag" / "nytt" like Egenskaper', () => {
    expect(nb.schedule.existingTag).toBe('i dag');
    expect(nb.schedule.newTag).toBe('nytt');
    expect(nb.schedule.split('1,0', '2,0')).toBe('i dag 1,0 · nytt 2,0');
    expect(nb.headline.existingShort).toBe('i dag');
    expect(nb.areas.existingShort).toBe('i dag');
    expect(nb.areas.existing).toBe(nb.status.existing);
    expect(allTexts().filter((t) => /\beks\./.test(t))).toEqual([]);
  });

  it('Forslag D: the hint line and the first-run card say it is the fixed base and "Nytt forslag" makes an editable copy', () => {
    expect(nb.hints.locked).toMatch(/det faste grunnlaget/);
    expect(nb.hints.locked).toMatch(/«Nytt forslag» lager en kopi som du kan endre/);
    expect(nb.firstRun.items.some((t) => /det faste grunnlaget/.test(t) && t.includes('«+ Nytt forslag» lager en kopi'))).toBe(true);
  });

  it('second fix round: one name per thing, no English; the first-run card names furniture now that the library exists', () => {
    // No English words in any text (the geometry fallback's technical detail is an argument, not part of nb).
    expect(allTexts().filter((t) => /(click|tap|delete|undo|redo|save|load|warning|error|the|and|select|rotate|room|wall|door|window|building)/i.test(t))).toEqual([]);
    // "Nytt bygg": the tool's tooltip names every template the chooser and the help offer.
    for (const u of Object.values(nb.tools.units)) expect(nb.tools.titles.unit.toLowerCase()).toContain(u.name.toLowerCase());
    // The first-run card names furniture (phase 2b: the library exists).
    expect(nb.firstRun.items.join(' ')).toMatch(/møbel/i);
    // The same value has the same name in the editor and in the read-only rows; "i dag" rather than "eksisterende".
    expect(nb.properties.fields.sill).toBe(nb.edit.opening.sill);
    expect(nb.properties.fields.risers).toBe(nb.edit.steps.risers);
    expect(nb.properties.fields.areaExisting).toBe('Herav hytta i dag');
    expect(nb.schedule.statusTitle).not.toContain('(i dag)');
    expect(nb.schedule.statusTitle).toContain(`«${nb.schedule.existingTag}»`);
    expect(nb.schedule.statusTitle).toContain(`«${nb.schedule.newTag}»`);
    // A selected door or window is tagged like the tool that makes it.
    expect(nb.selectionKinds.opening).toBe(nb.tools.names.opening);
    expect(nb.help.heading).toBe('Slik bruker du planleggeren');
    // Toast sentences end with a full stop.
    for (const t of [nb.editor.existingBlockMove, nb.editor.existingBlockDelete, nb.editor.deckMinVertices, nb.editor.deckVertexCrosses, nb.editor.tooSmall]) {
      expect(t.endsWith('.'), t).toBe(true);
    }
  });

  it('a delete that merges rooms reads as one sentence: "Slettet. «Soverom 1» og «Bad» er nå ett rom."', () => {
    expect(`${nb.toasts.deleted} ${nb.editor.merged('Soverom 1', 'Bad')}`).toBe('Slettet. «Soverom 1» og «Bad» er nå ett rom.');
  });
});

describe('warnings name walls and openings by type and place', () => {
  const seed = seedFixture();
  const names = makeNameLookup(seed.derived, seed.variant, seed.project.site);

  it('an interior door and wall: between the two rooms', () => {
    expect(names('opening', 'd-sov-ny')).toBe('døra i veggen mellom Gang og Soverom (ny fløy)');
    expect(names('wall', 'w-104-103')).toBe('veggen mellom Bad og Soverom 1');
    expect(names('wall', 'dv-pass-n')).toBe('romdeleren mellom Passasje og Spiseplass');
  });

  it('an exterior window: the true compass direction it faces and the room it is in', () => {
    // Plan +y bears 106°: the kitchen's plan-north wall faces east.
    expect(names('opening', 'win-kjk-n')).toBe('vinduet i ytterveggen mot øst i Kjøkken');
    expect(compassWord([0, 1])).toBe('nord');
    expect(compassWord([0, 1], { planNorthBearing: 106 })).toBe('øst');
    expect(compassWord([-1, 0], { planNorthBearing: 0 })).toBe('vest');
  });

  it('warning texts never show an id; openings on one wall are named together', () => {
    const door = seed.variant.openings.find((o) => o.id === 'd-sov-ny');
    if (!door) throw new Error('no d-sov-ny');
    const variant: Variant = { ...seed.variant, openings: [...seed.variant.openings, { ...door, id: 'op-s8l7wSL1', type: 'window', status: 'new' }] };
    const derived = seed.derive(variant);
    const overlap = warningItems(derived, variant, seed.project.site).find((w) => w.key.startsWith('opening-overlap'));
    expect(overlap?.text).toMatch(/^(Døra og vinduet|Vinduet og døra) i veggen mellom Gang og Soverom \(ny fløy\) overlapper hverandre\.$/);
    const lookup = makeNameLookup(derived, variant, seed.project.site);
    const all: ModelWarning[] = [
      { kind: 'opening-outside-host', openingId: 'd-sov-ny' },
      { kind: 'opening-above-roof', openingId: 'win-kjk-n', headZ: 2.5, roofZ: 2.2 },
      { kind: 'door-blocked', openingId: 'd-sov-ny', by: 'w-104-103' },
      { kind: 'wall-dangling', wallId: 'w-gang-n' },
    ];
    const texts = all.map((w) => warningText(w, lookup, String));
    expect(texts[0]).toBe('Døra i veggen mellom Gang og Soverom (ny fløy) får ikke plass i veggen.');
    expect(texts[2]).toBe('Døra i veggen mellom Gang og Soverom (ny fløy) blokkeres av veggen mellom Bad og Soverom 1.');
    for (const t of texts) expect(t).not.toMatch(/d-sov-ny|win-kjk-n|w-104-103|w-gang-n|op-/);
  });

  /**
   * "Mitt forslag" with a Vedskjul placed at each point (the real editor action), optionally listed before the other
   * blocks, and turned 90° `turns` times after placing (placement turns an open front away from the wing; two turns
   * put it back against the wing).
   */
  function withShed(at: [number, number][], shedsFirst = false, turns = 0): { variant: Variant } {
    const store = createAppStore({ ...seed.project, variants: [...seed.project.variants, seed.variant], activeVariantId: seed.variant.id });
    const sheds = at.map((p) => placeUnit(store, 'vedskjul', p));
    if (sheds.some((id) => !id)) throw new Error('no shed');
    for (const id of sheds) for (let i = 0; i < turns; i++) rotateBlock(store, id!, 90);
    const v = selectActiveVariant(store.getState());
    const isShed = (id: string) => sheds.includes(id);
    const variant = shedsFirst ? { ...v, blocks: [...v.blocks.filter((b) => isShed(b.id)), ...v.blocks.filter((b) => !isShed(b.id))] } : v;
    return { variant };
  }
  /** Against the wing's north wall (UX evidence d3/d4), and on the terrace's east steps. */
  const AT_WING: [number, number] = [18.4, 6.95];
  const ON_STEPS: [number, number] = [24.2, 9.1];
  const textsOf = (variant: Variant) => warningItems(seed.derive(variant), variant, seed.project.site).map((w) => w.text);

  it('an opening whose wall is now covered by another building part says which opening, where, and by what', () => {
    // A Vedskjul against the wing's north wall (UX evidence d3/d4). Listed first, the shed keeps the shared wall and
    // the wing's windows there lose theirs; listed last (as placed), the shed's own open front is the one covered.
    const first = withShed([AT_WING], true);
    const covered = seed.derive(first.variant).warnings.filter((w) => w.kind === 'opening-on-removed-edge');
    expect(covered.map((w) => (w.kind === 'opening-on-removed-edge' ? w.openingId : ''))).toContain('win-sov-n');
    expect(textsOf(first.variant)).toContain('Vinduet i ytterveggen mot øst i Soverom (ny fløy) sitter i en vegg som nå er dekket av «Vedskjul».');

    // Placed, the shed turns its open front away from the wing; turned back by hand, its front is the one covered.
    expect(textsOf(withShed([AT_WING]).variant).join(' | ')).not.toMatch(/Åpningen i ytterveggen .* i Vedskjul/);
    const placed = withShed([AT_WING], false, 2);
    const texts = textsOf(placed.variant);
    expect(texts).toContain('Åpningen i ytterveggen mot vest i Vedskjul sitter i en vegg som nå er dekket av «Ny tverrfløy».');
    for (const t of texts) expect(t).not.toMatch(/op-|blk-|win-|en vegg som er fjernet/);

    // A lookup that knows no covering part keeps the old sentence (never an id).
    const bare = (kind: string, id: string) => (kind === 'opening' ? 'åpningen' : id);
    expect(warningText({ kind: 'opening-on-removed-edge', openingId: 'op-1' }, bare, String)).toBe('Åpningen sitter i en vegg som er fjernet.');
  });

  it('a roof that does not meet its neighbour names the end by compass direction', () => {
    // A placed shed against the wing's gable end gives no roof warning (roof.ts: units do not carry a ridge on); a
    // drawn block there does.
    const { variant: withUnit } = withShed([AT_WING]);
    expect(textsOf(withUnit).join(' | ')).not.toMatch(/møter ikke nabotaket/);
    const variant = { ...withUnit, blocks: withUnit.blocks.map((b) => (b.template ? { ...b, template: undefined } : b)) };
    // The wing's ridge runs along plan y; its high (end) end faces plan +y, which bears 106°: east.
    expect(textsOf(variant)).toContain('Taket på «Ny tverrfløy» møter ikke nabotaket i enden mot øst.');
    const bare = (_kind: string, id: string) => id;
    expect(warningText({ kind: 'roof-no-meet', blockId: 'b', end: 'start' }, bare, String)).toBe('Taket på «b» møter ikke nabotaket i den ene enden.');
  });

  it('blocked deck steps say which steps and which building part is in the way', () => {
    // A Vedskjul on the terrace's east steps (centre (23.2, 9.1), facing plan +x: south).
    const { variant } = withShed([ON_STEPS]);
    expect(textsOf(variant)).toContain('Trappa fra terrassen mot sør står der det nå er «Vedskjul». Flytt trappa langs terrassekanten eller slett den.');
  });

  it('every warning kind on the real seed: no id, no placeless "a wall" / "a building" / "one end"', () => {
    // On the seed with a Vedskjul listed first against the wing's north wall (so win-sov-n's wall is covered) and one
    // on the terrace's east steps.
    const { variant } = withShed([AT_WING, ON_STEPS], true);
    const lookup = makeNameLookup(seed.derive(variant), variant, seed.project.site);
    // One sample per kind (the compiler insists on every kind of ModelWarning).
    const samples: { [K in ModelWarning['kind']]: Extract<ModelWarning, { kind: K }> } = {
      'room-unnamed': { kind: 'room-unnamed', faceId: 'face-x1', levelId: 'main', area: 4.3 },
      'room-anchor-lost': { kind: 'room-anchor-lost', roomId: 'room-sov1' },
      'room-small': { kind: 'room-small', roomId: 'room-sov1', area: 1, min: 2 },
      'opening-outside-host': { kind: 'opening-outside-host', openingId: 'win-kjk-n' },
      'opening-overlap': { kind: 'opening-overlap', openingIds: ['d-sov-ny', 'win-kjk-n'] },
      'opening-above-roof': { kind: 'opening-above-roof', openingId: 'win-kjk-n', headZ: 2.5, roofZ: 2.2 },
      'opening-on-removed-edge': { kind: 'opening-on-removed-edge', openingId: 'win-sov-n' },
      'door-blocked': { kind: 'door-blocked', openingId: 'd-sov-ny', by: 'w-104-103' },
      'wall-dangling': { kind: 'wall-dangling', wallId: 'w-gang-n' },
      'block-overlap': { kind: 'block-overlap', blockIds: ['blk-wing', 'blk-main'] },
      'block-self-intersecting': { kind: 'block-self-intersecting', blockId: 'blk-wing' },
      'parts-overlap': { kind: 'parts-overlap', blockId: 'blk-main' },
      'roof-no-meet': { kind: 'roof-no-meet', blockId: 'blk-wing', end: 'start' },
      'area-limit': { kind: 'area-limit', limit: 150, actual: 170 },
      'deck-steps-blocked': { kind: 'deck-steps-blocked', stepsId: 'rail-terrasse/steps/2', deckId: 'deck-terrasse' },
      // Furniture is named from the catalogue (phase 2b); the unknown type is quoted on purpose.
      'furniture-overlap': { kind: 'furniture-overlap', furnitureIds: ['f-1', 'f-2'] },
      'furniture-in-wall': { kind: 'furniture-in-wall', furnitureId: 'f-1', wallId: 'w-gang-n' },
      'furniture-outside': { kind: 'furniture-outside', furnitureId: 'f-1' },
      'furniture-unknown': { kind: 'furniture-unknown', furnitureId: 'f-1', catalogId: 'rakett' },
      'furniture-needs-wet-room': { kind: 'furniture-needs-wet-room', furnitureId: 'f-1' },
      generic: { kind: 'generic', message: 'geometry fallback: rooms on storey ground' },
    };
    const ids = /face-x1|room-sov1|win-|d-sov-ny|w-104|w-gang|blk-|rail-|deck-terrasse|steps\/|op-/;
    const placeless = /^En vegg |en vegg som er fjernet|den ene enden|den andre enden|et bygg\b|Ukjent advarsel/;
    for (const w of Object.values(samples)) {
      const text = warningText(w, lookup, formatM2);
      expect(text, w.kind).not.toMatch(placeless);
      if (!w.kind.startsWith('furniture-')) expect(text, w.kind).not.toMatch(ids);
    }
    expect(warningText(samples['roof-no-meet'], lookup, formatM2)).toBe('Taket på «Ny tverrfløy» møter ikke nabotaket i enden mot vest.');
    expect(warningText(samples['deck-steps-blocked'], lookup, formatM2)).toMatch(/^Trappa fra terrassen mot sør står der det nå er «Vedskjul 2»\./);
  });

  it('a loose wall in no named room is placed by the building part it stands in', () => {
    // A wall across Soverom (ny fløy) leaves an unnamed strip (y 3.4 … 4.2); a short stub in it dangles.
    const base = seed.variant.walls.find((w) => w.id === 'w-gang-n');
    if (!base) throw new Error('no w-gang-n');
    const variant: Variant = {
      ...seed.variant,
      walls: [
        ...seed.variant.walls,
        { ...base, id: 'w-split', a: [16, 4.2], b: [20.8, 4.2], status: 'new' },
        { ...base, id: 'w-stub', a: [19, 3.6], b: [19, 3.9], status: 'new' },
      ],
    };
    expect(textsOf(variant)).toContain('Veggen i «Ny tverrfløy» henger løs og danner ikke noe rom.');
  });

  it('a warning keeps its identity when only its figures change (not shown as new again)', () => {
    expect(warningKey({ kind: 'room-small', roomId: 'r', area: 1, min: 2 })).toBe(warningKey({ kind: 'room-small', roomId: 'r', area: 1.5, min: 2 }));
    expect(warningKey({ kind: 'opening-overlap', openingIds: ['a', 'b'] })).not.toBe(warningKey({ kind: 'opening-overlap', openingIds: ['a', 'c'] }));
  });
});
