import type { LevelLayout } from '@quest/shared';

/**
 * Platformer physics for play mode. Pure and Phaser-free so it can be unit
 * tested: pixels, seconds, y grows downwards (like the scene).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Collider extends Rect {
  /** Item id, or EXIT_ID for a sub-level's exit pipe. */
  id: string;
  kind: 'qblock' | 'checkpoint' | 'wall' | 'pipe' | 'warp' | 'cloud' | 'critter' | 'sign' | 'coins' | 'plant' | 'exit' | 'flag';
  /** Blocks movement from every side. */
  solid?: boolean;
  /** Only blocks from above (land on it, jump up through it). */
  oneWay?: boolean;
  /** Hurts on touch. */
  hazard?: boolean;
  /** Hitting it from below completes it. */
  bumpable?: boolean;
  /** Landing on it completes it (touching it any other way hurts). */
  stompable?: boolean;
  /** Pressing down while standing on it goes in (pipe or cloud). */
  enter?: boolean;
  /** Touching it collects it. */
  collect?: boolean;
}

export interface PlayWorld {
  colliders: Collider[];
  /** Level width in pixels: the hero can't leave [0, width]. */
  width: number;
  groundY: number;
}

export interface Body {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  onGround: boolean;
  /** Collider stood on, if any (undefined on the ground). */
  standingOn?: string;
  facing: 1 | -1;
  /** Seconds left in which a jump still counts as from the ground. */
  coyote: number;
  /** Seconds left in which a jump press is remembered until landing. */
  buffer: number;
  /** Seconds of invulnerability after getting hurt. */
  invuln: number;
}

export interface PlayInput {
  /** -1 (left) to 1 (right). */
  x: number;
  run: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  downPressed: boolean;
}

export type PlayEvent =
  | { kind: 'bump'; id: string }
  | { kind: 'stomp'; id: string }
  | { kind: 'collect'; id: string }
  | { kind: 'enter'; id: string }
  | { kind: 'hurt'; id: string }
  | { kind: 'flag' }
  | { kind: 'jump' };

export const EXIT_ID = '!exit';
export const FLAG_ID = '!flag';

export const TUNING = {
  walk: 112,
  run: 176,
  accel: 700,
  runAccel: 950,
  friction: 900,
  airControl: 0.75,
  gravity: 1400,
  /** Extra gravity while rising with jump released: short hops. */
  cutGravity: 2.6,
  jumpSpeed: 440,
  maxFall: 420,
  stompBounce: 260,
  hurtKnock: 160,
  hurtHop: 220,
  invuln: 1.2,
  coyote: 0.08,
  buffer: 0.12,
};

/** Hero hitbox inside the 16x16 sprite: a little narrower than the art. */
export const HITBOX = { offX: 2, w: 12, h: 15 };

export interface WorldOpts {
  tile: number;
  groundY: number;
  /** A dependency's sub-level: exit pipe instead of a flagpole. */
  sub?: boolean;
}

