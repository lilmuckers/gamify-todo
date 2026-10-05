import { calibration, HISTORY_WEEKS, progressStats, type HeatCell, type ProgressStats, type TimeboxStats } from '@quest/shared';
import type { App } from '../app';
import { h, icon } from './dom';

const SVG = 'http://www.w3.org/2000/svg';
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const date = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', opts);
/** "12", "2.5": days without a long tail of decimals. */
const days = (n: number) => String(Math.round(n * 10) / 10);

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...children: Node[]) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

function streakBlock(s: ProgressStats) {
  const { current, longest, today } = s.streak;
  const hint =
    !longest
      ? 'Finish anything today to start a streak.'
      : !current
        ? 'The flame’s out. One small tick today lights it again.'
        : today
          ? 'Safe for today. Nice.'
          : 'Tick one thing today to keep it going.';
  return h(
    'section',
    { class: 'pad-section stats-streak' },
    icon(current ? 'flame' : 'flame-out', 'grass', 'stats-flame'),
    h('div', { class: 'stats-big' }, h('b', null, current), current === 1 ? ' day in a row' : ' days in a row'),
    h('div', { class: 'pad-where' }, `best: ${plural(longest, 'day')} · ${plural(s.total, 'thing')} done in all`),
    h('p', { class: 'pad-where stats-hint' }, hint),
  );
}

function cellTitle(c: HeatCell) {
  const when = date(c.day, { weekday: 'short', day: 'numeric', month: 'short' });
  if (c.future) return when;
  const parts = [c.count ? plural(c.count, 'thing') : 'nothing'];
  if (c.cleared) parts.push(`${plural(c.cleared, 'level')} cleared`);
  return `${when}: ${parts.join(', ')}`;
}

/** The progress calendar: one column per week, Monday at the top, darker for busier days. */
function heatBlock(s: ProgressStats) {
  const cols = s.heatmap;
  const active = cols.flat().filter((c) => c.count > 0).length;
  const starts = cols.map((col) => col.find((c) => c.day.endsWith('-01')));
  const months = cols.map((col, i) => {
    // Label the week a month starts in, and the first week when no label is close by.
    const first = starts[i] ?? (i === 0 && !starts[1] && !starts[2] ? col[0] : undefined);
    return h('span', null, first ? date(first.day, { month: 'short' }) : '');
  });
  const rows = ['M', '', 'W', '', 'F', '', ''].map((l) => h('span', { class: 'stats-day' }, l));
  return h(
    'section',
    { class: 'pad-section stats-cal' },
    h('h3', null, `LAST ${HISTORY_WEEKS} WEEKS`),
    h('div', { class: 'stats-months', 'aria-hidden': 'true', style: `--weeks:${cols.length}` }, h('span'), months),
    h(
      'div',
      {
        class: 'stats-heat',
        role: 'img',
        'aria-label': `${plural(active, 'day')} with progress in the last ${HISTORY_WEEKS} weeks`,
        style: `--weeks:${cols.length}`,
      },
      rows,
      cols.flat().map((c) =>
        h('span', { class: `heat h${c.heat}${c.future ? ' future' : ''}${c.cleared ? ' clear' : ''}`, title: cellTitle(c) }),
      ),
    ),
    h(
      'div',
      { class: 'pad-where stats-legend', 'aria-hidden': 'true' },
      'less ',
      [0, 1, 2, 3, 4].map((n) => h('span', { class: `heat h${n}` })),
      ' more · ',
      h('span', { class: 'heat h2 clear' }),
      ' level cleared',
    ),
  );
}

const ADVICE: Record<NonNullable<ReturnType<typeof calibration>>, string> = {
  early: 'You usually finish well inside the box. Try tighter time-boxes: a little pressure helps.',
  'about-right': 'Your time-boxes are about right. Keep them tight.',
  late: 'Levels usually take longer than planned. Pick smaller deliverables, or give them bigger boxes.',
};

