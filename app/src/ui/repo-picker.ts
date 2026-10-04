import type { App } from '../app';
import { findRepos, installUrl, TEMPLATE_URL } from '../auth/signin';
import type { FoundRepo } from '../auth/discover';
import { patchUiPrefs, reloadWithMode, savedRepo, setRepo } from '../config';
import { h, relTime } from './dom';
import { openModal } from './modal';

/** Connects to a repo and restarts on it (the get-started guide resumes at the hero page). */
export function useRepo(fullName: string, opts: { setup?: boolean } = {}) {
  setRepo(fullName);
  if (opts.setup) patchUiPrefs({ setup: { step: 'hero' } });
  reloadWithMode(undefined, '#/');
}

/**
 * The signed-in user's Quest Log repos to choose from, or the ways to get one: make a repo
 * from the template, or give the App access to one they already have. Lists them itself
 * unless `repos` is passed in (straight after sign-in, which just did).
 */
export function repoChoice(opts: { repos?: FoundRepo[]; setup?: boolean }): HTMLElement {
  const box = h('div', { class: 'repo-choice', 'aria-live': 'polite' });
  const current = savedRepo();
  const show = (repos: FoundRepo[]) => {
    if (!repos.length) {
      box.replaceChildren(
        h('p', null, 'No Quest Log repo yet. Make one from the template (private is fine), then let Quest Log use it. Or add a repo you already have.'),
        h(
          'div',
          { class: 'actions' },
          h('a', { class: 'btn sm primary', href: TEMPLATE_URL, target: '_blank', rel: 'noopener' }, 'Create my quest repo ↗'),
          // Same tab: GitHub comes straight back here once the repo is added.
          h('a', { class: 'btn sm', href: installUrl() }, 'Add a repo to Quest Log'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: load }, 'Look again'),
        ),
        h('small', { class: 'muted' }, 'A repo counts once its data/ folder has settings.json or a game in it. The template comes with settings.json.'),
      );
      return;
    }
    box.replaceChildren(
      h('p', null, repos.length === 1 ? 'Found your Quest Log repo:' : 'Found these Quest Log repos. Which one do you want to play?'),
      h(
        'ul',
        { class: 'repo-list' },
        repos.map((r) =>
          h(
            'li',
            null,
            h(
              'button',
              { class: `repo-pick${r.fullName === current ? ' current' : ''}`, type: 'button', onclick: () => useRepo(r.fullName, { setup: opts.setup }) },
              h('b', null, r.name),
              h('small', null, `${r.owner}${r.private ? ' · private' : ''} · pushed ${relTime(r.pushedAt)}`),
              r.fullName === current && h('span', { class: 'pill' }, 'IN USE'),
            ),
          ),
        ),
      ),
      h('small', { class: 'muted' }, 'Missing one? ', h('a', { class: 'link', href: installUrl() }, 'Add it to Quest Log'), ' on GitHub.'),
    );
  };
  function load() {
    box.replaceChildren(h('p', { class: 'muted' }, 'Looking for your repos…'));
    findRepos()
      .then((r) => show(r.repos))
      .catch((err: Error) =>
        box.replaceChildren(h('p', { class: 'note warn' }, `Couldn’t list your repos: ${err.message}`), h('button', { class: 'btn sm', type: 'button', onclick: load }, 'Try again')),
      );
  }
  if (opts.repos) show(opts.repos);
  else load();
  return box;
}

/** The repo picker as a dialog (after sign-in, or Settings → Change repo). */
export function openRepoPicker(_app: App, repos?: FoundRepo[]) {
  openModal('Choose your repo', repoChoice({ repos }));
}
