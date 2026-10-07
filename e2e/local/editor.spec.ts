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
  // The character select opens over Settings; pick a hero other than the repo's.
  await page.getByRole('button', { name: 'CHANGE HERO' }).click();
  const pick = before === 'goth' ? 'Punk' : 'Goth';
  await page.getByRole('radio', { name: pick }).click();
  await page.getByRole('button', { name: 'PICK THIS HERO' }).click();
  // It closes itself after the transformation, back to Settings.
  await expect(page.getByRole('dialog', { name: 'CHOOSE YOUR HERO' })).toHaveCount(0);
  await expect(page.locator('.hero-card b')).toHaveText(pick);
  const chosen = await page.evaluate(() => (window.__questGame!.registry.get('app') as { heroId: string }).heroId);
  expect(chosen).not.toBe(before);

  await expect.poll(() => repoJson('data/settings.json').hero, { timeout: 15_000 }).toBe(chosen);
});

test('logging what a done item cost commits it, updates the money box and costs no polish', async ({ page }) => {
  const file = 'data/kitchen-renovation/services/electrics.json';
  type LevelFile = { items: { id: string; budget?: number; spent?: number }[]; stats?: { itemEdits?: Record<string, number> } };
  const statsBefore = repoJson<LevelFile>(file).stats;
  await page.goto('./#/p/kitchen-renovation/services/electrics/chase-the-walls-for-cables');
  await inScene(page, 'level');
  await expect(page.locator('.panel .money')).toContainText('£1,265 spent of £1,800');

  await page.locator('#item-chase-the-walls-for-cables').getByRole('button', { name: 'Edit item' }).click();
  await page.getByLabel('Spent (£)').fill('410');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // £10 over its £400 budget: an alert, a red tag, and the box adds it up.
  await expect(page.locator('.toast.alert')).toContainText('Over budget: Chase the walls for cables is at £410 of £400.');
  await expect(page.locator('#item-chase-the-walls-for-cables .money-tag')).toHaveText('£410 of £400');
  await expect(page.locator('#item-chase-the-walls-for-cables .money-tag')).toHaveClass(/\bover\b/);
  await expect(page.locator('.panel .money')).toContainText('£1,315 spent of £1,800');

  await expect.poll(() => repoJson<LevelFile>(file).items.find((i) => i.id === 'chase-the-walls-for-cables')?.spent, { timeout: 15_000 }).toBe(410);
  expect(repoJson<LevelFile>(file).stats).toEqual(statsBefore);
});

test('budgets stay hidden until the project turns them on, then alert as costs are logged', async ({ page }) => {
  // Allotment 2026 doesn't track money (the example data's home-maintenance now does).
  const level = './#/p/allotment/summer/watering/add-two-more-water-butts';
  await page.goto(level);
  await inScene(page, 'level');
  await expect(page.locator('.panel .money')).toHaveCount(0);
  await page.locator('#item-add-two-more-water-butts').getByRole('button', { name: 'Edit item' }).click();
  await expect(page.getByLabel('Budget (£)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.goto('./#/p/allotment');
  await inScene(page, 'overworld');
  await page.locator('.panel').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Track cash budgets').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => repoJson('data/allotment/project.json').budgets, { timeout: 15_000 }).toEqual({});

  await page.goto(level);
  await inScene(page, 'level');
  await page.locator('#item-add-two-more-water-butts').getByRole('button', { name: 'Edit item' }).click();
  await page.getByLabel('Budget (£)').fill('20');
  await page.getByLabel('Spent (£)').fill('19');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // The item and its level are finished, so only the Summer Crops world (still open) gets a heads-up.
  await expect(page.locator('.toast.warn')).toContainText('Heads-up: Summer Crops has used 95% of its £20.');
  await expect(page.locator('.panel .money')).toContainText('£19 spent of £20');
});

test('archiving a project commits archivedAt and pauses it; unarchiving takes it back off the shelf', async ({ page }) => {
  const file = 'data/bike-restoration/project.json';
  await page.goto('./#/p/bike-restoration');
  await inScene(page, 'overworld');
  await page.locator('.panel').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  const note = page.locator('.panel .archived-note');
  await expect(note).toContainText('Archived');
  await expect.poll(() => repoJson<{ archivedAt?: string }>(file).archivedAt, { timeout: 15_000 }).toMatch(/^\d{4}-/);

  // Its started levels say the clock is paused.
  await page.goto('./#/p/bike-restoration/build/drivetrain');
  await inScene(page, 'level');
  await expect(page.locator('.panel .timer.archived')).toContainText('the clock is paused');
  await expect(page.locator('.hud-time')).toHaveText('⏸ paused');

  await page.locator('.panel .timer.archived').getByRole('button', { name: 'Unarchive' }).click();
  await expect(page.locator('.panel .timer.archived')).toHaveCount(0);
  await expect.poll(() => repoJson<{ archivedAt?: string }>(file).archivedAt, { timeout: 15_000 }).toBeUndefined();
});
