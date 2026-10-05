import type { HistoryEvent } from './history';
import type { ItemType, Workspace } from './model';
import { changesAsHistory, type ChangeEvent } from './scan';
import { isCleared, POLISH_XP_COST, polishPoints, scoreLevel } from './scoring';
import {
  activityByDay,
  addDays,
  dayKey,
  heatmap,
  progressEvents,
  streaks,
  timeboxStats,
  weekStart,
  xpOverTime,
  type DayActivity,
  type HeatCell,
  type ProgressEvent,
  type ProgressStats,
  type Streak,
  type TimeboxStats,
} from './stats';
import { levelsOf } from './today';

/** Changes that count as polish on a cleared level (adds have their own count; cuts are free). */
const POLISH_KINDS = new Set<ChangeEvent['kind']>(['edited', 'reopened', 'done', 'ticked', 'unticked', 'extended']);

/** Weeks the detailed page looks back over. */
export const DETAILED_WEEKS = 52;

export interface ScatterPoint {
  project: string;
  level: string;
  /** Original time-box, days. */
  box: number;
  took: number;
  inTime: boolean;
}

export interface ProjectRow {
  id: string;
  title: string;
  done: number;
  items: number;
  cleared: number;
  levels: number;
  inTime: number;
  timed: number;
  stars: number;
  xp: number;
  /** Items dropped (scope cut). */
  cut: number;
  /** Every level cleared: a finished game. */
  finished: boolean;
}

export interface ScopeWeek {
  week: string;
  added: number;
  cut: number;
}

export interface LogLine {
  at: number;
  kind: ProgressEvent['kind'];
  /** What it was: an item title, a criterion's text, or the level's name for a clear. */
  title: string;
  project: string;
  levelName: string;
  undone?: boolean;
}

export interface DetailedStats {
  streak: Streak;
  total: number;
  undone: number;
  bestDay?: DayActivity;
  bestWeek?: { week: string; total: number };
  heatmap: HeatCell[][];
  /** Monday first. */
  weekday: number[];
  hour: number[];
  /** Done items by type (as the data stands). */
  mix: Partial<Record<ItemType, number>>;
  scope: { addedAfterStart: number; cut: number; extendedDays: number; weeks: ScopeWeek[] };
  timebox: TimeboxStats;
  scatter: ScatterPoint[];
  projects: ProjectRow[];
  polish: { reopened: number; editsAfterClear: number; xpLost: number; top: { title: string; levelName: string; times: number }[] };
  xp: ProgressStats['xp'];
  /** Newest first. */
  recent: LogLine[];
  /** Every bit of progress, for the day log. */
  events: ProgressEvent[];
  /** The deep scan contributed (scope, polish and reopen counts are complete). */
  scanned: boolean;
}

