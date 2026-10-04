import {
  ITEM_TYPES,
  safeLink,
  THEMES,
  uniqueId,
  type InboxItem,
  type ItemType,
  type OpBody,
  type Theme,
} from '@quest/shared';
import type { App } from '../app';
import { go, withPad, type Route } from '../router';
import { h, icon } from './dom';
import { field, requireFilled, select, text, TYPE_INFO, trimOrUndef } from './forms';
import { openModal } from './modal';
import { toast } from './toast';

/** What you're doing on the inbox page; kept across re-renders. */
const ui = {
  selected: new Set<string>(),
  editing: undefined as string | undefined,
  /** Link waiting to go with the next scribbled idea (from the share sheet). */
  link: undefined as string | undefined,
  via: 'pad' as 'pad' | 'share',
};

/** Pre-fills the scribble line with something shared to the app. */
export function prefillCapture(title: string, link?: string) {
  ui.link = link;
  ui.via = 'share';
  pendingTitle = title;
}
let pendingTitle: string | undefined;

const typeOptions = ITEM_TYPES.map((t) => ({ value: t, label: TYPE_INFO[t].label }));

/** Where selected ideas can go from the screen behind the pad. */
type Target =
  | { kind: 'game' }
  | { kind: 'world'; projectId: string }
  | { kind: 'level'; projectId: string; worldId: string }
  | { kind: 'place'; projectId: string; worldId: string; levelId: string; parentId?: string };

function targetFor(app: App, screen: Route): Target | undefined {
  switch (screen.view) {
    case 'projects':
      return { kind: 'game' };
    case 'overworld':
      return { kind: 'world', projectId: screen.projectId };
    case 'world':
      return { kind: 'level', projectId: screen.projectId, worldId: screen.worldId };
    case 'level': {
      const cur = app.currentLevel();
      return cur && { kind: 'place', projectId: cur.projectId, worldId: cur.world.id, levelId: cur.level.id, parentId: cur.sub?.dep.id };
    }
    default:
      return undefined;
  }
}

function actionLabel(t: Target, n: number) {
  const things = `${n || ''}${n ? ' ' : ''}idea${n === 1 ? '' : 's'}`;
  switch (t.kind) {
    case 'game':
      return `New game from ${things}`;
    case 'world':
      return `New world from ${things}`;
    case 'level':
      return `New level from ${things}`;
    case 'place':
      return t.parentId ? `Add ${things} as steps` : `Add ${things} to this level`;
  }
}

