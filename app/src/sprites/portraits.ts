import type { HeroId } from '@quest/shared';
import { HEROES } from './heroes';
import { canvas } from './canvas';
import { PALETTE } from './pixels';

/**
 * 32x32 head-and-shoulders portraits for dialogue, one per hero and
 * expression. The one deliberate exception to "everything is 16px".
 *
 * Each portrait is a character map like the sprites (the hero's digit colour
 * slots plus PALETTE letters). They share one hand-shaped head: it fills the
 * frame, light comes from the top left (a base and a shade per colour, the
 * shade sweeping across the jaw), eyes have a lid, white, iris and pupil, and
 * brows carry the expression. Each hero adds its own hair, clothes and
 * accessories to match its sprite, then a 1px dark outline goes round the
 * silhouette.
 */
export type Face = 'neutral' | 'reacting';
export const FACES: Face[] = ['neutral', 'reacting'];
export const PORTRAIT_SIZE = 32;

const N = PORTRAIT_SIZE;

/**
 * Colour roles, written into the grid as symbols that aren't palette
 * letters and swapped for the hero's own characters at the end.
 */
const SKIN = '@';
const SHADE = '%';
const HAIR = '#';
const HAIR_SHADE = '=';
const BROW = '~';
const IRIS = '&';
const MOUTH = '^';

interface Roles {
  skin: string;
  skinShade: string;
  hair: string;
  hairShade: string;
  brow: string;
  iris: string;
  mouth: string;
}

const SLOTS: Roles = { skin: '3', skinShade: '4', hair: '1', hairShade: '2', brow: '2', iris: 'N', mouth: 'R' };

// ---- The head ----

/** Half-width of the head on each row (centre 15.5): broad temples and cheeks, tapering to the chin. */
const HALF: Record<number, number> = {
  2: 3, 3: 5, 4: 7, 5: 8, 6: 9, 7: 9, 8: 10, 9: 10, 10: 10, 11: 10, 12: 10, 13: 10, 14: 10, 15: 10, 16: 10, 17: 10,
  18: 10, 19: 9, 20: 9, 21: 8, 22: 8, 23: 7, 24: 6, 25: 5, 26: 3,
};
const left = (y: number) => 16 - HALF[y];
const right = (y: number) => 15 + HALF[y];
const inHead = (x: number, y: number) => HALF[y] !== undefined && x >= left(y) && x <= right(y);

class Portrait {
  g: string[][] = Array.from({ length: N }, () => Array<string>(N).fill('.'));

  set(x: number, y: number, ch: string) {
    if (x >= 0 && y >= 0 && x < N && y < N) this.g[y][x] = ch;
  }
  get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < N && y < N ? this.g[y][x] : '.';
  }
  rect(x: number, y: number, w: number, h: number, ch: string) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, ch);
  }
  /** Rows of a pattern at (x, y); '.' leaves the cell alone. */
  stamp(x: number, y: number, rows: string[]) {
    rows.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && this.set(x + i, y + j, ch)));
  }
  /** Calls `fn` for every cell; returning a character paints it. */
  each(fn: (x: number, y: number, ch: string) => string | undefined | void) {
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const out = fn(x, y, this.g[y][x]);
        if (out) this.g[y][x] = out;
      }
  }
  /** 1px dark outline round the silhouette (inner edges keep their own shade). */
  outline() {
    const solid = (x: number, y: number) => this.get(x, y) !== '.';
    const add: [number, number][] = [];
    this.each((x, y) => {
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) add.push([x, y]);
    });
    for (const [x, y] of add) this.set(x, y, 'k');
  }
  rows(r: Roles) {
    const map: Record<string, string> = { [SKIN]: r.skin, [SHADE]: r.skinShade, [HAIR]: r.hair, [HAIR_SHADE]: r.hairShade, [BROW]: r.brow, [IRIS]: r.iris, [MOUTH]: r.mouth };
    return this.g.map((row) => row.map((ch) => map[ch] ?? ch).join(''));
  }
}

/** Light from the top left: the right side and, lower down, a diagonal across the jaw are in shade. */
const shaded = (x: number, y: number) => x + Math.max(0, y - 17) >= 22 || y >= 25;

