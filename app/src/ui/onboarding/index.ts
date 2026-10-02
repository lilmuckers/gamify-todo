import type { App } from '../../app';
import { onboardedStore, patchUiPrefs, reloadWithMode, TARGET, uiPrefs, urlMode } from '../../config';
import { toast } from '../toast';
import { showBanner, showSplash, type Choice } from './splash';

/**
 * First-visit onboarding, and picking up where it left off: a tour or the
 * get-started wizard in progress resumes after a reload.
 */
export function startOnboarding(app: App, opts: { firstVisit: boolean }) {
  const mode = urlMode();
  const prefs = uiPrefs();
  if (mode.demo) {
    toast('Demo: edit anything you like. Nothing is saved.', 'info', 5000);
    return;
  }
  if (prefs.setup) return void import('./setup').then((m) => m.openSetup(app));
  // -1: a tour asked for before a reload (onto the example data) starts fresh.
  if (typeof prefs.tourStep === 'number') return void import('./tour').then((m) => m.startTour(app, { resume: prefs.tourStep! >= 0 }));
  if (mode.welcome) {
    // Once is enough: a reload shouldn't bring it back.
    const q = new URLSearchParams(location.search);
    q.delete('welcome');
    history.replaceState(history.state, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
    return showWelcome(app);
  }
  if (!opts.firstVisit || onboardedStore.get()) return;
  // A shared link: show it, with a small way in rather than the full splash.
  if (!/^#?\/?$/.test(location.hash)) showBanner((c) => choose(app, c));
  else showWelcome(app);
}

/** The welcome splash (also from Settings). */
export function showWelcome(app: App) {
  showSplash((c) => choose(app, c));
}

function choose(app: App, c: Choice | 'skip') {
  onboardedStore.set();
  if (c === 'skip') return;
  if (c === 'demo') return reloadWithMode('demo', '#/');
  if (c === 'tour') return beginTour(app);
  // The Docker editor is already connected: the tour shows how it works.
  if (TARGET === 'local') {
    toast("You're already set up: this editor saves to your repo. Here's the tour.", 'info', 5000);
    return beginTour(app);
  }
  void import('./setup').then((m) => m.openSetup(app, 0));
}

/** The tour runs on the example data: connected (or in the demo), it restarts the app onto it first. */
export function beginTour(app: App) {
  onboardedStore.set();
  if (TARGET === 'pages' && app.store.source.id !== 'static') {
    patchUiPrefs({ tourStep: -1 });
    return reloadWithMode('tour', '#/');
  }
  void import('./tour').then((m) => m.startTour(app));
}

/** The get-started wizard, from the start (Settings). */
export function beginSetup(app: App) {
  onboardedStore.set();
  void import('./setup').then((m) => m.openSetup(app, 0));
}
