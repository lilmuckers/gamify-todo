// Bedroom floor props for the project select screen: a top-down console, a CRT
// on the wall, and random clutter. Original designs, drawn in code.
import { PALETTE } from './pixels';
import { canvas, pick, type Rand } from './canvas';
import { drawText } from './cartridge';

const K = PALETTE.k;

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, c: string) {
  ctx.fillStyle = c;
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) ctx.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
}

// ---- Console (top-down) ----

export const CONSOLE_W = 112;
export const CONSOLE_H = 76;
/** Slot centre relative to the console image centre. */
export const SLOT = { x: 0, y: -16, w: 50, h: 8 };

export function consoleTop(on: boolean): HTMLCanvasElement {
  const [c, ctx] = canvas(CONSOLE_W, CONSOLE_H);
  // Body with rounded corners.
  rect(ctx, 2, 0, CONSOLE_W - 4, CONSOLE_H, K);
  rect(ctx, 0, 2, CONSOLE_W, CONSOLE_H - 4, K);
  rect(ctx, 2, 1, CONSOLE_W - 4, CONSOLE_H - 2, '#c0cbdc');
  rect(ctx, 1, 2, CONSOLE_W - 2, CONSOLE_H - 4, '#c0cbdc');
  rect(ctx, 2, 1, CONSOLE_W - 4, 2, '#dfe9f0');
  rect(ctx, 1, CONSOLE_H - 5, CONSOLE_W - 2, 3, '#8b9bb4');
  // Raised deck around the slot.
  rect(ctx, 26, 6, 60, 26, K);
  rect(ctx, 27, 7, 58, 24, '#8b9bb4');
  rect(ctx, 27, 7, 58, 1, '#dfe9f0');
  // Slot (centre at y=22 → -16 from the image centre of 38).
  rect(ctx, 31, 18, 50, 8, K);
  rect(ctx, 32, 19, 48, 6, '#262b44');
  // Eject lever and vents.
  rect(ctx, 90, 12, 12, 16, K);
  rect(ctx, 91, 13, 10, 14, '#8b9bb4');
  rect(ctx, 93, 16, 6, 4, '#5a6988');
  for (let y = 40; y < 66; y += 3) rect(ctx, 30, y, 52, 1, '#8b9bb4');
  // Power slider, reset button, LED.
  rect(ctx, 8, 44, 16, 10, K);
  rect(ctx, 9, 45, 14, 8, '#5a6988');
  rect(ctx, on ? 16 : 10, 46, 6, 6, on ? '#63c74d' : '#c0cbdc');
  drawText(ctx, 'PWR', 10, 57, '#5a6988');
  disc(ctx, 96, 49, 6, 6, K);
  disc(ctx, 96, 49, 5, 5, '#e43b44');
  disc(ctx, 95, 48, 2, 2, '#f6757a');
  drawText(ctx, 'RST', 90, 57, '#5a6988');
  rect(ctx, 9, 36, 5, 4, K);
  rect(ctx, 10, 37, 3, 2, on ? '#63c74d' : '#a22633');
  drawText(ctx, 'QUEST-16', 40, 68, '#5a6988');
  return c;
}

/** Where cables leave the console, relative to the image centre. */
export const CONSOLE_PORTS = {
  av: { x: 30, y: -CONSOLE_H / 2 },
  power: { x: 44, y: -CONSOLE_H / 2 },
  pad1: { x: -30, y: CONSOLE_H / 2 },
  pad2: { x: -14, y: CONSOLE_H / 2 },
};

// ---- Wall + TV (front view) ----

export const TV_W = 200;
export const TV_H = 150;
/** Screen rectangle within the TV image. */
export const SCREEN = { x: 18, y: 16, w: 136, h: 104 };

