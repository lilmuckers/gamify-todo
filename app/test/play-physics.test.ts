import { describe, expect, it } from 'vitest';
import type { LayoutEntity, LevelLayout } from '@quest/shared';
import { ahead, buildWorld, newBody, step, TUNING, type Body, type PlayEvent, type PlayInput, type PlayWorld } from '../src/game/play/physics';

const T = 16;
const GROUND = 192;
const DT = 1 / 60;

const idle: PlayInput = { x: 0, run: false, jumpHeld: false, jumpPressed: false, downPressed: false };

function entity(kind: LayoutEntity['kind'], x: number, extra: Partial<LayoutEntity> = {}): LayoutEntity {
  const size = { qblock: [1, 1, 3], wall: [1, 3, 0], pipe: [2, 2, 0], warp: [2, 3, 0], cloud: [3, 1, 2], critter: [1, 1, 0], coins: [3, 1, 6], sign: [1, 2, 0], checkpoint: [1, 4, 0] }[kind];
  return { itemId: `${kind}-${x}`, kind, x, y: size[2], w: size[0], h: size[1], rank: 0, blocking: true, resolved: false, ...extra };
}

function world(entities: LayoutEntity[], sub = false): PlayWorld {
  const layout: LevelLayout = { width: 60, entities, decorations: [], flagX: 50, castleX: 59, stops: [], hero: { x: 0, kind: 'flag' } };
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
