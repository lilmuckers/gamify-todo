import { describe, expect, it } from 'vitest';
import { HERO_IDS } from '@quest/shared';
import { HEROES } from '../src/sprites/heroes';
import { PALETTE } from '../src/sprites/pixels';

describe('heroes', () => {
  it('has art for every hero id, 16x16 with only known colours', () => {
    expect(Object.keys(HEROES).sort()).toEqual([...HERO_IDS].sort());
    for (const id of HERO_IDS) {
      const { colors, frames } = HEROES[id];
      if (!frames) continue;
      for (const [name, rows] of Object.entries(frames)) {
        expect(rows, `${id} ${name}`).toHaveLength(16);
        for (const row of rows) {
          expect(row, `${id} ${name}`).toHaveLength(16);
          for (const ch of row) if (ch !== '.') expect(colors?.[ch] ?? PALETTE[ch], `${id} ${name} "${ch}"`).toBeDefined();
        }
      }
    }
  });
});
