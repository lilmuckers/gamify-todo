import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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
