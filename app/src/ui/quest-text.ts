import {
  parseQuestText,
  planImport,
  slugify,
  uniqueId,
  DEFAULT_TIMEBOX_DAYS,
  type DraftItem,
  type DraftMessage,
  type GameState,
  type ImportSummary,
  type QuestDraft,
} from '@quest/shared';
import type { App } from '../app';
import { h, icon, mount } from './dom';
import { TYPE_INFO } from './forms';
import { cleanPaste, completionAt, continueList, expandCheckbox, indentLines, pickSuggestion, type Completion, type Edit } from './quest-keys';

const PLACEHOLDER = `# World name
## Level name @7d
> What exists when this level is done
- [ ] How you know it is good enough
- A task
- ! A blocker
- => Something to chase
  - A step`;

const HELP = `# World                      a theme or phase        # World after:other-world
## Level @7d                 one deliverable, with its time-box in days
> One sentence               the deliverable
- [ ] Check                  a success criterion     - [ ] (opt) a nice-to-have one
- Task                       - ! Blocker   - ? Decision   - ~ Risk   - * Deliverable   - + Stretch
- Task after:other-task      waits for another item in the level (its title, in-kebab-case)
- Task £40                   a cost, at the end of the line
- => [Title](world/level)    waits on another level
- => Title                   something to wait for; indent lines under it for the steps to chase it
  - A step

Enter carries a list on, and steps out of it on an empty line. Tab and Shift+Tab move a line in and out.
"- []" then a space makes a criterion. After "after:" or "](", pick what to link to from the list.`;

/** What was typed, kept over a closed modal (Esc, a stray click) until a project is made from it. */
let kept = '';

export interface QuestTextEditor {
  el: HTMLElement;
  /** Re-reads the title and the text. Call when the title or the budgets tick changes. */
  refresh(): void;
  /** The parsed text. */
  draft(): QuestDraft;
  /** The existing project the plan is to be added to, when its box is ticked. */
  mergeInto(): { projectId: string; state: GameState } | undefined;
  /** Shows a line in place of the summary (the "create anyway?" question). */
  ask(text: string): void;
  /** Forgets the kept text, once it has become a project. */
  clear(): void;
}

interface EditorOptions {
  title: () => string;
  /** True when the new project will track cash budgets anyway. */
  budgets: () => boolean;
  /** The text changed (so any pending question is off). */
  onEdit: () => void;
}

/**
 * The Quest Markdown tab of the New project form: source on the left with
 * line numbers and the faults marked, the parsed tree on the right, the two
 * scrolling together.
 */
