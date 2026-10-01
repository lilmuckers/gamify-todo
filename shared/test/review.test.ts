import { describe, expect, it } from 'vitest';
import {
  applyOp,
  dropOptionalOps,
  inverseOp,
  isReviewDue,
  lastActivity,
  lastReviewSlot,
  makeOp,
  replay,
  scoreLevel,
  todayList,
  weeklyReview,
  type GameState,
  type Level,
  type OpBody,
  type Workspace,
} from '../src';
import { at, level, lvlOf, workspace } from './fixtures';

const ref = { ...at, projectTitle: 'T', worldName: 'W', levelName: 'Level', code: '1-1' };

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-01T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function project(id: string, levels: Level[]): GameState {
  return {
    overworld: { id, title: id.toUpperCase(), goals: [{ id: 'g', title: 'G' }], worldOrder: ['w'] },
    worlds: { w: { id: 'w', name: 'W', theme: 'grass', goalIds: ['g'], levels } },
  };
}
const ws = (...projects: GameState[]): Workspace => ({ projects: Object.fromEntries(projects.map((p) => [p.overworld.id, p])) });
const cleared = (o: Partial<Level>) =>
  level({ successCriteria: [{ id: 'mvp-1', text: 'Works', mvp: true, done: true }], ...o });

describe('weeklyReview', () => {
  const data = ws(
    project('house', [
      cleared({ id: 'shipped', name: 'Shipped', startedAt: ago(5), clearedAt: ago(2), timeboxDays: 10 }),
      cleared({ id: 'old-win', name: 'Old win', startedAt: ago(30), clearedAt: ago(20) }),
      level({
        id: 'late',
        name: 'Late',
        startedAt: ago(12),
        timeboxDays: 10,
        items: [
          { id: 'a', type: 'task', title: 'A', status: 'done', doneAt: ago(1) },
          { id: 'opt', type: 'task', title: 'Optional', status: 'todo', mvp: false },
          { id: 'shine', type: 'stretch', title: 'Shine', status: 'doing' },
          { id: 'cut', type: 'stretch', title: 'Cut', status: 'dropped' },
          { id: 'old', type: 'task', title: 'Old', status: 'done', doneAt: ago(9) },
          { id: 'dep', type: 'dependency', title: 'Dep', status: 'todo', subtasks: [{ id: 's', type: 'task', title: 'Step', status: 'done', doneAt: ago(3) }] },
        ],
      }),
      level({ id: 'stale', name: 'Stale', startedAt: ago(40), timeboxDays: 60, items: [{ id: 'x', type: 'task', title: 'X', status: 'done', doneAt: ago(15) }] }),
      level({ id: 'busy', name: 'Busy', startedAt: ago(40), timeboxDays: 60, items: [{ id: 'y', type: 'task', title: 'Y', status: 'done', doneAt: ago(13) }] }),
      level({ id: 'parked', name: 'Parked', someday: true, timeboxDays: 1 }),
      level({ id: 'fresh', name: 'Fresh' }),
    ]),
  );
  const r = weeklyReview(data, NOW);

  it('lists levels cleared and items (and steps) done in the last 7 days, newest first', () => {
    expect(r.shipped.levels.map((l) => l.levelId)).toEqual(['shipped']);
    expect(r.shipped.levels[0].stars).toBeGreaterThan(0);
    expect(r.shipped.xp).toBe(r.shipped.levels[0].xp);
    expect(r.shipped.items.map((i) => [i.item.id, i.subId])).toEqual([
      ['a', undefined],
      ['s', 'dep'],
    ]);
    expect(r.since).toBe(ago(7));
  });

  it('lists overdue levels with their optional leftovers', () => {
    expect(r.overdue.map((l) => l.levelId)).toEqual(['late']);
    expect(r.overdue[0].overdueMs).toBe(2 * DAY);
    expect(r.overdue[0].optional.map((i) => i.id)).toEqual(['opt', 'shine']);
    expect(r.overdue[0].idleDays).toBeUndefined();
  });

  it('lists started levels idle for 14+ days as stale, skipping someday and unstarted ones', () => {
    expect(r.stale.map((l) => [l.levelId, l.idleDays])).toEqual([['stale', 15]]);
  });

  it('offers started levels and each idle project’s next level as focus candidates', () => {
    expect(r.candidates.map((c) => c.levelId)).toEqual(['late', 'stale', 'busy']);
    const r2 = weeklyReview(ws(project('a', [level({ id: 'one' })])), NOW);
    expect(r2.candidates).toMatchObject([{ levelId: 'one', suggested: true }]);
  });

  it('flags an overdue level as stale too, rather than listing it twice', () => {
    const late = weeklyReview(ws(project('p', [level({ id: 'l', startedAt: ago(30), timeboxDays: 5 })])), NOW);
    expect(late.stale).toEqual([]);
    expect(late.overdue[0].idleDays).toBe(30);
  });
});

