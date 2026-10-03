import { expect, test, type Page } from '@playwright/test';
import { inScene, skipWelcome } from '../helpers';
import { commits, itemStatus } from '../repo';

/** The store's sync status and queued edits. */
const sync = (page: Page) =>
  page.evaluate(() => {
    const { store } = window.__questGame!.registry.get('app') as { store: { status: string; outbox: unknown[] } };
    return { status: store.status, queued: store.outbox.length };
  });

test('an edit made offline survives a reload and commits once back online', async ({ page, context }) => {
  await skipWelcome(page);
  const file = 'data/kitchen-renovation/finish/decorate.json';
  const level = './#/p/kitchen-renovation/finish/decorate';
  await page.goto(level);
  // The service worker caches the app; once it controls the page, a reload works offline.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(async () => {
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
    return page.evaluate(() => !!navigator.serviceWorker.controller);
  }).toBe(true);
  await inScene(page, 'level');
  await expect.poll(async () => (await sync(page)).status).toBe('synced');
  const before = await commits();

  await context.setOffline(true);
  const card = page.locator('.panel li.item.todo').first();
  const itemId = (await card.getAttribute('id'))!.replace(/^item-/, '');
  await card.getByRole('button', { name: '✓ Done' }).click();
  await expect.poll(() => sync(page)).toEqual({ status: 'offline', queued: 1 });
  await expect(page.locator('.sync-pill.offline')).toBeVisible();

  // Still offline: the app and the edit both come back from this browser's caches.
  await page.reload();
  await inScene(page, 'level');
  await expect(page.locator(`#item-${itemId}`)).toHaveClass(/\bdone\b/);
  await expect.poll(() => sync(page)).toEqual({ status: 'offline', queued: 1 });
  expect(await commits()).toEqual(before);
  expect(itemStatus(file, itemId)).not.toBe('done');

  await context.setOffline(false);
  await expect.poll(() => sync(page), { timeout: 20_000 }).toEqual({ status: 'synced', queued: 0 });
  await expect.poll(() => itemStatus(file, itemId)).toBe('done');
  expect((await commits()).length).toBe(before.length + 1);
});
