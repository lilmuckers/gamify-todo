import { describe, expect, it } from 'vitest';
import {
  addUnits,
  applyOp,
  dueView,
  effectiveStatus,
  inverseOp,
  isMvpItem,
  itemCost,
  makeOp,
  nextDue,
  polishPoints,
  repeatSummary,
  stampEvents,
  todayList,
  validateWorkspace,
  weeklyReview,
  type Item,
  type OpBody,
  type Workspace,
} from '../src';
import { at, level, lvlOf, workspace } from './fixtures';

const chore = (over: Partial<Item> = {}): Item => ({
  id: 'r',
  type: 'task',
  title: 'Test the smoke alarms',
  status: 'done',
  doneAt: '2026-04-03T10:00:00Z',
  repeat: { every: 6, unit: 'months' },
  completions: [{ on: '2026-04-03' }],
  ...over,
});

const withChore = (over: Partial<Item> = {}, lvl: Parameters<typeof level>[0] = {}) =>
  workspace(level({ items: [{ id: 'a', type: 'task', title: 'A', status: 'todo' }, chore(over)], ...lvl }));
const choreOf = (ws: Workspace) => lvlOf(ws).items.find((i) => i.id === 'r')!;
const apply = (ws: Workspace, body: OpBody, now = new Date('2026-10-05T09:00:00Z')) => applyOp(ws, makeOp(body, now));

describe('addUnits', () => {
  it('adds days and weeks across month and year ends', () => {
    expect(addUnits('2026-01-30', 3, 'days')).toBe('2026-02-02');
    expect(addUnits('2026-12-29', 1, 'weeks')).toBe('2027-01-05');
  });

  it('clamps months to the end of a shorter month without drifting', () => {
    expect(addUnits('2026-01-31', 1, 'months')).toBe('2026-02-28');
    expect(addUnits('2028-01-31', 1, 'months')).toBe('2028-02-29');
    expect(addUnits('2026-08-31', 6, 'months')).toBe('2027-02-28');
    expect(addUnits('2026-11-15', 3, 'months')).toBe('2027-02-15');
  });

  it('handles 29 February in leap and common years', () => {
    expect(addUnits('2028-02-29', 1, 'years')).toBe('2029-02-28');
    expect(addUnits('2028-02-29', 4, 'years')).toBe('2032-02-29');
  });
});

describe('nextDue', () => {
  it('counts from the last time it was done by default', () => {
    expect(nextDue(chore())).toBe('2026-10-03');
    expect(nextDue(chore({ completions: [{ on: '2026-04-03' }, { on: '2026-05-20' }] }))).toBe('2026-11-20');
  });

  it('falls back to doneAt for hand-written data without completions', () => {
    expect(nextDue(chore({ completions: undefined, doneAt: '2026-04-03T10:00:00Z' }))).toBe('2026-10-03');
  });

  it('is undefined when it has never been done and has no start', () => {
    expect(nextDue(chore({ status: 'todo', doneAt: undefined, completions: undefined }))).toBeUndefined();
    expect(nextDue({ id: 'x', type: 'task', title: 'X', status: 'done' })).toBeUndefined();
  });

  it('keeps a fixed schedule however late it was done, a completion covering its period', () => {
    const fixed = (on: string[], start?: string) =>
      nextDue(chore({ repeat: { every: 3, unit: 'months', from: 'fixed', ...(start ? { start } : {}) }, completions: on.map((d) => ({ on: d })) }));
    expect(fixed(['2026-01-31'])).toBe('2026-04-30');
    // Done late in the April period: the next one is still July.
    expect(fixed(['2026-01-31', '2026-06-20'])).toBe('2026-07-31');
    expect(fixed(['2026-02-10'], '2026-01-01')).toBe('2026-04-01');
    expect(fixed([], '2026-11-01')).toBe('2026-11-01');
  });
});

