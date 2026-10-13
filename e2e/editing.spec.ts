/**
 * Phase 2a editing on a desktop (docs/phase2-plan.md §3, §7 "Done when"). Every test but the Forslag D one starts from
 * a fresh "Nytt forslag" copy of the locked base proposal and drives the plan with the mouse like a family member:
 *
 *  (a) select the new wing's east exterior wall and drag it 1 m east: the wing follows, room areas change;
 *  (b) Nytt bygg → a Vedskjul on the terrace by the north railing: the deck pieces exclude it and the railing gets a
 *      gap; move it 1 m; attach it to the wing's north wall (a junction);
 *  (c) Vegg: a partition across Soverom (ny fløy): one room keeps its name, the other is unnamed until named (and
 *      then selected);
 *  (d) Soverom (ny fløy) Dybde 2,40 in Egenskaper: w-gang-n moves;
 *  (e) + (f) ghosts: the EXISTING door-mellom-vf moved 0.5 m turns new and leaves a dashed ghost; deleting the
 *      existing wall w-104-103 merges two rooms and leaves a ghost; Angre and "Ta tilbake" restore both;
 *  (g) on Forslag D itself every edit is refused with the toast, each attempt on its own (a drag of the selected
 *      wall shows the toast and does not pan);
 *  (h) the hot tub moves.
 * Fix round after 2a (the reviewers' findings, docs/phase2-plan.md §3.3–§3.5):
 *  (i) a short drag (0.3 m at the starting zoom) of w-gang-n lands on 3.7 (snapping does not pull it back);
 *  (j) the delete toast's Angre undoes only the delete (one toast for the delete + merge), and a later edit retires it;
 *  (k) moving a tree in "Mitt forslag" leaves the site and Forslag D unchanged (trees per proposal);
 *  (l) blk-main's west gable moved to x −1: the three west windows turn new and leave ghosts;
 *  (m) the whole wing moved 3 m east: every room keeps its name;
 *  (n) a placed Vedskjul turns 90° with "Roter 90°" in Egenskaper and keeps its back on the deck's north edge.
 * Second fix round after 2a:
 *  (o) the glass bump's east wall moved 0.5 m: the moved piece is new, the old wall a ghost, and today's BRA and axis
 *      area stay (BYA loses only the old cladding strips now inside the building);
 *  (p) a corner of the glass bump dragged out, then "Ta tilbake" on every ghost: no ghost left, the seed again;
 *  (q) w-105-diag moved 0.2 m, then "Ta tilbake": walls and openings as in the seed (the neighbour w-104-diag too);
 *  (r) the end handle of w-vf-korr dragged 0.36 m at the starting zoom moves the end (point snapping lets it go);
 *  (s) a Vedskjul against the wing's north wall turned twice stays against it, with no overlap warning;
 *  (t) after deleting w-104-103 a click on the middle of its ghost selects the ghost (no room label covers it);
 *  (c) also checks that the "Ny advarsel" toast of the unnamed piece goes away once the piece is named, and (e) that
 *      the door has its end handles at the starting zoom.
 * Final fix round after 2b:
 *  (u) w-vf-korr 0.3 m north, then w-103-korr 0.3 m south, then "Ta tilbake" on w-103-korr: w-vf-korr stays where
 *      the user put it (before: the restore reset it, with no toast);
 *  (v) a Vedskjul clicked 0.2 m south of the sauna wall moves no furniture of the house (before: the sauna stove was
 *      pushed out through the wall onto the terrace);
 *  (w) a Vedskjul dragged onto the terrace table pushes the table out (with the toast); deleting the shed leaves the
 *      table (before: the shed owned it, carried it along and deleted it);
 *  (x) a wall drag that cannot go on (lw-split north, on the loft) says so on the hint line while the drag lasts, and
 *      the wall stays.
 * Last fix round:
 *  (y) the Nytt bygg ghost over the house says «Bygget kan ikke stå oppå et annet bygg» on the hint line and a click
 *      there is refused with it; an Anneks dragged 4 m north into the wing stops against its wall (the hint while the
 *      pointer is in the house), with no overlap warning (before: it stood on the house and took its walls, names and
 *      furniture along when moved or deleted);
 *  (z) a Bod's north edge dragged over the terrace table pushes the table out (with the toast); the Bod moved and
 *      deleted leaves the table (before: the enlarged Bod owned it, carried it and deleted it);
 *  (aa) w-106-korr 0.3 m north carries the loft wall lw-106-top (`carriedBy`); lw-106-top moved on by the user, then
 *      «Ta tilbake» on lw-106-top: w-106-korr stays where the user put it (before: it was reset to the seed).
 * Fourth fix round: (ab) a Vedskjul against the main house resized in Egenskaper, the house stays; (ac) the corner
 * w-peis-w / w-peis-n closes again on «Ta tilbake».
 * Final morning round:
 *  (ad) dv-leseskrok 0.3 m south, w-106-stue 0.3 m west (nothing is carried, so no wall holds `carriedBy`), «Ta
 *      tilbake» on dv-leseskrok: w-106-stue stays straight with its end on the restored line (before: the fallback for
 *      proposals without `carriedBy` slanted it, with no toast);
 *  (ae) the main house's south edge 0.5 m north, a Vedskjul against it and another in the way of the old edge: «Ta
 *      tilbake» on the edge is refused with the toast naming the one in the way («Ta tilbake går ikke: «Vedskjul 2»
 *      står i veien – flytt det først.») and changes nothing — the shed against the edge is not pushed, no undo step
 *      (before: the shed was pushed off the house although the toast said no).
 * No state may produce a 'generic' warning (a failed derive or a geometry fallback).
 *
 * Screenshots (e2e/screenshots/): plan-editing.png (the deck selected: vertex and "+" handles), plan-unit-on-deck.png,
 * plan-ghosts.png (a moved door's and a deleted wall's ghosts, zoomed in), plan-glass-bump.png (the glass bump's east
 * wall moved: new wall, old wall dashed).
 */
import { expect, test, type Page } from '@playwright/test';
import type { Variant, Vec2 } from '../src/model/types';
import {
  activeVariant,
  assertNoGenericWarnings,
  clickPlan,
  collectPageErrors,
  createNewProposal,
  derivedRooms,
  dismissToasts,
  dragPlan,
  type HytteWindow,
  loadAndWaitReady,
  planToClient,
  planTransform,
  projectOnScreen,
  roomTapPoint,
  selectAt,
  selectRoom,
  selection,
  shoot,
  skipFirstRun,
} from './helpers';

const LOCKED_TEXT = 'Forslag D er grunnlaget og kan ikke endres. Lag et nytt forslag for å endre.';

const near = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;

function blockPolygon(v: Variant, id: string): Vec2[] {
  const b = v.blocks.find((x) => x.id === id);
  if (!b) throw new Error(`block ${id} missing`);
  return b.polygon.map((q) => q.p);
}

function bbox(poly: Vec2[]): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.min(...poly.map((p) => p[0])),
    y0: Math.min(...poly.map((p) => p[1])),
    x1: Math.max(...poly.map((p) => p[0])),
    y1: Math.max(...poly.map((p) => p[1])),
  };
}

/** Area of the first deck's derived pieces (outer rings minus holes) and its free runs per stored edge. */
async function deckState(page: Page): Promise<{ area: number; runs: Record<string, number>; railingPanels: number }> {
  return page.evaluate(() => {
    const d = (window as HytteWindow).__hytte?.derived;
    if (!d) throw new Error('derived missing');
    const deck = d.outdoor.decks[0];
    const ringArea = (r: [number, number][]) => {
      let s = 0;
      for (let i = 0; i < r.length; i++) {
        const [x0, y0] = r[i];
        const [x1, y1] = r[(i + 1) % r.length];
        s += x0 * y1 - x1 * y0;
      }
      return Math.abs(s) / 2;
    };
    let area = 0;
    for (const piece of deck.pieces) piece.forEach((ring, i) => (area += i === 0 ? ringArea(ring) : -ringArea(ring)));
    const runs: Record<string, number> = {};
    for (const r of deck.freeRuns) runs[r.edgeId] = (runs[r.edgeId] ?? 0) + 1;
    const railing = d.outdoor.railings.find((r) => r.deckId === deck.id);
    return { area, runs, railingPanels: railing?.panels.length ?? 0 };
  });
}

/** Does a derived deck piece contain the point? */
async function deckContains(page: Page, p: Vec2): Promise<boolean> {
  return page.evaluate(([x, y]) => {
    const d = (window as HytteWindow).__hytte?.derived;
    if (!d) throw new Error('derived missing');
    const inside = (r: [number, number][]) => {
      let c = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i];
        const [xj, yj] = r[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    return d.outdoor.decks.some((deck) => deck.pieces.some((piece) => inside(piece[0]) && !piece.slice(1).some(inside)));
  }, p);
}

async function freshProposal(page: Page): Promise<void> {
  await loadAndWaitReady(page);
  await createNewProposal(page);
}

/** Zoom the plan in around a plan point with the mouse wheel (each step about × 1.25). */
async function zoomAt(page: Page, p: Vec2, steps: number): Promise<void> {
  const [x, y] = await planToClient(page, p);
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, -150);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(300);
}

/** Today's (existing) BYA, BRA and axis area. */
async function existingAreas(page: Page): Promise<{ bya: number; bra: number; axis: number }> {
  return page.evaluate(() => {
    const a = (window as HytteWindow).__hytte?.derived?.areas;
    if (!a) throw new Error('derived missing');
    return { bya: a.bya.existing, bra: a.bra.existing, axis: a.axis.existing };
  });
}

/**
 * The point of the segment a–b (the drawn line of wall or ghost `id`) farthest from every other wall line, opening
 * and edge ghost of the plan's storey (default Plan 1), so a click there selects `id` and nothing drawn beside it.
 */
