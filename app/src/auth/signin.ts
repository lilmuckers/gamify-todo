import { GitHubClient } from '@quest/shared';
import { patchUiPrefs, savedRepo, setRepo, TARGET, tokenStore } from '../config';
import { discoverRepos, RepoScanner, type FoundRepo } from './discover';
import { authorizeUrl, codeChallenge, newVerifier, parseCallback, randomString, SignInError, workerTokens, type Callback } from './oauth';
import { CHANNEL, markPopup, openPopup, popupMessage, takeMarker, type PopupMessage } from './popup';
import { browserLock, needsSignIn, RefreshingToken } from './session';

/**
 * Sign in with GitHub in the browser: the redirect out, the redirect back, and the session
 * the GitHub data source runs on. Off unless the build has all three settings (the Pages
 * build gets them from repo variables); without them the app keeps the pasted-token flow.
 */

const AUTH_URL = (import.meta.env.VITE_AUTH_URL ?? '').trim();
const CLIENT_ID = (import.meta.env.VITE_GITHUB_APP_CLIENT_ID ?? '').trim();
const APP_SLUG = (import.meta.env.VITE_GITHUB_APP_SLUG ?? '').trim();

export function signInAvailable(): boolean {
  return TARGET === 'pages' && !!AUTH_URL && !!CLIENT_ID && !!APP_SLUG;
}

/** Where the user adds (or removes) repos for the App. */
export const installUrl = () => `https://github.com/apps/${APP_SLUG}/installations/new`;
/** A new repo from the Quest Log template: data/settings.json and the validate workflow included. */
export const TEMPLATE_URL = 'https://github.com/new?template_owner=lilmuckers&template_name=quest-log-template';
/** Where the user can take back the App's access altogether. */
export const REVOKE_URL = 'https://github.com/settings/apps/authorizations';

/** The sign-in this tab started: checked when GitHub sends the user back. */
interface Pending {
  state: string;
  verifier: string;
  /** The screen to come back to. */
  hash: string;
  /** Started from the get-started guide, which picks up after it. */
  setup?: boolean;
}

const PENDING_KEY = 'quest.signin';

function takePending(): Pending | undefined {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Pending>) : undefined;
    return p && typeof p.state === 'string' && typeof p.verifier === 'string' ? { state: p.state, verifier: p.verifier, hash: p.hash ?? '', setup: !!p.setup } : undefined;
  } catch {
    return undefined;
  }
}

/** The page GitHub sends the user back to: this one, minus query and hash. */
const redirectUri = () => `${location.origin}${location.pathname}`;

/** Sends the user to GitHub to sign in (the page navigates away). */
export async function startSignIn(opts: { setup?: boolean; hash?: string } = {}): Promise<void> {
  const pending: Pending = { state: randomString(32), verifier: newVerifier(), hash: opts.hash ?? location.hash, setup: opts.setup };
  try {
    // sessionStorage: this tab only, gone when it closes. Never in the URL.
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    throw new Error('This browser blocks storage, so sign-in can’t work here. Use a token instead.');
  }
  location.assign(authorizeUrl({ clientId: CLIENT_ID, redirectUri: redirectUri(), state: pending.state, challenge: await codeChallenge(pending.verifier) }));
}

/**
 * Takes GitHub's callback parameters off the URL. Runs first thing, before analytics or
 * anything else can see or record the address, so the code never reaches history or a Referer.
 */
export function takeCallback(): Callback {
  const { callback, search } = parseCallback(location.search);
  if (callback.kind !== 'none') history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
  return callback;
}

let provider: RefreshingToken | undefined;

/** Tokens for the signed-in session, refreshed through the Worker. One per page. */
export function sessionTokens(): RefreshingToken {
  return (provider ??= new RefreshingToken({
    load: () => tokenStore.session(),
    save: (s) => tokenStore.save(s),
    refresh: (refresh) => workerTokens(AUTH_URL, '/refresh', { refresh_token: refresh }),
    lock: browserLock,
    online: () => navigator.onLine,
  }));
}

const sessionGet = () => {
  const client = new GitHubClient(sessionTokens(), { owner: '', repo: '', branch: '' });
  return <T>(url: string) => client.request<T>('GET', url);
};

/** The Quest Log repos the signed-in user can reach. */
export function findRepos(): Promise<{ repos: FoundRepo[]; installed: number }> {
  return discoverRepos(sessionGet());
}

/** A scanner for the next-steps checklist, which polls while the user sets up on GitHub. */
export function repoScanner(): RepoScanner {
  return new RepoScanner(sessionGet());
}

/** Signed in with a session that still works (or can refresh). */
function signedIn(): boolean {
  const s = tokenStore.session();
  return s?.kind === 'app' && !needsSignIn(s);
}

