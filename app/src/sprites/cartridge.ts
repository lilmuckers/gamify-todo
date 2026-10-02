// Procedural game cartridges, console and carpet for the project select screen.
// Everything is seeded by the project id, so each project keeps its own look.
import { seeded } from '@quest/shared';
import { canvas, pick, type Rand } from './canvas';
import { PALETTE, THEMES } from './pixels';
import { sprite, type ThemeKey } from './render';

export const CART_W = 44;
export const CART_H = 52;

export type CartKind = 'game' | 'warp' | 'blank';

export interface CartSpec {
  seed: string;
  title: string;
  /** Themes of the project's worlds; tint the label art. */
  themes: ThemeKey[];
  kind?: CartKind;
}

const cache = new Map<string, HTMLCanvasElement>();


// 3x5 pixel font for label titles: five rows of three columns per glyph.
const GLYPHS: Record<string, string> = {
  A: '.#.|#.#|###|#.#|#.#',
  B: '##.|#.#|##.|#.#|##.',
  C: '.##|#..|#..|#..|.##',
  D: '##.|#.#|#.#|#.#|##.',
  E: '###|#..|##.|#..|###',
  F: '###|#..|##.|#..|#..',
  G: '.##|#..|#.#|#.#|.##',
  H: '#.#|#.#|###|#.#|#.#',
  I: '###|.#.|.#.|.#.|###',
  J: '..#|..#|..#|#.#|.#.',
  K: '#.#|#.#|##.|#.#|#.#',
  L: '#..|#..|#..|#..|###',
  M: '#.#|###|###|#.#|#.#',
  N: '##.|#.#|#.#|#.#|#.#',
  O: '.#.|#.#|#.#|#.#|.#.',
  P: '##.|#.#|##.|#..|#..',
  Q: '.#.|#.#|#.#|##.|.##',
  R: '##.|#.#|##.|#.#|#.#',
  S: '.##|#..|.#.|..#|##.',
  T: '###|.#.|.#.|.#.|.#.',
  U: '#.#|#.#|#.#|#.#|###',
  V: '#.#|#.#|#.#|#.#|.#.',
  W: '#.#|#.#|###|###|#.#',
  X: '#.#|#.#|.#.|#.#|#.#',
  Y: '#.#|#.#|.#.|.#.|.#.',
  Z: '###|..#|.#.|#..|###',
  '0': '###|#.#|#.#|#.#|###',
  '1': '.#.|##.|.#.|.#.|###',
  '2': '##.|..#|.#.|#..|###',
  '3': '##.|..#|.#.|..#|##.',
  '4': '#.#|#.#|###|..#|..#',
  '5': '###|#..|##.|..#|##.',
  '6': '.##|#..|###|#.#|###',
  '7': '###|..#|.#.|.#.|.#.',
  '8': '###|#.#|###|#.#|###',
  '9': '###|#.#|###|..#|##.',
  '-': '...|...|###|...|...',
  '!': '.#.|.#.|.#.|...|.#.',
  '&': '.#.|#.#|.#.|#.#|.##',
  '?': '##.|..#|.#.|...|.#.',
};

function glyph(ch: string): string {
  return (GLYPHS[ch] ?? '...|...|...|...|...').replace(/\|/g, '');
}

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, shadow?: string) {
  const draw = (ox: number, oy: number, c: string) => {
    ctx.fillStyle = c;
    [...text].forEach((ch, i) => {
      const g = glyph(ch);
      for (let p = 0; p < 15; p++) if (g[p] === '#') ctx.fillRect(ox + i * 4 + (p % 3), oy + Math.floor(p / 3), 1, 1);
    });
  };
  if (shadow) draw(x + 1, y + 1, shadow);
  draw(x, y, color);
}

/** Splits a title into up to two label lines of `max` chars. */
export function labelLines(title: string, max = 7): string[] {
  const words = title.toUpperCase().replace(/[^A-Z0-9&!?\- ]/g, '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= max) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w.slice(0, max);
    }
    if (lines.length === 2) break;
  }
  if (cur && lines.length < 2) lines.push(cur);
  return lines.slice(0, 2);
}

const SHELLS: [string, string, string][] = [
  ['#c0cbdc', '#8b9bb4', '#5a6988'], // light grey
  ['#8b9bb4', '#5a6988', '#3a4466'], // grey
  ['#3a4466', '#262b44', '#1a1c2c'], // black
  ['#f6757a', '#b55088', '#68386c'], // pink
  ['#2ce8f5', '#0099db', '#124e89'], // blue
  ['#63c74d', '#3e8948', '#265c42'], // green
  ['#fee761', '#feae34', '#c67a14'], // gold
  ['#e43b44', '#a22633', '#3e2731'], // red
];


