import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, zip } from '../src/ui/zip';

describe('zip', () => {
  it('computes CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('produces an archive unzip can extract', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const file = join(dir, 'skill.zip');
    writeFileSync(file, zip({ 'quest-log/SKILL.md': '# Hello ✓\n' }));
    execFileSync('unzip', ['-q', file, '-d', dir]);
    expect(readFileSync(join(dir, 'quest-log/SKILL.md'), 'utf8')).toBe('# Hello ✓\n');
  });
});
