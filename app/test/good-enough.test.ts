import { describe, expect, it } from 'vitest';
import { GOOD_ENOUGH_LINES, pickGoodEnoughLine } from '../src/ui/good-enough-lines';
import { EVENT_PARAMS, sanitize } from '../src/analytics';

describe('good enough lines (#26)', () => {
  it('has a few dozen different, short lines', () => {
    expect(GOOD_ENOUGH_LINES.length).toBeGreaterThanOrEqual(36);
    expect(new Set(GOOD_ENOUGH_LINES).size).toBe(GOOD_ENOUGH_LINES.length);
    for (const l of GOOD_ENOUGH_LINES) expect(l.length).toBeLessThanOrEqual(80);
  });

  it('never says the same line twice in a row', () => {
    const last = GOOD_ENOUGH_LINES[0];
    for (const r of [0, 0.5, 0.999]) expect(pickGoodEnoughLine(last, () => r)).not.toBe(last);
  });

  it('sends only what was picked and how many were left', () => {
    expect(sanitize(EVENT_PARAMS.good_enough, { action: 'drop', count_bucket: '2-5', title: 'Shiny trim' })).toEqual({ action: 'drop', count_bucket: '2-5' });
  });
});
