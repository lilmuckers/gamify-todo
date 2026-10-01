import { describe, expect, it } from 'vitest';
import { href, parseRoute, type Route } from '../src/router';

describe('router deep links', () => {
  const routes: Route[] = [
    { view: 'projects' },
    { view: 'overworld', projectId: 'house' },
    { view: 'world', projectId: 'house', worldId: 'kitchen' },
    { view: 'level', projectId: 'house', worldId: 'kitchen', levelId: 'demo' },
    { view: 'level', projectId: 'house', worldId: 'kitchen', levelId: 'demo', itemId: 'rent-skip' },
    { view: 'prs' },
    { view: 'pr', pr: 7 },
    { view: 'pr-level', pr: 7, projectId: 'house', worldId: 'kitchen', levelId: 'demo' },
    { view: 'pr-level', pr: 7, projectId: 'house', worldId: 'kitchen', levelId: 'demo', itemId: 'x' },
  ];

  it('round-trips every screen through the URL', () => {
    for (const r of routes) {
      const back = parseRoute(href(r));
      expect({ ...back, itemId: (back as any).itemId ?? undefined }).toEqual({ ...r, itemId: (r as any).itemId ?? undefined });
    }
  });

  it('falls back to the project list for unknown hashes', () => {
    expect(parseRoute('#/nope')).toEqual({ view: 'projects' });
    expect(parseRoute('')).toEqual({ view: 'projects' });
  });
});
