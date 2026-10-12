import { describe, expect, it } from 'vitest';
import { applyOp, makeOp, parseQuestText, planImport, validateWorkspace, type GameState, type OpBody, type Project, type Workspace } from '../src/index';
import { level, state } from './fixtures';

const text = (...lines: string[]) => lines.join('\n');
/** The messages as "line: text", 1-based like the editor shows them. */
const said = (src: string, existing?: GameState) => parseQuestText(src, existing).messages.map((m) => `${m.line + 1}: ${m.text}`);
/** The words the messages point at. */
const marked = (src: string) => {
  const lines = src.split('\n');
  return parseQuestText(src).messages.map((m) => (m.start === undefined ? null : lines[m.line].slice(m.start, m.end)));
};
const apply = (ws: Workspace, ops: OpBody[]) => ops.reduce((w, op) => applyOp(w, makeOp(op)), ws);
const project: Project = { id: 'kitchen', title: 'Kitchen', goals: [{ id: 'kitchen', title: 'Kitchen' }], worldOrder: [] };

const KITCHEN = text(
  '# Strip out',
  '## Empty shell @10d',
  '> Kitchen stripped back to bare walls and floor',
  '- [ ] Room empty, walls bare',
  '- [ ] (opt) Skirting boards saved for reuse',
  '- Book a skip £280',
  '- Remove old units after:book-a-skip',
  '- ! Gas still connected to hob',
  '- ? Keep the old radiator?',
  '- ~ Asbestos in ceiling tiles',
  '- + Repaint door frames',
  '- * Floor up, joists checked',
  '',
  '# First fix after:strip-out',
  '## Pipes and cables in @14d',
  '> Ready for the plasterer',
  '- [ ] Electrician signed off',
  '- => [Electrician booked](trades/book-the-electrician)',
  '- => Building control approval £250',
  '  - Draw up the plans',
  '  - Submit the application after:draw-up-the-plans',
  '  - ? Notify the neighbours first?',
  '- => Worktops delivered',
  '- Run new water feed after:building-control-approval,electrician-booked',
  '',
  '# Trades',
  '## Book the electrician @5d',
  '> A date in the diary',
  '- [ ] Booking confirmed in writing',
  '- Get three quotes',
);

