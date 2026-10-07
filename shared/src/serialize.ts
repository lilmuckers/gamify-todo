import type { GameState, InboxItem, Level, Project, Settings, World, WorldFile, Workspace } from './model';

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
/** Optional repo-wide inbox of captured ideas. */
export const INBOX_PATH = `${DATA_ROOT}/inbox.json`;

export type DataFile =
  | { kind: 'project'; projectId: string }
  | { kind: 'world'; projectId: string; worldId: string }
  | { kind: 'level'; projectId: string; worldId: string; levelId: string }
  | { kind: 'settings' }
  | { kind: 'inbox' };

/** What a repo path holds, or undefined if it isn't a Quest Log data file. */
export function classifyPath(path: string): DataFile | undefined {
  if (path === SETTINGS_PATH) return { kind: 'settings' };
  if (path === INBOX_PATH) return { kind: 'inbox' };
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
  'doneAt',
  'mvp',
  'text',
  'done',
  'deliverable',
  'description',
  'archivedAt',
  'theme',
  'goalIds',
  'unlocksAfter',
  'timeboxDays',
  'startedAt',
  'clearedAt',
  'pausedDays',
  'someday',
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
    // A criterion reads id, mvp, text, done, then when it was ticked.
    const criterion = 'text' in value && 'done' in value;
    const order = (k: string) => (criterion && k === 'doneAt' ? rank.get('done')! + 0.5 : (rank.get(k) ?? Infinity));
    entries.sort(([a], [b]) => {
      const ra = order(a);
      const rb = order(b);
      return ra !== rb ? ra - rb : a < b ? -1 : a > b ? 1 : 0;
    });
    return Object.fromEntries(entries.map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

export function stringify(value: unknown): string {
  return JSON.stringify(canonical(value), null, 2) + '\n';
}

const schemaRef = (kind: 'project' | 'world' | 'level' | 'settings' | 'inbox') => `${SCHEMA_BASE}${kind}.schema.json`;

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
  if (ws.inbox?.length) files[INBOX_PATH] = stringify({ $schema: schemaRef('inbox'), items: ws.inbox });
  return files;
}

/**
 * Files to write (string) or delete (null) to go from `prev` to `next`.
 * Projects that are the same object in both are skipped without
 * serializing them (ops copy only what they change).
 */
export function changedFiles(prev: Workspace, next: Workspace): Record<string, string | null> {
  const unchanged = (pid: string) => prev.projects[pid] === next.projects[pid];
  const a = toFiles({ ...prev, projects: Object.fromEntries(Object.entries(prev.projects).filter(([pid]) => !unchanged(pid))) });
  const b = toFiles({ ...next, projects: Object.fromEntries(Object.entries(next.projects).filter(([pid]) => !unchanged(pid))) });
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
 * An empty lookup table with no prototype. Ids like "constructor" and "prototype"
 * are valid slugs, so on a plain `{}` they would find Object's built-ins and let a
 * crafted path such as data/constructor/prototype/x.json write to Object.prototype.
 */
const table = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

/**
 * Builds the in-memory workspace. Lenient: files that can't be placed (a world
 * without project.json, unparseable JSON) are skipped; validateFiles reports them.
 * Worlds and levels missing from worldOrder/levelOrder go after the listed ones,
 * by id, and are written into the list on the next save.
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
  let inbox: InboxItem[] | undefined;
  const worldFiles = table<Record<string, WorldFile>>();
  const levels = table<Record<string, Record<string, Level>>>();
  for (const path of Object.keys(files)) {
    const f = classifyPath(path);
    if (!f) continue;
    if (f.kind === 'inbox') {
      const b = parse<{ items?: InboxItem[] }>(path);
      if (b && Array.isArray(b.items) && b.items.length) inbox = b.items;
    } else if (f.kind === 'settings') {
      const s = parse<Settings>(path);
      if (s && typeof s === 'object') settings = strip(s);
    } else if (f.kind === 'project') {
      const p = parse<Project>(path);
      if (p) projects[f.projectId] = { overworld: strip(p) as Project, worlds: {} };
    } else if (f.kind === 'world') {
      const w = parse<WorldFile>(path);
      if (w) (worldFiles[f.projectId] ??= table())[f.worldId] = w;
    } else if (f.levelId !== 'world') {
      const l = parse<Level>(path);
      if (l) ((levels[f.projectId] ??= table())[f.worldId] ??= table())[f.levelId] = strip(l) as Level;
    }
  }
  for (const [pid, state] of Object.entries(projects)) {
    for (const [wid, wf] of Object.entries(worldFiles[pid] ?? {})) {
      const { levelOrder, $schema: _, ...rest } = wf;
      const pool = Object.assign(table<Level>(), levels[pid]?.[wid]);
      const ordered: Level[] = [];
      for (const lid of Array.isArray(levelOrder) ? levelOrder : []) {
        if (typeof lid === 'string' && pool[lid]) ordered.push(pool[lid]);
        delete pool[lid];
      }
      ordered.push(...Object.keys(pool).sort().map((k) => pool[k]));
      state.worlds[wid] = { ...(rest as Omit<World, 'levels'>), levels: ordered };
    }
    const listed = Array.isArray(state.overworld.worldOrder) ? state.overworld.worldOrder : [];
    const unlisted = Object.keys(state.worlds).filter((w) => !listed.includes(w)).sort();
    if (unlisted.length) state.overworld = { ...state.overworld, worldOrder: [...listed, ...unlisted] };
  }
  return { projects, ...(settings ? { settings } : {}), ...(inbox ? { inbox } : {}) };
}
