import { expect, test } from '@playwright/test';
import { bubbleItem, clickItem, clickLocator, clickSpot, hash, inScene, settled, skipWelcome } from '../helpers';

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

test('the hero walks the map paths, and a locked world says why', async ({ page }) => {
  await page.goto('./#/p/customer-portal');
  await inScene(page, 'overworld');
  const map = (key: 'overworld' | 'world') =>
    page.evaluate((k) => {
      const s = window.__questGame!.scene.getScene(k) as unknown as {
        layer: { list: { type: string; visible: boolean; text?: string; texture?: { key: string }; x: number }[] };
      };
      const list = s.layer.list;
      return {
        tips: list.filter((o) => o.type === 'Text' && o.visible && o.text!.startsWith('Locked')).map((o) => o.text),
        locks: list.filter((o) => o.texture?.key === 'padlock').length,
        heroX: list.find((o) => o.type === 'Sprite')?.x,
      };
    }, key);

  // Features waits on Platform: a padlock, and a click explains instead of going in.
  expect((await map('overworld')).locks).toBe(2);
  await page.mouse.move(0, 0);
  await clickSpot(page, 'overworld', 'features');
  await expect.poll(async () => (await map('overworld')).tips).toEqual(['Locked: Clear World 2 (Platform) first']);
  expect(await hash(page)).toBe('#/p/customer-portal');

  // The hero waits at Platform (next up) and walks back along the path to Discovery.
  const from = (await map('overworld')).heroX!;
  await clickSpot(page, 'overworld', 'discovery');
  await expect.poll(async () => (await map('overworld')).heroX!).toBeLessThan(from - 8);
  await inScene(page, 'world');
  expect(await hash(page)).toBe('#/p/customer-portal/discovery');

  // Discovery is all clear: the hero waits by the castle, and walks back to level 1 to go in.
  const castle = (await map('world')).heroX!;
  await clickSpot(page, 'world', 'research');
  await expect.poll(async () => (await map('world')).heroX!).toBeLessThan(castle - 8);
  await inScene(page, 'level');
  expect(await hash(page)).toBe('#/p/customer-portal/discovery/research');
  await settled(page);
});

test('ride a cloud to the level a dependency waits on, and back again', async ({ page }) => {
  const from = '#/p/customer-portal/platform/api';
  await page.goto(`./${from}/auth-live`);
  await inScene(page, 'level');

  // Over on the dependency's cloud: one waits there to ride back.
  await page.getByRole('link', { name: /Ride the cloud to/ }).click();
  await expect.poll(() => hash(page)).toBe('#/p/customer-portal/platform/auth');
  await inScene(page, 'level');
  const parked = () => page.evaluate(() => !!(window.__questGame!.scene.getScene('level') as unknown as { home?: unknown }).home);
  await expect.poll(parked).toBe(true);

  // Back again: the hero lands by the dependency, its bubble open.
  await page.getByRole('link', { name: /Ride the cloud back to/ }).click();
  await expect.poll(() => hash(page)).toBe(`${from}/auth-live`);
  await inScene(page, 'level');
  await expect.poll(() => bubbleItem(page)).toBe('auth-live');

  // That trip's done: going over again starts a new one, and walking off forgets it.
  await page.getByRole('link', { name: /Ride the cloud to/ }).click();
  await inScene(page, 'level');
  await page.goto('./#/p/customer-portal/platform');
  await inScene(page, 'world');
  await page.goto('./#/p/customer-portal/platform/auth');
  await inScene(page, 'level');
  await expect(page.getByRole('link', { name: /Ride the cloud back to/ })).toHaveCount(0);
  expect(await parked()).toBe(false);
});

test('search with / finds a step inside a dependency and opens it', async ({ page }) => {
  await page.goto('./#/');
  await inScene(page, 'projects');
  await page.keyboard.press('/');
  const input = page.getByRole('searchbox', { name: 'Search' });
  await expect(input).toBeFocused();

  // A step under the kitchen's permit dependency, found by its own words.
  await input.fill('council website');
  const hit = page.locator('.search-hit').first();
  await expect(hit).toContainText('Apply on the council website');
  await expect(hit).toContainText('Kitchen Renovation › Strip-out › Demolition › Skip permit from the council');

  // Filters narrow it further and combine with the text.
  await page.getByRole('button', { name: 'Decision', exact: true }).click();
  await expect(page.locator('.search-hit')).toHaveCount(0);
  await page.getByRole('button', { name: 'Decision', exact: true }).click();

  await input.press('Enter');
  await expect(page.locator('.overlay')).toHaveCount(0);
  await expect.poll(() => hash(page)).toBe('#/p/kitchen-renovation/strip/demolition/@permit/apply-online');
  await inScene(page, 'level');
  await expect.poll(() => bubbleItem(page)).toBe('apply-online');
});
