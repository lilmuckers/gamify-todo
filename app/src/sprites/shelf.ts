// The games shelf on the bedroom wall: spines, the board, a bookend, and the
// dusty corner's cobweb, spider and unlucky fly. All drawn in code.
import { seeded, type HeroId } from '@quest/shared';
import { canvas } from './canvas';
import { cartShell, drawText } from './cartridge';
import { heroKey } from './heroes';
import { PALETTE } from './pixels';
import { sprite } from './render';
import { SPINE_H, SPINE_W, BOOKEND_W, DECOR_BOOKS_W, TROPHY_W, WEB_H, WEB_W } from '../game/shelf-layout';
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

/** Dust on whatever's been left on the top shelf: a grey film along the tops, and specks. */
function dusting(ctx: CanvasRenderingContext2D, w: number, h: number, seed: string) {
  const r = seeded(seed);
  for (let i = 0; i < w * 1.5; i++) {
    ctx.fillStyle = r() < 0.6 ? 'rgba(192,203,220,0.85)' : 'rgba(234,212,170,0.8)';
    ctx.fillRect(Math.floor(r() * w), Math.floor(r() * h * 0.6), 1, 1);
  }
}

/** Old books nobody reads, standing and leaning, for the top shelf. Just for show. */
export function decorBooks(): HTMLCanvasElement {
  return once('decor-books', () => {
    const H = 24;
    const [cv, ctx] = canvas(DECOR_BOOKS_W, H);
    const books: [number, number, number, string, string][] = [
      // x, width, height, cover, band
      [0, 6, 20, '#a22633', '#feae34'],
      [6, 5, 23, '#265c42', '#ead4aa'],
      [11, 7, 21, '#124e89', '#c0cbdc'],
      [18, 4, 18, '#68386c', '#feae34'],
    ];
    for (const [x, w, h, cover, band] of books) {
      ctx.fillStyle = K;
      ctx.fillRect(x, H - h, w, h);
      ctx.fillStyle = cover;
      ctx.fillRect(x + 1, H - h + 1, w - 2, h - 2);
      ctx.fillStyle = band;
      ctx.fillRect(x + 1, H - h + 4, w - 2, 1);
      ctx.fillRect(x + 1, H - 5, w - 2, 1);
    }
    // The last one has slumped against its neighbours.
    ctx.save();
    ctx.translate(23, H);
    ctx.rotate(0.35);
    ctx.fillStyle = K;
    ctx.fillRect(0, -17, 6, 17);
    ctx.fillStyle = '#743f39';
    ctx.fillRect(1, -16, 4, 15);
    ctx.fillStyle = '#fee761';
    ctx.fillRect(1, -12, 4, 1);
    ctx.restore();
    dusting(ctx, DECOR_BOOKS_W, H, 'decor-books');
    return cv;
  });
}

/** A gold cup from some long-ago win, gone dull under the dust. */
export function trophy(): HTMLCanvasElement {
  return once('trophy', () => {
    const H = 20;
    const [cv, ctx] = canvas(TROPHY_W, H);
    const px = (c: string, x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    };
    // Cup, handles, stem and a plinth.
    px(K, 2, 0, 10, 9);
    px(K, 0, 1, 3, 5);
    px(K, 11, 1, 3, 5);
    px('#c67a14', 3, 1, 8, 7);
    px('#feae34', 3, 1, 3, 6);
    px('#c67a14', 1, 2, 1, 3);
    px('#c67a14', 12, 2, 1, 3);
    px(K, 5, 9, 4, 4);
    px('#c67a14', 6, 9, 2, 4);
    px(K, 2, 13, 10, 7);
    px('#743f39', 3, 14, 8, 5);
    px('#c0cbdc', 5, 16, 4, 1);
    dusting(ctx, TROPHY_W, H, 'trophy');
    return cv;
  });
}

