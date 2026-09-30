import {
  isBlocking,
  isResolved,
  isWorldLocked,
  layoutLevel,
  levelNodeState,
  nudges,
  orderedWorlds,
  parseLevelRef,
  scoreLevel,
  suggestNext,
  totals,
  uniqueId,
  worldTotals,
  type EntryDiff,
  type Item,
  type Level,
  type World,
} from '@quest/shared';
import type { App } from '../app';
import { href } from '../router';
import { fmtDuration, h, icon, relTime, stars } from './dom';
import { criterionForm, goalForm, itemForm, levelForm, projectForm, STATUS_LABEL, TYPE_INFO, worldForm } from './forms';
import { mergeDialog, reviewDialog } from './review';

const link = (label: string, to: string, cls = 'link') => h('a', { href: to, class: cls }, label);

type Kid = Node | string | null | false | undefined | Kid[];

function section(title: string, action: HTMLElement | null, ...children: Kid[]) {
  return h('section', { class: 'card' }, h('header', null, h('h3', null, title), action), ...children);
}

function smallBtn(label: string, onclick: () => void, cls = '') {
  return h('button', { class: `btn sm ${cls}`, type: 'button', onclick }, label);
}

function badge(change: EntryDiff['change'] | undefined) {
  if (!change) return null;
  const label = { added: '+ new', modified: '! changed', removed: '× removed' }[change];
  return h('span', { class: `diff ${change}` }, label);
}

export function renderPanel(app: App): HTMLElement {
  const r = app.route;
  if (!app.state && r.view !== 'prs' && r.view !== 'pr' && r.view !== 'pr-level')
    return h('div', { class: 'panel-inner' }, h('p', { class: 'muted' }, app.store.error ?? 'Loading…'));
  switch (r.view) {
    case 'overworld':
      return overworldPanel(app);
    case 'world':
      return worldPanel(app, r.worldId);
    case 'level':
    case 'pr-level':
      return levelPanel(app);
    case 'prs':
      return pullsPanel(app);
    case 'pr':
      return pullPanel(app, r.pr);
  }
}

function overworldPanel(app: App) {
  const s = app.state!;
  const t = totals(s);
  const next = suggestNext(s);
  const edit = app.caps.canEdit;
  const worlds = orderedWorlds(s);
  const nextLevel = next && s.worlds[next.worldId]?.levels.find((l) => l.id === next.levelId);

  return h(
    'div',
    { class: 'panel-inner' },
    h(
      'div',
      { class: 'title-row' },
      h('h2', null, s.overworld.title),
      edit && smallBtn('Edit', () => projectForm(app)),
    ),
    s.overworld.description && h('p', { class: 'muted' }, s.overworld.description),
    h(
      'div',
      { class: 'stat-grid' },
      h('div', null, h('b', null, t.xp), h('span', null, 'XP')),
      h('div', null, h('b', null, t.coins), h('span', null, 'coins')),
      h('div', null, h('b', null, `${t.stars}/${t.maxStars}`), h('span', null, 'stars')),
      h('div', null, h('b', null, `${t.levelsCleared}/${t.levels}`), h('span', null, 'levels')),
    ),
    nextLevel &&
      h(
        'a',
        { class: 'btn primary block', href: href({ view: 'level', ...next! }) },
        `▶ Next: ${nextLevel.name}`,
      ),
    section(
      'Goals',
      edit ? smallBtn('+ Goal', () => goalForm(app)) : null,
      h(
        'ul',
        { class: 'list' },
        s.overworld.goals.map((g) => {
          const ws = worlds.filter((w) => w.goalIds.includes(g.id));
          const lv = ws.flatMap((w) => w.levels);
          const done = lv.filter((l) => scoreLevel(l).cleared).length;
          return h(
            'li',
            null,
            h('div', { class: 'row' }, h('strong', null, g.title), edit && smallBtn('✎', () => goalForm(app, g), 'ghost')),
            g.description && h('small', { class: 'muted' }, g.description),
            h('div', { class: 'bar' }, h('i', { style: `width:${lv.length ? (100 * done) / lv.length : 0}%` })),
            h('small', { class: 'muted' }, `${done}/${lv.length} levels · ${ws.map((w) => w.name).join(', ') || 'no worlds yet'}`),
          );
        }),
      ),
    ),
    section(
      'Worlds',
      edit ? smallBtn('+ World', () => worldForm(app)) : null,
      h(
        'ul',
        { class: 'list' },
        worlds.map((w, i) => {
          const wt = worldTotals(w);
          const locked = isWorldLocked(s, w);
          return h(
            'li',
            { class: locked ? 'locked' : '' },
            h(
              'div',
              { class: 'row' },
              link(`${i + 1}. ${w.name}`, href({ view: 'world', worldId: w.id })),
              locked && h('small', { class: 'muted' }, '🔒'),
              h('span', { class: 'grow' }),
              h('small', null, `${wt.cleared}/${wt.levels}`),
              edit &&
                h(
                  'span',
                  { class: 'row tight' },
                  smallBtn('↑', () => move(app, w.id, -1), 'ghost'),
                  smallBtn('↓', () => move(app, w.id, 1), 'ghost'),
                ),
            ),
          );
        }),
      ),
    ),
    app.caps.canReviewPRs &&
      h('a', { class: 'btn warp block', href: href({ view: 'prs' }) }, icon('warp-pipe', 'grass', 'icon'), ' Warp Zone: review PRs'),
    syncFooter(app),
  );
}

