// Validates data/** against the JSON Schema and semantic rules. Used by CI.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fromFiles, validateState, formatIssues, GAME_PATH } from '../src/index';

const root = process.argv[2] ?? process.cwd();
const files: Record<string, string> = {};
files[GAME_PATH] = readFileSync(join(root, GAME_PATH), 'utf8');
const worldsDir = join(root, 'data/worlds');
if (existsSync(worldsDir))
  for (const name of readdirSync(worldsDir))
    if (name.endsWith('.json')) files[`data/worlds/${name}`] = readFileSync(join(worldsDir, name), 'utf8');

const unknown = Object.keys(files).filter((p) => p !== GAME_PATH && !/^data\/worlds\/[a-z0-9]+(-[a-z0-9]+)*\.json$/.test(p));
const issues = validateState(fromFiles(files));
for (const p of unknown) issues.push({ file: p, path: '/', message: 'world file names must be kebab-case ids' });

if (issues.length) {
  console.error(`✗ ${issues.length} issue(s):\n${formatIssues(issues)}`);
  process.exit(1);
}
console.log(`✓ ${Object.keys(files).length} data files valid`);
