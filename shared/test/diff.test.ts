import { describe, expect, it } from 'vitest';
import { diffStates, reviewLevel, clone } from '../src/index';
import { state } from './fixtures';

describe('diffStates', () => {
  it('finds added worlds, and added/modified/removed items', () => {
    const base = state();
    const head = clone(base);
    const lvl = head.worlds.w.levels[0];
    lvl.items[0].status = 'done';
    lvl.items = lvl.items.filter((i) => i.id !== 'c');
    lvl.items.push({ id: 'new', type: 'risk', title: 'New', status: 'todo' });
    head.worlds.x = { id: 'x', name: 'X', theme: 'ice', goalIds: [], levels: [] };
    head.overworld.worldOrder.push('x');

    const d = diffStates(base, head);
    expect(d.worlds.x.change).toBe('added');
    expect(d.worlds.w.change).toBe('modified');
    const ld = d.levels.find((l) => l.levelId === 'lvl')!;
    expect(ld.items.a.change).toBe('modified');
    expect(ld.items.a.fields[0]).toMatchObject({ field: 'status', before: 'todo', after: 'done' });
    expect(ld.items.c.change).toBe('removed');
    expect(ld.items.new.change).toBe('added');
    expect(d.overworld[0].field).toBe('worldOrder');

    const shown = reviewLevel(base.worlds.w.levels[0], lvl);
    expect(shown.items.map((i) => i.id)).toContain('c');
  });

  it('reports nothing for identical states', () => {
    expect(diffStates(state(), state()).count).toBe(0);
  });
});