function move(app: App, worldId: string, delta: number) {
  const order = [...app.state!.overworld.worldOrder];
  const i = order.indexOf(worldId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  app.dispatch({ kind: 'updateOverworld', patch: { worldOrder: order } });
}

function worldPanel(app: App, worldId: string) {
  const s = app.state!;
  const w = s.worlds[worldId];
  if (!w) return h('div', { class: 'panel-inner' }, h('p', null, 'World not found. '), link('Back to map', '#/'));
  const edit = app.caps.canEdit;
  const wt = worldTotals(w);
  const goals = s.overworld.goals.filter((g) => w.goalIds.includes(g.id));
  return h(
    'div',
    { class: 'panel-inner' },
    h('nav', { class: 'crumbs' }, link('Overworld', '#/')),
    h('div', { class: 'title-row' }, h('h2', null, w.name), edit && smallBtn('Edit', () => worldForm(app, w))),
    w.description && h('p', { class: 'muted' }, w.description),
    h('p', null, stars(wt.stars, wt.maxStars || 3), ' ', h('small', null, `${wt.cleared}/${wt.levels} levels cleared`)),
    goals.length > 0 && h('div', { class: 'chips' }, goals.map((g) => h('span', { class: 'chip' }, g.title))),
    isWorldLocked(s, w) &&
      h('p', { class: 'note warn' }, `Locked until ${(w.unlocksAfter ?? []).map((id) => s.worlds[id]?.name ?? id).join(', ')} cleared. You can still play it.`),
    section(
      'Levels',
      edit ? smallBtn('+ Level', () => levelForm(app, w)) : null,
      w.levels.length === 0 && h('p', { class: 'muted' }, 'No levels yet. Each level is one key deliverable.'),
      h(
        'ol',
        { class: 'list' },
        w.levels.map((l, i) => {
          const sc = scoreLevel(l);
          const st = levelNodeState(w, i);
          return h(
            'li',
            { class: st },
            h(
              'div',
              { class: 'row' },
              icon({ cleared: 'node-clear', 'in-progress': 'node-active', open: 'node', locked: 'node-lock' }[st], 'grass', 'icon sm'),
              link(l.name, href({ view: 'level', worldId: w.id, levelId: l.id })),
              h('span', { class: 'grow' }),
              sc.cleared ? stars(sc.stars) : h('small', { class: 'muted' }, `${sc.mvpDone}/${sc.mvpTotal} MVP`),
              edit &&
                h(
                  'span',
                  { class: 'row tight' },
                  smallBtn('↑', () => app.dispatch({ kind: 'moveLevel', worldId: w.id, levelId: l.id, index: i - 1 }), 'ghost'),
                  smallBtn('↓', () => app.dispatch({ kind: 'moveLevel', worldId: w.id, levelId: l.id, index: i + 1 }), 'ghost'),
                ),
            ),
            h('small', { class: 'muted' }, l.deliverable),
          );
        }),
      ),
    ),
  );
}

function timerBlock(app: App, world: World, level: Level, readonly: boolean) {
  const sc = scoreLevel(level);
  const t = sc.timer;
  const edit = !readonly && app.caps.canEdit;
  if (t.phase === 'not-started')
    return h(
      'div',
      { class: 'timer idle' },
      h('span', null, `⏱ ${level.timeboxDays}-day time-box, not started`),
      edit && smallBtn('Start clock', () => app.dispatch({ kind: 'startLevel', worldId: world.id, levelId: level.id })),
    );
  const pct = Math.max(0, Math.min(100, (t.remainingFraction ?? 0) * 100));
  const label =
    t.phase === 'cleared'
      ? `Cleared ${relTime(level.clearedAt)} with ${fmtDuration(t.remainingMs!)} to spare`
      : t.phase === 'overdue'
        ? `Overdue by ${fmtDuration(-t.remainingMs!)}`
        : `${fmtDuration(t.remainingMs!)} left of ${level.timeboxDays}d`;
  return h(
    'div',
    { class: `timer ${t.phase}` },
    h('span', null, `⏱ ${label}`),
    t.phase !== 'cleared' && h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })),
  );
}