async function clearPointOn(page: Page, id: string, a: Vec2, b: Vec2, storey = 'ground'): Promise<Vec2> {
  return page.evaluate(
    ({ id, a, b, storey }) => {
      type P = [number, number];
      const d = (window as HytteWindow).__hytte?.derived;
      if (!d) throw new Error('derived missing');
      const segs: [P, P][] = [];
      for (const w of d.walls) {
        if (!w.storeyIds.includes(storey)) continue;
        if (w.id !== id) segs.push([w.a, w.b]);
        const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
        const u: P = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
        for (const o of w.openings) {
          const s0 = o.offset - o.width / 2;
          const s1 = o.offset + o.width / 2;
          segs.push([
            [w.a[0] + u[0] * s0, w.a[1] + u[1] * s0],
            [w.a[0] + u[0] * s1, w.a[1] + u[1] * s1],
          ]);
        }
      }
      for (const g of d.ghosts) if (g.id !== id) segs.push([g.a, g.b]);
      const distSeg = (p: P, [s, e]: [P, P]) => {
        const dx = e[0] - s[0];
        const dy = e[1] - s[1];
        const l2 = dx * dx + dy * dy;
        const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / l2));
        return Math.hypot(p[0] - s[0] - t * dx, p[1] - s[1] - t * dy);
      };
      let best: P = a;
      let bestD = -1;
      for (let i = 1; i < 60; i++) {
        const t = i / 60;
        const p: P = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const m = Math.min(...segs.map((s) => distSeg(p, s)));
        if (m > bestD) {
          bestD = m;
          best = p;
        }
      }
      return best;
    },
    { id, a, b, storey },
  );
}

/** The derived line (a, b) of a wall, wall ghost or edge ghost by id. */
async function derivedLine(page: Page, id: string): Promise<{ a: Vec2; b: Vec2 }> {
  return page.evaluate((id) => {
    const d = (window as HytteWindow).__hytte?.derived;
    const w = d?.walls.find((x) => x.id === id) ?? d?.ghosts.find((g) => g.id === id);
    if (!w) throw new Error(`${id} is not drawn`);
    return { a: w.a, b: w.b };
  }, id);
}

/** Select the glass bump (Leseskrok) itself: tap its room (its name; the room is furnished), then "Velg bygningsdelen". */
async function selectGlassBump(page: Page): Promise<void> {
  const at = await roomTapPoint(page, 'room-leseskrok');
  await page.mouse.click(at[0], at[1]);
  await expect.poll(() => selection(page)).toMatchObject({ kind: 'room', id: 'room-leseskrok' });
  await page.getByRole('button', { name: 'Velg bygningsdelen' }).click();
  await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id: 'blk-glass' });
}

/** Blocks, walls and openings of the active proposal against an earlier copy of it (`ghosts` as they are now). */
async function sameAs(page: Page, v0: Variant): Promise<{ blocks: boolean; walls: boolean; openings: boolean; ghosts: unknown }> {
  const v = await activeVariant(page);
  const J = (x: unknown) => JSON.stringify(x);
  return { blocks: J(v.blocks) === J(v0.blocks), walls: J(v.walls) === J(v0.walls), openings: J(v.openings) === J(v0.openings), ghosts: v.ghosts };
}

