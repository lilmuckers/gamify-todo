import { parseRepo, THEMES, uniqueId, type OpBody, type Theme } from '@quest/shared';
import { track } from '../../analytics';
import type { App } from '../../app';
import { needsSignIn } from '../../auth/session';
import { signInAvailable, TEMPLATE_URL } from '../../auth/signin';
import { patchUiPrefs, reloadWithMode, savedRepo, setRepo, TARGET, tokenStore, uiPrefs } from '../../config';
import { exampleData } from '../../data/demo';
import { go } from '../../router';
import { heroKey } from '../../sprites/heroes';
import { spriteUrl } from '../../sprites/render';
import { h } from '../dom';
import { field, requireFilled, select, text } from '../forms';
import { confirmDialog } from '../modal';
import { repoChoice } from '../repo-picker';
import { beginSignIn } from '../sign-in';
import { heroSelect } from '../hero-select';
import { skillHelpDialog } from '../skill-help';
import { play as sfx } from '../../audio';
import { toast } from '../toast';
import { testToken, type TokenReport } from './token-check';

// ---- The wizard ----

export type ChapterId = 'signin' | 'repo' | 'token' | 'connect' | 'local' | 'hero' | 'game' | 'ai';

/** The pasted-token chapters: the way in when sign-in isn't set up, or the user prefers a token. */
const TOKEN_CHAPTERS: ChapterId[] = ['repo', 'token', 'connect'];

interface Chapter {
  id: ChapterId;
  title: string;
  /** Only in one build: GitHub Pages connects with a token; the Docker editor is already on a repo. */
  only?: 'pages' | 'local';
  /** The hero's handwritten tip on this page. */
  tip: string;
  render(w: Wizard): Node[];
  /** False hides NEXT until the page is done (it moves on by itself). */
  canNext?(w: Wizard): boolean;
}

interface Wizard {
  app: App;
  repo: string;
  token: string;
  report?: TokenReport;
  /** Connecting with a pasted token rather than signing in. */
  pat: boolean;
  /** Switches between the token chapters and the sign-in one. */
  usePat(on: boolean): void;
  next(): void;
  back(): void;
  rerender(): void;
  close(): void;
  /** Undoes what the current page set up (timers, key handlers) before the next one renders. */
  cleanup?: () => void;
}

const ext = (url: string, label: string) => h('a', { class: 'manual-go', href: url, target: '_blank', rel: 'noopener' }, `${label} ↗`);

