import {
  budgetPrefs,
  buildSearchIndex,
  fold,
  hasFilters,
  isProjectArchived,
  ITEM_TYPES,
  search,
  snippet,
  STATUSES,
  type SearchEntry,
  type SearchFilters,
  type SearchHit,
} from '@quest/shared';
import { bucket, track } from '../analytics';
import type { App } from '../app';
import { href, withPad, type Route } from '../router';
import { h, icon, mount } from './dom';
import { STATUS_LABEL, TYPE_INFO } from './forms';
import { openModal } from './modal';

/** Which of the extra chips make sense here. */
export interface ChipOptions {
  overdue?: boolean;
  /** Some project tracks money. */
  budgets?: boolean;
  /** Some project is archived. */
  archived?: boolean;
}

const toggle = <T,>(list: T[] | undefined, v: T) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);

/**
 * Filter chips: item type, status, and the flags (blocking, overdue, over
 * budget, archived). Used by the search window and a level's item list.
 */
export function filterChips(f: SearchFilters, opts: ChipOptions, onChange: (f: SearchFilters) => void): HTMLElement {
  const chip = (label: string | (Node | string)[], on: boolean, next: SearchFilters, title?: string) =>
    h('button', { type: 'button', class: `chip filter${on ? ' on' : ''}`, 'aria-pressed': String(on), title, onclick: () => onChange(next) }, label);
  const types = (f.types ?? []) as string[];
  return h(
    'div',
    { class: 'filter-chips', role: 'group', 'aria-label': 'Filters' },
    h(
      'div',
      { class: 'chips' },
      ITEM_TYPES.map((t) => chip([icon(TYPE_INFO[t].sprite, 'grass', 'icon sm'), TYPE_INFO[t].label], types.includes(t), { ...f, types: toggle(f.types, t) })),
    ),
    h(
      'div',
      { class: 'chips' },
      STATUSES.map((s) => chip(STATUS_LABEL[s], !!f.statuses?.includes(s), { ...f, statuses: toggle(f.statuses, s) })),
      chip('Blocking', !!f.blocking, { ...f, blocking: !f.blocking }, 'Open must-do items: they hold their level up'),
      opts.overdue && chip('Overdue levels', !!f.overdue, { ...f, overdue: !f.overdue }, 'Levels past their time-box, and what is in them'),
      opts.budgets && chip('Over budget', !!f.overBudget, { ...f, overBudget: !f.overBudget }),
      opts.archived && chip('Archived games', !!f.archived, { ...f, archived: !f.archived }, 'Archived games are left out unless this is on'),
    ),
  );
}

/** Where a result goes: its screen, with an item's bubble open; an inbox idea opens the Inbox page. */
export function resultRoute(e: SearchEntry, from: Route): Route {
  const { projectId, worldId, levelId } = e;
  switch (e.kind) {
    case 'inbox':
      return withPad(from, 'inbox');
    case 'project':
      return { view: 'overworld', projectId: projectId! };
    case 'world':
      return { view: 'world', projectId: projectId!, worldId: worldId! };
    case 'level':
      return { view: 'level', projectId: projectId!, worldId: worldId!, levelId: levelId! };
    case 'item':
    case 'step':
      return { view: 'level', projectId: projectId!, worldId: worldId!, levelId: levelId!, subId: e.subId, itemId: e.itemId };
  }
}

const KIND_ICON: Record<string, string> = { project: 'star', world: 'node-clear', level: 'node' };
const KIND_LABEL: Record<string, string> = { project: 'Project', world: 'World', level: 'Level', inbox: 'Inbox idea' };

/** Filters stay set between searches (until the page reloads). */
let filters: SearchFilters = {};

/**
 * The search window (/ or the HUD's search button): type to search every
 * project, world, level, item, step and inbox idea; arrows and Enter to go.
 * Search terms never leave the browser: analytics gets only a result-count bucket.
 */
