import { describe, expect, it } from 'vitest';
import { ConflictError, applyOp, makeOp, type Workspace } from '@quest/shared';
import { keepUnchanged, Store, type KV } from '../src/data/store';
import type { DataSource } from '../src/data/source';
import { at, lvlOf, workspace as fixture } from '../../shared/test/fixtures';

function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (k) => structuredClone(data.get(k)) as any,
    set: async (k, v) => void data.set(k, structuredClone(v)),
  };
}

/** Fake remote with a version counter and optional forced conflicts. */
function fakeRemote(initial: Workspace) {
  let remote = { state: structuredClone(initial), version: 'v0' };
  let n = 0;
  const commits: string[] = [];
  let failNext = 0;
  const source: DataSource = {
    id: 'fake',
    label: 'fake',
    caps: { canEdit: true, canReviewPRs: false, canPublish: false },
    load: async () => structuredClone(remote),
    commit: async (_changes, message, base) => {
      if (failNext > 0 || base !== remote.version) {
        failNext--;
        throw new ConflictError();
      }
      commits.push(message);
      // Simulate applying the file changes by trusting the store's replay result.
      remote = { state: remote.state, version: `v${++n}` };
      return remote.version;
    },
  };
  return {
    source,
    commits,
    set: (s: Workspace) => (remote = { state: s, version: `v${++n}` }),
    get: () => remote,
    failTimes: (k: number) => (failNext = k),
  };
}

const opts = (online: { v: boolean }) => ({ online: () => online.v, debounceMs: 60_000, retryMs: 60_000 });

