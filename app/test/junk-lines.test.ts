import { describe, expect, it } from 'vitest';
import { HERO_IDS } from '@quest/shared';
import { JUNK_KINDS, JUNK_LINES, junkLine, junkLines, parseLine } from '../src/game/junk-lines';

describe('junk lines', () => {
  it('gives every hero at least 3 lines per thing, plus a fallback', () => {
    expect(Object.keys(JUNK_LINES).sort()).toEqual([...HERO_IDS].sort());
    for (const hero of HERO_IDS)
      for (const kind of [...JUNK_KINDS, 'any'])
        expect(junkLines(hero, kind).length, `${hero} ${kind}`).toBeGreaterThanOrEqual(3);
  });

  it('marks a mood and exactly one keyword on every line, and fills every label', () => {
    for (const hero of HERO_IDS)
      for (const [kind, lines] of Object.entries(JUNK_LINES[hero]))
        for (const raw of lines) {
          expect('+=!-', `${hero} ${kind}: ${raw}`).toContain(raw[0]);
          expect(raw.match(/\*[^*]+\*/g), `${hero} ${kind}: ${raw}`).toHaveLength(1);
          // Only snacks and comics have words printed on them.
          if (!['snack', 'comic'].includes(kind)) expect(raw, `${hero} ${kind}`).not.toContain('{label}');
          const line = parseLine(raw, 'ZAPS');
          expect(line.text).not.toMatch(/[{}*]/);
          expect(line.text.slice(line.keyword!.start, line.keyword!.end).length).toBeGreaterThan(0);
        }
  });

  it('fills in the label and picks the face from the mood', () => {
    expect(parseLine("={label}. Saving it for *later*.", 'CRNCH')).toEqual({
      text: 'CRNCH. Saving it for later.',
      keyword: { start: 21, end: 26 },
      mood: 'meh',
      face: 'reacting',
    });
    expect(parseLine('+Go *on*!').face).toBe('neutral');
  });

  it("never says the same thing twice in a row, and falls back for new kinds", () => {
    for (const hero of HERO_IDS) {
      let last: string | undefined;
      for (let i = 0; i < 30; i++) {
        const line = junkLine(hero, 'sock', '', last);
        expect(line.text).not.toBe(last);
        last = line.text;
      }
    }
    expect(junkLines('goth', 'hairbrush')).toEqual(JUNK_LINES.goth.any);
  });
});
