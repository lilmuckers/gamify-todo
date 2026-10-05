import { isCleared, type ItemType, type Op, type OpBody, type Workspace } from '@quest/shared';
import { itemOf, levelOf } from './analytics-events';
import type { Route } from './router';
import type { SfxName } from './sfx';

/** What finishing each kind of item sounds like: the same sound as its animation in the level scene. */
const DONE_SOUND: Record<ItemType, SfxName> = {
  task: 'coin',
  stretch: 'coin',
  deliverable: 'checkpoint',
  blocker: 'crumble',
  risk: 'stomp',
  decision: 'flip',
  dependency: 'poof',
};

/**
 * The sound an applied edit makes when no level scene is showing it (the
 * compact mobile view, or ticking from the pad over another screen). The
 * scene plays its own, in time with the animation.
 */
export function soundForOp(op: Op | OpBody, before: Workspace | undefined, after: Workspace | undefined): SfxName | undefined {
  if (op.kind === 'inboxAdd' || op.kind === 'inboxUpdate') return 'jot';
  if (op.kind === 'inboxRemove') return 'scratch';
  if (op.kind === 'inboxPlace') return 'win';
  if (op.kind !== 'setItemStatus' && op.kind !== 'setCriterion') return;
  const a = levelOf(before, op);
  const b = levelOf(after, op);
  if (a && b && !isCleared(a) && isCleared(b)) return 'clear';
  if (a && b && isCleared(a) && !isCleared(b)) return 'unclear';
  if (op.kind === 'setCriterion') return op.done ? 'blip' : 'unblip';
  if (op.status === 'dropped') return 'poof';
  if (op.status !== 'done') return;
  const item = itemOf(a, op.itemId, op.parentId);
  return item ? DONE_SOUND[item.type] : 'coin';
}

/** The level scene on screen animates (and sounds) this edit itself. */
export function sceneShows(route: Route, op: Op | OpBody): boolean {
  if (op.kind !== 'setItemStatus' && op.kind !== 'setCriterion') return false;
  if (route.view !== 'level') return false;
  if (route.projectId !== op.projectId || route.worldId !== op.worldId || route.levelId !== op.levelId) return false;
  const parentId = 'parentId' in op ? op.parentId : undefined;
  return (route.subId ?? undefined) === (parentId ?? undefined);
}
