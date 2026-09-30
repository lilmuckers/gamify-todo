import '@fontsource/press-start-2p/latin-400.css';
import './styles.css';
import { App } from './app';
import { repoRef, TARGET, tokenStore, uiPrefs } from './config';
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
  return token && repo ? new GitHubSource(token, repo) : new StaticSource();
}

function useMobile(): boolean {
  const pref = new URLSearchParams(location.search).get('mobile') ?? uiPrefs().mobile ?? 'auto';
  if (pref === 'on' || pref === '1') return true;
  if (pref === 'off' || pref === '0') return false;
  return window.matchMedia('(max-width: 767px), (pointer: coarse) and (max-height: 500px)').matches;
}

async function main() {
  const root = document.getElementById('app')!;
  const store = new Store(await createSource(), browserKV());
  store.attachBrowserEvents();
  const app = new App(store);
  const mobile = useMobile();
  document.body.classList.toggle('is-mobile', mobile);
  if (mobile) (await import('./mobile')).mountMobile(app, root);
  else {
    await document.fonts.load('8px "Press Start 2P"').catch(() => undefined);
    (await import('./desktop')).mountDesktop(app, root);
  }
  await store.start();
}

void main();
