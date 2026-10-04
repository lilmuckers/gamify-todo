import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/caveat/latin-400.css';
import '@fontsource/caveat/latin-700.css';
import './styles.css';
import { GitHubError, HERO_IDS, type HeroId } from '@quest/shared';
import { bucket, initAnalytics, setUserProps, track } from './analytics';
import { App } from './app';
import { answerPopup, finishSignIn, sessionTokens, signInAvailable, takeCallback, takeOutcome, type SignInOutcome } from './auth/signin';
import { chosenBranch, isFirstVisit, rememberBranch, repoRef, TARGET, tokenStore, uiPrefs, urlMode } from './config';
import { DemoSource, memoryKV } from './data/demo';
import { GitHubSource } from './data/github';
import { browserKV } from './data/kv';
import { LocalApiSource } from './data/local';
import type { DataSource } from './data/source';
import { StaticSource } from './data/static';
import { Store } from './data/store';
import { startFreshness } from './pwa';
import { prefillCapture } from './ui/inbox';
import { beginSignIn } from './ui/sign-in';
import { toast } from './ui/toast';

async function createSource(): Promise<DataSource> {
  const mode = urlMode();
  // ?demo: example data, editable, saved nowhere. ?tour: example data, read-only.
  if (mode.demo) return new DemoSource();
  if (mode.tour && TARGET === 'pages') return new StaticSource();
  if (TARGET === 'local') return new LocalApiSource().init();
  const session = tokenStore.session();
  const repo = repoRef();
  if (!session || !repo) return new StaticSource();
  // A signed-in session refreshes its 8-hour tokens as it goes; a pasted token is used as is.
  const token = session.kind === 'app' && signInAvailable() ? sessionTokens() : session.token;
  const source = await new GitHubSource(token, repo).init(chosenBranch());
  rememberBranch(source.client.repo.branch);
  return source;
}

function useMobile(): boolean {
  const pref = new URLSearchParams(location.search).get('mobile') ?? uiPrefs().mobile ?? 'auto';
  if (pref === 'on' || pref === '1') return true;
  if (pref === 'off' || pref === '0') return false;
  return window.matchMedia('(max-width: 767px), (pointer: coarse) and (max-height: 500px)').matches;
}

/** Fades out the boot splash from index.html. */
function dismissBoot() {
  const boot = document.getElementById('boot');
  if (!boot || boot.classList.contains('boot-done')) return;
  boot.classList.add('boot-done');
  setTimeout(() => boot.remove(), 250);
}

