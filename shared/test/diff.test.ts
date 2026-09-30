import { describe, expect, it } from 'vitest';
import { diffWorkspaces, reviewLevel, clone } from '../src/index';
import { workspace } from './fixtures';

describe('diffWorkspaces', () => {
  it('finds added projects/worlds and added/modified/removed items', () => {
    const base = workspace();
    const head = clone(base);
    const p = head.projects.p;
    const lvl = p.worlds.w.levels[0];
    lvl.items[0].status = 'done';
    lvl.items = lvl.items.filter((i) => i.id !== 'c');
    lvl.items.push({ id: 'new', type: 'risk', title: 'New', status: 'todo' });
    p.worlds.x = { id: 'x', name: 'X', theme: 'ice', goalIds: [], levels: [] };
    p.overworld.worldOrder.push('x');
    head.projects.house = { overworld: { id: 'house', title: 'House', goals: [], worldOrder: [] }, worlds: {} };

    const d = diffWorkspaces(base, head);
    expect(d.projects.house.change).toBe('added');
    expect(d.projects.p.change).toBe('modified');
    expect(d.projects.p.diff.worlds.x.change).toBe('added');
    const ld = d.levels.find((l) => l.levelId === 'lvl')!;
    expect(ld.projectId).toBe('p');
    expect(ld.items.a.fields[0]).toMatchObject({ field: 'status', before: 'todo', after: 'done' });
    expect(ld.items.c.change).toBe('removed');
    expect(ld.items.new.change).toBe('added');

    expect(reviewLevel(base.projects.p.worlds.w.levels[0], lvl).items.map((i) => i.id)).toContain('c');
  });

  it('reports nothing for identical workspaces', () => {
    expect(diffWorkspaces(workspace(), workspace()).count).toBe(0);
  });
});
