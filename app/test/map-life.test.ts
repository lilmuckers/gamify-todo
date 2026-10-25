import { describe, expect, it } from 'vitest';
import type { GameState, World } from '@quest/shared';
import { dueFanfares, fanfareKey, lockReason, mapWalk, routeBetween, worldClearedAt } from '../src/game/map-life';
import { MAX_WALK_MS } from '../src/game/walk';
import { level, state } from '../../shared/test/fixtures';

const cleared = (clearedAt?: string) =>
  level({ successCriteria: [{ id: 'mvp-1', text: 'Works', mvp: true, done: true }], clearedAt });

const world = (id: string, levels = [cleared('2026-10-20T10:00:00Z')], unlocksAfter?: string[]): World => ({
  id,
  name: id.toUpperCase(),
  theme: 'grass',
  goalIds: ['g'],
  levels,
  unlocksAfter,
});

describe('routeBetween', () => {
  // a → b → d, a → c; e stands alone.
  const layout = { edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'd' }, { from: 'a', to: 'c' }] };

  it('follows paths forwards', () => {
    expect(routeBetween(layout, 'a', 'd')).toEqual([
      { from: 'a', to: 'b', forward: true },
      { from: 'b', to: 'd', forward: true },
    ]);
  });

  it('walks paths backwards to reach a sibling', () => {
    expect(routeBetween(layout, 'c', 'b')).toEqual([
      { from: 'c', to: 'a', forward: false },
      { from: 'a', to: 'b', forward: true },
    ]);
  });

  it('has nothing to walk to where he is, and no route to an island no path reaches', () => {
    expect(routeBetween(layout, 'b', 'b')).toEqual([]);
    expect(routeBetween(layout, 'a', 'e')).toBeUndefined();
  });
});

describe('mapWalk', () => {
  it('strolls short walks and hurries long ones', () => {
    expect(mapWalk(7 * 16)).toEqual({ ms: 1000, pace: 1 });
    const far = mapWalk(40 * 16);
    expect(far.ms).toBe(MAX_WALK_MS);
    expect(far.pace).toBeGreaterThan(1);
  });
});

describe('lockReason', () => {
  it('names the worlds still to clear', () => {
    const s: GameState = {
      ...state(),
      worlds: { a: world('a'), b: world('b', [level()]), c: world('c', [level()], ['a', 'b']) },
    };
    s.overworld = { ...s.overworld, worldOrder: ['a', 'b', 'c'] };
    expect(lockReason(s, s.worlds.c)).toBe('Clear World 2 (B) first');
    expect(lockReason(s, s.worlds.a)).toBeUndefined();
  });
});

describe('world-clear fanfares', () => {
  const since = '2026-10-01T00:00:00Z';

  it('dates a world by its last level cleared', () => {
    expect(worldClearedAt(world('a', [cleared('2026-10-02T00:00:00Z'), cleared('2026-10-05T00:00:00Z')]))).toBe(Date.parse('2026-10-05T00:00:00Z'));
    expect(worldClearedAt(world('a', [cleared('2026-10-02T00:00:00Z'), level()]))).toBeUndefined();
    expect(worldClearedAt(world('a', [cleared()]))).toBeUndefined();
  });

  it('owes one to each world cleared since the log began, once', () => {
    const worlds = [world('new'), world('old', [cleared('2026-09-01T00:00:00Z')]), world('open', [level()])];
    expect(dueFanfares('p', worlds, { since, seen: [] })).toEqual(['new']);
    expect(dueFanfares('p', worlds, { since, seen: [fanfareKey('p', 'new')] })).toEqual([]);
    expect(dueFanfares('q', worlds, { since, seen: [fanfareKey('p', 'new')] })).toEqual(['new']);
  });
});
