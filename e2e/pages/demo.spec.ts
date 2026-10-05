import { expect, test, type Page } from '@playwright/test';
import { inScene, settled, skipWelcome } from '../helpers';

/** The flag's height on the pole, in world pixels (smaller is higher). */
const flagY = (page: Page) =>
  page.evaluate(() => (window.__questGame!.scene.getScene('level') as unknown as { pole?: { flag: { y: number } } }).pole?.flag.y);

test('the demo shows detailed stats from a made-up history, after a short pretend build', async ({ page }) => {
  await skipWelcome(page);
  await page.goto('./?demo#/records');
  // The page is there at once; the heroes pretend to build the history for about a second.
  const strip = page.locator('.ds-build');
  await expect(strip).toBeVisible();
  await expect(strip).toContainText('BUILDING YOUR HISTORY');
  await expect(strip).toBeHidden({ timeout: 10_000 });
  const detailed = page.getByRole('region', { name: 'Detailed stats' });
  await expect(detailed.getByRole('heading', { name: 'RECORDS · DETAILED' })).toBeVisible();
  await expect(detailed.locator('.ds-scan')).toContainText(/\d{3} commits read, all of it/, { timeout: 10_000 });
  // History-only numbers are there: reopened work and scope added mid-level.
  await expect(detailed.locator('.ds-tile').filter({ hasText: 'REOPENED' }).locator('b')).not.toHaveText('–');
  await expect(detailed.locator('.ds-scope b.up')).toHaveText(/^\+\d+/);
  // The finished example games are marked.
  await expect(detailed.locator('.ds-table .ds-won')).toHaveCount(3);
  // Money over time, for the projects that track it.
  const money = detailed.locator('.ds-money');
  await expect(money.getByRole('heading', { name: 'MONEY' })).toBeVisible();
  await expect(money.locator('.ds-row4')).toContainText('SPENT');
  await expect(money.locator('.ds-money-table tbody tr')).toHaveCount(6);
  await expect(money.locator('.ds-from')).toHaveCount(0);
});

test('the demo lets you tick a stair step, and keeps nothing after a reload', async ({ page }) => {
  await skipWelcome(page);
  await page.goto('./?demo#/p/allotment/summer/brassicas');
  await inScene(page, 'level');
  await expect(page.locator('.sync-pill.demo')).toBeVisible();

  const step = page.locator('.panel label.check').first();
  await expect(step.locator('input')).not.toBeChecked();
  const low = await flagY(page);
  expect(low).toBeDefined();

  // Tick the first success criterion: a step lights and the flag climbs.
  await step.locator('input').check();
  await settled(page);
  expect(await flagY(page)).toBeLessThan(low!);

  // Nothing was saved: a reload brings back the untouched level.
  await page.reload();
  await inScene(page, 'level');
  await expect(page.locator('.panel label.check input').first()).not.toBeChecked();
  expect(await flagY(page)).toBe(low);
});
