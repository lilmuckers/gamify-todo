import { describe, expect, it } from 'vitest';
import { parseQuestText } from '@quest/shared';
import { cleanPaste, completionAt, continueList, expandCheckbox, indentLines, pickSuggestion, type Edit } from '../src/ui/quest-keys';
import { level, state } from '../../shared/test/fixtures';

/** Text with `|` at the caret, or `[` and `]` round a selection. */
function at(marked: string) {
  const caret = marked.indexOf('|');
  if (caret >= 0) return { value: marked.replace('|', ''), start: caret, end: caret };
  const start = marked.indexOf('[');
  const value = marked.replace('[', '');
  const end = value.indexOf(']');
  return { value: value.replace(']', ''), start, end };
}
/** The text after an edit, marked the same way. */
function done(value: string, edit: Edit | undefined) {
  if (!edit) return undefined;
  const next = value.slice(0, edit.from) + edit.text + value.slice(edit.to);
  return edit.start === edit.end
    ? `${next.slice(0, edit.start)}|${next.slice(edit.start)}`
    : `${next.slice(0, edit.start)}[${next.slice(edit.start, edit.end)}]${next.slice(edit.end)}`;
}
const tab = (marked: string, out = false) => {
  const { value, start, end } = at(marked);
  return done(value, indentLines(value, start, end, out));
};
const enter = (marked: string) => {
  const { value, start, end } = at(marked);
  return done(value, continueList(value, start, end));
};
const space = (marked: string) => {
  const { value, start } = at(marked);
  return done(value, expandCheckbox(value, start));
};

describe('Tab and Shift+Tab', () => {
  it('moves the whole line in, wherever the caret is', () => {
    expect(tab('- Chase\n- A st|ep')).toBe('- Chase\n  - A st|ep');
    expect(tab('|- Step')).toBe('  |- Step');
  });
  it('leaves alone what cannot go in: an indented line, a heading, a deliverable, a blank', () => {
    for (const line of ['  - St|ep', '## Lev|el', '> Deliver|able', '|']) expect(tab(line)).toBeUndefined();
  });
  it('moves every list line of a selection, and keeps it selected', () => {
    expect(tab('- A\n- [B\n## L\n- C]\n- D')).toBe('- A\n  - [B\n## L\n  - C]\n- D');
    // A selection that stops at the start of a line doesn't take that line with it.
    expect(tab('[- A\n]- B')).toBe('[  - A\n]- B');
  });
  it('moves a line out by two spaces, one, or a tab', () => {
    expect(tab('  - St|ep', true)).toBe('- St|ep');
    expect(tab(' - St|ep', true)).toBe('- St|ep');
    expect(tab('\t- St|ep', true)).toBe('- St|ep');
    expect(tab('  |- Step', true)).toBe('|- Step');
    expect(tab('- St|ep', true)).toBeUndefined();
    expect(tab('[  - A\n  - B]', true)).toBe('[- A\n- B]');
  });
});

describe('Enter', () => {
  it('carries a list on with the same dash and indent', () => {
    expect(enter('- Task|')).toBe('- Task\n- |');
    expect(enter('  - Step|')).toBe('  - Step\n  - |');
    expect(enter('\t- Step|')).toBe('\t- Step\n  - |');
  });
  it('carries a criterion on with a box, but not a type or (opt)', () => {
    expect(enter('- [ ] Check|')).toBe('- [ ] Check\n- [ ] |');
    expect(enter('- [x] (opt) Nice|')).toBe('- [x] (opt) Nice\n- [ ] |');
    expect(enter('- ! Blocker|')).toBe('- ! Blocker\n- |');
    expect(enter('- => Chase £40|')).toBe('- => Chase £40\n- |');
  });
  it('takes the rest of the line down with it', () => {
    expect(enter('- One| two\n- Three')).toBe('- One\n- | two\n- Three');
  });
  it('steps out of an empty bullet: an indented one loses its indent, a plain one its dash', () => {
    expect(enter('- Chase\n  - |')).toBe('- Chase\n- |');
    expect(enter('- Task\n- |\n## Next')).toBe('- Task\n|\n## Next');
    expect(enter('- [ ] |')).toBe('|');
    expect(enter('  - [ ] |')).toBe('- [ ] |');
  });
  it('is left to the browser everywhere else', () => {
    for (const line of ['## Level|', '# World|', '> Deliverable|', 'words|', '|', '|- Task', '- [Task]']) expect(enter(line)).toBeUndefined();
  });
});

describe('"- []" and a space', () => {
  it('makes the box', () => {
    expect(space('- [] |')).toBe('- [ ] |');
    expect(space('  -[] |')).toBe('  - [ ] |');
    expect(space('- A\n- [] |\n- B')).toBe('- A\n- [ ] |\n- B');
  });
  it('only at the start of a list line', () => {
    for (const line of ['- Task [] |', '[] |', '- [x] |', '- []|', '- [ |]']) expect(space(line)).toBeUndefined();
  });
});

describe('cleanPaste', () => {
  it("turns other apps' bullets and tick boxes into this format's", () => {
    expect(cleanPaste(['• One', '* Two', '– Three', '— Four', '1. Five', '2) Six', '  ◦ Seven', '☐ Check', '[ ] Check', '[] Check', '☑ Done', '[x] Done', '* [ ] Both', '- [x] Was done'].join('\n'))).toBe(
      ['- One', '- Two', '- Three', '- Four', '- Five', '- Six', '  - Seven', '- [ ] Check', '- [ ] Check', '- [ ] Check', '- [ ] Done', '- [ ] Done', '- [ ] Both', '- [ ] Was done'].join('\n'),
    );
  });
  it('leaves this format, and ordinary text, as it is', () => {
    const own = ['# World', '## Level @7d', '> Deliverable', '- Task', '- * Deliverable', '- + Stretch', '+ Not a bullet here', '  - Step', '*bold* words', '2024 was long', ''].join('\n');
    expect(cleanPaste(own)).toBe(own);
  });
  it('takes Windows line ends', () => {
    expect(cleanPaste('• A\r\n• B')).toBe('- A\n- B');
  });
});

