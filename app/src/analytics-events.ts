import {
  dependencyMode,
  findLevel,
  isCleared,
  scoreLevel,
  type Item,
  type Level,
  type Op,
  type OpBody,
  type Workspace,
} from '@quest/shared';
import { bucket, type EVENT_PARAMS, type Params } from './analytics';

export interface TrackedEvent {
  name: keyof typeof EVENT_PARAMS;
  params?: Params;
}

const DAY = 86_400_000;

export function levelOf(ws: Workspace | undefined, op: { projectId: string; worldId: string; levelId: string }): Level | undefined {
  const state = ws?.projects[op.projectId];
  return state ? findLevel(state, op.worldId, op.levelId) : undefined;
}

export function itemOf(level: Level | undefined, itemId: string, parentId?: string): Item | undefined {
  if (!level) return;
  if (!parentId) return level.items.find((i) => i.id === itemId);
  return level.items.find((i) => i.id === parentId)?.subtasks?.find((s) => s.id === itemId) as Item | undefined;
}

/**
 * Analytics events for an applied op, from the workspace before and after.
 * Only enums, flags and counts: never titles or ids.
 */
export function eventsForOp(op: Op | OpBody, before: Workspace | undefined, after: Workspace | undefined): TrackedEvent[] {
  const out: TrackedEvent[] = [];
  const inSub = 'parentId' in op && !!op.parentId;
  switch (op.kind) {
    case 'setItemStatus': {
      const item = itemOf(levelOf(before, op), op.itemId, op.parentId);
      out.push({
        name: 'item_status',
        params: { status: op.status, item_type: item?.type, in_sub_level: inSub, dep_mode: item ? dependencyMode(item) : undefined },
      });
      break;
    }
    case 'addItem':
      out.push({ name: 'item_add', params: { item_type: op.item.type, in_sub_level: inSub } });
      break;
    case 'updateItem': {
      const item = itemOf(levelOf(after, op), op.itemId, op.parentId);
      out.push({ name: 'item_edit', params: { item_type: item?.type, in_sub_level: inSub } });
      break;
    }
    case 'deleteItem': {
      const item = itemOf(levelOf(before, op), op.itemId, op.parentId);
      out.push({ name: 'item_delete', params: { item_type: item?.type, in_sub_level: inSub } });
      break;
    }
    case 'setCriterion': {
      const c = levelOf(before, op)?.successCriteria.find((x) => x.id === op.criterionId);
      out.push({ name: 'criterion_toggle', params: { done: op.done, mvp: c?.mvp } });
      break;
    }
    case 'startLevel':
      out.push({ name: 'level_start' });
      break;
    case 'addLevel':
      out.push({ name: 'level_add' });
      break;
    case 'addWorld':
      out.push({ name: 'world_add' });
      break;
    case 'addProject':
      out.push({ name: 'project_add' });
      break;
    case 'setArchived':
      out.push({ name: 'project_archive', params: { archived: op.archived } });
      break;
    case 'updateSettings':
      // Reported as hero_select by App.setHero.
      break;
    case 'inboxAdd':
      out.push({ name: 'inbox_add', params: { item_type: op.item.type } });
      break;
    case 'inboxPlace':
      out.push({ name: 'inbox_place', params: { count: op.ids.length, target: op.parentId ? 'steps' : 'level' } });
      break;
    default:
      out.push({ name: 'data_edit', params: { kind: op.kind } });
  }

  // Did this op clear the level?
  if ('levelId' in op && 'worldId' in op) {
    const a = levelOf(before, op);
    const b = levelOf(after, op);
    if (a && b && !isCleared(a) && isCleared(b)) {
      const sc = scoreLevel(b);
      const days = b.startedAt ? Math.max(0, Math.round((Date.now() - Date.parse(b.startedAt)) / DAY)) : 0;
      out.push({
        name: 'level_clear',
        params: { stars: sc.stars, within_timebox: sc.starReasons.inTime, polish: sc.polish, days_bucket: bucket(days) },
      });
    }
  }
  return out;
}
