import type { HeroId } from '@quest/shared';
import { HEROES } from './heroes';
import { PALETTE } from './pixels';

/**
 * 32x32 head-and-shoulders portraits for dialogue, one per hero and
 * expression. The one deliberate exception to "everything is 16px".
 *
 * Each portrait is a character map like the sprites (same digit colour slots
 * as the hero, plus PALETTE letters), composed from a shared head and face
 * and the hero's own hair, clothes and accessories. Light comes from the top
 * left: shapes get at most a base and a shade (and the odd highlight), and a
 * 1px dark outline goes round the silhouette at the end.
 */
export type Face = 'neutral' | 'reacting';
export const FACES: Face[] = ['neutral', 'reacting'];
export const PORTRAIT_SIZE = 32;

const N = PORTRAIT_SIZE;
type Grid = string[][];

/** Colour roles: hero slots for most, palette letters for the classic hero. */
interface Roles {
  skin: string;
  skinShade: string;
  hair: string;
  hairShade: string;
  brow: string;
  mouth: string;
}

const SLOTS: Roles = { skin: '3', skinShade: '4', hair: '1', hairShade: '2', brow: '2', mouth: 'R' };

class Canvas {
  g: Grid = Array.from({ length: N }, () => Array<string>(N).fill('.'));
  constructor(public c: Roles) {}

  set(x: number, y: number, ch: string) {
    if (x >= 0 && y >= 0 && x < N && y < N) this.g[y][x] = ch;
  }
  get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < N && y < N ? this.g[y][x] : '.';
  }
  rect(x: number, y: number, w: number, h: number, ch: string) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, ch);
  }
  /** Fills cells inside an ellipse; `paint` picks the character per cell (or skips with undefined). */
  ellipse(cx: number, cy: number, rx: number, ry: number, paint: string | ((x: number, y: number) => string | undefined)) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy > 1) continue;
        const ch = typeof paint === 'string' ? paint : paint(x, y);
        if (ch) this.set(x, y, ch);
      }
  }
  /** Rows of a pattern, '.' leaves the cell alone. */
  stamp(x: number, y: number, rows: string[]) {
    rows.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && this.set(x + i, y + j, ch)));
  }
  /** Replaces one character with another within a box. */
  recolor(x: number, y: number, w: number, h: number, from: string, to: string) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.get(i, j) === from) this.set(i, j, to);
  }
  /** 1px dark outline round the silhouette (inner edges keep their own shade). */
  outline() {
    const solid = (x: number, y: number) => this.get(x, y) !== '.';
    const add: [number, number][] = [];
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++)
        if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) add.push([x, y]);
    for (const [x, y] of add) this.set(x, y, 'k');
  }
  rows() {
    return this.g.map((r) => r.join(''));
  }
}

// ---- Shared head ----

const HEAD = { cx: 16, cy: 14.5, rx: 8.6, ry: 10.6 };
const inHead = (x: number, y: number, pad = 0) => {
  const dx = (x + 0.5 - HEAD.cx) / (HEAD.rx + pad);
  const dy = (y + 0.5 - HEAD.cy) / (HEAD.ry + pad);
  return dx * dx + dy * dy <= 1;
};

/** Shoulders (in `top`), neck, ears and the head, shaded from the top left. */
function body(p: Canvas, top = '5') {
  const { skin, skinShade } = p.c;
  // Shoulders: a trapezoid that runs off the bottom edge.
  for (let y = 25; y < N; y++) {
    const half = Math.min(15, 8 + (y - 25) * 3);
    p.rect(16 - half, y, half * 2, 1, top);
  }
  // Neck, in the chin's shadow.
  p.rect(12, 21, 8, 6, skinShade);
  p.rect(12, 21, 2, 4, skin);
  // Ears.
  p.rect(6, 13, 2, 4, skin);
  p.rect(24, 13, 2, 4, skinShade);
  p.set(7, 14, skinShade);
  p.set(24, 14, skin);
  // Head: shade down the right side and under the jaw.
  p.ellipse(HEAD.cx, HEAD.cy, HEAD.rx, HEAD.ry, (x, y) => (x >= 21 || (y >= 22 && x >= 12) || (y >= 23) ? skinShade : skin));
}

