import { describe, expect, it } from 'vitest';
import { applyOp, changedFiles, classifyPath, describeOp, fromFiles, makeOp, SETTINGS_PATH, toFiles, validateFiles } from '../src';
import { workspace } from './fixtures';

describe('data/settings.json', () => {
  it('is a data file that round-trips through the workspace', () => {
    expect(classifyPath('data/settings.json')).toEqual({ kind: 'settings' });
    const ws = { ...workspace(), settings: { hero: 'redhead' as const } };
    const files = toFiles(ws);
    expect(JSON.parse(files[SETTINGS_PATH])).toEqual({
      $schema: 'https://tasks.patrick-mckinley.com/schema/settings.schema.json',
      hero: 'redhead',
    });
    expect(fromFiles(files).settings).toEqual({ hero: 'redhead' });
    expect(validateFiles(files)).toEqual([]);
  });

  it('is optional', () => {
    expect(toFiles(workspace())).not.toHaveProperty(SETTINGS_PATH);
    expect(fromFiles(toFiles(workspace()))).not.toHaveProperty('settings');
  });

  it('is written by updateSettings, keeping projects, and removed when emptied', () => {
    const before = workspace();
    const set = applyOp(before, makeOp({ kind: 'updateSettings', patch: { hero: 'bearded' } }));
    expect(set.settings).toEqual({ hero: 'bearded' });
    expect(set.projects).toEqual(before.projects);
    expect(Object.keys(changedFiles(before, set))).toEqual([SETTINGS_PATH]);
    // Project ops keep the settings.
    const later = applyOp(set, makeOp({ kind: 'updateProject', projectId: 'p', patch: { title: 'New' } }));
    expect(later.settings).toEqual({ hero: 'bearded' });
    const cleared = applyOp(set, makeOp({ kind: 'updateSettings', patch: { hero: undefined } }));
    expect(cleared).not.toHaveProperty('settings');
    expect(changedFiles(set, cleared)).toEqual({ [SETTINGS_PATH]: null });
    expect(describeOp(makeOp({ kind: 'updateSettings', patch: { hero: 'bearded' } }))).toBe('settings: hero = bearded');
  });

  it('rejects unknown heroes and extra keys', () => {
    const files = { ...toFiles(workspace()), [SETTINGS_PATH]: JSON.stringify({ hero: 'wizard' }) };
    expect(new Set(validateFiles(files).map((i) => i.file))).toEqual(new Set([SETTINGS_PATH]));
    files[SETTINGS_PATH] = JSON.stringify({ theme: 'dark' });
    expect(validateFiles(files)[0].message).toMatch(/theme/);
  });
});
