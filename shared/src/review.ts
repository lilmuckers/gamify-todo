import type { Item, Level, Workspace } from './model';
import { activeProjects, isMvpItem, isProjectArchived, isResolved } from './model';
import type { OpBody } from './ops';
import { isCleared, levelTimer, scoreLevel, suggestNext, type TimerPhase } from './scoring';
import { levelsOf, type LevelRef } from './today';

const DAY_MS = 86_400_000;
/** "This week": what shipped in the last this-many days. */
export const REVIEW_WINDOW_DAYS = 7;
/** A started level with no activity for this long is stale. */
export const STALE_DAYS = 14;
/** Levels you can pick to focus on next week. */
export const MAX_FOCUS = 3;

export interface ShippedLevel extends LevelRef {
  clearedAt: string;
  stars: number;
  xp: number;
}

export interface ShippedItem extends LevelRef {
  item: Item;
  doneAt: string;
  /** Set for a step inside this dependency's sub-level. */
  subId?: string;
  depTitle?: string;
}

export interface OverdueLevel extends LevelRef {
  overdueMs: number;
  mvpLeft: number;
  timeboxDays: number;
  /** Days already added to the time-box since starting. */
  extendedDays: number;
  /** Optional items still open: the obvious scope cut. */
  optional: Item[];
  /** Days since anything happened, when that's long enough to count as stale. */
  idleDays?: number;
}

export interface StaleLevel extends LevelRef {
  idleDays: number;
  mvpLeft: number;
}

export interface FocusCandidate extends LevelRef {
  phase: TimerPhase;
  mvpLeft: number;
  /** Not started yet: the project's suggested next level. */
  suggested?: boolean;
}

export interface WeeklyReview {
  /** Start of the window, ISO. */
  since: string;
  shipped: { levels: ShippedLevel[]; items: ShippedItem[]; xp: number; stars: number };
  /** Started levels past their time-box. */
  overdue: OverdueLevel[];
  /** Started levels with no activity for STALE_DAYS (not already overdue). */
  stale: StaleLevel[];
  /** Levels worth focusing on next week, most pressing first. */
  candidates: FocusCandidate[];
}

const mvpLeft = (level: Level) => level.successCriteria.filter((c) => c.mvp && !c.done).length;

/** Optional items not yet done or dropped: what "drop the optional stuff" drops. */
export function optionalLeft(level: Level): Item[] {
  return level.items.filter((i) => !isMvpItem(i) && !isResolved(i));
}

/** Latest sign of life in a level: started, cleared, an item or step done, or a criterion ticked (ms). */
export function lastActivity(level: Level): number | undefined {
  let last: number | undefined;
  const see = (at: string | undefined) => {
    const t = at ? Date.parse(at) : NaN;
    if (!Number.isNaN(t) && (last === undefined || t > last)) last = t;
  };
  see(level.startedAt);
  see(level.clearedAt);
  for (const item of level.items) {
    see(item.doneAt);
    for (const step of item.subtasks ?? []) see(step.doneAt);
  }
  for (const c of level.successCriteria) see(c.doneAt);
  return last;
}

/** The week in review across every project, as of `now`. */
export function weeklyReview(ws: Workspace, now = Date.now()): WeeklyReview {
  const since = now - REVIEW_WINDOW_DAYS * DAY_MS;
  const inWindow = (at: string | undefined) => {
    const t = at ? Date.parse(at) : NaN;
    return t >= since && t <= now;
  };
  const review: WeeklyReview = {
    since: new Date(since).toISOString(),
    shipped: { levels: [], items: [], xp: 0, stars: 0 },
    overdue: [],
    stale: [],
    candidates: [],
  };

  for (const { level, ref, state } of levelsOf(ws)) {
    const cleared = isCleared(level);
    if (cleared && inWindow(level.clearedAt)) {
      const s = scoreLevel(level, now);
      review.shipped.levels.push({ ...ref, clearedAt: level.clearedAt!, stars: s.stars, xp: s.xp });
      review.shipped.xp += s.xp;
      review.shipped.stars += s.stars;
    }
    for (const item of level.items) {
      if (item.status === 'done' && inWindow(item.doneAt)) review.shipped.items.push({ ...ref, item, doneAt: item.doneAt! });
      for (const step of item.subtasks ?? [])
        if (step.status === 'done' && inWindow(step.doneAt))
          review.shipped.items.push({ ...ref, item: step as Item, doneAt: step.doneAt!, subId: item.id, depTitle: item.title });
    }

    // What shipped still counts; an archived game's clocks are frozen, so it's never overdue or stale.
    if (cleared || level.someday || !level.startedAt || isProjectArchived(state)) continue;
    const timer = levelTimer(level, now);
    const last = lastActivity(level) ?? Date.parse(level.startedAt);
    const idle = Math.floor((now - last) / DAY_MS);
    const stale = idle >= STALE_DAYS;
    if (timer.phase === 'overdue')
      review.overdue.push({
        ...ref,
        overdueMs: -(timer.remainingMs ?? 0),
        mvpLeft: mvpLeft(level),
        timeboxDays: level.timeboxDays,
        extendedDays: level.stats?.timeboxExtendedDays ?? 0,
        optional: optionalLeft(level),
        ...(stale ? { idleDays: idle } : {}),
      });
    else if (stale) review.stale.push({ ...ref, idleDays: idle, mvpLeft: mvpLeft(level) });
  }

  review.shipped.levels.sort((a, b) => b.clearedAt.localeCompare(a.clearedAt));
  review.shipped.items.sort((a, b) => b.doneAt.localeCompare(a.doneAt));
  review.overdue.sort((a, b) => b.overdueMs - a.overdueMs);
  review.stale.sort((a, b) => b.idleDays - a.idleDays);
  review.candidates = focusCandidates(ws, now);
  return review;
}

