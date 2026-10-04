import { GitHubError, SignInExpiredError } from '@quest/shared';
import type { App } from '../app';
import type { FoundRepo, ScannedRepo, SetupScan } from '../auth/discover';
import { installUrl, repoScanner, startSignIn, TEMPLATE_URL } from '../auth/signin';
import { patchUiPrefs, reloadWithMode, savedRepo, setRepo } from '../config';
import { h, relTime } from './dom';
import { openModal } from './modal';

/** How often the next-steps list asks GitHub while the user sets things up there. */
const POLL_MS = 5000;
/** Stop asking after this long without finding a Quest Log repo; "Look again" starts over. */
const GIVE_UP_MS = 10 * 60_000;

/** Connects to a repo and restarts on it (the get-started guide resumes at the hero page). */
export function useRepo(fullName: string, opts: { setup?: boolean } = {}) {
  setRepo(fullName);
  if (opts.setup) patchUiPrefs({ setup: { step: 'hero' } });
  reloadWithMode(undefined, '#/');
}

const ext = (href: string, label: string, cls = 'btn sm') => h('a', { class: cls, href, target: '_blank', rel: 'noopener' }, `${label} ↗`);

/**
 * The signed-in user's Quest Log repos to choose from. With none yet, the next steps on
 * GitHub (make a repo from the template, let Quest Log use it), ticked off as they happen:
 * it asks GitHub every few seconds while the tab is showing, and at once when the user comes
 * back to it. Any repo Quest Log can reach can be used straight away.
 */
