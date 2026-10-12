/**
 * Proposals ("Forslag") in local mode (docs/phase2-plan.md §5; Playwright never uses the real shared space): the
 * proposals menu, autosave across a reload, rename, delete with two confirmations, the Papirkurv, the status pill,
 * "Send forslaget", an old #d= link imported as a new proposal, and an old whole-project autosave turned into
 * proposals (Forslag D itself is always the bundled one).
 *
 * Screenshots: proposals-menu.png (the open menu), share-dialog.png (local "Send forslaget").
 */
import { expect, test, type Page } from '@playwright/test';
import LZString from 'lz-string';
import { createForslagD, SEED_REVISION } from '../src/model/seed/forslagD';
import { CURRENT_SCHEMA_VERSION } from '../src/model/types';
import type { DeckVertex, Project, Vec2 } from '../src/model/types';
import {
  activeVariant,
  collectPageErrors,
  createNewProposal,
  dragPlan,
  type HytteWindow,
  loadAndWaitReady,
  projectOnScreen,
  READY_TIMEOUT_MS,
  selectAt,
  shoot,
  skipFirstRun,
} from './helpers';

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as HytteWindow).__hytte?.ready === true, undefined, { timeout: READY_TIMEOUT_MS, polling: 250 });
}

async function reloadReady(page: Page): Promise<void> {
  await page.reload();
  await waitReady(page);
}

/** A phase-1 style full share link payload (persistence.ts decodes it; importing persistence here would pull in JSON modules). */
function shareParam(project: Project): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify({ v: CURRENT_SCHEMA_VERSION, project }));
}

const names = async (page: Page) => (await projectOnScreen(page)).variants.map((v) => v.name);

