import { describe, expect, it } from 'vitest';
import { quip } from '../src/game/quips';

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
