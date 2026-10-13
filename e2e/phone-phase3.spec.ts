/**
 * Phase 3 on an iPhone 13 (the 'iphone' project: 390×844, touch):
 *  - «Gå rundt» from the button on the 3D view: the joystick (bottom left) held forward for 0,7 s walks the walker on
 *    at eye height; a drag on the right of the view turns the view; «Avslutt» ends the walk; screenshot phone-walk.png;
 *  - «Eksporter» is on screen in the top bar: «Eksporter plan som PDF …» opens the dialog with «Lag PDF» reachable
 *    without scrolling the page, and «Lagre 3D-bildet som PNG» is there (on a phone it hands the picture to the share
 *    sheet, which Playwright cannot show; the desktop test downloads it).
 * Final morning round:
 *  - «Avløp og sluk» on touch, like furniture («Trykk for å velge, dra det valgte for å flytte»): a one-finger drag that
 *    starts on the suggested stack pans the plan and saves nothing; a tap picks it (the hint line explains it), and a
 *    drag of the picked stack moves it along the wall and saves it;
 *  - the walk's camera button («Lagre bildet») is under «Avslutt».
 * The first-time flow with the shed against the wing and the bedroom pinched to the middle is in phone-editing.spec.ts.
 */
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import type { Vec2 } from '../src/model/types';
import {
  activeVariant,
  collectPageErrors,
  dismissToasts,
  type HytteWindow,
  loadAndWaitReady,
  planTransform,
  projectOnScreen,
  SETTLE_MS,
  shoot,
  skipFirstRun,
  touchDrag,
  touchSession,
} from './helpers';

async function walkProbe(page: Page) {
  return page.evaluate(() => (window as HytteWindow).__hytte?.walk ?? null);
}