const CHAPTERS: Chapter[] = [
  {
    id: 'signin',
    title: 'Sign in with GitHub',
    only: 'pages',
    tip: 'Pick just your quest repo when GitHub asks. Nothing else.',
    canNext: () => connectedBySignIn(),
    render: (w) => {
      const session = tokenStore.session();
      if (session?.kind !== 'app' || needsSignIn(session)) {
        const go = h(
          'button',
          {
            class: 'btn primary signin-big',
            type: 'button',
            onclick: () => {
              patchUiPrefs({ setup: { step: 'signin' } });
              // Signed in without leaving the page (desktop popup): this page moves on to the repo.
              beginSignIn(w.app, { setup: true, onSignedIn: () => w.rerender() });
            },
          },
          'SIGN IN WITH GITHUB',
        );
        return [
          h('p', { class: 'manual-lead' }, 'Your games live in a GitHub repo you own (private is fine). Sign in, then pick that repo. No tokens to make or paste.'),
          h('div', { class: 'actions manual-signin' }, go),
          h(
            'div',
            { class: 'manual-card' },
            h('h3', null, 'NO REPO YET?'),
            h('p', null, 'Make one from the Quest Log template first: it comes ready to play. Then sign in and give Quest Log that repo.'),
            ext(TEMPLATE_URL, 'MAKE MY QUEST REPO'),
          ),
          h(
            'p',
            { class: 'manual-safe' },
            '🔒 Quest Log only reaches the repos you pick on GitHub. Sign-in tokens last 8 hours, renew themselves and stay in this browser. ',
          ),
          h('p', { class: 'muted' }, 'Rather paste a token? ', h('button', { class: 'link-button', type: 'button', onclick: () => w.usePat(true) }, 'Use a token instead'), '.'),
        ];
      }
      if (connectedBySignIn())
        return [
          h('p', { class: 'manual-lead' }, 'Signed in and playing ', h('b', null, savedRepo()!), '. Press NEXT to pick your hero.'),
          h('details', null, h('summary', null, 'Play a different repo'), repoChoice({ setup: true })),
        ];
      // Signed in, no repo yet: the repos to pick from, or the next steps on GitHub (it watches for them).
      return [repoChoice({ setup: true })];
    },
  },
  {
    id: 'repo',
    title: 'Make a repo for your quests',
    only: 'pages',
    tip: 'Private repos are fine. Nobody sees your quests unless you share them.',
    render: (w) => {
      const repo = text(w.repo, { placeholder: 'you/my-quests' });
      repo.oninput = () => (w.repo = repo.value.trim());
      return [
        h('p', { class: 'manual-lead' }, 'Your games live in a GitHub repo you own: any repo works, private is fine. It needs one first commit, so tick ', h('b', null, 'Add a README'), ' when you make it.'),
        ext('https://github.com/new?name=my-quests&description=My%20Quest%20Log', 'MAKE A NEW REPO ON GITHUB'),
        field('Which repo? (owner/name)', repo, 'e.g. you/my-quests. Already have one? Use that.'),
        signInAvailable() && h('p', { class: 'muted' }, 'Rather not make a token? ', h('button', { class: 'link-button', type: 'button', onclick: () => w.usePat(false) }, 'Sign in with GitHub instead'), '.'),
      ].filter(Boolean) as Node[];
    },
  },
  {
    id: 'token',
    title: 'Forge a token',
    only: 'pages',
    tip: 'Keep it secret. Keep it safe. Never paste it anywhere else!',
    render: (w) => {
      const input = h('input', { type: 'password', class: 'manual-token', placeholder: 'github_pat_… paste it here', autocomplete: 'off', value: w.token });
      input.oninput = () => (w.token = input.value.trim());
      const result = h('div', { class: 'token-report', 'aria-live': 'polite' }, w.report ? reportView(w.report) : null);
      const testBtn = h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          onclick: async () => {
            const ref = parseRepo(w.repo);
            if (!ref) return toast('Go back a step and enter the repo as owner/name', 'warn');
            if (!w.token) return toast('Paste the token first', 'warn');
            testBtn.disabled = true;
            result.replaceChildren('Asking GitHub…');
            w.report = await testToken(w.token, ref);
            track('setup_token_test', { ok: w.report.ok, problem: w.report.problem });
            testBtn.disabled = false;
            w.rerender();
          },
        },
        'TEST IT',
      );
      return [
        h('p', { class: 'manual-lead' }, 'A fine-grained token lets Quest Log read and save your games in ', h('b', null, 'that one repo only'), '. Nothing else.'),
        ext('https://github.com/settings/personal-access-tokens/new', "OPEN GITHUB'S TOKEN PAGE"),
        h(
          'div',
          { class: 'manual-card' },
          h('h3', null, 'SET IT UP LIKE THIS'),
          h(
            'table',
            null,
            h('tr', null, h('td', null, 'Repository access'), h('td', null, 'Only select repositories → ', h('b', null, w.repo || 'your repo'))),
            h('tr', null, h('td', null, 'Contents'), h('td', null, h('span', { class: 'pill rw' }, 'READ AND WRITE'))),
            h('tr', null, h('td', null, 'Pull requests'), h('td', null, h('span', { class: 'pill rw' }, 'READ AND WRITE'))),
            h('tr', null, h('td', null, 'Checks'), h('td', null, h('span', { class: 'pill ro' }, 'READ-ONLY'))),
            h('tr', null, h('td', null, 'Expiration'), h('td', null, '90 days is a good balance; make a new one when it runs out')),
          ),
        ),
        h('div', { class: 'manual-paste' }, input, testBtn),
        result,
        h(
          'p',
          { class: 'manual-safe' },
          '🔒 The token is stored only in this browser and only ever sent to api.github.com. Never paste it anywhere else. To revoke it, delete it on that same GitHub page.',
        ),
      ];
    },
  },
  {
    id: 'connect',
    title: 'Connect',
    only: 'pages',
    tip: 'This bit restarts the app. Back in a jiffy!',
    render: (w) => {
      const branch = text('', { required: false, placeholder: 'default branch' });
      const status = h('p', { class: 'muted' });
      const connect = h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          onclick: async () => {
            const ref = parseRepo(w.repo);
            if (!ref || !w.token) return toast('Fill in the repo and token first', 'warn');
            connect.disabled = true;
            status.textContent = 'Connecting…';
            const report = w.report?.ok ? w.report : await testToken(w.token, ref);
            if (!report.ok) {
              connect.disabled = false;
              status.textContent = `✗ ${report.advice ?? 'That token can’t save to this repo yet.'}`;
              return;
            }
            setRepo(`${ref.owner}/${ref.repo}`, branch.value);
            tokenStore.set(w.token);
            track('github_connect', { can_push: true });
            // Pick up at the hero step once the app has restarted on the new repo.
            patchUiPrefs({ setup: { step: 'hero', repo: w.repo } });
            reloadWithMode(undefined, '#/');
          },
        },
        'CONNECT',
      );
      return [
        h('p', { class: 'manual-lead' }, 'Last check, then Quest Log restarts on ', h('b', null, w.repo || 'your repo'), '. Your games go in its ', h('code', null, 'data/'), ' folder; an empty repo gets one on your first save.'),
        field('Branch (optional)', branch, 'Leave empty for the repo’s default branch.'),
        h('div', { class: 'actions' }, connect),
        status,
      ];
    },
  },
  {
    id: 'local',
    title: 'Your local repo',
    only: 'local',
    tip: 'No tokens, no accounts. Just git, like the old days.',
    render: (w) => {
      const facts = h('ul', { class: 'token-checks' }, h('li', { class: 'unknown' }, 'Checking the repo…'));
      const status = w.app.store.source.status?.();
      void status
        ?.then((st) =>
          facts.replaceChildren(
            h('li', { class: 'yes' }, `✓ On branch ${st.branch}`),
            h('li', { class: 'yes' }, st.lastCommit ? `✓ Last commit: ${st.lastCommit.message.split('\n')[0].slice(0, 60)}` : '✓ No commits yet'),
            h('li', { class: st.remote ? 'yes' : 'unknown' }, st.remote ? `✓ Pushes to ${st.remote}${st.ahead ? ` (${st.ahead} commit${st.ahead === 1 ? '' : 's'} to publish)` : ''}` : '? No remote: everything stays on this machine'),
          ),
        )
        .catch((err: Error) => facts.replaceChildren(h('li', { class: 'no' }, `✗ Couldn't read the repo: ${err.message}`)));
      return [
        h('p', { class: 'manual-lead' }, 'This editor is already working on the git repo it was started in: every edit is written to its ', h('code', null, 'data/'), ' folder and committed there. No GitHub token needed.'),
        facts,
        h('p', { class: 'muted' }, 'Pushing is up to you: use ⇪ Publish in the top bar (when the repo has a remote), or plain git.'),
      ];
    },
  },
  {
    id: 'hero',
    title: 'Pick your hero',
    tip: 'Pick whoever makes you smile.',
    render: (w) => {
      // The character select, in the manual's colours. Picking plays the transformation, then turns the page.
      const select = heroSelect(w.app, { theme: 'manual', onPicked: () => w.next() });
      w.cleanup = select.destroy;
      return [h('p', { class: 'manual-lead' }, 'Who walks your levels? You can change this any time in Settings.'), select.el];
    },
  },
  {
    id: 'game',
    title: 'Start your first game',
    tip: 'Small is good. One level you finish beats ten you plan.',
    render: (w) => {
      const ws = w.app.workspace;
      const count = ws ? Object.keys(ws.projects).length : 0;
      const title = text('', { placeholder: 'e.g. Garden makeover' });
      const goal = text('', { required: false, placeholder: 'Defaults to the title' });
      const world = text('World 1');
      const theme = select(THEMES.map((t) => ({ value: t, label: t })), 'grass');
      const level = text('First steps');
      const criterion = text('Everything on this list done', { max: 280 });
      const create = h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          onclick: () => {
            if (!requireFilled(title, world, level, criterion)) return;
            const made = createGame(w.app, { title: title.value.trim(), goal: goal.value.trim(), world: world.value.trim(), theme: theme.value as Theme, level: level.value.trim(), criterion: criterion.value.trim() });
            if (!made) return;
            track('setup_done', { first_game: true });
            finish(w, made);
          },
        },
        'CREATE GAME',
      );
      const copy =
        w.app.caps.canEdit &&
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: async () => {
              if (!(await confirmDialog('Copy the example games', 'Add the example games to your repo in one commit? You can delete them later.', 'Copy them'))) return;
              try {
                await copyExamples(w.app);
                toast('Example games copied', 'win');
                w.next();
              } catch (err) {
                toast(`Couldn’t copy: ${(err as Error).message}`, 'alert', 6000);
              }
            },
          },
          'Copy the example games instead',
        );
      return [
        h('p', { class: 'manual-lead' }, count ? `Found ${count} game${count === 1 ? '' : 's'} in your repo already. Add another, or skip ahead.` : 'Your repo is empty. Name your first game: one goal, one world, one level to start.'),
        field('Game title', title),
        field('First goal', goal, 'What does done look like?'),
        field('World name', world),
        field('Theme', theme),
        field('Level name', level),
        field('Good enough when…', criterion, 'The level’s must-have success criterion.'),
        h('div', { class: 'actions' }, create, copy),
      ];
    },
  },
  {
    id: 'ai',
    title: '(Optional) Teach your AI the rules',
    tip: 'Optional, but handy if you live in a chat window.',
    render: (w) => [
      h('p', { class: 'manual-lead' }, 'Use ChatGPT or Claude? The AI skill teaches them how your games are stored, so they can add tasks, tick things off and plan levels for you.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => skillHelpDialog() }, 'OPEN THE AI SKILL'), h('button', { class: 'btn primary', type: 'button', onclick: () => (track('setup_done', { first_game: false }), finish(w)) }, "WORLD 1-1, LET'S GO!")),
    ],
  },
];

