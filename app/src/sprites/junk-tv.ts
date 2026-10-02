// "Title screens" the TV shows when something that isn't a game goes in the
// console (the bedroom easter egg). Chunky pixel art drawn in code, at half
// the screen's resolution so every pixel shows up as a 2x2 block.
//
// Every kind of thing has up to five screens: one made just for it, and
// others from a stock of game genres (kart racer, space shooter, fighter,
// falling blocks, RPG battle, platformer, quiz show) starring that thing,
// drawn as a little icon in its own colours.
import { PALETTE } from './pixels';
import { canvas, drawText } from './cartridge';
import { SCREEN } from './bedroom';

/** Picture size in art pixels; shown at 2x to fill the TV screen. */
export const JUNK_W = SCREEN.w / 2;
export const JUNK_H = SCREEN.h / 2;
export const JUNK_SCALE = 2;

const P = PALETTE;
const NIGHT = '#1a1c2c';
type Ctx = CanvasRenderingContext2D;

/** The thing that went in: its kind, its colours and any words printed on it. */
export interface JunkThing {
  kind: string;
  colors?: string[];
  label?: string;
}

export interface JunkVariant {
  /** Shown on the screen; `{label}` is the thing's printed words. Uppercase, 17 letters at most. */
  title: string;
  draw: (ctx: Ctx, t: JunkThing, title: string) => void;
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function disc(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, c: string) {
  ctx.fillStyle = c;
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) ctx.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
}

/** Centred text in the 3x5 font, with a drop shadow; `scale` 2 for big words. */
function title(ctx: Ctx, text: string, y: number, color: string = P.u, scale = 1, cx = JUNK_W / 2) {
  const t = text.toUpperCase();
  const w = (t.length * 4 - 1) * scale;
  const x = Math.round(cx - w / 2);
  if (scale === 1) return drawText(ctx, t, x, y, color, P.k);
  // Draw small, then blow it up pixel by pixel.
  const [tmp, tctx] = canvas(t.length * 4 + 1, 7);
  drawText(tctx, t, 0, 0, color, P.k);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, x, y, tmp.width * scale, tmp.height * scale);
  ctx.restore();
}

/** Horizontal bands of colour, top to bottom. */
function bands(ctx: Ctx, cols: string[], from = 0, to = JUNK_H) {
  const h = (to - from) / cols.length;
  cols.forEach((c, i) => rect(ctx, 0, from + i * h, JUNK_W, Math.ceil(h), c));
}

function stars(ctx: Ctx, n: number, seed: number) {
  for (let i = 0; i < n; i++) rect(ctx, (i * 37 + seed * 11) % JUNK_W, (i * 23 + seed * 7) % (JUNK_H - 8), 1, 1, i % 3 ? P.w : P.u);
}

/** A quaver: head and stem. */
function note(ctx: Ctx, x: number, y: number, c: string) {
  disc(ctx, x, y + 4, 1.5, 1, c);
  rect(ctx, x + 1, y, 1, 4, c);
  rect(ctx, x + 2, y, 2, 1, c);
}

// ---- Icons: each thing as a little character map ----
// 'a', 'b' and 'c' are the thing's own colours; other letters are PALETTE.