/** Eyes, brows, nose and mouth for an expression. `y` shifts brows (glasses push them up). */
function face(p: Canvas, f: Face, opts: { browY?: number; lashes?: boolean; lips?: string } = {}) {
  const { brow, mouth, skinShade } = p.c;
  const by = opts.browY ?? 10;
  if (f === 'neutral') {
    p.rect(10, by, 4, 1, brow);
    p.rect(18, by, 4, 1, brow);
    p.stamp(10, 12, ['kkkk', 'wkkw']);
    p.stamp(18, 12, ['kkkk', 'wkkw']);
  } else {
    // One brow up, one down; eyes wide and sliding sideways at the console.
    p.stamp(10, by - 2, ['..' + brow + brow, '.' + brow + '..', brow + '...']);
    p.stamp(18, by, [brow + brow + brow + '.', '...' + brow]);
    p.stamp(10, 11, ['kkkk', 'wwkk', 'wwkk']);
    p.stamp(18, 12, ['kkkk', 'wwkk']);
  }
  if (opts.lashes) {
    p.set(9, 11, 'k');
    p.set(22, 11, 'k');
  }
  // Nose shadow.
  p.stamp(16, 15, [skinShade, skinShade, '.' + skinShade]);
  p.set(15, 17, skinShade);
  const lips = opts.lips;
  if (f === 'neutral') {
    // A small closed smile; painted lips get a fuller lower lip.
    if (lips) p.stamp(13, 19, ['.' + lips.repeat(4), '..' + lips.repeat(2)]);
    else p.stamp(13, 19, [mouth + '....' + mouth, '.' + skinShade + mouth + mouth + skinShade]);
  } else {
    // A grimace: gritted teeth.
    const m = lips ?? mouth;
    p.stamp(13, 19, ['.' + m.repeat(4), m + 'wwww' + m, '.' + m.repeat(4)]);
  }
}

function glasses(p: Canvas, round = false) {
  const frame = round
    ? ['.kkkk.', 'k....k', 'k....k', '.kkkk.']
    : ['kkkkkk', 'k....k', 'k....k', 'kkkkkk'];
  p.stamp(9, 11, frame);
  p.stamp(17, 11, frame);
  p.rect(15, 12, 2, 1, 'k');
  p.set(8, 12, 'k');
  p.set(23, 12, 'k');
}

// ---- Hair and headwear ----

/** A dome of hair over the top of the head, down to `fringe` at the front. */
function dome(p: Canvas, fringe = 8, ch = p.c.hair, shade = p.c.hairShade) {
  p.ellipse(HEAD.cx, HEAD.cy - 1, HEAD.rx + 1, HEAD.ry + 1, (x, y) => (y <= fringe || (y <= 13 && (x <= 7 || x >= 24)) ? (x >= 21 && y > 3 ? shade : ch) : undefined));
}

/** Long hair falling behind the head to the shoulders. */
function longBack(p: Canvas, bottom = 29, ch = p.c.hair, shade = p.c.hairShade) {
  for (let y = 4; y <= bottom; y++) {
    const half = y < 10 ? 9 + (y - 4) / 3 : 11;
    for (let x = Math.round(16 - half); x < Math.round(16 + half); x++) p.set(x, y, x >= 23 ? shade : ch);
  }
}

/** Curls: a two-tone checker for short natural or curly hair. */
function curls(p: Canvas, fringe = 8) {
  dome(p, fringe);
  for (let y = 0; y < 14; y++) for (let x = 0; x < N; x++) if (p.get(x, y) === p.c.hair && (x + y) % 2) p.set(x, y, p.c.hairShade);
}

// ---- Clothes ----

