import type { GameState, Item, ItemStatus, Level, Workspace, World } from './model';
import type { Completion, Repeat } from './types.gen';

export type { Completion, Repeat };
export type RepeatUnit = Repeat['unit'];

const DAY_MS = 86_400_000;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** The local calendar day of a moment, YYYY-MM-DD. Repeats follow the user's calendar, not UTC. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local midnight at the start of `day` (ms). */
export function dayStart(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * `day` plus `n` units. Months and years that land past the end of a shorter
 * month clamp to its last day (31 Jan + 1 month = 28/29 Feb). Pure date maths
 * in UTC, so clock changes can't shift it.
 */
export function addUnits(day: string, n: number, unit: RepeatUnit): string {
  const [y, m, d] = day.split('-').map(Number);
  if (unit === 'days' || unit === 'weeks') {
    const t = new Date(Date.UTC(y, m - 1, d + n * (unit === 'weeks' ? 7 : 1)));
    return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
  }
  const months = m - 1 + n * (unit === 'years' ? 12 : 1);
  const y2 = y + Math.floor(months / 12);
  const m2 = (((months % 12) + 12) % 12) + 1;
  return `${y2}-${pad2(m2)}-${pad2(Math.min(d, daysInMonth(y2, m2)))}`;
}

/** Days it was done, oldest first; older hand-written data may only have a doneAt. */
function doneDays(item: Item): string[] {
  if (item.completions?.length) return item.completions.map((c) => c.on);
  const t = item.doneAt ? Date.parse(item.doneAt) : NaN;
  return item.status === 'done' && !Number.isNaN(t) ? [dayKey(t)] : [];
}

/** The last day a repeating item was done, if ever. */
export function lastDone(item: Item): string | undefined {
  return doneDays(item).at(-1);
}

/**
 * When a repeating item is next due, as a local day. `from: done` counts from
 * the last time it was done; `fixed` keeps to the schedule anchored on `start`
 * (or the first completion), and a completion covers the period it falls in.
 * Undefined when it doesn't repeat, or has nothing to count from yet.
 */
export function nextDue(item: Item): string | undefined {
  const r = item.repeat;
  if (!r) return undefined;
  const days = doneDays(item);
  const last = days.at(-1);
  if (r.from !== 'fixed') return last ? addUnits(last, r.every, r.unit) : r.start;
  const anchor = r.start ?? days[0];
  if (!anchor || !last) return anchor;
  // Counted from the anchor each time, so month-end clamping doesn't drift.
  let k = 0;
  let due = anchor;
  while (due <= last) due = addUnits(anchor, ++k * r.every, r.unit);
  return due;
}

/** A done repeating item whose next one has come round. */
export function isDueAgain(item: Item, today: string): boolean {
  if (!item.repeat || item.status !== 'done') return false;
  const due = nextDue(item);
  return !!due && due <= today;
}

/** The status to show: `todo` once a done repeating item is due again, else the stored one. */
export function effectiveStatus(item: Item, today: string): ItemStatus {
  return isDueAgain(item, today) ? 'todo' : item.status;
}

/** "↻ 6 mo": the cadence on a badge. */
export function cadenceLabel(r: Repeat): string {
  const short = { days: 'd', weeks: 'wk', months: 'mo', years: 'yr' }[r.unit];
  return `↻ ${r.every} ${short}`;
}

/** "every 6 months" / "every week". */
export function cadenceText(r: Repeat): string {
  const one = r.unit.slice(0, -1);
  return r.every === 1 ? `every ${one}` : `every ${r.every} ${r.unit}`;
}

/** "3 Apr", or "3 Apr 2027" outside `today`'s year. */
export function fmtDay(day: string, today = dayKey(Date.now())): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) };
  return new Date(dayStart(day)).toLocaleDateString('en-GB', opts);
}

