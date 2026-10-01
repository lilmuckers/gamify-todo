import { orderedWorlds } from '@quest/shared';
import { track } from './analytics';
import type { App } from './app';
import { href, type Route } from './router';

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

export function navFor(app: App): NavModel {
  const r = app.route;
  const home = link('Quest Log', { view: 'projects' });
  const state = app.state;
  const projectTitle = state?.overworld.title ?? ('projectId' in r ? r.projectId : '');

  switch (r.view) {
    case 'projects':
      return { crumbs: [home] };
    case 'today':
      return { crumbs: [home, link('Today', r)], up: link('All projects', { view: 'projects' }) };
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
      const name = (d: (typeof levels)[number]) =>
        (v?.data?.head.projects[d.projectId] ?? v?.data?.base.projects[d.projectId])?.worlds[d.worldId]?.levels.find((l) => l.id === d.levelId)?.name ?? d.levelId;
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
 * Keyboard: Esc goes up a screen (unless a popup or item bubble is open),
 * [ and ] step to the previous / next level or world.
 */
export function bindNavKeys(app: App) {
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.activeElement?.matches('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('.overlay')) return;
    const nav = navFor(app);
    const today = app.route.view === 'today' ? undefined : { label: 'Today', href: href({ view: 'today' }) };
    const target =
      e.key === 'Escape'
        ? // A level's item bubble takes Esc first (the flag can be stale on other screens).
          app.bubbleOpen && (app.route.view === 'level' || app.route.view === 'pr-level')
          ? undefined
          : nav.up
        : e.key === '['
          ? nav.prev
          : e.key === ']'
            ? nav.next
            : e.key === 't'
              ? today
              : undefined;
    if (!target) return;
    e.preventDefault();
    track('nav_shortcut', { key: e.key === 'Escape' ? 'escape' : e.key });
    location.hash = target.href;
  });
}
