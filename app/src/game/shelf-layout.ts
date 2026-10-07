/** Width of a game standing spine-out on the shelf, and the gap between two. */
export const SPINE_W = 12;
export const SPINE_GAP = 2;
/** A spine is as tall as a cartridge. */
export const SPINE_H = 52;
export const BOOKEND_W = 8;
/** The cobweb in the archived corner, hanging from its top-right point. */
export const WEB_W = 64;
export const WEB_H = 46;

export interface ShelfLayout {
  /** Board width; the shelf is centred on the x it's given. */
  width: number;
  /** Left edge of the board. */
  left: number;
  /** Centre x of each finished game's spine, left to right. */
  finished: number[];
  /** Centre x of each archived game's spine, left to right, in the right-hand corner. */
  archived: number[];
  /** Centre x of the bookend between the two, when there are archived games. */
  bookend?: number;
  /** The dusty corner: from here to the right end of the board. */
  dustFrom: number;
  /** Top-right point of the cobweb (spine tops are at the board's top minus SPINE_H). */
  web: { x: number; y: number };
}

const PAD = 10;
/** The corner always has room for the web and the spider, even with no archived games. */
const MIN_CORNER = 56;
/** Space between the last finished game and the bookend. */
const MID_GAP = 18;

/**
 * Where everything stands on the shelf, centred on `cx`, with the board's top
 * at `top`. Finished games line up from the left; a bookend, then archived
 * games pushed into the dusty right-hand corner under the cobweb.
 */
export function shelfLayout(finished: number, archived: number, cx: number, top: number): ShelfLayout {
  const run = (n: number) => (n ? n * SPINE_W + (n - 1) * SPINE_GAP : 0);
  const corner = Math.max(MIN_CORNER, run(archived) + BOOKEND_W + 2 * SPINE_GAP + 14);
  const width = Math.max(160, PAD + run(finished) + MID_GAP + corner + PAD);
  const left = Math.round(cx - width / 2);
  const right = left + width;
  const step = SPINE_W + SPINE_GAP;
  const out: ShelfLayout = {
    width,
    left,
    finished: Array.from({ length: finished }, (_, i) => left + PAD + SPINE_W / 2 + i * step),
    archived: Array.from({ length: archived }, (_, i) => right - PAD - run(archived) + SPINE_W / 2 + i * step),
    dustFrom: right - corner - PAD / 2,
    web: { x: right - 2, y: top - SPINE_H - WEB_H + 8 },
  };
  if (archived) out.bookend = right - PAD - run(archived) - SPINE_GAP - BOOKEND_W / 2;
  return out;
}
