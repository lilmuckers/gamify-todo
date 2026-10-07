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
/** Space at the ends of the top shelf. */
const DECOR_PAD = 8;
/** How often each easter egg turns up on the top shelf, per page load. */
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
export function shelfLayout(finished: number, archived: number, cx: number, top: number, minWidth = 240): ShelfLayout {
  const run = (n: number) => (n ? n * SPINE_W + (n - 1) * SPINE_GAP : 0);
  const corner = Math.max(MIN_CORNER, run(archived) + BOOKEND_W + 2 * SPINE_GAP + 14);
  // Wide enough for a good few ornaments on the top shelf, even with only a game or two.
  const width = Math.max(minWidth, PAD + run(finished) + MID_GAP + corner + PAD);
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
  /** A lean, in degrees: nothing up there was put back straight. */
  angle: number;
}

export interface TopShelf<K extends string> {
  /** In drawing order, back to front: a jumble, not left to right. */
  items: DecorPick<K>[];
  /** A 16 px hero centred here is hidden behind the books... */
  hide: number;
  /** ...and here leans PEEK_OUT px out past their left edge. */
  peek: number;
}

/** How many things clutter the top shelf. */
export const DECOR_MIN = 4;
export const DECOR_MAX = 5;

/**
 * What's left lying about on the top shelf. The books are always there (a
 * hero lives behind them); each easter egg turns up EGG_CHANCE of the time, or
 * always with `jam`; ordinary ornaments make it up to DECOR_MIN-DECOR_MAX
 * things. They're dumped untidily: uneven gaps, some overlapping, leaning a
 * little, in no particular depth order. `widths` gives every kind's width.
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
  const count = jam ? DECOR_MAX : DECOR_MIN + Math.floor(r() * (DECOR_MAX - DECOR_MIN + 1));
  const picked: K[] = [books];
  for (const egg of shuffle(eggs)) if (picked.length < count && (jam || r() < EGG_CHANCE)) picked.push(egg);
  for (const o of shuffle(ornaments)) if (picked.length < count) picked.push(o);

  // Left to right in a random order, but never the books first: the peeking hero needs room to their left.
  const rest = shuffle(picked.slice(1));
  const order = [rest[0], books, ...rest.slice(1)].filter((k): k is K => k !== undefined);
  const room = upper.width - 2 * DECOR_PAD;
  const total = order.reduce((n, k) => n + widths[k], 0);
  // Uneven gaps sharing out the spare room; when there isn't any, things overlap.
  const weights = order.slice(1).map(() => 0.2 + r());
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const spare = room - total;
  let x = upper.left + DECOR_PAD + (order.length === 1 ? spare / 2 : 0);
  const placed = order.map((kind, i) => {
    if (i > 0) x += (spare * weights[i - 1]) / sum + (r() - 0.6) * 10;
    const w = widths[kind];
    const cx = Math.round(Math.min(upper.left + upper.width - w / 2 - 2, Math.max(upper.left + w / 2 + 2, x + w / 2)));
    x += w;
    // Tall, thin things lean most; the books lean on their own.
    const angle = kind === books ? 0 : Math.round((r() - 0.5) * 2 * (w < 30 ? 7 : 3));
    return { kind, x: cx, angle };
  });
  const b = placed.find((p) => p.kind === books)!.x;
  // Roughly biggest at the back so little things aren't lost behind them, but jumbled: no neat rows.
  const depth = new Map(placed.map((p) => [p, widths[p.kind] * (0.6 + r() * 0.8)]));
  const items = [...placed].sort((p, q) => depth.get(q)! - depth.get(p)!);
  return { items, hide: b, peek: b - widths[books] / 2 - PEEK_OUT + 8 };
}
