import { expect, test } from '@playwright/test';
import { hash, skipWelcome } from '../helpers';

test.beforeEach(({ page }) => skipWelcome(page));

test('browse the heroes, read a profile and pick that hero', async ({ page }) => {
  await page.goto('./#/heroes');
  await expect(page.getByRole('heading', { name: 'HEROES' })).toBeVisible();
  await expect(page.locator('.hp-card')).toHaveCount(18);

  // Open a profile from the gallery: pose, bio and the 16x16 frames.
  await page.locator('.hp-card', { hasText: 'Hijab skater' }).click();
  await expect.poll(() => hash(page)).toBe('#/heroes/hijab-skater');
  await expect(page.getByRole('heading', { name: 'HIJAB SKATER' })).toBeVisible();
  await expect(page.locator('.hp-bio')).toContainText('skate park');
  await expect(page.getByRole('img', { name: 'Hijab skater, in a fighting stance' })).toBeVisible();
  await expect(page.locator('.hp-frame')).toHaveCount(3);

  // Say something: a line in the dialogue box.
  await page.getByRole('button', { name: 'SAY SOMETHING' }).click();
  await expect(page.locator('.dlg')).toBeVisible();

  // Pick the hero: the button says so, and the gallery marks them as yours.
  await page.getByRole('button', { name: 'PICK THIS HERO' }).click();
  await expect(page.getByRole('button', { name: '✓ YOUR HERO' })).toBeDisabled();
  await page.goto('./#/heroes');
  await expect(page.locator('.hp-card.mine')).toContainText('Hijab skater');

  // Arrow keys step through the heroes; Esc goes back to the gallery.
  await page.goto('./#/heroes/hijab-skater');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => hash(page)).toBe('#/heroes/silver-locs');
  await page.keyboard.press('Escape');
  await expect.poll(() => hash(page)).toBe('#/heroes');

  // An unknown hero falls back to the gallery.
  await page.goto('./#/heroes/nobody');
  await expect(page.locator('.hp-card')).toHaveCount(18);
});
