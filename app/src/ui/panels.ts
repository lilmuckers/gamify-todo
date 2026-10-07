import {
  alertLevel,
  budgetPrefs,
  clockNow,
  costLabel,
  costNote,
  dependencyMode,
  formatMoney,
  hasCost,
  itemCost,
  levelCost,
  projectCost,
  savedLabel,
  worldCost,
  type BudgetPrefs,
  type Cost,
  isBlocking,
  isMvpItem,
  isResolved,
  isWorldLocked,
  layoutLevel,
  levelNodeState,
  levelRefTarget,
  nudges,
  orderedProjects,
  orderedWorlds,
  safeLink,
  scoreLevel,
  shelfKind,
  suggestNextLevel,
  totals,
  uniqueId,
  worldTotals,
  type EntryDiff,
  type Item,
  type Level,
  type World,
} from '@quest/shared';
import { bucket, track } from '../analytics';
import { itemAddr, type App, type LevelView } from '../app';
import { pullLookup } from '../data/source';
import { href } from '../router';
import { NODE_SPRITE } from '../sprites/pixels';
import { fmtDuration, h, icon, relTime, stars } from './dom';
import { criterionForm, goalForm, itemForm, levelForm, projectForm, STATUS_LABEL, TYPE_INFO, worldForm } from './forms';
import { mergeDialog, reviewDialog } from './review';

const link = (label: string, to: string, cls = 'link') => h('a', { href: to, class: cls }, label);

/** Small cash tag for list rows; nothing when budgets are off or there's no money involved. */
function costTag(c: Cost, prefs: BudgetPrefs | undefined) {
  if (!prefs || !hasCost(c)) return null;
  const { currency } = prefs;
  const over = c.budgeted && c.left < 0;
  return h('small', { class: `money-tag${over ? ' over' : ''}`, title: savedLabel(c, currency) }, costLabel(c, currency));
}

/**
 * The money box for a level, world, project or dependency: spent against the
 * budget, what's left and the savings banked so far, plus a note when it's
 * over (or the parts below plan more than the budget).
 */
