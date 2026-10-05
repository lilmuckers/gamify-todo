import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyOp, makeOp, type OpBody, type Workspace } from '@quest/shared';
import { makeVoices, MIN_GAP_MS, schedule, shouldPlay, type Gate, type SynthContext } from '../src/audio';
import { hz, junkWord, JUNK_SFX, lengthOf, SFX, type Note } from '../src/sfx';
import { sceneShows, soundForOp } from '../src/sound-events';
import type { Route } from '../src/router';
import { at, level, workspace } from '../../shared/test/fixtures';

/** A stand-in AudioContext that records what gets scheduled. */
function fakeContext(now = 0) {
  const log = { oscillators: [] as { type?: string; freq: number[]; start: number; stop: number }[], noises: 0, filters: 0 };
  const param = (into?: number[]) => ({
    value: 0,
    setValueAtTime: (v: number) => into?.push(v),
    linearRampToValueAtTime: () => undefined,
    exponentialRampToValueAtTime: (v: number) => into?.push(v),
  });
  const node = () => ({ connect: (n: unknown) => n });
  const ctx = {
    currentTime: now,
    sampleRate: 100,
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => (log.filters++, { ...node(), type: '', Q: param(), frequency: param() }),
    createBuffer: (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) }),
    createPeriodicWave: () => ({}),
    createBufferSource: () => {
      log.noises++;
      return { ...node(), buffer: null, loop: false, start: () => undefined, stop: () => undefined };
    },
    createOscillator: () => {
      const o = { type: undefined as string | undefined, freq: [] as number[], start: 0, stop: 0 };
      log.oscillators.push(o);
      return {
        ...node(),
        set type(t: string) {
          o.type = t;
        },
        setPeriodicWave: () => (o.type = 'periodic'),
        frequency: param(o.freq),
        start: (t: number) => (o.start = t),
        stop: (t: number) => (o.stop = t),
      };
    },
  } as unknown as SynthContext;
  return { ctx, log };
}

describe('shouldPlay', () => {
  const ok: Gate = { on: true, ready: true, hidden: false, catchingUp: false, sinceLast: 1000 };

  it('plays only when on, started from a gesture, visible and not catching up', () => {
    expect(shouldPlay(ok)).toBe(true);
    expect(shouldPlay({ ...ok, on: false })).toBe(false);
    expect(shouldPlay({ ...ok, ready: false })).toBe(false);
    expect(shouldPlay({ ...ok, hidden: true })).toBe(false);
    expect(shouldPlay({ ...ok, catchingUp: true })).toBe(false);
  });

  it('drops the same sound again straight away', () => {
    expect(shouldPlay({ ...ok, sinceLast: MIN_GAP_MS - 1 })).toBe(false);
    expect(shouldPlay({ ...ok, sinceLast: MIN_GAP_MS })).toBe(true);
  });
});

describe('note tables', () => {
  const tables: [string, Note[]][] = [...Object.entries(SFX), ...Object.entries(JUNK_SFX)];

  it('are short, and every pitched note has a pitch', () => {
    for (const [name, notes] of tables) {
      expect(notes.length, name).toBeGreaterThan(0);
      expect(lengthOf(notes), name).toBeLessThanOrEqual(1.5);
      for (const n of notes) {
        expect(n.d, name).toBeGreaterThan(0);
        if (n.w !== 'noise') expect(hz(n.f!), name).toBeGreaterThan(20);
        if (n.to !== undefined) expect(hz(n.to), name).toBeGreaterThan(20);
      }
    }
  });

  it('reads note names', () => {
    expect(hz('A4')).toBe(440);
    expect(hz('A5')).toBe(880);
    expect(hz('C#5')).toBeCloseTo(554.37, 1);
    expect(hz(123)).toBe(123);
    expect(() => hz('H2')).toThrow();
  });

  it('give every junk sound word in the bedroom its own sound', () => {
    const src = readFileSync(new URL('../src/game/projects.ts', import.meta.url), 'utf8');
    const words = [...src.matchAll(/this\.pop\(egg, '([^']+)'/g)].map((m) => m[1]);
    expect(words.length).toBeGreaterThan(15);
    for (const w of words) expect(junkWord(w), w).not.toBe('POP');
    expect(junkWord('SHAKE SHAKE')).toBe('SHAKE');
    expect(junkWord('FZZZT!')).toBe('FIZZ');
    expect(junkWord('4!')).toBe('DIE');
    expect(junkWord('KAPOW')).toBe('POP');
  });
});

describe('schedule', () => {
  it('starts one source per note on the audio clock, after the delay', () => {
    const { ctx, log } = fakeContext(10);
    const voices = makeVoices(ctx);
    schedule(ctx, {} as AudioNode, voices, SFX.crumble, 0, 0.5);
    expect(log.noises).toBe(5);
    expect(log.oscillators).toHaveLength(1);
    expect(log.filters).toBe(5);
    expect(log.oscillators[0].start).toBeCloseTo(10.51);
    expect(log.oscillators[0].stop).toBeCloseTo(10.51 + 0.3 + 0.02);
  });

  it('uses the pulse waves and transposes by semitones', () => {
    const { ctx, log } = fakeContext();
    schedule(ctx, {} as AudioNode, makeVoices(ctx), SFX.blip, 12);
    expect(log.oscillators[0].type).toBe('periodic');
    expect(log.oscillators[0].freq[0]).toBeCloseTo(hz('C7'));
  });
});

describe('play', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function setup(prefs: object) {
    const { ctx, log } = fakeContext();
    const store: Record<string, string> = { 'quest.ui': JSON.stringify(prefs) };
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v) });
    vi.stubGlobal('document', { hidden: false });
    vi.stubGlobal('performance', { now: () => 1000 });
    vi.stubGlobal('setTimeout', (fn: () => void) => fn());
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal('addEventListener', (type: string, fn: () => void) => (listeners[type] = fn));
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running';
        destination = {};
        constructor() {
          return Object.assign(ctx, this);
        }
      },
    );
    const audio = await import('../src/audio');
    audio.initSound();
    return { audio, log, store, tap: () => listeners.pointerdown() };
  }

  it('is silent by default, even after a tap', async () => {
    const { audio, log, tap } = await setup({});
    tap();
    audio.play('coin');
    expect(log.oscillators).toHaveLength(0);
  });

  it('is silent before the first gesture, then plays', async () => {
    const { audio, log, tap } = await setup({ sound: true });
    audio.play('coin');
    expect(log.oscillators).toHaveLength(0);
    tap();
    audio.play('coin');
    expect(log.oscillators).toHaveLength(SFX.coin.length);
  });

  it('turning it on saves the choice and previews a coin', async () => {
    const { audio, log, store } = await setup({});
    audio.setSoundOn(true);
    expect(JSON.parse(store['quest.ui'])).toEqual({ sound: true });
    expect(log.oscillators).toHaveLength(SFX.coin.length);
    audio.setSoundOn(false);
    expect(JSON.parse(store['quest.ui'])).toEqual({});
  });

  it('keeps staggered copies but drops instant repeats', async () => {
    const { audio, log, tap } = await setup({ sound: true });
    tap();
    audio.play('coin');
    audio.play('coin');
    audio.play('coin', { delay: 0.08 });
    expect(log.oscillators).toHaveLength(SFX.coin.length * 2);
  });

  it('stays quiet in a hidden tab', async () => {
    const { audio, log, tap } = await setup({ sound: true });
    tap();
    vi.stubGlobal('document', { hidden: true });
    audio.play('coin');
    expect(log.oscillators).toHaveLength(0);
  });
});

