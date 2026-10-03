import { expect, test } from '@playwright/test';
import { cssSettled, skipWelcome } from '../helpers';

test.beforeEach(({ page }) => skipWelcome(page));

test('phones get the tab bar, cartridges, islands and the level strip', async ({ page }) => {
  await page.goto('./#/');
  // Phones open on today's plan; the tab bar is always there.
  const tabs = page.locator('nav.tabbar');
  await expect(tabs).toBeVisible();
  await expect(page).toHaveURL(/#\/~today$/);
  await expect(page.getByRole('link', { name: 'Put the pad away' })).toBeVisible();
  await cssSettled(page.locator('.legal-pad'));
  // Put the pad away. It sways in the hero's hands, so its ✕ is never still:
  // skip Playwright's wait for it to stop moving (the entrance is over).
  await page.getByRole('link', { name: 'Put the pad away' }).click({ force: true });
  await expect(page).toHaveURL(/#\/$/);
  for (const name of ['Today', 'Inbox', 'Projects', 'Next', 'Settings']) await expect(tabs.getByText(name, { exact: true })).toBeVisible();

  await tabs.getByRole('link', { name: 'Projects' }).click();
  const cart = page.locator('.cart-floor a.cart').first();
  await expect(cart).toBeVisible();
  await cart.click();
  await expect(page).toHaveURL(/#\/p\/[\w-]+$/);
  await expect(tabs.getByRole('link', { name: 'Map' })).toHaveClass(/\bon\b/);

  const island = page.locator('.islands a.island').first();
  await expect(island).toBeVisible();
  await island.click();
  await expect(page).toHaveURL(/#\/p\/[\w-]+\/[\w-]+$/);

  // Next: straight into the suggested level, drawn as a strip above its items.
  await tabs.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/#\/p\/[\w-]+\/[\w-]+\/[\w-]+$/);
  const strip = page.locator('.strip canvas');
  await expect(strip).toBeVisible();
  expect((await strip.boundingBox())!.width).toBeGreaterThan(0);
  await expect(page.locator('.mobile-body li.item').first()).toBeVisible();
});

test("a dependency's sub-level gets its own strip with the steps", async ({ page }) => {
  await page.goto('./#/p/kitchen-renovation/fit/appliances/@appliance-delivery');
  await expect(page.locator('.strip canvas')).toBeVisible();
  await expect(page.locator('.sub-level')).toBeVisible();
  await expect(page.locator('.sub-level li.item')).toHaveCount(5);
});
