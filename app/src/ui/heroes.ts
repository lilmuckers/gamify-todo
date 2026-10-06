import { HERO_IDS, type HeroId } from '@quest/shared';
import type { App } from '../app';
import { heroStore } from '../config';
import { href } from '../router';
import { fighterCanvas, IDLE_FRAMES } from '../sprites/fighters';
import { HEROES, heroKey, type HeroFrame } from '../sprites/heroes';
import { PALETTE, THEMES } from '../sprites/pixels';
import { emoteCanvas, FACES, portraitCanvas } from '../sprites/portraits';
import { sprite } from '../sprites/render';
import { junkLines } from '../game/junk-lines';
import { TOUR_LINES } from './onboarding/tour-lines';
import { parseLine, showDialogue, type Dialogue } from './dialogue';
import { h, isTyping } from './dom';

/** Screen pixels per art pixel for the big pose on the profile (and half that in the gallery). */
const POSE_PX = 4;
/** The idle loop: a breathing bob. */
const IDLE_MS = 180;

const SLOT_ROLES: [slot: string, role: string][] = [
  ['1', 'Hair'],
  ['2', 'Hair shade'],
  ['3', 'Skin'],
  ['4', 'Skin shade'],
  ['5', 'Top'],
  ['6', 'Top accent'],
  ['7', 'Bottoms'],
  ['8', 'Bottoms shade'],
  ['9', 'Shoes'],
  ['0', 'Shoe accent'],
];
/** Classic is drawn in palette letters, not slots. */
const CLASSIC_ROLES: [letter: string, role: string][] = [
  ['c', 'Cap'],
  ['C', 'Cap shade'],
  ['s', 'Skin'],
  ['S', 'Skin shade'],
  ['N', 'Hair and shoes'],
  ['o', 'Collar'],
  ['b', 'Overalls'],
  ['B', 'Overall shade'],
];

/** Where the sprite frames are shown, to check they read on every ground. */
const GROUNDS: { id: string; label: string; color: string }[] = [
  ...(['grass', 'desert', 'water', 'ice', 'sky', 'castle'] as const).map((t) => ({ id: t, label: t[0].toUpperCase() + t.slice(1), color: THEMES[t].sky })),
  { id: 'panel', label: 'Panel', color: '#262b44' },
  { id: 'pad', label: 'Legal pad', color: '#fdf3a7' },
];
const FRAMES: HeroFrame[] = ['stand', 'walk', 'jump'];

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A copy of a shared canvas, so the same art can sit in several places at once. */
function copy(src: HTMLCanvasElement, cls: string, scale: number, label?: string) {
  const c = h('canvas', {
    class: `pixel ${cls}`,
    width: src.width,
    height: src.height,
    style: `width:${src.width * scale}px;height:${src.height * scale}px`,
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }),
  });
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

/** What the hero might say: their tour lines (bar the last stop's sign-off) and general console lines. */
function sayings(id: HeroId): string[] {
  const tour = Object.entries(TOUR_LINES[id])
    .filter(([stop]) => stop !== 'ai')
    .flatMap(([, lines]) => lines);
  const junk = junkLines(id, 'any').map((l) => l.replaceAll('{game}', 'THIS').replaceAll('{label}', 'this'));
  return [...tour, ...junk];
}

/**
 * The hero gallery (#/heroes) and each hero's profile (#/heroes/<id>): a DOM
 * page over the game, like detailed stats. A profile shows the big pose, the
 * bio, the colour slots, the 16x16 frames on every ground and both portraits,
 * so it's also where new hero art gets checked.
 */
