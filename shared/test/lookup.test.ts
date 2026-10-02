import { describe, expect, it } from 'vitest';
import { findLevelAt, levelRefTarget, suggestNextLevel } from '../src/index';
import { at, level, state, workspace } from './fixtures';

describe('findLevelAt', () => {
  it('finds a level by project, world and level id', () => {
    const ws = workspace();
    expect(findLevelAt(ws, at)?.id).toBe('lvl');
  });

  it('is undefined for anything missing', () => {
    const ws = workspace();
    expect(findLevelAt(ws, { ...at, projectId: 'nope' })).toBeUndefined();
    expect(findLevelAt(ws, { ...at, worldId: 'nope' })).toBeUndefined();
    expect(findLevelAt(ws, { ...at, levelId: 'nope' })).toBeUndefined();
  });
});

describe('levelRefTarget', () => {
  it('resolves a levelRef to its world and level', () => {
    const s = state();
    const t = levelRefTarget(s, { levelRef: 'w/lvl' });
    expect(t?.world.name).toBe('W');
    expect(t?.level.id).toBe('lvl');
    expect(t && [t.worldId, t.levelId]).toEqual(['w', 'lvl']);
  });

  it('is undefined without a ref, for a malformed one, or a level that is gone', () => {
    const s = state();
    expect(levelRefTarget(s, {})).toBeUndefined();
    expect(levelRefTarget(s, { levelRef: 'w' })).toBeUndefined();
    expect(levelRefTarget(s, { levelRef: 'w/gone' })).toBeUndefined();
  });
});

describe('suggestNextLevel', () => {
  it('returns the suggested level with where it is', () => {
    const next = suggestNextLevel(state());
    expect(next && [next.worldId, next.levelId, next.level.name]).toEqual(['w', 'lvl', 'Level']);
  });

  it('is undefined once everything is cleared', () => {
    const cleared = level({ successCriteria: [{ id: 'mvp-1', text: 'Works', mvp: true, done: true }] });
    expect(suggestNextLevel(state(cleared))).toBeUndefined();
  });
});
