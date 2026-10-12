import type { DraftItem, GameState, QuestDraft } from '@quest/shared';

/**
 * What the Quest Markdown editor's keys do, worked out on plain strings so it
 * can be tested without a browser: list keys (Enter, Tab, Shift+Tab), the
 * `- []` shorthand, tidying pasted lists, and the suggestions for `after:` and
 * `=> [Title](…)` links.
 */

/** Replace `value.slice(from, to)` with `text`, then select `start..end`. */
export interface Edit {
  from: number;
  to: number;
  text: string;
  start: number;
  end: number;
}

const lineStart = (value: string, at: number) => value.lastIndexOf('\n', at - 1) + 1;
const lineEnd = (value: string, at: number) => {
  const end = value.indexOf('\n', at);
  return end < 0 ? value.length : end;
};
/** Indent, dash and (for a criterion) its box, at the start of a list line. */
const MARKER = /^([ \t]*)-[ \t]*(\[[ xX]?\][ \t]*)?/;
const isNested = (indent: string) => indent.replace(/\t/g, '  ').length >= 2;

/**
 * Tab and Shift+Tab: moves the selected lines in or out one step. The format
 * nests one deep, so only list lines with no indent move in.
 */
export function indentLines(value: string, selStart: number, selEnd: number, out: boolean): Edit | undefined {
  const from = lineStart(value, selStart);
  // A selection that ends at the very start of a line doesn't include that line.
  const last = selEnd > selStart && value[selEnd - 1] === '\n' ? selEnd - 1 : selEnd;
  const to = lineEnd(value, last);
  const before = value.slice(from, to).split('\n');
  const after = before.map((l) => (out ? l.replace(/^(\t| {1,2})/, '') : /^-/.test(l) ? `  ${l}` : l));
  const text = after.join('\n');
  if (text === value.slice(from, to)) return undefined;
  const first = after[0].length - before[0].length;
  // A selection that starts at the line's start still does: whole lines stay selected.
  const start = selStart !== selEnd && selStart === from ? from : Math.max(from, selStart + first);
  return { from, to, text, start, end: selStart === selEnd ? start : Math.max(start, selEnd + text.length - (to - from)) };
}

/**
 * Enter on a list line carries the list on: the next line starts with the
 * same indent and dash (and box, after a criterion). On an empty bullet it
 * steps out instead: an indented one loses its indent, a plain one its dash.
 * Undefined means the browser's own Enter is right.
 */
export function continueList(value: string, selStart: number, selEnd: number): Edit | undefined {
  if (selStart !== selEnd) return undefined;
  const from = lineStart(value, selStart);
  const to = lineEnd(value, selStart);
  const line = value.slice(from, to);
  const m = MARKER.exec(line);
  // Not a list line, or the caret is still inside its marker.
  if (!m || selStart - from < m[0].length) return undefined;
  const next = `${isNested(m[1]) ? '  ' : ''}- ${m[2] ? '[ ] ' : ''}`;
  if (!line.slice(m[0].length).trim()) {
    const text = isNested(m[1]) ? next.trimStart() : '';
    return { from, to, text, start: from + text.length, end: from + text.length };
  }
  const at = selStart + 1 + next.length;
  return { from: selStart, to: selStart, text: `\n${next}`, start: at, end: at };
}

/**
 * `- []` and a space make a criterion's box: `- [ ] `. Called once the space
 * is in (phone keyboards don't say which key was pressed, only what was typed).
 */
export function expandCheckbox(value: string, caret: number): Edit | undefined {
  const from = lineStart(value, caret);
  const m = /^([ \t]*)-[ \t]*\[\] $/.exec(value.slice(from, caret));
  if (!m) return undefined;
  const dash = from + m[1].length + 1;
  const at = dash + ' [ ] '.length;
  return { from: dash, to: caret, text: ' [ ] ', start: at, end: at };
}

/**
 * Pasted lists, as other apps write them, in this format's own marks: a
 * bullet (•, *, –, 1.) becomes "- " and a tick box becomes "- [ ] ". Lines that
 * already start with a dash, and everything else, are left as they are.
 */
export function cleanPaste(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const indent = /^[ \t]*/.exec(line)![0];
      const body = line
        .slice(indent.length)
        .replace(/^(?:[•◦▪‣·*–—]|\d+[.)])[ \t]+/, '- ')
        .replace(/^(?:- )?(?:[☐□☑☒✓✔]|\[[ xX]?\])[ \t]+/, '- [ ] ');
      return indent + body;
    })
    .join('\n');
}

/** One thing a link or `after:` could point at. */
export interface Suggestion {
  /** What is typed in for it: an id, or world-id/level-id. */
  insert: string;
  title: string;
  /** True when it is in the project being added to, not in the text. */
  there: boolean;
}

/** The word being typed (`from..to`) and what could go there. */
export interface Completion {
  from: number;
  to: number;
  options: Suggestion[];
  /** A link: picking also closes its bracket. */
  link: boolean;
}

