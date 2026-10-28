import { expect, test, type Page } from '@playwright/test';
import { renderStub, STUB_PATH } from '../../shared/src/stub';
import type { AutomationConfig } from '../../shared/src/automation';
import { FakeGitHub } from '../fake-github';
import { inScene, skipWelcome } from '../helpers';

// Routes don't see requests a service worker handles: keep it out of the way.
test.use({ serviceWorkers: 'block' });
test.beforeEach(({ page }) => skipWelcome(page));

const CONFIG = 'data/automation.json';
const REPO = 'player/quests';

/** A config with one device that wants time-box pushes, so the workflow has a schedule. */
const withDevice: AutomationConfig = {
  notify: {
    enabled: true,
    devices: [
      {
        id: 'laptop',
        label: 'Laptop',
        addedAt: '2026-10-20T09:00:00Z',
        timezone: 'Europe/London',
        subscription: { endpoint: 'https://push.example.com/laptop', keys: { p256dh: 'p256dh', auth: 'auth' } },
      },
    ],
  },
};
const json = (a: AutomationConfig) => JSON.stringify(a, null, 2) + '\n';

/** Signs in to `player/quests` and opens Settings on the Automation section. */
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

const workflow = (gh: FakeGitHub) => gh.repo(REPO).files()[STUB_PATH];
const schedule = (text: string) => /cron: '([^']+)'/.exec(text)?.[1] ?? null;

test('installs the workflow and automation.json in one commit, then edits re-render it', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  const repo = gh.repo(REPO);
  const section = await openAutomation(page, gh);

  await expect(section.locator('.stub-state')).toHaveAttribute('data-state', 'missing');
  await expect(section.locator('.last-run')).toHaveText('No runs yet.');
  // Nothing wants a scheduled push yet: the schedule is greyed out.
  await expect(section.getByLabel('Schedule')).toBeDisabled();

  await section.getByRole('button', { name: 'Install workflow' }).click();
  await expect(section.locator('.stub-state')).toHaveAttribute('data-state', 'current');
  const install = repo.appCommits().at(-1)!;
  expect(install.message).toBe('quest: automation: install the workflow');
  expect(repo.changed(install)).toEqual([STUB_PATH, CONFIG]);
  expect(JSON.parse(repo.files()[CONFIG])).toMatchObject({ channel: 'stable', schedule: { every: '3h' }, validate: { enabled: true, comment: true } });
  expect(workflow(gh)).toBe(renderStub(JSON.parse(repo.files()[CONFIG]), 'main').text);
  expect(schedule(workflow(gh))).toBeNull();

  // A setting the workflow doesn't depend on: only automation.json changes.
  const before = repo.appCommits().length;
  await section.getByLabel('Comment on pull requests').uncheck();
  await expect.poll(() => repo.appCommits().length).toBe(before + 1);
  expect(repo.changed(repo.appCommits().at(-1)!)).toEqual([CONFIG]);
  expect(JSON.parse(repo.files()[CONFIG]).validate).toEqual({ enabled: true, comment: false });
  // Turning checks off greys out the PR comment toggle.
  await section.getByLabel('Check every change').uncheck();
  await expect(section.getByLabel('Comment on pull requests')).toBeDisabled();
  await expect.poll(() => JSON.parse(repo.files()[CONFIG]).validate.enabled).toBe(false);

  // The channel is in the workflow: both files change in one commit.
  await section.getByLabel('Channel').selectOption('beta');
  await expect.poll(() => workflow(gh)).toContain('uses: lilmuckers/quest-log-actions@main');
  expect(repo.changed(repo.appCommits().at(-1)!)).toEqual([STUB_PATH, CONFIG]);
  await expect(section.locator('.stub-state')).toHaveAttribute('data-state', 'current');
});

test('the schedule re-renders the cron, and drops it when nothing scheduled is on', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  const repo = gh.repo(REPO);
  repo.push({ [CONFIG]: json(withDevice), [STUB_PATH]: renderStub(withDevice, 'main').text }, 'Install by hand');
  const section = await openAutomation(page, gh);

  await expect(section.locator('.stub-state')).toHaveAttribute('data-state', 'current');
  const every = section.getByLabel('Schedule');
  await expect(every).toBeEnabled();
  await expect(every).toHaveValue('3h');
  await expect(section.locator('.schedule-note')).toContainText('about 240 Actions minutes a month');
  expect(schedule(workflow(gh))).toBe('17 */3 * * *');

  await every.selectOption('1h');
  await expect.poll(() => schedule(workflow(gh))).toBe('17 * * * *');
  expect(repo.changed(repo.appCommits().at(-1)!)).toEqual([STUB_PATH, CONFIG]);
  await expect(section.locator('.schedule-note')).toContainText('about 720 Actions minutes a month');

  await every.selectOption('off');
  await expect.poll(() => workflow(gh).includes('schedule:')).toBe(false);

  // Back on, then notifications off: no scheduled event is left, so schedule: goes again.
  await every.selectOption('6h');
  await expect.poll(() => schedule(workflow(gh))).toBe('17 */6 * * *');
  await section.getByLabel('Notifications').uncheck();
  await expect.poll(() => workflow(gh).includes('schedule:')).toBe(false);
  await expect(every).toBeDisabled();
  await expect(section.locator('.stub-state')).toHaveAttribute('data-state', 'current');
});

