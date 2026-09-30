import {
  applyOp,
  changedFiles,
  commitMessage,
  ConflictError,
  makeOp,
  OpConflict,
  polishPoints,
  replay,
  validateWorkspace,
  type Workspace,
  type Issue,
  type Op,
  type OpBody,
} from '@quest/shared';
import type { DataSource } from './source';

/** Minimal async key-value store (IndexedDB in the browser, a Map in tests). */
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export type SyncStatus = 'loading' | 'readonly' | 'synced' | 'pending' | 'syncing' | 'offline' | 'error';

export interface Conflict {
  op: Op;
  message: string;
}

export interface DispatchResult {
  ok: boolean;
  error?: string;
  /** Polish points added by this edit (perfectionism penalty). */
  polish?: number;
}

interface Snapshot {
  state: Workspace;
  version: string;
  at: string;
}

export interface StoreOptions {
  online?: () => boolean;
  debounceMs?: number;
  retryMs?: number;
}

const MAX_ATTEMPTS = 3;

/**
 * Holds the game state. Edits are ops: applied locally at once, queued in a
 * persistent outbox, and replayed onto the latest remote state when syncing —
 * so offline edits survive reloads and merge cleanly with remote changes.
 */
export class Store {
  state?: Workspace;
  /** Last state known to be on the remote. */
  base?: Workspace;
  version?: string;
  outbox: Op[] = [];
  conflicts: Conflict[] = [];
  status: SyncStatus = 'loading';
  error?: string;
  issues: Issue[] = [];
  lastSyncedAt?: string;

  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private syncing?: Promise<void>;
  private again = false;
  private online: () => boolean;
  private debounceMs: number;
  private retryMs: number;

