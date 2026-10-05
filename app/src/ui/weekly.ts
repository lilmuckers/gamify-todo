import {
  dropOptionalOps,
  findLevel,
  levelKey,
  MAX_FOCUS,
  REVIEW_SLOTS,
  STALE_DAYS,
  weeklyReview,
  type FocusCandidate,
  type LevelRef,
  type OverdueLevel,
  type ShippedItem,
  type ShippedLevel,
  type StaleLevel,
} from '@quest/shared';
import type { App } from '../app';
import { bucket, track } from '../analytics';
import { href } from '../router';
import { play as sfx } from '../audio';
import { h, stars } from './dom';
import { confirmDialog } from './modal';
import { toast } from './toast';

const DAY_MS = 86_400_000;
/** Days the time-box can be stretched by, from the review. */
const EXTENSIONS = [1, 3, 7];
const MAX_LINES = 8;

/** Stale levels you said to keep this time round (until the page reloads). */
const kept = new Set<string>();

const code = (c: string, red = false) => h('span', { class: `pad-code${red ? ' red' : ''}` }, c);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const levelHref = (r: LevelRef) => href({ view: 'level', projectId: r.projectId, worldId: r.worldId, levelId: r.levelId });
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

function section(title: string, cls: string, lines: (HTMLElement | null)[], empty?: string, more?: Node | null, max = MAX_LINES) {
  const shown = lines.filter(Boolean) as HTMLElement[];
  return h(
    'section',
    { class: `pad-section ${cls}` },
    h('h3', null, title),
    shown.length
      ? h(
          'ul',
          null,
          shown.slice(0, max),
          shown.length > max && h('li', { class: 'pad-line more' }, `+ ${shown.length - max} more…`),
        )
      : empty && h('p', { class: 'pad-where review-empty' }, empty),
    more,
  );
}

/**
 * The weekly review, on green paper: what shipped in the last 7 days, levels
 * past their time-box (with one-tap scope cuts), levels gone quiet, and up to
 * three levels to focus on next week. Ends with a "Review done" stamp.
 */