/** A finger held on `at`, moved by `by` (px) and held there for `ms`, then lifted. */
async function holdTouch(cdp: CDPSession, page: Page, at: Vec2, by: Vec2, ms: number): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at[0], y: at[1], id: 1 }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at[0] + (by[0] * i) / 6, y: at[1] + (by[1] * i) / 6, id: 1 }] });
  }
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await page.waitForTimeout(100);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at[0] + by[0], y: at[1] + by[1] + (Date.now() % 2), id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test.describe('phase 3 on an iPhone', () => {
  let pageErrors: string[] = [];
  test.beforeEach(async ({ page }) => {
    pageErrors = collectPageErrors(page);
    await skipFirstRun(page);
  });
  test.afterEach(() => {
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('«Gå rundt» with the joystick: forward at eye height, a drag turns, «Avslutt» ends it', async ({ page }, testInfo) => {
    await loadAndWaitReady(page);
    await page.getByTestId('view-tab-3d').tap();
    const view = page.getByTestId('view-3d');
    await expect(view.locator('canvas')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(SETTLE_MS);
    await page.getByTestId('walk-start-3d').tap();
    await expect.poll(async () => (await walkProbe(page)) !== null).toBe(true);
    const joystick = page.getByTestId('walk-joystick');
    await expect(joystick).toBeVisible();
    await expect(page.getByTestId('walk-exit')).toBeVisible();
    await expect.poll(async () => {
      const w = await walkProbe(page);
      return w ? Math.round((w.eyeZ - w.feetZ) * 100) / 100 : null;
    }).toBeCloseTo(1.65, 1);
    const start = (await walkProbe(page))!;

    // The joystick is inside the screen and the 3D view, once the smooth scroll that brings the 3D view forward
    // (WalkControls) has settled: two equal reads in a row (expect.poll waits 100 ms or more between them).
    let prev = '';
    await expect
      .poll(async () => {
        const now = JSON.stringify([await joystick.boundingBox(), await view.boundingBox()]);
        const stable = now === prev;
        prev = now;
        return stable;
      })
      .toBe(true);
    // The camera button sits under «Avslutt», inside the view: both read in one frame, after the scroll (fix round 3
    // after phase 3: read one after the other while the page still scrolled, they failed 6 runs in 9).
    const [exitBox, photoBox] = await page.evaluate(() =>
      ['walk-exit', 'walk-photo'].map((id) => {
        const r = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        return { y: r.top, height: r.height };
      }),
    );
    expect(photoBox.y, 'under «Avslutt»').toBeGreaterThanOrEqual(exitBox.y + exitBox.height);
    expect(photoBox.height).toBeGreaterThanOrEqual(44);
    const jb = (await joystick.boundingBox())!;
    const vb = (await view.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(jb.x).toBeGreaterThanOrEqual(0);
    expect(jb.y + jb.height).toBeLessThanOrEqual(Math.min(vp.height, vb.y + vb.height) + 1);
    const cdp = await touchSession(page);
    const centre: Vec2 = [jb.x + jb.width / 2, jb.y + jb.height / 2];
    await holdTouch(cdp, page, centre, [0, -40], 700);
    await expect.poll(async () => {
      const w = await walkProbe(page);
      return w ? Math.hypot(w.x - start.x, w.y - start.y) : 0;
    }).toBeGreaterThan(0.1);
    const walked = (await walkProbe(page))!;
    expect(walked.eyeZ - walked.feetZ, 'eye height').toBeGreaterThan(1.5);
    expect(walked.eyeZ - walked.feetZ, 'eye height').toBeLessThan(1.7);
    // Released: the walker stops.
    await page.waitForTimeout(300);
    const stopped = (await walkProbe(page))!;
    await page.waitForTimeout(400);
    const still = (await walkProbe(page))!;
    expect(Math.hypot(still.x - stopped.x, still.y - stopped.y)).toBeLessThan(0.02);

    // A drag on the right of the view turns the view (heading), it does not walk.
    const look: Vec2 = [vb.x + vb.width * 0.75, vb.y + vb.height * 0.5];
    await holdTouch(cdp, page, look, [-60, 0], 150);
    await expect.poll(async () => Math.abs(((await walkProbe(page))?.heading ?? still.heading) - still.heading)).toBeGreaterThan(0.1);
    await page.waitForTimeout(SETTLE_MS);
    await shoot(page, testInfo, 'phone-walk');

    await page.getByTestId('walk-exit').tap();
    await expect.poll(() => walkProbe(page)).toBeNull();
    await expect(joystick).toHaveCount(0);
  });

  test('«Eksporter» is on screen: the PDF dialog with «Lag PDF» in reach, and the PNG entry', async ({ page }) => {
    await loadAndWaitReady(page);
    const menu = page.getByTestId('export-menu');
    const vp = page.viewportSize()!;
    const mb = (await menu.locator('summary').boundingBox())!;
    expect(mb.x).toBeGreaterThanOrEqual(0);
    expect(mb.x + mb.width).toBeLessThanOrEqual(vp.width);
    await menu.locator('summary').tap();
    const pdf = page.getByTestId('export-menu-pdf');
    const png = page.getByTestId('export-menu-png');
    await expect(pdf).toBeVisible();
    await expect(png).toBeVisible();
    for (const item of [pdf, png]) {
      const b = (await item.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      expect(b.height).toBeGreaterThanOrEqual(32);
    }
    await pdf.tap();
    const dialog = page.getByTestId('export-dialog');
    await expect(dialog).toBeVisible();
    const make = page.getByTestId('export-make');
    await make.scrollIntoViewIfNeeded();
    const kb = (await make.boundingBox())!;
    expect(kb.y + kb.height).toBeLessThanOrEqual(vp.height);
    expect(kb.x + kb.width).toBeLessThanOrEqual(vp.width);
    await expect(page.getByTestId('export-summary')).toContainText('Blir');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('«Avløp og sluk» on touch: a drag on the unpicked stack pans; a tap picks it, then a drag moves it', async ({ page }) => {
    await loadAndWaitReady(page);
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('new-proposal').tap();
    await expect.poll(async () => (await projectOnScreen(page)).variants.length).toBe(2);
    await expect(page.getByTestId('plan-view')).toHaveAttribute('data-plan-editable', 'true');
    await dismissToasts(page);
    const toggle = page.getByTestId('toggle-plumbing');
    // On the phone Vis starts folded.
    if (!(await toggle.isVisible())) {
      const vis = page.locator('details.panel > summary').filter({ hasText: /^\s*Vis\s*$/ });
      await vis.scrollIntoViewIfNeeded();
      await vis.tap();
    }
    await toggle.scrollIntoViewIfNeeded();
    await toggle.tap();
    await expect(toggle).toBeChecked();
    await page.getByTestId('plan-view').scrollIntoViewIfNeeded();
    const hit = page.locator('[data-testid=plan-view] [data-drain-hit]').first();
    await expect(hit).toHaveCount(1);
    const stackId = await hit.getAttribute('data-drain-hit');
    const centre = async (): Promise<Vec2> => {
      const b = (await hit.boundingBox())!;
      return [b.x + b.width / 2, b.y + b.height / 2];
    };
    const plumbing = async () => (await activeVariant(page)).plumbing ?? null;
    expect(await plumbing()).toBeNull();
    const cdp = await touchSession(page);

    // 1. A one-finger drag that starts on the stack (not picked): the plan pans, the stack is not moved or saved.
    const t0 = await planTransform(page);
    const c0 = await centre();
    await touchDrag(cdp, c0, [c0[0] - 70, c0[1] + 50], 14);
    await expect.poll(() => planTransform(page)).not.toBe(t0);
    expect(await plumbing(), 'nothing saved by a pan').toBeNull();
    const c1 = await centre();
    expect(Math.hypot(c1[0] - c0[0] + 70, c1[1] - c0[1] - 50), 'the stack went along with the plan').toBeLessThan(6);

    // 2. A tap picks it: the hint line says what a suggested stack is.
    await page.touchscreen.tap(c1[0], c1[1]);
    await expect(page.getByTestId('hint-line')).toContainText('Stammen er et forslag');
    expect(await plumbing(), 'a tap saves nothing').toBeNull();

    // 3. A drag of the picked stack moves it along the wall and saves it (the plan does not pan).
    const t1 = await planTransform(page);
    const c2 = await centre();
    await touchDrag(cdp, c2, [c2[0] + 40, c2[1]], 14);
    await expect.poll(async () => (await plumbing())?.stacks.length ?? 0).toBeGreaterThan(0);
    expect(await planTransform(page), 'the plan stayed put').toBe(t1);
    const saved = (await plumbing())!.stacks;
    expect(saved.some((x) => x.id === stackId || x.storeyId === 'ground'), JSON.stringify(saved)).toBe(true);
    const c3 = await centre();
    expect(Math.hypot(c3[0] - c2[0], c3[1] - c2[1]), 'the stack moved on screen').toBeGreaterThan(10);
  });
});
