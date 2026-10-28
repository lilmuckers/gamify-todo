import { createECDH } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { AutomationConfig } from '../../shared/src/automation';
import { renderStub, STUB_PATH } from '../../shared/src/stub';
import { FakeGitHub } from '../fake-github';
import { hash, inScene, skipWelcome } from '../helpers';

// Routes don't see requests a service worker handles, and headless Chromium can't really
// subscribe: a stand-in service worker container and PushManager take their place.
test.use({ serviceWorkers: 'block', timezoneId: 'America/New_York' });
test.beforeEach(({ page }) => skipWelcome(page));

const CONFIG = 'data/automation.json';
const REPO = 'player/quests';
const json = (a: AutomationConfig) => JSON.stringify(a, null, 2) + '\n';
const config = (gh: FakeGitHub) => JSON.parse(gh.repo(REPO).files()[CONFIG]) as AutomationConfig;
const b64url = (b: Buffer) => b.toString('base64url');

interface FakePush {
  permission: NotificationPermission;
  subscribes: number;
  /** The browser's current subscription: its number, and the key it was made for. */
  current: { n: number; key: string } | null;
  log: unknown[];
}

/** Stands in for the service worker, PushManager and Notification before the app loads. */
async function fakePush(page: Page, opts: { permission?: NotificationPermission; current?: { n: number; key: string }; deviceId?: string; noPush?: boolean } = {}) {
  await page.addInitScript((o) => {
    const w = window as unknown as { __push: FakePush; PushManager?: unknown; Notification: unknown };
    const state: FakePush = { permission: o.permission ?? 'default', subscribes: 0, current: o.current ?? null, log: [] };
    w.__push = state;
    if (o.deviceId) localStorage.setItem('quest.push.device', o.deviceId);
    const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const asSub = (c: { n: number; key: string }) => ({
      endpoint: `https://push.example.com/dev-${c.n}`,
      options: { applicationServerKey: b64(c.key).buffer },
      toJSON: () => ({ endpoint: `https://push.example.com/dev-${c.n}`, keys: { p256dh: `p256dh-${c.n}`, auth: `auth-${c.n}` } }),
      unsubscribe: async () => {
        if (state.current?.n === c.n) state.current = null;
        return true;
      },
    });
    let n = o.current?.n ?? 0;
    const pushManager = {
      getSubscription: async () => (state.current ? asSub(state.current) : null),
      subscribe: async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
        state.subscribes++;
        state.current = { n: ++n, key: btoa(String.fromCharCode(...applicationServerKey)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
        return asSub(state.current);
      },
    };
    const container = new EventTarget() as EventTarget & Record<string, unknown>;
    const registration = {
      pushManager,
      scope: location.origin + '/',
      installing: null,
      waiting: null,
      update: async () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      active: {
        postMessage: (msg: { type?: string }) => {
          if (msg?.type === 'quest-push-log') setTimeout(() => container.dispatchEvent(new MessageEvent('message', { data: { type: 'quest-push-log', log: state.log } })));
        },
      },
    };
    Object.assign(container, {
      controller: null,
      ready: Promise.resolve(registration),
      register: async () => registration,
      getRegistration: async () => registration,
    });
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    if (o.noPush) delete w.PushManager;
    w.Notification = class {
      static get permission() {
        return state.permission;
      }
      static async requestPermission() {
        if (state.permission === 'default') state.permission = 'granted';
        return state.permission;
      }
    };
  }, opts);
}

/** Signs in to `player/quests` and opens Settings on the Automation tab. */
async function openAutomation(page: Page, gh: FakeGitHub) {
  await gh.install(page);
  const session = JSON.stringify(gh.session());
  await page.addInitScript(
    ([s, r]) => {
      localStorage.setItem('quest.github.token', s);
      localStorage.setItem('quest.github.repo', r);
    },
    [session, REPO],
  );
  await page.goto('./#/');
  await inScene(page, 'projects');
  await expect(page.locator('.sync-pill.synced')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Automation' }).click();
  const section = page.locator('.automation');
  await expect(section).not.toHaveAttribute('aria-busy');
  return section;
}

const VAPID = (() => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
})();

const laptop = {
  id: 'laptop',
  label: 'Laptop',
  addedAt: '2026-10-20T09:00:00Z',
  timezone: 'Europe/London',
  subscription: { endpoint: 'https://push.example.com/laptop', keys: { p256dh: 'p256dh', auth: 'auth' } },
};
const oldPhone = { ...laptop, id: 'old-phone', label: 'Old phone', subscription: { ...laptop.subscription, endpoint: 'https://push.example.com/old' } };
const withDevices = (devices: (typeof laptop)[]): AutomationConfig => ({
  schedule: { every: '3h' },
  notify: { enabled: true, vapidPublicKey: VAPID.publicKey, devices },
});

test('the first device makes the keys, sets the secret and registers itself in one commit', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  const repo = gh.repo(REPO);
  const start: AutomationConfig = { channel: 'stable', schedule: { every: '3h' }, validate: { enabled: true, comment: true } };
  repo.push({ [CONFIG]: json(start), [STUB_PATH]: renderStub(start, 'main').text }, 'Install');
  await page.addInitScript(() => localStorage.setItem('quest.review', JSON.stringify({ day: 'mon', lastAt: new Date().toISOString(), focus: [] })));
  await fakePush(page);
  const section = await openAutomation(page, gh);
  expect(repo.public).toBe(false);

  const before = repo.appCommits().length;
  await section.getByRole('button', { name: 'Turn on for this device' }).click();
  const mine = section.locator('.push-device.mine');
  await expect(mine).toBeVisible();
  await expect(page.locator('.toast')).toContainText('Notifications are on for this device');

  // One commit: the public key, notify on, the device, and the workflow (it now has a schedule).
  expect(repo.appCommits().length).toBe(before + 1);
  const commit = repo.appCommits().at(-1)!;
  expect(repo.changed(commit)).toEqual([STUB_PATH, CONFIG]);
  expect(commit.message).toContain('automation: add device');
  const saved = config(gh);
  const device = saved.notify!.devices![0];
  expect(saved.notify!.enabled).toBe(true);
  expect(device).toMatchObject({
    label: expect.stringMatching(/ Chrome$/),
    timezone: 'America/New_York',
    events: { timebox: true, review: 'mon', warpZone: true },
    subscription: { endpoint: 'https://push.example.com/dev-1', keys: { p256dh: 'p256dh-1', auth: 'auth-1' } },
  });
  expect(device.id).toMatch(/^web-[0-9a-f]{8}$/);
  expect(repo.files()[STUB_PATH]).toContain('schedule:');

  // The secret is the private half of the key in automation.json, and the browser subscribed with it.
  const priv = repo.secretValues.get('QUEST_VAPID_PRIVATE_KEY')!;
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(priv, 'base64url'));
  expect(b64url(ecdh.getPublicKey())).toBe(saved.notify!.vapidPublicKey);
  expect(await page.evaluate(() => (window as unknown as { __push: FakePush }).__push.current?.key)).toBe(saved.notify!.vapidPublicKey);
  await expect(section.locator('.secrets')).toContainText('QUEST_VAPID_PRIVATE_KEY ✓ set');
  // A private repo: no warning about endpoints.
  await expect(section.locator('.push-public')).toHaveCount(0);
});

