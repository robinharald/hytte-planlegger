/**
 * Phase 2a editing on a desktop (docs/phase2-plan.md §3, §7 "Done when"). Every test but the Forslag D one starts from
 * a fresh "Nytt forslag" copy of the locked base proposal and drives the plan with the mouse like a family member:
 *
 *  (a) select the new wing's east exterior wall and drag it 1 m east: the wing follows, room areas change;
 *  (b) Nytt bygg → a Vedskjul on the terrace by the north railing: the deck pieces exclude it and the railing gets a
 *      gap; move it 1 m; attach it to the wing's north wall (a junction);
 *  (c) Vegg: a partition across Soverom (ny fløy): one room keeps its name, the other is unnamed until named;
 *  (d) Soverom (ny fløy) Dybde 2,40 in Egenskaper: w-gang-n moves;
 *  (e) + (f) ghosts: the EXISTING door-mellom-vf moved 0.5 m turns new and leaves a dashed ghost; deleting the
 *      existing wall w-104-103 merges two rooms and leaves a ghost; Angre and "Ta tilbake" restore both;
 *  (g) on Forslag D itself every edit is refused with the toast;
 *  (h) the hot tub moves.
 * No state may produce a 'generic' warning (a failed derive or a geometry fallback).
 *
 * Screenshots (e2e/screenshots/): plan-editing.png (the deck selected: vertex and "+" handles), plan-unit-on-deck.png,
 * plan-ghosts.png (a moved door's and a deleted wall's ghosts, zoomed in).
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
  dragPlan,
  type HytteWindow,
  loadAndWaitReady,
  planToClient,
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
    await expect(page.getByTestId('hint-line')).toContainText('Klikk der veggen skal begynne');
    await clickPlan(page, [18.95, 3.4]);
    await expect(page.getByTestId('hint-line')).toContainText('Klikk der den skal slutte');
    await clickPlan(page, [18.95, 6.2]);
    await expect.poll(async () => (await activeVariant(page)).walls.length).toBe(wallCount + 1);
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

    // An editing tool (greyed with aria-disabled, but still clickable: the click explains why).
    await page.getByTestId('tool-wall').click({ force: true });
    await expect(page.getByTestId('toast').filter({ hasText: LOCKED_TEXT })).toHaveCount(1);
    await expect(page.getByTestId('plan-view')).toHaveAttribute('data-plan-tool', 'select');
    // A drag of a selected wall pans instead.
    await selectAt(page, [20.8, 4.8], { kind: 'wall' });
    await dragPlan(page, [20.8, 4.8], [21.8, 4.8]);
    // Delete on a selected stored wall.
    await selectAt(page, [19.5, 3.4], { kind: 'wall', id: 'w-gang-n' });
    await page.keyboard.press('Delete');
    // A number field in Egenskaper.
    await selectAt(page, [19.6, 5.2], { kind: 'room', id: 'room-sov-ny' });
    const field = page.getByTestId('room-size-d').locator('input');
    await field.click();
    await page.keyboard.type('3');
    await field.press('Enter');
    // Arrow nudge.
    await selectAt(page, [19.5, 3.4], { kind: 'wall', id: 'w-gang-n' });
    await page.keyboard.press('ArrowUp');

    await expect(page.getByTestId('toast').filter({ hasText: LOCKED_TEXT })).toHaveCount(1);
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
});
