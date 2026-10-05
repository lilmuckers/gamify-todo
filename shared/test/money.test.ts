import { describe, expect, it } from 'vitest';
import { changesFromCommit, fromFiles, moneyStats, type ChangeEvent, type GameState, type Level, type Workspace } from '../src';
import { level } from './fixtures';

const local = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h).getTime();
const iso = (m: number, d: number, h = 12) => new Date(local(m, d, h)).toISOString();
const NOW = local(10, 5, 18);

function project(id: string, levels: Level[], budgets = true, currency?: string): GameState {
  return {
    overworld: { id, title: id.toUpperCase(), goals: [{ id: 'g', title: 'G' }], worldOrder: ['w'], ...(budgets ? { budgets: currency ? { currency } : {} } : {}) },
    worlds: { w: { id: 'w', name: 'W', theme: 'grass', goalIds: ['g'], levels } },
  };
}
const ws = (...ps: GameState[]): Workspace => ({ projects: Object.fromEntries(ps.map((p) => [p.overworld.id, p])) });

describe('money in the history scan', () => {
  const before = level({ startedAt: iso(9, 1), items: [{ id: 'a', type: 'task', title: 'A', status: 'done', doneAt: iso(9, 2), budget: 50 }] });
  const commit = (after: Level) => ({ sha: 's', date: iso(9, 3), message: '', files: [{ path: 'data/p/w/lvl.json', before: JSON.stringify(before), after: JSON.stringify(after) }] });

  it('sees costs logged and budgets changed, and doesn’t count them as edits', () => {
    const receipt = { ...before, items: [{ ...before.items[0], spent: 42.5 }] };
    expect(changesFromCommit(commit(receipt)).map((e) => [e.kind, e.subject, e.amount])).toEqual([['spent', 'A', 42.5]]);
    const rebudget = { ...before, budget: 300, items: [{ ...before.items[0], budget: 60, notes: 'new' }] };
    expect(changesFromCommit(commit(rebudget)).map((e) => [e.kind, e.subject, e.amount])).toEqual([
      ['budgeted', '', 300],
      ['budgeted', 'A', 10],
      ['edited', 'A', undefined],
    ]);
  });
});

