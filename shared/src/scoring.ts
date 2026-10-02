import type { GameState, Level, World } from './model';
import { findLevel, isMvpItem, isResolved, orderedWorlds } from './model';

export const BASE_XP = 100;
export const TIME_BONUS_XP = 100;
export const POLISH_XP_COST = 15;
export const MIN_CLEAR_XP = 10;
/** Edits to one done item before it counts as polishing. */
export const FREE_EDITS_PER_ITEM = 3;
export const HURRY_FRACTION = 0.25;
const DAY_MS = 86_400_000;

export type TimerPhase = 'not-started' | 'on-track' | 'hurry' | 'overdue' | 'cleared';

export interface TimerState {
  phase: TimerPhase;
  deadline?: number;
  remainingMs?: number;
  /** 1 at start → 0 at deadline → negative when overdue. */
  remainingFraction?: number;
}

export function levelTimer(level: Level, now = Date.now()): TimerState {
  if (!level.startedAt) return { phase: 'not-started' };
  const start = Date.parse(level.startedAt);
  const total = level.timeboxDays * DAY_MS;
  const deadline = start + total;
  const at = level.clearedAt ? Date.parse(level.clearedAt) : now;
  const remainingMs = deadline - at;
  const remainingFraction = remainingMs / total;
  const phase: TimerPhase = level.clearedAt
    ? 'cleared'
    : remainingMs < 0
      ? 'overdue'
      : remainingFraction < HURRY_FRACTION
        ? 'hurry'
        : 'on-track';
  return { phase, deadline, remainingMs, remainingFraction };
}

/**
 * The time-box as first set: extensions after the level started (from the
 * weekly review) quiet the clock but don't buy back the star or the bonus.
 */
export function originalTimer(level: Level, now = Date.now()): TimerState {
  const extended = level.stats?.timeboxExtendedDays ?? 0;
  if (!extended) return levelTimer(level, now);
  return levelTimer({ ...level, timeboxDays: Math.max(1, level.timeboxDays - extended) }, now);
}

export function isCleared(level: Level): boolean {
  const mvp = level.successCriteria.filter((c) => c.mvp);
  return mvp.length > 0 && mvp.every((c) => c.done);
}

/** Perfectionism score: edits after clear, scope creep, over-editing done items. */
export function polishPoints(level: Level): number {
  const s = level.stats ?? {};
  const overEdits = Object.values(s.itemEdits ?? {}).reduce(
    (sum, n) => sum + Math.max(0, n - FREE_EDITS_PER_ITEM),
    0,
  );
  return (s.editsAfterClear ?? 0) + (s.itemsAddedAfterClear ?? 0) + overEdits;
}

export interface LevelScore {
  cleared: boolean;
  mvpDone: number;
  mvpTotal: number;
  stars: number;
  starReasons: { cleared: boolean; inTime: boolean; noPolish: boolean };
  xp: number;
  coins: number;
  polish: number;
  timer: TimerState;
  /** Days the time-box was extended after starting (scored against the original). */
  extendedDays: number;
}

export function coinsFor(level: Level): number {
  let coins = 0;
  for (const item of level.items) {
    if (item.status !== 'done') continue;
    coins += item.type === 'stretch' ? 3 : 1;
  }
  for (const c of level.successCriteria) if (!c.mvp && c.done) coins += 2;
  return coins;
}

export function scoreLevel(level: Level, now = Date.now()): LevelScore {
  const mvp = level.successCriteria.filter((c) => c.mvp);
  const mvpDone = mvp.filter((c) => c.done).length;
  const cleared = isCleared(level);
  const timer = levelTimer(level, now);
  const polish = polishPoints(level);
  const scored = originalTimer(level, now);
  const inTime = cleared && (scored.remainingFraction === undefined || scored.remainingFraction >= 0);
  const noPolish = cleared && polish === 0;
  const stars = cleared ? 1 + (inTime ? 1 : 0) + (noPolish ? 1 : 0) : 0;
  let xp = 0;
  if (cleared) {
    const frac = Math.max(0, Math.min(1, scored.remainingFraction ?? 0));
    xp = Math.max(
      MIN_CLEAR_XP,
      Math.round(BASE_XP + TIME_BONUS_XP * frac - POLISH_XP_COST * polish),
    );
  }
  return {
    cleared,
    mvpDone,
    mvpTotal: mvp.length,
    stars,
    starReasons: { cleared, inTime, noPolish },
    xp,
    coins: coinsFor(level),
    polish,
    timer,
    extendedDays: level.stats?.timeboxExtendedDays ?? 0,
  };
}

export type NodeState = 'cleared' | 'in-progress' | 'open' | 'locked';