export function tvCanvas(): HTMLCanvasElement {
  const [c, ctx] = canvas(TV_W, TV_H);
  rect(ctx, 0, 4, TV_W, TV_H - 8, K);
  rect(ctx, 4, 0, TV_W - 8, TV_H, K);
  // Wood-grain cabinet.
  rect(ctx, 4, 4, TV_W - 8, TV_H - 8, '#743f39');
  for (let y = 6; y < TV_H - 6; y += 5) rect(ctx, 5, y, TV_W - 10, 1, '#5a2e2a');
  // Bezel.
  rect(ctx, SCREEN.x - 6, SCREEN.y - 6, SCREEN.w + 12, SCREEN.h + 12, '#3a4466');
  rect(ctx, SCREEN.x - 2, SCREEN.y - 2, SCREEN.w + 4, SCREEN.h + 4, K);
  rect(ctx, SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h, '#1f2a1f');
  // Glass shine.
  rect(ctx, SCREEN.x + 6, SCREEN.y + 4, 30, 2, '#2e3b2e');
  // Control panel: dials and speaker grille.
  const px = SCREEN.x + SCREEN.w + 10;
  rect(ctx, px - 2, 14, 32, TV_H - 28, '#262b44');
  disc(ctx, px + 14, 32, 9, 9, K);
  disc(ctx, px + 14, 32, 7, 7, '#8b9bb4');
  rect(ctx, px + 13, 25, 2, 6, K);
  disc(ctx, px + 14, 58, 7, 7, K);
  disc(ctx, px + 14, 58, 5, 5, '#8b9bb4');
  for (let y = 74; y < TV_H - 20; y += 3) rect(ctx, px + 3, y, 22, 1, K);
  rect(ctx, px + 20, TV_H - 20, 4, 3, '#e43b44');
  return c;
}

export function wallpaperCanvas(): HTMLCanvasElement {
  const [c, ctx] = canvas(32, 32);
  rect(ctx, 0, 0, 32, 32, '#3b5d7a');
  for (let x = 0; x < 32; x += 8) rect(ctx, x, 0, 3, 32, '#44698a');
  disc(ctx, 20, 8, 2, 2, '#f4f4f4');
  disc(ctx, 4, 24, 1, 1, '#fee761');
  return c;
}

// ---- Clutter (random each load) ----

export type PropKind =
  | 'snack'
  | 'crumbs'
  | 'sock'
  | 'juice'
  | 'soda'
  | 'pizza'
  | 'comic'
  | 'cassette'
  | 'banana'
  | 'duck'
  | 'donut'
  | 'teddy'
  | 'yoyo';

export interface Prop {
  kind: PropKind;
  canvas: HTMLCanvasElement;
  /** Words printed on it (a snack brand, a comic's cover), for hover quips. */
  label?: string;
  /** Draw under other props (e.g. a puddle). */
  under?: boolean;
  /** Its main colours, so pictures of it (the console easter egg) match. */
  colors?: string[];
}

const BRANDS = ['CRNCH', 'ZAPS', 'PUFFS', 'NACHO', 'WHIRL', 'BLAM', 'SNAX', 'KRISP', 'ZING'];
const BAG_COLOURS = ['#e43b44', '#0099db', '#63c74d', '#feae34', '#b55088', '#2ce8f5', '#f77622'];

function snackBag(r: Rand): Prop {
  const [c, ctx] = canvas(34, 40);
  const col = pick(r, BAG_COLOURS);
  // Crimped ends and a slightly bulged body.
  rect(ctx, 3, 0, 28, 40, K);
  rect(ctx, 1, 4, 32, 32, K);
  rect(ctx, 4, 1, 26, 38, col);
  rect(ctx, 2, 5, 30, 30, col);
  for (let x = 4; x < 30; x += 2) {
    rect(ctx, x, 1, 1, 3, K);
    rect(ctx, x, 36, 1, 3, K);
  }
  rect(ctx, 2, 14, 30, 9, '#f4f4f4');
  const brand = pick(r, BRANDS);
  drawText(ctx, brand, 5, 16, K);
  disc(ctx, 17, 29, 4, 3, '#fee761');
  rect(ctx, 6, 5, 2, 8, 'rgba(255,255,255,0.35)');
  if (r() < 0.5) {
    // Torn open with crisps spilling out.
    rect(ctx, 4, 0, 26, 4, '#262b44');
  }
  return { kind: 'snack', canvas: c, label: brand, colors: [col] };
}

function crumbs(r: Rand): Prop {
  const [c, ctx] = canvas(30, 20);
  for (let i = 0; i < 9; i++) disc(ctx, 3 + r() * 24, 3 + r() * 14, 2, 1, pick(r, ['#fee761', '#feae34', '#e4a672']));
  return { kind: 'crumbs', canvas: c, under: true };
}