function costBlock(c: Cost, prefs: BudgetPrefs | undefined, opts: { note?: boolean } = {}) {
  if (!prefs || !hasCost(c)) return null;
  const { currency } = prefs;
  const m = (n: number) => formatMoney(n, currency);
  const over = c.budgeted && c.left < 0;
  const near = prefs.alerts && alertLevel(c, prefs.alertAt) === 1;
  const head = !c.budgeted
    ? `💰 ${m(c.spent)} spent, no budget set`
    : c.spent > 0
      ? `💰 ${m(c.spent)} spent of ${m(c.budget)}`
      : `💰 ${m(c.budget)} budget, nothing spent yet`;
  const facts = [
    c.budgeted && c.spent > 0 && (over ? `${m(-c.left)} over` : `${m(c.left)} left`),
    c.saved > 0 && `${m(c.saved)} saved${c.settled ? '' : ' so far'}`,
    c.saved < 0 && `${m(-c.saved)} overspent on finished things`,
  ].filter(Boolean);
  const note = opts.note ? costNote(c, currency, prefs.alerts ? prefs.alertAt : undefined) : undefined;
  return [
    h(
      'div',
      { class: `money${over ? ' over' : near ? ' near' : ''}` },
      h('span', null, head),
      c.budgeted && c.budget > 0 && h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, (100 * c.spent) / c.budget)}%` })),
      facts.length > 0 && h('small', null, facts.join(' · ')),
    ),
    note && h('p', { class: `note ${note.tone}` }, note.text),
  ];
}

const SHELF_HEADING = { floor: '', finished: 'Completed', archived: 'Archived: clocks paused' };

function projectsPanel(app: App) {
  const ws = app.workspace!;
  const projects = orderedProjects(ws);
  const edit = app.caps.canEdit;
  const kinds = (['floor', 'finished', 'archived'] as const).map((k) => [k, projects.filter((p) => shelfKind(p) === k)] as const);
  return h(
    'div',
    { class: 'panel-inner' },
    h('div', { class: 'title-row' }, h('h2', null, 'Select project'), edit && smallBtn('+ Project', () => projectForm(app, true))),
    h('p', { class: 'muted' }, 'Each project is a separate map with its own goals, worlds and levels.'),
    projects.length === 0 &&
      h(
        'p',
        { class: 'note info' },
        edit ? 'No projects yet. Create one to start your quest.' : 'No projects here yet.',
      ),
    kinds.map(([kind, group]) => [
      kind !== 'floor' && group.length > 0 && h('h3', { class: 'shelf-heading' }, SHELF_HEADING[kind]),
      group.length > 0 &&
        h(
          'ul',
          { class: 'list' },
          group.map((p) => {
            const t = totals(p);
            const cash = projectCost(p);
            const money = budgetPrefs(p);
            const nextLevel = suggestNextLevel(p)?.level;
            return h(
              'li',
              null,
              h(
                'div',
                { class: 'row' },
                link(p.overworld.title, href({ view: 'overworld', projectId: p.overworld.id })),
                h('span', { class: 'grow' }),
                h('small', null, `★${t.stars}/${t.maxStars}`),
              ),
              p.overworld.description && h('small', { class: 'muted' }, p.overworld.description),
              h('div', { class: 'bar' }, h('i', { style: `width:${t.levels ? (100 * t.levelsCleared) / t.levels : 0}%` })),
              h(
                'small',
                { class: 'muted' },
                `${Object.keys(p.worlds).length} world(s) · ${t.levelsCleared}/${t.levels} levels · ${t.xp} XP`,
                nextLevel ? ` · next: ${nextLevel.name}` : '',
                money && hasCost(cash) ? ` · ${costLabel(cash, money.currency)}` : '',
              ),
            );
          }),
        ),
    ]),
    app.caps.canReviewPRs &&
      warpZoneButton(),
    syncFooter(app),
  );
}

type Kid = Node | string | null | false | undefined | Kid[];

/** Big button into the Warp Zone (PR review). */
function warpZoneButton() {
  return h('a', { class: 'btn warp block', href: href({ view: 'prs' }) }, icon('warp-pipe', 'grass', 'icon'), ' Warp Zone: review PRs');
}

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
  if (!app.workspace && r.view !== 'prs' && r.view !== 'pr' && r.view !== 'pr-level')
    return h('div', { class: 'panel-inner' }, h('p', { class: 'muted' }, app.store.error ?? 'Loading…'));
  if (app.projectId && !app.state && r.view !== 'pr-level')
    return h('div', { class: 'panel-inner' }, h('p', null, 'Project not found. '), link('All projects', '#/'));
  switch (r.view) {
    case 'projects':
    // Detailed stats covers the whole view; the project floor waits behind it.
    case 'records':
      return projectsPanel(app);
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
  const next = suggestNextLevel(s);
  const edit = app.caps.canEdit;
  const worlds = orderedWorlds(s);

  const pid = app.projectId!;
  return h(
    'div',
    { class: 'panel-inner' },
    h('nav', { class: 'crumbs' }, link('All projects', '#/')),
    h(
      'div',
      { class: 'title-row' },
      h('h2', null, s.overworld.title),
      edit && smallBtn('Edit', () => projectForm(app)),
    ),
    s.overworld.description && h('p', { class: 'muted' }, s.overworld.description),
    s.overworld.archivedAt &&
      h(
        'div',
        { class: 'note info archived-note' },
        h('span', null, '📦 Archived: on the shelf, with its clocks paused. It stays out of Today and the weekly review.'),
        edit && smallBtn('Unarchive', () => app.dispatch({ projectId: pid, kind: 'setArchived', archived: false })),
      ),
    h(
      'div',
      { class: 'stat-grid' },
      h('div', null, h('b', null, t.xp), h('span', null, 'XP')),
      h('div', null, h('b', null, t.coins), h('span', null, 'coins')),
      h('div', null, h('b', null, `${t.stars}/${t.maxStars}`), h('span', null, 'stars')),
      h('div', null, h('b', null, `${t.levelsCleared}/${t.levels}`), h('span', null, 'levels')),
    ),
    costBlock(projectCost(s), budgetPrefs(s)),
    next &&
      h(
        'a',
        { class: 'btn primary block', href: href({ view: 'level', projectId: pid, worldId: next.worldId, levelId: next.levelId }) },
        `▶ Next: ${next.level.name}`,
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
              link(`${i + 1}. ${w.name}`, href({ view: 'world', projectId: pid, worldId: w.id })),
              locked && h('small', { class: 'muted' }, '🔒'),
              h('span', { class: 'grow' }),
              costTag(worldCost(w), budgetPrefs(s)),
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
      warpZoneButton(),
    syncFooter(app),
  );
}

function move(app: App, worldId: string, delta: number) {
  const order = [...app.state!.overworld.worldOrder];
  const i = order.indexOf(worldId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  app.dispatch({ projectId: app.projectId!, kind: 'updateProject', patch: { worldOrder: order } });
}

function worldPanel(app: App, worldId: string) {
  const s = app.state!;
  const w = s.worlds[worldId];
  if (!w) return h('div', { class: 'panel-inner' }, h('p', null, 'World not found. '), link('Back to map', '#/'));
  const edit = app.caps.canEdit;
  const wt = worldTotals(w);
  const goals = s.overworld.goals.filter((g) => w.goalIds.includes(g.id));
  const pid = app.projectId!;
  return h(
    'div',
    { class: 'panel-inner' },
    h('nav', { class: 'crumbs' }, link('All projects', '#/'), ' › ', link(s.overworld.title, href({ view: 'overworld', projectId: pid }))),
    h('div', { class: 'title-row' }, h('h2', null, w.name), edit && smallBtn('Edit', () => worldForm(app, w))),
    w.description && h('p', { class: 'muted' }, w.description),
    h('p', null, stars(wt.stars, wt.maxStars || 3), ' ', h('small', null, `${wt.cleared}/${wt.levels} levels cleared`)),
    goals.length > 0 && h('div', { class: 'chips' }, goals.map((g) => h('span', { class: 'chip' }, g.title))),
    costBlock(worldCost(w), budgetPrefs(s), { note: true }),
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
              icon(NODE_SPRITE[st], 'grass', 'icon sm'),
              link(l.name, href({ view: 'level', projectId: pid, worldId: w.id, levelId: l.id })),
              h('span', { class: 'grow' }),
              costTag(levelCost(l), budgetPrefs(s)),
              sc.cleared ? stars(sc.stars) : h('small', { class: 'muted' }, `${l.someday ? '💤 someday · ' : ''}${sc.mvpDone}/${sc.mvpTotal} MVP`),
              edit &&
                h(
                  'span',
                  { class: 'row tight' },
                  smallBtn('↑', () => app.dispatch({ projectId: pid, kind: 'moveLevel', worldId: w.id, levelId: l.id, index: i - 1 }), 'ghost'),
                  smallBtn('↓', () => app.dispatch({ projectId: pid, kind: 'moveLevel', worldId: w.id, levelId: l.id, index: i + 1 }), 'ghost'),
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
  const project = app.state?.overworld;
  const sc = scoreLevel(level, clockNow(project));
  const t = sc.timer;
  const edit = !readonly && app.caps.canEdit;
  if (project?.archivedAt && t.phase !== 'cleared')
    return h(
      'div',
      { class: 'timer idle archived' },
      h(
        'span',
        null,
        t.phase === 'not-started'
          ? '⏸ Game archived: this level waits on the shelf with it.'
          : `⏸ Game archived: the clock is paused ${t.remainingMs! < 0 ? `${fmtDuration(-t.remainingMs!)} over the time-box` : `with ${fmtDuration(t.remainingMs!)} left`}. It picks up from there when you unarchive.`,
      ),
      edit && smallBtn('Unarchive', () => app.dispatch({ projectId: app.projectId!, kind: 'setArchived', archived: false })),
    );
  if (level.someday)
    return h(
      'div',
      { class: 'timer idle someday' },
      h('span', null, '💤 On the someday shelf: off Today and the weekly review. The clock starts afresh when you pick it up.'),
      edit && smallBtn('Bring it back', () => app.dispatch({ projectId: app.projectId!, kind: 'setSomeday', worldId: world.id, levelId: level.id, someday: false })),
    );
  if (t.phase === 'not-started')
    return h(
      'div',
      { class: 'timer idle' },
      h('span', null, `⏱ ${level.timeboxDays}-day time-box, not started`),
      edit && smallBtn('Start clock', () => app.dispatch({ projectId: app.projectId!, kind: 'startLevel', worldId: world.id, levelId: level.id })),
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
    sc.extendedDays > 0 &&
      h(
        'small',
        { class: 'muted' },
        `Extended by ${sc.extendedDays}d: the in-time ★ and time bonus still count the original ${level.timeboxDays - sc.extendedDays}d.`,
      ),
  );
}

function levelPanel(app: App) {
  const cur = app.currentLevel();
  const r = app.route;
  if (!cur) {
    if (r.view === 'pr-level') return pullPanel(app, r.pr);
    return h('div', { class: 'panel-inner' }, h('p', null, 'Level not found. '), link('Back to map', '#/'));
  }
  const { projectId, world, level, diff, readonly } = cur;
  const edit = !readonly && app.caps.canEdit;
  const at = { projectId, worldId: world.id, levelId: level.id };
  const itemAt = itemAddr(cur);
  const sc = scoreLevel(level);
  const lay = layoutLevel(level, { sub: !!cur.sub });
  const order = new Map(lay.entities.map((e, i) => [e.itemId, i]));
  const items = [...level.items].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const heroAt = lay.hero.itemId;
  const sel = app.selection;
  const back =
    r.view === 'pr-level'
      ? link(`Warp World #${r.pr}`, href({ view: 'pr', pr: r.pr }))
      : link(world.name, href({ view: 'world', projectId, worldId: world.id }));
  const projectTitle =
    r.view === 'pr-level'
      ? (() => {
          const data = app.pullView(r.pr)?.data;
          return data && pullLookup(data).project(projectId)?.overworld.title;
        })()
      : app.state?.overworld.title;

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
    const cash = itemCost(item);
    const saved = cur.budgets && cash.settled ? savedLabel(cash, cur.budgets.currency) : undefined;
    const quick = (status: Item['status'], label: string) =>
      item.status !== status &&
      smallBtn(label, () => app.dispatch({ kind: 'setItemStatus', ...itemAt, itemId: item.id, status }), status === 'done' ? 'go' : '');
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
        costTag(cash, cur.budgets),
        h('span', { class: 'grow' }),
        edit && [quick('doing', 'Start'), quick('done', '✓ Done'), !isResolved(item) && quick('dropped', 'Drop')],
      ),
      selected &&
        h(
          'div',
          { class: 'detail' },
          item.notes && h('p', { class: 'notes' }, item.notes),
          saved && h('small', { class: cash.saved > 0 ? 'win-text' : 'warn-text' }, cash.saved > 0 ? `💰 ${saved} on this one` : `💰 ${saved} budget`),
          item.dependsOn?.length &&
            h('small', null, 'After: ', item.dependsOn.map((id) => level.items.find((i) => i.id === id)?.title ?? id).join(', ')),
          !cur.sub && dependencyLinks(app, cur, item),
          item.link &&
            h('div', null, safeLink(item.link) ? h('a', { href: item.link, target: '_blank', rel: 'noopener noreferrer', class: 'link' }, item.link) : item.link),
          d?.fields.length &&
            h(
              'ul',
              { class: 'fielddiff' },
              d.fields.map((f) =>
                h('li', null, h('code', null, f.field), ': ', h('del', null, JSON.stringify(f.before) ?? '—'), ' → ', h('ins', null, JSON.stringify(f.after) ?? '—')),
              ),
            ),
          edit && smallBtn(cur.sub ? 'Edit step' : 'Edit item', () => itemForm(app, cur, item)),
        ),
    );
  };

  const quickAdd = () => {
    // data-keep: survives panel re-renders (value, focus, cursor), so you can add item after item.
    const title = h('input', {
      type: 'text',
      placeholder: cur.sub ? 'Add a step…' : 'Add an item…',
      maxLength: 120,
      'aria-label': 'New item title',
      'data-keep': `quick-add:${cur.level.id}:${cur.sub?.dep.id ?? ''}`,
    });
    const type = h(
      'select',
      { 'aria-label': 'Item type', 'data-keep': `quick-add-type:${cur.level.id}:${cur.sub?.dep.id ?? ''}` },
      Object.entries(TYPE_INFO)
        .filter(([k]) => !cur.sub || k !== 'dependency')
        .map(([k, v]) => h('option', { value: k }, v.label)),
    );
    return h(
      'form',
      {
        class: 'quick-add',
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (!title.value.trim()) return itemForm(app, cur, undefined, { type: type.value as Item['type'] });
          const ids = level.items.map((i) => i.id);
          const id = uniqueId(title.value, ids);
          if (app.dispatch({ kind: 'addItem', ...itemAt, item: { id, type: type.value as Item['type'], title: title.value.trim(), status: 'todo' } }).ok)
            title.value = '';
        },
      },
      title,
      type,
      h('button', { class: 'btn sm primary', type: 'submit' }, 'Add'),
      smallBtn('More…', () => itemForm(app, cur, undefined, { title: title.value, type: type.value as Item['type'] }), 'ghost'),
    );
  };

  if (cur.sub) {
    const { parent, dep } = cur.sub;
    const up = { ...r, subId: undefined, itemId: dep.id } as typeof r;
    const left = level.items.filter((i) => isMvpItem(i) && !isResolved(i)).length;
    // Back up the pipe: the hero pops out of the dependency's pipe in the level.
    const goUp = (closed: boolean) => {
      track('warp_exit', { closed });
      app.arrival = { kind: 'pipe-up', itemId: dep.id };
    };
    const setDep = (status: Item['status']) => {
      track('dependency_resolve', { action: status === 'done' ? 'close' : 'skip', dep_mode: 'warp' });
      goUp(status === 'done');
      if (app.dispatch({ kind: 'setItemStatus', ...at, itemId: dep.id, status }).ok) location.hash = href(up);
    };
    return h(
      'div',
      { class: 'panel-inner sub-level' },
      h('nav', { class: 'crumbs' }, link(world.name, href({ view: 'world', projectId, worldId: world.id })), ' › ', link(parent.name, href(up))),
      h('div', { class: 'title-row' }, h('h2', null, '⬇ ', dep.title), h('span', { class: `pill ${dep.status}` }, STATUS_LABEL[dep.status])),
      h('p', { class: 'deliverable' }, 'Below the warp pipe: the steps it takes to get this dependency.'),
      dep.notes && h('p', { class: 'muted' }, dep.notes),
      costBlock(itemCost(dep), cur.budgets, { note: true }),
      h(
        'p',
        { class: `note ${sc.cleared ? 'win' : 'info'}` },
        sc.cleared
          ? 'Every must-do step is out of the way.'
          : left
            ? `${left} must-do step${left === 1 ? '' : 's'} to go. Clear them and the hero heads back up with it done.`
            : 'Add the steps it takes to get this. Clear them and the hero heads back up with it done.',
      ),
      h(
        'div',
        { class: 'row actions' },
        h(
          'a',
          {
            class: 'btn sm',
            href: href(up),
            onclick: () => goUp(false),
          },
          '⬆ Back up the pipe',
        ),
        edit && !isResolved(dep) && smallBtn('✓ Got it', () => setDep('done'), 'go'),
        edit && !isResolved(dep) && smallBtn('Jump over', () => setDep('dropped')),
      ),
      section(
        `Steps · ${level.items.filter(isResolved).length}/${level.items.length}`,
        null,
        edit && quickAdd(),
        items.length === 0 && h('p', { class: 'muted' }, 'No steps yet. What has to happen before you have this?'),
        h('ul', { class: 'list items' }, items.map(itemCard)),
      ),
    );
  }

  return h(
    'div',
    { class: 'panel-inner' },
    h(
      'nav',
      { class: 'crumbs' },
      r.view === 'pr-level'
        ? [link('Warp Zone', href({ view: 'prs' })), ' › ', back, ` › ${projectTitle ?? projectId}`]
        : [link(projectTitle ?? projectId, href({ view: 'overworld', projectId })), ' › ', back],
    ),
    h('div', { class: 'title-row' }, h('h2', null, level.name), badge(diff?.change), edit && smallBtn('Edit', () => levelForm(app, world, level))),
    h('p', { class: 'deliverable' }, '🎯 ', level.deliverable),
    level.description && h('p', { class: 'muted' }, level.description),
    cloudHomeLink(app),
    diff?.fields.length &&
      h('ul', { class: 'fielddiff' }, diff.fields.map((f) => h('li', null, h('code', null, f.field), ' changed'))),
    timerBlock(app, world, level, readonly),
    costBlock(levelCost(level), cur.budgets, { note: !readonly }),
    h(
      'div',
      { class: 'score-row' },
      stars(sc.stars),
      h('span', null, `${sc.xp} XP`),
      h('span', null, `${sc.coins} 🪙`),
      sc.polish > 0 && h('span', { class: 'warn-text', title: 'Edits after clearing' }, `🐢 ${sc.polish}`),
    ),
    !readonly &&
      nudges(level, clockNow(app.state?.overworld), !!app.state?.overworld.archivedAt).map((n) => h('p', { class: `note ${n.tone}` }, n.text)),
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

/** The cloud back to the dependency the hero rode over from, while it waits here. */
function cloudHomeLink(app: App) {
  const home = app.cloudHome();
  if (!home) return null;
  const ride = (e: MouseEvent) => {
    e.preventDefault();
    const to = app.rideHome();
    if (to) location.hash = href(to);
  };
  return h('p', null, h('a', { class: 'link', href: href(home.route), onclick: ride }, `☁ Ride the cloud back to ${home.label}`));
}

/** Ways into a dependency: down its warp pipe, onto its cloud, or (when editing) add steps. */
function dependencyLinks(app: App, cur: LevelView, item: Item) {
  const mode = dependencyMode(item);
  if (!mode) return null;
  const r = app.route;
  if (mode === 'cloud') {
    const target = app.state && levelRefTarget(app.state, item);
    if (!target || r.view !== 'level') return h('small', { class: 'muted' }, `Needs level ${item.levelRef}`);
    const ride = () => app.rideCloud({ projectId: cur.projectId, worldId: cur.world.id, levelId: cur.level.id, itemId: item.id }, target);
    const to = href({ view: 'level', projectId: cur.projectId, worldId: target.worldId, levelId: target.levelId });
    return h('div', null, h('a', { class: 'link', href: to, onclick: ride }, `☁ Ride the cloud to ${target.world.name}: ${target.level.name}`));
  }
  if (r.view !== 'level' && r.view !== 'pr-level') return null;
  const below = { ...r, subId: item.id, itemId: undefined };
  const enter = () => {
    const steps = item.subtasks?.length ?? 0;
    track('warp_enter', { steps_bucket: bucket(steps), adding: steps === 0 });
    app.arrival = { kind: 'pipe-down' };
  };
  if (mode === 'warp') {
    const steps = (item.subtasks ?? []) as Item[];
    const done = steps.filter(isResolved).length;
    return h('div', null, h('a', { class: 'link', href: href(below), onclick: enter }, `⬇ Warp in: ${done}/${steps.length} steps done`));
  }
  if (r.view === 'level' && !cur.readonly && app.caps.canEdit)
    return h('div', null, h('a', { class: 'link', href: href(below), onclick: enter }, '+ Add steps (a warp pipe down to them)'));
  return null;
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
    h('nav', { class: 'crumbs' }, link('All projects', '#/')),
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
    h('div', { class: 'panel-inner' }, h('nav', { class: 'crumbs' }, link('All projects', '#/'), ' › ', link('Warp Zone', href({ view: 'prs' }))), ...c);
  if (!v || v.loading) return wrap(h('p', null, 'Warping…'));
  if (v.error || !v.data || !v.diff)
    return wrap(h('p', { class: 'note alert' }, v.error ?? 'Failed to load'), smallBtn('Retry', () => void app.loadPull(n, true)));
  const { detail } = v.data;
  const d = v.diff;
  const valid = (v.issues ?? []).length === 0;
  const mergeable = detail.mergeable !== false && valid;
  const checks = detail.checks;
  const find = pullLookup(v.data);
  const projectOf = find.project;
  const worldName = (pid: string, wid: string) => find.world(pid, wid)?.name ?? wid;
  const levelName = (pid: string, wid: string, lid: string) => find.level({ projectId: pid, worldId: wid, levelId: lid })?.name ?? lid;
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
      h(
        'ul',
        { class: 'list' },
        Object.entries(d.projects).map(([pid, pd]) =>
          h(
            'li',
            null,
            h('div', { class: 'row' }, badge(pd.change), h('strong', null, projectOf(pid)?.overworld.title ?? pid)),
            pd.diff.overworld.length > 0 &&
              h('small', { class: 'muted' }, `project.json: ${pd.diff.overworld.map((f) => f.field).join(', ')} changed`),
            Object.values(pd.diff.goals).map((g) => h('small', null, badge(g.change), ` goal ${g.id}`)),
            Object.values(pd.diff.worlds).map((w) =>
              h(
                'div',
                { class: 'nested-world' },
                h('div', { class: 'row' }, badge(w.change), worldName(pid, w.id)),
                h(
                  'ul',
                  { class: 'list nested' },
                  pd.diff.levels
                    .filter((l) => l.worldId === w.id)
                    .map((l) =>
                      h(
                        'li',
                        null,
                        badge(l.change),
                        ' ',
                        link(levelName(pid, w.id, l.levelId), href({ view: 'pr-level', pr: n, projectId: pid, worldId: w.id, levelId: l.levelId })),
                        h('small', { class: 'muted' }, ` ${Object.keys(l.items).length} item(s), ${Object.keys(l.criteria).length} criteria`),
                      ),
                    ),
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

