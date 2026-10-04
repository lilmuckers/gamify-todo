import { track } from '../analytics';
import type { App } from '../app';
import { popupsWork } from '../auth/popup';
import { openSignInPopup, startSignIn, stashOutcome, type SignInOutcome } from '../auth/signin';
import { reloadWithMode } from '../config';
import { h } from './dom';
import { openModal } from './modal';
import { toast } from './toast';

/**
 * Sign in with GitHub from a button. On desktop GitHub opens in a small window over the app,
 * which stays put underneath; on phones (or if the window is blocked) the page goes to GitHub
 * and back as before. Call it straight from the click.
 */
export function beginSignIn(app: App, opts: { setup?: boolean; onSignedIn?: () => void } = {}) {
  const redirect = () => void startSignIn({ setup: opts.setup }).catch((err: Error) => toast(err.message, 'alert', 6000));
  const popup = popupsWork() ? openSignInPopup({ setup: opts.setup }) : undefined;
  if (!popup) return redirect();
  const close = openModal(
    'Signing in…',
    h(
      'div',
      { class: 'signin-wait' },
      h('p', null, 'Finish signing in in the GitHub window. This page waits for you.'),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => popup.focus() }, 'Show the GitHub window'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => (popup.cancel(), redirect()) }, 'Use this tab instead'),
      ),
    ),
    [{ label: 'Cancel', run: () => popup.cancel() }],
    // Closed some other way (Esc, the backdrop): stop waiting.
    { onClose: () => popup.cancel() },
  );
  void popup.done.then((r) => {
    close();
    afterSignIn(app, r, opts);
  });
}

/**
 * What happens once a popup sign-in settles. Connected to a repo: restart on it (same
 * screen), and say so after the reload. Otherwise the choice (or the next steps) shows here.
 */
function afterSignIn(app: App, r: SignInOutcome, opts: { onSignedIn?: () => void }) {
  if (r.result === 'cancelled' && !r.message) return;
  if (r.result !== 'ok') {
    track('sign_in', { result: r.result });
    return void toast(r.message ?? 'Sign-in failed.', r.result === 'cancelled' ? 'info' : 'alert', 6000);
  }
  if (r.connected) {
    // main.ts reports it (and counts it) once the app is back up on the repo.
    stashOutcome(r);
    return reloadWithMode(undefined, location.hash || '#/');
  }
  track('sign_in', { result: 'ok' });
  if (r.message) toast(r.message, 'warn', 8000);
  if (opts.onSignedIn) return opts.onSignedIn();
  void import('./repo-picker').then((m) => m.openRepoPicker(app, r.repos));
}