test('a hand-edited cron shows the drift banner, and Re-write fixes it', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  const repo = gh.repo(REPO);
  const right = renderStub(withDevice, 'main').text;
  repo.push({ [CONFIG]: json(withDevice), [STUB_PATH]: right.replace("cron: '17 */3 * * *'", "cron: '0 9 * * *'") }, 'Edit the cron');
  const section = await openAutomation(page, gh);

  const banner = section.locator('.stub-state');
  await expect(banner).toHaveAttribute('data-state', 'drift');
  await expect(banner).toContainText('changed outside Quest Log');
  await banner.getByRole('button', { name: 'Re-write workflow' }).click();
  await expect(banner).toHaveAttribute('data-state', 'current');
  expect(workflow(gh)).toBe(right);
  const fix = repo.appCommits().at(-1)!;
  expect(fix.message).toBe('quest: automation: re-write the workflow');
  expect(repo.changed(fix)).toEqual([STUB_PATH]);
});

test('offers to replace the legacy workflow, and asks before replacing someone else’s', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  gh.repo(REPO).push({ [STUB_PATH]: 'name: CI\non: push\njobs: {}\n' }, 'Their own CI');
  const section = await openAutomation(page, gh);
  const banner = section.locator('.stub-state');
  await expect(banner).toHaveAttribute('data-state', 'foreign');
  await banner.getByRole('button', { name: 'Replace it' }).click();
  const confirm = page.getByRole('dialog', { name: 'Replace workflow' });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  expect(workflow(gh)).toBe('name: CI\non: push\njobs: {}\n');

  gh.repo(REPO).push({ [STUB_PATH]: 'name: Quest data\non: [push, pull_request]\n' }, 'Back to the old one');
  await section.getByRole('button', { name: 'Check again' }).click();
  await expect(banner).toHaveAttribute('data-state', 'legacy');
  await banner.getByRole('button', { name: 'Replace workflow' }).click();
  await expect(banner).toHaveAttribute('data-state', 'current');
});

test('shows the last run from its quest-status artifact', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  const repo = gh.repo(REPO);
  repo.push({ [CONFIG]: json({ channel: 'stable' }), [STUB_PATH]: renderStub({ channel: 'stable' }, 'main').text }, 'Install');
  repo.secrets.add('QUEST_VAPID_PRIVATE_KEY');
  const ranAt = new Date(Date.now() - 2 * 3600_000).toISOString();
  repo.runs = [
    {
      id: 4242,
      event: 'push',
      status: 'completed',
      conclusion: 'success',
      created_at: ranAt,
      status_json: {
        version: 1,
        ranAt,
        event: 'push',
        core: { version: '1.1.0' },
        modules: { validate: { ran: true, reason: 'push to main', ok: true }, notify: { ran: false, reason: 'notify is off' } },
        sent: {},
        expiredDevices: [],
      },
    },
  ];
  const section = await openAutomation(page, gh);

  // Read through the Actions API and the artifact zip. On GitHub the zip redirects to Azure blob
  // storage, which the fake can't stand in for: check the CSP lets that host through instead.
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toMatch(/connect-src [^;]*https:\/\/\*\.blob\.core\.windows\.net/);
  const run = section.locator('.last-run');
  await expect(run).toContainText(/Last run 2h \d+m ago · push · ✓ passed · core 1\.1\.0/);
  await expect(run.getByRole('link', { name: 'view on GitHub' })).toHaveAttribute('href', 'https://github.com/player/quests/actions/runs/4242');
  await expect(run.locator('li')).toHaveText(['✓ validate: push to main', '– notify: notify is off']);
  await expect(section.locator('.secrets')).toContainText('QUEST_VAPID_PRIVATE_KEY ✓ set');

  // A run in progress has no status yet.
  repo.runs.unshift({ id: 4243, event: 'schedule', status: 'in_progress', conclusion: null, created_at: new Date().toISOString() });
  await section.getByRole('button', { name: 'Check again' }).click();
  await expect(run).toContainText('schedule · ⏳ running');
  await expect(run).toContainText('Still running.');
});

test('is hidden without a GitHub repo', async ({ page }) => {
  await page.goto('./#/');
  await inScene(page, 'projects');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'GitHub & sync' }).click();
  await expect(page.getByRole('heading', { name: 'Sync' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Automation' })).toHaveCount(0);

  await page.goto('./?demo#/');
  await inScene(page, 'projects');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'GitHub & sync' }).click();
  await expect(page.getByRole('heading', { name: 'Demo' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Automation' })).toHaveCount(0);
});