const ICONS: Record<string, { map: string[]; colors: string[] }> = {
  sock: {
    colors: [P.w, P.r],
    map: ['kkkkk.....', 'kaaak.....', 'kbbbk.....', 'kaaak.....', 'kbbbk.....', 'kaaak.....', 'kaaakkkkk.', 'kaaaaaallk', 'kaaaaaallk', 'kkkkkkkkkk'],
  },
  snack: {
    colors: [P.r],
    map: ['.k.k.k.k.', 'kkkkkkkkk', 'kaaaaaaak', 'kwwwwwwwk', 'kwkwkkwwk', 'kwwwwwwwk', 'kaaauuaak', 'kaauuuuak', 'kaaaaaaak', 'kkkkkkkkk', '.k.k.k.k.'],
  },
  soda: {
    colors: [P.r],
    map: ['.kkkkkk.', 'kllllllk', 'kaaaaaak', 'kawaaaak', 'kawaaaak', 'kwwwwwwk', 'kwuuuuwk', 'kwwwwwwk', 'kaaaaaak', 'kllllllk', '.kkkkkk.'],
  },
  juice: {
    colors: [P.o, P.b],
    map: ['......k..', '.....k...', '.....k...', 'kkkkkkkkk', 'kaaaaaaak', 'kwwwwwwwk', '.kwbbbwk.', '.kwbbbwk.', '.kwwwwwk.', '.kwwwwwk.', '..kkkkk..'],
  },
  pizza: {
    colors: [P.u, P.R],
    map: ['kkkkkkkkkkk', 'knnnnnnnnnk', 'kaaaaaaaaak', '.kaabaaaak.', '.kaaaaabak.', '..kaaaaak..', '..kabaaak..', '...kaaak...', '...kaak....', '....kak....', '.....k.....'],
  },
  comic: {
    colors: [P.u, P.r, P.b],
    map: ['kkkkkkkkk', 'kbbbbbbbk', 'kbwbwbwbk', 'kbbbbbbbk', 'kaaaaaaak', 'kaawwwaak', 'kawwcwwak', 'kawcccwak', 'kaawwwaak', 'kaaaaaaak', 'kkkkkkkkk'],
  },
  controller: {
    colors: [P.l],
    map: ['.kkkkkkkkkkkk.', 'kaaaaaaaaaaaak', 'kaakaaaaaaraak', 'kakkkaaaagaaak', 'kaakaaMaMaabak', 'kaaaaaaaaaaaak', '.kkkkkkkkkkkk.'],
  },
  cassette: {
    colors: ['#262b44', P.w],
    map: ['kkkkkkkkkkkkkk', 'kaaaaaaaaaaaak', 'kabbbbbbbbbbak', 'kabkkbbbbkkbak', 'kabkkbbbbkkbak', 'kabbbbbbbbbbak', 'kaaakkkkkkaaak', 'kaaakMMMMkaaak', 'kkkkkkkkkkkkkk'],
  },
  banana: {
    colors: [P.u, P.y],
    map: ['..........kk', '.........kNk', '........kak.', '.......kaak.', 'k.....kaabk.', 'kk...kaaabk.', 'kakkkaaabk..', '.kaaaaabbk..', '..kkkkkkk...'],
  },
  duck: {
    colors: [P.u, P.o],
    map: ['..kkkk.....', '.kaaaak....', '.kaakak....', '.kaaaakkk..', '.kaaaakbbk.', 'kkkaaakkk..', 'kaaaaaaaak.', 'kaayaaaaak.', 'kaaaaaaak..', '.kkkkkkk...'],
  },
  donut: {
    colors: [P.q, P.u],
    map: ['...kkkkkk...', '.kkaaaaaakk.', 'kaabaaaabaak', 'kaaakkkkaaak', 'kabk....kbak', 'kaak....kaak', 'knaakkkkaank', 'knnaaaaaannk', '.kknnnnnnkk.', '...kkkkkk...'],
  },
  teddy: {
    colors: [P.n, P.s],
    map: ['.kk.....kk..', 'kabk...kabk.', 'kaaakkkaaak.', '.kaaaaaaak..', '.kakaaakak..', '.kaaabaaak..', '.kaabkbaak..', '..kaaaaak...', '.kkaaaaakk..', 'kaakabakaak.', 'kaakabakaak.', '.kkkkkkkkk..'],
  },
  yoyo: {
    colors: [P.r],
    map: ['....k....', '....k....', '....k....', '..kkkkk..', '.kaaaaak.', 'kaawwwaak', 'kawkkkwak', 'kaawwwaak', '.kaaaaak.', '..kkkkk..'],
  },
};

/** Size of a thing's icon at scale 1. */
export function iconSize(kind: string) {
  const m = (ICONS[kind] ?? ICONS.sock).map;
  return { w: m[0].length, h: m.length };
}

/** Paints a thing's icon with its top left at (x, y), `s` art pixels per cell. */
function icon(ctx: Ctx, t: JunkThing, x: number, y: number, s = 1, flip = false) {
  const def = ICONS[t.kind] ?? ICONS.sock;
  const own = (i: number) => t.colors?.[i] ?? def.colors[i] ?? def.colors[0];
  const color: Record<string, string> = { ...P, a: own(0), b: own(1), c: own(2) };
  const w = def.map[0].length;
  def.map.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch === '.') return;
      rect(ctx, x + (flip ? w - 1 - i : i) * s, y + j * s, s, s, color[ch] ?? P.M);
    }),
  );
}

/** Draws the icon centred on (cx, cy). */
function iconAt(ctx: Ctx, t: JunkThing, cx: number, cy: number, s = 1, flip = false) {
  const { w, h } = iconSize(t.kind);
  icon(ctx, t, Math.round(cx - (w * s) / 2), Math.round(cy - (h * s) / 2), s, flip);
}

// ---- Genre screens, starring whatever went in ----

