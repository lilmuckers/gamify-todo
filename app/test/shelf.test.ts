import { describe, expect, it } from 'vitest';
import { BOOKEND_W, shelfLayout, SPINE_W } from '../src/game/shelf-layout';
import { DURATION, FLY_AT, letterAt, nextActivity, REST, SPIDER_ACTIVITIES, spiderPose, WEB_WORDS } from '../src/game/shelf-spider';

describe('shelfLayout', () => {
  it('lines finished games up on the left and archived ones in the right-hand corner', () => {
    const l = shelfLayout(3, 2, 200, 0);
    const right = l.left + l.width;
    expect(l.finished).toHaveLength(3);
    expect(l.archived).toHaveLength(2);
    expect(l.finished[0]).toBeLessThan(l.finished[2]);
    // No overlaps, left to right: finished, bookend, archived.
    const edges = [...l.finished, l.bookend!, ...l.archived];
    for (let i = 1; i < edges.length; i++) expect(edges[i] - edges[i - 1]).toBeGreaterThanOrEqual(Math.min(SPINE_W, (SPINE_W + BOOKEND_W) / 2));
    expect(l.archived.at(-1)! + SPINE_W / 2).toBeLessThanOrEqual(right);
    expect(l.finished[0] - SPINE_W / 2).toBeGreaterThanOrEqual(l.left);
    expect(l.dustFrom).toBeLessThan(l.bookend!);
    expect(l.left + l.width / 2).toBeCloseTo(200, 0);
  });

  it('keeps room for the web and spider with nothing archived, and grows with lots of games', () => {
    const none = shelfLayout(2, 0, 0, 0);
    expect(none.bookend).toBeUndefined();
    expect(none.left + none.width - none.dustFrom).toBeGreaterThanOrEqual(56);
    expect(shelfLayout(30, 10, 0, 0).width).toBeGreaterThan(none.width * 3);
  });
});

describe('the shelf spider', () => {
  it('starts and ends every activity at rest in its corner', () => {
    for (const a of SPIDER_ACTIVITIES) {
      const start = spiderPose(a, 0);
      const end = spiderPose(a, DURATION[a]);
      expect([start.x, start.y], `${a} start`).toEqual([REST.x, REST.y]);
      expect(end.x, `${a} end`).toBeCloseTo(REST.x, 5);
      expect(end.y, `${a} end`).toBeCloseTo(REST.y, 5);
    }
  });

  it('stays inside its web', () => {
    for (const a of SPIDER_ACTIVITIES)
      for (let t = 0; t <= DURATION[a]; t += 50) {
        const p = spiderPose(a, t);
        expect(p.x, `${a} at ${t}`).toBeLessThanOrEqual(0);
        expect(p.x, `${a} at ${t}`).toBeGreaterThanOrEqual(-64);
        expect(p.y, `${a} at ${t}`).toBeGreaterThanOrEqual(0);
        expect(p.y, `${a} at ${t}`).toBeLessThanOrEqual(46);
      }
  });

  it('hangs on a thread to bounce', () => {
    const p = spiderPose('bounce', DURATION.bounce / 2);
    expect(p.thread).toBeCloseTo(p.y);
    expect(p.y).toBeGreaterThan(20);
  });

  it('wraps the fly up where it got stuck', () => {
    expect(spiderPose('wrap', 0).fly).toEqual({ ...FLY_AT, wrapped: 0 });
    expect(spiderPose('wrap', DURATION.wrap - 1).fly?.wrapped).toBe(1);
    expect(spiderPose('crawl', 1000).fly).toBeUndefined();
  });

  it('spins SOME PIG a letter at a time, walking along them', () => {
    expect(WEB_WORDS).toBe('SOME PIG');
    expect(spiderPose('write', 0).letters).toBe(0);
    const mid = spiderPose('write', 1000 + 650 * 3 + 100);
    expect(mid.letters).toBe(3);
    expect(Math.abs(mid.x - letterAt(3).x)).toBeLessThan(5);
    expect(spiderPose('write', DURATION.write - 1).letters).toBe(WEB_WORDS.length);
  });

  it('never does the same thing twice running', () => {
    for (const a of SPIDER_ACTIVITIES) for (const r of [0, 0.5, 0.99]) expect(nextActivity(a, () => r)).not.toBe(a);
  });
});
