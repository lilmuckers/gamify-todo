import { describe, expect, it } from 'vitest';
import { href, parseRoute, togglePad, withPad, type Route } from '../src/router';

describe('router deep links', () => {
  const routes: Route[] = [
    { view: 'projects' },
    { view: 'projects', pad: 'today' },
    { view: 'level', projectId: 'house', worldId: 'kitchen', levelId: 'demo', itemId: 'rent-skip', pad: 'today' },
    { view: 'world', projectId: 'house', worldId: 'kitchen', pad: 'inbox' },
    { view: 'overworld', projectId: 'house' },
    { view: 'world', projectId: 'house', worldId: 'kitchen' },
    { view: 'level', projectId: 'house', worldId: 'kitchen', levelId: 'demo' },
    { view: 'level', projectId: 'house', worldId: 'kitchen', levelId: 'demo', itemId: 'rent-skip' },
    { view: 'level', projectId: 'house', worldId: 'kitchen', levelId: 'demo', subId: 'permit' },
    { view: 'level', projectId: 'house', worldId: 'kitchen', levelId: 'demo', subId: 'permit', itemId: 'call-council' },
    { view: 'prs' },
    { view: 'pr', pr: 7 },
    { view: 'pr-level', pr: 7, projectId: 'house', worldId: 'kitchen', levelId: 'demo' },
    { view: 'pr-level', pr: 7, projectId: 'house', worldId: 'kitchen', levelId: 'demo', itemId: 'x' },
    { view: 'pr-level', pr: 7, projectId: 'house', worldId: 'kitchen', levelId: 'demo', subId: 'dep', itemId: 'x' },
  ];

  it('round-trips every screen through the URL', () => {
    for (const r of routes) {
      const back = parseRoute(href(r));
      expect({ ...back, itemId: (back as any).itemId ?? undefined }).toEqual({ ...r, itemId: (r as any).itemId ?? undefined });
    }
  });

  it('keeps the dependency apart from the item', () => {
    expect(href({ view: 'level', projectId: 'p', worldId: 'w', levelId: 'l', subId: 'd', itemId: 'i' })).toBe('#/p/p/w/l/@d/i');
    expect(parseRoute('#/p/p/w/l/i')).toEqual({ view: 'level', projectId: 'p', worldId: 'w', levelId: 'l', itemId: 'i' });
  });

  it('holds a pad page up over any screen', () => {
    expect(href({ view: 'projects', pad: 'today' })).toBe('#/~today');
    expect(href({ view: 'world', projectId: 'p', worldId: 'w', pad: 'inbox' })).toBe('#/p/p/w/~inbox');
    expect(parseRoute('#/p/p/w/l/i/~today')).toEqual({ view: 'level', projectId: 'p', worldId: 'w', levelId: 'l', itemId: 'i', pad: 'today' });
    // The old link still opens it; unknown pages are just ids.
    expect(parseRoute('#/today')).toEqual({ view: 'projects', pad: 'today' });
    expect(parseRoute('#/review')).toEqual({ view: 'projects', pad: 'review' });
    expect(parseRoute('#/p/p/~review')).toEqual({ view: 'overworld', projectId: 'p', pad: 'review' });
    expect(withPad({ view: 'prs', pad: 'today' }, undefined)).toEqual({ view: 'prs' });
    expect(togglePad({ view: 'prs', pad: 'inbox' }, 'inbox')).toEqual({ view: 'prs' });
    expect(togglePad({ view: 'prs', pad: 'today' }, 'inbox')).toEqual({ view: 'prs', pad: 'inbox' });
  });

  it('falls back to the project list for unknown hashes', () => {
    expect(parseRoute('#/nope')).toEqual({ view: 'projects' });
    expect(parseRoute('')).toEqual({ view: 'projects' });
  });
});
