import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFirstVisit, VISIT_KEYS } from '../src/config';
import { DemoSource } from '../src/data/demo';
import { tokenReport } from '../src/ui/onboarding/token-check';

const storage = (data: Record<string, string>) => ({ getItem: (k: string) => data[k] ?? null });

describe('isFirstVisit', () => {
  it('is true only when none of the Quest Log keys exist', () => {
    expect(isFirstVisit(storage({}))).toBe(true);
    expect(isFirstVisit(storage({ unrelated: 'x' }))).toBe(true);
    for (const k of VISIT_KEYS) expect(isFirstVisit(storage({ [k]: '1' })), k).toBe(false);
  });

  it('treats blocked or missing storage as not first (a dismissal could not be remembered)', () => {
    expect(isFirstVisit({ getItem: () => { throw new Error('SecurityError'); } })).toBe(false);
    expect(isFirstVisit(undefined)).toBe(false);
  });
});

describe('DemoSource', () => {
  afterEach(() => vi.unstubAllGlobals());

  const seedFiles = {
    'data/p/project.json': JSON.stringify({ id: 'p', title: 'P', goals: [{ id: 'g', title: 'G' }], worldOrder: [] }),
  };

  it('loads the example files once and keeps commits in memory, with no network writes', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    let loads = 0;
    const demo = new DemoSource({ loadFiles: async () => (loads++, structuredClone(seedFiles)) });
    expect(demo.caps.canEdit).toBe(true);
    const first = await demo.load();
    expect(Object.keys(first.state.projects)).toEqual(['p']);
    const v = await demo.commit({ 'data/p/project.json': seedFiles['data/p/project.json'].replace('"P"', '"Renamed"') }, 'edit', first.version);
    expect(v).not.toBe(first.version);
    const after = await demo.load();
    expect(after.version).toBe(v);
    expect(after.state.projects.p.overworld.title).toBe('Renamed');
    await demo.commit({ 'data/p/project.json': null }, 'delete', v);
    expect(Object.keys((await demo.load()).state.projects)).toEqual([]);
    expect(loads).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('tokenReport', () => {
  const user = { ok: true as const, value: { login: 'me' } };
  const repo = (canPush: boolean, empty = false) => ({ ok: true as const, value: { canPush, empty } });
  const yes = { ok: true as const, value: true as const };
  const no = (status: number) => ({ ok: false as const, status });

  it('passes a token that can save, see PRs and checks', () => {
    const r = tokenReport({ user, repo: repo(true), pulls: yes, checks: yes });
    expect(r).toMatchObject({ ok: true, login: 'me', problem: undefined });
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it('names the first problem worth fixing, as an enum', () => {
    expect(tokenReport({ user: no(401), repo: no(0) }).problem).toBe('bad_token');
    expect(tokenReport({ user: no(0), repo: no(0) }).problem).toBe('network');
    expect(tokenReport({ user, repo: no(404) }).problem).toBe('no_access');
    expect(tokenReport({ user, repo: repo(true, true), pulls: yes })).toMatchObject({ ok: false, problem: 'empty_repo' });
    expect(tokenReport({ user, repo: repo(false), pulls: yes, checks: yes })).toMatchObject({ ok: false, problem: 'missing_contents' });
  });

  it('treats PRs and checks as optional extras', () => {
    expect(tokenReport({ user, repo: repo(true), pulls: no(403), checks: yes })).toMatchObject({ ok: true, problem: 'missing_pulls' });
    expect(tokenReport({ user, repo: repo(true), pulls: yes, checks: no(403) })).toMatchObject({ ok: true, problem: 'missing_checks' });
  });

  it('never puts token text in its output', () => {
    const r = tokenReport({ user, repo: repo(false) });
    expect(JSON.stringify(r)).not.toMatch(/github_pat|ghp_/);
  });
});
