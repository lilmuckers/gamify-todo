import { seeded, todayList, type TodayFocus, type TodayItem, type TodayLevel } from '@quest/shared';
import { HEROES } from '../sprites/heroes';
import { PALETTE } from '../sprites/pixels';
import type { App } from '../app';
import { href, withPad, type PadPage } from '../router';
import { play as sfx } from '../audio';
import { inboxCount, inboxSheet } from './inbox';
import { reviewSheet } from './weekly';
import { statsScreen } from './stats';
import { fmtDuration, h, keepFields } from './dom';

const DAY_MS = 86_400_000;

/** A slightly wobbly hand-drawn square, for the tick boxes. */
const BOX_PATH = 'M2.5 3.2 C6 2.4 11 2.9 15.6 2.6 C15.9 7 15.4 11.5 15.8 15.4 C11.2 15.9 6.4 15.2 2.4 15.7 C2.8 11.4 2.1 7.2 2.5 3.2 Z';
const TICK_PATH = 'M4.5 9.5 L8 13 L16 2.5';

function svg(viewBox: string, cls: string, paths: string[]) {
  const ns = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(ns, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('class', cls);
  el.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    el.append(p);
  }
  return el;
}

const where = (r: { code: string; projectTitle: string }) => h('span', { class: 'pad-where' }, `${r.code} · ${r.projectTitle}`);
const code = (c: string, red = false) => h('span', { class: `pad-code${red ? ' red' : ''}` }, c);

function itemHref(r: TodayItem) {
  return href({ view: 'level', projectId: r.projectId, worldId: r.worldId, levelId: r.levelId, subId: r.subId, itemId: r.item.id });
}

/**
 * Today's plan, scrawled on a yellow legal pad: levels running out of time,
 * what's in progress and where the hero is waiting, across every project.
 * Every line deep-links to its level, item or dependency step.
 */
