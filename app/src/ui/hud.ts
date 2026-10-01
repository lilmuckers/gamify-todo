import { scoreLevel, totals } from '@quest/shared';
import type { App } from '../app';
import { href } from '../router';
import { fmtDuration, h, icon, mount, stars } from './dom';
import { settingsDialog } from './settings';
import { skillHelpDialog } from './skill-help';
import { toast } from './toast';
import { confirmDialog } from './modal';

const STATUS_TEXT: Record<string, string> = {
  loading: '… loading',
  readonly: '👁 read-only',
  synced: '✓ saved',
  pending: '● saving',
  syncing: '⟳ syncing',
  offline: '✈ offline',
  error: '⚠ sync error',
};

/** Top bar: where you are, how you're doing, sync state, settings. */
export function renderHud(app: App, el: HTMLElement) {
  const s = app.store;
  const st = app.state;
  const t = st ? totals(st) : undefined;
  const cur = app.currentLevel();
  const r = app.route;

  let middle: Node | null = null;
  if (cur && r.view === 'level') {
    const sc = scoreLevel(cur.level);
    const tm = sc.timer;
    middle = h(
      'div',
      { class: `hud-level ${tm.phase}` },
      h('span', { class: 'hud-name' }, cur.level.name),
      stars(sc.stars),
      h(
        'span',
        { class: 'hud-time' },
        tm.phase === 'not-started'
          ? `⏱ ${cur.level.timeboxDays}d`
          : tm.phase === 'cleared'
            ? 'CLEAR!'
            : `⏱ ${fmtDuration(tm.remainingMs!)}`,
      ),
    );
  } else if (r.view === 'pr' || r.view === 'pr-level') {
    middle = h('div', { class: 'hud-level warp' }, h('span', { class: 'hud-name' }, `WARP WORLD #${r.pr}`));
  }

  const syncLabel = `${STATUS_TEXT[s.status] ?? s.status}${s.outbox.length ? ` (${s.outbox.length})` : ''}`;
  const publish =
    s.source.publish &&
    h(
      'button',
      {
        class: 'btn sm',
        type: 'button',
        title: 'Push local commits to GitHub',
        onclick: async (e: Event) => {
          if (!(await confirmDialog('Publish', 'Push local commits to the remote? GitHub Pages will redeploy.', 'Publish'))) return;
          const btn = e.target as HTMLButtonElement;
          btn.disabled = true;
          try {
            await s.sync();
            toast(await s.source.publish!(), 'win');
          } catch (err) {
            toast((err as Error).message, 'alert', 6000);
          } finally {
            btn.disabled = false;
          }
        },
      },
      '⇪ Publish',
    );

  mount(
    el,
    h('a', { class: 'hud-home', href: href({ view: 'projects' }), title: 'All projects' }, icon('hero', 'grass', 'icon'), h('span', null, 'QUEST LOG')),
    app.state &&
      h('a', { class: 'hud-project', href: href({ view: 'overworld', projectId: app.projectId! }), title: 'Project map' }, app.state.overworld.title),
    middle,
    h('span', { class: 'grow' }),
    t && h('span', { class: 'hud-stat', title: 'Experience' }, `${t.xp} XP`),
    t && h('span', { class: 'hud-stat', title: 'Coins' }, icon('coin', 'grass', 'icon sm'), `×${t.coins}`),
    app.caps.canReviewPRs &&
      h(
        'a',
        { class: 'hud-warp', href: href({ view: 'prs' }), title: 'Warp Zone: review PRs' },
        icon('warp-pipe', 'grass', 'icon'),
        app.pulls.list?.length ? h('b', null, app.pulls.list.length) : null,
      ),
    publish,
    h(
      'button',
      { class: `sync-pill ${s.status}`, type: 'button', title: s.error ?? 'Sync details', onclick: () => settingsDialog(app) },
      syncLabel,
    ),
    h('button', { class: 'btn sm', type: 'button', title: 'Use Quest Log with Claude or ChatGPT', onclick: () => skillHelpDialog() }, 'AI SKILL'),
    h('button', { class: 'btn ghost gear-btn', type: 'button', title: 'Settings', 'aria-label': 'Settings', onclick: () => settingsDialog(app) }, '⚙'),
  );
}
