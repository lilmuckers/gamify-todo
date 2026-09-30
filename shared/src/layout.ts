import type { Item, ItemType, Level } from './model';
import { isMvpItem, isResolved } from './model';
import { isCleared } from './scoring';

/** Sprite family for each item type. */
export type EntityKind = 'qblock' | 'checkpoint' | 'wall' | 'pipe' | 'critter' | 'sign' | 'coins';

export const KIND_FOR_TYPE: Record<ItemType, EntityKind> = {
  task: 'qblock',
  deliverable: 'checkpoint',
  blocker: 'wall',
  dependency: 'pipe',
  risk: 'critter',
  decision: 'sign',
  stretch: 'coins',
};

/** All coordinates in tiles. x grows right; y is height above the ground surface. */
export interface LayoutEntity {
  itemId: string;
  kind: EntityKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rank: number;
  blocking: boolean;
  resolved: boolean;
}

export interface Decoration {
  kind: 'cloud' | 'bush' | 'hill';
  x: number;
  y: number;
  size: number;
}

export interface Stop {
  x: number;
  itemId?: string;
  kind: 'item' | 'flag' | 'castle';
}

export interface LevelLayout {
  width: number;
  entities: LayoutEntity[];
  decorations: Decoration[];
  flagX: number;
  castleX: number;
  /** Where the hero stops, in walking order. */
  stops: Stop[];
  /** Where the hero is now: the first stop. */
  hero: Stop;
}

const SIZE: Record<EntityKind, { w: number; h: number; y: number }> = {
  qblock: { w: 1, h: 1, y: 3 },
  checkpoint: { w: 1, h: 4, y: 0 },
  wall: { w: 1, h: 3, y: 0 },
  pipe: { w: 2, h: 2, y: 0 },
  critter: { w: 1, h: 1, y: 0 },
  sign: { w: 1, h: 2, y: 0 },
  coins: { w: 3, h: 1, y: 6 },
};

const GAP = 3;
const RANK_GAP = 2;
const START_X = 6;

export function isBlocking(item: Item): boolean {
  if (isResolved(item) || !isMvpItem(item)) return false;
  return true;
}

/** Longest dependsOn chain to each item (roots = 0). Cycle-safe. */
export function ranks(items: Item[]): Map<string, number> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const deps = (byId.get(id)?.dependsOn ?? []).filter((d) => byId.has(d));
    const r = deps.length ? 1 + Math.max(...deps.map(rankOf)) : 0;
    visiting.delete(id);
    memo.set(id, r);
    return r;
  };
  for (const i of items) rankOf(i.id);
  return memo;
}

/** Small deterministic PRNG so decoration is stable per level. */
export function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function layoutLevel(level: Level): LevelLayout {
  // Once MVP criteria are met nothing blocks any more: good enough wins.
  const cleared = isCleared(level);
  const r = ranks(level.items);
  const indexOf = new Map(level.items.map((i, idx) => [i.id, idx]));
  const main = level.items
    .filter((i) => i.type !== 'stretch')
    .sort((a, b) => r.get(a.id)! - r.get(b.id)! || indexOf.get(a.id)! - indexOf.get(b.id)!);
  const stretch = level.items.filter((i) => i.type === 'stretch');

  const entities: LayoutEntity[] = [];
  let x = START_X;
  let prevRank = 0;
  for (const item of main) {
    const kind = KIND_FOR_TYPE[item.type];
    const size = SIZE[kind];
    const rank = r.get(item.id)!;
    if (rank !== prevRank) x += RANK_GAP;
    prevRank = rank;
    entities.push({
      itemId: item.id,
      kind,
      x,
      y: size.y,
      w: size.w,
      h: size.h,
      rank,
      blocking: !cleared && isBlocking(item),
      resolved: isResolved(item),
    });
    x += size.w + GAP;
  }

  const mainEnd = Math.max(x, START_X + 8);
  const flagX = mainEnd + 3;
  const castleX = flagX + 5;
  const width = castleX + 10;

  // Stretch coins float above whatever they depend on, else spread across the level.
  stretch.forEach((item, n) => {
    const anchor = entities.find((e) => item.dependsOn?.includes(e.itemId));
    const cx = anchor
      ? anchor.x
      : START_X + Math.round(((n + 0.5) * (mainEnd - START_X)) / stretch.length) - 1;
    const size = SIZE.coins;
    entities.push({
      itemId: item.id,
      kind: 'coins',
      x: cx,
      y: size.y + (n % 2),
      w: size.w,
      h: size.h,
      rank: r.get(item.id)!,
      blocking: false,
      resolved: isResolved(item),
    });
  });

  const stops: Stop[] = entities
    .filter((e) => e.blocking)
    .sort((a, b) => a.x - b.x)
    .map((e) => ({
      x: e.kind === 'qblock' ? e.x : e.x - 1.25,
      itemId: e.itemId,
      kind: 'item' as const,
    }));
  stops.push(
    cleared ? { x: castleX + 2, kind: 'castle' } : { x: flagX - 1.5, kind: 'flag' },
  );

  const rand = seeded(level.id);
  const decorations: Decoration[] = [];
  for (let cx = 2 + rand() * 6; cx < width; cx += 7 + rand() * 8)
    decorations.push({ kind: 'cloud', x: cx, y: 8 + Math.floor(rand() * 4), size: 1 + Math.floor(rand() * 3) });
  for (let hx = rand() * 10; hx < width; hx += 12 + rand() * 14)
    decorations.push({ kind: 'hill', x: hx, y: 0, size: 1 + Math.floor(rand() * 2) });
  for (let bx = 4 + rand() * 8; bx < width; bx += 9 + rand() * 10)
    decorations.push({ kind: 'bush', x: bx, y: 0, size: 1 + Math.floor(rand() * 3) });

  return { width, entities, decorations, flagX, castleX, stops, hero: stops[0] };
}
