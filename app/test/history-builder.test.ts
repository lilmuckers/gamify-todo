import { describe, expect, it } from 'vitest';
import type { CommitChanges, Level, Workspace } from '@quest/shared';
import { HistoryBuilder, type BuildEnv } from '../src/data/history-builder';
import { inlineWork } from '../src/data/history-work';
import type { DataSource, HistoryRange } from '../src/data/source';
import type { KV } from '../src/data/store';

function memoryKV(): KV {
  const data = new Map<string, unknown>();
  return { get: async <T,>(k: string) => structuredClone(data.get(k)) as T | undefined, set: async (k: string, v: unknown) => void data.set(k, structuredClone(v)) };
}

const lvl = (done: string[], at: string): Level => ({
  id: 'l',
  name: 'L',
  deliverable: 'D',
  timeboxDays: 30,
  startedAt: '2026-01-01T09:00:00Z',
  successCriteria: [{ id: 'm', text: 'M', mvp: true, done: false }],
  items: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, type: 'task' as const, title: id.toUpperCase(), status: done.includes(id) ? ('done' as const) : ('todo' as const), ...(done.includes(id) ? { doneAt: at } : {}) })),
});

/** A repo whose n-th commit (1-based, one a day from 2 Jan) marks one more item done. */
function repo(n: number): CommitChanges[] {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.UTC(2026, 0, 2 + i, 10)).toISOString();
    return {
      sha: `c${i + 1}`,
      date,
      message: `quest: done: ${ids[i % 6].toUpperCase()} (p/w/l)`,
      files: [{ path: 'data/p/w/l.json', before: JSON.stringify(lvl(ids.slice(0, i % 6), date)), after: JSON.stringify(lvl(ids.slice(0, (i % 6) + 1), date)) }],
    };
  }).reverse();
}

function source(commits: () => CommitChanges[], opts: { id?: string; fail?: () => boolean } = {}) {
  const asked: HistoryRange[] = [];
  const src: DataSource = {
    id: opts.id ?? 'local',
    label: 'repo@main',
    caps: { canEdit: true, canReviewPRs: false, canPublish: false },
    load: async () => ({ state: { projects: {} }, version: 'v' }),
    async changesPage(range) {
      asked.push(range);
      if (opts.fail?.()) throw new Error('offline');
      const all = commits().filter((c) => (!range.since || c.date > range.since) && (!range.until || c.date <= range.until));
      const page = all.slice(0, range.limit);
      return { commits: page, more: all.length > range.limit, oldest: page.at(-1)?.date, requests: 1 + page.length * 3 };
    },
  };
  return { src, asked };
}

/** A clock that only moves when the builder sleeps, so tests run instantly. */
function fakeEnv(): BuildEnv & { clock: number; idles: number } {
  const env = {
    clock: Date.parse('2026-03-01T12:00:00Z'),
    idles: 0,
    now: () => env.clock,
    sleep: async (ms: number) => {
      env.clock += ms;
      await new Promise((r) => setTimeout(r, 0));
    },
    idle: async () => {
      env.idles++;
      await new Promise((r) => setTimeout(r, 0));
    },
  };
  return env;
}