/** A kart race: three of the thing on wheels, a chequered flag ahead. */
function kart(ctx: Ctx, t: JunkThing, name: string) {
  bands(ctx, [P.c, '#9badb7'], 0, 24);
  rect(ctx, 0, 24, JUNK_W, 4, P.h);
  rect(ctx, 0, 28, JUNK_W, 18, P.M);
  for (let x = 0; x < JUNK_W; x += 8) rect(ctx, x, 37, 4, 1, P.w);
  rect(ctx, 0, 46, JUNK_W, 6, P.h);
  for (let y = 28; y < 46; y += 2) rect(ctx, 60 + (y % 4 ? 0 : 2), y, 2, 2, P.w);
  const racer = (x: number, y: number) => {
    const { w, h } = iconSize(t.kind);
    icon(ctx, t, x, y - h, 1);
    rect(ctx, x + 1, y, 3, 3, P.k);
    rect(ctx, x + w - 4, y, 3, 3, P.k);
    for (let j = 0; j < 3; j++) rect(ctx, x - 8 - j * 2, y - h + 2 + j * 3, 6, 1, P.w);
  };
  racer(40, 37);
  racer(22, 43);
  racer(8, 39);
  title(ctx, name, 4, P.r);
}

/** A space shooter: the thing as the ship, flame behind, lasers ahead. */
function space(ctx: Ctx, t: JunkThing, name: string) {
  rect(ctx, 0, 0, JUNK_W, JUNK_H, NIGHT);
  stars(ctx, 30, 9);
  disc(ctx, 58, 44, 14, 12, t.colors?.[0] ?? P.p);
  disc(ctx, 54, 40, 6, 4, P.w);
  // Flame, ship, then lasers and a saucer to shoot at.
  disc(ctx, 8, 30, 5, 3, P.o);
  disc(ctx, 9, 30, 3, 2, P.u);
  iconAt(ctx, t, 22, 30, 2);
  for (const x of [36, 44, 52]) rect(ctx, x, 29, 5, 1, P.g);
  disc(ctx, 60, 18, 5, 2, P.l);
  disc(ctx, 60, 16, 2, 2, P.c);
  title(ctx, name, 3);
}

/** A versus screen: the thing against its evil twin. */
function fighter(ctx: Ctx, t: JunkThing, name: string) {
  bands(ctx, [P.P, P.p, P.o, P.y], 0, 40);
  rect(ctx, 0, 40, JUNK_W, 12, P.N);
  for (let x = 0; x < JUNK_W; x += 6) rect(ctx, x, 40, 1, 12, P.n);
  // Health bars, one already taking a beating.
  rect(ctx, 3, 11, 26, 4, P.k);
  rect(ctx, 4, 12, 24, 2, P.g);
  rect(ctx, 39, 11, 26, 4, P.k);
  rect(ctx, 40, 12, 9, 2, P.r);
  iconAt(ctx, t, 15, 31, 2);
  iconAt(ctx, { ...t, colors: [P.M, P.k, P.l] }, 53, 31, 2, true);
  title(ctx, 'VS', 24, P.r, 2);
  title(ctx, name, 3, P.w);
}

/** Falling blocks: the thing drops into a well of its own colours. */
function drop(ctx: Ctx, t: JunkThing, name: string) {
  rect(ctx, 0, 0, JUNK_W, JUNK_H, '#262b44');
  rect(ctx, 18, 10, 32, 42, P.l);
  rect(ctx, 20, 10, 28, 40, NIGHT);
  const cols = [t.colors?.[0] ?? P.r, t.colors?.[1] ?? P.b, P.g, P.u];
  const rows = ['ab.cdaab.c', 'cdabcd.abd', 'abcdabcdab'];
  rows.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && rect(ctx, 20 + i * 3 - 1, 41 + j * 3, 3, 3, cols['abcd'.indexOf(ch)])));
  iconAt(ctx, t, 34, 22, 1);
  for (let y = 28; y < 38; y += 3) rect(ctx, 34, y, 1, 1, P.M);
  drawText(ctx, 'NEXT', 52, 14, P.w);
  iconAt(ctx, t, 59, 26, 1);
  drawText(ctx, '900', 52, 40, P.u);
  title(ctx, name, 2);
}

/** An RPG battle: the thing as the monster, a menu to fight it. */
function rpg(ctx: Ctx, t: JunkThing, name: string) {
  bands(ctx, [NIGHT, '#262b44', '#3a4466'], 0, 36);
  rect(ctx, 0, 30, JUNK_W, 6, P.G);
  iconAt(ctx, t, 34, 22, 2);
  drawText(ctx, 'HP 99', 4, 11, P.w);
  // Menu box with a pointer at FIGHT.
  rect(ctx, 2, 36, 64, 15, P.w);
  rect(ctx, 3, 37, 62, 13, '#124e89');
  drawText(ctx, 'FIGHT ITEM RUN', 8, 41, P.w);
  rect(ctx, 5, 42, 2, 3, P.u);
  title(ctx, name, 2);
}

