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
