import type { Criterion, GameState, Goal, InboxItem, Item, ItemStatus, Level, Project, Settings, World, Workspace } from './model';
import { clone, uniqueId } from './model';
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
  | ({
      kind: 'setItemStatus';
      itemId: string;
      status: ItemStatus;
      /** Undo only: the done stamp to put back (null = none), instead of stamping now. */
      doneAt?: string | null;
    } & ItemAddr)
  | ({
      kind: 'addItem';
      item: Item;
      /** Position in the list; end when omitted. */
      index?: number;
      /** Siblings that wait for this item again (when undoing a delete). */
      dependents?: string[];
    } & ItemAddr)
  | ({ kind: 'updateItem'; itemId: string; patch: ItemPatch } & ItemAddr)
  | ({ kind: 'deleteItem'; itemId: string } & ItemAddr)
  | ({ kind: 'setCriterion'; criterionId: string; done: boolean } & LevelAddr)
  | ({ kind: 'addCriterion'; criterion: Criterion } & LevelAddr)
  | ({ kind: 'updateCriterion'; criterionId: string; patch: CriterionPatch } & LevelAddr)
  | ({ kind: 'deleteCriterion'; criterionId: string } & LevelAddr)
  | ({ kind: 'startLevel' } & LevelAddr)
  | ({ kind: 'updateLevel'; patch: LevelPatch } & LevelAddr)
  /** Adds days to a started level's time-box; still scored against the original (stats.timeboxExtendedDays). */
  | ({ kind: 'extendTimebox'; days: number } & LevelAddr)
  /** Parks a level on the someday shelf (clearing its start), or brings it back. */
  | ({ kind: 'setSomeday'; someday: boolean } & LevelAddr)
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
  | { kind: 'updateSettings'; patch: Partial<Omit<Settings, '$schema'>> }
  /** Inbox (data/inbox.json): captured ideas waiting to be placed. */
  | { kind: 'inboxAdd'; item: InboxItem; index?: number }
  | { kind: 'inboxUpdate'; id: string; patch: Partial<Omit<InboxItem, 'id'>> }
  | { kind: 'inboxRemove'; ids: string[] }
  /** Moves inbox items into a level (or a dependency's steps) as to-do items. */
  | ({ kind: 'inboxPlace'; ids: string[]; projectId: string } & ItemAddr);

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
  (op.kind === 'setItemStatus' && op.status === 'dropped') ||
  (op.kind === 'setSomeday' && op.someday);

/** Keeps `doneAt` in step with the status: stamped when it becomes done, gone otherwise. */
function stampDone(item: Pick<Item, 'status' | 'doneAt'>, wasDone: boolean, at: string) {
  if (item.status !== 'done') delete item.doneAt;
  else if (!wasDone || !item.doneAt) item.doneAt = at;
}

/** Real progress on a parked level takes it off the someday shelf. */
function isProgress(op: Op): boolean {
  if (op.kind === 'setItemStatus') return op.status === 'doing' || op.status === 'done';
  if (op.kind === 'updateItem') return op.patch.status === 'doing' || op.patch.status === 'done';
  return op.kind === 'setCriterion' && op.done;
}

