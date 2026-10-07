// The games shelf on the bedroom wall: spines, the board, a bookend, and the
// dusty corner's cobweb, spider and unlucky fly. All drawn in code.
import { seeded, type HeroId } from '@quest/shared';
import { canvas } from './canvas';
import { cartShell, drawText } from './cartridge';
import { heroKey } from './heroes';
import { PALETTE } from './pixels';
import { sprite } from './render';
import { SPINE_H, SPINE_W, BOOKEND_W, WEB_H, WEB_W } from '../game/shelf-layout';
import type { CartSpec } from './cartridge';

const K = PALETTE.k;
const WOOD = ['#e4a672', '#b86f50', '#743f39', '#3f2832'] as const;
const SILK = '#f4f4f4';

const cache = new Map<string, HTMLCanvasElement>();
const once = (key: string, draw: () => HTMLCanvasElement) => {
  let c = cache.get(key);
  if (!c) cache.set(key, (c = draw()));
  return c;
};

/** Characters that fit up a spine (3x5 font, 4 px each, below the cap). */
const SPINE_CHARS = 10;

/** A cartridge seen end-on, standing on the shelf: its shell colours, a label strip and the title running up it. */
export function cartSpine(spec: CartSpec, finished: boolean): HTMLCanvasElement {
  return once(`spine:${spec.seed}:${spec.title}:${finished}`, () => {
    const [hi, mid, lo] = cartShell(spec);
    const [cv, ctx] = canvas(SPINE_W, SPINE_H);
    ctx.fillStyle = K;
    ctx.fillRect(0, 0, SPINE_W, SPINE_H);
    ctx.fillStyle = mid;
    ctx.fillRect(1, 1, SPINE_W - 2, SPINE_H - 2);
    ctx.fillStyle = hi;
    ctx.fillRect(1, 1, 1, SPINE_H - 2);
    ctx.fillStyle = lo;
    ctx.fillRect(SPINE_W - 2, 1, 1, SPINE_H - 2);
    // A cap at the top: a star for a finished game.
    if (finished) {
      ctx.fillStyle = '#fee761';
      for (const [x, y] of [[5, 2], [6, 2], [4, 3], [5, 3], [6, 3], [7, 3], [5, 4], [6, 4], [4, 5], [7, 5]]) ctx.fillRect(x, y, 1, 1);
    } else {
      ctx.fillStyle = lo;
      ctx.fillRect(3, 3, SPINE_W - 6, 2);
    }
    // Label strip with the title running bottom to top, like a book.
    ctx.fillStyle = K;
    ctx.fillRect(2, 8, SPINE_W - 4, SPINE_H - 11);
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(3, 9, SPINE_W - 6, SPINE_H - 13);
    const title = spec.title.toUpperCase().replace(/[^A-Z0-9&!?\- ]/g, '').slice(0, SPINE_CHARS).trim();
    const [tc, tx] = canvas(SPINE_CHARS * 4, 5);
    drawText(tx, title, 0, 0, K);
    ctx.save();
    ctx.translate(4, SPINE_H - 5);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(tc, 0, 0);
    ctx.restore();
    return cv;
  });
}

/** Dust specks to lay over an archived spine, seeded so they don't shimmer between visits. */
export function spineDust(seed: string): HTMLCanvasElement {
  return once(`dust:${seed}`, () => {
    const r = seeded(`dust:${seed}`);
    const [cv, ctx] = canvas(SPINE_W, SPINE_H);
    ctx.fillStyle = 'rgba(192,203,220,0.55)';
    ctx.fillRect(0, 0, SPINE_W, 3);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = r() < 0.5 ? '#c0cbdc' : '#ead4aa';
      ctx.fillRect(Math.floor(r() * SPINE_W), Math.floor(r() * SPINE_H * (r() < 0.6 ? 0.35 : 1)), 1, 1);
    }
    return cv;
  });
}

