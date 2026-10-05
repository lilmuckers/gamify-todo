import { calibration, formatMoney, HISTORY_WEEKS, moneyStats, progressStats, type HeatCell, type ProgressStats, type TimeboxStats } from '@quest/shared';
import type { App } from '../app';
import { href } from '../router';
import { h, icon } from './dom';

const SVG = 'http://www.w3.org/2000/svg';
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const date = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(day.length === 10 ? `${day}T12:00:00` : day).toLocaleDateString('en-GB', opts);
/** "12", "2.5": days without a long tail of decimals. */
export const days = (n: number) => String(Math.round(n * 10) / 10);

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...children: Node[]) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

function cellTitle(c: HeatCell) {
  const when = date(c.day, { weekday: 'short', day: 'numeric', month: 'short' });
  if (c.future) return when;
  const parts = [c.count ? plural(c.count, 'thing') : 'nothing'];
  if (c.cleared) parts.push(`${plural(c.cleared, 'level')} cleared`);
  if (c.undone) parts.push(`${c.undone} reopened later`);
  return `${when}: ${parts.join(', ')}`;
}

/**
 * The progress calendar: one column per week, Monday at the top, brighter
 * for busier days. With `onDay`, each day is a button that shows what
 * happened on it.
 */
export function heatGrid(cols: HeatCell[][], opts: { label: string; onDay?: (day: string) => void; selected?: string }): HTMLElement[] {
  const active = cols.flat().filter((c) => c.count > 0).length;
  const starts = cols.map((col) => col.find((c) => c.day.endsWith('-01')));
  const months = cols.map((col, i) => {
    // Label the week a month starts in, and the first week when no label is close by.
    const first = starts[i] ?? (i === 0 && !starts[1] && !starts[2] ? col[0] : undefined);
    return h('span', null, first ? date(first.day, { month: 'short' }) : '');
  });
  const rows = ['M', '', 'W', '', 'F', '', ''].map((l) => h('span', { class: 'stats-day' }, l));
  const cell = (c: HeatCell) => {
    const cls = `heat h${c.heat}${c.future ? ' future' : ''}${c.cleared ? ' clear' : ''}${opts.selected === c.day ? ' picked' : ''}`;
    if (!opts.onDay || c.future) return h('span', { class: cls, title: cellTitle(c) });
    return h('button', { class: cls, type: 'button', title: cellTitle(c), 'aria-label': cellTitle(c), onclick: () => opts.onDay!(c.day) });
  };
  return [
    h('div', { class: 'stats-months', 'aria-hidden': 'true', style: `--weeks:${cols.length}` }, h('span'), months),
    h(
      'div',
      {
        class: 'stats-heat',
        role: opts.onDay ? 'group' : 'img',
        'aria-label': `${plural(active, 'day')} with progress ${opts.label}`,
        style: `--weeks:${cols.length}`,
      },
      rows,
      cols.flat().map(cell),
    ),
    h(
      'div',
      { class: 'stats-legend', 'aria-hidden': 'true' },
      'less ',
      [0, 1, 2, 3, 4].map((n) => h('span', { class: `heat h${n}` })),
      ' more · ',
      h('span', { class: 'heat h2 clear' }),
      ' level cleared',
      opts.onDay ? ' · pick a day to see what happened' : '',
    ),
  ];
}

const ADVICE: Record<NonNullable<ReturnType<typeof calibration>>, string> = {
  early: 'You usually finish well inside the box. Try tighter time-boxes: a little pressure helps.',
  'about-right': 'Your time-boxes are about right. Keep them tight.',
  late: 'Levels usually take longer than planned. Pick smaller deliverables, or give them bigger boxes.',
};

export const advice = (t: TimeboxStats) => {
  const verdict = calibration(t);
  return verdict ? ADVICE[verdict] : t.cleared ? 'Start and clear a level to see how your time-boxes hold up.' : 'Clear a level to see how your time-boxes hold up.';
};

export const streakHint = ({ current, longest, today }: ProgressStats['streak']) =>
  !longest
    ? 'Finish anything today to start a streak.'
    : !current
      ? 'The flame’s out. One small tick today lights it again.'
      : today
        ? 'Safe for today. Nice.'
        : 'Tick one thing today to keep it going.';

/** Weekly XP as bars, with the running total drawn over them. */
export function xpChart(xp: ProgressStats['xp'], label = `${HISTORY_WEEKS} weeks`): SVGSVGElement | null {
  const { weeks, total } = xp;
  if (!total) return null;
  const gained = total - xp.before;
  const W = 200;
  const H = 64;
  const step = W / weeks.length;
  const maxBar = Math.max(1, ...weeks.map((w) => w.gained));
  const lo = weeks[0]?.total ?? 0;
  const span = Math.max(1, total - lo);
  const y = (v: number) => H - 4 - ((v - lo) / span) * (H - 10);
  const tip = (w: (typeof weeks)[number]) => `Week of ${date(w.week, { day: 'numeric', month: 'short' })}: +${w.gained} XP (${w.total} total)`;
  return svg(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'stats-xp', role: 'img', 'aria-label': `${gained} XP earned in the last ${label}, ${total} in all` },
    ...weeks.map((w, i) => {
      const bh = (w.gained / maxBar) * (H * 0.6);
      return svg('rect', { class: 'xp-bar', x: i * step + step * 0.08, y: H - bh, width: step * 0.84, height: bh }, svg('title', {}, document.createTextNode(tip(w))));
    }),
    svg('line', { class: 'xp-base', x1: 0, y1: H - 0.5, x2: W, y2: H - 0.5 }),
    svg('polyline', { class: 'xp-line', points: weeks.map((w, i) => `${(i + 0.5) * step},${y(w.total)}`).join(' ') }),
  );
}

