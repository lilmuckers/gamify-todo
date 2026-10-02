import { describe, expect, it } from 'vitest';
import { HERO_IDS } from '@quest/shared';
import { EMOTES, FACES, MOODS, PORTRAIT_SIZE, PORTRAITS, portraitColors } from '../src/sprites/portraits';

describe('hero portraits', () => {
  it('has a 32x32 portrait for every hero and expression, using only that hero\'s colours', () => {
    expect(Object.keys(PORTRAITS).sort()).toEqual([...HERO_IDS].sort());
    for (const id of HERO_IDS) {
      const colors = portraitColors(id);
      for (const f of FACES) {
        const rows = PORTRAITS[id][f];
        expect(rows, `${id} ${f}`).toHaveLength(PORTRAIT_SIZE);
        for (const row of rows) {
          expect(row, `${id} ${f}`).toHaveLength(PORTRAIT_SIZE);
          for (const ch of row) if (ch !== '.') expect(colors[ch], `${id} ${f} "${ch}"`).toBeDefined();
        }
      }
    }
  });

  it('gives each expression its own face, framed by a dark outline', () => {
    for (const id of HERO_IDS) {
      expect(PORTRAITS[id].reacting, id).not.toEqual(PORTRAITS[id].neutral);
      const rows = PORTRAITS[id].neutral;
      // The shoulders fill the bottom row; the silhouette's edge is outline.
      expect(rows.at(-1)!.replaceAll('.', '').length, id).toBeGreaterThan(16);
      for (const row of rows) {
        const first = row.search(/[^.]/);
        if (first > 0) expect(row[first], `${id}: ${row}`).toBe('k');
      }
    }
  });

  it('has a 7x7 white emote for every mood', () => {
    for (const m of MOODS) {
      expect(EMOTES[m]).toHaveLength(7);
      for (const row of EMOTES[m]) expect(row).toMatch(/^[.w]{7}$/);
    }
  });
});
