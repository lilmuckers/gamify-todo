import { describeOp, GitHubClient, parseRepo, REVIEW_SLOTS, type ReviewDay } from '@quest/shared';
import { analyticsAllowed, analyticsAvailable, setAnalyticsAllowed, track } from '../analytics';
import type { App } from '../app';
import { setSoundOn, soundOn } from '../audio';
import { needsSignIn } from '../auth/session';
import { REVOKE_URL, signInAvailable, signOut } from '../auth/signin';
import { chosenBranch, reloadWithMode, repoRef, savedRepo, setRepo, setUiPrefs, TARGET, tokenStore, uiPrefs } from '../config';
import { HEROES, heroKey } from '../sprites/heroes';
import { portraitCanvas } from '../sprites/portraits';
import { spriteUrl } from '../sprites/render';
import { h, relTime } from './dom';
import { openHeroSelect } from './hero-select';
import { confirmDialog, openModal } from './modal';
import { openRepoPicker } from './repo-picker';
import { beginSignIn } from './sign-in';
import { toast } from './toast';

export function settingsDialog(app: App) {
  const s = app.store;
  const body = h('div', { class: 'settings' });
  body.append(
    h('h3', null, 'Your hero'),
    heroCard(app),
  );

  if (s.source.id === 'demo') {
    body.append(h('h3', null, 'Demo'), ...demoNotice(app));
  } else if (TARGET === 'pages') {
    if (signInAvailable()) body.append(...signInSection(app, () => closeAll()));
    body.append(...tokenSection(app, signInAvailable()));
  }

  body.append(
    h('h3', null, 'New here?'),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'btn sm', type: 'button', onclick: () => void import('./onboarding').then((m) => (closeAll(), m.showWelcome(app))) }, 'Show the welcome screen'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => void import('./onboarding').then((m) => (closeAll(), m.beginTour(app))) }, 'Take the tour'),
      s.source.id !== 'demo' &&
        h('button', { class: 'btn sm', type: 'button', onclick: () => void import('./onboarding').then((m) => (closeAll(), m.beginSetup(app))) }, 'Set-up guide'),
    ),
  );

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
  const sound = h('input', {
    id: 'sound-toggle',
    type: 'checkbox',
    checked: soundOn(),
    onchange: (e: Event) => {
      const on = (e.target as HTMLInputElement).checked;
      setSoundOn(on);
      track('sound_toggle', { on });
    },
  });
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  body.append(
    h('h3', null, 'Display'),
    h('label', { class: 'field' }, h('span', null, 'Layout'), mode),
    h('label', { class: 'check' }, sound, 'Sound effects'),
    h(
      'small',
      { class: 'muted' },
      `Short retro blips, made in the browser. Off by default.${calm ? ' Your system asks for reduced motion, so they stay off unless you turn them on.' : ''}`,
    ),
  );

  const reviewDay = h(
    'select',
    { onchange: (e: Event) => app.setReview({ day: (e.target as HTMLSelectElement).value as ReviewDay }) },
    [
      ...(Object.entries(REVIEW_SLOTS) as [ReviewDay, { label: string }][]).map(([v, slot]) => [v, `Every ${slot.label}`]),
      ['off', 'No reminder (W still opens it)'],
    ].map(([v, l]) => h('option', { value: v, selected: app.review.day === v }, l)),
  );
  body.append(
    h('h3', null, 'Weekly review'),
    h('label', { class: 'field' }, h('span', null, 'Remind me'), reviewDay),
    h('small', { class: 'muted' }, 'A REVIEW button appears in the top bar when it’s due. Kept in this browser.'),
  );

  if (analyticsAvailable()) {
    const toggle = h('input', {
      type: 'checkbox',
      checked: analyticsAllowed(),
      onchange: (e: Event) => {
        const on = (e.target as HTMLInputElement).checked;
        setAnalyticsAllowed(on);
        toast(on ? 'Analytics on from the next reload' : 'Analytics off', 'win');
      },
    });
    body.append(
      h('h3', null, 'Privacy'),
      h('label', { class: 'check' }, toggle, 'Usage analytics (Google Analytics)'),
      h(
        'small',
        { class: 'muted' },
        'Counts which screens and actions get used, by type only: no project, level or item titles or ids, no repo names, no tokens. Off by default if your browser sends Global Privacy Control.',
      ),
    );
  }

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
  const closeAll = openModal('Settings', body);
}

