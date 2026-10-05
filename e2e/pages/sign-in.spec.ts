import { expect, test, type Page } from '@playwright/test';
import { FakeGitHub } from '../fake-github';
import { inScene, skipWelcome } from '../helpers';

// Routes don't see requests a service worker handles: keep it out of the way.
test.use({ serviceWorkers: 'block' });
test.beforeEach(({ page }) => skipWelcome(page));

const LEVEL = '#/p/allotment/summer/brassicas';
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('quest.github.token') ?? 'null'));

/** Starts the app already signed in (once: reloads keep whatever the app saved since). */
async function signedIn(page: Page, session: object, repo = 'player/quests') {
  await page.addInitScript(
    ([s, r]) => {
      if (localStorage.getItem('quest.github.token')) return;
      localStorage.setItem('quest.github.token', s);
      localStorage.setItem('quest.github.repo', r);
    },
    [JSON.stringify(session), repo],
  );
}

/** Ticks the level's first success criterion and returns its checkbox. */
async function tickFirstCriterion(page: Page) {
  const box = page.locator('.panel label.check input').first();
  await expect(box).not.toBeChecked();
  await box.check();
  return box;
}

test('sign in, pick a repo, and edit it', async ({ page }) => {
  const gh = new FakeGitHub({
    repos: [
      { owner: 'player', name: 'quests' },
      { owner: 'family', name: 'house' },
      { owner: 'player', name: 'dotfiles', quest: false },
    ],
  });
  await gh.install(page);
  await page.goto('./#/');
  await inScene(page, 'projects');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();

  // Back from GitHub: the code is gone from the address, and both Quest Log repos are offered.
  const picker = page.getByRole('dialog', { name: 'Choose your repo' });
  await expect(picker).toBeVisible();
  expect(page.url()).not.toMatch(/code=|state=/);
  expect(gh.exchanges).toBe(1);
  await expect(picker.locator('.repo-pick.quest')).toHaveText([/house/, /quests/]);
  expect(await stored(page)).toMatchObject({ kind: 'app', token: 'ghu_2', refresh: 'ghr_2' });

  await picker.locator('.repo-pick.quest', { hasText: 'quests' }).click();
  await inScene(page, 'projects');
  await expect(page.locator('.sync-pill.synced')).toBeVisible();

  await page.goto(`./${LEVEL}`);
  await inScene(page, 'level');
  await tickFirstCriterion(page);
  await expect.poll(() => gh.repo('player/quests').appCommits().length).toBe(1);
  expect(gh.repo('player/quests').appCommits()[0]).toMatchObject({ message: expect.stringMatching(/^quest: /), auth: 'Bearer ghu_2' });
});

test('one Quest Log repo connects straight away', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }, { owner: 'player', name: 'dotfiles', quest: false }] });
  await gh.install(page);
  await page.goto('./#/');
  await inScene(page, 'projects');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(page.locator('.toast', { hasText: 'Signed in. Playing player/quests.' })).toBeVisible();
  await expect(page.locator('.sync-pill.synced')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('quest.github.repo'))).toBe('player/quests');
});

test('an expired token refreshes without the user noticing', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  await gh.install(page);
  const session = gh.session({ expired: true });
  await signedIn(page, session);
  await page.goto(`./${LEVEL}`);
  await inScene(page, 'level');
  await expect(page.locator('.sync-pill.synced')).toBeVisible();

  expect(gh.refreshes).toBe(1);
  // Never sent the dead token; saved the rotated pair.
  expect(gh.seen).not.toContain(`Bearer ${session.token}`);
  expect(await stored(page)).toMatchObject({ kind: 'app', token: 'ghu_2', refresh: 'ghr_2' });

  await tickFirstCriterion(page);
  await expect.poll(() => gh.repo('player/quests').appCommits().length).toBe(1);
});

test('an expired sign-in keeps the edits and syncs them after signing in again', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  await gh.install(page);
  await signedIn(page, gh.session());
  await page.goto(`./${LEVEL}`);
  await inScene(page, 'level');
  await expect(page.locator('.sync-pill.synced')).toBeVisible();

  // Revoked on GitHub: the edit can't sync, and refreshing fails too.
  gh.revokeAll();
  await tickFirstCriterion(page);
  const warning = page.locator('.toast', { hasText: 'Your GitHub sign-in has expired' });
  await expect(warning).toBeVisible();
  await expect(page.locator('.sync-pill.error')).toBeVisible();
  expect(gh.repo('player/quests').appCommits()).toHaveLength(0);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Your GitHub sign-in has expired. 1 edit(s) are kept')).toBeVisible();
  // Signed in again in the window, the app reloads onto the repo. Wait for that reload, or the
  // old level scene passes inScene and the check after it runs mid-reload.
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Sign in again' }).click()]);

  // Back on the same screen and repo, and the queued edit goes out with the new token.
  await inScene(page, 'level');
  await expect.poll(() => gh.repo('player/quests').appCommits().length).toBe(1);
  expect(gh.repo('player/quests').appCommits()[0].auth).toMatch(/^Bearer ghu_\d+$/);
  await expect(page.locator('.panel label.check input').first()).toBeChecked();
  await expect(page.locator('.sync-pill.synced')).toBeVisible();
});

