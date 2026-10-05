import type { HistoryEvent } from './history';
import type { Workspace } from './model';
import { isCleared, scoreLevel } from './scoring';
import { levelsOf } from './today';

const DAY_MS = 86_400_000;
/** Weeks of history the stats page draws (about four months). */
export const HISTORY_WEEKS = 20;

/** What got done on one local calendar day. */
export interface DayActivity {
  /** Local date, YYYY-MM-DD. */
  day: string;
  /** Items and dependency steps marked done. */
  done: number;
  /** Success criteria ticked. */
  ticked: number;
  /** Levels cleared. */
  cleared: number;
  total: number;
  /** Of those, how many were reopened or un-ticked later (they still count). */
  undone: number;
}

/** One bit of progress at a moment: from a done stamp in the data, or from commit history. */
export interface ProgressEvent {
  /** ms. */
  at: number;
  kind: 'done' | 'ticked' | 'cleared';
  /** "project/world/level". */
  level: string;
  /** Item title ("Step (in Dependency)" for steps), criterion id, or '' for a clear. */
  subject: string;
  /** Only in the commit history: the stamp has gone because it was reopened or un-ticked later. */
  undone?: boolean;
}

export interface Streak {
  /** Days in a row with progress, up to today (or yesterday, while today is still open). */
  current: number;
  longest: number;
  /** Something is done today already, so the streak is safe until midnight. */
  today: boolean;
}

export interface HeatCell {
  day: string;
  count: number;
  /** 0 (nothing) to 4 (a big day), for shading. */
  heat: 0 | 1 | 2 | 3 | 4;
  /** Levels cleared that day. */
  cleared: number;
  /** Things done that day and reopened later (from the commit history). */
  undone: number;
  /** After today: drawn blank. */
  future: boolean;
}

export interface TimeboxStats {
  /** Levels cleared. */
  cleared: number;
  /** Mean stars per cleared level. */
  avgStars?: number;
  /** Cleared levels with both a start and a clear time: the ones the timings below use. */
  timed: number;
  /** Of those, cleared within the original time-box. */
  inTime: number;
  inTimeRate?: number;
  /** Median days from start to clear. */
  medianDays?: number;
  /** Median original time-box, in days. */
  medianTimebox?: number;
  /** Median of days taken ÷ time-box, per level: over 1 means time-boxes run short. */
  medianRatio?: number;
}

/** How the time-boxes have been working out, from the median ratio. */
export type Calibration = 'early' | 'about-right' | 'late';

export interface XpWeek {
  /** Monday of the week, YYYY-MM-DD. */
  week: string;
  /** XP from levels cleared that week. */
  gained: number;
  /** Running total at the end of the week. */
  total: number;
}

export interface ProgressStats {
  /** Days with any progress, oldest first. */
  days: DayActivity[];
  streak: Streak;
  /** Week columns, oldest first, each Monday to Sunday. */
  heatmap: HeatCell[][];
  timebox: TimeboxStats;
  /** XP by week over the same span as the heatmap. */
  xp: { weeks: XpWeek[]; before: number; total: number };
  /** Everything ever done, ticked or cleared (that has a date). */
  total: number;
  /** Of those, the ones reopened or un-ticked later. */
  undone: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The local calendar day of a moment, YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const parseDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** The day `n` days after `day` (or before, when negative). Safe across clock changes. */
export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return dayKey(d.getTime());
}

/** The Monday on or before `day`. */
export function weekStart(day: string): string {
  return addDays(day, -((parseDay(day).getDay() + 6) % 7));
}

/**
 * Progress from the done stamps in the data: items and steps (`doneAt`),
 * criteria (`doneAt`) and level clears (`clearedAt`). Reopening something
 * removes its stamp, so this only sees what is still done.
 */
export function stampEvents(ws: Workspace): ProgressEvent[] {
  const out: ProgressEvent[] = [];
  for (const { level, ref } of levelsOf(ws)) {
    const key = `${ref.projectId}/${ref.worldId}/${ref.levelId}`;
    const add = (at: string | undefined, kind: ProgressEvent['kind'], subject: string) => {
      const t = at ? Date.parse(at) : NaN;
      if (!Number.isNaN(t)) out.push({ at: t, kind, level: key, subject });
    };
    for (const item of level.items) {
      if (item.status === 'done') add(item.doneAt, 'done', item.title);
      for (const step of item.subtasks ?? [])
        if (step.status === 'done') add(step.doneAt, 'done', `${step.title} (in ${item.title})`);
    }
    for (const c of level.successCriteria) if (c.done) add(c.doneAt, 'ticked', c.id);
    if (isCleared(level)) add(level.clearedAt, 'cleared', '');
  }
  return out;
}