describe('moneyStats', () => {
  const data = ws(
    project('house', [
      level({
        id: 'roof',
        name: 'Roof',
        startedAt: iso(9, 1),
        clearedAt: iso(9, 20),
        successCriteria: [{ id: 'm', text: 'M', mvp: true, done: true, doneAt: iso(9, 20) }],
        items: [
          { id: 'slates', type: 'task', title: 'Slates', status: 'done', doneAt: iso(9, 10), budget: 250, spent: 180 },
          { id: 'flashing', type: 'task', title: 'Flashing', status: 'done', doneAt: iso(9, 15), budget: 200, spent: 310 },
          { id: 'guards', type: 'stretch', title: 'Guards', status: 'dropped', budget: 45 },
        ],
      }),
      level({ id: 'eicr', name: 'EICR', startedAt: iso(10, 1), items: [{ id: 'book', type: 'task', title: 'Book', status: 'doing', budget: 180, spent: 60 }] }),
    ]),
    project('move', [level({ id: 'van', name: 'Van', budget: 400, startedAt: iso(4, 1), clearedAt: iso(4, 2), successCriteria: [{ id: 'm', text: 'M', mvp: true, done: true }], items: [{ id: 'v', type: 'task', title: 'Van', status: 'done', doneAt: iso(4, 1), spent: 350 }] })]),
    project('free', [level({ items: [{ id: 'x', type: 'task', title: 'X', status: 'done', spent: 999 }] })], false),
    project('euro', [level({ items: [{ id: 'y', type: 'task', title: 'Y', status: 'done', spent: 5 }] })], true, 'EUR'),
  );

  it('adds up projects that track money, in one currency', () => {
    const m = moneyStats(data, { now: NOW })!;
    expect(m.currency).toBe('GBP');
    expect(m.otherCurrencies).toEqual(['EUR']);
    expect(m.projects.map((p) => p.id)).toEqual(['house', 'move']);
    expect(m.spent).toBe(180 + 310 + 60 + 350);
    expect(m.budget).toBe(250 + 200 + 45 + 180 + 400);
    // Settled with their own budget: slates (under), flashing (over) and the van level (under).
    expect([m.settled, m.onBudget]).toEqual([3, 2]);
    expect(m.overruns[0]).toMatchObject({ title: 'Flashing', over: 110 });
    expect(m.savings.map((s) => [s.title, s.saved, s.dropped])).toEqual([
      ['Slates', 70, false],
      ['Van', 50, false],
      ['Guards', 45, true],
    ]);
  });

  it('dates spending by when it was finished, or by the history when there is one', () => {
    const m = moneyStats(data, { now: NOW })!;
    const month = (d: string) => m.months.find((w) => w.month === d)!;
    // From the first month money went out (the van, in April) to this one.
    expect(m.months[0].month).toBe('2026-04');
    expect(m.months.at(-1)!.month).toBe('2026-10');
    expect(month('2026-04').spent).toBe(350);
    expect(month('2026-09').spent).toBe(490);
    expect(m.months.at(-1)!.total).toBe(m.spent);
    expect(m.fromHistory).toBe(false);
    // Budgets of finished things, as they finished: the line spending is measured against.
    expect(month('2026-09').planned).toBeGreaterThanOrEqual(400 + 450);
    expect(moneyStats(data, { now: NOW, months: 3 })!.months.map((x) => x.month)).toEqual(['2026-08', '2026-09', '2026-10']);

    // The history says the flashing was paid in two parts, a week apart.
    const deep: ChangeEvent[] = [
      { at: iso(9, 15), sha: 'a', kind: 'spent', level: 'house/w/roof', subject: 'Flashing', amount: 200 },
      { at: iso(9, 22), sha: 'b', kind: 'spent', level: 'house/w/roof', subject: 'Flashing', amount: 110 },
      { at: iso(10, 2), sha: 'b2', kind: 'spent', level: 'house/w/roof', subject: 'Slates', amount: 180 },
    ];
    const h = moneyStats(data, { now: NOW, deep })!;
    expect(h.fromHistory).toBe(true);
    expect(h.months.find((w) => w.month === '2026-09')!.spent).toBe(200 + 110);
    // The slates were paid in October, not when they were done.
    expect(h.months.find((w) => w.month === '2026-10')!.spent).toBe(180 + 60);
    expect(h.months.at(-1)!.total).toBe(h.spent);
  });

  it('is undefined when nothing tracks money', () => {
    expect(moneyStats(ws(project('free', [level()], false)), { now: NOW })).toBeUndefined();
  });

  it('covers the example projects', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(__dirname, '../..');
    const files: Record<string, string> = {};
    const walk = (dir: string) => {
      for (const f of readdirSync(join(root, dir))) {
        const rel = `${dir}/${f}`;
        if (statSync(join(root, rel)).isDirectory()) walk(rel);
        else if (f.endsWith('.json')) files[rel] = readFileSync(join(root, rel), 'utf8');
      }
    };
    walk('data');
    const m = moneyStats(fromFiles(files), { now: Date.parse('2026-10-05T17:00:00Z') })!;
    expect(m.projects.map((p) => p.id).sort()).toEqual(['allotment-2025', 'bike-restoration', 'home-maintenance', 'kitchen-renovation', 'moving-flat', 'sourdough']);
    expect(m.overruns.length).toBeGreaterThan(2);
    expect(m.savings.some((s) => s.dropped)).toBe(true);
    expect(m.onBudget).toBeLessThan(m.settled);
    // Moving Flat kept to its goal of under £2,500.
    expect(m.projects.find((p) => p.id === 'moving-flat')!.spent).toBeLessThan(2500);
  });
});
