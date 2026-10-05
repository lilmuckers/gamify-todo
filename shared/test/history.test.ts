import { describe, expect, it } from 'vitest';
import {
  activityByDay,
  commitMessage,
  historyEvents,
  makeOp,
  mergeHistory,
  parseCommit,
  progressStats,
  stampEvents,
  type HistoryCommit,
  type OpBody,
} from '../src';
import { at, level, workspace } from './fixtures';

const local = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h).getTime();
const iso = (m: number, d: number, h = 12) => new Date(local(m, d, h)).toISOString();
const commit = (message: string, date: string, sha = 'abc'): HistoryCommit => ({ sha, date, message });

describe('parseCommit', () => {
  it('reads a single edit', () => {
    expect(parseCommit(commit('quest: done: Write docs (p/w/lvl)', iso(10, 1)))).toEqual([
      { at: iso(10, 1), kind: 'done', level: 'p/w/lvl', subject: 'Write docs', sha: 'abc' },
    ]);
    expect(parseCommit(commit('quest: untick criterion mvp-1 (p/w/lvl)', iso(10, 1)))[0]).toMatchObject({ kind: 'untick', subject: 'mvp-1' });
  });

  it('reads every bullet of a batch, and keeps brackets in titles', () => {
    const msg = 'quest: 4 updates\n\n- done: Fix (the) tap (home/kitchen/sink)\n- edit Other (home/kitchen/sink)\n- tick criterion works (home/kitchen/sink)\n- todo: Shortlist (in Find a plumber) (home/kitchen/sink)';
    expect(parseCommit(commit(msg, iso(10, 2))).map((e) => [e.kind, e.subject])).toEqual([
      ['done', 'Fix (the) tap'],
      ['tick', 'works'],
      ['todo', 'Shortlist (in Find a plumber)'],
    ]);
  });

  it('ignores commits the app did not make', () => {
    expect(parseCommit(commit('Add a level by hand\n\n- done: X (p/w/l)', iso(10, 1)))).toEqual([]);
    expect(parseCommit(commit('quest: settings: hero = goth', iso(10, 1)))).toEqual([]);
  });

  it('understands the messages the app writes', () => {
    const lvl = level({ items: [...level().items, { id: 'd', type: 'dependency', title: 'Dep', status: 'todo', subtasks: [{ id: 's', type: 'task', title: 'Step', status: 'todo' }] }] });
    const ws = workspace(lvl);
    const ops = (
      [
        { kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' },
        { kind: 'setItemStatus', ...at, parentId: 'd', itemId: 's', status: 'done' },
        { kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: true },
        { kind: 'setItemStatus', ...at, itemId: 'a', status: 'todo' },
      ] as OpBody[]
    ).map((o) => makeOp(o));
    const one = parseCommit(commit(commitMessage([ops[0]], ws), iso(10, 1)));
    expect(one).toEqual([{ at: iso(10, 1), kind: 'done', level: 'p/w/lvl', subject: 'A', sha: 'abc' }]);
    const batch = parseCommit(commit(commitMessage(ops, ws), iso(10, 1)));
    expect(batch.map((e) => [e.kind, e.subject])).toEqual([
      ['done', 'A'],
      ['done', 'Step (in Dep)'],
      ['tick', 'mvp-1'],
      ['todo', 'A'],
    ]);
    // Stamps name steps the same way, so the two can be matched up.
    const done = workspace(level({ items: [{ id: 'd', type: 'dependency', title: 'Dep', status: 'todo', subtasks: [{ id: 's', type: 'task', title: 'Step', status: 'done', doneAt: iso(10, 1) }] }] }));
    expect(stampEvents(done).map((e) => e.subject)).toEqual(['Step (in Dep)']);
  });
});

describe('mergeHistory', () => {
  const data = workspace(
    level({
      items: [
        { id: 'a', type: 'task', title: 'A', status: 'done', doneAt: iso(10, 2, 9) },
        { id: 'b', type: 'task', title: 'B', status: 'todo' },
      ],
    }),
  );
  const history = historyEvents([
    // Synced a minute after the click: the stamp already has it.
    commit('quest: done: A (p/w/lvl)', new Date(local(10, 2, 9) + 60_000).toISOString(), 'c1'),
    // Done, then reopened: only the history remembers it.
    commit('quest: done: B (p/w/lvl)', iso(9, 28), 'c2'),
    commit('quest: todo: B (p/w/lvl)', iso(9, 29), 'c3'),
    // Ticked, un-ticked, ticked again (still un-ticked now).
    commit('quest: tick criterion bonus (p/w/lvl)', iso(9, 20), 'c4'),
    commit('quest: untick criterion bonus (p/w/lvl)', iso(9, 21), 'c5'),
  ]);

  it('adds what only the history knows, flagged as undone, without double counting', () => {
    const events = mergeHistory(stampEvents(data), history);
    expect(events.map((e) => [e.kind, e.subject, e.undone ?? false])).toEqual([
      ['done', 'A', false],
      ['ticked', 'bonus', true],
      ['done', 'B', true],
    ]);
    const days = activityByDay(events);
    expect(days.get('2026-09-28')).toMatchObject({ done: 1, undone: 1, total: 1 });
    expect(days.get('2026-10-02')).toMatchObject({ done: 1, undone: 0 });
  });

  it('matches a commit that synced days late to its stamp', () => {
    const late = historyEvents([commit('quest: done: A (p/w/lvl)', iso(10, 4), 'c6')]);
    expect(mergeHistory(stampEvents(data), late)).toHaveLength(1);
    // Too late to be the same click: it was done again.
    const again = historyEvents([commit('quest: done: A (p/w/lvl)', iso(10, 9), 'c7')]);
    expect(mergeHistory(stampEvents(data), again)).toHaveLength(2);
  });

  it('counts each round of done, reopened, done again', () => {
    const redo = workspace(level({ items: [{ id: 'a', type: 'task', title: 'A', status: 'done', doneAt: iso(10, 3) }] }));
    const h = historyEvents([
      commit('quest: done: A (p/w/lvl)', iso(9, 30), 'c1'),
      commit('quest: doing: A (p/w/lvl)', iso(10, 1), 'c2'),
      commit('quest: done: A (p/w/lvl)', iso(10, 3), 'c3'),
    ]);
    const events = mergeHistory(stampEvents(redo), h);
    expect(events.map((e) => [new Date(e.at).getDate(), e.undone ?? false])).toEqual([
      [3, false],
      [30, true],
    ]);
  });

  it('feeds streaks and totals', () => {
    const s = progressStats(data, local(10, 2, 18), 4, history);
    expect(s.total).toBe(3);
    expect(s.undone).toBe(2);
    expect(s.streak.longest).toBe(1);
  });
});