/** The shelf board, `w` wide, with two brackets under it. */
export function shelfBoard(w: number): HTMLCanvasElement {
  return once(`board:${w}`, () => {
    const [cv, ctx] = canvas(w, 18);
    ctx.fillStyle = WOOD[3];
    ctx.fillRect(0, 0, w, 7);
    ctx.fillStyle = WOOD[1];
    ctx.fillRect(1, 1, w - 2, 5);
    ctx.fillStyle = WOOD[0];
    ctx.fillRect(1, 1, w - 2, 1);
    ctx.fillStyle = WOOD[2];
    for (let x = 8; x < w - 4; x += 23) ctx.fillRect(x, 3, 6, 1);
    for (const bx of [16, w - 22]) {
      ctx.fillStyle = WOOD[3];
      ctx.fillRect(bx, 7, 6, 11);
      ctx.fillStyle = WOOD[2];
      ctx.fillRect(bx + 1, 7, 4, 9);
    }
    return cv;
  });
}

/**
 * The shadow a shelf casts on the wall, stylised: a hard dark band right under
 * the board, fading out in a dither, with the brackets' shadows slanting off.
 * Drawn at the board's top-left, 4 px down and to the right.
 */
export function shelfShadow(w: number): HTMLCanvasElement {
  return once(`shadow:${w}`, () => {
    const H = 22;
    const [cv, ctx] = canvas(w + 4, H);
    const shade = (x: number, y: number, a: number) => {
      ctx.fillStyle = `rgba(26,28,44,${a})`;
      ctx.fillRect(x, y, 1, 1);
    };
    for (let x = 4; x < w + 4; x++) {
      for (let y = 7; y < 10; y++) shade(x, y, 0.4);
      for (let y = 10; y < 14; y++) if ((x + y) % 2 === 0) shade(x, y, 0.3);
      if ((x + 14) % 4 === 0) shade(x, 14, 0.25);
    }
    for (const bx of [16, w - 22])
      for (let y = 10; y < H; y++)
        for (let x = 0; x < 6; x++) if ((x + y) % 2 === 0 || y < 14) shade(bx + 4 + x + Math.floor((y - 10) / 3), y, 0.32);
    return cv;
  });
}

/** A grey dust drift along the board in the archived corner. */
export function dustPile(w: number): HTMLCanvasElement {
  return once(`pile:${w}`, () => {
    const r = seeded(`pile:${w}`);
    const [cv, ctx] = canvas(w, 3);
    for (let x = 0; x < w; x++) {
      const h = r() < 0.5 ? 1 : r() < 0.6 ? 2 : 0;
      ctx.fillStyle = r() < 0.5 ? '#c0cbdc' : '#8b9bb4';
      ctx.fillRect(x, 3 - h, 1, h);
    }
    return cv;
  });
}

/** An L-shaped metal bookend. */
export function bookend(): HTMLCanvasElement {
  return once('bookend', () => {
    const [cv, ctx] = canvas(BOOKEND_W, 34);
    ctx.fillStyle = K;
    ctx.fillRect(2, 0, 4, 34);
    ctx.fillRect(0, 30, BOOKEND_W, 4);
    ctx.fillStyle = '#8b9bb4';
    ctx.fillRect(3, 1, 2, 31);
    ctx.fillRect(1, 31, BOOKEND_W - 2, 2);
    ctx.fillStyle = '#c0cbdc';
    ctx.fillRect(3, 1, 1, 30);
    return cv;
  });
}

/** A cobweb hanging from its top-right corner: spokes out from the corner and sagging threads across. */
export function cobweb(): HTMLCanvasElement {
  return once('cobweb', () => {
    const [cv, ctx] = canvas(WEB_W, WEB_H);
    const dot = (x: number, y: number) => {
      if (x >= 0 && y >= 0 && x < WEB_W && y < WEB_H) ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    };
    const ox = WEB_W - 1;
    ctx.fillStyle = SILK;
    ctx.globalAlpha = 0.75;
    const spokes = [180, 162, 140, 118, 96];
    for (const deg of spokes) {
      const a = (deg * Math.PI) / 180;
      for (let d = 0; d < 90; d += 0.7) dot(ox + Math.cos(a) * d, Math.sin(a) * d);
    }
    ctx.globalAlpha = 0.6;
    for (const ring of [10, 20, 31, 43, 56]) {
      for (let s = 0; s < spokes.length - 1; s++) {
        const a0 = (spokes[s] * Math.PI) / 180;
        const a1 = (spokes[s + 1] * Math.PI) / 180;
        for (let t = 0; t <= 1; t += 0.04) {
          // Threads sag towards the corner between spokes.
          const sag = 1 - Math.sin(t * Math.PI) * 0.12;
          const a = a0 + (a1 - a0) * t;
          dot(ox + Math.cos(a) * ring * sag, Math.sin(a) * ring * sag);
        }
      }
    }
    // A torn strand drifting down.
    ctx.globalAlpha = 0.5;
    for (let y = 30; y < WEB_H; y++) dot(14 + Math.sin(y / 3), y);
    return cv;
  });
}