describe('Store', () => {
  it('applies edits locally and syncs them as one commit', async () => {
    const remote = fakeRemote(fixture());
    const online = { v: true };
    const store = new Store(remote.source, memoryKV(), opts(online));
    await store.start();
    expect(store.status).toBe('synced');
    store.dispatch({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' });
    store.dispatch({ kind: 'setItemStatus', ...at, itemId: 'b', status: 'doing' });
    expect(store.status).toBe('pending');
    await store.sync();
    expect(remote.commits).toHaveLength(1);
    expect(remote.commits[0]).toMatch(/2 updates/);
    expect(store.outbox).toHaveLength(0);
    expect(store.status).toBe('synced');
  });

  it('applies a batch all together (one commit) or not at all', async () => {
    const remote = fakeRemote(fixture());
    const store = new Store(remote.source, memoryKV(), opts({ v: true }));
    await store.start();
    const bad = store.dispatchBatch([
      { kind: 'setItemStatus', ...at, itemId: 'a', status: 'dropped' },
      { kind: 'setItemStatus', ...at, itemId: 'gone', status: 'dropped' },
    ]);
    expect(bad.ok).toBe(false);
    expect(store.outbox).toHaveLength(0);
    expect(lvlOf(store.state!).items[0].status).toBe('todo');
    const r = store.dispatchBatch([
      { kind: 'setItemStatus', ...at, itemId: 'c', status: 'dropped' },
      { kind: 'extendTimebox', ...at, days: 3 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.ops).toHaveLength(2);
    await store.sync();
    expect(remote.commits).toEqual([expect.stringMatching(/2 updates[\s\S]*dropped: C[\s\S]*extend time-box by 3 days/)]);
  });

  it('retracts an unsynced edit so nothing is committed', async () => {
    const remote = fakeRemote(fixture());
    const store = new Store(remote.source, memoryKV(), opts({ v: true }));
    await store.start();
    const r = store.dispatch({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' });
    expect(store.state!.projects.p.worlds.w.levels[0].items[0].status).toBe('done');
    expect(store.retract(r.op!.opId)).toBe(true);
    expect(store.state!.projects.p.worlds.w.levels[0].items[0].status).toBe('todo');
    expect(store.outbox).toHaveLength(0);
    await store.sync();
    expect(remote.commits).toHaveLength(0);
    // Already gone: nothing to retract.
    expect(store.retract(r.op!.opId)).toBe(false);
  });

  it("won't retract an edit that is being committed", async () => {
    const remote = fakeRemote(fixture());
    const store = new Store(remote.source, memoryKV(), opts({ v: true }));
    await store.start();
    const r = store.dispatch({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' });
    const syncing = store.sync();
    expect(store.retract(r.op!.opId)).toBe(false);
    await syncing;
    expect(remote.commits).toHaveLength(1);
    expect(store.retract(r.op!.opId)).toBe(false);
  });

  it('queues offline, survives reload, and replays onto a changed remote', async () => {
    const remote = fakeRemote(fixture());
    const kv = memoryKV();
    const online = { v: true };
    const s1 = new Store(remote.source, kv, opts(online));
    await s1.start();
    online.v = false;
    s1.dispatch({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' });
    s1.dispatch({ kind: 'setItemStatus', ...at, itemId: 'b', status: 'done' });
    await s1.sync();
    expect(s1.status).toBe('offline');
    expect(remote.commits).toHaveLength(0);

    // Meanwhile someone deleted item b remotely.
    remote.set(applyOp(remote.get().state, makeOp({ kind: 'deleteItem', ...at, itemId: 'b' })));

    // App restarts, still offline: cached snapshot + outbox restore the local view.
    const s2 = new Store(remote.source, kv, opts(online));
    const started = s2.start();
    await started;
    expect(s2.outbox).toHaveLength(2);
    expect(lvlOf(s2.state!).items.find((i) => i.id === 'a')?.status).toBe('done');

    online.v = true;
    await s2.sync();
    expect(remote.commits).toHaveLength(1);
    expect(s2.outbox).toHaveLength(0);
    expect(s2.conflicts).toHaveLength(1);
    expect(s2.conflicts[0].message).toMatch(/item "b"/);
  });

  it('retries when the remote moves during commit', async () => {
    const remote = fakeRemote(fixture());
    const store = new Store(remote.source, memoryKV(), opts({ v: true }));
    await store.start();
    store.dispatch({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' });
    remote.failTimes(1);
    await store.sync();
    expect(remote.commits).toHaveLength(1);
    expect(store.status).toBe('synced');
  });

  it('rejects edits that would make data invalid', async () => {
    const remote = fakeRemote(fixture());
    const store = new Store(remote.source, memoryKV(), opts({ v: true }));
    await store.start();
    const r = store.dispatch({
      kind: 'updateItem',
      ...at,
      itemId: 'a',
      patch: { dependsOn: ['b'] }, // b already depends on a → cycle
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cycle/);
    expect(store.outbox).toHaveLength(0);
  });

  it('reports polish penalties', async () => {
    const remote = fakeRemote(fixture());
    const store = new Store(remote.source, memoryKV(), opts({ v: true }));
    await store.start();
    store.dispatch({ kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: true });
    const r = store.dispatch({ kind: 'updateItem', ...at, itemId: 'a', patch: { title: 'Tweak' } });
    expect(r.polish).toBe(1);
  });
  it('ignores a lagging read of an older head, but takes genuine remote changes', async () => {
    const remote = fakeRemote(fixture());
    const kv = memoryKV();
    const first = new Store(remote.source, kv, opts({ v: true }));
    await first.start();
    first.dispatch({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' });
    await first.sync();
    const committed = first.version!;

    // Reload while the branch read still returns the commit before ours.
    const stale = { state: fixture(), version: 'v0' };
    let behind = true;
    const lagging: DataSource = {
      ...remote.source,
      load: async () => structuredClone(stale),
      isBehind: async (r, k) => behind && r === 'v0' && k === committed,
    };
    const second = new Store(lagging, kv, opts({ v: true }));
    await second.start();
    expect(second.version).toBe(committed);
    expect(lvlOf(second.state!).items[0].status).toBe('done');

    // A remote that really moved on (not an ancestor) wins.
    behind = false;
    await second.refresh();
    expect(second.version).toBe('v0');
    expect(lvlOf(second.state!).items[0].status).toBe('todo');
  });

  it('holds play-session edits until released, committing only the kept ones', async () => {
    const remote = fakeRemote(fixture());
    const kv = memoryKV();
    const store = new Store(remote.source, kv, opts({ v: true }));
    await store.start();
    store.hold(true);
    const a = store.dispatch({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' }).op!;
    const b = store.dispatch({ kind: 'setItemStatus', ...at, itemId: 'b', status: 'done' }).op!;
    await store.sync();
    expect(remote.commits).toHaveLength(0);
    expect(store.heldOps().map((o) => o.opId)).toEqual([a.opId, b.opId]);

    // A reload mid-session still knows which edits were held, and still waits.
    const reloaded = new Store(remote.source, kv, opts({ v: true }));
    await reloaded.start();
    expect([...reloaded.held]).toEqual([a.opId, b.opId]);
    expect(remote.commits).toHaveLength(0);

    store.hold(false);
    store.release([b.opId]);
    await store.sync();
    expect(remote.commits).toEqual([expect.stringContaining('done')]);
    expect(store.held.size).toBe(0);
    const items = lvlOf(store.state!).items;
    expect(items.find((i) => i.id === 'a')?.status).not.toBe('done');
    expect(items.find((i) => i.id === 'b')?.status).toBe('done');
  });

  it('skipping everything undoes the session and syncs nothing', async () => {
    const remote = fakeRemote(fixture());
    const store = new Store(remote.source, memoryKV(), opts({ v: true }));
    await store.start();
    store.hold(true);
    store.dispatch({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' });
    store.hold(false);
    store.release([]);
    await store.sync();
    expect(remote.commits).toHaveLength(0);
    expect(store.outbox).toHaveLength(0);
    expect(lvlOf(store.state!).items.find((i) => i.id === 'a')?.status).not.toBe('done');
  });

  it('keeps the same state object when a sync or refresh changes nothing', async () => {
    const remote = fakeRemote(fixture());
    const store = new Store(remote.source, memoryKV(), opts({ v: true }));
    await store.start();
    const loaded = store.state;
    await store.refresh();
    expect(store.state).toBe(loaded);
    store.dispatch({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' });
    const edited = store.state;
    expect(edited).not.toBe(loaded);
    await store.sync();
    // The synced state matches what the edit already showed: same object.
    expect(store.state).toBe(edited);
  });

  it('hands out a new state when the remote changed', async () => {
    const remote = fakeRemote(fixture());
    const store = new Store(remote.source, memoryKV(), opts({ v: true }));
    await store.start();
    const loaded = store.state;
    remote.set(applyOp(remote.get().state, makeOp({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' })));
    await store.refresh();
    expect(store.state).not.toBe(loaded);
    expect(lvlOf(store.state!).items.find((i) => i.id === 'a')?.status).toBe('done');
  });
});

describe('keepUnchanged', () => {
  const two = (): Workspace => {
    const ws = fixture();
    return { ...ws, projects: { ...ws.projects, q: structuredClone(ws.projects.p) } };
  };

  it('reuses untouched projects and replaces changed ones', () => {
    const prev = two();
    const next = structuredClone(prev);
    next.projects.q.overworld.title = 'Renamed';
    const out = keepUnchanged(prev, next);
    expect(out).not.toBe(prev);
    expect(out.projects.p).toBe(prev.projects.p);
    expect(out.projects.q).toBe(next.projects.q);
  });

  it('returns the previous workspace when nothing differs', () => {
    const prev = { ...two(), settings: { hero: 'classic' as const }, inbox: [{ id: 'i', type: 'task' as const, title: 'Idea' }] };
    expect(keepUnchanged(prev, structuredClone(prev))).toBe(prev);
  });

  it('notices added or removed projects, settings and inbox', () => {
    const prev = two();
    const { q: _, ...rest } = prev.projects;
    expect(keepUnchanged(prev, { ...prev, projects: rest })).not.toBe(prev);
    expect(keepUnchanged(prev, { ...structuredClone(prev), settings: { hero: 'classic' } })).not.toBe(prev);
    expect(keepUnchanged({ ...prev, inbox: [{ id: 'i', type: 'task' as const, title: 'Idea' }] }, structuredClone(prev)).inbox).toBeUndefined();
  });
});

describe('Store.isStale', () => {
  it('goes stale a few hours after the last pull, only while online', async () => {
    const remote = fakeRemote(fixture());
    const online = { v: true };
    const store = new Store(remote.source, memoryKV(), { ...opts(online), staleMs: 1000 });
    await store.start();
    const at = Date.parse(store.lastSyncedAt!);
    expect(store.isStale(at + 999)).toBe(false);
    expect(store.isStale(at + 1000)).toBe(true);
    online.v = false;
    expect(store.isStale(at + 1000)).toBe(false);
  });

  it('counts a failed pull, so errors are not retried every tick', async () => {
    const remote = fakeRemote(fixture());
    const online = { v: true };
    const store = new Store(remote.source, memoryKV(), { ...opts(online), staleMs: 1000 });
    remote.source.load = async () => {
      throw new Error('down');
    };
    const before = Date.now();
    await store.start();
    expect(store.status).toBe('error');
    expect(store.isStale(before + 500)).toBe(false);
    expect(store.isStale(Date.now() + 1000)).toBe(true);
  });
});
