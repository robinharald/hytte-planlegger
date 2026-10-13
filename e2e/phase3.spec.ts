/**
 * Phase 3 on a desktop (1400×900): the exports, the walk, the drainage helper and the IFC overlay.
 *
 *  - «Eksporter» → «Eksporter plan som PDF …»: A3, 1:50, both storeys; the dialog says how many pages, «Lag PDF»
 *    downloads «hytta-<forslag>-<dato>.pdf» with that many pages on A3 (`window.__hytte.lastExport`, and the file's
 *    own page objects and MediaBox); screenshot export-dialog.png;
 *  - «Lagre 3D-bildet som PNG» downloads «hytta-3d-<dato>.png» (`lastExport`: a PNG of the 3D view's size);
 *  - «Gå rundt»: W held for 500 ms moves the walker and the eye stays at eye height (1,65 m over the floor; the walk
 *    probe `window.__hytte.walk`); Esc ends the walk; screenshot 3d-walk.png;
 *  - Vis → «Avløp og sluk»: the suggested stack in the plan and «WC og Hovedbad: toalettene står rygg mot rygg på
 *    veggen ved x 18,6 – det er fint.»; the WC's toilet moved into Soverom 1 → a 'drain-far' line under Advarsler;
 *    screenshot plan-avlop.png;
 *  - «IFC-modell» → «Last inn IFC-fil» with the small synthetic file e2e/fixtures/test-cabin.ifc (src/ifc/testIfc.ts:
 *    the main house's four walls, a window, a door, a floor and a roof slab — not the architect's model): blue outlines
 *    in the plan (`[data-layer=ifc]`) and the overlay in 3D (the canvas's `data-ifc-meshes`); screenshot ifc-overlay.png
 *    with the synthetic fixture (the architect's file is only used locally through the HYTTE_IFC environment variable, never
 *    copied into the repository), else with the synthetic one.
 *
 * The editor-core fixes of this round (a unit against the house resized, the corner «Ta tilbake») are in
 * editing.spec.ts (ab)–(ac); the proposal link's «Bytt dit» in proposals.spec.ts; the phone side in
 * phone-phase3.spec.ts.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Vec2 } from '../src/model/types';
import {
  activeVariant,
  assertNoGenericWarnings,
  collectPageErrors,
  createNewProposal,
  derivedFurniture,
  dismissToasts,
  dragPlan,
  type HytteWindow,
  loadAndWaitReady,
  planToClient,
  selectAt,
  SETTLE_MS,
  shoot,
  skipFirstRun,
} from './helpers';

const FIXTURE_IFC = fileURLToPath(new URL('./fixtures/test-cabin.ifc', import.meta.url));

async function lastExport(page: Page) {
  return page.evaluate(() => (window as HytteWindow).__hytte?.lastExport ?? null);
}

async function walkProbe(page: Page) {
  return page.evaluate(() => (window as HytteWindow).__hytte?.walk ?? null);
}

async function openExportMenu(page: Page): Promise<void> {
  await page.getByTestId('export-menu').locator('summary').click();
  await expect(page.getByTestId('export-menu-pdf')).toBeVisible();
}

async function show3d(page: Page, tab: 'view-tab-3d' | 'view-tab-split' = 'view-tab-3d'): Promise<void> {
  await page.getByTestId(tab).click();
  await expect(page.getByTestId('view-3d').locator('canvas')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(SETTLE_MS);
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

test.describe('phase 3 on a desktop (1400×900)', () => {
  let pageErrors: string[] = [];
  test.beforeEach(async ({ page }) => {
    pageErrors = collectPageErrors(page);
    await skipFirstRun(page);
  });
  test.afterEach(async ({ page }) => {
    await assertNoGenericWarnings(page);
    expect(pageErrors, `uncaught errors in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('«Eksporter plan som PDF»: A3, 1:50, both storeys — the pages the dialog promised, on A3', async ({ page }, testInfo) => {
    await loadAndWaitReady(page);
    await openExportMenu(page);
    await page.getByTestId('export-menu-pdf').click();
    const dialog = page.getByTestId('export-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('export-paper-A3').click();
    await page.getByTestId('export-scale-50').click();
    await page.getByTestId('export-storeys-both').click();
    const summary = (await page.getByTestId('export-summary').textContent()) ?? '';
    const m = /Blir (\d+) sider: Plan 1 på (\d+) ark A3 \w+, Hems på (\d+) ark A3 \w+, romskjema til slutt\./.exec(summary);
    expect(m, summary).not.toBeNull();
    const pages = Number(m![1]);
    expect(Number(m![2])).toBeGreaterThan(1);
    expect(pages).toBeGreaterThanOrEqual(Number(m![2]) + Number(m![3]) + 1);
    await shoot(page, testInfo, 'export-dialog');

    const download = page.waitForEvent('download');
    await page.getByTestId('export-make').click();
    await expect.poll(async () => (await lastExport(page))?.kind, { timeout: 60_000 }).toBe('pdf');
    const info = (await lastExport(page))!;
    expect(info.pages).toBe(pages);
    expect(info.fileName).toMatch(/^hytta-forslag-d-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(info.bytes).toBeGreaterThan(50_000);
    const file = await download;
    expect(file.suggestedFilename()).toBe(info.fileName);
    const saved = testInfo.outputPath(info.fileName);
    await file.saveAs(saved);
    const pdf = readFileSync(saved).toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.match(/\/Type\s*\/Page(?![s\w])/g)?.length, 'page objects in the file').toBe(pages);
    // A3 in points (297 × 420 mm), either way round.
    const boxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((b) => [Number(b[1]), Number(b[2])].sort((a, c) => a - c));
    expect(boxes.length).toBeGreaterThan(0);
    for (const [w, h] of boxes) {
      expect(w).toBeCloseTo(841.89, 0);
      expect(h).toBeCloseTo(1190.55, 0);
    }
    await expect(page.getByTestId('export-status')).toContainText(info.fileName);
  });

  test('«Lagre 3D-bildet som PNG» downloads the 3D view with its caption', async ({ page }) => {
    await loadAndWaitReady(page);
    await show3d(page);
    await openExportMenu(page);
    const download = page.waitForEvent('download');
    await page.getByTestId('export-menu-png').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^hytta-3d-\d{4}-\d{2}-\d{2}\.png$/);
    const info = await lastExport(page);
    expect(info).toMatchObject({ kind: 'png', pages: 1, fileName: file.suggestedFilename() });
    expect(info!.width).toBeGreaterThan(600);
    expect(info!.height).toBeGreaterThan(300);
    expect(info!.bytes).toBeGreaterThan(20_000);
    const head = readFileSync(await file.path()).subarray(0, 8);
    expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test('«Gå rundt»: W for 500 ms walks on at eye height; Esc ends the walk', async ({ page }, testInfo) => {
    await loadAndWaitReady(page);
    await show3d(page);
    await page.getByTestId('preset-walk').click();
    await expect.poll(async () => (await walkProbe(page)) !== null).toBe(true);
    await expect(page.getByTestId('walk-exit')).toBeVisible();
    // The eye settles at 1,65 m over the floor of the Stue.
    await expect.poll(async () => {
      const w = await walkProbe(page);
      return w ? Math.round((w.eyeZ - w.feetZ) * 100) / 100 : null;
    }).toBeCloseTo(1.65, 1);
    const start = (await walkProbe(page))!;

    await page.keyboard.down('w');
    await page.waitForTimeout(500);
    await page.keyboard.up('w');
    await expect.poll(async () => {
      const w = await walkProbe(page);
      return w ? Math.hypot(w.x - start.x, w.y - start.y) : 0;
    }).toBeGreaterThan(0.1);
    const after = (await walkProbe(page))!;
    expect(after.session).toBe(start.session);
    expect(after.eyeZ - after.feetZ, 'eye height while walking').toBeGreaterThan(1.5);
    expect(after.eyeZ - after.feetZ, 'eye height while walking').toBeLessThan(1.7);
    expect(Math.abs(after.feetZ - start.feetZ), 'still on the same floor').toBeLessThan(0.05);
    // Not into the plan: the walk keys never nudge a selection.
    expect(await page.evaluate(() => (window as HytteWindow).__hytte?.selection ?? null)).toBeNull();
    await page.waitForTimeout(SETTLE_MS);
    await shoot(page, testInfo, '3d-walk');

    await page.keyboard.press('Escape');
    await expect.poll(() => walkProbe(page)).toBeNull();
    await expect(page.getByTestId('walk-exit')).toHaveCount(0);
    await expect(page.getByTestId('preset-walk')).toHaveAttribute('aria-pressed', 'false');
  });

  test('Vis → «Avløp og sluk»: the stack and the «fint» line; a toilet moved into Soverom 1 is flagged', async ({ page }, testInfo) => {
    await loadAndWaitReady(page);
    await createNewProposal(page);
    await page.getByTestId('view-tab-plan').click();
    await page.getByTestId('toggle-plumbing').check();
    const info = page.getByTestId('plumbing-info');
    await expect(info).toContainText('WC og Hovedbad: toalettene står rygg mot rygg på veggen ved x 18,6 – det er fint.');
    const layer = page.locator('[data-testid=plan-view] [data-layer=plumbing]');
    await expect(layer).toHaveCount(1);
    await expect(layer.locator('[data-drain-stack]')).not.toHaveCount(0);
    await expect(layer.locator('[data-drain-far]')).toHaveCount(0);
    await expect(page.getByTestId('plumbing-far')).toHaveCount(0);
    // The WC's toilet (fu-wc-1 at 18,215 / 0,9) dragged to Soverom 1 at the far west end of the house.
    const wc = (await activeVariant(page)).furniture.find((f) => f.id === 'fu-wc-1');
    expect(wc?.position).toEqual([18.215, 0.9]);
    await selectAt(page, wc!.position, { kind: 'furniture', id: 'fu-wc-1' });
    await dragPlan(page, wc!.position, [1.6, 4.9], 24);
    await expect.poll(async () => (await derivedFurniture(page)).find((f) => f.id === 'fu-wc-1')?.roomId).toBe('room-sov1');
    await dismissToasts(page);
    const far = page.getByTestId('plumbing-far');
    await expect(far).toContainText(/Soverom 1: toalettet står [\d,]+ m fra avløpsstammen – det er for langt/);
    await expect(layer.locator('[data-drain-far="fu-wc-1"]')).toHaveCount(1);
    // Advarsler lists it (the drainage helper's warning while the overlay is on).
    await expect(page.getByTestId('warnings')).toContainText(/Toalettet i «Soverom 1» står [\d,]+ m fra avløpsstammen\./);
    // Off: the warning goes with the overlay; on again, Angre puts the toilet back and it is fine again.
    await page.getByTestId('toggle-plumbing').uncheck();
    await expect(page.getByTestId('warnings')).not.toContainText('fra avløpsstammen');
    await expect(layer).toHaveCount(0);
    await page.getByTestId('toggle-plumbing').check();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await activeVariant(page)).furniture.find((f) => f.id === 'fu-wc-1')?.position).toEqual([18.215, 0.9]);
    await expect(info).toContainText('WC og Hovedbad: toalettene står rygg mot rygg på veggen ved x 18,6 – det er fint.');
    await expect(page.getByTestId('plumbing-far')).toHaveCount(0);

    // The screenshot: the bathrooms zoomed in, the stack on w-wc-bad and the short runs.
    await zoomAt(page, [18.6, 0.8], 5);
    await shoot(page, testInfo, 'plan-avlop');
  });

  test('«IFC-modell»: a picked IFC file draws its outlines in the plan and its model in 3D', async ({ page }, testInfo) => {
    await loadAndWaitReady(page);
    await page.getByTestId('view-tab-split').click();
    const panel = page.getByTestId('ifc-panel');
    await panel.locator('summary').click();
    await expect(page.getByTestId('ifc-load')).toBeVisible();
    // Through the file chooser, as a family member would.
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('ifc-load').click();
    await (await chooser).setFiles(FIXTURE_IFC);
    await expect(page.getByTestId('ifc-file')).toContainText('test-cabin.ifc', { timeout: 60_000 });
    const plan = page.locator('[data-testid=plan-view] [data-layer=ifc]');
    await expect(plan).toHaveCount(1);
    const wallPath = plan.locator('path[data-ifc=wall]');
    await expect(wallPath).toHaveCount(1);
    expect(((await wallPath.getAttribute('d')) ?? '').length).toBeGreaterThan(20);
    await expect(plan.locator('path[data-ifc=window]')).toHaveCount(1);
    await expect(plan.locator('path[data-ifc=door]')).toHaveCount(1);
    // The plan's south wall line of the synthetic file sits on the house's south wall (y 0 ± 0,1).
    const box = await wallPath.evaluate((p: SVGPathElement) => {
      const b = p.getBBox();
      const m = p.getCTM();
      const root = p.ownerSVGElement?.querySelector<SVGGElement>('[data-plan-root]')?.getCTM();
      if (!m || !root) return null;
      const toPlan = root.inverse().multiply(m);
      const pt = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(toPlan);
      const a = pt(b.x, b.y);
      const c = pt(b.x + b.width, b.y + b.height);
      return { x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), y0: Math.min(a.y, c.y), y1: Math.max(a.y, c.y) };
    });
    expect(box).not.toBeNull();
    expect(box!.x0).toBeCloseTo(-0.1, 1);
    expect(box!.x1).toBeCloseTo(16.1, 1);
    expect(box!.y0).toBeCloseTo(-0.1, 1);
    expect(box!.y1).toBeCloseTo(6.3, 1);
    // 3D: the overlay's meshes are in the scene (the canvas says how many groups it draws).
    const canvas = page.getByTestId('view-3d').locator('canvas');
    await expect(canvas).toHaveAttribute('data-ifc-meshes', /^[1-9]\d*$/);
    await page.getByTestId('ifc-show-3d').uncheck();
    await expect(canvas).not.toHaveAttribute('data-ifc-meshes', /.+/);
    await page.getByTestId('ifc-show-3d').check();
    await expect(canvas).toHaveAttribute('data-ifc-meshes', /^[1-9]\d*$/);

    // The committed screenshot is always taken with the synthetic fixture (never the architect's file).
    await page.getByTestId('mode-ute').click();
    await page.getByTestId('preset-oversikt').click();
    await zoomAt(page, [8, 3.1], 3);
    await page.waitForTimeout(SETTLE_MS * 2);
    await shoot(page, testInfo, 'ifc-overlay');

    // «Fjern» takes it off this device.
    await page.getByTestId('ifc-remove').click();
    await expect(plan).toHaveCount(0);
    await expect(page.getByTestId('ifc-load')).toBeVisible();
  });
});
