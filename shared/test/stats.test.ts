import { describe, expect, it } from 'vitest';
import {
  activityByDay,
  addDays,
  applyOp,
  calibration,
  currentStreak,
  dayKey,
  heatmap,
  heatOf,
  inverseOp,
  lastActivity,
  makeOp,
  progressEvents,
  progressStats,
  stringify,
  streaks,
  timeboxStats,
  weekStart,
  xpOverTime,
  type GameState,
  type Level,
  type OpBody,
  type Workspace,
} from '../src';
import { at, level, lvlOf, workspace } from './fixtures';

// Local times throughout, so the tests pass in any time zone.
const local = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h).getTime();
const iso = (m: number, d: number, h = 12) => new Date(local(m, d, h)).toISOString();
/** Monday 5 October 2026, midday. */
const NOW = local(10, 5);

function project(id: string, levels: Level[]): GameState {
  return {
    overworld: { id, title: id, goals: [{ id: 'g', title: 'G' }], worldOrder: ['w'] },
    worlds: { w: { id: 'w', name: 'W', theme: 'grass', goalIds: ['g'], levels } },
  };
}
const ws = (...levels: Level[]): Workspace => ({ projects: { p: project('p', levels) } });
const cleared = (o: Partial<Level>, tickedAt?: string) =>
  level({ successCriteria: [{ id: 'mvp-1', text: 'Works', mvp: true, done: true, ...(tickedAt ? { doneAt: tickedAt } : {}) }], items: [], ...o });