describe('lastActivity', () => {
  it('is the latest of start, clear and done stamps', () => {
    expect(lastActivity(level())).toBeUndefined();
    expect(lastActivity(level({ startedAt: ago(9), items: [{ id: 'a', type: 'task', title: 'A', status: 'done', doneAt: ago(2) }] }))).toBe(NOW - 2 * DAY);
  });
});

describe('scope cuts', () => {
  it('drops every optional item in one batch', () => {
    const lvl = level({ items: [...level().items, { id: 'o', type: 'risk', title: 'O', status: 'doing', mvp: false }] });
    const ops = dropOptionalOps(ref, lvl);
    expect(ops.map((o) => (o as { itemId: string }).itemId)).toEqual(['c', 'o']);
    const after = replay(workspace(lvl), ops.map((o) => makeOp(o)));
    expect(after.conflicts).toEqual([]);
    expect(lvlOf(after.state).items.filter((i) => i.status === 'dropped').map((i) => i.id)).toEqual(['c', 'o']);
  });

  it('extending a started time-box quiets the clock but scores against the original', () => {
    const lvl = level({ startedAt: ago(12), timeboxDays: 10 });
    const ext = applyOp(workspace(lvl), makeOp({ kind: 'extendTimebox', ...at, days: 5 }, new Date(NOW)));
    const l = lvlOf(ext);
    expect(l.timeboxDays).toBe(15);
    expect(l.stats?.timeboxExtendedDays).toBe(5);
    const done = applyOp(ext, makeOp({ kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: true }, new Date(NOW)));
    const s = scoreLevel(lvlOf(done), NOW);
    expect(s.timer.phase).toBe('cleared');
    expect(s.starReasons.inTime).toBe(false);
    expect(s.extendedDays).toBe(5);
  });

  it('extending before the level starts is just planning, and stops at 90 days', () => {
    const l = lvlOf(applyOp(workspace(level({ timeboxDays: 88 })), makeOp({ kind: 'extendTimebox', ...at, days: 7 })));
    expect(l.timeboxDays).toBe(90);
    expect(l.stats).toBeUndefined();
    expect(() => applyOp(workspace(l), makeOp({ kind: 'extendTimebox', ...at, days: 1 }))).toThrow(/maximum/);
  });

  it('someday parks a level, clears its start and comes back with progress', () => {
    const lvl = level({ startedAt: ago(30), items: [{ id: 'a', type: 'task', title: 'A', status: 'done', doneAt: ago(20) }, ...level().items.slice(1)] });
    const parked = applyOp(workspace(lvl), makeOp({ kind: 'setSomeday', ...at, someday: true }));
    expect(lvlOf(parked)).toMatchObject({ someday: true });
    expect(lvlOf(parked).startedAt).toBeUndefined();
    expect(todayList(parked, NOW).next).toEqual([]);
    // Editing a title isn't progress; starting work is.
    const edited = applyOp(parked, makeOp({ kind: 'updateItem', ...at, itemId: 'b', patch: { title: 'B2' } }));
    expect(lvlOf(edited).someday).toBe(true);
    const back = applyOp(edited, makeOp({ kind: 'setItemStatus', ...at, itemId: 'b', status: 'doing' }, new Date(NOW)));
    expect(lvlOf(back).someday).toBeUndefined();
    expect(lvlOf(back).startedAt).toBe(new Date(NOW).toISOString());
  });

  it("a cleared level can't be parked", () => {
    expect(() => applyOp(workspace(cleared({})), makeOp({ kind: 'setSomeday', ...at, someday: true }))).toThrow(/cleared/);
  });
});