describe('completionAt', () => {
  const PLAN = ['# Strip out', '## Empty shell @10d', '> Bare walls', '- [ ] Room empty', '- Book a skip', '- Remove old units', '- => Building control', '  - Draw up the plans', '  - Submit the application', '# Trades', '## Book the electrician @5d', '> A date', '- [ ] Booked', '- Get three quotes'];
  /** Suggestions at the `|` in `line`, put in place of line `n` of the plan (or added at the end). */
  function offer(line: string, n = PLAN.length, existing?: Parameters<typeof completionAt>[3]) {
    const lines = [...PLAN];
    lines.splice(n, n < PLAN.length ? 1 : 0, line);
    const { value, start } = at(lines.join('\n'));
    const c = completionAt(value, start, parseQuestText(value, existing), existing);
    return c && { ...c, value, typed: value.slice(c.from, c.to), ids: c.options.map((o) => o.insert) };
  }

  it("after: offers the level's other items, not the line's own", () => {
    expect(offer('- Remove old units after:|', 5)?.ids).toEqual(['book-a-skip', 'building-control']);
    expect(offer('- Book a skip after:|', 4)?.ids).toEqual(['remove-old-units', 'building-control']);
    // In the last level of the plan.
    expect(offer('- Pay the deposit after:|')?.ids).toEqual(['get-three-quotes']);
  });
  it('on a step, offers only the other steps of its dependency', () => {
    expect(offer('  - Submit the application after:|', 8)?.ids).toEqual(['draw-up-the-plans']);
  });
  it('on a world line, offers the other worlds', () => {
    expect(offer('# Trades after:|', 9)?.ids).toEqual(['strip-out']);
  });
  it('matches anywhere in the title or id, whatever the case or spacing, the starts first', () => {
    expect(offer('- X after:skip|', 5)?.ids).toEqual(['book-a-skip']);
    expect(offer('- X after:A-SK|', 5)?.ids).toEqual(['book-a-skip']);
    expect(offer('- X after:b|', 5)?.ids).toEqual(['book-a-skip', 'building-control']);
    expect(offer('- X after:con|', 5)?.ids).toEqual(['building-control']);
    expect(offer('- X after:zzz|', 5)?.ids).toEqual([]);
    // "bu" starts "Building control" but is only inside nothing else.
    expect(offer('- X after:o|', 5)?.ids).toEqual(['book-a-skip', 'building-control']);
  });
  it('covers exactly the word being typed, and drops what the same after: already lists', () => {
    const c = offer('- X after:book-a-skip,bu|il,remove-old-units £5', 5)!;
    expect(c.typed).toBe('buil');
    expect(c.ids).toEqual(['building-control']);
    expect(offer('- X after:book-a-skip,|', 5)?.ids).toEqual(['building-control']);
  });
  it('a link offers every level but its own, as world/level', () => {
    const c = offer('- => [Booked](|', 5)!;
    expect(c.options).toEqual([{ insert: 'trades/book-the-electrician', title: 'Trades › Book the electrician', there: false }]);
    expect(offer('- => [Shell](|')?.ids).toEqual(['strip-out/empty-shell']);
    expect(offer('- => [Shell](ty SH|')?.ids).toEqual(['strip-out/empty-shell']);
    expect(offer('- => [Shell](strip-out/em|')?.ids).toEqual(['strip-out/empty-shell']);
    expect(offer('- => [Shell](elec|tric)')?.typed).toBe('electric');
  });
  it('picking replaces the word; a link gets its bracket, and the caret goes past it', () => {
    const put = (line: string, n?: number) => {
      const c = offer(line, n)!;
      return done(c.value, pickSuggestion(c.value, c, c.options[0]))!.split('\n').find((l) => l.includes('|'));
    };
    expect(put('- X after:ski|p £5', 5)).toBe('- X after:book-a-skip| £5');
    expect(put('- => [Booked](elec|', 5)).toBe('- => [Booked](trades/book-the-electrician)|');
    expect(put('- => [Booked](elec|)', 5)).toBe('- => [Booked](trades/book-the-electrician)|');
  });
  it('offers nothing where no link goes', () => {
    for (const line of ['- Just a ta|sk', '- X after:a |', '## Level after:|', '- Plain [x](|', '> after:|']) expect(offer(line, 5)).toBeUndefined();
    // A line with no level above it has nothing to wait for.
    expect(completionAt('# W\n- X after:', 15, parseQuestText('# W\n- X after:'))).toBeUndefined();
  });
  it('when adding to a project, offers what it holds too', () => {
    // The fixture: world w, level "Level" (id lvl), items a/b/c.
    const existing = state(level());
    const src = '# W\n## Level\n- New after:';
    const c = completionAt(src, src.length, parseQuestText(src, existing), existing)!;
    expect(c.options).toEqual([
      { insert: 'a', title: 'A', there: true },
      { insert: 'b', title: 'B', there: true },
      { insert: 'c', title: 'C', there: true },
    ]);
    const link = '# W\n## Other @1d\n- => [Old](';
    expect(completionAt(link, link.length, parseQuestText(link, existing), existing)!.options).toEqual([{ insert: 'w/lvl', title: 'W › Level', there: true }]);
    const world = '# New after:';
    expect(completionAt(world, world.length, parseQuestText(world, existing), existing)!.options).toEqual([{ insert: 'w', title: 'W', there: true }]);
  });
});
