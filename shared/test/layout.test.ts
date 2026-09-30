import { describe, expect, it } from 'vitest';
import { layoutLevel, ranks } from '../src/index';
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
