import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { E2E_REPO } from './paths';

/** A JSON file from the local editor's repo, as it is on disk now. */
export function repoJson<T = Record<string, any>>(path: string): T {
  return JSON.parse(readFileSync(join(E2E_REPO, path), 'utf8')) as T;
}

/** An item's status in a level file. */
export function itemStatus(levelPath: string, itemId: string): string | undefined {
  return repoJson<{ items: { id: string; status: string }[] }>(levelPath).items.find((i) => i.id === itemId)?.status;
}

/** Commit messages, newest first. */
export async function commits(): Promise<string[]> {
  const log = await simpleGit(E2E_REPO).log();
  return log.all.map((c) => c.message);
}