describe('effectiveStatus and dueView', () => {
  it('shows a done chore as to do once the next one is due', () => {
    expect(effectiveStatus(chore(), '2026-10-02')).toBe('done');
    expect(effectiveStatus(chore(), '2026-10-03')).toBe('todo');
    expect(effectiveStatus(chore({ status: 'dropped' }), '2027-01-01')).toBe('dropped');
  });

  it('changes only what is due, keeping everything else by reference', () => {
    const ws = withChore();
    expect(dueView(ws, '2026-10-01')).toBe(ws);
    const view = dueView(ws, '2026-10-05');
    expect(choreOf(view).status).toBe('todo');
    expect(choreOf(ws).status).toBe('done');
    expect(lvlOf(view).items[0]).toBe(lvlOf(ws).items[0]);
    expect(dueView(ws, '2026-10-05')).toBe(view);
  });

  it('keeps an untouched level identical across edits elsewhere', () => {
    const ws: Workspace = { projects: { ...withChore().projects, q: { ...withChore().projects.p, overworld: { ...withChore().projects.p.overworld, id: 'q' } } } };
    const before = dueView(ws, '2026-10-05');
    const after = dueView(apply(ws, { kind: 'setItemStatus', projectId: 'q', worldId: 'w', levelId: 'lvl', itemId: 'a', status: 'doing' }), '2026-10-05');
    expect(after.projects.p).toBe(before.projects.p);
  });

  it('sums it up for the bubble', () => {
    expect(repeatSummary(chore(), '2026-06-01')).toBe('↻ every 6 months · next due 3 Oct');
    expect(repeatSummary(chore(), '2026-10-03')).toBe('↻ every 6 months · due today');
    expect(repeatSummary(chore(), '2026-10-20')).toBe('↻ every 6 months · due since 3 Oct');
    expect(repeatSummary(chore({ repeat: { every: 1, unit: 'weeks' }, completions: [], status: 'todo', doneAt: undefined }))).toBe('↻ every week · not done yet');
  });

  it('never puts a chore on the critical path', () => {
    expect(isMvpItem(chore({ mvp: true }))).toBe(false);
  });
});

describe('doing a chore again', () => {
  const done: OpBody = { kind: 'setItemStatus', ...at, itemId: 'r', status: 'done', on: '2026-10-05' };

  it('logs a completion and stamps doneAt afresh, though the file already said done', () => {
    const after = choreOf(apply(withChore(), done));
    expect(after.status).toBe('done');
    expect(after.doneAt).toBe('2026-10-05T09:00:00.000Z');
    expect(after.completions).toEqual([{ on: '2026-04-03' }, { on: '2026-10-05' }]);
    expect(nextDue(after)).toBe('2027-04-05');
  });

  it('takes the local day from when the edit was made', () => {
    const op = makeOp({ kind: 'setItemStatus', ...at, itemId: 'r', status: 'done' }, new Date(2026, 9, 5, 23, 30));
    expect(op.kind === 'setItemStatus' && op.on).toBe('2026-10-05');
  });

  it('merges a second tick on the same day and moves spent into the entry', () => {
    let ws = apply(withChore({ spent: 10 }), done);
    expect(choreOf(ws).completions!.at(-1)).toEqual({ on: '2026-10-05', spent: 10 });
    expect(choreOf(ws).spent).toBeUndefined();
    ws = apply(ws, { kind: 'updateItem', ...at, itemId: 'r', patch: { spent: 2.5 } });
    ws = apply(ws, done);
    expect(choreOf(ws).completions).toEqual([{ on: '2026-04-03' }, { on: '2026-10-05', spent: 12.5 }]);
  });

  it('logs one from the item form too, when the chore was due again', () => {
    const due = apply(withChore(), { kind: 'updateItem', ...at, itemId: 'r', patch: { status: 'done', title: 'Test all alarms' }, on: '2026-10-05' });
    expect(choreOf(due).completions).toHaveLength(2);
    const notDue = apply(withChore(), { kind: 'updateItem', ...at, itemId: 'r', patch: { status: 'done' }, on: '2026-06-01' });
    expect(choreOf(notDue).completions).toHaveLength(1);
  });

  it('is upkeep, not polish, even in a cleared level, as are edits to chores', () => {
    const cleared = { successCriteria: [{ id: 'm', text: 'M', mvp: true, done: true }], clearedAt: '2026-04-04T00:00:00Z' };
    const ws = withChore({}, cleared);
    let next = apply(ws, done);
    next = apply(next, { kind: 'setItemStatus', ...at, itemId: 'r', status: 'doing' });
    next = apply(next, done);
    next = apply(next, { kind: 'updateItem', ...at, itemId: 'r', patch: { repeat: { every: 3, unit: 'months' }, title: 'Test the alarms' } });
    next = apply(next, { kind: 'addItem', ...at, item: chore({ id: 'gutters', title: 'Clear the gutters', status: 'todo', completions: undefined, doneAt: undefined }) });
    expect(polishPoints(lvlOf(next))).toBe(0);
    // Anything else after the clear still counts.
    expect(polishPoints(lvlOf(apply(next, { kind: 'updateItem', ...at, itemId: 'a', patch: { title: 'Polished' } })))).toBe(1);
    expect(lvlOf(next).clearedAt).toBe(lvlOf(ws).clearedAt);
  });

  it('undoes back to the old log and spend', () => {
    const ws = withChore({ spent: 10 });
    for (const body of [done, { kind: 'updateItem', ...at, itemId: 'r', patch: { status: 'done' }, on: '2026-10-05' }] as OpBody[]) {
      const after = apply(ws, body);
      const back = apply(after, inverseOp(body, ws)!);
      expect(choreOf(back)).toEqual(choreOf(ws));
    }
  });
});

