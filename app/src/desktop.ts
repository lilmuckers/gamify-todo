import type { App } from './app';
import { startGame } from './game';
import { h } from './ui/dom';
import { renderHud } from './ui/hud';
import { renderPanel } from './ui/panels';
import { scheduler } from './ui/render-loop';

export function mountDesktop(app: App, root: HTMLElement) {
  const hud = h('header', { class: 'hud' });
  const game = h('div', { class: 'game', 'aria-label': 'Game view' });
  const panel = h('aside', { class: 'panel' });
  root.append(hud, h('main', { class: 'desktop' }, game, panel));
  scheduler(app, panel, () => {
    renderHud(app, hud);
    return renderPanel(app);
  });
  startGame(app, game);
}
