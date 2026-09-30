import { describe, expect, it } from 'vitest';
import { scoreLevel, levelTimer, nudges, suggestNext, BASE_XP, TIME_BONUS_XP } from '../src/index';
import { level, state } from './fixtures';

const DAY = 86_400_000;
const start = Date.parse('2026-01-01T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('timer', () => {
  it('moves through phases', () => {
    const l = level({ startedAt: iso(start), timeboxDays: 4 });
    expect(levelTimer(level()).phase).toBe('not-started');
    expect(levelTimer(l, start + DAY).phase).toBe('on-track');
    expect(levelTimer(l, start + 3.5 * DAY).phase).toBe('hurry');
    expect(levelTimer(l, start + 5 * DAY).phase).toBe('overdue');
  });
});

describe('scoreLevel', () => {
  const cleared = (clearAt: number, stats = {}) =>
    level({
      startedAt: iso(start),
      clearedAt: iso(clearAt),
      timeboxDays: 10,
      stats,
      successCriteria: [{ id: 'm', text: 'm', mvp: true, done: true }],
    });

  it('gives 3 stars and time bonus for an early clean clear', () => {
    const s = scoreLevel(cleared(start + 5 * DAY));
    expect(s.stars).toBe(3);
    expect(s.xp).toBe(BASE_XP + TIME_BONUS_XP * 0.5);
  });

  it('loses the time star when late', () => {
    const s = scoreLevel(cleared(start + 12 * DAY));
    expect(s.starReasons.inTime).toBe(false);
    expect(s.stars).toBe(2);
    expect(s.xp).toBe(BASE_XP);
  });

  it('penalises polishing', () => {
    const s = scoreLevel(cleared(start + 5 * DAY, { editsAfterClear: 2, itemEdits: { a: 5 } }));
    expect(s.polish).toBe(4);
    expect(s.stars).toBe(2);
    expect(s.xp).toBeLessThan(BASE_XP);
  });

  it('never clears on non-MVP criteria alone', () => {
    const l = level();
    l.successCriteria[1].done = true;
    expect(scoreLevel(l).cleared).toBe(false);
    expect(scoreLevel(l).coins).toBe(2);
  });
});

describe('nudges', () => {
  it('suggests dropping optional items when overdue', () => {
    const l = level({ startedAt: iso(start), timeboxDays: 1 });
    const n = nudges(l, start + 3 * DAY);
    expect(n[0].tone).toBe('alert');
    expect(n[0].text).toMatch(/Drop: C/);
  });
});

describe('suggestNext', () => {
  it('prefers started levels', () => {
    const s = state();
    s.worlds.w.levels.push({ ...level({ id: 'second', startedAt: iso(start) }) });
    expect(suggestNext(s)).toEqual({ worldId: 'w', levelId: 'second' });
  });
});
