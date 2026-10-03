import { expect, test } from '@playwright/test';
import { bubbleItem, clickItem, clickLocator, hash, inScene, skipWelcome } from '../helpers';

test.beforeEach(({ page }) => skipWelcome(page));

test('browse from the project floor to an item, and deep-link to it', async ({ page }) => {
  await page.goto('./#/');
  await inScene(page, 'projects');
  await expect(page.getByRole('heading', { name: 'Select project' })).toBeVisible();

  // Pick the first cartridge off the floor: the console boots it and opens its map.
  await clickLocator(page, 'cartridge');
  await inScene(page, 'overworld');
  expect(await hash(page)).toMatch(/^#\/p\/[\w-]+$/);

  // Into the next level from the map's panel.
  await page.locator('.panel a.btn.primary').first().click();
  await inScene(page, 'level');
  const level = await hash(page);
  expect(level).toMatch(/^#\/p\/[\w-]+\/[\w-]+\/[\w-]+$/);

  // Click an item in the level: its bubble opens, the panel selects it, the URL names it.
  // A to-do the hero isn't already waiting at (that one's bubble opens by itself).
  const card = page.locator('.panel li.item.todo').filter({ hasNotText: 'NEXT' }).first();
  const itemId = (await card.getAttribute('id'))!.replace(/^item-/, '');
  await clickItem(page, itemId);
  await expect.poll(() => bubbleItem(page)).toBe(itemId);
  await expect(page.locator(`#item-${itemId}`)).toHaveClass(/selected/);
  await expect.poll(() => hash(page)).toBe(`${level}/${itemId}`);

  // The same link, opened fresh, shows the same bubble.
  await page.goto(`./${level}/${itemId}`);
  await page.reload();
  await inScene(page, 'level');
  await expect.poll(() => bubbleItem(page)).toBe(itemId);
  await expect(page.locator(`#item-${itemId}`)).toHaveClass(/selected/);
});
