import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ATTACHMENTS_DIR, isAttachmentFile } from '../src/attachments';

/** Every .json file under <root>/data, keyed by repo-relative posix path. */
export function readDataDir(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (name.endsWith('.json')) files[relative(root, abs).split(sep).join('/')] = readFileSync(abs, 'utf8');
    }
  };
  if (existsSync(join(root, 'data'))) walk(join(root, 'data'));
  return files;
}

/** Paths of the binary files under <root>/data/attachments: listed for pairing, never read. */
export function listAttachmentFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out.push(relative(root, abs).split(sep).join('/'));
    }
  };
  if (existsSync(join(root, ATTACHMENTS_DIR))) walk(join(root, ATTACHMENTS_DIR));
  return out.filter(isAttachmentFile);
}