/** Shoulders in `top`, then the neck, ears and head. */
function body(p: Portrait, top = '5') {
  p.rect(5, 27, 22, 1, top);
  p.rect(3, 28, 26, 1, top);
  p.rect(1, 29, 30, 3, top);
  // Neck, mostly in the chin's shadow.
  p.rect(11, 23, 10, 6, SHADE);
  p.rect(11, 23, 2, 4, SKIN);
  // Ears: the left one catches the light, the right one doesn't.
  p.stamp(4, 12, ['.@', '@%', '@%', '@%', '@%', '.@']);
  p.stamp(26, 12, ['%.', '%%', '%%', '%%', '%%', '%.']);
  p.each((x, y) => (inHead(x, y) ? (shaded(x, y) ? SHADE : SKIN) : undefined));
}

interface FaceOpts {
  /** Brow row (glasses push them up). */
  browY?: number;
  lashes?: boolean;
  /** Painted lips in this colour. */
  lips?: string;
}

/** Brows, eyes, nose and mouth for an expression. */
function face(p: Portrait, f: Face, o: FaceOpts = {}) {
  const by = o.browY ?? 10;
  // Nose: a shadow down its right side, then the nostrils.
  p.rect(17, 14, 1, 3, SHADE);
  p.rect(15, 17, 3, 1, SHADE);
  if (f === 'neutral') {
    p.stamp(9, by, [BROW.repeat(5), BROW]);
    p.stamp(18, by, [BROW.repeat(5), '....' + BROW]);
    p.stamp(9, 12, ['kkkkk', '.w' + IRIS + 'kw']);
    p.stamp(18, 12, ['kkkkk', 'w' + IRIS + 'kw']);
    if (o.lips) p.stamp(13, 20, [o.lips.repeat(6), '.' + o.lips.repeat(4)]);
    else p.stamp(13, 20, [SHADE + '....' + SHADE, '.' + MOUTH.repeat(4), '..' + SHADE + SHADE]);
  } else {
    // One brow shot up, the other down and in; eyes wide, glancing at the console.
    p.stamp(9, by - 2, ['..' + BROW.repeat(3), BROW.repeat(2)]);
    p.stamp(18, by, [BROW.repeat(4), '....' + BROW]);
    p.stamp(9, 11, ['.kkkk', '.ww' + IRIS + 'k', '.ww' + IRIS + 'k', '.' + SHADE.repeat(4)]);
    p.stamp(18, 12, ['kkkkk', 'ww' + IRIS + 'k']);
    const m = o.lips ?? MOUTH;
    p.stamp(13, 20, [m.repeat(6), m + 'wwww' + m, '.' + m.repeat(4)]);
  }
  if (o.lashes) {
    p.set(8, 11, 'k');
    p.set(23, 11, 'k');
  }
}

/** Specs in front of the eyes: lenses tint the skin pale, eyes show through. */
function glasses(p: Portrait, round = false) {
  const lens = (x0: number) => {
    for (let y = 12; y <= 14; y++) for (let x = x0 + 1; x <= x0 + 5; x++) if (p.get(x, y) === SKIN || p.get(x, y) === SHADE) p.set(x, y, 'l');
    p.rect(x0, 11, 7, 1, 'k');
    p.rect(x0, 15, 7, 1, 'k');
    p.rect(x0, 11, 1, 5, 'k');
    p.rect(x0 + 6, 11, 1, 5, 'k');
    if (round) for (const [x, y] of [[x0, 11], [x0 + 6, 11], [x0, 15], [x0 + 6, 15]]) p.set(x, y, p.get(x, y + (y === 11 ? -1 : 1)) === '.' ? '.' : SKIN);
  };
  lens(8);
  lens(17);
  p.rect(15, 12, 2, 1, 'k');
  p.rect(6, 12, 2, 1, 'k');
  p.rect(24, 12, 2, 1, 'k');
}

// ---- Hair ----

/** Hair texture: clean strand lines of shade (no dither), and the right side in shade. */
const strands = (x: number, y: number) => (x >= 23 || (x % 4 === 0 && y >= 3) ? HAIR_SHADE : HAIR);
/** Curl clusters: 2x2 blobs of base and shade, offset row to row. */
const blobs = (x: number, y: number) => ((Math.floor((x + (Math.floor(y / 2) % 2)) / 2) + Math.floor(y / 2)) % 2 ? HAIR_SHADE : HAIR);

/**
 * Hair over the top of the head, a pixel proud of the skull, down to
 * `fringe` at the front (a little ragged) and to `sides` at the temples.
 */
