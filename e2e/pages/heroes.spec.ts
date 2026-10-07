import { expect, test } from '@playwright/test';
import { hash, skipWelcome } from '../helpers';

test.beforeEach(({ page }) => skipWelcome(page));

test('pick a hero from the select screen', async ({ page }) => {
  // With no hero named, the screen opens on yours.
  await page.goto('./#/heroes');
  await expect(page.getByRole('heading', { name: 'HEROES' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(18);
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(1);

  // Pick a portrait: their pose and bio on the left, name and description under the grid.
  await page.getByRole('radio', { name: 'Hijab skater' }).click();
  await expect.poll(() => hash(page)).toBe('#/heroes/hijab-skater');
  await expect(page.getByRole('radio', { name: 'Hijab skater' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('img', { name: 'Hijab skater, in a fighting stance' })).toBeVisible();
  await expect(page.locator('.hp-bio')).toContainText('skate park');
  await expect(page.locator('.hp-name')).toHaveText('HIJAB SKATER');
  await expect(page.locator('.hp-desc')).toContainText('Teal hijab');

  // Make them yours: the pose shrinks into the 16x16 sprite, then it's back to the projects.
  await page.getByRole('button', { name: 'PICK THIS HERO' }).click();
  await expect(page.locator('.hp-morph')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '✓ Hijab skater is your hero' })).toBeVisible();
  await expect.poll(() => hash(page)).toBe('#/');

  // Back on the select screen, they're yours and the cursor starts on them.
  await page.goto('./#/heroes');
  await expect(page.getByRole('radio', { name: 'Hijab skater' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.hp-cell.mine')).toHaveAttribute('aria-label', 'Hijab skater');
  await expect(page.getByRole('button', { name: '✓ YOUR HERO' })).toBeDisabled();

  // Arrow keys move round the grid (six across); Esc goes back to the projects.
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => hash(page)).toBe('#/heroes/silver-locs');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => hash(page)).toBe('#/heroes/trans-flag-hair');
  await page.keyboard.press('Escape');
  await expect.poll(() => hash(page)).toBe('#/');

  // An unknown hero opens on yours.
  await page.goto('./#/heroes/nobody');
  await expect(page.getByRole('radio', { name: 'Hijab skater' })).toHaveAttribute('aria-checked', 'true');
});

test('with reduced motion, picking a hero goes straight back to the projects', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./#/heroes/punk');
  await page.getByRole('radio', { name: 'Punk' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => hash(page)).toBe('#/');
  await page.goto('./#/heroes');
  await expect(page.locator('.hp-cell.mine')).toHaveAttribute('aria-label', 'Punk');
});
