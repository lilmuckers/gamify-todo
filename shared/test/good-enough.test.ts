import { describe, expect, it } from 'vitest';
import { keepOptionalOps, makeOp, optionalSavings, replay, scoreLevel, type Level } from '../src';
import { at, level, lvlOf, workspace } from './fixtures';

/** Cleared (the MVP criterion ticked), with a stretch item and an optional task still open. */
function cleared(): Level {
  return level({
    startedAt: '2026-10-01T00:00:00Z',
    clearedAt: '2026-10-02T00:00:00Z',
    successCriteria: [{ id: 'mvp-1', text: 'Works', mvp: true, done: true }],
    items: [
      { id: 'a', type: 'task', title: 'A', status: 'done' },
      { id: 'c', type: 'stretch', title: 'Shiny trim', status: 'todo', notes: 'Brass?', budget: 40, spent: 15 },
      { id: 'o', type: 'task', title: 'Label the boxes', status: 'todo', mvp: false, link: 'https://example.com', dependsOn: ['a'] },
      { id: 'x', type: 'stretch', title: 'Over', status: 'todo', budget: 10, spent: 30 },
    ],
  });
}

describe('good enough (#26)', () => {
  it('banks the unspent budget of what is left, never a negative', () => {
    expect(optionalSavings(cleared())).toBe(25);
    expect(optionalSavings(level())).toBe(0);
  });

  it('moves the optional items left to the inbox, without a polish penalty', () => {
    const lvl = cleared();
    const ops = keepOptionalOps(at, lvl, [{ id: 'c', type: 'task', title: 'Taken' }], '2026-10-25T00:00:00Z');
    const after = replay({ ...workspace(lvl), inbox: [{ id: 'c', type: 'task', title: 'Taken' }] }, ops.map((o) => makeOp(o)));
    expect(after.conflicts).toEqual([]);
    expect(lvlOf(after.state).items.map((i) => i.id)).toEqual(['a']);
    expect(after.state.inbox).toEqual([
      { id: 'c', type: 'task', title: 'Taken' },
      { id: 'c-2', type: 'stretch', title: 'Shiny trim', notes: 'Brass?', addedAt: '2026-10-25T00:00:00Z' },
      { id: 'o', type: 'task', title: 'Label the boxes', link: 'https://example.com', addedAt: '2026-10-25T00:00:00Z' },
      { id: 'x', type: 'stretch', title: 'Over', addedAt: '2026-10-25T00:00:00Z' },
    ]);
    expect(scoreLevel(lvlOf(after.state)).polish).toBe(0);
    expect(scoreLevel(lvlOf(after.state)).cleared).toBe(true);
  });
});
