import type { App } from './app';
import { startGame } from './game';
import { bindNavKeys, navFor } from './nav';
import { h, mount } from './ui/dom';
import { renderHud } from './ui/hud';
import { renderPanel } from './ui/panels';
import { scheduler } from './ui/render-loop';

export function mountDesktop(app: App, root: HTMLElement) {
  const hud = h('header', { class: 'hud' });
  const game = h('div', { class: 'game', 'aria-label': 'Game view' });
  const nav = h('nav', { class: 'game-nav', 'aria-label': 'Level navigation' });
  const panel = h('aside', { class: 'panel' });
  root.append(hud, h('main', { class: 'desktop' }, h('div', { class: 'game-wrap' }, game, nav), panel));
  scheduler(app, panel, () => {
    renderHud(app, hud);
    renderGameNav(app, nav);
    return renderPanel(app);
  });
  // Before the game starts, so Esc reaches us before Phaser's own key handling.
  bindNavKeys(app);
  startGame(app, game);
}

/** Up / previous / next controls floating over the game view. */
function renderGameNav(app: App, el: HTMLElement) {
  const { up, prev, next } = navFor(app);
  el.hidden = !up && !prev && !next;
  mount(
    el,
    up && h('a', { class: 'btn nav-up', href: up.href, title: `${up.label} (Esc)` }, '▲ ', up.label),
    h('span', { class: 'grow' }),
    prev && h('a', { class: 'btn', href: prev.href, title: `${prev.label} ([)` }, '◀ ', h('span', { class: 'nav-label' }, prev.label)),
    next && h('a', { class: 'btn', href: next.href, title: `${next.label} (])` }, h('span', { class: 'nav-label' }, next.label), ' ▶'),
  );
}
