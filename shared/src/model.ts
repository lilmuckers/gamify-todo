import type { Project, World as WorldFile, Level, Item, Criterion, Goal, Subtask, Settings, InboxItem } from './types.gen';

export type { Project, WorldFile, Level, Item, Criterion, Goal, Subtask, Settings, InboxItem };
export type HeroId = NonNullable<Settings['hero']>;
/** The project file is what the overworld map shows. */
export type Overworld = Project;
/** In memory, a world carries its level files, in levelOrder. */
export type World = Omit<WorldFile, 'levelOrder' | '$schema'> & { levels: Level[] };
export type ItemType = Item['type'];
export type ItemStatus = Item['status'];
export type Theme = World['theme'];
export type LevelStats = NonNullable<Level['stats']>;

/** One project in memory: project.json plus its worlds (with levels), keyed by world id. */
export interface GameState {
  overworld: Project;
  worlds: Record<string, World>;
}

/** Every project in the data folder, keyed by project id. Projects are independent. */
export interface Workspace {
  projects: Record<string, GameState>;
  /** data/settings.json, when the repo has one. */
  settings?: Omit<Settings, '$schema'>;
  /** data/inbox.json: captured ideas not yet placed in a level. */
  inbox?: InboxItem[];
}

export const HERO_IDS: HeroId[] = [
  'classic', 'bearded', 'redhead', 'mustard-jumper', 'denim-jacket', 'hoodie',
  'emo', 'goth', 'punk', 'rainbow-tee', 'trans-flag-hair', 'trans-pin',
  'bi-bomber', 'drag-glam', 'nb-beanie', 'hijab-skater', 'silver-locs', 'flannel',
];

/** Every level cleared (every MVP criterion done): a finished game. */
export function isProjectFinished(state: GameState): boolean {
  const levels = Object.values(state.worlds).flatMap((w) => w.levels);
  return levels.length > 0 && levels.every((l) => l.successCriteria.some((c) => c.mvp) && l.successCriteria.every((c) => !c.mvp || c.done));
}

/** Projects by title, with finished games after the ones still being played. */
export function orderedProjects(ws: Workspace): GameState[] {
  return Object.values(ws.projects).sort(
    (a, b) => Number(isProjectFinished(a)) - Number(isProjectFinished(b)) || a.overworld.title.localeCompare(b.overworld.title),
  );
}

export const ITEM_TYPES: ItemType[] = [
  'task',
  'deliverable',
  'blocker',
  'dependency',
  'risk',
  'decision',
  'stretch',
];
export const STATUSES: ItemStatus[] = ['todo', 'doing', 'done', 'dropped'];
export const THEMES: Theme[] = ['grass', 'desert', 'water', 'ice', 'sky', 'castle'];

export const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'item';
}

/** Returns a slug from `text` that is not in `taken`. */
export function uniqueId(text: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const base = slugify(text);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!set.has(candidate)) return candidate;
  }
}

export function isResolved(item: Item): boolean {
  return item.status === 'done' || item.status === 'dropped';
}

export function isMvpItem(item: Item): boolean {
  return item.type !== 'stretch' && item.mvp !== false;
}

export function orderedWorlds(state: GameState): World[] {
  const seen = new Set<string>();
  const out: World[] = [];
  for (const id of state.overworld.worldOrder) {
    const w = state.worlds[id];
    if (w && !seen.has(id)) {
      out.push(w);
      seen.add(id);
    }
  }
  // Worlds missing from worldOrder still show, at the end, by id (as fromFiles orders them).
  for (const id of Object.keys(state.worlds).sort()) if (!seen.has(id)) out.push(state.worlds[id]);
  return out;
}

export function findLevel(state: GameState, worldId: string, levelId: string): Level | undefined {
  return state.worlds[worldId]?.levels.find((l) => l.id === levelId);
}

/** Where a level lives in a workspace. */
export interface LevelAt {
  projectId: string;
  worldId: string;
  levelId: string;
}

/** A level anywhere in the workspace, by project, world and level id. */
export function findLevelAt(ws: Workspace, at: LevelAt): Level | undefined {
  const state = ws.projects[at.projectId];
  return state && findLevel(state, at.worldId, at.levelId);
}

export function parseLevelRef(ref: string): { worldId: string; levelId: string } | undefined {
  const [worldId, levelId] = ref.split('/');
  return worldId && levelId ? { worldId, levelId } : undefined;
}

/** The level a dependency's levelRef points at in this project, if it still exists. */
export function levelRefTarget(state: GameState, item: Pick<Item, 'levelRef'>): { worldId: string; levelId: string; world: World; level: Level } | undefined {
  const ref = item.levelRef ? parseLevelRef(item.levelRef) : undefined;
  const level = ref && findLevel(state, ref.worldId, ref.levelId);
  return ref && level ? { ...ref, world: state.worlds[ref.worldId], level } : undefined;
}

/**
 * How a dependency shows up in a level:
 * - `cloud`: it points at another level (levelRef); the hero can ride over to it.
 * - `warp`: it has subtasks; a warp pipe leads down into a sub-level of them.
 * - `plain`: just something to wait for (a pipe with a plant).
 */
export type DependencyMode = 'cloud' | 'warp' | 'plain';

export function dependencyMode(item: Item): DependencyMode | undefined {
  if (item.type !== 'dependency') return undefined;
  if (item.levelRef) return 'cloud';
  if (item.subtasks?.length) return 'warp';
  return 'plain';
}

/** Id of the single criterion of a sub-level: every must-do subtask is out of the way. */
export const SUB_CRITERION_ID = 'all-steps-clear';

/**
 * A dependency's subtasks as a level of their own, so the level view can show
 * them. Keeps the parent level's id: ops address the parent level plus the
 * dependency (`parentId`).
 */
export function subLevel(parent: Level, dep: Item): Level {
  const items = (dep.subtasks ?? []) as Item[];
  // No must-do steps yet means nothing has been cleared, not that everything has.
  const must = items.filter(isMvpItem);
  const done = must.length > 0 && must.every(isResolved);
  return {
    id: parent.id,
    name: dep.title,
    deliverable: `Everything needed for "${dep.title}"`,
    ...(dep.notes ? { description: dep.notes } : {}),
    timeboxDays: parent.timeboxDays,
    ...(parent.startedAt ? { startedAt: parent.startedAt } : {}),
    successCriteria: [{ id: SUB_CRITERION_ID, text: 'Every must-do step done or dropped', mvp: true, done }],
    items,
  };
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * `url` if it is safe to use as an href, else undefined. Data can come from
 * anyone who opens a pull request, and the schema's "uri" format allows
 * `javascript:` and `data:` URLs, which would run in the app next to the token.
 */
export function safeLink(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    return LINK_PROTOCOLS.has(new URL(url).protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}
