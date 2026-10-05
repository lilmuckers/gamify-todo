import { describe, expect, it } from 'vitest';
import { doWork, inlineWork, workClient } from '../src/data/history-work';

describe('history work', () => {
  const commit = {
    sha: 'c1',
    date: '2026-10-02T10:00:00Z',
    message: '',
    files: [
      {
        path: 'data/p/w/l.json',
        before: JSON.stringify({ startedAt: '2026-10-01T09:00:00Z', timeboxDays: 5, successCriteria: [], items: [{ id: 'a', type: 'task', title: 'A', status: 'todo' }] }),
        after: JSON.stringify({ startedAt: '2026-10-01T09:00:00Z', timeboxDays: 5, successCriteria: [], items: [{ id: 'a', type: 'task', title: 'A', status: 'done', doneAt: '2026-10-02T09:00:00Z' }] }),
      },
    ],
  };

  it('compares commits and adds up stats', () => {
    expect(doWork({ kind: 'scan', commits: [commit] }).map((e) => e.kind)).toEqual(['done']);
    expect(doWork({ kind: 'stats', ws: { projects: {} }, quick: [], deep: [], now: Date.parse('2026-10-05T12:00:00Z') }).total).toBe(0);
  });

  it('runs inline where there are no workers', async () => {
    // Node has no Worker: the client falls back to the same work on this thread.
    expect(typeof Worker).toBe('undefined');
    const events = await workClient().run({ kind: 'scan', commits: [commit] });
    expect(events).toHaveLength(1);
    expect(await inlineWork().run({ kind: 'scan', commits: [] })).toEqual([]);
  });
});
