import { describe, expect, it } from 'vitest';
import { BOARD_H, BOOKEND_W, DECOR_BOOKS_W, EGG_CHANCE, PEEK_OUT, shelfLayout, SPINE_H, SPINE_W, topShelfDecor } from '../src/game/shelf-layout';
import { DURATION, FLY_AT, letterAt, nextActivity, nextPeekIn, peekPose, PEEK_MS, REST, SPIDER_ACTIVITIES, spiderPose, WEB_WORDS } from '../src/game/shelf-spider';

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
    expect(shelfLayout(30, 10, 0, 0).width).toBeGreaterThan(none.width * 2);
  });
});

describe('the top shelf', () => {
  const widths = { books: 30, a: 12, b: 10, c: 14, d: 8, e: 16, egg1: 12, egg2: 10 } as Record<string, number>;
  const ornaments = ['a', 'b', 'c', 'd', 'e'];
  const eggs = ['egg1', 'egg2'];
  /** Repeatable "random" numbers. */
  const seq = (...xs: number[]) => {
    let i = 0;
    return () => xs[i++ % xs.length];
  };

  it('runs the width of the games shelf and holds the cobweb up from underneath', () => {
    const l = shelfLayout(3, 2, 200, 0);
    expect(l.upper.left).toBe(l.left);
    expect(l.upper.width).toBe(l.width);
    expect(l.upper.top + BOARD_H).toBe(l.web.y);
    expect(l.upper.top).toBeLessThan(-SPINE_H);
  });

  it('always has the books, never first, and fits everything on the board without overlaps', () => {
    for (const r of [seq(0.1), seq(0.9), seq(0.3, 0.7, 0.5)]) {
      const upper = { left: 0, width: 160 };
      const t = topShelfDecor(upper, widths, 'books', eggs, ornaments, r);
      expect(t.items.map((i) => i.kind)).toContain('books');
      expect(t.items[0].kind).not.toBe('books');
      for (let i = 1; i < t.items.length; i++) {
        const a = t.items[i - 1];
        const b = t.items[i];
        expect(b.x - widths[b.kind] / 2).toBeGreaterThanOrEqual(a.x + widths[a.kind] / 2);
      }
      const last = t.items.at(-1)!;
      expect(last.x + widths[last.kind] / 2).toBeLessThanOrEqual(upper.width);
    }
  });

  it('shows each easter egg some visits only, and all of them with ?jam', () => {
    const has = (r: () => number, jam = false) => topShelfDecor({ left: 0, width: 400 }, widths, 'books', eggs, ornaments, r, jam).items.map((i) => i.kind);
    expect(has(seq(0.99))).not.toContain('egg1');
    expect(has(seq(0.1))).toEqual(expect.arrayContaining(['egg1', 'egg2']));
    expect(has(seq(0.99), true)).toEqual(expect.arrayContaining(['egg1', 'egg2']));
    expect(EGG_CHANCE).toBe(0.6);
  });

  it('hides a hero right behind the books, and lets them lean out a little', () => {
    const t = topShelfDecor({ left: 0, width: 200 }, widths, 'books', eggs, ornaments, seq(0.4));
    const books = t.items.find((i) => i.kind === 'books')!.x;
    expect(t.hide).toBe(books);
    expect(books - DECOR_BOOKS_W / 2 - (t.peek - 8)).toBe(PEEK_OUT);
  });

  it('peeks out, looks round, and hides again', () => {
    expect(peekPose(0).out).toBe(0);
    expect(peekPose(PEEK_MS / 2).out).toBe(1);
    expect(peekPose(PEEK_MS * 0.7).lookBack).toBe(true);
    expect(peekPose(PEEK_MS).out).toBe(0);
    expect(nextPeekIn(() => 0)).toBeGreaterThanOrEqual(5000);
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
