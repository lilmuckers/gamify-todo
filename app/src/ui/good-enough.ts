import { budgetPrefs, dropOptionalOps, formatMoney, keepOptionalOps, optionalLeft, optionalSavings, type Level, type LevelAt } from '@quest/shared';
import { bucket, track } from '../analytics';
import type { App } from '../app';
import { goodEnoughStore } from '../config';
import { emoteCanvas, portraitCanvas, thumbCanvas } from '../sprites/portraits';
import { canvasUrl } from '../sprites/render';
import { h, truncate } from './dom';
import { pickGoodEnoughLine } from './good-enough-lines';
import { openModal } from './modal';

const levelKey = (at: LevelAt) => `${at.projectId}/${at.worldId}/${at.levelId}`;

/** Whether this level's moment is still to come in this browser. */
export const goodEnoughDue = (at: LevelAt) => !goodEnoughStore.get().seen.includes(levelKey(at));

const img = (c: HTMLCanvasElement, cls: string) => h('img', { class: `pixel ${cls}`, src: canvasUrl(c), alt: '' });

/**
 * "You did enough" (#26): a level just cleared with optional items left. The
 * hero gives a grudging thumbs up and a line, then offers to drop the rest
 * (banking any unspent budget) or move it to the inbox. Both are scope cuts,
 * so neither costs polish. Shown once per level per browser.
 */
export function goodEnoughDialog(app: App, at: LevelAt, level: Level) {
  const left = optionalLeft(level);
  if (!left.length) return;
  const line = pickGoodEnoughLine(goodEnoughStore.get().last);
  goodEnoughStore.see(levelKey(at), line);
  const prefs = budgetPrefs(app.workspace?.projects[at.projectId]);
  const saving = prefs ? optionalSavings(level) : 0;
  const n = left.length;
  const done = (action: 'drop' | 'keep' | 'close') => track('good_enough', { action, count_bucket: bucket(n) });

  const body = h(
    'div',
    { class: 'good-enough' },
    h(
      'div',
      { class: 'ge-hero', 'aria-hidden': 'true' },
      h('span', { class: 'ge-face' }, img(portraitCanvas(app.heroId, 'reacting'), 'ge-portrait'), img(emoteCanvas('meh'), 'ge-emote')),
      img(thumbCanvas(app.heroId), 'ge-thumb'),
    ),
    h('p', { class: 'ge-line' }, `“${line}”`),
    h(
      'p',
      null,
      `Every must-do is done. ${n} optional item${n === 1 ? '' : 's'} left: `,
      left.slice(0, 4).map((i, k) => [k > 0 && ', ', h('b', null, truncate(i.title, 40))]),
      n > 4 && ` and ${n - 4} more`,
      '.',
    ),
  );

  openModal(
    'Good enough!',
    body,
    [
      { label: 'Leave them', run: () => done('close') },
      {
        label: 'Keep for later',
        run: () => {
          if (!app.dispatchBatch(keepOptionalOps(at, level, app.workspace?.inbox), { via: 'good_enough' })) return false;
          done('keep');
        },
      },
      {
        label: saving > 0 ? `Drop the rest, bank ${formatMoney(saving, prefs!.currency)}` : 'Drop the rest',
        kind: 'primary',
        run: () => {
          if (!app.dispatchBatch(dropOptionalOps(at, level), { via: 'good_enough' })) return false;
          done('drop');
        },
      },
    ],
  );
}
