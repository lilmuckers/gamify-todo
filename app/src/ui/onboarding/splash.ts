import { HERO_IDS, type HeroId } from '@quest/shared';
import { track } from '../../analytics';
import { heroKey } from '../../sprites/heroes';
import { spriteUrl } from '../../sprites/render';
import { h } from '../dom';

export type Choice = 'demo' | 'tour' | 'start';

/** Three different heroes for the box cover: a new cast every time. */
function cast(r: () => number = Math.random): HeroId[] {
  const pool = [...HERO_IDS];
  const out: HeroId[] = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}

const CHOICES: { id: Choice; label: string; blurb: string; cls: string }[] = [
  { id: 'demo', label: '▶ PLAY THE DEMO', blurb: 'Try everything with example games. Nothing is saved.', cls: 'play' },
  { id: 'tour', label: '? TAKE THE TOUR', blurb: 'A guided walk through how it all works.', cls: 'tour' },
  { id: 'start', label: '★ GET STARTED', blurb: 'Connect your own GitHub repo, step by step.', cls: 'start' },
];

/**
 * The welcome screen: a console box and a magazine-ad blurb, with three ways
 * in. Plain HTML over the app, so it's quick to show and easy to read.
 */
export function showSplash(onChoose: (c: Choice | 'skip') => void): () => void {
  const [left, middle, right] = cast();
  const sprite = (id: HeroId, frame: 'stand' | 'jump', cls: string) => h('img', { class: `pixel splash-hero ${cls}`, src: spriteUrl(heroKey(id, frame)), alt: '' });
  let done = false;
  const choose = (c: Choice | 'skip') => {
    if (done) return;
    done = true;
    close();
    track('onboarding_choice', { choice: c });
    onChoose(c);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    choose('skip');
  };
  const buttons = CHOICES.map((c) =>
    h('button', { class: `splash-btn ${c.cls}`, type: 'button', onclick: () => choose(c.id) }, h('span', { class: 'splash-btn-label' }, c.label), h('small', null, c.blurb)),
  );
  const el = h(
    'div',
    { class: 'splash', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'splash-title' },
    h(
      'div',
      { class: 'splash-stage' },
      h(
        'div',
        { class: 'splash-box', 'aria-hidden': 'true' },
        h(
          'div',
          { class: 'splash-front' },
          h('div', { class: 'splash-banner' }, h('span', null, '16-BIT'), h('span', null, '1 PLAYER'), h('span', null, 'SAVE TO GITHUB')),
          h('div', { class: 'splash-logo' }, 'QUEST', h('br'), 'LOG'),
          h('div', { class: 'splash-sub' }, 'THE PROJECT ADVENTURE'),
          h('div', { class: 'splash-cloud c1' }),
          h('div', { class: 'splash-cloud c2' }),
          h('div', { class: 'splash-q q1' }, '?'),
          h('div', { class: 'splash-q q2' }, '?'),
          sprite(left, 'stand', 'h1'),
          sprite(middle, 'jump', 'h2'),
          sprite(right, 'stand', 'h3'),
          h('div', { class: 'splash-tag' }, 'WORLD 1-1'),
          h('div', { class: 'splash-seal' }, 'OFFICIAL', h('br'), 'SEAL OF', h('br'), 'GETTING', h('br'), 'THINGS', h('br'), 'DONE'),
        ),
        h('div', { class: 'splash-spine' }, h('span', null, 'QUEST LOG')),
      ),
      h(
        'div',
        { class: 'splash-copy' },
        h('p', { class: 'splash-kicker' }, '▶ NEW FROM QUEST LOG'),
        h('h1', { id: 'splash-title' }, "NOW YOU'RE PLAYING WITH PROJECTS!"),
        h(
          'ul',
          null,
          h('li', null, 'Every project is a ', h('b', null, 'game'), '. Every milestone a ', h('b', null, 'level'), '.'),
          h('li', null, 'Tasks are ', h('b', null, '? blocks'), '. Blockers are ', h('b', null, 'brick walls'), '.'),
          h('li', null, "Clear the flagpole when it's ", h('b', null, 'good enough'), ', not perfect.'),
          h('li', null, 'Saves straight to ', h('b', null, 'your own GitHub repo'), '. No account, no server.'),
        ),
        h('div', { class: 'splash-ctas' }, buttons),
        h(
          'p',
          { class: 'splash-fine' },
          'Batteries not included. Procrastination sold separately. ',
          h('button', { class: 'link splash-skip', type: 'button', onclick: () => choose('skip') }, 'Skip, just look around'),
        ),
      ),
    ),
  );
  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  document.body.append(el);
  document.addEventListener('keydown', onKey, true);
  buttons[0].focus();
  track('onboarding_view');
  return close;
}

/** A shared link on a first visit: show the link, with a small way in instead of the full splash. */
export function showBanner(onChoose: (c: Choice | 'skip') => void): () => void {
  const choose = (c: Choice | 'skip') => {
    el.remove();
    track('onboarding_choice', { choice: c, via: 'banner' });
    onChoose(c);
  };
  const el = h(
    'div',
    { class: 'welcome-banner', role: 'region', 'aria-label': 'Welcome' },
    h('b', null, 'New here?'),
    ...CHOICES.map((c) => h('button', { class: `btn sm ${c.cls}`, type: 'button', onclick: () => choose(c.id) }, c.label)),
    h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': 'Dismiss', onclick: () => choose('skip') }, '✕'),
  );
  document.body.append(el);
  track('onboarding_view', { via: 'banner' });
  return () => el.remove();
}
