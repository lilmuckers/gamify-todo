/**
 * GitHub App user-token exchange (Sign in with GitHub, #30). GitHub's token endpoint needs the
 * client secret and sends no CORS headers, so this runs server-side only: in the token-exchange
 * Worker (`worker/`) and, later, the Docker server. Pure fetch, no DOM or Node APIs.
 */

export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

/** A user-to-server token. The `null`s cover apps with token expiry turned off. */
export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds until `accessToken` expires. */
  expiresIn: number | null;
  /** Seconds until `refreshToken` expires. */
  refreshTokenExpiresIn: number | null;
}

/**
 * The exchange failed. `code` is GitHub's own error code (`bad_verification_code`,
 * `bad_refresh_token`, `incorrect_client_credentials`, …) or `upstream_error` when GitHub's
 * reply wasn't usable. Messages never include tokens or the secret.
 */
export class OAuthError extends Error {
  constructor(
    public code: string,
    message = code,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

/** Swaps the `code` from GitHub's sign-in redirect for a token. `codeVerifier` is for PKCE. */
export function exchangeCode(
  args: ClientCredentials & { code: string; codeVerifier?: string },
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<TokenSet> {
  const body: Record<string, string> = {
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
  };
  if (args.codeVerifier) body.code_verifier = args.codeVerifier;
  return requestToken(body, fetchImpl);
}

/** Trades a refresh token for a fresh token pair. GitHub rotates the refresh token too. */
export function refreshToken(
  args: ClientCredentials & { refreshToken: string },
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<TokenSet> {
  return requestToken(
    {
      client_id: args.clientId,
      client_secret: args.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
    },
    fetchImpl,
  );
}

async function requestToken(body: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenSet> {
  let res: Response;
  try {
    res = await fetchImpl(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OAuthError('upstream_error', 'GitHub could not be reached');
  }
  if (!res.ok) throw new OAuthError('upstream_error', `GitHub answered ${res.status}`);
  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new OAuthError('upstream_error', 'GitHub sent a non-JSON reply');
  }
  // GitHub reports failures as 200 with an `error` field.
  if (typeof json?.error === 'string') {
    const description = typeof json.error_description === 'string' ? json.error_description : json.error;
    throw new OAuthError(json.error, description);
  }
  if (typeof json?.access_token !== 'string' || !json.access_token) {
    throw new OAuthError('upstream_error', 'GitHub sent no access token');
  }
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : null,
    expiresIn: seconds(json.expires_in),
    refreshTokenExpiresIn: seconds(json.refresh_token_expires_in),
  };
}

/** GitHub sends numbers, but older docs show strings: accept both. */
function seconds(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}
