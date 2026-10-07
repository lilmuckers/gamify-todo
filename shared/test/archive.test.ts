import { describe, expect, it } from 'vitest';
import {
  activeProjects,
  applyOp,
  clockNow,
  describeOp,
  focusCandidates,
  levelTimer,
  makeOp,
  orderedProjects,
  shelfKind,
  subLevel,
  todayList,
  validateWorkspace,
  weeklyReview,
  type GameState,
  type Level,
  type Workspace,
} from '../src/index';
import { level } from './fixtures';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-01T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function project(id: string, title: string, levels: Level[], archivedAt?: string): GameState {
  return {
    overworld: { id, title, goals: [{ id: 'g', title: 'G' }], worldOrder: ['w'], ...(archivedAt ? { archivedAt } : {}) },
    worlds: { w: { id: 'w', name: 'W', theme: 'grass', goalIds: ['g'], levels } },
  };
}
const ws = (...ps: GameState[]): Workspace => ({ projects: Object.fromEntries(ps.map((p) => [p.overworld.id, p])) });
const cleared = () =>
  level({
    id: 'won',
    startedAt: ago(30),
    clearedAt: ago(25),
    successCriteria: [{ id: 'mvp-1', text: 'Works', mvp: true, done: true }],
  });

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

describe('shelf order', () => {
  it('puts games in play first, then finished, then archived', () => {
    const w = ws(
      project('z-done', 'Z done', [cleared()]),
      project('b-arch', 'B archived', [level()], ago(3)),
      project('a-arch-done', 'A archived', [cleared()], ago(3)),
      project('m-play', 'M play', [level()]),
    );
    expect(orderedProjects(w).map((p) => [p.overworld.id, shelfKind(p)])).toEqual([
      ['m-play', 'floor'],
      ['z-done', 'finished'],
      ['a-arch-done', 'archived'],
      ['b-arch', 'archived'],
    ]);
    expect(activeProjects(w).map((p) => p.overworld.id)).toEqual(['m-play', 'z-done']);
  });
});

describe('frozen clocks', () => {
  it('clockNow stops at archivedAt', () => {
    expect(clockNow({ id: 'p', title: 'P', goals: [], worldOrder: [] }, NOW)).toBe(NOW);
    expect(clockNow({ id: 'p', title: 'P', goals: [], worldOrder: [], archivedAt: ago(5) }, NOW)).toBe(NOW - 5 * DAY);
  });

  it('pausedDays pushes the deadline back', () => {
    const late = level({ startedAt: ago(12), timeboxDays: 10 });
    expect(levelTimer(late, NOW).phase).toBe('overdue');
    expect(levelTimer({ ...late, pausedDays: 5 }, NOW).phase).toBe('on-track');
    expect(levelTimer({ ...late, pausedDays: 5 }, NOW).remainingMs).toBe(3 * DAY);
  });

  it('sub-levels keep the parent pause', () => {
    const parent = level({ startedAt: ago(12), pausedDays: 4, items: [{ id: 'd', type: 'dependency', title: 'D', status: 'todo', subtasks: [] }] });
    expect(subLevel(parent, parent.items[0]).pausedDays).toBe(4);
  });
});

describe('setArchived', () => {
  it('stamps archivedAt with the op time, and never writes into its input', () => {
    const before = deepFreeze(ws(project('p', 'P', [level({ startedAt: ago(2) })])));
    const op = makeOp({ kind: 'setArchived', projectId: 'p', archived: true }, new Date(NOW));
    const next = applyOp(before, op);
    expect(next.projects.p.overworld.archivedAt).toBe(new Date(NOW).toISOString());
    expect(next.projects.p.worlds.w).toBe(before.projects.p.worlds.w);
    expect(validateWorkspace(next)).toEqual([]);
    expect(describeOp(op, before)).toBe('archive: P (p)');
  });

  it('credits the archived days to started, uncleared levels on unarchive', () => {
    const fresh = level({ id: 'fresh' });
    const going = level({ id: 'going', startedAt: ago(20), pausedDays: 1 });
    const done = cleared();
    const before = deepFreeze(ws(project('p', 'P', [fresh, going, done], ago(10))));
    const next = applyOp(before, makeOp({ kind: 'setArchived', projectId: 'p', archived: false }, new Date(NOW)));
    const [f, g, d] = next.projects.p.worlds.w.levels;
    expect(next.projects.p.overworld.archivedAt).toBeUndefined();
    expect(g.pausedDays).toBe(11);
    expect(f).toBe(fresh);
    expect(d).toBe(done);
    expect(validateWorkspace(next)).toEqual([]);
  });

  it('is a no-op when already in that state', () => {
    const before = ws(project('p', 'P', [level()], ago(1)));
    const next = applyOp(before, makeOp({ kind: 'setArchived', projectId: 'p', archived: true }, new Date(NOW)));
    expect(next.projects.p.overworld.archivedAt).toBe(ago(1));
  });
});

describe('archived games are out of the reports', () => {
  const late = level({ id: 'late', startedAt: ago(30), timeboxDays: 10, items: [{ id: 'a', type: 'task', title: 'A', status: 'doing' }] });
  const w = ws(project('p', 'P', [late], ago(1)), project('q', 'Q', [level({ id: 'next' })]));

  it('leaves Today alone', () => {
    const t = todayList(w, NOW);
    expect(t.overdue).toEqual([]);
    expect(t.doing).toEqual([]);
    expect(t.next.map((n) => n.projectId)).toEqual(['q']);
  });

  it('leaves the weekly review alone, but keeps what shipped', () => {
    const shipped = level({
      id: 'shipped',
      startedAt: ago(4),
      clearedAt: ago(2),
      successCriteria: [{ id: 'mvp-1', text: 'Works', mvp: true, done: true, doneAt: ago(2) }],
    });
    const r = weeklyReview(ws(project('p', 'P', [late, shipped], ago(1))), NOW);
    expect(r.overdue).toEqual([]);
    expect(r.stale).toEqual([]);
    expect(r.shipped.levels.map((l) => l.levelId)).toEqual(['shipped']);
    expect(focusCandidates(w, NOW).map((c) => c.projectId)).toEqual(['q']);
  });
});
