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
 * Progress per local day, from the done stamps in the data: items and steps
 * (`doneAt`), criteria (`doneAt`) and level clears (`clearedAt`). Things
 * reopened since have lost their stamp, so they don't count.
 */
export function activityByDay(ws: Workspace): Map<string, DayActivity> {
  const days = new Map<string, DayActivity>();
  const add = (at: string | undefined, kind: 'done' | 'ticked' | 'cleared') => {
    const t = at ? Date.parse(at) : NaN;
    if (Number.isNaN(t)) return;
    const day = dayKey(t);
    let a = days.get(day);
    if (!a) days.set(day, (a = { day, done: 0, ticked: 0, cleared: 0, total: 0 }));
    a[kind] += 1;
    a.total += 1;
  };
  for (const { level } of levelsOf(ws)) {
    for (const item of level.items) {
      if (item.status === 'done') add(item.doneAt, 'done');
      for (const step of item.subtasks ?? []) if (step.status === 'done') add(step.doneAt, 'done');
    }
    for (const c of level.successCriteria) if (c.done) add(c.doneAt, 'ticked');
    if (isCleared(level)) add(level.clearedAt, 'cleared');
  }
  return days;
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
      col.push({ day, count, heat: heatOf(count), cleared: a?.cleared ?? 0, future });
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
export function progressStats(ws: Workspace, now = Date.now(), weeks = HISTORY_WEEKS): ProgressStats {
  const activity = activityByDay(ws);
  const days = [...activity.values()].sort((a, b) => a.day.localeCompare(b.day));
  return {
    days,
    streak: streaks(activity.keys(), now),
    heatmap: heatmap(activity, now, weeks),
    timebox: timeboxStats(ws, now),
    xp: xpOverTime(ws, now, weeks),
    total: days.reduce((sum, d) => sum + d.total, 0),
  };
}

const streakCache = new WeakMap<Workspace, { day: string; streak: Streak }>();

/** The streak alone, for the HUD: cached per workspace and day, since the HUD redraws often. */
export function currentStreak(ws: Workspace, now = Date.now()): Streak {
  const day = dayKey(now);
  const hit = streakCache.get(ws);
  if (hit?.day === day) return hit.streak;
  const streak = streaks(activityByDay(ws).keys(), now);
  streakCache.set(ws, { day, streak });
  return streak;
}