  constructor(
    public source: DataSource,
    private kv: KV,
    opts: StoreOptions = {},
  ) {
    this.online = opts.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine));
    this.debounceMs = opts.debounceMs ?? 1500;
    this.retryMs = opts.retryMs ?? 30_000;
  }

  get caps() {
    return this.source.caps;
  }

  // v2: project-folder data layout; older caches are ignored.
  private key(name: string) {
    return `v2:${this.source.id}:${name}`;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private idleStatus(): SyncStatus {
    if (!this.caps.canEdit) return 'readonly';
    if (this.outbox.length) return this.online() ? 'pending' : 'offline';
    return 'synced';
  }

  private setBase(base: Workspace, version: string) {
    this.base = base;
    this.version = version;
    this.state = replay(base, this.outbox).state;
    this.issues = validateWorkspace(this.state);
  }

  async start(): Promise<void> {
    const [snap, outbox, conflicts] = await Promise.all([
      this.kv.get<Snapshot>(this.key('snapshot')),
      this.kv.get<Op[]>(this.key('outbox')),
      this.kv.get<Conflict[]>(this.key('conflicts')),
    ]);
    this.outbox = outbox ?? [];
    this.conflicts = conflicts ?? [];
    if (snap) {
      this.setBase(snap.state, snap.version);
      this.lastSyncedAt = snap.at;
      this.status = this.online() ? 'loading' : 'offline';
      this.emit();
    }
    await this.refresh();
    if (this.outbox.length) await this.sync();
  }

  /** Pulls the latest remote state (when nothing is queued). */
  async refresh(): Promise<void> {
    if (this.outbox.length && this.caps.canEdit) return this.sync();
    try {
      const remote = await this.source.load();
      this.setBase(remote.state, remote.version);
      this.lastSyncedAt = new Date().toISOString();
      this.status = this.idleStatus();
      this.error = undefined;
      await this.saveSnapshot();
    } catch (err) {
      this.fail(err);
    }
    this.emit();
  }

  private fail(err: unknown) {
    if (!this.online()) {
      this.status = 'offline';
      return;
    }
    this.status = 'error';
    this.error = err instanceof Error ? err.message : String(err);
  }

  private saveSnapshot() {
    if (!this.base || !this.version) return Promise.resolve();
    return this.kv.set(this.key('snapshot'), {
      state: this.base,
      version: this.version,
      at: this.lastSyncedAt ?? new Date().toISOString(),
    } satisfies Snapshot);
  }

  private saveQueue() {
    return Promise.all([
      this.kv.set(this.key('outbox'), this.outbox),
      this.kv.set(this.key('conflicts'), this.conflicts),
    ]);
  }

  dispatch(body: OpBody): DispatchResult {
    if (!this.caps.canEdit) return { ok: false, error: 'Read-only mode' };
    if (!this.state) return { ok: false, error: 'Still loading' };
    const op = makeOp(body);
    let next: Workspace;
    try {
      next = applyOp(this.state, op);
    } catch (err) {
      if (err instanceof OpConflict) return { ok: false, error: err.message };
      throw err;
    }
    const before = this.issues.length;
    const issues = validateWorkspace(next);
    if (issues.length > before) {
      const known = new Set(this.issues.map((i) => i.file + i.path + i.message));
      const fresh = issues.find((i) => !known.has(i.file + i.path + i.message)) ?? issues[0];
      return { ok: false, error: `${fresh.path}: ${fresh.message}` };
    }
    const polish = 'levelId' in op ? this.polishDelta(this.state, next, op.projectId, op.worldId, op.levelId) : 0;
    this.state = next;
    this.issues = issues;
    this.outbox.push(op);
    this.status = this.idleStatus();
    void this.saveQueue();
    this.emit();
    this.schedule(this.debounceMs);
    return { ok: true, polish };
  }

  private polishDelta(a: Workspace, b: Workspace, projectId: string, worldId: string, levelId: string) {
    const find = (ws: Workspace) => ws.projects[projectId]?.worlds[worldId]?.levels.find((l) => l.id === levelId);
    const la = find(a);
    const lb = find(b);
    return la && lb ? polishPoints(lb) - polishPoints(la) : 0;
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), ms);
  }

  /** Pushes queued ops. Safe to call any time; concurrent calls coalesce. */
  sync(): Promise<void> {
    if (this.syncing) {
      this.again = true;
      return this.syncing;
    }
    this.syncing = this.doSync().finally(() => {
      this.syncing = undefined;
      if (this.again) {
        this.again = false;
        void this.sync();
      }
    });
    return this.syncing;
  }

  private async doSync(): Promise<void> {
    clearTimeout(this.timer);
    if (!this.source.commit || !this.outbox.length) return;
    if (!this.online()) {
      this.status = 'offline';
      this.emit();
      return;
    }
    this.status = 'syncing';
    this.emit();
    const batch = [...this.outbox];
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const remote = await this.source.load();
        const r = replay(remote.state, batch);
        let version = remote.version;
        if (r.applied.length) {
          const remoteOk = validateWorkspace(remote.state).length === 0;
          const issues = validateWorkspace(r.state);
          if (remoteOk && issues.length) {
            this.status = 'error';
            this.error = `Queued edits would make data invalid: ${issues[0].path} ${issues[0].message}`;
            this.emit();
            return;
          }
          const changes = changedFiles(remote.state, r.state);
          if (Object.keys(changes).length) {
            try {
              version = await this.source.commit(
                changes,
                commitMessage(r.applied, r.state),
                remote.version,
              );
            } catch (err) {
              if (err instanceof ConflictError) continue;
              throw err;
            }
          }
        }
        const done = new Set(batch.map((o) => o.opId));
        this.outbox = this.outbox.filter((o) => !done.has(o.opId));
        this.conflicts.push(...r.conflicts);
        this.lastSyncedAt = new Date().toISOString();
        this.error = undefined;
        this.setBase(r.state, version);
        this.status = this.idleStatus();
        await Promise.all([this.saveQueue(), this.saveSnapshot()]);
        this.emit();
        return;
      }
      this.status = 'error';
      this.error = 'Remote kept changing; will retry';
      this.schedule(this.retryMs);
    } catch (err) {
      this.fail(err);
      this.schedule(this.retryMs);
    }
    this.emit();
  }

  dismissConflicts() {
    this.conflicts = [];
    void this.saveQueue();
    this.emit();
  }

  /** Throws away queued edits (after the user confirms). */
  discardOutbox() {
    this.outbox = [];
    if (this.base && this.version) this.setBase(this.base, this.version);
    this.status = this.idleStatus();
    void this.saveQueue();
    this.emit();
  }

  /** Wires browser events: reconnect, tab focus, periodic retry. */
  attachBrowserEvents() {
    window.addEventListener('online', () => void this.refresh());
    window.addEventListener('offline', () => {
      this.status = this.idleStatus();
      this.emit();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.refresh();
    });
    setInterval(() => {
      if (this.outbox.length && this.online()) void this.sync();
    }, this.retryMs);
  }
}
