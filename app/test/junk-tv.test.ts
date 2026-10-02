import { describe, expect, it } from 'vitest';
import { JUNK_KINDS, LABELLED_KINDS } from '../src/game/junk-lines';
import { JUNK_SCREENS, junkTitle, pickVariant } from '../src/sprites/junk-tv';
import { clutterKinds, EXTRA_KINDS } from '../src/sprites/bedroom';

/** A seeded random, so runs repeat. */
const rand = (seed: number) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

describe('junk TV screens', () => {
  it('gives every kind up to five screens with titles the pixel font can draw', () => {
    expect(Object.keys(JUNK_SCREENS).sort()).toEqual([...JUNK_KINDS].sort());
    for (const kind of JUNK_KINDS) {
      const n = JUNK_SCREENS[kind].length;
      expect(n, kind).toBeGreaterThanOrEqual(1);
      expect(n, kind).toBeLessThanOrEqual(5);
      const titles = JUNK_SCREENS[kind].map((_, i) => junkTitle(kind, i, 'MIX 3'));
      expect(new Set(titles).size, kind).toBe(n);
      for (const t of titles) {
        expect(t, kind).toMatch(/^[A-Z0-9 !&?-]{1,17}$/);
        if (!LABELLED_KINDS.includes(kind)) expect(t, kind).not.toContain('MIX 3');
      }
    }
  });

  it('never shows the same screen twice running', () => {
    let last: number | undefined;
    const seen = new Set<number>();
    const r = rand(7);
    for (let i = 0; i < 60; i++) {
      const v = pickVariant('duck', last, r);
      expect(v).not.toBe(last);
      seen.add(v);
      last = v;
    }
    expect(seen.size).toBe(5);
  });
});

describe('clutter', () => {
  it('keeps the old amount of clutter but draws the kinds from the whole list', () => {
    const counts: number[] = [];
    const kinds = new Set<string>();
    for (let seed = 1; seed < 400; seed++) {
      const list = clutterKinds(rand(seed));
      const others = list.filter((k) => k !== 'snack' && k !== 'crumbs');
      counts.push(others.length);
      for (const k of list) kinds.add(k);
      // Never two of the same extra thing; one to three snack bags.
      expect(new Set(others).size).toBe(others.length);
      const bags = list.filter((k) => k === 'snack').length;
      expect(bags).toBeGreaterThanOrEqual(1);
      expect(bags).toBeLessThanOrEqual(3);
    }
    expect(Math.max(...counts)).toBeLessThanOrEqual(6);
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    expect(mean).toBeGreaterThan(2.8);
    expect(mean).toBeLessThan(4.2);
    for (const k of EXTRA_KINDS) expect(kinds, k).toContain(k);
  });
});