function sock(r: Rand): Prop {
  const [c, ctx] = canvas(22, 30);
  const base = pick(r, ['#f4f4f4', '#262b44', '#e43b44', '#63c74d', '#0099db']);
  const stripe = pick(r, ['#e43b44', '#0099db', '#feae34', '#b55088']);
  const shape = (col: string, inset: number) => {
    rect(ctx, 2 + inset, 1 + inset, 10 - 2 * inset, 20 - inset, col);
    rect(ctx, 2 + inset, 18, 18 - 2 * inset, 10 - 2 * inset, col);
  };
  shape(K, 0);
  shape(base, 1);
  rect(ctx, 3, 4, 8, 2, stripe);
  rect(ctx, 3, 8, 8, 2, stripe);
  rect(ctx, 14, 19, 5, 8, pick(r, ['#c0cbdc', '#8b9bb4']));
  return { kind: 'sock', canvas: c, colors: [base, stripe] };
}

function juice(r: Rand): Prop {
  const liquid = pick(r, ['#f77622', '#b55088', '#63c74d', '#e43b44']);
  const [c, ctx] = canvas(60, 44);
  // Irregular puddle spreading from the cup's mouth.
  for (let i = 0; i < 7; i++) disc(ctx, 26 + r() * 26, 12 + r() * 20, 5 + r() * 8, 4 + r() * 6, liquid);
  ctx.globalAlpha = 0.35;
  disc(ctx, 36, 18, 5, 3, '#f4f4f4');
  ctx.globalAlpha = 1;
  // Cup on its side, mouth towards the puddle.
  const cx = 2;
  const cy = 14;
  rect(ctx, cx, cy + 2, 22, 12, K);
  rect(ctx, cx + 1, cy + 3, 20, 10, '#f4f4f4');
  rect(ctx, cx + 1, cy + 3, 20, 2, '#c0cbdc');
  disc(ctx, cx + 21, cy + 8, 4, 7, K);
  disc(ctx, cx + 21, cy + 8, 3, 6, liquid);
  const cupLabel = pick(r, ['#0099db', '#e43b44', '#63c74d']);
  rect(ctx, cx + 5, cy + 6, 8, 4, cupLabel);
  return { kind: 'juice', canvas: c, colors: [liquid, cupLabel] };
}

function soda(r: Rand): Prop {
  const [c, ctx] = canvas(30, 14);
  const col = pick(r, ['#e43b44', '#0099db', '#63c74d', '#262b44']);
  rect(ctx, 2, 1, 24, 12, K);
  rect(ctx, 3, 2, 22, 10, col);
  rect(ctx, 3, 2, 22, 2, '#f4f4f4');
  rect(ctx, 24, 2, 4, 10, '#c0cbdc');
  rect(ctx, 26, 4, 3, 6, K);
  rect(ctx, 8, 6, 10, 3, '#fee761');
  return { kind: 'soda', canvas: c, colors: [col] };
}

function pizza(r: Rand): Prop {
  const [c, ctx] = canvas(26, 26);
  for (let y = 0; y < 24; y++) {
    const w = Math.round(24 - y);
    rect(ctx, 1, y + 1, w, 1, K);
    if (w > 2) rect(ctx, 2, y + 1, w - 2, 1, y < 3 ? '#b86f50' : '#fee761');
  }
  for (let i = 0; i < 4; i++) disc(ctx, 5 + r() * 9, 6 + r() * 8, 2, 2, '#a22633');
  return { kind: 'pizza', canvas: c, colors: ['#fee761', '#a22633'] };
}

function comic(r: Rand): Prop {
  const [c, ctx] = canvas(32, 42);
  rect(ctx, 0, 0, 32, 42, K);
  const cover = pick(r, ['#fee761', '#2ce8f5', '#f6757a', '#63c74d']);
  const banner = pick(r, ['#e43b44', '#124e89', '#262b44']);
  rect(ctx, 1, 1, 30, 40, cover);
  rect(ctx, 2, 2, 28, 9, banner);
  const word = pick(r, ['ZAP!', 'POW!', 'BAM!', 'WOW!']);
  drawText(ctx, word, 8, 4, '#f4f4f4');
  disc(ctx, 16, 26, 8, 9, '#f4f4f4');
  const hero = pick(r, ['#e43b44', '#0099db', '#b55088']);
  disc(ctx, 16, 24, 4, 4, hero);
  rect(ctx, 26, 36, 4, 4, '#f4f4f4');
  return { kind: 'comic', canvas: c, label: word, colors: [cover, banner, hero] };
}