function todaySheet(app: App) {
  const ws = app.workspace;
  const list = ws ? todayList(ws, Date.now(), app.review.focus) : { focus: [], overdue: [], doing: [], next: [] };
  const edit = app.caps.canEdit;
  const today = new Date();

  const setStatus = (r: TodayItem, status: 'done' | 'doing', line: HTMLElement) => {
    const run = () =>
      app.dispatch(
        {
          kind: 'setItemStatus',
          projectId: r.projectId,
          worldId: r.worldId,
          levelId: r.levelId,
          ...(r.subId ? { parentId: r.subId } : {}),
          itemId: r.item.id,
          status,
        },
        { source: 'today' },
      );
    if (status === 'done') sfx('pen');
    if (status !== 'done' || matchMedia('(prefers-reduced-motion: reduce)').matches) return run();
    // Pen stroke through the line, then let the list re-render without it.
    line.classList.add('struck');
    setTimeout(run, 420);
  };

  const itemLine = (r: TodayItem) => {
    // Assigned below; the click handlers only run after that.
    let line!: HTMLElement;
    const box = h(
      'button',
      {
        class: 'pad-box',
        type: 'button',
        disabled: !edit,
        title: edit ? 'Done!' : 'Read-only',
        'aria-label': `Mark "${r.item.title}" done`,
        onclick: () => setStatus(r, 'done', line),
      },
      svg('0 0 18 18', 'pad-box-svg', [BOX_PATH, TICK_PATH]),
    );
    const label = r.suggested
      ? ['start ', code(r.code), ` ${r.levelName}: `, r.item.title]
      : [r.depTitle ? h('span', { class: 'pad-dep' }, `⬇ ${r.depTitle}: `) : null, r.item.title];
    line = h(
      'li',
      { class: `pad-line${r.phase === 'overdue' ? ' late' : ''}${r.focus ? ' focus' : ''}` },
      box,
      h('a', { class: 'pad-link', href: itemHref(r) }, ...label),
      r.suggested ? h('span', { class: 'pad-where' }, r.projectTitle) : where(r),
      edit &&
        r.item.status === 'todo' &&
        h('button', { class: 'pad-start', type: 'button', title: 'Start it', 'aria-label': `Start "${r.item.title}"`, onclick: () => setStatus(r, 'doing', line) }, '▶'),
      svg('0 0 100 10', 'pad-strike', ['M1 6 C 30 3, 60 8, 99 4']),
    );
    return line;
  };

  const levelLine = (r: TodayLevel) => {
    const over = r.phase === 'overdue';
    const days = Math.max(1, Math.round(Math.abs(r.remainingMs) / DAY_MS));
    const note = over
      ? `${days} day${days === 1 ? '' : 's'} over`
      : r.remainingMs < DAY_MS
        ? `${fmtDuration(r.remainingMs)} left`
        : `${days} day${days === 1 ? '' : 's'} left`;
    return h(
      'li',
      { class: `pad-line level${over ? ' late' : ''}` },
      code(r.code, over),
      h('a', { class: 'pad-link', href: href({ view: 'level', projectId: r.projectId, worldId: r.worldId, levelId: r.levelId }) }, r.levelName),
      over && h('span', { class: 'pad-bang', 'aria-hidden': 'true' }, '!!'),
      h('span', { class: 'pad-where' }, `${note} · ${r.mvpLeft} must-do${r.mvpLeft === 1 ? '' : 's'} · ${r.projectTitle}`),
    );
  };

  const focusLine = (r: TodayFocus) =>
    h(
      'li',
      { class: `pad-line level${r.phase === 'overdue' ? ' late' : ''}` },
      code(r.code, r.phase === 'overdue'),
      h('a', { class: 'pad-link', href: href({ view: 'level', projectId: r.projectId, worldId: r.worldId, levelId: r.levelId }) }, r.levelName),
      h('span', { class: 'pad-where' }, `${r.mvpLeft} must-do${r.mvpLeft === 1 ? '' : 's'} · ${r.projectTitle}`),
    );

  // A pad page only holds so much: the rest is summed up in one line.
  const MAX_LINES = 8;
  const section = (title: string, cls: string, lines: HTMLElement[]) =>
    lines.length
      ? h(
          'section',
          { class: `pad-section ${cls}` },
          h('h3', null, title),
          h(
            'ul',
            null,
            lines.slice(0, MAX_LINES),
            lines.length > MAX_LINES && h('li', { class: 'pad-line more' }, `+ ${lines.length - MAX_LINES} more…`),
          ),
        )
      : null;

  const empty = !list.overdue.length && !list.doing.length && !list.next.length;
  return [
    h('div', { class: 'pad-date' }, today.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })),
    h('h2', { class: 'pad-title' }, "TODAY'S QUESTS"),
    section("THIS WEEK'S FOCUS ★", 'focus', list.focus.map(focusLine)),
    section('RUNNING OUT!!', 'late', list.overdue.map(levelLine)),
    section('DOING', 'doing', list.doing.map(itemLine)),
    section('NEXT UP', 'next', list.next.map(itemLine)),
    empty && h('p', { class: 'pad-empty' }, 'Nothing on the go… pick a cartridge! ', h('span', { class: 'pad-arrow', 'aria-hidden': 'true' }, '↙')),
    !ws && h('p', { class: 'pad-empty' }, 'Loading…'),
  ];
}

/** The pad's own pages; stats is held up as a records screen instead. */
type Sheet = Exclude<PadPage, 'stats'>;
const PAGE_LABEL: Record<Sheet, string> = { today: 'TODAY', inbox: 'INBOX', review: 'REVIEW' };
const PAGE_ARIA: Record<Sheet, string> = { today: "Today's plan", inbox: 'Inbox', review: 'Weekly review' };
const SHEETS: Record<Sheet, (app: App) => (Node | null | false | undefined)[]> = { today: todaySheet, inbox: inboxSheet, review: reviewSheet };

/**
 * The legal pad: page tabs along the top (Today, Inbox), a cross to put it
 * away, the hero's thumbs holding it, and the sheet for the current page.
 */
