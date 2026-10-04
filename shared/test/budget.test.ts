import { describe, expect, it } from 'vitest';
import {
  alertLevel,
  alertText,
  applyOp,
  budgetAlerts,
  budgetPrefs,
  costLabel,
  costNote,
  currencySymbol,
  savedLabel,
  formatMoney,
  itemCost,
  levelCost,
  makeOp,
  projectCost,
  validateFiles,
  validateWorkspace,
  toFiles,
  worldCost,
  type Item,
  type Level,
} from '../src/index';
import { at, level, lvlOf, state, workspace } from './fixtures';

const task = (id: string, extra: Partial<Item> = {}): Item => ({ id, type: 'task', title: id, status: 'todo', ...extra });
const cleared = (lvl: Level): Level => ({ ...lvl, successCriteria: lvl.successCriteria.map((c) => ({ ...c, done: c.mvp || c.done })) });

describe('itemCost', () => {
  it('is empty without money', () => {
    expect(itemCost(task('a'))).toMatchObject({ budgeted: false, budget: 0, spent: 0, saved: 0 });
  });

  it('banks savings only once the item is done or dropped', () => {
    expect(itemCost(task('a', { budget: 50, spent: 40 }))).toMatchObject({ budget: 50, spent: 40, left: 10, saved: 0 });
    expect(itemCost(task('a', { budget: 50, spent: 40, status: 'done' })).saved).toBe(10);
    // Dropping it banks whatever wasn't spent: scope cuts save money.
    expect(itemCost(task('a', { budget: 50, status: 'dropped' })).saved).toBe(50);
    // Going over shows as negative savings.
    expect(itemCost(task('a', { budget: 50, spent: 65, status: 'done' })).saved).toBe(-15);
  });

  it("adds up a dependency's steps unless it sets its own budget", () => {
    const dep: Item = {
      id: 'dep',
      type: 'dependency',
      title: 'Dep',
      status: 'todo',
      spent: 5,
      subtasks: [
        { id: 's1', type: 'task', title: 'S1', status: 'done', budget: 30, spent: 20 },
        { id: 's2', type: 'task', title: 'S2', status: 'todo', budget: 70 },
      ],
    };
    expect(itemCost(dep)).toMatchObject({ budgeted: true, capped: false, budget: 100, spent: 25, saved: 10 });
    expect(itemCost({ ...dep, budget: 80 })).toMatchObject({ capped: true, budget: 80, planned: 100, left: 55 });
    expect(itemCost({ ...dep, budget: 80, status: 'done' }).saved).toBe(55);
  });

  it('rounds to pennies', () => {
    const c = levelCost(level({ items: [task('a', { spent: 0.1 }), task('b', { spent: 0.2 })] }));
    expect(c.spent).toBe(0.3);
  });
});

describe('levelCost and worldCost', () => {
  const items = [task('a', { budget: 100, spent: 80, status: 'done' }), task('b', { budget: 200, spent: 50 }), task('c', { spent: 10 })];

  it('sums items until the level clears, then banks what is left', () => {
    const lvl = level({ items });
    expect(levelCost(lvl)).toMatchObject({ budget: 300, spent: 140, left: 160, saved: 20 });
    expect(levelCost(cleared(lvl)).saved).toBe(160);
  });

  it('uses its own budget as the allowance', () => {
    const c = levelCost(level({ items, budget: 250 }));
    expect(c).toMatchObject({ capped: true, budget: 250, planned: 300, left: 110 });
    expect(costNote(c)?.tone).toBe('warn');
  });

  it('rolls levels up into worlds and projects', () => {
    const s = state(level({ items }));
    s.worlds.w.levels.push(level({ id: 'two', items: [], budget: 1000 }));
    expect(worldCost(s.worlds.w)).toMatchObject({ budget: 1300, spent: 140, saved: 20 });
    s.worlds.w.budget = 1200;
    expect(worldCost(s.worlds.w)).toMatchObject({ budget: 1200, planned: 1300 });
    expect(projectCost(s)).toMatchObject({ budget: 1200, spent: 140, saved: 20 });
  });
});

describe('costNote', () => {
  it('warns when over budget, and stays quiet otherwise', () => {
    expect(costNote(levelCost(level({ items: [task('a', { budget: 10, spent: 12.5 })] })))).toEqual({
      tone: 'alert',
      text: 'Over budget by £2.50. Anything optional you could drop?',
    });
    expect(costNote(levelCost(level({ items: [task('a', { budget: 10, status: 'dropped' })] })), 'EUR')).toBeUndefined();
    expect(costNote(levelCost(level()))).toBeUndefined();
  });
});

