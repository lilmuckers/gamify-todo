import { patchUiPrefs, uiPrefs } from './config';
import { isCatchingUp } from './game/catch-up';
import { hz, junkWord, JUNK_SFX, SFX, type Note, type SfxName } from './sfx';

/**
 * Sound effects: a tiny WebAudio synth playing the note tables in `sfx.ts`.
 * Off by default (Settings → Display). The AudioContext is only made on a
 * user gesture with sound on, so nothing plays before the first interaction,
 * and nothing plays while the tab is hidden or the game is catching up after
 * one (a burst of every sound it missed would be no fun).
 */

/** Overall loudness: the sound board's middle setting. */
const VOLUME = 0.18;
/** The same sound again within this many ms is dropped (a burst of stair steps, three coins at once). */
export const MIN_GAP_MS = 40;

export interface Gate {
  on: boolean;
  /** An AudioContext exists and is running (it was started from a gesture). */
  ready: boolean;
  hidden: boolean;
  catchingUp: boolean;
  /** Ms since this sound last played. */
  sinceLast: number;
}

export function shouldPlay(g: Gate): boolean {
  return g.on && g.ready && !g.hidden && !g.catchingUp && g.sinceLast >= MIN_GAP_MS;
}

/** The bits of an AudioContext the synth uses, so tests can pass a fake. */
export type SynthContext = Pick<
  AudioContext,
  'currentTime' | 'sampleRate' | 'createGain' | 'createOscillator' | 'createBufferSource' | 'createBiquadFilter' | 'createBuffer' | 'createPeriodicWave'
>;

export interface Voices {
  noise: AudioBuffer;
  waves: Partial<Record<Note['w'], PeriodicWave>>;
}

/** One second of white noise and the narrow pulse waves, made once per context. */
export function makeVoices(ctx: SynthContext): Voices {
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const waves: Voices['waves'] = {};
  for (const [name, duty] of [['pulse25', 0.25], ['pulse12', 0.125]] as const) {
    // A pulse wave's cosine series: the duty sets how nasal it sounds.
    const n = 64;
    const re = new Float32Array(n);
    for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    waves[name] = ctx.createPeriodicWave(re, new Float32Array(n));
  }
  return { noise, waves };
}

/**
 * Schedules a note table on the audio clock, `delay` seconds from now,
 * transposed by `semis`. Each note is a source → (filter) → envelope → `out`.
 */
export function schedule(ctx: SynthContext, out: AudioNode, voices: Voices, notes: readonly Note[], semis = 0, delay = 0) {
  const t0 = ctx.currentTime + 0.01 + delay;
  const k = 2 ** (semis / 12);
  for (const n of notes) {
    const t = t0 + n.at;
    const v = n.v ?? 0.5;
    const a = Math.min(n.a ?? 0.005, n.d / 2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    g.gain.setValueAtTime(v, t + a + (n.d - a) * (n.hold ?? 0));
    g.gain.exponentialRampToValueAtTime(0.0008, t + n.d);
    let src: AudioScheduledSourceNode;
    if (n.w === 'noise') {
      const b = ctx.createBufferSource();
      b.buffer = voices.noise;
      b.loop = true;
      src = b;
    } else {
      const o = ctx.createOscillator();
      const wave = voices.waves[n.w];
      if (wave) o.setPeriodicWave(wave);
      else o.type = n.w as OscillatorType;
      o.frequency.setValueAtTime(hz(n.f ?? 440) * k, t);
      if (n.to !== undefined) o.frequency.exponentialRampToValueAtTime(hz(n.to) * k, t + n.d);
      src = o;
    }
    let node: AudioNode = src;
    if (n.filter) {
      const f = ctx.createBiquadFilter();
      f.type = n.filter.type;
      f.Q.value = n.filter.q ?? 1;
      f.frequency.setValueAtTime(n.filter.f, t);
      if (n.filter.to) f.frequency.exponentialRampToValueAtTime(n.filter.to, t + n.d);
      node.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + n.d + 0.02);
  }
}

let ctx: AudioContext | undefined;
let master: GainNode | undefined;
let voices: Voices | undefined;
const lastPlayed = new Map<string, number>();

export const soundOn = (): boolean => uiPrefs().sound === true;

/** Makes or resumes the AudioContext. Only call from a user gesture, or it starts suspended. */
function wake() {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = VOLUME;
      master.connect(ctx.destination);
      voices = makeVoices(ctx);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* no WebAudio: stay silent */
  }
}

/** Starts (or restarts) audio on any tap or key while sound is on. Call once at boot. */
export function initSound() {
  const nudge = () => {
    if (soundOn() && ctx?.state !== 'running') wake();
  };
  addEventListener('pointerdown', nudge, { capture: true });
  addEventListener('keydown', nudge, { capture: true });
}

/** The Settings toggle (itself a gesture, so audio can start right away and preview a coin). */
export function setSoundOn(on: boolean) {
  patchUiPrefs({ sound: on || undefined });
  if (!on) return;
  wake();
  // A fresh context may still be starting: give it a beat.
  setTimeout(() => play('coin'), 60);
}

function playNotes(key: string, notes: readonly Note[], semis = 0, delay = 0) {
  const now = performance.now();
  const ok = shouldPlay({
    on: soundOn(),
    ready: ctx?.state === 'running',
    hidden: document.hidden,
    catchingUp: isCatchingUp(),
    sinceLast: now - (lastPlayed.get(key) ?? -Infinity),
  });
  if (!ok || !ctx || !master || !voices) return;
  lastPlayed.set(key, now);
  try {
    schedule(ctx, master, voices, notes, semis, delay);
  } catch {
    /* a bad table shouldn't break the game */
  }
}

/** Plays a sound. `semis` transposes it (the stair blip); `delay` is in seconds. */
export function play(name: SfxName, opts: { semis?: number; delay?: number } = {}) {
  // Staggered copies (a row of coins) are separate sounds, not repeats.
  playNotes(opts.delay ? `${name}@${opts.delay}` : name, SFX[name], opts.semis, opts.delay);
}

/** Plays the sound for one of the junk easter egg's sound words. */
export function playWord(word: string) {
  const w = junkWord(word);
  playNotes(`junk:${w}`, JUNK_SFX[w]);
}
