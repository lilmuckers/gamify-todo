import { scanChanges, type ChangeEvent, type ScanProgress } from '@quest/shared';
import type { DataSource } from './source';
import type { KV } from './store';

interface Cached {
  events: ChangeEvent[];
  /** Newest commit compared so far, ISO: the next scan starts here. */
  newest?: string;
  /** Every commit compared so far. */
  shas: string[];
  /** When the last scan finished, ISO. */
  scannedAt: string;
}

/** A finished scan is fresh enough for this long; after that, opening the page reads newer commits. */
const FRESH_MS = 10 * 60 * 1000;

const id = (e: ChangeEvent) => `${e.sha}|${e.kind}|${e.level}|${e.subject}`;

/**
 * The detailed stats' history: what every data commit changed, compared
 * level file by level file (`scanChanges`). The first scan can take a
 * while on GitHub (one request per commit and two per changed level), so
 * progress is reported as it goes, and the result is cached in IndexedDB
 * per repo and branch. Later scans only compare newer commits; offline, the
 * cache is used as it is.
 */
export class DeepHistory {
  events: ChangeEvent[] = [];
  status: 'none' | 'idle' | 'scanning' | 'ready' | 'offline' = 'idle';
  progress?: ScanProgress;
  scannedAt?: string;
  private shas = new Set<string>();
  error?: string;
  private newest?: string;
  private loaded = false;
  private scanning?: Promise<void>;
  private lastEmit = 0;

  constructor(
    private source: DataSource,
    private kv: KV,
    private onChange: () => void,
  ) {
    if (!source.changes) this.status = 'none';
  }

  get available() {
    return !!this.source.changes;
  }

  /** Commits compared so far. */
  get commits() {
    return this.shas.size;
  }

  private get key() {
    return `deep:${this.source.id}:${this.source.label}`;
  }

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    const c = await this.kv.get<Cached>(this.key).catch(() => undefined);
    if (!c) return;
    this.events = c.events;
    this.newest = c.newest;
    this.shas = new Set(c.shas);
    this.scannedAt = c.scannedAt;
    this.status = 'ready';
  }

  /** Scans newer commits when the cache is stale (or `full`: everything again). */
  scan(opts: { full?: boolean } = {}): Promise<void> {
    if (!this.available) return Promise.resolve();
    return (this.scanning ??= this.run(!!opts.full).finally(() => (this.scanning = undefined)));
  }

  private async run(full: boolean) {
    await this.load();
    if (!full && this.scannedAt && Date.now() - Date.parse(this.scannedAt) < FRESH_MS) {
      this.onChange();
      return;
    }
    const was = this.status;
    this.status = 'scanning';
    this.error = undefined;
    this.progress = { phase: 'reading', done: 0, total: 0 };
    this.onChange();
    try {
      const commits = await this.source.changes!({
        since: full ? undefined : this.newest,
        onProgress: (p) => {
          this.progress = p;
          // A repaint per commit is plenty; a burst of fast ones shouldn't redraw every time.
          const now = Date.now();
          if (now - this.lastEmit > 80 || p.done === p.total) {
            this.lastEmit = now;
            this.onChange();
          }
        },
      });
      this.progress = { phase: 'adding', done: commits.length, total: commits.length };
      this.onChange();
      const found = scanChanges(commits);
      const base = full ? [] : this.events;
      const seen = new Set(base.map(id));
      const fresh = found.filter((e) => !seen.has(id(e)));
      this.events = [...base, ...fresh].sort((a, b) => a.at.localeCompare(b.at));
      this.newest = commits.reduce((max, c) => (c.date > max ? c.date : max), full ? '' : (this.newest ?? '')) || this.newest;
      // The commit at `since` comes back on the next scan too: a set counts it once.
      if (full) this.shas.clear();
      for (const c of commits) this.shas.add(c.sha);
      this.scannedAt = new Date().toISOString();
      this.status = 'ready';
      this.progress = undefined;
      await this.kv
        .set(this.key, { events: this.events, newest: this.newest, shas: [...this.shas], scannedAt: this.scannedAt } satisfies Cached)
        .catch(() => undefined);
    } catch (err) {
      this.progress = undefined;
      this.error = (err as Error).message;
      this.status = was === 'ready' || this.events.length ? 'ready' : 'offline';
    }
    this.onChange();
  }
}