describe('formatMoney', () => {
  it('shows pennies only when there are some', () => {
    expect(formatMoney(1200)).toBe('£1,200');
    expect(formatMoney(49.9)).toBe('£49.90');
    expect(formatMoney(5, 'USD')).toBe('US$5');
  });
});

describe('cost ops', () => {
  it('logging a cost on a done item, or a cleared level, is not polish', () => {
    let ws = applyOp(workspace(), makeOp({ kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' }));
    ws = applyOp(ws, makeOp({ kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: true }));
    const before = lvlOf(ws).stats;
    // The item form sends every field: only the changed ones count.
    const { id: _, ...a } = lvlOf(ws).items[0];
    ws = applyOp(ws, makeOp({ kind: 'updateItem', ...at, itemId: 'a', patch: { ...a, mvp: undefined, budget: 40, spent: 35 } }));
    ws = applyOp(ws, makeOp({ kind: 'updateLevel', ...at, patch: { name: 'Level', budget: 100 } }));
    expect(lvlOf(ws).stats).toEqual(before);
    expect(lvlOf(ws).items[0]).toMatchObject({ budget: 40, spent: 35 });
    expect(lvlOf(ws).budget).toBe(100);
    // Anything else alongside it still counts.
    ws = applyOp(ws, makeOp({ kind: 'updateItem', ...at, itemId: 'a', patch: { spent: 36, title: 'A!' } }));
    expect(lvlOf(ws).stats?.editsAfterClear).toBe(1);
  });

  it('removes budgets and budget settings when patched to undefined', () => {
    let ws = workspace();
    ws = applyOp(ws, makeOp({ kind: 'updateWorld', projectId: 'p', worldId: 'w', patch: { budget: 10 } }));
    ws = applyOp(ws, makeOp({ kind: 'updateProject', projectId: 'p', patch: { budgets: { currency: 'EUR' } } }));
    expect(ws.projects.p.worlds.w.budget).toBe(10);
    expect(validateWorkspace(ws)).toEqual([]);
    ws = applyOp(ws, makeOp({ kind: 'updateWorld', projectId: 'p', worldId: 'w', patch: { budget: undefined } }));
    ws = applyOp(ws, makeOp({ kind: 'updateProject', projectId: 'p', patch: { budgets: undefined } }));
    expect('budget' in ws.projects.p.worlds.w).toBe(false);
    expect('budgets' in ws.projects.p.overworld).toBe(false);
  });
});

describe('schema', () => {
  it('accepts money and rejects negative amounts, odd currency codes or alert points', () => {
    const ws = workspace(level({ budget: 99.99, items: [task('a', { budget: 10, spent: 0 })] }));
    ws.projects.p.overworld.budgets = { currency: 'EUR', alerts: false, alertAt: 75 };
    ws.projects.p.worlds.w.budget = 1000;
    expect(validateFiles(toFiles(ws))).toEqual([]);
    lvlOf(ws).items[0].spent = -1;
    ws.projects.p.overworld.budgets = { currency: 'euro', alertAt: 20 };
    const issues = validateFiles(toFiles(ws)).map((i) => `${i.file}${i.path}`);
    expect(issues).toEqual(
      expect.arrayContaining(['data/p/project.json/budgets/currency', 'data/p/project.json/budgets/alertAt', 'data/p/w/lvl.json/items/0/spent']),
    );
  });
});

describe('labels', () => {
  it('read naturally', () => {
    expect(costLabel(itemCost(task('a', { spent: 12 })))).toBe('£12 spent');
    expect(costLabel(itemCost(task('a', { budget: 40 })))).toBe('£40 budget');
    expect(costLabel(itemCost(task('a', { budget: 40, spent: 35 })))).toBe('£35 of £40');
    expect(savedLabel(itemCost(task('a', { budget: 40, spent: 35, status: 'done' })))).toBe('£5 saved');
    expect(savedLabel(itemCost(task('a', { budget: 40, spent: 45, status: 'done' })))).toBe('£5 over');
    expect(savedLabel(itemCost(task('a', { budget: 40, spent: 35 })))).toBeUndefined();
    expect(currencySymbol('EUR')).toBe('€');
  });
});

describe('budgetPrefs', () => {
  it('is off unless the project turns budgets on, with defaults filled in', () => {
    const s = state();
    expect(budgetPrefs(s)).toBeUndefined();
    s.overworld.budgets = {};
    expect(budgetPrefs(s)).toEqual({ currency: 'GBP', alerts: true, alertAt: 90 });
    s.overworld.budgets = { currency: 'EUR', alerts: false, alertAt: 75 };
    expect(budgetPrefs(s)).toEqual({ currency: 'EUR', alerts: false, alertAt: 75 });
  });
});

describe('budget alerts', () => {
  const ws0 = () => workspace(level({ budget: 1000, items: [task('a', { budget: 100, spent: 50 }), task('b', { budget: 500 })] }));
  const log = (ws: ReturnType<typeof ws0>, itemId: string, spent: number) =>
    applyOp(ws, makeOp({ kind: 'updateItem', ...at, itemId, patch: { spent } }));
  const alerts = (a: ReturnType<typeof ws0>, b: ReturnType<typeof ws0>, at = 90) =>
    budgetAlerts(a.projects.p, b.projects.p, at).map((x) => `${x.kind}:${x.title}:${x.level}`);

  it('levels: fine, heads-up while open, over', () => {
    expect(alertLevel(itemCost(task('a', { budget: 100, spent: 89 })))).toBe(0);
    expect(alertLevel(itemCost(task('a', { budget: 100, spent: 90 })))).toBe(1);
    expect(alertLevel(itemCost(task('a', { budget: 100, spent: 95, status: 'done' })))).toBe(0);
    expect(alertLevel(itemCost(task('a', { budget: 100, spent: 101, status: 'done' })))).toBe(2);
    expect(alertLevel(itemCost(task('a', { budget: 0, spent: 1 })))).toBe(2);
    expect(alertLevel(itemCost(task('a', { spent: 1000 })))).toBe(0);
    expect(alertLevel(itemCost(task('a', { budget: 100, spent: 80 })), 80)).toBe(1);
  });

  it('fire when a cost crosses a line, once', () => {
    const ws = ws0();
    const near = log(ws, 'a', 92);
    expect(alerts(ws, near)).toEqual(['item:a:1']);
    const over = log(near, 'a', 130);
    expect(alerts(near, over)).toEqual(['item:a:2']);
    // Already over: another receipt doesn't nag again.
    expect(alerts(over, log(over, 'a', 140))).toEqual([]);
  });

  it('include the level and world a cost tips over', () => {
    const ws = ws0();
    const big = log(ws, 'b', 900);
    expect(alerts(ws, big)).toEqual(['item:b:2', 'level:Level:1', 'world:W:1']);
    ws.projects.p.worlds.w.budget = 950;
    expect(alerts(ws, log(ws, 'b', 960))).toEqual(['item:b:2', 'level:Level:2', 'world:W:2']);
  });

  it('cover dependency steps, and new items added over budget', () => {
    const dep: Item = { id: 'dep', type: 'dependency', title: 'Dep', status: 'todo', subtasks: [{ id: 's', type: 'task', title: 'S', status: 'todo', budget: 10 }] };
    const ws = workspace(level({ items: [dep] }));
    const next = applyOp(ws, makeOp({ kind: 'updateItem', ...at, parentId: 'dep', itemId: 's', patch: { spent: 12 } }));
    expect(alerts(ws, next)).toEqual(['step:S:2', 'item:Dep:2', 'level:Level:2', 'world:W:2']);
    const added = applyOp(ws, makeOp({ kind: 'addItem', ...at, item: task('new', { budget: 5, spent: 5 }) }));
    expect(alerts(ws, added, 100)).toEqual(['item:new:1']);
  });

  it('say what happened', () => {
    const [over] = budgetAlerts(ws0().projects.p, log(ws0(), 'a', 130).projects.p);
    expect(alertText(over)).toBe('Over budget: a is at £130 of £100.');
    const [near] = budgetAlerts(ws0().projects.p, log(ws0(), 'a', 92.5).projects.p);
    expect(alertText(near, 'EUR')).toBe('Heads-up: a has used 92% of its €100.');
  });

  it('show as a panel note at the heads-up point', () => {
    expect(costNote(itemCost(task('a', { budget: 100, spent: 95 })), 'GBP', 90)?.text).toBe('95% of the budget spent, £5 left. Keep an eye on it.');
    expect(costNote(itemCost(task('a', { budget: 100, spent: 95 })))).toBeUndefined();
  });
});