const xpNote = (s: ProgressStats) =>
  s.xp.total ? `+${s.xp.total - s.xp.before} XP in ${HISTORY_WEEKS} weeks · ${s.xp.total} XP in all` : 'XP comes from clearing levels. Your first one will show up here.';

/** One line on money, for projects that track it: what's gone out against the budgets, and what's been saved. */
function moneyLine(ws: Parameters<typeof moneyStats>[0]): HTMLElement | null {
  const m = moneyStats(ws, { months: 1 });
  if (!m) return null;
  const money = (n: number) => formatMoney(n, m.currency);
  return h(
    'p',
    { class: 'ss-note ss-money' },
    icon('coin', 'grass', 'icon sm'),
    ` ${money(m.spent)} spent of ${money(m.budget)} budgeted`,
    m.saved ? ` · ${m.saved > 0 ? `${money(m.saved)} saved` : `${money(-m.saved)} over`} on finished things` : '',
    m.settled ? ` · ${m.onBudget} of ${m.settled} on budget` : '',
  );
}

/** Where the numbers come from: stamps alone, or with the commit history (and how fresh it is). */
export function sourceNote(app: App): string {
  const p = app.progress;
  if (!p.available) return 'From the done dates in your data.';
  if (p.status === 'loading') return 'From the done dates in your data. Reading the commit history…';
  if (p.status === 'offline') return 'From the done dates in your data. The commit history can’t be read right now.';
  const ago = p.readAt ? Math.round((Date.now() - Date.parse(p.readAt)) / 60_000) : 0;
  return `From the done dates in your data and the commit history (checked ${ago < 1 ? 'just now' : `${ago} min ago`}).`;
}

/**
 * Stats as an arcade records screen held over whatever is showing: the
 * streak and totals, the last 20 weeks, time-boxes beside XP, and the way
 * into the detailed page. It comes from the done stamps in the data plus
 * the cached commit history, so it works offline.
 */
export function statsScreen(app: App, onClose: () => void): HTMLElement {
  const ws = app.workspace;
  const head = h(
    'header',
    { class: 'ss-head' },
    h('h2', null, 'RECORDS'),
    h(
      'div',
      { class: 'ss-head-acts' },
      h('a', { class: 'btn sm ss-detailed', href: href({ view: 'records' }), title: 'Everything: the last year, rhythm, scope, every time-box' }, 'DETAILED STATS ▶'),
      h('button', { class: 'btn sm', type: 'button', title: 'Close (Esc)', onclick: onClose }, '✕ CLOSE'),
    ),
  );
  const region = { class: 'stats-screen', role: 'region', 'aria-label': 'Stats: streaks and history' };
  if (!ws) return h('div', region, head, h('p', null, 'Loading…'));
  const s = progressStats(ws, Date.now(), HISTORY_WEEKS, app.progress.events);
  const t = s.timebox;
  const tile = (value: string, label: string, extra?: Node | null) => h('div', { class: 'ss-tile' }, extra, h('b', null, value), h('span', null, label));
  const row = (value: string, label: string, note?: string) => h('li', null, h('b', null, value), ` ${label}`, note ? h('em', null, ` ${note}`) : null);
  return h(
    'div',
    region,
    head,
    h(
      'div',
      { class: 'ss-tiles' },
      tile(String(s.streak.current), 'DAY STREAK', icon(s.streak.current ? 'flame' : 'flame-out', 'grass', 'ss-flame')),
      tile(String(s.streak.longest), 'BEST STREAK'),
      tile(String(s.total), 'THINGS DONE'),
      tile(String(s.xp.total), 'XP'),
    ),
    h('p', { class: 'ss-note' }, streakHint(s.streak), s.undone ? ` ${s.undone} reopened later, still counted.` : ''),
    moneyLine(ws),
    h('section', { class: 'ss-box ss-cal' }, h('h3', null, `LAST ${HISTORY_WEEKS} WEEKS`), heatGrid(s.heatmap, { label: `in the last ${HISTORY_WEEKS} weeks` })),
    h(
      'div',
      { class: 'ss-cols' },
      h(
        'section',
        { class: 'ss-box' },
        h('h3', null, 'TIME-BOXES'),
        h(
          'ul',
          { class: 'ss-list' },
          t.cleared ? row(String(t.cleared), 'levels cleared', `★ ${t.avgStars!.toFixed(1)} avg`) : null,
          t.timed ? row(`${Math.round(t.inTimeRate! * 100)}%`, 'cleared in time', `${t.inTime} of ${t.timed}`) : null,
          t.timed ? row(`${days(t.medianDays!)}d`, `vs a ${days(t.medianTimebox!)}-day box`, `×${t.medianRatio!.toFixed(2)}`) : null,
        ),
        h('p', { class: `ss-note${calibration(t) === 'late' ? ' late' : ''}` }, advice(t)),
      ),
      h('section', { class: 'ss-box' }, h('h3', null, 'XP OVER TIME'), xpChart(s.xp), h('p', { class: 'ss-note' }, xpNote(s))),
    ),
    h('p', { class: 'ss-note ss-source' }, sourceNote(app)),
  );
}
