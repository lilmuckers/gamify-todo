import { isWorldLocked, orderedProjects, orderedWorlds, seeded, suggestNext, totals, worldTotals } from '@quest/shared';
import type { App } from './app';
import { go, href, togglePad } from './router';
import { canvasUrl, island } from './sprites/render';
import { drawStrip } from './sprites/strip';
import { heroKey } from './sprites/heroes';
import { carpetCanvas, cartridge } from './sprites/cartridge';
import { h, icon, mount } from './ui/dom';
import { renderHud, repaintSyncStatus } from './ui/hud';
import { renderPanel } from './ui/panels';
import { scheduler } from './ui/render-loop';
import { settingsDialog } from './ui/settings';
import { mountPadOverlay } from './ui/today';
import { mountRecords } from './ui/records';

/** Compact, touch-first layout for phones: DOM screens plus a static level strip. */
export function mountMobile(app: App, root: HTMLElement) {
  const hud = h('header', { class: 'hud' });
  const body = h('main', { class: 'mobile-body' });
  const nav = h('nav', { class: 'tabbar' });
  // Detailed stats takes the body's place while it's open.
  const records = h('div', { class: 'mobile' });
  root.append(hud, body, records, nav);

  const today = h('div', { class: 'mobile' });
  root.append(today);
  let stripScroll: number | undefined;
  scheduler(app, body, () => {
    renderHud(app, hud);
    renderNav(app, nav);
    const prevStrip = body.querySelector('.strip');
    if (prevStrip) stripScroll = prevStrip.scrollLeft;
    const visual = renderVisual(app, stripScroll);
    return h('div', null, visual, renderPanel(app));
  }, () => repaintSyncStatus(app, hud, body));
  window.addEventListener('hashchange', () => (stripScroll = undefined));
  mountPadOverlay(app, today);
  mountRecords(app, records, { onShow: (shown) => (body.hidden = shown) });
}

function renderVisual(app: App, scroll?: number): HTMLElement | null {
  const r = app.route;
  const state = app.state;
  if (r.view === 'projects' && app.workspace) {
    // Cartridges on the carpet, each tilted by its own seed.
    return h(
      'div',
      { class: 'cart-floor', style: `background-image:url(${canvasUrl(carpetCanvas())})` },
      orderedProjects(app.workspace).map((p) => {
        const t = totals(p);
        const id = p.overworld.id;
        const tilt = (seeded(id)() - 0.5) * 16;
        const art = cartridge({ seed: id, title: p.overworld.title, themes: orderedWorlds(p).map((w) => w.theme) });
        return h(
          'a',
          { class: 'cart', href: href({ view: 'overworld', projectId: id }), style: `--tilt:${tilt.toFixed(1)}deg` },
          h('img', { src: canvasUrl(art), class: 'pixel', alt: '' }),
          h('b', null, p.overworld.title),
          h('small', null, `★${t.stars}/${t.maxStars}`),
        );
      }),
    );
  }
  if (r.view === 'overworld' && state) {
    const next = suggestNext(state);
    return h(
      'div',
      { class: 'islands' },
      orderedWorlds(state).map((w, i) => {
        const t = worldTotals(w);
        return h(
          'a',
          { class: 'island', href: href({ view: 'world', projectId: r.projectId, worldId: w.id }) },
          h('img', { src: canvasUrl(island(w.theme, isWorldLocked(state, w))), class: 'pixel', alt: '' }),
          h('b', null, `${i + 1}. ${w.name}`),
          h('small', null, `★${t.stars}/${t.maxStars}${next?.worldId === w.id ? ' · ▶' : ''}`),
        );
      }),
    );
  }
  const cur = app.currentLevel();
  if (cur) {
    const theme = r.view === 'pr-level' ? 'warp' : cur.sub ? 'under' : cur.world.theme;
    const sel = app.selection?.kind === 'item' ? app.selection.id : undefined;
    const strip = drawStrip(cur.level, theme, cur.diff, sel, !!cur.sub, heroKey(app.heroId));
    const scale = 1.5;
    strip.canvas.className = 'pixel';
    strip.canvas.style.width = `${strip.canvas.width * scale}px`;
    strip.canvas.style.height = `${strip.canvas.height * scale}px`;
    strip.canvas.addEventListener('click', (e) => {
      const rect = strip.canvas.getBoundingClientRect();
      const id = strip.hit((e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
      app.select(id ? (sel === id ? undefined : { kind: 'item', id }) : undefined);
    });
    const wrap = h('div', { class: 'strip' }, strip.canvas);
    requestAnimationFrame(() => {
      wrap.scrollLeft = scroll ?? Math.max(0, strip.heroX * scale - wrap.clientWidth / 3);
    });
    return wrap;
  }
  return null;
}

function renderNav(app: App, nav: HTMLElement) {
  const state = app.state;
  const pid = app.projectId;
  const next = state && suggestNext(state);
  mount(
    nav,
    h('a', { href: href(togglePad(app.route, 'today')), class: `tab-pad${app.route.pad === 'today' ? ' on' : ''}` }, h('span', { class: 'gear' }, '✎'), h('span', null, 'Today')),
    h('a', { href: href(togglePad(app.route, 'inbox')), class: `tab-pad${app.route.pad === 'inbox' ? ' on' : ''}` }, h('span', { class: 'gear' }, '✉'), h('span', null, 'Inbox')),
    h('a', { href: href({ view: 'projects' }), class: app.route.view === 'projects' ? 'on' : '' }, icon('node-clear', 'grass', 'icon sm'), h('span', null, 'Projects')),
    pid &&
      h('a', { href: href({ view: 'overworld', projectId: pid }), class: app.route.view === 'overworld' ? 'on' : '' }, icon('node', 'grass', 'icon sm'), h('span', null, 'Map')),
    h(
      'button',
      { type: 'button', disabled: !next, onclick: () => next && pid && go({ view: 'level', projectId: pid, ...next }) },
      icon(heroKey(app.heroId), 'grass', 'icon sm'),
      h('span', null, 'Next'),
    ),
    app.caps.canReviewPRs &&
      h('a', { href: href({ view: 'prs' }), class: app.route.view.startsWith('pr') ? 'on' : '' }, icon('warp-pipe', 'grass', 'icon sm'), h('span', null, 'Warp')),
    h('button', { type: 'button', onclick: () => settingsDialog(app) }, h('span', { class: 'gear' }, '⚙'), h('span', null, 'Settings')),
  );
}
