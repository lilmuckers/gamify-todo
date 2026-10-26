/** The livelier maps (#23): routes, walk timing and the world-clear fanfare. Phaser-free so it can be tested. */
import { isWorldCleared, isWorldLocked, orderedWorlds, type GameState, type MapLayout, type World } from '@quest/shared';
import { MAX_WALK_MS, WALK_TILES_PER_SEC } from './walk';

/** One step of a route: along the path from `from` to `to`, backwards when `forward` is false. */
export interface Hop {
  from: string;
  to: string;
  forward: boolean;
}

/**
 * The fewest hops along the map's paths from one world to another, either way along each
 * path. Empty when they're the same world; undefined when no path joins them.
 */
export function routeBetween(layout: Pick<MapLayout, 'edges'>, from: string, to: string): Hop[] | undefined {
  if (from === to) return [];
  const prev = new Map<string, Hop>();
  const queue = [from];
  const seen = new Set(queue);
  while (queue.length) {
    const at = queue.shift()!;
    for (const e of layout.edges) {
      const hop = e.from === at ? { from: at, to: e.to, forward: true } : e.to === at ? { from: at, to: e.from, forward: false } : undefined;
      if (!hop || seen.has(hop.to)) continue;
      seen.add(hop.to);
      prev.set(hop.to, hop);
      if (hop.to === to) {
        const route: Hop[] = [];
        for (let h = prev.get(to); h; h = prev.get(h.from)) route.unshift(h);
        return route;
      }
      queue.push(hop.to);
    }
  }
  return undefined;
}

/** How long a walk of `px` map pixels takes, and how fast the walk animation runs: like the level's, capped (#22). */
export function mapWalk(px: number, tile = 16): { ms: number; pace: number } {
  const natural = (px / tile / WALK_TILES_PER_SEC) * 1000;
  const ms = Math.min(natural, MAX_WALK_MS);
  return { ms, pace: ms > 0 ? natural / ms : 1 };
}

/** Why a world is locked, for the map's padlock tooltip and the phone's island list; undefined when it isn't. */
export function lockReason(state: GameState, world: World): string | undefined {
  if (!isWorldLocked(state, world)) return undefined;
  const number = new Map(orderedWorlds(state).map((w, i) => [w.id, i + 1]));
  const waiting = (world.unlocksAfter ?? []).map((id) => state.worlds[id]).filter((d) => d && !isWorldCleared(d));
  return `Clear ${waiting.map((d) => `World ${number.get(d.id)} (${d.name})`).join(' and ')} first`;
}

/** When a world was cleared (ms): its last level's `clearedAt`. Undefined while it isn't, or for old data without dates. */
export function worldClearedAt(world: World): number | undefined {
  if (!isWorldCleared(world)) return undefined;
  let last: number | undefined;
  for (const l of world.levels) {
    const t = l.clearedAt ? Date.parse(l.clearedAt) : NaN;
    if (Number.isNaN(t)) return undefined;
    last = Math.max(last ?? t, t);
  }
  return last;
}

/** Which fanfares this browser has played. `since` is when it started keeping track. */
export interface FanfareLog {
  since: string;
  seen: string[];
}

export const fanfareKey = (projectId: string, worldId: string) => `${projectId}/${worldId}`;

/**
 * Worlds owed a world-clear fanfare: cleared after this browser started keeping track, and not
 * celebrated yet. Worlds cleared before then (or imported finished) stay quiet.
 */
export function dueFanfares(projectId: string, worlds: World[], log: FanfareLog): string[] {
  return worlds
    .filter((w) => {
      const at = worldClearedAt(w);
      return at !== undefined && at >= Date.parse(log.since) && !log.seen.includes(fanfareKey(projectId, w.id));
    })
    .map((w) => w.id);
}