export function questTextEditor(app: App, opts: EditorOptions): QuestTextEditor {
  const source = h('textarea', {
    class: 'qt-text',
    wrap: 'off',
    spellcheck: false,
    autocapitalize: 'off',
    'aria-label': 'Quest Markdown',
    placeholder: PLACEHOLDER,
  });
  source.value = kept;
  const gutter = h('div', { class: 'qt-gutter', 'aria-hidden': 'true' });
  const marks = h('pre', { class: 'qt-marks', 'aria-hidden': 'true' });
  const suggest = h('div', { class: 'qt-suggest', role: 'listbox', 'aria-label': 'Link to', hidden: true });
  const tree = h('div', { class: 'qt-tree', 'aria-label': 'What will be created' });
  const target = h('div', { class: 'qt-target' });
  const summary = h('div', { class: 'qt-summary', role: 'status' });
  const merge = h('input', { type: 'checkbox' });
  const el = h(
    'div',
    { class: 'qt' },
    target,
    h('div', { class: 'qt-split' }, h('div', { class: 'qt-source' }, gutter, h('div', { class: 'qt-stack' }, marks, source, suggest)), tree),
    summary,
    h('details', { class: 'qt-help' }, h('summary', null, 'Format help'), h('pre', null, HELP)),
  );

  let draft: QuestDraft = { worlds: [], messages: [] };
  let into: { projectId: string; state: GameState } | undefined;

  const lines = () => source.value.split('\n');
  /** Where a message points in its line: the word at fault, or all of the line's text. */
  const range = (m: DraftMessage, raw: string): [number, number] =>
    m.start !== undefined && m.end !== undefined ? [m.start, m.end] : [raw.length - raw.trimStart().length, raw.trimEnd().length];

  function paintSource() {
    const by = new Map<number, DraftMessage[]>();
    for (const m of draft.messages) by.set(m.line, [...(by.get(m.line) ?? []), m]);
    const src = lines();
    mount(
      gutter,
      src.map((_, i) => h('div', { class: by.has(i) ? 'bad' : '' }, i + 1)),
    );
    mount(
      marks,
      h(
        'div',
        { class: 'qt-marks-in' },
        src.map((raw, i) => {
          const msgs = by.get(i);
          if (!msgs) return h('div', null, raw || ' ');
          const parts: (string | HTMLElement)[] = [];
          let pos = 0;
          for (const [a, b] of msgs.map((m) => range(m, raw)).sort((x, y) => x[0] - y[0])) {
            if (b <= pos) continue;
            const from = Math.max(a, pos);
            parts.push(raw.slice(pos, from), h('mark', null, raw.slice(from, b)));
            pos = b;
          }
          return h('div', { class: 'bad' }, parts, raw.slice(pos) || ' ');
        }),
      ),
    );
    follow();
  }

  function paintTree(existing: GameState | undefined) {
    const rows: { line: number; el: HTMLElement }[] = [];
    const row = (line: number, depth: number, ...children: (Node | string | false | null | undefined)[]) =>
      rows.push({ line, el: h('div', { class: `qt-row d${depth}`, dataset: { line: String(line) } }, ...children) });
    const note = (text: string) => h('small', { class: 'muted' }, text);
    const there = (text: string) => h('small', { class: 'qt-there' }, text);
    for (const w of draft.worlds) {
      const world = existing?.worlds[w.id];
      row(w.line, 0, h('span', { class: 'tag hero' }, 'World'), h('b', null, w.name), w.after.length > 0 && note(`locked until ${w.after.join(', ')}`), world && there('already there, adding to it'));
      for (const l of w.levels) {
        const level = world?.levels.find((x) => x.id === l.id);
        row(l.line, 1, h('span', { class: 'tag' }, 'Level'), h('span', null, l.name), !level && note(`⏱ ${l.days ?? DEFAULT_TIMEBOX_DAYS}d`), level && there('already there, adding to it'));
        if (l.deliverable && !level) row(l.deliverable.line, 2, note(`Deliverable: ${l.deliverable.text}`));
        for (const c of l.criteria)
          row(c.line, 2, h('span', { class: `tag${c.mvp ? ' mvp' : ''}` }, c.mvp ? 'MVP' : 'Optional'), h('span', null, c.text), level?.successCriteria.some((x) => x.id === c.id) && there('already there, skipped'));
        const item = (i: DraftItem, depth: number, skipped: boolean) => {
          const kind = i.type !== 'dependency' ? null : i.levelRef ? `☁ to ${i.levelRef}` : i.steps.length ? `pipe, ${i.steps.length} step${i.steps.length === 1 ? '' : 's'}` : 'waiting on it';
          row(
            i.line,
            depth,
            icon(TYPE_INFO[i.type].sprite, 'grass', 'icon sm'),
            h('span', null, i.title),
            kind && note(kind),
            i.after.length > 0 && note(`after ${i.after.join(', ')}`),
            i.budget !== undefined && note(`💰 ${i.budget}`),
            skipped && depth === 2 && there('already there, skipped'),
          );
          for (const s of i.steps) item(s, 3, skipped);
        };
        for (const i of l.items) item(i, 2, !!level?.items.some((x) => x.id === i.id));
      }
    }
    for (const m of draft.messages)
      rows.push({
        // Just under the row for its line.
        line: m.line + 0.5,
        el: h('div', { class: 'qt-msg', dataset: { line: String(m.line), ...(m.start !== undefined ? { start: String(m.start), end: String(m.end) } : {}) } }, `Line ${m.line + 1}: ${m.text}`),
      });
    rows.sort((a, b) => a.line - b.line);
    mount(
      tree,
      rows.length ? rows.map((r) => r.el) : h('p', { class: 'muted' }, 'Type or paste a plan on the left. This side shows what it will create, as you type.'),
      // Room for the last row to reach the top, so both sides can scroll all the way.
      rows.length > 0 && h('div', { class: 'qt-tail' }),
    );
  }

  function paintSummary(s: ImportSummary, projectId: string) {
    const n = draft.messages.length;
    const count = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
    const parts: (string | HTMLElement)[] = [`${into ? 'Adds to' : 'Creates'} data/${projectId}/`];
    if (draft.worlds.length) parts.push([count(s.worlds, 'world'), count(s.levels, 'level'), count(s.items, 'item'), s.criteria === 1 ? '1 criterion' : `${s.criteria} criteria`].join(', '));
    if (s.skipped) parts.push(`${s.skipped} already there, skipped`);
    if (s.budgetsOn) parts.push('cash budgets turned on');
    if (n) parts.push(h('b', { class: 'qt-count' }, `${count(n, 'line')} to check`));
    mount(
      summary,
      parts.flatMap((part, i) => (i ? [' · ', part] : [part])),
    );
  }

  function refresh() {
    kept = source.value;
    const title = opts.title().trim();
    // Ids in real data are often shorter than their titles: a project is "already there" by either.
    const slug = slugify(title || 'project');
    const projects = Object.values(app.workspace?.projects ?? {});
    const exists = title ? (projects.find((p) => p.overworld.id === slug) ?? projects.find((p) => slugify(p.overworld.title) === slug)) : undefined;
    into = exists && merge.checked ? { projectId: exists.overworld.id, state: exists } : undefined;
    const projectId = into?.projectId ?? uniqueId(title || 'project', Object.keys(app.workspace?.projects ?? {}));
    mount(
      target,
      exists
        ? [
            h('span', null, 'A project called ', h('b', null, exists.overworld.title), ' is already there.'),
            h('label', { class: 'check' }, merge, 'Add to that project'),
            h('span', { class: 'muted' }, into ? 'Its worlds and levels are reused. Nothing in it is changed, and the details tab is not used.' : `A new one is made beside it: ${projectId}.`),
          ]
        : h('span', { class: 'muted' }, 'One line per world, level and item. The right side shows what it makes, as you type.'),
    );
    draft = parseQuestText(source.value, into?.state);
    const plan = planImport(
      draft,
      into ? { projectId } : { projectId, create: { id: projectId, title, goals: [], worldOrder: [], ...(opts.budgets() ? { budgets: {} } : {}) } },
      into?.state,
    );
    paintSource();
    paintTree(into?.state);
    paintSummary(plan.summary, projectId);
  }

  // --- Scrolling: the gutter and marks follow the text; the tree and the text follow each other.
  const metrics = () => {
    const cs = getComputedStyle(source);
    return { line: parseFloat(cs.lineHeight) || 20, pad: parseFloat(cs.paddingTop) || 0 };
  };
  function follow() {
    marks.scrollTop = gutter.scrollTop = source.scrollTop;
    marks.scrollLeft = source.scrollLeft;
  }
  /** Rows are measured from the tree's own top (it is their offset parent). */
  const treePad = () => parseFloat(getComputedStyle(tree).paddingTop) || 0;
  const rowsOf = () => [...tree.querySelectorAll<HTMLElement>('.qt-row')];
  /** The side being driven ignores its own scroll events for a moment, so the two don't chase each other. */
  let driven: 'text' | 'tree' | undefined;
  let release: ReturnType<typeof setTimeout> | undefined;
  const drive = (side: 'text' | 'tree') => {
    driven = side;
    clearTimeout(release);
    release = setTimeout(() => (driven = undefined), 80);
  };
  source.addEventListener('scroll', () => {
    follow();
    if (driven === 'text') return;
    drive('tree');
    const top = source.scrollTop / metrics().line;
    let prev: HTMLElement | undefined;
    let next: HTMLElement | undefined;
    for (const r of rowsOf()) {
      if (Number(r.dataset.line) <= top) prev = r;
      else {
        next = r;
        break;
      }
    }
    if (!prev) {
      tree.scrollTop = 0;
      return;
    }
    // Part-way between two rows in the text is part-way between them in the tree.
    const from = Number(prev.dataset.line);
    const part = next ? Math.min(1, (top - from) / (Number(next.dataset.line) - from)) : 0;
    tree.scrollTop = prev.offsetTop - treePad() + part * ((next?.offsetTop ?? prev.offsetTop) - prev.offsetTop);
  });
  tree.addEventListener('scroll', () => {
    if (driven === 'tree') return;
    drive('text');
    const y = tree.scrollTop + treePad();
    let prev: HTMLElement | undefined;
    let next: HTMLElement | undefined;
    for (const r of rowsOf()) {
      if (r.offsetTop <= y) prev = r;
      else {
        next = r;
        break;
      }
    }
    if (!prev) {
      source.scrollTop = 0;
      return;
    }
    const from = Number(prev.dataset.line);
    const part = next ? (y - prev.offsetTop) / (next.offsetTop - prev.offsetTop) : 0;
    source.scrollTop = (from + part * (next ? Number(next.dataset.line) - from : 0)) * metrics().line;
  });

  // A row selects its line; a message selects the word at fault.
  tree.addEventListener('click', (e) => {
    const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-line]');
    if (!hit) return;
    const src = lines();
    const i = Number(hit.dataset.line);
    const start = src.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
    const [a, b] = hit.dataset.start !== undefined ? [Number(hit.dataset.start), Number(hit.dataset.end)] : [0, src[i]?.length ?? 0];
    source.focus();
    source.setSelectionRange(start + a, start + b);
    const { line, pad } = metrics();
    // Bring the line into view if it is off either end.
    if (i * line < source.scrollTop || (i + 1) * line + pad > source.scrollTop + source.clientHeight) source.scrollTop = Math.max(0, (i - 2) * line);
  });

  // --- Suggestions: what an after: or a link could point at, in a list at the caret.
  let offered: { c: Completion; index: number } | undefined;
  /** Where the list was closed by hand (Esc, or a pick): it stays shut until the text changes. */
  let shut: string | undefined;
  /** Width of one character: the font is monospace and the text doesn't wrap. */
  const charWidth = () => {
    const cs = getComputedStyle(source);
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return parseFloat(cs.fontSize) * 0.6;
    ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
    return ctx.measureText('0'.repeat(20)).width / 20;
  };
  function closeSuggest() {
    offered = undefined;
    suggest.hidden = true;
  }
  function paintSuggest() {
    if (!offered) return;
    const { c, index } = offered;
    mount(
      suggest,
      c.options.length
        ? c.options.map((o, i) =>
            h(
              'div',
              {
                class: `qt-option${i === index ? ' on' : ''}`,
                role: 'option',
                'aria-selected': String(i === index),
                // The text keeps the keyboard: a press picks without taking focus.
                onmousedown: (e: Event) => {
                  e.preventDefault();
                  pick(i);
                },
              },
              h('span', null, o.title),
              h('small', { class: 'muted' }, o.insert),
              o.there && h('small', { class: 'qt-there' }, 'already there'),
            ),
          )
        : h('div', { class: 'qt-option muted' }, 'Nothing matches'),
    );
    suggest.hidden = false;
    suggest.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    // Under the word being typed; above it when there is no room below.
    const { line, pad } = metrics();
    const upTo = source.value.slice(0, c.from);
    const row = upTo.split('\n').length - 1;
    const col = upTo.slice(upTo.lastIndexOf('\n') + 1).replace(/\t/g, '  ').length;
    const stack = suggest.parentElement!;
    const top = pad + (row + 1) * line - source.scrollTop;
    if (top - line < 0 || top - line > stack.clientHeight) return closeSuggest();
    const x = pad + col * charWidth() - source.scrollLeft;
    suggest.style.left = `${Math.max(0, Math.min(x, stack.clientWidth - suggest.offsetWidth))}px`;
    suggest.style.top = `${top + suggest.offsetHeight > stack.clientHeight && top - line - suggest.offsetHeight >= 0 ? top - line - suggest.offsetHeight : top}px`;
  }
  function updateSuggest() {
    const caret = source.selectionStart;
    const c = document.activeElement === source && caret === source.selectionEnd && shut !== source.value ? completionAt(source.value, caret, draft, into?.state) : undefined;
    if (!c) return closeSuggest();
    // The same list keeps its place; a new one starts at the top.
    const same = offered && offered.c.from === c.from && offered.c.options.length === c.options.length;
    offered = { c, index: same ? offered!.index : 0 };
    paintSuggest();
  }
  function pick(i: number) {
    if (!offered) return;
    const edit = pickSuggestion(source.value, offered.c, offered.c.options[i]);
    closeSuggest();
    apply(edit);
    shut = source.value;
    closeSuggest();
  }

  /** Makes an edit the way typing would, so the browser's own undo steps back through it. */
  function apply(edit: Edit) {
    source.focus();
    source.setSelectionRange(edit.from, edit.to);
    const typed = edit.text ? document.execCommand('insertText', false, edit.text) : edit.from === edit.to || document.execCommand('delete');
    if (!typed) {
      source.setRangeText(edit.text, edit.from, edit.to, 'end');
      opts.onEdit();
      refresh();
    }
    source.setSelectionRange(edit.start, edit.end);
    updateSuggest();
  }

  source.addEventListener('input', (e) => {
    opts.onEdit();
    refresh();
    const box = (e as InputEvent).data === ' ' && source.selectionStart === source.selectionEnd ? expandCheckbox(source.value, source.selectionStart) : undefined;
    if (box) apply(box);
    else updateSuggest();
  });
  source.addEventListener('keydown', (e) => {
    if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    if (offered) {
      const n = offered.c.options.length;
      if (e.key === 'Escape') {
        // Only the list closes: the form's own Esc never hears this one.
        e.preventDefault();
        e.stopPropagation();
        shut = source.value;
        return closeSuggest();
      }
      if (n && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        offered.index = (offered.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        return paintSuggest();
      }
      if (n && !e.shiftKey && (e.key === 'Enter' || e.key === 'Tab')) {
        e.preventDefault();
        return pick(offered.index);
      }
    }
    const { value, selectionStart: start, selectionEnd: end } = source;
    // Tab never leaves the text (steps need it); Esc closes the form, and the text is kept.
    if (e.key === 'Tab') e.preventDefault();
    const edit =
      e.key === 'Tab' ? indentLines(value, start, end, e.shiftKey) : e.key === 'Enter' && !e.shiftKey ? continueList(value, start, end) : undefined;
    if (!edit) return;
    e.preventDefault();
    apply(edit);
  });
  // Lists pasted from elsewhere come in with this format's own bullets and boxes.
  source.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (!text || cleanPaste(text) === text) return;
    e.preventDefault();
    const clean = cleanPaste(text);
    const at = source.selectionStart + clean.length;
    apply({ from: source.selectionStart, to: source.selectionEnd, text: clean, start: at, end: at });
  });
  // The caret moved without typing (arrows, Home, a click): the list follows or goes.
  source.addEventListener('keyup', (e) => {
    if (!['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) updateSuggest();
  });
  source.addEventListener('click', updateSuggest);
  source.addEventListener('scroll', () => offered && paintSuggest());
  source.addEventListener('blur', closeSuggest);
  merge.addEventListener('change', () => {
    opts.onEdit();
    refresh();
  });

  refresh();
  return {
    el,
    refresh,
    draft: () => draft,
    mergeInto: () => into,
    ask: (text) => mount(summary, h('b', { class: 'qt-count' }, text)),
    clear: () => {
      kept = '';
    },
  };
}
