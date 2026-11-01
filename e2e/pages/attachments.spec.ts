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
  expect(sidecar).toMatchObject({
    id,
    via: 'button',
    capturedWith: { kind: 'desktop', browser: expect.stringMatching(/^Chrome \d+$/), installed: false, app: expect.any(String) },
    original: { name: 'receipt.png', type: 'image/png', bytes: PNG.length, width: 2, height: 2 },
  });
  expect(sidecar.capturedWith).not.toHaveProperty('device');
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
  await expect(shown.locator('.pr-photo-device')).toContainText(/desktop · Chrome \d+ · build /);
  await expect(shown.locator('.pr-photo-original')).toHaveText(`original · receipt.png · 2×2 · 1 KB`);
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

test('a photo’s details are edited on its pull request, then it shows on the item it’s attached to once merged', async ({ page }) => {
  const gh = new FakeGitHub({ repos: [{ owner: 'player', name: 'quests' }] });
  const repo = gh.repo(REPO);
  await openInbox(page, gh);
  await page.locator('.pad-capture input[type=file]').setInputFiles(photo);
  await page.locator('.pad-photos .pad-line.photo').getByRole('link', { name: /#1$/ }).click();

  const shown = page.locator('.pr-attachment');
  await shown.getByText('Edit details').click();
  await shown.getByLabel('Title').fill('Tile receipt');
  await shown.getByLabel('Notes').fill('Splashback tiles, 4 boxes');
  await shown.getByLabel('Taken on').fill('2026-10-27');
  await shown.getByLabel('Tags (comma between)').fill('receipt, tiles, receipt');
  await shown.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Kitchen Renovation' });
  await shown.getByRole('combobox', { name: 'World' }).selectOption({ label: 'Fit-out' });
  await shown.getByRole('combobox', { name: 'Level' }).selectOption({ label: 'Splashback and floor' });
  await shown.getByRole('combobox', { name: 'Item' }).selectOption({ label: 'Choose the splashback tiles' });
  await shown.getByRole('button', { name: 'Save to the pull request' }).click();

  // One commit on the PR's branch rewrites the sidecar; main is untouched.
  await expect(shown.locator('figcaption strong')).toHaveText('Tile receipt');
  await expect(shown.locator('.pr-photo-link')).toHaveText('📎 Kitchen Renovation › Fit-out › Splashback and floor › Choose the splashback tiles');
  await expect(shown.locator('figcaption')).toContainText('taken 2026-10-27 · #receipt #tiles');
  const [pull] = repo.pulls;
  const id = pull.head.replace('quest/attach/', '');
  const head = repo.commits.get(repo.branches.get(pull.head)!)!;
  expect(head.message).toBe('quest: attach: details: Tile receipt');
  expect(repo.changed(head)).toEqual([attachmentSidecarPath(id)]);
  expect(JSON.parse(repo.files(repo.branches.get(pull.head)!)[attachmentSidecarPath(id)])).toMatchObject({
    id,
    via: 'button',
    title: 'Tile receipt',
    text: 'Splashback tiles, 4 boxes',
    takenOn: '2026-10-27',
    tags: ['receipt', 'tiles'],
    attachedTo: { project: 'kitchen-renovation', world: 'fit', level: 'tiling', item: 'choose-the-splashback-tiles' },
    // What the app recorded when it was added survives the edit.
    capturedWith: { kind: 'desktop' },
    original: { name: 'receipt.png', width: 2, height: 2 },
  });

  // Merged, it hangs off the item, its level, world and project.
  repo.merge(pull.number);
  await page.goto('./#/p/kitchen-renovation/fit/tiling');
  await page.reload();
  const card = page.locator('#item-choose-the-splashback-tiles');
  await expect(card.locator('.tag.photos')).toHaveText('📷 1');
  await card.locator('.item-title').click();
  const strip = card.locator('.photo-strip li');
  await expect(strip).toHaveCount(1);
  await expect(strip.locator('.photo-title')).toHaveText('Tile receipt');
  await expect.poll(() => strip.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2);
  await expect(page.getByText('Photos · 1')).toBeVisible();
  await page.goto('./#/p/kitchen-renovation/fit');
  await expect(page.locator('.photo-strip li small').first()).toHaveText('Splashback and floor › Choose the splashback tiles');
});