export function openSearch(app: App, via: 'key' | 'button') {
  const ws = app.workspace;
  if (!ws) return;
  track('search_open', { via });
  const index = buildSearchIndex(ws);
  const projects = Object.values(ws.projects);
  const opts: ChipOptions = {
    overdue: true,
    budgets: projects.some((p) => budgetPrefs(p)),
    archived: projects.some(isProjectArchived),
  };
  let hits: SearchHit[] = [];
  let active = 0;

  const input = h('input', {
    type: 'search',
    class: 'search-input',
    placeholder: 'Find a project, level, item or step…',
    'aria-label': 'Search',
    'aria-controls': 'search-results',
    autocomplete: 'off',
    spellcheck: false,
  });
  const chipsBox = h('div', null);
  const list = h('ul', { class: 'search-results', id: 'search-results', role: 'listbox', 'aria-label': 'Results' });
  const status = h('p', { class: 'muted search-status', 'aria-live': 'polite' });

  const go = (hit: SearchHit) => {
    track('search_go', { kind: hit.entry.kind, results_bucket: bucket(hits.length), filtered: hasFilters(filters) });
    close();
    location.hash = href(resultRoute(hit.entry, app.route));
  };

  const row = (hit: SearchHit, i: number) => {
    const e = hit.entry;
    const sprite = e.itemType ? TYPE_INFO[e.itemType].sprite : KIND_ICON[e.kind];
    const kind = e.itemType ? `${TYPE_INFO[e.itemType].label}${e.kind === 'step' ? ' step' : ''}` : KIND_LABEL[e.kind];
    const q = input.value;
    const words = fold(q).split(/\s+/).filter(Boolean);
    // Matched in the notes, not the title: show where.
    const why = words.length && !words.some((w) => e.keys.title.includes(w)) ? snippet(e.body, q) : undefined;
    return h(
      'li',
      { id: `search-hit-${i}`, role: 'option', 'aria-selected': String(i === active), class: `search-hit${i === active ? ' active' : ''}${e.finished ? ' finished' : ''}` },
      h(
        'a',
        {
          href: href(resultRoute(e, app.route)),
          tabindex: -1,
          onclick: (ev: Event) => {
            ev.preventDefault();
            go(hit);
          },
          onmousemove: () => active !== i && setActive(i),
        },
        icon(sprite, 'grass', 'icon'),
        h(
          'span',
          { class: 'search-text' },
          h('span', { class: 'search-title' }, e.title),
          e.path.length > 0 && h('small', { class: 'search-path' }, e.path.join(' › ')),
          why && h('small', { class: 'search-snippet' }, why),
        ),
        h(
          'span',
          { class: 'search-tags' },
          e.status && h('span', { class: `pill ${e.status}` }, STATUS_LABEL[e.status]),
          h('small', { class: 'muted' }, kind),
        ),
      ),
    );
  };

  const setActive = (i: number) => {
    active = i;
    list.querySelectorAll('.search-hit').forEach((el, j) => {
      el.classList.toggle('active', j === i);
      el.setAttribute('aria-selected', String(j === i));
    });
    input.setAttribute('aria-activedescendant', `search-hit-${i}`);
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };

  const render = () => {
    hits = search(index, input.value, filters);
    active = 0;
    mount(list, hits.map(row));
    if (hits.length) input.setAttribute('aria-activedescendant', 'search-hit-0');
    else input.removeAttribute('aria-activedescendant');
    const asked = input.value.trim() || hasFilters(filters);
    status.textContent = !asked ? 'Type to search, or pick a filter.' : hits.length ? '' : 'Nothing found. Try fewer words or filters.';
    mount(chipsBox, filterChips(filters, opts, (f) => {
      filters = f;
      render();
      input.focus();
    }));
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length) setActive((active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length);
    } else if (e.key === 'Enter') {
      // The modal is a form: Enter would submit it.
      e.preventDefault();
      if (hits[active]) go(hits[active]);
    }
  });

  render();
  const close = openModal('Search', h('div', { class: 'search' }, input, chipsBox, status, list), [{ label: 'Close' }]);
}
