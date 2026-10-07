import { HERO_IDS, type HeroId } from '@quest/shared';
import type { App } from '../app';
import { play as sfx } from '../audio';
import { heroStore } from '../config';
import { fighterCanvas, IDLE_FRAMES } from '../sprites/fighters';
import { HEROES, heroKey } from '../sprites/heroes';
import { portraitCanvas } from '../sprites/portraits';
import { sprite } from '../sprites/render';
import { h, isTyping } from './dom';
import { openModal } from './modal';

/** The idle loop: a breathing bob. */
const IDLE_MS = 180;
/** Portraits per row in the grid (six by three for eighteen heroes). */
const COLS = 6;
/** Screen pixels per art pixel for the big pose (48x64 shown at 192x256). */
const POSE_PX = 4;
const STAGE_W = 48 * POSE_PX;
const STAGE_H = 64 * POSE_PX;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Draws `src` into `c`, replacing what was there. */
function blit(c: HTMLCanvasElement, src: HTMLCanvasElement) {
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
}

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

export interface HeroSelectOptions {
  /** 'arcade' (dark, for the Settings modal) or 'manual' (the set-up guide's cream pages). */
  theme?: 'arcade' | 'manual';
  /** After the transformation has played and the hero is yours. */
  onPicked?: (id: HeroId) => void;
}

/**
 * A fighting-game character select: the hero under the cursor stands on a
 * stage in their big pose with their bio under it; a grid of portraits sits
 * beside it with the name and description under that. Picking plays the
 * transformation from a 90s handheld RPG's intro: the pose flashes white and
 * shrinks in pixel steps into the 16x16 sprite, which colours in and hops.
 */
export function heroSelect(app: App, opts: HeroSelectOptions = {}): { el: HTMLElement; destroy(): void } {
  let current: HeroId = app.heroId;
  let idle: ReturnType<typeof setInterval> | undefined;
  /** True while the pick plays out: the grid and keys wait. */
  let busy = false;
  let alive = true;
  /** A pointer is pressing a portrait (so its focus isn't a keyboard move). */
  let pressing = false;

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
    const cell = h('button', { class: 'hp-cell', type: 'button', role: 'radio', 'aria-label': HEROES[id].label, 'aria-checked': 'false' }, face);
    // A click moves the cursor here; a click on the hero already under it picks them.
    cell.addEventListener('click', () => {
      pressing = false;
      if (current === id) void choose(id);
      else move(id);
    });
    // Tabbing onto a portrait moves the cursor too, so Enter picks the one with focus.
    // Not for a mouse press, which focuses first: its click moves the cursor instead.
    cell.addEventListener('pointerdown', () => (pressing = true));
    cell.addEventListener('focus', () => !pressing && move(id));
    return { id, cell, face };
  });
  const el = h(
    'div',
    { class: `hero-select hp-${opts.theme ?? 'arcade'}` },
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
      if (!el.isConnected) return stopIdle();
      t = (t + 1) % IDLE_FRAMES.length;
      blit(pose, fighterCanvas(id, IDLE_FRAMES[t]));
    }, IDLE_MS);
  };

  /** The button reads "✓ YOUR HERO" when the hero under the cursor is already yours. */
  const refreshPick = () => {
    const mine = app.heroId === current && heroStore.get() === current;
    pick.textContent = mine ? '✓ YOUR HERO' : 'PICK THIS HERO';
    pick.disabled = mine || busy;
    for (const c of cells) c.cell.classList.toggle('mine', c.id === app.heroId);
  };

  /** Moves the cursor to `id`: pose, bio, name, description and the highlighted portrait. */
  const move = (id: HeroId, first = false) => {
    if (busy || (id === current && !first)) return;
    current = id;
    const hero = HEROES[id];
    startIdle(id);
    pose.setAttribute('aria-label', `${hero.label}, in a fighting stance`);
    bio.textContent = hero.bio;
    quote.textContent = hero.quote;
    name.textContent = hero.label.toUpperCase();
    desc.textContent = hero.description;
    for (const c of cells) {
      const on = c.id === id;
      c.cell.classList.toggle('on', on);
      c.cell.setAttribute('aria-checked', String(on));
      // A quick double take as the cursor lands.
      if (on && !first && !reduced()) {
        blit(c.face, portraitCanvas(c.id, 'reacting'));
        setTimeout(() => blit(c.face, portraitCanvas(c.id)), 350);
      }
    }
    if (!first) sfx('select');
    refreshPick();
  };

  /** Picks `id`: the transformation, then `onPicked`. Reduced motion (or a hidden tab) skips to the end. */
  const choose = async (id: HeroId) => {
    if (busy) return;
    busy = true;
    el.classList.add('picking');
    refreshPick();
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
    const draw = (src: HTMLCanvasElement, scale: number, o?: { white?: boolean; lift?: number }) => stand(morph, src, scale, floor, o);

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
    el.classList.remove('picking');
    if (!alive) return;
    opts.onPicked?.(id);
    // Still showing (the set-up guide stays put): back to the pose, with the new hero marked.
    morph.hidden = true;
    pose.style.visibility = '';
    startIdle(current);
    refreshPick();
  };
  pick.addEventListener('click', () => void choose(current));

  // Arrow keys move the cursor round the grid; Enter picks. Only while this
  // select is on top: not under another dialog.
  const onKey = (e: KeyboardEvent) => {
    if (!el.isConnected || busy || e.altKey || e.metaKey || e.ctrlKey || isTyping()) return;
    const overlays = document.querySelectorAll('.overlay');
    const top = overlays[overlays.length - 1];
    if (top && !top.contains(el)) return;
    const at = HERO_IDS.indexOf(current);
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS } as Record<string, number>)[e.key];
    if (step) {
      e.preventDefault();
      e.stopPropagation();
      move(HERO_IDS[(at + step + HERO_IDS.length) % HERO_IDS.length]);
      cells.find((c) => c.id === current)?.cell.focus();
    } else if (e.key === 'Enter' && (!(e.target instanceof HTMLButtonElement) || e.target.matches('.hp-cell'))) {
      e.preventDefault();
      void choose(current);
    }
  };
  // Capture, so the arrows don't also scroll the page or the set-up guide.
  window.addEventListener('keydown', onKey, true);

  move(current, true);
  return {
    el,
    destroy() {
      alive = false;
      stopIdle();
      window.removeEventListener('keydown', onKey, true);
    },
  };
}

/** The character select in a modal over Settings. It closes itself once the hero is picked. */
export function openHeroSelect(app: App, onPicked?: (id: HeroId) => void) {
  let close = () => {};
  const select = heroSelect(app, {
    onPicked: (id) => {
      close();
      onPicked?.(id);
    },
  });
  close = openModal('CHOOSE YOUR HERO', select.el, [{ label: 'Close' }], { wide: true, onClose: () => select.destroy() });
}
