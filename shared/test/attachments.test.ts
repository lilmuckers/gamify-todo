import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attachmentFilePath,
  attachmentNames,
  attachmentSidecarPath,
  changedFiles,
  classifyPath,
  fromFiles,
  GitHubClient,
  isAttachmentFile,
  isDataPath,
  toFiles,
  validateFiles,
  validateWorkspace,
} from '../src';
import { listAttachmentFiles, readDataDir } from '../scripts/read-data';
import { JPEG_BYTES, sidecar, workspace } from './fixtures';

const json = (v: unknown) => JSON.stringify(v, null, 2);
/** The fixture tree plus attachments: `{ id: ext }`, each with a sidecar unless `ext` is null. */
function tree(attachments: Record<string, string | null> = { 'receipt-1': 'jpg' }) {
  const files = toFiles(workspace());
  const paths: string[] = [];
  for (const [id, ext] of Object.entries(attachments)) {
    files[attachmentSidecarPath(id)] = json(sidecar({ id }));
    if (ext) paths.push(`data/attachments/${id}.${ext}`);
  }
  return { files, paths };
}
const messages = (files: Record<string, string>, paths?: string[]) => validateFiles(files, paths).map((i) => `${i.file}: ${i.message}`);

describe('attachment paths', () => {
  it('classifies sidecars as data and files as binary', () => {
    expect(attachmentFilePath('receipt-1', 'jpg')).toBe('data/attachments/receipt-1.jpg');
    expect(classifyPath('data/attachments/receipt-1.json')).toEqual({ kind: 'attachment', id: 'receipt-1' });
    expect(classifyPath('data/attachments/receipt-1.jpg')).toBeUndefined();
    expect(isDataPath('data/attachments/receipt-1.jpg')).toBe(false);
    expect(isAttachmentFile('data/attachments/receipt-1.jpg')).toBe(true);
    expect(isAttachmentFile('data/attachments/receipt-1.json')).toBe(false);
  });

  it('never reads data/attachments/ as a project', () => {
    expect(classifyPath('data/attachments/project.json')).toEqual({ kind: 'attachment', id: 'project' });
    expect(classifyPath('data/attachments/w/world.json')).toBeUndefined();
    expect(classifyPath('data/attachments/w/l.json')).toBeUndefined();
    expect(classifyPath('data/attachments/Receipt.json')).toBeUndefined();
  });

  it('keeps sidecars out of the workspace, so app saves never touch them', () => {
    const { files } = tree();
    const ws = fromFiles(files);
    expect(ws).toEqual(fromFiles(toFiles(workspace())));
    expect(Object.keys(toFiles(ws)).some((p) => p.startsWith('data/attachments/'))).toBe(false);
    expect(changedFiles(ws, { ...ws, settings: { hero: 'goth' } })).toEqual({ 'data/settings.json': expect.any(String) });
  });

  it('names attachments for the Warp Zone by file name only', () => {
    expect(attachmentNames(['data/p/w/l.json', 'data/attachments/b.json', 'data/attachments/b.png', 'data/attachments/a.jpg'])).toEqual(['a.jpg', 'b.json', 'b.png']);
  });
});

