import { expect, test, type Page } from '@playwright/test';
import { inScene, settled, skipWelcome } from '../helpers';

/** The flag's height on the pole, in world pixels (smaller is higher). */
const flagY = (page: Page) =>
  page.evaluate(() => (window.__questGame!.scene.getScene('level') as unknown as { pole?: { flag: { y: number } } }).pole?.flag.y);

test('the demo shows detailed stats from a made-up history, after a short pretend scan', async ({ page }) => {
  await skipWelcome(page);
  await page.goto('./?demo#/records');
  await expect(page.locator('.ds-load')).toContainText('SCANNING YOUR HISTORY');
  const detailed = page.getByRole('region', { name: 'Detailed stats' });
  await expect(detailed.getByRole('heading', { name: 'RECORDS · DETAILED' })).toBeVisible({ timeout: 10_000 });
  await expect(detailed.locator('.ds-scan')).toContainText(/\d{3} commits scanned/);
  // History-only numbers are there: reopened work and scope added mid-level.
  await expect(detailed.locator('.ds-tile').filter({ hasText: 'REOPENED' }).locator('b')).not.toHaveText('–');
  await expect(detailed.locator('.ds-scope b.up')).toHaveText(/^\+\d+/);
  // The finished example games are marked.
  await expect(detailed.locator('.ds-won')).toHaveCount(3);
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
