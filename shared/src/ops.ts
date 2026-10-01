import type { Criterion, GameState, Goal, Item, ItemStatus, Level, Project, Settings, World, Workspace } from './model';
import { clone } from './model';
import { isCleared } from './scoring';

interface LevelAddr {
  worldId: string;
  levelId: string;
}

/** Item ops can target a dependency's subtasks instead of the level's items. */
interface ItemAddr extends LevelAddr {
  /** Id of the dependency item whose subtasks are targeted. */
  parentId?: string;
}

type ItemPatch = Partial<Omit<Item, 'id'>>;
type CriterionPatch = Partial<Omit<Criterion, 'id'>>;
type LevelPatch = Partial<Pick<Level, 'name' | 'deliverable' | 'description' | 'timeboxDays'>>;
type WorldPatch = Partial<Pick<World, 'name' | 'description' | 'theme' | 'goalIds' | 'unlocksAfter'>>;
type ProjectPatch = Partial<Pick<Project, 'title' | 'description' | 'worldOrder'>>;

/** Ops that act inside one project. */
type ProjectOpBody =
  | ({ kind: 'setItemStatus'; itemId: string; status: ItemStatus } & ItemAddr)
  | ({ kind: 'addItem'; item: Item } & ItemAddr)
  | ({ kind: 'updateItem'; itemId: string; patch: ItemPatch } & ItemAddr)
  | ({ kind: 'deleteItem'; itemId: string } & ItemAddr)
  | ({ kind: 'setCriterion'; criterionId: string; done: boolean } & LevelAddr)
  | ({ kind: 'addCriterion'; criterion: Criterion } & LevelAddr)
  | ({ kind: 'updateCriterion'; criterionId: string; patch: CriterionPatch } & LevelAddr)
  | ({ kind: 'deleteCriterion'; criterionId: string } & LevelAddr)
  | ({ kind: 'startLevel' } & LevelAddr)
  | ({ kind: 'updateLevel'; patch: LevelPatch } & LevelAddr)
  | ({ kind: 'deleteLevel' } & LevelAddr)
  | ({ kind: 'moveLevel'; index: number } & LevelAddr)
  | { kind: 'addLevel'; worldId: string; level: Level }
  | { kind: 'addWorld'; world: World }
  | { kind: 'updateWorld'; worldId: string; patch: WorldPatch }
  | { kind: 'deleteWorld'; worldId: string }
  | { kind: 'updateProject'; patch: ProjectPatch }
  | { kind: 'addGoal'; goal: Goal }
  | { kind: 'updateGoal'; goalId: string; patch: Partial<Omit<Goal, 'id'>> }
  | { kind: 'deleteGoal'; goalId: string };

export type OpBody =
  | (ProjectOpBody & { projectId: string })
  | { kind: 'addProject'; projectId: string; project: Project }
  | { kind: 'deleteProject'; projectId: string }
  /** Repo-wide settings (data/settings.json). Undefined values remove keys. */
  | { kind: 'updateSettings'; patch: Partial<Omit<Settings, '$schema'>> };

type ProjectOp = ProjectOpBody & { projectId: string; opId: string; at: string };

export type Op = OpBody & { opId: string; at: string };

/** Raised when an op no longer applies (target deleted, id taken). */
export class OpConflict extends Error {
  constructor(
    message: string,
    public op: Op,
  ) {
    super(message);
    this.name = 'OpConflict';
  }
}