describe('days', () => {
  it('keys moments by local calendar day', () => {
    expect(dayKey(local(10, 5, 0))).toBe('2026-10-05');
    expect(dayKey(local(10, 5, 23))).toBe('2026-10-05');
    expect(addDays('2026-10-05', -5)).toBe('2026-09-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    // Across the October clock change.
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });

  it('starts weeks on Monday', () => {
    expect(weekStart('2026-10-05')).toBe('2026-10-05');
    expect(weekStart('2026-10-11')).toBe('2026-10-05');
    expect(weekStart('2026-10-04')).toBe('2026-09-28');
  });
});

describe('activityByDay', () => {
  it('counts done items and steps, ticked criteria and clears by day', () => {
    const data = ws(
      level({
        id: 'a',
        startedAt: iso(9, 20),
        successCriteria: [
          { id: 'm', text: 'M', mvp: true, done: false },
          { id: 'b', text: 'B', mvp: false, done: true, doneAt: iso(10, 2, 9) },
        ],
        items: [
          { id: 'x', type: 'task', title: 'X', status: 'done', doneAt: iso(10, 2, 10) },
          { id: 'y', type: 'task', title: 'Y', status: 'done', doneAt: iso(10, 3) },
          // Reopened: a stale stamp doesn't count.
          { id: 'z', type: 'task', title: 'Z', status: 'todo', doneAt: iso(10, 3) },
          // Old data with no stamp: can't be placed.
          { id: 'old', type: 'task', title: 'Old', status: 'done' },
          { id: 'd', type: 'dependency', title: 'D', status: 'todo', subtasks: [{ id: 's', type: 'task', title: 'S', status: 'done', doneAt: iso(10, 2, 18) }] },
        ],
      }),
      cleared({ id: 'c', startedAt: iso(9, 30), clearedAt: iso(10, 3, 15) }, iso(10, 3, 15)),
    );
    const days = activityByDay(progressEvents(data));
    expect([...days.keys()].sort()).toEqual(['2026-10-02', '2026-10-03']);
    expect(days.get('2026-10-02')).toEqual({ day: '2026-10-02', done: 2, ticked: 1, cleared: 0, total: 3, undone: 0 });
    expect(days.get('2026-10-03')).toEqual({ day: '2026-10-03', done: 1, ticked: 1, cleared: 1, total: 3, undone: 0 });
  });
});

describe('streaks', () => {
  const run = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

  it('counts back from today', () => {
    expect(streaks(run('2026-10-01', 5), NOW)).toEqual({ current: 5, longest: 5, today: true });
  });

  it("keeps yesterday's streak alive until today is over", () => {
    expect(streaks(run('2026-10-01', 4), NOW)).toEqual({ current: 4, longest: 4, today: false });
  });

  it('breaks after a missed day and remembers the longest', () => {
    const days = [...run('2026-09-01', 9), ...run('2026-10-01', 3)];
    expect(streaks(days, NOW)).toEqual({ current: 0, longest: 9, today: false });
    expect(streaks([], NOW)).toEqual({ current: 0, longest: 0, today: false });
  });

  it('ignores days after today and duplicates', () => {
    expect(streaks(['2026-10-05', '2026-10-05', '2026-10-06', '2026-10-07'], NOW)).toEqual({ current: 1, longest: 1, today: true });
  });

  it('caches the HUD streak per workspace and day', () => {
    const data = ws(level({ items: [{ id: 'a', type: 'task', title: 'A', status: 'done', doneAt: iso(10, 4) }] }));
    expect(currentStreak(data, NOW).current).toBe(1);
    expect(currentStreak(data, NOW)).toBe(currentStreak(data, NOW + 3_600_000));
    expect(currentStreak(data, local(10, 7)).current).toBe(0);
  });
});

describe('heatmap', () => {
  it('draws whole weeks, Monday first, up to this week', () => {
    const activity = activityByDay(progressEvents(
      ws(level({ items: Array.from({ length: 5 }, (_, i) => ({ id: `i${i}`, type: 'task' as const, title: 'I', status: 'done' as const, doneAt: iso(10, 1) })) })),
    ));
    const cols = heatmap(activity, NOW, 3);
    expect(cols).toHaveLength(3);
    expect(cols.every((c) => c.length === 7)).toBe(true);
    expect(cols[0][0].day).toBe('2026-09-21');
    expect(cols[2][0]).toMatchObject({ day: '2026-10-05', future: false });
    expect(cols[2][1]).toMatchObject({ day: '2026-10-06', future: true, count: 0 });
    expect(cols[1][3]).toMatchObject({ day: '2026-10-01', count: 5, heat: 3 });
  });

  it('shades by count', () => {
    expect([0, 1, 2, 3, 4, 6, 7, 30].map(heatOf)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('timeboxStats', () => {
  const data = ws(
    // 4 of 10 days: in time, 3 stars.
    cleared({ id: 'quick', startedAt: iso(9, 1), clearedAt: iso(9, 5), timeboxDays: 10 }),
    // 15 of 10 days: late, 2 stars.
    cleared({ id: 'slow', startedAt: iso(9, 1), clearedAt: iso(9, 16), timeboxDays: 10 }),
    // Extended 5 → 10 after starting, cleared on day 8: late against the original 5.
    cleared({ id: 'stretched', startedAt: iso(9, 10), clearedAt: iso(9, 18), timeboxDays: 10, stats: { timeboxExtendedDays: 5 } }),
    // Cleared but never started: counts for stars, not timings.
    cleared({ id: 'undated' }),
    level({ id: 'open', startedAt: iso(9, 1) }),
  );

  it('averages stars and measures days against the original time-box', () => {
    const t = timeboxStats(data, NOW);
    expect(t.cleared).toBe(4);
    expect(t.avgStars).toBeCloseTo((3 + 2 + 2 + 3) / 4);
    expect(t.timed).toBe(3);
    expect(t.inTime).toBe(1);
    expect(t.inTimeRate).toBeCloseTo(1 / 3);
    expect(t.medianDays).toBeCloseTo(8);
    expect(t.medianTimebox).toBe(10);
    // Ratios 0.4, 1.5 and 1.6.
    expect(t.medianRatio).toBeCloseTo(1.5);
    expect(calibration(t)).toBe('late');
  });

  it('has no averages with nothing cleared', () => {
    const t = timeboxStats(ws(level()), NOW);
    expect(t).toEqual({ cleared: 0, timed: 0, inTime: 0 });
    expect(calibration(t)).toBeUndefined();
  });

  it('calls time-boxes early, about right or late', () => {
    const r = (medianRatio: number) => calibration({ cleared: 1, timed: 1, inTime: 1, medianRatio });
    expect([r(0.3), r(0.8), r(1), r(1.4)]).toEqual(['early', 'about-right', 'about-right', 'late']);
  });
});

describe('xpOverTime', () => {
  it('adds XP in the week each level cleared, after what came before', () => {
    const data = ws(
      cleared({ id: 'long-ago', startedAt: iso(1, 1), clearedAt: iso(1, 2) }),
      cleared({ id: 'undated' }),
      cleared({ id: 'last-week', startedAt: iso(9, 28), clearedAt: iso(10, 1) }),
      cleared({ id: 'this-week', startedAt: iso(10, 5, 8), clearedAt: iso(10, 5, 10) }),
    );
    const xp = xpOverTime(data, NOW, 3);
    expect(xp.weeks.map((w) => w.week)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05']);
    expect(xp.weeks[0].gained).toBe(0);
    expect(xp.weeks[1].gained).toBeGreaterThan(0);
    expect(xp.weeks[2].gained).toBeGreaterThan(0);
    expect(xp.before).toBeGreaterThan(0);
    expect(xp.weeks[0].total).toBe(xp.before);
    expect(xp.total).toBe(xp.before + xp.weeks[1].gained + xp.weeks[2].gained);
    expect(xp.weeks[2].total).toBe(xp.total);
  });
});

describe('criterion doneAt', () => {
  const tick = (w: Workspace, done: boolean, when: number, id = 'mvp-1') =>
    applyOp(w, makeOp({ kind: 'setCriterion', ...at, criterionId: id, done }, new Date(when)));

  it('is stamped when ticked, kept when ticked again and removed when un-ticked', () => {
    let w = tick(workspace(), true, NOW);
    expect(lvlOf(w).successCriteria[0].doneAt).toBe(new Date(NOW).toISOString());
    w = tick(w, true, NOW + 86_400_000);
    expect(lvlOf(w).successCriteria[0].doneAt).toBe(new Date(NOW).toISOString());
    w = tick(w, false, NOW);
    expect(lvlOf(w).successCriteria[0].doneAt).toBeUndefined();
  });

  it('follows done in updateCriterion too', () => {
    const w = applyOp(workspace(), makeOp({ kind: 'updateCriterion', ...at, criterionId: 'bonus', patch: { done: true } }, new Date(NOW)));
    expect(lvlOf(w).successCriteria[1].doneAt).toBe(new Date(NOW).toISOString());
    const renamed = applyOp(w, makeOp({ kind: 'updateCriterion', ...at, criterionId: 'bonus', patch: { text: 'Prettier' } }, new Date(NOW + 1000)));
    expect(lvlOf(renamed).successCriteria[1].doneAt).toBe(new Date(NOW).toISOString());
  });

  it('undoing an un-tick puts the original stamp back', () => {
    const before = workspace(level({ successCriteria: [{ id: 'mvp-1', text: 'Works', mvp: true, done: true, doneAt: iso(9, 1) }] }));
    const body: OpBody = { kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: false };
    const after = applyOp(before, makeOp(body));
    const back = applyOp(after, makeOp(inverseOp(body, before)!, new Date(NOW)));
    expect(lvlOf(back).successCriteria[0].doneAt).toBe(iso(9, 1));
    // Undoing a tick takes the stamp away again.
    const ticked: OpBody = { kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: true };
    expect(inverseOp(ticked, workspace())).toEqual({ ...ticked, done: false });
  });

  it('counts as activity for the review and is written after done', () => {
    expect(lastActivity(level({ startedAt: iso(9, 1), successCriteria: [{ id: 'm', text: 'M', mvp: true, done: true, doneAt: iso(9, 9) }] }))).toBe(local(9, 9));
    expect(stringify({ doneAt: iso(9, 9), done: true, mvp: true, text: 'T', id: 'c' }).match(/"(\w+)":/g)).toEqual(['"id":', '"mvp":', '"text":', '"done":', '"doneAt":']);
  });
});

describe('the example data', () => {
  it('has a lively history', async () => {
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
    const s = progressStats(fromFiles(files), Date.parse('2026-10-03T20:00:00Z'));
    expect(s.streak.current).toBeGreaterThan(1);
    expect(s.streak.longest).toBeGreaterThanOrEqual(s.streak.current);
    expect(s.heatmap.flat().filter((c) => c.count > 0).length).toBeGreaterThan(60);
    expect(s.timebox.cleared).toBe(30);
    expect(s.timebox.timed).toBe(30);
    expect(s.timebox.inTimeRate).toBeGreaterThan(0);
    expect(s.timebox.inTimeRate).toBeLessThan(1);
    expect(s.xp.weeks.at(-1)!.total).toBe(s.xp.total);
    // Every stamp in the example data is on something done.
    expect(s.total).toBe(s.days.reduce((n, d) => n + d.done + d.ticked + d.cleared, 0));
  });
});
