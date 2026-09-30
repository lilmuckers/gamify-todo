import { fromFiles, GAME_PATH, worldPath, type Overworld } from '@quest/shared';
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

/** Read-only: the JSON files deployed alongside the site. */
export class StaticSource implements DataSource {
  id = 'static';
  label = 'Read-only';
  caps = { canEdit: false, canReviewPRs: false, canPublish: false };

  async load(): Promise<Loaded> {
    const files: Record<string, string> = { [GAME_PATH]: await text(GAME_PATH) };
    const overworld = JSON.parse(files[GAME_PATH]) as Overworld;
    await Promise.all(
      overworld.worldOrder.map(async (id) => {
        files[worldPath(id)] = await text(worldPath(id));
      }),
    );
    const version = await hash(Object.keys(files).sort().map((k) => files[k]).join('\0'));
    return { state: fromFiles(files), version };
  }
}