function levelPanel(app: App) {
  const cur = app.currentLevel();
  const r = app.route;
  if (!cur) {
    if (r.view === 'pr-level') return pullPanel(app, r.pr);
    return h('div', { class: 'panel-inner' }, h('p', null, 'Level not found. '), link('Back to map', '#/'));
  }
  const { world, level, diff, readonly } = cur;
  const edit = !readonly && app.caps.canEdit;
  const at = { worldId: world.id, levelId: level.id };
  const sc = scoreLevel(level);
  const lay = layoutLevel(level);
  const order = new Map(lay.entities.map((e, i) => [e.itemId, i]));
  const items = [...level.items].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const heroAt = lay.hero.itemId;
  const sel = app.selection;
  const back =
    r.view === 'pr-level'
      ? link(`Warp World #${r.pr}`, href({ view: 'pr', pr: r.pr }))
      : link(world.name, href({ view: 'world', worldId: world.id }));

  const critList = h(
    'ul',
    { class: 'list criteria' },
    level.successCriteria.map((c) =>
      h(
        'li',
        { class: c.done ? 'done' : '' },
        h(
          'label',
          { class: 'check' },
          h('input', {
            type: 'checkbox',
            checked: c.done,
            disabled: !edit,
            onchange: (e: Event) =>
              app.dispatch({ kind: 'setCriterion', ...at, criterionId: c.id, done: (e.target as HTMLInputElement).checked }),
          }),
          h('span', null, c.text),
        ),
        c.mvp ? h('span', { class: 'tag mvp', title: 'Required to clear' }, 'MVP') : h('span', { class: 'tag' }, 'bonus'),
        badge(diff?.criteria[c.id]?.change),
        edit && smallBtn('✎', () => criterionForm(app, world.id, level, c), 'ghost'),
      ),
    ),
  );

  const itemCard = (item: Item) => {
    const d = diff?.items[item.id];
    const selected = sel?.kind === 'item' && sel.id === item.id;
    const optional = item.type === 'stretch' || item.mvp === false;
    const ref = item.levelRef ? parseLevelRef(item.levelRef) : undefined;
    const quick = (status: Item['status'], label: string) =>
      item.status !== status &&
      smallBtn(label, () => app.dispatch({ kind: 'setItemStatus', ...at, itemId: item.id, status }), status === 'done' ? 'go' : '');
    return h(
      'li',
      {
        class: `item ${item.status} ${selected ? 'selected' : ''} ${d?.change ?? ''}`,
        id: `item-${item.id}`,
        onclick: (e: Event) => {
          if ((e.target as HTMLElement).closest('button,a,input')) return;
          app.select(selected ? undefined : { kind: 'item', id: item.id });
        },
      },
      h(
        'div',
        { class: 'row' },
        icon(TYPE_INFO[item.type].sprite, 'grass', 'icon'),
        h('span', { class: 'item-title' }, item.title),
        heroAt === item.id && h('span', { class: 'tag hero', title: 'The hero is waiting here' }, 'NEXT'),
        badge(d?.change),
      ),
      h(
        'div',
        { class: 'row meta' },
        h('span', { class: `pill ${item.status}` }, STATUS_LABEL[item.status]),
        h('small', { class: 'muted' }, TYPE_INFO[item.type].label),
        optional ? h('small', { class: 'muted' }, '· optional') : isBlocking(item) && h('small', { class: 'warn-text' }, '· blocks'),
        h('span', { class: 'grow' }),
        edit && [quick('doing', 'Start'), quick('done', '✓ Done'), !isResolved(item) && quick('dropped', 'Drop')],
      ),
      selected &&
        h(
          'div',
          { class: 'detail' },
          item.notes && h('p', { class: 'notes' }, item.notes),
          item.dependsOn?.length &&
            h('small', null, 'After: ', item.dependsOn.map((id) => level.items.find((i) => i.id === id)?.title ?? id).join(', ')),
          ref && h('div', null, link(`↪ Warp to ${item.levelRef}`, href({ view: 'level', ...ref }))),
          item.link && h('div', null, h('a', { href: item.link, target: '_blank', rel: 'noopener noreferrer', class: 'link' }, item.link)),
          d?.fields.length &&
            h(
              'ul',
              { class: 'fielddiff' },
              d.fields.map((f) =>
                h('li', null, h('code', null, f.field), ': ', h('del', null, JSON.stringify(f.before) ?? '—'), ' → ', h('ins', null, JSON.stringify(f.after) ?? '—')),
              ),
            ),
          edit && smallBtn('Edit item', () => itemForm(app, world.id, level, item)),
        ),
    );
  };

  const quickAdd = () => {
    const title = h('input', { type: 'text', placeholder: 'Add an item…', maxLength: 120, 'aria-label': 'New item title' });
    const type = h(
      'select',
      { 'aria-label': 'Item type' },
      Object.entries(TYPE_INFO).map(([k, v]) => h('option', { value: k }, v.label)),
    );
    return h(
      'form',
      {
        class: 'quick-add',
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (!title.value.trim()) return itemForm(app, world.id, level, undefined, { type: type.value as Item['type'] });
          const ids = level.items.map((i) => i.id);
          const id = uniqueId(title.value, ids);
          if (app.dispatch({ kind: 'addItem', ...at, item: { id, type: type.value as Item['type'], title: title.value.trim(), status: 'todo' } }).ok)
            title.value = '';
        },
      },
      title,
      type,
      h('button', { class: 'btn sm primary', type: 'submit' }, 'Add'),
      smallBtn('More…', () => itemForm(app, world.id, level, undefined, { title: title.value, type: type.value as Item['type'] }), 'ghost'),
    );
  };

  return h(
    'div',
    { class: 'panel-inner' },
    h('nav', { class: 'crumbs' }, link('Overworld', '#/'), ' › ', back),
    h('div', { class: 'title-row' }, h('h2', null, level.name), badge(diff?.change), edit && smallBtn('Edit', () => levelForm(app, world, level))),
    h('p', { class: 'deliverable' }, '🎯 ', level.deliverable),
    level.description && h('p', { class: 'muted' }, level.description),
    diff?.fields.length &&
      h('ul', { class: 'fielddiff' }, diff.fields.map((f) => h('li', null, h('code', null, f.field), ' changed'))),
    timerBlock(app, world, level, readonly),
    h(
      'div',
      { class: 'score-row' },
      stars(sc.stars),
      h('span', null, `${sc.xp} XP`),
      h('span', null, `${sc.coins} 🪙`),
      sc.polish > 0 && h('span', { class: 'warn-text', title: 'Edits after clearing' }, `🐢 ${sc.polish}`),
    ),
    !readonly &&
      nudges(level).map((n) => h('p', { class: `note ${n.tone}` }, n.text)),
    section(
      `Success criteria · ${sc.mvpDone}/${sc.mvpTotal} MVP`,
      edit ? smallBtn('+', () => criterionForm(app, world.id, level)) : null,
      critList,
    ),
    section(
      `Items · ${level.items.filter(isResolved).length}/${level.items.length}`,
      null,
      edit && quickAdd(),
      items.length === 0 && h('p', { class: 'muted' }, 'Empty level. Add tasks, blockers, risks…'),
      h('ul', { class: 'list items' }, items.map(itemCard)),
    ),
  );
}