/** "↻ every 6 months · next due 3 Apr" (or "due since…", "due today", "not done yet"). Undefined when it doesn't repeat. */
export function repeatSummary(item: Item, today = dayKey(Date.now())): string | undefined {
  if (!item.repeat) return undefined;
  const due = nextDue(item);
  const when = !due
    ? 'not done yet'
    : due === today
      ? 'due today'
      : due < today
        ? `due since ${fmtDay(due, today)}`
        : `next due ${fmtDay(due, today)}`;
  return `↻ ${cadenceText(item.repeat)} · ${when}`;
}

/**
 * Every time a repeating item was done, as moments for stats and the review.
 * The latest one is stamped with the exact `doneAt` (logged together, though
 * another time zone can see it on a neighbouring day); older days count from
 * local midnight.
 */
export function completionTimes(item: Item): number[] {
  const list = item.completions ?? [];
  const done = item.doneAt ? Date.parse(item.doneAt) : NaN;
  const paired = !Number.isNaN(done) && list.length > 0 && Math.abs(done - (dayStart(list.at(-1)!.on) + DAY_MS / 2)) <= 1.5 * DAY_MS;
  return list.map((c, i) => (paired && i === list.length - 1 ? done : dayStart(c.on)));
}

/**
 * Logs one completion of a repeating item (in place, on an op's copy): today
 * is appended once (a second tick the same day merges), the item's `spent`
 * moves into that entry so each occurrence has its own budget, and doneAt is
 * stamped afresh even if it already said done.
 */
export function logCompletion(item: Item, on: string, at: string) {
  if (!item.repeat) return;
  const list = [...(item.completions ?? [])];
  const last = list.at(-1);
  // A clock that went backwards mustn't break the date order.
  if (last && last.on >= on) {
    if (item.spent !== undefined) list[list.length - 1] = { ...last, spent: Math.round(((last.spent ?? 0) + item.spent) * 100) / 100 };
  } else list.push({ on, ...(item.spent !== undefined ? { spent: item.spent } : {}) });
  item.completions = list;
  delete item.spent;
  item.doneAt = at;
}

/** Views memoised per raw object and day, so an unchanged level, world or project keeps its identity across edits. */
function memo<T extends object>(fn: (raw: T, today: string) => T) {
  const cache = new WeakMap<T, { day: string; view: T }>();
  return (raw: T, today: string): T => {
    const hit = cache.get(raw);
    if (hit?.day === today) return hit.view;
    const view = fn(raw, today);
    cache.set(raw, { day: today, view });
    return view;
  };
}

const dueLevel = memo((level: Level, today: string): Level => {
  if (!level.items.some((i) => isDueAgain(i, today))) return level;
  return { ...level, items: level.items.map((i) => (isDueAgain(i, today) ? { ...i, status: 'todo' as const } : i)) };
});

const dueWorld = memo((w: World, today: string): World => {
  const levels = w.levels.map((l) => dueLevel(l, today));
  return levels.some((l, i) => l !== w.levels[i]) ? { ...w, levels } : w;
});

const dueProject = memo((state: GameState, today: string): GameState => {
  let worlds: Record<string, World> | undefined;
  for (const [id, w] of Object.entries(state.worlds)) {
    const next = dueWorld(w, today);
    if (next !== w) (worlds ??= { ...state.worlds })[id] = next;
  }
  return worlds ? { ...state, worlds } : state;
});

const dueWorkspace = memo((ws: Workspace, today: string): Workspace => {
  let projects: Workspace['projects'] | undefined;
  for (const [id, p] of Object.entries(ws.projects)) {
    const next = dueProject(p, today);
    if (next !== p) (projects ??= { ...ws.projects })[id] = next;
  }
  return projects ? { ...ws, projects } : ws;
});

/**
 * The workspace as the app shows it on `today`: repeating items that are due
 * again read as `todo`. Nothing is written; the stored files keep `done`
 * until the chore is done again. Copy-on-write, so unchanged projects, worlds
 * and levels keep their identity (views skip them), and memoised per day.
 */
export function dueView(ws: Workspace, today = dayKey(Date.now())): Workspace {
  return dueWorkspace(ws, today);
}
