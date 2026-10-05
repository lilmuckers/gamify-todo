import type { ChangeEvent, DetailedStats, HistoryEvent, Workspace } from '@quest/shared';
import type { DataSource, HistoryRange } from './source';
import type { KV } from './store';
import type { WorkClient } from './history-work';

/** A slice of history still to read: commits after `since`, up to `until`. */
type Range = Omit<HistoryRange, 'limit'>;

interface Saved {
  events: ChangeEvent[];
  shas: string[];
  /** Still to read, most urgent first. Empty once everything has been read. */
  ranges: Range[];
  /** Newest and oldest commit dates read so far. */
  newest?: string;
  oldest?: string;
  builtAt?: string;
  /** The last numbers worked out, so the page opens instantly next time. */
  stats?: DetailedStats;
}

/** What the builder needs from the page around it: a clock, sleep, and when the UI is busy. */
export interface BuildEnv {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Resolves once the interface is idle (no input, no sync, not playing, tab visible). */
  idle(): Promise<void>;
}

/** How hard to work: commits per page, and the pause between pages (background / while watched). */
const PACE = {
  github: { limit: 5, gap: 8_000, watched: 1_500, perHour: 300, watchedPerHour: 1_200 },
  other: { limit: 25, gap: 1_500, watched: 300, perHour: Infinity, watchedPerHour: Infinity },
  // The demo's history is ready-made: take it in one go.
  demo: { limit: 5_000, gap: 0, watched: 0, perHour: Infinity, watchedPerHour: Infinity },
};
const HOUR = 3_600_000;
/** New commits are looked for this often (and after each sync). */
const FRESH_MS = 10 * 60_000;

const eventId = (e: ChangeEvent) => `${e.sha}|${e.kind}|${e.level}|${e.subject}`;

/**
 * Builds the detailed stats' history a little at a time, in the
 * background, from the first visit: newest commits first (so recent stats
 * are useful at once), then further back a page at a time until it reaches
 * the start. Every page is saved (IndexedDB, per repo and branch), so it
 * carries on where it left off next visit, and once it's caught up only new
 * commits are read. It never gets in the way: it waits for the interface to
 * be idle before each page, keeps to a request budget on GitHub, and the
 * parsing and adding up happen on a worker thread.
 */
export class HistoryBuilder {
  /** idle: not started yet; waiting: out of request budget for now; offline: can't read the history. */
  status: 'none' | 'idle' | 'waiting' | 'building' | 'complete' | 'offline' = 'idle';
  events: ChangeEvent[] = [];
  newest?: string;
  oldest?: string;
  builtAt?: string;
  error?: string;
  stats?: DetailedStats;
  private shas = new Set<string>();
  private ranges: Range[] = [{}];
  private watched = false;
  private loaded?: Promise<void>;
  private running = false;
  private wake?: () => void;
  private stopped = false;
  private spent: { from: number; n: number } = { from: 0, n: 0 };
  private statsKey?: string;
  private statsWanted?: { ws: Workspace; quick: HistoryEvent[]; key: string };
  private statsRunning = false;
  private lastFresh = 0;
  private version = 0;

  constructor(
    private source: DataSource,
    private kv: KV,
    private work: WorkClient,
    private env: BuildEnv,
    private onChange: () => void,
  ) {
    if (!source.changesPage) this.status = 'none';
  }

  get available() {
    return !!this.source.changesPage;
  }

  /** Commits read so far. */
  get commits() {
    return this.shas.size;
  }

  /** Everything back to the first commit has been read (checking for new commits doesn't count). */
  get complete() {
    return this.ranges.every((r) => r.since !== undefined);
  }

  private get key() {
    return `history-build:${this.source.id}:${this.source.label}`;
  }

  private get pace() {
    return this.source.id.startsWith('gh:') ? PACE.github : this.source.id === 'demo' ? PACE.demo : PACE.other;
  }

  /** Loads what's been built so far (fast), without reading anything new. */
  load(): Promise<void> {
    return (this.loaded ??= (async () => {
      const s = await this.kv.get<Saved>(this.key).catch(() => undefined);
      if (!s) return;
      this.events = s.events;
      this.shas = new Set(s.shas);
      this.ranges = s.ranges;
      this.newest = s.newest;
      this.oldest = s.oldest;
      this.builtAt = s.builtAt;
      this.stats = s.stats;
      this.version++;
      this.onChange();
    })());
  }

  /** Starts building in the background after `delay` ms (the app's start-up gets the CPU first). */
  start(delay = 0) {
    if (!this.available || this.running) return;
    this.running = true;
    void this.run(delay);
  }

  /** The detailed page is open: work faster, still only when idle. */
  setWatched(on: boolean) {
    this.watched = on;
    if (on) {
      this.start();
      this.nudge();
    }
  }

  /** Something was committed (or it's been a while): read the new commits next. */
  refresh() {
    if (!this.available) return;
    this.lastFresh = 0;
    this.nudge();
  }

  /** Throws away everything built and starts again from the newest commit. */
  async rebuild() {
    this.events = [];
    this.shas.clear();
    this.ranges = [{}];
    this.newest = this.oldest = this.builtAt = undefined;
    this.stats = undefined;
    this.statsKey = undefined;
    this.version++;
    await this.save();
    this.onChange();
    this.start();
    this.nudge();
  }

  stop() {
    this.stopped = true;
    this.nudge();
  }

  private nudge() {
    this.wake?.();
  }

