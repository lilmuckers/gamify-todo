import { scoreLevel, totals, type TimerPhase } from '@quest/shared';
import { play as sfx } from '../audio';
import type { App } from '../app';
import { href, togglePad } from '../router';
import { fmtDuration, h, icon, mount, stars } from './dom';
import { track } from '../analytics';
import { navFor } from '../nav';
import { heroKey } from '../sprites/heroes';
import { demoNotice, settingsDialog } from './settings';
import { skillHelpDialog } from './skill-help';
import { inboxCount } from './inbox';
import { todayCount } from './today';
import { toast } from './toast';
import { confirmDialog, openModal } from './modal';
import { syncFooter } from './panels';

const STATUS_TEXT: Record<string, string> = {
  loading: '… loading',
  readonly: '👁 read-only',
  synced: '✓ saved',
  pending: '● saving',
  syncing: '⟳ syncing',
  offline: '✈ offline',
  error: '⚠ sync error',
};

/** A count on a HUD button, when there's anything to count. */
const badge = (n: number | string) => (n ? h('b', { class: 'hud-badge' }, n) : null);

/** The sync state button: saved, syncing, offline... (or the demo's warning). */
function syncPill(app: App) {
  const s = app.store;
  if (s.source.id === 'demo')
    return h(
      'button',
      { class: 'sync-pill demo', type: 'button', title: 'The demo saves nothing. Click for how to keep your work.', onclick: () => openModal('Demo: nothing is saved', h('div', null, demoNotice(app))) },
      'DEMO · NOT SAVED',
    );
  return h(
    'button',
    { class: `sync-pill ${s.status}`, type: 'button', title: s.error ?? 'Sync details', onclick: () => settingsDialog(app) },
    `${STATUS_TEXT[s.status] ?? s.status}${s.outbox.length ? ` (${s.outbox.length})` : ''}`,
  );
}

/**
 * Repaints only what shows sync status (the HUD pill and the panel's sync
 * footer), for store updates that changed nothing else.
 */
export function repaintSyncStatus(app: App, hud: HTMLElement, panel: HTMLElement) {
  hud.querySelector('.sync-pill')?.replaceWith(syncPill(app));
  panel.querySelector('.sync-foot')?.replaceWith(syncFooter(app));
}

/** Top bar: where you are, how you're doing, sync state, settings. */
/** The time-box phase last shown, so tipping into hurry or overdue while you watch sounds once. */
let lastPhase: { key: string; phase: TimerPhase } | undefined;

export function renderHud(app: App, el: HTMLElement) {
  const s = app.store;
  const st = app.state;
  const t = st ? totals(st) : undefined;
  const cur = app.currentLevel();
  const r = app.route;

  let middle: Node | null = null;
  // A sub-level has no time-box or stars of its own.
  if (cur && r.view === 'level' && !cur.sub) {
    const sc = scoreLevel(cur.level);
    const tm = sc.timer;
    const key = `${cur.projectId}/${cur.world.id}/${cur.level.id}`;
    if (lastPhase?.key === key && lastPhase.phase !== tm.phase && (tm.phase === 'hurry' || tm.phase === 'overdue')) sfx('hurry');
    lastPhase = { key, phase: tm.phase };
    middle = h(
      'div',
      { class: `hud-level ${tm.phase}` },
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
  }

  // Breadcrumb trail: every step back up is one click away.
  const crumbs = navFor(app).crumbs;
  const trail = h(
    'nav',
    { class: 'hud-crumbs', 'aria-label': 'You are here' },
    crumbs.map((c, i) => [
      i > 0 && h('span', { class: 'sep', 'aria-hidden': 'true' }, '›'),
      i === 0
        ? h('a', { class: 'hud-home', href: c.href, title: 'All projects' }, icon(heroKey(app.heroId), 'grass', 'icon'), h('span', null, 'QUEST LOG'))
        : h('a', { href: c.href, class: i === crumbs.length - 1 ? 'here' : '', 'aria-current': i === crumbs.length - 1 ? 'page' : undefined }, c.label),
    ]),
  );

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
            track('publish', { ok: true });
          } catch (err) {
            track('publish', { ok: false });
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
    trail,
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
    syncPill(app),
    h(
      'a',
      { class: `btn sm hud-today${r.pad === 'today' ? ' on' : ''}`, href: href(togglePad(r, 'today')), title: "Today's plan (T)" },
      'TODAY',
      badge(todayCount(app)),
    ),
    h(
      'a',
      { class: `btn sm hud-today${r.pad === 'inbox' ? ' on' : ''}`, href: href(togglePad(r, 'inbox')), title: 'Inbox: jot ideas down, sort them later (I, or N to write)' },
      'INBOX',
      badge(inboxCount(app)),
    ),
    // Once a week the review asks for a few minutes; otherwise it waits on the pad (W).
    (app.reviewDue || r.pad === 'review') &&
      h(
        'a',
        { class: `btn sm hud-today hud-review${r.pad === 'review' ? ' on' : ''}`, href: href(togglePad(r, 'review')), title: 'Weekly review: celebrate what shipped, cut scope (W)' },
        'REVIEW',
        badge(app.reviewDue ? '!' : 0),
      ),
    h('button', { class: 'btn sm hud-ai', type: 'button', title: 'Use Quest Log with Claude or ChatGPT', onclick: () => skillHelpDialog() }, 'AI SKILL'),
    h('button', { class: 'btn ghost gear-btn', type: 'button', title: 'Settings', 'aria-label': 'Settings', onclick: () => settingsDialog(app) }, '⚙'),
  );
}
