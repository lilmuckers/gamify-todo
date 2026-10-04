import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle, type Env } from '../src/index';

const SITE = 'https://tasks.patrick-mckinley.com';
const env: Env = {
  GITHUB_CLIENT_ID: 'Iv23id',
  GITHUB_CLIENT_SECRET: 'shh',
  ALLOWED_ORIGINS: `${SITE}, http://localhost:5173`,
};

const tokens = {
  access_token: 'ghu_a',
  expires_in: 28800,
  refresh_token: 'ghr_r',
  refresh_token_expires_in: 15897600,
  token_type: 'bearer',
};

/** A GitHub stand-in that records what it was sent. */
function github(reply: unknown = tokens) {
  const sent: Record<string, string>[] = [];
  const fn = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  return { fn, sent };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://auth.example${path}`, {
    method: 'POST',
    headers: { Origin: SITE, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  // Stores nothing, logs nothing.
  for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe('token exchange worker', () => {
  it('exchanges a code for tokens', async () => {
    const gh = github();
    const res = await handle(post('/exchange', { code: 'c0de', code_verifier: 'v' }), env, gh.fn);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      access_token: 'ghu_a',
      refresh_token: 'ghr_r',
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
    });
    expect(gh.sent).toEqual([{ client_id: 'Iv23id', client_secret: 'shh', code: 'c0de', code_verifier: 'v' }]);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    expect(res.headers.get('Vary')).toBe('Origin');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('refreshes a token', async () => {
    const gh = github();
    const res = await handle(post('/refresh', { refresh_token: 'ghr_old' }), env, gh.fn);
    expect(res.status).toBe(200);
    expect(gh.sent[0]).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'ghr_old' });
  });

  it('allows every listed origin', async () => {
    const res = await handle(post('/exchange', { code: 'c' }, { Origin: 'http://localhost:5173' }), env, github().fn);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it.each([
    ['another site', { Origin: 'https://evil.example' }],
    ['no Origin', { Origin: '' }],
  ])('refuses %s without CORS headers', async (_, headers) => {
    const gh = github();
    const res = await handle(post('/exchange', { code: 'c' }, headers), env, gh.fn);
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(gh.sent).toHaveLength(0);
  });

  it('answers the CORS preflight', async () => {
    const res = await handle(new Request('https://auth.example/exchange', { method: 'OPTIONS', headers: { Origin: SITE } }), env);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
  });

  it('404s unknown paths and 405s other methods', async () => {
    expect((await handle(post('/', { code: 'c' }), env)).status).toBe(404);
    const get = await handle(new Request('https://auth.example/exchange', { headers: { Origin: SITE } }), env);
    expect(get.status).toBe(405);
  });

  it.each([
    ['broken JSON', '/exchange', '{nope', {}],
    ['a JSON array', '/exchange', '[]', {}],
    ['no code', '/exchange', {}, {}],
    ['an empty code', '/exchange', { code: '' }, {}],
    ['a non-string code', '/exchange', { code: 42 }, {}],
    ['a bad verifier', '/exchange', { code: 'c', code_verifier: 7 }, {}],
    ['an oversized code', '/exchange', { code: 'x'.repeat(513) }, {}],
    ['an oversized body', '/exchange', { code: 'c', pad: 'x'.repeat(5000) }, {}],
    ['no refresh token', '/refresh', { code: 'c' }, {}],
    ['a form body', '/exchange', 'code=c', { 'Content-Type': 'application/x-www-form-urlencoded' }],
  ])('rejects %s without calling GitHub', async (_, path, body, headers) => {
    const gh = github();
    const res = await handle(post(path, body, headers), env, gh.fn);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
    expect(gh.sent).toHaveLength(0);
  });

  it.each([
    ['bad_verification_code', '/exchange', 400, 'bad_verification_code'],
    ['bad_refresh_token', '/refresh', 401, 'bad_refresh_token'],
    ['incorrect_client_credentials', '/exchange', 500, 'server_misconfigured'],
    ['something_new', '/exchange', 502, 'something_new'],
  ])('maps GitHub’s %s to %s', async (code, path, status, error) => {
    const body = path === '/exchange' ? { code: 'c' } : { refresh_token: 'r' };
    const res = await handle(post(path, body), env, github({ error: code }).fn);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
  });

  it('502s when GitHub is down', async () => {
    const down = (async () => new Response('', { status: 503 })) as typeof fetch;
    const res = await handle(post('/exchange', { code: 'c' }), env, down);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_error' });
  });

  it('500s without calling GitHub when the secret is missing', async () => {
    const gh = github();
    const res = await handle(post('/exchange', { code: 'c' }), { ...env, GITHUB_CLIENT_SECRET: '' }, gh.fn);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_misconfigured' });
    expect(gh.sent).toHaveLength(0);
  });
});