/** The spider: a round black body, red eyes and four legs a side, in two walking frames. */
export function spider(frame: 0 | 1): HTMLCanvasElement {
  return once(`spider:${frame}`, () => {
    const [cv, ctx] = canvas(9, 8);
    const px = (c: string, cells: number[][]) => {
      ctx.fillStyle = c;
      for (const [x, y] of cells) ctx.fillRect(x, y, 1, 1);
    };
    px(K, [[3, 1], [4, 1], [5, 1], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [3, 4], [4, 4], [5, 4], [4, 0]]);
    px('#e43b44', [[3, 2], [5, 2]]);
    px('#5a6988', [[4, 3]]);
    const legs = frame
      ? [[1, 1], [0, 0], [1, 3], [0, 4], [7, 2], [8, 1], [7, 4], [8, 5], [2, 5], [1, 6], [6, 5], [7, 7]]
      : [[1, 2], [0, 1], [1, 4], [0, 5], [7, 1], [8, 0], [7, 3], [8, 4], [2, 5], [2, 7], [6, 5], [6, 6]];
    px(K, legs);
    return cv;
  });
}

/** A tiny winged hero (half size), buzzing: the spider's lunch. */
export function heroFly(hero: HeroId, wings: 0 | 1): HTMLCanvasElement {
  return once(`fly:${hero}:${wings}`, () => {
    const [cv, ctx] = canvas(14, 10);
    ctx.fillStyle = wings ? 'rgba(244,244,244,0.9)' : 'rgba(44,232,245,0.7)';
    if (wings) {
      ctx.fillRect(0, 1, 3, 2);
      ctx.fillRect(11, 1, 3, 2);
    } else {
      ctx.fillRect(1, 3, 3, 2);
      ctx.fillRect(10, 3, 3, 2);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite(heroKey(hero, 'jump')), 0, 0, 16, 16, 3, 1, 8, 8);
    return cv;
  });
}

/** Silk wound round the fly once it's caught. */
export function cocoon(): HTMLCanvasElement {
  return once('cocoon', () => {
    const [cv, ctx] = canvas(8, 10);
    ctx.fillStyle = '#c0cbdc';
    ctx.fillRect(1, 0, 6, 10);
    ctx.fillRect(0, 1, 8, 8);
    ctx.fillStyle = SILK;
    for (let y = 1; y < 10; y += 2) ctx.fillRect(y % 4 === 1 ? 1 : 0, y, 7, 1);
    return cv;
  });
}

/** One spun letter of WEB_WORDS, in silk. */
export function silkLetter(ch: string): HTMLCanvasElement {
  return once(`silk:${ch}`, () => {
    const [cv, ctx] = canvas(3, 5);
    drawText(ctx, ch, 0, 0, SILK);
    return cv;
  });
}


// ---- The top shelf: ornaments at the bedroom's own scale ----
// A cartridge is 52 px tall for about 13 cm, so roughly 4 px to the
// centimetre: a desk globe is huge, a pocket pet is tiny. Everything is drawn
// at that size, 1 px to the pixel like the rest of the room, never scaled up.

type Ctx = CanvasRenderingContext2D;

const fill = (ctx: Ctx, c: string, x: number, y: number, w: number, h: number) => {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

/** A filled ellipse, row by row so its edge stays pixel-crisp. */
function oval(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, c: string) {
  ctx.fillStyle = c;
  for (let y = -ry; y <= ry; y++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
    ctx.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2 + 1, 1);
  }
}

/** An ellipse with a 1 px black outline. */
const ring = (ctx: Ctx, cx: number, cy: number, rx: number, ry: number, c: string) => {
  oval(ctx, cx, cy, rx + 1, ry + 1, K);
  oval(ctx, cx, cy, rx, ry, c);
};

