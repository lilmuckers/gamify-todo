import { expect, test } from '@playwright/test';
import { clickLocator, hash, inScene, settled, skipWelcome } from '../helpers';

test.beforeEach(({ page }) => skipWelcome(page));

test('finished and archived games stand on the shelf, and go in the console from there', async ({ page }) => {
  await page.goto('./#/');
  await inScene(page, 'projects');
  // Only games in play lie on the floor; the button counts what's up on the shelf.
  const up = page.getByRole('button', { name: 'Look at the shelf: 2 completed · 1 archived' });
  await expect(up).toBeVisible();
  await up.click();
  await settled(page);
  const down = page.getByRole('button', { name: 'Back to the floor' });
  await expect(down).toBeVisible();
  await expect(up).toBeHidden();

  // Esc looks back down, and up again.
  await page.keyboard.press('Escape');
  await settled(page);
  await expect(up).toBeVisible();
  await up.click();
  await settled(page);

  // The archived game: off the shelf, into the console, onto its map, still archived.
  await clickLocator(page, 'shelf:moving-flat');
  await inScene(page, 'overworld');
  expect(await hash(page)).toBe('#/p/moving-flat');
  await expect(page.locator('.panel .archived-note')).toContainText('Archived');
});
