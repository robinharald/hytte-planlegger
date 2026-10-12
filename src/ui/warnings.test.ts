/**
 * Loose walls in the Advarsler panel (editor polish, phase 2b; second review: "Veggen i Stue henger løs …" three times
 * after deleting the divider dv-kjk-w, and "En vegg henger løs …" with no place for a wall drawn on the terrace).
 * ui/warnings.ts names a loose wall by where it stands — the part of its one named room, the terrace, or the nearest
 * building part outside — and merges loose-wall lines with the same text into one line with a count.
 */
import { describe, expect, it } from 'vitest';
import { warningText } from '../i18n/nb';
import type { ModelWarning } from '../model/derived';
import type { Variant, Wall } from '../model/types';
import { deleteWall } from '../state/editActions';
import { createAppStore, selectActiveVariant } from '../state/store';
import { formatM2 } from './format';
import { seedFixture } from './testSeed';
import { compassWord, makeNameLookup, partOf, warningItems } from './warnings';
import { nb } from '../i18n/nb';

const seed = seedFixture();
const site = seed.project.site;

/** "Mitt forslag" (an unlocked copy of Forslag D) on a store. */
function proposal() {
  const store = createAppStore({ ...seed.project, variants: [...seed.project.variants, seed.variant], activeVariantId: seed.variant.id });
  return store;
}

/** The seed with extra new walls (a copy of w-gang-n's properties at new places). */
function withWalls(...walls: { id: string; a: [number, number]; b: [number, number] }[]): Variant {
  const base = seed.variant.walls.find((w) => w.id === 'w-gang-n') as Wall;
  return { ...seed.variant, walls: [...seed.variant.walls, ...walls.map((w) => ({ ...base, ...w, status: 'new' as const }))] };
}

const linesOf = (variant: Variant) => warningItems(seed.derive(variant), variant, site);

describe('partOf: which part of a room or deck a point is in', () => {
  const box: [number, number][] = [
    [0, 0],
    [8, 0],
    [8, 2],
    [0, 2],
  ];
  it('the compass word of the offset in half-sizes, "midt" (null) near the centre', () => {
    expect(partOf(box, [4, 1.1])).toBeNull();
    // A long room: 1 m from its north edge is its northern part, although the east end is 3 m away.
    expect(partOf(box, [4.5, 1.9])).toBe('nord');
    expect(partOf(box, [7.5, 1])).toBe('øst');
    expect(partOf(box, [7.5, 1.9])).toBe('nordøst');
    // True north with the site (plan +y bears 106°: east).
    expect(partOf(box, [4, 1.9], site)).toBe(compassWord([0, 1], site));
  });
});

describe('loose walls say where they stand', () => {
  it('a wall in one named room: the part of the room ("nord i …"), not just the room', () => {
    // A short stub inside Stue (x 9…16, y 0…2.2 on Plan 1), near its plan-east end.
    const variant = withWalls({ id: 'w-stub', a: [15, 1], b: [15, 1.6] });
    const d = seed.derive(variant);
    expect(d.warnings.some((w) => w.kind === 'wall-dangling' && w.wallId === 'w-stub')).toBe(true);
    const name = makeNameLookup(d, variant, site)('wall', 'w-stub');
    const stue = d.rooms.find((r) => r.room?.name === 'Stue')!;
    const part = partOf(stue.facePolygon.length >= 3 ? stue.facePolygon : stue.polygon, [15, 1.3], site);
    expect(part).not.toBeNull();
    expect(name).toBe(`veggen ${nb.warnings.names.inRoomPart(part, 'Stue')}`);
    expect(linesOf(variant).map((l) => l.text)).toContain(`Veggen ${part} i Stue henger løs og danner ikke noe rom.`);
  });

  it('a wall drawn on the terrace: "på terrassen" (with the part of the terrace), never "En vegg"', () => {
    const deck = seed.derived.outdoor.decks[0];
    expect(deck).toBeDefined();
    // On the deck's free part east of the buildings (Plan 1, x 22…24).
    const variant = withWalls({ id: 'w-deck', a: [22.5, 8], b: [23.5, 8] });
    const d = seed.derive(variant);
    expect(d.warnings.some((w) => w.kind === 'wall-dangling' && w.wallId === 'w-deck')).toBe(true);
    const text = warningText({ kind: 'wall-dangling', wallId: 'w-deck' }, makeNameLookup(d, variant, site), formatM2);
    expect(text).toMatch(/^Veggen (\S+ )?på terrassen henger løs og danner ikke noe rom\.$/);
    expect(text).not.toMatch(/^En vegg/);
  });

  it('a wall outside the buildings and the terrace: the direction from the nearest building part', () => {
    const variant = withWalls({ id: 'w-out', a: [2, -6], b: [4, -6] });
    const d = seed.derive(variant);
    const text = warningText({ kind: 'wall-dangling', wallId: 'w-out' }, makeNameLookup(d, variant, site), formatM2);
    expect(text).toMatch(/^Veggen \S+ for «[^»]+» henger løs og danner ikke noe rom\.$/);
  });

  it('a wall in an unnamed part of a building part keeps "i «…»", a wall between two rooms "mellom …"', () => {
    const names = makeNameLookup(seed.derived, seed.variant, site);
    expect(names('wall', 'w-104-103')).toBe('veggen mellom Bad og Soverom 1');
    expect(names('wall', 'dv-pass-n')).toBe('romdeleren mellom Passasje og Spiseplass');
  });
});

