import type { GameState, Level, Project, Settings, World, WorldFile, Workspace } from './model';

export const DATA_ROOT = 'data';
/** Published schema location; data files point here so they validate anywhere. */
export const SCHEMA_BASE = 'https://tasks.patrick-mckinley.com/schema/';

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
const PROJECT_RE = new RegExp(`^${DATA_ROOT}/(${SLUG})/project\\.json$`);
const WORLD_RE = new RegExp(`^${DATA_ROOT}/(${SLUG})/(${SLUG})/world\\.json$`);
const LEVEL_RE = new RegExp(`^${DATA_ROOT}/(${SLUG})/(${SLUG})/(${SLUG})\\.json$`);

export const projectPath = (p: string) => `${DATA_ROOT}/${p}/project.json`;
export const worldPath = (p: string, w: string) => `${DATA_ROOT}/${p}/${w}/world.json`;
export const levelPath = (p: string, w: string, l: string) => `${DATA_ROOT}/${p}/${w}/${l}.json`;
/** Optional repo-wide settings (default hero...). */
export const SETTINGS_PATH = `${DATA_ROOT}/settings.json`;

export type DataFile =
  | { kind: 'project'; projectId: string }
  | { kind: 'world'; projectId: string; worldId: string }
  | { kind: 'level'; projectId: string; worldId: string; levelId: string }
  | { kind: 'settings' };

/** What a repo path holds, or undefined if it isn't a Quest Log data file. */
export function classifyPath(path: string): DataFile | undefined {
  if (path === SETTINGS_PATH) return { kind: 'settings' };
  let m = PROJECT_RE.exec(path);
  if (m) return { kind: 'project', projectId: m[1] };
  m = WORLD_RE.exec(path);
  if (m) return { kind: 'world', projectId: m[1], worldId: m[2] };
  m = LEVEL_RE.exec(path);
  if (m) return { kind: 'level', projectId: m[1], worldId: m[2], levelId: m[3] };
}

export const isDataPath = (path: string) => classifyPath(path) !== undefined;

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
  'subtasks',
  'goals',
  'worldOrder',
  'levelOrder',
  'successCriteria',
  'items',
  'stats',
];
const rank = new Map(KEY_ORDER.map((k, i) => [k, i]));

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
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

const schemaRef = (kind: 'project' | 'world' | 'level' | 'settings') => `${SCHEMA_BASE}${kind}.schema.json`;

/** Files for one project. */
export function projectFiles(projectId: string, state: GameState): Record<string, string> {
  const files: Record<string, string> = {
    [projectPath(projectId)]: stringify({ ...state.overworld, $schema: schemaRef('project') }),
  };
  for (const world of Object.values(state.worlds)) {
    const { levels, ...rest } = world;
    const file: WorldFile = { ...rest, $schema: schemaRef('world'), levelOrder: levels.map((l) => l.id) };
    files[worldPath(projectId, world.id)] = stringify(file);
    for (const level of levels)
      files[levelPath(projectId, world.id, level.id)] = stringify({ ...level, $schema: schemaRef('level') });
  }
  return files;
}

/** Map of repo path → file content for the whole workspace. */
export function toFiles(ws: Workspace): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [id, state] of Object.entries(ws.projects)) Object.assign(files, projectFiles(id, state));
  if (ws.settings && Object.keys(ws.settings).length)
    files[SETTINGS_PATH] = stringify({ ...ws.settings, $schema: schemaRef('settings') });
  return files;
}

/** Files to write (string) or delete (null) to go from `prev` to `next`. */
export function changedFiles(prev: Workspace, next: Workspace): Record<string, string | null> {
  const a = toFiles(prev);
  const b = toFiles(next);
  const out: Record<string, string | null> = {};
  for (const [path, content] of Object.entries(b)) if (a[path] !== content) out[path] = content;
  for (const path of Object.keys(a)) if (!(path in b)) out[path] = null;
  return out;
}

function strip<T extends { $schema?: string }>(o: T): Omit<T, '$schema'> {
  const { $schema: _, ...rest } = o;
  return rest;
}

/**
 * Builds the in-memory workspace. Lenient: files that can't be placed (a world
 * without project.json, unparseable JSON) are skipped; validateFiles reports them.
 */
export function fromFiles(files: Record<string, string>): Workspace {
  const parse = <T>(path: string): T | undefined => {
    try {
      return JSON.parse(files[path]) as T;
    } catch {
      return undefined;
    }
  };
  const projects: Record<string, GameState> = {};
  let settings: Workspace['settings'];
  const worldFiles: Record<string, Record<string, WorldFile>> = {};
  const levels: Record<string, Record<string, Record<string, Level>>> = {};
  for (const path of Object.keys(files)) {
    const f = classifyPath(path);
    if (!f) continue;
    if (f.kind === 'settings') {
      const s = parse<Settings>(path);
      if (s && typeof s === 'object') settings = strip(s);
    } else if (f.kind === 'project') {
      const p = parse<Project>(path);
      if (p) projects[f.projectId] = { overworld: strip(p) as Project, worlds: {} };
    } else if (f.kind === 'world') {
      const w = parse<WorldFile>(path);
      if (w) (worldFiles[f.projectId] ??= {})[f.worldId] = w;
    } else if (f.levelId !== 'world') {
      const l = parse<Level>(path);
      if (l) ((levels[f.projectId] ??= {})[f.worldId] ??= {})[f.levelId] = strip(l) as Level;
    }
  }
  for (const [pid, state] of Object.entries(projects)) {
    for (const [wid, wf] of Object.entries(worldFiles[pid] ?? {})) {
      const { levelOrder, $schema: _, ...rest } = wf;
      const pool = { ...levels[pid]?.[wid] };
      const ordered: Level[] = [];
      for (const lid of Array.isArray(levelOrder) ? levelOrder : []) {
        if (pool[lid]) ordered.push(pool[lid]);
        delete pool[lid];
      }
      ordered.push(...Object.keys(pool).sort().map((k) => pool[k]));
      state.worlds[wid] = { ...(rest as Omit<World, 'levels'>), levels: ordered };
    }
  }
  return settings ? { projects, settings } : { projects };
}