/** A box with a 1 px black outline. */
const box = (ctx: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  fill(ctx, K, x, y, w, h);
  fill(ctx, c, x + 1, y + 1, w - 2, h - 2);
};

/** A shape narrowing (or widening) from `w0` at row y0 to `w1` at row y1, centred on cx, outlined. */
function taper(ctx: Ctx, cx: number, y0: number, y1: number, w0: number, w1: number, c: string) {
  for (let y = y0; y <= y1; y++) {
    const w = Math.round(w0 + ((w1 - w0) * (y - y0)) / Math.max(1, y1 - y0));
    fill(ctx, K, cx - w / 2 - 1, y, w + 2, 1);
    fill(ctx, c, cx - w / 2, y, w, 1);
  }
  fill(ctx, K, cx - w0 / 2, y0 - 1, w0, 1);
  fill(ctx, K, cx - w1 / 2, y1 + 1, w1, 1);
}

/** Dust over whatever's been left up there: a film on the upward faces and specks, more on bigger things. */
function dusting(ctx: Ctx, w: number, h: number, seed: string) {
  const r = seeded(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const solid = (x: number, y: number) => img.data[(y * w + x) * 4 + 3] > 0;
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++)
      if (solid(x, y)) {
        // The top edge of each column gathers a grey film.
        if (r() < 0.7) fill(ctx, 'rgba(192,203,220,0.8)', x, y + 1, 1, 1);
        break;
      }
  for (let i = 0; i < (w * h) / 22; i++) {
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * h * (r() < 0.7 ? 0.5 : 1));
    if (solid(x, y)) fill(ctx, r() < 0.6 ? 'rgba(192,203,220,0.85)' : 'rgba(234,212,170,0.8)', x, y, 1, 1);
  }
}

/** Draws on a fresh `w` x `h` canvas, then lets the dust settle on it. */
const ornament = (name: string, w: number, h: number, draw: (ctx: Ctx, r: () => number) => void) => () => {
  const [cv, ctx] = canvas(w, h);
  draw(ctx, seeded(name));
  dusting(ctx, w, h, name);
  return cv;
};

/** Hardbacks, ~24 cm: standing, one leaning, one lying across the top. A hero lives behind them. */
const books = ornament('books', 66, 94, (ctx) => {
  const H = 94;
  const stand: [number, number, number, string, string][] = [
    // x, width, height, cover, band
    [0, 13, 88, '#a22633', '#feae34'],
    [13, 11, 92, '#265c42', '#ead4aa'],
    [24, 15, 84, '#124e89', '#c0cbdc'],
    [39, 9, 78, '#68386c', '#feae34'],
  ];
  for (const [x, w, h, cover, band] of stand) {
    box(ctx, x, H - h, w, h, cover);
    fill(ctx, band, x + 1, H - h + 8, w - 2, 2);
    fill(ctx, band, x + 1, H - 12, w - 2, 2);
    fill(ctx, 'rgba(244,244,244,0.25)', x + 2, H - h + 2, 1, h - 4);
    fill(ctx, band, x + 3, H - h + 20, w - 6, 1);
    fill(ctx, band, x + 3, H - h + 23, w - 6, 1);
  }
  // The last one has slumped back against the others.
  ctx.save();
  ctx.translate(65, H);
  ctx.rotate(-0.3);
  box(ctx, -12, -76, 12, 76, '#743f39');
  fill(ctx, '#fee761', -11, -68, 10, 2);
  fill(ctx, '#fee761', -11, -12, 10, 2);
  ctx.restore();
});

/** A gold cup, ~18 cm, from some long-ago win. */
const trophy = ornament('trophy', 46, 72, (ctx) => {
  // Handles first, so the cup sits over them.
  for (const x of [0, 34]) {
    box(ctx, x, 6, 12, 22, '#c67a14');
    ctx.clearRect(x + 3, 9, 6, 16);
  }
  taper(ctx, 23, 2, 34, 32, 14, '#feae34');
  fill(ctx, '#fee761', 12, 4, 3, 24);
  fill(ctx, '#c67a14', 31, 4, 3, 24);
  taper(ctx, 23, 35, 48, 6, 6, '#c67a14');
  taper(ctx, 23, 49, 54, 14, 22, '#feae34');
  box(ctx, 8, 55, 30, 17, '#743f39');
  fill(ctx, '#c0cbdc', 14, 61, 18, 5);
  fill(ctx, '#8b9bb4', 16, 63, 14, 1);
});

