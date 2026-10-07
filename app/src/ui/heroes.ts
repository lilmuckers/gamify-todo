import { HERO_IDS, type HeroId } from '@quest/shared';
import type { App } from '../app';
import { heroStore } from '../config';
import { play as sfx } from '../audio';
import { go, href } from '../router';
import { fighterCanvas, IDLE_FRAMES } from '../sprites/fighters';
import { HEROES, heroKey } from '../sprites/heroes';
import { portraitCanvas } from '../sprites/portraits';
import { sprite } from '../sprites/render';
import { h, isTyping } from './dom';

/** The idle loop: a breathing bob. */
const IDLE_MS = 180;
/** Portraits per row in the grid (six by three for eighteen heroes). */
const COLS = 6;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Screen pixels per art pixel for the big pose (48x64 shown at 192x256). */
const POSE_PX = 4;
const STAGE_W = 48 * POSE_PX;
const STAGE_H = 64 * POSE_PX;

const feetRows = new WeakMap<HTMLCanvasElement, number>();
/** Rows down to the soles: art is padded below the feet by different amounts. */
function feet(src: HTMLCanvasElement): number {
  let rows = feetRows.get(src);
  if (rows === undefined) {
    const d = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
    rows = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) rows = Math.floor((i - 3) / 4 / src.width) + 1;
    feetRows.set(src, rows);
  }
  return rows;
}

/**
 * Draws `src` at a whole-pixel `scale`, centred, with its soles on `floor`
 * (canvas pixels from the top), optionally as a white silhouette.
 */
function stand(c: HTMLCanvasElement, src: HTMLCanvasElement, scale: number, floor: number, opts: { white?: boolean; lift?: number } = {}) {
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, c.width, c.height);
  const w = Math.round(src.width * scale);
  const hgt = Math.round(src.height * scale);
  ctx.drawImage(src, Math.round((c.width - w) / 2), floor - Math.round(feet(src) * scale) - (opts.lift ?? 0), w, hgt);
  if (opts.white) {
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'source-over';
  }
}

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
  /** True while the pick plays out: the grid and keys wait. */
  let busy = false;

  const pose = h('canvas', { class: 'pixel hp-pose', width: 48, height: 64, role: 'img' });
  // The pick's transformation plays here, over the pose, in real screen pixels.
  const morph = h('canvas', { class: 'hp-morph', width: STAGE_W, height: STAGE_H, 'aria-hidden': 'true', hidden: true });
  const flash = h('div', { class: 'hp-flash', 'aria-hidden': 'true' });
  const caption = h('p', { class: 'hp-caption', role: 'status', 'aria-live': 'polite' });
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
      h('div', { class: 'hp-left' }, h('div', { class: 'hp-stage' }, h('div', { class: 'hp-spot' }, pose, morph, flash), h('div', { class: 'hp-floor' })), h('div', { class: 'hp-bio' }, bio, quote)),
      h(
        'div',
        { class: 'hp-right' },
        h('div', { class: 'hp-grid', role: 'radiogroup', 'aria-label': 'Heroes', style: `--cols:${COLS}` }, cells.map((c) => c.cell)),
        name,
        desc,
        h('div', { class: 'actions' }, pick),
        caption,
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
    pick.onclick = () => void choose(id);
  };

  /**
   * Picking a hero, as in a 90s handheld RPG's intro: the big pose throws a
   * victory pose, flashes white, shrinks in pixel steps into the 16x16 sprite,
   * which colours in and hops. Then back to the project floor. Reduced motion
   * (or a hidden tab) skips straight to the end.
   */
  const choose = async (id: HeroId) => {
    if (busy) return;
    busy = true;
    host.classList.add('picking');
    pick.disabled = true;
    const hero = HEROES[id];
    let skip = reduced() || document.hidden;
    const onHide = () => document.hidden && (skip = true);
    document.addEventListener('visibilitychange', onHide);
    const wait = (ms: number) => (skip ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms)));
    const flashOnce = (opacity: number, ms: number) => !skip && flash.animate([{ opacity }, { opacity: 0 }], { duration: ms });
    const body = fighterCanvas(id, 'win');
    const small = (frame: 'stand' | 'jump') => sprite(heroKey(id, frame));
    // Everything stands where the big pose's feet are, so nobody sinks into the floor.
    const floor = feet(body) * POSE_PX;
    const draw = (src: HTMLCanvasElement, scale: number, opts?: { white?: boolean; lift?: number }) => stand(morph, src, scale, floor, opts);

    stopIdle();
    if (!skip) {
      sfx('start');
      morph.hidden = false;
      pose.style.visibility = 'hidden';
      draw(body, POSE_PX);
      await wait(380);
      flashOnce(0.9, 260);
      draw(body, POSE_PX, { white: true });
      await wait(260);
      sfx('whoosh');
      // Snapped steps, not a smooth tween: it should look like the old hardware did it.
      for (const scale of [3, 2, 1]) {
        if (skip) break;
        draw(body, scale, { white: true });
        await wait(130);
      }
      draw(small('stand'), POSE_PX, { white: true });
      await wait(160);
      draw(small('stand'), 3, { white: true });
      await wait(90);
    }
    // The hero is yours as the sprite colours in.
    app.setHero(id);
    draw(small('stand'), POSE_PX);
    morph.hidden = false;
    pose.style.visibility = 'hidden';
    flashOnce(0.5, 160);
    await wait(220);
    if (!skip) {
      sfx('jump');
      for (const lift of [12, 20, 12, 0]) {
        draw(small(lift ? 'jump' : 'stand'), POSE_PX, { lift });
        await wait(70);
      }
    }
    caption.textContent = `✓ ${hero.label} is your hero`;
    if (!skip) sfx('win');
    await wait(1100);
    document.removeEventListener('visibilitychange', onHide);
    busy = false;
    host.classList.remove('picking');
    caption.textContent = '';
    morph.hidden = true;
    pose.style.visibility = '';
    shown = {};
    go({ view: 'projects' });
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
    if (busy) return;
    const id = r.heroId ?? app.heroId;
    if (shown.id !== id || shown.mine !== app.heroId) show(id);
  };

  // Arrow keys move the cursor round the grid; Enter picks the hero under it.
  window.addEventListener('keydown', (e) => {
    const r = app.route;
    if (host.hidden || busy || r.view !== 'heroes' || e.altKey || e.metaKey || e.ctrlKey || isTyping() || document.querySelector('.overlay')) return;
    const at = HERO_IDS.indexOf(r.heroId ?? app.heroId);
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS } as Record<string, number>)[e.key];
    if (step) {
      e.preventDefault();
      go({ view: 'heroes', heroId: HERO_IDS[(at + step + HERO_IDS.length) % HERO_IDS.length] });
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement && !e.target.matches('.hp-cell'))) {
      e.preventDefault();
      void choose(HERO_IDS[at]);
    }
  });

  app.subscribe((change) => change !== 'sync' && render());
  render();
}