function dome(p: Portrait, fringe = 7, sides = 11) {
  for (let y = 0; y <= sides; y++)
    for (let x = 0; x < N; x++) {
      const h = HALF[y] ?? (y < 2 ? HALF[2] - (2 - y) : undefined);
      if (h === undefined || x < 15 - h || x > 16 + h) continue;
      const edge = fringe + ((x * 7) % 3 === 0 ? 1 : 0);
      if (y <= edge || x <= 7 || x >= 24) p.set(x, y, strands(x, y));
    }
}

/** Long hair falling behind the head and over the shoulders, to `bottom`. */
function longBack(p: Portrait, bottom = 31) {
  for (let y = 2; y <= bottom; y++) {
    const h = y < 12 ? Math.min(12, (HALF[y] ?? 3) + 2) : 12;
    for (let x = 16 - h; x <= 15 + h; x++) p.set(x, y, strands(x, y));
  }
}

/** Tight curls: a checker of base and shade. */
function curls(p: Portrait, fringe = 6, sides = 11) {
  dome(p, fringe, sides);
  p.each((x, y, ch) => (y <= sides && (ch === HAIR || ch === HAIR_SHADE) ? blobs(x, y) : undefined));
}

/** A strand hanging down the side of the face, from y0 to y1. */
function lock(p: Portrait, x: number, y0: number, y1: number, w = 2) {
  for (let y = y0; y <= y1; y++) for (let i = 0; i < w; i++) p.set(x + i, y, x + i >= 23 ? HAIR_SHADE : HAIR);
}

/** A neckline in `ch` round the base of the neck. */
function neckline(p: Portrait, ch: string) {
  p.rect(10, 27, 12, 1, ch);
  p.set(9, 28, ch);
  p.set(22, 28, ch);
}

// ---- Heroes ----

interface Def {
  roles?: Partial<Roles>;
  draw: (p: Portrait, f: Face) => void;
}