/** A desk globe, ~28 cm: a big blue planet on a brass meridian and a stand. */
const globe = ornament('globe', 80, 110, (ctx, r) => {
  const cx = 40;
  const cy = 42;
  const R = 32;
  // The meridian ring behind and round the left of the globe.
  oval(ctx, cx, cy, R + 6, R + 6, K);
  oval(ctx, cx, cy, R + 5, R + 5, '#c67a14');
  oval(ctx, cx, cy, R + 3, R + 3, K);
  ctx.clearRect(cx + 4, 0, 80, 110);
  ring(ctx, cx, cy, R, R, '#0099db');
  // Land from a few overlapping waves, so every globe isn't the same blobs.
  const a = r() * 6;
  const b = r() * 6;
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      const d = x * x + y * y;
      if (d >= R * R) continue;
      const land = Math.sin(x / 7 + a) + Math.sin(y / 5 + b) + Math.sin((x + y) / 9) > 0.9;
      const shade = x + y > R * 0.75;
      if (land) fill(ctx, shade ? '#3e8948' : '#63c74d', cx + x, cy + y, 1, 1);
      else if (shade) fill(ctx, '#124e89', cx + x, cy + y, 1, 1);
    }
  oval(ctx, cx - 12, cy - 14, 4, 3, 'rgba(244,244,244,0.6)');
  // Axis pins top and bottom, and the stand.
  fill(ctx, K, cx - 1, cy - R - 6, 3, 5);
  fill(ctx, K, cx - 1, cy + R + 2, 3, 6);
  taper(ctx, cx, cy + R + 8, 100, 5, 7, '#c67a14');
  oval(ctx, cx, 104, 26, 5, K);
  oval(ctx, cx, 104, 25, 4, '#743f39');
  fill(ctx, '#b86f50', cx - 18, 101, 36, 1);
});

/** A snow globe, ~10 cm: a cabin and a tree in a flurry. */
const snowGlobe = ornament('snow-globe', 36, 42, (ctx, r) => {
  ring(ctx, 18, 16, 15, 15, '#a8d8ea');
  oval(ctx, 18, 26, 13, 4, '#f4f4f4');
  // A tree and a little cabin.
  for (let y = 0; y < 12; y++) fill(ctx, '#3e8948', 9 - y / 3, 10 + y, 1 + (y * 2) / 3, 1);
  fill(ctx, '#743f39', 8, 22, 2, 3);
  box(ctx, 18, 17, 10, 8, '#be4a2f');
  fill(ctx, '#fee761', 21, 20, 3, 3);
  for (let i = 0; i < 18; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * 13;
    fill(ctx, '#f4f4f4', 18 + Math.cos(a) * d, 15 + Math.sin(a) * d, 1, 1);
  }
  fill(ctx, 'rgba(244,244,244,0.7)', 10, 6, 3, 2);
  box(ctx, 4, 30, 28, 12, '#b55088');
  fill(ctx, '#68386c', 5, 38, 26, 3);
});

/** A cactus in a terracotta pot, ~15 cm, with one pink flower. */
const cactus = ornament('cactus', 38, 60, (ctx, r) => {
  // Arms, then the trunk over them.
  box(ctx, 3, 18, 8, 16, '#3e8948');
  box(ctx, 3, 30, 14, 8, '#3e8948');
  box(ctx, 27, 12, 8, 14, '#3e8948');
  box(ctx, 22, 22, 13, 8, '#3e8948');
  box(ctx, 13, 4, 12, 38, '#3e8948');
  oval(ctx, 19, 5, 6, 3, '#3e8948');
  fill(ctx, '#63c74d', 15, 6, 2, 34);
  for (let i = 0; i < 30; i++) fill(ctx, '#ead4aa', 4 + r() * 30, 6 + r() * 34, 1, 1);
  oval(ctx, 19, 2, 3, 2, '#f6757a');
  fill(ctx, '#fee761', 19, 2, 1, 1);
  taper(ctx, 19, 40, 59, 30, 22, '#be4a2f');
  fill(ctx, K, 3, 44, 32, 1);
  fill(ctx, '#743f39', 6, 40, 26, 2);
});

