/**
 * Fix round after 2a, UX finding "nb.ts wording consistency" and "Warnings use internal ids": one device verb, one
 * rotate verb, no Ctrl+Z on a touch screen, one source per text, the ghost header, "i dag" / "nytt" everywhere, the
 * Møbler hint, the Forslag D explanation; and warnings that name walls and openings by type and place.
 */
import { describe, expect, it } from 'vitest';
import { nb, warningText } from '../i18n/nb';
import type { ModelWarning } from '../model/derived';
import type { Variant } from '../model/types';
import { undoHow } from './device';
import { hintFor } from './hints';
import { seedFixture } from './testSeed';
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

  it('the Møbler hint says the library comes in the next update; the ghost header has a neutral kind tag', () => {
    expect(hintFor('furniture')).toBe('Møbelbiblioteket kommer i neste oppdatering.');
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

  it('a warning keeps its identity when only its figures change (not shown as new again)', () => {
    expect(warningKey({ kind: 'room-small', roomId: 'r', area: 1, min: 2 })).toBe(warningKey({ kind: 'room-small', roomId: 'r', area: 1.5, min: 2 }));
    expect(warningKey({ kind: 'opening-overlap', openingIds: ['a', 'b'] })).not.toBe(warningKey({ kind: 'opening-overlap', openingIds: ['a', 'c'] }));
  });
});
