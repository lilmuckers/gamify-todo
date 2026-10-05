import { describe, expect, it, vi } from 'vitest';
import type { CommitChanges, Level, ScanProgress } from '@quest/shared';
import { DeepHistory } from '../src/data/deep-history';
import type { DataSource } from '../src/data/source';
import type { KV } from '../src/data/store';

function memoryKV(): KV {
  const data = new Map<string, unknown>();
  return { get: async <T,>(k: string) => structuredClone(data.get(k)) as T | undefined, set: async (k: string, v: unknown) => void data.set(k, structuredClone(v)) };
}

const lvl = (done: boolean, at = '2026-09-02T09:00:00Z'): Level => ({
  id: 'l',
  name: 'L',
  deliverable: 'D',
  timeboxDays: 5,
  startedAt: '2026-09-01T09:00:00Z',
  successCriteria: [{ id: 'm', text: 'M', mvp: true, done: false }],
  items: [{ id: 'a', type: 'task', title: 'A', status: done ? 'done' : 'todo', ...(done ? { doneAt: at } : {}) }],
});
const commit = (sha: string, date: string, from: boolean, to: boolean): CommitChanges => ({
  sha,
  date,
  message: '',
  files: [{ path: 'data/p/w/l.json', before: JSON.stringify(lvl(from)), after: JSON.stringify(lvl(to, date)) }],
});

function source(changes?: DataSource['changes']): DataSource {
  return { id: 'gh:o/r', label: 'o/r@main', caps: { canEdit: true, canReviewPRs: false, canPublish: false }, load: async () => ({ state: { projects: {} }, version: 'v' }), changes };
}

describe('DeepHistory', () => {
  it('scans with progress, caches, and then only compares newer commits', async () => {
    const kv = memoryKV();
    const seen: ScanProgress[] = [];
    const read = vi.fn(async (opts: { since?: string; onProgress?: (p: ScanProgress) => void }) => {
      opts.onProgress?.({ phase: 'comparing', done: 1, total: 2 });
      return opts.since
        ? [commit('c2', '2026-09-03T09:00:00Z', true, false), commit('c3', '2026-09-04T09:00:00Z', false, true)]
        : [commit('c1', '2026-09-02T09:00:05Z', false, true), commit('c2', '2026-09-03T09:00:00Z', true, false)];
    });
    let d!: DeepHistory;
    d = new DeepHistory(source(read), kv, () => d.progress && seen.push(d.progress));
    await d.scan();
    expect(d.status).toBe('ready');
    expect(d.commits).toBe(2);
    expect(d.events.map((e) => e.kind)).toEqual(['done', 'reopened']);
    expect(seen.map((p) => p.phase)).toContain('comparing');
    // Fresh: opening again doesn't scan.
    await d.scan();
    expect(read).toHaveBeenCalledTimes(1);

    // A later visit (stale cache) reads from the newest commit on, counting the boundary commit once.
    vi.useFakeTimers({ now: Date.now() + 11 * 60_000 });
    const later = new DeepHistory(source(read), kv, () => {});
    await later.scan();
    vi.useRealTimers();
    expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ since: '2026-09-03T09:00:00Z' }));
    expect(later.commits).toBe(3);
    expect(later.events.map((e) => e.kind)).toEqual(['done', 'reopened', 'done']);

    // A full rescan starts over.
    await later.scan({ full: true });
    expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ since: undefined }));
  });

  it('keeps the cache when a scan fails, and does nothing without history', async () => {
    const kv = memoryKV();
    await new DeepHistory(source(async () => [commit('c1', '2026-09-02T09:00:05Z', false, true)]), kv, () => {}).scan();
    vi.useFakeTimers({ now: Date.now() + 11 * 60_000 });
    const offline = new DeepHistory(source(async () => Promise.reject(new Error('offline'))), kv, () => {});
    await offline.scan();
    vi.useRealTimers();
    expect(offline.status).toBe('ready');
    expect(offline.error).toBe('offline');
    expect(offline.events).toHaveLength(1);

    const never = new DeepHistory(source(async () => Promise.reject(new Error('offline'))), memoryKV(), () => {});
    await never.scan();
    expect(never.status).toBe('offline');

    const none = new DeepHistory(source(), memoryKV(), () => {});
    await none.scan();
    expect(none.status).toBe('none');
  });
});
