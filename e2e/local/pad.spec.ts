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

  // Esc puts the pad away, back on the level.
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/p\/kitchen-renovation\/fit\/tiling$/);
  await expect(pad).toHaveCount(0);
});

test('s holds up the stats screen, and the HUD flame puts it away', async ({ page }) => {
  await page.goto('./#/p/kitchen-renovation/fit/tiling');
  await inScene(page, 'level');
  const stats = page.getByRole('region', { name: 'Stats: streaks and history' });

  await page.keyboard.press('s');
  await expect(page).toHaveURL(/\/~stats$/);
  await expect(stats.getByRole('heading', { name: 'RECORDS' })).toBeVisible();
  await expect(stats.locator('.stats-heat .heat')).toHaveCount(140);
  await expect(stats.getByRole('heading', { name: 'TIME-BOXES' })).toBeVisible();
  // The Docker editor has a commit log, so the history counts too.
  await expect(stats.locator('.ss-source')).toContainText('commit history');
  // Stats isn't a page of the pad any more.
  await expect(page.locator('.legal-pad')).toHaveCount(0);

  await page.locator('.hud-streak').click();
  await expect(page).toHaveURL(/#\/p\/kitchen-renovation\/fit\/tiling$/);
  await expect(stats).toHaveCount(0);
  await page.keyboard.press('s');
  await expect(stats).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/p\/kitchen-renovation\/fit\/tiling$/);
  await expect(stats).toHaveCount(0);
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

test('detailed stats build the repo’s history in the background, and Esc goes back to stats', async ({ page }) => {
  await page.goto('./#/stats');
  await page.getByRole('link', { name: /DETAILED STATS/ }).click();
  await expect(page).toHaveURL(/#\/records$/);
  const detailed = page.getByRole('region', { name: 'Detailed stats' });
  // The page opens at once, whatever has been built so far.
  await expect(detailed.getByRole('heading', { name: 'RECORDS · DETAILED' })).toBeVisible();
  // The local server has a real git log behind it, read a page at a time until it's all in.
  await expect(detailed.locator('.ds-scan')).toContainText(/\d+ commits? read, all of it/, { timeout: 30_000 });
  await expect(page.locator('.ds-build')).toBeHidden();
  await expect(detailed.locator('.stats-heat button.heat')).not.toHaveCount(0);
  await expect(detailed.getByRole('heading', { name: 'BY PROJECT' })).toBeVisible();

  // Pick a day with something in it: its log opens under the calendar.
  await detailed.locator('.stats-heat button.heat:not(.h0)').first().click();
  await expect(detailed.locator('.ds-day li').first()).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/~stats$/);
  await expect(page.getByRole('region', { name: 'Stats: streaks and history' })).toBeVisible();
});