/** How far a commit can trail the click it records (offline edits sync later). */
const SYNC_LAG_MS = 3 * DAY_MS;
/** Clocks differ: a commit can carry a time a little before the click's stamp. */
const SKEW_MS = 60 * 60 * 1000;

/**
 * Stamps plus what only the commit history knows: work done and then
 * reopened, un-ticked or dropped (its stamp is gone, the commit isn't).
 * A commit that records something a stamp already shows is left out, since
 * the stamp has the exact time. Commits made by hand or by other tools say
 * nothing parseable, so their changes count through the stamps alone.
 */
export function mergeHistory(stamps: ProgressEvent[], history: HistoryEvent[]): ProgressEvent[] {
  const out = [...stamps];
  if (!history.length) return out;
  const key = (kind: string, level: string, subject: string) => `${kind}|${level}|${subject}`;
  const unmatched = new Map<string, number[]>();
  for (const e of stamps) {
    if (e.kind === 'cleared') continue;
    const k = key(e.kind, e.level, e.subject);
    unmatched.set(k, [...(unmatched.get(k) ?? []), e.at]);
  }
  const events = [...history].sort((a, b) => a.at.localeCompare(b.at));
  events.forEach((h, i) => {
    if (h.kind !== 'done' && h.kind !== 'tick') return;
    const kind = h.kind === 'done' ? 'done' : 'ticked';
    const at = Date.parse(h.at);
    if (Number.isNaN(at)) return;
    const k = key(kind, h.level, h.subject);
    const stamps = unmatched.get(k) ?? [];
    const match = stamps.findIndex((t) => at >= t - SKEW_MS && at - t <= SYNC_LAG_MS);
    if (match >= 0) {
      stamps.splice(match, 1);
      return;
    }
    // Undone if the next change to the same thing takes it back.
    const undoes = (n: HistoryEvent) =>
      kind === 'done' ? n.kind === 'todo' || n.kind === 'doing' || n.kind === 'dropped' : n.kind === 'untick';
    const same = (n: HistoryEvent) =>
      n.level === h.level && n.subject === h.subject && (kind === 'done' ? n.kind !== 'tick' && n.kind !== 'untick' : n.kind === 'tick' || n.kind === 'untick');
    const next = events.slice(i + 1).find(same);
    out.push({ at, kind, level: h.level, subject: h.subject, ...(next && undoes(next) ? { undone: true } : {}) });
  });
  return out;
}

/** Progress per local day. */
export function activityByDay(events: ProgressEvent[]): Map<string, DayActivity> {
  const days = new Map<string, DayActivity>();
  for (const e of events) {
    const day = dayKey(e.at);
    let a = days.get(day);
    if (!a) days.set(day, (a = { day, done: 0, ticked: 0, cleared: 0, total: 0, undone: 0 }));
    a[e.kind] += 1;
    a.total += 1;
    if (e.undone) a.undone += 1;
  }
  return days;
}

/** Progress events for a workspace, with the commit history when there is one. */
export function progressEvents(ws: Workspace, history: HistoryEvent[] = []): ProgressEvent[] {
  return mergeHistory(stampEvents(ws), history);
}

/** The current and longest runs of days with progress, as of `now`. */
export function streaks(active: Iterable<string>, now = Date.now()): Streak {
  const today = dayKey(now);
  // Stamps from a fast clock elsewhere can't count towards a streak yet.
  const days = [...new Set(active)].filter((d) => d <= today).sort();
  const set = new Set(days);
  let longest = 0;
  let run = 0;
  let prev: string | undefined;
  for (const day of days) {
    run = prev && addDays(prev, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }
  const done = set.has(today);
  let current = 0;
  for (let day = done ? today : addDays(today, -1); set.has(day); day = addDays(day, -1)) current += 1;
  return { current, longest, today: done };
}

/** Shade for a day's count: 1, 2–3, 4–6, 7+. */
export function heatOf(count: number): HeatCell['heat'] {
  return count <= 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
}

/** First Monday shown when drawing `weeks` weeks up to `now`. */
function firstWeek(weeks: number, now: number): string {
  return addDays(weekStart(dayKey(now)), -7 * (weeks - 1));
}

/** A calendar of the last `weeks` weeks: one column per week, Monday at the top. */
export function heatmap(activity: Map<string, DayActivity>, now = Date.now(), weeks = HISTORY_WEEKS): HeatCell[][] {
  const today = dayKey(now);
  const cols: HeatCell[][] = [];
  let day = firstWeek(weeks, now);
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let i = 0; i < 7; i++, day = addDays(day, 1)) {
      const future = day > today;
      const a = future ? undefined : activity.get(day);
      const count = a?.total ?? 0;
      col.push({ day, count, heat: heatOf(count), cleared: a?.cleared ?? 0, undone: a?.undone ?? 0, future });
    }
    cols.push(col);
  }
  return cols;
}

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * How cleared levels went against their time-boxes: stars, the share
 * cleared in time, and median days taken against the box. Timings use the
 * time-box as first set, like the in-time star.
 */
