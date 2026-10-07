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

describe('hero profiles', () => {
  it('gives every hero a short bio and a signature quote', () => {
    for (const id of HERO_IDS) {
      const { bio, quote } = HEROES[id];
      for (const [what, text] of Object.entries({ bio, quote })) {
        expect(text.trim(), `${id} ${what}`).not.toBe('');
        // Plain text: no dialogue markup.
        expect(text, `${id} ${what}`).not.toMatch(/[*{}]/);
      }
      expect(bio.length, `${id} bio`).toBeLessThanOrEqual(160);
      expect(quote.length, `${id} quote`).toBeLessThanOrEqual(60);
    }
  });

  it('keeps every bio and quote different', () => {
    expect(new Set(HERO_IDS.map((id) => HEROES[id].bio)).size).toBe(HERO_IDS.length);
    expect(new Set(HERO_IDS.map((id) => HEROES[id].quote)).size).toBe(HERO_IDS.length);
  });
});