function legalPad(app: App, page: Sheet, opts: { enter?: boolean; flip?: boolean; onClose?: () => void }): HTMLElement {
  const tilt = -1.2 - seeded(new Date().toDateString())() * 2.6;
  const counts: Record<Sheet, number | string> = { today: todayCount(app), inbox: inboxCount(app), review: app.reviewDue ? '!' : 0 };
  return h(
    'div',
    {
      class: `legal-pad page-${page}${opts.enter ? ' enter' : ''}`,
      style: `--tilt:${tilt.toFixed(2)}deg`,
      role: 'region',
      'aria-label': PAGE_ARIA[page],
    },
    h(
      'nav',
      { class: 'pad-tabs', 'aria-label': 'Pad pages' },
      (Object.keys(PAGE_LABEL) as Sheet[]).map((p) =>
        h(
          'a',
          { class: `pad-tab tab-${p}${p === page ? ' on' : ''}`, href: href(withPad(app.route, p)), 'aria-current': p === page ? 'page' : undefined },
          PAGE_LABEL[p],
          counts[p] ? h('b', null, counts[p]) : null,
        ),
      ),
    ),
    h('div', { class: 'pad-binding', 'aria-hidden': 'true' }),
    h(
      'a',
      {
        class: 'pad-close',
        href: href(withPad(app.route, undefined)),
        title: 'Put it away (Esc)',
        'aria-label': 'Put the pad away',
        onclick: (e: Event) => {
          if (!opts.onClose) return;
          e.preventDefault();
          opts.onClose();
        },
      },
      '✕',
    ),
    // Your hero's thumbs, holding the pad up.
    h('span', { class: 'pad-thumb left', 'aria-hidden': 'true' }),
    h('span', { class: 'pad-thumb right', 'aria-hidden': 'true' }),
    h('div', { class: `pad-sheet${opts.flip ? ' flip' : ''}` }, SHEETS[page](app)),
  );
}

/**
 * Holds today's plan up over whatever screen is showing, whenever the route
 * has the today flag. Clicking the backdrop or the cross puts it away.
 */
export function mountPadOverlay(app: App, host: HTMLElement) {
  let open: PadPage | undefined;
  let queued = false;
  host.classList.add('today-overlay');
  host.hidden = true;
  host.addEventListener('click', (e) => {
    if (e.target === host) close();
  });

  const close = () => {
    const pad = host.querySelector('.legal-pad');
    const done = () => (location.hash = href(withPad(app.route, undefined)));
    sfx('page');
    if (!pad || matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    pad.classList.add('leaving');
    host.classList.add('leaving');
    setTimeout(done, 220);
  };

  const render = () => {
    queued = false;
    const page = app.route.pad;
    host.hidden = !page;
    host.classList.remove('leaving');
    if (!page) {
      open = undefined;
      host.replaceChildren();
      return;
    }
    // Stats is a records screen held up over the game, not a page of the pad.
    const screen = page === 'stats';
    host.classList.toggle('as-screen', screen);
    if (screen) {
      const was = host.querySelector('.stats-screen');
      if (!was) sfx('page');
      const scrolled = was?.scrollTop ?? 0;
      host.replaceChildren(statsScreen(app, close));
      host.querySelector('.stats-screen')!.scrollTop = scrolled;
      open = undefined;
      return;
    }
    // Keep the reader's place, and whatever they're typing, across updates.
    const scroll = open === page ? (host.querySelector('.pad-sheet')?.scrollTop ?? 0) : 0;
    const kept = keepFields(host);
    const pad = legalPad(app, page, { enter: !open, flip: !!open && open !== page, onClose: close });
    if (open !== page) sfx('page');
    const skin = HEROES[app.heroId]?.colors?.['3'] ?? PALETTE.s;
    pad.style.setProperty('--skin', skin);
    const held = open ? host.querySelector<HTMLElement>('.legal-pad') : null;
    if (held) {
      // Already up: refill the pad it's holding rather than swapping in a new
      // one, which would restart its hold sway (and the entrance, if still
      // running) on every update. Keeping `enter` keeps the animation list as is.
      pad.classList.toggle('enter', held.classList.contains('enter'));
      held.className = pad.className;
      held.setAttribute('aria-label', pad.getAttribute('aria-label')!);
      held.style.cssText = pad.style.cssText;
      held.replaceChildren(...pad.childNodes);
    } else host.replaceChildren(pad);
    kept.restore();
    const sheet = host.querySelector('.pad-sheet');
    if (sheet) sheet.scrollTop = scroll;
    if (page === 'inbox' && app.focusCapture) {
      app.focusCapture = false;
      host.querySelector<HTMLInputElement>('.pad-scribble')?.focus();
    }
    open = page;
  };
  app.subscribe((change) => {
    // The pad shows no sync status, and stats doesn't use the background history.
    if (queued || change !== 'all') return;
    queued = true;
    setTimeout(render, 0);
  });
  render();
}

/** Overdue levels plus items in progress: the HUD badge count. */
export function todayCount(app: App): number {
  const ws = app.workspace;
  if (!ws) return 0;
  const t = todayList(ws);
  return t.overdue.length + t.doing.length;
}
