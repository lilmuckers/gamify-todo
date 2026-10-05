import { expect, test } from '@playwright/test';
import { cssSettled, inScene, skipWelcome } from '../helpers';
import { repoJson } from '../repo';

test.beforeEach(({ page }) => skipWelcome(page));

test('t, i, w and s hold up Today, the Inbox, the weekly review and stats', async ({ page }) => {
  await page.goto('./#/p/kitchen-renovation/fit/tiling');
  await inScene(page, 'level');
  const pad = page.locator('.legal-pad');

  await page.keyboard.press('t');
  await expect(page).toHaveURL(/\/~today$/);
  await expect(pad).toHaveAttribute('aria-label', "Today's plan");
  await expect(pad.locator('.pad-title')).toBeVisible();

  await page.keyboard.press('i');
  await expect(page).toHaveURL(/\/~inbox$/);
  await expect(pad).toHaveAttribute('aria-label', 'Inbox');
  await expect(pad.getByRole('heading', { name: 'INBOX' })).toBeVisible();

  await page.keyboard.press('w');
  await expect(page).toHaveURL(/\/~review$/);
  await expect(pad).toHaveAttribute('aria-label', 'Weekly review');

  // Stats: 20 weeks of calendar, and the HUD flame puts it away again.
  await page.keyboard.press('s');
  await expect(page).toHaveURL(/\/~stats$/);
  await expect(pad).toHaveAttribute('aria-label', 'Stats: streaks and history');
  await expect(pad.locator('.stats-heat .heat')).toHaveCount(140);
  await expect(pad.getByRole('heading', { name: 'TIME-BOXES' })).toBeVisible();
  await page.locator('.hud-streak').click();
  await expect(page).toHaveURL(/#\/p\/kitchen-renovation\/fit\/tiling$/);
  await page.keyboard.press('s');
  await expect(page).toHaveURL(/\/~stats$/);
  await expect(pad).toHaveAttribute('aria-label', 'Stats: streaks and history');

  // Esc puts the pad away, back on the level.
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/p\/kitchen-renovation\/fit\/tiling$/);
  await expect(pad).toHaveCount(0);
});

test('n captures an idea, which can then be placed into the open level', async ({ page }) => {
  const idea = 'Ask about spare tiles for repairs';
  await page.goto('./#/p/kitchen-renovation/fit/tiling');
  await inScene(page, 'level');

  await page.keyboard.press('n');
  const scribble = page.getByRole('textbox', { name: 'New idea' });
  await expect(scribble).toBeFocused();
  await scribble.fill(idea);
  await scribble.press('Enter');
  await expect.poll(() => repoJson<{ items: { title: string }[] }>('data/inbox.json').items.map((i) => i.title), { timeout: 15_000 }).toContain(idea);

  // Tick it on the pad and place it here.
  const pad = page.locator('.legal-pad');
  await cssSettled(pad);
  await pad.getByRole('button', { name: `Select "${idea}"` }).click({ force: true });
  await pad.locator('.pad-do').click({ force: true });
  await expect(page.locator('.toast', { hasText: '1 idea placed' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.panel li.item', { hasText: idea })).toBeVisible();
  await expect
    .poll(() => repoJson<{ items: { title: string }[] }>('data/kitchen-renovation/fit/tiling.json').items.map((i) => i.title), { timeout: 15_000 })
    .toContain(idea);
  expect(repoJson<{ items: { title: string }[] }>('data/inbox.json').items.map((i) => i.title)).not.toContain(idea);
});