/** Longest time-box a level can have (schema maximum). */
export const MAX_TIMEBOX_DAYS = 90;

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
      const wasDone = item.status === 'done';
      item.status = op.status;
      stampDone(item, wasDone, op.at);
      if (op.status === 'done' && op.doneAt !== undefined) {
        if (op.doneAt) item.doneAt = op.doneAt;
        else delete item.doneAt;
      }
      break;
    }
    case 'addItem':
      if (parent && (op.item.type === 'dependency' || op.item.subtasks || op.item.levelRef))
        throw new OpConflict('steps inside a dependency cannot be dependencies themselves', op);
      if (list().some((i) => i.id === op.item.id))
        throw new OpConflict(`${parent ? 'step' : 'item'} id "${op.item.id}" already taken`, op);
      if (op.index === undefined || op.index >= list().length) list().push(clone(op.item));
      else list().splice(Math.max(0, op.index), 0, clone(op.item));
      for (const sibling of list())
        if (op.dependents?.includes(sibling.id) && !sibling.dependsOn?.includes(op.item.id))
          sibling.dependsOn = [...(sibling.dependsOn ?? []), op.item.id];
      break;
    case 'updateItem': {
      const item = findItem(op.itemId);
      if (!wasCleared && item.status === 'done' && op.patch.status !== 'dropped') bumpItem(statKey(item.id));
      const wasDone = item.status === 'done';
      Object.assign(item, clone(op.patch));
      for (const [k, v] of Object.entries(op.patch)) if (v === undefined) delete (item as any)[k];
      if (op.patch.status !== undefined) stampDone(item, wasDone, op.at);
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
    case 'extendTimebox': {
      if (!Number.isInteger(op.days) || op.days < 1) throw new OpConflict('extend the time-box by a whole number of days', op);
      const added = Math.min(MAX_TIMEBOX_DAYS, level.timeboxDays + op.days) - level.timeboxDays;
      if (added <= 0) throw new OpConflict(`the time-box is already at the ${MAX_TIMEBOX_DAYS}-day maximum`, op);
      level.timeboxDays += added;
      // Before the level starts it's just planning; after, it's on the record.
      if (level.startedAt)
        level.stats = { ...level.stats, timeboxExtendedDays: (level.stats?.timeboxExtendedDays ?? 0) + added };
      break;
    }
    case 'setSomeday':
      if (op.someday && wasCleared) throw new OpConflict("a cleared level can't go on the someday shelf", op);
      if (op.someday) {
        level.someday = true;
        // The clock starts afresh when work resumes.
        delete level.startedAt;
      } else delete level.someday;
      break;
  }
  if (level.someday && isProgress(op)) delete level.someday;

  const busy = (i: Pick<Item, 'status'>) => i.status === 'doing' || i.status === 'done';
  const active =
    level.items.some((i) => busy(i) || (i.subtasks ?? []).some(busy)) ||
    level.successCriteria.some((c) => c.done);
  if (!level.startedAt && active && !level.someday) level.startedAt = op.at;
  const nowCleared = isCleared(level);
  if (nowCleared && !level.clearedAt) level.clearedAt = op.at;
  if (!nowCleared && level.clearedAt) delete level.clearedAt;
}

/** Applies one op to a copy of the workspace. Throws OpConflict if the target is gone. */
function withInbox(ws: Workspace, inbox: InboxItem[]): Workspace {
  const { inbox: _, ...rest } = ws;
  return inbox.length ? { ...rest, inbox } : rest;
}

function applyInboxOp(ws: Workspace, op: Op & { kind: 'inboxAdd' | 'inboxUpdate' | 'inboxRemove' | 'inboxPlace' }): Workspace {
  const inbox = clone(ws.inbox ?? []);
  const find = (id: string) => need(inbox.find((i) => i.id === id), `inbox item "${id}"`, op);
  switch (op.kind) {
    case 'inboxAdd':
      if (inbox.some((i) => i.id === op.item.id)) throw new OpConflict(`inbox id "${op.item.id}" already taken`, op);
      inbox.splice(op.index ?? inbox.length, 0, clone(op.item));
      return withInbox(ws, inbox);
    case 'inboxUpdate': {
      const item = find(op.id);
      Object.assign(item, clone(op.patch));
      for (const [k, v] of Object.entries(op.patch)) if (v === undefined) delete (item as any)[k];
      return withInbox(ws, inbox);
    }
    case 'inboxRemove':
      for (const id of op.ids) find(id);
      return withInbox(ws, inbox.filter((i) => !op.ids.includes(i.id)));
    case 'inboxPlace': {
      // Each captured idea becomes a to-do item via the normal addItem path,
      // so level stats and start times behave exactly as for a new item.
      const placed = op.ids.map(find);
      const level = ws.projects[op.projectId]?.worlds[op.worldId]?.levels.find((l) => l.id === op.levelId);
      need(level, `level "${op.levelId}"`, op);
      const parent = op.parentId ? level!.items.find((i) => i.id === op.parentId) : undefined;
      const taken = (parent ? (parent.subtasks ?? []) : level!.items).map((i) => i.id);
      let next = ws;
      for (const p of placed) {
        const id = uniqueId(p.id, taken);
        taken.push(id);
        // Steps can't be dependencies themselves.
        const type = op.parentId && p.type === 'dependency' ? 'task' : p.type;
        const item: Item = { id, type, title: p.title, status: 'todo', ...(p.link ? { link: p.link } : {}), ...(p.notes ? { notes: p.notes } : {}) };
        next = applyOp(next, {
          ...op,
          kind: 'addItem',
          projectId: op.projectId,
          worldId: op.worldId,
          levelId: op.levelId,
          ...(op.parentId ? { parentId: op.parentId } : {}),
          item,
        } as Op);
      }
      return withInbox(next, inbox.filter((i) => !op.ids.includes(i.id)));
    }
  }
}

