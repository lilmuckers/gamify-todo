import { fromFiles, type AttachmentPull, type CommitChanges } from '@quest/shared';
import { demoCommits, demoHistory } from './demo-history';
import { TARGET } from '../config';
import type { AttachmentProvider, DataSource, HistoryRange, Loaded } from './source';
import { StaticSource } from './static';
import type { KV } from './store';

/**
 * The example games shipped with the app: data/ on Pages; examples/data/ in
 * the Docker build, whose data/ is the live repo behind its API.
 */
export function exampleData(): StaticSource {
  return new StaticSource(TARGET === 'local' ? 'examples/' : '');
}

/**
 * Play the demo: the example data, fully editable, saved nowhere. Commits
 * apply to an in-memory copy of the files and get a made-up version, so the
 * store, sync status, undo and celebrations behave exactly as with GitHub,
 * but nothing is written to any repo, server or this browser's storage.
 */
export class DemoSource implements DataSource {
  id = 'demo';
  label = 'Demo (not saved)';
  caps = { canEdit: true, canReviewPRs: false, canPublish: false, canAutomate: false };
  private files?: Record<string, string>;
  private version = 0;

  constructor(private seed: { loadFiles(): Promise<Record<string, string>> } = exampleData()) {}

  async load(): Promise<Loaded> {
    this.files ??= await this.seed.loadFiles();
    return { state: fromFiles(this.files), version: `demo-${this.version}` };
  }

  /** A made-up history (the demo has no repo), so stats show what a real one would. */
  async history(since?: string) {
    const all = demoHistory(fromFiles(this.files ?? (await this.seed.loadFiles())));
    return since ? all.filter((c) => c.date >= since) : all;
  }

  private built?: { files: Record<string, string>; commits: CommitChanges[] };

  /** The same history for the detailed stats, a page at a time like a real repo (newest first). */
  async changesPage(range: HistoryRange) {
    const files = this.files ?? (await this.seed.loadFiles());
    if (this.built?.files !== files) this.built = { files, commits: demoCommits(fromFiles(files)).reverse() };
    const inRange = this.built.commits.filter((c) => (!range.since || c.date > range.since) && (!range.until || c.date <= range.until));
    const commits = inRange.slice(0, range.limit);
    return { commits, more: inRange.length > range.limit, oldest: commits.at(-1)?.date };
  }

  /** Photos go nowhere either: each becomes a pretend pull request that lasts until reload. */
  private photos: { pull: AttachmentPull; blob: Blob }[] = [];
  attachments: AttachmentProvider = {
    submit: async ({ sidecar, base64 }) => {
      const number = 900 + this.photos.length + 1;
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const pull = { id: sidecar.id, number, title: `📷 ${sidecar.title ?? 'New photo'}`, url: '#/~inbox', headSha: 'demo', createdAt: sidecar.addedAt };
      this.photos.unshift({ pull, blob: new Blob([bytes], { type: 'image/jpeg' }) });
      return number;
    },
    pending: async () => this.photos.map((p) => p.pull),
    file: async (pull) => this.photos.find((p) => p.pull.id === pull.id)?.blob ?? new Blob(),
  };

  async commit(changes: Record<string, string | null>, _message: string, _base: string): Promise<string> {
    const files = { ...(this.files ?? (await this.seed.loadFiles())) };
    for (const [path, text] of Object.entries(changes)) {
      if (text === null) delete files[path];
      else files[path] = text;
    }
    this.files = files;
    return `demo-${++this.version}`;
  }
}

/** A KV that forgets everything on reload, so demo edits never touch a real repo's cache. */
export function memoryKV(): KV {
  const data = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
    set: async (key: string, value: unknown) => void data.set(key, structuredClone(value)),
  };
}
