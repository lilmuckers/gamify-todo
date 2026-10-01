import { describe, expect, it } from 'vitest';
import {
  applyOp,
  changedFiles,
  describeOp,
  fromFiles,
  INBOX_PATH,
  inverseOp,
  makeOp,
  OpConflict,
  toFiles,
  validateFiles,
  type InboxItem,
  type OpBody,
  type Workspace,
} from '../src';
import { at, level, lvlOf, workspace } from './fixtures';

const idea = (id: string, extra: Partial<InboxItem> = {}): InboxItem => ({ id, type: 'task', title: id.toUpperCase(), ...extra });
const withInbox = (items: InboxItem[], ws: Workspace = workspace()): Workspace => ({ ...ws, inbox: items });
const run = (ws: Workspace, body: OpBody) => applyOp(ws, makeOp(body));

describe('data/inbox.json', () => {
  it('round-trips through files and is optional', () => {
    const ws = withInbox([idea('tiles', { type: 'decision', notes: 'Which colour?', link: 'https://example.com/tiles' })]);
    const files = toFiles(ws);
    expect(JSON.parse(files[INBOX_PATH]).items).toEqual(ws.inbox);
    expect(fromFiles(files).inbox).toEqual(ws.inbox);
    expect(validateFiles(files)).toEqual([]);
    expect(toFiles(workspace())).not.toHaveProperty(INBOX_PATH);
  });

  it('rejects duplicate ids and unknown fields', () => {
    const files = { ...toFiles(workspace()), [INBOX_PATH]: JSON.stringify({ items: [idea('a'), idea('a')] }) };
    expect(validateFiles(files).map((i) => i.message)).toContain('duplicate inbox item id "a"');
    files[INBOX_PATH] = JSON.stringify({ items: [{ ...idea('a'), status: 'todo' }] });
    expect(validateFiles(files).length).toBeGreaterThan(0);
  });
});

describe('inbox ops', () => {
  it('adds, edits and removes captured ideas', () => {
    let ws = run(workspace(), { kind: 'inboxAdd', item: idea('a') });
    ws = run(ws, { kind: 'inboxAdd', item: idea('b') });
    ws = run(ws, { kind: 'inboxUpdate', id: 'a', patch: { title: 'Buy tiles', type: 'deliverable' } });
    expect(ws.inbox).toEqual([{ id: 'a', type: 'deliverable', title: 'Buy tiles' }, idea('b')]);
    ws = run(ws, { kind: 'inboxRemove', ids: ['a', 'b'] });
    expect(ws).not.toHaveProperty('inbox');
    expect(() => run(withInbox([idea('a')]), { kind: 'inboxAdd', item: idea('a') })).toThrow(OpConflict);
  });

  it('places items in a level as to-dos, with fresh ids, in one change', () => {
    const before = withInbox([idea('a', { notes: 'N', link: 'https://x.test' }), idea('keep')]);
    const after = run(before, { kind: 'inboxPlace', ids: ['a'], ...at });
    // "a" is taken in the level already, so it gets a new id.
    expect(lvlOf(after).items.at(-1)).toEqual({ id: 'a-2', type: 'task', title: 'A', status: 'todo', link: 'https://x.test', notes: 'N' });
    expect(after.inbox).toEqual([idea('keep')]);
    // Level file and inbox file change together.
    expect(Object.keys(changedFiles(before, after)).sort()).toEqual([INBOX_PATH, 'data/p/w/lvl.json'].sort());
    expect(describeOp(makeOp({ kind: 'inboxPlace', ids: ['a'], ...at }))).toBe('place 1 inbox item in p/w/lvl');
  });

  it('places items as steps of a dependency, turning dependencies into tasks', () => {
    const ws = withInbox([idea('d', { type: 'dependency' })], workspace(level({ items: [{ id: 'dep', type: 'dependency', title: 'Permit', status: 'todo' }] })));
    const after = run(ws, { kind: 'inboxPlace', ids: ['d'], ...at, parentId: 'dep' });
    expect(lvlOf(after).items[0].subtasks).toEqual([{ id: 'd', type: 'task', title: 'D', status: 'todo' }]);
  });

  it('refuses missing items or levels', () => {
    expect(() => run(withInbox([idea('a')]), { kind: 'inboxPlace', ids: ['ghost'], ...at })).toThrow(/inbox item "ghost"/);
    expect(() => run(withInbox([idea('a')]), { kind: 'inboxPlace', ids: ['a'], ...at, levelId: 'nope' })).toThrow(OpConflict);
  });

  it('can be undone', () => {
    const before = withInbox([idea('a'), idea('b'), idea('c')]);
    for (const body of [
      { kind: 'inboxAdd', item: idea('d') },
      { kind: 'inboxUpdate', id: 'b', patch: { title: 'Changed', notes: 'x' } },
      { kind: 'inboxRemove', ids: ['b'] },
    ] as OpBody[]) {
      const after = run(before, body);
      expect(run(after, inverseOp(body, before)!).inbox).toEqual(before.inbox);
    }
    expect(inverseOp({ kind: 'inboxPlace', ids: ['a'], ...at }, before)).toBeUndefined();
  });
});
