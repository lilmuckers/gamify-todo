import type { GameState, Level, World, Workspace } from './model';
import { stringify } from './serialize';

export type Change = 'added' | 'removed' | 'modified';

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface EntryDiff {
  id: string;
  change: Change;
  fields: FieldChange[];
}

export interface LevelDiff {
  projectId: string;
  worldId: string;
  levelId: string;
  change: Change;
  fields: FieldChange[];
  items: Record<string, EntryDiff>;
  criteria: Record<string, EntryDiff>;
}

export interface StateDiff {
  overworld: FieldChange[];
  goals: Record<string, EntryDiff>;
  worlds: Record<string, EntryDiff>;
  levels: LevelDiff[];
  /** Total number of changed entities, for badges. */
  count: number;
}

const same = (a: unknown, b: unknown) => stringify(a) === stringify(b);

function fieldChanges(a: object, b: object, skip: string[] = []): FieldChange[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: FieldChange[] = [];
  for (const k of keys) {
    if (skip.includes(k) || k === '$schema') continue;
    const before = (a as any)[k];
    const after = (b as any)[k];
    if (!same(before, after)) out.push({ field: k, before, after });
  }
  return out;
}

function diffList<T extends { id: string }>(
  a: T[],
  b: T[],
  skip: string[] = [],
): Record<string, EntryDiff> {
  const out: Record<string, EntryDiff> = {};
  const before = new Map(a.map((x) => [x.id, x]));
  const after = new Map(b.map((x) => [x.id, x]));
  for (const [id, x] of after) {
    const prev = before.get(id);
    if (!prev) out[id] = { id, change: 'added', fields: fieldChanges({}, x, skip) };
    else {
      const fields = fieldChanges(prev, x, skip);
      if (fields.length) out[id] = { id, change: 'modified', fields };
    }
  }
  for (const [id, x] of before)
    if (!after.has(id)) out[id] = { id, change: 'removed', fields: fieldChanges(x, {}, skip) };
  return out;
}

function diffLevel(projectId: string, worldId: string, a: Level | undefined, b: Level | undefined): LevelDiff | undefined {
  const base = a ?? ({ items: [], successCriteria: [] } as unknown as Level);
  const head = b ?? ({ items: [], successCriteria: [] } as unknown as Level);
  const skip = ['items', 'successCriteria', 'stats'];
  const fields = fieldChanges(a ?? {}, b ?? {}, skip);
  const items = diffList(base.items, head.items);
  const criteria = diffList(base.successCriteria, head.successCriteria);
  const change: Change | undefined = !a
    ? 'added'
    : !b
      ? 'removed'
      : fields.length || Object.keys(items).length || Object.keys(criteria).length
        ? 'modified'
        : undefined;
  if (!change) return;
  return { projectId, worldId, levelId: (b ?? a)!.id, change, fields, items, criteria };
}

export function diffStates(base: GameState, head: GameState, projectId = ''): StateDiff {
  const overworld = fieldChanges(base.overworld, head.overworld, ['goals']);
  const goals = diffList(base.overworld.goals, head.overworld.goals);
  const worlds: Record<string, EntryDiff> = {};
  const levels: LevelDiff[] = [];
  const ids = new Set([...Object.keys(base.worlds), ...Object.keys(head.worlds)]);
  for (const id of ids) {
    const a: World | undefined = base.worlds[id];
    const b: World | undefined = head.worlds[id];
    const fields = fieldChanges(a ?? {}, b ?? {}, ['levels']);
    const levelIds = new Set([...(a?.levels ?? []), ...(b?.levels ?? [])].map((l) => l.id));
    const worldLevels: LevelDiff[] = [];
    for (const lid of levelIds) {
      const d = diffLevel(
        projectId,
        id,
        a?.levels.find((l) => l.id === lid),
        b?.levels.find((l) => l.id === lid),
      );
      if (d) worldLevels.push(d);
    }
    levels.push(...worldLevels);
    const change: Change | undefined = !a
      ? 'added'
      : !b
        ? 'removed'
        : fields.length || worldLevels.length
          ? 'modified'
          : undefined;
    if (change) worlds[id] = { id, change, fields };
  }
  const count =
    overworld.length +
    Object.keys(goals).length +
    levels.reduce(
      (n, l) => n + 1 + Object.keys(l.items).length + Object.keys(l.criteria).length,
      0,
    );
  return { overworld, goals, worlds, levels, count };
}

export interface WorkspaceDiff {
  /** Per-project diffs, only for projects that changed. */
  projects: Record<string, { change: Change; diff: StateDiff }>;
  /** Every changed level across projects. */
  levels: LevelDiff[];
  count: number;
}

const EMPTY: GameState = { overworld: { id: '', title: '', goals: [], worldOrder: [] }, worlds: {} };

export function diffWorkspaces(base: Workspace, head: Workspace): WorkspaceDiff {
  const out: WorkspaceDiff = { projects: {}, levels: [], count: 0 };
  const ids = new Set([...Object.keys(base.projects), ...Object.keys(head.projects)]);
  for (const id of ids) {
    const a = base.projects[id];
    const b = head.projects[id];
    const diff = diffStates(a ?? EMPTY, b ?? EMPTY, id);
    if (a && b && !diff.count) continue;
    out.projects[id] = { change: !a ? 'added' : !b ? 'removed' : 'modified', diff };
    out.levels.push(...diff.levels);
    out.count += Math.max(1, diff.count);
  }
  return out;
}

/**
 * Head level plus base-only items/criteria appended, so removed entries can be
 * drawn as ghosts in the review view.
 */
export function reviewLevel(base: Level | undefined, head: Level | undefined): Level {
  const shown = structuredClone(head ?? base!);
  if (base && head) {
    const itemIds = new Set(head.items.map((i) => i.id));
    for (const i of base.items)
      if (!itemIds.has(i.id)) shown.items.push({ ...structuredClone(i), status: 'dropped' });
    const critIds = new Set(head.successCriteria.map((c) => c.id));
    for (const c of base.successCriteria)
      if (!critIds.has(c.id)) shown.successCriteria.push(structuredClone(c));
  }
  return shown;
}