/** Stars and time-box accuracy over every cleared level, to calibrate the next estimate. */
function timeboxBlock(t: TimeboxStats) {
  const lines: (HTMLElement | false)[] = [];
  const line = (...children: (Node | string)[]) => h('li', { class: 'pad-line' }, ...children);
  if (t.cleared)
    lines.push(
      line(
        h('b', null, plural(t.cleared, 'level')),
        ' cleared',
        h('span', { class: 'pad-where' }, `★ ${t.avgStars!.toFixed(1)} on average`),
      ),
    );
  if (t.timed) {
    lines.push(
      line(h('b', null, `${Math.round(t.inTimeRate! * 100)}%`), ' cleared in time', h('span', { class: 'pad-where' }, `${t.inTime} of ${t.timed}`)),
      line(
        'typically ',
        h('b', null, `${days(t.medianDays!)} days`),
        ` against a ${days(t.medianTimebox!)}-day box`,
        h('span', { class: 'pad-where' }, `×${t.medianRatio!.toFixed(2)}`),
      ),
    );
  }
  const verdict = calibration(t);
  return h(
    'section',
    { class: 'pad-section stats-timebox' },
    h('h3', null, 'TIME-BOXES'),
    lines.length ? h('ul', null, lines) : null,
    h(
      'p',
      { class: `pad-where stats-hint${verdict === 'late' ? ' late' : ''}` },
      verdict ? ADVICE[verdict] : t.cleared ? 'Start and clear a level to see how your time-boxes hold up.' : 'Clear a level to see how your time-boxes hold up.',
    ),
  );
}

/** Weekly XP as pencil bars, with the running total inked over them. */
function xpBlock(s: ProgressStats) {
  const { weeks, total } = s.xp;
  const gained = total - s.xp.before;
  const W = 200;
  const H = 64;
  const step = W / weeks.length;
  const maxBar = Math.max(1, ...weeks.map((w) => w.gained));
  const lo = weeks[0]?.total ?? 0;
  const span = Math.max(1, total - lo);
  const y = (v: number) => H - 4 - ((v - lo) / span) * (H - 10);
  const label = (w: (typeof weeks)[number]) =>
    `Week of ${date(w.week, { day: 'numeric', month: 'short' })}: +${w.gained} XP (${w.total} total)`;
  const chart = svg(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'stats-xp', role: 'img', 'aria-label': `${gained} XP earned in the last ${HISTORY_WEEKS} weeks, ${total} in all` },
    ...weeks.map((w, i) => {
      const bh = (w.gained / maxBar) * (H * 0.6);
      return svg('rect', { class: 'xp-bar', x: i * step + 1.5, y: H - bh, width: step - 3, height: bh }, svg('title', {}, document.createTextNode(label(w))));
    }),
    svg('line', { class: 'xp-base', x1: 0, y1: H - 0.5, x2: W, y2: H - 0.5 }),
    svg('polyline', { class: 'xp-line', points: weeks.map((w, i) => `${(i + 0.5) * step},${y(w.total)}`).join(' ') }),
  );
  return h(
    'section',
    { class: 'pad-section stats-xp-block' },
    h('h3', null, 'XP OVER TIME'),
    total ? chart : null,
    h('div', { class: 'pad-where' }, total ? `+${gained} XP in ${HISTORY_WEEKS} weeks · ${total} XP in all` : 'XP comes from clearing levels. Your first one will show up here.'),
  );
}

/**
 * The long view, on blue graph paper: the current streak, a calendar of
 * days with progress, how time-boxes have held up, and XP over time. All of
 * it comes from the done stamps in the data, so it works offline.
 */
export function statsSheet(app: App): (Node | null | false | undefined)[] {
  const ws = app.workspace;
  if (!ws) return [h('h2', { class: 'pad-title' }, 'STATS'), h('p', { class: 'pad-empty' }, 'Loading…')];
  const now = Date.now();
  const s = progressStats(ws, now);
  return [
    h('div', { class: 'pad-date' }, new Date(now).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })),
    h('h2', { class: 'pad-title' }, 'STATS'),
    h('div', { class: 'pad-sub' }, 'small steps add up'),
    streakBlock(s),
    heatBlock(s),
    timeboxBlock(s.timebox),
    xpBlock(s),
  ];
}
