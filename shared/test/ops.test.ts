import { describe, expect, it } from 'vitest';
import { applyOp, makeOp, replay, OpConflict, commitMessage, validateState } from '../src/index';
import { state } from './fixtures';

const at = { worldId: 'w', levelId: 'lvl' };
const lvl = (s: ReturnType<typeof state>) => s.worlds.w.levels[0];

describe('applyOp', () => {
  it('is immutable and auto-starts the level', () => {
    const s = state();
    const next = applyOp(s, makeOp({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'doing' }));
    expect(lvl(s).items[0].status).toBe('todo');
    expect(lvl(next).items[0].status).toBe('doing');
    expect(lvl(next).startedAt).toBeDefined();
  });

  it('sets and clears clearedAt with MVP criteria', () => {
    let s = applyOp(state(), makeOp({ kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: true }));
    expect(lvl(s).clearedAt).toBeDefined();
    s = applyOp(s, makeOp({ kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: false }));
    expect(lvl(s).clearedAt).toBeUndefined();
  });

  it('counts edits after clear but not scope cuts', () => {
    let s = applyOp(state(), makeOp({ kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: true }));
    s = applyOp(s, makeOp({ kind: 'updateItem', ...at, itemId: 'a', patch: { title: 'A2' } }));
    s = applyOp(s, makeOp({ kind: 'addItem', ...at, item: { id: 'd', type: 'task', title: 'D', status: 'todo' } }));
    s = applyOp(s, makeOp({ kind: 'setItemStatus', ...at, itemId: 'c', status: 'dropped' }));
    expect(lvl(s).stats).toMatchObject({ editsAfterClear: 1, itemsAddedAfterClear: 1 });
  });

  it('counts repeated edits of done items', () => {
    let s = applyOp(state(), makeOp({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' }));
    for (let n = 0; n < 4; n++)
      s = applyOp(s, makeOp({ kind: 'updateItem', ...at, itemId: 'a', patch: { notes: `v${n}` } }));
    expect(lvl(s).stats?.itemEdits?.a).toBe(4);
  });

  it('removes dependsOn references when deleting an item', () => {
    const s = applyOp(state(), makeOp({ kind: 'deleteItem', ...at, itemId: 'a' }));
    expect(lvl(s).items.find((i) => i.id === 'b')?.dependsOn).toBeUndefined();
    expect(validateState(s)).toEqual([]);
  });

  it('throws OpConflict on missing targets', () => {
    expect(() =>
      applyOp(state(), makeOp({ kind: 'setItemStatus', ...at, itemId: 'ghost', status: 'done' })),
    ).toThrow(OpConflict);
  });
});

describe('replay (offline rebase)', () => {
  it('applies local ops on a changed remote and reports conflicts', () => {
    const local = [
      makeOp({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' }),
      makeOp({ kind: 'setItemStatus', ...at, itemId: 'b', status: 'done' }),
    ];
    // Remote meanwhile renamed the level and deleted item b.
    let remote = applyOp(state(), makeOp({ kind: 'updateLevel', ...at, patch: { name: 'Renamed' } }));
    remote = applyOp(remote, makeOp({ kind: 'deleteItem', ...at, itemId: 'b' }));
    const r = replay(remote, local);
    expect(lvl(r.state).name).toBe('Renamed');
    expect(lvl(r.state).items.find((i) => i.id === 'a')?.status).toBe('done');
    expect(r.applied).toHaveLength(1);
    expect(r.conflicts[0].message).toMatch(/item "b"/);
  });

  it('builds readable commit messages', () => {
    const ops = [makeOp({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' })];
    expect(commitMessage(ops, state())).toBe('quest: done: A (w/lvl)');
  });
});
