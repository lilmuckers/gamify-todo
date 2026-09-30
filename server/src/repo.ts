import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { DATA_ROOT, isDataPath } from '@quest/shared';

export { isDataPath };

/** The mounted git repo: reads/writes data files and commits them. */
export class Repo {
  git: SimpleGit;

  constructor(public dir: string) {
    this.git = simpleGit(dir);
  }

  /** Every .json under data/ (including stray ones, so validation can flag them). */
  async readFiles(): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const walk = async (dir: string) => {
      for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) await walk(abs);
        else if (entry.name.endsWith('.json')) files[relative(this.dir, abs).split(sep).join('/')] = await readFile(abs, 'utf8');
      }
    };
    const root = join(this.dir, DATA_ROOT);
    if (existsSync(root)) await walk(root);
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
      if (content === null) {
        await rm(abs, { force: true });
        // Drop now-empty world/project folders.
        for (let d = dirname(abs); relative(this.dir, d).split(sep).length > 1; d = dirname(d))
          await rmdir(d).catch(() => undefined);
      }
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