/** Quick (commit message) and deep (diff) history describe the same commits: count each once. */
function uniqueHistory(quick: HistoryEvent[], deep: ChangeEvent[]): HistoryEvent[] {
  const seen = new Set<string>();
  const out: HistoryEvent[] = [];
  // Deep first: it has the click time when the data stamped one.
  for (const e of [...changesAsHistory(deep), ...quick]) {
    const k = `${e.sha}|${e.kind}|${e.level}|${e.subject}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/**
 * Everything on the detailed stats page, as of `now`: the done stamps in
 * the data, plus the commit history (quick, from commit messages) and the
 * deep scan (from the changes themselves) when there are any.
 */
export function detailedStats(ws: Workspace, opts: { now?: number; quick?: HistoryEvent[]; deep?: ChangeEvent[] } = {}): DetailedStats {
  const now = opts.now ?? Date.now();
  const deep = opts.deep ?? [];
  const events = progressEvents(ws, uniqueHistory(opts.quick ?? [], deep)).filter((e) => e.at <= now);
  const activity = activityByDay(events);
  const days = [...activity.values()];

  let bestDay: DayActivity | undefined;
  const weeks = new Map<string, number>();
  for (const d of days) {
    if (!bestDay || d.total > bestDay.total) bestDay = d;
    const w = weekStart(d.day);
    weeks.set(w, (weeks.get(w) ?? 0) + d.total);
  }
  let bestWeek: DetailedStats['bestWeek'];
  for (const [week, total] of weeks) if (!bestWeek || total > bestWeek.total) bestWeek = { week, total };

  const weekday = [0, 0, 0, 0, 0, 0, 0];
  const hour = new Array<number>(24).fill(0);
  for (const e of events) {
    const d = new Date(e.at);
    weekday[(d.getDay() + 6) % 7] += 1;
    hour[d.getHours()] += 1;
  }

  // Names, for the logs.
  const names = new Map<string, { project: string; levelName: string; criteria: Map<string, string> }>();
  const projects = new Map<string, ProjectRow>();
  const scatter: ScatterPoint[] = [];
  const mix: DetailedStats['mix'] = {};
  let xpLost = 0;
  const statsEdits: { title: string; levelName: string; times: number }[] = [];
  for (const { level, ref, state } of levelsOf(ws)) {
    names.set(`${ref.projectId}/${ref.worldId}/${ref.levelId}`, {
      project: ref.projectId,
      levelName: level.name,
      criteria: new Map(level.successCriteria.map((c) => [c.id, c.text])),
    });
    const row =
      projects.get(ref.projectId) ??
      projects
        .set(ref.projectId, { id: ref.projectId, title: state.overworld.title, done: 0, items: 0, cleared: 0, levels: 0, inTime: 0, timed: 0, stars: 0, xp: 0, cut: 0, finished: true })
        .get(ref.projectId)!;
    row.levels += 1;
    for (const item of level.items) {
      row.items += 1;
      if (item.status === 'done') {
        row.done += 1;
        mix[item.type] = (mix[item.type] ?? 0) + 1;
      }
      if (item.status === 'dropped') row.cut += 1;
    }
    const score = scoreLevel(level, now);
    for (const [key, n] of Object.entries(level.stats?.itemEdits ?? {}))
      if (n > 3) statsEdits.push({ title: level.items.find((i) => i.id === key)?.title ?? key, levelName: level.name, times: n });
    if (!isCleared(level)) {
      row.finished = false;
      continue;
    }
    row.cleared += 1;
    xpLost += polishPoints(level) * POLISH_XP_COST;
    row.stars += score.stars;
    row.xp += score.xp;
    if (level.startedAt && level.clearedAt) {
      const took = (Date.parse(level.clearedAt) - Date.parse(level.startedAt)) / 86_400_000;
      row.timed += 1;
      if (score.starReasons.inTime) row.inTime += 1;
      scatter.push({ project: ref.projectId, level: level.name, box: Math.max(1, level.timeboxDays - score.extendedDays), took, inTime: score.starReasons.inTime });
    }
  }

  // Scope and polish from the deep scan.
  const first = addDays(weekStart(dayKey(now)), -7 * (DETAILED_WEEKS - 1));
  const scopeWeeks = new Map<string, ScopeWeek>();
  for (let w = 0, week = first; w < DETAILED_WEEKS; w++, week = addDays(week, 7)) scopeWeeks.set(week, { week, added: 0, cut: 0 });
  let addedAfterStart = 0;
  let cut = 0;
  let extendedDays = 0;
  let reopened = 0;
  let editsAfterClear = 0;
  const fiddles = new Map<string, { title: string; levelName: string; times: number }>();
  for (const e of deep) {
    const week = scopeWeeks.get(weekStart(dayKey(Date.parse(e.at))));
    if (e.kind === 'added' && e.afterStart) {
      addedAfterStart += 1;
      if (week) week.added += 1;
    }
    if ((e.kind === 'dropped' || e.kind === 'removed') && e.afterStart) {
      cut += 1;
      if (week) week.cut += 1;
    }
    if (e.kind === 'extended') extendedDays += e.days ?? 0;
    if (e.kind === 'reopened' || e.kind === 'unticked') reopened += 1;
    // As the app counts polish: any change to a cleared level except adding or cutting scope.
    if (e.afterClear && POLISH_KINDS.has(e.kind)) editsAfterClear += 1;
    if (e.kind === 'reopened' || e.kind === 'edited') {
      const k = `${e.level}|${e.subject}`;
      const f = fiddles.get(k) ?? fiddles.set(k, { title: e.subject, levelName: names.get(e.level)?.levelName ?? e.level, times: 0 }).get(k)!;
      f.times += 1;
    }
  }
  const top = [...fiddles.values(), ...(deep.length ? [] : statsEdits)].filter((f) => f.times > 1).sort((a, b) => b.times - a.times).slice(0, 5);

  const line = (e: ProgressEvent): LogLine => {
    const n = names.get(e.level);
    const title = e.kind === 'cleared' ? (n?.levelName ?? e.level) : e.kind === 'ticked' ? (n?.criteria.get(e.subject) ?? e.subject) : e.subject;
    return { at: e.at, kind: e.kind, title, project: n?.project ?? e.level.split('/')[0], levelName: n?.levelName ?? e.level, ...(e.undone ? { undone: true } : {}) };
  };
  const sorted = [...events].sort((a, b) => b.at - a.at);

  return {
    streak: streaks(activity.keys(), now),
    total: days.reduce((n, d) => n + d.total, 0),
    undone: days.reduce((n, d) => n + d.undone, 0),
    bestDay,
    bestWeek,
    heatmap: heatmap(activity, now, DETAILED_WEEKS),
    weekday,
    hour,
    mix,
    scope: { addedAfterStart, cut: deep.length ? cut : [...projects.values()].reduce((n, p) => n + p.cut, 0), extendedDays, weeks: [...scopeWeeks.values()] },
    timebox: timeboxStats(ws, now),
    scatter,
    projects: [...projects.values()],
    polish: { reopened, editsAfterClear, xpLost, top },
    xp: xpOverTime(ws, now, DETAILED_WEEKS),
    recent: sorted.slice(0, 12).map(line),
    events: sorted,
    scanned: deep.length > 0,
  };
}

/** What happened on one local day, newest first, with names. */
export function dayLog(ws: Workspace, stats: DetailedStats, day: string): LogLine[] {
  const names = new Map(levelsOf(ws).map(({ level, ref }) => [`${ref.projectId}/${ref.worldId}/${ref.levelId}`, level]));
  return stats.events
    .filter((e) => dayKey(e.at) === day)
    .map((e) => {
      const level = names.get(e.level);
      const title =
        e.kind === 'cleared' ? (level?.name ?? e.level) : e.kind === 'ticked' ? (level?.successCriteria.find((c) => c.id === e.subject)?.text ?? e.subject) : e.subject;
      return { at: e.at, kind: e.kind, title, project: e.level.split('/')[0], levelName: level?.name ?? e.level, ...(e.undone ? { undone: true } : {}) };
    });
}
