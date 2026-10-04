import type { StoredToken } from '../config';

/**
 * Sign in with GitHub, the browser half (#92): PKCE and `state`, reading GitHub's redirect
 * back to us, and calling the token-exchange Worker (`worker/`). Pure functions with their
 * inputs passed in, so they test without a browser.
 */

export const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

/** RFC 7636 §4.1, and what the Worker checks: 43–128 of these characters. */
export const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

type Random = (bytes: Uint8Array) => Uint8Array;
const cryptoRandom: Random = (bytes) => crypto.getRandomValues(bytes);

/**
 * A random string of unreserved characters. There are 66 of them and 198 is the largest
 * multiple of 66 below 256, so higher bytes are dropped: every character is equally likely.
 */
export function randomString(length: number, random: Random = cryptoRandom): string {
  let out = '';
  while (out.length < length) {
    for (const b of random(new Uint8Array(length))) if (b < 198 && out.length < length) out += UNRESERVED[b % 66];
  }
  return out;
}

/** A fresh PKCE code verifier (64 characters: comfortably inside 43–128). */
export const newVerifier = (random?: Random) => randomString(64, random);

/** The S256 code challenge: base64url(SHA-256(verifier)), no padding. */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  let bin = '';
  for (const b of digest) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function authorizeUrl(args: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
    code_challenge: args.challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${q}`;
}

/** What GitHub's redirect back to us carried. */
export type Callback =
  | { kind: 'none' }
  /** A sign-in (or, with `setupAction`, an install that also asked for authorisation). */
  | { kind: 'code'; code: string; state?: string; setupAction?: string }
  /** An install or repo-selection change with no code. `request`: an org owner must approve. */
  | { kind: 'install'; setupAction: string }
  /** `access_denied` when the user pressed Cancel. */
  | { kind: 'error'; error: string };

/** Every parameter GitHub may add to the callback URL. None of them should outlive the page load. */
const CALLBACK_KEYS = ['code', 'state', 'error', 'error_description', 'error_uri', 'installation_id', 'setup_action'];

/** Reads the callback from a query string, and returns the query string without it. */
export function parseCallback(search: string): { callback: Callback; search: string } {
  const q = new URLSearchParams(search);
  const code = q.get('code') ?? undefined;
  const state = q.get('state') ?? undefined;
  const error = q.get('error') ?? undefined;
  const setupAction = q.get('setup_action') ?? undefined;
  let callback: Callback = { kind: 'none' };
  if (error) callback = { kind: 'error', error: error.slice(0, 40) };
  else if (code) callback = { kind: 'code', code, state, setupAction };
  else if (setupAction) callback = { kind: 'install', setupAction };
  if (callback.kind === 'none') return { callback, search };
  for (const k of CALLBACK_KEYS) q.delete(k);
  // `?demo&tour` style flags keep their bare form.
  const rest = q.toString().replace(/=(&|$)/g, '$1');
  return { callback, search: rest ? `?${rest}` : '' };
}

/**
 * The Worker (or GitHub through it) said no. `code` is the Worker's documented error
 * (`bad_verification_code`, `bad_refresh_token`, `rate_limited`, …) or `network`.
 */
export class SignInError extends Error {
  constructor(
    public code: string,
    public status = 0,
  ) {
    super(SIGN_IN_ERRORS[code] ?? `Sign-in failed (${code})`);
    this.name = 'SignInError';
  }
}

const SIGN_IN_ERRORS: Record<string, string> = {
  bad_verification_code: 'That sign-in link was used up or too old. Try again.',
  bad_refresh_token: 'Your GitHub sign-in has expired. Sign in again.',
  rate_limited: 'Too many sign-in attempts. Wait a minute and try again.',
  network: "Couldn't reach the sign-in service. Check your connection and try again.",
  server_misconfigured: 'The sign-in service isn’t set up properly. Use a token for now.',
  forbidden_origin: 'The sign-in service doesn’t accept this site. Use a token for now.',
};

/** Posts to the Worker and turns its token set into a stored session. Never logs the reply. */
export async function workerTokens(
  authUrl: string,
  route: '/exchange' | '/refresh',
  body: Record<string, string>,
  opts: { fetch?: typeof fetch; now?: number } = {},
): Promise<StoredToken> {
  const fetchImpl = opts.fetch ?? ((...a) => fetch(...a));
  let res: Response;
  try {
    res = await fetchImpl(`${authUrl.replace(/\/+$/, '')}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new SignInError('network');
  }
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* handled below */
  }
  if (!res.ok) throw new SignInError(typeof json.error === 'string' ? json.error.slice(0, 40) : 'upstream_error', res.status);
  if (typeof json.access_token !== 'string' || !json.access_token) throw new SignInError('upstream_error', res.status);
  const now = opts.now ?? Date.now();
  const at = (seconds: unknown) => (typeof seconds === 'number' && seconds > 0 ? now + seconds * 1000 : undefined);
  return {
    kind: 'app',
    token: json.access_token,
    refresh: typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : undefined,
    expiresAt: at(json.expires_in),
    refreshExpiresAt: at(json.refresh_token_expires_in),
  };
}