let counter = 0;
export function makeOp(body: OpBody, now = new Date()): Op {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${(counter++).toString(36)}`;
  return { ...body, opId: rand, at: now.toISOString() } as Op;
}

// Scope cuts are always welcome, even after clearing.
const isScopeCut = (op: Op) =>
  op.kind === 'deleteItem' ||
  op.kind === 'deleteCriterion' ||
  (op.kind === 'setItemStatus' && op.status === 'dropped');

function need<T>(value: T | undefined, what: string, op: Op): T {
  if (value === undefined) throw new OpConflict(`${what} no longer exists`, op);
  return value;
}

function applyLevelOp(level: Level, op: ProjectOp & LevelAddr) {
  const parentId = 'parentId' in op ? op.parentId : undefined;
  const parent = parentId
    ? need(level.items.find((i) => i.id === parentId && i.type === 'dependency'), `dependency "${parentId}"`, op)
    : undefined;
  // The list item ops act on: the level's items, or a dependency's subtasks.
  const list = (): Item[] => (parent ? ((parent.subtasks ??= []) as Item[]) : level.items);
  const setList = (items: Item[]) => {
    if (!parent) level.items = items;
    else if (items.length) parent.subtasks = items as NonNullable<Item['subtasks']>;
    else delete parent.subtasks;
  };
  const findItem = (id: string) =>
    need(list().find((i) => i.id === id), `${parent ? 'step' : 'item'} "${id}"`, op);
  // Subtask edit counts are keyed parent/sub so they can't clash with item ids.
  const statKey = (id: string) => (parent ? `${parent.id}/${id}` : id);
  const findCriterion = (id: string) =>
    need(level.successCriteria.find((c) => c.id === id), `criterion "${id}"`, op);

  const wasCleared = isCleared(level);
  const bump = (key: 'editsAfterClear' | 'itemsAddedAfterClear') => {
    level.stats = { ...level.stats, [key]: (level.stats?.[key] ?? 0) + 1 };
  };
  const bumpItem = (id: string) => {
    const itemEdits = { ...level.stats?.itemEdits, [id]: (level.stats?.itemEdits?.[id] ?? 0) + 1 };
    level.stats = { ...level.stats, itemEdits };
  };

  if (wasCleared && op.kind !== 'startLevel' && !isScopeCut(op))
    bump(op.kind === 'addItem' ? 'itemsAddedAfterClear' : 'editsAfterClear');

  switch (op.kind) {
    case 'setItemStatus': {
      const item = findItem(op.itemId);
      if (!wasCleared && item.status === 'done' && op.status !== 'dropped') bumpItem(statKey(item.id));
      item.status = op.status;
      break;
    }
    case 'addItem':
      if (parent && (op.item.type === 'dependency' || op.item.subtasks || op.item.levelRef))
        throw new OpConflict('steps inside a dependency cannot be dependencies themselves', op);
      if (list().some((i) => i.id === op.item.id))
        throw new OpConflict(`${parent ? 'step' : 'item'} id "${op.item.id}" already taken`, op);
      list().push(clone(op.item));
      break;
    case 'updateItem': {
      const item = findItem(op.itemId);
      if (!wasCleared && item.status === 'done' && op.patch.status !== 'dropped') bumpItem(statKey(item.id));
      Object.assign(item, clone(op.patch));
      for (const [k, v] of Object.entries(op.patch)) if (v === undefined) delete (item as any)[k];
      break;
    }
    case 'deleteItem': {
      findItem(op.itemId);
      const rest = list().filter((i) => i.id !== op.itemId);
      for (const i of rest)
        if (i.dependsOn?.includes(op.itemId)) {
          i.dependsOn = i.dependsOn.filter((d) => d !== op.itemId);
          if (!i.dependsOn.length) delete i.dependsOn;
        }
      setList(rest);
      if (level.stats?.itemEdits) delete level.stats.itemEdits[statKey(op.itemId)];
      // Deleting a dependency drops its subtasks' edit counts too.
      if (!parent && level.stats?.itemEdits)
        for (const k of Object.keys(level.stats.itemEdits)) if (k.startsWith(`${op.itemId}/`)) delete level.stats.itemEdits[k];
      break;
    }
    case 'setCriterion':
      findCriterion(op.criterionId).done = op.done;
      break;
    case 'addCriterion':
      if (level.successCriteria.some((c) => c.id === op.criterion.id))
        throw new OpConflict(`criterion id "${op.criterion.id}" already taken`, op);
      level.successCriteria.push(clone(op.criterion));
      break;
    case 'updateCriterion':
      Object.assign(findCriterion(op.criterionId), clone(op.patch));
      break;
    case 'deleteCriterion':
      findCriterion(op.criterionId);
      level.successCriteria = level.successCriteria.filter((c) => c.id !== op.criterionId);
      break;
    case 'startLevel':
      level.startedAt ??= op.at;
      break;
    case 'updateLevel':
      Object.assign(level, clone(op.patch));
      for (const [k, v] of Object.entries(op.patch)) if (v === undefined) delete (level as any)[k];
      break;
  }

  const busy = (i: Pick<Item, 'status'>) => i.status === 'doing' || i.status === 'done';
  const active =
    level.items.some((i) => busy(i) || (i.subtasks ?? []).some(busy)) ||
    level.successCriteria.some((c) => c.done);
  if (!level.startedAt && active) level.startedAt = op.at;
  const nowCleared = isCleared(level);
  if (nowCleared && !level.clearedAt) level.clearedAt = op.at;
  if (!nowCleared && level.clearedAt) delete level.clearedAt;
}

/** Applies one op to a copy of the workspace. Throws OpConflict if the target is gone. */
export function applyOp(ws: Workspace, op: Op): Workspace {
  if (op.kind === 'updateSettings') {
    const settings = { ...ws.settings, ...clone(op.patch) };
    for (const [k, v] of Object.entries(op.patch)) if (v === undefined) delete (settings as any)[k];
    const { settings: _, ...rest } = ws;
    return Object.keys(settings).length ? { ...rest, settings } : rest;
  }
  if (op.kind === 'addProject') {
    if (ws.projects[op.projectId]) throw new OpConflict(`project id "${op.projectId}" already taken`, op);
    return { ...ws, projects: { ...ws.projects, [op.projectId]: { overworld: clone(op.project), worlds: {} } } };
  }
  const state = need(ws.projects[op.projectId], `project "${op.projectId}"`, op);
  if (op.kind === 'deleteProject') {
    const { [op.projectId]: _, ...rest } = ws.projects;
    return { ...ws, projects: rest };
  }
  return { ...ws, projects: { ...ws.projects, [op.projectId]: applyProjectOp(state, op) } };
}

function applyProjectOp(state: GameState, op: ProjectOp): GameState {
  const next = clone(state);
  const world = (id: string) => need(next.worlds[id], `world "${id}"`, op);

  switch (op.kind) {
    case 'addWorld':
      if (next.worlds[op.world.id]) throw new OpConflict(`world id "${op.world.id}" already taken`, op);
      next.worlds[op.world.id] = clone(op.world);
      if (!next.overworld.worldOrder.includes(op.world.id)) next.overworld.worldOrder.push(op.world.id);
      return next;
    case 'updateWorld':
      Object.assign(world(op.worldId), clone(op.patch));
      return next;
    case 'deleteWorld': {
      world(op.worldId);
      delete next.worlds[op.worldId];
      next.overworld.worldOrder = next.overworld.worldOrder.filter((id) => id !== op.worldId);
      for (const w of Object.values(next.worlds)) {
        if (w.unlocksAfter?.includes(op.worldId))
          w.unlocksAfter = w.unlocksAfter.filter((id) => id !== op.worldId);
        for (const l of w.levels)
          for (const i of l.items) if (i.levelRef?.startsWith(`${op.worldId}/`)) delete i.levelRef;
      }
      return next;
    }
    case 'updateProject':
      Object.assign(next.overworld, clone(op.patch));
      return next;
    case 'addGoal':
      if (next.overworld.goals.some((g) => g.id === op.goal.id))
        throw new OpConflict(`goal id "${op.goal.id}" already taken`, op);
      next.overworld.goals.push(clone(op.goal));
      return next;
    case 'updateGoal':
      Object.assign(
        need(next.overworld.goals.find((g) => g.id === op.goalId), `goal "${op.goalId}"`, op),
        clone(op.patch),
      );
      return next;
    case 'deleteGoal':
      next.overworld.goals = next.overworld.goals.filter((g) => g.id !== op.goalId);
      for (const w of Object.values(next.worlds)) w.goalIds = w.goalIds.filter((g) => g !== op.goalId);
      return next;
    case 'addLevel': {
      const w = world(op.worldId);
      if (w.levels.some((l) => l.id === op.level.id))
        throw new OpConflict(`level id "${op.level.id}" already taken`, op);
      w.levels.push(clone(op.level));
      return next;
    }
    case 'deleteLevel': {
      const w = world(op.worldId);
      need(w.levels.find((l) => l.id === op.levelId), `level "${op.levelId}"`, op);
      w.levels = w.levels.filter((l) => l.id !== op.levelId);
      const ref = `${op.worldId}/${op.levelId}`;
      for (const ow of Object.values(next.worlds))
        for (const l of ow.levels) for (const i of l.items) if (i.levelRef === ref) delete i.levelRef;
      return next;
    }
    case 'moveLevel': {
      const w = world(op.worldId);
      const from = w.levels.findIndex((l) => l.id === op.levelId);
      if (from < 0) throw new OpConflict(`level "${op.levelId}" no longer exists`, op);
      const [level] = w.levels.splice(from, 1);
      w.levels.splice(Math.max(0, Math.min(op.index, w.levels.length)), 0, level);
      return next;
    }
    default: {
      const w = world(op.worldId);
      const level = need(w.levels.find((l) => l.id === op.levelId), `level "${op.levelId}"`, op);
      applyLevelOp(level, op);
      return next;
    }
  }
}

export interface ReplayResult {
  state: Workspace;
  applied: Op[];
  conflicts: { op: Op; message: string }[];
}

/** Replays ops on top of `state`, skipping (and reporting) ones that no longer apply. */
export function replay(state: Workspace, ops: Op[]): ReplayResult {
  const applied: Op[] = [];
  const conflicts: ReplayResult['conflicts'] = [];
  let current = state;
  for (const op of ops) {
    try {
      current = applyOp(current, op);
      applied.push(op);
    } catch (err) {
      if (!(err instanceof OpConflict)) throw err;
      conflicts.push({ op, message: err.message });
    }
  }
  return { state: current, applied, conflicts };
}

function itemTitle(ws: Workspace, op: { projectId: string; itemId: string } & ItemAddr): string {
  const level = ws.projects[op.projectId]?.worlds[op.worldId]?.levels.find((l) => l.id === op.levelId);
  const parent = op.parentId ? level?.items.find((i) => i.id === op.parentId) : undefined;
  const list = op.parentId ? parent?.subtasks : level?.items;
  const title = list?.find((i) => i.id === op.itemId)?.title ?? op.itemId;
  return op.parentId ? `${title} (in ${parent?.title ?? op.parentId})` : title;
}

/** Human summary of an op, for commit messages and the pending list. */
export function describeOp(op: Op, state?: Workspace): string {
  if (op.kind === 'updateSettings')
    return `settings: ${Object.entries(op.patch).map(([k, v]) => `${k} = ${v ?? 'default'}`).join(', ')}`;
  const where = 'levelId' in op ? ` (${op.projectId}/${op.worldId}/${op.levelId})` : ` (${op.projectId})`;
  const title = (id: string) =>
    state && 'levelId' in op ? itemTitle(state, { ...op, itemId: id } as any) : id;
  const parentTitle = (id: string) =>
    state && 'levelId' in op ? itemTitle(state, { ...op, parentId: undefined, itemId: id } as any) : id;
  switch (op.kind) {
    case 'setItemStatus':
      return `${op.status}: ${title(op.itemId)}${where}`;
    case 'addItem':
      return `add ${op.parentId ? `step to ${parentTitle(op.parentId)}: ` : ''}${op.item.type} "${op.item.title}"${where}`;
    case 'updateItem':
      return `edit ${title(op.itemId)}${where}`;
    case 'deleteItem':
      return `delete ${title(op.itemId)}${where}`;
    case 'setCriterion':
      return `${op.done ? 'tick' : 'untick'} criterion ${op.criterionId}${where}`;
    case 'addCriterion':
      return `add criterion "${op.criterion.text}"${where}`;
    case 'updateCriterion':
      return `edit criterion ${op.criterionId}${where}`;
    case 'deleteCriterion':
      return `delete criterion ${op.criterionId}${where}`;
    case 'startLevel':
      return `start level${where}`;
    case 'updateLevel':
      return `edit level${where}`;
    case 'deleteLevel':
      return `delete level${where}`;
    case 'moveLevel':
      return `reorder level${where}`;
    case 'addLevel':
      return `add level "${op.level.name}" to ${op.projectId}/${op.worldId}`;
    case 'addWorld':
      return `add world "${op.world.name}"${where}`;
    case 'updateWorld':
      return `edit world ${op.worldId}${where}`;
    case 'deleteWorld':
      return `delete world ${op.worldId}${where}`;
    case 'updateProject':
      return `edit project${where}`;
    case 'addGoal':
      return `add goal "${op.goal.title}"${where}`;
    case 'updateGoal':
      return `edit goal ${op.goalId}${where}`;
    case 'deleteGoal':
      return `delete goal ${op.goalId}${where}`;
    case 'addProject':
      return `add project "${op.project.title}"`;
    case 'deleteProject':
      return `delete project ${op.projectId}`;
  }
}

export function commitMessage(ops: Op[], state?: Workspace): string {
  if (ops.length === 1) return `quest: ${describeOp(ops[0], state)}`;
  return `quest: ${ops.length} updates\n\n${ops.map((o) => `- ${describeOp(o, state)}`).join('\n')}`;
}