describe('attachment validation', () => {
  it('accepts paired files of every allowed type', () => {
    const { files, paths } = tree({ a: 'jpg', b: 'jpeg', c: 'png', d: 'webp', e: 'heic' });
    expect(validateFiles(files, paths)).toEqual([]);
  });

  it('rejects a sidecar without a file', () => {
    const { files, paths } = tree({ 'receipt-1': null });
    expect(messages(files, paths)).toEqual([
      'data/attachments/receipt-1.json: attachment sidecar has no file: add data/attachments/receipt-1.<jpg|jpeg|png|webp|heic> or remove the sidecar',
    ]);
  });

  it('rejects a file without a sidecar', () => {
    const { files } = tree({});
    expect(messages(files, ['data/attachments/receipt-1.jpg'])).toEqual([
      'data/attachments/receipt-1.jpg: attachment file has no sidecar: add data/attachments/receipt-1.json',
    ]);
  });

  it('rejects other file types, odd names, folders and a second file for one id', () => {
    const { files, paths } = tree();
    expect(messages(files, [...paths, 'data/attachments/receipt-1.png', 'data/attachments/notes.pdf', 'data/attachments/Photo.jpg', 'data/attachments/x/y.jpg'])).toEqual([
      'data/attachments/Photo.jpg: unexpected attachment file: use data/attachments/<id>.<jpg|jpeg|png|webp|heic> with a sidecar data/attachments/<id>.json',
      'data/attachments/notes.pdf: unexpected attachment file: use data/attachments/<id>.<jpg|jpeg|png|webp|heic> with a sidecar data/attachments/<id>.json',
      'data/attachments/x/y.jpg: unexpected attachment file: use data/attachments/<id>.<jpg|jpeg|png|webp|heic> with a sidecar data/attachments/<id>.json',
      'data/attachments/receipt-1.png: attachment "receipt-1" already has a file (data/attachments/receipt-1.jpg); keep one',
    ]);
  });

  it('checks the sidecar against the schema and its file name', () => {
    const { files, paths } = tree();
    const edit = (patch: object) => ({ ...files, 'data/attachments/receipt-1.json': json({ ...sidecar(), ...patch }) });
    expect(messages(edit({ id: 'other' }), paths)).toEqual(['data/attachments/receipt-1.json: id "other" must match its file name "receipt-1"']);
    const at = (patch: object) => validateFiles(edit(patch), paths).map((i) => `${i.path} ${i.message}`).join('\n');
    expect(at({ via: 'email' })).toMatch(/^\/via /m);
    expect(at({ extracted: {} })).toMatch(/extracted/);
    expect(at({ addedAt: 'yesterday' })).toMatch(/^\/addedAt /m);
    expect(at({ title: '' })).toMatch(/^\/title /m);
  });

  it('only pairs when the caller lists the files', () => {
    expect(validateFiles(tree({ 'receipt-1': null }).files)).toEqual([]);
  });

  it('flags JSON that is in data/attachments/ but is not a sidecar', () => {
    const { files, paths } = tree();
    expect(messages({ ...files, 'data/attachments/x/y.json': '{}' }, paths)[0]).toMatch(/^data\/attachments\/x\/y\.json: unexpected file: .*data\/attachments\/<id>\.json$/);
  });

  it('reserves the project id "attachments"', () => {
    const ws = workspace();
    ws.projects = { attachments: { ...ws.projects.p, overworld: { ...ws.projects.p.overworld, id: 'attachments' } } };
    expect(validateWorkspace(ws).map((i) => i.message)).toContain('project id "attachments" is reserved');
  });
});

describe('attachment files are listed, never read', () => {
  it('reads sidecars but only lists binaries from a checkout', () => {
    const root = mkdtempSync(join(tmpdir(), 'quest-attach-'));
    const { files } = tree();
    for (const [p, c] of Object.entries({ ...files, 'data/attachments/receipt-1.jpg': JPEG_BYTES })) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), c);
    }
    const read = readDataDir(root);
    expect(read['data/attachments/receipt-1.json']).toBeDefined();
    expect(Object.keys(read).filter((p) => !p.endsWith('.json'))).toEqual([]);
    expect(listAttachmentFiles(root)).toEqual(['data/attachments/receipt-1.jpg']);
    expect(validateFiles(read, listAttachmentFiles(root))).toEqual([]);
  });

  it('fetches sidecars but not attachment blobs from GitHub, and lists both in a PR', async () => {
    const fetched: string[] = [];
    const fn = (async (url: string) => {
      fetched.push(url);
      const body = url.endsWith('/git/trees/abc?recursive=1')
        ? {
            tree: [
              { path: 'data/attachments/receipt-1.json', sha: 's1', type: 'blob' },
              { path: 'data/attachments/receipt-1.jpg', sha: 'j1', type: 'blob' },
            ],
          }
        : url.endsWith('/pulls/7')
          ? { number: 7, title: 'Photo', user: { login: 'u' }, html_url: '', head: { sha: 'h', ref: 'quest/attach/receipt-1', repo: { full_name: 'o/r' } }, base: { ref: 'main' } }
          : url.includes('/pulls/7/files')
            ? [{ filename: 'data/attachments/receipt-1.jpg' }, { filename: 'data/attachments/receipt-1.json' }]
            : url.includes('/check-runs')
              ? { check_runs: [] }
              : undefined;
      const text = url.endsWith('/git/blobs/s1') ? json(sidecar()) : JSON.stringify(body);
      return { ok: true, status: 200, statusText: '200', json: async () => body, text: async () => text } as Response;
    }) as typeof fetch;
    const gh = new GitHubClient('tok', { owner: 'o', repo: 'r', branch: 'main' }, fn);
    expect(Object.keys(await gh.readDataAt('abc'))).toEqual(['data/attachments/receipt-1.json']);
    expect(fetched.some((u) => u.endsWith('/git/blobs/j1'))).toBe(false);
    expect((await gh.pull(7)).dataFiles).toEqual(['data/attachments/receipt-1.jpg', 'data/attachments/receipt-1.json']);
  });
});