/** Label artwork styles. Each paints a 32x32 area at (0,0). */
const ART: ((ctx: CanvasRenderingContext2D, r: Rand, c: { a: string; b: string; c: string }) => void)[] = [
  // Rolling hills under a sun.
  (ctx, r, c) => {
    bands(ctx, c.a, '#fde2a7', 0, 20);
    disc(ctx, 8 + r() * 16, 8 + r() * 4, 4 + r() * 2, '#fee761');
    hills(ctx, r, c.b, 18, 6);
    hills(ctx, r, c.c, 24, 4);
  },
  // Space: stars and a ringed planet.
  (ctx, r, c) => {
    ctx.fillStyle = '#1a1c2c';
    ctx.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = r() < 0.3 ? '#fee761' : '#f4f4f4';
      ctx.fillRect(Math.floor(r() * 32), Math.floor(r() * 32), 1, 1);
    }
    const px = 10 + r() * 12;
    const py = 12 + r() * 10;
    disc(ctx, px, py, 7, c.b);
    disc(ctx, px - 2, py - 2, 3, c.a);
    ctx.fillStyle = c.c;
    for (let x = -11; x <= 11; x++) ctx.fillRect(Math.round(px + x), Math.round(py + x * 0.25), 1, 1);
  },
  // Sunset grid horizon.
  (ctx, r, c) => {
    bands(ctx, '#3b1d53', c.b, 0, 18);
    const sy = 12;
    disc(ctx, 16, sy, 7, '#feae34');
    ctx.fillStyle = '#3b1d53';
    for (let y = sy; y < sy + 8; y += 2) ctx.fillRect(8, y, 16, 1);
    ctx.fillStyle = '#1a1c2c';
    ctx.fillRect(0, 18, 32, 14);
    ctx.fillStyle = c.a;
    for (let y = 18, g = 1; y < 32; y += g, g++) ctx.fillRect(0, y, 32, 1);
    for (let x = -24; x <= 56; x += 8) line(ctx, 16 + (x - 16) * 0.15, 18, x, 32, c.a);
    void r;
  },
  // Snowy mountains and a moon.
  (ctx, r, c) => {
    bands(ctx, '#124e89', c.a, 0, 24);
    disc(ctx, 22 + r() * 6, 6, 3, '#f4f4f4');
    for (let i = 0; i < 3; i++) {
      const x = r() * 32;
      const h = 12 + r() * 10;
      const col = i === 2 ? c.c : c.b;
      for (let y = 0; y < h; y++) {
        const w = y * 1.1;
        ctx.fillStyle = y < 3 ? '#f4f4f4' : col;
        ctx.fillRect(Math.round(x - w), Math.round(32 - h + y), Math.max(1, Math.round(w * 2)), 1);
      }
    }
  },
  // Sea, island and palm.
  (ctx, r, c) => {
    bands(ctx, c.a, '#b3f5fb', 0, 18);
    ctx.fillStyle = '#0099db';
    ctx.fillRect(0, 18, 32, 14);
    ctx.fillStyle = '#2ce8f5';
    for (let y = 20; y < 32; y += 3) for (let x = (y % 2) * 2; x < 32; x += 6) ctx.fillRect(x, y, 3, 1);
    const ix = 6 + r() * 14;
    ctx.fillStyle = '#fee761';
    ctx.fillRect(ix, 17, 12, 3);
    ctx.fillStyle = '#743f39';
    ctx.fillRect(ix + 6, 8, 1, 9);
    ctx.fillStyle = c.b;
    ctx.fillRect(ix + 2, 7, 9, 2);
    ctx.fillRect(ix + 4, 5, 5, 2);
  },
  // Castle at night.
  (ctx, r, c) => {
    bands(ctx, '#1a1c2c', c.c, 0, 32);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = '#fee761';
      ctx.fillRect(Math.floor(r() * 32), Math.floor(r() * 14), 1, 1);
    }
    ctx.fillStyle = '#262b44';
    ctx.fillRect(6, 16, 20, 16);
    for (let x = 6; x < 26; x += 4) ctx.fillRect(x, 14, 2, 2);
    ctx.fillRect(12, 8, 8, 8);
    ctx.fillStyle = '#feae34';
    ctx.fillRect(15, 11, 2, 3);
    ctx.fillRect(9, 20, 2, 3);
    ctx.fillRect(21, 20, 2, 3);
    ctx.fillStyle = c.b;
    ctx.fillRect(15, 3, 1, 5);
    ctx.fillRect(16, 3, 4, 2);
  },
  // Bold abstract stripes.
  (ctx, r, c) => {
    const cols = [c.a, c.b, c.c, '#f4f4f4'];
    const w = 3 + Math.floor(r() * 3);
    const dir = r() < 0.5 ? 1 : -1;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        ctx.fillStyle = cols[Math.floor((x + dir * y + 64) / w) % cols.length];
        ctx.fillRect(x, y, 1, 1);
      }
    disc(ctx, 16, 18, 8, '#1a1c2c');
    disc(ctx, 16, 18, 6, pick(r, cols));
  },
];