/** A platformer: the thing mid-jump over coins and bricks, a flag at the end. */
function platform(ctx: Ctx, t: JunkThing, name: string) {
  bands(ctx, ['#5c94fc', '#9cc3ff'], 0, 44);
  disc(ctx, 12, 14, 5, 2, P.w);
  disc(ctx, 48, 18, 6, 2, P.w);
  rect(ctx, 0, 44, JUNK_W, 8, P.n);
  for (let x = 0; x < JUNK_W; x += 4) rect(ctx, x, 44, 1, 8, P.N);
  rect(ctx, 0, 44, JUNK_W, 1, P.g);
  for (const [x, y, w] of [[6, 34, 12], [40, 28, 14]]) {
    rect(ctx, x, y, w, 3, P.r);
    for (let i = x; i < x + w; i += 3) rect(ctx, i, y, 1, 3, P.R);
  }
  for (const x of [26, 30, 34]) disc(ctx, x, 24, 1, 2, P.u);
  // The jump: a dotted arc, then the thing at its peak.
  for (let i = 0; i < 6; i++) rect(ctx, 10 + i * 3, 30 - Math.sin((i / 5) * Math.PI) * 8, 1, 1, P.w);
  iconAt(ctx, t, 30, 33, 1);
  rect(ctx, 60, 22, 1, 22, P.l);
  rect(ctx, 61, 22, 5, 4, P.g);
  title(ctx, name, 3, P.w);
}

/** A quiz show: the thing at a podium under spotlights, three answers. */
function quiz(ctx: Ctx, t: JunkThing, name: string) {
  rect(ctx, 0, 0, JUNK_W, JUNK_H, '#3b1d53');
  for (const x of [10, 58]) for (let y = 10; y < 44; y++) rect(ctx, x - (y - 10) / 4, y, (y - 10) / 2 + 1, 1, '#68386c');
  rect(ctx, 22, 32, 24, 12, P.k);
  rect(ctx, 23, 33, 22, 10, P.r);
  rect(ctx, 23, 36, 22, 2, P.u);
  iconAt(ctx, t, 34, 24, 1);
  title(ctx, '?', 12, P.u, 2, 52);
  for (const [i, ch] of ['A', 'B', 'C'].entries()) {
    rect(ctx, 6 + i * 20, 46, 16, 6, P.b);
    drawText(ctx, ch, 13 + i * 20, 46, P.w);
  }
  title(ctx, name, 3);
}

// ---- One screen made just for each kind ----

/** SOCK QUEST: a sock with a sword, sunrise behind. */
function sockQuest(ctx: Ctx, t: JunkThing, name: string) {
  const [base = P.w, stripe = P.r] = t.colors ?? [];
  bands(ctx, ['#262b44', P.P, P.p, P.o], 0, 44);
  disc(ctx, 34, 44, 15, 12, P.y);
  disc(ctx, 34, 44, 11, 9, P.u);
  for (let i = -3; i <= 3; i++) rect(ctx, 34 + i * 7, 26 - Math.abs(i) * 2, 1, 4, P.u);
  rect(ctx, 0, 44, JUNK_W, 8, P.G);
  rect(ctx, 0, 44, JUNK_W, 1, P.h);
  // The sock: leg and foot, outlined, with its stripes.
  rect(ctx, 21, 13, 10, 25, P.k);
  rect(ctx, 21, 31, 18, 9, P.k);
  rect(ctx, 22, 14, 8, 24, base);
  rect(ctx, 22, 32, 16, 7, base);
  rect(ctx, 22, 17, 8, 2, stripe);
  rect(ctx, 22, 21, 8, 2, stripe);
  rect(ctx, 34, 32, 4, 7, P.l);
  // Two eyes, determined.
  rect(ctx, 24, 25, 1, 2, P.k);
  rect(ctx, 27, 25, 1, 2, P.k);
  // The sword, held high.
  rect(ctx, 40, 6, 3, 24, P.k);
  rect(ctx, 41, 7, 1, 22, P.l);
  rect(ctx, 41, 7, 1, 4, P.w);
  rect(ctx, 37, 29, 9, 2, P.Y);
  rect(ctx, 40, 31, 3, 4, P.N);
  title(ctx, name, 3);
}

