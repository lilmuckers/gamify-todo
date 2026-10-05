import { describe, expect, it } from 'vitest';
import { dayLog, DETAILED_WEEKS, detailedStats, fromFiles, historyEvents, isProjectFinished, orderedProjects, type ChangeEvent, type GameState, type Level, type Workspace } from '../src';
import { level } from './fixtures';

const local = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h).getTime();
const iso = (m: number, d: number, h = 12) => new Date(local(m, d, h)).toISOString();
const NOW = local(10, 5, 18);

function project(id: string, levels: Level[]): GameState {
  return {
    overworld: { id, title: id.toUpperCase(), goals: [{ id: 'g', title: 'G' }], worldOrder: ['w'] },
    worlds: { w: { id: 'w', name: 'W', theme: 'grass', goalIds: ['g'], levels } },
  };
}
const ws = (...ps: GameState[]): Workspace => ({ projects: Object.fromEntries(ps.map((p) => [p.overworld.id, p])) });
const cleared = (o: Partial<Level>) =>
  level({ successCriteria: [{ id: 'works', text: 'It works', mvp: true, done: true, doneAt: o.clearedAt }], items: [], ...o });

const data = ws(
  project('done', [
    cleared({ id: 'one', name: 'One', startedAt: iso(9, 1), clearedAt: iso(9, 4), timeboxDays: 5, items: [{ id: 'a', type: 'task', title: 'A', status: 'done', doneAt: iso(9, 2, 9) }] }),
    cleared({ id: 'two', name: 'Two', startedAt: iso(9, 10), clearedAt: iso(9, 25), timeboxDays: 10, stats: { editsAfterClear: 2 }, items: [{ id: 'r', type: 'risk', title: 'R', status: 'done', doneAt: iso(9, 12, 20) }, { id: 'x', type: 'task', title: 'X', status: 'dropped' }] }),
  ]),
  project('open', [level({ id: 'busy', name: 'Busy', startedAt: iso(10, 1), items: [{ id: 'b', type: 'task', title: 'B', status: 'todo' }] })]),
);
const ev = (at: string, kind: ChangeEvent['kind'], level: string, subject: string, extra: Partial<ChangeEvent> = {}): ChangeEvent => ({ at, sha: `s-${at}-${kind}`, kind, level, subject, ...extra });
const deep: ChangeEvent[] = [
  ev(iso(10, 2, 8), 'added', 'open/w/busy', 'B', { afterStart: true, itemType: 'task' }),
  ev(iso(10, 2, 9), 'done', 'open/w/busy', 'B'),
  ev(iso(10, 3, 9), 'reopened', 'open/w/busy', 'B'),
  ev(iso(10, 3, 10), 'done', 'open/w/busy', 'B'),
  ev(iso(10, 3, 11), 'reopened', 'open/w/busy', 'B'),
  ev(iso(9, 26, 9), 'edited', 'done/w/two', 'R', { afterClear: true }),
  ev(iso(9, 14), 'dropped', 'done/w/two', 'X', { afterStart: true }),
  ev(iso(9, 15), 'extended', 'done/w/two', '', { days: 3 }),
];

describe('detailedStats', () => {
  const s = detailedStats(data, { now: NOW, deep });

  it('counts stamps plus history-only work, and finds the best day and week', () => {
    // Stamps: A, R, the two ticks, the two clears (6). History: B done twice, both reopened.
    expect(s.total).toBe(8);
    expect(s.undone).toBe(2);
    expect(s.bestDay?.day).toBe('2026-09-04');
    expect(s.bestWeek?.total).toBeGreaterThanOrEqual(2);
    expect(s.heatmap).toHaveLength(DETAILED_WEEKS);
    expect(s.weekday.reduce((a, b) => a + b)).toBe(8);
    expect(s.hour.reduce((a, b) => a + b)).toBe(8);
    expect(s.scanned).toBe(true);
  });

  it('reports scope, polish, the mix and each project', () => {
    expect(s.scope).toMatchObject({ addedAfterStart: 1, cut: 1, extendedDays: 3 });
    expect(s.scope.weeks).toHaveLength(DETAILED_WEEKS);
    expect(s.polish).toMatchObject({ reopened: 2, editsAfterClear: 1, xpLost: 30 });
    expect(s.polish.top[0]).toEqual({ title: 'B', levelName: 'Busy', times: 2 });
    expect(s.mix).toEqual({ task: 1, risk: 1 });
    const done = s.projects.find((p) => p.id === 'done')!;
    expect(done).toMatchObject({ finished: true, cleared: 2, levels: 2, cut: 1, timed: 2, inTime: 1 });
    expect(s.projects.find((p) => p.id === 'open')!.finished).toBe(false);
    expect(s.scatter.map((p) => [p.level, Math.round(p.took), p.box, p.inTime])).toEqual([
      ['One', 3, 5, true],
      ['Two', 15, 10, false],
    ]);
  });

  it('names things in the log, newest first', () => {
    expect(s.recent[0]).toMatchObject({ kind: 'done', title: 'B', levelName: 'Busy', undone: true });
    const day = dayLog(data, s, '2026-09-04');
    expect(day.map((l) => [l.kind, l.title])).toEqual(
      expect.arrayContaining([
        ['ticked', 'It works'],
        ['cleared', 'One'],
      ]),
    );
  });

  it('counts a commit once when both histories describe it', () => {
    const quick = historyEvents([{ sha: 's-q', date: iso(10, 2, 9), message: 'quest: done: B (open/w/busy)' }, { sha: 's-q2', date: iso(10, 3, 9), message: 'quest: todo: B (open/w/busy)' }]);
    const same: ChangeEvent[] = [ev(iso(10, 2, 9), 'done', 'open/w/busy', 'B', { sha: 's-q' }), ev(iso(10, 3, 9), 'reopened', 'open/w/busy', 'B', { sha: 's-q2' })];
    expect(detailedStats(data, { now: NOW, quick, deep: same }).total).toBe(7);
    expect(detailedStats(data, { now: NOW, quick }).total).toBe(7);
  });

  it('falls back to the data alone without a scan', () => {
    const plain = detailedStats(data, { now: NOW });
    expect(plain.scanned).toBe(false);
    expect(plain.total).toBe(6);
    expect(plain.scope.cut).toBe(1);
    expect(plain.polish.reopened).toBe(0);
  });

  it('marks the finished example games', async () => {
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
    const ex = detailedStats(fromFiles(files), { now: Date.parse('2026-10-05T17:00:00Z') });
    expect(ex.projects.filter((p) => p.finished).map((p) => p.id).sort()).toEqual(['allotment-2025', 'moving-flat', 'sourdough']);
    expect(ex.scatter.length).toBe(56);
    // Finished games go after the ones still being played.
    const order = orderedProjects(fromFiles(files)).map((p) => [p.overworld.id, isProjectFinished(p)]);
    expect(order.slice(-3).every(([, done]) => done)).toBe(true);
    expect(order.slice(0, -3).some(([, done]) => done)).toBe(false);
  });
});