/** A twin-bell alarm clock, ~12 cm, stopped years ago. */
const alarmClock = ornament('alarm-clock', 44, 48, (ctx) => {
  ring(ctx, 9, 8, 7, 6, '#feae34');
  ring(ctx, 35, 8, 7, 6, '#feae34');
  fill(ctx, K, 21, 2, 3, 8);
  ring(ctx, 22, 27, 18, 17, '#e43b44');
  ring(ctx, 22, 27, 14, 13, '#f4f4f4');
  for (const [x, y] of [[22, 16], [33, 27], [22, 38], [11, 27]]) fill(ctx, K, x, y, 1, 2);
  fill(ctx, K, 22, 19, 1, 9);
  fill(ctx, K, 22, 27, 7, 1);
  fill(ctx, K, 8, 42, 4, 6);
  fill(ctx, K, 32, 42, 4, 6);
});

/** A china piggy bank, ~12 cm long, coin slot on top. */
const piggyBank = ornament('piggy-bank', 56, 40, (ctx) => {
  for (const x of [12, 20, 34, 42]) box(ctx, x, 30, 6, 10, '#f6757a');
  ring(ctx, 27, 20, 23, 14, '#f6757a');
  oval(ctx, 22, 14, 10, 4, '#fbb1b4');
  ring(ctx, 50, 21, 5, 5, '#b55088');
  fill(ctx, K, 48, 20, 1, 2);
  fill(ctx, K, 51, 20, 1, 2);
  for (let y = 0; y < 7; y++) fill(ctx, K, 36 + y / 2, 3 + y, 4, 1);
  fill(ctx, K, 40, 13, 2, 2);
  fill(ctx, K, 20, 6, 12, 2);
  fill(ctx, '#3a4466', 21, 6, 10, 1);
  fill(ctx, K, 2, 16, 3, 1);
  fill(ctx, K, 1, 14, 1, 2);
});

/** A lava lamp, ~30 cm, its blobs long since settled. */
const lavaLamp = ornament('lava-lamp', 32, 114, (ctx) => {
  taper(ctx, 16, 2, 16, 10, 14, '#8b9bb4');
  taper(ctx, 16, 18, 76, 14, 22, '#b55088');
  oval(ctx, 16, 70, 8, 5, '#feae34');
  oval(ctx, 13, 50, 4, 6, '#feae34');
  oval(ctx, 19, 32, 3, 4, '#feae34');
  fill(ctx, 'rgba(244,244,244,0.3)', 11, 22, 2, 46);
  taper(ctx, 16, 78, 112, 14, 30, '#8b9bb4');
  fill(ctx, '#c0cbdc', 10, 82, 2, 28);
});

/** A model rocket, ~26 cm, on its launch stand. */
const rocket = ornament('rocket', 26, 106, (ctx) => {
  for (let y = 0; y < 22; y++) {
    const w = 2 + Math.round((y * 12) / 22);
    fill(ctx, K, 13 - w / 2 - 1, y, w + 2, 1);
    fill(ctx, '#e43b44', 13 - w / 2, y, w, 1);
  }
  box(ctx, 6, 21, 15, 66, '#f4f4f4');
  ring(ctx, 13, 36, 4, 4, '#2ce8f5');
  fill(ctx, '#e43b44', 7, 56, 13, 4);
  fill(ctx, '#c0cbdc', 18, 22, 2, 64);
  for (const side of [-1, 1])
    for (let y = 0; y < 18; y++) {
      const w = Math.round(y / 3);
      fill(ctx, K, side < 0 ? 5 - w - 1 : 21, 70 + y, w + 2, 1);
      fill(ctx, '#e43b44', side < 0 ? 5 - w : 21, 70 + y, w, 1);
    }
  box(ctx, 9, 87, 9, 6, '#5a6988');
  fill(ctx, K, 12, 93, 2, 8);
  box(ctx, 1, 100, 24, 6, '#3a4466');
});