/** Paints a character map: each character is a colour from `colors` ('.' is clear). */
function paintMap(rows: string[], colors: Record<string, string>): HTMLCanvasElement {
  const w = Math.max(...rows.map((r) => r.length));
  const [cv, ctx] = canvas(w, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x] === 'k' ? K : colors[row[x]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return cv;
}

/** A map painted, then left to gather dust. */
const dusty = (name: string, rows: string[], colors: Record<string, string>) => () => {
  const cv = paintMap(rows, colors);
  dusting(cv.getContext('2d')!, cv.width, cv.height, name);
  return cv;
};

/** A small framed picture of `draw`, for the wall of the top shelf. */
function framed(name: string, draw: (ctx: CanvasRenderingContext2D) => void, plate?: string) {
  return () => {
    const [cv, ctx] = canvas(14, 17);
    ctx.fillStyle = K;
    ctx.fillRect(0, 0, 14, 16);
    ctx.fillStyle = '#c67a14';
    ctx.fillRect(1, 1, 12, 14);
    ctx.fillStyle = '#ead4aa';
    ctx.fillRect(3, 3, 8, 9);
    ctx.save();
    ctx.beginPath();
    ctx.rect(3, 3, 8, 9);
    ctx.clip();
    draw(ctx);
    ctx.restore();
    if (plate) {
      ctx.fillStyle = '#fee761';
      ctx.fillRect(4, 13, 6, 1);
    }
    // A little stand at the back.
    ctx.fillStyle = K;
    ctx.fillRect(9, 16, 4, 1);
    dusting(ctx, 14, 17, name);
    return cv;
  };
}

/** Ornaments for the top shelf: always some of these, shuffled each visit. */
export const ORNAMENTS = [
  'trophy', 'globe', 'snow-globe', 'cactus', 'alarm-clock', 'piggy-bank', 'lava-lamp',
  'rocket', 'd20', 'photo', 'marbles', 'puzzle-cube', 'pet-egg',
] as const;
/** Easter eggs: each turns up on some visits only (all of them with ?jam). */
export const SHELF_EGGS = ['sleeping-cat', 'other-sock', 'spider-of-the-month', 'spare-life'] as const;
export type DecorKind = 'books' | (typeof ORNAMENTS)[number] | (typeof SHELF_EGGS)[number];

const DECOR_DRAW: Record<DecorKind, () => HTMLCanvasElement> = {
  books: decorBooks,
  trophy,
  globe: dusty('globe', [
    '....kkkk....',
    '..kkbbggkk..',
    '.kbbbggbbbk.',
    '.kbggbbbggk.',
    'kbbggggbbbbk',
    'kbbbggbbbggk',
    'kbbbbbbbggbk',
    '.kbggbbbbbk.',
    '.kbbggbbbbk.',
    '..kkbbbbkk..',
    '....kkkk....',
    '.....kk.....',
    '.....kk.....',
    '....kyyk....',
    '...kyyyyk...',
    '..kkkkkkkk..',
  ], { b: '#0099db', g: '#63c74d', y: '#c67a14' }),
  'snow-globe': dusty('snow-globe', [
    '...kkkkkk...',
    '..kllwlllk..',
    '.kwllllwllk.',
    '.klllgglllk.',
    '.kllggggwlk.',
    '.kwgggggglk.',
    '.klllhhlllk.',
    '..kwlhhllk..',
    '...kkkkkk...',
    '..kddddddk..',
    '..kdwddwdk..',
    '..kkkkkkkk..',
  ], { l: '#a8d8ea', w: '#f4f4f4', g: '#3e8948', h: '#743f39', d: '#b55088' }),
  cactus: dusty('cactus', [
    '....kk....',
    '...kggk...',
    '.k.kggk...',
    'kgkkgwk.k.',
    'kggkggkkgk',
    '.kggggkggk',
    '..kggggggk',
    '...kgggkk.',
    '...kgggk..',
    '...kgwgk..',
    '.kkkkkkkk.',
    '.kooooook.',
    '..kooook..',
    '..kooook..',
    '...kkkk...',
  ], { g: '#3e8948', w: '#63c74d', o: '#be4a2f' }),
  'alarm-clock': dusty('alarm-clock', [
    '.kk......kk.',
    'kyyk....kyyk',
    'kyyykkkkyyyk',
    '.kkrrrrrrkk.',
    '.krwwwwwwrk.',
    'krwwwkwwwwrk',
    'krwwwkwwwwrk',
    'krwwwkkkwwrk',
    'krwwwwwwwwrk',
    '.krwwwwwwrk.',
    '..krrrrrrk..',
    '.kk.kkkk.kk.',
  ], { y: '#feae34', r: '#e43b44', w: '#f4f4f4' }),
  'piggy-bank': dusty('piggy-bank', [
    '.....kkkk.k.....',
    '...kkppppkpk....',
    '..kpppppppppkk..',
    '.kppppkkpppppwk.',
    'kpppppppppppppk.',
    'kpppppppppppkppk',
    'kppppppppppppppk',
    '.kppppppppppppk.',
    '..kpkkkkkkkkpk..',
    '..kpk......kpk..',
    '..kkk......kkk..',
  ], { p: '#f6757a', w: '#f4f4f4' }),
  'lava-lamp': dusty('lava-lamp', [
    '...kk...',
    '..kssk..',
    '..kssk..',
    '.kllllk.',
    '.kloolk.',
    '.kloolk.',
    '.kllllk.',
    'kllllllk',
    'klllollk',
    'kllooolk',
    'kllllllk',
    'kloollllk',
    'kllllllk',
    '.kllllk.',
    '.kssssk.',
    'kssssssk',
    'kssssssk',
    'kkkkkkkk',
  ], { s: '#8b9bb4', l: '#b55088', o: '#feae34' }),
  rocket: dusty('rocket', [
    '...kk...',
    '..krrk..',
    '..kwwk..',
    '.kwwwwk.',
    '.kwbbwk.',
    '.kwbbwk.',
    '.kwwwwk.',
    '.kwwwwk.',
    '.kwrrwk.',
    '.kwwwwk.',
    'krkwwkrk',
    'krkwwkrk',
    'krrkkrrk',
    'kk.ss.kk',
    '...ss...',
    '.kkkkkk.',
  ], { r: '#e43b44', w: '#f4f4f4', b: '#0099db', s: '#5a6988' }),
  d20: dusty('d20', [
    '....kkk....',
    '..kkrrrkk..',
    '.krrkrkrrk.',
    'krrkrrrkrrk',
    'krkrwwwrkrk',
    'kkrrwrwrrkk',
    'krkrrwrrkrk',
    'krrkwwwkrrk',
    '.krrkkkrrk.',
    '..kkrrrkk..',
    '....kkk....',
  ], { r: '#e43b44', w: '#f4f4f4' }),
  photo: framed('photo', (ctx) => {
    // A holiday snap: the classic hero on a beach.
    ctx.fillStyle = '#2ce8f5';
    ctx.fillRect(3, 3, 8, 5);
    ctx.fillStyle = '#fee761';
    ctx.fillRect(3, 8, 8, 4);
    ctx.drawImage(sprite(heroKey('classic')), 0, 0, 16, 16, 4, 4, 8, 8);
  }),
  marbles: dusty('marbles', [
    '.kkkkkkkk.',
    '.kssssssk.',
    'k........k',
    'k.r.bb...k',
    'k.rr.bgg.k',
    'k.yy..gg.k',
    'kbyyrr...k',
    'kbb.rrwwyk',
    'kgg.bbwwyk',
    'kggrrbbrrk',
    '.kkkkkkkk.',
  ], { s: '#8b9bb4', r: '#e43b44', b: '#0099db', g: '#63c74d', y: '#fee761', w: '#f4f4f4' }),
  'puzzle-cube': dusty('puzzle-cube', [
    'kkkkkkkkkk',
    'krrkwwkbbk',
    'krrkwwkbbk',
    'kkkkkkkkkk',
    'kyykggkrrk',
    'kyykggkrrk',
    'kkkkkkkkkk',
    'kbbkoowwk.',
    'kbbkoowwk.',
    'kkkkkkkkk.',
  ], { r: '#e43b44', w: '#f4f4f4', b: '#0099db', y: '#fee761', g: '#63c74d', o: '#feae34' }),
  'pet-egg': dusty('pet-egg', [
    '...kkkk...',
    '..kppppk..',
    '.kppppppk.',
    'kpkkkkkkpk',
    'kpkggggkpk',
    'kpkgkgkkpk',
    'kpkggggkpk',
    'kpkkkkkkpk',
    'kppwpwpppk',
    '.kppppppk.',
    '..kkkkkk..',
  ], { p: '#b55088', g: '#63c74d', w: '#f4f4f4' }),
  // ---- Easter eggs ----
  'sleeping-cat': dusty('sleeping-cat', [
    '..............w.',
    '.............w..',
    '..k.k.......www.',
    '.kokok..........',
    '.koooookkkkk....',
    'kokoookooooook..',
    'koooooooooooook.',
    '.kooooooooooookk',
    '..kkkkkkkkkkkkok',
    '..............k.',
  ], { o: '#feae34', w: '#c0cbdc' }),
  // The floor's sock has a pair after all.
  'other-sock': dusty('other-sock', [
    '.kkkkk....',
    '.kwwwk....',
    '.krrrk....',
    '.kwwwk....',
    '.krrrk....',
    '.kwwwk....',
    '.kwwwk....',
    '.kwwwkk...',
    'kwwwwwwk..',
    'kwwwwwwwk.',
    'krrwwwwwk.',
    '.kkkkkkk..',
  ], { w: '#f4f4f4', r: '#e43b44' }),
  // A portrait of the spider downstairs, with a little brass plate.
  'spider-of-the-month': framed(
    'spider-of-the-month',
    (ctx) => {
      ctx.fillStyle = '#c0cbdc';
      ctx.fillRect(3, 3, 8, 9);
      ctx.drawImage(spider(0), 0, 0, 9, 8, 3, 4, 9, 8);
    },
    'plate',
  ),
  // An extra life, saved in a jar for a rainy day.
  'spare-life': dusty('spare-life', [
    '.kkkkkkkk.',
    '.kssssssk.',
    'k........k',
    'k.kk..kk.k',
    'kkggkkggkk',
    'kkgwggggkk',
    'kkggggggkk',
    'k.kggggk.k',
    'k..kggk..k',
    'k...kk...k',
    '.kkkkkkkk.',
  ], { s: '#8b9bb4', g: '#63c74d', w: '#f4f4f4' }),
};

/** A top-shelf ornament or easter egg. */
export const decorCanvas = (kind: DecorKind) => once(`decor:${kind}`, DECOR_DRAW[kind]);
