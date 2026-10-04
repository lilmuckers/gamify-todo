import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle, type Env } from '../src/index';

const SITE = 'https://tasks.patrick-mckinley.com';
/** A valid PKCE verifier (43–128 unreserved characters). */
const V = 'v'.repeat(43);
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
    const res = await handle(post('/exchange', { code: 'c0de', code_verifier: V }), env, gh.fn);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      access_token: 'ghu_a',
      refresh_token: 'ghr_r',
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
    });
    expect(gh.sent).toEqual([{ client_id: 'Iv23id', client_secret: 'shh', code: 'c0de', code_verifier: V }]);
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
    const res = await handle(post('/exchange', { code: 'c', code_verifier: V }, { Origin: 'http://localhost:5173' }), env, github().fn);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it.each([
    ['another site', { Origin: 'https://evil.example' }],
    ['no Origin', { Origin: '' }],
  ])('refuses %s without CORS headers', async (_, headers) => {
    const gh = github();
    const res = await handle(post('/exchange', { code: 'c', code_verifier: V }, headers), env, gh.fn);
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
    expect((await handle(post('/', { code: 'c', code_verifier: V }), env)).status).toBe(404);
    const get = await handle(new Request('https://auth.example/exchange', { headers: { Origin: SITE } }), env);
    expect(get.status).toBe(405);
  });

  it.each([
    ['broken JSON', '/exchange', '{nope', {}],
    ['a JSON array', '/exchange', '[]', {}],
    ['no code', '/exchange', { code_verifier: V }, {}],
    ['an empty code', '/exchange', { code: '', code_verifier: V }, {}],
    ['a non-string code', '/exchange', { code: 42, code_verifier: V }, {}],
    ['no PKCE verifier', '/exchange', { code: 'c' }, {}],
    ['a non-string verifier', '/exchange', { code: 'c', code_verifier: 7 }, {}],
    ['a short verifier', '/exchange', { code: 'c', code_verifier: 'v'.repeat(42) }, {}],
    ['a long verifier', '/exchange', { code: 'c', code_verifier: 'v'.repeat(129) }, {}],
    ['a verifier with odd characters', '/exchange', { code: 'c', code_verifier: `${'v'.repeat(42)}/` }, {}],
    ['an oversized code', '/exchange', { code: 'x'.repeat(513), code_verifier: V }, {}],
    ['an oversized body', '/exchange', { code: 'c', code_verifier: V, pad: 'x'.repeat(5000) }, {}],
    ['no refresh token', '/refresh', { code: 'c', code_verifier: V }, {}],
    ['a form body', '/exchange', 'code=c', { 'Content-Type': 'application/x-www-form-urlencoded' }],
  ])('rejects %s without calling GitHub', async (_, path, body, headers) => {
    const gh = github();
    const res = await handle(post(path, body, headers), env, gh.fn);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
    expect(gh.sent).toHaveLength(0);
  });

  it('stops reading a chunked body past 4 KB', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024).fill(32));
      },
    });
    const gh = github();
    const req = new Request('https://auth.example/exchange', {
      method: 'POST',
      headers: { Origin: SITE, 'Content-Type': 'application/json' },
      body: endless,
      duplex: 'half',
    } as RequestInit);
    const res = await handle(req, env, gh.fn);
    expect(res.status).toBe(400);
    expect(pulled).toBeLessThan(10);
    expect(gh.sent).toHaveLength(0);
  });

  it.each([
    ['bad_verification_code', '/exchange', 400, 'bad_verification_code'],
    ['bad_refresh_token', '/refresh', 401, 'bad_refresh_token'],
    ['incorrect_client_credentials', '/exchange', 500, 'server_misconfigured'],
    ['something_new', '/exchange', 502, 'something_new'],
  ])('maps GitHub’s %s to %s', async (code, path, status, error) => {
    const body = path === '/exchange' ? { code: 'c', code_verifier: V } : { refresh_token: 'r' };
    const res = await handle(post(path, body), env, github({ error: code }).fn);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
  });

  it('502s when GitHub is down', async () => {
    const down = (async () => new Response('', { status: 503 })) as typeof fetch;
    const res = await handle(post('/exchange', { code: 'c', code_verifier: V }), env, down);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_error' });
  });

  it('500s without calling GitHub when the secret is missing', async () => {
    const gh = github();
    const res = await handle(post('/exchange', { code: 'c', code_verifier: V }), { ...env, GITHUB_CLIENT_SECRET: '' }, gh.fn);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_misconfigured' });
    expect(gh.sent).toHaveLength(0);
  });

  describe('rate limit', () => {
    /** A limiter stand-in that records keys and answers as told. */
    function limiter(answer: () => Promise<{ success: boolean }>) {
      const keys: string[] = [];
      return { keys, LIMITER: { limit: async ({ key }: { key: string }) => (keys.push(key), answer()) } };
    }
    const ip = { 'CF-Connecting-IP': '203.0.113.7' };

    it('429s over the limit without calling GitHub', async () => {
      const gh = github();
      const lim = limiter(async () => ({ success: false }));
      const res = await handle(post('/exchange', { code: 'c', code_verifier: V }, ip), { ...env, LIMITER: lim.LIMITER }, gh.fn);
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: 'rate_limited' });
      expect(res.headers.get('Retry-After')).toBe('60');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
      expect(gh.sent).toHaveLength(0);
      expect(lim.keys).toEqual(['203.0.113.7']);
    });

    it('lets requests under the limit through, keyed by client IP', async () => {
      const lim = limiter(async () => ({ success: true }));
      const res = await handle(post('/refresh', { refresh_token: 'r' }, ip), { ...env, LIMITER: lim.LIMITER }, github().fn);
      expect(res.status).toBe(200);
      expect(lim.keys).toEqual(['203.0.113.7']);
    });

    it('doesn’t count preflights or forbidden origins', async () => {
      const lim = limiter(async () => ({ success: false }));
      const e = { ...env, LIMITER: lim.LIMITER };
      const pre = await handle(new Request('https://auth.example/exchange', { method: 'OPTIONS', headers: { Origin: SITE } }), e);
      expect(pre.status).toBe(204);
      const bad = await handle(post('/exchange', { code: 'c', code_verifier: V }, { Origin: 'https://evil.example' }), e);
      expect(bad.status).toBe(403);
      expect(lim.keys).toHaveLength(0);
    });

    it('fails open when the limiter errors', async () => {
      const lim = limiter(() => Promise.reject(new Error('down')));
      const res = await handle(post('/exchange', { code: 'c', code_verifier: V }), { ...env, LIMITER: lim.LIMITER }, github().fn);
      expect(res.status).toBe(200);
      expect(lim.keys).toEqual(['unknown']);
    });
  });
});
