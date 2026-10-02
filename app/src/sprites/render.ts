import type { Theme } from '@quest/shared';
import { HEROES, parseHeroKey } from './heroes';
import { canvas } from './canvas';
import { PALETTE, SPRITES, THEMES, type ThemeColors } from './pixels';

export type ThemeKey = Theme | 'warp' | 'under';
export const TILE = 16;

const cache = new Map<string, HTMLCanvasElement>();

function paint(map: string[], colors: Record<string, string>): HTMLCanvasElement {
  const w = Math.max(...map.map((r) => r.length));
  const [c, ctx] = canvas(w, map.length);
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = colors[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

function themeColors(theme: ThemeKey): Record<string, string> {
  const t: ThemeColors = THEMES[theme] ?? THEMES.grass;
  return { ...PALETTE, T: t.T, t: t.t, D: t.D, d: t.d };
}

/** Canvas for a named pixel sprite, themed where the map uses theme slots. */
export function sprite(name: string, theme: ThemeKey = 'grass'): HTMLCanvasElement {
  const key = `${name}:${theme}`;
  let c = cache.get(key);
  if (!c) {
    const special = SPECIAL[name];
    const hero = parseHeroKey(name);
    c = special
      ? special(theme)
      : hero
        ? heroCanvas(hero.id, hero.frame)
        : paint(SPRITES[name] ?? SPRITES.qblock, themeColors(theme));
    cache.set(key, c);
  }
  return c;
}

/** A player character frame; 'classic' is the original hero art. */
function heroCanvas(id: keyof typeof HEROES, frame: 'stand' | 'walk' | 'jump'): HTMLCanvasElement {
  const def = HEROES[id];
  if (!def.frames) return paint(SPRITES[frame === 'stand' ? 'hero' : `hero-${frame}`], PALETTE);
  return paint(def.frames[frame], { ...PALETTE, ...def.colors });
}

const urls = new WeakMap<HTMLCanvasElement, string>();

/**
 * PNG data URL of a canvas that never changes after it's drawn (cached
 * sprites, islands, cartridges). Encoded once: re-encoding on every render
 * costs CPU and makes each <img> decode again, which flickers.
 */
export function canvasUrl(c: HTMLCanvasElement): string {
  let url = urls.get(c);
  if (!url) urls.set(c, (url = c.toDataURL()));
  return url;
}

/** PNG data URL for DOM <img> use (HUD icons, mobile UI). */
export function spriteUrl(name: string, theme: ThemeKey = 'grass'): string {
  return canvasUrl(sprite(name, theme));
}

// Sprites easier to draw with code than by hand.
const SPECIAL: Record<string, (theme: ThemeKey) => HTMLCanvasElement> = {
  castle: () => {
    const [c, ctx] = canvas(80, 80);
    const stone = PALETTE.m;
    const dark = PALETTE.M;
    const line = PALETTE.k;
    const block = (x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = line;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = stone;
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
      ctx.fillStyle = dark;
      for (let by = y + 1; by < y + h - 1; by += 6) {
        ctx.fillRect(x + 1, by + 5, w - 2, 1);
        const off = ((by - y) / 6) % 2 ? 4 : 0;
        for (let bx = x + 1 + off; bx < x + w - 1; bx += 8) ctx.fillRect(bx, by, 1, 5);
      }
    };
    block(8, 40, 64, 40); // base
    block(20, 16, 40, 26); // keep
    for (let i = 0; i < 5; i++) block(8 + i * 14, 32, 8, 9); // base crenels
    for (let i = 0; i < 3; i++) block(20 + i * 16, 8, 8, 9); // keep crenels
    ctx.fillStyle = line;
    ctx.fillRect(32, 56, 16, 24); // door
    ctx.beginPath();
    ctx.arc(40, 57, 8, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(28, 24, 6, 9); // windows
    ctx.fillRect(46, 24, 6, 9);
    return c;
  },
  hill: (theme) => {
    const t = THEMES[theme] ?? THEMES.grass;
    const [c, ctx] = canvas(80, 40);
    ctx.fillStyle = PALETTE.k;
    ctx.beginPath();
    ctx.ellipse(40, 40, 40, 38, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = t.hill;
    ctx.beginPath();
    ctx.ellipse(40, 40, 39, 37, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = t.hillShade;
    for (const [x, y] of [
      [28, 16],
      [48, 22],
      [36, 30],
    ]) {
      ctx.fillRect(x, y, 2, 6);
      ctx.fillRect(x + 4, y, 2, 6);
    }
    return c;
  },
};

/** Island canvas for the overworld, per theme. */
export function island(theme: ThemeKey, locked: boolean): HTMLCanvasElement {
  const key = `island:${theme}:${locked}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const t = THEMES[theme] ?? THEMES.grass;
  const [c, ctx] = canvas(96, 64);
  // Shadow in the water.
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(50, 44, 44, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  // Cliff.
  ctx.fillStyle = PALETTE.k;
  ctx.beginPath();
  ctx.ellipse(48, 38, 44, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = t.d;
  ctx.beginPath();
  ctx.ellipse(48, 38, 43, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  // Top.
  ctx.fillStyle = PALETTE.k;
  ctx.beginPath();
  ctx.ellipse(48, 32, 44, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = t.island;
  ctx.beginPath();
  ctx.ellipse(48, 32, 43, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = t.t;
  for (let i = 0; i < 7; i++) ctx.fillRect(14 + i * 11, 30 + ((i * 7) % 9), 3, 2);
  // Landmark per theme.
  const lm: Record<string, () => void> = {
    grass: () => ctx.drawImage(sprite('bush'), 24, 12),
    desert: () => {
      ctx.fillStyle = PALETTE.k;
      ctx.beginPath();
      ctx.moveTo(34, 32);
      ctx.lineTo(50, 6);
      ctx.lineTo(66, 32);
      ctx.fill();
      ctx.fillStyle = PALETTE.y;
      ctx.beginPath();
      ctx.moveTo(37, 31);
      ctx.lineTo(50, 9);
      ctx.lineTo(63, 31);
      ctx.fill();
    },
    water: () => {
      ctx.fillStyle = PALETTE.N;
      ctx.fillRect(47, 8, 3, 24);
      ctx.fillStyle = PALETTE.g;
      ctx.fillRect(38, 6, 22, 4);
      ctx.fillRect(42, 3, 14, 3);
    },
    ice: () => {
      ctx.fillStyle = PALETTE.l;
      ctx.beginPath();
      ctx.moveTo(30, 32);
      ctx.lineTo(46, 8);
      ctx.lineTo(62, 32);
      ctx.fill();
      ctx.fillStyle = PALETTE.w;
      ctx.beginPath();
      ctx.moveTo(40, 18);
      ctx.lineTo(46, 8);
      ctx.lineTo(52, 18);
      ctx.fill();
    },
    sky: () => ctx.drawImage(sprite('cloud'), 32, 6),
    castle: () => ctx.drawImage(sprite('castle'), 28, -6, 40, 40),
    warp: () => ctx.drawImage(sprite('warp-pipe'), 32, 8),
  };
  lm[theme]?.();
  if (locked) {
    ctx.fillStyle = 'rgba(26,28,44,0.55)';
    ctx.beginPath();
    ctx.ellipse(48, 32, 45, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(sprite('node-lock'), 40, 18);
  }
  cache.set(key, c);
  return c;
}

export function themeOf(theme: string): ThemeColors {
  return THEMES[theme as ThemeKey] ?? THEMES.grass;
}