/** Soft lock: a level is "open" once the previous one is cleared. Locked levels stay enterable. */
export function levelNodeState(world: World, index: number): NodeState {
  const level = world.levels[index];
  if (isCleared(level)) return 'cleared';
  if (level.startedAt) return 'in-progress';
  if (index === 0 || isCleared(world.levels[index - 1])) return 'open';
  return 'locked';
}

export function isWorldCleared(world: World): boolean {
  return world.levels.length > 0 && world.levels.every(isCleared);
}

export function isWorldLocked(state: GameState, world: World): boolean {
  return (world.unlocksAfter ?? []).some((id) => {
    const w = state.worlds[id];
    return w && !isWorldCleared(w);
  });
}

export interface Totals {
  xp: number;
  coins: number;
  stars: number;
  maxStars: number;
  levelsCleared: number;
  levels: number;
}

export function totals(state: GameState, now = Date.now()): Totals {
  const t: Totals = { xp: 0, coins: 0, stars: 0, maxStars: 0, levelsCleared: 0, levels: 0 };
  for (const world of Object.values(state.worlds)) {
    for (const level of world.levels) {
      const s = scoreLevel(level, now);
      t.xp += s.xp;
      t.coins += s.coins;
      t.stars += s.stars;
      t.maxStars += 3;
      t.levels += 1;
      if (s.cleared) t.levelsCleared += 1;
    }
  }
  return t;
}

export function worldTotals(world: World, now = Date.now()) {
  let stars = 0;
  let cleared = 0;
  for (const level of world.levels) {
    const s = scoreLevel(level, now);
    stars += s.stars;
    if (s.cleared) cleared += 1;
  }
  return { stars, maxStars: world.levels.length * 3, cleared, levels: world.levels.length };
}

/** Next level to play: finish what's started before starting something new. Skips the someday shelf. */
export function suggestNext(state: GameState): { worldId: string; levelId: string } | undefined {
  const worlds = orderedWorlds(state);
  for (const w of worlds)
    for (const l of w.levels)
      if (l.startedAt && !isCleared(l) && !l.someday) return { worldId: w.id, levelId: l.id };
  for (const w of worlds) {
    if (isWorldLocked(state, w)) continue;
    for (const l of w.levels) if (!isCleared(l) && !l.someday) return { worldId: w.id, levelId: l.id };
  }
}

/** The suggested next level itself, with where it is. */
export function suggestNextLevel(state: GameState): { worldId: string; levelId: string; level: Level } | undefined {
  const next = suggestNext(state);
  const level = next && findLevel(state, next.worldId, next.levelId);
  return next && level ? { ...next, level } : undefined;
}

export interface Nudge {
  tone: 'info' | 'warn' | 'alert' | 'win';
  text: string;
}

/** Anti-perfectionism coaching for a level. */
export function nudges(level: Level, now = Date.now()): Nudge[] {
  const out: Nudge[] = [];
  const score = scoreLevel(level, now);
  const optional = level.items.filter((i) => !isMvpItem(i) && !isResolved(i));
  const mvpItems = level.items.filter(isMvpItem);
  const mvpCriteria = level.successCriteria.filter((c) => c.mvp);

  if (score.cleared) {
    out.push({ tone: 'win', text: 'Level clear! Good enough shipped — head to the next level.' });
    if (optional.some((i) => i.status === 'doing'))
      out.push({ tone: 'warn', text: 'Still polishing extras on a cleared level. Move on; revisit later if it matters.' });
    if (score.polish > 0)
      out.push({ tone: 'warn', text: `Perfectionism detected 🐢 (${score.polish} polish point${score.polish === 1 ? '' : 's'}): −${score.polish * POLISH_XP_COST} XP.` });
    return out;
  }
  if (score.timer.phase === 'overdue') {
    const cut = optional.map((i) => i.title).slice(0, 3);
    out.push({
      tone: 'alert',
      text: `Hurry up! Time-box blown.${cut.length ? ` Drop: ${cut.join(', ')}.` : ' Cut an MVP criterion or ship what you have.'}`,
    });
  } else if (score.timer.phase === 'hurry') {
    out.push({ tone: 'warn', text: 'Under 25% of time left — ship the MVP or cut scope.' });
  }
  if (mvpItems.length > 0 && mvpItems.every(isResolved) && score.mvpDone < score.mvpTotal)
    out.push({ tone: 'info', text: 'All critical items done — tick the MVP criteria and grab the flag!' });
  if (mvpCriteria.length > 5)
    out.push({ tone: 'warn', text: `${mvpCriteria.length} MVP criteria is a lot. Which 3 truly matter?` });
  if (mvpItems.length > 15)
    out.push({ tone: 'warn', text: 'Huge level. Split it into two deliverables?' });
  return out;
}