describe('doneAt', () => {
  const set = (ws: Workspace, body: Partial<OpBody>, when: number) => applyOp(ws, makeOp({ ...at, ...body } as OpBody, new Date(when)));

  it('is stamped when an item or step becomes done and removed when it is reopened', () => {
    let w = set(workspace(), { kind: 'setItemStatus', itemId: 'a', status: 'done' }, NOW);
    expect(lvlOf(w).items[0].doneAt).toBe(new Date(NOW).toISOString());
    // Done again: keeps the first stamp.
    w = set(w, { kind: 'updateItem', itemId: 'a', patch: { status: 'done' } }, NOW + DAY);
    expect(lvlOf(w).items[0].doneAt).toBe(new Date(NOW).toISOString());
    w = set(w, { kind: 'setItemStatus', itemId: 'a', status: 'todo' }, NOW);
    expect(lvlOf(w).items[0].doneAt).toBeUndefined();

    const dep = level({ items: [{ id: 'd', type: 'dependency', title: 'D', status: 'todo', subtasks: [{ id: 's', type: 'task', title: 'S', status: 'todo' }] }] });
    const steps = set(workspace(dep), { kind: 'setItemStatus', parentId: 'd', itemId: 's', status: 'done' } as Partial<OpBody>, NOW);
    expect(lvlOf(steps).items[0].subtasks?.[0].doneAt).toBe(new Date(NOW).toISOString());
  });

  it('undoing a reopen puts the original stamp back', () => {
    const done = workspace(level({ items: [{ id: 'a', type: 'task', title: 'A', status: 'done', doneAt: ago(3) }] }));
    const body = { kind: 'setItemStatus', ...at, itemId: 'a', status: 'todo' } as OpBody;
    const reopened = applyOp(done, makeOp(body));
    const back = applyOp(reopened, makeOp(inverseOp(body, done)!, new Date(NOW)));
    expect(lvlOf(back).items[0].doneAt).toBe(ago(3));
  });
});

describe('isReviewDue', () => {
  // Thursday 1 Oct 2026, local time.
  const thu = new Date(2026, 9, 1, 12).getTime();
  const fri3pm = new Date(2026, 9, 2, 15).getTime();

  it('finds the most recent slot', () => {
    expect(new Date(lastReviewSlot('fri', thu)!)).toEqual(new Date(2026, 8, 25, 14));
    expect(new Date(lastReviewSlot('fri', fri3pm)!)).toEqual(new Date(2026, 9, 2, 14));
    expect(new Date(lastReviewSlot('mon', thu)!)).toEqual(new Date(2026, 8, 28, 9));
    expect(lastReviewSlot('off', thu)).toBeUndefined();
  });

  it('is due once a slot passes after the last review, and never when off', () => {
    const wed = new Date(2026, 8, 30, 10).toISOString();
    expect(isReviewDue('fri', wed, thu)).toBe(false);
    expect(isReviewDue('fri', wed, fri3pm)).toBe(true);
    expect(isReviewDue('fri', new Date(fri3pm).toISOString(), fri3pm + 1000)).toBe(false);
    expect(isReviewDue('fri', undefined, thu)).toBe(true);
    expect(isReviewDue('off', undefined, thu)).toBe(false);
  });
});

describe('todayList focus', () => {
  it('lists focus levels and puts their items first', () => {
    const data = ws(
      project('a', [level({ id: 'urgent', startedAt: ago(9), timeboxDays: 10 })]),
      project('b', [level({ id: 'calm', startedAt: ago(1), timeboxDays: 30 })]),
    );
    expect(todayList(data, NOW).next.map((n) => n.levelId)).toEqual(['urgent', 'calm']);
    const t = todayList(data, NOW, ['b/w/calm']);
    expect(t.focus.map((f) => f.levelId)).toEqual(['calm']);
    expect(t.next.map((n) => [n.levelId, !!n.focus])).toEqual([
      ['calm', true],
      ['urgent', false],
    ]);
  });
});
