import { describe, expect, it } from 'vitest';
import {
  applyOp,
  dependencyMode,
  describeOp,
  kindFor,
  layoutLevel,
  makeOp,
  OpConflict,
  semanticIssues,
  subLevel,
  SUB_CRITERION_ID,
  type Item,
} from '../src';
import { at, level, lvlOf, state, workspace } from './fixtures';

const dep = (extra: Partial<Item> = {}): Item => ({ id: 'permit', type: 'dependency', title: 'Permit', status: 'todo', ...extra });
const steps: NonNullable<Item['subtasks']> = [
  { id: 'call', type: 'task', title: 'Call council', status: 'todo' },
  { id: 'form', type: 'task', title: 'Send form', status: 'todo', dependsOn: ['call'] },
  { id: 'nice', type: 'stretch', title: 'Thank-you card', status: 'todo' },
];

describe('dependency modes', () => {
  it('picks cloud for a level link, warp for subtasks, plain otherwise', () => {
    expect(dependencyMode(dep())).toBe('plain');
    expect(dependencyMode(dep({ levelRef: 'w/other' }))).toBe('cloud');
    expect(dependencyMode(dep({ subtasks: steps }))).toBe('warp');
    expect(dependencyMode(dep({ subtasks: [] }))).toBe('plain');
    expect(dependencyMode({ id: 't', type: 'task', title: 'T', status: 'todo' })).toBeUndefined();
    expect(kindFor(dep())).toBe('pipe');
    expect(kindFor(dep({ subtasks: steps }))).toBe('warp');
    expect(kindFor(dep({ levelRef: 'w/x' }))).toBe('cloud');
  });
});

describe('subLevel', () => {
  it('turns subtasks into a level that clears when every must-do step is out of the way', () => {
    const parent = level({ items: [dep({ subtasks: steps })] });
    const sub = subLevel(parent, parent.items[0]);
    expect(sub.id).toBe(parent.id);
    expect(sub.items.map((i) => i.id)).toEqual(['call', 'form', 'nice']);
    expect(sub.successCriteria).toEqual([expect.objectContaining({ id: SUB_CRITERION_ID, done: false })]);

    const done = subLevel(parent, dep({ subtasks: steps.map((s) => (s.type === 'stretch' ? s : { ...s, status: 'done' })) }));
    expect(done.successCriteria[0].done).toBe(true);
  });

  it('lays out with an exit pipe and no castle stop', () => {
    const parent = level({ items: [dep({ subtasks: steps.map((s) => ({ ...s, status: 'done' as const })) })] });
    const sub = subLevel(parent, parent.items[0]);
    const lay = layoutLevel(sub, { sub: true });
    expect(lay.hero.kind).toBe('flag');
    expect(lay.width).toBeLessThan(layoutLevel(sub).width);
  });
});

describe('ops on subtasks', () => {
  const ws = () => workspace(level({ items: [dep({ subtasks: structuredClone(steps) })] }));
  const sub = (w: ReturnType<typeof ws>) => lvlOf(w).items[0].subtasks!;

  it('sets status, adds, edits and deletes steps inside a dependency', () => {
    let w = applyOp(ws(), makeOp({ kind: 'setItemStatus', ...at, parentId: 'permit', itemId: 'call', status: 'done' }));
    expect(sub(w)[0].status).toBe('done');
    // Touching a step starts the level clock.
    expect(lvlOf(w).startedAt).toBeDefined();

    w = applyOp(w, makeOp({ kind: 'addItem', ...at, parentId: 'permit', item: { id: 'pay', type: 'task', title: 'Pay fee', status: 'todo' } }));
    expect(sub(w).map((s) => s.id)).toEqual(['call', 'form', 'nice', 'pay']);

    w = applyOp(w, makeOp({ kind: 'updateItem', ...at, parentId: 'permit', itemId: 'pay', patch: { title: 'Pay the fee' } }));
    expect(sub(w)[3].title).toBe('Pay the fee');

    w = applyOp(w, makeOp({ kind: 'deleteItem', ...at, parentId: 'permit', itemId: 'call' }));
    expect(sub(w).map((s) => s.id)).toEqual(['form', 'nice', 'pay']);
    expect(sub(w)[0].dependsOn).toBeUndefined();
    // The dependency itself is untouched.
    expect(lvlOf(w).items[0].status).toBe('todo');
  });

  it('creates the subtask list on the first step and removes it with the last', () => {
    let w = workspace(level({ items: [dep()] }));
    w = applyOp(w, makeOp({ kind: 'addItem', ...at, parentId: 'permit', item: { id: 'one', type: 'task', title: 'One', status: 'todo' } }));
    expect(lvlOf(w).items[0].subtasks).toHaveLength(1);
    w = applyOp(w, makeOp({ kind: 'deleteItem', ...at, parentId: 'permit', itemId: 'one' }));
    expect(lvlOf(w).items[0]).not.toHaveProperty('subtasks');
  });

  it('refuses nested dependencies, unknown parents and taken ids', () => {
    const nested = makeOp({ kind: 'addItem', ...at, parentId: 'permit', item: dep({ id: 'inner' }) });
    expect(() => applyOp(ws(), nested)).toThrow(OpConflict);
    const orphan = makeOp({ kind: 'setItemStatus', ...at, parentId: 'nope', itemId: 'call', status: 'done' });
    expect(() => applyOp(ws(), orphan)).toThrow(/dependency "nope"/);
    const taken = makeOp({ kind: 'addItem', ...at, parentId: 'permit', item: { id: 'call', type: 'task', title: 'x', status: 'todo' } });
    expect(() => applyOp(ws(), taken)).toThrow(/step id "call"/);
  });

  it('describes step ops with the dependency they belong to', () => {
    const w = ws();
    expect(describeOp(makeOp({ kind: 'setItemStatus', ...at, parentId: 'permit', itemId: 'call', status: 'done' }), w)).toBe(
      'done: Call council (in Permit) (p/w/lvl)',
    );
    expect(describeOp(makeOp({ kind: 'addItem', ...at, parentId: 'permit', item: { id: 'x', type: 'task', title: 'X', status: 'todo' } }), w)).toBe(
      'add step to Permit: task "X" (p/w/lvl)',
    );
  });
});

describe('subtask validation', () => {
  const issues = (items: Item[]) => semanticIssues('p', state(level({ items }))).map((i) => i.message);

  it('accepts a dependency with steps', () => {
    expect(issues([dep({ subtasks: steps })])).toEqual([]);
  });

  it('flags steps on non-dependencies, mixing with levelRef, bad refs and cycles', () => {
    expect(issues([{ id: 't', type: 'task', title: 'T', status: 'todo', subtasks: steps }])).toContain('only dependency items can have subtasks');
    const s = state(level({ items: [dep({ levelRef: 'w/other', subtasks: steps })] }));
    s.worlds.w.levels.push(level({ id: 'other' }));
    expect(semanticIssues('p', s).map((i) => i.message)).toEqual(['use levelRef or subtasks, not both']);
    expect(issues([dep({ subtasks: [...steps, { ...steps[0] }] })])).toContain('duplicate subtask id "call"');
    expect(issues([dep({ subtasks: [{ ...steps[0], dependsOn: ['ghost'] }] })])).toContain('unknown subtask "ghost"');
    expect(
      issues([dep({ subtasks: [{ ...steps[0], dependsOn: ['form'] }, steps[1]] })]).some((m) => m.startsWith('dependency cycle')),
    ).toBe(true);
  });

  it('rejects a level that depends on itself', () => {
    expect(issues([dep({ levelRef: 'w/lvl' })])).toContain('a level cannot depend on itself');
  });
});
