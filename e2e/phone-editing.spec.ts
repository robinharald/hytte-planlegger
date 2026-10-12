/**
 * Editing on a phone (docs/phase2-plan.md §1 rule 4, §3.1; the 'iphone' project in playwright.config.ts: iPhone 13
 * viewport and touch, on Chromium). Dad plays with ideas on his iPhone:
 *  - open the app and make "Nytt forslag";
 *  - a one-finger drag across the plan pans it and moves nothing; two fingers zoom;
 *  - tap a new wall (w-gang-n) and drag it with one finger: it moves;
 *  - the mini-bar's Egenskaper opens the properties bottom sheet; type a number (the wall's Tykkelse);
 *  - Dør/vindu → Dør, tap on a wall: a door is placed and the tool goes back to Velg (the door selected).
 * Screenshots: phone-edit.png (the dragged wall selected, handles and the mini-bar), phone-sheet.png (the sheet).
 */
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import type { Vec2 } from '../src/model/types';
import {
  activeVariant,
  assertNoGenericWarnings,
  collectPageErrors,
  type HytteWindow,
  loadAndWaitReady,
  planScale,
  planToClient,
  projectOnScreen,
  selection,
  shoot,
  skipFirstRun,
  tapPlan,
  touchDrag,
  touchDragPlan,
  touchSession,
} from './helpers';

async function rootTransform(page: Page): Promise<string | null> {
  return page.locator('[data-testid=plan-view] [data-plan-root]').getAttribute('transform');
}

/** Two-finger pinch around a client point: the fingers move from ±d0 to ±d1 px apart horizontally. */
async function pinch(cdp: CDPSession, at: Vec2, d0: number, d1: number, steps = 10): Promise<void> {
  const pts = (d: number) => [
    { x: at[0] - d, y: at[1], id: 1 },
    { x: at[0] + d, y: at[1], id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + ((d1 - d0) * i) / steps) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test.describe('editing on an iPhone', () => {
  test('pan, drag a wall, change a number in the sheet, tap-place a door', async ({ page }, testInfo) => {
    const pageErrors = collectPageErrors(page);
    await skipFirstRun(page);
    await loadAndWaitReady(page);
    const cdp = await touchSession(page);

    // "+ Nytt forslag" (the name prompt is accepted as it is).
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('new-proposal').tap();
    await expect.poll(async () => (await projectOnScreen(page)).variants.length).toBe(2);
    await expect(page.getByTestId('plan-view')).toHaveAttribute('data-plan-editable', 'true');
    const plan = page.getByTestId('plan-view');
    await plan.scrollIntoViewIfNeeded();

    // One finger on empty paper pans the plan and changes nothing.
    const before = JSON.stringify(await activeVariant(page));
    const t0 = await rootTransform(page);
    const box = await plan.boundingBox();
    if (!box) throw new Error('plan not on screen');
    const empty = await planToClient(page, [3, -4]);
    await touchDrag(cdp, empty, [empty[0] + 60, empty[1] - 30]);
    await expect.poll(() => rootTransform(page)).not.toBe(t0);
    expect(JSON.stringify(await activeVariant(page)), 'a pan moves nothing').toBe(before);
    expect(await selection(page)).toBeNull();

    // Two fingers zoom in around the new wing.
    const s0 = await planScale(page);
    await pinch(cdp, await planToClient(page, [17.8, 3.4]), 30, 90);
    await expect.poll(() => planScale(page)).toBeGreaterThan(s0 * 1.8);
    expect(JSON.stringify(await activeVariant(page)), 'a pinch moves nothing').toBe(before);

    // Tap the new wall between Gang and Soverom (ny fløy), then drag it 1.6 m north with one finger (to y 5.0: clear of
    // the 24 px touch snap radius around other walls' lines: a short drag snaps back onto y 3.4, where the divider dv-pass-n
    // continues the wall's line).
    const wallAt = await planToClient(page, [18.4, 3.4]);
    const planBox = await plan.boundingBox();
    expect(planBox && wallAt[0] > planBox.x + 10 && wallAt[0] < planBox.x + planBox.width - 10, 'the wall is on screen').toBe(true);
    await tapPlan(page, [18.4, 3.4]);
    await expect.poll(() => selection(page)).toMatchObject({ kind: 'wall', id: 'w-gang-n' });
    await touchDragPlan(page, cdp, [18.4, 3.4], [18.4, 5.0], 16);
    await expect.poll(async () => (await activeVariant(page)).walls.find((w) => w.id === 'w-gang-n')?.a[1]).toBeCloseTo(5.0, 1);
    expect(await selection(page)).toMatchObject({ kind: 'wall', id: 'w-gang-n' });
    await expect(page.getByTestId('mini-bar')).toBeVisible();
    await page.waitForTimeout(300);
    await shoot(page, testInfo, 'phone-edit');

    // Egenskaper as a bottom sheet: type the wall's thickness.
    await page.getByTestId('mini-properties').tap();
    const sheet = page.getByTestId('properties-sheet');
    await expect(sheet).toBeVisible();
    const thickness = sheet.getByTestId('wall-thickness').locator('input');
    await thickness.tap();
    await thickness.fill('0,15');
    await thickness.press('Enter');
    await expect.poll(async () => (await activeVariant(page)).walls.find((w) => w.id === 'w-gang-n')?.thickness).toBeCloseTo(0.15, 3);
    await shoot(page, testInfo, 'phone-sheet');
    await sheet.getByRole('button', { name: 'Lukk' }).tap();
    await expect(sheet).toHaveCount(0);

    // Dør/vindu → Dør, tap on the wall between the stue and the pantry (w-wing-w, south of the passage): a door is placed
    // and the tool returns to Velg.
    const openings0 = (await activeVariant(page)).openings.length;
    await page.getByTestId('tool-opening').tap();
    await page.getByTestId('opening-type-door').tap();
    await expect(plan).toHaveAttribute('data-plan-tool', 'opening');
    await tapPlan(page, [16, 1.0]);
    await expect.poll(async () => (await activeVariant(page)).openings.length).toBe(openings0 + 1);
    const door = (await activeVariant(page)).openings.at(-1);
    expect(door).toMatchObject({ type: 'door', status: 'new', host: { kind: 'wall', wallId: 'w-wing-w' } });
    await expect(plan).toHaveAttribute('data-plan-tool', 'select');
    expect(await selection(page)).toMatchObject({ kind: 'opening', id: door?.id });

    await assertNoGenericWarnings(page);
    const notes = await page.evaluate(() => (window as HytteWindow).__hytte?.derived?.warnings.map((w) => w.kind) ?? []);
    expect(notes.filter((k) => k === 'generic')).toEqual([]);
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});
