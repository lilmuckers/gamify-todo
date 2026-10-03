import { expect, type Locator, type Page } from '@playwright/test';

/** Marks the welcome screen as seen, so tests start straight on the app. */
export async function skipWelcome(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('quest.onboarded')) localStorage.setItem('quest.onboarded', new Date().toISOString());
  });
}

/** Waits for a scene to be running, then for its animations to settle. */
export async function inScene(page: Page, key: 'projects' | 'overworld' | 'world' | 'level') {
  await expect
    .poll(() => page.evaluate((k) => !!window.__questGame?.scene.getScenes(true).some((s) => s.scene.key === k), key), { message: `scene ${key}` })
    .toBe(true);
  await settled(page);
}

/**
 * Waits until no one-off animation is running in any scene: every tween that
 * ends, timer and camera effect has finished. Endless loops (bobbing blocks)
 * don't count. Checked on the game's own state, never with a fixed sleep.
 */
export async function settled(page: Page) {
  const busy = () =>
    page.evaluate(() => {
      const scenes = window.__questGame!.scene.getScenes(true).filter((s) => s.scene.key !== 'boot');
      return scenes.some((s) => {
        const clock = s.time as unknown as { _active: { loop: boolean; hasDispatched: boolean }[]; _pendingInsertion: unknown[] };
        return (
          s.tweens.getTweens().some((t) => !t.isInfinite && !t.isFinished() && !t.isPendingRemove() && !t.isDestroyed()) ||
          clock._pendingInsertion.length > 0 ||
          clock._active.some((e) => !e.loop && !e.hasDispatched) ||
          s.cameras.cameras.some((c) => c.fadeEffect.isRunning || c.panEffect.isRunning || c.zoomEffect.isRunning)
        );
      });
    });
  // Twice in a row: a finished animation's promise may start the next one a moment later.
  await expect.poll(async () => !(await busy()) && !(await busy()), { message: 'game settled', timeout: 20_000 }).toBe(true);
}

/** Centre of a page-space rectangle. */
const centre = (r: { x: number; y: number; width: number; height: number }) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** Clicks something on the game canvas the app has a locator for ('cartridge', 'qblock', 'goal'...). */
export async function clickLocator(page: Page, name: string) {
  const r = await page.evaluate((n) => {
    const app = window.__questGame!.registry.get('app') as { locators: Map<string, () => DOMRect | undefined> };
    const box = app.locators.get(n)?.();
    return box && { x: box.x, y: box.y, width: box.width, height: box.height };
  }, name);
  expect(r, `locator ${name}`).toBeTruthy();
  await settled(page);
  const { x, y } = centre(r!);
  await page.mouse.click(x, y);
}

/** Clicks an item drawn in the level, by id (scrolling the camera to it first). */
export async function clickItem(page: Page, itemId: string) {
  const r = await page.evaluate((id) => {
    const scene = window.__questGame!.scene.getScene('level') as unknown as {
      views: Map<string, { root: { x: number; y: number; width: number; height: number } }>;
      following: boolean;
      bringIntoView(x: number, w: number): void;
      toScreen(r: { x: number; y: number; w: number; h: number }): DOMRect;
    };
    const v = scene.views.get(id);
    if (!v) return undefined;
    // The root sits at the item's top-left, sized to its tiles (its hit area).
    const { x, y, width: w, height: h } = v.root;
    scene.following = false;
    scene.bringIntoView(x, w);
    const s = scene.toScreen({ x, y, w, h });
    return { x: s.x, y: s.y, width: s.width, height: s.height };
  }, itemId);
  expect(r, `item ${itemId} in the level`).toBeTruthy();
  const { x, y } = centre(r!);
  await page.mouse.click(x, y);
}

/** The item whose bubble is open in the level, if any. */
export function bubbleItem(page: Page) {
  return page.evaluate(() => (window.__questGame!.scene.getScene('level') as unknown as { bubble?: { itemId: string } }).bubble?.itemId);
}

/** The app's current route hash. */
export const hash = (page: Page) => page.evaluate(() => location.hash);

/** Waits for an element's CSS animations that end (an entrance, say) to finish; endless ones (a sway) don't count. */
export async function cssSettled(locator: Locator) {
  await locator.evaluate((el) =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}
