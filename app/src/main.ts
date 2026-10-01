import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/caveat/latin-400.css';
import '@fontsource/caveat/latin-700.css';
import './styles.css';
import { GitHubError } from '@quest/shared';
import { bucket, initAnalytics, setUserProps, track } from './analytics';
import { App } from './app';
import { chosenBranch, rememberBranch, repoRef, TARGET, tokenStore, uiPrefs } from './config';
import { GitHubSource } from './data/github';
import { browserKV } from './data/kv';
import { LocalApiSource } from './data/local';
import type { DataSource } from './data/source';
import { StaticSource } from './data/static';
import { Store } from './data/store';

async function createSource(): Promise<DataSource> {
  if (TARGET === 'local') return new LocalApiSource().init();
  const token = tokenStore.get();
  const repo = repoRef();
  if (!token || !repo) return new StaticSource();
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

async function main() {
  const root = document.getElementById('app')!;
  const mobile = useMobile();
  // Phones open on today's plan.
  if (mobile && /^#?\/?$/.test(location.hash)) history.replaceState(history.state, '', '#/~today');
  const store = new Store(await createSource(), browserKV());
  store.attachBrowserEvents();
  const app = new App(store);
  const userProps = () => ({
    app_mode: TARGET === 'local' ? 'local' : store.caps.canEdit ? 'github' : 'readonly',
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
  window.addEventListener('appinstalled', () => track('pwa_install'));
  document.body.classList.toggle('is-mobile', mobile);
  if (mobile) (await import('./mobile')).mountMobile(app, root);
  else {
    await document.fonts.load('8px "Press Start 2P"').catch(() => undefined);
    (await import('./desktop')).mountDesktop(app, root);
  }
  await store.start();
}

void main();