test.describe('editing a proposal (desktop 1400×900)', () => {
  let pageErrors: string[] = [];
  test.beforeEach(async ({ page }) => {
    pageErrors = collectPageErrors(page);
    await skipFirstRun(page);
  });
  test.afterEach(async ({ page }) => {
    await assertNoGenericWarnings(page);
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('(a) the wing follows its east wall dragged 1 m east', async ({ page }) => {
    await freshProposal(page);
    const before = await derivedRooms(page);
    const area = (rooms: typeof before, id: string) => rooms.find((r) => r.id === id)?.area ?? NaN;

    await selectAt(page, [20.8, 4.8], { kind: 'wall', id: /^blk-wing\// });
    await dragPlan(page, [20.8, 4.8], [21.8, 4.8]);

    await expect.poll(async () => bbox(blockPolygon(await activeVariant(page), 'blk-wing')).x1).toBeCloseTo(21.8, 2);
    const wing = bbox(blockPolygon(await activeVariant(page), 'blk-wing'));
    expect(wing, 'only the east edge moved').toMatchObject({ x0: 16, y0: -2, y1: 6.2 });
    const after = await derivedRooms(page);
    // The rooms along the east wall grow by 1 m × their depth; the rest stay.
    expect(area(after, 'room-sov-ny') - area(before, 'room-sov-ny')).toBeCloseTo(2.58, 1);
    expect(area(after, 'room-gang') - area(before, 'room-gang')).toBeCloseTo(1.08, 1);
    expect(area(after, 'room-hovedbad')).toBeGreaterThan(area(before, 'room-hovedbad') + 3.5);
    expect(area(after, 'room-stue')).toBeCloseTo(area(before, 'room-stue'), 3);
    expect(after.filter((r) => r.name === null), 'no unnamed rooms').toEqual([]);
    // One undo step.
    await page.getByTestId('undo').click();
    await expect.poll(async () => bbox(blockPolygon(await activeVariant(page), 'blk-wing')).x1).toBeCloseTo(20.8, 3);
  });

  test('(b) a Vedskjul on the terrace: deck and railing adapt; it moves and attaches to the wing', async ({ page }, testInfo) => {
    await freshProposal(page);
    const deck0 = await deckState(page);
    expect(deck0.runs['deck-terrasse-v2'], 'the north edge has one free run').toBe(1);

    await page.getByTestId('tool-unit').click();
    await page.getByTestId('unit-vedskjul').click();
    // Turn it half round so the open front faces the deck when it later stands against the wing.
    await page.getByTestId('unit-rotate').click();
    await page.getByTestId('unit-rotate').click();
    await expect(page.getByTestId('plan-view')).toHaveAttribute('data-plan-tool', 'unit');
    // Near the north edge of the terrace: the unit snaps with its back against the deck edge (y 12.1).
    const [x, y] = await planToClient(page, [14, 11.3]);
    await page.mouse.move(x - 20, y - 20);
    await page.mouse.move(x, y, { steps: 5 });
    await page.mouse.click(x, y);

    await expect.poll(async () => (await activeVariant(page)).blocks.length).toBe(5);
    const unit = (await activeVariant(page)).blocks[4];
    expect(unit).toMatchObject({ name: 'Vedskjul', isNew: true, template: 'vedskjul' });
    let box = bbox(unit.polygon.map((q) => q.p));
    expect(box.x1 - box.x0).toBeCloseTo(2, 3);
    expect(box.y1 - box.y0).toBeCloseTo(1.5, 3);
    expect(box.y1, 'snapped against the north edge of the deck').toBeCloseTo(12.1, 2);
    expect(await selection(page), 'the new unit is selected, the tool is back to Velg').toMatchObject({ kind: 'block', id: unit.id });
    await expect(page.getByTestId('plan-view')).toHaveAttribute('data-plan-tool', 'select');

    // The deck pieces exclude it, and the north railing has a gap where it stands.
    const deck1 = await deckState(page);
    expect(deck0.area - deck1.area, 'deck area under the unit is gone').toBeGreaterThan(2.5);
    expect(await deckContains(page, [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2])).toBe(false);
    expect(deck1.runs['deck-terrasse-v2'], 'the north edge is split into two free runs').toBe(2);
    expect(deck1.railingPanels).toBeGreaterThan(deck0.railingPanels);

    // Move it 1 m east (drag the selected unit by its body).
    const c0: Vec2 = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
    await dragPlan(page, c0, [c0[0] + 1, c0[1]]);
    await expect.poll(async () => bbox(blockPolygon(await activeVariant(page), unit.id)).x0).toBeCloseTo(box.x0 + 1, 1);
    box = bbox(blockPolygon(await activeVariant(page), unit.id));
    expect(box.y1, 'still against the deck edge').toBeCloseTo(12.1, 2);
    expect((await deckState(page)).runs['deck-terrasse-v2']).toBe(2);
    // Zoomed in on the unit and the gap in the north railing.
    const [zx, zy] = await planToClient(page, [16.5, 10]);
    await page.mouse.move(zx, zy);
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, -150);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(300);
    await shoot(page, testInfo, 'plan-unit-on-deck');

    // Attach it to the wing's north wall (y 6.2), flush with the wing's east corner (x 20.8).
    const c1: Vec2 = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
    await dragPlan(page, c1, [19.8, 6.95], 20);
    await expect.poll(async () => bbox(blockPolygon(await activeVariant(page), unit.id)).y0).toBeCloseTo(6.2, 2);
    box = bbox(blockPolygon(await activeVariant(page), unit.id));
    expect(box.x1).toBeGreaterThan(18.5);
    expect(box.x0).toBeLessThan(20.8);
    const junctions = await page.evaluate(
      (id) => (window as HytteWindow).__hytte?.derived?.blocks.find((b) => b.block.id === id)?.junctions.map((j) => j.otherBlockId) ?? [],
      unit.id,
    );
    expect(junctions, 'the unit and the wing share a wall').toContain('blk-wing');
    expect((await deckState(page)).runs['deck-terrasse-v2'], 'the north railing is whole again').toBe(1);
  });

  test('(c) a partition across Soverom (ny fløy): one room keeps its name, the other is named', async ({ page }) => {
    await freshProposal(page);
    const wallCount = (await activeVariant(page)).walls.length;
    await page.getByTestId('tool-wall').click();
    await expect(page.getByTestId('hint-line')).toContainText('Trykk der veggen skal begynne');
    // Between the rug (to x 18.4) and the bed (from x 18.64): a wall through furniture would warn about it too.
    await clickPlan(page, [18.5, 3.4]);
    await expect(page.getByTestId('hint-line')).toContainText('Trykk der den skal slutte');
    await clickPlan(page, [18.5, 6.2]);
    await expect.poll(async () => (await activeVariant(page)).walls.length).toBe(wallCount + 1);
    // The unnamed piece is announced once, as a warning toast.
    const warningToast = page.getByTestId('toast').filter({ hasText: /advarsel/i });
    await expect(warningToast).toHaveCount(1);
    await expect(warningToast).toContainText('Rom uten navn');
    const wall = (await activeVariant(page)).walls.at(-1);
    expect(wall?.status).toBe('new');
    expect(Math.min(wall!.a[1], wall!.b[1])).toBeCloseTo(3.4, 1);
    expect(Math.max(wall!.a[1], wall!.b[1])).toBeCloseTo(6.2, 1);
    expect(await selection(page), 'the new wall is selected').toMatchObject({ kind: 'wall', id: wall!.id });
    await expect(page.getByTestId('plan-view'), 'Vegg stays active').toHaveAttribute('data-plan-tool', 'wall');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('plan-view')).toHaveAttribute('data-plan-tool', 'select');

    const rooms = await derivedRooms(page);
    expect(rooms.find((r) => r.id === 'room-sov-ny')?.name, 'the larger piece keeps the room').toBe('Soverom (ny fløy)');
    const unnamed = rooms.filter((r) => r.name === null);
    expect(unnamed).toHaveLength(1);

    // Name the other piece in Egenskaper ("Gi navn"): the bed fills it, so a click on the bed, then a second one there
    // for the room under it.
    await selectRoom(page, unnamed[0].id);
    await page.getByTestId('name-face-input').fill('Kontor');
    await page.getByTestId('name-face').click();
    await expect.poll(async () => (await derivedRooms(page)).filter((r) => r.name === null).length).toBe(0);
    expect((await derivedRooms(page)).map((r) => r.name)).toContain('Kontor');
    await expect(page.getByTestId('room-schedule')).toContainText('Kontor');
    // The newly named room is selected and shown in Egenskaper (not "Det som var valgt finnes ikke lenger").
    const kontor = (await derivedRooms(page)).find((r) => r.name === 'Kontor');
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'room', id: kontor?.id });
    await expect(page.getByTestId('properties')).toContainText('Kontor');
    await expect(page.getByTestId('properties')).not.toContainText('finnes ikke lenger');
    // The warning is gone, and so is its toast (it does not stay up for its full time).
    await expect(warningToast).toHaveCount(0);
  });

  test('(d) Dybde 2,40 for Soverom (ny fløy) moves w-gang-n', async ({ page }) => {
    await freshProposal(page);
    await selectRoom(page, 'room-sov-ny');
    const field = page.getByTestId('room-size-d').locator('input');
    await expect(field).toHaveValue(/^2,58/);
    await field.fill('2,40');
    await field.press('Enter');
    await expect.poll(async () => (await activeVariant(page)).walls.find((w) => w.id === 'w-gang-n')?.a[1]).toBeCloseTo(3.58, 3);
    const w = (await activeVariant(page)).walls.find((x) => x.id === 'w-gang-n');
    expect(w?.b[1]).toBeCloseTo(3.58, 3);
    await expect(field).toHaveValue(/^2,40/);
    const sov = (await derivedRooms(page)).find((r) => r.id === 'room-sov-ny');
    expect(sov?.area).toBeCloseTo(4.58 * 2.4, 1);
  });

  test('(e)+(f) ghosts: a moved existing door and a deleted existing wall; Angre and "Ta tilbake" restore them', async ({ page }, testInfo) => {
    await freshProposal(page);
    const doorBefore = (await activeVariant(page)).openings.find((o) => o.id === 'door-mellom-vf');
    expect(doorBefore?.status).toBe('existing');

    // (e) Move the existing door between Vindfang and Mellombygg 0.5 m east.
    await selectAt(page, [7.01, 6.2], { kind: 'opening', id: 'door-mellom-vf' });
    // At the starting zoom the 0.91 m door is wider than one handle: it has its end handles (outside its ends).
    await expect(page.locator('[data-testid=plan-view] [data-handle="oe:start"]')).toHaveCount(1);
    await expect(page.locator('[data-testid=plan-view] [data-handle="oe:end"]')).toHaveCount(1);
    await dragPlan(page, [7.01, 6.2], [7.51, 6.2]);
    await expect.poll(async () => (await activeVariant(page)).openings.find((o) => o.id === 'door-mellom-vf')?.status).toBe('new');
    let v = await activeVariant(page);
    const moved = v.openings.find((o) => o.id === 'door-mellom-vf');
    // The centre snaps to the 10 cm grid: 0.49 from 8.99 to 8.50 along the edge (it runs east → west).
    expect(Math.abs((moved?.offset ?? 0) - (doorBefore?.offset ?? 0))).toBeCloseTo(0.5, 1);
    const ghost = v.openings.find((o) => o.status === 'removed' && o.id.startsWith('door-mellom-vf'));
    expect(ghost, 'a removed copy stays at the old place').toBeDefined();
    expect(ghost?.offset).toBeCloseTo(doorBefore?.offset ?? NaN, 3);
    await expect(page.locator(`[data-testid=plan-view] [data-sel-kind=ghost][data-sel-id="${ghost?.id}"]`)).toHaveCount(1);

    // (f) Delete the existing wall between Soverom 1 and Bad (lower level): the rooms merge, the wall stays as a ghost.
    await selectAt(page, [3.05, 5.6], { kind: 'wall', id: 'w-104-103' });
    await page.getByTestId('wall-delete').click();
    await expect.poll(async () => (await activeVariant(page)).walls.find((w) => w.id === 'w-104-103')?.status).toBe('removed');
    const rooms = await derivedRooms(page);
    expect(rooms.map((r) => r.id)).toContain('room-sov1');
    expect(rooms.map((r) => r.id), 'Bad merged into Soverom 1').not.toContain('room-bad');
    expect(rooms.filter((r) => r.name === null)).toEqual([]);
    await expect(page.getByTestId('toasts')).toContainText('er nå ett rom');
    await expect(page.locator('[data-testid=plan-view] [data-sel-kind=ghost][data-sel-id="w-104-103"]').first()).toBeAttached();

    // Both ghosts on screen (zoomed in on the old cabin).
    await page.keyboard.press('Escape');
    const [zx, zy] = await planToClient(page, [5, 5.2]);
    await page.mouse.move(zx, zy);
    for (let i = 0; i < 2; i++) {
      await page.mouse.wheel(0, -150);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(300);
    await shoot(page, testInfo, 'plan-ghosts');

    // Angre brings the wall and both rooms back.
    await page.getByTestId('undo').click();
    await expect.poll(async () => (await activeVariant(page)).walls.find((w) => w.id === 'w-104-103')?.status).toBe('existing');
    expect((await derivedRooms(page)).map((r) => r.id)).toEqual(expect.arrayContaining(['room-sov1', 'room-bad']));

    // "Ta tilbake" on the door's ghost puts the door back where it was, as part of today's cabin.
    await selectAt(page, [6.62, 6.2], { kind: 'ghost', id: ghost!.id });
    await page.getByTestId('ghost-restore').click();
    await expect.poll(async () => (await activeVariant(page)).openings.find((o) => o.id === 'door-mellom-vf')?.status).toBe('existing');
    v = await activeVariant(page);
    expect(v.openings.find((o) => o.id === 'door-mellom-vf')?.offset).toBeCloseTo(doorBefore?.offset ?? NaN, 3);
    expect(v.openings.filter((o) => o.status === 'removed' && o.id.startsWith('door-mellom-vf'))).toEqual([]);
  });

  test('(g) Forslag D itself refuses every edit with the toast', async ({ page }) => {
    await loadAndWaitReady(page);
    const before = JSON.stringify(await activeVariant(page));
    expect((await activeVariant(page)).locked).toBe(true);
    await expect(page.getByTestId('plan-view')).toHaveAttribute('data-plan-editable', 'false');
    const lockedToast = page.getByTestId('toast').filter({ hasText: LOCKED_TEXT });
    /** Each refused attempt shows the locked toast on its own (closed again before the next attempt). */
    const expectRefused = async (step: string) => {
      await expect(lockedToast, `${step}: the locked toast`).toHaveCount(1);
      await dismissToasts(page);
      await expect(lockedToast).toHaveCount(0);
    };

    // An editing tool (greyed with aria-disabled, but still clickable: the click explains why).
    await page.getByTestId('tool-wall').click({ force: true });
    await expectRefused('tool');
    await expect(page.getByTestId('plan-view')).toHaveAttribute('data-plan-tool', 'select');
    // A drag of the selected wall: the toast, and the plan does not pan.
    await selectAt(page, [20.8, 4.8], { kind: 'wall' });
    const t0 = await planTransform(page);
    await dragPlan(page, [20.8, 4.8], [21.8, 4.8]);
    await expectRefused('drag of the selected wall');
    expect(await planTransform(page), 'the plan did not pan').toBe(t0);
    // Delete on a selected stored wall.
    await selectAt(page, [19.5, 3.4], { kind: 'wall', id: 'w-gang-n' });
    await page.keyboard.press('Delete');
    await expectRefused('Delete');
    // A number field in Egenskaper.
    await selectRoom(page, 'room-sov-ny');
    const field = page.getByTestId('room-size-d').locator('input');
    await field.click();
    await page.keyboard.type('3');
    await field.press('Enter');
    await expectRefused('number field');
    // Arrow nudge.
    await selectAt(page, [19.5, 3.4], { kind: 'wall', id: 'w-gang-n' });
    await page.keyboard.press('ArrowUp');
    await expect(lockedToast, 'arrow nudge: the locked toast').toHaveCount(1);

    expect(JSON.stringify(await activeVariant(page)), 'Forslag D is unchanged').toBe(before);
    expect((await projectOnScreen(page)).variants).toHaveLength(1);

    // The toast's "Nytt forslag" makes an editable copy.
    await page.getByTestId('toast-new-proposal').click();
    await expect.poll(async () => (await projectOnScreen(page)).variants.length).toBe(2);
    expect((await activeVariant(page)).locked).not.toBe(true);
    await expect(page.getByTestId('plan-view')).toHaveAttribute('data-plan-editable', 'true');
    const base = (await projectOnScreen(page)).variants.find((x) => x.id === 'forslag-d');
    expect(JSON.stringify(base)).toBe(before);
  });

  test('(h) the hot tub moves; the deck shows its handles when selected', async ({ page }, testInfo) => {
    await freshProposal(page);
    await selectAt(page, [22, 9], { kind: 'deck', id: 'deck-terrasse' });
    const vertices = page.locator('[data-testid=plan-view] [data-handle-shape=vertex]');
    await expect(vertices.first()).toBeVisible();
    expect(await vertices.count(), 'a handle on every deck corner').toBe(10);
    expect(await page.locator('[data-testid=plan-view] [data-handle-shape=insert]').count(), 'a "+" on every deck edge').toBe(10);
    await shoot(page, testInfo, 'plan-editing');

    const tub0 = (await activeVariant(page)).outdoor.hotTubs[0].centre;
    await selectAt(page, [21.7, -3.2], { kind: 'hotTub', id: 'tub-1' });
    await dragPlan(page, [21.7, -3.2], [19.7, -3.4]);
    await expect.poll(async () => (await activeVariant(page)).outdoor.hotTubs[0].centre[0]).toBeLessThan(tub0[0] - 1.5);
    const tub1 = (await activeVariant(page)).outdoor.hotTubs[0].centre;
    expect(near(tub1[0], 19.7, 0.25) && near(tub1[1], -3.4, 0.25), `tub at ${tub1.join(', ')}`).toBe(true);
  });

  test('(i) a short drag of w-gang-n (0.3 m at the starting zoom) lands on 3.7', async ({ page }) => {
    await freshProposal(page);
    await selectAt(page, [19.5, 3.4], { kind: 'wall', id: 'w-gang-n' });
    await dragPlan(page, [19.5, 3.4], [19.5, 3.7]);
    await expect.poll(async () => (await activeVariant(page)).walls.find((w) => w.id === 'w-gang-n')?.a[1]).toBeCloseTo(3.7, 3);
    const w = (await activeVariant(page)).walls.find((x) => x.id === 'w-gang-n');
    expect(w?.b[1]).toBeCloseTo(3.7, 3);
  });

  test("(j) the delete toast's Angre undoes only the delete; a later edit retires it", async ({ page }) => {
    await freshProposal(page);
    const gangY = async () => (await activeVariant(page)).walls.find((w) => w.id === 'w-gang-n')?.a[1];
    const wallStatus = async () => (await activeVariant(page)).walls.find((w) => w.id === 'w-104-103')?.status;
    // An unrelated edit first: w-gang-n 10 cm north (one undo step).
    await selectAt(page, [19.5, 3.4], { kind: 'wall', id: 'w-gang-n' });
    await page.keyboard.press('Shift+ArrowUp');
    await expect.poll(gangY).toBeCloseTo(3.5, 3);
    await dismissToasts(page);

    // Delete w-104-103: ONE toast for the action ("Slettet." + the merge) with one Angre.
    await selectAt(page, [3.05, 5.6], { kind: 'wall', id: 'w-104-103' });
    await page.getByTestId('wall-delete').click();
    await expect.poll(wallStatus).toBe('removed');
    const deleted = page.getByTestId('toast').filter({ hasText: 'Slettet.' });
    await expect(deleted).toHaveCount(1);
    await expect(deleted).toContainText('er nå ett rom');
    await expect(page.getByTestId('toast-undo')).toHaveCount(1);
    await deleted.getByTestId('toast-undo').click();
    await expect.poll(wallStatus).toBe('existing');
    expect(await gangY(), 'the earlier edit stays').toBeCloseTo(3.5, 3);
    expect((await derivedRooms(page)).map((r) => r.id)).toEqual(expect.arrayContaining(['room-sov1', 'room-bad']));
    await expect(deleted).toHaveCount(0);

    // Delete again, then another edit: the delete toast can no longer undo (closed or disabled).
    await selectAt(page, [3.05, 5.6], { kind: 'wall', id: 'w-104-103' });
    await page.getByTestId('wall-delete').click();
    await expect.poll(wallStatus).toBe('removed');
    await expect(deleted).toHaveCount(1);
    await selectAt(page, [19.5, 3.4], { kind: 'wall', id: 'w-gang-n' });
    await page.keyboard.press('Shift+ArrowUp');
    await expect.poll(gangY).toBeCloseTo(3.6, 3);
    await expect(deleted.getByTestId('toast-undo').and(page.locator(':enabled'))).toHaveCount(0);
    expect(await wallStatus(), 'nothing was undone').toBe('removed');
  });

  test('(k) moving a tree in "Mitt forslag" leaves the site and Forslag D unchanged', async ({ page }) => {
    await freshProposal(page);
    const p0 = await projectOnScreen(page);
    const site0 = JSON.stringify(p0.site);
    const base0 = JSON.stringify(p0.variants.find((v) => v.id === 'forslag-d'));
    await selectAt(page, [-4, 4], { kind: 'tree', id: 'tree-1' });
    await dragPlan(page, [-4, 4], [-2, 7]);
    await expect
      .poll(async () => (await activeVariant(page)).trees?.find((t) => t.id === 'tree-1')?.position[0] ?? -4)
      .toBeGreaterThan(-2.3);
    const moved = (await activeVariant(page)).trees?.find((t) => t.id === 'tree-1');
    expect(near(moved?.position[1] ?? NaN, 7, 0.3), `tree at ${moved?.position.join(', ')}`).toBe(true);
    const p1 = await projectOnScreen(page);
    expect(JSON.stringify(p1.site), 'the site is unchanged').toBe(site0);
    expect(JSON.stringify(p1.variants.find((v) => v.id === 'forslag-d')), 'Forslag D is unchanged').toBe(base0);
    // In the plan and 3D (derived), Forslag D still has the tree where it was.
    await page.getByTestId('proposals-menu').click();
    await page.getByTestId('proposal-item-forslag-d').click();
    await expect
      .poll(() => page.evaluate(() => (window as HytteWindow).__hytte?.derived?.site.trees.find((t) => t.tree.id === 'tree-1')?.tree.position))
      .toEqual([-4, 4]);
  });

  test("(l) blk-main's west gable moved to x −1: the three west windows turn new and leave ghosts", async ({ page }) => {
    await freshProposal(page);
    const ids = ['win-104-w', 'win-hems-w1', 'win-hems-w2'];
    const v0 = await activeVariant(page);
    for (const id of ids) expect(v0.openings.find((o) => o.id === id)?.status).toBe('existing');
    await selectAt(page, [0, 1.0], { kind: 'wall', id: /^blk-main\// });
    await dragPlan(page, [0, 1.0], [-1, 1.0]);
    await expect.poll(async () => bbox(blockPolygon(await activeVariant(page), 'blk-main')).x0).toBeCloseTo(-1, 2);
    const v = await activeVariant(page);
    for (const id of ids) {
      const o = v.openings.find((x) => x.id === id);
      expect(o?.status, `${id} is new`).toBe('new');
      const ghost = v.openings.find((x) => x.id === `${id}/ghost`);
      expect(ghost?.status, `${id} leaves a ghost`).toBe('removed');
    }
    expect(v.ghosts?.length ?? 0, 'the old gable line is a ghost').toBeGreaterThan(0);
    expect((await derivedRooms(page)).filter((r) => r.name === null), 'no unnamed rooms').toEqual([]);
  });

  test('(m) the whole wing moved 3 m east: every room keeps its name', async ({ page }) => {
    await freshProposal(page);
    const before = await derivedRooms(page);
    const named = (rooms: typeof before) => rooms.map((r) => `${r.id}=${r.name}`).sort();
    await selectAt(page, [20.8, 4.8], { kind: 'wall', id: /^blk-wing\// });
    await page.getByRole('button', { name: 'Velg bygningsdelen' }).click();
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id: 'blk-wing' });
    await dragPlan(page, [18.4, 1.0], [21.4, 1.0], 20);
    await expect.poll(async () => bbox(blockPolygon(await activeVariant(page), 'blk-wing')).x0).toBeCloseTo(19, 1);
    const wing = bbox(blockPolygon(await activeVariant(page), 'blk-wing'));
    expect(wing.x1 - wing.x0, 'the wing keeps its size').toBeCloseTo(4.8, 3);
    const after = await derivedRooms(page);
    expect(after.filter((r) => r.name === null), 'no unnamed rooms').toEqual([]);
    expect(named(after), 'the same rooms with the same names').toEqual(named(before));
    const lost = await page.evaluate(() => ((window as HytteWindow).__hytte?.derived?.warnings ?? []).filter((w) => w.kind === 'room-anchor-lost').length);
    expect(lost, 'no room lost its place').toBe(0);
    // The rooms moved with the wing: Hovedbad's label is now east of x 19.
    const hovedbad = await page.evaluate(() => (window as HytteWindow).__hytte?.derived?.rooms.find((r) => r.id === 'room-hovedbad')?.labelPoint);
    expect(hovedbad?.[0]).toBeGreaterThan(19);
  });

  test('(n) a placed Vedskjul turns 90° with "Roter 90°" and keeps its back on the deck edge', async ({ page }) => {
    await freshProposal(page);
    await page.getByTestId('tool-unit').click();
    await page.getByTestId('unit-vedskjul').click();
    const [x, y] = await planToClient(page, [14, 11.3]);
    await page.mouse.move(x - 20, y - 20);
    await page.mouse.move(x, y, { steps: 5 });
    await page.mouse.click(x, y);
    await expect.poll(async () => (await activeVariant(page)).blocks.length).toBe(5);
    const unit = (await activeVariant(page)).blocks[4];
    const b0 = bbox(unit.polygon.map((q) => q.p));
    expect(b0.x1 - b0.x0).toBeCloseTo(2, 3);
    expect(b0.y1 - b0.y0).toBeCloseTo(1.5, 3);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id: unit.id });

    await page.getByTestId('block-rotate').click();
    await expect.poll(async () => {
      const b = bbox(blockPolygon(await activeVariant(page), unit.id));
      return Math.round((b.x1 - b.x0) * 100) / 100;
    }).toBe(1.5);
    const b1 = bbox(blockPolygon(await activeVariant(page), unit.id));
    expect(b1.y1 - b1.y0).toBeCloseTo(2, 3);
    // It stood with its back on the deck's north edge (y 12.1): it turns about its middle and stays on that line.
    expect(b0.y1).toBeCloseTo(12.1, 2);
    expect(b1.y1, 'still on the deck edge').toBeCloseTo(12.1, 2);
    expect(near((b1.x0 + b1.x1) / 2, (b0.x0 + b0.x1) / 2, 0.11), 'turned about its middle').toBe(true);
    const overlaps = await page.evaluate(() => ((window as HytteWindow).__hytte?.derived?.warnings ?? []).filter((w) => w.kind === 'block-overlap').length);
    expect(overlaps).toBe(0);
    // One undo step turns it back.
    await page.getByTestId('undo').click();
    await expect.poll(async () => {
      const b = bbox(blockPolygon(await activeVariant(page), unit.id));
      return Math.round((b.x1 - b.x0) * 100) / 100;
    }).toBe(2);
  });

  test("(o) the glass bump's east wall moved 0.5 m: new wall, old wall a ghost, today's areas do not grow", async ({ page }, testInfo) => {
    await freshProposal(page);
    const a0 = await existingAreas(page);
    await selectGlassBump(page);
    // The east edge's handle sits at its middle (9, −1); drag it 0.5 m east.
    await expect(page.locator('[data-testid=plan-view] [data-handle="be:v-glass-se"]')).toHaveCount(1);
    await dragPlan(page, [9, -1], [9.5, -1]);
    await expect.poll(async () => bbox(blockPolygon(await activeVariant(page), 'blk-glass')).x1).toBeCloseTo(9.5, 2);
    expect(bbox(blockPolygon(await activeVariant(page), 'blk-glass')), 'only the east edge moved').toMatchObject({ x0: 5, y0: -2, y1: 0 });

    // The moved piece is new; the old east wall and the stretch of today's south wall the open junction now covers are
    // ghosts, drawn in the plan.
    const pieces = await page.evaluate(() =>
      ((window as HytteWindow).__hytte?.derived?.walls ?? [])
        .filter((w) => w.source.kind === 'blockEdge' && w.source.blockId === 'blk-glass' && w.source.edgeId === 'v-glass-se')
        .map((w) => w.isNew),
    );
    expect(pieces, 'the moved east wall is new').toEqual([true]);
    const ghosts = (await activeVariant(page)).ghosts?.map((g) => g.id) ?? [];
    expect(ghosts).toEqual(expect.arrayContaining(['blk-glass/v-glass-se/ghost', 'blk-main/v-main-sw/ghost']));
    await expect(page.locator('[data-testid=plan-view] [data-sel-kind=ghost][data-sel-id="blk-glass/v-glass-se/ghost"]').first()).toBeAttached();
    const leseskrok = await page.evaluate(() => (window as HytteWindow).__hytte?.derived?.rooms.find((r) => r.id === 'room-leseskrok'));
    expect(leseskrok?.areaNew, 'what Leseskrok gains is new').toBeGreaterThan(0.5);

    // Today's BRA and axis area stay; BYA loses only the old cladding strips that are now inside the building
    // (0.11 × 2.11 along the old east wall and 0.11 × 0.39 of the main wall beyond it), as for the west gable.
    const a1 = await existingAreas(page);
    expect(a1.bra).toBeCloseTo(a0.bra, 4);
    expect(a1.axis).toBeCloseTo(98, 4);
    expect(a1.bya).toBeCloseTo(a0.bya - 0.11 * 2.11 - 0.11 * 0.39, 3);
    await expect(page.getByTestId('headline')).toContainText('i dag 101,9');

    await page.keyboard.press('Escape');
    await zoomAt(page, [8, -0.5], 5);
    await shoot(page, testInfo, 'plan-glass-bump');

    // One undo step gives today's glass bump back, with no ghost.
    await page.getByTestId('undo').click();
    await expect.poll(async () => bbox(blockPolygon(await activeVariant(page), 'blk-glass')).x1).toBeCloseTo(9, 3);
    expect((await activeVariant(page)).ghosts).toBeUndefined();
  });

  test('(p) a corner of the glass bump dragged out, then "Ta tilbake" on every ghost: none is left', async ({ page }) => {
    await freshProposal(page);
    const v0 = await activeVariant(page);
    // Today's ghosts of the seed itself (the windows the proposal takes out) stay; count them first.
    const ghostEls = page.locator('[data-testid=plan-view] [data-sel-kind=ghost]');
    const ghostEls0 = await ghostEls.count();
    await selectGlassBump(page);
    await expect(page.locator('[data-testid=plan-view] [data-handle="bv:v-glass-sw"]')).toHaveCount(1);
    await dragPlan(page, [5, -2], [4.5, -2.5]);
    await expect
      .poll(async () => {
        const b = bbox(blockPolygon(await activeVariant(page), 'blk-glass'));
        return [b.x0, b.y0, b.x1, b.y1].map((c) => Math.round(c * 100) / 100);
      })
      .toEqual([4.5, -2.5, 9, 0]);
    const ghosts0 = (await activeVariant(page)).ghosts ?? [];
    expect(ghosts0.length, 'the old south and west walls are ghosts').toBeGreaterThan(1);

    // Zoomed in, "Ta tilbake" on each edge ghost in turn (clicked where nothing else is drawn next to it).
    await page.keyboard.press('Escape');
    await zoomAt(page, [7, -1.2], 6);
    const restored: string[] = [];
    for (let n = 0; n < 6; n++) {
      const g = (await activeVariant(page)).ghosts?.[0];
      if (!g) break;
      const line = await derivedLine(page, g.id);
      const at = await clearPointOn(page, g.id, line.a, line.b);
      await page.keyboard.press('Escape');
      await selectAt(page, at, { kind: 'ghost', id: g.id });
      await page.getByTestId('ghost-restore').click();
      await expect.poll(async () => (await activeVariant(page)).ghosts?.some((x) => x.id === g.id) ?? false).toBe(false);
      restored.push(g.id);
    }
    expect(restored.length).toBeGreaterThan(0);
    expect(await sameAs(page, v0), `after "Ta tilbake" on ${restored.join(', ')}`).toEqual({ blocks: true, walls: true, openings: true, ghosts: undefined });
    expect((await derivedRooms(page)).filter((r) => r.name === null)).toEqual([]);
    await expect(ghostEls, 'no ghost of the drag is left in the plan').toHaveCount(ghostEls0);
  });

  test('(q) w-105-diag moved 0.2 m, then "Ta tilbake": walls and openings as in the seed, the neighbour too', async ({ page }) => {
    await freshProposal(page);
    const v0 = await activeVariant(page);
    // Zoomed in on the diagonal walls of the lower floor (0.2 m is below the 5 px drag threshold at the starting zoom).
    await zoomAt(page, [2.7, 2.7], 6);
    const w = await derivedLine(page, 'w-105-diag');
    const at = await clearPointOn(page, 'w-105-diag', w.a, w.b);
    await selectAt(page, at, { kind: 'wall', id: 'w-105-diag' });
    // 0.2 m across the wall, towards the south-west (its left normal).
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const n: Vec2 = [-(w.b[1] - w.a[1]) / len, (w.b[0] - w.a[0]) / len];
    await dragPlan(page, at, [at[0] + n[0] * 0.2, at[1] + n[1] * 0.2]);
    await expect.poll(async () => (await activeVariant(page)).walls.find((x) => x.id === 'w-105-diag')?.status).toBe('new');
    const moved = (await activeVariant(page)).walls.find((x) => x.id === 'w-105-diag');
    const shift = Math.max(Math.hypot((moved?.a[0] ?? 0) - w.a[0], (moved?.a[1] ?? 0) - w.a[1]), Math.hypot((moved?.b[0] ?? 0) - w.b[0], (moved?.b[1] ?? 0) - w.b[1]));
    expect(shift, 'the wall moved').toBeGreaterThan(0.1);
    expect((await activeVariant(page)).walls.find((x) => x.id === 'w-104-diag')?.status, 'the neighbour was carried along').toBe('new');

    // "Ta tilbake" on the old line.
    await page.keyboard.press('Escape');
    const g = await derivedLine(page, 'w-105-diag/ghost');
    const gAt = await clearPointOn(page, 'w-105-diag/ghost', g.a, g.b);
    await selectAt(page, gAt, { kind: 'ghost', id: 'w-105-diag/ghost' });
    await page.getByTestId('ghost-restore').click();
    await expect.poll(async () => (await activeVariant(page)).walls.find((x) => x.id === 'w-105-diag')?.status).toBe('existing');
    expect(await sameAs(page, v0)).toEqual({ blocks: true, walls: true, openings: true, ghosts: undefined });
    expect((await derivedRooms(page)).filter((r) => r.name === null)).toEqual([]);
  });

  test('(r) the end handle of w-vf-korr dragged 0.36 m at the starting zoom moves the end', async ({ page }) => {
    await freshProposal(page);
    const w0 = (await activeVariant(page)).walls.find((x) => x.id === 'w-vf-korr');
    expect(w0?.b).toEqual([9, 4.24]);
    const line = await derivedLine(page, 'w-vf-korr');
    await selectAt(page, await clearPointOn(page, 'w-vf-korr', line.a, line.b), { kind: 'wall', id: 'w-vf-korr' });
    const handle = page.locator('[data-testid=plan-view] [data-handle="we:b"]');
    await expect(handle).toHaveCount(1);
    const box = await handle.boundingBox();
    if (!box) throw new Error('the end handle is not on screen');
    const [hx, hy] = [box.x + box.width / 2, box.y + box.height / 2];
    // Grab the handle and move the pointer 0.36 m north on screen.
    const from = await planToClient(page, [9, 4.24]);
    const to = await planToClient(page, [9, 4.6]);
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(hx + ((to[0] - from[0]) * i) / 12, hy + ((to[1] - from[1]) * i) / 12);
    await page.mouse.up();
    await expect.poll(async () => (await activeVariant(page)).walls.find((x) => x.id === 'w-vf-korr')?.b[1] ?? 0).toBeGreaterThan(4.5);
    const w1 = (await activeVariant(page)).walls.find((x) => x.id === 'w-vf-korr');
    expect(near(w1?.b[0] ?? NaN, 9, 0.03) && near(w1?.b[1] ?? NaN, 4.6, 0.05), `end b at ${w1?.b.join(', ')}`).toBe(true);
    expect(w1?.a, 'the other end stays').toEqual(w0?.a);
  });

  test('(s) a Vedskjul against the wing turned twice stays against it, with no overlap warning', async ({ page }) => {
    await freshProposal(page);
    await page.getByTestId('tool-unit').click();
    await page.getByTestId('unit-vedskjul').click();
    const [x, y] = await planToClient(page, [14, 11.3]);
    await page.mouse.move(x - 20, y - 20);
    await page.mouse.move(x, y, { steps: 5 });
    await page.mouse.click(x, y);
    await expect.poll(async () => (await activeVariant(page)).blocks.length).toBe(5);
    const unit = (await activeVariant(page)).blocks[4];
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id: unit.id });
    const c0 = bbox(unit.polygon.map((q) => q.p));
    // Against the wing's north wall (y 6.2), flush with its east corner.
    await dragPlan(page, [(c0.x0 + c0.x1) / 2, (c0.y0 + c0.y1) / 2], [19.8, 6.95], 20);
    await expect.poll(async () => bbox(blockPolygon(await activeVariant(page), unit.id)).y0).toBeCloseTo(6.2, 2);
    const start = bbox(blockPolygon(await activeVariant(page), unit.id));
    const state = () =>
      page.evaluate((id) => {
        const d = (window as HytteWindow).__hytte?.derived;
        return {
          junctions: d?.blocks.find((b) => b.block.id === id)?.junctions.map((j) => j.otherBlockId) ?? [],
          overlaps: (d?.warnings ?? []).filter((w) => w.kind === 'block-overlap').length,
        };
      }, unit.id);
    expect(await state()).toMatchObject({ junctions: expect.arrayContaining(['blk-wing']), overlaps: 0 });

    for (const turn of [1, 2]) {
      await dismissToasts(page);
      await page.getByTestId('block-rotate').click();
      await expect
        .poll(async () => {
          const b = bbox(blockPolygon(await activeVariant(page), unit.id));
          return Math.round((b.x1 - b.x0) * 100) / 100;
        })
        .toBe(turn === 1 ? 1.5 : 2);
      const b = bbox(blockPolygon(await activeVariant(page), unit.id));
      expect(b.y0, `turn ${turn}: still on the wing's north wall`).toBeCloseTo(6.2, 2);
      expect(await state(), `turn ${turn}`).toMatchObject({ junctions: expect.arrayContaining(['blk-wing']), overlaps: 0 });
      await expect(page.getByTestId('toast').filter({ hasText: 'overlapper' })).toHaveCount(0);
    }
    const end = bbox(blockPolygon(await activeVariant(page), unit.id));
    for (const k of ['x0', 'y0', 'x1', 'y1'] as const) expect(end[k], `back on the start footprint (${k})`).toBeCloseTo(start[k], 2);
  });

  test("(t) after deleting w-104-103 a click on its ghost's middle selects the ghost", async ({ page }) => {
    await freshProposal(page);
    await selectAt(page, [3.05, 5.6], { kind: 'wall', id: 'w-104-103' });
    await page.getByTestId('wall-delete').click();
    await expect.poll(async () => (await activeVariant(page)).walls.find((w) => w.id === 'w-104-103')?.status).toBe('removed');
    await dismissToasts(page);
    await page.keyboard.press('Escape');
    // The ghost runs x 3.05, y 4.24..6.2; the merged room's label must not cover its middle.
    await selectAt(page, [3.05, 5.22], { kind: 'ghost', id: 'w-104-103' });
    await expect(page.getByTestId('ghost-restore')).toBeVisible();
  });
});

