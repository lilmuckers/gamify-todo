import type { HeroId } from '@quest/shared';
import { HEROES } from './heroes';
import { canvas } from './canvas';
import { PALETTE } from './pixels';

/**
 * Big 48x64 fighting-game poses for the hero profile (and, later, the
 * character select, #111). Like the portraits, a deliberate exception to
 * "everything is 16px", used only on those screens: the game keeps its 16x16
 * sprites.
 *
 * No pose is drawn by hand. One body in a fists-up stance is built from shapes
 * (head, torso, limbs, shoes), each outlined in `k` and lit from the top left,
 * then each hero adds hair, clothes and extras from `LOOKS`. Colours are the
 * hero's sprite slots plus two shades the slots don't have: `%` (the top,
 * darkened) and `$` (the shoes, darkened). Slot 6 is an accent, not a shade.
 */
export const FIGHTER_W = 48;
export const FIGHTER_H = 64;

/** Four idle frames (a breathing bob, feet planted) and a victory pose. */
export type FighterFrame = 0 | 1 | 2 | 3 | 'win';
export const FIGHTER_FRAMES: FighterFrame[] = [0, 1, 2, 3, 'win'];
export const IDLE_FRAMES: FighterFrame[] = [0, 1, 2, 3];

type Hair = 'cap' | 'bald' | 'long' | 'bun' | 'dome' | 'wavy' | 'fringe' | 'mohawk' | 'curls' | 'flag' | 'undercut' | 'wig' | 'beanie' | 'hijab' | 'locs' | 'sweep';
type Clothes = 'overalls' | 'tee' | 'tank' | 'jumper' | 'jacket' | 'hoodie' | 'dress' | 'dungarees' | 'gown';
type Extra = 'moustache' | 'beard' | 'glasses' | 'roundglasses' | 'stubble' | 'lips' | 'lashes';

interface Look {
  hair: Hair;
  clothes: Clothes;
  extra?: Extra[];
  legs?: 'shorts' | 'stripes';
  shoes?: 'check' | 'chunky';
  /** Details on the top. */
  top?: 'studs' | 'rainbow' | 'pin' | 'bomber' | 'scarf' | 'plaid';
}

/** Each hero's hair, clothes and signature details, matching the sprite and portrait. */
export const LOOKS: Record<HeroId, Look> = {
  classic: { hair: 'cap', extra: ['moustache'], clothes: 'overalls' },
  bearded: { hair: 'bald', extra: ['beard', 'glasses'], clothes: 'tee' },
  redhead: { hair: 'long', clothes: 'tank' },
  'mustard-jumper': { hair: 'bun', extra: ['glasses'], clothes: 'jumper' },
  'denim-jacket': { hair: 'dome', clothes: 'jacket' },
  hoodie: { hair: 'wavy', extra: ['stubble'], clothes: 'hoodie', legs: 'shorts' },
  emo: { hair: 'fringe', clothes: 'tee', shoes: 'check' },
  goth: { hair: 'long', extra: ['lips'], clothes: 'dress', legs: 'stripes' },
  punk: { hair: 'mohawk', clothes: 'jacket', top: 'studs' },
  'rainbow-tee': { hair: 'curls', clothes: 'tee', top: 'rainbow' },
  'trans-flag-hair': { hair: 'flag', clothes: 'dungarees' },
  'trans-pin': { hair: 'undercut', extra: ['moustache'], clothes: 'jumper', top: 'pin' },
  'bi-bomber': { hair: 'curls', clothes: 'jacket', top: 'bomber' },
  'drag-glam': { hair: 'wig', extra: ['lashes', 'lips'], clothes: 'gown' },
  'nb-beanie': { hair: 'beanie', clothes: 'jacket', top: 'scarf' },
  'hijab-skater': { hair: 'hijab', clothes: 'hoodie', shoes: 'chunky' },
  'silver-locs': { hair: 'locs', extra: ['roundglasses'], clothes: 'jumper' },
  flannel: { hair: 'sweep', clothes: 'jacket', top: 'plaid' },
};

