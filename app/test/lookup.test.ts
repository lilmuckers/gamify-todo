import { describe, expect, it } from 'vitest';
import { pullLookup } from '../src/data/source';
import { truncate } from '../src/ui/dom';
import { at, level, workspace } from '../../shared/test/fixtures';

describe('pullLookup', () => {
  it("prefers the PR's head, falling back to its base for removed things", () => {
    const base = workspace(level({ name: 'Before' }));
    const head = workspace(level({ name: 'After' }));
    const find = pullLookup({ head, base });
    expect(find.level(at)?.name).toBe('After');
    expect(find.project('p')).toBe(head.projects.p);

    const removed = pullLookup({ head: { projects: {} }, base });
    expect(removed.level(at)?.name).toBe('Before');
    expect(removed.world('p', 'w')?.name).toBe('W');
    expect(removed.project('p')).toBe(base.projects.p);
  });
});

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('Order tiles', 32)).toBe('Order tiles');
    expect(truncate('x'.repeat(32), 32)).toBe('x'.repeat(32));
  });

  it('cuts to the limit, tail included', () => {
    expect(truncate('x'.repeat(33), 32)).toBe(`${'x'.repeat(31)}…`);
    expect(truncate('y'.repeat(200), 160, '...')).toBe(`${'y'.repeat(157)}...`);
  });
});
