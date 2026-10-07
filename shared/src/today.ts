import type { GameState, Item, Level, Workspace } from './model';
import { activeProjects, dependencyMode, isProjectArchived, isResolved, orderedProjects, orderedWorlds, subLevel } from './model';
import { layoutLevel } from './layout';
import { isCleared, levelTimer, suggestNext, type TimerPhase } from './scoring';

/** Where a Today entry lives, plus a "cheat code" like 3-2 (world 3, level 2). */
export interface TodayRef {
  projectId: string;
  projectTitle: string;
  worldId: string;
  worldName: string;
  levelId: string;
  levelName: string;
  code: string;
  /** Set when the entry is a step inside this dependency's sub-level. */
  subId?: string;
  depTitle?: string;
}

export interface TodayItem extends TodayRef {
  item: Item;
  phase: TimerPhase;
  /** A level that hasn't been started yet: the suggested place to begin. */
  suggested?: boolean;
  /** In one of this week's focus levels (picked in the weekly review). */
  focus?: boolean;
}

/** A level picked as one of this week's focus levels. */
export interface TodayFocus extends LevelRef {
  phase: TimerPhase;
  mvpLeft: number;
}

export interface TodayLevel extends TodayRef {
  phase: 'hurry' | 'overdue';
  remainingMs: number;
  mvpLeft: number;
}

export interface TodayList {
  /** This week's focus levels that still need clearing, in the order picked. */
  focus: TodayFocus[];
  /** Started levels whose time-box is nearly or completely used up. */
  overdue: TodayLevel[];
  /** Items (and dependency steps) in progress. */
  doing: TodayItem[];
  /** Where the hero is waiting in each active level, or where to start. */
  next: TodayItem[];
}

const PHASE_RANK: Record<TimerPhase, number> = { overdue: 0, hurry: 1, 'on-track': 2, 'not-started': 3, cleared: 4 };

/** Where a level lives, with its cheat code. */
export type LevelRef = Omit<TodayRef, 'subId' | 'depTitle'>;

export interface Located {
  state: GameState;
  ref: LevelRef;
  level: Level;
}

/** Every level in every project, in map order, with where it lives. */
export function levelsOf(ws: Workspace): Located[] {
  const out: Located[] = [];
  for (const state of orderedProjects(ws))
    orderedWorlds(state).forEach((world, wi) =>
      world.levels.forEach((level, li) =>
        out.push({
          state,
          level,
          ref: {
            projectId: state.overworld.id,
            projectTitle: state.overworld.title,
            worldId: world.id,
            worldName: world.name,
            levelId: level.id,
            levelName: level.name,
            code: `${wi + 1}-${li + 1}`,
          },
        }),
      ),
    );
  return out;
}

/** The item the hero stops at in a level, stepping into a warp pipe's sub-level. */
function nextStop(level: Level): { item: Item; subId?: string; depTitle?: string } | undefined {
  const id = layoutLevel(level).hero.itemId;
  const item = id ? level.items.find((i) => i.id === id) : undefined;
  if (!item) return;
  if (dependencyMode(item) === 'warp') {
    const sub = subLevel(level, item);
    const stepId = layoutLevel(sub, { sub: true }).hero.itemId;
    const step = stepId ? sub.items.find((i) => i.id === stepId) : undefined;
    if (step) return { item: step, subId: item.id, depTitle: item.title };
  }
  return { item };
}

/** "project/world/level": how focus levels are stored. */
export const levelKey = (r: { projectId: string; worldId: string; levelId: string }) => `${r.projectId}/${r.worldId}/${r.levelId}`;

/**
 * Everything worth doing today, across every project. `focus` holds this
 * week's focus levels ("project/world/level"); their items go first.
 */
export function todayList(ws: Workspace, now = Date.now(), focus: string[] = []): TodayList {
  const overdue: TodayLevel[] = [];
  const doing: (TodayItem & { urgency: number })[] = [];
  const next: (TodayItem & { urgency: number })[] = [];
  const focusLevels: TodayFocus[] = [];
  const focused = new Set(focus);

  for (const { level, ref, state } of levelsOf(ws)) {
    // Parked on the someday shelf, or the whole game archived: not today's problem.
    if (isCleared(level) || level.someday || isProjectArchived(state)) continue;
    const timer = levelTimer(level, now);
    const urgency = timer.remainingFraction ?? Infinity;
    const inFocus = focused.has(levelKey(ref));
    const mark = inFocus ? { focus: true } : {};
    if (inFocus) focusLevels.push({ ...ref, phase: timer.phase, mvpLeft: level.successCriteria.filter((c) => c.mvp && !c.done).length });

    if (timer.phase === 'overdue' || timer.phase === 'hurry') {
      const mvpLeft = level.successCriteria.filter((c) => c.mvp && !c.done).length;
      overdue.push({ ...ref, phase: timer.phase, remainingMs: timer.remainingMs ?? 0, mvpLeft });
    }

    for (const item of level.items) {
      if (item.status === 'doing') doing.push({ ...ref, item, phase: timer.phase, urgency, ...mark });
      for (const step of item.subtasks ?? [])
        if (step.status === 'doing')
          doing.push({ ...ref, item: step as Item, subId: item.id, depTitle: item.title, phase: timer.phase, urgency, ...mark });
    }

    // A focus level is worth starting even if it hasn't been yet.
    if (level.startedAt || inFocus) {
      const stop = nextStop(level);
      if (stop && !isResolved(stop.item)) next.push({ ...ref, ...stop, phase: timer.phase, urgency, ...mark });
    }
  }

  // Projects with nothing on the go: suggest where to start.
  const active = new Set(next.map((n) => n.projectId));
  for (const state of activeProjects(ws)) {
    if (active.has(state.overworld.id)) continue;
    const s = suggestNext(state);
    if (!s) continue;
    const located = levelsOf({ projects: { [state.overworld.id]: state } }).find(
      (l) => l.ref.worldId === s.worldId && l.ref.levelId === s.levelId,
    );
    const stop = located && nextStop(located.level);
    if (located && stop)
      next.push({ ...located.ref, ...stop, phase: levelTimer(located.level, now).phase, suggested: true, urgency: Infinity });
  }

  const doingIds = new Set(doing.map((d) => `${d.projectId}/${d.worldId}/${d.levelId}/${d.subId ?? ''}/${d.item.id}`));
  const byUrgency = (a: { urgency: number; phase: TimerPhase; projectTitle: string; focus?: boolean }, b: typeof a) =>
    Number(!a.focus) - Number(!b.focus) ||
    PHASE_RANK[a.phase] - PHASE_RANK[b.phase] ||
    a.urgency - b.urgency ||
    a.projectTitle.localeCompare(b.projectTitle);
  const strip = <T extends { urgency: number }>({ urgency: _, ...rest }: T) => rest;

  const order = (r: LevelRef) => focus.indexOf(levelKey(r));
  return {
    focus: focusLevels.sort((a, b) => order(a) - order(b)),
    overdue: overdue.sort((a, b) => a.remainingMs - b.remainingMs),
    doing: doing.sort(byUrgency).map(strip),
    next: next
      .filter((n) => !doingIds.has(`${n.projectId}/${n.worldId}/${n.levelId}/${n.subId ?? ''}/${n.item.id}`))
      .sort((a, b) => Number(!!a.suggested) - Number(!!b.suggested) || byUrgency(a, b))
      .map(strip),
  };
}
