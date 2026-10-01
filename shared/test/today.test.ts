import { describe, expect, it } from 'vitest';
import { todayList, type GameState, type Level, type Workspace } from '../src';
import { level } from './fixtures';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-01T12:00:00Z');
const started = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

function project(id: string, title: string, worlds: Record<string, Level[]>): GameState {
  return {
    overworld: { id, title, goals: [{ id: 'g', title: 'G' }], worldOrder: Object.keys(worlds) },
    worlds: Object.fromEntries(
      Object.entries(worlds).map(([wid, levels]) => [wid, { id: wid, name: wid.toUpperCase(), theme: 'grass' as const, goalIds: ['g'], levels }]),
    ),
  };
}

const ws = (...projects: GameState[]): Workspace => ({ projects: Object.fromEntries(projects.map((p) => [p.overworld.id, p])) });

describe('todayList', () => {
  it('lists overdue and hurrying levels, most urgent first, with level codes', () => {
    const t = todayList(
      ws(
        project('house', 'House', {
          kitchen: [
            level({ id: 'fine', name: 'Fine', startedAt: started(1), timeboxDays: 10 }),
            level({ id: 'late', name: 'Late', startedAt: started(12), timeboxDays: 10 }),
          ],
          garden: [level({ id: 'tight', name: 'Tight', startedAt: started(9), timeboxDays: 10 })],
        }),
      ),
      NOW,
    );
    expect(t.overdue.map((l) => [l.levelId, l.phase, l.code])).toEqual([
      ['late', 'overdue', '1-2'],
      ['tight', 'hurry', '2-1'],
    ]);
    expect(t.overdue[0].mvpLeft).toBe(1);
  });

  it('lists doing items, including steps inside dependencies', () => {
    const lvl = level({
      startedAt: started(1),
      items: [
        { id: 'a', type: 'task', title: 'A', status: 'doing' },
        {
          id: 'dep',
          type: 'dependency',
          title: 'Permit',
          status: 'todo',
          subtasks: [{ id: 's1', type: 'task', title: 'Call council', status: 'doing' }],
        },
      ],
    });
    const t = todayList(ws(project('p', 'P', { w: [lvl] })), NOW);
    expect(t.doing.map((d) => [d.item.id, d.subId, d.depTitle])).toEqual([
      ['a', undefined, undefined],
      ['s1', 'dep', 'Permit'],
    ]);
  });

  it('shows where the hero waits, skipping items already doing and stepping into warp pipes', () => {
    const doingFirst = level({ id: 'one', startedAt: started(1), items: [{ id: 'x', type: 'task', title: 'X', status: 'doing' }] });
    const warp = level({
      id: 'two',
      startedAt: started(1),
      items: [
        {
          id: 'dep',
          type: 'dependency',
          title: 'Permit',
          status: 'todo',
          subtasks: [
            { id: 'done', type: 'task', title: 'Done step', status: 'done' },
            { id: 'next', type: 'task', title: 'Next step', status: 'todo' },
          ],
        },
      ],
    });
    const t = todayList(ws(project('p', 'P', { w: [doingFirst, warp] })), NOW);
    expect(t.next.map((n) => [n.levelId, n.item.id, n.subId])).toEqual([['two', 'next', 'dep']]);
  });

  it('suggests a starting point for projects with nothing on the go, after active ones', () => {
    const active = project('a', 'Active', { w: [level({ startedAt: started(1) })] });
    const idle = project('b', 'Idle', { w: [level({ id: 'first', name: 'First' })] });
    const t = todayList(ws(idle, active), NOW);
    expect(t.next.map((n) => [n.projectId, n.levelId, !!n.suggested])).toEqual([
      ['a', 'lvl', false],
      ['b', 'first', true],
    ]);
  });

  it('ignores cleared levels and finished items', () => {
    const cleared = level({
      startedAt: started(20),
      successCriteria: [{ id: 'c', text: 'C', mvp: true, done: true }],
      items: [{ id: 'd', type: 'task', title: 'D', status: 'doing' }],
    });
    const t = todayList(ws(project('p', 'P', { w: [cleared] })), NOW);
    expect(t).toEqual({ overdue: [], doing: [], next: [] });
  });

  it('works on the example data', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fromFiles } = await import('../src');
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
    const t = todayList(fromFiles(files), NOW);
    expect(t.next.length).toBeGreaterThan(0);
    for (const n of [...t.next, ...t.doing]) expect(['done', 'dropped']).not.toContain(n.item.status);
  });
});
