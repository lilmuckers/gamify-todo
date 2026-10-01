import { describe, expect, it } from 'vitest';
import { applyOp, inverseOp, makeOp, type Item, type OpBody, type Workspace } from '../src';
import { at, level, lvlOf, workspace } from './fixtures';

/** Applying an op then its inverse gets back to where we started. */
function roundTrip(ws: Workspace, body: OpBody) {
  const after = applyOp(ws, makeOp(body));
  const inv = inverseOp(body, ws);
  expect(inv).toBeDefined();
  const back = applyOp(after, makeOp(inv!));
  return { after, back };
}

describe('inverseOp', () => {
  it('reverses status, criterion and edit changes', () => {
    const ws = workspace();
    for (const body of [
      { kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' },
      { kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: true },
      { kind: 'updateItem', ...at, itemId: 'b', patch: { title: 'New', notes: 'Added notes' } },
    ] as OpBody[]) {
      const { back } = roundTrip(ws, body);
      expect(lvlOf(back).items).toEqual(lvlOf(ws).items);
      expect(lvlOf(back).successCriteria).toEqual(lvlOf(ws).successCriteria);
    }
  });

  it('removes an added item and restores a deleted one in place, steps and all', () => {
    const dep: Item = {
      id: 'dep',
      type: 'dependency',
      title: 'Permit',
      status: 'todo',
      subtasks: [{ id: 's', type: 'task', title: 'S', status: 'done' }],
    };
    const ws = workspace(level({ items: [{ id: 'a', type: 'task', title: 'A', status: 'todo' }, dep, { id: 'z', type: 'task', title: 'Z', status: 'todo' }] }));
    const del = roundTrip(ws, { kind: 'deleteItem', ...at, itemId: 'dep' });
    expect(lvlOf(del.after).items.map((i) => i.id)).toEqual(['a', 'z']);
    expect(lvlOf(del.back).items).toEqual(lvlOf(ws).items);

    const add = roundTrip(ws, { kind: 'addItem', ...at, item: { id: 'new', type: 'task', title: 'New', status: 'todo' } });
    expect(lvlOf(add.back).items).toEqual(lvlOf(ws).items);

    const step = roundTrip(ws, { kind: 'setItemStatus', ...at, parentId: 'dep', itemId: 's', status: 'todo' });
    expect(lvlOf(step.back).items).toEqual(lvlOf(ws).items);
  });

  it('restores the items that waited for a deleted item', () => {
    const ws = workspace(); // b waits for a
    const { after, back } = roundTrip(ws, { kind: 'deleteItem', ...at, itemId: 'a' });
    expect(lvlOf(after).items.find((i) => i.id === 'b')?.dependsOn).toBeUndefined();
    expect(lvlOf(back).items).toEqual(lvlOf(ws).items);
  });

  it('inserts at an index with addItem', () => {
    const ws = applyOp(workspace(), makeOp({ kind: 'addItem', ...at, item: { id: 'x', type: 'task', title: 'X', status: 'todo' }, index: 1 }));
    expect(lvlOf(ws).items.map((i) => i.id)).toEqual(['a', 'x', 'b', 'c']);
  });

  it('has no inverse for structural edits or missing targets', () => {
    expect(inverseOp({ kind: 'updateLevel', ...at, patch: { name: 'N' } }, workspace())).toBeUndefined();
    expect(inverseOp({ kind: 'setItemStatus', ...at, itemId: 'ghost', status: 'done' }, workspace())).toBeUndefined();
  });
});
