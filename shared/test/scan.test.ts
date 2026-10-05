import { describe, expect, it } from 'vitest';
import { changesAsHistory, changesFromCommit, scanChanges, type CommitChanges, type Level } from '../src';
import { level } from './fixtures';

const PATH = 'data/p/w/lvl.json';
const text = (l: Level) => JSON.stringify(l);
const commit = (before: Level | undefined, after: Level | undefined, date = '2026-10-02T10:00:00Z', sha = 'c1'): CommitChanges => ({
  sha,
  date,
  message: 'Edit by hand',
  files: [{ path: PATH, ...(before ? { before: text(before) } : {}), ...(after ? { after: text(after) } : {}) }],
});
const kinds = (c: CommitChanges) => changesFromCommit(c).map((e) => `${e.kind}:${e.subject}`);

describe('changesFromCommit', () => {
  const started = level({ startedAt: '2026-09-28T09:00:00Z' });

  it('sees status changes, with the done stamp as the time', () => {
    const done = level({ ...started, items: started.items.map((i) => (i.id === 'a' ? { ...i, status: 'done', doneAt: '2026-10-01T18:00:00Z' } : i)) });
    const [e] = changesFromCommit(commit(started, done));
    expect(e).toMatchObject({ kind: 'done', subject: 'A', itemType: 'task', level: 'p/w/lvl', at: '2026-10-01T18:00:00Z', sha: 'c1' });
    expect(kinds(commit(done, started))).toEqual(['reopened:A']);
    const dropped = level({ ...started, items: started.items.map((i) => (i.id === 'c' ? { ...i, status: 'dropped' } : i)) });
    expect(changesFromCommit(commit(started, dropped))[0]).toMatchObject({ kind: 'dropped', subject: 'C', afterStart: true });
  });

  it('sees scope added after the start, removed items and edits', () => {
    const more = level({ ...started, items: [...started.items, { id: 'd', type: 'risk', title: 'D', status: 'todo' }] });
    expect(changesFromCommit(commit(started, more))[0]).toMatchObject({ kind: 'added', subject: 'D', itemType: 'risk', afterStart: true, afterClear: false });
    expect(kinds(commit(more, started))).toEqual(['removed:D']);
    const renamed = level({ ...started, items: started.items.map((i) => (i.id === 'a' ? { ...i, notes: 'more words' } : i)) });
    expect(kinds(commit(started, renamed))).toEqual(['edited:A']);
    // Before the start it's just planning.
    expect(changesFromCommit(commit(level(), level({ items: [...level().items, { id: 'd', type: 'task', title: 'D', status: 'todo' }] })))[0].afterStart).toBe(false);
  });

  it('sees steps inside dependencies', () => {
    const dep = (status: 'todo' | 'done') =>
      level({ ...started, items: [{ id: 'd', type: 'dependency', title: 'Dep', status: 'todo', subtasks: [{ id: 's', type: 'task', title: 'Step', status, ...(status === 'done' ? { doneAt: '2026-10-01T10:00:00Z' } : {}) }] }] });
    expect(kinds(commit(dep('todo'), dep('done')))).toEqual(['done:Step (in Dep)']);
  });

  it('sees ticks, starts, clears, polish and extensions', () => {
    const ticked = (l: Level, done: boolean): Level => ({ ...l, successCriteria: l.successCriteria.map((c) => (c.mvp ? { ...c, done, ...(done ? { doneAt: '2026-10-02T09:00:00Z' } : {}) } : c)) });
    const unstarted = level();
    const begun = { ...unstarted, startedAt: '2026-10-02T09:00:00Z', timeboxDays: unstarted.timeboxDays };
    expect(kinds(commit(unstarted, begun))).toEqual(['started:']);
    const clear = { ...ticked(begun, true), clearedAt: '2026-10-02T09:00:00Z' };
    expect(kinds(commit(begun, clear))).toEqual(['ticked:mvp-1', 'cleared:']);
    const { clearedAt: _, ...back } = ticked(clear, false);
    expect(kinds(commit(clear, back as Level))).toEqual(['unticked:mvp-1', 'uncleared:']);
    const polished = { ...clear, items: clear.items.map((i) => (i.id === 'b' ? { ...i, title: 'Better B' } : i)) };
    expect(changesFromCommit(commit(clear, polished))[0]).toMatchObject({ kind: 'edited', afterClear: true });
    expect(changesFromCommit(commit(begun, { ...begun, timeboxDays: begun.timeboxDays + 3 }))[0]).toMatchObject({ kind: 'extended', days: 3 });
  });

  it('ignores new level files, other files and junk', () => {
    expect(changesFromCommit(commit(undefined, started))).toEqual([]);
    expect(changesFromCommit({ sha: 'x', date: '2026-10-02T10:00:00Z', message: '', files: [{ path: 'data/p/project.json', before: '{}', after: '{"a":1}' }, { path: PATH, before: 'not json', after: '{' }] })).toEqual([]);
  });
});

describe('scanChanges', () => {
  it('orders events and feeds the streak merge', () => {
    const a = level({ startedAt: '2026-09-28T09:00:00Z' });
    const b = level({ ...a, items: a.items.map((i) => (i.id === 'a' ? { ...i, status: 'done', doneAt: '2026-10-03T10:00:00Z' } : i)) });
    const events = scanChanges([commit(b, a, '2026-10-04T10:00:00Z', 'c2'), commit(a, b, '2026-10-03T10:00:05Z', 'c1')]);
    expect(events.map((e) => e.kind)).toEqual(['done', 'reopened']);
    expect(changesAsHistory(events).map((e) => e.kind)).toEqual(['done', 'todo']);
  });
});
