import { describe, expect, it } from 'vitest';
import { toFiles, fromFiles, changedFiles, stringify, clone } from '../src/index';
import { state } from './fixtures';

describe('serialize', () => {
  it('round-trips and keeps a stable key order', () => {
    const s = state();
    const files = toFiles(s);
    expect(fromFiles(files)).toEqual(s);
    expect(Object.keys(JSON.parse(files['data/worlds/w.json']))[0]).toBe('$schema');
    expect(stringify({ z: 1, id: 'x', a: undefined })).toBe('{\n  "id": "x",\n  "z": 1\n}\n');
  });

  it('computes changed and deleted files', () => {
    const a = state();
    const b = clone(a);
    b.worlds.w.name = 'Renamed';
    delete (b.worlds as any).w;
    b.worlds.v = { ...a.worlds.w, id: 'v' };
    const changes = changedFiles(a, b);
    expect(changes['data/worlds/w.json']).toBeNull();
    expect(changes['data/worlds/v.json']).toContain('"id": "v"');
    expect(changes['data/game.json']).toBeUndefined();
  });
});
