import { historyEvents, type HistoryEvent } from '@quest/shared';
import type { DataSource } from './source';
import type { KV } from './store';

interface Cached {
  events: HistoryEvent[];
  /** Newest commit read so far, ISO: the next read starts here. */
  newest?: string;
  /** When the history was last read, ISO. */
  readAt?: string;
}

/** Don't ask the source again sooner than this, unless the stats page asks. */
const REFRESH_MS = 10 * 60 * 1000;

/**
 * What the commit history says was done, ticked, reopened or un-ticked,
 * for the stats page. Read from the source (GitHub's commit list, or
 * `git log` on the Docker editor), parsed once and cached in IndexedDB, so
 * later reads only fetch newer commits and it still works offline.
 * Sources with no history (the static site, the demo) leave it empty.
 */
export class ProgressHistory {
  events: HistoryEvent[] = [];
  status: 'none' | 'loading' | 'ready' | 'offline' = 'none';
  readAt?: string;
  private newest?: string;
  private reading?: Promise<void>;
  private lastTry = 0;

  constructor(
    private source: DataSource,
    private kv: KV,
    private onChange: () => void,
  ) {}

  get available(): boolean {
    return !!this.source.history;
  }

  /** The cache key: per repo and branch, since the label carries both. */
  private get key() {
    return `history:${this.source.id}:${this.source.label}`;
  }

  /** Loads the cache, then reads anything newer. */
  async init(): Promise<void> {
    if (!this.available) return;
    const cached = await this.kv.get<Cached>(this.key).catch(() => undefined);
    if (cached) {
      this.events = cached.events;
      this.newest = cached.newest;
      this.readAt = cached.readAt;
      this.status = 'ready';
      if (cached.events.length) this.onChange();
    }
    await this.refresh(0);
  }

  /** Reads commits newer than the cache, unless it was tried within `maxAge` ms. Failures keep the cache. */
  refresh(maxAge = REFRESH_MS): Promise<void> {
    if (!this.available || this.reading) return this.reading ?? Promise.resolve();
    if (Date.now() - this.lastTry < maxAge) return Promise.resolve();
    this.lastTry = Date.now();
    if (this.status === 'none') this.status = 'loading';
    this.reading = this.read().finally(() => (this.reading = undefined));
    return this.reading;
  }

  private async read() {
    try {
      const commits = await this.source.history!(this.newest);
      const seen = new Set(this.events.map(id));
      const fresh = historyEvents(commits).filter((e) => !seen.has(id(e)));
      const newest = commits.reduce((max, c) => (c.date > max ? c.date : max), this.newest ?? '');
      this.readAt = new Date().toISOString();
      const changed = fresh.length > 0 || this.status !== 'ready';
      if (fresh.length) this.events = [...this.events, ...fresh].sort((a, b) => a.at.localeCompare(b.at));
      this.newest = newest || this.newest;
      this.status = 'ready';
      await this.kv.set(this.key, { events: this.events, newest: this.newest, readAt: this.readAt } satisfies Cached).catch(() => undefined);
      if (changed) this.onChange();
    } catch {
      const was = this.status;
      this.status = this.events.length ? 'ready' : 'offline';
      if (was !== this.status) this.onChange();
    }
  }
}

const id = (e: HistoryEvent) => `${e.sha}|${e.kind}|${e.level}|${e.subject}`;
