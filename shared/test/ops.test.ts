import { describe, expect, it } from 'vitest';
import { applyOp, makeOp, replay, OpConflict, commitMessage, validateWorkspace } from '../src/index';
import { at, level, lvlOf, workspace } from './fixtures';

describe('applyOp', () => {
  it('is immutable and auto-starts the level', () => {
    const ws = workspace();
    const next = applyOp(ws, makeOp({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'doing' }));
    expect(lvlOf(ws).items[0].status).toBe('todo');
    expect(lvlOf(next).items[0].status).toBe('doing');
    expect(lvlOf(next).startedAt).toBeDefined();
  });

  it('sets and clears clearedAt with MVP criteria', () => {
    let ws = applyOp(workspace(), makeOp({ kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: true }));
    expect(lvlOf(ws).clearedAt).toBeDefined();
    ws = applyOp(ws, makeOp({ kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: false }));
    expect(lvlOf(ws).clearedAt).toBeUndefined();
  });

  it('counts edits after clear but not scope cuts', () => {
    let ws = applyOp(workspace(), makeOp({ kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: true }));
    ws = applyOp(ws, makeOp({ kind: 'updateItem', ...at, itemId: 'a', patch: { title: 'A2' } }));
    ws = applyOp(ws, makeOp({ kind: 'addItem', ...at, item: { id: 'd', type: 'task', title: 'D', status: 'todo' } }));
    ws = applyOp(ws, makeOp({ kind: 'setItemStatus', ...at, itemId: 'c', status: 'dropped' }));
    expect(lvlOf(ws).stats).toMatchObject({ editsAfterClear: 1, itemsAddedAfterClear: 1 });
  });

  it('counts repeated edits of done items', () => {
    let ws = applyOp(workspace(), makeOp({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' }));
    for (let n = 0; n < 4; n++) ws = applyOp(ws, makeOp({ kind: 'updateItem', ...at, itemId: 'a', patch: { notes: `v${n}` } }));
    expect(lvlOf(ws).stats?.itemEdits?.a).toBe(4);
  });

  it('lets a done sub-level step be reopened (dep/step edit key)', () => {
    const dep = { id: 'dep', type: 'dependency' as const, title: 'Dep', status: 'todo' as const, subtasks: [{ id: 's', type: 'task' as const, title: 'S', status: 'todo' as const }] };
    let ws = workspace(level({ items: [dep] }));
    ws = applyOp(ws, makeOp({ kind: 'setItemStatus', ...at, parentId: 'dep', itemId: 's', status: 'done' }));
    ws = applyOp(ws, makeOp({ kind: 'setItemStatus', ...at, parentId: 'dep', itemId: 's', status: 'todo' }));
    expect(lvlOf(ws).stats?.itemEdits).toEqual({ 'dep/s': 1 });
    expect(validateWorkspace(ws)).toEqual([]);
  });

  it('removes dependsOn references when deleting an item', () => {
    const ws = applyOp(workspace(), makeOp({ kind: 'deleteItem', ...at, itemId: 'a' }));
    expect(lvlOf(ws).items.find((i) => i.id === 'b')?.dependsOn).toBeUndefined();
    expect(validateWorkspace(ws)).toEqual([]);
  });

  it('throws OpConflict on missing targets', () => {
    expect(() => applyOp(workspace(), makeOp({ kind: 'setItemStatus', ...at, itemId: 'ghost', status: 'done' }))).toThrow(OpConflict);
    expect(() => applyOp(workspace(), makeOp({ kind: 'setItemStatus', ...at, projectId: 'nope', itemId: 'a', status: 'done' }))).toThrow(/project "nope"/);
  });

  it('adds and deletes whole projects', () => {
    let ws = applyOp(workspace(), makeOp({ kind: 'addProject', projectId: 'house', project: { id: 'house', title: 'House', goals: [], worldOrder: [] } }));
    expect(Object.keys(ws.projects).sort()).toEqual(['house', 'p']);
    expect(validateWorkspace(ws)).toEqual([]);
    ws = applyOp(ws, makeOp({ kind: 'deleteProject', projectId: 'p' }));
    expect(Object.keys(ws.projects)).toEqual(['house']);
  });
});

describe('replay (offline rebase)', () => {
  it('applies local ops on a changed remote and reports conflicts', () => {
    const local = [
      makeOp({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' }),
      makeOp({ kind: 'setItemStatus', ...at, itemId: 'b', status: 'done' }),
    ];
    let remote = applyOp(workspace(), makeOp({ kind: 'updateLevel', ...at, patch: { name: 'Renamed' } }));
    remote = applyOp(remote, makeOp({ kind: 'deleteItem', ...at, itemId: 'b' }));
    const r = replay(remote, local);
    expect(lvlOf(r.state).name).toBe('Renamed');
    expect(lvlOf(r.state).items.find((i) => i.id === 'a')?.status).toBe('done');
    expect(r.applied).toHaveLength(1);
    expect(r.conflicts[0].message).toMatch(/item "b"/);
  });

  it('builds readable commit messages', () => {
    const ops = [makeOp({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' })];
    expect(commitMessage(ops, workspace())).toBe('quest: done: A (p/w/lvl)');
  });
});
