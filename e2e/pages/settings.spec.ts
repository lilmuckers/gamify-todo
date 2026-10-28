import { expect, test } from '@playwright/test';
import { inScene, skipWelcome } from '../helpers';

test.beforeEach(({ page }) => skipWelcome(page));

test('Settings opens on Game, arrow keys move between tabs, and the sync pill opens GitHub & sync', async ({ page }) => {
  await page.goto('./#/');
  await inScene(page, 'projects');
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const tab = (name: string) => settings.getByRole('tab', { name });
  await expect(tab('Game')).toHaveAttribute('aria-selected', 'true');
  await expect(tab('Game')).toBeFocused();
  await expect(settings.getByRole('button', { name: 'CHANGE HERO' })).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Sync' })).toBeHidden();

  await page.keyboard.press('ArrowDown');
  await expect(tab('GitHub & sync')).toBeFocused();
  await expect(settings.getByRole('heading', { name: 'Sync' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(tab('Help')).toHaveAttribute('aria-selected', 'true');
  await expect(settings.getByRole('button', { name: 'Use Quest Log with AI' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(tab('Game')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await page.locator('.sync-pill').click();
  await expect(tab('GitHub & sync')).toHaveAttribute('aria-selected', 'true');
  await expect(settings.getByRole('heading', { name: 'Sync' })).toBeVisible();
});
