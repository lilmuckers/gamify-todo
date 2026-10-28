import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { crc32, unzipFile, zip } from '../src/ui/zip';

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

describe('unzipFile', () => {
  it('reads a stored file back', async () => {
    const archive = zip({ 'a.txt': 'first', 'status.json': '{"ok":true}' });
    expect(new TextDecoder().decode(await unzipFile(archive, 'status.json'))).toBe('{"ok":true}');
    expect(await unzipFile(archive, 'missing.json')).toBeUndefined();
  });

  it('reads a deflated file from a streamed archive, like a GitHub artifact', async () => {
    const body = JSON.stringify({ ranAt: '2026-10-28T09:00:00Z', padding: 'x'.repeat(500) });
    const archive = streamedZip('status.json', new TextEncoder().encode(body));
    expect(new TextDecoder().decode(await unzipFile(archive, 'status.json'))).toBe(body);
  });

  it('says when it is not a zip', async () => {
    await expect(unzipFile(new TextEncoder().encode('nope, not a zip at all'), 'x')).rejects.toThrow(/zip/);
  });
});

/** A one-file deflated zip as a streaming writer makes it: sizes only in a data descriptor and the directory. */
function streamedZip(name: string, data: Uint8Array): Uint8Array {
  const packed = deflateRawSync(data);
  const n = new TextEncoder().encode(name);
  const crc = crc32(data);
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(4, 20, true);
  local.setUint16(6, 0x08, true); // sizes follow in a data descriptor
  local.setUint16(8, 8, true);
  local.setUint16(26, n.length, true);
  const desc = new DataView(new ArrayBuffer(16));
  desc.setUint32(0, 0x08074b50, true);
  desc.setUint32(4, crc, true);
  desc.setUint32(8, packed.length, true);
  desc.setUint32(12, data.length, true);
  const cd = new DataView(new ArrayBuffer(46));
  cd.setUint32(0, 0x02014b50, true);
  cd.setUint16(4, 20, true);
  cd.setUint16(6, 20, true);
  cd.setUint16(8, 0x08, true);
  cd.setUint16(10, 8, true);
  cd.setUint32(16, crc, true);
  cd.setUint32(20, packed.length, true);
  cd.setUint32(24, data.length, true);
  cd.setUint16(28, n.length, true);
  const cdAt = 30 + n.length + packed.length + 16;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, 1, true);
  eocd.setUint16(10, 1, true);
  eocd.setUint32(12, 46 + n.length, true);
  eocd.setUint32(16, cdAt, true);
  const parts = [new Uint8Array(local.buffer), n, packed, new Uint8Array(desc.buffer), new Uint8Array(cd.buffer), n, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
}
