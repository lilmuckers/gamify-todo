/** How the hero gets about the level on his own (#22). Phaser-free so it can be tested. */

/** Normal walking pace. */
export const WALK_TILES_PER_SEC = 7;
/** No walk takes longer than this: further than that, he hurries. */
export const MAX_WALK_MS = 1200;
/** Further than this, he blinks out and pops up near the stop instead of hurrying all the way. */
export const POP_TILES = 12;
/** How far short of the stop he pops up, so he still walks in to it. */
export const POP_SHORT_TILES = 2;

export interface WalkPlan {
  /** Pop up `tiles` short of the stop first, on the side he's coming from. */
  pop: boolean;
  /** Tiles left to walk (after any pop). */
  tiles: number;
  /** How long the walk takes. */
  ms: number;
  /** Walk animation speed: above 1 when he hurries. */
  pace: number;
  /** How panicked he looks, 0 (strolling) to 1 (popping in): lean, bounce and sweat. */
  panic: number;
}

/** Pace of the fastest hurry, just short of a pop-in. */
const TOP_PACE = (POP_TILES / WALK_TILES_PER_SEC) * 1000 / MAX_WALK_MS;

/** Plans a walk of `tiles`: a stroll, a hurry capped at `MAX_WALK_MS`, or a pop-in and a short walk. */
export function planWalk(tiles: number): WalkPlan {
  const pop = tiles > POP_TILES;
  const walk = pop ? POP_SHORT_TILES : tiles;
  const natural = (walk / WALK_TILES_PER_SEC) * 1000;
  const ms = Math.min(natural, MAX_WALK_MS);
  const pace = ms > 0 ? natural / ms : 1;
  const panic = pop ? 1 : Math.min(1, Math.max(0, (pace - 1) / (TOP_PACE - 1)));
  return { pop, tiles: walk, ms, pace, panic };
}