/** Colliders for a laid-out level. Tile rects become pixel rects, as the scene draws them. */
export function buildWorld(layout: LevelLayout, { tile: T, groundY, sub }: WorldOpts): PlayWorld {
  const colliders: Collider[] = [];
  for (const e of layout.entities) {
    const x = e.x * T;
    const y = groundY - (e.y + e.h) * T;
    const w = e.w * T;
    const h = e.h * T;
    const id = e.itemId;
    const open = !e.resolved;
    switch (e.kind) {
      case 'qblock':
        colliders.push({ id, kind: e.kind, x, y, w, h, solid: true, bumpable: open });
        break;
      case 'wall':
        // Rubble once it's dealt with.
        if (open) colliders.push({ id, kind: e.kind, x, y, w, h, solid: true });
        break;
      case 'pipe':
        colliders.push({ id, kind: e.kind, x, y, w, h, solid: true });
        // The piranha plant bobbing out of an unmet dependency.
        if (open) colliders.push({ id, kind: 'plant', x: x + 10, y: y - 10, w: w - 20, h: 10, hazard: true });
        break;
      case 'warp':
        colliders.push({ id, kind: e.kind, x, y, w, h, solid: true, enter: true });
        break;
      case 'cloud':
        // Drawn floating a few pixels above its tile; land where it looks.
        colliders.push({ id, kind: e.kind, x, y: y + 2, w, h: 6, oneWay: true, enter: true });
        break;
      case 'critter':
        // It paces 12px to the right of its tile.
        if (open) colliders.push({ id, kind: e.kind, x: x + 2, y: y + 4, w: w + 8, h: h - 4, stompable: true });
        break;
      case 'coins':
        if (open) colliders.push({ id, kind: e.kind, x, y, w, h, collect: true });
        break;
      case 'checkpoint':
      case 'sign':
        // Scenery: walk past, or press up at it for its bubble.
        colliders.push({ id, kind: e.kind, x, y, w, h });
        break;
    }
  }
  const fx = layout.flagX * T;
  if (sub) colliders.push({ id: EXIT_ID, kind: 'exit', x: fx, y: groundY - 2 * T, w: 2 * T, h: 2 * T, solid: true, enter: true });
  else {
    // Base block, then the pole itself.
    colliders.push({ id: FLAG_ID, kind: 'flag', x: fx, y: groundY - T, w: T, h: T, solid: true });
    colliders.push({ id: FLAG_ID, kind: 'flag', x: fx + 6, y: groundY - 10 * T, w: 4, h: 9 * T });
  }
  return { colliders, width: layout.width * T, groundY };
}

export function newBody(x: number, groundY: number): Body {
  return { x, y: groundY - HITBOX.h, w: HITBOX.w, h: HITBOX.h, vx: 0, vy: 0, onGround: true, facing: 1, coyote: 0, buffer: 0, invuln: 0 };
}

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const approach = (v: number, target: number, step: number) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

/**
 * Advances the body by `dt` seconds. Mutates and returns `body`; `done` lists
 * ids already completed this session so they don't fire twice before the
 * level re-renders.
 */
