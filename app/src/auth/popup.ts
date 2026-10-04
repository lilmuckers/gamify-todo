import type { Callback } from './oauth';

/**
 * Signing in (and installing the App) in a small GitHub window over the app, on desktop,
 * instead of sending the whole page to GitHub and back. The popup lands back on our callback
 * page, which hands the result to the waiting tab over a BroadcastChannel and closes. That
 * channel works even if GitHub cuts the popup off from `window.opener`, and only ever carries
 * messages between pages of this site.
 *
 * The PKCE verifier never leaves the waiting tab's memory: the popup passes back the code,
 * and the waiting tab swaps it. So a stray code is as useless as in the redirect flow.
 */

export const CHANNEL = 'quest-signin';
/** Marks a popup in progress, so our callback page knows it's in one (and which). */
const MARKER_KEY = 'quest.signin.popup';
/** A popup older than this is forgotten: its callback loads the app as normal. */
const MARKER_TTL_MS = 15 * 60_000;

export type PopupKind = 'signin' | 'install';

export interface PopupMarker {
  kind: PopupKind;
  /** The sign-in's `state` (sign-ins only). */
  state?: string;
  at: number;
}

/** What the popup tells the waiting tab, and the tab's reply. */
export type PopupMessage =
  | { kind: 'signin'; state: string; code?: string; error?: string }
  | { kind: 'install'; setupAction: string }
  | { kind: 'ack'; state?: string };

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function markPopup(marker: PopupMarker, store: Store = localStorage) {
  try {
    store.setItem(MARKER_KEY, JSON.stringify(marker));
  } catch {
    /* no storage: the callback loads the app and finishes as a redirect would */
  }
}

/** Reads and forgets the marker (if it's still fresh). */
export function takeMarker(store: Store = localStorage, now = Date.now()): PopupMarker | undefined {
  try {
    const raw = store.getItem(MARKER_KEY);
    if (!raw) return undefined;
    store.removeItem(MARKER_KEY);
    const m = JSON.parse(raw) as Partial<PopupMarker>;
    if ((m.kind !== 'signin' && m.kind !== 'install') || typeof m.at !== 'number' || now - m.at > MARKER_TTL_MS) return undefined;
    return { kind: m.kind, state: typeof m.state === 'string' ? m.state : undefined, at: m.at };
  } catch {
    return undefined;
  }
}

/**
 * The message for a callback that landed in one of our popups, or undefined when this page
 * isn't one (no marker, or a callback that doesn't match it): then it loads as normal.
 */
export function popupMessage(cb: Callback, marker: PopupMarker | undefined): PopupMessage | undefined {
  if (!marker || cb.kind === 'none') return undefined;
  if (marker.kind === 'signin' && marker.state) {
    if (cb.kind === 'code' && !cb.setupAction && cb.state === marker.state) return { kind: 'signin', state: marker.state, code: cb.code };
    if (cb.kind === 'error') return { kind: 'signin', state: marker.state, error: cb.error };
    return undefined;
  }
  if (marker.kind === 'install') {
    if (cb.kind === 'install') return { kind: 'install', setupAction: cb.setupAction };
    if (cb.kind === 'code' && cb.setupAction) return { kind: 'install', setupAction: cb.setupAction };
  }
  return undefined;
}

/**
 * Popups on desktop only: on phones and in the installed app a "popup" is a new tab or a
 * browser sheet, and the redirect already feels like switching apps.
 */
export function popupsWork(): boolean {
  if (typeof BroadcastChannel === 'undefined') return false;
  if (document.body.classList.contains('is-mobile')) return false;
  return !window.matchMedia('(display-mode: standalone)').matches;
}

/** Opens (or reuses) a centred window. Undefined when the browser blocks it. */
export function openPopup(name: string, url: string, width = 560, height = 720): Window | undefined {
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 3));
  return window.open(url, name, `popup=yes,width=${width},height=${height},left=${left},top=${top}`) ?? undefined;
}