async function main() {
  // GitHub's sign-in callback comes off the URL before anything else can see it.
  const callback = takeCallback();
  // A sign-in (or install) popup back from GitHub: hand the answer to the waiting tab, and stop.
  if (answerPopup(callback)) return;
  // Before anything writes its own keys.
  const firstVisit = isFirstVisit();
  // Offline cache for the app, refreshed when it's a few hours old.
  void startFreshness().catch(() => undefined);
  const root = document.getElementById('app')!;
  const mobile = useMobile();
  // Something shared to the installed app lands in the inbox, ready to save.
  const shared = new URLSearchParams(location.search);
  const sharedTitle = shared.get('share-title') || shared.get('share-text');
  const sharedUrl = shared.get('share-url') || (shared.get('share-text')?.match(/https?:\/\/\S+/)?.[0] ?? '');
  if (sharedTitle || sharedUrl) {
    prefillCapture((sharedTitle ?? sharedUrl).replace(sharedUrl, '').trim() || sharedUrl, sharedUrl || undefined);
    for (const k of ['share-title', 'share-text', 'share-url']) shared.delete(k);
    const query = shared.toString();
    history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}#/~inbox`);
  }
  // Phones open on today's plan (once they've been here before).
  else if (mobile && /^#?\/?$/.test(location.hash) && !isFirstVisit()) history.replaceState(history.state, '', '#/~today');
  // Back from GitHub in this tab, or restarted onto the repo a popup sign-in found.
  const signIn = (await finishSignIn(callback).catch((err: Error): SignInOutcome => ({ result: 'error', message: err.message }))) ?? takeOutcome();
  // Off to GitHub for a fresh sign-in: nothing to start here.
  if (signIn === 'redirecting') return;
  const source = await createSource();
  // The demo keeps nothing: not even an offline cache.
  const store = new Store(source, source.id === 'demo' ? memoryKV() : browserKV());
  store.attachBrowserEvents();
  const app = new App(store);
  // A tour in progress: its guide walks the levels from the very first frame.
  const tour = uiPrefs();
  if (typeof tour.tourStep === 'number' && tour.tourStep >= 0 && HERO_IDS.includes(tour.tourGuide as HeroId)) app.heroOverride = tour.tourGuide as HeroId;
  if (sharedTitle || sharedUrl) app.focusCapture = true;
  const userProps = () => ({
    app_mode: source.id === 'demo' ? 'demo' : urlMode().tour ? 'tour' : TARGET === 'local' ? 'local' : store.caps.canEdit ? 'github' : 'readonly',
    layout: mobile ? 'mobile' : 'desktop',
    display: window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
    hero: app.heroId,
  });
  initAnalytics(app.route, userProps());
  // Hero and edit mode settle once data loads.
  let lastProps = JSON.stringify(userProps());
  app.subscribe(() => {
    const props = userProps();
    const sig = JSON.stringify(props);
    if (sig !== lastProps) setUserProps(props);
    lastProps = sig;
  });
  store.onSyncResult = (r) => {
    track('sync', { result: r.result, ops_bucket: bucket(r.ops) });
    if (r.conflicts) track('sync_conflict', { count: r.conflicts });
    if (r.error instanceof GitHubError && (r.error.status === 429 || /rate limit/i.test(r.error.message))) track('rate_limited');
  };
  let warned = false;
  store.onSignInExpired = () => {
    if (warned) return;
    warned = true;
    const n = store.outbox.length;
    const kept = n ? ` Your ${n} unsynced edit${n === 1 ? ' is' : 's are'} kept until you do.` : '';
    toast(`Your GitHub sign-in has expired. Sign in again to keep saving.${kept}`, 'warn', 20_000, { label: 'SIGN IN', run: () => beginSignIn(app) });
  };
  window.addEventListener('appinstalled', () => track('pwa_install'));
  document.body.classList.toggle('is-mobile', mobile);
  if (mobile) (await import('./mobile')).mountMobile(app, root);
  else {
    await document.fonts.load('8px "Press Start 2P"').catch(() => undefined);
    (await import('./desktop')).mountDesktop(app, root);
  }
  // The welcome screen doesn't need the data: show it while that loads.
  void import('./ui/onboarding').then((m) => m.startOnboarding(app, { firstVisit }));
  // The splash covers the empty shell until there's something to show: the
  // offline copy if there is one, else the first load (or its failure).
  const unsubBoot = store.subscribe(() => {
    if (store.state) dismissBoot();
  });
  await store.start().finally(() => {
    unsubBoot();
    dismissBoot();
  });
  if (signIn) reportSignIn(app, signIn);
  // The tab closed mid-game last time: ask about that session's edits now.
  if (store.held.size) app.reviewHeld('resumed');
}

/** Tells the user how the sign-in went, and asks them to choose a repo when there's a choice. */
function reportSignIn(app: App, r: SignInOutcome) {
  if (!r.install) track('sign_in', { result: r.result });
  if (r.result !== 'ok') return void toast(r.message ?? 'Sign-in failed.', r.result === 'cancelled' ? 'info' : 'alert', 6000);
  if (r.message) toast(r.message, 'warn', 8000);
  else if (r.connected) toast(`Signed in. Playing ${r.connected}.`, 'win');
  // The get-started guide shows the choice on its own page.
  if (r.setup || r.connected || !r.repos) return;
  void import('./ui/repo-picker').then((m) => m.openRepoPicker(app, r.repos));
}

main().catch((err) => {
  dismissBoot();
  throw err;
});
