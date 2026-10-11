/**
 * Smoke test: the app loads, derives Forslag D, renders the plan and the 3D view, and the headline UI is there.
 * A fresh start uses the bundled seed revision; an autosave of an older revision gets "Hent ny Forslag D".
 *
 * Screenshots are written to e2e/screenshots/*.png (committed, so a diff shows what changed visually):
 *   plan.png, 3d-ute-oversikt.png, 3d-ute-framsiden.png, 3d-ute-langsiden.png, 3d-ute-inne-stua.png (Ute + the
 *   'inne-stua' camera: the roofs seen from inside the living room), 3d-inne-stua.png, plan-hems.png, phone.png
 *
 * Preconditions: Chromium installed (`npx playwright install chromium`); the dev server is started by
 * playwright.config.ts or reused. The UI exposes `window.__hytte = { ready, project, derived }` and the
 * data-testids listed in docs/architecture.md ("Test hooks the UI must provide").
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DerivedVariant } from '../src/model/derived';
import { createForslagD, SEED_REVISION } from '../src/model/seed/forslagD';
import type { Project, Vec2 } from '../src/model/types';

/** Shape of the test hook the UI keeps on window. */
interface HytteHook {
  ready: boolean;
  project: Project;
  derived: DerivedVariant;
}
type HytteWindow = Window & { __hytte?: Partial<HytteHook> };

const SCREENSHOT_DIR = fileURLToPath(new URL('./screenshots/', import.meta.url));
const READY_TIMEOUT_MS = 60_000;
/** Camera transitions take ~900 ms; give SwiftShader some slack on top. */
const SETTLE_MS = 1_500;
/** The SVG plan is synchronous, but webfonts and labels may still be settling. */
const PLAN_SETTLE_MS = 500;

test.beforeAll(() => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

/** Collects uncaught exceptions thrown by the page; a smoke test should see none. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Loads '/', waits until the UI reports ready (first 3D frame rendered) and checks the derive pipeline is real. */
async function loadAndWaitReady(page: Page): Promise<void> {
  await page.goto('/');
  try {
    await page.waitForFunction(() => (window as HytteWindow).__hytte?.ready === true, undefined, {
      timeout: READY_TIMEOUT_MS,
      polling: 250,
    });
  } catch (err) {
    throw new Error(
      `window.__hytte.ready did not become true within ${READY_TIMEOUT_MS / 1000} s. ` +
        'The UI must set window.__hytte = { ready, project, derived } and flip ready after the first 3D frame ' +
        '(View3D onReady). Is the 3D view mounted at start-up?',
      { cause: err },
    );
  }
  await page.evaluate(() => document.fonts.ready);
  await assertDeriveIsNotStub(page);
}

/**
 * A 'generic' warning comes from the derive stub, a failed derive (useDerived.ts) or a geometry fallback
 * (polygon clipping failed somewhere, derive.ts GEOMETRY_FALLBACK); the seed must produce none of them.
 */
async function assertDeriveIsNotStub(page: Page): Promise<void> {
  const generic = await page.evaluate(() =>
    ((window as HytteWindow).__hytte?.derived?.warnings ?? []).flatMap((w) => (w.kind === 'generic' ? [w.message] : [])),
  );
  expect(
    generic,
    `derived.warnings contains a 'generic' warning (${generic.join('; ')}): the derive pipeline failed, fell back ` +
      'to simplified geometry, or src/geometry/derive.ts is still the stub.',
  ).toEqual([]);
}

/** The active variant's terrace: its westmost x and the railing's step gaps (from the project on screen). */
async function activeDeck(page: Page): Promise<{ seedRevision: number; variants: string[]; active: string; deckMinX: number; gaps: [number, number][] }> {
  return page.evaluate(() => {
    const p = (window as HytteWindow).__hytte?.project;
    if (!p) throw new Error('window.__hytte.project is missing');
    const v = p.variants.find((x) => x.id === p.activeVariantId) ?? p.variants[0];
    return {
      seedRevision: p.seedRevision,
      variants: p.variants.map((x) => x.name),
      active: v.name,
      deckMinX: Math.min(...v.outdoor.decks[0].polygon.map((q) => q[0])),
      gaps: v.outdoor.railings[0].gaps.map((g): [number, number] => [g.from, g.to]),
    };
  });
}

/** Viewport screenshot into e2e/screenshots/<name>.png, also attached to the report. */
async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

/** The Romskjema fits its column: the 'Areal' header ends inside the side panel and the table does not scroll sideways. */
async function assertScheduleFits(page: Page): Promise<void> {
  const header = await page.getByTestId('schedule-area-header').boundingBox();
  const panel = await page.locator('aside.side').boundingBox();
  expect(header, "the schedule's Areal header should be rendered").not.toBeNull();
  expect(panel, 'the side panel should be rendered').not.toBeNull();
  if (!header || !panel) return;
  expect(header.x + header.width, "the schedule's Areal header should end inside the side panel").toBeLessThanOrEqual(panel.x + panel.width + 0.5);
  const overflow = await page
    .getByTestId('room-schedule')
    .locator('.table-wrap')
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, 'the schedule table should not scroll sideways').toBeLessThanOrEqual(1);
}

/** Room labels in the plan that carry an area line ("… m²"). */
async function planLabelsWithArea(page: Page): Promise<{ labels: number; withArea: number }> {
  return page.getByTestId('plan-view').evaluate((svg) => {
    const labels = [...svg.querySelectorAll('[data-room-label]')];
    return { labels: labels.length, withArea: labels.filter((l) => (l.textContent ?? '').includes('m²')).length };
  });
}

