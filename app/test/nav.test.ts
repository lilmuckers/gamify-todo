import { describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { navFor } from '../src/nav';
import type { Route } from '../src/router';
import { level, state } from '../../shared/test/fixtures';

// Project "p": world "w" (levels lvl, two), world "x" (level three).
function fakeApp(route: Route): App {
  const s = state();
  s.worlds.w.levels.push(level({ id: 'two', name: 'Two' }));
  s.worlds.x = { id: 'x', name: 'X', theme: 'ice', goalIds: [], levels: [level({ id: 'three', name: 'Three' })] };
  s.overworld.worldOrder.push('x');
  return { route, state: s, pullView: () => undefined } as unknown as App;
}

describe('navFor', () => {
  it('steps through levels across world boundaries, with up to the world map', () => {
    const nav = navFor(fakeApp({ view: 'level', projectId: 'p', worldId: 'w', levelId: 'two' }));
    expect(nav.crumbs.map((c) => c.label)).toEqual(['Quest Log', 'T', 'W', 'Two']);
    expect(nav.up).toEqual({ label: 'W map', href: '#/p/p/w' });
    expect(nav.prev?.href).toBe('#/p/p/w/lvl');
    expect(nav.next).toEqual({ label: 'X: Three', href: '#/p/p/x/three' });
  });

  it('has no prev on the first level or next on the last', () => {
    expect(navFor(fakeApp({ view: 'level', projectId: 'p', worldId: 'w', levelId: 'lvl' })).prev).toBeUndefined();
    expect(navFor(fakeApp({ view: 'level', projectId: 'p', worldId: 'x', levelId: 'three' })).next).toBeUndefined();
  });

  it('steps between worlds on a world map and goes up to the project', () => {
    const nav = navFor(fakeApp({ view: 'world', projectId: 'p', worldId: 'x' }));
    expect(nav.up?.href).toBe('#/p/p');
    expect(nav.prev?.label).toBe('W');
    expect(nav.next).toBeUndefined();
  });

  it('goes back up the pipe from a sub-level, to the dependency', () => {
    const nav = navFor(fakeApp({ view: 'level', projectId: 'p', worldId: 'w', levelId: 'two', subId: 'dep' }));
    expect(nav.crumbs.map((c) => c.label)).toEqual(['Quest Log', 'T', 'W', 'Two', '⬇ dep']);
    expect(nav.up?.href).toBe('#/p/p/w/two/dep');
    expect(nav.prev).toBeUndefined();
    expect(nav.next).toBeUndefined();
  });

  it('always offers a way back from the Warp Zone and projects', () => {
    expect(navFor(fakeApp({ view: 'prs' })).up?.href).toBe('#/');
    expect(navFor(fakeApp({ view: 'pr', pr: 3 })).up?.href).toBe('#/prs');
    expect(navFor(fakeApp({ view: 'overworld', projectId: 'p' })).up?.href).toBe('#/');
    expect(navFor(fakeApp({ view: 'projects' })).up).toBeUndefined();
    expect(navFor(fakeApp({ view: 'today' }))).toMatchObject({ crumbs: [{ label: 'Quest Log' }, { label: 'Today', href: '#/today' }], up: { href: '#/' } });
    const fromLevel = fakeApp({ view: 'today' });
    fromLevel.previousRoute = { view: 'level', projectId: 'p', worldId: 'w', levelId: 'two' };
    expect(navFor(fromLevel).up).toEqual({ label: 'Back', href: '#/p/p/w/two' });
  });
});
