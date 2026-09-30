import { describe, expect, it } from 'vitest';
import { layoutWorldMap, type GameState, type World } from '../src/index';

function project(worlds: [string, string[]][]): GameState {
  const ws: Record<string, World> = {};
  for (const [id, after] of worlds)
    ws[id] = { id, name: id, theme: 'grass', goalIds: [], unlocksAfter: after.length ? after : undefined, levels: [] };
  return { overworld: { id: 'p', title: 'P', goals: [], worldOrder: worlds.map(([id]) => id) }, worlds: ws };
}

const pos = (m: ReturnType<typeof layoutWorldMap>) => Object.fromEntries(m.nodes.map((n) => [n.id, [n.col, n.row]]));

describe('layoutWorldMap', () => {
  it('places worlds by dependency depth, not creation order', () => {
    // a → b, a → c, b + c → d; e is independent.
    const m = layoutWorldMap(project([['d', ['b', 'c']], ['e', []], ['b', ['a']], ['a', []], ['c', ['a']]]));
    const p = pos(m);
    expect(p.a[0]).toBe(0);
    expect(p.e[0]).toBe(0);
    expect(p.b[0]).toBe(1);
    expect(p.c[0]).toBe(1);
    expect(p.d[0]).toBe(2);
    expect(m.cols).toBe(3);
    expect(m.rows).toBe(2);
    expect(m.edges).toEqual(
      expect.arrayContaining([
        { from: 'b', to: 'd' },
        { from: 'c', to: 'd' },
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
      ]),
    );
    expect(m.edges).toHaveLength(4);
  });

  it('puts unconnected worlds side by side in the first column with no edges', () => {
    const m = layoutWorldMap(project([['x', []], ['y', []]]));
    expect(m.cols).toBe(1);
    expect(m.edges).toEqual([]);
  });

  it('survives cycles and unknown references', () => {
    const m = layoutWorldMap(project([['a', ['b']], ['b', ['a']], ['c', ['ghost']]]));
    expect(m.nodes).toHaveLength(3);
  });

  it('handles an empty project', () => {
    expect(layoutWorldMap(project([]))).toEqual({ nodes: [], edges: [], cols: 0, rows: 0 });
  });
});
