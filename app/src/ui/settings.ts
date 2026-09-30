import { describeOp, GitHubClient, parseRepo } from '@quest/shared';
import type { App } from '../app';
import { chosenBranch, repoRef, setRepo, setUiPrefs, TARGET, tokenStore, uiPrefs } from '../config';
import { h, relTime } from './dom';
import { confirmDialog, openModal } from './modal';
import { toast } from './toast';

export function settingsDialog(app: App) {
  const s = app.store;
  const body = h('div', { class: 'settings' });

  if (TARGET === 'pages') {
    const cur = repoRef();
    const repo = h('input', { type: 'text', value: cur ? `${cur.owner}/${cur.repo}` : '', placeholder: 'owner/repo' });
    const branch = h('input', { type: 'text', value: chosenBranch() ?? '', placeholder: 'default branch' });
    const token = h('input', { type: 'password', value: '', placeholder: tokenStore.get() ? '•••••• (saved)' : 'github_pat_…', autocomplete: 'off' });
    const status = h(
      'small',
      { class: 'muted' },
      !tokenStore.get()
        ? 'Not connected: read-only view of this site’s data.'
        : app.caps.canEdit
          ? `Connected to ${s.source.label}: edits commit straight to GitHub.`
          : `Connected to ${s.source.label} read-only (token cannot push).`,
    );
    const save = h(
      'button',
      {
        class: 'btn sm primary',
        type: 'button',
        onclick: async () => {
          const ref = parseRepo(repo.value);
          const t = token.value.trim() || tokenStore.get();
          if (!ref || !t) return toast('Need a repo (owner/repo) and a token', 'warn');
          status.textContent = 'Checking…';
          try {
            const who = await new GitHubClient(t, { ...ref, branch: branch.value.trim() || 'main' }).whoami();
            if (who.empty) throw new Error(`${ref.owner}/${ref.repo} has no commits yet. Add a README on GitHub first.`);
            setRepo(`${ref.owner}/${ref.repo}`, branch.value);
            tokenStore.set(t);
            toast(who.canPush ? `Connected as ${who.login}` : `Connected read-only: ${who.login} cannot push there`, who.canPush ? 'win' : 'warn');
            location.hash = '#/';
            location.reload();
          } catch (err) {
            status.textContent = `✗ ${(err as Error).message}`;
          }
        },
      },
      'Test & save',
    );
    const disconnect = h(
      'button',
      {
        class: 'btn sm danger',
        type: 'button',
        disabled: !tokenStore.get(),
        onclick: async () => {
          if (s.outbox.length && !(await confirmDialog('Disconnect', `${s.outbox.length} edit(s) are not synced yet and will stay queued until you reconnect.`, 'Disconnect')))
            return;
          tokenStore.set(undefined);
          location.reload();
        },
      },
      'Disconnect',
    );
    body.append(
      h('h3', null, 'GitHub connection'),
      h(
        'p',
        { class: 'muted' },
        'Keep your quests in any GitHub repo you own — no need to fork or clone this project. Create a repo (with a README so it has a first commit), then paste a fine-grained personal access token scoped to only that repo with ',
        h('b', null, 'Contents: read & write'),
        ', ',
        h('b', null, 'Pull requests: read & write'),
        ' and ',
        h('b', null, 'Checks: read'),
        '. Data goes in data/<project>/… (see the ',
        h('a', { href: 'skills/quest-log/SKILL.md', target: '_blank', class: 'link' }, 'skill guide'),
        '). The token is stored in this browser’s localStorage only and sent nowhere except api.github.com. Anyone with access to this browser profile can read it.',
      ),
      h('label', { class: 'field' }, h('span', null, 'Repository'), repo),
      h('label', { class: 'field' }, h('span', null, 'Branch (optional)'), branch),
      h('label', { class: 'field' }, h('span', null, 'Token'), token),
      status,
      h('div', { class: 'actions' }, save, disconnect),
    );
  }

  const mode = h(
    'select',
    {
      onchange: (e: Event) => {
        setUiPrefs({ ...uiPrefs(), mobile: (e.target as HTMLSelectElement).value as 'auto' });
        location.reload();
      },
    },
    [
      ['auto', 'Auto (by screen size)'],
      ['off', 'Full game view'],
      ['on', 'Compact mobile view'],
    ].map(([v, l]) => h('option', { value: v, selected: (uiPrefs().mobile ?? 'auto') === v }, l)),
  );
  body.append(h('h3', null, 'Display'), h('label', { class: 'field' }, h('span', null, 'Layout'), mode));

  body.append(h('h3', null, 'Sync'));
  body.append(

    h('p', null, `Source: ${s.source.label} · status: ${s.status} · last synced ${relTime(s.lastSyncedAt)}`),
  );
  if (s.error) body.append(h('p', { class: 'note alert' }, s.error));
  if (s.outbox.length)
    body.append(
      h('p', null, `${s.outbox.length} queued edit(s):`),
      h('ul', { class: 'list compact' }, s.outbox.slice(-20).map((op) => h('li', null, h('small', null, describeOp(op, s.base))))),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn sm primary', type: 'button', onclick: () => void s.sync() }, 'Sync now'),
        h(
          'button',
          {
            class: 'btn sm danger',
            type: 'button',
            onclick: async () => {
              if (await confirmDialog('Discard edits', `Throw away ${s.outbox.length} unsynced edit(s)?`, 'Discard', true)) s.discardOutbox();
            },
          },
          'Discard',
        ),
      ),
    );
  if (s.conflicts.length)
    body.append(
      h('p', { class: 'note warn' }, `${s.conflicts.length} offline edit(s) could not be applied because their target changed remotely:`),
      h('ul', { class: 'list compact' }, s.conflicts.map((c) => h('li', null, h('small', null, `${describeOp(c.op)} — ${c.message}`)))),
      h('button', { class: 'btn sm', type: 'button', onclick: () => s.dismissConflicts() }, 'Dismiss'),
    );
  if (s.issues.length)
    body.append(
      h('h3', null, 'Data issues'),
      h('ul', { class: 'list compact' }, s.issues.slice(0, 20).map((i) => h('li', null, h('small', null, `${i.file}${i.path}: ${i.message}`)))),
    );
  if (s.source.publish)
    body.append(
      h('h3', null, 'Publish'),
      h('p', { class: 'muted' }, 'Edits are committed locally. Publishing pushes them so GitHub Pages redeploys.'),
    );
  openModal('Settings', body);
}