export function applyOp(ws: Workspace, op: Op): Workspace {
  if (op.kind === 'inboxAdd' || op.kind === 'inboxUpdate' || op.kind === 'inboxRemove' || op.kind === 'inboxPlace')
    return applyInboxOp(ws, op);
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

/** Op kinds the app offers to undo. */
export const UNDOABLE = new Set<Op['kind']>([
  'setItemStatus',
  'setCriterion',
  'updateItem',
  'addItem',
  'deleteItem',
  'inboxAdd',
  'inboxUpdate',
  'inboxRemove',
]);

/**
 * The op that reverses `op`, given the workspace just before it was applied.
 * Undefined when the op can't be reversed (or its target was already gone).
 */
export function inverseOp(op: OpBody, before: Workspace): OpBody | undefined {
  const inbox = before.inbox ?? [];
  if (op.kind === 'inboxAdd') return { kind: 'inboxRemove', ids: [op.item.id] };
  if (op.kind === 'inboxUpdate') {
    const prev = inbox.find((i) => i.id === op.id) as Record<string, unknown> | undefined;
    return prev && { kind: 'inboxUpdate', id: op.id, patch: Object.fromEntries(Object.keys(op.patch).map((k) => [k, clone(prev[k])])) };
  }
  if (op.kind === 'inboxRemove') {
    if (op.ids.length !== 1) return;
    const index = inbox.findIndex((i) => i.id === op.ids[0]);
    return index < 0 ? undefined : { kind: 'inboxAdd', item: clone(inbox[index]), index };
  }
  if (op.kind === 'inboxPlace' || !('levelId' in op) || !('worldId' in op)) return;
  const level = before.projects[op.projectId]?.worlds[op.worldId]?.levels.find((l) => l.id === op.levelId);
  if (!level) return;
  const parentId = 'parentId' in op ? op.parentId : undefined;
  const list: Item[] = parentId ? ((level.items.find((i) => i.id === parentId)?.subtasks ?? []) as Item[]) : level.items;
  const at = { projectId: op.projectId, worldId: op.worldId, levelId: op.levelId, ...(parentId ? { parentId } : {}) };
  switch (op.kind) {
    case 'setItemStatus': {
      const prev = list.find((i) => i.id === op.itemId);
      if (!prev) return;
      // Reopening a done item and undoing it keeps the original done stamp.
      const stamp = prev.status === 'done' ? { doneAt: prev.doneAt ?? null } : {};
      return { kind: 'setItemStatus', ...at, itemId: op.itemId, status: prev.status, ...stamp };
    }
    case 'setCriterion': {
      const prev = level.successCriteria.find((c) => c.id === op.criterionId);
      return prev && { kind: 'setCriterion', ...at, criterionId: op.criterionId, done: prev.done };
    }
    case 'updateItem': {
      const prev = list.find((i) => i.id === op.itemId) as Record<string, unknown> | undefined;
      if (!prev) return;
      const patch = Object.fromEntries(Object.keys(op.patch).map((k) => [k, clone(prev[k])]));
      return { kind: 'updateItem', ...at, itemId: op.itemId, patch };
    }
    case 'addItem':
      return { kind: 'deleteItem', ...at, itemId: op.item.id };
    case 'deleteItem': {
      const index = list.findIndex((i) => i.id === op.itemId);
      if (index < 0) return;
      const dependents = list.filter((i) => i.dependsOn?.includes(op.itemId)).map((i) => i.id);
      return { kind: 'addItem', ...at, item: clone(list[index]), index, ...(dependents.length ? { dependents } : {}) };
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
  const inboxTitle = (id: string) => state?.inbox?.find((i) => i.id === id)?.title ?? id;
  if (op.kind === 'inboxAdd') return `inbox: add "${op.item.title}"`;
  if (op.kind === 'inboxUpdate') return `inbox: edit ${inboxTitle(op.id)}`;
  if (op.kind === 'inboxRemove') return `inbox: remove ${op.ids.map(inboxTitle).join(', ')}`;
  if (op.kind === 'inboxPlace')
    return `place ${op.ids.length} inbox item${op.ids.length === 1 ? '' : 's'} in ${op.projectId}/${op.worldId}/${op.levelId}${op.parentId ? ` (steps of ${op.parentId})` : ''}`;
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
    case 'extendTimebox':
      return `extend time-box by ${op.days} day${op.days === 1 ? '' : 's'}${where}`;
    case 'setSomeday':
      return `${op.someday ? 'move to someday' : 'back from someday'}${where}`;
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
