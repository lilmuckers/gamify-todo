import { describe, expect, it } from 'vitest';
import { buildSearchIndex, filterItems, fold, search, snippet, type GameState, type Level, type Workspace } from '../src';
import { level, state } from './fixtures';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-20T12:00:00Z');

function kitchen(): Level {
  return level({
    id: 'tiling',
    name: 'Tiling',
    deliverable: 'Splashback on the wall',
    startedAt: new Date(NOW - 20 * DAY).toISOString(),
    timeboxDays: 7,
    items: [
      { id: 'quote', type: 'task', title: 'Get the tiling quote', status: 'doing', notes: 'Ask Dave and the shop on Mill Road', spent: 120, budget: 100 },
      { id: 'grout', type: 'decision', title: 'Pick a grout colour', status: 'todo' },
      {
        id: 'permit',
        type: 'dependency',
        title: 'Landlord says yes',
        status: 'todo',
        subtasks: [{ id: 'email', type: 'task', title: 'Email the café landlord', status: 'done' }],
      },
      { id: 'shiny', type: 'stretch', title: 'Shiny trim', status: 'todo' },
    ],
  });
}

function ws(): Workspace {
  const house: GameState = state(kitchen());
  house.overworld = { ...house.overworld, id: 'house', title: 'House', budgets: {} };
  const old: GameState = state(level({ id: 'done', name: 'Old tiling', successCriteria: [{ id: 'm', text: 'x', mvp: true, done: true }], items: [] }));
  old.overworld = { ...old.overworld, id: 'old', title: 'Old flat' };
  const shelf: GameState = state(level({ id: 'shelf', name: 'Tiling shelf', items: [] }));
  shelf.overworld = { ...shelf.overworld, id: 'attic', title: 'Attic', archivedAt: '2026-01-01T00:00:00Z' };
  return {
    projects: { house, old, attic: shelf },
    inbox: [{ id: 'tile-idea', type: 'risk', title: 'Tiles might crack', notes: 'Heard about it at the café' }],
  };
}

const titles = (q: string, f = {}) => search(buildSearchIndex(ws(), NOW), q, f).map((h) => h.entry.title);

describe('search index', () => {
  it('flattens projects, worlds, levels, items, steps and inbox ideas with their paths', () => {
    const index = buildSearchIndex(ws(), NOW);
    const step = index.find((e) => e.kind === 'step')!;
    expect(step).toMatchObject({ title: 'Email the café landlord', path: ['House', 'W', 'Tiling', 'Landlord says yes'], projectId: 'house', worldId: 'w', levelId: 'tiling', subId: 'permit', itemId: 'email' });
    expect(index.find((e) => e.kind === 'inbox')).toMatchObject({ itemId: 'tile-idea', itemType: 'risk', path: ['Inbox'] });
    expect(new Set(index.map((e) => e.kind))).toEqual(new Set(['project', 'world', 'level', 'item', 'step', 'inbox']));
  });

  it('flags overdue levels and what is in them, over-budget items, and blocking items', () => {
    const index = buildSearchIndex(ws(), NOW);
    const by = (id: string) => index.find((e) => e.itemId === id || (e.kind === 'level' && e.levelId === id))!;
    expect(by('tiling').overdue).toBe(true);
    expect(by('quote')).toMatchObject({ overdue: true, overBudget: true, blocking: true });
    expect(by('shiny').blocking).toBeUndefined();
  });

  it('only flags money when the project has budgets on', () => {
    const w = ws();
    delete w.projects.house.overworld.budgets;
    expect(buildSearchIndex(w, NOW).some((e) => e.overBudget)).toBe(false);
  });
});

describe('search', () => {
  it('matches every word, case- and accent-insensitively, title first', () => {
    expect(titles('TILING quote')).toEqual(['Get the tiling quote']);
    expect(titles('cafe landlord')).toContain('Email the café landlord');
    expect(titles('tiling quote nope')).toEqual([]);
    expect(fold('Café')).toBe('cafe');
  });

  it('finds things by their notes and path, behind title matches', () => {
    expect(titles('mill road')).toEqual(['Get the tiling quote']);
    const hits = titles('cafe');
    expect(hits[0]).toBe('Email the café landlord');
    expect(hits).toContain('Tiles might crack');
  });

  it('ranks finished games lower and hides archived ones unless asked', () => {
    const hits = titles('tiling');
    expect(hits.indexOf('Old tiling')).toBeGreaterThan(hits.indexOf('Tiling'));
    expect(hits).not.toContain('Tiling shelf');
    expect(titles('tiling', { archived: true })).toContain('Tiling shelf');
  });

  it('filters by type and status, combined with text', () => {
    expect(titles('', { types: ['decision'] })).toEqual(['Pick a grout colour']);
    expect(titles('', { statuses: ['done'] })).toEqual(['Email the café landlord']);
    expect(titles('tiling', { types: ['task'], statuses: ['doing'] })).toEqual(['Get the tiling quote']);
    expect(titles('', { types: ['risk'] })).toEqual(['Tiles might crack']);
  });

  it('filters blocking, overdue and over-budget', () => {
    expect(titles('', { blocking: true })).toEqual(['Get the tiling quote', 'Pick a grout colour', 'Landlord says yes']);
    expect(titles('', { overdue: true, types: ['decision'] })).toEqual(['Pick a grout colour']);
    // Overspending rolls up: the level and world are over too.
    expect(titles('', { overBudget: true })).toEqual(['W', 'Tiling', 'Get the tiling quote']);
  });

  it('returns nothing for an empty query with no filters, and respects the limit', () => {
    expect(titles('')).toEqual([]);
    expect(search(buildSearchIndex(ws(), NOW), 't', {}, 2)).toHaveLength(2);
  });
});

describe('filterItems', () => {
  it('filters a level list with the same rules, and leaves it alone with no filters', () => {
    const items = kitchen().items;
    expect(filterItems(items, {})).toBe(items);
    expect(filterItems(items, { types: ['decision', 'stretch'] }).map((i) => i.id)).toEqual(['grout', 'shiny']);
    expect(filterItems(items, { overBudget: true }, { currency: 'GBP', alerts: true, alertAt: 90 }).map((i) => i.id)).toEqual(['quote']);
  });
});

describe('snippet', () => {
  it('cuts text around the first matching word', () => {
    expect(snippet('Ask Dave and the shop on Mill Road for a price', 'mill', 20)).toBe('…shop on Mill Road fo…');
    expect(snippet('short', 'nope')).toBeUndefined();
  });
});
