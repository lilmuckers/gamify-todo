import { expect, test } from '@playwright/test';
import { inScene, skipWelcome } from '../helpers';

test.beforeEach(({ page }) => skipWelcome(page));

test('the character select opens over Settings, and picking shrinks the hero into their sprite', async ({ page }) => {
  await page.goto('./#/');
  await inScene(page, 'projects');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'CHANGE HERO' }).click();
  const select = page.getByRole('dialog', { name: 'CHOOSE YOUR HERO' });
  await expect(select).toBeVisible();
  await expect(select.getByRole('radio')).toHaveCount(18);
  await expect(select.getByRole('radio', { checked: true })).toHaveCount(1);

  // A portrait: their pose and bio on the left, name and description under the grid.
  await select.getByRole('radio', { name: 'Hijab skater' }).click();
  await expect(select.getByRole('radio', { name: 'Hijab skater' })).toHaveAttribute('aria-checked', 'true');
  await expect(select.getByRole('img', { name: 'Hijab skater, in a fighting stance' })).toBeVisible();
  await expect(select.locator('.hp-bio')).toContainText('skate park');
  await expect(select.locator('.hp-name')).toHaveText('HIJAB SKATER');
  await expect(select.locator('.hp-desc')).toContainText('Teal hijab');

  // Arrow keys move round the grid (six across).
  await page.keyboard.press('ArrowRight');
  await expect(select.getByRole('radio', { name: 'Silver locs' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(select.getByRole('radio', { name: 'Flag-dyed hair' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');

  // Pick: the transformation plays, then the select closes back to Settings.
  await select.getByRole('button', { name: 'PICK THIS HERO' }).click();
  await expect(select.locator('.hp-morph')).toBeVisible();
  await expect(select.getByRole('status').filter({ hasText: '✓ Rainbow tee is your hero' })).toBeVisible();
  await expect(select).toHaveCount(0);
  await expect(page.locator('.hero-card b')).toHaveText('Rainbow tee');

  // Opened again, it starts on your hero.
  await page.getByRole('button', { name: 'CHANGE HERO' }).click();
  await expect(page.getByRole('radio', { name: 'Rainbow tee' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.hp-cell.mine')).toHaveAttribute('aria-label', 'Rainbow tee');
  await expect(page.getByRole('button', { name: '✓ YOUR HERO' })).toBeDisabled();
});

test('with reduced motion, picking a hero closes the select at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./#/');
  await inScene(page, 'projects');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'CHANGE HERO' }).click();
  await page.getByRole('radio', { name: 'Punk' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'CHOOSE YOUR HERO' })).toHaveCount(0);
  await expect(page.locator('.hero-card b')).toHaveText('Punk');
});