function neckline(p: Canvas, ch: string) {
  p.rect(11, 25, 10, 1, ch);
  p.set(10, 26, ch);
  p.set(21, 26, ch);
}

// ---- Heroes ----

type Builder = (p: Canvas, f: Face) => void;

const BUILD: Record<HeroId, { roles?: Partial<Roles>; draw: Builder }> = {
  classic: {
    roles: { skin: 's', skinShade: 'S', hair: 'N', hairShade: 'N', brow: 'N', mouth: 'R' },
    draw: (p, f) => {
      body(p, 'b');
      // Shirt sleeves at the edges, overall straps and buttons.
      p.rect(1, 28, 6, 4, 'o');
      p.rect(25, 28, 6, 4, 'o');
      p.rect(9, 25, 2, 7, 'B');
      p.rect(21, 25, 2, 7, 'B');
      p.set(10, 28, 'u');
      p.set(21, 28, 'u');
      p.rect(12, 26, 8, 1, 'o');
      // Sideburns, then the cap with its brim.
      p.rect(7, 9, 2, 5, 'N');
      p.rect(23, 9, 2, 5, 'N');
      p.ellipse(16, 8, 10, 7, (x, y) => (y <= 8 ? (x >= 21 ? 'C' : 'c') : undefined));
      p.rect(6, 8, 21, 2, 'C');
      p.rect(13, 3, 6, 4, 'w');
      p.rect(15, 4, 2, 2, 'c');
      face(p, f, { browY: 11 });
      // The moustache, over the mouth's top line.
      p.stamp(11, 17, ['NNNNNNNNNN', '.NNN..NNN.']);
    },
  },
  bearded: {
    roles: { brow: '2' },
    draw: (p, f) => {
      body(p);
      neckline(p, '6');
      // Bald: a shine on top.
      p.rect(11, 5, 3, 1, 'w');
      p.set(10, 6, 'w');
      face(p, f, { browY: 9 });
      // Beard: cheeks, jaw and chin, with the mouth showing through.
      p.ellipse(HEAD.cx, HEAD.cy + 1, HEAD.rx, HEAD.ry, (x, y) => (y >= 15 && (y >= 18 || x <= 10 || x >= 21) ? (x >= 21 ? '2' : '1') : undefined));
      p.rect(7, 13, 2, 4, '1');
      p.rect(23, 13, 2, 4, '2');
      p.stamp(13, 18, ['111111', '1' + (f === 'neutral' ? 'RRRR' : 'wwww') + '1', '.' + (f === 'neutral' ? '1111' : 'RRRR') + '.']);
      glasses(p);
    },
  },
  redhead: {
    draw: (p, f) => {
      longBack(p, 30);
      body(p, '3');
      // Tank top: straps over bare shoulders.
      p.rect(9, 25, 2, 7, '5');
      p.rect(21, 25, 2, 7, '5');
      p.rect(9, 29, 14, 3, '5');
      p.rect(9, 29, 14, 1, '6');
      dome(p, 7);
      // Parting and strands framing the face.
      p.rect(13, 3, 1, 5, '2');
      p.rect(7, 8, 2, 12, '1');
      p.rect(23, 8, 2, 12, '2');
      face(p, f);
    },
  },
  'mustard-jumper': {
    draw: (p, f) => {
      body(p);
      neckline(p, '6');
      p.rect(4, 29, 24, 1, '6');
      dome(p, 7);
      // Hair up in a bun.
      p.ellipse(16, 2.5, 4, 3, (x) => (x >= 18 ? '2' : '1'));
      p.rect(13, 5, 6, 1, '2');
      face(p, f, { browY: 9 });
      glasses(p);
    },
  },
  'denim-jacket': {
    draw: (p, f) => {
      body(p);
      // White tee in the jacket's open front, collar points.
      p.rect(12, 25, 8, 7, 'w');
      p.stamp(8, 25, ['6666', '.666', '..66']);
      p.stamp(20, 25, ['6666', '666.', '66..']);
      p.rect(11, 25, 1, 7, '6');
      p.rect(20, 25, 1, 7, '6');
      dome(p, 7);
      // Short purple hair swept over to one side.
      p.stamp(7, 7, ['1111111', '111111.', '1111...', '11.....']);
      face(p, f);
    },
  },
  hoodie: {
    draw: (p, f) => {
      body(p);
      // The hood bunched round the neck, and drawstrings.
      p.rect(8, 24, 16, 2, '6');
      p.rect(7, 25, 2, 3, '6');
      p.rect(23, 25, 2, 3, '6');
      p.rect(13, 26, 1, 5, 'w');
      p.rect(18, 26, 1, 5, 'w');
      curls(p, 7);
      face(p, f);
      // Stubble along the jaw.
      for (const [x, y] of [[10, 18], [12, 21], [14, 22], [17, 22], [19, 21], [21, 18], [11, 20], [20, 20]]) p.set(x, y, '4');
    },
  },
  emo: {
    draw: (p, f) => {
      body(p);
      // Band tee with a blotchy logo.
      p.ellipse(16, 29.5, 4, 2, '6');
      p.set(14, 29, '5');
      p.set(17, 30, '5');
      dome(p, 7);
      p.rect(7, 8, 2, 8, '1');
      p.rect(23, 8, 2, 6, '1');
      face(p, f);
      // The fringe sweeps right across one eye, with its purple streak.
      p.stamp(6, 7, [
        '111111111111',
        '11111111111.',
        '1111111111..',
        '111111111...',
        '11111111....',
        '.111111.....',
        '..1111......',
      ]);
      p.rect(12, 7, 1, 4, '2');
      p.rect(11, 9, 1, 3, '2');
    },
  },
  goth: {
    draw: (p, f) => {
      longBack(p, 30);
      body(p);
      // Lace trim along the neckline, and a choker.
      for (let x = 9; x < 23; x += 2) p.set(x, 25, '6');
      p.rect(12, 23, 8, 1, 'k');
      p.set(16, 24, '6');
      // Straight hair with a blunt fringe.
      dome(p, 9);
      p.rect(7, 9, 2, 16, '1');
      p.rect(23, 9, 2, 16, '2');
      p.rect(9, 9, 14, 1, '2');
      face(p, f, { browY: 11, lips: 'P' });
    },
  },
  punk: {
    draw: (p, f) => {
      body(p);
      // Leather jacket lapels over a white tee, studs on the shoulders.
      p.rect(12, 25, 8, 7, '6');
      p.stamp(9, 25, ['5k', '55k', '555k']);
      p.stamp(20, 25, ['k5', 'k55', 'k555']);
      for (const x of [4, 7, 24, 27]) p.set(x, 28, 'l');
      // Shaved sides with a little stubble, then the mohawk running off the top.
      for (let x = 9; x <= 22; x += 2) p.set(x, 5 + (x % 4 === 1 ? 1 : 0), '4');
      p.ellipse(16, 4, 3.4, 6, (x) => (x >= 17 ? '2' : '1'));
      p.rect(14, 0, 4, 4, '1');
      p.rect(17, 0, 1, 4, '2');
      face(p, f);
      // Ear piercings.
      p.set(6, 16, 'l');
      p.set(25, 16, 'l');
      p.set(25, 14, 'l');
    },
  },
  'rainbow-tee': {
    draw: (p, f) => {
      body(p, 'r');
      // The rainbow stripes across the tee.
      ['r', 'o', 'u', 'g', 'b', 'p'].forEach((c, i) => p.recolor(0, 26 + i, N, 1, 'r', c));
      neckline(p, 'r');
      curls(p, 7);
      face(p, f);
    },
  },
  'trans-flag-hair': {
    draw: (p, f) => {
      longBack(p, 30);
      body(p, '6');
      // Dungaree straps and bib over a white tee.
      p.rect(9, 25, 2, 7, '5');
      p.rect(21, 25, 2, 7, '5');
      p.rect(11, 29, 10, 3, '5');
      p.set(10, 27, 'u');
      p.set(21, 27, 'u');
      dome(p, 7);
      p.rect(7, 8, 2, 14, '1');
      p.rect(23, 8, 2, 14, '1');
      // Dyed in bands: light blue on top, pink, white, pink, light blue.
      const band = (y: number) => (y < 7 ? 'c' : y < 13 ? 'q' : y < 19 ? 'w' : y < 25 ? 'q' : 'c');
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (p.get(x, y) === '1' || p.get(x, y) === '2') p.set(x, y, band(y));
      face(p, f);
    },
  },
  'trans-pin': {
    draw: (p, f) => {
      body(p);
      // Cardigan open over a white tee, with the striped pin.
      p.rect(12, 25, 8, 7, '6');
      p.rect(11, 25, 1, 7, 'k');
      p.rect(20, 25, 1, 7, 'k');
      p.stamp(7, 27, ['c', 'q', 'w', 'q', 'c']);
      // Undercut: hair on top, clipped sides in skin shade.
      dome(p, 7);
      p.rect(7, 8, 2, 5, '4');
      p.rect(23, 8, 2, 5, '4');
      p.rect(8, 5, 16, 1, '2');
      face(p, f);
      // Moustache.
      p.stamp(12, 17, ['22222222', '.222222.']);
    },
  },
  'bi-bomber': {
    draw: (p, f) => {
      body(p);
      // Jacket in magenta, purple and blue bands, ribbed collar.
      p.recolor(0, 28, N, 2, '5', '6');
      p.recolor(0, 30, N, 2, '5', 'B');
      p.rect(10, 24, 12, 2, '6');
      p.rect(15, 26, 2, 6, 'k');
      curls(p, 6);
      face(p, f);
    },
  },
  'drag-glam': {
    roles: { brow: 'k' },
    draw: (p, f) => {
      // The wig: bigger than the frame, curls catching the light.
      p.ellipse(16, 13, 15, 16, (x, y) => ((x * 3 + y * 5) % 7 === 0 ? '2' : '1'));
      body(p, '3');
      // Sparkly gown below bare shoulders.
      p.rect(4, 29, 24, 3, '5');
      for (const [x, y] of [[7, 30], [12, 29], [18, 31], [23, 30]]) p.set(x, y, 'u');
      p.ellipse(16, 4, 9, 4, (x, y) => ((x + y) % 5 === 0 ? '2' : '1'));
      p.rect(8, 7, 16, 2, '1');
      face(p, f, { lashes: true, lips: 'r' });
      // Eyeshadow and earrings.
      p.rect(10, 11, 4, 1, 'p');
      p.rect(18, 11, 4, 1, 'p');
      p.rect(6, 17, 1, 3, 'u');
      p.rect(25, 17, 1, 3, 'u');
    },
  },
  'nb-beanie': {
    draw: (p, f) => {
      body(p);
      // Striped scarf.
      ['u', 'w', 'p', 'k'].forEach((c, i) => p.rect(9, 23 + i, 14, 1, c));
      p.rect(17, 27, 3, 4, 'p');
      p.rect(17, 29, 3, 1, 'u');
      // Hair peeking out under the beanie.
      p.rect(7, 9, 2, 5, '2');
      p.rect(23, 9, 2, 5, '2');
      face(p, f);
      // Beanie: stripes, a folded brim and a bobble that runs off the top.
      p.ellipse(16, 8.5, 10, 8, (x, y) => (y <= 9 ? ['u', 'u', 'w', 'w', 'p', 'p', 'k', 'u', 'w', 'p'][Math.max(0, y)] : undefined));
      p.rect(6, 8, 20, 2, 'p');
      p.ellipse(16, 0.5, 2.5, 2, 'u');
    },
  },
  'hijab-skater': {
    draw: (p, f) => {
      body(p);
      // Skate hoodie with a pocket line.
      p.rect(4, 30, 24, 1, '6');
      // Hijab: wraps the head and drapes over the shoulders, framing the face.
      p.ellipse(16, 14, 11, 13, (x) => (x >= 22 ? '2' : '1'));
      p.rect(5, 22, 22, 6, '1');
      p.rect(22, 22, 5, 6, '2');
      p.ellipse(HEAD.cx, HEAD.cy + 0.5, 6.8, 8.6, (x, y) => (x >= 20 || y >= 21 ? '4' : '3'));
      p.rect(9, 7, 14, 1, '2');
      face(p, f);
    },
  },
  'silver-locs': {
    draw: (p, f) => {
      longBack(p, 31);
      body(p);
      neckline(p, '6');
      dome(p, 7);
      p.rect(6, 8, 3, 19, '1');
      p.rect(23, 8, 3, 19, '2');
      // Locs: alternate strands of silver and grey.
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (p.get(x, y) === '1' && x % 2) p.set(x, y, '2');
      face(p, f, { browY: 9 });
      glasses(p, true);
    },
  },
  flannel: {
    draw: (p, f) => {
      body(p);
      // Red plaid over a white tee.
      for (let y = 25; y < N; y++) for (let x = 0; x < N; x++) if (p.get(x, y) === '5' && (x % 4 === 1 || y % 4 === 3)) p.set(x, y, '6');
      p.stamp(13, 25, ['wwwwww', '.wwww.', '..ww..']);
      // Side-swept crop with a shaved side.
      dome(p, 7);
      p.rect(7, 6, 2, 7, '4');
      p.stamp(9, 7, ['1111111111', '..11111111', '.....1111.']);
      face(p, f);
    },
  },
};

