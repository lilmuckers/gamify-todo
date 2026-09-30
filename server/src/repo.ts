import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { GAME_PATH, WORLD_PATH_RE } from '@quest/shared';

export const isDataPath = (p: string) => p === GAME_PATH || WORLD_PATH_RE.test(p);

/** The mounted git repo: reads/writes data files and commits them. */
export class Repo {
  git: SimpleGit;

  constructor(public dir: string) {
    this.git = simpleGit(dir);
  }

  async readFiles(): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    files[GAME_PATH] = await readFile(join(this.dir, GAME_PATH), 'utf8');
    const worlds = join(this.dir, 'data/worlds');
    if (existsSync(worlds))
      for (const name of (await readdir(worlds)).sort()) {
        const rel = `data/worlds/${name}`;
        if (isDataPath(rel)) files[rel] = await readFile(join(this.dir, rel), 'utf8');
      }
    return files;
  }

  /** Content hash of the data files; changes whenever anything touches them. */
  static version(files: Record<string, string>): string {
    const h = createHash('sha1');
    for (const k of Object.keys(files).sort()) h.update(k).update('\0').update(files[k]).update('\0');
    return h.digest('hex');
  }

  async write(changes: Record<string, string | null>) {
    for (const [rel, content] of Object.entries(changes)) {
      const abs = join(this.dir, rel);
      if (content === null) await rm(abs, { force: true });
      else {
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content);
      }
    }
  }

  /** Commits exactly the given paths, leaving anything else in the working tree alone. */
  async commit(paths: string[], message: string): Promise<string | undefined> {
    const status = await this.git.status(paths);
    if (!status.files.length) return;
    const present = paths.filter((p) => existsSync(join(this.dir, p)));
    const removed = paths.filter((p) => !existsSync(join(this.dir, p)));
    if (present.length) await this.git.add(present);
    if (removed.length) await this.git.raw(['rm', '--cached', '--ignore-unmatch', '--quiet', '--', ...removed]);
    const r = await this.git.commit(message, paths);
    return r.commit || undefined;
  }

  async remoteUrl(): Promise<string | undefined> {
    try {
      return (await this.git.remote(['get-url', 'origin']))?.trim();
    } catch {
      return undefined;
    }
  }
}
