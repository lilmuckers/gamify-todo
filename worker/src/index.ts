/**
 * Quest Log token exchange: the one server-side step of Sign in with GitHub (#30). The browser
 * can't call GitHub's token endpoint itself (it needs the client secret and has no CORS), so it
 * posts here. Stores nothing and logs nothing: tokens only ever appear in the response.
 *
 *   POST /exchange { code, code_verifier? } → token set
 *   POST /refresh  { refresh_token }        → token set
 */
import { exchangeCode, OAuthError, refreshToken, type TokenSet } from '@quest/shared/oauth';

export interface Env {
  GITHUB_CLIENT_ID: string;
  /** Set with `wrangler secret put GITHUB_CLIENT_SECRET`; never in wrangler.toml. */
  GITHUB_CLIENT_SECRET: string;
  /** Comma-separated origins allowed to call this Worker. */
  ALLOWED_ORIGINS: string;
}

const MAX_BODY = 4096;
const MAX_FIELD = 512;
const ROUTES = new Set(['/exchange', '/refresh']);

/** GitHub's error code → our status. Anything unlisted is GitHub's fault: 502. */
const ERROR_STATUS: Record<string, number> = {
  bad_verification_code: 400,
  invalid_grant: 400,
  bad_refresh_token: 401,
  incorrect_client_credentials: 500,
  redirect_uri_mismatch: 500,
};

export async function handle(request: Request, env: Env, fetchImpl?: typeof fetch): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (!ROUTES.has(pathname)) return json({ error: 'not_found' }, 404);

  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins(env).has(origin)) return json({ error: 'forbidden_origin' }, 403);
  const cors = {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'POST, OPTIONS' });

  const body = await readBody(request);
  if (!body) return json({ error: 'invalid_request' }, 400, cors);
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return json({ error: 'server_misconfigured' }, 500, cors);
  const creds = { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET };

  let tokens: TokenSet;
  try {
    if (pathname === '/exchange') {
      const code = field(body, 'code');
      const verifier = body.code_verifier === undefined ? undefined : field(body, 'code_verifier');
      if (!code || verifier === null) return json({ error: 'invalid_request' }, 400, cors);
      tokens = await exchangeCode({ ...creds, code, codeVerifier: verifier }, fetchImpl);
    } else {
      const refresh = field(body, 'refresh_token');
      if (!refresh) return json({ error: 'invalid_request' }, 400, cors);
      tokens = await refreshToken({ ...creds, refreshToken: refresh }, fetchImpl);
    }
  } catch (e) {
    const code = e instanceof OAuthError ? e.code : 'upstream_error';
    const status = ERROR_STATUS[code] ?? 502;
    // Don't tell callers which of our credentials is wrong.
    return json({ error: status === 500 ? 'server_misconfigured' : code }, status, cors);
  }

  return json(
    {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
      refresh_token_expires_in: tokens.refreshTokenExpiresIn,
    },
    200,
    cors,
  );
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};

function allowedOrigins(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  );
}

/** A small JSON object, or null for anything else. */
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return null;
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > MAX_BODY) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A non-empty, bounded string field, or null. */
function field(body: Record<string, unknown>, key: string): string | null {
  const v = body[key];
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_FIELD ? v : null;
}

function json(data: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}
