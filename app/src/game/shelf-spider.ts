/**
 * The spider in the shelf's dusty corner, as plain maths: where it is at a
 * moment of an activity. The scene asks every frame, so nothing here is a
 * tween or timer (the spider never "settles", and doesn't have to).
 * Coordinates are relative to the cobweb's top-right point, x to the left
 * (negative) and y down.
 */
export type SpiderActivity = 'bounce' | 'crawl' | 'wrap' | 'write';
export const SPIDER_ACTIVITIES: SpiderActivity[] = ['bounce', 'crawl', 'wrap', 'write'];

/** What the spider spins in its web. */
export const WEB_WORDS = 'SOME PIG';

export const DURATION: Record<SpiderActivity, number> = { bounce: 5200, crawl: 6000, wrap: 7600, write: 9400 };

/** Where the spider sits between activities: up in the corner. */
export const REST = { x: -6, y: 5 };
/** Where the fly gets stuck. */
export const FLY_AT = { x: -34, y: 26 };
const LETTER_MS = 650;
/** Walking over to the first letter before spinning. */
const WRITE_LEAD_MS = 1000;
/** Left end and baseline of the spun words (3x5 letters, 4 px apart). */
export const WORDS_AT = { x: -58, y: 34 };

export interface SpiderPose {
  x: number;
  y: number;
  /** Leg frame, 0 or 1: alternates while it walks. */
  frame: 0 | 1;
  /** Length of the thread above it, when it's hanging (bounce). */
  thread?: number;
  /** The fly, while there is one, and how far wrapped up it is (0-1). */
  fly?: { x: number; y: number; wrapped: number };
  /** How many characters of WEB_WORDS are spun so far. */
  letters: number;
}

type Pt = { x: number; y: number };
const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Walks a path of points in `ms`, at an even pace between points. */
function walk(path: Pt[], t: number, ms: number): Pt & { moving: boolean } {
  if (t >= ms) return { ...path[path.length - 1], moving: false };
  const legs = path.length - 1;
  const at = (Math.max(0, t) / ms) * legs;
  const i = Math.min(legs - 1, Math.floor(at));
  return { x: lerp(path[i].x, path[i + 1].x, at - i), y: lerp(path[i].y, path[i + 1].y, at - i), moving: true };
}

const legs = (t: number, moving: boolean): 0 | 1 => (moving && Math.floor(t / 110) % 2 ? 1 : 0);

/** Top-left of the n-th character of WEB_WORDS. */
export const letterAt = (n: number): Pt => ({ x: WORDS_AT.x + n * 4, y: WORDS_AT.y });

const CRAWL: Pt[] = [REST, { x: -18, y: 10 }, { x: -32, y: 6 }, { x: -40, y: 20 }, { x: -24, y: 28 }, { x: -12, y: 18 }, REST];

/** The spider's pose `t` ms into `activity`. */
export function spiderPose(activity: SpiderActivity, t: number): SpiderPose {
  const ms = DURATION[activity];
  switch (activity) {
    case 'bounce': {
      // Drop down on a thread, bob, climb back up.
      const down = 900;
      const up = ms - 900;
      const drop = t < down ? ease(t / down) : t > up ? 1 - ease((t - up) / 900) : 1;
      const bob = t > down && t < up ? Math.sin(((t - down) / 420) * Math.PI) * 4 : 0;
      const y = lerp(REST.y, 30, drop) + bob;
      return { x: REST.x, y, frame: 0, thread: y, letters: 0 };
    }
    case 'crawl': {
      const p = walk(CRAWL, t, ms - 400);
      return { x: p.x, y: p.y, frame: legs(t, p.moving), letters: 0 };
    }
    case 'wrap': {
      // Scuttle over, spin it up (jiggling round it), admire it, go home.
      const to = { x: FLY_AT.x + 4, y: FLY_AT.y - 5 };
      const spin0 = 1800;
      const spin1 = 4400;
      const home = ms - 1400;
      const wrapped = ease((t - spin0) / (spin1 - spin0));
      const fly = { ...FLY_AT, wrapped };
      if (t < spin0) {
        const p = walk([REST, { x: -20, y: 14 }, to], t, spin0);
        return { x: p.x, y: p.y, frame: legs(t, p.moving), fly, letters: 0 };
      }
      if (t < spin1) {
        const a = ((t - spin0) / 260) * Math.PI;
        return { x: FLY_AT.x + Math.cos(a) * 5, y: FLY_AT.y + Math.sin(a) * 4 - 2, frame: legs(t, true), fly, letters: 0 };
      }
      const p = t < home ? { ...to, moving: false } : walk([to, { x: -20, y: 14 }, REST], t - home, 1300);
      return { x: p.x, y: p.y, frame: legs(t, p.moving), fly, letters: 0 };
    }
    case 'write': {
      // Over to the first letter, then letter by letter along the baseline, each appearing as it's passed.
      const n = WEB_WORDS.length;
      if (t < WRITE_LEAD_MS) {
        const first = letterAt(0);
        const p = walk([REST, { x: -30, y: 14 }, { x: first.x + 1, y: first.y - 2 }], t, WRITE_LEAD_MS);
        return { x: p.x, y: p.y, frame: legs(t, p.moving), letters: 0 };
      }
      t -= WRITE_LEAD_MS;
      const end = n * LETTER_MS;
      if (t < end) {
        const i = Math.floor(t / LETTER_MS);
        const f = (t % LETTER_MS) / LETTER_MS;
        const a = letterAt(i);
        // Down and up each letter's stroke.
        const y = a.y + (f < 0.5 ? f * 2 : 2 - f * 2) * 5 - 2;
        return { x: a.x + 1 + f * 3, y, frame: legs(t, true), letters: Math.min(n, i + (f > 0.5 ? 1 : 0)) };
      }
      const p = walk([{ x: letterAt(n - 1).x + 4, y: WORDS_AT.y - 2 }, { x: -14, y: 16 }, REST], t - end, ms - WRITE_LEAD_MS - end - 300);
      return { x: p.x, y: p.y, frame: legs(t, p.moving), letters: n };
    }
  }
}

/** The next activity: any but the last one, so it never does the same thing twice running. */
export function nextActivity(last: SpiderActivity | undefined, r: () => number = Math.random): SpiderActivity {
  const choices = SPIDER_ACTIVITIES.filter((a) => a !== last);
  return choices[Math.floor(r() * choices.length)];
}
