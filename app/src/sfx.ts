/**
 * Sound effects as note tables, played by the synth in `audio.ts`. No audio
 * files: each sound is a few oscillator or noise notes with an envelope.
 * Auditioned on the sound board for issue #20; retune here.
 */

/** NES-style narrow pulses (`pulse25`, `pulse12`), plain WebAudio waves, or filtered white noise. */
export type Wave = 'square' | 'pulse25' | 'pulse12' | 'triangle' | 'sawtooth' | 'noise';

export interface Note {
  w: Wave;
  /** Start pitch: Hz or a note name ('E6', 'C#4'). Ignored for noise. */
  f?: number | string;
  /** End pitch: an exponential slide over the note. */
  to?: number | string;
  /** Start, seconds from the sound's start. */
  at: number;
  /** Length in seconds, decay included. */
  d: number;
  /** Peak volume, 0-1 (default 0.5). */
  v?: number;
  /** Attack in seconds (default 5 ms: no click, still plucky). */
  a?: number;
  /** Share of the length held at full volume before the decay (default 0). */
  hold?: number;
  filter?: { type: BiquadFilterType; f: number; to?: number; q?: number };
}

const NOTE: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };

/** 'A4' → 440, 'C#5' → 554.4; numbers pass through. */
export function hz(n: number | string): number {
  if (typeof n === 'number') return n;
  const m = /^([A-G])(#|b)?(\d)$/.exec(n);
  if (!m) throw new Error(`Bad note ${n}`);
  const semis = NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (semis / 12);
}

const seq = (n: number, fn: (i: number) => Note): Note[] => Array.from({ length: n }, (_, i) => fn(i));

/** Semitones up the stairs: step k's blip is a major scale note higher than step k-1's. */
export const STEP_SCALE = [0, 2, 4, 5, 7, 9, 11, 12];

/** Semitones of a quick run down (or up) a major scale: the pipe sounds. */
const SCALE_DOWN = [0, 2, 4, 5, 7, 9, 12];

const lowpass = (f: number, to?: number) => ({ type: 'lowpass' as const, f, to });

export const SFX = {
  // Level: items and the goal
  coin: [
    { w: 'pulse25', f: 'B5', at: 0, d: 0.07, v: 0.5 },
    { w: 'pulse25', f: 'E6', at: 0.07, d: 0.4, v: 0.5, hold: 0.25 },
  ],
  bump: [
    { w: 'triangle', f: 190, to: 80, at: 0, d: 0.09, v: 0.9 },
    { w: 'noise', at: 0, d: 0.04, v: 0.35, filter: lowpass(900) },
  ],
  crumble: [
    ...seq(5, (i) => ({ w: 'noise', at: i * 0.055, d: 0.09, v: 0.6 - i * 0.08, filter: lowpass(2200 - i * 350) })),
    { w: 'triangle', f: 130, to: 50, at: 0, d: 0.3, v: 0.7 },
  ],
  stomp: [
    { w: 'square', f: 'E4', to: 'E3', at: 0, d: 0.09, v: 0.35 },
    { w: 'triangle', f: 220, to: 60, at: 0, d: 0.13, v: 0.8 },
  ],
  checkpoint: seq(4, (i) => ({ w: 'pulse25', f: ['C5', 'E5', 'G5', 'C6'][i], at: i * 0.065, d: i === 3 ? 0.3 : 0.08, v: 0.45, hold: i === 3 ? 0.3 : 0 })),
  flip: [
    { w: 'pulse12', f: 'A5', at: 0, d: 0.04, v: 0.4 },
    { w: 'pulse12', f: 'E6', at: 0.06, d: 0.07, v: 0.4 },
  ],
  poof: [{ w: 'noise', at: 0, d: 0.28, v: 0.45, a: 0.02, filter: { type: 'bandpass', f: 2400, to: 300, q: 1.2 } }],
  blip: [{ w: 'pulse25', f: 'C6', at: 0, d: 0.07, v: 0.4 }],
  unblip: [{ w: 'pulse25', f: 'G5', to: 'C5', at: 0, d: 0.12, v: 0.35 }],
  flagpole: seq(14, (i) => ({ w: 'pulse25', f: hz('C7') * 2 ** (-i / 6), at: i * 0.055, d: 0.06, v: 0.3 })),
  clear: [
    { w: 'pulse25', f: 'C5', at: 0, d: 0.09, v: 0.45 },
    { w: 'pulse25', f: 'E5', at: 0.09, d: 0.09, v: 0.45 },
    { w: 'pulse25', f: 'G5', at: 0.18, d: 0.09, v: 0.45 },
    { w: 'pulse25', f: 'C6', at: 0.27, d: 0.3, v: 0.45, hold: 0.5 },
    { w: 'pulse25', f: 'A5', at: 0.62, d: 0.08, v: 0.45 },
    { w: 'pulse25', f: 'B5', at: 0.72, d: 0.08, v: 0.45 },
    { w: 'pulse25', f: 'C6', at: 0.82, d: 0.45, v: 0.5, hold: 0.45 },
    { w: 'pulse12', f: 'G6', at: 0.82, d: 0.45, v: 0.2, hold: 0.45 },
    { w: 'triangle', f: 'C3', at: 0, d: 0.5, v: 0.7, hold: 0.6 },
    { w: 'triangle', f: 'G3', at: 0.62, d: 0.18, v: 0.7 },
    { w: 'triangle', f: 'C3', at: 0.82, d: 0.45, v: 0.7, hold: 0.45 },
  ],
  firework: [
    { w: 'noise', at: 0, d: 0.06, v: 0.5, filter: { type: 'highpass', f: 1500 } },
    ...seq(6, (i) => ({ w: 'noise', at: 0.08 + i * 0.035 + (i % 2) * 0.012, d: 0.02, v: 0.22 - i * 0.025, filter: { type: 'highpass', f: 5000 + (i % 3) * 1200 } })),
  ],
  unclear: [
    { w: 'pulse25', f: 'E5', at: 0, d: 0.15, v: 0.4 },
    { w: 'pulse25', f: 'C5', to: 'A4', at: 0.17, d: 0.35, v: 0.4, hold: 0.3 },
  ],

  // Level: travel
  pipe: seq(7, (i) => ({ w: 'pulse25', f: hz('C6') * 2 ** (-SCALE_DOWN[i] / 12), at: i * 0.05, d: 0.05, v: 0.3 })),
  pipeUp: seq(7, (i) => ({ w: 'pulse25', f: hz('C5') * 2 ** (SCALE_DOWN[i] / 12), at: i * 0.05, d: 0.05, v: 0.3 })),
  whoosh: [{ w: 'noise', at: 0, d: 0.55, v: 0.5, a: 0.18, filter: { type: 'bandpass', f: 400, to: 3200, q: 2 } }],

  // Play mode
  jump: [{ w: 'pulse25', f: 280, to: 620, at: 0, d: 0.11, v: 0.22 }],
  hurt: [
    { w: 'square', f: 700, to: 90, at: 0, d: 0.28, v: 0.35 },
    { w: 'noise', at: 0, d: 0.1, v: 0.25, filter: lowpass(1500) },
  ],
  bonk: [
    { w: 'triangle', f: 150, to: 70, at: 0, d: 0.18, v: 1 },
    { w: 'pulse12', f: 'A3', at: 0, d: 0.04, v: 0.4 },
    ...seq(5, (i) => ({ w: 'triangle', f: i % 2 ? 210 : 260, at: 0.1 + i * 0.06, d: 0.07, v: 0.5 - i * 0.08 })),
  ],
  playOn: [
    { w: 'pulse25', f: 'B5', at: 0, d: 0.05, v: 0.4 },
    { w: 'pulse25', f: 'E6', at: 0.06, d: 0.05, v: 0.4 },
    { w: 'pulse25', f: 'B6', at: 0.12, d: 0.14, v: 0.4 },
  ],
  playOff: [
    { w: 'pulse25', f: 'B6', at: 0, d: 0.05, v: 0.4 },
    { w: 'pulse25', f: 'E6', at: 0.06, d: 0.05, v: 0.4 },
    { w: 'pulse25', f: 'B5', at: 0.12, d: 0.14, v: 0.4 },
  ],

  // Bedroom and console
  slot: [
    { w: 'noise', at: 0, d: 0.05, v: 0.7, filter: lowpass(1200) },
    { w: 'triangle', f: 120, to: 70, at: 0, d: 0.09, v: 0.9 },
    { w: 'pulse12', f: 'C4', at: 0.035, d: 0.03, v: 0.35 },
  ],
  powerOn: [
    { w: 'triangle', f: 55, to: 220, at: 0, d: 0.75, v: 0.6, a: 0.3, hold: 0.4 },
    { w: 'pulse12', f: 110, to: 440, at: 0.05, d: 0.7, v: 0.12, a: 0.3, hold: 0.4 },
  ],
  bootJingle: [
    { w: 'pulse25', f: 'G5', at: 0, d: 0.1, v: 0.45 },
    { w: 'pulse25', f: 'G6', at: 0.13, d: 0.65, v: 0.45, hold: 0.25 },
    { w: 'pulse12', f: 'D6', at: 0.13, d: 0.65, v: 0.2, hold: 0.25 },
    { w: 'triangle', f: 'G3', at: 0.13, d: 0.55, v: 0.7, hold: 0.3 },
  ],
  start: [
    { w: 'pulse25', f: 'C6', at: 0, d: 0.05, v: 0.45 },
    { w: 'pulse25', f: 'G6', at: 0.06, d: 0.16, v: 0.45 },
  ],
  static: [{ w: 'noise', at: 0, d: 0.32, v: 0.3, hold: 0.8 }],
  tvOff: [
    { w: 'pulse12', f: 3000, to: 200, at: 0, d: 0.1, v: 0.25 },
    { w: 'noise', at: 0.09, d: 0.03, v: 0.4, filter: { type: 'highpass', f: 2000 } },
  ],

  // Dialogue and maps
  talk: [{ w: 'pulse12', f: 'A5', at: 0, d: 0.025, v: 0.18 }],
  select: [
    { w: 'pulse25', f: 'A5', at: 0, d: 0.04, v: 0.4 },
    { w: 'pulse25', f: 'A6', at: 0.045, d: 0.08, v: 0.4 },
  ],

  // Edits, legal pad and HUD
  buzz: [
    { w: 'sawtooth', f: 98, at: 0, d: 0.13, v: 0.4, hold: 0.7, filter: lowpass(1400) },
    { w: 'sawtooth', f: 92, at: 0.17, d: 0.2, v: 0.4, hold: 0.7, filter: lowpass(1400) },
  ],
  polish: [
    { w: 'sawtooth', f: 'D4', to: 'C#4', at: 0, d: 0.32, v: 0.4, hold: 0.6, filter: lowpass(1100) },
    { w: 'sawtooth', f: 'C4', to: 'A3', at: 0.38, d: 0.6, v: 0.4, hold: 0.5, filter: lowpass(1100) },
  ],
  budget: [
    { w: 'pulse25', f: 'E6', at: 0, d: 0.08, v: 0.4, hold: 0.6 },
    { w: 'pulse25', f: 'E6', at: 0.15, d: 0.08, v: 0.4, hold: 0.6 },
  ],
  undo: seq(3, (i) => ({ w: 'pulse25', f: 1600, to: 700, at: i * 0.05, d: 0.05, v: 0.25 })),
  jot: seq(3, (i) => ({ w: 'noise', at: i * 0.05, d: 0.04, v: 0.25, filter: { type: 'bandpass', f: 4000 + (i % 2) * 900, q: 1.5 } })),
  scratch: seq(7, (i) => ({ w: 'noise', at: i * 0.045, d: 0.04, v: 0.28, filter: { type: 'bandpass', f: i % 2 ? 4600 : 3000, q: 1.5 } })),
  page: [{ w: 'noise', at: 0, d: 0.13, v: 0.3, a: 0.02, filter: { type: 'bandpass', f: 1500, to: 5000, q: 0.8 } }],
  pen: [{ w: 'noise', at: 0, d: 0.16, v: 0.22, a: 0.02, filter: { type: 'bandpass', f: 3600, to: 2400, q: 2 } }],
  stamp: [
    { w: 'triangle', f: 95, to: 50, at: 0, d: 0.13, v: 1 },
    { w: 'noise', at: 0, d: 0.06, v: 0.5, filter: lowpass(600) },
    { w: 'pulse25', f: 'C6', at: 0.22, d: 0.08, v: 0.4 },
    { w: 'pulse25', f: 'E6', at: 0.31, d: 0.08, v: 0.4 },
    { w: 'pulse25', f: 'G6', at: 0.4, d: 0.32, v: 0.4, hold: 0.3 },
  ],
  hurry: seq(12, (i) => ({
    w: 'pulse25',
    f: hz('C5') * 2 ** ([0, 4, 7, 12][i % 4] / 12) * (i >= 8 ? 2 : i >= 4 ? 1.5 : 1),
    at: i * 0.055,
    d: 0.05,
    v: 0.35,
  })),
  win: [
    { w: 'pulse25', f: 'G5', at: 0, d: 0.06, v: 0.4 },
    { w: 'pulse25', f: 'D6', at: 0.07, d: 0.25, v: 0.4, hold: 0.3 },
  ],
} satisfies Record<string, Note[]>;

/** The junk easter egg's sound words, keyed by the word's first word without punctuation. */
export const JUNK_SFX = {
  SQUEAK: [{ w: 'pulse12', f: 1700, to: 2600, at: 0, d: 0.09, v: 0.3 }],
  BOING: [
    { w: 'triangle', f: 120, to: 520, at: 0, d: 0.35, v: 0.7 },
    { w: 'pulse12', f: 240, to: 1040, at: 0, d: 0.2, v: 0.12 },
  ],
  FIZZ: [{ w: 'noise', at: 0, d: 0.55, v: 0.25, a: 0.05, hold: 0.6, filter: { type: 'highpass', f: 5000 } }],
  CLUNK: [
    { w: 'pulse12', f: 'E4', at: 0, d: 0.04, v: 0.35 },
    { w: 'triangle', f: 140, to: 60, at: 0.02, d: 0.12, v: 0.9 },
    { w: 'pulse12', f: 'A4', at: 0.07, d: 0.03, v: 0.2 },
  ],
  SPLOSH: [
    { w: 'noise', at: 0, d: 0.25, v: 0.35, filter: lowpass(1800, 400) },
    ...seq(4, (i) => ({ w: 'triangle', f: 300 + i * 60, to: 700 + i * 120, at: 0.04 + i * 0.07, d: 0.05, v: 0.35 })),
  ],
  SNAP: [
    { w: 'noise', at: 0, d: 0.03, v: 0.8, filter: { type: 'highpass', f: 2000 } },
    { w: 'pulse12', f: 1200, at: 0, d: 0.02, v: 0.3 },
  ],
  SHAKE: seq(4, (i) => ({ w: 'noise', at: i * 0.07, d: 0.05, v: 0.3, filter: { type: 'bandpass', f: 6000, q: 1 } })),
  CRINKLE: seq(8, (i) => ({ w: 'noise', at: i * 0.028 + (i % 3) * 0.006, d: 0.018, v: 0.3, filter: { type: 'highpass', f: 4000 + (i % 3) * 800 } })),
  YANK: [{ w: 'sawtooth', f: 220, to: 80, at: 0, d: 0.16, v: 0.4, filter: lowpass(1500) }],
  ROLL: seq(6, (i) => ({ w: 'triangle', f: 'C3', at: i * 0.05, d: 0.04, v: 0.5 })),
  WOBBLE: seq(6, (i) => ({ w: 'triangle', f: i % 2 ? 260 : 310, at: i * 0.06, d: 0.07, v: 0.5 })),
  SQUISH: [
    { w: 'noise', at: 0, d: 0.15, v: 0.45, filter: { type: 'bandpass', f: 1400, to: 500, q: 5 } },
    { w: 'noise', at: 0.13, d: 0.12, v: 0.3, filter: { type: 'bandpass', f: 500, to: 1100, q: 5 } },
  ],
  FLIP: seq(2, (i) => ({ w: 'noise', at: i * 0.08, d: 0.05, v: 0.3, filter: { type: 'bandpass', f: 3000, q: 1 } })),
  DIE: [
    ...[0, 0.06, 0.13, 0.21, 0.3].map((at, i): Note => ({ w: 'triangle', f: [700, 900, 650, 850, 750][i], at, d: 0.03, v: 0.45 })),
    { w: 'triangle', f: 600, at: 0.42, d: 0.06, v: 0.5 },
  ],
  SHOVE: [{ w: 'noise', at: 0, d: 0.12, v: 0.45, filter: lowpass(700) }],
  WHOOPS: [{ w: 'pulse25', f: 800, to: 300, at: 0, d: 0.3, v: 0.3 }],
  EJECT: [
    { w: 'pulse12', f: 1200, to: 400, at: 0, d: 0.12, v: 0.3 },
    { w: 'triangle', f: 110, at: 0.1, d: 0.09, v: 0.8 },
  ],
  FOLD: [
    { w: 'noise', at: 0, d: 0.06, v: 0.3, filter: { type: 'bandpass', f: 2500, q: 1 } },
    { w: 'triangle', f: 160, to: 90, at: 0.05, d: 0.08, v: 0.6 },
  ],
  POP: [{ w: 'pulse12', f: 600, to: 1200, at: 0, d: 0.05, v: 0.3 }],
} satisfies Record<string, Note[]>;

export type SfxName = keyof typeof SFX;
export type JunkWord = keyof typeof JUNK_SFX;

/** Words that share a sound. */
const ALIAS: Record<string, JunkWord> = { FZZZT: 'FIZZ', TUG: 'YANK', STUFF: 'SHOVE' };

/** The sound for a junk sound word ('SHAKE SHAKE', 'FZZZT!', '4!'): a die roll for numbers, a pop if unknown. */
export function junkWord(word: string): JunkWord {
  const w = word.toUpperCase().split(/\s+/)[0].replace(/[^A-Z0-9]/g, '');
  if (/^\d+$/.test(w)) return 'DIE';
  if (w in JUNK_SFX) return w as JunkWord;
  return ALIAS[w] ?? 'POP';
}

/** How long a note table lasts, in seconds. */
export const lengthOf = (notes: readonly Note[]) => Math.max(0, ...notes.map((n) => n.at + n.d));
