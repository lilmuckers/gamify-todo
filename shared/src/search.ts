import type { GameState, Item, ItemStatus, ItemType, Level, Subtask, World, Workspace } from './model';
import { clockNow, isProjectArchived, isProjectFinished, orderedProjects, orderedWorlds } from './model';
import { alertLevel, budgetPrefs, itemCost, levelCost, worldCost, type BudgetPrefs, type Cost } from './budget';
import { isBlocking } from './layout';
import { levelTimer } from './scoring';

/** What a search result is: a whole project down to a step inside a dependency, or an inbox idea. */
export type SearchKind = 'project' | 'world' | 'level' | 'item' | 'step' | 'inbox';

/** One thing search can find, flattened out of the workspace with where it lives. */
export interface SearchEntry {
  kind: SearchKind;
  title: string;
  /** Titles above it, outermost first: project, world, level, then the dependency for a step. */
  path: string[];
  projectId?: string;
  worldId?: string;
  levelId?: string;
  /** The dependency a step sits under. */
  subId?: string;
  /** The item, step or inbox idea. */
  itemId?: string;
  itemType?: ItemType;
  status?: ItemStatus;
  /** Notes, deliverables, criteria: matched, but worth less than the title. */
  body: string;
  /** An open must-do item: it holds the level up. */
  blocking?: boolean;
  /** A level past its time-box, or something inside one. */
  overdue?: boolean;
  /** Spent more than its budget (only when the project has budgets on). */
  overBudget?: boolean;
  /** In a finished game: ranked lower. */
  finished?: boolean;
  /** In an archived game: hidden unless asked for. */
  archived?: boolean;
  /** Folded copies for matching (lower case, no accents). */
  keys: { title: string; path: string; body: string };
}

/** Narrows results. Every filter set must match; within a list, any value does. */
export interface SearchFilters {
  types?: ItemType[];
  statuses?: ItemStatus[];
  blocking?: boolean;
  overdue?: boolean;
  overBudget?: boolean;
  /** Include archived games (left out otherwise). */
  archived?: boolean;
}

export interface SearchHit {
  entry: SearchEntry;
  score: number;
}

/** Lower case without accents, so "cafe" finds "Café". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const tokens = (query: string) => fold(query).split(/\s+/).filter(Boolean);

function entry(e: Omit<SearchEntry, 'keys'>): SearchEntry {
  return { ...e, keys: { title: fold(e.title), path: fold(e.path.join(' ')), body: fold(e.body) } };
}

const over = (c: Cost, prefs: BudgetPrefs | undefined) => !!prefs && alertLevel(c, prefs.alertAt) === 2;
const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join('\n');

/**
 * Every project, world, level, item, dependency step and inbox idea in the
 * workspace, in the order the app shows them (games in play first).
 * `now` decides which levels are overdue.
 */
export function buildSearchIndex(ws: Workspace, now = Date.now()): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const state of orderedProjects(ws)) indexProject(out, state, now);
  for (const idea of ws.inbox ?? [])
    out.push(entry({ kind: 'inbox', title: idea.title, path: ['Inbox'], itemId: idea.id, itemType: idea.type, body: join(idea.notes, idea.link) }));
  return out;
}

function indexProject(out: SearchEntry[], state: GameState, now: number) {
  const p = state.overworld;
  const prefs = budgetPrefs(state);
  const flags = { finished: isProjectFinished(state) || undefined, archived: isProjectArchived(state) || undefined };
  const at = { projectId: p.id };
  out.push(entry({ kind: 'project', title: p.title, path: [], ...at, ...flags, body: join(p.description, ...p.goals.map((g) => g.title)) }));
  for (const world of orderedWorlds(state)) indexWorld(out, state, world, prefs, flags, clockNow(p, now));
}

function indexWorld(out: SearchEntry[], state: GameState, world: World, prefs: BudgetPrefs | undefined, flags: object, now: number) {
  const projectTitle = state.overworld.title;
  const at = { projectId: state.overworld.id, worldId: world.id };
  out.push(entry({ kind: 'world', title: world.name, path: [projectTitle], ...at, ...flags, body: world.description ?? '', overBudget: over(worldCost(world), prefs) || undefined }));
  for (const level of world.levels) {
    const path = [projectTitle, world.name, level.name];
    const overdue = levelTimer(level, now).phase === 'overdue' || undefined;
    const lvl = { ...at, levelId: level.id, ...flags, overdue };
    out.push(entry({ kind: 'level', title: level.name, path: path.slice(0, 2), ...lvl, body: levelBody(level), overBudget: over(levelCost(level), prefs) || undefined }));
    for (const item of level.items) {
      out.push(itemEntry('item', item, path, lvl, prefs));
      for (const step of item.subtasks ?? []) out.push(itemEntry('step', step, [...path, item.title], { ...lvl, subId: item.id }, prefs));
    }
  }
}

