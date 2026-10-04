import { describe, expect, it } from 'vitest';
import { GitHubClient, GitHubError, SignInExpiredError, type TokenProvider } from '@quest/shared';
import { handle, type Env } from '../../worker/src/index';
import { discoverRepos, isQuestRepo, type GitHubGet } from '../src/auth/discover';
import {
  authorizeUrl,
  codeChallenge,
  newVerifier,
  parseCallback,
  randomString,
  SignInError,
  VERIFIER_PATTERN,
  workerTokens,
} from '../src/auth/oauth';
import { needsSignIn, RefreshingToken, REFRESH_EARLY_MS, type SessionDeps } from '../src/auth/session';
import { parseStoredToken, type StoredToken } from '../src/config';

const SITE = 'https://tasks.patrick-mckinley.com';

describe('PKCE and state', () => {
  it('makes verifiers the Worker accepts', () => {
    for (let i = 0; i < 50; i++) expect(newVerifier()).toMatch(VERIFIER_PATTERN);
    expect(new Set(Array.from({ length: 20 }, () => newVerifier())).size).toBe(20);
  });

  it('uses only unreserved characters, evenly, whatever bytes come in', () => {
    // All 0xff: every byte is dropped, so it asks for more until the bad run ends.
    let calls = 0;
    const s = randomString(10, (b) => b.fill(calls++ ? 7 : 255));
    expect(s).toBe('H'.repeat(10));
    expect(randomString(66 * 3, (b) => b.map((_, i) => i % 66))).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('computes the RFC 7636 S256 challenge', async () => {
    // RFC 7636 Appendix B.
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('builds the authorize URL with a challenge and state', () => {
    const url = new URL(authorizeUrl({ clientId: 'Iv23x', redirectUri: `${SITE}/`, state: 'st', challenge: 'ch' }));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'Iv23x',
      redirect_uri: `${SITE}/`,
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
  });
});

describe('callback parsing', () => {
  it('takes a sign-in callback off the query string', () => {
    expect(parseCallback('?code=abc&state=xyz')).toEqual({ callback: { kind: 'code', code: 'abc', state: 'xyz', setupAction: undefined }, search: '' });
  });

  it('keeps unrelated parameters and bare flags', () => {
    expect(parseCallback('?mobile=on&code=abc&state=xyz&demo').search).toBe('?mobile=on&demo');
  });

  it('reads cancels and errors, dropping their descriptions', () => {
    const r = parseCallback('?error=access_denied&error_description=The+user+said+no&error_uri=https%3A%2F%2Fdocs&state=s');
    expect(r).toEqual({ callback: { kind: 'error', error: 'access_denied' }, search: '' });
  });

  it('spots an install, with or without a code', () => {
    expect(parseCallback('?code=c&installation_id=9&setup_action=install').callback).toEqual({ kind: 'code', code: 'c', state: undefined, setupAction: 'install' });
    expect(parseCallback('?installation_id=9&setup_action=update')).toEqual({ callback: { kind: 'install', setupAction: 'update' }, search: '' });
  });

  it('leaves other URLs alone', () => {
    expect(parseCallback('?share-title=Hi')).toEqual({ callback: { kind: 'none' }, search: '?share-title=Hi' });
    expect(parseCallback('')).toEqual({ callback: { kind: 'none' }, search: '' });
  });
});

describe('stored tokens', () => {
  it('reads a bare string from before sign-in as a PAT', () => {
    expect(parseStoredToken('github_pat_abc')).toEqual({ token: 'github_pat_abc', kind: 'pat' });
    expect(parseStoredToken('  ghp_x \n')).toEqual({ token: 'ghp_x', kind: 'pat' });
  });

  it('reads a sign-in session', () => {
    const s: StoredToken = { token: 'ghu_a', kind: 'app', refresh: 'ghr_r', expiresAt: 1000, refreshExpiresAt: 2000 };
    expect(parseStoredToken(JSON.stringify(s))).toEqual(s);
  });

  it('ignores junk', () => {
    expect(parseStoredToken(undefined)).toBeUndefined();
    expect(parseStoredToken('')).toBeUndefined();
    expect(parseStoredToken('{not json')).toBeUndefined();
    expect(parseStoredToken('{"kind":"app"}')).toBeUndefined();
    expect(parseStoredToken('{"token":"t","kind":"app","expiresAt":"soon"}')).toEqual({ token: 't', kind: 'app' });
  });

  it('knows when a session needs signing in again', () => {
    const now = 10_000;
    expect(needsSignIn({ token: 't', kind: 'pat' }, now)).toBe(false);
    expect(needsSignIn({ token: 't', kind: 'app', refresh: 'r', expiresAt: now - 1 }, now)).toBe(false);
    expect(needsSignIn({ token: 't', kind: 'app', expiresAt: now - 1 }, now)).toBe(true);
    expect(needsSignIn({ token: 't', kind: 'app', refresh: 'r', expiresAt: now - 1, refreshExpiresAt: now - 1 }, now)).toBe(true);
    // An App with token expiry turned off.
    expect(needsSignIn({ token: 't', kind: 'app' }, now)).toBe(false);
  });
});

describe('talking to the Worker', () => {
  const env: Env = { GITHUB_CLIENT_ID: 'Iv23id', GITHUB_CLIENT_SECRET: 'shh', ALLOWED_ORIGINS: SITE };

  /** The real Worker in front of a fake GitHub, reached as if over the network from the site. */
  function viaWorker(reply: Record<string, unknown>) {
    const sent: Record<string, string>[] = [];
    const github = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(reply));
    }) as typeof fetch;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const req = new Request(url, { ...init, headers: { ...(init.headers as Record<string, string>), Origin: SITE } });
      return handle(req, env, github);
    }) as typeof fetch;
    return { sent, fetchImpl };
  }

  it('swaps a code and a generated verifier for a session', async () => {
    const w = viaWorker({ access_token: 'ghu_a', refresh_token: 'ghr_r', expires_in: 28800, refresh_token_expires_in: 15897600 });
    const verifier = newVerifier();
    const s = await workerTokens('https://auth.example/', '/exchange', { code: 'c0de', code_verifier: verifier }, { fetch: w.fetchImpl, now: 1000 });
    expect(s).toEqual({ kind: 'app', token: 'ghu_a', refresh: 'ghr_r', expiresAt: 1000 + 28800_000, refreshExpiresAt: 1000 + 15897600_000 });
    expect(w.sent[0]).toMatchObject({ code: 'c0de', code_verifier: verifier });
  });

  it('reports the Worker’s errors by code', async () => {
    const w = viaWorker({ error: 'bad_refresh_token' });
    const err = await workerTokens('https://auth.example', '/refresh', { refresh_token: 'old' }, { fetch: w.fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(SignInError);
    expect(err).toMatchObject({ code: 'bad_refresh_token', status: 401 });
    const bad = viaWorker({ error: 'bad_verification_code' });
    await expect(workerTokens('https://auth.example', '/exchange', { code: 'c', code_verifier: newVerifier() }, { fetch: bad.fetchImpl })).rejects.toMatchObject({
      code: 'bad_verification_code',
    });
  });

  it('turns a network failure into a SignInError', async () => {
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(workerTokens('https://auth.example', '/refresh', { refresh_token: 'r' }, { fetch: down })).rejects.toMatchObject({ code: 'network' });
  });
});

/** A browser's localStorage and the Worker, in miniature. */
function session(initial: StoredToken | undefined, opts: { now?: number; online?: boolean } = {}) {
  let stored = initial && { ...initial };
  const saves: StoredToken[] = [];
  const refreshes: string[] = [];
  let n = 0;
  let fail: SignInError | undefined;
  let gate: Promise<void> | undefined;
  const clock = { now: opts.now ?? 1_000_000 };
  const deps: SessionDeps = {
    load: () => stored && { ...stored },
    save: (s) => {
      stored = { ...s };
      saves.push({ ...s });
    },
    refresh: async (r) => {
      refreshes.push(r);
      await gate;
      if (fail) throw fail;
      n++;
      return { kind: 'app', token: `ghu_${n}`, refresh: `ghr_${n}`, expiresAt: clock.now + 8 * 3600_000, refreshExpiresAt: clock.now + 180 * 86400_000 };
    },
    now: () => clock.now,
    online: () => opts.online ?? true,
  };
  return {
    deps,
    clock,
    saves,
    refreshes,
    get: () => stored,
    set: (s: StoredToken) => (stored = { ...s }),
    failWith: (code: string) => (fail = new SignInError(code)),
    hold: () => {
      let open!: () => void;
      gate = new Promise((r) => (open = r));
      return open;
    },
  };
}

describe('RefreshingToken', () => {
  const fresh = (now: number): StoredToken => ({ kind: 'app', token: 'ghu_0', refresh: 'ghr_0', expiresAt: now + 3600_000, refreshExpiresAt: now + 86400_000 });

  it('hands out the token until it is about to expire', async () => {
    const s = session(undefined);
    s.set(fresh(s.clock.now));
    const p = new RefreshingToken(s.deps);
    expect(await p.get()).toBe('ghu_0');
    s.clock.now += 3600_000 - REFRESH_EARLY_MS + 1;
    expect(await p.get()).toBe('ghu_1');
    expect(s.refreshes).toEqual(['ghr_0']);
    // The rotated refresh token is saved.
    expect(s.get()).toMatchObject({ token: 'ghu_1', refresh: 'ghr_1' });
  });

  it('shares one refresh between concurrent requests', async () => {
    const s = session(undefined);
    s.set({ ...fresh(s.clock.now), expiresAt: s.clock.now - 1 });
    const p = new RefreshingToken(s.deps);
    const open = s.hold();
    const all = Promise.all([p.get(), p.get(), p.renew('ghu_0'), p.get()]);
    open();
    expect(await all).toEqual(['ghu_1', 'ghu_1', 'ghu_1', 'ghu_1']);
    expect(s.refreshes).toEqual(['ghr_0']);
  });

  it('saves the new session before handing out its token', async () => {
    const s = session(undefined);
    s.set({ ...fresh(s.clock.now), expiresAt: s.clock.now });
    const order: string[] = [];
    const save = s.deps.save;
    s.deps.save = (x) => (order.push('save'), save(x));
    const token = await new RefreshingToken(s.deps).get().then((t) => (order.push('use'), t));
    expect(token).toBe('ghu_1');
    expect(order).toEqual(['save', 'use']);
  });

  it('uses a token another tab already refreshed, instead of spending the old refresh token', async () => {
    const s = session(undefined);
    s.set({ ...fresh(s.clock.now), expiresAt: s.clock.now });
    const p = new RefreshingToken(s.deps);
    // The other tab got the lock first and saved its result.
    s.deps.lock = async (fn) => {
      s.set({ kind: 'app', token: 'ghu_other', refresh: 'ghr_other', expiresAt: s.clock.now + 8 * 3600_000 });
      return fn();
    };
    expect(await p.get()).toBe('ghu_other');
    expect(s.refreshes).toEqual([]);
  });

  it('refreshes once when GitHub rejects a token early', async () => {
    const s = session(undefined);
    s.set(fresh(s.clock.now));
    const p = new RefreshingToken(s.deps);
    expect(await p.renew('ghu_0')).toBe('ghu_1');
    expect(s.refreshes).toEqual(['ghr_0']);
  });

  it('never refreshes while offline', async () => {
    const s = session(undefined, { online: false });
    s.set({ ...fresh(s.clock.now), expiresAt: s.clock.now - 1 });
    const p = new RefreshingToken(s.deps);
    expect(await p.get()).toBe('ghu_0');
    expect(await p.renew('ghu_0')).toBeUndefined();
    expect(s.refreshes).toEqual([]);
  });

  it('gives up for good on a dead refresh token, and stops asking the Worker', async () => {
    const s = session(undefined);
    s.set({ ...fresh(s.clock.now), expiresAt: s.clock.now - 1 });
    let told = 0;
    s.deps.onExpired = () => told++;
    s.failWith('bad_refresh_token');
    const p = new RefreshingToken(s.deps);
    await expect(p.get()).rejects.toBeInstanceOf(SignInExpiredError);
    expect(s.get()).toMatchObject({ kind: 'app', refresh: undefined });
    expect(needsSignIn(s.get(), s.clock.now)).toBe(true);
    await expect(p.get()).rejects.toBeInstanceOf(SignInExpiredError);
    expect(s.refreshes).toHaveLength(1);
    expect(told).toBe(2);
  });

  it('treats a refresh token past its expiry as dead without asking', async () => {
    const s = session(undefined);
    s.set({ ...fresh(s.clock.now), expiresAt: s.clock.now - 1, refreshExpiresAt: s.clock.now - 1 });
    await expect(new RefreshingToken(s.deps).get()).rejects.toBeInstanceOf(SignInExpiredError);
    expect(s.refreshes).toEqual([]);
  });

  it('keeps the session through a network blip or rate limit', async () => {
    const s = session(undefined);
    s.set({ ...fresh(s.clock.now), expiresAt: s.clock.now - 1 });
    s.failWith('rate_limited');
    const p = new RefreshingToken(s.deps);
    await expect(p.get()).rejects.toMatchObject({ code: 'rate_limited' });
    expect(s.get()).toMatchObject({ refresh: 'ghr_0' });
  });

  it('hands back a pasted token without refreshing it', async () => {
    const s = session({ kind: 'pat', token: 'github_pat_x' });
    const p = new RefreshingToken(s.deps);
    expect(await p.get()).toBe('github_pat_x');
    expect(await p.renew('github_pat_x')).toBe('github_pat_x');
    expect(s.refreshes).toEqual([]);
  });
});

describe('GitHubClient with a token provider', () => {
  function provider(tokens: string[]): TokenProvider & { renewed: string[] } {
    let i = 0;
    const renewed: string[] = [];
    return {
      renewed,
      get: async () => tokens[i],
      renew: async (old) => (renewed.push(old), tokens[++i]),
    };
  }

  function api(accept: (auth: string | null) => boolean) {
    const auths: (string | null)[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization ?? null;
      auths.push(auth);
      return accept(auth) ? new Response(JSON.stringify({ login: 'me' })) : new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
    }) as typeof fetch;
    return { auths, fetchImpl };
  }

  it('renews once on a 401 and retries with the new token', async () => {
    const gh = api((a) => a === 'Bearer ghu_new');
    const p = provider(['ghu_old', 'ghu_new']);
    const client = new GitHubClient(p, { owner: 'o', repo: 'r', branch: 'main' }, gh.fetchImpl);
    expect(await client.request('GET', 'https://api.github.com/user')).toEqual({ login: 'me' });
    expect(gh.auths).toEqual(['Bearer ghu_old', 'Bearer ghu_new']);
    expect(p.renewed).toEqual(['ghu_old']);
  });

  it('gives up after one retry', async () => {
    const gh = api(() => false);
    const client = new GitHubClient(provider(['a', 'b', 'c']), { owner: 'o', repo: 'r', branch: 'main' }, gh.fetchImpl);
    const err = (await client.request('GET', '/x').catch((e) => e)) as GitHubError;
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.status).toBe(401);
    expect(gh.auths).toHaveLength(2);
  });

  it('passes a dead sign-in on to the caller', async () => {
    const gh = api(() => false);
    const dead: TokenProvider = { get: async () => 'ghu_x', renew: async () => Promise.reject(new SignInExpiredError()) };
    const client = new GitHubClient(dead, { owner: 'o', repo: 'r', branch: 'main' }, gh.fetchImpl);
    await expect(client.request('GET', '/x')).rejects.toBeInstanceOf(SignInExpiredError);
  });

  it('leaves a plain token alone on a 401', async () => {
    const gh = api(() => false);
    const client = new GitHubClient('github_pat_x', { owner: 'o', repo: 'r', branch: 'main' }, gh.fetchImpl);
    await expect(client.request('GET', '/x')).rejects.toMatchObject({ status: 401 });
    expect(gh.auths).toEqual(['Bearer github_pat_x']);
  });
});