/** {BRAND} WORLD: a crisp the size of a planet. */
function crispWorld(ctx: Ctx, t: JunkThing, name: string) {
  const bag = t.colors?.[0] ?? P.r;
  rect(ctx, 0, 0, JUNK_W, JUNK_H, NIGHT);
  stars(ctx, 26, 3);
  // A ring in the bag's colour behind the crisp, then the crisp, then the ring's front.
  disc(ctx, 34, 32, 30, 5, bag);
  disc(ctx, 34, 32, 26, 3, NIGHT);
  disc(ctx, 34, 30, 19, 15, P.k);
  disc(ctx, 34, 30, 18, 14, P.y);
  disc(ctx, 31, 27, 13, 9, P.u);
  for (const [x, y] of [[26, 24], [40, 28], [33, 36], [44, 22], [23, 33]]) disc(ctx, x, y, 2, 1, P.o);
  for (let x = 20; x < 50; x += 6) rect(ctx, x, 30 + ((x / 6) % 2), 4, 1, P.Y);
  rect(ctx, 6, 35, 56, 2, bag);
  title(ctx, name, 4);
}

/** FIZZ FORCE: a can rocket launching. */
function fizzForce(ctx: Ctx, t: JunkThing, name: string) {
  const can = t.colors?.[0] ?? P.r;
  bands(ctx, ['#124e89', P.B, P.b]);
  stars(ctx, 10, 5);
  for (const [x, r] of [[16, 6], [26, 7], [42, 7], [52, 6], [34, 5]]) disc(ctx, x, 47, r, 4, P.l);
  disc(ctx, 34, 38, 5, 7, P.o);
  disc(ctx, 34, 37, 3, 5, P.u);
  rect(ctx, 27, 9, 14, 25, P.k);
  rect(ctx, 28, 10, 12, 23, can);
  rect(ctx, 28, 10, 12, 2, P.l);
  rect(ctx, 28, 18, 12, 5, P.w);
  rect(ctx, 31, 19, 6, 3, P.u);
  rect(ctx, 29, 13, 2, 4, P.w);
  rect(ctx, 23, 27, 4, 7, P.k);
  rect(ctx, 41, 27, 4, 7, P.k);
  rect(ctx, 24, 28, 3, 5, P.r);
  rect(ctx, 41, 28, 3, 5, P.r);
  title(ctx, name, 2);
}

/** SPLASH!: the TV filling up with juice; a fish swims by. */
function splash(ctx: Ctx, t: JunkThing, name: string) {
  const liquid = t.colors?.[0] ?? P.o;
  rect(ctx, 0, 0, JUNK_W, JUNK_H, NIGHT);
  rect(ctx, 0, 20, JUNK_W, JUNK_H - 20, liquid);
  for (let x = 0; x < JUNK_W; x++) rect(ctx, x, 18 + (Math.floor(x / 4) % 2), 1, 2, liquid);
  for (let x = 2; x < JUNK_W; x += 8) rect(ctx, x, 18 + (Math.floor(x / 4) % 2), 3, 1, P.w);
  for (const [x, y] of [[10, 40], [12, 32], [52, 44], [56, 30], [20, 26]]) rect(ctx, x, y, 2, 2, P.w);
  disc(ctx, 36, 34, 7, 4, P.k);
  disc(ctx, 36, 34, 6, 3, P.o);
  rect(ctx, 41, 30, 1, 9, P.k);
  rect(ctx, 42, 31, 3, 7, P.k);
  rect(ctx, 42, 32, 2, 5, P.o);
  rect(ctx, 32, 33, 1, 1, P.k);
  rect(ctx, 30, 35, 1, 1, P.k);
  title(ctx, name, 4, P.w);
}

/** The comic's hero punching through the screen, with the cover's sound word. */
function comicBurst(ctx: Ctx, t: JunkThing, name: string) {
  const [cover = P.u, banner = P.r, hero = P.b] = t.colors ?? [];
  rect(ctx, 0, 0, JUNK_W, JUNK_H, banner);
  const cx = 34;
  const cy = 30;
  for (const [col, long, short] of [[P.k, 26, 16], [cover, 24, 14]] as const) {
    ctx.fillStyle = col;
    for (let a = 0; a < 360; a += 1) {
      const spike = a % 30 < 15 ? long : short;
      const rad = (a * Math.PI) / 180;
      for (let r = 0; r < spike; r++) ctx.fillRect(Math.round(cx + Math.cos(rad) * r), Math.round(cy + Math.sin(rad) * r * 0.75), 1, 1);
    }
  }
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1]]) for (let r = 18; r < 34; r++) rect(ctx, cx + dx * r, cy + dy * r * 0.6, 1, 1, P.w);
  disc(ctx, 34, 39, 6, 5, P.k);
  disc(ctx, 34, 39, 5, 4, hero);
  for (let i = 0; i < 4; i++) rect(ctx, 31 + i * 2, 35, 1, 3, P.k);
  title(ctx, name, 14, P.w, 2);
}

