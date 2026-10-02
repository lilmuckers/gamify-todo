// "Title screens" the TV shows when something that isn't a game goes in the
// console (the bedroom easter egg). Chunky pixel art drawn in code, at half
// the screen's resolution so every pixel shows up as a 2x2 block.
import { PALETTE } from './pixels';
import { canvas, drawText } from './cartridge';
import { SCREEN } from './bedroom';

/** Picture size in art pixels; shown at 2x to fill the TV screen. */
export const JUNK_W = SCREEN.w / 2;
export const JUNK_H = SCREEN.h / 2;
export const JUNK_SCALE = 2;

const P = PALETTE;
type Ctx = CanvasRenderingContext2D;

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function disc(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, c: string) {
  ctx.fillStyle = c;
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) ctx.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
}

/** Centred title in the 3x5 font, with a drop shadow; `scale` 2 for big words. */
function title(ctx: Ctx, text: string, y: number, color: string = P.u, scale = 1) {
  const t = text.toUpperCase();
  const w = (t.length * 4 - 1) * scale;
  const x = Math.round((JUNK_W - w) / 2);
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

// ---- One picture per kind ----

/** SOCK QUEST: a sock with a sword, sunrise behind. */
function sock(ctx: Ctx, [base = P.w, stripe = P.r]: string[]) {
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
  title(ctx, 'SOCK QUEST', 3);
}

/** {BRAND} WORLD: a crisp the size of a planet. */
function snack(ctx: Ctx, [bag = P.r]: string[], label = 'SNAX') {
  rect(ctx, 0, 0, JUNK_W, JUNK_H, '#1a1c2c');
  stars(ctx, 26, 3);
  // A ring in the bag's colour behind the crisp, then the crisp, then the ring's front.
  disc(ctx, 34, 32, 30, 5, bag);
  disc(ctx, 34, 32, 26, 3, '#1a1c2c');
  disc(ctx, 34, 30, 19, 15, P.k);
  disc(ctx, 34, 30, 18, 14, P.y);
  disc(ctx, 31, 27, 13, 9, P.u);
  for (const [x, y] of [[26, 24], [40, 28], [33, 36], [44, 22], [23, 33]]) disc(ctx, x, y, 2, 1, P.o);
  for (let x = 20; x < 50; x += 6) rect(ctx, x, 30 + ((x / 6) % 2), 4, 1, P.Y);
  rect(ctx, 6, 35, 56, 2, bag);
  title(ctx, `${label} WORLD`, 4);
}

/** FIZZ FORCE: a can rocket launching. */
function soda(ctx: Ctx, [can = P.r]: string[]) {
  bands(ctx, ['#124e89', P.B, P.b]);
  stars(ctx, 10, 5);
  // Smoke at the launch pad.
  for (const [x, r] of [[16, 6], [26, 7], [42, 7], [52, 6], [34, 5]]) disc(ctx, x, 47, r, 4, P.l);
  // Flames.
  disc(ctx, 34, 38, 5, 7, P.o);
  disc(ctx, 34, 37, 3, 5, P.u);
  // The can: body, lid, a white band and fins.
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
  title(ctx, 'FIZZ FORCE', 2);
}

/** The TV filling up with juice; a fish swims by. */
function juice(ctx: Ctx, [liquid = P.o]: string[]) {
  rect(ctx, 0, 0, JUNK_W, JUNK_H, '#1a1c2c');
  // Juice up to two thirds, with a wavy top and bubbles.
  rect(ctx, 0, 20, JUNK_W, JUNK_H - 20, liquid);
  for (let x = 0; x < JUNK_W; x++) rect(ctx, x, 18 + (Math.floor(x / 4) % 2), 1, 2, liquid);
  for (let x = 2; x < JUNK_W; x += 8) rect(ctx, x, 18 + (Math.floor(x / 4) % 2), 3, 1, P.w);
  for (const [x, y] of [[10, 40], [12, 32], [52, 44], [56, 30], [20, 26]]) {
    rect(ctx, x, y, 2, 2, P.w);
  }
  // A fish, unbothered.
  disc(ctx, 36, 34, 7, 4, P.k);
  disc(ctx, 36, 34, 6, 3, P.o);
  rect(ctx, 41, 30, 1, 9, P.k);
  rect(ctx, 42, 31, 3, 7, P.k);
  rect(ctx, 42, 32, 2, 5, P.o);
  rect(ctx, 32, 33, 1, 1, P.k);
  rect(ctx, 30, 35, 1, 1, P.k);
  title(ctx, 'SPLASH!', 4, P.w);
}

/** PIZZA KART: slices racing. */
function pizza(ctx: Ctx, [cheese = P.u, pepperoni = P.R]: string[]) {
  bands(ctx, [P.c, '#9badb7'], 0, 26);
  rect(ctx, 0, 26, JUNK_W, 4, P.h);
  rect(ctx, 0, 30, JUNK_W, 16, P.M);
  for (let x = 0; x < JUNK_W; x += 8) rect(ctx, x, 37, 4, 1, P.w);
  rect(ctx, 0, 46, JUNK_W, 6, P.h);
  // A slice on wheels: crust down the left, point to the right.
  const slice = (x: number, y: number) => {
    for (let i = 0; i < 13; i++) {
      const half = Math.max(0, 6 - Math.floor(i / 2));
      rect(ctx, x + i, y - half - 1, 1, half * 2 + 2, P.k);
      if (i > 0 && half > 0) rect(ctx, x + i, y - half, 1, half * 2, cheese);
    }
    rect(ctx, x + 1, y - 6, 2, 12, P.n);
    rect(ctx, x + 5, y - 3, 2, 2, pepperoni);
    rect(ctx, x + 6, y + 1, 2, 2, pepperoni);
    // Wheels, and speed lines behind.
    rect(ctx, x + 1, y + 6, 3, 3, P.k);
    rect(ctx, x + 8, y + 3, 3, 3, P.k);
    for (let j = 0; j < 3; j++) rect(ctx, x - 9 - j * 2, y - 3 + j * 3, 6, 1, P.w);
  };
  slice(48, 33);
  slice(30, 39);
  slice(13, 35);
  title(ctx, 'PIZZA KART', 5, P.r);
}

/** The comic's hero bursting out of the screen, with the cover's sound word. */
function comic(ctx: Ctx, [cover = P.u, banner = P.r, hero = P.b]: string[], label = 'POW!') {
  rect(ctx, 0, 0, JUNK_W, JUNK_H, banner);
  // A jagged burst in the cover's colour.
  const cx = 34;
  const cy = 30;
  ctx.fillStyle = P.k;
  for (let a = 0; a < 360; a += 1) {
    const spike = a % 30 < 15 ? 26 : 16;
    const rad = (a * Math.PI) / 180;
    for (let r = 0; r < spike; r++) ctx.fillRect(Math.round(cx + Math.cos(rad) * r), Math.round(cy + Math.sin(rad) * r * 0.75), 1, 1);
  }
  ctx.fillStyle = cover;
  for (let a = 0; a < 360; a += 1) {
    const spike = a % 30 < 15 ? 24 : 14;
    const rad = (a * Math.PI) / 180;
    for (let r = 0; r < spike; r++) ctx.fillRect(Math.round(cx + Math.cos(rad) * r), Math.round(cy + Math.sin(rad) * r * 0.75), 1, 1);
  }
  // Cracks in the glass from the punch.
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1]]) for (let r = 18; r < 34; r++) rect(ctx, cx + dx * r, cy + dy * r * 0.6, 1, 1, P.w);
  // The hero's fist coming through.
  disc(ctx, 34, 39, 6, 5, P.k);
  disc(ctx, 34, 39, 5, 4, hero);
  for (let i = 0; i < 4; i++) rect(ctx, 31 + i * 2, 35, 1, 3, P.k);
  title(ctx, label, 14, P.w, 2);
}