function pullsPanel(app: App) {
  const p = app.pulls;
  if (!app.caps.canReviewPRs)
    return h(
      'div',
      { class: 'panel-inner' },
      h('h2', null, 'Warp Zone'),
      h('p', null, 'Connect GitHub in Settings (or set GITHUB_TOKEN for Docker) to review pull requests here.'),
    );
  return h(
    'div',
    { class: 'panel-inner' },
    h('nav', { class: 'crumbs' }, link('Overworld', '#/')),
    h('div', { class: 'title-row' }, h('h2', null, 'Warp Zone'), smallBtn('↻', () => void app.loadPulls(true), 'ghost')),
    h('p', { class: 'muted' }, 'Open pull requests that change quest data. Each one is a Warp World to explore before merging.'),
    p.loading && h('p', null, 'Scanning pipes…'),
    p.error && h('p', { class: 'note alert' }, p.error),
    p.list?.length === 0 && h('p', { class: 'muted' }, 'No open PRs touch data/. All quiet.'),
    h(
      'ul',
      { class: 'list' },
      (p.list ?? []).map((pr) =>
        h(
          'li',
          null,
          h('div', { class: 'row' }, icon('warp-pipe', 'grass', 'icon sm'), link(`#${pr.number} ${pr.title}`, href({ view: 'pr', pr: pr.number }))),
          h('small', { class: 'muted' }, `${pr.author} · ${pr.dataFiles.length} data file(s) · updated ${relTime(pr.updatedAt)}${pr.draft ? ' · draft' : ''}`),
        ),
      ),
    ),
  );
}