/** A twenty-sided die, ~2 cm: tiny. */
const d20 = ornament('d20', 9, 9, (ctx) => {
  oval(ctx, 4, 4, 4, 4, K);
  oval(ctx, 4, 4, 3, 3, '#e43b44');
  fill(ctx, K, 2, 5, 5, 1);
  fill(ctx, K, 4, 2, 1, 3);
  fill(ctx, '#f4f4f4', 3, 6, 1, 1);
});

/** A holiday snap of the classic hero at the seaside, in a gilt frame (~10 x 13 cm). */
const photo = ornament('photo', 40, 52, (ctx) => {
  box(ctx, 0, 0, 40, 50, '#c67a14');
  fill(ctx, '#feae34', 2, 2, 36, 1);
  box(ctx, 5, 5, 30, 40, '#f4f4f4');
  fill(ctx, '#2ce8f5', 7, 7, 26, 18);
  fill(ctx, '#0099db', 7, 25, 26, 8);
  fill(ctx, '#fee761', 7, 33, 26, 10);
  oval(ctx, 28, 12, 3, 3, '#fee761');
  ctx.drawImage(sprite(heroKey('classic')), 12, 25);
  fill(ctx, K, 26, 50, 10, 2);
});

/** A jar of marbles, ~12 cm. */
const marbles = ornament('marbles', 40, 48, (ctx, r) => {
  box(ctx, 6, 0, 28, 7, '#8b9bb4');
  fill(ctx, '#c0cbdc', 7, 1, 26, 1);
  box(ctx, 2, 6, 36, 42, '#3a4466');
  fill(ctx, 'rgba(168,216,234,0.25)', 3, 7, 34, 40);
  const colors = ['#e43b44', '#0099db', '#63c74d', '#fee761', '#f4f4f4', '#b55088', '#feae34'];
  for (let i = 0; i < 46; i++) {
    const x = 6 + r() * 28;
    const y = 18 + Math.sqrt(r()) * 25;
    oval(ctx, x, y, 2, 2, colors[Math.floor(r() * colors.length)]);
    fill(ctx, 'rgba(244,244,244,0.7)', x - 1, y - 1, 1, 1);
  }
  fill(ctx, 'rgba(244,244,244,0.4)', 5, 9, 2, 34);
});

/** A twisty puzzle cube, ~6 cm, never solved. */
const puzzleCube = ornament('puzzle-cube', 23, 23, (ctx, r) => {
  fill(ctx, K, 0, 0, 23, 23);
  const colors = ['#e43b44', '#f4f4f4', '#0099db', '#fee761', '#63c74d', '#feae34'];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) fill(ctx, colors[Math.floor(r() * 6)], 1 + x * 7, 1 + y * 7, 6, 6);
});

/** A pocket pet on a keychain, ~5 cm: small. */
const petEgg = ornament('pet-egg', 16, 20, (ctx) => {
  ring(ctx, 8, 11, 7, 8, '#b55088');
  box(ctx, 4, 6, 9, 7, '#9fbf8f');
  fill(ctx, K, 7, 8, 1, 1);
  fill(ctx, K, 10, 8, 1, 1);
  fill(ctx, K, 8, 10, 2, 1);
  for (const x of [4, 8, 12]) fill(ctx, '#f4f4f4', x, 15, 2, 2);
  fill(ctx, '#c0cbdc', 7, 0, 3, 3);
});

// ---- Easter eggs ----

/** A ginger cat curled up asleep, ~30 cm, dreaming in z's. */
const sleepingCat = ornament('sleeping-cat', 104, 48, (ctx) => {
  ring(ctx, 50, 32, 42, 15, '#feae34');
  for (let x = 20; x < 80; x += 9) fill(ctx, '#c67a14', x, 19, 3, 8);
  ring(ctx, 84, 32, 14, 12, '#feae34');
  // Ears.
  for (const [x, dir] of [[76, -1], [90, 1]] as const)
    for (let y = 0; y < 8; y++) fill(ctx, y === 0 ? K : '#feae34', x + (dir < 0 ? y / 2 : 0), 14 + y, 8 - y, 1);
  fill(ctx, K, 78, 32, 4, 1);
  fill(ctx, K, 87, 32, 4, 1);
  fill(ctx, '#f6757a', 84, 36, 2, 1);
  // The tail wrapped round the front.
  ring(ctx, 46, 44, 30, 3, '#c67a14');
  drawText(ctx, 'Z', 92, 0, '#c0cbdc');
  drawText(ctx, 'Z', 98, 6, '#c0cbdc');
});