const PHASE_RANK: Record<TimerPhase, number> = { overdue: 0, hurry: 1, 'on-track': 2, 'not-started': 3, cleared: 4 };

/**
 * Levels to pick next week's focus from: every started, uncleared level (most
 * pressing first), then each project's suggested next level if nothing in it
 * is started. The someday shelf and archived games are left out.
 */
export function focusCandidates(ws: Workspace, now = Date.now()): FocusCandidate[] {
  const started: (FocusCandidate & { urgency: number })[] = [];
  const busy = new Set<string>();
  for (const { level, ref, state } of levelsOf(ws)) {
    if (!level.startedAt || level.someday || isCleared(level) || isProjectArchived(state)) continue;
    const timer = levelTimer(level, now);
    started.push({ ...ref, phase: timer.phase, mvpLeft: mvpLeft(level), urgency: timer.remainingFraction ?? Infinity });
    busy.add(ref.projectId);
  }
  started.sort((a, b) => PHASE_RANK[a.phase] - PHASE_RANK[b.phase] || a.urgency - b.urgency);
  const out: FocusCandidate[] = started.map(({ urgency: _, ...c }) => c);
  const all = levelsOf(ws);
  for (const state of activeProjects(ws)) {
    if (busy.has(state.overworld.id)) continue;
    const s = suggestNext(state);
    const found = s && all.find((l) => l.ref.projectId === state.overworld.id && l.ref.worldId === s.worldId && l.ref.levelId === s.levelId);
    if (found) out.push({ ...found.ref, phase: 'not-started', mvpLeft: mvpLeft(found.level), suggested: true });
  }
  return out;
}

/** One op per optional item still open: the scope cut, applied together as one commit. */
export function dropOptionalOps(ref: LevelRef, level: Level): OpBody[] {
  return optionalLeft(level).map((i) => ({
    kind: 'setItemStatus',
    projectId: ref.projectId,
    worldId: ref.worldId,
    levelId: ref.levelId,
    itemId: i.id,
    status: 'dropped',
  }));
}

/** When the weekly review falls due, in this browser's local time. */
export type ReviewDay = 'fri' | 'mon' | 'sun' | 'off';

export const REVIEW_SLOTS: Record<Exclude<ReviewDay, 'off'>, { weekday: number; hour: number; label: string }> = {
  fri: { weekday: 5, hour: 14, label: 'Friday afternoon' },
  mon: { weekday: 1, hour: 9, label: 'Monday morning' },
  sun: { weekday: 0, hour: 18, label: 'Sunday evening' },
};

/** The most recent review slot at or before `now` (ms), local time. */
export function lastReviewSlot(day: ReviewDay, now = Date.now()): number | undefined {
  if (day === 'off') return;
  const { weekday, hour } = REVIEW_SLOTS[day];
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - weekday + 7) % 7));
  if (d.getTime() > now) d.setDate(d.getDate() - 7);
  return d.getTime();
}

/** A review is due once a slot has passed since the last one. */
export function isReviewDue(day: ReviewDay, lastReviewAt: string | undefined, now = Date.now()): boolean {
  const slot = lastReviewSlot(day, now);
  if (slot === undefined) return false;
  const last = lastReviewAt ? Date.parse(lastReviewAt) : NaN;
  return Number.isNaN(last) || last < slot;
}
