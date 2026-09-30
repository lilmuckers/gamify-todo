// Rewrites data/** in the canonical key order/format the app writes, so app
// commits produce minimal diffs. `--check` exits non-zero if anything would change.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromFiles, GAME_PATH, toFiles } from '../src/index';

const root = process.cwd();
const check = process.argv.includes('--check');
const files: Record<string, string> = { [GAME_PATH]: readFileSync(join(root, GAME_PATH), 'utf8') };
for (const name of readdirSync(join(root, 'data/worlds')))
  if (name.endsWith('.json')) files[`data/worlds/${name}`] = readFileSync(join(root, 'data/worlds', name), 'utf8');

const formatted = toFiles(fromFiles(files));
let dirty = 0;
for (const [path, content] of Object.entries(formatted)) {
  if (files[path] === content) continue;
  dirty++;
  if (check) console.error(`not formatted: ${path}`);
  else writeFileSync(join(root, path), content);
}
if (check && dirty) {
  console.error('Run `npm run format:data`.');
  process.exit(1);
}
console.log(check ? '✓ data formatted' : `formatted ${dirty} file(s)`);