/** Signed in, with a repo chosen: the sign-in page is done. */
function connectedBySignIn(): boolean {
  const s = tokenStore.session();
  return s?.kind === 'app' && !needsSignIn(s) && !!savedRepo();
}

function reportView(r: TokenReport): Node[] {
  return [
    h('ul', { class: 'token-checks' }, r.checks.map((c) => h('li', { class: c.ok === undefined ? 'unknown' : c.ok ? 'yes' : 'no' }, c.ok === undefined ? '? ' : c.ok ? '✓ ' : '✗ ', c.label))),
    r.login && h('p', { class: 'muted' }, `Signed in to GitHub as ${r.login}.`),
    r.advice && h('p', { class: r.ok ? 'note' : 'note warn' }, r.advice),
  ].filter(Boolean) as Node[];
}

/** The ops for a brand-new game with one world and one level, dispatched as one commit. */
function createGame(app: App, v: { title: string; goal: string; world: string; theme: Theme; level: string; criterion: string }) {
  const ws = app.workspace;
  if (!ws) return toast('Still loading your repo', 'warn'), undefined;
  const projectId = uniqueId(v.title, Object.keys(ws.projects));
  const goalTitle = v.goal || v.title;
  const goalId = uniqueId(goalTitle, []);
  const worldId = uniqueId(v.world, []);
  const levelId = uniqueId(v.level, ['world']);
  const ops: OpBody[] = [
    { kind: 'addProject', projectId, project: { id: projectId, title: v.title, goals: [{ id: goalId, title: goalTitle }], worldOrder: [] } },
    { kind: 'addWorld', projectId, world: { id: worldId, name: v.world, theme: v.theme, goalIds: [goalId], levels: [] } },
    {
      kind: 'addLevel',
      projectId,
      worldId,
      level: { id: levelId, name: v.level, deliverable: v.level, timeboxDays: 7, successCriteria: [{ id: uniqueId(v.criterion, []), text: v.criterion, mvp: true, done: false }], items: [] },
    },
  ];
  return app.dispatchBatch(ops, { via: 'setup' }) ? { projectId, worldId, levelId } : undefined;
}