describe('parseQuestText', () => {
  it('reads worlds, levels, deliverables, criteria and every item type', () => {
    const draft = parseQuestText(KITCHEN);
    expect(draft.messages).toEqual([]);
    expect(draft.worlds.map((w) => [w.id, w.after, w.levels.map((l) => l.id)])).toEqual([
      ['strip-out', [], ['empty-shell']],
      ['first-fix', ['strip-out'], ['pipes-and-cables-in']],
      ['trades', [], ['book-the-electrician']],
    ]);
    const shell = draft.worlds[0].levels[0];
    expect(shell).toMatchObject({ name: 'Empty shell', days: 10, deliverable: { line: 2, text: 'Kitchen stripped back to bare walls and floor' } });
    expect(shell.criteria.map((c) => [c.id, c.mvp])).toEqual([
      ['room-empty-walls-bare', true],
      ['skirting-boards-saved-for-reuse', false],
    ]);
    expect(shell.items.map((i) => [i.type, i.title])).toEqual([
      ['task', 'Book a skip'],
      ['task', 'Remove old units'],
      ['blocker', 'Gas still connected to hob'],
      ['decision', 'Keep the old radiator?'],
      ['risk', 'Asbestos in ceiling tiles'],
      ['stretch', 'Repaint door frames'],
      ['deliverable', 'Floor up, joists checked'],
    ]);
    expect(shell.items[0]).toMatchObject({ id: 'book-a-skip', budget: 280, line: 5 });
    expect(shell.items[1].after).toEqual(['book-a-skip']);
  });

  it('reads the three kinds of dependency', () => {
    const [cloud, pipe, plain, feed] = parseQuestText(KITCHEN).worlds[1].levels[0].items;
    expect(cloud).toMatchObject({ type: 'dependency', title: 'Electrician booked', levelRef: 'trades/book-the-electrician', steps: [] });
    expect(pipe).toMatchObject({ type: 'dependency', title: 'Building control approval', budget: 250 });
    expect(pipe.levelRef).toBeUndefined();
    expect(pipe.steps.map((s) => [s.type, s.id, s.after])).toEqual([
      ['task', 'draw-up-the-plans', []],
      ['task', 'submit-the-application', ['draw-up-the-plans']],
      ['decision', 'notify-the-neighbours-first', []],
    ]);
    expect(plain).toMatchObject({ type: 'dependency', title: 'Worktops delivered', steps: [] });
    expect(plain.levelRef).toBeUndefined();
    // A comma list, pointing at dependencies defined above.
    expect(feed.after).toEqual(['building-control-approval', 'electrician-booked']);
  });

  it('resolves links in the same world, by name, and titles a bare link from its level', () => {
    const draft = parseQuestText(text('# Trades', '## Fit @2d', '> In', '- [ ] In', '- => [Booked](Book the electrician)', '- => trades/book-the-electrician', '## Book the electrician @5d', '> Date', '- [ ] Booked'));
    expect(draft.messages).toEqual([]);
    expect(draft.worlds[0].levels[0].items.map((i) => [i.title, i.levelRef])).toEqual([
      ['Booked', 'trades/book-the-electrician'],
      ['Book the electrician', 'trades/book-the-electrician'],
    ]);
  });

  it('lets after: point forward, and takes a tab as an indent', () => {
    const draft = parseQuestText(text('# W', '## L @3d', '> D', '- [ ] C', '- Second after:first', '- First', '- => Chase', '\t- Step'));
    expect(draft.messages).toEqual([]);
    expect(draft.worlds[0].levels[0].items[0].after).toEqual(['first']);
    expect(draft.worlds[0].levels[0].items[2].steps.map((s) => s.title)).toEqual(['Step']);
  });

  it('carries on with a world whose heading comes up again', () => {
    const draft = parseQuestText(text('# A', '## One @1d', '> D', '- [ ] C', '# B', '# A', '## Two @1d', '> D', '- [ ] C'));
    expect(draft.worlds.map((w) => [w.id, w.levels.map((l) => l.id)])).toEqual([
      ['a', ['one', 'two']],
      ['b', []],
    ]);
  });

  it('joins a deliverable written over several lines', () => {
    const draft = parseQuestText(text('# W', '## L @3d', '> One', '> two', '- [ ] C'));
    expect(draft.worlds[0].levels[0].deliverable).toEqual({ line: 2, text: 'One two' });
  });

  it('gives items with the same title different ids, and never calls a level "world"', () => {
    const draft = parseQuestText(text('# W', '## World @3d', '> D', '- [ ] C', '- Paint', '- Paint'));
    expect(draft.worlds[0].levels[0].id).toBe('world-2');
    expect(draft.worlds[0].levels[0].items.map((i) => i.id)).toEqual(['paint', 'paint-2']);
    expect(draft.messages).toEqual([]);
  });

  it('only takes cost and after: from the end of a line', () => {
    const [a, b] = parseQuestText(text('# W', '## L @3d', '> D', '- [ ] C', '- Sell the £5 notes after:b £12.5', '- B')).worlds[0].levels[0].items;
    expect(a).toMatchObject({ title: 'Sell the £5 notes', budget: 12.5, after: ['b'] });
    expect(b.budget).toBeUndefined();
  });

  describe('messages', () => {
    const head = ['# W', '## L @3d', '> D', '- [ ] C'];
    it.each([
      [['## L @3d', '> D', '- [ ] C'], ['1: level before any "# World", put under "Unsorted"']],
      [['# W', '- Task'], ['2: this line is outside a level, add a "## Level" above it']],
      [['# W', '## L', '- Task'], ['2: no time-box (@7d), "> deliverable" line and "- [ ] success criterion" yet: defaults will be used']],
      [['# W', '## L @3d', '> D', '- [ ] C', '## L @3d', '> D', '- [ ] C'], ['5: second level called "L" in this world, saved as l-2']],
      [['# W', '## L @200d', '> D', '- [ ] C'], ['2: a time-box is 1 to 90 days, using 90']],
      [[...head, '- A after:nope', '- B'], ['5: after:nope matches nothing in this level. Ids here: b']],
      [[...head, '- A after:a'], ['5: an item cannot come after itself']],
      [[...head, '- A after:b', '- B after:a'], ['6: after:a would be a loop: a already waits for b']],
      [[...head, '- => [X](w/nope)'], ['5: no level w/nope in this plan: kept as something to wait for']],
      [[...head, '- => [X](w/l)'], ['5: a level cannot depend on itself: kept as something to wait for']],
      [[...head, '## M @1d', '> D', '- [ ] C', '- => [X](l)', '  - Step'], ['8: "X" links to a level, so it cannot also have steps: the steps are left out']],
      [[...head, '- => Chase', '  - => Deeper'], ['6: steps cannot be dependencies themselves, this line is left out']],
      [[...head, '- Task', '  - Sub'], ['6: indented, but not under a "=>" dependency: kept as a normal item']],
      [[...head, '- => Chase', '  - [ ] Check'], ['6: success criteria cannot be steps, moved to the level']],
      [['# W', '## L @3d', '> D', '- [ ] (opt) Nice'], ['4: a level needs one criterion that is not (opt): this one is made a must']],
      [[...head, 'Just a sentence'], ['5: not understood: start worlds with "# ", levels with "## " and items with "- "']],
      [[...head, '### Deeper'], ['5: only "# World" and "## Level" headings are used']],
      [[...head, '- '], ['5: nothing to add on this line']],
      [['# W after:nope', '# X after:x'], ['1: after:nope is not a world in this plan', '2: a world cannot come after itself']],
      [['# A after:b', '# B after:a'], ['2: after:a would be a loop: a already waits for b']],
      [[...head, `- ${'x'.repeat(130)}`], ['5: the title is too long, cut at 120 characters']],
    ])('%j', (lines, expected) => {
      expect(said(text(...lines))).toEqual(expected);
    });

    it('point at the word at fault', () => {
      expect(marked(text('# W after:nope', '## L @200d', '> D', '- [ ] C', '- A after:b,gone £5', '- B', '- => [X](w/nope)', '- => other/level'))).toEqual(['nope', '@200d', 'gone', 'w/nope', 'other/level']);
      // No single word at fault: the whole line.
      expect(marked(text('# W', '- Task'))).toEqual([null]);
    });

    it('keeps what it can: the bad link or wait is dropped, the item stays', () => {
      const items = parseQuestText(text('# W', '## L @3d', '> D', '- [ ] C', '- A after:nope', '- => [X](w/nope)')).worlds[0].levels[0].items;
      expect(items.map((i) => [i.title, i.after, i.levelRef])).toEqual([
        ['A', [], undefined],
        ['X', [], undefined],
      ]);
    });

    it('leaves out what goes past the schema limits', () => {
      const lines = ['# W', '## L @3d', '> D', '- [ ] C', ...Array.from({ length: 201 }, (_, i) => `- Task ${i}`)];
      const draft = parseQuestText(text(...lines));
      expect(draft.worlds[0].levels[0].items).toHaveLength(200);
      expect(draft.messages.map((m) => m.text)).toEqual(['a level holds at most 200 items, this one is left out']);
    });
  });

  describe('against a project that is already there', () => {
    const existing = state(level());
    it('takes the ids of what matches by name, not only by id', () => {
      // The fixture's level is "lvl" called "Level"; its items are a/b/c called A/B/C; its criteria mvp-1 "Works" and bonus "Pretty".
      const draft = parseQuestText(text('# w', '## Level', '- [ ] Works', '- [ ] New check', '- A', '- New after:B', '- => [Self](W/Level)', '## Lvl'), existing);
      const [lvl, second] = draft.worlds[0].levels;
      expect(lvl.id).toBe('lvl');
      expect(lvl.criteria.map((c) => c.id)).toEqual(['mvp-1', 'new-check']);
      expect(lvl.items.map((i) => [i.id, i.after])).toEqual([
        ['a', []],
        ['new', ['b']],
        ['self', []],
      ]);
      expect(draft.messages.map((m) => m.text)).toEqual(['a level cannot depend on itself: kept as something to wait for', 'second level called "Lvl" in this world, saved as lvl-2', 'no time-box (@7d), "> deliverable" line and "- [ ] success criterion" yet: defaults will be used']);
      expect(second.id).toBe('lvl-2');
    });

    it('lets links and after: point at what it holds', () => {
      const src = text('# W after:w', '## Lvl', '- New after:a', '## Next @2d', '> D', '- [ ] C', '- => [Old](w/lvl)', '# Other after:w');
      const draft = parseQuestText(src, existing);
      // The existing world keeps its own unlocksAfter; the existing level needs no defaults.
      expect(draft.messages.map((m) => m.text)).toEqual(['the world "W" is already there, so after: is left as it is']);
      expect(draft.worlds[0].levels[0].items[0].after).toEqual(['a']);
      expect(draft.worlds[0].levels[1].items[0].levelRef).toBe('w/lvl');
      expect(draft.worlds[1].after).toEqual(['w']);
      expect(said(src)).toContain('3: after:a matches nothing in this level');
    });
  });
});