test.describe('editing a proposal (desktop, final fix round after 2b)', () => {
  let pageErrors: string[] = [];
  test.beforeEach(async ({ page }) => {
    pageErrors = collectPageErrors(page);
    await skipFirstRun(page);
  });
  test.afterEach(async ({ page }) => {
    await assertNoGenericWarnings(page);
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  /** Drag the wall `id` (by a point clear of everything else) `dy` m along plan y; returns its stored y afterwards. */
  const dragWallY = async (page: Page, id: string, dy: number): Promise<number> => {
    const w = await derivedLine(page, id);
    const at = await clearPointOn(page, id, w.a, w.b);
    await selectAt(page, at, { kind: 'wall', id });
    const y0 = (await activeVariant(page)).walls.find((x) => x.id === id)?.a[1] ?? NaN;
    await dragPlan(page, at, [at[0], at[1] + dy]);
    await expect.poll(async () => Math.abs(((await activeVariant(page)).walls.find((x) => x.id === id)?.a[1] ?? y0) - y0), id).toBeGreaterThan(0.15);
    await page.keyboard.press('Escape');
    return (await activeVariant(page)).walls.find((x) => x.id === id)?.a[1] ?? NaN;
  };

  test('(u) w-vf-korr north, w-103-korr south, then "Ta tilbake" on w-103-korr: w-vf-korr stays where it was put', async ({ page }) => {
    await freshProposal(page);
    const y1 = await dragWallY(page, 'w-vf-korr', 0.3);
    expect(y1, 'w-vf-korr moved north').toBeCloseTo(4.54, 1);
    const y2 = await dragWallY(page, 'w-103-korr', -0.3);
    expect(y2, 'w-103-korr moved south').toBeCloseTo(3.94, 1);
    const vf = async () => (await activeVariant(page)).walls.find((x) => x.id === 'w-vf-korr');
    const moved = await vf();
    expect(moved?.a[1]).toBeCloseTo(y1, 6);

    const g = await derivedLine(page, 'w-103-korr/ghost');
    await selectAt(page, await clearPointOn(page, 'w-103-korr/ghost', g.a, g.b), { kind: 'ghost', id: 'w-103-korr/ghost' });
    await page.getByTestId('ghost-restore').click();
    await expect.poll(async () => (await activeVariant(page)).walls.find((x) => x.id === 'w-103-korr')?.status).toBe('existing');
    // The other wall keeps the user's move: exactly as it was before the restore.
    expect(await vf()).toEqual(moved);
  });

  /** Nytt bygg → Vedskjul, the pointer brought in from the side and clicked at plan point `p`; returns the new block's id. */
  const placeShed = async (page: Page, p: Vec2): Promise<string> => {
    const n = (await activeVariant(page)).blocks.length;
    await page.getByTestId('tool-unit').click();
    await page.getByTestId('unit-vedskjul').click();
    const [x, y] = await planToClient(page, p);
    await page.mouse.move(x - 20, y - 20);
    await page.mouse.move(x, y, { steps: 5 });
    await page.mouse.click(x, y);
    await expect.poll(async () => (await activeVariant(page)).blocks.length).toBe(n + 1);
    return (await activeVariant(page)).blocks[n].id;
  };
  const positions = async (page: Page) => new Map((await activeVariant(page)).furniture.map((f) => [f.id, f.position.join(',')]));

  test('(v) a Vedskjul clicked 0.2 m south of the sauna wall moves no furniture of the house', async ({ page }) => {
    await freshProposal(page);
    const inRooms = (await page.evaluate(() => ((window as HytteWindow).__hytte?.derived?.furniture ?? []).filter((f) => f.roomId).map((f) => f.id))).sort();
    expect(inRooms.length).toBeGreaterThan(40);
    const before = await positions(page);
    // The sauna is in the wing's south end (wall y −2); the stove fu-badstue-2 stands at (18.34, −1.615).
    await placeShed(page, [18.1, -2.2]);
    const after = await positions(page);
    const moved = inRooms.filter((id) => after.get(id) !== before.get(id));
    expect(moved, 'house furniture moved by the shed').toEqual([]);
    await expect(page.locator('[data-testid=toast]').filter({ hasText: 'er flyttet ut av' })).toHaveCount(0);
  });

  test('(w) a Vedskjul dragged onto the terrace table pushes it out; deleting the shed leaves the table', async ({ page }) => {
    await freshProposal(page);
    const n0 = (await activeVariant(page)).furniture.length;
    const table0 = (await activeVariant(page)).furniture.find((f) => f.id === 'fu-terrasse-2');
    expect(table0?.position).toEqual([12.8, -2.3]);
    // West of the table, on the terrace: nothing to push.
    const id = await placeShed(page, [10.6, -3.6]);
    expect((await activeVariant(page)).furniture.find((f) => f.id === 'fu-terrasse-2')?.position).toEqual([12.8, -2.3]);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id });
    await dismissToasts(page);
    // Dragged by its body so its middle comes to (12.8, −2.0), over the table.
    const box = bbox(blockPolygon(await activeVariant(page), id));
    const c: Vec2 = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
    await dragPlan(page, c, [12.8, -2.0], 20);
    await expect.poll(async () => bbox(blockPolygon(await activeVariant(page), id)).x0).toBeGreaterThan(box.x0 + 1.5);
    const moved = bbox(blockPolygon(await activeVariant(page), id));
    // The table is pushed out of the shed, and the toast says so.
    await expect(page.locator('[data-testid=toast]').filter({ hasText: '«Utebord» er flyttet ut av «Vedskjul».' })).toBeVisible();
    const t1 = (await activeVariant(page)).furniture.find((f) => f.id === 'fu-terrasse-2');
    const inside = (p: Vec2) => p[0] > moved.x0 && p[0] < moved.x1 && p[1] > moved.y0 && p[1] < moved.y1;
    expect(t1, 'the table is still there').toBeDefined();
    expect(inside(t1!.position), `the table at ${t1!.position.join(', ')} is out of the shed`).toBe(false);
    // Delete the shed: the table stays where it was pushed.
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id });
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await activeVariant(page)).blocks.some((b) => b.id === id)).toBe(false);
    const v = await activeVariant(page);
    expect(v.furniture.length, 'no furniture deleted with the shed').toBe(n0);
    expect(v.furniture.find((f) => f.id === 'fu-terrasse-2')?.position).toEqual(t1!.position);
  });

  test('(x) lw-split dragged north on the loft: the hint line says the wall cannot go on, and the wall stays', async ({ page }) => {
    await freshProposal(page);
    await page.getByTestId('plan-storey-loft').click();
    const w = await derivedLine(page, 'lw-split');
    const at = await clearPointOn(page, 'lw-split', w.a, w.b, 'loft');
    await selectAt(page, at, { kind: 'wall', id: 'lw-split' });
    const before = (await activeVariant(page)).walls.find((x) => x.id === 'lw-split');
    const hint = page.getByTestId('hint-line');
    const STUCK = 'Veggen kan ikke flyttes lenger hit – enden står fast';
    await expect(hint).not.toContainText(STUCK);
    // Press, and move 0.8 m north in steps without letting go.
    const [x0, y0] = await planToClient(page, at);
    const [, y1] = await planToClient(page, [at[0], at[1] + 0.8]);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(x0, y0 + ((y1 - y0) * i) / 12);
    await expect(hint).toContainText(STUCK);
    await page.mouse.up();
    await expect(hint).not.toContainText(STUCK);
    expect((await activeVariant(page)).walls.find((x) => x.id === 'lw-split')).toEqual(before);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Last fix round: a unit never stands on another building; an enlarged unit pushes terrace furniture out; «Ta
  // tilbake» on a carried wall leaves its carrier.
  // ---------------------------------------------------------------------------------------------------------------

  const ON_BLOCK = 'Bygget kan ikke stå oppå et annet bygg';
  const overlapWarnings = (page: Page) =>
    page.evaluate(() => ((window as HytteWindow).__hytte?.derived?.warnings ?? []).filter((w) => w.kind === 'block-overlap').length);

  /** Nytt bygg → `template`, the pointer brought in from the side to plan point `p` (the ghost there, nothing clicked). */
  const hoverUnit = async (page: Page, template: string, p: Vec2): Promise<void> => {
    await page.getByTestId('tool-unit').click();
    await page.getByTestId(`unit-${template}`).click();
    const [x, y] = await planToClient(page, p);
    await page.mouse.move(x - 20, y - 20);
    await page.mouse.move(x, y, { steps: 5 });
  };

  test('(y) Nytt bygg over the house says so and is refused; an Anneks dragged onto the house stops against its wall', async ({ page }) => {
    await freshProposal(page);
    const hint = page.getByTestId('hint-line');
    const n = (await activeVariant(page)).blocks.length;
    // The ghost over the middle of the house: the hint line says it cannot stand there, and a click is refused.
    await hoverUnit(page, 'anneks', [12, 3]);
    await expect(hint).toContainText(ON_BLOCK);
    const [hx, hy] = await planToClient(page, [12, 3]);
    await page.mouse.click(hx, hy);
    await expect(page.getByTestId('toast').filter({ hasText: `${ON_BLOCK}.` })).toBeVisible();
    expect((await activeVariant(page)).blocks.length).toBe(n);
    // (The toasts sit at the bottom of the plan, over the terrace.)
    await dismissToasts(page);
    // Out on the terrace south of the wing the hint goes, and a click places it.
    const [tx, ty] = await planToClient(page, [18.4, -6.5]);
    await page.mouse.move(tx, ty, { steps: 8 });
    await expect(hint).not.toContainText(ON_BLOCK);
    await page.mouse.click(tx, ty);
    await expect.poll(async () => (await activeVariant(page)).blocks.length).toBe(n + 1);
    const id = (await activeVariant(page)).blocks[n].id;
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id });
    await dismissToasts(page);
    const box0 = bbox(blockPolygon(await activeVariant(page), id));
    expect(box0.y1, 'placed clear of the wing (its south wall is at y −2)').toBeLessThan(-2.5);

    // Dragged by its body 4 m north, into the wing: while the pointer is in the house the hint says why it stops.
    const c: Vec2 = [(box0.x0 + box0.x1) / 2, (box0.y0 + box0.y1) / 2];
    const [x0, y0] = await planToClient(page, c);
    const [, y1] = await planToClient(page, [c[0], c[1] + 4]);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 16; i++) await page.mouse.move(x0, y0 + ((y1 - y0) * i) / 16);
    await expect(hint).toContainText(ON_BLOCK);
    await page.mouse.up();
    await expect(hint).not.toContainText(ON_BLOCK);
    // It stops at the contact: against the wing's south wall, not on it, with no overlap warning.
    await expect.poll(async () => bbox(blockPolygon(await activeVariant(page), id)).y1).toBeGreaterThan(box0.y1 + 0.5);
    const box1 = bbox(blockPolygon(await activeVariant(page), id));
    expect(box1.y1, `the Anneks ends at y ${box1.y1}`).toBeLessThanOrEqual(-2 + 1e-6);
    expect(box1.y1).toBeGreaterThan(-2.05);
    expect(box1.x0).toBeCloseTo(box0.x0, 2);
    expect(await overlapWarnings(page)).toBe(0);
  });

  test('(z) a Bod\'s north edge dragged over the terrace table pushes the table out; moved and deleted, the table stays', async ({ page }) => {
    await freshProposal(page);
    const n0 = (await activeVariant(page)).furniture.length;
    const table0 = (await activeVariant(page)).furniture.find((f) => f.id === 'fu-terrasse-2');
    expect(table0?.position).toEqual([12.8, -2.3]);
    const nb = (await activeVariant(page)).blocks.length;
    await hoverUnit(page, 'bod', [12.8, -5.4]);
    const [px, py] = await planToClient(page, [12.8, -5.4]);
    await page.mouse.click(px, py);
    await expect.poll(async () => (await activeVariant(page)).blocks.length).toBe(nb + 1);
    const bod = (await activeVariant(page)).blocks[nb];
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id: bod.id });
    await dismissToasts(page);
    const box0 = bbox(bod.polygon.map((q) => q.p));
    expect(box0.y1, 'south of the table').toBeLessThan(-2.8);
    // The north edge's handle (the edge from the north-east corner), dragged to y −1.1, over the table.
    const north = bod.polygon.find((q, i) => {
      const next = bod.polygon[(i + 1) % bod.polygon.length];
      return Math.abs(q.p[1] - box0.y1) < 1e-6 && Math.abs(next.p[1] - box0.y1) < 1e-6;
    });
    if (!north) throw new Error('no north edge');
    await expect(page.locator(`[data-testid=plan-view] [data-handle="be:${north.id}"]`)).toHaveCount(1);
    const mid: Vec2 = [(box0.x0 + box0.x1) / 2, box0.y1];
    await dragPlan(page, mid, [mid[0], -1.1], 16);
    await expect.poll(async () => bbox(blockPolygon(await activeVariant(page), bod.id)).y1).toBeGreaterThan(-1.6);
    const box1 = bbox(blockPolygon(await activeVariant(page), bod.id));
    await expect(page.getByTestId('toast').filter({ hasText: '«Utebord» er flyttet ut av «Bod».' })).toBeVisible();
    const t1 = (await activeVariant(page)).furniture.find((f) => f.id === 'fu-terrasse-2');
    const inside = (p: Vec2) => p[0] > box1.x0 && p[0] < box1.x1 && p[1] > box1.y0 && p[1] < box1.y1;
    expect(t1, 'the table is still there').toBeDefined();
    expect(inside(t1!.position), `the table at ${t1!.position.join(', ')} is out of the Bod`).toBe(false);
    const d = (await page.evaluate(() => (window as HytteWindow).__hytte?.derived?.furniture ?? [])).find((f) => f.id === 'fu-terrasse-2');
    expect(d?.roomId ?? null, 'the table is in no room of the Bod').toBeNull();
    await dismissToasts(page);
    // Moved 3 m south by its body and deleted: the table stays where it was pushed.
    const c: Vec2 = [(box1.x0 + box1.x1) / 2, (box1.y0 + box1.y1) / 2];
    await page.keyboard.press('Escape');
    await selectAt(page, c, { kind: 'block', id: bod.id });
    await dragPlan(page, c, [c[0], c[1] - 3], 16);
    await expect.poll(async () => bbox(blockPolygon(await activeVariant(page), bod.id)).y1).toBeLessThan(box1.y1 - 2);
    expect((await activeVariant(page)).furniture.find((f) => f.id === 'fu-terrasse-2')?.position).toEqual(t1!.position);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id: bod.id });
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await activeVariant(page)).blocks.some((b) => b.id === bod.id)).toBe(false);
    const v = await activeVariant(page);
    expect(v.furniture.length, 'no furniture deleted with the Bod').toBe(n0);
    expect(v.furniture.find((f) => f.id === 'fu-terrasse-2')?.position).toEqual(t1!.position);
  });

  /** As dragWallY, on the storey `storey` ('loft': Hems), zoomed in `zoom` wheel steps around the wall first. */
  const dragWallYOn = async (page: Page, id: string, dy: number, storey: string, zoom: number): Promise<number> => {
    const w = await derivedLine(page, id);
    await zoomAt(page, [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2], zoom);
    const at = await clearPointOn(page, id, w.a, w.b, storey);
    await selectAt(page, at, { kind: 'wall', id });
    const y0 = (await activeVariant(page)).walls.find((x) => x.id === id)?.a[1] ?? NaN;
    await dragPlan(page, at, [at[0], at[1] + dy]);
    await expect.poll(async () => Math.abs(((await activeVariant(page)).walls.find((x) => x.id === id)?.a[1] ?? y0) - y0), id).toBeGreaterThan(0.15);
    await page.keyboard.press('Escape');
    return (await activeVariant(page)).walls.find((x) => x.id === id)?.a[1] ?? NaN;
  };

  test('(aa) w-106-korr north (it carries the loft wall lw-106-top), lw-106-top north again, «Ta tilbake» on lw-106-top: w-106-korr stays', async ({ page }) => {
    await freshProposal(page);
    const wall = async (id: string) => (await activeVariant(page)).walls.find((x) => x.id === id);
    const top0 = await wall('lw-106-top');
    const korrY = await dragWallY(page, 'w-106-korr', 0.3);
    expect(korrY, 'w-106-korr moved north').toBeCloseTo(2.48, 1);
    // The loft wall above it in line was carried along (and knows by what).
    expect((await wall('lw-106-top'))?.carriedBy?.by).toBe('w-106-korr');
    await page.getByTestId('plan-storey-loft').click();
    await dismissToasts(page);
    // The carry left lw-106-top a 0.2 m stub beside the landing's door (as before this round): zoomed in to grab it.
    const topY = await dragWallYOn(page, 'lw-106-top', 0.3, 'loft', 10);
    expect(topY, 'lw-106-top moved on by the user').toBeGreaterThan(korrY + 0.15);
    const korr = await wall('w-106-korr');

    const g = await derivedLine(page, 'lw-106-top/ghost');
    await selectAt(page, await clearPointOn(page, 'lw-106-top/ghost', g.a, g.b, 'loft'), { kind: 'ghost', id: 'lw-106-top/ghost' });
    await page.getByTestId('ghost-restore').click();
    await expect.poll(async () => (await wall('lw-106-top'))?.status).toBe(top0?.status);
    expect((await wall('lw-106-top'))?.a).toEqual(top0?.a);
    expect((await wall('lw-106-top'))?.b).toEqual(top0?.b);
    // The carrier keeps the user's move: exactly as it was before the restore.
    expect(await wall('w-106-korr')).toEqual(korr);
  });
  // ---- Fourth fix round (sixth review) ----------------------------------------------------------------------------

  /** As dragWallY, along plan x (a wall along plan y). */
  const dragWallX = async (page: Page, id: string, dx: number): Promise<number> => {
    const w = await derivedLine(page, id);
    const at = await clearPointOn(page, id, w.a, w.b);
    await selectAt(page, at, { kind: 'wall', id });
    const x0 = (await activeVariant(page)).walls.find((x) => x.id === id)?.a[0] ?? NaN;
    await dragPlan(page, at, [at[0] + dx, at[1]]);
    await expect.poll(async () => Math.abs(((await activeVariant(page)).walls.find((x) => x.id === id)?.a[0] ?? x0) - x0), id).toBeGreaterThan(0.15);
    await page.keyboard.press('Escape');
    return (await activeVariant(page)).walls.find((x) => x.id === id)?.a[0] ?? NaN;
  };

  test('(ab) a Vedskjul against the main house, Dybde 2,0 in Egenskaper: the shed grows south, the house stays', async ({ page }) => {
    await freshProposal(page);
    const v0 = await activeVariant(page);
    const houseWallIds = new Set(v0.walls.map((w) => w.id));
    const houseWalls = (v: Variant) => JSON.stringify(v.walls.filter((w) => houseWallIds.has(w.id)));
    const houseOpeningIds = new Set(v0.openings.map((o) => o.id));
    const houseOpenings = (v: Variant) => JSON.stringify(v.openings.filter((o) => houseOpeningIds.has(o.id)));
    const id = await placeShed(page, [12.8, -0.9]);
    const v1 = await activeVariant(page);
    const box0 = bbox(blockPolygon(v1, id));
    expect(box0.y1, 'against the house').toBeCloseTo(0, 2);
    expect(blockPolygon(v1, 'blk-main')).toEqual(blockPolygon(v0, 'blk-main'));
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'block', id });
    const depth = page.getByTestId('block-depth').locator('input');
    await expect(depth).toHaveValue(/^1,5/);
    await depth.fill('2,0');
    await depth.press('Enter');
    await expect.poll(async () => bbox(blockPolygon(await activeVariant(page), id)).y0).toBeCloseTo(box0.y1 - 2, 2);
    const v2 = await activeVariant(page);
    expect(bbox(blockPolygon(v2, id)).y1, 'still against the house').toBeCloseTo(0, 2);
    expect(blockPolygon(v2, 'blk-main'), 'the house did not move').toEqual(blockPolygon(v0, 'blk-main'));
    expect(blockPolygon(v2, 'blk-glass')).toEqual(blockPolygon(v0, 'blk-glass'));
    expect(houseWalls(v2), "the house's walls did not move").toBe(houseWalls(v0));
    expect(houseOpenings(v2), "the house's doors and windows did not move").toBe(houseOpenings(v0));
  });

  test('(ac) w-peis-w 0.3 m west, w-peis-n 0.3 m north, «Ta tilbake» on w-peis-w: the corner closes, every room keeps its name', async ({ page }) => {
    await freshProposal(page);
    const named = async () => (await derivedRooms(page)).filter((r) => r.name).length;
    const kinds = () => page.evaluate(() => ((window as HytteWindow).__hytte?.derived?.warnings ?? []).map((w) => w.kind));
    const n0 = await named();
    expect(n0).toBe(27);
    await zoomAt(page, [7.6, 2.7], 6);
    const x = await dragWallX(page, 'w-peis-w', -0.3);
    expect(x, 'w-peis-w moved west').toBeCloseTo(6.67, 1);
    const y = await dragWallY(page, 'w-peis-n', 0.3);
    expect(y, 'w-peis-n moved north').toBeCloseTo(3.4, 1);
    expect(await named()).toBe(n0);
    await dismissToasts(page);

    const g = await derivedLine(page, 'w-peis-w/ghost');
    await selectAt(page, await clearPointOn(page, 'w-peis-w/ghost', g.a, g.b), { kind: 'ghost', id: 'w-peis-w/ghost' });
    await page.getByTestId('ghost-restore').click();
    await expect.poll(async () => (await activeVariant(page)).walls.find((w) => w.id === 'w-peis-w')?.a[0]).toBeCloseTo(6.97, 2);
    // The user's w-peis-n stays, and the restored wall reaches it: no loose wall, no merged rooms.
    const v = await activeVariant(page);
    expect(v.walls.find((w) => w.id === 'w-peis-n')?.a[1]).toBeCloseTo(y, 2);
    expect(await named(), 'every room keeps its name').toBe(n0);
    expect(await kinds()).not.toContain('wall-dangling');
    await expect(page.locator('[data-testid=toast]').filter({ hasText: 'er nå ett rom' })).toHaveCount(0);
  });

  // ---- Final morning round -----------------------------------------------------------------------------------------

  test('(ad) dv-leseskrok 0.3 m south, w-106-stue 0.3 m west, «Ta tilbake» on dv-leseskrok: w-106-stue stays straight', async ({ page }) => {
    await freshProposal(page);
    const wall = async (id: string) => (await activeVariant(page)).walls.find((w) => w.id === id);
    const named = async () => (await derivedRooms(page)).filter((r) => r.name).length;
    const kinds = () => page.evaluate(() => ((window as HytteWindow).__hytte?.derived?.warnings ?? []).map((w) => w.kind));
    const seedDivider = await wall('dv-leseskrok');
    expect(seedDivider?.a).toEqual([5, 0]);
    await zoomAt(page, [5.6, 0.6], 6);
    const y = await dragWallY(page, 'dv-leseskrok', -0.3);
    expect(y, 'dv-leseskrok moved south').toBeCloseTo(-0.3, 1);
    // It carried w-106-stue's end along (stretched to y −0,3); above y 0 the wall's ghost lies over it, so the wall is
    // grabbed on the stretched piece, zoomed in, clear of the glass bump's wall (x 5) and the divider (y −0,3).
    expect((await wall('w-106-stue'))?.a).toEqual([5.1, -0.3]);
    await zoomAt(page, [5.13, -0.15], 4);
    const grab: Vec2 = [5.13, -0.15];
    const [gx, gy] = await planToClient(page, grab);
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.getAttribute('data-wall-id') ?? null, [gx, gy])).toBe('w-106-stue');
    await selectAt(page, grab, { kind: 'wall', id: 'w-106-stue' });
    await dragPlan(page, grab, [grab[0] - 0.3, grab[1]]);
    await expect.poll(async () => (await wall('w-106-stue'))?.a[0]).toBeLessThan(5.1 - 0.05);
    await page.keyboard.press('Escape');
    const x = (await wall('w-106-stue'))!.a[0];
    // Nothing is carried any more: the case the removed fallback (proposals saved without carriedBy) took.
    expect((await activeVariant(page)).walls.filter((w) => w.carriedBy !== undefined).map((w) => w.id)).toEqual([]);
    await dismissToasts(page);

    const g = await derivedLine(page, 'dv-leseskrok/ghost');
    // a stretch of the ghost on screen at this zoom (a divider's ghost is selected as a removed wall)
    await selectAt(page, await clearPointOn(page, 'dv-leseskrok/ghost', [5.6, g.a[1]], [6.6, g.a[1]]), { kind: 'wall', id: 'dv-leseskrok/ghost' });
    await page.getByTestId('ghost-restore').click();
    await expect.poll(async () => (await wall('dv-leseskrok'))?.a[1]).toBeCloseTo(0, 6);
    expect(await wall('dv-leseskrok')).toEqual(seedDivider);
    // The user's w-106-stue keeps its x and stays straight, its south end on the restored line (before: [5,1, 0]…).
    const stue = (await wall('w-106-stue'))!;
    expect(stue.a[0], 'straight').toBeCloseTo(stue.b[0], 6);
    expect(stue.a[0], "the user's x").toBeCloseTo(x, 6);
    expect(Math.min(stue.a[1], stue.b[1]), 'its end closed on the restored divider').toBeCloseTo(0, 6);
    expect(await named(), 'every room keeps its name').toBe(27);
    expect(await kinds()).not.toContain('wall-dangling');
  });

  test('(ae) a refused «Ta tilbake» on the house edge (a shed in the way) changes nothing', async ({ page }) => {
    await freshProposal(page);
    // The toast names the shed in the way (fix round 3 after phase 3; before: «Bygget kan ikke stå oppå et annet bygg.»).
    const REFUSED = 'Ta tilbake går ikke: «Vedskjul 2» står i veien – flytt det først.';
    // The main house's south edge 0.5 m north (the Soverom side, clear of the glass bump).
    await selectAt(page, [2.5, 0], { kind: 'wall', id: /^blk-main\// });
    await dragPlan(page, [2.5, 0], [2.5, 0.5]);
    await expect.poll(async () => bbox(blockPolygon(await activeVariant(page), 'blk-main')).y0).toBeCloseTo(0.5, 2);
    // The old edge's ghost (its piece west of the glass bump: east of it the deck's edge lies on the same line).
    const ghost = ((await activeVariant(page)).ghosts ?? []).find((x) => x.id === 'blk-main/v-main-sw/ghost');
    expect(ghost?.id, 'the old south edge is a ghost').toBeTruthy();
    await page.keyboard.press('Escape');
    // A Vedskjul snapped against the moved edge …
    const shed = await placeShed(page, [12.8, -0.4]);
    expect(bbox(blockPolygon(await activeVariant(page), shed)).y1, 'against the moved edge').toBeCloseTo(0.5, 2);
    await page.keyboard.press('Escape');
    // … and another one in the old edge's way that does not touch the house: west of the glass bump, zoomed in so
    // it does not snap against the moved edge (0,25 m away).
    await zoomAt(page, [2.5, -0.5], 4);
    const other = await placeShed(page, [2.5, -0.5]);
    const otherBox = bbox(blockPolygon(await activeVariant(page), other));
    expect(otherBox.y1, 'below the moved edge').toBeLessThan(0.5 - 0.1);
    expect(otherBox.y1, 'in the old edge\'s way').toBeGreaterThan(0);
    await page.getByTestId('tool-select').click();
    await page.keyboard.press('Escape');
    await dismissToasts(page);

    const before = JSON.stringify(await activeVariant(page));
    const line = await derivedLine(page, ghost!.id);
    await selectAt(page, await clearPointOn(page, ghost!.id, line.a, line.b), { kind: 'ghost', id: ghost!.id });
    await page.getByTestId('ghost-restore').click();
    await expect(page.locator('[data-testid=toast]').filter({ hasText: REFUSED })).toHaveCount(1);
    await page.waitForTimeout(300);
    expect(JSON.stringify(await activeVariant(page)), 'nothing changed: the shed against the edge was not pushed').toBe(before);
    expect(bbox(blockPolygon(await activeVariant(page), shed)).y1).toBeCloseTo(0.5, 2);
    // No undo step either: Angre now takes back the second shed, the last real edit.
    await page.keyboard.press('Escape');
    await page.getByTestId('undo').click();
    await expect.poll(async () => (await activeVariant(page)).blocks.some((b) => b.id === other)).toBe(false);
    expect(bbox(blockPolygon(await activeVariant(page), shed)).y1, 'the first shed is where it was').toBeCloseTo(0.5, 2);
  });
});
