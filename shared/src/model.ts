import type { Overworld, World, Level, Item, Criterion, Goal } from './types.gen';

export type { Overworld, World, Level, Item, Criterion, Goal };
export type ItemType = Item['type'];
export type ItemStatus = Item['status'];
export type Theme = World['theme'];
export type LevelStats = NonNullable<Level['stats']>;

/** Whole project in memory: game.json plus every world file, keyed by world id. */
export interface GameState {
  overworld: Overworld;
  worlds: Record<string, World>;
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
  // Worlds missing from worldOrder still show, at the end.
  for (const w of Object.values(state.worlds)) if (!seen.has(w.id)) out.push(w);
  return out;
}

export function findLevel(state: GameState, worldId: string, levelId: string): Level | undefined {
  return state.worlds[worldId]?.levels.find((l) => l.id === levelId);
}

export function parseLevelRef(ref: string): { worldId: string; levelId: string } | undefined {
  const [worldId, levelId] = ref.split('/');
  return worldId && levelId ? { worldId, levelId } : undefined;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
