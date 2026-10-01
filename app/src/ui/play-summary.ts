import { describeOp, type Op } from '@quest/shared';
import { track } from '../analytics';
import type { App, PlayEnd } from '../app';
import { activePad } from '../game/play/input';
import { h } from './dom';
import { openModal } from './modal';

const TITLE: Record<PlayEnd, string> = {
  cleared: 'Level clear! Save your run?',
  idle: 'Paused: 2 minutes idle',
  resumed: 'Unsaved play session',
  stopped: 'Game over: save your run?',
  left: 'Game over: save your run?',
};

const INTRO: Record<PlayEnd, string> = {
  cleared: 'You reached the castle. Here is everything you changed on the way.',
  idle: 'Play mode stopped after 2 minutes without input. Here is what you changed.',
  resumed: 'The window closed during a play session last time. These changes were never committed.',
  stopped: 'Here is everything you changed while playing.',
  left: 'You left the level mid-game. Here is everything you changed while playing.',
};

/**
 * End-of-play summary: every held edit, all ticked. Commit sends the ticked
 * ones; unticked ones are taken back as if they never happened. It can't be
 * dismissed: held edits block syncing until the player decides.
 */
export function playSummary(app: App, ops: Op[], why: PlayEnd) {
  const state = app.store.state;
  const boxes = ops.map((op) => h('input', { type: 'checkbox', checked: true, value: op.opId }));
  const all = h('input', { type: 'checkbox', checked: true });
  const list = h(
    'ul',
    { class: 'play-summary' },
    ops.map((op, i) => h('li', null, h('label', null, boxes[i], h('span', null, describeOp(op, state))))),
  );
  const body = h(
    'div',
    null,
    h('p', null, INTRO[why]),
    h('label', { class: 'play-summary-all' }, all, h('span', null, `All ${ops.length} change${ops.length === 1 ? '' : 's'}`)),
    list,
    h('p', { class: 'muted' }, 'Untick anything you want to skip: skipped changes are undone.'),
  );

  const picked = () => boxes.filter((b) => b.checked).map((b) => b.value);
  let decided = false;
  const finish = (keep: string[]) => {
    if (decided) return;
    decided = true;
    track('play_commit', { kept: keep.length, skipped: ops.length - keep.length, why });
    app.store.release(keep);
  };
  const close = openModal(
    TITLE[why],
    body,
    [
      { label: 'Skip all', run: () => finish([]) },
      { label: 'Commit', kind: 'primary', run: () => finish(picked()) },
    ],
    { dismissable: false },
  );

  // Keep the commit button's label and the "all" box in step with the ticks.
  const commit = body.closest('form')?.querySelector<HTMLButtonElement>('.btn.primary');
  const update = () => {
    const n = picked().length;
    all.checked = n === ops.length;
    all.indeterminate = n > 0 && n < ops.length;
    if (commit) commit.textContent = n ? `Commit ${n} of ${ops.length}` : 'Skip all';
  };
  for (const b of boxes) b.addEventListener('change', update);
  all.addEventListener('change', () => {
    for (const b of boxes) b.checked = all.checked;
    update();
  });
  update();
  commit?.focus();

  // Still holding the controller: A commits what's ticked.
  let wasDown = !!activePad()?.buttons[0]?.pressed;
  const poll = () => {
    if (decided || !commit?.isConnected) return;
    const down = !!activePad()?.buttons[0]?.pressed;
    if (down && !wasDown) {
      finish(picked());
      close();
      return;
    }
    wasDown = down;
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}