const levelBody = (level: Level) => join(level.deliverable, level.description, ...level.successCriteria.map((c) => c.text));

function itemEntry(kind: 'item' | 'step', item: Item | Subtask, path: string[], at: Partial<SearchEntry>, prefs: BudgetPrefs | undefined): SearchEntry {
  return entry({
    kind,
    title: item.title,
    path,
    ...at,
    itemId: item.id,
    itemType: item.type,
    status: item.status,
    body: join(item.notes, item.link),
    blocking: isBlocking(item as Item) || undefined,
    overBudget: over(itemCost(item), prefs) || undefined,
  });
}

/** Whether any filter is set (archived alone only widens, so it doesn't count). */
export function hasFilters(f: SearchFilters): boolean {
  return !!(f.types?.length || f.statuses?.length || f.blocking || f.overdue || f.overBudget);
}

/** Whether an entry gets past the filters. Type and status filters only let items, steps and ideas through. */
export function matchesFilters(e: SearchEntry, f: SearchFilters): boolean {
  if (e.archived && !f.archived) return false;
  if (f.types?.length && !(e.itemType && f.types.includes(e.itemType))) return false;
  if (f.statuses?.length && !(e.status && f.statuses.includes(e.status))) return false;
  if (f.blocking && !e.blocking) return false;
  if (f.overdue && !e.overdue) return false;
  if (f.overBudget && !e.overBudget) return false;
  return true;
}

/** Things you're more likely after come first when scores tie. */
const KIND_BONUS: Record<SearchKind, number> = { item: 2, step: 1, level: 2, world: 1, project: 1, inbox: 1 };

/**
 * How well an entry matches the query, or 0 if it doesn't. Every word must
 * appear somewhere; a word in the title counts most, at the start of a title
 * word more again, and the whole query at the start of the title most of all.
 */
export function scoreEntry(e: SearchEntry, query: string): number {
  const words = tokens(query);
  if (!words.length) return 0;
  let score = 0;
  for (const w of words) {
    const { title, path, body } = e.keys;
    const i = title.indexOf(w);
    if (i >= 0) score += i === 0 || /[^a-z0-9]/.test(title[i - 1]) ? 10 : 6;
    else if (path.includes(w)) score += 2;
    else if (body.includes(w)) score += 1;
    else return 0;
  }
  if (e.keys.title.startsWith(words.join(' '))) score += 10;
  score += KIND_BONUS[e.kind];
  // Finished games are history: still findable, behind what's in play.
  return e.finished ? score / 2 : score;
}

/**
 * Search the index: entries matching every word of the query and the
 * filters, best first. With no query, every entry the filters let through, in
 * index order; with neither, nothing.
 */
export function search(index: SearchEntry[], query: string, filters: SearchFilters = {}, limit = 50): SearchHit[] {
  const q = query.trim();
  if (!q && !hasFilters(filters)) return [];
  const hits: SearchHit[] = [];
  for (const e of index) {
    if (!matchesFilters(e, filters)) continue;
    const score = q ? scoreEntry(e, q) : 1;
    if (score > 0) hits.push({ entry: e, score });
  }
  // Array.sort is stable: ties keep index order (in-play games first, then by position).
  if (q) hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/**
 * A short piece of `text` around the first query word it contains, for a
 * result that matched in its notes rather than its title. Undefined if none.
 */
export function snippet(text: string, query: string, width = 60): string | undefined {
  const folded = fold(text);
  // fold() can change lengths for some characters; only trust positions when it didn't.
  if (folded.length !== text.length) return undefined;
  for (const w of tokens(query)) {
    const i = folded.indexOf(w);
    if (i < 0) continue;
    const start = Math.max(0, i - Math.floor((width - w.length) / 2));
    const end = Math.min(text.length, start + width);
    const piece = text.slice(start, end).replace(/\s+/g, ' ').trim();
    return `${start > 0 ? '…' : ''}${piece}${end < text.length ? '…' : ''}`;
  }
  return undefined;
}

/** The items (or steps) in a level's list that get past the filters: the panel's filter chips. */
export function filterItems<T extends Item | Subtask>(items: T[], filters: SearchFilters, prefs?: BudgetPrefs): T[] {
  if (!hasFilters(filters)) return items;
  return items.filter((item) => matchesFilters(itemEntry('item', item, [], {}, prefs), filters));
}