async function showPlan(page: Page, storey: 'ground' | 'loft'): Promise<void> {
  await page.getByTestId('view-tab-plan').click();
  await page.getByTestId(`plan-storey-${storey}`).click();
  await expect(page.getByTestId('plan-view')).toBeVisible();
  await page.waitForTimeout(PLAN_SETTLE_MS);
}

async function show3d(page: Page, mode: 'ute' | 'inne', preset: string): Promise<void> {
  await page.getByTestId('view-tab-3d').click();
  await expect(page.getByTestId('view-3d').locator('canvas')).toBeVisible();
  await page.getByTestId(`mode-${mode}`).click();
  await page.getByTestId(`preset-${preset}`).click();
  await page.waitForTimeout(SETTLE_MS);
}

test.describe('desktop 1400×900', () => {
  test('plan, 3D views, room schedule and area totals', async ({ page }, testInfo) => {
    const pageErrors = collectPageErrors(page);
    await loadAndWaitReady(page);

    // A fresh start uses the bundled seed: the terrace starts at the glass bump's east wall (x 9), the south steps
    // are east of the living-room door.
    expect(await activeDeck(page)).toMatchObject({
      seedRevision: SEED_REVISION,
      deckMinX: 9,
      gaps: [
        [5.2, 6.6],
        [23.5, 24.9],
        [29.8, 31.2],
      ],
    });

    // Headline UI: the new wing's rooms are in the schedule and the area panel shows BYA.
    const schedule = page.getByTestId('room-schedule');
    await expect(schedule, 'room schedule should list Hovedbad').toContainText('Hovedbad');
    await expect(schedule, 'room schedule should list Badstue').toContainText('Badstue');
    await expect(page.getByTestId('area-totals'), 'area totals should show BYA').toContainText('BYA');
    await assertScheduleFits(page);
    await expect(page.getByTestId('headline'), 'the headline splits the buildings from the deck').toContainText('bygg');
    await expect(page.getByTestId('headline')).toContainText('terrasse');

    await showPlan(page, 'ground');
    const { labels, withArea } = await planLabelsWithArea(page);
    expect(withArea, `plan room labels with an m² line (of ${labels} labels)`).toBeGreaterThanOrEqual(15);
    await shoot(page, testInfo, 'plan');

    await show3d(page, 'ute', 'oversikt');
    await expect(page.getByTestId('preset-langsiden'), 'the Langsiden preset should be offered').toBeVisible();
    await shoot(page, testInfo, '3d-ute-oversikt');

    await page.getByTestId('preset-framsiden').click();
    await page.waitForTimeout(SETTLE_MS);
    await shoot(page, testInfo, '3d-ute-framsiden');

    await page.getByTestId('preset-langsiden').click();
    await page.waitForTimeout(SETTLE_MS);
    await shoot(page, testInfo, '3d-ute-langsiden');

    // Roofs on, camera inside the stue: no turf slab may hang into the room (review fix in roof.ts).
    await page.getByTestId('preset-inne-stua').click();
    await page.waitForTimeout(SETTLE_MS);
    await shoot(page, testInfo, '3d-ute-inne-stua');

    await show3d(page, 'inne', 'inne-stua');
    await shoot(page, testInfo, '3d-inne-stua');

    await showPlan(page, 'loft');
    await shoot(page, testInfo, 'plan-hems');

    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('an autosave of an older Forslag D revision is offered "Hent ny Forslag D"', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    // The autosave of a user who started before the terrace cut: older revision, deck in front of the glass bump.
    const old = createForslagD();
    old.seedRevision = SEED_REVISION - 1;
    const oldDeck: Vec2[] = [[5, -4.6], [23.2, -4.6], [23.2, 12.1], [9, 12.1], [9, 6.2], [20.8, 6.2], [20.8, -2], [16, -2], [16, 0], [9, 0], [9, -2], [5, -2]];
    old.variants[0].outdoor.decks[0].polygon = oldDeck;
    await page.addInitScript((json) => {
      if (!localStorage.getItem('hytte-planlegger:project')) localStorage.setItem('hytte-planlegger:project', json);
    }, JSON.stringify(old));
    await loadAndWaitReady(page);
    expect(await activeDeck(page)).toMatchObject({ seedRevision: SEED_REVISION - 1, deckMinX: 5 });

    const fetchSeed = page.getByRole('button', { name: 'Hent ny Forslag D' });
    await expect(page.getByText(`Forslag D er oppdatert (revisjon ${SEED_REVISION}).`)).toBeVisible();
    await fetchSeed.click();
    await expect(fetchSeed, 'the banner goes away').toHaveCount(0);
    await expect.poll(async () => (await activeDeck(page)).seedRevision).toBe(SEED_REVISION);
    // The new seed is added as a variant next to the user's own (kept unchanged) and becomes the active one.
    expect(await activeDeck(page)).toMatchObject({
      variants: ['Forslag D', `Forslag D (revisjon ${SEED_REVISION})`],
      active: `Forslag D (revisjon ${SEED_REVISION})`,
      deckMinX: 9,
    });
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});

test.describe('phone 375×812', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('loads and renders in a phone viewport', async ({ page }, testInfo) => {
    const pageErrors = collectPageErrors(page);
    await loadAndWaitReady(page);
    await page.waitForTimeout(SETTLE_MS);
    // Del lenke and Hjelp stay on screen on a phone.
    for (const id of ['open-share', 'open-help']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, `${id} should be rendered`).not.toBeNull();
      if (box) expect(box.x + box.width, `${id} should be inside the 375 px viewport`).toBeLessThanOrEqual(375);
    }
    await assertScheduleFits(page);
    await shoot(page, testInfo, 'phone');
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});
