import { describe, expect, it } from 'vitest';
import { poleQuip, quip } from '../src/game/quips';

describe('quip', () => {
  it('fills in the printed label and never leaves a placeholder', () => {
    for (let i = 0; i < 40; i++) {
      const q = quip('snack', 'ZAPS');
      expect(q).not.toContain('{label}');
      expect(q.length).toBeGreaterThan(5);
    }
    expect(quip('snack', 'ZAPS', undefined, () => 0)).toBe('ZAPS: 40% bag, 60% air, 100% gone.');
  });

  it("doesn't say the same thing twice in a row", () => {
    let last: string | undefined;
    for (let i = 0; i < 40; i++) {
      const q = quip('sock', '', last);
      expect(q).not.toBe(last);
      last = q;
    }
  });
});

describe('poleQuip', () => {
  it('never tells you off the same way twice in a row, and counts what is left', () => {
    let last: string | undefined;
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const q = poleQuip(2, last);
      expect(q).not.toBe(last);
      expect(q).not.toContain('{n}');
      seen.add(q);
      last = q;
    }
    expect(seen.size).toBeGreaterThan(3);
    expect(poleQuip(2, undefined, () => 0.999)).toBe('2 steps short. Off you pop.');
    expect(poleQuip(1, undefined, () => 0.999)).toBe('1 step short. Off you pop.');
  });
});