test('a second device reuses the repo’s key and leaves the secret alone', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  const repo = gh.repo(REPO);
  repo.public = true;
  const start = withDevices([laptop]);
  repo.push({ [CONFIG]: json(start), [STUB_PATH]: renderStub(start, 'main').text }, 'Install');
  repo.secrets.add('QUEST_VAPID_PRIVATE_KEY');
  await fakePush(page);
  const section = await openAutomation(page, gh);

  // Public repo: endpoints are visible, and Settings says so.
  await expect(section.locator('.push-public')).toContainText('This repo is public');
  await section.getByRole('button', { name: 'Turn on for this device' }).click();
  await expect(section.locator('.push-device.mine')).toBeVisible();
  await expect.poll(() => config(gh).notify!.devices!.length).toBe(2);
  const saved = config(gh);
  expect(saved.notify!.vapidPublicKey).toBe(VAPID.publicKey);
  expect(saved.notify!.devices![0].id).toBe('laptop');
  expect(repo.secretValues.size).toBe(0);
  expect(repo.appCommits().at(-1)!.message).toMatch(/^quest: automation: add device ".+ Chrome"$/);
  expect(await page.evaluate(() => (window as unknown as { __push: FakePush }).__push.current?.key)).toBe(VAPID.publicKey);
});

