import { describe, expect, it } from 'vitest';
import { HERO_IDS } from '@quest/shared';
import { fighter, fighterColors, FIGHTER_FRAMES, FIGHTER_H, FIGHTER_W, IDLE_FRAMES, LOOKS } from '../src/sprites/fighters';

const painted = (rows: string[], x: number, y: number) => (rows[y]?.[x] ?? '.') !== '.';

describe('fighter poses', () => {
  it('has a look for every hero', () => {
    expect(Object.keys(LOOKS).sort()).toEqual([...HERO_IDS].sort());
  });

  it('draws every frame at 48x64 in known colours only', () => {
    for (const id of HERO_IDS) {
      const colors = fighterColors(id);
      for (const f of FIGHTER_FRAMES) {
        const rows = fighter(id, f);
        expect(rows, `${id} ${f}`).toHaveLength(FIGHTER_H);
        for (const row of rows) {
          expect(row, `${id} ${f}`).toHaveLength(FIGHTER_W);
          for (const ch of row) if (ch !== '.') expect(colors[ch], `${id} ${f} "${ch}"`).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });

  it('leaves no stray pixels floating outside the figure', () => {
    for (const id of HERO_IDS)
      for (const f of FIGHTER_FRAMES) {
        const rows = fighter(id, f);
        rows.forEach((row, y) =>
          [...row].forEach((ch, x) => {
            if (ch === '.') return;
            const touching = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => painted(rows, x + a, y + b));
            expect(touching, `${id} ${f} lone pixel at ${x},${y}`).toBe(true);
          }),
        );
      }
  });

  it('bobs the body on the spot: idle frames differ, the feet stay put', () => {
    for (const id of HERO_IDS) {
      const idle = IDLE_FRAMES.map((f) => fighter(id, f));
      expect(new Set(idle.map((r) => r.join('\n'))).size, id).toBe(3); // 0, 1, 2, 1
      // Below the hem: a gown covers the tops of the shoes.
      const feet = (rows: string[]) => rows.slice(58).join('\n');
      for (const rows of idle) expect(feet(rows), id).toBe(feet(idle[0]));
      expect(fighter(id, 'win').join('\n'), id).not.toBe(idle[0].join('\n'));
    }
  });

  it('keeps the whole figure inside the frame, outlined at the top', () => {
    for (const id of HERO_IDS) {
      const rows = fighter(id, 0);
      const top = rows.findIndex((r) => /[^.]/.test(r));
      expect(rows[top].replace(/\./g, ''), id).toMatch(/^k+$/);
    }
  });

  it('dresses classic in its sprite colours: cyan cap, orange collar, blue overalls', () => {
    const chars = new Set(fighter('classic', 0).join(''));
    for (const ch of ['c', 'o', 'b', 'N']) expect(chars.has(ch), ch).toBe(true);
    expect(chars.has('r'), 'no red cap').toBe(false);
  });
});