/** What came of GitHub sending the user back, for main.ts to report once the app is up. */
export interface SignInOutcome {
  result: 'ok' | 'cancelled' | 'error';
  message?: string;
  /** Not a sign-in but an install change: no `sign_in` event. */
  install?: boolean;
  /** The repo now in use, when there was exactly one (or the one already chosen). */
  connected?: string;
  /** Quest Log repos found, when the user has to choose (or make) one. */
  repos?: FoundRepo[];
  setup?: boolean;
}

/**
 * Finishes a sign-in GitHub sent back: checks `state`, swaps the code (with the PKCE
 * verifier) for a session through the Worker, then finds the user's repos. 'redirecting'
 * when it had to start a fresh sign-in instead.
 */
export async function finishSignIn(cb: Callback): Promise<SignInOutcome | 'redirecting' | undefined> {
  if (cb.kind === 'none' || !signInAvailable()) return undefined;
  if (cb.kind === 'error') {
    takePending();
    return cb.error === 'access_denied' ? { result: 'cancelled', message: 'Sign-in cancelled.' } : { result: 'error', message: `GitHub said no (${cb.error}).` };
  }
  if (cb.kind === 'install') {
    if (cb.setupAction === 'request') return { result: 'ok', install: true, message: 'Asked an owner of that account to approve Quest Log. Sign in again once they have.' };
    // Repos added or removed: look again, signing in first if needed.
    if (!signedIn()) return startSignIn().then(() => 'redirecting' as const);
    return { result: 'ok', install: true, ...(await pickRepo(false)) };
  }
  const pending = takePending();
  // Back from installing the App. That code came with no PKCE challenge or state of ours, so
  // don't redeem it. Already signed in (adding a repo from the next-steps list): just look
  // again. Otherwise a normal sign-in is one click-free round trip now the App is authorised.
  if (cb.setupAction && signedIn()) return { result: 'ok', install: true, setup: pending?.setup, ...(await pickRepo(!!pending?.setup)) };
  if (cb.setupAction) {
    await startSignIn({ setup: pending?.setup, hash: pending?.hash });
    return 'redirecting';
  }
  if (!pending || !cb.state || cb.state !== pending.state)
    return { result: 'error', message: 'That sign-in didn’t start in this tab, so it was ignored. Try again.' };
  if (pending.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}${pending.hash}`);
  return completeSignIn(cb.code, pending.verifier, !!pending.setup);
}

/** Swaps the code (with its PKCE verifier) for a session, then finds the user's repos. */
async function completeSignIn(code: string, verifier: string, setup: boolean): Promise<SignInOutcome> {
  try {
    tokenStore.save(await workerTokens(AUTH_URL, '/exchange', { code, code_verifier: verifier }));
  } catch (err) {
    return { result: 'error', message: err instanceof SignInError ? err.message : 'Sign-in failed. Try again.' };
  }
  return { result: 'ok', setup, ...(await pickRepo(setup)) };
}

/** A sign-in running in a popup over this page. */
export interface PopupSignIn {
  /** Settles once GitHub answers, the window is closed, or the user gives up. */
  done: Promise<SignInOutcome>;
  /** Brings the GitHub window to the front. */
  focus(): void;
  /** Gives up: closes the window and settles as cancelled. */
  cancel(): void;
}

/** Give up waiting on a popup after this long. */
const POPUP_TIMEOUT_MS = 10 * 60_000;

/**
 * Starts a sign-in in a popup (desktop). Call it straight from the click, or the browser
 * blocks the window; undefined when it did anyway (sign in with `startSignIn` instead).
 */
export function openSignInPopup(opts: { setup?: boolean } = {}): PopupSignIn | undefined {
  // Open first, on the click; fill in GitHub's address once the challenge is ready.
  const win = openPopup('quest-signin', '');
  if (!win) return undefined;
  const state = randomString(32);
  const verifier = newVerifier();
  markPopup({ kind: 'signin', state, at: Date.now() });
  void codeChallenge(verifier).then((challenge) => {
    win.location.href = authorizeUrl({ clientId: CLIENT_ID, redirectUri: redirectUri(), state, challenge });
  });

  const channel = new BroadcastChannel(CHANNEL);
  let settle!: (r: SignInOutcome) => void;
  let finished = false;
  const done = new Promise<SignInOutcome>((resolve) => (settle = resolve));
  const finish = (r: SignInOutcome) => {
    if (finished) return;
    finished = true;
    clearInterval(watch);
    clearTimeout(timeout);
    channel.close();
    settle(r);
  };
  let closedAt = 0;
  let answered = false;
  channel.onmessage = (e: MessageEvent<PopupMessage>) => {
    const m = e.data;
    if (m?.kind !== 'signin' || m.state !== state || finished) return;
    answered = true;
    channel.postMessage({ kind: 'ack', state } satisfies PopupMessage);
    if (m.error) return finish(m.error === 'access_denied' ? { result: 'cancelled', message: 'Sign-in cancelled.' } : { result: 'error', message: `GitHub said no (${m.error}).` });
    if (m.code) void completeSignIn(m.code, verifier, !!opts.setup).then(finish);
  };
  // Closed without an answer: give it a moment (the answer may still be on its way), then stop.
  const watch = setInterval(() => {
    if (!win.closed || answered) return;
    closedAt ||= Date.now();
    if (Date.now() - closedAt > 1500) finish({ result: 'cancelled', message: 'The GitHub window was closed before sign-in finished.' });
  }, 500);
  const timeout = setTimeout(() => finish({ result: 'cancelled', message: 'Sign-in timed out. Try again.' }), POPUP_TIMEOUT_MS);
  return {
    done,
    focus: () => win.focus(),
    cancel: () => {
      if (!win.closed) win.close();
      finish({ result: 'cancelled' });
    },
  };
}

/**
 * Opens GitHub's install page in a popup (desktop). Our callback page tells the waiting tab
 * when GitHub sends the popup back. False when the browser blocked the window.
 */
export function openInstallPopup(): boolean {
  const win = openPopup('quest-install', installUrl(), 1000, 760);
  if (win) markPopup({ kind: 'install', at: Date.now() });
  return !!win;
}

/** Runs `fn` when a popup finishes an install. Returns a stop function. */
export function onInstallPopup(fn: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent<PopupMessage>) => e.data?.kind === 'install' && fn();
  return () => channel.close();
}

/**
 * On our callback page inside a popup: hands GitHub's answer to the waiting tab and closes.
 * True when this page was such a popup (the app shouldn't start here).
 *
 * If no tab answers (it was closed), the popup offers to carry on as a normal page: the
 * verifier was in that tab's memory, so it starts a fresh sign-in here.
 */
export function answerPopup(cb: Callback): boolean {
  if (cb.kind === 'none' || !signInAvailable() || typeof BroadcastChannel === 'undefined') return false;
  const message = popupMessage(cb, takeMarker());
  if (!message) return false;
  const channel = new BroadcastChannel(CHANNEL);
  const say = (text: string, action?: { label: string; run: () => void }) => {
    const sub = document.querySelector('#boot .boot-sub');
    if (sub) sub.textContent = text;
    if (action) {
      const btn = document.createElement('button');
      btn.className = 'boot-action';
      btn.textContent = action.label;
      btn.onclick = action.run;
      document.getElementById('boot')?.append(btn);
    }
  };
  say(message.kind === 'install' ? 'DONE' : 'SIGNING IN');
  if (message.kind === 'install') {
    channel.postMessage(message);
    setTimeout(() => window.close(), 300);
    say('DONE · YOU CAN CLOSE THIS WINDOW');
    return true;
  }
  let acked = false;
  channel.onmessage = (e: MessageEvent<PopupMessage>) => {
    if (e.data?.kind !== 'ack' || e.data.state !== message.state) return;
    acked = true;
    channel.close();
    say('SIGNED IN · YOU CAN CLOSE THIS WINDOW');
    window.close();
  };
  channel.postMessage(message);
  setTimeout(() => {
    if (acked) return;
    channel.close();
    say('THE QUEST LOG TAB HAS GONE', { label: 'Sign in here instead', run: () => void startSignIn({ hash: '#/' }) });
  }, 3000);
  return true;
}

const DONE_KEY = 'quest.signin.done';

/** Keeps a popup sign-in's outcome across the reload onto the new repo, for main.ts to report. */
export function stashOutcome(r: SignInOutcome) {
  try {
    sessionStorage.setItem(DONE_KEY, JSON.stringify({ ...r, repos: undefined }));
  } catch {
    /* the reload just won't say "Signed in" */
  }
}

export function takeOutcome(): SignInOutcome | undefined {
  try {
    const raw = sessionStorage.getItem(DONE_KEY);
    sessionStorage.removeItem(DONE_KEY);
    return raw ? (JSON.parse(raw) as SignInOutcome) : undefined;
  } catch {
    return undefined;
  }
}

/** Connects to the user's Quest Log repo when there's no choice to make. */
async function pickRepo(setup: boolean): Promise<Pick<SignInOutcome, 'connected' | 'repos' | 'message'>> {
  let repos: FoundRepo[];
  try {
    ({ repos } = await findRepos());
  } catch {
    return { message: 'Signed in, but couldn’t list your repos. Try Change repo in Settings.' };
  }
  const current = savedRepo();
  let connected = repos.find((r) => r.fullName === current)?.fullName;
  if (!connected && repos.length === 1) {
    connected = repos[0].fullName;
    setRepo(connected);
  }
  if (connected && setup) patchUiPrefs({ setup: { step: 'hero' } });
  return { connected, repos };
}

/** Forgets the session and the repo on this device. Queued edits stay, for the next sign-in. */
export function signOut() {
  tokenStore.set(undefined);
  setRepo(undefined);
}