test.describe('proposals (local mode)', () => {
  test.beforeEach(async ({ page }) => skipFirstRun(page));

  test('create, edit, reload, rename, delete with two confirmations, restore from the Papirkurv', async ({ page }, testInfo) => {
    const pageErrors = collectPageErrors(page);
    await loadAndWaitReady(page);
    const pill = page.getByTestId('status-pill');
    await expect(pill).toHaveAttribute('data-state', 'local');
    await expect(pill).toHaveAttribute('aria-label', 'Kun på denne enheten (ingen delt plass satt opp)');

    // Create ("+ Nytt forslag" accepts the default name "Mitt forslag") and edit: the hot tub 2 m west.
    await createNewProposal(page);
    const id = (await activeVariant(page)).id;
    const tub0 = (await activeVariant(page)).outdoor.hotTubs[0].centre;
    await selectAt(page, [21.7, -3.2], { kind: 'hotTub', id: 'tub-1' });
    await dragPlan(page, [21.7, -3.2], [19.7, -3.2]);
    await expect.poll(async () => (await activeVariant(page)).outdoor.hotTubs[0].centre[0]).toBeLessThan(tub0[0] - 1.5);
    const tub1 = (await activeVariant(page)).outdoor.hotTubs[0].centre;

    // Saved on this device: a reload shows the same proposal, with the moved hot tub.
    await page.waitForTimeout(1200);
    await reloadReady(page);
    expect((await activeVariant(page)).id).toBe(id);
    expect((await activeVariant(page)).outdoor.hotTubs[0].centre).toEqual(tub1);

    // The menu: Forslag D first (Grunnlag), then the proposal with "sist endret …"; choosing switches.
    await page.getByTestId('proposals-menu').click();
    const items = page.getByTestId('proposals-list').locator('.proposal-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Forslag D');
    await expect(items.nth(0)).toContainText('Grunnlag');
    await expect(page.getByTestId(`proposal-item-${id}`)).toContainText(/Mitt forslag\s*sist endret i dag \d\d\.\d\d/);
    await shoot(page, testInfo, 'proposals-menu');
    await page.getByTestId('proposal-item-forslag-d').click();
    await expect.poll(async () => (await activeVariant(page)).id).toBe('forslag-d');
    await page.getByTestId('proposals-menu').click();
    await page.getByTestId(`proposal-item-${id}`).click();
    await expect.poll(async () => (await activeVariant(page)).id).toBe(id);

    // Rename.
    page.once('dialog', (d) => void d.accept('Hyttedrøm'));
    await page.getByTestId('rename-proposal').click();
    await expect(page.getByTestId('proposals-menu')).toContainText('Hyttedrøm');

    // Delete: asked twice; the second step says what happens.
    await page.getByTestId('delete-proposal').click();
    await expect(page.getByTestId('delete-step-1')).toHaveText('Vil du slette «Hyttedrøm»?');
    await page.getByTestId('delete-next').click();
    await expect(page.getByTestId('delete-step-2')).toContainText('Er du sikker? Forslaget forsvinner fra listen.');
    await expect(page.getByTestId('delete-step-2')).toContainText('Papirkurv i 30 dager');
    await page.getByTestId('delete-confirm').click();
    await expect.poll(() => names(page)).toEqual(['Forslag D']);
    await expect(page.getByTestId('toast').first()).toContainText('«Hyttedrøm» er lagt i Papirkurv.');

    // Gone after a reload too — but in the Papirkurv.
    await page.waitForTimeout(1200);
    await reloadReady(page);
    expect(await names(page)).toEqual(['Forslag D']);
    await page.getByTestId('more-menu').locator('summary').click();
    await page.getByTestId('more-trash').click();
    const row = page.getByTestId(`trash-item-${id}`);
    await expect(row).toContainText('Hyttedrøm');
    await expect(row).toContainText(/Slettet i dag \d\d\.\d\d · forsvinner om 30 dager/);
    await page.getByTestId(`trash-restore-${id}`).click();
    await expect(page.getByTestId('trash-panel')).toHaveCount(0);
    await expect.poll(() => names(page)).toEqual(['Forslag D', 'Hyttedrøm']);
    expect((await activeVariant(page)).id).toBe(id);
    expect((await activeVariant(page)).outdoor.hotTubs[0].centre).toEqual(tub1);
    await page.waitForTimeout(1200);
    await reloadReady(page);
    expect(await names(page)).toEqual(['Forslag D', 'Hyttedrøm']);

    // Send forslaget (local): a link with a copy of the proposal.
    await page.getByTestId('open-share').click();
    await expect(page.getByTestId('share-local-link')).toHaveValue(/#d=/);
    await shoot(page, testInfo, 'share-dialog');
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('an old #d= link opens as a new proposal; the same link again adds nothing', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    const shared = createForslagD();
    const v = shared.variants[0];
    delete v.locked;
    v.name = 'Pappas forslag';
    v.notes = 'fra lenken';
    const hash = `#d=${shareParam(shared)}`;
    await page.goto(`/${hash}`);
    await waitReady(page);
    await expect.poll(() => names(page)).toEqual(['Forslag D', 'Pappas forslag']);
    const active = await activeVariant(page);
    expect(active).toMatchObject({ name: 'Pappas forslag', notes: 'fra lenken' });
    expect(active.locked).toBeUndefined();
    await expect(page.getByTestId('toast').first()).toContainText('«Pappas forslag» fra lenken er lagt til som et nytt forslag.');
    // The address bar no longer carries the link.
    expect(new URL(page.url()).hash).toBe('');
    await page.waitForTimeout(1200);
    await page.goto(`/${hash}`);
    await waitReady(page);
    expect(await names(page)).toEqual(['Forslag D', 'Pappas forslag']);
    expect(pageErrors).toEqual([]);
  });

  test('an autosave from before the shared proposals becomes proposals; Forslag D is the current bundled one', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    // A phase-2a autosave of an older seed revision whose (unlocked) working copy still has the old terrace from x 5.
    const old = createForslagD();
    old.seedRevision = SEED_REVISION - 1;
    delete old.variants[0].locked;
    const oldPoints: Vec2[] = [[5, -4.6], [23.2, -4.6], [23.2, 12.1], [9, 12.1], [9, 6.2], [20.8, 6.2], [20.8, -2], [16, -2], [16, 0], [9, 0], [9, -2], [5, -2]];
    old.variants[0].outdoor.decks[0].polygon = oldPoints.map((p, i): DeckVertex => ({ id: `deck-terrasse-v${i}`, p }));
    await page.addInitScript((json) => {
      if (!localStorage.getItem('hytte-planlegger:project.before-2b')) localStorage.setItem('hytte-planlegger:project', json);
    }, JSON.stringify(old));
    await loadAndWaitReady(page);
    const p = await projectOnScreen(page);
    expect(p.variants.map((v) => [v.name, v.locked === true])).toEqual([
      ['Forslag D', true],
      ['Forslag D (eget)', false],
    ]);
    expect(p.seedRevision).toBe(SEED_REVISION);
    const deckMinX = (i: number) => Math.min(...p.variants[i].outdoor.decks[0].polygon.map((q) => q.p[0]));
    expect(deckMinX(0)).toBe(9);
    expect(deckMinX(1)).toBe(5);
    // The old key is retired (kept as a backup), so a reload does not import it twice.
    expect(await page.evaluate(() => [localStorage.getItem('hytte-planlegger:project'), localStorage.getItem('hytte-planlegger:project.before-2b') !== null])).toEqual([null, true]);
    await page.waitForTimeout(1200);
    await reloadReady(page);
    expect(await names(page)).toEqual(['Forslag D', 'Forslag D (eget)']);
    await expect(page.getByText('Forslag D er oppdatert')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});