function build(id: HeroId, f: Face): string[] {
  const def = BUILD[id];
  const p = new Canvas({ ...SLOTS, ...def.roles });
  def.draw(p, f);
  p.outline();
  return p.rows();
}

/** Every hero's portraits, by expression. */
export const PORTRAITS = Object.fromEntries(
  (Object.keys(BUILD) as HeroId[]).map((id) => [id, Object.fromEntries(FACES.map((f) => [f, build(id, f)]))]),
) as Record<HeroId, Record<Face, string[]>>;

/** The colours a hero's portrait may use: its sprite slots plus the shared palette. */
export function portraitColors(id: HeroId): Record<string, string> {
  return { ...PALETTE, ...HEROES[id]?.colors };
}

const cache = new Map<string, HTMLCanvasElement>();

/** A 32x32 canvas of a hero's portrait (scale it up with CSS, pixelated). */
export function portraitCanvas(id: HeroId, f: Face = 'neutral'): HTMLCanvasElement {
  const key = `${id}:${f}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  const colors = portraitColors(id);
  PORTRAITS[id][f].forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = colors[ch];
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  cache.set(key, c);
  return c;
}

// ---- Emote icons (white, 7x7) for the corner of the portrait panel ----

export type Mood = 'happy' | 'meh' | 'shocked' | 'sad';
export const MOODS: Mood[] = ['happy', 'meh', 'shocked', 'sad'];

export const EMOTES: Record<Mood, string[]> = {
  happy: ['.......', '.w...w.', '.w...w.', '.......', 'w.....w', '.w...w.', '..www..'],
  meh: ['.......', '.w...w.', '.w...w.', '.......', '.......', '.wwwww.', '.......'],
  shocked: ['w.....w', '.w...w.', '.......', '..www..', '.w...w.', '.w...w.', '..www..'],
  sad: ['.......', '.w...w.', '.w...w.', '.......', '..www..', '.w...w.', 'w.....w'],
};

export function emoteCanvas(m: Mood): HTMLCanvasElement {
  const key = `emote:${m}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 7;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = PALETTE.w;
  EMOTES[m].forEach((row, y) => [...row].forEach((ch, x) => ch === 'w' && ctx.fillRect(x, y, 1, 1)));
  cache.set(key, c);
  return c;
}