export function mountHeroes(app: App, host: HTMLElement, opts: { onShow?: (shown: boolean) => void } = {}) {
  host.classList.add('records-host', 'heroes-host');
  host.hidden = true;
  let shown: { heroId?: HeroId | 'gallery'; mine?: HeroId } = {};
  let idle: ReturnType<typeof setInterval> | undefined;
  let ground = 'grass';
  let dialogue: Dialogue | undefined;
  let lastLine: string | undefined;

  const stopIdle = () => {
    if (idle) clearInterval(idle);
    idle = undefined;
  };
  const closeDialogue = () => {
    dialogue?.close();
    dialogue = undefined;
  };

  /** Steps a pose canvas through the idle loop (unless motion is reduced). */
  const animate = (id: HeroId, canvases: HTMLCanvasElement[]) => {
    stopIdle();
    if (reduced()) return;
    let t = 0;
    idle = setInterval(() => {
      if (!host.isConnected || host.hidden) return stopIdle();
      t = (t + 1) % IDLE_FRAMES.length;
      for (const c of canvases) {
        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(fighterCanvas(id, IDLE_FRAMES[t]), 0, 0);
      }
    }, IDLE_MS);
  };

  const pickButton = (id: HeroId) => {
    const mine = app.heroId === id && heroStore.get() === id;
    return h(
      'button',
      {
        class: `btn ${mine ? '' : 'primary'} hp-pick`,
        type: 'button',
        disabled: mine,
        onclick: () => app.setHero(id),
      },
      mine ? '✓ YOUR HERO' : 'PICK THIS HERO',
    );
  };

  const gallery = () =>
    h(
      'div',
      { class: 'heroes-page' },
      h('div', { class: 'ds-head' }, h('h2', null, 'HEROES'), h('p', { class: 'muted' }, `${HERO_IDS.length} heroes. Pick one to see their profile.`)),
      h(
        'ul',
        { class: 'hp-grid' },
        HERO_IDS.map((id) =>
          h(
            'li',
            null,
            h(
              'a',
              { class: `hp-card${id === app.heroId ? ' mine' : ''}`, href: href({ view: 'heroes', heroId: id }) },
              h('span', { class: 'hp-card-art' }, copy(fighterCanvas(id), 'hp-card-pose', 2), copy(portraitCanvas(id), 'hp-card-face', 2)),
              h('b', null, HEROES[id].label),
              h('small', null, HEROES[id].bio),
              id === app.heroId ? h('span', { class: 'hp-tag' }, 'P1') : null,
            ),
          ),
        ),
      ),
    );

  const profile = (id: HeroId) => {
    const hero = HEROES[id];
    const i = HERO_IDS.indexOf(id);
    const prev = HERO_IDS[(i - 1 + HERO_IDS.length) % HERO_IDS.length];
    const next = HERO_IDS[(i + 1) % HERO_IDS.length];
    const pose = copy(fighterCanvas(id), 'hp-pose', POSE_PX, `${hero.label}, in a fighting stance`);
    const stage = h('div', { class: 'hp-stage' }, pose, h('div', { class: 'hp-floor' }));

    const say = h(
      'button',
      {
        class: 'btn hp-say',
        type: 'button',
        onclick: () => {
          closeDialogue();
          const pool = sayings(id).filter((l) => l !== lastLine);
          lastLine = pool[Math.floor(Math.random() * pool.length)];
          // The box sits along the bottom of the pose and bio, as it does over the game.
          dialogue = showDialogue({ hero: id, line: parseLine(lastLine), host: say.closest<HTMLElement>('.hp-top')!, px: 3, instant: reduced() });
        },
      },
      'SAY SOMETHING',
    );

    const colors = hero.colors;
    const swatches = (colors ? SLOT_ROLES.map(([s, role]) => [s, role, colors[s]]) : CLASSIC_ROLES.map(([l, role]) => [l, role, PALETTE[l]])).map(([s, role, c]) =>
      h('li', null, h('i', { style: `background:${c}` }), h('span', null, h('b', null, s), ` ${role}`)),
    );

    const frames = h('div', { class: 'hp-frames' });
    const drawFrames = () => {
      const g = GROUNDS.find((x) => x.id === ground) ?? GROUNDS[0];
      frames.style.background = g.color;
      frames.replaceChildren(
        ...FRAMES.map((f) => h('figure', null, copy(sprite(heroKey(id, f)), 'hp-frame', 8, `${hero.label}, ${f}`), h('figcaption', null, f))),
      );
    };
    drawFrames();
    const grounds = h(
      'div',
      { class: 'hp-grounds', role: 'group', 'aria-label': 'Background' },
      GROUNDS.map((g) =>
        h(
          'button',
          {
            class: `chip${g.id === ground ? ' on' : ''}`,
            type: 'button',
            'aria-pressed': String(g.id === ground),
            onclick: (e: Event) => {
              ground = g.id;
              for (const b of grounds.children) {
                const on = b === e.currentTarget;
                b.classList.toggle('on', on);
                b.setAttribute('aria-pressed', String(on));
              }
              drawFrames();
            },
          },
          h('i', { style: `background:${g.color}` }),
          g.label,
        ),
      ),
    );

    const page = h(
      'div',
      { class: 'heroes-page hp-profile' },
      h(
        'nav',
        { class: 'hp-steps' },
        h('a', { class: 'btn sm', href: href({ view: 'heroes', heroId: prev }), 'aria-label': `Previous hero: ${HEROES[prev].label}` }, '◀'),
        h('a', { class: 'btn sm', href: href({ view: 'heroes' }) }, 'ALL HEROES'),
        h('a', { class: 'btn sm', href: href({ view: 'heroes', heroId: next }), 'aria-label': `Next hero: ${HEROES[next].label}` }, '▶'),
      ),
      h(
        'div',
        { class: 'hp-top' },
        stage,
        h(
          'div',
          { class: 'hp-card-info' },
          h('h2', null, hero.label.toUpperCase()),
          h('p', { class: 'hp-desc' }, hero.description),
          h('div', { class: 'hp-bio' }, h('p', null, hero.bio), h('q', null, hero.quote)),
          h('p', { class: 'hp-voice' }, h('b', null, 'Voice: '), hero.voice),
          h('div', { class: 'actions' }, pickButton(id), say),
        ),
      ),
      h('h3', null, 'Colours'),
      h('ul', { class: 'hp-swatches' }, swatches),
      h('h3', null, 'In the game (16×16)'),
      grounds,
      frames,
      h('h3', null, 'Portraits'),
      h(
        'div',
        { class: 'hp-faces' },
        FACES.map((f) =>
          h(
            'figure',
            null,
            h('span', { class: 'hp-face' }, copy(portraitCanvas(id, f), 'hp-face-art', 4, `${hero.label}, ${f}`), copy(emoteCanvas(f === 'neutral' ? 'happy' : 'shocked'), 'hp-emote', 3)),
            h('figcaption', null, f),
          ),
        ),
      ),
    );
    animate(id, [pose]);
    return page;
  };

  const render = () => {
    const r = app.route;
    const show = r.view === 'heroes';
    if (host.hidden === show) opts.onShow?.(show);
    host.hidden = !show;
    if (!show) {
      shown = {};
      stopIdle();
      closeDialogue();
      host.replaceChildren();
      return;
    }
    const want = r.heroId ?? 'gallery';
    // Redraw only when the page or the chosen hero changes, so the idle loop and a line being said carry on.
    if (shown.heroId === want && shown.mine === app.heroId) return;
    const sameHero = shown.heroId === want;
    shown = { heroId: want, mine: app.heroId };
    if (sameHero && r.heroId) {
      host.querySelector('.hp-pick')?.replaceWith(pickButton(r.heroId));
      return;
    }
    closeDialogue();
    stopIdle();
    host.replaceChildren(r.heroId ? profile(r.heroId) : gallery());
    host.scrollTop = 0;
  };

  // ← and → step through the heroes on a profile ([ and ] work too, via the nav keys).
  window.addEventListener('keydown', (e) => {
    const r = app.route;
    if (host.hidden || r.view !== 'heroes' || !r.heroId || e.altKey || e.metaKey || e.ctrlKey || isTyping() || document.querySelector('.overlay')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = HERO_IDS.indexOf(r.heroId);
    const id = HERO_IDS[(i + (e.key === 'ArrowLeft' ? -1 : 1) + HERO_IDS.length) % HERO_IDS.length];
    e.preventDefault();
    location.hash = href({ view: 'heroes', heroId: id });
  });

  app.subscribe((change) => change !== 'sync' && render());
  render();
}
