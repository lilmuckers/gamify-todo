// Validates data/** against the JSON Schema, folder structure and semantic rules. Used by CI.
import { formatIssues, validateFiles } from '../src/index';
import { readDataDir } from './read-data';

const files = readDataDir(process.argv[2] ?? process.cwd());
const issues = validateFiles(files);
if (issues.length) {
  console.error(`✗ ${issues.length} issue(s):\n${formatIssues(issues)}`);
  process.exit(1);
}
console.log(`✓ ${Object.keys(files).length} data files valid`);
