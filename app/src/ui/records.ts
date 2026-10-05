import { calibration, dayLog, DETAILED_WEEKS, formatMoney, HERO_IDS, type DetailedStats, type HeroId, type ItemType, type LogLine, type MoneyStats } from '@quest/shared';
import type { App } from '../app';
import { heroKey } from '../sprites/heroes';
import { href } from '../router';
import { h, icon } from './dom';
import { advice, date, days, heatGrid, plural, streakHint, svg, xpChart } from './stats';

const COLORS = ['#63c74d', '#feae34', '#0099db', '#b55088', '#e43b44', '#2ce8f5', '#f77622', '#c0cbdc'];
const TYPE: Record<ItemType, [sprite: string, label: string]> = {
  task: ['qblock', 'Tasks'],
  decision: ['sign-q', 'Decisions made'],
  risk: ['critter', 'Risks handled'],
  dependency: ['pipe-top', 'Dependencies'],
  stretch: ['coin', 'Stretch goals'],
  deliverable: ['flag', 'Milestones'],
  blocker: ['brick', 'Blockers smashed'],
};
const VERB: Record<LogLine['kind'], string> = { done: 'Done', ticked: 'Ticked', cleared: 'Cleared' };
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** The demo's pretend build on first open, so visitors see the heroes at work. */
const DEMO_BUILD_MS = 1200;

/**
 * Detailed stats (#/records): a full page over the game. It opens at once
 * with whatever history has been built so far (the builder works in the
 * background from the first visit); while older history is still filling
 * in, a strip at the top shows heroes at work and how far back it's got.
 */
export function mountRecords(app: App, host: HTMLElement, opts: { onShow?: (shown: boolean) => void } = {}) {
  host.classList.add('records-host');
  host.hidden = true;
  let queued = false;
  let day: string | undefined;
  let frames: ReturnType<typeof setInterval> | undefined;
  let shown: { stats?: DetailedStats; day?: string; ws?: unknown } = {};
  let pretend: number | undefined;
  let pretended = false;
  const strip = buildStrip(app);
  const body = h('div');

  const render = () => {
    queued = false;
    const show = app.route.view === 'records';
    if (host.hidden === show) opts.onShow?.(show);
    host.hidden = !show;
    if (!show) {
      day = undefined;
      shown = {};
      stopFrames();
      host.replaceChildren();
      return;
    }
    if (!host.contains(body)) host.replaceChildren(h('div', { class: 'records-page' }, strip, body));
    // The demo has its history ready-made; the first open pretends to build it for a moment.
    if (app.store.source.id === 'demo' && !pretended) {
      pretended = true;
      pretend = Date.now();
      const tick = () => {
        schedule();
        if (pretend && Date.now() - pretend < DEMO_BUILD_MS) setTimeout(tick, 60);
        else pretend = undefined;
      };
      tick();
    }
    const building = updateStrip(strip, app, pretend);
    if (building) startFrames();
    else stopFrames();

    const ws = app.workspace;
    const stats = ws && app.history.statsFor(ws, app.progress.events);
    // Only redraw the page itself when its numbers (or the picked day) change.
    if (shown.stats === stats && shown.day === day && shown.ws === ws && body.childElementCount) {
      const note = body.querySelector('.ds-scan-note');
      if (note) note.textContent = scanNote(app);
      return;
    }
    shown = { stats, day, ws };
    const scroll = host.scrollTop;
    const scrolled = body.querySelector('.ds-cal-scroll')?.scrollLeft;
    body.replaceChildren(
      page(app, stats, day, (d) => {
        day = day === d ? undefined : d;
        schedule();
      }),
    );
    host.scrollTop = scroll;
    const cal = body.querySelector('.ds-cal-scroll');
    if (cal) cal.scrollLeft = scrolled ?? cal.scrollWidth;
  };

  const startFrames = () => {
    if (frames || reduced()) return;
    let t = 0;
    frames = setInterval(() => {
      t++;
      for (const img of strip.querySelectorAll<HTMLImageElement>('.ds-hero')) {
        const bump = img.parentElement!.classList.contains('bump');
        const frame = bump ? (t % 4 < 2 ? 'jump' : 'stand') : t % 2 ? 'walk' : 'stand';
        img.src = icon(heroKey(img.dataset.hero as HeroId, frame)).src;
      }
    }, 220);
  };
  const stopFrames = () => {
    if (frames) clearInterval(frames);
    frames = undefined;
  };

  const schedule = () => {
    if (queued) return;
    queued = true;
    setTimeout(render, 0);
  };
  app.subscribe((change) => change !== 'sync' && schedule());
  render();
}