/** The floor sock's missing pair, lying here all along (~25 cm). */
const otherSock = ornament('other-sock', 84, 28, (ctx) => {
  box(ctx, 0, 4, 58, 20, '#f4f4f4');
  for (const x of [4, 12, 20]) fill(ctx, '#e43b44', x, 5, 4, 18);
  ring(ctx, 66, 16, 16, 10, '#f4f4f4');
  fill(ctx, '#c0cbdc', 58, 24, 18, 2);
  oval(ctx, 74, 12, 5, 5, '#e43b44');
});

/** A portrait of the spider downstairs, with a brass plate: spider of the month. */
const spiderOfTheMonth = ornament('spider-of-the-month', 40, 52, (ctx) => {
  box(ctx, 0, 0, 40, 50, '#c67a14');
  fill(ctx, '#feae34', 2, 2, 36, 1);
  box(ctx, 5, 5, 30, 34, '#5a6988');
  fill(ctx, '#3a4466', 6, 30, 28, 8);
  // A painting, so it can be as big as it likes.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spider(0), 0, 0, 9, 8, 7, 9, 27, 24);
  box(ctx, 10, 41, 20, 6, '#fee761');
  fill(ctx, '#c67a14', 12, 43, 16, 2);
  fill(ctx, K, 26, 50, 10, 2);
});

/** An extra life, saved in a jar for a rainy day (~12 cm). */
const spareLife = ornament('spare-life', 40, 48, (ctx) => {
  box(ctx, 6, 0, 28, 7, '#8b9bb4');
  box(ctx, 2, 6, 36, 42, '#3a4466');
  fill(ctx, 'rgba(99,199,77,0.18)', 3, 7, 34, 40);
  // A heart: two circles and a point.
  oval(ctx, 14, 20, 6, 6, K);
  oval(ctx, 26, 20, 6, 6, K);
  for (let y = 0; y < 14; y++) fill(ctx, K, 7 + y, 21 + y, 26 - y * 2, 1);
  oval(ctx, 14, 20, 5, 5, '#63c74d');
  oval(ctx, 26, 20, 5, 5, '#63c74d');
  for (let y = 0; y < 12; y++) fill(ctx, '#63c74d', 9 + y, 21 + y, 22 - y * 2, 1);
  fill(ctx, '#f4f4f4', 11, 17, 2, 2);
  drawText(ctx, '1UP', 14, 38, '#fee761');
  fill(ctx, 'rgba(244,244,244,0.4)', 5, 9, 2, 34);
});

/** Ornaments for the top shelf: a few of these, picked fresh on each page load. */
export const ORNAMENTS = [
  'trophy', 'globe', 'snow-globe', 'cactus', 'alarm-clock', 'piggy-bank', 'lava-lamp',
  'rocket', 'd20', 'photo', 'marbles', 'puzzle-cube', 'pet-egg',
] as const;
/** Easter eggs: each turns up on some page loads only (all of them with ?jam). */
export const SHELF_EGGS = ['sleeping-cat', 'other-sock', 'spider-of-the-month', 'spare-life'] as const;
export type DecorKind = 'books' | (typeof ORNAMENTS)[number] | (typeof SHELF_EGGS)[number];

const DECOR_DRAW: Record<DecorKind, () => HTMLCanvasElement> = {
  books,
  trophy,
  globe,
  'snow-globe': snowGlobe,
  cactus,
  'alarm-clock': alarmClock,
  'piggy-bank': piggyBank,
  'lava-lamp': lavaLamp,
  rocket,
  d20,
  photo,
  marbles,
  'puzzle-cube': puzzleCube,
  'pet-egg': petEgg,
  'sleeping-cat': sleepingCat,
  'other-sock': otherSock,
  'spider-of-the-month': spiderOfTheMonth,
  'spare-life': spareLife,
};

/** A top-shelf ornament or easter egg. */
export const decorCanvas = (kind: DecorKind) => once(`decor:${kind}`, DECOR_DRAW[kind]);
