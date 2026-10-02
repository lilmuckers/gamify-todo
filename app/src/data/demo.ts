import { fromFiles } from '@quest/shared';
import type { DataSource, Loaded } from './source';
import { StaticSource } from './static';
import type { KV } from './store';

/**
 * Play the demo: the example data, fully editable, saved nowhere. Commits
 * apply to an in-memory copy of the files and get a made-up version, so the
 * store, sync status, undo and celebrations behave exactly as with GitHub,
 * but nothing is written to any repo, server or this browser's storage.
 */
export class DemoSource implements DataSource {
  id = 'demo';
  label = 'Demo (not saved)';
  caps = { canEdit: true, canReviewPRs: false, canPublish: false };
  private files?: Record<string, string>;
  private version = 0;

  constructor(private seed: { loadFiles(): Promise<Record<string, string>> } = new StaticSource()) {}

  async load(): Promise<Loaded> {
    this.files ??= await this.seed.loadFiles();
    return { state: fromFiles(this.files), version: `demo-${this.version}` };
  }

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
