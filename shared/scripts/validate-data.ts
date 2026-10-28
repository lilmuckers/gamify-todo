// Validates data/** against the JSON Schema, folder structure and semantic rules. Used by CI.
import { formatIssues, validateFiles } from '../src/index';
import { listAttachmentFiles, readDataDir } from './read-data';

const root = process.argv[2] ?? process.cwd();
const files = readDataDir(root);
const issues = validateFiles(files, listAttachmentFiles(root));
if (issues.length) {
  console.error(`✗ ${issues.length} issue(s):\n${formatIssues(issues)}`);
  process.exit(1);
}
console.log(`✓ ${Object.keys(files).length} data files valid`);