const BUILD: Record<HeroId, Def> = {
  classic: {
    roles: { skin: 's', skinShade: 'S', hair: 'N', hairShade: 'N', brow: 'N', iris: 'b' },
    draw: (p, f) => {
      body(p, 'b');
      // Shirt at the shoulders, overall straps with buttons.
      p.rect(1, 29, 6, 3, 'o');
      p.rect(25, 29, 6, 3, 'o');
      p.rect(10, 28, 12, 1, 'o');
      p.rect(8, 27, 2, 5, 'B');
      p.rect(22, 27, 2, 5, 'B');
      p.set(8, 29, 'u');
      p.set(23, 29, 'u');
      // Sideburns, then the cap: crown, badge and a peak over the brow.
      lock(p, 6, 8, 13);
      lock(p, 24, 8, 13);
      for (let y = 0; y <= 8; y++) {
        const h = Math.min(11, (HALF[Math.max(2, y)] ?? 3) + 1 + (y < 2 ? -1 : 0));
        for (let x = 16 - h; x <= 15 + h; x++) p.set(x, y, x >= 21 ? 'C' : 'c');
      }
      p.rect(13, 2, 6, 4, 'w');
      p.rect(15, 3, 2, 2, 'c');
      p.rect(4, 8, 24, 2, 'C');
      p.rect(4, 8, 24, 1, 'c');
      face(p, f, { browY: 11 });
      // A big moustache over the mouth.
      p.stamp(10, 18, ['NNNNNNNNNNNN', '.NNNN..NNNN.']);
    },
  },
  bearded: {
    draw: (p, f) => {
      body(p);
      neckline(p, '6');
      // Bald, with a shine.
      p.stamp(10, 3, ['.ww', 'ww.', 'w..']);
      face(p, f, { browY: 9 });
      // The beard: up the cheeks, full below the nose, the mouth showing through.
      p.each((x, y) => {
        if (!inHead(x, y) || y < 15) return;
        if (y < 19 && x > 9 && x < 22) return;
        return x >= 22 || (x % 3 === 0 && y >= 20) ? HAIR_SHADE : HAIR;
      });
      p.stamp(4, 15, ['.#', '##']);
      p.stamp(26, 15, ['=.', '==']);
      p.rect(14, 18, 4, 1, HAIR);
      p.stamp(12, 19, ['########', '#' + (f === 'neutral' ? '.' + MOUTH.repeat(4) + '.' : MOUTH + 'wwww' + MOUTH) + '#', '##' + (f === 'neutral' ? '####' : MOUTH.repeat(4)) + '##']);
      glasses(p);
    },
  },
  redhead: {
    draw: (p, f) => {
      longBack(p);
      body(p, SKIN);
      // Tank top: straps over bare shoulders.
      p.rect(8, 27, 2, 5, '5');
      p.rect(22, 27, 2, 5, '5');
      p.rect(8, 30, 16, 2, '5');
      p.rect(8, 30, 16, 1, '6');
      dome(p, 6, 12);
      // A side parting and long strands framing the face.
      p.rect(12, 1, 1, 5, HAIR_SHADE);
      lock(p, 5, 9, 26, 2);
      lock(p, 25, 9, 26, 2);
      face(p, f);
    },
  },
  'mustard-jumper': {
    draw: (p, f) => {
      body(p);
      // Ribbed neckline and hem stripe.
      neckline(p, '6');
      p.rect(1, 30, 30, 1, '6');
      dome(p, 6);
      // Hair up in a bun, tied with a band.
      p.stamp(12, 0, ['.####=.', '#####==', '.#####=']);
      p.rect(13, 3, 6, 1, HAIR_SHADE);
      face(p, f, { browY: 9 });
      glasses(p);
    },
  },
  'denim-jacket': {
    draw: (p, f) => {
      body(p);
      // White tee in the jacket's open front, collar points.
      p.rect(12, 27, 8, 5, 'w');
      p.stamp(6, 27, ['666666', '.66666', '..6666']);
      p.stamp(20, 27, ['666666', '66666.', '6666..']);
      p.rect(11, 28, 1, 4, '6');
      p.rect(20, 28, 1, 4, '6');
      dome(p, 5);
      // Short purple hair swept over to one side.
      p.stamp(6, 6, ['##########', '#########.', '#######...', '#####.....', '###.......']);
      face(p, f);
    },
  },
  hoodie: {
    draw: (p, f) => {
      body(p);
      // The hood bunched round the neck, and drawstrings.
      p.rect(7, 26, 18, 2, '6');
      p.rect(5, 27, 3, 3, '6');
      p.rect(24, 27, 3, 3, '6');
      p.rect(13, 28, 1, 4, 'w');
      p.rect(18, 28, 1, 4, 'w');
      // Dark wavy hair.
      dome(p, 6);
      p.each((x, y, ch) => (y <= 11 && (ch === HAIR || ch === HAIR_SHADE) ? (x >= 23 || (y + Math.round(Math.sin(x / 2) * 1.5)) % 4 === 0 ? HAIR_SHADE : HAIR) : undefined));
      face(p, f);
      // Stubble along the jaw and chin.
      p.each((x, y) => (inHead(x, y) && y >= 19 && (x + y) % 2 === 0 && (y >= 23 || x <= 10 || x >= 21) ? SHADE : undefined));
    },
  },
  emo: {
    draw: (p, f) => {
      body(p);
      // Band tee with a blotchy logo.
      p.stamp(12, 29, ['.6666.', '66.666', '.66.6.']);
      dome(p, 6, 13);
      lock(p, 6, 10, 18);
      lock(p, 24, 10, 15);
      face(p, f);
      // The fringe sweeps right across one eye, with its purple streak.
      p.stamp(5, 6, [
        '##############',
        '#############.',
        '############..',
        '###########...',
        '##########....',
        '.#########....',
        '..#######.....',
        '...####.......',
      ]);
      p.rect(12, 5, 1, 6, HAIR_SHADE);
      p.rect(11, 9, 1, 3, HAIR_SHADE);
    },
  },
  goth: {
    draw: (p, f) => {
      longBack(p);
      body(p);
      // Lace trim along the neckline, a choker with a charm.
      for (let x = 7; x < 25; x += 2) p.set(x, 27, '6');
      p.rect(11, 24, 10, 1, 'k');
      p.set(16, 25, '6');
      // Straight hair, a blunt fringe, curtains down each side.
      dome(p, 8);
      p.rect(8, 9, 16, 1, HAIR_SHADE);
      lock(p, 5, 9, 28, 3);
      lock(p, 24, 9, 28, 3);
      face(p, f, { browY: 11, lips: 'P' });
    },
  },
  punk: {
    draw: (p, f) => {
      body(p);
      // Leather jacket lapels over a white tee, studs on the shoulders.
      p.rect(12, 27, 8, 5, '6');
      p.stamp(8, 27, ['55k', '555k', '5555k']);
      p.stamp(21, 27, ['k55', 'k555', 'k5555']);
      for (const x of [3, 6, 25, 28]) p.set(x, 29, 'l');
      // Shaved sides, then the mohawk running off the top, combed into strands.
      for (let y = 0; y <= 8; y++) for (let x = 13; x <= 18; x++) p.set(x, y, x >= 17 || x === 15 ? HAIR_SHADE : HAIR);
      face(p, f, { browY: 10 });
      // Ear piercings.
      p.set(4, 16, 'l');
      p.set(27, 16, 'l');
      p.set(27, 13, 'l');
    },
  },
  'rainbow-tee': {
    draw: (p, f) => {
      body(p, 'r');
      // Rainbow stripes across the tee.
      ['r', 'r', 'o', 'u', 'g', 'b', 'p'].forEach((c, i) => p.each((x, y, ch) => (y === 25 + i && ch === 'r' ? c : undefined)));
      neckline(p, 'r');
      curls(p, 5);
      face(p, f);
    },
  },
  'trans-flag-hair': {
    draw: (p, f) => {
      longBack(p);
      body(p, '6');
      // Dungaree straps and bib over a white tee, with buttons.
      p.rect(8, 27, 2, 5, '5');
      p.rect(22, 27, 2, 5, '5');
      p.rect(10, 30, 12, 2, '5');
      p.set(9, 29, 'u');
      p.set(22, 29, 'u');
      dome(p, 6, 12);
      lock(p, 5, 9, 26, 2);
      lock(p, 25, 9, 26, 2);
      // Dyed in bands: light blue, pink, white, pink, light blue.
      const band = (y: number) => (y < 7 ? 'c' : y < 13 ? 'q' : y < 19 ? 'w' : y < 25 ? 'q' : 'c');
      p.each((x, y, ch) => (ch === HAIR || ch === HAIR_SHADE ? band(y) : undefined));
      face(p, f);
    },
  },
  'trans-pin': {
    draw: (p, f) => {
      body(p);
      // Cardigan open over a white tee, with the striped pin.
      p.rect(12, 27, 8, 5, '6');
      p.rect(11, 27, 1, 5, 'k');
      p.rect(20, 27, 1, 5, 'k');
      p.stamp(6, 28, ['c', 'q', 'w', 'q']);
      // Undercut: hair on top, clipped sides in skin shade.
      dome(p, 6, 7);
      p.rect(6, 7, 2, 5, SHADE);
      p.rect(24, 7, 2, 5, SHADE);
      p.rect(7, 4, 18, 1, HAIR_SHADE);
      face(p, f);
      // A neat moustache.
      p.stamp(12, 18, ['########', '.######.']);
      p.rect(19, 18, 1, 1, HAIR_SHADE);
    },
  },
  'bi-bomber': {
    draw: (p, f) => {
      body(p);
      // Jacket in magenta, purple and blue bands, ribbed collar, zip.
      p.each((x, y, ch) => (ch === '5' && y >= 30 ? 'B' : ch === '5' && y >= 29 ? '6' : undefined));
      p.rect(9, 26, 14, 2, '6');
      p.rect(15, 28, 2, 4, 'k');
      curls(p, 5);
      face(p, f);
    },
  },
  'drag-glam': {
    roles: { brow: 'k', iris: 'b' },
    draw: (p, f) => {
      // The wig: bigger than the frame, curls catching the light.
      for (let y = 0; y < 30; y++) for (let x = 0; x < N; x++) {
        const dx = (x + 0.5 - 16) / 15.5;
        const dy = (y + 0.5 - 13) / 16;
        if (dx * dx + dy * dy <= 1) p.set(x, y, x >= 26 ? HAIR_SHADE : blobs(x, y));
      }
      body(p, SKIN);
      // Sparkly gown below bare shoulders.
      p.rect(5, 30, 22, 2, '5');
      for (const [x, y] of [[7, 30], [12, 31], [18, 30], [24, 31]]) p.set(x, y, 'u');
      // The wig's front: volume over the forehead.
      dome(p, 5, 9);
      p.each((x, y, ch) => (y <= 9 && (ch === HAIR || ch === HAIR_SHADE) ? blobs(x, y) : undefined));
      face(p, f, { lashes: true, lips: 'r' });
      // Eyeshadow and drop earrings.
      p.rect(9, 11, 5, 1, 'p');
      p.rect(18, 11, 5, 1, 'p');
      p.rect(4, 18, 1, 3, 'u');
      p.rect(27, 18, 1, 3, 'u');
    },
  },
  'nb-beanie': {
    draw: (p, f) => {
      body(p);
      // Striped scarf, an end hanging down.
      ['u', 'w', 'p', 'k'].forEach((c, i) => p.rect(8, 24 + i, 16, 1, c));
      p.rect(17, 28, 4, 4, 'p');
      p.rect(17, 30, 4, 1, 'u');
      // Hair under the beanie.
      lock(p, 6, 9, 13);
      lock(p, 24, 9, 13);
      face(p, f);
      // Beanie: stripes, folded brim, and a bobble running off the top.
      const stripe = ['u', 'u', 'w', 'w', 'p', 'p', 'k', 'k'];
      for (let y = 0; y <= 7; y++) {
        const h = Math.min(11, (HALF[Math.max(2, y)] ?? 3) + 1 + (y < 2 ? -1 : 0));
        for (let x = 16 - h; x <= 15 + h; x++) p.set(x, y, stripe[y]);
      }
      p.rect(5, 8, 22, 2, 'p');
      p.rect(5, 8, 22, 1, 'u');
      p.stamp(14, 0, ['uuuu']);
    },
  },
  'hijab-skater': {
    draw: (p, f) => {
      body(p);
      // Skate hoodie with a pocket seam.
      p.rect(1, 31, 30, 1, '6');
      // The hijab wraps the head and drapes over the shoulders...
      for (let y = 0; y < 30; y++)
        for (let x = 0; x < N; x++) {
          const dx = (x + 0.5 - 16) / 12.5;
          const dy = (y + 0.5 - 14) / 15;
          if (dx * dx + dy * dy <= 1) p.set(x, y, x >= 23 ? HAIR_SHADE : HAIR);
        }
      p.rect(4, 22, 24, 6, HAIR);
      p.rect(22, 22, 6, 6, HAIR_SHADE);
      // ...framing the face.
      p.each((x, y) => {
        const dx = (x + 0.5 - 16) / 8.6;
        const dy = (y + 0.5 - 15.5) / 10.6;
        if (dx * dx + dy * dy <= 1) return shaded(x, y) ? SHADE : SKIN;
      });
      p.rect(8, 6, 16, 1, HAIR_SHADE);
      face(p, f);
    },
  },
  'silver-locs': {
    draw: (p, f) => {
      longBack(p);
      body(p);
      neckline(p, '6');
      dome(p, 6, 12);
      lock(p, 4, 9, 28, 3);
      lock(p, 25, 9, 28, 3);
      // Locs: alternate strands of silver and grey.
      p.each((x, y, ch) => (ch === HAIR && x % 2 ? HAIR_SHADE : ch === HAIR_SHADE && x % 2 === 0 && x < 23 ? HAIR : undefined));
      face(p, f, { browY: 9 });
      glasses(p, true);
    },
  },
  flannel: {
    draw: (p, f) => {
      body(p);
      // Red plaid over a white tee.
      p.each((x, y, ch) => (ch === '5' && y >= 27 && (x % 4 === 1 || y % 4 === 3) ? '6' : undefined));
      p.stamp(12, 27, ['wwwwwwww', '.wwwwww.', '..wwww..']);
      // Side-swept crop with a shaved side.
      dome(p, 5, 9);
      p.rect(6, 5, 2, 7, SHADE);
      p.stamp(8, 6, ['############', '...#########', '......#####.']);
      face(p, f);
    },
  },
};

function build(id: HeroId, f: Face): string[] {
  const def = BUILD[id];
  const p = new Portrait();
  def.draw(p, f);
  p.outline();
  return p.rows({ ...SLOTS, ...def.roles });
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
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(N, N);
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
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(7, 7);
  ctx.fillStyle = PALETTE.w;
  EMOTES[m].forEach((row, y) => [...row].forEach((ch, x) => ch === 'w' && ctx.fillRect(x, y, 1, 1)));
  cache.set(key, c);
  return c;
}