/** Lower-case words joined by hyphens, so "a sk", "A-Sk" and an id compare alike. Empty stays empty. */
const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Options whose title or id contains `query`, the ones that start with it first. */
function matching(options: Suggestion[], query: string): Suggestion[] {
  const q = norm(query);
  if (!q) return options;
  const rank = (o: Suggestion) => {
    const hay = [norm(o.title), norm(o.insert), ...o.insert.split('/')];
    return hay.some((x) => x.startsWith(q)) ? 0 : hay.some((x) => x.includes(q)) ? 1 : 2;
  };
  return options
    .map((o, i) => ({ o, i, r: rank(o) }))
    .filter((x) => x.r < 2)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.o);
}

/**
 * What to suggest at the caret, if it is somewhere a link goes: after
 * `after:` (the other items of the level, the other steps of the dependency,
 * or the other worlds on a world line) or inside `=> [Title](` (every level).
 * `draft` is the text as parsed; `existing` is the project being added to.
 */
export function completionAt(value: string, caret: number, draft: QuestDraft, existing?: GameState): Completion | undefined {
  const start = lineStart(value, caret);
  const before = value.slice(start, caret);
  const rest = value.slice(caret, lineEnd(value, caret));
  const lines = value.slice(0, start).split('\n');
  const lineNo = lines.length - 1;

  // The level the caret's line belongs to: the nearest heading above is a level's.
  let levelLine = -1;
  for (let i = lineNo - 1; i >= 0 && levelLine < 0; i--) {
    if (/^\s*##\s/.test(lines[i])) levelLine = i;
    else if (/^\s*#\s/.test(lines[i])) break;
  }
  const world = draft.worlds.find((w) => w.levels.some((l) => l.line === levelLine));
  const level = world?.levels.find((l) => l.line === levelLine);

  const link = /\]\(([^)]*)$/.exec(before);
  if (link && /^\s*-\s*=>/.test(before)) {
    const mine = world && level ? `${world.id}/${level.id}` : '';
    const options: Suggestion[] = [];
    for (const w of draft.worlds) for (const l of w.levels) options.push({ insert: `${w.id}/${l.id}`, title: `${w.name} › ${l.name}`, there: !!existing?.worlds[w.id]?.levels.some((x) => x.id === l.id) });
    for (const w of Object.values(existing?.worlds ?? {}))
      for (const l of w.levels) if (!options.some((o) => o.insert === `${w.id}/${l.id}`)) options.push({ insert: `${w.id}/${l.id}`, title: `${w.name} › ${l.name}`, there: true });
    return {
      from: caret - link[1].length,
      to: caret + /^[^)]*/.exec(rest)![0].length,
      options: matching(options.filter((o) => o.insert !== mine), link[1]),
      link: true,
    };
  }

  const after = /(?:^|\s)after:(\S*)$/.exec(before);
  if (!after) return undefined;
  const word = after[1].slice(after[1].lastIndexOf(',') + 1);
  const tail = /^[^\s,]*/.exec(rest)![0];
  // What the same after: already lists, either side of the caret.
  const listed = new Set([...after[1].split(',').slice(0, -1), ...rest.slice(tail.length).replace(/\s.*$/, '').split(',')].map(norm).filter(Boolean));
  const done = (options: Suggestion[]): Completion => ({
    from: caret - word.length,
    to: caret + tail.length,
    options: matching(options.filter((o) => !listed.has(o.insert)), word),
    link: false,
  });

  if (/^\s*#\s/.test(before)) {
    const options: Suggestion[] = draft.worlds.filter((w) => w.line !== lineNo).map((w) => ({ insert: w.id, title: w.name, there: !!existing?.worlds[w.id] }));
    for (const w of Object.values(existing?.worlds ?? {})) if (!draft.worlds.some((d) => d.id === w.id)) options.push({ insert: w.id, title: w.name, there: true });
    return done(options);
  }
  if (!level || !/^\s*-/.test(before)) return undefined;

  // An indented line under a dependency is one of its steps, and waits for its other steps.
  const above = level.items.filter((i) => i.line < lineNo).pop();
  const steps = isNested(/^[ \t]*/.exec(before)![0]) && above?.type === 'dependency' && !level.items.some((i) => i.line === lineNo);
  const siblings: DraftItem[] = steps ? above!.steps : level.items;
  const old = steps ? [] : (existing?.worlds[world!.id]?.levels.find((l) => l.id === level.id)?.items ?? []);
  const options: Suggestion[] = siblings.filter((i) => i.line !== lineNo).map((i) => ({ insert: i.id, title: i.title, there: old.some((o) => o.id === i.id) }));
  for (const o of old) if (!siblings.some((i) => i.id === o.id)) options.push({ insert: o.id, title: o.title, there: true });
  return done(options);
}

/** The edit that puts a picked suggestion in place of the word being typed. */
export function pickSuggestion(value: string, c: Completion, option: Suggestion): Edit {
  // A link's bracket is closed, and the caret left after it.
  const closed = c.link && value[c.to] === ')';
  const text = option.insert + (c.link && !closed ? ')' : '');
  const at = c.from + text.length + (closed ? 1 : 0);
  return { from: c.from, to: c.to, text, start: at, end: at };
}