describe('the second review: deleting the divider dv-kjk-w', () => {
  it('names each loose wall by its place, and identical lines become one with a count', () => {
    const store = proposal();
    expect(deleteWall(store, 'dv-kjk-w')).toBe(true);
    const variant = selectActiveVariant(store.getState());
    const d = seed.derive(variant);
    const dangling = d.warnings.filter((w): w is Extract<ModelWarning, { kind: 'wall-dangling' }> => w.kind === 'wall-dangling');
    expect(dangling.length).toBeGreaterThanOrEqual(1);
    const lines = warningItems(d, variant, site).filter((l) => l.key.startsWith('wall-dangling'));
    // One line per distinct text; the counts add up to the warnings; no two lines say the same.
    expect(lines.reduce((n, l) => n + l.count, 0)).toBe(dangling.length);
    expect(new Set(lines.map((l) => l.text)).size).toBe(lines.length);
    for (const l of lines) {
      expect(l.text).not.toMatch(/^Veggen i Stue henger/);
      expect(l.text).not.toMatch(/^En vegg/);
      if (l.count > 1) expect(l.text).toMatch(new RegExp(`^${l.count} (vegger|romdelere) .+ henger løs og danner ikke noe rom\\.$`));
    }
  });
});

describe('merging', () => {
  it('two loose walls in the same part of a room: one line "2 vegger … henger løs …" pointing at the first', () => {
    const variant = withWalls({ id: 'w-s1', a: [15, 1], b: [15, 1.6] }, { id: 'w-s2', a: [15.3, 1], b: [15.3, 1.6] });
    const d = seed.derive(variant);
    const names = makeNameLookup(d, variant, site);
    expect(names('wall', 'w-s1')).toBe(names('wall', 'w-s2'));
    const place = names('wall', 'w-s1').replace(/^veggen /, '');
    const lines = warningItems(d, variant, site).filter((l) => l.key.startsWith('wall-dangling'));
    const merged = lines.find((l) => l.count === 2);
    expect(merged?.text).toBe(`2 vegger ${place} henger løs og danner ikke noe rom.`);
    expect(merged?.target).toEqual({ kind: 'wall', id: 'w-s1' });
  });

  it('other kinds keep a line each, even with the same text', () => {
    const warnings: ModelWarning[] = [
      { kind: 'opening-outside-host', openingId: 'nope-1' },
      { kind: 'opening-outside-host', openingId: 'nope-2' },
    ];
    const derived = { ...seed.derived, warnings };
    const lines = warningItems(derived, seed.variant, site);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.count)).toEqual([1, 1]);
    expect(lines[0].text).toBe(lines[1].text);
  });

  it('every line has a count of 1 when nothing repeats (the seed)', () => {
    expect(warningItems(seed.derived, seed.variant, site).every((l) => l.count === 1)).toBe(true);
  });
});

describe('furniture warnings name the item and what it stands in (phase 2b)', () => {
  const names = makeNameLookup(seed.derived, seed.variant, site);
  const text = (w: ModelWarning) => warningText(w, names, formatM2);

  it('a door blocked by a furniture item names the item; one blocked by a wall names the wall', () => {
    expect(text({ kind: 'door-blocked', openingId: 'd-105', by: 'fu-sov2-1' })).toMatch(/ blokkeres av «Seng 150»\.$/);
    expect(text({ kind: 'door-blocked', openingId: 'd-105', by: 'w-104-103' })).toMatch(/ blokkeres av veggen mellom Bad og Soverom 1\.$/);
  });

  it('an item in the stairs, the chimney, a post or the hot tub says so; in a wall it is "inni en vegg"', () => {
    const post = seed.derived.structure.find((s) => s.kind === 'post')!;
    expect(text({ kind: 'furniture-in-wall', furnitureId: 'fu-sov1-1', wallId: 'stair-loft' })).toBe('Møbelet «Seng 150» står i trappa.');
    expect(text({ kind: 'furniture-in-wall', furnitureId: 'fu-sov1-1', wallId: 'chimney-1' })).toBe('Møbelet «Seng 150» står i pipa.');
    expect(text({ kind: 'furniture-in-wall', furnitureId: 'fu-sov1-1', wallId: post.id })).toBe('Møbelet «Seng 150» står i en stolpe.');
    expect(text({ kind: 'furniture-in-wall', furnitureId: 'fu-sov1-1', wallId: 'tub-1' })).toBe('Møbelet «Seng 150» står i badestampen.');
    expect(text({ kind: 'furniture-in-wall', furnitureId: 'fu-sov1-1', wallId: 'w-104-103' })).toBe('Møbelet «Seng 150» står inni en vegg.');
  });
});