function cassette(r: Rand): Prop {
  const [c, ctx] = canvas(36, 24);
  const shell = pick(r, ['#262b44', '#e43b44', '#0099db', '#f4f4f4', '#b55088']);
  const sticker = pick(r, ['#f4f4f4', '#fee761', '#2ce8f5']);
  rect(ctx, 0, 0, 36, 24, K);
  rect(ctx, 1, 1, 34, 22, shell);
  // Sticker with a scrawled title, then the window with both reels.
  rect(ctx, 3, 2, 30, 13, sticker);
  const name = pick(r, ['MIX 3', 'RAD', 'TUNES', 'JAMS', 'SIDE A']);
  drawText(ctx, name, 5, 3, K);
  rect(ctx, 8, 9, 20, 5, K);
  rect(ctx, 9, 10, 18, 3, '#5a6988');
  for (const x of [11, 24]) {
    disc(ctx, x, 11, 2, 2, '#f4f4f4');
    rect(ctx, x, 11, 1, 1, K);
  }
  // The bottom edge with its little holes.
  rect(ctx, 7, 18, 22, 5, K);
  rect(ctx, 8, 19, 20, 4, '#8b9bb4');
  for (const x of [11, 17, 23]) rect(ctx, x, 20, 2, 2, K);
  return { kind: 'cassette', canvas: c, label: name, colors: [shell, sticker] };
}

function banana(r: Rand): Prop {
  const [c, ctx] = canvas(32, 18);
  const ripe = r() < 0.7;
  const skin = ripe ? '#fee761' : '#63c74d';
  // A crescent, column by column: thick in the middle, curling up at the ends.
  for (let x = 2; x < 30; x++) {
    const t = (x - 16) / 14;
    const mid = 6 + Math.round(t * t * 8);
    const half = Math.max(1, Math.round(4 * (1 - t * t)));
    rect(ctx, x, mid - half - 1, 1, half * 2 + 2, K);
    rect(ctx, x, mid - half, 1, half * 2, skin);
    rect(ctx, x, mid + half - 1, 1, 1, '#feae34');
  }
  // Brown tips.
  rect(ctx, 1, 13, 3, 3, '#743f39');
  rect(ctx, 28, 12, 3, 3, '#743f39');
  if (r() < 0.5) for (const x of [10, 15, 21]) rect(ctx, x, 9, 1, 1, '#743f39');
  return { kind: 'banana', canvas: c, colors: [skin, '#feae34'] };
}

function duck(r: Rand): Prop {
  const [c, ctx] = canvas(28, 24);
  const body = pick(r, ['#fee761', '#fee761', '#f6757a', '#2ce8f5']);
  disc(ctx, 14, 16, 12, 7, K);
  disc(ctx, 14, 16, 11, 6, body);
  disc(ctx, 9, 8, 6, 6, K);
  disc(ctx, 9, 8, 5, 5, body);
  // Beak, eye and a wing.
  rect(ctx, 1, 8, 4, 3, K);
  rect(ctx, 1, 9, 3, 1, '#f77622');
  rect(ctx, 8, 6, 2, 2, K);
  rect(ctx, 8, 6, 1, 1, '#f4f4f4');
  disc(ctx, 17, 15, 5, 3, '#feae34');
  return { kind: 'duck', canvas: c, colors: [body, '#f77622'] };
}

function donut(r: Rand): Prop {
  const [c, ctx] = canvas(28, 28);
  const icing = pick(r, ['#f6757a', '#743f39', '#f4f4f4', '#b55088', '#2ce8f5']);
  disc(ctx, 14, 14, 13, 13, K);
  disc(ctx, 14, 14, 12, 12, '#e4a672');
  disc(ctx, 14, 13, 11, 10, icing);
  // Sprinkles, then the hole.
  const sprinkles = ['#e43b44', '#fee761', '#63c74d', '#0099db', '#f4f4f4'];
  for (let i = 0; i < 12; i++) {
    const a = r() * Math.PI * 2;
    const d = 6 + r() * 4;
    rect(ctx, 14 + Math.cos(a) * d, 13 + Math.sin(a) * d * 0.9, r() < 0.5 ? 2 : 1, r() < 0.5 ? 1 : 2, pick(r, sprinkles));
  }
  disc(ctx, 14, 14, 4, 4, K);
  ctx.clearRect(12, 12, 5, 5);
  return { kind: 'donut', canvas: c, colors: [icing, pick(r, sprinkles)] };
}