  /** Sleeps for `ms`, or until nudged. */
  private rest(ms: number) {
    return Promise.race([this.env.sleep(ms), new Promise<void>((r) => (this.wake = r))]);
  }

  private async run(delay: number) {
    await this.load();
    if (delay) await this.rest(delay);
    let backoff = 30_000;
    while (!this.stopped) {
      // Caught up: look for new commits now and then (sooner after a sync).
      if (this.env.now() - this.lastFresh > FRESH_MS) {
        this.lastFresh = this.env.now();
        if (this.newest || !this.ranges.length) this.ranges.unshift({ since: this.newest });
      }
      if (!this.ranges.length) {
        this.setStatus('complete');
        await this.rest(FRESH_MS);
        continue;
      }
      // Spend no more than the hourly budget on GitHub.
      const cap = this.watched ? this.pace.watchedPerHour : this.pace.perHour;
      if (this.env.now() - this.spent.from >= HOUR) this.spent = { from: this.env.now(), n: 0 };
      if (this.spent.n >= cap) {
        this.setStatus('waiting');
        await this.rest(this.spent.from + HOUR - this.env.now());
        continue;
      }
      await this.env.idle();
      if (this.stopped) break;
      this.setStatus('building');
      try {
        await this.step();
        backoff = 30_000;
      } catch (err) {
        this.error = (err as Error).message;
        this.setStatus('offline');
        await this.rest(backoff);
        backoff = Math.min(backoff * 2, 15 * 60_000);
        continue;
      }
      await this.rest(this.watched ? this.pace.watched : this.pace.gap);
    }
    this.running = false;
  }

  /** Reads one page of the most urgent range, compares it on the worker, and saves. */
  private async step() {
    const range = this.ranges[0];
    const page = await this.source.changesPage!({ ...range, limit: this.pace.limit });
    this.spent.n += page.requests ?? 1;
    const fresh = page.commits.filter((c) => !this.shas.has(c.sha));
    if (fresh.length) {
      const found = await this.work.run({ kind: 'scan', commits: fresh });
      const seen = new Set(this.events.map(eventId));
      this.events = [...this.events, ...found.filter((e) => !seen.has(eventId(e)))].sort((a, b) => a.at.localeCompare(b.at));
      for (const c of fresh) {
        this.shas.add(c.sha);
        if (!this.newest || c.date > this.newest) this.newest = c.date;
        if (!this.oldest || c.date < this.oldest) this.oldest = c.date;
      }
      this.version++;
    }
    // Page on through this range, or move to the next one.
    const until = page.oldest;
    if (page.more && until) {
      // Only commits already read at this edge: step past them so it can't get stuck.
      const stuck = !fresh.length && until === range.until;
      this.ranges[0] = { ...range, until: stuck ? new Date(Date.parse(until) - 1000).toISOString() : until };
    } else this.ranges.shift();
    this.builtAt = new Date(this.env.now()).toISOString();
    await this.save();
    this.onChange();
  }

  private save() {
    const saved: Saved = {
      events: this.events,
      shas: [...this.shas],
      ranges: this.ranges,
      newest: this.newest,
      oldest: this.oldest,
      builtAt: this.builtAt,
      stats: this.stats,
    };
    return this.kv.set(this.key, saved).catch(() => undefined);
  }

  private setStatus(s: HistoryBuilder['status']) {
    if (this.status === s) return;
    this.status = s;
    this.onChange();
  }

  /**
   * The detailed stats for `ws`: whatever was last worked out, straight
   * away, while a fresh add-up runs on the worker if anything changed.
   */
  statsFor(ws: Workspace, quick: HistoryEvent[]): DetailedStats | undefined {
    const day = new Date(this.env.now()).toDateString();
    const key = `${this.version}|${day}|${quick.length}|${ids.get(ws) ?? ids.set(ws, ++wsCount).get(ws)}`;
    if (key !== this.statsKey) {
      this.statsWanted = { ws, quick, key };
      void this.addUp();
    }
    return this.stats;
  }

  private async addUp() {
    if (this.statsRunning || !this.statsWanted) return;
    this.statsRunning = true;
    const { ws, quick, key } = this.statsWanted;
    this.statsWanted = undefined;
    try {
      this.stats = await this.work.run({ kind: 'stats', ws, quick, deep: this.events, now: this.env.now() });
      this.statsKey = key;
      void this.save();
      this.onChange();
    } catch {
      /* the worker failed: the inline fallback takes over next time */
    }
    this.statsRunning = false;
    if (this.statsWanted) void this.addUp();
  }
}

/** Workspaces are swapped, not mutated (copy-on-write): an id per object tells versions apart. */
const ids = new WeakMap<Workspace, number>();
let wsCount = 0;

/** The browser's version of "idle": no recent input, nothing syncing or playing, tab visible. */
export function browserEnv(busy: () => boolean): BuildEnv {
  let lastInput = 0;
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
    addEventListener(type, () => (lastInput = Date.now()), { passive: true, capture: true });
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
  const quiet = () => {
    const pending = (navigator as Navigator & { scheduling?: { isInputPending?: () => boolean } }).scheduling?.isInputPending?.();
    return !document.hidden && !busy() && Date.now() - lastInput > 1_500 && !pending;
  };
  return {
    now: () => Date.now(),
    sleep,
    async idle() {
      while (!quiet()) await sleep(1_000);
      await new Promise<void>((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 3_000 }) : setTimeout(r, 50)));
    },
  };
}