test('each device has its own name, timezone and events, and can be removed', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  const repo = gh.repo(REPO);
  const start = withDevices([laptop, oldPhone]);
  repo.push({ [CONFIG]: json(start), [STUB_PATH]: renderStub(start, 'main').text }, 'Install');
  repo.secrets.add('QUEST_VAPID_PRIVATE_KEY');
  // This browser is the laptop, and its subscription is the one on file.
  await fakePush(page, { deviceId: 'laptop' });
  const section = await openAutomation(page, gh);

  const mine = section.locator('.push-device[data-id="laptop"]');
  await expect(mine).toHaveClass(/mine/);
  await expect(section.getByRole('button', { name: 'Turn on for this device' })).toHaveCount(0);
  const device = (id: string) => config(gh).notify!.devices!.find((d) => d.id === id)!;

  await mine.getByLabel('Time-boxes running out').uncheck();
  await expect.poll(() => device('laptop').events?.timebox).toBe(false);
  await mine.getByLabel('Timezone').selectOption('Asia/Tokyo');
  await expect.poll(() => device('laptop').timezone).toBe('Asia/Tokyo');
  await mine.getByLabel('Weekly review').selectOption('sun');
  await expect.poll(() => device('laptop').events?.review).toBe('sun');
  // This browser's in-app reminder follows.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('quest.review')!).day)).toBe('sun');
  await mine.getByLabel('Name', { exact: true }).fill('Work laptop');
  await mine.getByLabel('Name', { exact: true }).press('Tab');
  await expect.poll(() => device('laptop').label).toBe('Work laptop');

  // Another device's switches are just as editable.
  const other = section.locator('.push-device[data-id="old-phone"]');
  await other.getByLabel('Warp Zone pull requests').uncheck();
  await expect.poll(() => device('old-phone').events?.warpZone).toBe(false);
  expect(device('old-phone').events).toEqual({ timebox: true, review: 'fri', warpZone: false });

  // Removing asks first.
  await other.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('dialog', { name: 'Remove device' }).getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => config(gh).notify!.devices!.map((d) => d.id)).toEqual(['laptop']);
  // The message is written from the data after the edit, so it names the device by id.
  expect(repo.appCommits().at(-1)!.message).toBe('quest: automation: remove device "old-phone"');

  // The Game tab's review day reaches the device too.
  await page.getByRole('tab', { name: 'Game' }).click();
  await page.getByLabel('Remind me').selectOption('fri');
  await expect.poll(() => device('laptop').events?.review).toBe('fri');

  // Turning this device off unsubscribes it and takes it off the list.
  await page.getByRole('tab', { name: 'Automation' }).click();
  await mine.getByRole('button', { name: 'Turn off here' }).click();
  await page.getByRole('dialog', { name: 'Turn off notifications' }).getByRole('button', { name: 'Turn off' }).click();
  await expect.poll(() => config(gh).notify!.devices).toBeUndefined();
  await expect(section.getByRole('button', { name: 'Turn on for this device' })).toBeVisible();
});