/** Pasting a fine-grained token: the way in without sign-in, and what AI assistants still use. */
function tokenSection(app: App, fallback: boolean): Node[] {
  const s = app.store;
  // Only a pasted token belongs to this form; a sign-in session has its own section.
  const saved = tokenStore.session();
  const pat = saved?.kind === 'pat' ? saved.token : undefined;
  const cur = repoRef();
  const repo = h('input', { type: 'text', value: cur ? `${cur.owner}/${cur.repo}` : '', placeholder: 'owner/repo' });
  const branch = h('input', { type: 'text', value: chosenBranch() ?? '', placeholder: 'default branch' });
  const token = h('input', { type: 'password', value: '', placeholder: pat ? '•••••• (saved)' : 'github_pat_…', autocomplete: 'off' });
  const status = h(
    'small',
    { class: 'muted' },
    !pat
      ? saved
        ? 'Signed in with GitHub. Saving a token here replaces the sign-in.'
        : 'Not connected: read-only view of this site’s data.'
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
        const t = token.value.trim() || pat;
        if (!ref || !t) return toast('Need a repo (owner/repo) and a token', 'warn');
        status.textContent = 'Checking…';
        try {
          const who = await new GitHubClient(t, { ...ref, branch: branch.value.trim() || 'main' }).whoami();
          if (who.empty) throw new Error(`${ref.owner}/${ref.repo} has no commits yet. Add a README on GitHub first.`);
          setRepo(`${ref.owner}/${ref.repo}`, branch.value);
          tokenStore.set(t);
          track('github_connect', { can_push: who.canPush });
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
      disabled: !pat,
      onclick: async () => {
        if (s.outbox.length && !(await confirmDialog('Disconnect', `${s.outbox.length} edit(s) are not synced yet and will stay queued until you reconnect.`, 'Disconnect')))
          return;
        tokenStore.set(undefined);
        track('github_disconnect');
        location.reload();
      },
    },
    'Disconnect',
  );
  const intro = h('h3', null, 'GitHub connection');
  const parts: Node[] = [
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
      '). The token is stored in this browser’s localStorage and the app sends it only to api.github.com. Anyone with access to this browser profile can read it.',
      fallback && ' AI assistants that edit your quests use a token like this too.',
      analyticsAvailable() &&
        ' This page also loads Google Analytics (no titles, ids or repo names are sent); you can switch it off under Privacy below.',
    ),
    h('label', { class: 'field' }, h('span', null, 'Repository'), repo),
    h('label', { class: 'field' }, h('span', null, 'Branch (optional)'), branch),
    h('label', { class: 'field' }, h('span', null, 'Token'), token),
    status,
    h('div', { class: 'actions' }, save, disconnect),
  ];
  if (!fallback) return [intro, ...parts];
  // Sign-in is the way in; the token form folds away (open while a token is in use).
  return [h('details', { class: 'token-fallback', open: tokenStore.session()?.kind === 'pat' }, h('summary', null, 'Use a token instead'), ...parts)];
}