describe('soundForOp', () => {
  const run = (ws: Workspace, body: OpBody) => soundForOp(body, ws, applyOp(ws, makeOp(body)));

  it('sounds like the item it finishes', () => {
    const ws = workspace(
      level({
        items: [
          { id: 'a', type: 'task', title: 'A', status: 'todo' },
          { id: 'b', type: 'blocker', title: 'B', status: 'todo' },
          { id: 'r', type: 'risk', title: 'R', status: 'todo' },
          { id: 'd', type: 'decision', title: 'D', status: 'todo' },
          { id: 'm', type: 'deliverable', title: 'M', status: 'todo' },
        ],
      }),
    );
    const done = (itemId: string) => run(ws, { kind: 'setItemStatus', ...at, itemId, status: 'done' });
    expect(['a', 'b', 'r', 'd', 'm'].map(done)).toEqual(['coin', 'crumble', 'stomp', 'flip', 'checkpoint']);
    expect(run(ws, { kind: 'setItemStatus', ...at, itemId: 'a', status: 'dropped' })).toBe('poof');
    expect(run(ws, { kind: 'setItemStatus', ...at, itemId: 'a', status: 'doing' })).toBeUndefined();
  });

  it('blips for criteria, and plays the jingle when the level clears', () => {
    const ws = workspace();
    expect(run(ws, { kind: 'setCriterion', ...at, criterionId: 'bonus', done: true })).toBe('blip');
    expect(run(ws, { kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: true })).toBe('clear');
    const cleared = applyOp(ws, makeOp({ kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: true }));
    expect(run(cleared, { kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: false })).toBe('unclear');
  });

  it('scribbles on the inbox, and is quiet for other edits', () => {
    const ws = workspace();
    expect(run(ws, { kind: 'inboxAdd', item: { id: 'idea', type: 'task', title: 'Idea' } })).toBe('jot');
    expect(run(ws, { kind: 'updateLevel', ...at, patch: { name: 'New' } })).toBeUndefined();
  });
});

describe('sceneShows', () => {
  const lvl: Route = { view: 'level', ...at };
  const tick: OpBody = { kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' };

  it('is true only for the level (or sub-level) on screen', () => {
    expect(sceneShows(lvl, tick)).toBe(true);
    expect(sceneShows({ ...lvl, pad: 'today' }, tick)).toBe(true);
    expect(sceneShows({ ...lvl, levelId: 'other' }, tick)).toBe(false);
    expect(sceneShows({ ...lvl, subId: 'pipe' }, tick)).toBe(false);
    expect(sceneShows({ ...lvl, subId: 'pipe' }, { ...tick, parentId: 'pipe' })).toBe(true);
    expect(sceneShows({ view: 'projects' }, tick)).toBe(false);
    expect(sceneShows(lvl, { kind: 'inboxPlace', ids: ['x'], ...at })).toBe(false);
  });
});
