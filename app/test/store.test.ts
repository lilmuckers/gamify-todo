import { describe, expect, it } from 'vitest';
import { ConflictError, applyOp, makeOp, type GameState } from '@quest/shared';
import { Store, type KV } from '../src/data/store';
import type { DataSource } from '../src/data/source';
import { state as fixture } from '../../shared/test/fixtures';

function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (k) => structuredClone(data.get(k)) as any,
    set: async (k, v) => void data.set(k, structuredClone(v)),
  };
}

/** Fake remote with a version counter and optional forced conflicts. */
function fakeRemote(initial: GameState) {
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
    set: (s: GameState) => (remote = { state: s, version: `v${++n}` }),
    get: () => remote,
    failTimes: (k: number) => (failNext = k),
  };
}

const at = { worldId: 'w', levelId: 'lvl' };
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
    expect(s2.state!.worlds.w.levels[0].items.find((i) => i.id === 'a')?.status).toBe('done');

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
});