test('offers to remove devices the last run found expired', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  const repo = gh.repo(REPO);
  const start = withDevices([laptop, oldPhone]);
  repo.push({ [CONFIG]: json(start), [STUB_PATH]: renderStub(start, 'main').text }, 'Install');
  repo.secrets.add('QUEST_VAPID_PRIVATE_KEY');
  const ranAt = new Date(Date.now() - 3600_000).toISOString();
  repo.runs = [
    {
      id: 77,
      event: 'schedule',
      status: 'completed',
      conclusion: 'success',
      created_at: ranAt,
      status_json: {
        version: 1,
        ranAt,
        event: 'schedule',
        core: { version: '1.2.1' },
        modules: { notify: { ran: true, reason: '1 sent, 1 expired', ok: true } },
        sent: { laptop: 1 },
        expiredDevices: ['old-phone'],
      },
    },
  ];
  await fakePush(page);
  const section = await openAutomation(page, gh);

  const prompt = section.locator('.push-expired[data-id="old-phone"]');
  await expect(prompt).toHaveText(/Old phone stopped receiving notifications\. Remove it\?/);
  await expect(section.locator('.push-expired')).toHaveCount(1);

  // Keep: it stops asking about this run.
  await prompt.getByRole('button', { name: 'Keep' }).click();
  await expect(prompt).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem('quest.push.kept'));
  await section.getByRole('button', { name: 'Check again' }).click();
  await expect(prompt).toBeVisible();

  await prompt.getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => config(gh).notify!.devices!.map((d) => d.id)).toEqual(['laptop']);
  await expect(prompt).toHaveCount(0);
});

test('a registered device that opens the app saves its renewed subscription', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  const repo = gh.repo(REPO);
  const start = withDevices([laptop]);
  repo.push({ [CONFIG]: json(start), [STUB_PATH]: renderStub(start, 'main').text }, 'Install');
  repo.secrets.add('QUEST_VAPID_PRIVATE_KEY');
  // The browser rotated the laptop's subscription since it was saved.
  await fakePush(page, { deviceId: 'laptop', permission: 'granted', current: { n: 40, key: VAPID.publicKey } });
  await gh.install(page);
  const session = JSON.stringify(gh.session());
  await page.addInitScript(([s, r]) => (localStorage.setItem('quest.github.token', s), localStorage.setItem('quest.github.repo', r)), [session, REPO]);
  await page.goto('./#/');
  await inScene(page, 'projects');

  await expect.poll(() => config(gh).notify!.devices![0].subscription.endpoint).toBe('https://push.example.com/dev-40');
  expect(config(gh).notify!.devices![0]).toMatchObject({ id: 'laptop', label: 'Laptop', timezone: 'Europe/London' });
  // Nothing new to subscribe to: it kept the browser's subscription.
  expect(await page.evaluate(() => (window as unknown as { __push: FakePush }).__push.subscribes)).toBe(0);
});

test('a notification click opens its screen, and the device shows what arrived', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  const repo = gh.repo(REPO);
  const start = withDevices([laptop]);
  repo.push({ [CONFIG]: json(start), [STUB_PATH]: renderStub(start, 'main').text }, 'Install');
  await fakePush(page, { deviceId: 'laptop' });
  const section = await openAutomation(page, gh);

  // The worker logged a push: the page asks for the log when told.
  await page.evaluate(() => {
    const w = window as unknown as { __push: FakePush };
    w.__push.log.push({ kind: 'push', at: new Date().toISOString(), title: 'New PR #3 in the Warp Zone', url: '#/pr/3' });
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'quest-push', id: 'a', entry: w.__push.log[0] } }));
  });
  await expect(section.locator('.push-log')).toContainText('🔔 New PR #3 in the Warp Zone · just now');

  // A click in the worker sends the open app to the push's route; anything else is ignored.
  await page.keyboard.press('Escape');
  const open = (url: string, id: string) =>
    page.evaluate(([u, i]) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'quest-open', url: u, id: i } })), [url, id]);
  await open('https://evil.example.com/', 'b');
  expect(await hash(page)).toBe('#/');
  await open('#/p/home-maintenance', 'c');
  await inScene(page, 'overworld');
  expect(await hash(page)).toBe('#/p/home-maintenance');
});

test.describe('on an iPhone outside the Home Screen', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });

  test('says to add the app to the Home Screen first', async ({ page }) => {
    const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
    await fakePush(page, { noPush: true });
    const section = await openAutomation(page, gh);
    await expect(section.locator('.push-support')).toHaveAttribute('data-support', 'ios-needs-install');
    await expect(section.locator('.push-support')).toContainText('Add to Home Screen');
    await expect(section.getByRole('button', { name: 'Turn on for this device' })).toHaveCount(0);
  });
});
