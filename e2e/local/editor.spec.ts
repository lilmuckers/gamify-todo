import { expect, test } from '@playwright/test';
import { inScene, skipWelcome } from '../helpers';
import { commits, itemStatus, repoJson } from '../repo';

test.beforeEach(({ page }) => skipWelcome(page));

test('completing an item writes the file and commits it', async ({ page }) => {
  const file = 'data/kitchen-renovation/finish/snagging.json';
  const before = await commits();
  await page.goto('./#/p/kitchen-renovation/finish/snagging');
  await inScene(page, 'level');
  const card = page.locator('.panel li.item.todo').first();
  const itemId = (await card.getAttribute('id'))!.replace(/^item-/, '');

  await card.getByRole('button', { name: '✓ Done' }).click();
  await expect(page.locator(`#item-${itemId}`)).toHaveClass(/\bdone\b/);

  await expect.poll(() => itemStatus(file, itemId), { timeout: 15_000 }).toBe('done');
  await expect.poll(async () => (await commits()).length).toBe(before.length + 1);
  expect((await commits())[0]).toMatch(/^quest:/);
});

test('steps added under a warp pipe, once done, send the hero back up with the dependency done', async ({ page }) => {
  const file = 'data/bike-restoration/build/brakes.json';
  await page.goto('./#/p/bike-restoration/build/brakes/@brake-cables');
  await inScene(page, 'level');
  await expect(page.locator('.panel.sub-level, .panel .sub-level')).toBeVisible();

  const add = page.getByRole('textbox', { name: 'New item title' });
  for (const step of ['Buy inner cables', 'Fit and tension them']) {
    await add.fill(step);
    await add.press('Enter');
    await expect(page.locator('.panel li.item', { hasText: step })).toBeVisible();
  }
  for (const step of ['Buy inner cables', 'Fit and tension them']) {
    await page.locator('.panel li.item', { hasText: step }).getByRole('button', { name: '✓ Done' }).click();
  }

  // Back up the pipe by itself, into the level, with the dependency done.
  await expect.poll(() => page.evaluate(() => location.hash), { timeout: 20_000 }).not.toContain('@');
  await inScene(page, 'level');
  await expect(page.locator('#item-brake-cables')).toHaveClass(/\bdone\b/);
  await expect.poll(() => itemStatus(file, 'brake-cables'), { timeout: 15_000 }).toBe('done');
  const dep = repoJson<{ items: { id: string; subtasks?: { title: string; status: string }[] }[] }>(file).items.find((i) => i.id === 'brake-cables')!;
  expect(dep.subtasks?.map((s) => [s.title, s.status])).toEqual([
    ['Buy inner cables', 'done'],
    ['Fit and tension them', 'done'],
  ]);
});

test('the hero picker saves the hero to data/settings.json', async ({ page }) => {
  await page.goto('./#/');
  await inScene(page, 'projects');
  const before = repoJson('data/settings.json').hero;
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Next hero' }).click();
  await page.getByRole('button', { name: 'Use this hero' }).click();
  await expect(page.getByRole('button', { name: '✓ Your hero' })).toBeDisabled();
  const chosen = await page.evaluate(() => (window.__questGame!.registry.get('app') as { heroId: string }).heroId);
  expect(chosen).not.toBe(before);

  await expect.poll(() => repoJson('data/settings.json').hero, { timeout: 15_000 }).toBe(chosen);
});
