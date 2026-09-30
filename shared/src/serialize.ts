import type { GameState, Overworld, World } from './model';

export const GAME_PATH = 'data/game.json';
export const worldPath = (id: string) => `data/worlds/${id}.json`;
export const WORLD_PATH_RE = /^data\/worlds\/([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/;

const GAME_SCHEMA_REF = '../schema/quest.schema.json';
const WORLD_SCHEMA_REF = '../../schema/quest.schema.json';

// Keys first in this order, remaining keys alphabetical — keeps diffs readable.
const KEY_ORDER = [
  '$schema',
  'id',
  'title',
  'name',
  'type',
  'status',
  'mvp',
  'text',
  'done',
  'deliverable',
  'description',
  'theme',
  'goalIds',
  'unlocksAfter',
  'timeboxDays',
  'startedAt',
  'clearedAt',
  'dependsOn',
  'levelRef',
  'link',
  'notes',
  'goals',
  'worldOrder',
  'successCriteria',
  'items',
  'levels',
  'stats',
];
const rank = new Map(KEY_ORDER.map((k, i) => [k, i]));

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    entries.sort(([a], [b]) => {
      const ra = rank.get(a) ?? Infinity;
      const rb = rank.get(b) ?? Infinity;
      return ra !== rb ? ra - rb : a < b ? -1 : a > b ? 1 : 0;
    });
    return Object.fromEntries(entries.map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

export function stringify(value: unknown): string {
  return JSON.stringify(canonical(value), null, 2) + '\n';
}

/** Map of repo path → file content for the whole state. */
export function toFiles(state: GameState): Record<string, string> {
  const files: Record<string, string> = {
    [GAME_PATH]: stringify({ ...state.overworld, $schema: GAME_SCHEMA_REF }),
  };
  for (const world of Object.values(state.worlds)) {
    files[worldPath(world.id)] = stringify({ ...world, $schema: WORLD_SCHEMA_REF });
  }
  return files;
}

/** Files to write (string) or delete (null) to go from `prev` to `next`. */
export function changedFiles(prev: GameState, next: GameState): Record<string, string | null> {
  const a = toFiles(prev);
  const b = toFiles(next);
  const out: Record<string, string | null> = {};
  for (const [path, content] of Object.entries(b)) if (a[path] !== content) out[path] = content;
  for (const path of Object.keys(a)) if (!(path in b)) out[path] = null;
  return out;
}

export function fromFiles(files: Record<string, string>): GameState {
  const game = files[GAME_PATH];
  if (!game) throw new Error(`Missing ${GAME_PATH}`);
  const overworld = JSON.parse(game) as Overworld;
  const worlds: Record<string, World> = {};
  for (const [path, content] of Object.entries(files)) {
    const m = WORLD_PATH_RE.exec(path);
    if (!m) continue;
    const world = JSON.parse(content) as World;
    worlds[m[1]] = world;
  }
  return normalizeState({ overworld, worlds });
}

/** Strips `$schema` pointers so in-memory state compares cleanly. */
export function normalizeState(state: GameState): GameState {
  const { $schema: _o, ...overworld } = state.overworld;
  const worlds: Record<string, World> = {};
  for (const [id, w] of Object.entries(state.worlds)) {
    const { $schema: _w, ...rest } = w;
    worlds[id] = rest as World;
  }
  return { overworld: overworld as Overworld, worlds };
}
