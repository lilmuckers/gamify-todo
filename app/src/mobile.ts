import { isWorldLocked, orderedWorlds, suggestNext, worldTotals } from '@quest/shared';
import type { App } from './app';
import { go, href } from './router';
import { island } from './sprites/render';
import { drawStrip } from './sprites/strip';
import { h, icon, mount } from './ui/dom';
import { renderHud } from './ui/hud';
import { renderPanel } from './ui/panels';
import { scheduler } from './ui/render-loop';
import { settingsDialog } from './ui/settings';

/** Compact, touch-first layout for phones: DOM screens plus a static level strip. */
export function mountMobile(app: App, root: HTMLElement) {
  const hud = h('header', { class: 'hud' });
  const body = h('main', { class: 'mobile-body' });
  const nav = h('nav', { class: 'tabbar' });
  root.append(hud, body, nav);

  let stripScroll: number | undefined;
  scheduler(app, body, () => {
    renderHud(app, hud);
    renderNav(app, nav);
    const prevStrip = body.querySelector('.strip');
    if (prevStrip) stripScroll = prevStrip.scrollLeft;
    const visual = renderVisual(app, stripScroll);
    return h('div', null, visual, renderPanel(app));
  });
  window.addEventListener('hashchange', () => (stripScroll = undefined));
}

function renderVisual(app: App, scroll?: number): HTMLElement | null {
  const r = app.route;
  const state = app.state;
  if (r.view === 'overworld' && state) {
    const next = suggestNext(state);
    return h(
      'div',
      { class: 'islands' },
      orderedWorlds(state).map((w, i) => {
        const t = worldTotals(w);
        return h(
          'a',
          { class: 'island', href: href({ view: 'world', worldId: w.id }) },
          h('img', { src: island(w.theme, isWorldLocked(state, w)).toDataURL(), class: 'pixel', alt: '' }),
          h('b', null, `${i + 1}. ${w.name}`),
          h('small', null, `★${t.stars}/${t.maxStars}${next?.worldId === w.id ? ' · ▶' : ''}`),
        );
      }),
    );
  }
  const cur = app.currentLevel();
  if (cur) {
    const theme = r.view === 'pr-level' ? 'warp' : cur.world.theme;
    const sel = app.selection?.kind === 'item' ? app.selection.id : undefined;
    const strip = drawStrip(cur.level, theme, cur.diff, sel);
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
  const next = state && suggestNext(state);
  mount(
    nav,
    h('a', { href: href({ view: 'overworld' }), class: app.route.view === 'overworld' ? 'on' : '' }, icon('node', 'grass', 'icon sm'), h('span', null, 'Map')),
    h(
      'button',
      { type: 'button', disabled: !next, onclick: () => next && go({ view: 'level', ...next }) },
      icon('hero', 'grass', 'icon sm'),
      h('span', null, 'Next'),
    ),
    app.caps.canReviewPRs &&
      h('a', { href: href({ view: 'prs' }), class: app.route.view.startsWith('pr') ? 'on' : '' }, icon('warp-pipe', 'grass', 'icon sm'), h('span', null, 'Warp')),
    h('button', { type: 'button', onclick: () => settingsDialog(app) }, h('span', { class: 'gear' }, '⚙'), h('span', null, 'Settings')),
  );
}
