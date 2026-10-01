import { describe, expect, it } from 'vitest';
import type { LayoutEntity, LevelLayout, StairStep } from '@quest/shared';
import { ahead, buildWorld, nearest, newBody, step, stepId, TUNING, type Body, type PlayEvent, type PlayInput, type PlayWorld } from '../src/game/play/physics';

const T = 16;
const GROUND = 192;
const DT = 1 / 60;

const idle: PlayInput = { x: 0, run: false, jumpHeld: false, jumpPressed: false, downPressed: false };

function entity(kind: LayoutEntity['kind'], x: number, extra: Partial<LayoutEntity> = {}): LayoutEntity {
  const size = { qblock: [1, 1, 3], wall: [1, 3, 0], pipe: [2, 2, 0], warp: [2, 3, 0], cloud: [3, 1, 2], critter: [1, 1, 0], coins: [3, 1, 6], sign: [1, 2, 0], checkpoint: [1, 4, 0] }[kind];
  return { itemId: `${kind}-${x}`, kind, x, y: size[2], w: size[0], h: size[1], rank: 0, blocking: true, resolved: false, ...extra };
}

function world(entities: LayoutEntity[], sub = false, stairs: StairStep[] = []): PlayWorld {
  const layout: LevelLayout = { width: 60, entities, decorations: [], stairs, flagX: 50, castleX: 59, stops: [], hero: { x: 0, kind: 'flag' } };
  return buildWorld(layout, { tile: T, groundY: GROUND, sub });
}

/** Runs `frames` steps with `input` (or a per-frame input), collecting events. */
function run(body: Body, w: PlayWorld, frames: number, input: PlayInput | ((f: number) => PlayInput) = idle) {
  const events: PlayEvent[] = [];
  for (let f = 0; f < frames; f++) events.push(...step(body, typeof input === 'function' ? input(f) : input, w, DT));
  return events;
}

const jumpOnce = (f: number, x = 0): PlayInput => ({ ...idle, x, jumpHeld: true, jumpPressed: f === 0 });

describe('play physics', () => {
  it('rests on the ground', () => {
    const b = newBody(10, GROUND);
    b.y -= 40;
    b.onGround = false;
    run(b, world([]), 60);
    expect(b.y + b.h).toBe(GROUND);
    expect(b.onGround).toBe(true);
  });

  it('jumps a little over 4 tiles at most, and less when released early', () => {
    const w = world([]);
    const high = newBody(10, GROUND);
    let top = GROUND;
    run(high, w, 60, (f) => {
      top = Math.min(top, high.y + high.h);
      return jumpOnce(f);
    });
    const rise = GROUND - top;
    expect(rise).toBeGreaterThan(4 * T);
    expect(rise).toBeLessThan(5 * T);

    const short = newBody(10, GROUND);
    let shortTop = GROUND;
    run(short, w, 60, (f) => {
      shortTop = Math.min(shortTop, short.y + short.h);
      return { ...idle, jumpPressed: f === 0, jumpHeld: f < 4 };
    });
    expect(GROUND - shortTop).toBeLessThan(rise * 0.65);
  });

  it('is blocked by an unresolved wall and walks through a resolved one', () => {
    const right = { ...idle, x: 1 };
    const blocked = newBody(3 * T, GROUND);
    run(blocked, world([entity('wall', 6)]), 90, right);
    expect(blocked.x + blocked.w).toBe(6 * T);

    const open = newBody(3 * T, GROUND);
    run(open, world([entity('wall', 6, { resolved: true })]), 90, right);
    expect(open.x).toBeGreaterThan(7 * T);
  });

  it('bumps a ? block from below once, then not again once done', () => {
    const w = world([entity('qblock', 6)]);
    const b = newBody(6 * T + 2, GROUND);
    const events = run(b, w, 60, jumpOnce);
    expect(events.filter((e) => e.kind === 'bump')).toEqual([{ kind: 'bump', id: 'qblock-6' }]);
    // Head stopped at the block's underside.
    const again = newBody(6 * T + 2, GROUND);
    const later = [] as PlayEvent[];
    for (let f = 0; f < 60; f++) later.push(...step(again, jumpOnce(f), w, DT, new Set(['qblock-6'])));
    expect(later.some((e) => e.kind === 'bump')).toBe(false);
  });

  it('stomps a critter from above but gets hurt walking into it', () => {
    const w = world([entity('critter', 6)]);
    const stomper = newBody(6 * T + 4, GROUND);
    stomper.y = GROUND - 4 * T;
    stomper.onGround = false;
    const fromAbove = run(stomper, w, 40);
    expect(fromAbove[0]).toEqual({ kind: 'stomp', id: 'critter-6' });
    expect(fromAbove.some((e) => e.kind === 'hurt')).toBe(false);

    const walker = newBody(3 * T, GROUND);
    const fromSide = run(walker, w, 60, { ...idle, x: 1 });
    expect(fromSide.find((e) => e.kind === 'hurt')).toEqual({ kind: 'hurt', id: 'critter-6' });
    expect(fromSide.filter((e) => e.kind === 'hurt')).toHaveLength(1);
    expect(walker.invuln).toBeGreaterThan(0);
  });

  it('jumps up through a cloud and lands on top of it', () => {
    const w = world([entity('cloud', 5)]);
    const b = newBody(6 * T, GROUND);
    run(b, w, 90, jumpOnce);
    expect(b.onGround).toBe(true);
    expect(b.standingOn).toBe('cloud-5');
    expect(b.y + b.h).toBe(GROUND - 3 * T + 2);
  });

  it('goes into a warp pipe when pressing down on top of it', () => {
    const w = world([entity('warp', 6)]);
    const b = newBody(6 * T + 2, GROUND);
    b.y = GROUND - 3 * T - b.h;
    run(b, w, 5);
    expect(b.standingOn).toBe('warp-6');
    expect(step(b, { ...idle, downPressed: true }, w, DT)).toContainEqual({ kind: 'enter', id: 'warp-6' });
  });

  it('collects coins and touches the flagpole', () => {
    const w = world([entity('coins', 6, { y: 0 })]);
    const b = newBody(5 * T, GROUND);
    expect(run(b, w, 30, { ...idle, x: 1 })).toContainEqual({ kind: 'collect', id: 'coins-6' });
    const atPole = newBody(48 * T, GROUND);
    expect(run(atPole, w, 120, (f) => jumpOnce(f % 40, 1)).some((e) => e.kind === 'flag')).toBe(true);
  });

  it('keeps the walk speed in step with the scripted walk', () => {
    expect(TUNING.walk).toBe(7 * T);
  });
});

