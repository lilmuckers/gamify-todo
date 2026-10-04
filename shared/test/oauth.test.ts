import { describe, expect, it } from 'vitest';
import { exchangeCode, GITHUB_TOKEN_URL, OAuthError, refreshToken } from '../src/index';

function fakeFetch(reply: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit; body: Record<string, string> }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    return reply();
  }) as typeof fetch;
  return { fn, calls };
}

const creds = { clientId: 'Iv23id', clientSecret: 'shh' };
const ok = (json: unknown) => () => new Response(JSON.stringify(json), { status: 200 });
const full = {
  access_token: 'ghu_a',
  expires_in: 28800,
  refresh_token: 'ghr_r',
  refresh_token_expires_in: 15897600,
  token_type: 'bearer',
  scope: '',
};

describe('exchangeCode', () => {
  it('posts the code as JSON and asks for JSON back', async () => {
    const { fn, calls } = fakeFetch(ok(full));
    await exchangeCode({ ...creds, code: 'c0de' }, fn);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(GITHUB_TOKEN_URL);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.redirect).toBe('manual');
    expect(calls[0].init.headers).toMatchObject({ Accept: 'application/json', 'Content-Type': 'application/json' });
    expect(calls[0].body).toEqual({ client_id: 'Iv23id', client_secret: 'shh', code: 'c0de' });
  });

  it('passes a PKCE verifier through when given', async () => {
    const { fn, calls } = fakeFetch(ok(full));
    await exchangeCode({ ...creds, code: 'c0de', codeVerifier: 'v' }, fn);
    expect(calls[0].body.code_verifier).toBe('v');
  });

  it('normalises the token set', async () => {
    const { fn } = fakeFetch(ok(full));
    expect(await exchangeCode({ ...creds, code: 'c' }, fn)).toEqual({
      accessToken: 'ghu_a',
      refreshToken: 'ghr_r',
      expiresIn: 28800,
      refreshTokenExpiresIn: 15897600,
    });
  });

  it('copes with token expiry turned off (no refresh token)', async () => {
    const { fn } = fakeFetch(ok({ access_token: 'ghu_a', token_type: 'bearer' }));
    expect(await exchangeCode({ ...creds, code: 'c' }, fn)).toEqual({
      accessToken: 'ghu_a',
      refreshToken: null,
      expiresIn: null,
      refreshTokenExpiresIn: null,
    });
  });

  it('accepts expiry as a numeric string', async () => {
    const { fn } = fakeFetch(ok({ ...full, expires_in: '28800' }));
    expect((await exchangeCode({ ...creds, code: 'c' }, fn)).expiresIn).toBe(28800);
  });

  it('turns a 200 with an error field into an OAuthError with GitHub’s code', async () => {
    const { fn } = fakeFetch(ok({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }));
    const err = await exchangeCode({ ...creds, code: 'c' }, fn).catch((e) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect(err.code).toBe('bad_verification_code');
    expect(err.message).toBe('The code passed is incorrect or expired.');
  });

  it.each([
    ['a non-2xx reply', () => new Response('nope', { status: 503 })],
    ['a redirect', () => new Response(null, { status: 307, headers: { Location: 'https://evil.example/' } })],
    ['a non-JSON reply', () => new Response('<html>', { status: 200 })],
    ['no access token', ok({ token_type: 'bearer' })],
    ['a network failure', () => Promise.reject(new TypeError('fetch failed'))],
  ])('reports %s as upstream_error', async (_, reply) => {
    const { fn } = fakeFetch(reply);
    const err = await exchangeCode({ ...creds, code: 'c' }, fn).catch((e) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect(err.code).toBe('upstream_error');
  });

  it('never puts the secret or code in an error message', async () => {
    const { fn } = fakeFetch(() => new Response('nope', { status: 500 }));
    const err = await exchangeCode({ ...creds, code: 'c0de' }, fn).catch((e) => e);
    expect(err.message).not.toContain('shh');
    expect(err.message).not.toContain('c0de');
  });
});

describe('refreshToken', () => {
  it('uses the refresh_token grant', async () => {
    const { fn, calls } = fakeFetch(ok(full));
    const tokens = await refreshToken({ ...creds, refreshToken: 'ghr_old' }, fn);
    expect(calls[0].body).toEqual({
      client_id: 'Iv23id',
      client_secret: 'shh',
      grant_type: 'refresh_token',
      refresh_token: 'ghr_old',
    });
    expect(tokens.refreshToken).toBe('ghr_r');
  });

  it('reports an expired refresh token as bad_refresh_token', async () => {
    const { fn } = fakeFetch(ok({ error: 'bad_refresh_token' }));
    const err = await refreshToken({ ...creds, refreshToken: 'ghr_old' }, fn).catch((e) => e);
    expect(err.code).toBe('bad_refresh_token');
  });
});