export function repoChoice(opts: { repos?: FoundRepo[]; setup?: boolean }): HTMLElement {
  const box = h('div', { class: 'repo-choice', 'aria-live': 'polite' });
  const current = savedRepo();
  const scanner = repoScanner();
  // Straight after sign-in the Quest Log repos are already known: show them at once.
  let scan: SetupScan | undefined = opts.repos?.length ? { installations: 1, repos: opts.repos.map((r) => ({ ...r, kind: 'quest' as const })) } : undefined;
  let error: string | undefined;
  let expired = false;
  let checkedAt: number | undefined;
  let startedAt = Date.now();
  let busy = false;
  let watching = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const pick = (r: FoundRepo, label: string, cls = '') =>
    h(
      'button',
      { class: `repo-pick${r.fullName === current ? ' current' : ''}${cls}`, type: 'button', onclick: () => useRepo(r.fullName, { setup: opts.setup }) },
      h('b', null, r.name),
      h('small', null, `${r.owner}${r.private ? ' · private' : ''} · pushed ${relTime(r.pushedAt)}`),
      h('span', { class: 'pill' }, r.fullName === current ? 'IN USE' : label),
    );

  /** Repos Quest Log can reach that have no quest log yet: fine to start one in (unless empty). */
  const others = (repos: ScannedRepo[]) =>
    h(
      'ul',
      { class: 'repo-list' },
      repos.map((r) =>
        h(
          'li',
          null,
          r.kind === 'empty'
            ? h('div', { class: 'repo-pick disabled' }, h('b', null, r.name), h('small', null, `${r.owner} · empty: add a README on GitHub first`), h('span', { class: 'pill' }, 'EMPTY'))
            : pick(r, 'START HERE'),
        ),
      ),
    );

  const status = () => {
    if (expired)
      return h('p', { class: 'note warn' }, 'Your GitHub sign-in has expired. ', h('button', { class: 'link-button', type: 'button', onclick: () => void startSignIn({ setup: opts.setup }) }, 'Sign in again'), '.');
    if (error) return h('p', { class: 'note warn' }, `Couldn’t reach GitHub (${error}). Trying again…`);
    if (!watching) return h('p', { class: 'watch' }, 'Stopped checking. ', h('button', { class: 'link-button', type: 'button', onclick: restart }, 'Look again'));
    return h('p', { class: 'watch live' }, h('i', { class: 'dot', 'aria-hidden': 'true' }), checkedAt ? `Watching GitHub for your repo · checked ${relTime(new Date(checkedAt).toISOString())}` : 'Checking GitHub…');
  };

  const render = () => {
    if (!scan && !error && !expired) return void box.replaceChildren(h('p', { class: 'muted' }, 'Looking for your repos…'));
    const repos = scan?.repos ?? [];
    const quest = repos.filter((r) => r.kind === 'quest');
    const rest = repos.filter((r) => r.kind !== 'quest');
    if (quest.length) {
      box.replaceChildren(
        h('p', null, quest.length === 1 ? 'Found your Quest Log repo:' : 'Found these Quest Log repos. Which one do you want to play?'),
        h('ul', { class: 'repo-list' }, quest.map((r) => h('li', null, pick(r, 'PLAY ▶', ' quest')))),
        ...(rest.length ? [h('details', null, h('summary', null, 'Start a new quest log in another repo'), others(rest))] : []),
        h('small', { class: 'muted' }, 'Missing one? ', h('a', { class: 'link', href: installUrl(), target: '_blank', rel: 'noopener' }, 'Add it to Quest Log ↗'), ' on GitHub, then come back here.'),
      );
      return;
    }
    const installed = !!scan && scan.installations > 0;
    const canSee = rest.length > 0;
    const step = (done: boolean, title: string, ...body: (Node | false)[]) =>
      h('li', { class: done ? 'done' : 'todo' }, h('b', null, title), ...body.filter((n): n is Node => !!n));
    box.replaceChildren(
      h('p', null, 'Nearly there! Two things to do on GitHub. Then come back to this tab: it notices by itself.'),
      h(
        'ol',
        { class: 'next-steps' },
        step(true, 'Sign in to GitHub'),
        // Done once a Quest Log repo turns up, which this list then makes way for.
        step(
          false,
          'Make a repo for your quests',
          h('span', null, 'Start from the Quest Log template. Any name works, and private is fine.'),
          h('div', { class: 'actions' }, ext(TEMPLATE_URL, 'Create my quest repo', 'btn sm primary')),
        ),
        step(
          canSee,
          'Let Quest Log use it',
          h(
            'span',
            null,
            canSee
              ? 'Quest Log can see your repos. Made a new one? Add it on GitHub too, if it isn’t below.'
              : installed
                ? 'Quest Log is installed, but can’t see any repos yet. On GitHub, under Repository access, add your quest repo and press Save.'
                : 'Install Quest Log on GitHub: choose “Only select repositories”, pick your quest repo, then press Install.',
          ),
          h('div', { class: 'actions' }, ext(installUrl(), installed ? 'Add my repo to Quest Log' : 'Install Quest Log')),
        ),
        step(
          false,
          'Pick it here',
          h('span', null, canSee ? 'None of these has a quest log yet. Start one in any of them, or make one from the template.' : 'It appears here as soon as Quest Log can see it.'),
        ),
      ),
      ...(canSee ? [others(rest)] : []),
      status(),
    );
  };

  const schedule = () => {
    clearTimeout(timer);
    if (watching && !expired) timer = setTimeout(() => void tick(), POLL_MS);
  };

  async function tick() {
    // Closed (the dialog, or the guide moved on): stop for good.
    if (!box.isConnected && checkedAt !== undefined) return stop();
    // In the background: wait (after a first look). Coming back to the tab checks at once (see onBack).
    if (busy || (document.hidden && checkedAt !== undefined)) return schedule();
    busy = true;
    try {
      scan = await scanner.scan();
      error = undefined;
      checkedAt = Date.now();
    } catch (err) {
      if (err instanceof SignInExpiredError) expired = true;
      else error = err instanceof GitHubError ? `GitHub answered ${err.status}` : 'no connection';
    }
    busy = false;
    if (scan?.repos.some((r) => r.kind === 'quest') || Date.now() - startedAt > GIVE_UP_MS) watching = false;
    render();
    schedule();
  }

  function restart() {
    watching = true;
    startedAt = Date.now();
    void tick();
  }

  const onBack = () => {
    if (!box.isConnected) return stop();
    if (!document.hidden && watching && !expired) void tick();
  };
  function stop() {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onBack);
    window.removeEventListener('focus', onBack);
  }
  document.addEventListener('visibilitychange', onBack);
  window.addEventListener('focus', onBack);

  render();
  void tick();
  return box;
}

/** The repo picker as a dialog (after sign-in, or Settings → Change repo). */
export function openRepoPicker(_app: App, repos?: FoundRepo[]) {
  openModal('Choose your repo', repoChoice({ repos }));
}