/** Adds the example games' files to the connected repo in one commit. */
async function copyExamples(app: App) {
  const store = app.store;
  if (!store.source.commit || !store.version) throw new Error('not connected');
  await store.sync();
  const examples = await exampleData().loadFiles();
  const have = new Set(Object.keys(store.state?.projects ?? {}));
  const changes: Record<string, string> = {};
  for (const [path, body] of Object.entries(examples)) {
    const m = /^data\/([^/]+)\//.exec(path);
    if (m && !have.has(m[1])) changes[path] = body;
  }
  if (!Object.keys(changes).length) return;
  await store.source.commit(changes, 'quest: copy the example games', store.version);
  await store.refresh();
}

function finish(w: Wizard, where?: { projectId: string; worldId: string; levelId: string }) {
  patchUiPrefs({ setup: undefined });
  w.close();
  sfx('win');
  toast("WORLD 1-1, GO!", 'win');
  if (where) go({ view: 'level', ...where });
  else location.hash = '#/';
}

/**
 * Get started: a wizard styled like a game's instruction manual. Red
 * sidebar of chapters, a cream page for the current one, the player's hero
 * with handwritten tips. Resumes where it left off after a reload.
 */
export function openSetup(app: App, start?: ChapterId) {
  document.querySelector('.manual-overlay')?.remove();
  const saved = uiPrefs().setup;
  const first = start ?? saved?.step;
  const pick = (pat: boolean) =>
    CHAPTERS.filter((c) => (!c.only || c.only === TARGET) && (pat ? c.id !== 'signin' : !TOKEN_CHAPTERS.includes(c.id)));
  let chapters = pick(!signInAvailable() || TOKEN_CHAPTERS.includes(first as ChapterId));
  let at = Math.max(0, chapters.findIndex((c) => c.id === first));
  const side = h('ol', { class: 'manual-chapters' });
  const page = h('div', { class: 'manual-page' });
  const overlay = h(
    'div',
    { class: 'manual-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Getting started' },
    h(
      'div',
      { class: 'manual' },
      h('div', { class: 'manual-side' }, h('h2', null, 'GETTING STARTED'), side),
      h('div', { class: 'manual-main' }, page),
      h('button', { class: 'manual-close', type: 'button', 'aria-label': 'Close', title: 'Close (you can come back from Settings)', onclick: () => w.close() }, '✕'),
    ),
  );
  const w: Wizard = {
    app,
    repo: saved?.repo ?? '',
    token: '',
    pat: !chapters.some((c) => c.id === 'signin'),
    usePat: (on) => {
      w.pat = on;
      chapters = pick(on);
      const step: ChapterId = on ? 'repo' : 'signin';
      at = chapters.findIndex((c) => c.id === step);
      patchUiPrefs({ setup: { step, repo: w.repo || undefined } });
      track('setup_step', { step });
      render();
    },
    next: () => move(1),
    back: () => move(-1),
    rerender: () => render(),
    close: () => {
      w.cleanup?.();
      overlay.remove();
      unsub();
      document.removeEventListener('keydown', onKey, true);
    },
  };
  const move = (d: number) => {
    at = Math.max(0, Math.min(chapters.length - 1, at + d));
    patchUiPrefs({ setup: { step: chapters[at].id, repo: w.repo || undefined } });
    track('setup_step', { step: chapters[at].id });
    render();
  };
  const render = () => {
    w.cleanup?.();
    w.cleanup = undefined;
    const c = chapters[at];
    side.replaceChildren(
      ...chapters.map((ch, k) => h('li', { class: k < at ? 'done' : k === at ? 'now' : 'todo' }, h('button', { type: 'button', disabled: k > at, onclick: () => ((at = k), render()) }, `${k + 1}. ${ch.title}`))),
    );
    const last = at === chapters.length - 1;
    page.replaceChildren(
      h('p', { class: 'manual-pageno' }, `MANUAL · PAGE ${at + 1}`),
      h('h1', null, `STEP ${at + 1}: ${c.title.toUpperCase()}`),
      ...c.render(w),
      h(
        'div',
        { class: 'manual-nav' },
        at > 0 && h('button', { class: 'btn', type: 'button', onclick: () => w.back() }, '◀ BACK'),
        // Connecting moves on by itself (it restarts the app); the last page has its own finish.
        !last && c.id !== 'connect' && (c.canNext?.(w) ?? true) && h('button', { class: 'btn', type: 'button', onclick: () => w.next() }, c.id === 'game' ? 'SKIP ▶' : 'NEXT ▶'),
      ),
      h(
        'div',
        { class: 'manual-tip' },
        h('div', { class: 'manual-bubble' }, c.tip),
        h('img', { class: 'pixel', src: spriteUrl(heroKey(app.heroId)), alt: '' }),
      ),
    );
    // The character select starts on your hero, so focus that portrait rather than the first one.
    ((page.querySelector('.hp-cell.on') ?? page.querySelector('input, select, button')) as HTMLElement | null)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      w.close();
    }
  };
  // Hero changes (picked on page 4) show up in the tip at once.
  const unsub = app.subscribe(() => chapters[at].id === 'hero' && (page.querySelector('.manual-tip img') as HTMLImageElement | null)?.setAttribute('src', spriteUrl(heroKey(app.heroId))));
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  track('setup_step', { step: chapters[at].id });
  render();
}