/** The inbox page of the legal pad: captured ideas, waiting to be placed. */
export function inboxSheet(app: App): (Node | null | false | undefined)[] {
  const items = app.workspace?.inbox ?? [];
  const edit = app.caps.canEdit;
  const ids = new Set(items.map((i) => i.id));
  for (const id of ui.selected) if (!ids.has(id)) ui.selected.delete(id);

  const add = (title: string, type: ItemType) => {
    const item: InboxItem = {
      id: uniqueId(title, [...ids]),
      type,
      title,
      ...(ui.link ? { link: ui.link } : {}),
      addedAt: new Date().toISOString(),
    };
    const r = app.dispatch({ kind: 'inboxAdd', item }, { via: ui.via });
    if (r.ok) {
      ui.link = undefined;
      ui.via = 'pad';
    }
    return r.ok;
  };

  const scribble = (() => {
    if (!edit) return null;
    const title = h('input', {
      type: 'text',
      class: 'pad-scribble',
      placeholder: 'Jot something down…',
      maxLength: 120,
      'aria-label': 'New idea',
      'data-keep': 'inbox-scribble',
    });
    if (pendingTitle) {
      title.value = pendingTitle;
      pendingTitle = undefined;
    }
    const type = h(
      'select',
      { class: 'pad-type', 'aria-label': 'Type', 'data-keep': 'inbox-type' },
      typeOptions.map((o) => h('option', { value: o.value }, o.label)),
    );
    return h(
      'form',
      {
        class: 'pad-capture',
        onsubmit: (e: Event) => {
          e.preventDefault();
          const t = title.value.trim();
          if (!t) return title.focus();
          if (add(t, type.value as ItemType)) title.value = '';
        },
      },
      title,
      type,
      h('button', { class: 'pad-pen', type: 'submit', title: 'Add to inbox' }, '+'),
      ui.link &&
        h(
          'div',
          { class: 'pad-shared' },
          '🔗 ',
          ui.link,
          h('button', { class: 'pad-pen', type: 'button', title: 'Drop the link', onclick: () => ((ui.link = undefined), app.emit()) }, '✕'),
        ),
    );
  })();

  const line = (item: InboxItem) => {
    const selected = ui.selected.has(item.id);
    if (edit && ui.editing === item.id) return editLine(app, item);
    return h(
      'li',
      { class: `pad-line inbox${selected ? ' picked' : ''}` },
      h(
        'button',
        {
          class: 'pad-box',
          type: 'button',
          disabled: !edit,
          'aria-pressed': String(selected),
          'aria-label': `${selected ? 'Unselect' : 'Select'} "${item.title}"`,
          onclick: () => {
            if (selected) ui.selected.delete(item.id);
            else ui.selected.add(item.id);
            app.emit();
          },
        },
        tickBox(selected),
      ),
      icon(TYPE_INFO[item.type].sprite, 'grass', 'icon sm pad-icon'),
      h(
        edit ? 'button' : 'span',
        {
          class: 'pad-link',
          ...(edit ? { type: 'button', title: 'Edit', onclick: () => ((ui.editing = item.id), app.emit()) } : {}),
        },
        item.title,
      ),
      (item.notes || item.link) &&
        h(
          'span',
          { class: 'pad-where' },
          item.notes ?? '',
          item.link && [
            item.notes ? ' · ' : '',
            safeLink(item.link) ? h('a', { href: item.link, target: '_blank', rel: 'noopener noreferrer' }, linkLabel(item.link)) : item.link,
          ],
        ),
      edit &&
        h(
          'button',
          {
            class: 'pad-pen pad-cross',
            type: 'button',
            title: 'Cross it out',
            'aria-label': `Remove "${item.title}"`,
            onclick: () => app.dispatch({ kind: 'inboxRemove', ids: [item.id] }),
          },
          '✕',
        ),
    );
  };

  const screen = withPad(app.route, undefined);
  const target = edit ? targetFor(app, screen) : undefined;
  const n = ui.selected.size;
  const bar =
    edit &&
    items.length > 0 &&
    h(
      'div',
      { class: 'pad-actions' },
      h(
        'button',
        {
          class: 'pad-pen small',
          type: 'button',
          onclick: () => {
            if (ui.selected.size === items.length) ui.selected.clear();
            else for (const i of items) ui.selected.add(i.id);
            app.emit();
          },
        },
        ui.selected.size === items.length ? 'none' : 'all',
      ),
      target
        ? h(
            'button',
            { class: 'pad-do', type: 'button', disabled: !n, onclick: () => place(app, target, [...ui.selected]) },
            actionLabel(target, n),
            ' →',
          )
        : h('span', { class: 'pad-where' }, 'Open a level, world or the project list to place these'),
    );

  return [
    h('h2', { class: 'pad-title' }, 'INBOX'),
    h('div', { class: 'pad-sub' }, 'scribbled ideas, not sorted yet'),
    scribble,
    !edit && h('p', { class: 'pad-where' }, 'Read-only: connect GitHub in Settings to jot things down.'),
    items.length
      ? h('ul', { class: 'pad-list' }, items.map(line))
      : h('p', { class: 'pad-empty' }, edit ? 'Nothing here. Jot ideas down as they come; sort them later.' : 'Empty.'),
    bar,
  ];
}

