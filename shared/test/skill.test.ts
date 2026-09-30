import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateFiles } from '../src/index';

// Keeps skills/quest-log/SKILL.md honest: its example files must validate.
describe('SKILL.md examples', () => {
  it('are a valid data tree', () => {
    const md = readFileSync('skills/quest-log/SKILL.md', 'utf8');
    const section = md.slice(md.indexOf('## 4. Example files'), md.indexOf('## 5.'));
    const files: Record<string, string> = {};
    for (const m of section.matchAll(/`(data\/[^`]+\.json)`\n```json\n([\s\S]*?)```/g)) files[m[1]] = m[2];
    expect(Object.keys(files)).toHaveLength(3);
    expect(validateFiles(files)).toEqual([]);
  });
});
