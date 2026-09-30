import { describe, expect, it } from 'vitest';
import { validateFiles, validateWorkspace, toFiles } from '../src/index';
import { readDataDir } from '../scripts/read-data';
import { level, workspace } from './fixtures';

const messages = (ws: ReturnType<typeof workspace>) => validateWorkspace(ws).map((i) => i.message).join('\n');
const fileMessages = (files: Record<string, string>) => validateFiles(files).map((i) => `${i.file}: ${i.message}`).join('\n');

describe('validateWorkspace', () => {
  it('accepts the fixture', () => {
    expect(validateWorkspace(workspace())).toEqual([]);
  });

  it('accepts the committed data', () => {
    expect(validateFiles(readDataDir(process.cwd()))).toEqual([]);
  });

  it('rejects unknown properties', () => {
    const ws = workspace();
    (ws.projects.p.worlds.w.levels[0].items[0] as any).priority = 'high';
    expect(messages(ws)).toMatch(/additional properties: priority/);
  });

  it('rejects bad ids and enum values', () => {
    const ws = workspace();
    ws.projects.p.worlds.w.levels[0].items[0].id = 'Bad Id';
    (ws.projects.p.worlds.w.levels[0].items[1] as any).type = 'bug';
    const m = messages(ws);
    expect(m).toMatch(/pattern/);
    expect(m).toMatch(/const|oneOf/);
  });

  it('rejects dangling dependsOn and cycles', () => {
    const ws = workspace(
      level({
        items: [
          { id: 'a', type: 'task', title: 'A', status: 'todo', dependsOn: ['b'] },
          { id: 'b', type: 'task', title: 'B', status: 'todo', dependsOn: ['a'] },
          { id: 'c', type: 'task', title: 'C', status: 'todo', dependsOn: ['ghost'] },
        ],
      }),
    );
    const m = messages(ws);
    expect(m).toMatch(/unknown item "ghost"/);
    expect(m).toMatch(/dependency cycle/);
  });

  it('requires an MVP criterion and known references within the project', () => {
    const ws = workspace(level({ successCriteria: [{ id: 'x', text: 'x', mvp: false, done: false }] }));
    ws.projects.p.worlds.w.goalIds = ['nope'];
    ws.projects.p.worlds.w.levels[0].items[0].levelRef = 'w/missing';
    const m = messages(ws);
    expect(m).toMatch(/at least one criterion/);
    expect(m).toMatch(/unknown goal "nope"/);
    expect(m).toMatch(/unknown level "w\/missing"/);
  });

  it('reserves the level id "world"', () => {
    const ws = workspace(level({ id: 'world' }));
    expect(messages(ws)).toMatch(/reserved/);
  });
});

describe('validateFiles (folder structure)', () => {
  const good = () => toFiles(workspace());

  it('requires ids to match paths', () => {
    const files = good();
    files['data/p/w/lvl.json'] = files['data/p/w/lvl.json'].replace('"id": "lvl"', '"id": "other"');
    expect(fileMessages(files)).toMatch(/lvl\.json: id "other" must match its file name "lvl"/);
  });

  it('requires order lists to match files and parents to exist', () => {
    const files = good();
    files['data/p/w/extra.json'] = files['data/p/w/lvl.json'].replace('"id": "lvl"', '"id": "extra"');
    files['data/p/orphan/stray.json'] = '{}';
    files['data/q/w/world.json'] = files['data/p/w/world.json'];
    delete files['data/p/w/lvl.json'];
    const m = fileMessages(files);
    expect(m).toMatch(/no data\/p\/w\/lvl\.json/);
    expect(m).toMatch(/level "extra" missing from levelOrder/);
    expect(m).toMatch(/no data\/p\/orphan\/world\.json for this level/);
    expect(m).toMatch(/no data\/q\/project\.json for this world/);
  });

  it('flags stray files and bad JSON', () => {
    const files = good();
    files['data/notes.json'] = '{}';
    files['data/p/w/lvl.json'] = '{nope';
    const m = fileMessages(files);
    expect(m).toMatch(/notes\.json: unexpected file/);
    expect(m).toMatch(/invalid JSON/);
  });
});
