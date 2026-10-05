import type { MergeMethod, PullDetail, ReviewEvent } from '@quest/shared';
import { track } from '../analytics';
import type { App } from '../app';
import { go } from '../router';
import { h } from './dom';
import { openModal } from './modal';
import { play as sfx } from '../audio';
import { toast } from './toast';

export function reviewDialog(app: App, pr: PullDetail) {
  const provider = app.store.source.pulls!;
  const body = h('textarea', { rows: 4, placeholder: 'Comment (optional for approve)', maxLength: 5000 });
  const send = (event: ReviewEvent) => async () => {
    if (event !== 'APPROVE' && !body.value.trim()) {
      body.focus();
      toast('Write a comment first', 'warn');
      return false;
    }
    try {
      await provider.review(pr.number, event, body.value.trim());
      track('pr_review', { event: event.toLowerCase() });
      toast(event === 'APPROVE' ? 'Approved ✓' : 'Review sent', 'win');
    } catch (err) {
      toast((err as Error).message, 'alert', 6000);
      return false;
    }
  };
  openModal(`Review #${pr.number}`, h('div', null, body), [
    { label: 'Cancel' },
    { label: 'Request changes', kind: 'danger', run: send('REQUEST_CHANGES') },
    { label: 'Comment', run: send('COMMENT') },
    { label: 'Approve', kind: 'primary', run: send('APPROVE') },
  ]);
}

export function mergeDialog(app: App, pr: PullDetail) {
  const provider = app.store.source.pulls!;
  const method = h(
    'select',
    null,
    (['squash', 'merge', 'rebase'] as MergeMethod[]).map((m) => h('option', { value: m }, m)),
  );
  const body = h(
    'div',
    null,
    h('p', null, `Merge "${pr.title}" into ${pr.baseRef}? This changes the shared project data for everyone and cannot be undone from here.`),
    h('label', { class: 'field' }, h('span', null, 'Merge method'), method),
  );
  openModal(`Merge #${pr.number}`, body, [
    { label: 'Cancel' },
    {
      label: 'Merge',
      kind: 'primary',
      run: async () => {
        try {
          await provider.merge(pr.number, method.value as MergeMethod, pr.headSha);
          track('pr_merge', { method: method.value });
        } catch (err) {
          toast((err as Error).message, 'alert', 6000);
          return false;
        }
        sfx('win');
        toast(`Merged #${pr.number}! Warp complete.`, 'win');
        app.forgetPull(pr.number);
        await app.store.refresh();
        go({ view: 'projects' });
      },
    },
  ]);
}
