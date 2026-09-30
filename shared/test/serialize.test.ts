import { describe, expect, it } from 'vitest';
import { toFiles, fromFiles, changedFiles, stringify, clone, applyOp, makeOp } from '../src/index';
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