const until = async (cond: () => boolean, tries = 2000) => {
  for (let i = 0; i < tries && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
  if (!cond()) throw new Error('timed out');
};

describe('HistoryBuilder', () => {
  it('builds newest first, a page at a time when idle, until it reaches the first commit', async () => {
    const { src, asked } = source(() => repo(60));
    const env = fakeEnv();
    const b = new HistoryBuilder(src, memoryKV(), inlineWork(), env, () => {});
    b.start();
    await until(() => b.commits > 0);
    // The first page is the newest commits.
    expect(b.oldest! > '2026-02-01').toBe(true);
    await until(() => b.complete);
    b.stop();
    expect(b.commits).toBe(60);
    expect(b.oldest).toBe('2026-01-02T10:00:00.000Z');
    expect(b.events.filter((e) => e.kind === 'done')).toHaveLength(60);
    // Waited for the interface to be idle before every page, and paged backwards by date.
    expect(env.idles).toBeGreaterThanOrEqual(3);
    expect(asked[0]).toEqual({ limit: 25 });
    expect(asked[1].until).toBe(repo(60)[24].date);
  });

  it('carries on next visit where it left off, then only reads new commits', async () => {
    const kv = memoryKV();
    let n = 60;
    const { src, asked } = source(() => repo(n));
    const first = new HistoryBuilder(src, kv, inlineWork(), fakeEnv(), () => {});
    first.start();
    await until(() => first.commits >= 25);
    first.stop();
    await until(() => asked.length >= 1);

    // A later visit: the saved progress loads at once and the build resumes.
    const env = fakeEnv();
    const second = new HistoryBuilder(src, kv, inlineWork(), env, () => {});
    await second.load();
    expect(second.commits).toBeGreaterThanOrEqual(25);
    expect(second.complete).toBe(false);
    second.start();
    await until(() => second.complete);
    expect(second.commits).toBe(60);

    // Two new commits: a refresh reads just those.
    n = 62;
    const before = asked.length;
    second.refresh();
    await until(() => second.commits === 62);
    second.stop();
    expect(asked.slice(before).some((r) => r.since === repo(60)[0].date)).toBe(true);
  });

  it('keeps to an hourly request budget on GitHub', async () => {
    const { src, asked } = source(() => repo(400), { id: 'gh:o/r' });
    const env = fakeEnv();
    const times: number[] = [];
    const page = src.changesPage!.bind(src);
    src.changesPage = (range) => {
      times.push(env.clock);
      return page(range);
    };
    const b = new HistoryBuilder(src, memoryKV(), inlineWork(), env, () => {});
    b.start();
    await until(() => asked.length > 19);
    b.stop();
    // 5 commits a page at 16 requests: 19 pages fit in 300 before it waits for the hour to pass.
    expect(times[18] - times[0]).toBeLessThan(30 * 60_000);
    expect(times[19] - times[0]).toBeGreaterThanOrEqual(60 * 60_000);
  });

  it('steps past an edge of commits it has already read', async () => {
    // Every commit at the same time: paging by date alone would ask for the same page forever.
    const same = repo(40).map((c) => ({ ...c, date: '2026-01-10T10:00:00.000Z' }));
    const { src } = source(() => same);
    const b = new HistoryBuilder(src, memoryKV(), inlineWork(), fakeEnv(), () => {});
    b.start();
    await until(() => b.complete);
    b.stop();
    expect(b.commits).toBe(25);
  });

  it('backs off when offline and keeps what it has', async () => {
    const env = fakeEnv();
    const failedAt: number[] = [];
    let failures = 0;
    const { src } = source(() => repo(60), {
      fail: () => {
        // Down for three tries once the first page is in.
        if (failures >= 3 || !b.commits) return false;
        failures++;
        failedAt.push(env.clock);
        return true;
      },
    });
    const b = new HistoryBuilder(src, memoryKV(), inlineWork(), env, () => {});
    b.start();
    await until(() => b.complete);
    b.stop();
    expect(b.commits).toBe(60);
    expect(b.error).toBe('offline');
    // Each retry waits longer: 30 s, then 60 s.
    expect(failedAt[1] - failedAt[0]).toBeGreaterThanOrEqual(30_000);
    expect(failedAt[2] - failedAt[1]).toBeGreaterThanOrEqual(60_000);
  });

  it('adds up the stats off the main path, and only again when something changed', async () => {
    const { src } = source(() => repo(6));
    let changes = 0;
    const b = new HistoryBuilder(src, memoryKV(), inlineWork(), fakeEnv(), () => changes++);
    b.start();
    await until(() => b.complete);
    b.stop();
    const ws: Workspace = { projects: {} };
    expect(b.statsFor(ws, [])).toBeUndefined();
    await until(() => !!b.stats);
    const first = b.stats;
    expect(first?.scanned).toBe(true);
    // Same inputs: the cached numbers, no new add-up.
    const seen = changes;
    expect(b.statsFor(ws, [])).toBe(first);
    await new Promise((r) => setTimeout(r, 5));
    expect(changes).toBe(seen);
    // A new workspace object: worked out again.
    b.statsFor({ projects: {} }, []);
    await until(() => b.stats !== first);
  });

  it('does nothing for sources without history', async () => {
    const src = { ...source(() => []).src, changesPage: undefined };
    const b = new HistoryBuilder(src, memoryKV(), inlineWork(), fakeEnv(), () => {});
    b.start();
    expect(b.status).toBe('none');
    expect(b.available).toBe(false);
  });
});