function teddy(r: Rand): Prop {
  const [c, ctx] = canvas(30, 34);
  const fur = pick(r, ['#b86f50', '#e4a672', '#8b9bb4', '#f6757a']);
  const muzzle = '#ead4aa';
  // Ears, head, body, arms and legs, then the face.
  for (const x of [6, 23]) {
    disc(ctx, x, 5, 4, 4, K);
    disc(ctx, x, 5, 3, 3, fur);
    disc(ctx, x, 5, 1, 1, muzzle);
  }
  disc(ctx, 15, 11, 10, 9, K);
  disc(ctx, 15, 11, 9, 8, fur);
  disc(ctx, 15, 25, 9, 8, K);
  disc(ctx, 15, 25, 8, 7, fur);
  disc(ctx, 15, 26, 5, 5, muzzle);
  for (const x of [4, 26]) {
    disc(ctx, x, 22, 3, 5, K);
    disc(ctx, x, 22, 2, 4, fur);
  }
  disc(ctx, 15, 14, 4, 3, muzzle);
  rect(ctx, 14, 12, 3, 2, K);
  rect(ctx, 11, 9, 2, 2, K);
  rect(ctx, 18, 9, 2, 2, K);
  rect(ctx, 14, 16, 3, 1, '#743f39');
  return { kind: 'teddy', canvas: c, colors: [fur, muzzle] };
}

function yoyo(r: Rand): Prop {
  const [c, ctx] = canvas(26, 30);
  const col = pick(r, ['#e43b44', '#0099db', '#63c74d', '#fee761', '#b55088']);
  // A loop of string, then the yo-yo itself.
  ctx.fillStyle = '#f4f4f4';
  for (let a = 0; a < 360; a += 6) {
    const t = (a * Math.PI) / 180;
    ctx.fillRect(Math.round(17 + Math.cos(t) * 6), Math.round(8 + Math.sin(t) * 5), 1, 1);
  }
  rect(ctx, 12, 12, 1, 6, '#f4f4f4');
  disc(ctx, 12, 21, 9, 8, K);
  disc(ctx, 12, 21, 8, 7, col);
  disc(ctx, 12, 21, 4, 4, '#f4f4f4');
  disc(ctx, 12, 21, 2, 2, K);
  rect(ctx, 6, 16, 3, 2, '#f4f4f4');
  return { kind: 'yoyo', canvas: c, colors: [col] };
}

const MAKERS: Record<Exclude<PropKind, 'crumbs'>, (r: Rand) => Prop> = {
  snack: snackBag,
  sock,
  juice,
  soda,
  pizza,
  comic,
  cassette,
  banana,
  duck,
  donut,
  teddy,
  yoyo,
};

/** Things that can turn up on the floor besides the snack bags. */
export const EXTRA_KINDS: Exclude<PropKind, 'crumbs' | 'snack'>[] = ['sock', 'juice', 'soda', 'pizza', 'comic', 'cassette', 'banana', 'duck', 'donut', 'teddy', 'yoyo'];

/**
 * Which things lie on the floor this time. Same amount as ever (one to
 * three snack bags, some with crumbs, plus a handful of other things), but
 * the handful is drawn from the whole list, at most one of each.
 */
export function clutterKinds(r: Rand = Math.random): PropKind[] {
  const out: PropKind[] = [];
  const bags = 1 + Math.floor(r() * 3);
  for (let i = 0; i < bags; i++) {
    out.push('snack');
    if (r() < 0.6) out.push('crumbs');
  }
  // As many others as the old fixed odds gave (0-6, about 3.5 on average).
  const others = [0.8, 0.35, 0.7, 0.6, 0.5, 0.5].filter((p) => r() < p).length;
  const pool = [...EXTRA_KINDS];
  for (let i = 0; i < others && pool.length; i++) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}

/** A fresh, random assortment of floor clutter. */
export function clutter(r: Rand = Math.random): Prop[] {
  return clutterKinds(r).map((k) => (k === 'crumbs' ? crumbs(r) : MAKERS[k](r)));
}