/** A controller playing a smaller controller, playing a smaller one... */
function playerZero(ctx: Ctx, _t: JunkThing, name: string) {
  rect(ctx, 0, 0, JUNK_W, JUNK_H, '#262b44');
  const pad = (x: number, y: number, w: number, h: number, u: number) => {
    rect(ctx, x, y, w, h, P.k);
    rect(ctx, x + u, y + u, w - 2 * u, h - 2 * u, P.l);
    const dx = x + 3 * u;
    const dy = y + Math.round(h / 2);
    rect(ctx, dx, dy - u, 3 * u, u, P.k);
    rect(ctx, dx + u, dy - 2 * u, u, 3 * u, P.k);
    rect(ctx, x + w - 5 * u, dy - 2 * u, u, u, P.r);
    rect(ctx, x + w - 3 * u, dy, u, u, P.g);
  };
  pad(6, 14, 56, 32, 2);
  rect(ctx, 22, 20, 24, 20, P.k);
  rect(ctx, 23, 21, 22, 18, NIGHT);
  pad(26, 25, 16, 10, 1);
  rect(ctx, 31, 28, 6, 4, NIGHT);
  rect(ctx, 33, 29, 2, 2, P.l);
  title(ctx, name, 4);
}

/** {label} LIVE!: the tape on stage under the lights, notes flying. */
function tapeLive(ctx: Ctx, t: JunkThing, name: string) {
  rect(ctx, 0, 0, JUNK_W, JUNK_H, NIGHT);
  for (const x of [6, 34, 62]) for (let y = 10; y < 46; y++) rect(ctx, x - (y - 10) / 5, y, (y - 10) / 2.5 + 1, 1, '#262b44');
  rect(ctx, 0, 44, JUNK_W, 8, P.N);
  rect(ctx, 0, 44, JUNK_W, 1, P.n);
  iconAt(ctx, t, 34, 28, 3);
  for (const [x, y, c] of [[6, 14, P.u], [58, 12, P.q], [10, 34, P.c], [56, 34, P.u], [16, 22, P.g]] as const) note(ctx, x, y, c);
  title(ctx, name, 3);
}

/** SLIP STREAM: a kart spinning out on a banana skin. */
function slipStream(ctx: Ctx, t: JunkThing, name: string) {
  bands(ctx, [P.c, '#9badb7'], 0, 22);
  rect(ctx, 0, 22, JUNK_W, 4, P.h);
  rect(ctx, 0, 26, JUNK_W, 20, P.M);
  for (let x = 0; x < JUNK_W; x += 8) rect(ctx, x, 36, 4, 1, P.w);
  rect(ctx, 0, 46, JUNK_W, 6, P.h);
  iconAt(ctx, t, 18, 40, 1);
  // Skid marks looping round, and the kart mid-spin.
  for (let a = 0; a < 360; a += 15) {
    const r = (a * Math.PI) / 180;
    rect(ctx, 44 + Math.cos(r) * 10, 34 + Math.sin(r) * 5, 1, 1, P.k);
  }
  rect(ctx, 38, 26, 12, 7, P.k);
  rect(ctx, 39, 27, 10, 5, P.r);
  rect(ctx, 41, 28, 4, 2, P.c);
  rect(ctx, 38, 33, 3, 3, P.k);
  rect(ctx, 47, 33, 3, 3, P.k);
  for (const [x, y] of [[34, 22], [54, 24], [52, 30]]) rect(ctx, x, y, 2, 1, P.w);
  title(ctx, name, 4, P.r);
}

/** QUACK ATTACK: a giant duck rising out of the sea, a boat fleeing. */
function quackAttack(ctx: Ctx, t: JunkThing, name: string) {
  bands(ctx, ['#5c94fc', '#9cc3ff'], 0, 32);
  bands(ctx, [P.b, P.B], 32, 52);
  iconAt(ctx, t, 26, 26, 3);
  for (let x = 0; x < JUNK_W; x += 6) rect(ctx, x, 32 + (x % 12 ? 1 : 0), 4, 1, P.w);
  // A little boat, getting out of there.
  rect(ctx, 52, 36, 10, 3, P.k);
  rect(ctx, 53, 37, 8, 1, P.n);
  rect(ctx, 56, 30, 1, 6, P.k);
  rect(ctx, 57, 30, 4, 4, P.w);
  for (let i = 0; i < 3; i++) rect(ctx, 46 - i * 3, 38 + i, 3, 1, P.w);
  title(ctx, name, 4, P.w);
}

