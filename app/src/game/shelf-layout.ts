/** Width of a game standing spine-out on the shelf, and the gap between two. */
export const SPINE_W = 12;
export const SPINE_GAP = 2;
/** A spine is as tall as a cartridge. */
export const SPINE_H = 52;
export const BOOKEND_W = 8;
/** The cobweb in the archived corner, hanging from its top-right point. */
export const WEB_W = 64;
export const WEB_H = 46;
/** Thickness of a shelf board (its brackets hang below). */
export const BOARD_H = 7;
/** The pile of ornamental books on the top shelf, that a hero hides behind. */
export const DECOR_BOOKS_W = 30;
export const TROPHY_W = 14;
/** Space between ornaments on the top shelf, and at its ends. */
const DECOR_GAP = 7;
const DECOR_PAD = 12;
/** How often each easter egg turns up on the top shelf, per visit. */
export const EGG_CHANCE = 0.6;
/** How far a hero leans out from behind the books to peek. */
export const PEEK_OUT = 9;

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
  /** Top-right point of the cobweb, under the top shelf's right end. */
  web: { x: number; y: number };
  /**
   * The top shelf, just for show: the cobweb hangs from its underside. Things
   * stand on it at `top`; a hero hides behind the books and leans out to peek.
   */
  upper: { left: number; width: number; top: number };
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
  // Wide enough for a good few ornaments on the top shelf, even with only a game or two.
  const width = Math.max(240, PAD + run(finished) + MID_GAP + corner + PAD);
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
    // The top shelf runs the whole width, just above the web.
    upper: { left, width, top: top - SPINE_H - WEB_H + 8 - BOARD_H },
  };
  if (archived) out.bookend = right - PAD - run(archived) - SPINE_GAP - BOOKEND_W / 2;
  return out;
}

export interface DecorPick<K extends string> {
  kind: K;
  /** Centre x on the top shelf. */
  x: number;
}

export interface TopShelf<K extends string> {
  items: DecorPick<K>[];
  /** A 16 px hero centred here is hidden behind the books... */
  hide: number;
  /** ...and here leans PEEK_OUT px out past their left edge. */
  peek: number;
}

/**
 * What stands on the top shelf this visit. The books always do (a hero
 * lives behind them); each easter egg turns up EGG_CHANCE of the time, or
 * always with `jam`; ordinary ornaments fill the rest, shuffled, as many
 * as fit. `widths` gives every kind's width; `books` is the books' kind.
 */
export function topShelfDecor<K extends string>(
  upper: { left: number; width: number },
  widths: Record<K, number>,
  books: K,
  eggs: readonly K[],
  ornaments: readonly K[],
  r: () => number = Math.random,
  jam = false,
): TopShelf<K> {
  const shuffle = <T>(xs: readonly T[]) => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const room = upper.width - 2 * DECOR_PAD;
  const picked: K[] = [books];
  let used = widths[books];
  const tryAdd = (k: K) => {
    if (used + DECOR_GAP + widths[k] > room) return;
    picked.push(k);
    used += DECOR_GAP + widths[k];
  };
  for (const egg of shuffle(eggs)) if (jam || r() < EGG_CHANCE) tryAdd(egg);
  for (const o of shuffle(ornaments)) tryAdd(o);
  // Shuffle where things stand, but never put the books first: the peeking hero needs room to their left.
  const rest = shuffle(picked.slice(1));
  const order = rest.length ? [rest[0], books, ...rest.slice(1)] : [books];
  // Spread out evenly along the board.
  const spare = room - used;
  const gap = DECOR_GAP + (order.length > 1 ? spare / (order.length - 1) : 0);
  let x = upper.left + DECOR_PAD + (order.length > 1 ? 0 : spare / 2);
  const items = order.map((kind) => {
    const pick = { kind, x: Math.round(x + widths[kind] / 2) };
    x += widths[kind] + gap;
    return pick;
  });
  const b = items.find((i) => i.kind === books)!.x;
  return { items, hide: b, peek: b - widths[books] / 2 - PEEK_OUT + 8 };
}