// ---------- Building: heroes at work ----------

/** Three heroes for the stage: yours, and two others picked by the day. */
function crew(app: App): HeroId[] {
  const all = HERO_IDS.filter((id) => id !== app.heroId);
  const seed = new Date().getDate();
  return [app.heroId, all[seed % all.length], all[(seed * 7 + 3) % all.length]];
}

/** The strip at the top of the page while history is being built. Made once, updated in place. */
function buildStrip(app: App): HTMLElement {
  const [a, b, c] = crew(app);
  const hero = (id: HeroId) => h('img', { class: 'ds-hero pixel', 'data-hero': id, src: icon(heroKey(id)).src, alt: '' });
  const prop = (name: string, cls: string) => h('img', { class: `${cls} pixel`, src: icon(name).src, alt: '' });
  return h(
    'section',
    { class: 'ds-build', role: 'status', 'aria-live': 'polite', hidden: true },
    h(
      'div',
      { class: 'ds-stage', 'aria-hidden': 'true' },
      h('div', { class: 'ds-worker bump' }, prop('qblock', 'ds-block'), prop('coin', 'ds-coin'), hero(a)),
      h('div', { class: 'ds-worker carry' }, prop('brick', 'ds-brick'), hero(b)),
      h('div', { class: 'ds-worker stack' }, h('div', { class: 'ds-pile' }, prop('brick', ''), prop('brick', ''), prop('brick', '')), hero(c)),
      h('div', { class: 'ds-ground' }),
    ),
    h(
      'div',
      { class: 'ds-build-text' },
      h('h3', null, 'BUILDING YOUR HISTORY'),
      h('div', { class: 'ds-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i')),
      h('p', { class: 'ds-bar-note' }),
      h('p', { class: 'ds-hint' }, 'It fills in a little at a time while you use Quest Log, and only when nothing else is happening. Everything it reads is kept in this browser.'),
    ),
  );
}

