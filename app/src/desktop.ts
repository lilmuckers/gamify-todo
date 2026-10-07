import type { App } from './app';
import { startGame } from './game';
import { bindNavKeys, navFor } from './nav';
import { h, mount } from './ui/dom';
import { renderHud, repaintSyncStatus } from './ui/hud';
import { controllerCanvas } from './sprites/cartridge';
import { canvasUrl } from './sprites/render';
import { renderPanel } from './ui/panels';
import { scheduler } from './ui/render-loop';
import { mountPadOverlay } from './ui/today';
import { mountRecords } from './ui/records';

export function mountDesktop(app: App, root: HTMLElement) {
  const hud = h('header', { class: 'hud' });
  const game = h('div', { class: 'game', 'aria-label': 'Game view' });
  const nav = h('nav', { class: 'game-nav', 'aria-label': 'Level navigation' });
  const panel = h('aside', { class: 'panel' });
  // Today's plan, held up over whatever is on screen.
  const today = h('div');
  // Detailed stats: a page over the game and panel (the pad can still go over it).
  const records = h('div');
  root.append(hud, h('main', { class: 'desktop' }, h('div', { class: 'game-wrap' }, game, nav), panel, records, today));
  scheduler(app, panel, () => {
    renderHud(app, hud);
    renderGameNav(app, nav);
    return renderPanel(app);
  }, () => repaintSyncStatus(app, hud, panel));
  mountPadOverlay(app, today);
  mountRecords(app, records);
  // Before the game starts, so Esc reaches us before Phaser's own key handling.
  bindNavKeys(app);
  startGame(app, game);
}

/** Up / play / previous / next controls floating over the game view. */
function renderGameNav(app: App, el: HTMLElement) {
  const { up, prev, next } = navFor(app);
  el.hidden = !up && !prev && !next;
  mount(
    el,
    up && h('a', { class: 'btn nav-up', href: up.href, title: `${up.label} (Esc)` }, '▲ ', up.label),
    app.canPlay &&
      h(
        'button',
        { class: `btn nav-play${app.playing ? ' on' : ''}`, title: app.playing ? 'Stop playing (P or Esc)' : 'Play with a gamepad or the keyboard (P)', onclick: (e: MouseEvent) => {
            // Space jumps: don't leave it pressing this button again.
            (e.currentTarget as HTMLElement).blur();
            app.setPlaying(!app.playing);
          },
        },
        app.playing ? '■ STOP' : [h('img', { class: 'pad-icon', src: padIcon(), alt: '' }), ' PLAY'],
      ),
    h('span', { class: 'grow' }),
    prev && h('a', { class: 'btn', href: prev.href, title: `${prev.label} ([)` }, '◀ ', h('span', { class: 'nav-label' }, prev.label)),
    next && h('a', { class: 'btn', href: next.href, title: `${next.label} (])` }, h('span', { class: 'nav-label' }, next.label), ' ▶'),
  );
}

/** The bedroom's controller sprite, as a button icon. */
function padIcon() {
  return canvasUrl(controllerCanvas());
}