/** Sign in with GitHub: who's signed in, which repo, and the ways to change either. */
function signInSection(app: App, closeSettings: () => void): Node[] {
  const s = app.store;
  const session = tokenStore.session();
  const head = h('h3', null, 'GitHub');
  const signIn = (label: string) =>
    h('button', { class: 'btn sm primary signin-big', type: 'button', onclick: () => (closeSettings(), beginSignIn(app)) }, label);
  if (session?.kind !== 'app')
    return [
      head,
      h('p', null, 'Keep your quests in your own GitHub repo, private if you like. Sign in and pick the repo: no tokens to make or paste.'),
      h('div', { class: 'actions' }, signIn('Sign in with GitHub')),
      h('small', { class: 'muted' }, 'Quest Log only sees the repos you choose when you install it on GitHub.'),
    ];
  const signOutBtn = h(
    'button',
    {
      class: 'btn sm danger',
      type: 'button',
      onclick: async () => {
        if (s.outbox.length && !(await confirmDialog('Sign out', `${s.outbox.length} edit(s) are not synced yet. They stay queued in this browser until you sign in again.`, 'Sign out')))
          return;
        signOut();
        track('github_disconnect');
        reloadWithMode(undefined, '#/');
      },
    },
    'Sign out',
  );
  const revoke = h('a', { class: 'link', href: REVOKE_URL, target: '_blank', rel: 'noopener' }, 'revoke its access on GitHub');
  if (s.needsSignIn || needsSignIn(session))
    return [
      head,
      h('p', { class: 'note warn' }, `Your GitHub sign-in has expired.${s.outbox.length ? ` ${s.outbox.length} edit(s) are kept and will sync once you sign in.` : ''}`),
      h('div', { class: 'actions' }, signIn('Sign in again'), signOutBtn),
    ];
  const repo = savedRepo();
  return [
    head,
    h('p', null, repo ? `Signed in with GitHub, playing ${s.source.label}.` : 'Signed in with GitHub. No repo chosen yet.'),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: `btn sm${repo ? '' : ' primary'}`, type: 'button', onclick: () => (closeSettings(), openRepoPicker(app)) }, repo ? 'Change repo' : 'Choose a repo'),
      signOutBtn,
    ),
    h(
      'small',
      { class: 'muted' },
      'Sign-in tokens last 8 hours and renew themselves. They only reach the repos you gave Quest Log on GitHub, and they stay in this browser’s localStorage. Signing out forgets them here; to cut Quest Log off everywhere, ',
      revoke,
      '.',
    ),
  ];
}

/** What the demo is (and isn't), with the ways out. */
export function demoNotice(app: App): Node[] {
  return [
    h('p', null, 'You’re playing the demo: the example games, fully editable. Changes live in this tab only and vanish when you leave or reload. Nothing is sent to GitHub.'),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'btn sm primary', type: 'button', onclick: () => void import('./onboarding').then((m) => m.beginSetup(app)) }, '★ Get started for real'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => reloadWithMode(undefined, '#/') }, 'Leave the demo'),
    ),
  ];
}

/**
 * Your hero, with a button that opens the character select over Settings.
 * The choice is kept in this browser; when the data is editable it is also
 * saved to data/settings.json as the repo default.
 */
export function heroCard(app: App) {
  const repoHero = app.workspace?.settings?.hero;
  const where = app.store.source.label;
  const note = h(
    'small',
    { class: 'muted' },
    app.caps.canEdit
      ? `Saved in this browser and to data/settings.json (${where}), so it becomes the default for everyone viewing this data.`
      : `Saved in this browser only, next to your token. It overrides the data's default${repoHero ? ` (${HEROES[repoHero].label})` : ''}.`,
  );
  const card = h('div', { class: 'hero-card' });
  const show = () => {
    const id = app.heroId;
    const face = h('canvas', { class: 'pixel hero-card-face', width: 32, height: 32, 'aria-hidden': 'true' });
    face.getContext('2d')!.drawImage(portraitCanvas(id), 0, 0);
    card.replaceChildren(
      face,
      h('img', { class: 'pixel hero-card-sprite', src: spriteUrl(heroKey(id)), alt: '' }),
      h('div', null, h('b', null, HEROES[id].label), h('small', { class: 'muted' }, HEROES[id].description)),
    );
  };
  show();
  const change = h('button', { class: 'btn sm primary', type: 'button', onclick: () => openHeroSelect(app, show) }, 'CHANGE HERO');
  return h('div', { class: 'hero-picker' }, card, h('div', { class: 'actions' }, change), note);
}