export function step(body: Body, input: PlayInput, world: PlayWorld, dt: number, done: ReadonlySet<string> = new Set()): PlayEvent[] {
  const t = TUNING;
  const events: PlayEvent[] = [];
  dt = Math.min(dt, 1 / 30);
  body.invuln = Math.max(0, body.invuln - dt);

  // Horizontal: accelerate towards the stick, skid to a stop without it.
  const max = input.run ? t.run : t.walk;
  const control = body.onGround ? 1 : t.airControl;
  if (Math.abs(input.x) > 0.01) {
    body.facing = input.x > 0 ? 1 : -1;
    body.vx = approach(body.vx, input.x * max, (input.run ? t.runAccel : t.accel) * control * dt);
  } else body.vx = approach(body.vx, 0, t.friction * control * dt);

  // Jump, with a little forgiveness either side of the ledge.
  body.coyote = body.onGround ? t.coyote : Math.max(0, body.coyote - dt);
  body.buffer = input.jumpPressed ? t.buffer : Math.max(0, body.buffer - dt);
  if (body.buffer > 0 && body.coyote > 0) {
    body.vy = -t.jumpSpeed;
    body.buffer = body.coyote = 0;
    body.onGround = false;
    events.push({ kind: 'jump' });
  }
  const g = body.vy < 0 && !input.jumpHeld ? t.gravity * t.cutGravity : t.gravity;
  body.vy = Math.min(body.vy + g * dt, t.maxFall);

  const solids = world.colliders.filter((c) => c.solid);

  // Move X, then push out of anything solid.
  body.x += body.vx * dt;
  for (const c of solids) {
    if (!overlaps(body, c)) continue;
    if (body.vx > 0) body.x = c.x - body.w;
    else if (body.vx < 0) body.x = c.x + c.w;
    else body.x = body.x + body.w / 2 < c.x + c.w / 2 ? c.x - body.w : c.x + c.w;
    body.vx = 0;
  }
  body.x = Math.max(0, Math.min(body.x, world.width - body.w));

  // Move Y, then land on / bonk against things.
  const prevBottom = body.y + body.h;
  body.y += body.vy * dt;
  body.onGround = false;
  body.standingOn = undefined;
  let bumped: Collider | undefined;
  for (const c of solids) {
    if (!overlaps(body, c)) continue;
    if (body.vy > 0) land(body, c);
    else if (body.vy < 0) {
      body.y = c.y + c.h;
      body.vy = 0;
      // Hitting two blocks at once: the one most overhead counts.
      const mid = body.x + body.w / 2;
      if (c.bumpable && (!bumped || Math.abs(c.x + c.w / 2 - mid) < Math.abs(bumped.x + bumped.w / 2 - mid))) bumped = c;
    }
  }
  if (bumped && !done.has(bumped.id)) events.push({ kind: 'bump', id: bumped.id });
  for (const c of world.colliders) {
    if (!c.oneWay || body.vy < 0 || prevBottom > c.y + 1) continue;
    if (overlaps(body, c)) land(body, c);
  }
  if (body.y + body.h >= world.groundY) {
    body.y = world.groundY - body.h;
    body.vy = 0;
    body.onGround = true;
  }

  // Standing on something you can go into.
  if (input.downPressed && body.onGround && body.standingOn) {
    const c = world.colliders.find((c) => c.id === body.standingOn && c.enter);
    if (c) events.push({ kind: 'enter', id: c.id });
  }

  // Touching things.
  let flag = false;
  for (const c of world.colliders) {
    if (c.solid || c.oneWay || done.has(c.id) || !overlaps(body, c)) continue;
    if (c.kind === 'flag') flag = true;
    else if (c.collect) events.push({ kind: 'collect', id: c.id });
    else if (c.stompable && body.vy > 0 && prevBottom <= c.y + 6) {
      body.vy = -t.stompBounce;
      body.y = c.y - body.h;
      events.push({ kind: 'stomp', id: c.id });
    } else if ((c.hazard || c.stompable) && body.invuln === 0) {
      body.invuln = t.invuln;
      const away = body.x + body.w / 2 < c.x + c.w / 2 ? -1 : 1;
      body.vx = away * t.hurtKnock;
      body.vy = -t.hurtHop;
      body.onGround = false;
      events.push({ kind: 'hurt', id: c.id });
    }
  }
  if (flag) events.push({ kind: 'flag' });
  return events;
}

function land(body: Body, c: Collider) {
  body.y = c.y - body.h;
  body.vy = 0;
  body.onGround = true;
  body.standingOn = c.id;
}

/**
 * The nearest thing ahead of the hero: in the direction he's facing (which
 * stays the last way he moved once he stops), or right above or below him.
 */
export function ahead(body: Body, world: PlayWorld): Collider | undefined {
  const mid = body.x + body.w / 2;
  let best: Collider | undefined;
  let bestDist = Infinity;
  for (const c of world.colliders) {
    if (c.kind === 'plant') continue;
    const d = (c.x + c.w / 2 - mid) * body.facing;
    // Overlapping counts as ahead, so a block overhead isn't skipped.
    const over = c.x < body.x + body.w && c.x + c.w > body.x;
    if (d < 0 && !over) continue;
    const dist = over ? 0 : d;
    if (dist < bestDist) (best = c), (bestDist = dist);
  }
  return best;
}

/** The thing the hero is at: touching, standing on, or within half a tile of. */
export function nearest(body: Body, world: PlayWorld): Collider | undefined {
  const reach = { x: body.x - 8, y: body.y - 4, w: body.w + 16, h: body.h + 8 };
  const mid = body.x + body.w / 2;
  let best: Collider | undefined;
  for (const c of world.colliders) {
    if (c.kind === 'plant' || !overlaps(reach, c)) continue;
    if (!best || Math.abs(c.x + c.w / 2 - mid) < Math.abs(best.x + best.w / 2 - mid)) best = c;
  }
  return best;
}
