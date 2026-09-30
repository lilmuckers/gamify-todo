import type { GameState } from './model';
import { orderedWorlds } from './model';

export interface MapNode {
  id: string;
  /** Dependency depth: 0 = unlocks after nothing. */
  col: number;
  /** Position within the column, 0-based. */
  row: number;
}

export interface MapLayout {
  nodes: MapNode[];
  /** `from` must be cleared before `to` unlocks. */
  edges: { from: string; to: string }[];
  cols: number;
  /** Tallest column. */
  rows: number;
}

/**
 * Lays out a project's worlds by `unlocksAfter`: each world sits one column to
 * the right of its deepest dependency, and every dependency gets an edge.
 * Cycle-safe (a cycle is cut rather than recursing forever).
 */
export function layoutWorldMap(state: GameState): MapLayout {
  const worlds = orderedWorlds(state);
  const ids = new Set(worlds.map((w) => w.id));
  const deps = new Map(worlds.map((w) => [w.id, (w.unlocksAfter ?? []).filter((d) => ids.has(d) && d !== w.id)]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const colOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const ds = deps.get(id) ?? [];
    const c = ds.length ? 1 + Math.max(...ds.map(colOf)) : 0;
    visiting.delete(id);
    depth.set(id, c);
    return c;
  };
  worlds.forEach((w) => colOf(w.id));

  const cols = Math.max(0, ...depth.values()) + (worlds.length ? 1 : 0);
  const order = new Map(worlds.map((w, i) => [w.id, i]));
  const rowOf = new Map<string, number>();
  const nodes: MapNode[] = [];
  let rows = 0;
  for (let c = 0; c < cols; c++) {
    // Order each column by where its dependencies sit, to keep paths from crossing.
    const col = worlds
      .filter((w) => depth.get(w.id) === c)
      .map((w) => {
        const ds = deps.get(w.id)!.filter((d) => rowOf.has(d));
        const centre = ds.length ? ds.reduce((s, d) => s + rowOf.get(d)!, 0) / ds.length : order.get(w.id)!;
        return { id: w.id, centre };
      })
      .sort((a, b) => a.centre - b.centre || order.get(a.id)! - order.get(b.id)!);
    col.forEach((n, row) => {
      rowOf.set(n.id, row);
      nodes.push({ id: n.id, col: c, row });
    });
    rows = Math.max(rows, col.length);
  }
  const edges = worlds.flatMap((w) =>
    (deps.get(w.id) ?? []).filter((d) => depth.get(d)! < depth.get(w.id)!).map((d) => ({ from: d, to: w.id })),
  );
  return { nodes, edges, cols, rows };
}
