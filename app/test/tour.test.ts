import { describe, expect, it } from 'vitest';
import { HERO_IDS } from '@quest/shared';
import { parseLine } from '../src/ui/dialogue';
import { MAX_TOUR_LINE, pickGuide, pickVariants, TOUR_LINES, TOUR_STEPS } from '../src/ui/onboarding/tour-lines';

// The concept each step teaches: every guide's line must highlight it.
const KEYWORD: Record<string, RegExp> = {
  bedroom: /cartridge/i,
  project: /map/i,
  world: /level/i,
  level: /\? block/i,
  deps: /warp pipe/i,
  flag: /flagpole/i,
  pad: /today/i,
  play: /play/i,
  ai: /ai skill/i,
};

describe('tour lines', () => {
  it('give every hero two lines per step, each with the step keyword, short enough to fit', () => {
    expect(Object.keys(TOUR_LINES).sort()).toEqual([...HERO_IDS].sort());
    for (const hero of HERO_IDS)
      for (const step of TOUR_STEPS) {
        const lines = TOUR_LINES[hero][step];
        expect(lines, `${hero} ${step}`).toHaveLength(2);
        expect(lines[0]).not.toBe(lines[1]);
        for (const raw of lines) {
          const line = parseLine(raw);
          expect(line.keyword, `${hero} ${step}: ${raw}`).toBeDefined();
          expect(line.text.slice(line.keyword!.start, line.keyword!.end), `${hero} ${step}`).toMatch(KEYWORD[step]);
          expect(line.text.length, `${hero} ${step}: ${line.text}`).toBeLessThanOrEqual(MAX_TOUR_LINE);
          expect(line.text).not.toMatch(/[{}*]/);
        }
      }
  });
});

describe('tour guide', () => {
  it("uses the hero this browser picked", () => {
    expect(pickGuide(HERO_IDS, 'goth', 'goth')).toEqual({ guide: 'goth', random: false });
  });

  it('picks at random otherwise, never the last guide', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { guide, random } = pickGuide(HERO_IDS, undefined, 'punk');
      expect(random).toBe(true);
      expect(guide).not.toBe('punk');
      seen.add(guide);
    }
    expect(seen.size).toBeGreaterThan(5);
    expect(pickGuide(HERO_IDS, 'not-a-hero', undefined, () => 0).guide).toBe(HERO_IDS[0]);
  });

  it('switches every step to the other variant on a repeat tour', () => {
    const first = pickVariants(undefined, () => 0.2);
    expect(first.every((v) => v === 0)).toBe(true);
    expect(pickVariants(first)).toEqual(first.map(() => 1));
  });
});
