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
  selectAt,
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
 * and edge ghost of Plan 1, so a click there selects `id` and nothing drawn beside it.
 */
async function clearPointOn(page: Page, id: string, a: Vec2, b: Vec2): Promise<Vec2> {
  return page.evaluate(
    ({ id, a, b }) => {
      type P = [number, number];
      const d = (window as HytteWindow).__hytte?.derived;
      if (!d) throw new Error('derived missing');
      const segs: [P, P][] = [];
      for (const w of d.walls) {
        if (!w.storeyIds.includes('ground')) continue;
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
    { id, a, b },
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

/** Select the glass bump (Leseskrok) itself: tap its room, then "Velg bygningsdelen". */
async function selectGlassBump(page: Page): Promise<void> {
  await selectAt(page, [7, -1.3], { kind: 'room', id: 'room-leseskrok' });
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
    await clickPlan(page, [18.95, 3.4]);
    await expect(page.getByTestId('hint-line')).toContainText('Trykk der den skal slutte');
    await clickPlan(page, [18.95, 6.2]);
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

    // Name the other piece in Egenskaper ("Gi navn").
    await selectAt(page, [19.9, 4.8], { kind: 'room', id: unnamed[0].id });
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
    await selectAt(page, [19.6, 5.2], { kind: 'room', id: 'room-sov-ny' });
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
    await selectAt(page, [19.6, 5.2], { kind: 'room', id: 'room-sov-ny' });
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
    await page.getByTestId('variant-select').selectOption('forslag-d');
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
