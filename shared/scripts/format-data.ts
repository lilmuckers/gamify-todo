// Rewrites data/** in the canonical key order/format the app writes, so app
// commits produce minimal diffs. `--check` exits non-zero if anything would change.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromFiles, toFiles } from '../src/index';
import { readDataDir } from './read-data';

const root = process.cwd();
const check = process.argv.includes('--check');
const files = readDataDir(root);
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
