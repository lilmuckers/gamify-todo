import { SignInExpiredError, type TokenProvider } from '@quest/shared';
import type { StoredToken } from '../config';
import { SignInError } from './oauth';

/** Refresh this long before the access token runs out, so a slow sync doesn't straddle it. */
export const REFRESH_EARLY_MS = 5 * 60_000;

export interface SessionDeps {
  /** Reads the saved session fresh each time: another tab may have refreshed it. */
  load(): StoredToken | undefined;
  save(session: StoredToken): void;
  /** Trades a refresh token for a new session (the Worker's `/refresh`). Throws SignInError. */
  refresh(refreshToken: string): Promise<StoredToken>;
  /** Runs `fn` holding a lock every tab shares (`navigator.locks`), or just runs it. */
  lock?<T>(fn: () => Promise<T>): Promise<T>;
  now?(): number;
  online?(): boolean;
  /** The session can't be refreshed any more: the user has to sign in again. */
  onExpired?(): void;
}

/**
 * Access tokens for a Sign in with GitHub session, refreshed before they run out.
 *
 * GitHub rotates the refresh token on every use, and the old one stops working. So one
 * refresh at a time: requests in this tab share the one in flight, and tabs take turns under
 * a lock, re-reading storage first in case the tab before them already refreshed. The new
 * session is saved before its token is used, so a crash can't strand the only valid refresh
 * token in memory.
 */
export class RefreshingToken implements TokenProvider {
  private inflight?: Promise<string>;

  constructor(private deps: SessionDeps) {}

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  private online() {
    return this.deps.online?.() ?? true;
  }

  private expiring(s: StoredToken) {
    return s.kind === 'app' && s.expiresAt !== undefined && s.expiresAt - this.now() <= REFRESH_EARLY_MS;
  }

  async get(): Promise<string | undefined> {
    const s = this.deps.load();
    if (!s) return undefined;
    // Offline: no refresh attempts. The request fails anyway, and sync retries once back online.
    if (!this.expiring(s) || !this.online()) return s.token;
    return this.refreshFrom(s.token);
  }

  async renew(rejected: string): Promise<string | undefined> {
    if (!this.online()) return undefined;
    return this.refreshFrom(rejected);
  }

  private refreshFrom(stale: string): Promise<string> {
    this.inflight ??= this.locked(async () => {
      const s = this.deps.load();
      if (!s) throw new SignInExpiredError();
      // Someone else refreshed while we waited for the lock.
      if (s.token !== stale && !this.expiring(s)) return s.token;
      // A pasted token can't be refreshed: hand it back and let the request fail as it would.
      if (s.kind !== 'app') return s.token;
      if (!s.refresh || (s.refreshExpiresAt !== undefined && s.refreshExpiresAt <= this.now())) throw this.expired(s);
      let next: StoredToken;
      try {
        next = await this.deps.refresh(s.refresh);
      } catch (err) {
        if (err instanceof SignInError && (err.code === 'bad_refresh_token' || err.code === 'invalid_request')) throw this.expired(s);
        // Network, rate limit, GitHub down: keep the session and try again later.
        throw err;
      }
      this.deps.save(next);
      return next.token;
    }).finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    return this.deps.lock ? this.deps.lock(fn) : fn();
  }

  /**
   * Marks the session dead (no refresh token, access token expired), so later requests fail
   * at once instead of asking the Worker again. The session itself stays, so the app knows to
   * offer "Sign in again" rather than "Sign in".
   */
  private expired(s: StoredToken): SignInExpiredError {
    if (s.refresh || s.expiresAt === undefined || s.expiresAt > this.now())
      this.deps.save({ ...s, refresh: undefined, refreshExpiresAt: undefined, expiresAt: Math.min(s.expiresAt ?? Infinity, this.now()) });
    this.deps.onExpired?.();
    return new SignInExpiredError();
  }
}

/** True for a sign-in session that can't refresh any more. */
export function needsSignIn(s: StoredToken | undefined, now = Date.now()): boolean {
  if (s?.kind !== 'app') return false;
  const tokenDead = s.expiresAt !== undefined && s.expiresAt <= now;
  const refreshDead = !s.refresh || (s.refreshExpiresAt !== undefined && s.refreshExpiresAt <= now);
  return tokenDead && refreshDead;
}

/** `navigator.locks` where there is one (all current browsers), else no lock. */
export function browserLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? (locks.request('quest-token-refresh', fn) as Promise<T>) : fn();
}
