import { fromFiles } from '@quest/shared';
import { BASE_URL, fetchText } from '../config';
import type { DataSource, Loaded } from './source';

async function hash(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Read-only: the JSON files deployed alongside the site. Static hosting can't
 * list folders, so the build writes data/index.json with every data path.
 */
export class StaticSource implements DataSource {
  id = 'static';
  label = 'Read-only';
  caps = { canEdit: false, canReviewPRs: false, canPublish: false };

  /** `prefix`: where the data/ folder sits under the site ('examples/' in the Docker build). */
  constructor(private prefix = '') {}

  private get(path: string) {
    return fetchText(`${BASE_URL}${this.prefix}${path}`, 'this build has no example data');
  }

  /** Every deployed data file, by path. */
  async loadFiles(): Promise<Record<string, string>> {
    const index = JSON.parse(await this.get('data/index.json')) as { files: string[] };
    const files: Record<string, string> = {};
    await Promise.all(index.files.map(async (p) => (files[p] = await this.get(p))));
    return files;
  }

  async load(): Promise<Loaded> {
    const files = await this.loadFiles();
    const version = await hash(Object.keys(files).sort().map((k) => files[k]).join('\0'));
    return { state: fromFiles(files), version };
  }
}
