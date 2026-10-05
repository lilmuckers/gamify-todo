import { orderedWorlds } from '@quest/shared';
import { track } from './analytics';
import type { App } from './app';
import { pullLookup } from './data/source';
import { runPendingUndo } from './ui/toast';
import { isTyping } from './ui/dom';
import { href, togglePad, withPad, type PadPage, type Route } from './router';

export interface NavLink {
  label: string;
  href: string;
}

/** Where you are, the screen above it, and the neighbours at the same depth. */
export interface NavModel {
  crumbs: NavLink[];
  up?: NavLink;
  prev?: NavLink;
  next?: NavLink;
}

const link = (label: string, route: Route): NavLink => ({ label, href: href(route) });
const PAD_CRUMB: Record<PadPage, string> = { today: 'Today', inbox: 'Inbox', review: 'Weekly review', stats: 'Stats' };

export function navFor(app: App): NavModel {
  const r = app.route;
  const screen = screenNav(app, withPad(r, undefined));
  if (!r.pad) return screen;
  // A pad page is held up over the screen: closing it puts it away again.
  return {
    crumbs: [...screen.crumbs, link(PAD_CRUMB[r.pad], r)],
    up: link('Close', withPad(r, undefined)),
  };
}

function screenNav(app: App, r: Route): NavModel {
  const home = link('Quest Log', { view: 'projects' });
  const state = app.state;
  const projectTitle = state?.overworld.title ?? ('projectId' in r ? r.projectId : '');

  switch (r.view) {
    case 'projects':
      return { crumbs: [home] };
    case 'prs':
      return { crumbs: [home, link('Warp Zone', r)], up: link('All projects', { view: 'projects' }) };
    case 'overworld':
      return { crumbs: [home, link(projectTitle, r)], up: link('All projects', { view: 'projects' }) };
    case 'world': {
      const worlds = state ? orderedWorlds(state) : [];
      const i = worlds.findIndex((w) => w.id === r.worldId);
      const at = (w: (typeof worlds)[number] | undefined) =>
        w && link(w.name, { view: 'world', projectId: r.projectId, worldId: w.id });
      return {
        crumbs: [home, link(projectTitle, { view: 'overworld', projectId: r.projectId }), at(worlds[i]) ?? link(r.worldId, r)],
        up: link(`${projectTitle} map`, { view: 'overworld', projectId: r.projectId }),
        prev: at(worlds[i - 1]),
        next: at(worlds[i + 1]),
      };
    }
    case 'level': {
      const world = state?.worlds[r.worldId];
      const level = world?.levels.find((l) => l.id === r.levelId);
      const levelRoute: Route = { view: 'level', projectId: r.projectId, worldId: r.worldId, levelId: r.levelId };
      const base = [
        home,
        link(projectTitle, { view: 'overworld', projectId: r.projectId }),
        link(world?.name ?? r.worldId, { view: 'world', projectId: r.projectId, worldId: r.worldId }),
      ];
      if (r.subId) {
        // Inside a dependency's sub-level: up goes back out of the pipe.
        const dep = level?.items.find((i) => i.id === r.subId);
        const back = { ...levelRoute, itemId: r.subId };
        return {
          crumbs: [...base, link(level?.name ?? r.levelId, back), link(`⬇ ${dep?.title ?? r.subId}`, { ...r, itemId: undefined })],
          up: link(`Back up to ${level?.name ?? r.levelId}`, back),
        };
      }
      // Prev/next run through every level of the project, crossing world boundaries.
      const all = state ? orderedWorlds(state).flatMap((w) => w.levels.map((l) => ({ w, l }))) : [];
      const i = all.findIndex((x) => x.w.id === r.worldId && x.l.id === r.levelId);
      const at = (x: (typeof all)[number] | undefined) =>
        x && link(x.w.id === r.worldId ? x.l.name : `${x.w.name}: ${x.l.name}`, { view: 'level', projectId: r.projectId, worldId: x.w.id, levelId: x.l.id });
      return {
        crumbs: [...base, link(all[i]?.l.name ?? r.levelId, levelRoute)],
        up: link(`${world?.name ?? r.worldId} map`, { view: 'world', projectId: r.projectId, worldId: r.worldId }),
        prev: at(all[i - 1]),
        next: at(all[i + 1]),
      };
    }
    case 'pr':
      return {
        crumbs: [home, link('Warp Zone', { view: 'prs' }), link(`PR #${r.pr}`, r)],
        up: link('Warp Zone', { view: 'prs' }),
      };
    case 'pr-level': {
      const v = app.pullView(r.pr);
      if (r.subId) {
        const back: Route = { ...r, subId: undefined, itemId: r.subId };
        return {
          crumbs: [home, link('Warp Zone', { view: 'prs' }), link(`PR #${r.pr}`, { view: 'pr', pr: r.pr }), link(r.levelId, back), link(`⬇ ${r.subId}`, r)],
          up: link(`Back up to ${r.levelId}`, back),
        };
      }
      const levels = v?.diff?.levels ?? [];
      const i = levels.findIndex((d) => d.projectId === r.projectId && d.worldId === r.worldId && d.levelId === r.levelId);
      const find = v?.data && pullLookup(v.data);
      const name = (d: (typeof levels)[number]) => find?.level(d)?.name ?? d.levelId;
      const at = (d: (typeof levels)[number] | undefined) =>
        d && link(name(d), { view: 'pr-level', pr: r.pr, projectId: d.projectId, worldId: d.worldId, levelId: d.levelId });
      return {
        crumbs: [home, link('Warp Zone', { view: 'prs' }), link(`PR #${r.pr}`, { view: 'pr', pr: r.pr }), at(levels[i]) ?? link(r.levelId, r)],
        up: link(`PR #${r.pr}`, { view: 'pr', pr: r.pr }),
        prev: at(levels[i - 1]),
        next: at(levels[i + 1]),
      };
    }
  }
}