/** DONUT DIMENSION: a portal swirling through the hole of a giant donut. */
function donutDimension(ctx: Ctx, t: JunkThing, name: string) {
  rect(ctx, 0, 0, JUNK_W, JUNK_H, '#3b1d53');
  stars(ctx, 20, 4);
  // The swirl, then the donut over it (its hole lets the swirl show).
  for (let a = 0; a < 720; a += 8) {
    const r = (a * Math.PI) / 180;
    const d = a / 60;
    rect(ctx, 34 + Math.cos(r) * d, 31 + Math.sin(r) * d * 0.8, 1, 1, a % 32 ? P.c : P.w);
  }
  iconAt(ctx, t, 34, 31, 4);
  title(ctx, name, 2);
}

/** KING TEDDY: the bear crowned in front of its castle. */
function kingTeddy(ctx: Ctx, t: JunkThing, name: string) {
  bands(ctx, [P.P, P.p], 0, 40);
  // Castle: walls, towers, battlements, banners.
  rect(ctx, 6, 22, 56, 22, P.M);
  for (const x of [4, 52]) rect(ctx, x, 14, 12, 30, P.M);
  for (let x = 4; x < 64; x += 4) rect(ctx, x, x < 16 || x >= 52 ? 12 : 20, 2, 2, P.M);
  rect(ctx, 8, 18, 2, 6, P.r);
  rect(ctx, 58, 18, 2, 6, P.r);
  rect(ctx, 0, 44, JUNK_W, 8, P.h);
  iconAt(ctx, t, 34, 32, 2);
  // The crown.
  rect(ctx, 26, 8, 16, 3, P.u);
  for (const x of [26, 32, 38]) rect(ctx, x, 5, 4, 3, P.u);
  rect(ctx, 33, 9, 2, 1, P.r);
  title(ctx, name, 1, P.w);
}

/** YO-YO SKYLINE: swinging between towers on a yo-yo string at night. */
function yoyoSkyline(ctx: Ctx, t: JunkThing, name: string) {
  rect(ctx, 0, 0, JUNK_W, JUNK_H, NIGHT);
  stars(ctx, 14, 6);
  disc(ctx, 54, 12, 5, 5, P.u);
  disc(ctx, 52, 11, 4, 4, NIGHT);
  for (const [x, w, h] of [[0, 12, 30], [14, 10, 22], [26, 14, 36], [42, 10, 18], [54, 14, 28]]) {
    rect(ctx, x, JUNK_H - h, w, h, '#262b44');
    for (let y = JUNK_H - h + 3; y < JUNK_H - 2; y += 4) for (let i = x + 2; i < x + w - 2; i += 3) if ((i + y) % 7) rect(ctx, i, y, 1, 2, P.u);
  }
  // The string from the tallest roof, the yo-yo at the end of its swing.
  for (let i = 0; i < 14; i++) rect(ctx, 33 + i, 16 + i * 0.6, 1, 1, P.w);
  iconAt(ctx, t, 50, 28, 2);
  title(ctx, name, 3);
}