export function reviewSheet(app: App): (Node | null | false | undefined)[] {
  const ws = app.workspace;
  if (!ws) return [h('h2', { class: 'pad-title' }, 'WEEKLY REVIEW'), h('p', { class: 'pad-empty' }, 'Loading…')];
  const now = Date.now();
  const review = weeklyReview(ws, now);
  const prefs = app.review;
  const edit = app.caps.canEdit;
  const doneThisRound = !app.reviewDue;

  // ---- Shipped ----
  const shippedLevel = (r: ShippedLevel) =>
    h(
      'li',
      { class: 'pad-line shipped' },
      code(r.code),
      h('a', { class: 'pad-link', href: levelHref(r) }, r.levelName),
      stars(r.stars),
      h('span', { class: 'pad-where' }, `+${r.xp} XP · ${day(r.clearedAt)} · ${r.projectTitle}`),
    );
  const shippedItem = (r: ShippedItem) =>
    h(
      'li',
      { class: 'pad-line shipped item' },
      h('span', { class: 'review-tick', 'aria-hidden': 'true' }, '✓'),
      h(
        'a',
        { class: 'pad-link', href: href({ view: 'level', projectId: r.projectId, worldId: r.worldId, levelId: r.levelId, subId: r.subId, itemId: r.item.id }) },
        r.depTitle ? h('span', { class: 'pad-dep' }, `⬇ ${r.depTitle}: `) : null,
        r.item.title,
      ),
      h('span', { class: 'pad-where' }, `${r.code} · ${r.projectTitle}`),
    );
  const { shipped } = review;
  const shippedCount = shipped.levels.length + shipped.items.length;
  const shippedTitle = shippedCount
    ? `SHIPPED THIS WEEK${shipped.levels.length ? ` (+${shipped.xp} XP, ★${shipped.stars})` : ''}`
    : 'SHIPPED THIS WEEK';

  // ---- Scope cuts ----
  const cut = (action: string, run: () => boolean | Promise<boolean>) => async () => {
    if (!(await run())) return;
    track('review_action', { action });
  };
  const dropOptional = (r: OverdueLevel) =>
    cut('drop_optional', () => {
      const level = findLevel(ws.projects[r.projectId], r.worldId, r.levelId);
      if (!level) return false;
      const ops = dropOptionalOps(r, level);
      const ok = app.dispatchBatch(ops, { source: 'review' });
      if (ok) sfx('win');
      if (ok) toast(`Dropped ${plural(ops.length, 'optional item')} from ${r.levelName}. Scope cut: no penalty.`, 'win');
      return ok;
    });
  const extend = (r: OverdueLevel, days: number) =>
    cut('extend', () => {
      const ok = app.dispatchBatch([{ kind: 'extendTimebox', projectId: r.projectId, worldId: r.worldId, levelId: r.levelId, days }], { source: 'review' });
      if (ok) toast(`${r.levelName}: +${plural(days, 'day')}. The ★ for finishing in time still counts the original time-box.`, 'warn', 5000);
      return ok;
    });
  const someday = (r: LevelRef) =>
    cut('someday', () => {
      const ok = app.dispatchBatch([{ kind: 'setSomeday', projectId: r.projectId, worldId: r.worldId, levelId: r.levelId, someday: true }], { source: 'review' });
      if (ok) sfx('win');
      if (ok) toast(`${r.levelName} is on the someday shelf. Start any item to bring it back.`, 'win');
      return ok;
    });
  const dropLevel = (r: LevelRef) =>
    cut('drop_level', async () => {
      const yes = await confirmDialog(
        'Drop this level?',
        `Delete "${r.levelName}" and everything in it from ${r.projectTitle}? It stays in the git history.`,
        'Drop level',
      );
      if (!yes) return false;
      const ok = app.dispatchBatch([{ kind: 'deleteLevel', projectId: r.projectId, worldId: r.worldId, levelId: r.levelId }], { source: 'review' });
      if (ok) sfx('scratch');
      if (ok) toast(`Dropped ${r.levelName}. Less is more.`, 'win');
      return ok;
    });
  const keep = (r: LevelRef) =>
    cut('keep', () => {
      kept.add(levelKey(r));
      app.emit();
      return true;
    });

  const btn = (label: string, title: string, onclick: () => void, cls = '') =>
    h('button', { class: `pad-pen small review-act ${cls}`, type: 'button', title, onclick }, label);

  const staleActions = (r: LevelRef) => [
    btn('someday', 'Park it on the someday shelf: off Today and this review; the clock restarts when you pick it up again', someday(r)),
    btn('drop level', 'Delete the level (it stays in the git history)', dropLevel(r), 'danger'),
  ];

  const overdueLine = (r: OverdueLevel) => {
    const days = Math.max(1, Math.round(r.overdueMs / DAY_MS));
    const room = 90 - r.timeboxDays;
    return h(
      'li',
      { class: 'pad-line level late review-level' },
      code(r.code, true),
      h('a', { class: 'pad-link', href: levelHref(r) }, r.levelName),
      h('span', { class: 'pad-bang', 'aria-hidden': 'true' }, '!!'),
      h(
        'span',
        { class: 'pad-where' },
        `${plural(days, 'day')} over · ${plural(r.mvpLeft, 'must-do')} · ${r.projectTitle}`,
        r.extendedDays ? ` · already +${r.extendedDays}d` : '',
        r.idleDays !== undefined ? ` · quiet for ${r.idleDays} days` : '',
      ),
      edit &&
        h(
          'div',
          { class: 'review-acts' },
          r.optional.length > 0 &&
            btn(
              `drop ${plural(r.optional.length, 'optional')}`,
              `Drop: ${r.optional.map((i) => i.title).join(', ')}`,
              dropOptional(r),
              'cut',
            ),
          room > 0 &&
            h(
              'span',
              { class: 'review-extend' },
              'extend ',
              EXTENSIONS.filter((d) => d <= room).map((d) => btn(`+${d}d`, `Add ${plural(d, 'day')} to the time-box (the in-time ★ still counts the original)`, extend(r, d))),
              h('em', null, ' (costs the ★)'),
            ),
          r.idleDays !== undefined && staleActions(r),
        ),
    );
  };

  const staleLine = (r: StaleLevel) => {
    if (kept.has(levelKey(r))) return null;
    return h(
      'li',
      { class: 'pad-line level review-level' },
      code(r.code),
      h('a', { class: 'pad-link', href: levelHref(r) }, r.levelName),
      h('span', { class: 'pad-where' }, `quiet for ${r.idleDays} days · ${plural(r.mvpLeft, 'must-do')} · ${r.projectTitle}`),
      edit && h('div', { class: 'review-acts' }, btn('keep', 'Keep going with it', keep(r)), staleActions(r)),
    );
  };

  // ---- Next week's focus ----
  const exists = new Set(review.candidates.map(levelKey));
  const focus = prefs.focus.filter((k) => exists.has(k));
  const toggleFocus = (c: FocusCandidate) => {
    const k = levelKey(c);
    const next = focus.includes(k) ? focus.filter((f) => f !== k) : [...focus, k];
    if (next.length > MAX_FOCUS) return toast(`Pick at most ${MAX_FOCUS}. Fewer is better.`, 'warn');
    app.setReview({ focus: next });
  };
  const focusLine = (c: FocusCandidate) => {
    const k = levelKey(c);
    const on = focus.includes(k);
    const full = !on && focus.length >= MAX_FOCUS;
    return h(
      'li',
      { class: `pad-line inbox review-focus${on ? ' picked' : ''}${full ? ' full' : ''}` },
      h(
        'button',
        { class: 'pad-box', type: 'button', 'aria-pressed': String(on), 'aria-label': `${on ? 'Unpick' : 'Pick'} "${c.levelName}"`, onclick: () => toggleFocus(c) },
        tick(on),
      ),
      code(c.code, c.phase === 'overdue'),
      h('a', { class: 'pad-link', href: levelHref(c) }, c.levelName),
      h('span', { class: 'pad-where' }, `${c.suggested ? 'next up · ' : ''}${plural(c.mvpLeft, 'must-do')} · ${c.projectTitle}`),
    );
  };

  const slot = prefs.day === 'off' ? undefined : REVIEW_SLOTS[prefs.day];
  const finish = () => {
    app.setReview({ lastAt: new Date().toISOString(), focus });
    track('weekly_review_done', {
      shipped_bucket: bucket(shippedCount),
      focus: focus.length,
      overdue: review.overdue.length,
      stale: review.stale.length,
    });
    sfx('stamp');
    toast(focus.length ? `Review done. Focus: ${plural(focus.length, 'level')} this week.` : 'Review done. Have a good week!', 'win');
  };

  return [
    h('div', { class: 'pad-date' }, `since ${day(review.since)}`),
    h('h2', { class: 'pad-title' }, 'WEEKLY REVIEW'),
    h('div', { class: 'pad-sub' }, 'celebrate what shipped, cut what didn’t'),
    doneThisRound && !!prefs.lastAt && h('div', { class: 'review-stamp', title: `Reviewed ${day(prefs.lastAt)}` }, 'REVIEWED ✓'),
    section(
      shippedTitle,
      'shipped',
      [...shipped.levels.map(shippedLevel), ...shipped.items.map(shippedItem)],
      'Nothing shipped yet this week. Small is fine: what’s the smallest thing you could finish?',
    ),
    section(
      'OVERDUE!!',
      'late',
      review.overdue.map(overdueLine),
      'Nothing past its time-box. 👍',
    ),
    section(`GONE QUIET (${STALE_DAYS}+ DAYS)`, 'stale', review.stale.map(staleLine), 'Nothing stuck.'),
    section(
      `NEXT WEEK: PICK UP TO ${MAX_FOCUS}`,
      'focus',
      review.candidates.map(focusLine),
      'Nothing on the go. Start a level and it’ll show up here.',
      focus.length > 0 ? h('p', { class: 'pad-where' }, 'Focus levels go to the top of Today.') : null,
      // Every candidate stays pickable.
      Infinity,
    ),
    h(
      'div',
      { class: 'pad-actions review-done' },
      h('span', { class: 'pad-where' }, slot ? `Due every ${slot.label} · change in ⚙ Settings` : 'Reminders off · ⚙ Settings'),
      h('button', { class: 'pad-do', type: 'button', onclick: finish }, doneThisRound ? 'Update focus ✓' : 'Review done ✓'),
    ),
  ];
}

function tick(on: boolean) {
  const ns = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(ns, 'svg');
  el.setAttribute('viewBox', '0 0 18 18');
  el.setAttribute('class', `pad-box-svg${on ? ' on' : ''}`);
  el.setAttribute('aria-hidden', 'true');
  for (const d of [
    'M2.5 3.2 C6 2.4 11 2.9 15.6 2.6 C15.9 7 15.4 11.5 15.8 15.4 C11.2 15.9 6.4 15.2 2.4 15.7 C2.8 11.4 2.1 7.2 2.5 3.2 Z',
    'M4.5 9.5 L8 13 L16 2.5',
  ]) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    el.append(p);
  }
  return el;
}
