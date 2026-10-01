import { describe, expect, it } from 'vitest';
import { layoutLevel, MAX_STAIR_H, ranks, stairHeights } from '../src/index';
import { level } from './fixtures';

describe('layout', () => {
  it('ranks by dependency depth', () => {
    const r = ranks(level().items);
    expect(r.get('a')).toBe(0);
    expect(r.get('b')).toBe(1);
  });

  it('places dependents to the right and stops at the first blocker', () => {
    const l = layoutLevel(level());
    const a = l.entities.find((e) => e.itemId === 'a')!;
    const b = l.entities.find((e) => e.itemId === 'b')!;
    expect(b.x).toBeGreaterThan(a.x);
    expect(a.kind).toBe('qblock');
    expect(b.kind).toBe('wall');
    expect(l.hero.itemId).toBe('a');
    expect(l.stops.at(-1)?.kind).toBe('flag');
  });

  it('stretch items never block', () => {
    const l = layoutLevel(level());
    const c = l.entities.find((e) => e.itemId === 'c')!;
    expect(c.kind).toBe('coins');
    expect(c.blocking).toBe(false);
  });

  it('walks to the castle once cleared', () => {
    const lv = level();
    lv.successCriteria[0].done = true;
    expect(layoutLevel(lv).hero.kind).toBe('castle');
  });

  it('is deterministic', () => {
    expect(layoutLevel(level())).toEqual(layoutLevel(level()));
  });
});

describe('stairs', () => {
  const crit = (n: number, extra: (i: number) => object = () => ({})) =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i}`, text: `C${i}`, mvp: i === 0, done: false, ...extra(i) }));

  it('puts one step per criterion between the last item and the pole, one block higher each', () => {
    const lv = level({ successCriteria: crit(3, (i) => ({ done: i === 1 })) });
    const l = layoutLevel(lv);
    expect(l.stairs.map((s) => [s.criterionId, s.h, s.mvp, s.done])).toEqual([
      ['c0', 1, true, false],
      ['c1', 2, false, true],
      ['c2', 3, false, false],
    ]);
    const lastItem = Math.max(...l.entities.filter((e) => e.kind !== 'coins').map((e) => e.x + e.w));
    expect(l.stairs[0].x).toBeGreaterThan(lastItem);
    l.stairs.forEach((s, i) => i && expect(s.x).toBe(l.stairs[i - 1].x + l.stairs[i - 1].w));
    const top = l.stairs.at(-1)!;
    expect(l.flagX).toBeGreaterThan(top.x + top.w);
    expect(l.castleX).toBeGreaterThan(l.flagX);
  });

  it('waits at the foot of the stairs once nothing blocks', () => {
    const lv = level({ items: [] });
    const l = layoutLevel(lv);
    expect(l.hero.kind).toBe('flag');
    expect(l.hero.x).toBeLessThan(l.stairs[0].x);
  });

  it('caps the height for many criteria and still climbs to the top', () => {
    const l = layoutLevel(level({ successCriteria: crit(20) }));
    expect(l.stairs).toHaveLength(20);
    expect(Math.max(...l.stairs.map((s) => s.h))).toBe(MAX_STAIR_H);
    expect(l.stairs.at(-1)!.h).toBe(MAX_STAIR_H);
    l.stairs.forEach((s, i) => i && expect(s.h - l.stairs[i - 1].h).toBeGreaterThanOrEqual(0));
    l.stairs.forEach((s, i) => i && expect(s.h - l.stairs[i - 1].h).toBeLessThanOrEqual(1));
    expect(stairHeights(8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('has no stairs in a sub-level', () => {
    const l = layoutLevel(level(), { sub: true });
    expect(l.stairs).toEqual([]);
    expect(l.stops.at(-1)).toEqual({ x: l.flagX - 1.5, kind: 'flag' });
  });
});
