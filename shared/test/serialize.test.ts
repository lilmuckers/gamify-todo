import { describe, expect, it } from 'vitest';
import { toFiles, fromFiles, changedFiles, stringify, clone, applyOp, makeOp, safeLink } from '../src/index';
import { at, workspace } from './fixtures';

describe('serialize', () => {
  it('writes one file per project, world and level, and round-trips', () => {
    const ws = workspace();
    const files = toFiles(ws);
    expect(Object.keys(files).sort()).toEqual(['data/p/project.json', 'data/p/w/lvl.json', 'data/p/w/world.json']);
    expect(JSON.parse(files['data/p/w/world.json']).levelOrder).toEqual(['lvl']);
    expect(JSON.parse(files['data/p/w/lvl.json']).$schema).toMatch(/level\.schema\.json$/);
    expect(fromFiles(files)).toEqual(ws);
    expect(stringify({ z: 1, id: 'x', a: undefined })).toBe('{\n  "id": "x",\n  "z": 1\n}\n');
  });

  it('touches only the level file for an item change', () => {
    const a = workspace();
    const b = applyOp(a, makeOp({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'doing' }));
    expect(Object.keys(changedFiles(a, b))).toEqual(['data/p/w/lvl.json']);
  });

  it('computes deleted files', () => {
    const a = workspace();
    const b = clone(a);
    b.projects.p.worlds.w.levels = [];
    const changes = changedFiles(a, b);
    expect(changes['data/p/w/lvl.json']).toBeNull();
    expect(changes['data/p/w/world.json']).toContain('"levelOrder": []');
  });

  it('orders levels by levelOrder, appending unlisted ones', () => {
    const files = toFiles(workspace());
    files['data/p/w/aaa.json'] = files['data/p/w/lvl.json'].replace('"id": "lvl"', '"id": "aaa"');
    expect(fromFiles(files).projects.p.worlds.w.levels.map((l) => l.id)).toEqual(['lvl', 'aaa']);
  });
});

describe('fromFiles with hostile ids', () => {
  it('never writes to Object.prototype', () => {
    fromFiles({
      'data/constructor/project.json': '{"id":"constructor"}',
      'data/constructor/prototype/world.json': '{"id":"prototype"}',
      'data/constructor/prototype/pwned.json': '{"id":"pwned"}',
    });
    expect(({} as Record<string, unknown>).pwned).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('pwned');
  });

  it('keeps built-in names out of level order', () => {
    const ws = fromFiles({
      'data/p/project.json': '{"id":"p"}',
      'data/p/w/world.json': '{"id":"w","levelOrder":["constructor","tostring","hasownproperty",7]}',
      'data/p/w/lvl.json': '{"id":"lvl"}',
    });
    expect(ws.projects.p.worlds.w.levels.map((l) => l.id)).toEqual(['lvl']);
  });

  it('still loads real projects and worlds named like built-ins', () => {
    const ws = fromFiles({
      'data/constructor/project.json': '{"id":"constructor"}',
      'data/constructor/prototype/world.json': '{"id":"prototype"}',
      'data/constructor/prototype/valueof.json': '{"id":"valueof"}',
    });
    expect(ws.projects['constructor'].worlds['prototype'].levels.map((l) => l.id)).toEqual(['valueof']);
  });
});

describe('safeLink', () => {
  it('allows web and mail links', () => {
    for (const url of ['https://example.com/x?y=1', 'http://localhost:5173/', 'mailto:a@b.co']) expect(safeLink(url)).toBe(url);
  });

  it('refuses script, data and odd schemes', () => {
    for (const url of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/passwd', 'not a url', '', 42])
      expect(safeLink(url)).toBeUndefined();
  });
});
