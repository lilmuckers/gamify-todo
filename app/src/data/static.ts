import { fromFiles } from '@quest/shared';
import { BASE_URL } from '../config';
import type { DataSource, Loaded } from './source';

async function text(path: string): Promise<string> {
  const res = await fetch(`${BASE_URL}${path}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.text();
}

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

  async load(): Promise<Loaded> {
    const index = JSON.parse(await text('data/index.json')) as { files: string[] };
    const files: Record<string, string> = {};
    await Promise.all(index.files.map(async (p) => (files[p] = await text(p))));
    const version = await hash(Object.keys(files).sort().map((k) => files[k]).join('\0'));
    return { state: fromFiles(files), version };
  }
}