function bands(ctx: CanvasRenderingContext2D, top: string, bottom: string, y0: number, y1: number) {
  // Dithered two-colour gradient.
  for (let y = y0; y < y1; y++) {
    const t = (y - y0) / Math.max(1, y1 - y0);
    for (let x = 0; x < 32; x++) {
      const threshold = ((x % 2) + (y % 2) * 2) / 4;
      ctx.fillStyle = t > threshold + 0.25 ? bottom : top;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, rad: number, color: string) {
  ctx.fillStyle = color;
  for (let y = -rad; y <= rad; y++)
    for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad) ctx.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
}

function hills(ctx: CanvasRenderingContext2D, r: Rand, color: string, base: number, amp: number) {
  const phase = r() * 6;
  const freq = 0.15 + r() * 0.2;
  ctx.fillStyle = color;
  for (let x = 0; x < 32; x++) {
    const top = Math.round(base - amp * (0.5 + 0.5 * Math.sin(x * freq + phase)));
    ctx.fillRect(x, top, 1, 32 - top);
  }
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string) {
  ctx.fillStyle = color;
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
}

/** A cartridge with procedural label art, seeded by `spec.seed`. */
export function cartridge(spec: CartSpec): HTMLCanvasElement {
  const key = `${spec.kind ?? 'game'}:${spec.seed}:${spec.title}:${spec.themes.join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = seeded(spec.seed);
  const [cv, ctx] = canvas(CART_W, CART_H);
  const kind = spec.kind ?? 'game';
  const shell = kind === 'warp' ? SHELLS[3] : kind === 'blank' ? SHELLS[0] : pick(r, SHELLS);
  const [hi, mid, lo] = shell;
  const K = PALETTE.k;

  // Shell with chamfered top corners.
  ctx.fillStyle = K;
  ctx.fillRect(1, 3, CART_W - 2, CART_H - 3);
  ctx.fillRect(3, 1, CART_W - 6, 2);
  ctx.fillStyle = mid;
  ctx.fillRect(2, 4, CART_W - 4, CART_H - 5);
  ctx.fillRect(4, 2, CART_W - 8, 2);
  ctx.fillStyle = hi;
  ctx.fillRect(4, 2, CART_W - 8, 1);
  ctx.fillRect(2, 4, 1, CART_H - 6);
  ctx.fillStyle = lo;
  ctx.fillRect(CART_W - 3, 4, 1, CART_H - 5);
  ctx.fillRect(2, CART_H - 2, CART_W - 4, 1);
  // Grip ridges down both sides and a finger notch at the bottom.
  for (let y = 16; y < CART_H - 8; y += 3) {
    ctx.fillStyle = lo;
    ctx.fillRect(3, y, 2, 1);
    ctx.fillRect(CART_W - 5, y, 2, 1);
  }
  ctx.fillStyle = lo;
  ctx.fillRect(CART_W / 2 - 6, CART_H - 5, 12, 2);
  ctx.fillStyle = hi;
  ctx.fillRect(CART_W / 2 - 6, CART_H - 3, 12, 1);

  // Label: 32x38 inset with a black border; title band on top, art below.
  const lx = 6;
  const ly = 5;
  ctx.fillStyle = K;
  ctx.fillRect(lx - 1, ly - 1, 34, 42);
  const label = canvas(32, 40)[1];
  const art = canvas(32, 32);
  const t = spec.themes.length ? spec.themes : (['grass'] as ThemeKey[]);
  const theme = THEMES[pick(r, t)] ?? THEMES.grass;
  const colors = { a: theme.sky, b: theme.T, c: theme.d };

  if (kind === 'blank') {
    label.fillStyle = '#f4f4f4';
    label.fillRect(0, 0, 32, 40);
    label.fillStyle = '#c0cbdc';
    for (let y = 12; y < 40; y += 4) label.fillRect(3, y, 26, 1);
    drawText(label, 'NEW', 10, 2, '#5a6988');
    label.fillStyle = '#e43b44';
    label.fillRect(15, 18, 3, 11);
    label.fillRect(11, 22, 11, 3);
  } else {
    if (kind === 'warp') {
      art[1].fillStyle = '#1a1c2c';
      art[1].fillRect(0, 0, 32, 32);
      art[1].drawImage(sprite('warp-pipe'), 0, 16);
      for (let i = 0; i < 12; i++) {
        art[1].fillStyle = i % 2 ? '#b55088' : '#2ce8f5';
        art[1].fillRect(Math.floor(r() * 32), Math.floor(r() * 16), 2, 1);
      }
    } else {
      pick(r, ART)(art[1], r, colors);
      // Some covers get a hero or critter cameo.
      const cameo = r();
      if (cameo < 0.35) art[1].drawImage(sprite('hero'), Math.floor(r() * 14), 16);
      else if (cameo < 0.5) art[1].drawImage(sprite('critter'), Math.floor(r() * 14) + 2, 16);
    }
    label.drawImage(art[0], 0, 8);
    // Title band.
    const band = kind === 'warp' ? '#b55088' : pick(r, ['#1a1c2c', '#e43b44', '#124e89', '#f4f4f4', '#feae34']);
    const ink = band === '#f4f4f4' || band === '#feae34' ? '#1a1c2c' : '#f4f4f4';
    const lines = labelLines(spec.title);
    const bandH = lines.length > 1 ? 14 : 8;
    label.fillStyle = band;
    label.fillRect(0, 0, 32, bandH);
    lines.forEach((ln, i) => drawText(label, ln, Math.max(1, Math.floor((32 - (ln.length * 4 - 1)) / 2)), 2 + i * 6, ink));
    // Publisher-style stripe at the bottom.
    label.fillStyle = mid;
    label.fillRect(0, 38, 32, 2);
  }
  ctx.drawImage(label.canvas, lx, ly);
  // Shine.
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(lx, ly, 2, 40);
  cache.set(key, cv);
  return cv;
}

/** Original controller pad. */
export function controllerCanvas(): HTMLCanvasElement {
  const hit = cache.get('controller');
  if (hit) return hit;
  const [cv, ctx] = canvas(48, 24);
  const K = PALETTE.k;
  ctx.fillStyle = K;
  ctx.fillRect(2, 2, 44, 20);
  ctx.fillRect(0, 5, 48, 14);
  ctx.fillStyle = '#c0cbdc';
  ctx.fillRect(3, 3, 42, 18);
  ctx.fillRect(1, 6, 46, 12);
  // D-pad.
  ctx.fillStyle = K;
  ctx.fillRect(8, 10, 9, 3);
  ctx.fillRect(11, 7, 3, 9);
  // Face buttons.
  for (const [x, y, c] of [
    [34, 7, '#e43b44'],
    [39, 10, '#63c74d'],
    [34, 13, '#0099db'],
    [29, 10, '#feae34'],
  ] as const) {
    ctx.fillStyle = K;
    ctx.fillRect(x - 1, y - 1, 5, 5);
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 3, 3);
  }
  ctx.fillStyle = '#5a6988';
  ctx.fillRect(20, 14, 3, 1);
  ctx.fillRect(24, 14, 3, 1);
  cache.set('controller', cv);
  return cv;
}

/** 90s arcade carpet tile. */
export function carpetCanvas(): HTMLCanvasElement {
  const hit = cache.get('carpet');
  if (hit) return hit;
  const [cv, ctx] = canvas(64, 64);
  ctx.fillStyle = '#262b44';
  ctx.fillRect(0, 0, 64, 64);
  const r = seeded('carpet');
  const cols = ['#b55088', '#2ce8f5', '#feae34', '#3a4466', '#63c74d'];
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = pick(r, cols);
    const x = Math.floor(r() * 64);
    const y = Math.floor(r() * 64);
    const shape = Math.floor(r() * 3);
    // Wrap-around so the tile repeats seamlessly.
    for (const [ox, oy] of [
      [0, 0],
      [-64, 0],
      [0, -64],
      [-64, -64],
    ]) {
      if (shape === 0) for (let k = 0; k < 6; k++) ctx.fillRect(x + ox + k, y + oy + Math.round(Math.sin(k) * 2), 1, 1);
      else if (shape === 1) {
        ctx.fillRect(x + ox, y + oy, 3, 1);
        ctx.fillRect(x + ox + 1, y + oy - 1, 1, 3);
      } else for (let k = 0; k < 4; k++) ctx.fillRect(x + ox + k, y + oy + k, 1, 1);
    }
  }
  cache.set('carpet', cv);
  return cv;
}
