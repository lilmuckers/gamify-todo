import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { validateState, fromFiles } from '../src/index';
import { level, state } from './fixtures';

const messages = (s: ReturnType<typeof state>) => validateState(s).map((i) => i.message).join('\n');

describe('validateState', () => {
  it('accepts the fixture', () => {
    expect(validateState(state())).toEqual([]);
  });

  it('accepts the committed seed data', () => {
    const files: Record<string, string> = { 'data/game.json': readFileSync('data/game.json', 'utf8') };
    for (const f of readdirSync('data/worlds'))
      files[`data/worlds/${f}`] = readFileSync(`data/worlds/${f}`, 'utf8');
    expect(validateState(fromFiles(files))).toEqual([]);
  });

  it('rejects unknown properties', () => {
    const s = state();
    (s.worlds.w.levels[0].items[0] as any).priority = 'high';
    expect(messages(s)).toMatch(/additional properties: priority/);
  });

  it('rejects bad ids and enum values', () => {
    const s = state();
    s.worlds.w.levels[0].items[0].id = 'Bad Id';
    (s.worlds.w.levels[0].items[1] as any).type = 'bug';
    const m = messages(s);
    expect(m).toMatch(/pattern/);
    expect(m).toMatch(/const|oneOf/);
  });

  it('rejects dangling dependsOn and cycles', () => {
    const s = state(
      level({
        items: [
          { id: 'a', type: 'task', title: 'A', status: 'todo', dependsOn: ['b'] },
          { id: 'b', type: 'task', title: 'B', status: 'todo', dependsOn: ['a'] },
          { id: 'c', type: 'task', title: 'C', status: 'todo', dependsOn: ['ghost'] },
        ],
      }),
    );
    const m = messages(s);
    expect(m).toMatch(/unknown item "ghost"/);
    expect(m).toMatch(/dependency cycle/);
  });

  it('requires an MVP criterion and known references', () => {
    const s = state(level({ successCriteria: [{ id: 'x', text: 'x', mvp: false, done: false }] }));
    s.worlds.w.goalIds = ['nope'];
    s.worlds.w.levels[0].items[0].levelRef = 'w/missing';
    const m = messages(s);
    expect(m).toMatch(/at least one criterion/);
    expect(m).toMatch(/unknown goal "nope"/);
    expect(m).toMatch(/unknown level "w\/missing"/);
  });

  it('requires worldOrder and files to agree', () => {
    const s = state();
    s.overworld.worldOrder.push('ghost');
    expect(messages(s)).toMatch(/no world file for "ghost"/);
  });
});