describe('repo discovery', () => {
  /** A fake api.github.com: paths → JSON, anything else 404. */
  function fake(routes: Record<string, unknown>): GitHubGet & { calls: string[] } {
    const calls: string[] = [];
    const get = (async (url: string) => {
      const path = url.replace('https://api.github.com', '');
      calls.push(path);
      if (path in routes) {
        const v = routes[path];
        if (v instanceof GitHubError) throw v;
        return v;
      }
      throw new GitHubError(`404 ${path}`, 404);
    }) as GitHubGet & { calls: string[] };
    get.calls = calls;
    return get;
  }
  const repo = (owner: string, name: string, pushed: string) => ({ full_name: `${owner}/${name}`, name, owner: { login: owner }, private: true, pushed_at: pushed });

  it('recognises Quest Log repos by their data folder', async () => {
    const get = fake({
      '/repos/a/settings/contents/data': [{ name: 'settings.json', type: 'file' }],
      '/repos/a/inbox/contents/data': [{ name: 'inbox.json', type: 'file' }],
      '/repos/a/project/contents/data': [{ name: 'README.md', type: 'file' }, { name: 'notes', type: 'dir' }, { name: 'garden', type: 'dir' }],
      '/repos/a/project/contents/data/garden/project.json': { name: 'project.json' },
      '/repos/a/other/contents/data': [{ name: 'stuff', type: 'dir' }],
      '/repos/a/empty/contents/data': new GitHubError('This repository is empty.', 409),
    });
    expect(await isQuestRepo(get, 'a/settings')).toBe(true);
    expect(await isQuestRepo(get, 'a/inbox')).toBe(true);
    expect(await isQuestRepo(get, 'a/project')).toBe(true);
    expect(await isQuestRepo(get, 'a/other')).toBe(false);
    expect(await isQuestRepo(get, 'a/none')).toBe(false);
    expect(await isQuestRepo(get, 'a/empty')).toBe(false);
  });

  it('lists Quest Log repos across installations, newest push first, once each', async () => {
    const get = fake({
      '/user/installations?per_page=100': { installations: [{ id: 1 }, { id: 2 }] },
      '/user/installations/1/repositories?per_page=100': { repositories: [repo('me', 'quests', '2026-09-01T00:00:00Z'), repo('me', 'dotfiles', '2026-10-01T00:00:00Z')] },
      '/user/installations/2/repositories?per_page=100': { repositories: [repo('family', 'house', '2026-10-02T00:00:00Z'), repo('me', 'quests', '2026-09-01T00:00:00Z')] },
      '/repos/me/quests/contents/data': [{ name: 'settings.json', type: 'file' }],
      '/repos/family/house/contents/data': [{ name: 'inbox.json', type: 'file' }],
    });
    const r = await discoverRepos(get);
    expect(r.installed).toBe(3);
    expect(r.repos.map((x) => x.fullName)).toEqual(['family/house', 'me/quests']);
    expect(r.repos[1]).toEqual({ fullName: 'me/quests', owner: 'me', name: 'quests', private: true, pushedAt: '2026-09-01T00:00:00Z' });
    expect(get.calls.filter((c) => c === '/repos/me/quests/contents/data')).toHaveLength(1);
  });

  it('skips a repo it can’t check rather than failing the lot', async () => {
    const get = fake({
      '/user/installations?per_page=100': { installations: [{ id: 1 }] },
      '/user/installations/1/repositories?per_page=100': { repositories: [repo('me', 'quests', '2026-09-01T00:00:00Z'), repo('me', 'broken', '2026-09-02T00:00:00Z')] },
      '/repos/me/quests/contents/data': [{ name: 'settings.json', type: 'file' }],
      '/repos/me/broken/contents/data': new GitHubError('Server Error', 500),
    });
    expect((await discoverRepos(get)).repos.map((x) => x.fullName)).toEqual(['me/quests']);
  });

  it('finds nothing when the App isn’t installed anywhere', async () => {
    const get = fake({ '/user/installations?per_page=100': { installations: [] } });
    expect(await discoverRepos(get)).toEqual({ repos: [], installed: 0 });
  });
});
