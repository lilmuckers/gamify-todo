import { describe, expect, it } from 'vitest';
import { ConflictError, GitHubClient, GitHubError, parseRepo, STUB_PATH, WorkflowPermissionError } from '../src/index';

type Route = (url: string, init: RequestInit) => { status?: number; json?: unknown; text?: string; bytes?: Uint8Array } | undefined;

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
      // Like fetch: an empty body isn't JSON (GitHub's 201 for a new secret has none).
      json: async () => {
        if (r.json === undefined) throw new SyntaxError('Unexpected end of JSON input');
        return r.json;
      },
      text: async () => r.text ?? (r.json === undefined ? '' : JSON.stringify(r.json)),
      arrayBuffer: async () => (r.bytes ?? new Uint8Array()).slice().buffer,
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

  it('reads one page of what data commits changed, newest first, skipping merges', async () => {
    const { fn, calls } = fakeFetch((url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/commits') && u.searchParams.get('path') === 'data')
        return {
          json: [
            { sha: 'm', parents: [{ sha: 'b' }, { sha: 'x' }], commit: { message: 'Merge', committer: { date: '2026-10-03T10:00:00Z' } } },
            { sha: 'b', parents: [{ sha: 'a' }], commit: { message: 'quest: done: X (p/w/l)', author: { date: '2026-10-02T09:59:00Z' }, committer: { date: '2026-10-02T10:00:00Z' } } },
            { sha: 'a', parents: [{ sha: 'z' }], commit: { message: 'add level', committer: { date: '2026-10-01T10:00:00Z' } } },
          ],
        };
      if (u.pathname.endsWith('/commits/b')) return { json: { files: [{ filename: 'data/p/w/l.json', status: 'modified', sha: 'blob-b' }, { filename: 'README.md', status: 'modified', sha: 'r' }] } };
      if (u.pathname.endsWith('/commits/a')) return { json: { files: [{ filename: 'data/p/w/l.json', status: 'added', sha: 'blob-a' }] } };
      if (u.pathname.endsWith('/contents/data/p/w/l.json') && u.searchParams.get('ref') === 'a') return { text: 'BEFORE' };
      if (u.pathname.endsWith('/git/blobs/blob-b')) return { text: 'AFTER-B' };
      if (u.pathname.endsWith('/git/blobs/blob-a')) return { text: 'AFTER-A' };
    });
    const page = await new GitHubClient('tok', repo, fn).dataChangesPage({ until: '2026-10-04T00:00:00Z', limit: 3 });
    expect(page.commits.map((c) => c.sha)).toEqual(['b', 'a']);
    expect(page.commits[0]).toMatchObject({ date: '2026-10-02T09:59:00Z', files: [{ path: 'data/p/w/l.json', before: 'BEFORE', after: 'AFTER-B' }] });
    expect(page.commits[1].files).toEqual([{ path: 'data/p/w/l.json', before: undefined, after: 'AFTER-A' }]);
    // A full page: there may be more, older than the oldest commit date listed.
    expect(page).toMatchObject({ more: true, oldest: '2026-10-01T10:00:00Z', requests: 6 });
    const q = new URL(calls[0].url).searchParams;
    expect([q.get('until'), q.get('per_page')]).toEqual(['2026-10-04T00:00:00Z', '3']);
    expect(calls.some((c) => c.url.includes('/commits/m'))).toBe(false);
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

  it('writes only data/ and the Quest Log workflow', async () => {
    const { fn, calls } = fakeFetch((url, init) => {
      if (url.endsWith('/git/commits/parent')) return { json: { tree: { sha: 'tree0' } } };
      if (url.endsWith('/git/trees') && init.method === 'POST') return { json: { sha: 'tree1' } };
      if (url.endsWith('/git/commits') && init.method === 'POST') return { json: { sha: 'c1' } };
      if (url.endsWith('/git/refs/heads/main')) return { json: {} };
    });
    const gh = new GitHubClient('tok', repo, fn);
    await expect(gh.commitFiles({ '.github/workflows/other.yml': 'x' }, 'msg', 'parent')).rejects.toThrow(/doesn't write \.github\/workflows\/other\.yml/);
    await expect(gh.commitFiles({ 'README.md': 'x', 'data/automation.json': '{}' }, 'msg', 'parent')).rejects.toThrow(/README/);
    expect(calls).toHaveLength(0);
    await gh.putWorkflow('name: Quest Log\n', 'msg', 'parent', { 'data/automation.json': '{}' });
    const tree = calls.find((c) => c.url.endsWith('/git/trees'))!.body;
    expect(tree.tree.map((e: { path: string }) => e.path)).toEqual(['data/automation.json', STUB_PATH]);
  });

  it('says when a commit needs the Workflows permission, rather than calling it a conflict', async () => {
    const { fn } = fakeFetch((url, init) => {
      if (url.endsWith('/git/commits/parent')) return { json: { tree: { sha: 'tree0' } } };
      if (init.method === 'POST') return { json: { sha: 'x' } };
      if (url.endsWith('/git/refs/heads/main'))
        return { status: 422, json: { message: 'refusing to allow a GitHub App to create or update workflow `.github/workflows/quest.yml` without `workflows` permission' } };
    });
    const err = await new GitHubClient('tok', repo, fn).putWorkflow('x', 'msg', 'parent').catch((e) => e);
    expect(err).toBeInstanceOf(WorkflowPermissionError);
    expect(err.message).toContain('"Workflows: read & write"');
  });

  it('names the missing permission on a 403, but not for rate limits', async () => {
    let message = 'Resource not accessible by integration';
    const { fn } = fakeFetch(() => ({ status: 403, json: { message } }));
    const gh = new GitHubClient('tok', repo, fn);
    await expect(gh.listSecrets()).rejects.toThrow(/needs the "Secrets: read & write" permission/);
    await expect(gh.latestRuns()).rejects.toThrow(/needs the "Actions: read" permission/);
    message = 'API rate limit exceeded';
    const err = await gh.latestRuns().catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.message).not.toContain('permission');
  });

  it('reads one file at a ref, or nothing when it is missing', async () => {
    const { fn, calls } = fakeFetch((url) => {
      if (url.endsWith('/contents/.github/workflows/quest.yml?ref=abc')) return { text: 'name: Quest Log\n' };
    });
    const gh = new GitHubClient('tok', repo, fn);
    expect(await gh.readFile(STUB_PATH, 'abc')).toBe('name: Quest Log\n');
    expect(await gh.readFile('data/automation.json', 'abc')).toBeUndefined();
    expect(calls[0].url).toBe('https://api.github.com/repos/o/r/contents/.github/workflows/quest.yml?ref=abc');
  });

  it('sets, lists and deletes Actions secrets by name', async () => {
    const { fn, calls } = fakeFetch((url, init) => {
      if (url.endsWith('/actions/secrets/public-key')) return { json: { key_id: 'k1', key: 'AAAA' } };
      if (url.endsWith('/actions/secrets?per_page=100')) return { json: { total_count: 1, secrets: [{ name: 'QUEST_VAPID_PRIVATE_KEY' }] } };
      if (url.includes('/actions/secrets/QUEST_') && (init.method === 'PUT' || init.method === 'DELETE')) return { status: init.method === 'PUT' ? 201 : 204 };
    });
    const gh = new GitHubClient('tok', repo, fn);
    expect(await gh.secretsPublicKey()).toEqual({ key_id: 'k1', key: 'AAAA' });
    await gh.putSecret('QUEST_VAPID_PRIVATE_KEY', 'c2VhbGVk', 'k1');
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', body: { encrypted_value: 'c2VhbGVk', key_id: 'k1' } });
    expect(await gh.listSecrets()).toEqual(['QUEST_VAPID_PRIVATE_KEY']);
    await gh.deleteSecret('QUEST_VAPID_PRIVATE_KEY');
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: 'https://api.github.com/repos/o/r/actions/secrets/QUEST_VAPID_PRIVATE_KEY' });
  });

  it('finds the newest Quest Log run and downloads its status artifact', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 5, 6]);
    const { fn, calls } = fakeFetch((url) => {
      if (url.endsWith('/actions/workflows/quest.yml/runs?per_page=1'))
        return {
          json: {
            workflow_runs: [
              { id: 7, event: 'push', status: 'completed', conclusion: 'success', created_at: '2026-10-28T09:00:00Z', run_started_at: '2026-10-28T09:00:05Z', html_url: 'https://github.com/o/r/actions/runs/7' },
            ],
          },
        };
      if (url.endsWith('/actions/runs/7/artifacts?name=quest-status'))
        return { json: { artifacts: [{ name: 'quest-status', expired: false, archive_download_url: 'https://api.github.com/repos/o/r/actions/artifacts/9/zip' }] } };
      if (url.endsWith('/actions/runs/8/artifacts?name=quest-status'))
        return { json: { artifacts: [{ name: 'quest-status', expired: true, archive_download_url: 'https://api.github.com/x' }] } };
      if (url.endsWith('/actions/artifacts/9/zip')) return { bytes: zip };
    });
    const gh = new GitHubClient('tok', repo, fn);
    expect(await gh.latestRuns()).toEqual([
      { id: 7, event: 'push', status: 'completed', conclusion: 'success', createdAt: '2026-10-28T09:00:05Z', url: 'https://github.com/o/r/actions/runs/7' },
    ]);
    expect(await gh.runArtifact(7, 'quest-status')).toEqual(zip);
    expect(calls.at(-1)!.auth).toBe('Bearer tok');
    expect(await gh.runArtifact(8, 'quest-status')).toBeUndefined();
    // Not installed: GitHub has no such workflow.
    const none = fakeFetch(() => undefined);
    expect(await new GitHubClient('tok', repo, none.fn).latestRuns()).toEqual([]);
  });

  it('parses repo references', () => {
    expect(parseRepo('git@github.com:lilmuckers/gamify-todo.git')).toMatchObject({ owner: 'lilmuckers', repo: 'gamify-todo' });
    expect(parseRepo('https://github.com/a/b')).toMatchObject({ owner: 'a', repo: 'b' });
    expect(parseRepo('a/b', 'dev')).toEqual({ owner: 'a', repo: 'b', branch: 'dev' });
    expect(parseRepo('nonsense')).toBeUndefined();
  });
});