function tickBox(on: boolean) {
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

function linkLabel(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Basic details only: rich editing comes once it's placed in a level. */
function editLine(app: App, item: InboxItem) {
  const title = text(item.title);
  const type = select(typeOptions, item.type);
  const notes = text(item.notes ?? '', { required: false, max: 4000, placeholder: 'Notes' });
  const link = h('input', { type: 'url', value: item.link ?? '', placeholder: 'https://…' });
  const done = () => {
    ui.editing = undefined;
    app.emit();
  };
  return h(
    'li',
    { class: 'pad-line inbox editing' },
    h(
      'form',
      {
        class: 'pad-edit',
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (!requireFilled(title)) return;
          if (link.value && !link.checkValidity()) return link.reportValidity();
          app.dispatch({
            kind: 'inboxUpdate',
            id: item.id,
            patch: {
              title: title.value.trim(),
              type: type.value as ItemType,
              notes: trimOrUndef(notes.value),
              link: trimOrUndef(link.value),
            },
          });
          done();
        },
      },
      title,
      type,
      notes,
      link,
      h('div', null, h('button', { class: 'pad-pen', type: 'submit' }, 'save'), h('button', { class: 'pad-pen', type: 'button', onclick: done }, 'cancel')),
    ),
  );
}

/** Puts the selected ideas somewhere, making a new game / world / level first if needed. */
function place(app: App, target: Target, ids: string[]) {
  const finish = (where: { projectId: string; worldId: string; levelId: string; parentId?: string }, kind: string, before: OpBody[]) => {
    for (const op of before) if (!app.dispatch(op).ok) return false;
    const { projectId, worldId, levelId, parentId } = where;
    const r = app.dispatch({ kind: 'inboxPlace', ids, projectId, worldId, levelId, ...(parentId ? { parentId } : {}) }, { target: kind });
    if (!r.ok) return false;
    ui.selected.clear();
    toast(`${ids.length} idea${ids.length === 1 ? '' : 's'} placed`, 'win');
    return true;
  };

  if (target.kind === 'place') {
    const { kind: _, ...where } = target;
    finish(where, target.parentId ? 'steps' : 'level', []);
    return;
  }

  const fields: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  const rows: Node[] = [];
  if (target.kind === 'game') {
    fields.title = text('', { placeholder: 'e.g. Garden makeover' });
    fields.goal = text('', { required: false, placeholder: 'Defaults to the title' });
    rows.push(field('Game title', fields.title), field('First goal', fields.goal, 'What does done look like?'));
  }
  if (target.kind !== 'level') {
    fields.world = text(target.kind === 'game' ? 'World 1' : '');
    fields.theme = select(
      THEMES.map((t) => ({ value: t, label: t })),
      'grass',
    );
    rows.push(field('World name', fields.world), field('Theme', fields.theme));
  }
  fields.level = text('First steps');
  fields.deliverable = text('', { max: 280, required: false, placeholder: 'Defaults to the level name' });
  fields.criterion = text('Everything on this list done', { max: 280 });
  fields.days = h('input', { type: 'number', min: 1, max: 90, value: '7' });
  rows.push(
    field('Level name', fields.level),
    field('Deliverable', fields.deliverable, 'One sentence: what exists when this level is cleared.'),
    field('Good enough when…', fields.criterion, 'The MVP success criterion.'),
    field('Time-box (days)', fields.days),
  );

  const title = { game: 'New game', world: 'New world', level: 'New level' }[target.kind];
  openModal(`${title} from ${ids.length} idea${ids.length === 1 ? '' : 's'}`, h('div', null, rows), [
    { label: 'Cancel' },
    {
      label: 'Create',
      kind: 'primary',
      run: () => {
        const required = [fields.level, fields.criterion, ...(fields.title ? [fields.title] : []), ...(fields.world ? [fields.world] : [])];
        if (!requireFilled(...(required as HTMLInputElement[]))) return false;
        const ws = app.workspace!;
        const v = (k: string) => fields[k]?.value.trim() ?? '';
        const levelName = v('level');
        const level = {
          id: '',
          name: levelName,
          deliverable: v('deliverable') || levelName,
          timeboxDays: Math.max(1, Math.min(90, Math.round(Number(v('days')) || 7))),
          successCriteria: [{ id: uniqueId(v('criterion'), []), text: v('criterion'), mvp: true, done: false }],
          items: [],
        };
        const ops: OpBody[] = [];
        let projectId: string;
        let worldId: string;
        if (target.kind === 'game') {
          projectId = uniqueId(v('title'), Object.keys(ws.projects));
          const goal = v('goal') || v('title');
          ops.push({ kind: 'addProject', projectId, project: { id: projectId, title: v('title'), goals: [{ id: uniqueId(goal, []), title: goal }], worldOrder: [] } });
        } else projectId = target.projectId;
        const state = ws.projects[projectId];
        if (target.kind === 'level') worldId = target.worldId;
        else {
          worldId = uniqueId(v('world'), Object.keys(state?.worlds ?? {}));
          const goalIds = target.kind === 'game' ? [] : (state?.overworld.goals.map((g) => g.id) ?? []).slice(0, 1);
          ops.push({ kind: 'addWorld', projectId, world: { id: worldId, name: v('world'), theme: v('theme') as Theme, goalIds, levels: [] } });
        }
        level.id = uniqueId(levelName, ['world', ...(state?.worlds[worldId]?.levels.map((l) => l.id) ?? [])]);
        ops.push({ kind: 'addLevel', projectId, worldId, level });
        if (target.kind === 'game') {
          // The new game's world serves its first goal.
          const goalId = (ops[0] as { project: { goals: { id: string }[] } }).project.goals[0].id;
          (ops[1] as { world: { goalIds: string[] } }).world.goalIds = [goalId];
        }
        const ok = finish({ projectId, worldId, levelId: level.id }, target.kind, ops);
        if (ok) go({ view: 'level', projectId, worldId, levelId: level.id });
        return ok;
      },
    },
  ]);
}

/** Items waiting in the inbox: the HUD badge count. */
export function inboxCount(app: App): number {
  return app.workspace?.inbox?.length ?? 0;
}