/** Shows or hides the strip and fills in its words. True while building. */
function updateStrip(strip: HTMLElement, app: App, pretend?: number): boolean {
  const b = app.history;
  const bar = strip.querySelector<HTMLElement>('.ds-bar')!;
  const fill = bar.firstChild as HTMLElement;
  const note = strip.querySelector('.ds-bar-note')!;
  if (pretend !== undefined) {
    const pct = Math.min(100, ((Date.now() - pretend) / DEMO_BUILD_MS) * 100);
    strip.hidden = false;
    bar.classList.remove('going');
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    fill.style.width = `${pct}%`;
    note.replaceChildren(h('b', null, `${Math.round(pct)}%`), ` · reading ${plural(Math.round((b.commits * pct) / 100), 'commit')}`);
    return true;
  }
  const building = b.available && !b.complete;
  strip.hidden = !building;
  if (!building) return false;
  // How much is left is unknown until it reaches the first commit: the bar just keeps moving.
  bar.classList.add('going');
  bar.removeAttribute('aria-valuenow');
  fill.style.width = '';
  const back = b.oldest ? ` · back to ${date(b.oldest, { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
  const state =
    b.status === 'offline'
      ? ' · paused: can’t reach the history right now'
      : b.status === 'waiting'
        ? ' · taking a breather (GitHub limits how fast it can read)'
        : '';
  note.replaceChildren(h('b', null, plural(b.commits, 'commit')), ` read${back}${state}`);
  return true;
}

// ---------- The page ----------

function page(app: App, s: DetailedStats | undefined, picked: string | undefined, onDay: (day: string) => void): HTMLElement {
  const ws = app.workspace;
  const head = h(
    'div',
    { class: 'ds-head' },
    h('h2', null, 'RECORDS · DETAILED'),
    h(
      'span',
      { class: 'ds-scan' },
      h('span', { class: 'ds-scan-note' }, scanNote(app)),
      app.history.available &&
        h('button', { class: 'btn sm', type: 'button', title: 'Throw away the history kept in this browser and build it again', onclick: () => void app.history.rebuild() }, '⟳ REBUILD'),
      h('a', { class: 'btn sm', href: href({ view: 'projects', pad: 'stats' }), title: 'Back to stats (Esc)' }, '✕ CLOSE'),
    ),
  );
  if (!ws || !s) return h('div', null, head, h('p', { class: 'ss-note' }, 'Adding it up…'));
  const order = s.projects.map((p) => p.id);
  const colour = (id: string) => COLORS[Math.max(0, order.indexOf(id)) % COLORS.length];
  const card = (title: string, cls: string, ...kids: (Node | Node[] | string | null | false | undefined)[]) =>
    h('section', { class: `ss-box ${cls}` }, h('h3', null, title), ...kids);
  const fromHistory = (on: boolean) => (on ? null : h('em', { class: 'ds-from' }, 'needs history'));
  const tile = (value: string, label: string, note?: string) => h('div', { class: 'ss-tile ds-tile' }, h('b', null, value), h('span', null, label), note && h('small', null, note));
  const dot = (id: string) => h('i', { class: 'ds-dot', style: `background:${colour(id)}`, 'aria-hidden': 'true' });

  // Calendar, with the picked day's log.
  const log = picked ? dayLog(ws, s, picked) : [];
  const calendar = card(
    'THE LAST YEAR',
    'ds-cal',
    (() => {
      // On narrow screens the year scrolls sideways (starting at the latest weeks); the key stays put.
      const [months, grid, legend] = heatGrid(s.heatmap, { label: `in the last ${DETAILED_WEEKS} weeks`, onDay, selected: picked });
      return [h('div', { class: 'ds-cal-scroll' }, months, grid), legend];
    })(),
    picked &&
      h(
        'div',
        { class: 'ds-day' },
        h('h4', null, date(picked, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
        log.length
          ? h('ul', { class: 'ds-list' }, log.map((l) => logLine(l, dot)))
          : h('p', { class: 'ss-note' }, 'Nothing that day. Rest days count too.'),
      ),
  );

  // Rhythm.
  const wmax = Math.max(1, ...s.weekday);
  const hmax = Math.max(1, ...s.hour);
  const busiest = s.weekday.indexOf(Math.max(...s.weekday));
  const peak = s.hour.indexOf(Math.max(...s.hour));
  const part = peak < 12 ? 'mornings' : peak < 17 ? 'afternoons' : 'evenings';
  const weekend = s.weekday[5] + s.weekday[6];
  const rhythm = card(
    'RHYTHM',
    'ds-rhythm',
    h(
      'div',
      { class: 'ds-week', role: 'img', 'aria-label': `Busiest on ${WEEKDAYS[busiest]}s` },
      WEEKDAYS.map((d, i) => h('div', { title: `${d}: ${s.weekday[i]}` }, h('i', { style: `height:${(s.weekday[i] / wmax) * 100}%` }), h('span', null, d[0]))),
    ),
    svg('svg', { viewBox: '0 0 240 40', class: 'ds-hours', role: 'img', 'aria-label': `Busiest in the ${part}` }, ...s.hour.map((n, i) => svg('rect', { x: i * 10 + 1, y: 40 - (n / hmax) * 36, width: 8, height: (n / hmax) * 36 }, svg('title', {}, document.createTextNode(`${String(i).padStart(2, '0')}:00: ${n}`))))),
    h('div', { class: 'ds-axis', 'aria-hidden': 'true' }, ['00', '06', '12', '18', '24'].map((t) => h('span', null, t))),
    s.total
      ? h('p', { class: 'ss-note' }, 'Busiest on ', h('b', null, `${WEEKDAYS[busiest]}s`), `, mostly ${part}. `, weekend < s.total * 0.15 ? 'Weekends stay quiet: good.' : 'Weekends get a look-in too.')
      : h('p', { class: 'ss-note' }, 'Finish a few things and your rhythm shows up here.'),
  );

  // Mix.
  const mixRows = (Object.entries(s.mix) as [ItemType, number][]).sort((a, b) => b[1] - a[1]);
  const mmax = Math.max(1, ...mixRows.map(([, n]) => n));
  const mix = card(
    'WHAT YOU FINISHED',
    'ds-mix',
    mixRows.length
      ? h('ul', null, mixRows.map(([t, n]) => h('li', null, icon(TYPE[t][0], 'grass', 'icon'), h('span', null, TYPE[t][1]), h('i', { style: `width:${(n / mmax) * 100}%` }), h('b', null, n))))
      : h('p', { class: 'ss-note' }, 'Nothing done yet.'),
  );

  // Scope.
  const smax = Math.max(1, ...s.scope.weeks.map((w) => Math.max(w.added, w.cut)));
  const sw = 300 / s.scope.weeks.length;
  const scope = card(
    'SCOPE',
    'ds-scope',
    h(
      'div',
      { class: 'ds-row3' },
      h('div', null, h('b', { class: 'up' }, s.scanned ? `+${s.scope.addedAfterStart}` : '–'), h('span', null, 'ADDED AFTER START')),
      h('div', null, h('b', { class: 'down' }, `−${s.scope.cut}`), h('span', null, 'CUT OR DROPPED')),
      h('div', null, h('b', null, s.scanned ? `+${s.scope.extendedDays}` : '–'), h('span', null, 'TIME-BOX DAYS ADDED')),
    ),
    s.scanned &&
      svg(
        'svg',
        { viewBox: '0 0 300 70', class: 'ds-scopes', role: 'img', 'aria-label': `${s.scope.addedAfterStart} items added after a level started, ${s.scope.cut} cut, over the year` },
        svg('line', { class: 'mid', x1: 0, y1: 35, x2: 300, y2: 35 }),
        ...s.scope.weeks.flatMap((w, i) => [
          svg('rect', { class: 'up', x: i * sw + 0.5, y: 35 - (w.added / smax) * 33, width: Math.max(1, sw - 1), height: (w.added / smax) * 33 }),
          svg('rect', { class: 'down', x: i * sw + 0.5, y: 35, width: Math.max(1, sw - 1), height: (w.cut / smax) * 33 }),
        ]),
      ),
    h(
      'p',
      { class: 'ss-note' },
      !s.scanned
        ? 'Cuts are counted from your data. What was added mid-level needs the commit history. '
        : s.scope.cut >= s.scope.addedAfterStart
          ? 'You cut at least as much as you add after starting. That’s the spirit.'
          : `You add more than you cut once a level is going (${s.scope.addedAfterStart} vs ${s.scope.cut}). Cut harder.`,
      fromHistory(s.scanned),
    ),
  );

  // Time-boxes, level by level.
  const maxD = Math.max(5, ...s.scatter.map((p) => Math.max(p.took, p.box))) * 1.05;
  const W = 300;
  const H = 180;
  const x = (v: number) => 24 + (Math.sqrt(v) / Math.sqrt(maxD)) * (W - 30);
  const y = (v: number) => H - 18 - (Math.sqrt(v) / Math.sqrt(maxD)) * (H - 26);
  const short = s.scatter.filter((p) => p.box <= 7);
  const shortLate = short.filter((p) => !p.inTime).length;
  const scatter = card(
    'TIME-BOXES, LEVEL BY LEVEL',
    'ds-scatter',
    s.scatter.length
      ? svg(
          'svg',
          { viewBox: `0 0 ${W} ${H}`, class: 'ds-plot', role: 'img', 'aria-label': `${s.scatter.length} cleared levels: ${s.timebox.inTime} in time` },
          svg('polygon', { class: 'late-zone', points: `${x(0)},${y(0)} ${x(maxD)},${y(maxD)} ${x(0)},${y(maxD)}` }),
          svg('line', { class: 'diag', x1: x(0), y1: y(0), x2: x(maxD), y2: y(maxD) }),
          svg('line', { class: 'axis', x1: x(0), y1: y(0), x2: x(maxD), y2: y(0) }),
          svg('line', { class: 'axis', x1: x(0), y1: y(0), x2: x(0), y2: y(maxD) }),
          ...s.scatter.map((p) =>
            svg('rect', { x: x(p.box) - 3, y: y(p.took) - 3, width: 6, height: 6, fill: colour(p.project) }, svg('title', {}, document.createTextNode(`${p.level}: ${days(p.took)} days, ${p.box}-day box`))),
          ),
          svg('text', { x: W - 4, y: H - 4, 'text-anchor': 'end' }, document.createTextNode('time-box (days) →')),
          svg('text', { x: 4, y: 10 }, document.createTextNode('↑ took')),
          svg('text', { x: x(maxD * 0.12), y: y(maxD * 0.7), class: 'zone' }, document.createTextNode('LATE')),
        )
      : null,
    h(
      'p',
      { class: `ss-note${calibration(s.timebox) === 'late' ? ' late' : ''}` },
      advice(s.timebox),
      short.length >= 3 && shortLate / short.length > 0.5 ? ` Short boxes (a week or less) run over most: ${shortLate} of ${short.length}.` : '',
    ),
  );

  // By project.
  const table = card(
    'BY PROJECT',
    'ds-table',
    h(
      'table',
      null,
      h('thead', null, h('tr', null, ['', 'DONE', 'CLEARED', 'IN TIME', '★ AVG', 'XP', 'CUT'].map((t) => h('th', { scope: 'col' }, t)))),
      h(
        'tbody',
        null,
        s.projects.map((p) =>
          h(
            'tr',
            null,
            h('th', { scope: 'row' }, dot(p.id), h('a', { href: href({ view: 'overworld', projectId: p.id }) }, p.title), p.finished ? h('span', { class: 'ds-won', title: 'Every level cleared' }, '★ FINISHED') : null),
            h('td', null, `${p.done}/${p.items}`),
            h('td', null, `${p.cleared}/${p.levels}`),
            h('td', null, p.timed ? `${Math.round((p.inTime / p.timed) * 100)}%` : '–'),
            h('td', null, p.cleared ? (p.stars / p.cleared).toFixed(1) : '–'),
            h('td', null, p.xp),
            h('td', null, p.cut),
          ),
        ),
      ),
    ),
  );

  // Perfectionism.
  const polish = card(
    'PERFECTIONISM WATCH 🐢',
    'ds-polish',
    h(
      'div',
      { class: 'ds-row3' },
      h('div', null, h('b', null, s.scanned ? s.polish.reopened : '–'), h('span', null, 'REOPENED')),
      h('div', null, h('b', null, s.scanned ? s.polish.editsAfterClear : '–'), h('span', null, 'EDITS AFTER CLEAR')),
      h('div', null, h('b', null, s.polish.xpLost ? `−${s.polish.xpLost}` : '0'), h('span', null, 'XP LOST TO POLISH')),
    ),
    s.polish.top.length
      ? h('ul', { class: 'ds-list' }, s.polish.top.map((f) => h('li', null, h('b', null, `${f.times}×`), ` ${f.title} `, h('em', null, f.levelName))))
      : null,
    h('p', { class: 'ss-note' }, s.polish.top.length ? 'Things you kept going back to. Good enough was good enough. ' : 'Nothing you kept fiddling with. Lovely. ', fromHistory(s.scanned)),
  );

  const lately = card('LATELY', 'ds-log', s.recent.length ? h('ul', { class: 'ds-list' }, s.recent.map((l) => logLine(l, dot))) : h('p', { class: 'ss-note' }, 'Nothing yet.'));

  const xp = card('XP OVER THE YEAR', 'ds-xp', xpChart(s.xp, `${DETAILED_WEEKS} weeks`), h('p', { class: 'ss-note' }, `${s.xp.total - s.xp.before} XP this year · ${s.xp.total} in all`));

  return h(
    'div',
    { role: 'region', 'aria-label': 'Detailed stats' },
    head,
    h(
      'div',
      { class: 'ds-tiles' },
      tile(String(s.streak.current), 'DAY STREAK', `best ${s.streak.longest}`),
      tile(String(s.bestDay?.total ?? 0), 'BEST DAY', s.bestDay ? date(s.bestDay.day, { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' }) : undefined),
      tile(String(s.bestWeek?.total ?? 0), 'BEST WEEK', s.bestWeek ? `w/c ${date(s.bestWeek.week, { day: 'numeric', month: 'short', year: '2-digit' })}` : undefined),
      tile(String(s.total), 'THINGS DONE', plural(s.timebox.cleared, 'level') + ' cleared'),
      tile(s.scanned ? String(s.undone) : '–', 'REOPENED', s.scanned ? 'still counted' : 'needs history'),
      tile(s.timebox.timed ? `${Math.round(s.timebox.inTimeRate! * 100)}%` : '–', 'IN TIME', s.timebox.cleared ? `★ ${s.timebox.avgStars!.toFixed(1)} avg` : undefined),
    ),
    h('p', { class: 'ss-note' }, streakHint(s.streak)),
    calendar,
    h('div', { class: 'ds-grid3' }, rhythm, mix, scope),
    s.money && moneyCard(s.money, colour, card),
    h('div', { class: 'ds-grid2' }, scatter, table),
    h('div', { class: 'ds-grid2' }, polish, h('div', null, xp, lately)),
  );
}

/**
 * Money over the year, for projects that track it: where it stands,
 * spending week by week against what the finished things were budgeted at,
 * and what ran over or came in under.
 */
function moneyCard(
  m: MoneyStats,
  colour: (project: string) => string,
  card: (title: string, cls: string, ...kids: (Node | Node[] | string | null | false | undefined)[]) => HTMLElement,
): HTMLElement {
  const money = (n: number) => formatMoney(n, m.currency);
  const W = 300;
  const H = 90;
  const step = W / m.months.length;
  const top = Math.max(1, ...m.months.map((w) => Math.max(w.total, w.planned)));
  const bar = Math.max(1, ...m.months.map((w) => w.spent));
  const y = (v: number) => H - 4 - (v / top) * (H - 10);
  const label = (month: string, opts: Intl.DateTimeFormatOptions) => date(`${month}-15`, opts);
  const tip = (w: MoneyStats['months'][number]) => `${label(w.month, { month: 'long', year: 'numeric' })}: ${money(w.spent)} spent (${money(w.total)} in all)`;
  const chart = svg(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'ds-money-chart', role: 'img', 'aria-label': `${money(m.spent)} spent of ${money(m.budget)} budgeted` },
    ...m.months.map((w, i) => {
      const bh = (w.spent / bar) * (H * 0.45);
      return svg('rect', { class: 'spend', x: i * step + step * 0.12, y: H - bh, width: step * 0.76, height: bh }, svg('title', {}, document.createTextNode(tip(w))));
    }),
    svg('line', { class: 'base', x1: 0, y1: H - 0.5, x2: W, y2: H - 0.5 }),
    svg('polyline', { class: 'planned', points: m.months.map((w, i) => `${(i + 0.5) * step},${y(w.planned)}`).join(' ') }),
    svg('polyline', { class: 'total', points: m.months.map((w, i) => `${(i + 0.5) * step},${y(w.total)}`).join(' ') }),
  );
  // Label the first month, each January, and this month.
  const ticks = h(
    'div',
    { class: 'ds-money-ticks', 'aria-hidden': 'true', style: `--months:${m.months.length}` },
    m.months.map((w, i) => h('span', null, i === 0 || i === m.months.length - 1 || w.month.endsWith('-01') ? label(w.month, { month: 'short', year: '2-digit' }) : '')),
  );
  const over = m.spent > m.budget;
  const row = (label: string, value: string, cls = '') => h('div', null, h('b', { class: cls }, value), h('span', null, label));
  const lineItem = (l: MoneyStats['overruns'][number] | MoneyStats['savings'][number], amount: string) =>
    h('li', null, h('b', null, amount), ` ${l.title} `, l.title !== l.levelName ? h('em', null, l.levelName) : null, ' ', h('i', { class: 'ds-dot', style: `background:${colour(l.project)}`, 'aria-hidden': 'true' }));
  const rate = m.settled ? Math.round((m.onBudget / m.settled) * 100) : undefined;
  return card(
    'MONEY',
    'ds-money',
    h(
      'div',
      { class: 'ds-row4' },
      row('BUDGETED', money(m.budget)),
      row('SPENT', money(m.spent), over ? 'down-bad' : ''),
      row(m.left < 0 ? 'OVER' : 'LEFT', money(Math.abs(m.left)), m.left < 0 ? 'down-bad' : ''),
      row(m.saved < 0 ? 'OVERSPENT SO FAR' : 'SAVED SO FAR', money(Math.abs(m.saved)), m.saved < 0 ? 'down-bad' : 'up-good'),
    ),
    h(
      'div',
      { class: 'ds-money-grid' },
      h(
        'div',
        null,
        chart,
        ticks,
        h(
          'ul',
          { class: 'ds-money-key' },
          h('li', null, h('span', { class: 'ds-key total' }), 'spent in all'),
          h('li', null, h('span', { class: 'ds-key planned' }), 'what the finished things were budgeted at'),
          h('li', null, h('span', { class: 'ds-key spend' }), 'spent each month'),
          m.fromHistory ? null : h('li', null, h('em', { class: 'ds-from' }, 'dated by when things were done')),
        ),
        rate !== undefined &&
          h(
            'p',
            { class: `ss-note${rate < 50 ? ' late' : ''}` },
            `${m.onBudget} of ${m.settled} finished things with a budget came in on or under it (${rate}%)`,
            m.medianRatio === undefined
              ? '.'
              : Math.abs(m.medianRatio - 1) < 0.005
                ? '; typically right on budget.'
                : `; typically ${m.medianRatio < 1 ? `${Math.round((1 - m.medianRatio) * 100)}% under` : `${Math.round((m.medianRatio - 1) * 100)}% over`}.`,
          ),
        m.otherCurrencies.length > 0 && h('p', { class: 'ss-note' }, `Projects in ${m.otherCurrencies.join(', ')} aren't counted here.`),
      ),
      h(
        'div',
        null,
        h('h4', null, 'RAN OVER'),
        m.overruns.length ? h('ul', { class: 'ds-list' }, m.overruns.map((l) => lineItem(l, `+${money(l.over)}`))) : h('p', { class: 'ss-note' }, 'Nothing ran over. Lovely.'),
        h('h4', null, 'CAME IN UNDER'),
        m.savings.length ? h('ul', { class: 'ds-list' }, m.savings.map((l) => lineItem(l, `−${money(l.saved)}${l.dropped ? ' (cut)' : ''}`))) : h('p', { class: 'ss-note' }, 'Nothing settled under budget yet.'),
      ),
    ),
    h(
      'table',
      { class: 'ds-money-table' },
      h('thead', null, h('tr', null, ['', 'BUDGET', 'SPENT', 'LEFT', 'SAVED'].map((t) => h('th', { scope: 'col' }, t)))),
      h(
        'tbody',
        null,
        m.projects.map((p) =>
          h(
            'tr',
            null,
            h('th', { scope: 'row' }, h('i', { class: 'ds-dot', style: `background:${colour(p.id)}`, 'aria-hidden': 'true' }), p.title, p.finished ? h('span', { class: 'ds-won' }, '★ FINISHED') : null),
            h('td', null, money(p.budget)),
            h('td', { class: p.spent > p.budget ? 'down-bad' : '' }, money(p.spent)),
            h('td', { class: p.left < 0 ? 'down-bad' : '' }, money(p.left)),
            h('td', { class: p.saved < 0 ? 'down-bad' : p.saved > 0 ? 'up-good' : '' }, money(p.saved)),
          ),
        ),
      ),
    ),
  );
}

function logLine(l: LogLine, dot: (project: string) => Node) {
  return h(
    'li',
    null,
    h('em', null, new Date(l.at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })),
    ' ',
    h('b', null, VERB[l.kind]),
    ` ${l.title} `,
    l.kind !== 'cleared' && h('em', null, l.levelName),
    ' ',
    dot(l.project),
    l.undone ? h('span', { class: 'ds-undone', title: 'Reopened later: still counted' }, '↺') : null,
  );
}

function scanNote(app: App): string {
  const b = app.history;
  if (!b.available) return 'From the done dates in your data · this repo’s history can’t be read here · ';
  const ago = b.builtAt ? Math.round((Date.now() - Date.parse(b.builtAt)) / 60_000) : undefined;
  const when = ago === undefined ? '' : ago < 1 ? ' · updated just now' : ago < 120 ? ` · updated ${ago} min ago` : ` · updated ${Math.round(ago / 60)} h ago`;
  return `${plural(b.commits, 'commit')} read${b.complete ? ', all of it' : ' so far'}${when} · `;
}