test('with no repo yet, the next steps tick off by themselves as the user sets up on GitHub', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [], installed: false });
  await gh.install(page);
  await page.goto('./#/');
  await inScene(page, 'projects');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();

  const picker = page.getByRole('dialog', { name: 'Choose your repo' });
  const steps = picker.locator('.next-steps li');
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(0)).toHaveClass(/done/);
  await expect(picker.getByRole('link', { name: 'Create my quest repo ↗' })).toHaveAttribute('href', /template_name=quest-log-template/);
  await expect(picker.getByRole('link', { name: 'Install Quest Log ↗' })).toHaveAttribute('href', 'https://github.com/apps/quest-log-e2e/installations/new');
  await expect(picker.locator('.watch.live')).toContainText('Watching GitHub');

  // Installed on a repo with no quest log in it: that repo can be used, and the steps move on.
  gh.addRepo({ owner: 'player', name: 'notes', quest: false });
  await expect(steps.nth(2)).toHaveClass(/done/, { timeout: 15_000 });
  await expect(picker.locator('.repo-pick', { hasText: 'notes' })).toContainText('START HERE');

  // Then the repo made from the template: found, ready to play, and the checking stops.
  gh.addRepo({ owner: 'player', name: 'quests' });
  const play = picker.locator('.repo-pick', { hasText: 'quests' });
  await expect(play).toContainText('PLAY', { timeout: 15_000 });
  await expect(picker.locator('.watch.live')).toHaveCount(0);
  await play.click();
  await inScene(page, 'projects');
  await expect(page.locator('.sync-pill.synced')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('quest.github.repo'))).toBe('player/quests');
});

test('on desktop, GitHub opens in a small window and the app never leaves the page', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }, { owner: 'family', name: 'house' }] });
  await gh.install(page);
  await page.goto('./#/');
  await inScene(page, 'projects');
  // Survives only if this page is never unloaded.
  await page.evaluate(() => ((window as unknown as { stayed: boolean }).stayed = true));

  await page.getByRole('button', { name: 'Settings' }).click();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Sign in with GitHub' }).click()]);
  await expect(page.getByRole('dialog', { name: 'Signing in…' })).toBeVisible();
  // The popup lands back on our page, hands over the code, and closes itself.
  await popup.waitForEvent('close');

  const picker = page.getByRole('dialog', { name: 'Choose your repo' });
  await expect(picker.locator('.repo-pick.quest')).toHaveCount(2);
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);
  expect(gh.exchanges).toBe(1);
  expect(await stored(page)).toMatchObject({ kind: 'app' });
});

test('installing Quest Log in a window ticks the checklist off at once', async ({ page, baseURL }) => {
  const gh = new FakeGitHub({ repos: [], installed: false });
  await gh.install(page);
  await page.addInitScript((s) => {
    if (!localStorage.getItem('quest.github.token')) localStorage.setItem('quest.github.token', s);
  }, JSON.stringify(gh.session()));
  await page.goto('./#/');
  await inScene(page, 'projects');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Choose a repo' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your repo' });
  await expect(picker.locator('.watch.live')).toContainText('checked');

  gh.installReturn = { redirectUri: baseURL!, repo: { owner: 'player', name: 'quests' } };
  const [popup] = await Promise.all([page.waitForEvent('popup'), picker.getByRole('link', { name: 'Install Quest Log ↗' }).click()]);
  await popup.waitForEvent('close');
  // Told by the popup, not by the next 5-second poll.
  await expect(picker.locator('.repo-pick.quest', { hasText: 'quests' })).toContainText('PLAY', { timeout: 3000 });
});

test('if the window is blocked, sign-in goes to GitHub and back in this tab', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }, { owner: 'family', name: 'house' }] });
  await gh.install(page);
  await page.addInitScript(() => (window.open = () => null));
  await page.goto('./#/');
  await inScene(page, 'projects');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your repo' });
  await expect(picker.locator('.repo-pick.quest')).toHaveCount(2);
  expect(page.url()).not.toMatch(/code=|state=/);
  expect(gh.exchanges).toBe(1);
});

test('cancelling on GitHub changes nothing', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  await gh.install(page);
  await page.context().route('https://github.com/login/oauth/authorize?**', (route) => {
    const url = new URL(route.request().url());
    const back = new URL(url.searchParams.get('redirect_uri')!);
    back.search = `?error=access_denied&state=${url.searchParams.get('state')}`;
    return route.fulfill({ status: 302, headers: { Location: back.href } });
  });
  await page.goto('./#/');
  await inScene(page, 'projects');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(page.locator('.toast', { hasText: 'Sign-in cancelled.' })).toBeVisible();
  expect(page.url()).not.toMatch(/error=/);
  expect(await stored(page)).toBeNull();
  expect(gh.exchanges).toBe(0);
});
