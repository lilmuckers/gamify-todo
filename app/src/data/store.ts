import {
  applyOp,
  changedFiles,
  commitMessage,
  ConflictError,
  findLevelAt,
  makeOp,
  OpConflict,
  polishPoints,
  replay,
  revalidate,
  validateWorkspace,
  type LevelAt,
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
  /** The op as queued, for undo. */
  op?: Op;
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
  /** Re-pull a tab left open this long without a sync, even if it's never hidden. */
  staleMs?: number;
}

const MAX_ATTEMPTS = 3;

/**
 * `next`, reusing `prev`'s objects wherever the content is the same. A sync
 * or refresh that changes nothing then hands back the very same state, and
 * untouched projects keep their identity, so views can skip work by
 * comparing references. Content that serializes differently counts as
 * changed (the safe way round).
 */
export function keepUnchanged(prev: Workspace | undefined, next: Workspace): Workspace {
  if (!prev || prev === next) return next;
  const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
  let changed = Object.keys(prev.projects).length !== Object.keys(next.projects).length;
  const projects: Workspace['projects'] = {};
  for (const [id, project] of Object.entries(next.projects)) {
    const old = prev.projects[id];
    projects[id] = old && same(old, project) ? old : project;
    changed ||= projects[id] !== old;
  }
  const out: Workspace = { ...next, projects };
  if (next.settings && same(prev.settings, next.settings)) out.settings = prev.settings;
  if (next.inbox && same(prev.inbox, next.inbox)) out.inbox = prev.inbox;
  changed ||= out.settings !== prev.settings || out.inbox !== prev.inbox;
  return changed ? out : prev;
}

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
  /**
   * Ops made while holding (a play session): queued but not synced until the
   * player picks which to keep. Persisted, so a closed tab asks next time.
   */
  held = new Set<string>();
  private holding = false;
  /** Called when a sync attempt finishes (analytics). */
  onSyncResult?: (r: { result: 'ok' | 'offline' | 'error' | 'conflict'; ops: number; conflicts: number; error?: unknown }) => void;
  status: SyncStatus = 'loading';
  error?: string;
  issues: Issue[] = [];
  lastSyncedAt?: string;

  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private syncing?: Promise<void>;
  private again = false;
  /** Ops being committed right now: too late to retract. */
  private inFlight = new Set<string>();
  private online: () => boolean;
  private debounceMs: number;
  private retryMs: number;
  private staleMs: number;
  private pulledAt = 0;

  constructor(
    public source: DataSource,
    private kv: KV,
    opts: StoreOptions = {},
  ) {
    this.online = opts.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine));
    this.debounceMs = opts.debounceMs ?? 1500;
    this.retryMs = opts.retryMs ?? 30_000;
    this.staleMs = opts.staleMs ?? 3 * 60 * 60 * 1000;
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
    this.rebuild();
  }

  /** State = the remote base plus every queued edit (keeping what didn't change). */
  private rebuild() {
    const prev = this.state;
    this.state = keepUnchanged(prev, replay(this.base!, this.outbox).state);
    // Same state, same issues: skip revalidating everything.
    if (this.state !== prev) this.issues = revalidate(prev, this.issues, this.state);
  }

  async start(): Promise<void> {
    const [snap, outbox, conflicts, held] = await Promise.all([
      this.kv.get<Snapshot>(this.key('snapshot')),
      this.kv.get<Op[]>(this.key('outbox')),
      this.kv.get<Conflict[]>(this.key('conflicts')),
      this.kv.get<string[]>(this.key('held')),
    ]);
    this.outbox = outbox ?? [];
    this.conflicts = conflicts ?? [];
    const queued = new Set(this.outbox.map((o) => o.opId));
    this.held = new Set((held ?? []).filter((id) => queued.has(id)));
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
    this.pulledAt = Date.now();
    try {
      const remote = await this.freshest(await this.source.load());
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

  /**
   * The loaded remote, unless it's older than the head we already know (a read
   * that lags behind our own commit): then the known head, so a reload doesn't
   * roll recent edits back.
   */
  private async freshest(remote: { state: Workspace; version: string }) {
    const known = this.base && this.version;
    if (!known || remote.version === this.version || !this.source.isBehind) return remote;
    try {
      if (await this.source.isBehind(remote.version, this.version!)) return { state: this.base!, version: this.version! };
    } catch {
      // Can't tell: trust the remote.
    }
    return remote;
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
      this.kv.set(this.key('held'), [...this.held]),
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
    const issues = revalidate(this.state, this.issues, next);
    if (issues.length > before) {
      const known = new Set(this.issues.map((i) => i.file + i.path + i.message));
      const fresh = issues.find((i) => !known.has(i.file + i.path + i.message)) ?? issues[0];
      return { ok: false, error: `${fresh.path}: ${fresh.message}` };
    }
    const polish = 'levelId' in op ? this.polishDelta(this.state, next, op) : 0;
    this.state = next;
    this.issues = issues;
    this.outbox.push(op);
    if (this.holding) this.held.add(op.opId);
    this.status = this.idleStatus();
    void this.saveQueue();
    this.emit();
    this.schedule(this.debounceMs);
    return { ok: true, polish, op };
  }

  /**
   * Applies several edits together, or none of them: they queue side by side,
   * so they go out in one commit (e.g. a weekly-review scope cut).
   */
  dispatchBatch(bodies: OpBody[]): DispatchResult & { ops?: Op[] } {
    if (!this.caps.canEdit) return { ok: false, error: 'Read-only mode' };
    if (!this.state) return { ok: false, error: 'Still loading' };
    if (!bodies.length) return { ok: true, ops: [] };
    const ops = bodies.map((b) => makeOp(b));
    let next = this.state;
    try {
      for (const op of ops) next = applyOp(next, op);
    } catch (err) {
      if (err instanceof OpConflict) return { ok: false, error: err.message };
      throw err;
    }
    const issues = revalidate(this.state, this.issues, next);
    if (issues.length > this.issues.length) return { ok: false, error: `${issues[0].path}: ${issues[0].message}` };
    this.state = next;
    this.issues = issues;
    this.outbox.push(...ops);
    if (this.holding) for (const op of ops) this.held.add(op.opId);
    this.status = this.idleStatus();
    void this.saveQueue();
    this.emit();
    this.schedule(this.debounceMs);
    return { ok: true, ops };
  }

  private polishDelta(a: Workspace, b: Workspace, at: LevelAt) {
    const la = findLevelAt(a, at);
    const lb = findLevelAt(b, at);
    return la && lb ? polishPoints(lb) - polishPoints(la) : 0;
  }

  /** Starts or stops holding new edits back from syncing (see `held`). */
  hold(on: boolean) {
    this.holding = on;
  }

  /** Held edits, oldest first. */
  heldOps(): Op[] {
    return this.outbox.filter((o) => this.held.has(o.opId));
  }

  /**
   * Ends a hold: held edits in `keep` go out with the next sync, the rest are
   * taken back as if they never happened.
   */
  release(keep: Iterable<string>) {
    const kept = new Set(keep);
    const drop = new Set([...this.held].filter((id) => !kept.has(id)));
    this.held.clear();
    if (drop.size && this.base) {
      this.outbox = this.outbox.filter((o) => !drop.has(o.opId));
      this.rebuild();
    }
    this.status = this.idleStatus();
    void this.saveQueue();
    this.emit();
    if (this.outbox.length) void this.sync();
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
      this.inFlight.clear();
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
    // Held edits wait for the player's say-so; ops queue in order, so everything waits.
    if (!this.source.commit || !this.outbox.length || this.holding || this.held.size) return;
    if (!this.online()) {
      this.status = 'offline';
      this.emit();
      this.onSyncResult?.({ result: 'offline', ops: this.outbox.length, conflicts: 0 });
      return;
    }
    this.status = 'syncing';
    this.emit();
    const batch = [...this.outbox];
    for (const o of batch) this.inFlight.add(o.opId);
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const remote = await this.freshest(await this.source.load());
        const r = replay(remote.state, batch);
        let version = remote.version;
        if (r.applied.length) {
          const remoteIssues = validateWorkspace(remote.state);
          const remoteOk = remoteIssues.length === 0;
          // Replayed edits share untouched projects with the remote: only re-check the rest.
          const issues = revalidate(remote.state, remoteIssues, r.state);
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
        this.onSyncResult?.({ result: r.conflicts.length ? 'conflict' : 'ok', ops: r.applied.length, conflicts: r.conflicts.length });
        return;
      }
      this.status = 'error';
      this.error = 'Remote kept changing; will retry';
      this.schedule(this.retryMs);
      this.onSyncResult?.({ result: 'error', ops: batch.length, conflicts: 0 });
    } catch (err) {
      this.fail(err);
      this.schedule(this.retryMs);
      this.onSyncResult?.({ result: 'error', ops: batch.length, conflicts: 0, error: err });
    }
    this.emit();
  }

  /**
   * Takes back an edit that hasn't been synced yet, as if it never happened
   * (no commit, no polish counted). False when it's already synced or syncing.
   */
  retract(opId: string): boolean {
    if (this.inFlight.has(opId) || !this.base) return false;
    const before = this.outbox.length;
    this.outbox = this.outbox.filter((o) => o.opId !== opId);
    if (this.outbox.length === before) return false;
    this.held.delete(opId);
    this.rebuild();
    this.status = this.idleStatus();
    void this.saveQueue();
    this.emit();
    return true;
  }

  dismissConflicts() {
    this.conflicts = [];
    void this.saveQueue();
    this.emit();
  }

  /** Throws away queued edits (after the user confirms). */
  discardOutbox() {
    this.outbox = [];
    this.held.clear();
    if (this.base && this.version) this.setBase(this.base, this.version);
    this.status = this.idleStatus();
    void this.saveQueue();
    this.emit();
  }

  /** Online, and the last pull (good or failed) is older than `staleMs`. */
  isStale(now = Date.now()): boolean {
    if (!this.online() || this.status === 'loading') return false;
    const last = Math.max(this.pulledAt, this.lastSyncedAt ? Date.parse(this.lastSyncedAt) : 0);
    return now - last >= this.staleMs;
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
      else if (this.isStale() && document.visibilityState === 'visible') void this.refresh();
    }, this.retryMs);
  }
}
