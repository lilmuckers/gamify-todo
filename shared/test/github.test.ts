import { describe, expect, it } from 'vitest';
import { ConflictError, GitHubClient, parseRepo } from '../src/index';

type Route = (url: string, init: RequestInit) => { status?: number; json?: unknown; text?: string } | undefined;

function fakeFetch(route: Route) {
  const calls: { url: string; method: string; body?: any; auth?: string }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, auth: headers.Authorization });
    const r = route(url, init) ?? { status: 404, json: { message: 'nope' } };
    const status = r.status ?? 200;
    return {
      ok: status < 300,
      status,
      statusText: String(status),
      json: async () => r.json,
      text: async () => r.text ?? JSON.stringify(r.json),
    } as Response;
  }) as typeof fetch;
  return { fn, calls };
}

const repo = { owner: 'o', repo: 'r', branch: 'main' };

describe('GitHubClient', () => {
  it('reads only data files at a commit', async () => {
    const { fn, calls } = fakeFetch((url) => {
      if (url.endsWith('/git/trees/abc?recursive=1'))
        return {
          json: {
            tree: [
              { path: 'data/p/project.json', sha: 'g1', type: 'blob' },
              { path: 'data/p/w/world.json', sha: 'w1', type: 'blob' },
              { path: 'data/p/w/deep/nope.json', sha: 'x', type: 'blob' },
              { path: 'README.md', sha: 'x', type: 'blob' },
            ],
          },
        };
      if (url.endsWith('/git/blobs/g1')) return { text: '{"g":1}' };
      if (url.endsWith('/git/blobs/w1')) return { text: '{"w":1}' };
    });
    const gh = new GitHubClient('tok', repo, fn);
    const files = await gh.readDataAt('abc');
    expect(files).toEqual({ 'data/p/project.json': '{"g":1}', 'data/p/w/world.json': '{"w":1}' });
    expect(calls.every((c) => c.auth === 'Bearer tok' && c.url.startsWith('https://api.github.com/'))).toBe(true);
  });

  it('commits atomically and maps non-fast-forward to ConflictError', async () => {
    let refStatus = 200;
    const { fn, calls } = fakeFetch((url, init) => {
      if (url.endsWith('/git/commits/parent')) return { json: { tree: { sha: 'tree0' } } };
      if (url.endsWith('/git/trees') && init.method === 'POST') return { json: { sha: 'tree1' } };
      if (url.endsWith('/git/commits') && init.method === 'POST') return { json: { sha: 'c1' } };
      if (url.endsWith('/git/refs/heads/main')) return { status: refStatus, json: { message: 'Update is not a fast forward' } };
    });
    const gh = new GitHubClient('tok', repo, fn);
    const sha = await gh.commitFiles({ 'data/p/project.json': '{}', 'data/p/old/world.json': null }, 'msg', 'parent');
    expect(sha).toBe('c1');
    const tree = calls.find((c) => c.url.endsWith('/git/trees'))!.body;
    expect(tree.base_tree).toBe('tree0');
    expect(tree.tree).toContainEqual({ path: 'data/p/old/world.json', mode: '100644', type: 'blob', sha: null });
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ sha: 'c1', force: false });

    refStatus = 422;
    await expect(gh.commitFiles({ 'data/p/project.json': '{}' }, 'msg', 'parent')).rejects.toBeInstanceOf(ConflictError);
  });

  it('tells an empty repo by its commit log, not its size', async () => {
    let commits: { status: number; json: unknown } = { status: 200, json: [{ sha: 'c1' }] };
    const { fn } = fakeFetch((url) => {
      if (url === 'https://api.github.com/user') return { json: { login: 'u' } };
      if (url.endsWith('/repos/o/r')) return { json: { permissions: { push: true }, default_branch: 'main', size: 0 } };
      if (url.endsWith('/commits?per_page=1')) return commits;
    });
    const gh = new GitHubClient('tok', repo, fn);
    expect(await gh.whoami()).toMatchObject({ empty: false, canPush: true });

    commits = { status: 409, json: { message: 'Git Repository is empty.' } };
    expect(await gh.whoami()).toMatchObject({ empty: true });

    commits = { status: 500, json: { message: 'boom' } };
    await expect(gh.hasCommits()).rejects.toThrow(/500/);
  });

  it('pages through commits that touched data/', async () => {
    const commit = (i: number) => ({ sha: `s${i}`, commit: { message: `quest: done: T${i} (p/w/l)`, author: { date: `2026-10-0${1 + (i % 5)}T10:00:00Z` } } });
    const { fn, calls } = fakeFetch((url) => {
      if (!url.includes('/commits?')) return;
      const page = Number(new URL(url).searchParams.get('page'));
      return { json: page === 1 ? Array.from({ length: 100 }, (_, i) => commit(i)) : [commit(100)] };
    });
    const commits = await new GitHubClient('tok', repo, fn).dataCommits('2026-09-01T00:00:00Z');
    expect(commits).toHaveLength(101);
    expect(commits[0]).toEqual({ sha: 's0', date: '2026-10-01T10:00:00Z', message: 'quest: done: T0 (p/w/l)' });
    const q = new URL(calls[0].url).searchParams;
    expect([q.get('sha'), q.get('path'), q.get('since'), q.get('per_page')]).toEqual(['main', 'data', '2026-09-01T00:00:00Z', '100']);
    expect(calls).toHaveLength(2);
  });

  it('lists only PRs touching data files', async () => {
    const pr = (n: number) => ({ number: n, title: `PR ${n}`, user: { login: 'u' }, html_url: '', draft: false, updated_at: '', head: { sha: 's', ref: 'b', repo: { full_name: 'o/r' } }, base: { ref: 'main' } });
    const { fn } = fakeFetch((url) => {
      if (url.includes('/pulls?')) return { json: [pr(1), pr(2)] };
      if (url.includes('/pulls/1/files')) return { json: [{ filename: 'data/p/w/x.json' }, { filename: 'README.md' }] };
      if (url.includes('/pulls/2/files')) return { json: [{ filename: 'app/src/main.ts' }] };
    });
    const list = await new GitHubClient('tok', repo, fn).listDataPulls();
    expect(list.map((p) => p.number)).toEqual([1]);
    expect(list[0].dataFiles).toEqual(['data/p/w/x.json']);
  });

  it('parses repo references', () => {
    expect(parseRepo('git@github.com:lilmuckers/gamify-todo.git')).toMatchObject({ owner: 'lilmuckers', repo: 'gamify-todo' });
    expect(parseRepo('https://github.com/a/b')).toMatchObject({ owner: 'a', repo: 'b' });
    expect(parseRepo('a/b', 'dev')).toEqual({ owner: 'a', repo: 'b', branch: 'dev' });
    expect(parseRepo('nonsense')).toBeUndefined();
  });
});