export function timeboxStats(ws: Workspace, now = Date.now()): TimeboxStats {
  const out: TimeboxStats = { cleared: 0, timed: 0, inTime: 0 };
  let stars = 0;
  const days: number[] = [];
  const boxes: number[] = [];
  const ratios: number[] = [];
  for (const { level } of levelsOf(ws)) {
    if (!isCleared(level)) continue;
    const score = scoreLevel(level, now);
    out.cleared += 1;
    stars += score.stars;
    const start = level.startedAt ? Date.parse(level.startedAt) : NaN;
    const end = level.clearedAt ? Date.parse(level.clearedAt) : NaN;
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    const box = Math.max(1, level.timeboxDays - score.extendedDays);
    const took = (end - start) / DAY_MS;
    out.timed += 1;
    if (score.starReasons.inTime) out.inTime += 1;
    days.push(took);
    boxes.push(box);
    ratios.push(took / box);
  }
  if (out.cleared) out.avgStars = stars / out.cleared;
  if (out.timed) {
    out.inTimeRate = out.inTime / out.timed;
    out.medianDays = median(days);
    out.medianTimebox = median(boxes);
    out.medianRatio = median(ratios);
  }
  return out;
}

/** Early: levels usually take well under their box. Late: usually over it. */
export function calibration(stats: TimeboxStats): Calibration | undefined {
  const r = stats.medianRatio;
  if (r === undefined) return;
  return r < 0.6 ? 'early' : r > 1.1 ? 'late' : 'about-right';
}

/**
 * XP earned per week (from each cleared level, on the day it cleared) over
 * the last `weeks` weeks, with the running total. XP from before the span,
 * or from levels with no clear date, is the starting `before`.
 */
export function xpOverTime(ws: Workspace, now = Date.now(), weeks = HISTORY_WEEKS): ProgressStats['xp'] {
  const first = firstWeek(weeks, now);
  const gained = new Map<string, number>();
  let before = 0;
  for (const { level } of levelsOf(ws)) {
    const xp = scoreLevel(level, now).xp;
    if (!xp) continue;
    const t = level.clearedAt ? Date.parse(level.clearedAt) : NaN;
    const week = Number.isNaN(t) ? undefined : weekStart(dayKey(Math.min(t, now)));
    if (!week || week < first) before += xp;
    else gained.set(week, (gained.get(week) ?? 0) + xp);
  }
  let total = before;
  const out: XpWeek[] = [];
  for (let w = 0, week = first; w < weeks; w++, week = addDays(week, 7)) {
    const g = gained.get(week) ?? 0;
    total += g;
    out.push({ week, gained: g, total });
  }
  return { weeks: out, before, total };
}

/** Everything the stats page shows, as of `now`. */
export function progressStats(ws: Workspace, now = Date.now(), weeks = HISTORY_WEEKS, history: HistoryEvent[] = []): ProgressStats {
  const activity = activityByDay(progressEvents(ws, history));
  const days = [...activity.values()].sort((a, b) => a.day.localeCompare(b.day));
  return {
    days,
    streak: streaks(activity.keys(), now),
    heatmap: heatmap(activity, now, weeks),
    timebox: timeboxStats(ws, now),
    xp: xpOverTime(ws, now, weeks),
    total: days.reduce((sum, d) => sum + d.total, 0),
    undone: days.reduce((sum, d) => sum + d.undone, 0),
  };
}

const streakCache = new WeakMap<Workspace, { day: string; history: HistoryEvent[]; streak: Streak }>();
const NO_HISTORY: HistoryEvent[] = [];

/** The streak alone, for the HUD: cached per workspace, history and day, since the HUD redraws often. */
export function currentStreak(ws: Workspace, now = Date.now(), history: HistoryEvent[] = NO_HISTORY): Streak {
  const day = dayKey(now);
  const hit = streakCache.get(ws);
  if (hit?.day === day && hit.history === history) return hit.streak;
  const streak = streaks(activityByDay(progressEvents(ws, history)).keys(), now);
  streakCache.set(ws, { day, history, streak });
  return streak;
}
