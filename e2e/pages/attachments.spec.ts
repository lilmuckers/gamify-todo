import { expect, test, type Page } from '@playwright/test';
import { ATTACHMENT_LABEL, attachmentFilePath, attachmentSidecarPath } from '../../shared/src';
import { validateFiles } from '../../shared/src/validate';
import { FakeGitHub } from '../fake-github';
import { inScene, skipWelcome } from '../helpers';

// Routes don't see requests a service worker handles: keep it out of the way. The held-up
// pad sways forever, which Playwright never calls stable enough to click: reduce motion.
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
test.beforeEach(({ page }) => skipWelcome(page));

const REPO = 'player/quests';

/** A 2×2 red PNG, so the browser has a real image to shrink. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
);
const photo = { name: 'receipt.png', mimeType: 'image/png', buffer: PNG };

/** Signs in to `player/quests` and opens the inbox. */
async function openInbox(page: Page, gh: FakeGitHub) {
  await gh.install(page);
  const session = JSON.stringify(gh.session());
  await page.addInitScript(
    ([s, r]) => {
      localStorage.setItem('quest.github.token', s);
      localStorage.setItem('quest.github.repo', r);
    },
    [session, REPO],
  );
  await page.goto('./#/~inbox');
  await inScene(page, 'projects');
  await expect(page.locator('.sync-pill.synced')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a photo' })).toBeVisible();
}

test('📷 uploads a photo as its own labelled pull request, shown waiting and in the Warp Zone', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  const repo = gh.repo(REPO);
  const before = repo.head;
  await openInbox(page, gh);

  await page.locator('.pad-capture input[type=file]').setInputFiles(photo);
  const row = page.locator('.pad-photos .pad-line.photo');
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('link', { name: /#1$/ })).toBeVisible();
  await expect(row.locator('.pad-where')).toContainText('waiting');
  await expect(row.locator('img.pad-photo')).toHaveAttribute('src', /^blob:/);

  // One branch, one pull request with the photo and its sidecar, labelled; main untouched.
  expect(repo.head).toBe(before);
  expect(repo.pulls).toHaveLength(1);
  const [pull] = repo.pulls;
  expect(pull).toMatchObject({ title: '📷 New photo', base: 'main', labels: [ATTACHMENT_LABEL] });
  const id = pull.head.replace('quest/attach/', '');
  expect(await row.getAttribute('data-photo')).toBe(id);
  const sha = repo.branches.get(pull.head)!;
  const files = repo.files(sha);
  const jpg = repo.bytes(attachmentFilePath(id, 'jpg'), sha)!;
  expect([...jpg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  const sidecar = JSON.parse(files[attachmentSidecarPath(id)]);
  expect(sidecar).toMatchObject({ id, via: 'button' });
  expect(repo.changed(repo.commits.get(sha)!)).toEqual([attachmentFilePath(id, 'jpg'), attachmentSidecarPath(id)]);
  expect(validateFiles({ ...files, [attachmentFilePath(id, 'jpg')]: '' }, [attachmentSidecarPath(id), attachmentFilePath(id, 'jpg')])).toEqual([]);

  // The row's link opens it in the Warp Zone.
  await row.getByRole('link').click();
  await expect(page.getByRole('heading', { name: '#1 📷 New photo' })).toBeVisible();
  await expect(page.getByText('Attachments')).toBeVisible();
  // The photo itself shows, loaded from the PR's branch, with its sidecar's words.
  const shown = page.locator(`.pr-attachment[data-attachment="${id}"]`);
  await expect(shown.locator('figcaption code')).toHaveText(`${id}.jpg`);
  await expect(shown.locator('figcaption')).toContainText('added with 📷');
  await expect(shown.locator('img')).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => shown.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2);
  await expect(shown.locator('a.pr-photo')).toHaveAttribute('href', /^blob:/);
});

test('a photo added offline waits here, then uploads once back online', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  const repo = gh.repo(REPO);
  await openInbox(page, gh);

  await page.context().setOffline(true);
  await page.locator('.pad-capture input[type=file]').setInputFiles(photo);
  const row = page.locator('.pad-photos .pad-line.photo');
  await expect(row.locator('.pad-where')).toHaveText('saved here, not sent yet');
  expect(repo.pulls).toHaveLength(0);

  await page.context().setOffline(false);
  await expect(row.getByRole('link', { name: /#1$/ })).toBeVisible();
  await expect(row).toHaveCount(1);
  expect(repo.pulls).toHaveLength(1);
});

test('pasting a photo into the scribble line uploads it too', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  const repo = gh.repo(REPO);
  await openInbox(page, gh);

  await page.getByRole('textbox', { name: 'New idea' }).evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'clip.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, PNG.toString('base64'));
  await expect(page.locator('.pad-photos .pad-line.photo').getByRole('link', { name: /#1$/ })).toBeVisible();
  const id = repo.pulls[0].head.replace('quest/attach/', '');
  expect(JSON.parse(repo.files(repo.branches.get(repo.pulls[0].head)!)[attachmentSidecarPath(id)])).toMatchObject({ via: 'paste' });
  await expect(page.getByRole('textbox', { name: 'New idea' })).toHaveValue('');
});
