import { describe, expect, it, vi } from 'vitest';
import type { HistoryCommit } from '@quest/shared';
import { ProgressHistory } from '../src/data/history';
import type { DataSource } from '../src/data/source';
import type { KV } from '../src/data/store';

function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T,>(k: string) => data.get(k) as T | undefined,
    set: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
  };
}

const c = (sha: string, date: string, message: string): HistoryCommit => ({ sha, date, message });

function source(history?: (since?: string) => Promise<HistoryCommit[]>): DataSource {
  return { id: 'gh:o/r', label: 'o/r@main', caps: { canEdit: true, canReviewPRs: false, canPublish: false }, load: async () => ({ state: { projects: {} }, version: 'v' }), history };
}

describe('ProgressHistory', () => {
  it('reads the history, caches it, and then only asks for newer commits', async () => {
    const kv = memoryKV();
    const read = vi.fn(async (since?: string) =>
      since
        ? [c('s3', '2026-10-03T10:00:00Z', 'quest: todo: A (p/w/l)'), c('s2', '2026-10-02T10:00:00Z', 'quest: done: B (p/w/l)')]
        : [c('s2', '2026-10-02T10:00:00Z', 'quest: done: B (p/w/l)'), c('s1', '2026-10-01T10:00:00Z', 'quest: done: A (p/w/l)'), c('s0', '2026-09-30T10:00:00Z', 'Edit by hand')],
    );
    const changed = vi.fn();
    const h = new ProgressHistory(source(read), kv, changed);
    await h.init();
    expect(h.status).toBe('ready');
    expect(h.events.map((e) => `${e.kind} ${e.subject}`)).toEqual(['done A', 'done B']);
    expect(changed).toHaveBeenCalled();

    // A fresh page load starts from the cache and asks only for what's newer.
    const again = new ProgressHistory(source(read), kv, () => {});
    await again.init();
    expect(read).toHaveBeenLastCalledWith('2026-10-02T10:00:00Z');
    // The boundary commit comes back too, but isn't counted twice.
    expect(again.events.map((e) => `${e.kind} ${e.subject}`)).toEqual(['done A', 'done B', 'todo A']);
  });

  it('keeps the cache when offline', async () => {
    const kv = memoryKV();
    await new ProgressHistory(source(async () => [c('s1', '2026-10-01T10:00:00Z', 'quest: done: A (p/w/l)')]), kv, () => {}).init();
    const offline = new ProgressHistory(source(async () => Promise.reject(new Error('offline'))), kv, () => {});
    await offline.init();
    expect(offline.status).toBe('ready');
    expect(offline.events).toHaveLength(1);

    const never = new ProgressHistory(source(async () => Promise.reject(new Error('offline'))), memoryKV(), () => {});
    await never.init();
    expect(never.status).toBe('offline');
  });

  it('throttles reads and does nothing for sources with no history', async () => {
    const read = vi.fn(async () => [] as HistoryCommit[]);
    const h = new ProgressHistory(source(read), memoryKV(), () => {});
    await h.init();
    await h.refresh();
    await h.refresh(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    await h.refresh(0);
    expect(read).toHaveBeenCalledTimes(2);

    const none = new ProgressHistory(source(), memoryKV(), () => {});
    await none.init();
    expect(none.available).toBe(false);
    expect(none.status).toBe('none');
  });
});