describe('planImport', () => {
  it('builds a new project that validates, with budgets turned on by a cost', () => {
    const { ops, summary } = planImport(parseQuestText(KITCHEN), { projectId: 'kitchen', create: project });
    expect(ops.map((o) => o.kind)).toEqual(['addProject', 'addWorld', 'addLevel', 'addWorld', 'addLevel', 'addWorld', 'addLevel']);
    expect(summary).toEqual({ worlds: 3, levels: 3, items: 15, criteria: 4, skipped: 0, budgetsOn: true });
    const ws = apply({ projects: {} }, ops);
    expect(validateWorkspace(ws)).toEqual([]);
    const made = ws.projects.kitchen;
    expect(made.overworld).toMatchObject({ budgets: {}, worldOrder: ['strip-out', 'first-fix', 'trades'] });
    expect(Object.values(made.worlds).map((w) => [w.theme, w.goalIds, w.unlocksAfter])).toEqual([
      ['grass', ['kitchen'], undefined],
      ['desert', ['kitchen'], ['strip-out']],
      ['water', ['kitchen'], undefined],
    ]);
    const pipes = made.worlds['first-fix'].levels[0];
    expect(pipes.items[1]).toEqual({
      id: 'building-control-approval',
      type: 'dependency',
      title: 'Building control approval',
      status: 'todo',
      subtasks: [
        { id: 'draw-up-the-plans', type: 'task', title: 'Draw up the plans', status: 'todo' },
        { id: 'submit-the-application', type: 'task', title: 'Submit the application', status: 'todo', dependsOn: ['draw-up-the-plans'] },
        { id: 'notify-the-neighbours-first', type: 'decision', title: 'Notify the neighbours first?', status: 'todo' },
      ],
      budget: 250,
    });
    expect(pipes.items[0].levelRef).toBe('trades/book-the-electrician');
    expect(pipes.successCriteria).toEqual([{ id: 'electrician-signed-off', text: 'Electrician signed off', mvp: true, done: false }]);
  });

  it('fills in what a bare level needs, so it still validates', () => {
    const { ops, summary } = planImport(parseQuestText(text('# W', '## Paint the hall', '- Buy paint')), { projectId: 'kitchen', create: project });
    const ws = apply({ projects: {} }, ops);
    expect(validateWorkspace(ws)).toEqual([]);
    expect(ws.projects.kitchen.worlds.w.levels[0]).toMatchObject({
      deliverable: 'Paint the hall',
      timeboxDays: 5,
      successCriteria: [{ id: 'paint-the-hall', text: 'Paint the hall', mvp: true, done: false }],
    });
    expect(summary.budgetsOn).toBe(false);
    expect(ws.projects.kitchen.overworld.budgets).toBeUndefined();
  });

  it('with nothing typed, only makes the project', () => {
    expect(planImport(parseQuestText(''), { projectId: 'kitchen', create: project }).ops).toEqual([{ kind: 'addProject', projectId: 'kitchen', project }]);
  });

  it('adds to an existing project: worlds and levels are reused, what is there is skipped', () => {
    const existing = state(level());
    const ws: Workspace = { projects: { p: existing } };
    const src = text('# W', '## Lvl', '- [ ] Bonus', '- [ ] Fast', '- A', '- D after:a £9', '- => Chase', '  - Step', '## Fresh @2d', '> New', '- [ ] Done', '# Extra', '## More @1d', '> M', '- [ ] M');
    const draft = parseQuestText(src, existing);
    expect(draft.messages).toEqual([]);
    const { ops, summary } = planImport(draft, { projectId: 'p' }, existing);
    expect(ops.map((o) => o.kind)).toEqual(['updateProject', 'addCriterion', 'addItem', 'addItem', 'addLevel', 'addWorld', 'addLevel']);
    expect(summary).toEqual({ worlds: 1, levels: 2, items: 3, criteria: 3, skipped: 2, budgetsOn: true });
    const next = apply(ws, ops);
    expect(validateWorkspace(next)).toEqual([]);
    const lvl = next.projects.p.worlds.w.levels[0];
    // The fixture's own items and criteria are untouched; the new ones follow.
    expect(lvl.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'chase']);
    expect(lvl.items[0]).toEqual(level().items[0]);
    expect(lvl.items[3]).toMatchObject({ dependsOn: ['a'], budget: 9 });
    expect(lvl.successCriteria.map((c) => c.id)).toEqual(['mvp-1', 'bonus', 'fast']);
    expect(next.projects.p.worlds.w.levels.map((l) => l.id)).toEqual(['lvl', 'fresh']);
    expect(next.projects.p.worlds.extra).toMatchObject({ theme: 'desert', goalIds: [] });
    // Doing it twice adds nothing more.
    const again = planImport(parseQuestText(src, next.projects.p), { projectId: 'p' }, next.projects.p);
    expect(again.ops).toEqual([]);
    expect(again.summary.skipped).toBe(8);
  });
});