/** Classic's sprite and portrait use palette letters, not digit slots: its pose maps the slots onto them. */
const CLASSIC: Record<string, string> = { '1': 'N', '2': 'N', '3': 's', '4': 'S', '5': 'b', '7': 'b', '8': 'B', '9': 'N', '0': 'k', cap: 'c', capShade: 'C' };

type Cell = [x: number, y: number];
type Pt = [x: number, y: number];

/** The pose as a 48x64 character map (the hero's slots, `%`, `$` and palette letters). */
export function fighter(id: HeroId, frame: FighterFrame): string[] {
  const look = LOOKS[id];
  const W = FIGHTER_W;
  const H = FIGHTER_H;
  const grid = Array.from({ length: H }, () => Array<string>(W).fill('.'));
  const slot = (s: string) => (id === 'classic' ? (CLASSIC[s] ?? s) : s);
  const set = (x: number, y: number, c: string) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < W && y < H) grid[y][x] = c;
  };
  const get = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? grid[y][x] : '.');
  const win = frame === 'win';
  // The upper body bobs; the feet stay planted.
  const dy = win ? 0 : [0, 1, 2, 1][frame];

  const poly = (pts: Pt[]): Cell[] => {
    const cells: Cell[] = [];
    const ys = pts.map((p) => p[1]);
    for (let y = Math.ceil(Math.min(...ys)); y <= Math.floor(Math.max(...ys)); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.round(xs[i]); x <= Math.round(xs[i + 1]); x++) cells.push([x, y]);
    }
    return cells;
  };
  const ell = (cx: number, cy: number, rx: number, ry: number): Cell[] => {
    const cells: Cell[] = [];
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) cells.push([x, y]);
    return cells;
  };
  const rect = (x: number, y: number, w: number, h: number) => poly([[x, y], [x + w - 0.01, y], [x + w - 0.01, y + h - 0.01], [x, y + h - 0.01]]);
  const limb = ([x1, y1]: Pt, [x2, y2]: Pt, r: number) => {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = (-(y2 - y1) / len) * r;
    const ny = ((x2 - x1) / len) * r;
    return poly([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]]);
  };
  const up = (cells: Cell[]): Cell[] => cells.map(([x, y]) => [x, y + dy]);
  const at = (x: number, y: number, c: string) => set(x, y + dy, c);

  /** Outlines the shape in k (so overlapping parts get a line between them), fills it, shades its right-hand side. */
  const part = (cells: Cell[], base: string, shade: string | null, { outline = true, shadeFrom = 0.72 } = {}) => {
    const key = new Set(cells.map(([x, y]) => `${x},${y}`));
    if (outline)
      for (const [x, y] of cells)
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!key.has(`${x + a},${y + b}`)) set(x + a, y + b, 'k');
    const rows = new Map<number, [number, number]>();
    for (const [x, y] of cells) {
      const r = rows.get(y) ?? [x, x];
      rows.set(y, [Math.min(r[0], x), Math.max(r[1], x)]);
    }
    for (const [x, y] of cells) {
      const [a, b] = rows.get(y)!;
      const t = b > a ? (x - a) / (b - a) : 0;
      set(x, y, shade && t > shadeFrom ? shade : base);
    }
    return cells;
  };
  /**
   * Recolours painted pixels only: never the outline, never empty space. `fn`
   * gets unbobbed coordinates for the upper body; pass `planted` for the legs.
   */
  const recolour = (cells: Cell[], fn: (x: number, y: number) => string | null, planted = false) => {
    for (const [x, y] of cells) {
      const c = get(x, y);
      if (c === 'k' || c === '.') continue;
      const next = fn(x, planted ? y : y - dy);
      if (next) set(x, y, next);
    }
  };

  const { hair, clothes } = look;
  const extra = look.extra ?? [];
  const skirt = clothes === 'dress' || clothes === 'gown';
  const sleeves = clothes === 'jumper' || clothes === 'jacket' || clothes === 'hoodie' || clothes === 'overalls';
  // Trans flag order down the hair: blue, pink, white, pink, blue.
  const flagBand = (y: number) => {
    const t = (y - 3) / 25;
    return t < 0.2 ? '1' : t < 0.4 ? '2' : t < 0.6 ? 'w' : t < 0.8 ? '2' : '1';
  };

  // ---- Behind the body ----
  if (hair === 'long' || hair === 'locs' || hair === 'wig') {
    const back = hair === 'wig' ? ell(24, 14, 14, 13) : poly([[14, 8], [34, 8], [37, 36], [11, 36]]);
    part(up(back), '1', '2', { shadeFrom: 0.7 });
    if (hair === 'locs') recolour(up(back), (x) => (x % 3 === 0 ? '2' : null));
  }
  if (hair === 'flag') {
    const back = up(poly([[13, 8], [35, 8], [37, 32], [11, 32]]));
    part(back, '1', null);
    recolour(back, (_, y) => flagBand(y));
  }
  if (clothes === 'hoodie' && hair !== 'hijab') part(up(ell(24, 23, 9, 4)), slot('5'), '%');

  // Back arm: a guard up by the chin, or a fist in the air.
  const backFist: Pt = win ? [12, 4] : [15, 21];
  const backElbow: Pt = win ? [10, 16] : [8, 32];
  const sleeve: [string, string] = clothes === 'dungarees' ? ['6', 'l'] : clothes === 'tank' || clothes === 'gown' ? [slot('3'), slot('4')] : [slot('5'), '%'];
  const forearm: [string, string] = sleeves ? [slot('5'), '%'] : [slot('3'), slot('4')];
  part(up(limb([15, 26], backElbow, 2.6)), ...sleeve);
  part(up(limb(backElbow, backFist, 2.3)), ...forearm);

  // Legs in a wide stance, then shoes with soles.
  const shorts = look.legs === 'shorts';
  const legs = [limb([19, 42], [12, 57], 3.2), limb([29, 42], [36, 57], 3.2)];
  for (const leg of legs) part(leg, shorts ? slot('3') : slot('7'), shorts ? slot('4') : look.legs === 'stripes' ? null : slot('8'));
  if (shorts) {
    part(limb([19, 42], [16, 48], 3.4), slot('7'), slot('8'));
    part(limb([29, 42], [32, 48], 3.4), slot('7'), slot('8'));
  }
  if (look.legs === 'stripes') for (const leg of legs) recolour(leg, (_, y) => (y % 2 ? slot('8') : null), true);
  const chunky = look.shoes === 'chunky' ? 1 : 0;
  for (const sx of [6, 32]) {
    const shoe = part(rect(sx - chunky, 56 - chunky, 11 + chunky, 5 + chunky), slot('9'), '$', { shadeFrom: 0.75 });
    recolour(shoe, (x, y) => (y >= 60 ? slot('0') : look.shoes === 'check' && (x + y) % 2 ? 'k' : null), true);
  }

  // Hips or skirt, then the torso and what's printed on it.
  if (skirt) {
    // The waist bobs with the body; the hem stays put, so the skirt stretches a little.
    const hem = clothes === 'gown' ? 56 : 48;
    part(poly([[15, 36 + dy], [33, 36 + dy], [clothes === 'gown' ? 42 : 38, hem], [clothes === 'gown' ? 6 : 10, hem]]), slot('5'), '%');
  } else part(up(rect(15, 37, 19, 7)), slot('7'), slot('8'));
  const torso = part(up(poly([[14, 24], [34, 24], [33, 39], [15, 39]])), slot('5'), '%');
  if (clothes === 'jacket') recolour(torso, (x, y) => (x >= 22 && x <= 26 && y > 25 ? (look.top === 'studs' || look.top === 'plaid' ? 'w' : '6') : null));
  if (clothes === 'dungarees') {
    // A white tee (slot 6) under a bib in slot 5, with buttons and straps.
    recolour(torso, (x, y) => (y > 31 || (x >= 18 && x <= 30 && y > 27) ? slot('5') : x > 31 ? 'l' : '6'));
    at(19, 29, 'u');
    at(29, 29, 'u');
    for (let y = 24; y < 28; y++) {
      at(19, y, slot('5'));
      at(30, y, slot('5'));
    }
  }
  if (clothes === 'overalls') {
    // Classic, as the sprite: an orange collar and placket on blue, with gold buttons.
    recolour(torso, (x, y) => (y < 27 || (x >= 23 && x <= 25) ? 'o' : null));
    at(20, 30, 'u');
    at(28, 30, 'u');
  }
  if (clothes === 'jumper' || clothes === 'hoodie') recolour(torso, (_, y) => (y >= 37 ? '%' : null));
  if (look.top === 'rainbow') recolour(torso, (_, y) => (y >= 27 ? 'rougbp'[Math.floor((y - 27) / 2) % 6] : null));
  if (look.top === 'bomber') recolour(torso, (_, y) => (y >= 30 ? (y < 34 ? '6' : 'b') : null));
  if (look.top === 'plaid') recolour(torso, (x, y) => ((x < 22 || x > 26) && (x % 4 === 0 || y % 4 === 0) ? '6' : null));
  if (look.top === 'studs') for (const [x, y] of [[17, 28], [19, 31], [17, 34], [31, 28], [29, 31], [31, 34]]) at(x, y, 'l');
  if (look.top === 'pin') {
    at(19, 29, 'c');
    at(20, 29, 'q');
    at(19, 30, 'w');
    at(20, 30, 'c');
  }

  // ---- Neck and head ----
  const hijab = hair === 'hijab';
  if (!hijab) part(up(rect(21, 19, 6, 6)), slot('3'), slot('4'));
  if (look.top === 'scarf') {
    recolour(part(up(rect(17, 21, 15, 4)), 'u', 'p'), (x) => (x % 4 < 2 ? 'w' : null));
    part(up(rect(27, 24, 4, 9)), 'p', 'P');
  }
  if (hijab) {
    // Round over the head, closed under the chin, draped over the shoulders, with two folds.
    const wrap = part(up([...ell(24, 13, 11, 11.5), ...poly([[14, 16], [34, 16], [38, 25], [35, 30], [13, 30], [10, 25]])]), '1', '2', { shadeFrom: 0.7 });
    recolour(wrap, (x, y) => {
      const t = x - 24;
      return (y > 23.5 && Math.abs(t + (y - 23.5) * 0.7 - 5) < 0.5) || (y > 24 && Math.abs(t - (y - 24) * 0.6 + 7) < 0.5) ? '2' : null;
    });
  }
  if (hair === 'flag') {
    // The hair mass sits behind the face (as the portrait does): two curtains to the shoulders.
    const mass = up([...ell(24, 13, 10.4, 11), ...poly([[13.6, 13], [18.5, 13], [18, 27.5], [12.5, 27.5]]), ...poly([[29.5, 13], [34.4, 13], [35.5, 27.5], [30, 27.5]])]);
    part(mass, '1', null);
    recolour(mass, (_, y) => flagBand(y));
    part(up(rect(21, 21, 6, 4)), slot('3'), slot('4'));
  }
  const face = hijab ? up(ell(25, 14.5, 7.4, 8.2)) : up(ell(24, 13, 8, 9));
  part(face, slot('3'), slot('4'), { outline: !hijab });
  if (hijab) recolour(face, (_, y) => (y < 7.6 ? '2' : null)); // the underscarf band

  // ---- Hair over the head ----
  const crown = (below: number, rx = 8.6, ry = 9.6) => up(ell(24, 13, rx, ry).filter(([, y]) => y <= below));
  if (hair === 'cap') {
    part(crown(9.5, 9.2, 10.4), slot('cap'), slot('capShade'));
    part(up(poly([[24, 8.2], [37, 8.2], [36, 10.4], [24, 10.4]])), slot('capShade'), null); // the peak, facing right
    // The badge, inside the crown.
    part(up(rect(21, 4, 4, 3)), 'w', null, { outline: false });
    at(22, 5, slot('cap'));
    at(23, 5, slot('cap'));
    for (let y = 11; y < 15; y++) at(17, y, 'N'); // sideburn
  }
  if (['dome', 'wavy', 'undercut', 'sweep', 'bun', 'fringe', 'long', 'locs', 'curls'].includes(hair)) {
    // Curls first, outlined, so their tops make a bumpy edge; the crown then fills in under them.
    if (hair === 'curls') for (let x = 16; x <= 32; x += 3) part(up(ell(x, 4 + (x % 2), 2, 2)), slot('1'), slot('2'));
    part(crown(hair === 'curls' ? 8 : 7), slot('1'), slot('2'), { outline: false });
    if (hair === 'wavy') recolour(up(rect(16, 3, 17, 3)), (x) => (x % 4 === 0 ? slot('2') : null));
    if (hair === 'undercut' || hair === 'sweep') recolour(up(rect(15, 6, 4, 7)), (x, y) => (get(x, y + dy) === slot('1') || get(x, y + dy) === slot('3') ? slot('4') : null));
    if (hair === 'sweep') part(up(poly([[18, 4], [33, 4], [31, 9], [22, 8]])), slot('1'), slot('2'), { outline: false });
    if (hair === 'bun') part(up(ell(20, 4, 4, 3)), slot('1'), slot('2'));
    if (hair === 'fringe') part(up(poly([[18, 5], [30, 5], [26, 15], [20, 14]])), slot('1'), slot('2'), { outline: false });
    if (hair === 'long' || hair === 'locs') part(up(poly([[15, 6], [19, 6], [17, 20], [15, 20]])), slot('1'), slot('2'), { outline: false });
  }
  if (hair === 'flag') {
    part(crown(8.2, 9.4, 10.2), '1', null);
    recolour(up(poly([[17, 5.5], [32, 5.5], [31, 9], [18, 9]])), (_, y) => (y > 7.4 ? '2' : null)); // a pink fringe
  }
  if (hair === 'mohawk') {
    // The crest has an outline above the head only, so nothing cuts across the scalp.
    part(up(rect(21.5, 1, 5, 4)), slot('1'), slot('2'));
    part(up(rect(21.5, 4, 5, 5)), slot('1'), slot('2'), { outline: false });
    recolour(up([...rect(18, 5, 3, 4), ...rect(27, 5, 3, 4)]), (x, y) => ((x + y) % 2 ? slot('4') : null)); // stubble
  }
  if (hair === 'wig') {
    part(crown(7), '1', '2', { outline: false });
    part(up(ell(16, 7, 4, 5)), '1', '2', { outline: false });
  }
  if (hair === 'beanie') {
    recolour(part(crown(8), 'p', 'P'), (_, y) => 'uwpk'[Math.floor((y + 2) / 2.5) % 4]);
    part(up(ell(24, 2, 2, 1.6)), 'u', 'Y');
  }
  if (hair === 'bald') {
    at(20, 7, 'w');
    at(21, 6, 'w');
  }

  // ---- Face, three-quarters, looking right ----
  const fx = hijab ? 25 : 24;
  const ey = 14;
  const brow = hair === 'bald' || hijab ? slot('4') : slot('2');
  for (const x of [fx - 2, fx + 4]) {
    at(x, ey, 'k');
    at(x, ey + 1, 'k');
    at(x - 1, ey, 'w');
    for (let i = -1; i <= 1; i++) at(x + i, ey - 2, brow);
  }
  at(fx + 6, ey + 3, slot('4'));
  at(fx + 7, ey + 3, slot('4'));
  for (const m of win ? [-1, 0, 1, 2] : [0, 1]) at(fx + 1 + m, ey + 5, 'q');
  if (win) {
    at(fx + 1, ey + 6, 'k');
    at(fx + 2, ey + 6, 'k');
  }
  if (extra.includes('beard')) {
    recolour(up(ell(24, 13, 8.6, 9.6)), (x, y) => (y >= ey + 3 && !(y === ey + 5 && x >= fx && x <= fx + 2) ? (x > 29 ? slot('2') : slot('1')) : null));
    part(up(ell(25, 22, 6, 3)), slot('1'), slot('2'));
  }
  if (extra.includes('stubble')) for (let x = 19; x < 31; x += 2) at(x, ey + 7, slot('4'));
  if (extra.includes('moustache')) for (let x = fx - 1; x <= fx + 4; x++) at(x, ey + 4, slot('1'));
  if (extra.includes('glasses') || extra.includes('roundglasses')) {
    const r = extra.includes('roundglasses') ? 2.3 : 2.5;
    for (const cx of [fx - 3, fx + 4]) {
      for (let a = 0; a < 6.3; a += 0.15) at(Math.round(cx + Math.cos(a) * r), Math.round(ey + 0.5 + Math.sin(a) * (r - 0.6)), 'k');
      at(cx - 1, ey, 'l');
    }
    for (let x = fx; x <= fx + 1; x++) at(x, ey, 'k');
  }
  if (extra.includes('lashes')) for (const x of [fx - 3, fx + 5]) at(x, ey - 1, 'k');
  if (extra.includes('lips')) for (let x = fx; x <= fx + 3; x++) at(x, ey + 5, id === 'goth' ? 'P' : 'r');

  // ---- Front arm and both fists ----
  const fistElbow: Pt = win ? [39, 16] : [41, 33];
  const fist: Pt = win ? [37, 3] : [38, 22];
  part(up(limb([33, 26], fistElbow, 2.8)), ...sleeve);
  part(up(limb(fistElbow, fist, 2.4)), ...forearm);
  part(up(ell(fist[0], fist[1], 3.4, 3.2)), slot('3'), slot('4'));
  part(up(ell(backFist[0], backFist[1], 3, 3)), slot('3'), slot('4'));
  if (clothes === 'gown') for (const [x, y] of [[20, 30], [27, 34], [16, 46], [30, 50], [23, 42], [36, 53]]) if (get(x, y + dy) === '5') at(x, y, 'w'); // sparkles

  return grid.map((r) => r.join(''));
}

const darken = (hex: string, by = 0.72) =>
  `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * by).toString(16).padStart(2, '0')).join('')}`;

/** The colours a hero's pose may use: its sprite slots, the shared palette, and the top and shoe shades. */
export function fighterColors(id: HeroId): Record<string, string> {
  const colors: Record<string, string> = { ...PALETTE, ...HEROES[id].colors };
  const top = colors[id === 'classic' ? 'b' : '5'];
  const shoe = colors[id === 'classic' ? 'N' : '9'];
  return { ...colors, '%': darken(top), $: darken(shoe) };
}

const cache = new Map<string, HTMLCanvasElement>();

/** A 48x64 canvas of a hero's pose (scale it up with CSS, pixelated). */
export function fighterCanvas(id: HeroId, frame: FighterFrame = 0): HTMLCanvasElement {
  const key = `${id}:${frame}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(FIGHTER_W, FIGHTER_H);
  const colors = fighterColors(id);
  fighter(id, frame).forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = colors[ch];
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  cache.set(key, c);
  return c;
}
