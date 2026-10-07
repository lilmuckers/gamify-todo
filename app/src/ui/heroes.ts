import { HERO_IDS, type HeroId } from '@quest/shared';
import type { App } from '../app';
import { heroStore } from '../config';
import { go, href } from '../router';
import { fighterCanvas, IDLE_FRAMES } from '../sprites/fighters';
import { HEROES } from '../sprites/heroes';
import { portraitCanvas } from '../sprites/portraits';
import { h, isTyping } from './dom';

/** The idle loop: a breathing bob. */
const IDLE_MS = 180;
/** Portraits per row in the grid (six by three for eighteen heroes). */
const COLS = 6;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Draws `src` into `c`, replacing what was there. */
function blit(c: HTMLCanvasElement, src: HTMLCanvasElement) {
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
}

/**
 * The heroes (#/heroes, #/heroes/<id>) as a fighting-game select screen: the
 * chosen hero's big pose on the left with their bio under it, the grid of
 * portraits on the right with their name and description under it. A DOM page
 * over the game, like detailed stats.
 */
export function mountHeroes(app: App, host: HTMLElement, opts: { onShow?: (shown: boolean) => void } = {}) {
  host.classList.add('records-host', 'heroes-host');
  host.hidden = true;
  let idle: ReturnType<typeof setInterval> | undefined;
  let shown: { id?: HeroId; mine?: HeroId } = {};

  const pose = h('canvas', { class: 'pixel hp-pose', width: 48, height: 64, role: 'img' });
  const bio = h('p', null);
  const quote = h('q', null);
  const name = h('h3', { class: 'hp-name' });
  const desc = h('p', { class: 'hp-desc' });
  const pick = h('button', { class: 'btn primary hp-pick', type: 'button' });
  const cells = HERO_IDS.map((id) => {
    const face = h('canvas', { class: 'pixel', width: 32, height: 32, 'aria-hidden': 'true' });
    blit(face, portraitCanvas(id));
    const cell = h(
      'a',
      { class: 'hp-cell', href: href({ view: 'heroes', heroId: id }), role: 'radio', 'aria-label': HEROES[id].label, 'aria-checked': 'false' },
      face,
    );
    return { id, cell, face };
  });
  const page = h(
    'div',
    { class: 'heroes-page' },
    h('h2', { class: 'hp-title' }, 'HEROES'),
    h(
      'div',
      { class: 'hp-select' },
      h('div', { class: 'hp-left' }, h('div', { class: 'hp-stage' }, pose, h('div', { class: 'hp-floor' })), h('div', { class: 'hp-bio' }, bio, quote)),
      h(
        'div',
        { class: 'hp-right' },
        h('div', { class: 'hp-grid', role: 'radiogroup', 'aria-label': 'Heroes', style: `--cols:${COLS}` }, cells.map((c) => c.cell)),
        name,
        desc,
        h('div', { class: 'actions' }, pick),
      ),
    ),
  );

  const stopIdle = () => {
    if (idle) clearInterval(idle);
    idle = undefined;
  };
  const startIdle = (id: HeroId) => {
    stopIdle();
    blit(pose, fighterCanvas(id));
    if (reduced()) return;
    let t = 0;
    idle = setInterval(() => {
      if (host.hidden) return stopIdle();
      t = (t + 1) % IDLE_FRAMES.length;
      blit(pose, fighterCanvas(id, IDLE_FRAMES[t]));
    }, IDLE_MS);
  };

  /** Shows `id`: pose, bio, name, description, and the cursor on their portrait. */
  const show = (id: HeroId) => {
    const hero = HEROES[id];
    const changed = shown.id !== id;
    shown = { id, mine: app.heroId };
    if (changed) {
      startIdle(id);
      pose.setAttribute('aria-label', `${hero.label}, in a fighting stance`);
      bio.textContent = hero.bio;
      quote.textContent = hero.quote;
      name.textContent = hero.label.toUpperCase();
      desc.textContent = hero.description;
    }
    for (const c of cells) {
      const on = c.id === id;
      c.cell.classList.toggle('on', on);
      c.cell.setAttribute('aria-checked', String(on));
      c.cell.classList.toggle('mine', c.id === app.heroId);
      // A quick double take as the cursor lands.
      if (on && changed && !reduced()) {
        blit(c.face, portraitCanvas(c.id, 'reacting'));
        setTimeout(() => blit(c.face, portraitCanvas(c.id)), 350);
      }
    }
    const mine = app.heroId === id && heroStore.get() === id;
    pick.textContent = mine ? '✓ YOUR HERO' : 'PICK THIS HERO';
    pick.disabled = mine;
    pick.onclick = () => app.setHero(id);
  };

  const render = () => {
    const r = app.route;
    const visible = r.view === 'heroes';
    if (host.hidden === visible) opts.onShow?.(visible);
    host.hidden = !visible;
    if (!visible) {
      stopIdle();
      shown = {};
      host.replaceChildren();
      return;
    }
    if (!host.contains(page)) host.replaceChildren(page);
    const id = r.heroId ?? app.heroId;
    if (shown.id !== id || shown.mine !== app.heroId) show(id);
  };

  // Arrow keys move the cursor round the grid; Enter picks the hero under it.
  window.addEventListener('keydown', (e) => {
    const r = app.route;
    if (host.hidden || r.view !== 'heroes' || e.altKey || e.metaKey || e.ctrlKey || isTyping() || document.querySelector('.overlay')) return;
    const at = HERO_IDS.indexOf(r.heroId ?? app.heroId);
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS } as Record<string, number>)[e.key];
    if (step) {
      e.preventDefault();
      go({ view: 'heroes', heroId: HERO_IDS[(at + step + HERO_IDS.length) % HERO_IDS.length] });
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement && !e.target.matches('.hp-cell'))) {
      e.preventDefault();
      app.setHero(HERO_IDS[at]);
    }
  });

  app.subscribe((change) => change !== 'sync' && render());
  render();
}