/** A controller playing a smaller controller, playing a smaller one... */
function controller(ctx: Ctx) {
  rect(ctx, 0, 0, JUNK_W, JUNK_H, '#262b44');
  // A controller at (x, y), `w` wide, with a "screen" in the middle for the next one.
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
  rect(ctx, 23, 21, 22, 18, '#1a1c2c');
  pad(26, 25, 16, 10, 1);
  rect(ctx, 31, 28, 6, 4, '#1a1c2c');
  rect(ctx, 33, 29, 2, 2, P.l);
  title(ctx, 'PLAYER 0', 4);
}

/** The picture for a thing, in its own colours; unknown kinds get static. */
export function junkScreen(kind: string, colors: string[] = [], label?: string): HTMLCanvasElement {
  const [c, ctx] = canvas(JUNK_W, JUNK_H);
  switch (kind) {
    case 'sock':
      sock(ctx, colors);
      break;
    case 'snack':
      snack(ctx, colors, label);
      break;
    case 'soda':
      soda(ctx, colors);
      break;
    case 'juice':
      juice(ctx, colors);
      break;
    case 'pizza':
      pizza(ctx, colors);
      break;
    case 'comic':
      comic(ctx, colors, label);
      break;
    case 'controller':
      controller(ctx);
      break;
    default:
      for (let y = 0; y < JUNK_H; y++) for (let x = 0; x < JUNK_W; x++) rect(ctx, x, y, 1, 1, (x * 7 + y * 13) % 5 ? P.M : P.l);
  }
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