describe('flagpole stairs', () => {
  /** Steps at x = 40, 42, 44 (tiles), 1-3 blocks tall; the pole is at 50. */
  const stairs = (spec: [mvp: boolean, done: boolean][]): StairStep[] =>
    spec.map(([mvp, done], i) => ({ criterionId: `c${i}`, index: i, x: 40 + 2 * i, w: 2, h: i + 1, mvp, done }));
  /** Holds right, jumping whenever on the ground: climbs anything in the way. */
  const climb = (b: Body) => (): PlayInput => ({ ...idle, x: 1, jumpHeld: true, jumpPressed: b.onGround });
  /** Plays like the scene: landed steps go in the `played` set. */
  function play(b: Body, w: PlayWorld, frames: number, input: (f: number) => PlayInput, played = new Set<string>()) {
    const events: PlayEvent[] = [];
    for (let f = 0; f < frames; f++) {
      const ev = step(b, input(f), w, DT, played);
      for (const e of ev) if (e.kind === 'step') played.add(e.id);
      events.push(...ev);
      if (ev.some((e) => e.kind === 'flag')) break;
    }
    return { events, played };
  }

  it('makes each step a solid platform and ticks a step once when landed on', () => {
    const w = world([], false, stairs([[true, false]]));
    const b = newBody(39 * T - 4, GROUND);
    const { events, played } = play(b, w, 60, (f) => ({ ...idle, x: f < 20 ? 1 : 0, jumpHeld: true, jumpPressed: f === 0 }));
    expect(b.standingOn).toBe(stepId('c0'));
    expect(b.y + b.h).toBe(GROUND - T);
    expect(events.filter((e) => e.kind === 'step')).toEqual([{ kind: 'step', id: stepId('c0') }]);
    // Standing there doesn't tick it again, even with the played set cleared (a rebuild).
    expect(run(b, w, 30).filter((e) => e.kind === 'step')).toEqual([]);
    expect(played.has(stepId('c0'))).toBe(true);
  });

  it("doesn't tick steps that are already ticked", () => {
    const w = world([], false, stairs([[true, true]]));
    const b = newBody(39 * T - 4, GROUND);
    const events = run(b, w, 60, (f) => ({ ...idle, x: f < 20 ? 1 : 0, jumpHeld: true, jumpPressed: f === 0 }));
    expect(b.standingOn).toBe(stepId('c0'));
    expect(events.some((e) => e.kind === 'step')).toBe(false);
  });

  it('climbs to the pole, ticking every step, then the pole counts', () => {
    const w = world([], false, stairs([[true, false], [true, false], [true, false]]));
    const b = newBody(36 * T, GROUND);
    const { events } = play(b, w, 600, climb(b));
    expect(events.filter((e) => e.kind === 'step').map((e) => (e as { id: string }).id)).toEqual(['c0', 'c1', 'c2'].map(stepId));
    expect(events.some((e) => e.kind === 'flag')).toBe(true);
    expect(events.some((e) => e.kind === 'flagWhack')).toBe(false);
  });

  it("walls off everything past an un-ticked must-do step, so it can't be skipped", () => {
    const w = world([], false, stairs([[true, true], [true, false], [true, false]]));
    const b = newBody(36 * T, GROUND);
    // Never lets the step-2 landing count: the gate past it stays shut.
    const never = { has: () => false } as unknown as Set<string>;
    for (let f = 0; f < 600; f++) step(b, climb(b)(), w, DT, never);
    const gate = w.colliders.find((c) => c.kind === 'gate' && c.id === stepId('c1'))!;
    expect(b.x + b.w).toBeLessThanOrEqual(gate.x + 0.001);
    // The only gates are for un-ticked must-do steps.
    expect(w.colliders.filter((c) => c.kind === 'gate').map((c) => c.id)).toEqual([stepId('c1'), stepId('c2')]);
    expect(w.mvpSteps).toEqual([stepId('c1'), stepId('c2')]);
  });

  it('lets bonus steps be jumped over', () => {
    // A bonus step between two ticked must-dos, never landed on.
    const w = world([], false, [
      { criterionId: 'a', index: 0, x: 40, w: 2, h: 1, mvp: true, done: true },
      { criterionId: 'bonus', index: 1, x: 42, w: 2, h: 2, mvp: false, done: false },
      { criterionId: 'b', index: 2, x: 44, w: 2, h: 2, mvp: true, done: true },
    ]);
    expect(w.colliders.some((c) => c.kind === 'gate')).toBe(false);
    const b = newBody(41 * T, GROUND);
    b.y = GROUND - T - b.h;
    // Long jump from the first step straight onto the third.
    const { events } = play(b, w, 120, (f) => ({ ...idle, x: 1, run: true, jumpHeld: f < 20, jumpPressed: f === 0 }));
    expect(events.some((e) => e.kind === 'step')).toBe(false);
    expect(events.some((e) => e.kind === 'flag')).toBe(true);
  });

  it('whacks the hero back from the pole while a must-do step is left, with a cooldown', () => {
    const w = world([], false, stairs([[true, false]]));
    // Dropped right by the pole, past the stairs.
    const b = newBody(48 * T, GROUND);
    const events = run(b, w, 60, { ...idle, x: 1 });
    const whacks = events.filter((e) => e.kind === 'flagWhack');
    expect(whacks).toEqual([{ kind: 'flagWhack', left: 1 }]);
    expect(events.some((e) => e.kind === 'flag')).toBe(false);
    expect(b.x).toBeLessThan(48 * T);
    // Once the cooldown is over, it whacks again.
    expect(run(b, w, 200, { ...idle, x: 1 }).filter((e) => e.kind === 'flagWhack').length).toBeGreaterThan(0);
  });

  it('leaves gates out of looking around', () => {
    const w = world([], false, stairs([[true, false]]));
    // Just past the step, facing the pole: the gate behind is never "ahead" or "near".
    const b = newBody(42 * T + 2, GROUND);
    expect(ahead(b, w)?.kind).toBe('flag');
    expect(nearest(b, w)?.id).toBe(stepId('c0'));
  });
});

describe('looking ahead', () => {
  it('finds the nearest thing in the way the hero faces, keeping it after he stops', () => {
    const w = world([entity('qblock', 4), entity('wall', 10), entity('sign', 16)]);
    const b = newBody(7 * T, GROUND);
    expect(ahead(b, w)?.id).toBe('wall-10');
    run(b, w, 6, { ...idle, x: -1 });
    run(b, w, 30);
    expect(b.facing).toBe(-1);
    expect(ahead(b, w)?.id).toBe('qblock-4');
  });

  it('counts a block right overhead as ahead', () => {
    const w = world([entity('qblock', 6), entity('wall', 9)]);
    const b = newBody(6 * T + 2, GROUND);
    b.facing = -1;
    expect(ahead(b, w)?.id).toBe('qblock-6');
  });
});