/** Every kind's screens: its own first, then genre screens with its name on. */
export const JUNK_SCREENS: Record<string, JunkVariant[]> = {
  sock: [
    { title: 'SOCK QUEST', draw: sockQuest },
    { title: 'SOCK KART', draw: kart },
    { title: 'SOCK FIGHTER II', draw: fighter },
    { title: 'SOCK DROP', draw: drop },
    { title: 'SOCKS IN SPACE', draw: space },
  ],
  snack: [
    { title: '{label} WORLD', draw: crispWorld },
    { title: 'CRISP FANTASY', draw: rpg },
    { title: '{label} RALLY', draw: kart },
    { title: 'CRUNCH JUMP', draw: platform },
    { title: 'WHO WANTS A CRISP', draw: quiz },
  ],
  soda: [
    { title: 'FIZZ FORCE', draw: fizzForce },
    { title: 'CAN COMMAND', draw: space },
    { title: 'POP FIGHTER', draw: fighter },
    { title: 'FIZZ DROP', draw: drop },
    { title: 'SODA SPEED', draw: kart },
  ],
  juice: [
    { title: 'SPLASH!', draw: splash },
    { title: 'DRIP JUMP', draw: platform },
    { title: 'JUICE QUEST', draw: rpg },
    { title: 'JUICE OR LOSE', draw: quiz },
    { title: 'PULP DROP', draw: drop },
  ],
  pizza: [
    { title: 'PIZZA KART', draw: kart },
    { title: 'SLICE FIGHTER', draw: fighter },
    { title: 'PIZZA ORBIT', draw: space },
    { title: 'CRUST QUEST', draw: rpg },
    { title: 'TOPPING JUMP', draw: platform },
  ],
  comic: [
    { title: '{label}', draw: comicBurst },
    { title: '{label} FIGHTER', draw: fighter },
    { title: 'COMIC QUIZ', draw: quiz },
    { title: 'PANEL JUMP', draw: platform },
    { title: 'COSMIC COMIC', draw: space },
  ],
  controller: [
    { title: 'PLAYER 0', draw: playerZero },
    { title: 'PAD VS PAD', draw: fighter },
    { title: 'PRESS ANY KEY', draw: quiz },
    { title: 'BOSS - YOU', draw: rpg },
    { title: 'CABLE KART', draw: kart },
  ],
  cassette: [
    { title: '{label} LIVE!', draw: tapeLive },
    { title: 'REWIND RACER', draw: kart },
    { title: 'TAPE DROP', draw: drop },
    { title: 'SIDE B QUEST', draw: rpg },
    { title: 'NAME THAT TAPE', draw: quiz },
  ],
  banana: [
    { title: 'SLIP STREAM', draw: slipStream },
    { title: 'PEEL JUMP', draw: platform },
    { title: 'BANANA BRAWL', draw: fighter },
    { title: 'BANANA ORBIT', draw: space },
    { title: 'BANANA QUEST', draw: rpg },
  ],
  duck: [
    { title: 'QUACK ATTACK', draw: quackAttack },
    { title: 'DUCK DERBY', draw: kart },
    { title: 'SPACE DUCK', draw: space },
    { title: 'QUACK QUIZ', draw: quiz },
    { title: 'DUCK DROP', draw: drop },
  ],
  donut: [
    { title: 'DONUT DIMENSION', draw: donutDimension },
    { title: 'GLAZE RACER', draw: kart },
    { title: 'SPRINKLE DROP', draw: drop },
    { title: 'HOLE QUEST', draw: rpg },
    { title: 'RING JUMP', draw: platform },
  ],
  teddy: [
    { title: 'KING TEDDY', draw: kingTeddy },
    { title: 'TEDDY FIGHTER', draw: fighter },
    { title: 'CUDDLE QUEST', draw: rpg },
    { title: 'HUG OR NOT', draw: quiz },
    { title: 'TEDDY JUMP', draw: platform },
  ],
  yoyo: [
    { title: 'YO-YO SKYLINE', draw: yoyoSkyline },
    { title: 'YO-YO ORBIT', draw: space },
    { title: 'YO-YO DUEL', draw: fighter },
    { title: 'YO-YO DROP', draw: drop },
    { title: 'SPIN RACER', draw: kart },
  ],
};

/** How many screens a kind has. */
export const junkVariants = (kind: string) => JUNK_SCREENS[kind]?.length ?? 0;

/** A screen's title with the thing's printed words filled in. */
export function junkTitle(kind: string, variant: number, label?: string): string {
  const v = JUNK_SCREENS[kind]?.[variant];
  return v ? v.title.replaceAll('{label}', (label ?? 'SNAX').toUpperCase()).trim() : '';
}

/** Picks a screen for a kind, never the same one twice running when there's a choice. */
export function pickVariant(kind: string, last?: number, r: () => number = Math.random): number {
  const n = junkVariants(kind);
  if (n <= 1) return 0;
  const options = [...Array(n).keys()].filter((i) => i !== last);
  return options[Math.floor(r() * options.length)];
}

/** The picture for a thing, in its own colours; unknown kinds get static. */
export function junkScreen(t: JunkThing, variant = 0): HTMLCanvasElement {
  const [c, ctx] = canvas(JUNK_W, JUNK_H);
  const v = JUNK_SCREENS[t.kind]?.[variant] ?? JUNK_SCREENS[t.kind]?.[0];
  if (v) v.draw(ctx, t, junkTitle(t.kind, JUNK_SCREENS[t.kind].indexOf(v), t.label));
  else for (let y = 0; y < JUNK_H; y++) for (let x = 0; x < JUNK_W; x++) rect(ctx, x, y, 1, 1, (x * 7 + y * 13) % 5 ? P.M : P.l);
  return c;
}

/** A frame of TV static, for the flicker in and out. */
export function staticFrame(seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(JUNK_W, JUNK_H);
  let s = seed * 9301 + 49297;
  for (let y = 0; y < JUNK_H; y++)
    for (let x = 0; x < JUNK_W; x++) {
      s = (s * 9301 + 49297) % 233280;
      const v = s / 233280;
      rect(ctx, x, y, 1, 1, v < 0.33 ? P.k : v < 0.66 ? P.M : P.l);
    }
  return c;
}