describe('chores in stats, the review, money and Today', () => {
  const ws = withChore({
    doneAt: '2026-10-01T18:00:00Z',
    repeat: { every: 1, unit: 'weeks' },
    completions: [{ on: '2026-09-17', spent: 4 }, { on: '2026-09-24', spent: 7 }, { on: '2026-10-01' }],
    budget: 5,
  });

  it('counts every completion as progress', () => {
    const done = stampEvents(ws).filter((e) => e.subject === 'Test the smoke alarms');
    expect(done).toHaveLength(3);
    expect(done.at(-1)!.at).toBe(Date.parse('2026-10-01T18:00:00Z'));
  });

  it('ships each completion in the week it happened', () => {
    const shipped = (now: string) => weeklyReview(ws, Date.parse(now)).shipped.items.filter((i) => i.item.id === 'r').map((i) => i.doneAt);
    expect(shipped('2026-10-02T12:00:00Z')).toEqual(['2026-10-01T18:00:00.000Z']);
    expect(shipped('2026-09-25T12:00:00Z')).toEqual([new Date(2026, 8, 24).toISOString()]);
  });

  it('budgets per occurrence, banking each one', () => {
    const c = itemCost(choreOf(ws));
    expect(c).toMatchObject({ budget: 15, spent: 11, saved: 4, settled: true });
    const due = itemCost(choreOf(dueView(ws, '2026-10-08')));
    expect(due).toMatchObject({ budget: 20, spent: 11, settled: false });
  });

  it('lists chores that have come round, even in a cleared level', () => {
    const cleared = withChore({}, { successCriteria: [{ id: 'm', text: 'M', mvp: true, done: true }], startedAt: '2026-04-01T00:00:00Z' });
    expect(todayList(dueView(cleared, '2026-06-01')).chores).toEqual([]);
    const t = todayList(dueView(cleared, '2026-10-05'));
    expect(t.chores.map((c) => [c.item.id, c.due])).toEqual([['r', '2026-10-03']]);
  });
});

describe('validation', () => {
  it('rejects repeating dependencies and out-of-order completions', () => {
    const bad = workspace(
      level({
        items: [chore({ id: 'd', type: 'dependency' }), chore({ id: 'e', completions: [{ on: '2026-05-01' }, { on: '2026-05-01' }] })],
      }),
    );
    expect(validateWorkspace(bad).map((i) => `${i.path} ${i.message}`)).toEqual([
      '/items/0/repeat dependency items cannot repeat',
      '/items/1/completions completions must be in date order, one per day',
    ]);
    expect(validateWorkspace(withChore())).toEqual([]);
  });

  it('checks the rule and the days against the schema', () => {
    const bad = workspace(level({ items: [chore({ repeat: { every: 0, unit: 'months' }, completions: [{ on: '2026-13-01' }] })] }));
    expect(validateWorkspace(bad).map((i) => i.path)).toEqual(expect.arrayContaining(['/items/0/repeat/every', '/items/0/completions/0/on']));
  });
});
