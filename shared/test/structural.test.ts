import { describe, expect, it } from 'vitest';
import {
  applyOp,
  changedFiles,
  makeOp,
  revalidate,
  toFiles,
  validateWorkspace,
  type GameState,
  type Level,
  type OpBody,
  type Workspace,
} from '../src/index';
import { level } from './fixtures';

/** Two projects; "p" has two worlds of two levels, with a cloud from w2 back to w1. */
function rich(): Workspace {
  const lvl = (id: string, extra: Partial<Level> = {}) => level({ id, name: id.toUpperCase(), ...extra });
  const p: GameState = {
    overworld: { id: 'p', title: 'P', goals: [{ id: 'g', title: 'Goal' }, { id: 'h', title: 'Other' }], worldOrder: ['w1', 'w2'] },
    worlds: {
      w1: { id: 'w1', name: 'One', theme: 'grass', goalIds: ['g'], levels: [lvl('a1'), lvl('a2')] },
      w2: {
        id: 'w2',
        name: 'Two',
        theme: 'desert',
        goalIds: ['g', 'h'],
        unlocksAfter: ['w1'],
        levels: [
          lvl('b1', { items: [{ id: 'dep', type: 'dependency', title: 'Needs a1', status: 'todo', levelRef: 'w1/a1' }] }),
          lvl('b2'),
        ],
      },
    },
  };
  const q: GameState = {
    overworld: { id: 'q', title: 'Q', goals: [{ id: 'g', title: 'Goal' }], worldOrder: ['w'] },
    worlds: { w: { id: 'w', name: 'W', theme: 'grass', goalIds: ['g'], levels: [lvl('lvl')] } },
  };
  return { projects: { p, q }, settings: { hero: 'classic' }, inbox: [{ id: 'idea', type: 'task', title: 'Idea' }] };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const p1 = { projectId: 'p', worldId: 'w1', levelId: 'a1' };

/** One of every op kind that touches project p (or settings / the inbox). */
const OPS: OpBody[] = [
  { kind: 'setItemStatus', ...p1, itemId: 'a', status: 'done' },
  { kind: 'updateItem', ...p1, itemId: 'a', patch: { title: 'Renamed' } },
  { kind: 'addItem', ...p1, item: { id: 'new', type: 'task', title: 'New', status: 'todo' }, dependents: ['b'] },
  { kind: 'deleteItem', ...p1, itemId: 'a' },
  { kind: 'setCriterion', ...p1, criterionId: 'mvp-1', done: true },
  { kind: 'addCriterion', ...p1, criterion: { id: 'more', text: 'More', mvp: false, done: false } },
  { kind: 'updateCriterion', ...p1, criterionId: 'bonus', patch: { text: 'Prettier' } },
  { kind: 'deleteCriterion', ...p1, criterionId: 'bonus' },
  { kind: 'startLevel', ...p1 },
  { kind: 'updateLevel', ...p1, patch: { name: 'Renamed' } },
  { kind: 'extendTimebox', ...p1, days: 2 },
  { kind: 'setSomeday', ...p1, someday: true },
  { kind: 'addWorld', projectId: 'p', world: { id: 'w3', name: 'Three', theme: 'ice', goalIds: [], levels: [] } },
  { kind: 'updateWorld', projectId: 'p', worldId: 'w1', patch: { name: 'Uno' } },
  { kind: 'deleteWorld', projectId: 'p', worldId: 'w1' },
  { kind: 'updateProject', projectId: 'p', patch: { title: 'Renamed' } },
  { kind: 'addGoal', projectId: 'p', goal: { id: 'k', title: 'K' } },
  { kind: 'updateGoal', projectId: 'p', goalId: 'g', patch: { title: 'G!' } },
  { kind: 'deleteGoal', projectId: 'p', goalId: 'h' },
  { kind: 'addLevel', projectId: 'p', worldId: 'w1', level: level({ id: 'a3' }) },
  { kind: 'deleteLevel', projectId: 'p', worldId: 'w1', levelId: 'a1' },
  { kind: 'moveLevel', projectId: 'p', worldId: 'w1', levelId: 'a2', index: 0 },
  { kind: 'updateSettings', patch: { hero: 'goth' } },
  { kind: 'inboxAdd', item: { id: 'idea-2', type: 'task', title: 'Another' } },
  { kind: 'inboxUpdate', id: 'idea', patch: { title: 'Better idea' } },
  { kind: 'inboxRemove', ids: ['idea'] },
  { kind: 'inboxPlace', ids: ['idea'], ...p1 },
] as OpBody[];

describe('ops copy only what they change', () => {
  it.each(OPS.map((o) => [o.kind, o] as const))('%s never writes into its input', (_kind, body) => {
    const ws = deepFreeze(rich());
    expect(() => applyOp(ws, makeOp(body))).not.toThrow();
  });

  it('shares untouched projects, worlds and levels', () => {
    const ws = rich();
    const next = applyOp(ws, makeOp({ kind: 'setItemStatus', ...p1, itemId: 'a', status: 'doing' }));
    expect(next.projects.q).toBe(ws.projects.q);
    expect(next.projects.p).not.toBe(ws.projects.p);
    expect(next.projects.p.overworld).toBe(ws.projects.p.overworld);
    expect(next.projects.p.worlds.w2).toBe(ws.projects.p.worlds.w2);
    expect(next.projects.p.worlds.w1.levels[1]).toBe(ws.projects.p.worlds.w1.levels[1]);
    expect(next.projects.p.worlds.w1.levels[0]).not.toBe(ws.projects.p.worlds.w1.levels[0]);
    expect(next.settings).toBe(ws.settings);
  });

  it('copies only the levels whose cloud points at a deleted level', () => {
    const ws = rich();
    const next = applyOp(ws, makeOp({ kind: 'deleteLevel', projectId: 'p', worldId: 'w1', levelId: 'a1' }));
    expect(next.projects.p.worlds.w2.levels[0].items[0].levelRef).toBeUndefined();
    expect(ws.projects.p.worlds.w2.levels[0].items[0].levelRef).toBe('w1/a1');
    expect(next.projects.p.worlds.w2.levels[1]).toBe(ws.projects.p.worlds.w2.levels[1]);
  });
});

describe('revalidate', () => {
  const sorted = (issues: { file: string; path: string; message: string }[]) =>
    issues.map((i) => `${i.file}${i.path} ${i.message}`).sort();

  it.each(OPS.map((o) => [o.kind, o] as const))('matches a full validate after %s', (_kind, body) => {
    const ws = rich();
    const next = applyOp(ws, makeOp(body));
    expect(sorted(revalidate(ws, validateWorkspace(ws), next))).toEqual(sorted(validateWorkspace(next)));
  });

  it('carries over issues of untouched projects and finds new ones', () => {
    const ws = rich();
    // Project q starts out invalid (an item waits for one that doesn't exist).
    ws.projects.q.worlds.w.levels[0].items[0].dependsOn = ['ghost'];
    const issues = validateWorkspace(ws);
    expect(issues).toHaveLength(1);
    // An edit to p keeps q's issue without re-checking q...
    const edited = applyOp(ws, makeOp({ kind: 'setItemStatus', ...p1, itemId: 'a', status: 'doing' }));
    expect(revalidate(ws, issues, edited)).toEqual(issues);
    // ...and a bad edit to p shows up.
    const bad = applyOp(ws, makeOp({ kind: 'updateItem', ...p1, itemId: 'a', patch: { dependsOn: ['nowhere'] } }));
    expect(sorted(revalidate(ws, issues, bad))).toEqual(sorted(validateWorkspace(bad)));
    expect(revalidate(ws, issues, bad)).toHaveLength(2);
  });
});

describe('changedFiles', () => {
  it.each(OPS.map((o) => [o.kind, o] as const))('matches a full file comparison after %s', (_kind, body) => {
    const ws = rich();
    const next = applyOp(ws, makeOp(body));
    const a = toFiles(ws);
    const b = toFiles(next);
    const full: Record<string, string | null> = {};
    for (const [path, content] of Object.entries(b)) if (a[path] !== content) full[path] = content;
    for (const path of Object.keys(a)) if (!(path in b)) full[path] = null;
    expect(changedFiles(ws, next)).toEqual(full);
  });
});