export function pullPanel(app: App, n: number) {
  const v = app.pullView(n);
  const wrap = (...c: (Node | string | null | false | undefined)[]) =>
    h('div', { class: 'panel-inner' }, h('nav', { class: 'crumbs' }, link('Overworld', '#/'), ' › ', link('Warp Zone', href({ view: 'prs' }))), ...c);
  if (!v || v.loading) return wrap(h('p', null, 'Warping…'));
  if (v.error || !v.data || !v.diff)
    return wrap(h('p', { class: 'note alert' }, v.error ?? 'Failed to load'), smallBtn('Retry', () => void app.loadPull(n, true)));
  const { detail, head, base } = v.data;
  const d = v.diff;
  const valid = (v.issues ?? []).length === 0;
  const mergeable = detail.mergeable !== false && valid;
  const checks = detail.checks;
  const worldName = (id: string) => head.worlds[id]?.name ?? base.worlds[id]?.name ?? id;
  return wrap(
    h('h2', null, `#${detail.number} ${detail.title}`),
    h('p', { class: 'muted' }, `${detail.author} wants to merge ${detail.headRef} → ${detail.baseRef}`),
    detail.body && h('p', { class: 'notes' }, detail.body.slice(0, 600)),
    h(
      'div',
      { class: 'status-list' },
      h('div', { class: valid ? 'ok' : 'bad' }, valid ? '✓ Schema valid' : `✗ ${v.issues!.length} schema issue(s)`),
      h(
        'div',
        { class: checks.state === 'success' ? 'ok' : checks.state === 'failure' ? 'bad' : 'wait' },
        { success: '✓ Checks passed', failure: '✗ Checks failing', pending: '… Checks running', none: '– No checks' }[checks.state],
      ),
      h('div', { class: detail.mergeable === false ? 'bad' : 'ok' }, detail.mergeable === false ? `✗ Not mergeable (${detail.mergeableState})` : `✓ Mergeable (${detail.mergeableState ?? 'unknown'})`),
    ),
    !valid && h('ul', { class: 'fielddiff' }, v.issues!.slice(0, 8).map((i) => h('li', null, `${i.file}${i.path}: ${i.message}`))),
    section(
      `Changes · ${d.count}`,
      null,
      d.overworld.length > 0 && h('p', null, `Project: ${d.overworld.map((f) => f.field).join(', ')} changed`),
      Object.values(d.goals).map((g) => h('p', null, badge(g.change), ` goal ${g.id}`)),
      h(
        'ul',
        { class: 'list' },
        Object.values(d.worlds).map((w) =>
          h(
            'li',
            null,
            h('div', { class: 'row' }, badge(w.change), h('strong', null, worldName(w.id))),
            h(
              'ul',
              { class: 'list nested' },
              d.levels
                .filter((l) => l.worldId === w.id)
                .map((l) =>
                  h(
                    'li',
                    null,
                    badge(l.change),
                    ' ',
                    link(
                      head.worlds[w.id]?.levels.find((x) => x.id === l.levelId)?.name ??
                        base.worlds[w.id]?.levels.find((x) => x.id === l.levelId)?.name ??
                        l.levelId,
                      href({ view: 'pr-level', pr: n, worldId: w.id, levelId: l.levelId }),
                    ),
                    h('small', { class: 'muted' }, ` ${Object.keys(l.items).length} item(s), ${Object.keys(l.criteria).length} criteria`),
                  ),
                ),
            ),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'actions' },
      smallBtn('Review…', () => reviewDialog(app, detail)),
      h(
        'button',
        {
          class: 'btn sm go',
          type: 'button',
          disabled: !mergeable,
          title: mergeable ? 'Merge this PR' : 'Fix validation / conflicts first',
          onclick: () => mergeDialog(app, detail),
        },
        '⚑ Merge',
      ),
      h('a', { class: 'btn sm ghost', href: detail.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open on GitHub'),
    ),
  );
}

export function syncFooter(app: App) {
  const s = app.store;
  return h(
    'footer',
    { class: 'sync-foot muted' },
    h('small', null, `${s.source.label} · synced ${relTime(s.lastSyncedAt)}${s.outbox.length ? ` · ${s.outbox.length} queued` : ''}`),
  );
}