/**
 * Keyboard: Esc goes up a screen (unless a popup or item bubble is open) or
 * puts today's plan away, [ and ] step to the previous / next level or world,
 * t / i / w / s hold up the Today / Inbox / Weekly review / Stats page of the pad (or put it away), n opens
 * the inbox ready to write on, p starts or stops play mode.
 */
export function bindNavKeys(app: App) {
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey) return;
    if (isTyping()) return;
    // Ctrl/Cmd+Z: take back the last edit while its UNDO toast is showing.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      if (runPendingUndo()) e.preventDefault();
      return;
    }
    if (e.metaKey || e.ctrlKey) return;
    if (document.querySelector('.overlay')) return;
    // p: play the level with a gamepad or the keyboard. While playing, keys
    // steer the hero and Esc belongs to the game.
    if (e.key === 'p' && (app.playing || app.canPlay)) {
      e.preventDefault();
      track('nav_shortcut', { key: 'p' });
      app.setPlaying(!app.playing);
      return;
    }
    // The play controls handle Esc themselves.
    if (app.playing) return;
    const nav = navFor(app);
    const r = app.route;
    const today = { label: 'Today', href: href(togglePad(r, 'today')) };
    const inbox = { label: 'Inbox', href: href(togglePad(r, 'inbox')) };
    const review = { label: 'Weekly review', href: href(togglePad(r, 'review')) };
    const stats = { label: 'Stats', href: href(togglePad(r, 'stats')) };
    // n: jot something down (the inbox page, ready to write on).
    const capture = { label: 'Inbox', href: href(withPad(r, 'inbox')) };
    const target =
      e.key === 'Escape'
        ? // A level's item bubble takes Esc first (the flag can be stale on other screens).
          !r.pad && app.bubbleOpen && (r.view === 'level' || r.view === 'pr-level')
          ? undefined
          : nav.up
        : e.key === '['
          ? nav.prev
          : e.key === ']'
            ? nav.next
            : e.key === 't'
              ? today
              : e.key === 'i'
                ? inbox
                : e.key === 'w'
                  ? review
                  : e.key === 's'
                    ? stats
                    : e.key === 'n'
                      ? capture
                      : undefined;
    if (!target) return;
    e.preventDefault();
    if (e.key === 'n') app.focusCapture = true;
    track('nav_shortcut', { key: e.key === 'Escape' ? 'escape' : e.key });
    location.hash = target.href;
  });
}
