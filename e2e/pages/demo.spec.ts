import { expect, test, type Page } from '@playwright/test';
import { inScene, settled, skipWelcome } from '../helpers';

/** The flag's height on the pole, in world pixels (smaller is higher). */
const flagY = (page: Page) =>
  page.evaluate(() => (window.__questGame!.scene.getScene('level') as unknown as { pole?: { flag: { y: number } } }).pole?.flag.y);

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
