import type { Criterion, GameState, Item, ItemType, Level, Project, World } from './model';
import { slugify, THEMES, uniqueId } from './model';
import { roundMoney } from './budget';
import { MAX_TIMEBOX_DAYS, type OpBody } from './ops';

/**
 * Quest Markdown: a whole plan typed (or pasted) as text.
 *
 *   # World name after:other-world
 *   ## Level name @7d
 *   > The deliverable, in one sentence
 *   - [ ] MVP success criterion
 *   - [ ] (opt) Optional criterion
 *   - A task £40
 *   - ! Blocker   - ? Decision   - ~ Risk   - * Deliverable   - + Stretch
 *   - Another task after:a-task
 *   - => [Waits on a level](world/level)
 *   - => Something to chase
 *     - A step
 *     - Another step after:a-step
 *   - => Something to wait for
 *
 * parseQuestText never fails: whatever it can't use becomes a message with a
 * line (and, where one word is at fault, a column range), and the rest is kept.
 * planImport turns the draft into ordinary ops. Create only: nothing that
 * already exists is changed.
 */

/** A problem on one source line. `start`/`end` are columns in that line when one word is at fault. */
export interface DraftMessage {
  /** 0-based line in the source. */
  line: number;
  text: string;
  start?: number;
  end?: number;
}

export interface DraftItem {
  line: number;
  id: string;
  type: ItemType;
  title: string;
  /** Ids of siblings this one waits for (dependsOn). */
  after: string[];
  budget?: number;
  /** For a dependency that points at a level: '<world-id>/<level-id>'. */
  levelRef?: string;
  /** For a dependency you chase yourself: its steps (subtasks). */
  steps: DraftItem[];
}

export interface DraftCriterion {
  line: number;
  id: string;
  text: string;
  mvp: boolean;
}

export interface DraftLevel {
  line: number;
  id: string;
  name: string;
  /** Time-box, when the heading gave one. */
  days?: number;
  deliverable?: { line: number; text: string };
  criteria: DraftCriterion[];
  items: DraftItem[];
}

export interface DraftWorld {
  line: number;
  id: string;
  name: string;
  /** Ids of worlds to clear first (unlocksAfter). */
  after: string[];
  levels: DraftLevel[];
}

export interface QuestDraft {
  worlds: DraftWorld[];
  messages: DraftMessage[];
}

/** Time-box a level gets when its heading has no @Nd (the level form's default). */
export const DEFAULT_TIMEBOX_DAYS = 5;

const TITLE_MAX = 120;
const TEXT_MAX = 280;
const MONEY_MAX = 1_000_000_000;
// Schema list limits.
const MAX_LEVELS = 50;
const MAX_CRITERIA = 20;
const MAX_ITEMS = 200;
const MAX_STEPS = 100;

const PREFIXES: Record<string, ItemType> = { '!': 'blocker', '?': 'decision', '~': 'risk', '*': 'deliverable', '+': 'stretch' };

/** A word in the source with where it sits, so a message can point at it. */
interface Token {
  text: string;
  start: number;
  end: number;
}

/** A parsed item before its links and ids are settled. */
interface RawItem extends DraftItem {
  afterTokens: Token[];
  ref?: Token;
}

interface RawWorld extends DraftWorld {
  afterTokens: Token[];
  afterLine: number;
}

/** Strips trailing `after:a,b` and `£12.50` words off `text`, which starts at column `offset` of its line. */
function takeSuffixes(text: string, offset: number) {
  const after: Token[] = [];
  let budget: number | undefined;
  let rest = text.trimEnd();
  for (;;) {
    const m = /(^|\s+)(after:(\S*)|[£$€](\d+(?:\.\d+)?))$/.exec(rest);
    if (!m) break;
    const at = offset + m.index + m[1].length;
    if (m[3] !== undefined) {
      // Each id of a comma list gets its own range.
      let col = at + 'after:'.length;
      const found: Token[] = [];
      for (const part of m[3].split(',')) {
        if (part) found.push({ text: part, start: col, end: col + part.length });
        col += part.length + 1;
      }
      after.unshift(...found);
    } else budget ??= Math.min(MONEY_MAX, roundMoney(Number(m[4])));
    rest = rest.slice(0, m.index).trimEnd();
  }
  return { rest, after, budget };
}

function cut(text: string, max: number, what: string, line: number, say: (line: number, text: string) => void): string {
  if (text.length <= max) return text;
  say(line, `${what} is too long, cut at ${max} characters`);
  return text.slice(0, max).trimEnd();
}

/** "a, b and c" */
function list(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Reads Quest Markdown into a draft tree.
 *
 * Pass `existing` when the plan will be added to a project that is already
 * there. A world, level, item or criterion that matches one of its own, by id
 * or by name, takes that one's id (ids in real data are often shorter than
 * their titles), and links and `after:` may point at what it holds.
 */
export function parseQuestText(src: string, existing?: GameState): QuestDraft {
  const worlds: RawWorld[] = [];
  const messages: DraftMessage[] = [];
  const say = (line: number, text: string, at?: { start: number; end: number }) =>
    messages.push(at ? { line, text, start: at.start, end: at.end } : { line, text });

  /** The thing in `list` that `text` names: by id, or by its name's slug. */
  const named = <T extends { id: string }>(list: T[] | undefined, text: string, name: (t: T) => string): T | undefined => {
    const slug = slugify(text);
    return list?.find((t) => t.id === slug) ?? list?.find((t) => slugify(name(t)) === slug);
  };
  const oldWorlds = Object.values(existing?.worlds ?? {});
  /** The project's own level, for each draft level that matches one. */
  const oldLevel = new Map<DraftLevel, Level>();

  let world: RawWorld | undefined;
  let level: DraftLevel | undefined;
  /** The dependency that indented lines become steps of. */
  let dep: RawItem | undefined;
  /** Lines under a level that was left out are skipped without a message each. */
  let skipping = false;

  src.split(/\r?\n/).forEach((raw, line) => {
    const body = raw.trim();
    if (!body || /^-{3,}$/.test(body)) return;
    const lead = raw.length - raw.trimStart().length;
    const nested = raw.slice(0, lead).replace(/\t/g, '  ').length >= 2;
    /** Column of `rest` (the tail of the line after a marker). */
    const col = (rest: string) => lead + body.length - rest.length;
    let m: RegExpExecArray | null;

    if ((m = /^(#+)\s+(.*)$/.exec(body)) && m[1].length > 2) {
      say(line, 'only "# World" and "## Level" headings are used');
      return;
    }
    if (m && m[1].length === 1) {
      const { rest, after } = takeSuffixes(m[2], col(m[2]));
      const name = cut(rest || 'Untitled world', TITLE_MAX, 'the world name', line, say);
      const id = named(oldWorlds, name, (w) => w.name)?.id ?? slugify(name);
      // The same heading again carries on with that world.
      world = worlds.find((w) => w.id === id);
      if (!world) worlds.push((world = { line, id, name, after: [], afterTokens: [], afterLine: line, levels: [] }));
      if (after.length) {
        world.afterTokens.push(...after);
        world.afterLine = line;
      }
      level = dep = undefined;
      skipping = false;
      return;
    }
    if (m) {
      if (!world) {
        say(line, 'level before any "# World", put under "Unsorted"');
        worlds.push((world = { line, id: 'unsorted', name: 'Unsorted', after: [], afterTokens: [], afterLine: line, levels: [] }));
      }
      dep = undefined;
      const box = /(^|\s)@(\d+)\s*d(?:ays?)?(?=\s|$)/i.exec(m[2]);
      const nameText = (box ? m[2].slice(0, box.index) + m[2].slice(box.index + box[0].length) : m[2]).trim();
      if (world.levels.length >= MAX_LEVELS) {
        say(line, `a world holds at most ${MAX_LEVELS} levels, this one is left out`);
        level = undefined;
        skipping = true;
        return;
      }
      skipping = false;
      const name = cut(nameText || 'Untitled level', TITLE_MAX, 'the level name', line, say);
      const taken = world.levels.map((l) => l.id);
      const olds = existing?.worlds[world.id]?.levels ?? [];
      const old = named(olds, name, (l) => l.name);
      const again = taken.includes(old?.id ?? slugify(name));
      // "world" is the world file's own name.
      const id = old && !again ? old.id : uniqueId(name, ['world', ...taken, ...olds.map((l) => l.id)]);
      if (again) say(line, `second level called "${name}" in this world, saved as ${id}`);
      level = { line, id, name, criteria: [], items: [] };
      if (old && !again) oldLevel.set(level, old);
      if (box) {
        const days = Number(box[2]);
        level.days = Math.max(1, Math.min(MAX_TIMEBOX_DAYS, days));
        if (level.days !== days) {
          const start = col(m[2]) + box.index + box[1].length;
          say(line, `a time-box is 1 to ${MAX_TIMEBOX_DAYS} days, using ${level.days}`, { start, end: start + box[0].length - box[1].length });
        }
      }
      world.levels.push(level);
      return;
    }
    if (skipping) return;
    if (!level) {
      say(line, 'this line is outside a level, add a "## Level" above it');
      return;
    }
    if ((m = /^>\s*(.*)$/.exec(body))) {
      if (!m[1]) return;
      // A quote over several lines is one deliverable.
      const text = level.deliverable ? `${level.deliverable.text} ${m[1]}` : m[1];
      level.deliverable = { line: level.deliverable?.line ?? line, text: cut(text, TEXT_MAX, 'the deliverable', line, say) };
      if (!nested) dep = undefined;
      return;
    }
    if ((m = /^-\s*\[[ xX]?\]\s*(.*)$/.exec(body))) {
      if (nested && dep) say(line, 'success criteria cannot be steps, moved to the level');
      else dep = undefined;
      const mvp = !/^\((?:opt|optional)\)/i.test(m[1]);
      const text = cut(m[1].replace(/^\((?:opt|optional)\)\s*/i, ''), TEXT_MAX, 'the criterion', line, say);
      if (!text) say(line, 'nothing after the box');
      else if (level.criteria.length >= MAX_CRITERIA) say(line, `a level holds at most ${MAX_CRITERIA} criteria, this one is left out`);
      else {
        const taken = level.criteria.map((c) => c.id);
        const olds = oldLevel.get(level)?.successCriteria ?? [];
        const old = named(olds, text, (c) => c.text);
        level.criteria.push({ line, id: old && !taken.includes(old.id) ? old.id : uniqueId(text, [...taken, ...olds.map((c) => c.id)]), text, mvp });
      }
      return;
    }
    if (!(m = /^-\s*(.*)$/.exec(body))) {
      say(line, 'not understood: start worlds with "# ", levels with "## " and items with "- "');
      if (!nested) dep = undefined;
      return;
    }

    let rest = m[1];
    let type: ItemType = 'task';
    let p: RegExpExecArray | null;
    if ((p = /^=>(\s+|$)/.exec(rest))) type = 'dependency';
    else if ((p = /^([!?~*+])\s+/.exec(rest))) type = PREFIXES[p[1]];
    if (p) rest = rest.slice(p[0].length);
    const tail = takeSuffixes(rest, col(rest));
    let title = tail.rest;
    let ref: Token | undefined;
    if (type === 'dependency') {
      const link = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(title);
      if (link) {
        const start = col(rest) + link[0].length - link[2].length - 1;
        title = link[1].trim();
        if (link[2].trim()) ref = { text: link[2].trim(), start, end: start + link[2].length };
      } else if (/^[a-z0-9-]+\/[a-z0-9-]+$/.test(title)) {
        // A bare world/level: the title comes from the level it names.
        ref = { text: title, start: col(rest), end: col(rest) + title.length };
        title = '';
      }
    }
    if (!title && !ref) {
      say(line, 'nothing to add on this line');
      return;
    }
    const item: RawItem = {
      line,
      id: '',
      type,
      title: cut(title, TITLE_MAX, 'the title', line, say),
      after: [],
      afterTokens: tail.after,
      steps: [],
      ...(tail.budget !== undefined ? { budget: tail.budget } : {}),
      ...(ref ? { ref } : {}),
    };
    if (nested && dep) {
      if (type === 'dependency') say(line, 'steps cannot be dependencies themselves, this line is left out');
      else if (dep.steps.length >= MAX_STEPS) say(line, `a dependency holds at most ${MAX_STEPS} steps, this one is left out`);
      else dep.steps.push(item);
      return;
    }
    if (nested) say(line, 'indented, but not under a "=>" dependency: kept as a normal item');
    if (level.items.length >= MAX_ITEMS) {
      say(line, `a level holds at most ${MAX_ITEMS} items, this one is left out`);
      dep = undefined;
      return;
    }
    level.items.push(item);
    dep = type === 'dependency' ? item : undefined;
  });

  // Second pass: links and after: may point forward, so they wait until everything is read.
  const levelNames = new Map<string, string>();
  /** What a link or after: may call a world, and a level within each world: its id, or its name's slug. */
  const worldAlias = new Map<string, string>();
  const levelAlias = new Map<string, Map<string, string>>();
  const alias = (map: Map<string, string>, id: string, name: string) => {
    map.set(id, id);
    if (!map.has(slugify(name))) map.set(slugify(name), id);
  };
  for (const w of [...oldWorlds, ...worlds]) {
    alias(worldAlias, w.id, w.name);
    const levels = levelAlias.get(w.id) ?? new Map<string, string>();
    levelAlias.set(w.id, levels);
    for (const l of w.levels) {
      alias(levels, l.id, l.name);
      levelNames.set(`${w.id}/${l.id}`, l.name);
    }
  }

  /** True when `from` already waits for `to`, directly or through others. */
  const waitsFor = <T extends { id: string; after: string[] }>(all: T[], from: string, to: string, seen = new Set<string>()): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (all.find((x) => x.id === from)?.after ?? []).some((next) => waitsFor(all, next, to, seen));
  };

  /** Settles ids and `after:` for one list of siblings. `known` is the project's copy of the list, if it has one. */
  const settle = (items: RawItem[], known: Pick<Item, 'id' | 'title'>[], where: string) => {
    for (const item of items) {
      const taken = items.filter((i) => i !== item && i.id).map((i) => i.id);
      const old = named(known, item.title, (k) => k.title);
      item.id = old && !taken.includes(old.id) ? old.id : uniqueId(item.title, [...taken, ...known.map((k) => k.id)]);
    }
    const ids = new Set([...known, ...items].map((i) => i.id));
    for (const item of items)
      for (const tok of item.afterTokens) {
        const slug = slugify(tok.text);
        const want = ids.has(slug) ? slug : (named(known, tok.text, (k) => k.title)?.id ?? slug);
        if (want === item.id) say(item.line, 'an item cannot come after itself', tok);
        else if (!ids.has(want)) {
          const others = items.filter((i) => i !== item).map((i) => i.id);
          say(item.line, `after:${tok.text} matches nothing in ${where}${others.length ? `. Ids here: ${others.slice(0, 4).join(', ')}${others.length > 4 ? '…' : ''}` : ''}`, tok);
        } else if (waitsFor(items, want, item.id)) say(item.line, `after:${tok.text} would be a loop: ${want} already waits for ${item.id}`, tok);
        else if (!item.after.includes(want)) item.after.push(want);
      }
  };

  for (const w of worlds) {
    for (const l of w.levels) {
      const here = `${w.id}/${l.id}`;
      for (const item of l.items as RawItem[]) {
        if (!item.ref) continue;
        const parts = item.ref.text.split('/').map((s) => slugify(s.trim()));
        const inWorld = parts.length === 1 ? w.id : (worldAlias.get(parts[0]) ?? parts[0]);
        const called = parts.length === 1 ? parts[0] : parts.slice(1).join('/');
        const full = `${inWorld}/${levelAlias.get(inWorld)?.get(called) ?? called}`;
        const name = levelNames.get(full);
        if (!item.title) item.title = name ?? item.ref.text;
        if (name === undefined) say(item.line, `no level ${full} in this ${existing ? 'project' : 'plan'}: kept as something to wait for`, item.ref);
        else if (full === here) say(item.line, 'a level cannot depend on itself: kept as something to wait for', item.ref);
        else item.levelRef = full;
        if (item.steps.length) {
          say(item.line, `"${item.title}" links to a level, so it cannot also have steps: the steps are left out`);
          item.steps = [];
        }
      }
      settle(l.items as RawItem[], oldLevel.get(l)?.items ?? [], 'this level');
      for (const item of l.items) settle(item.steps as RawItem[], [], 'these steps');

      // What a level can't do without. Not said of a level that is already there: it has its own.
      if (oldLevel.has(l)) continue;
      const missing = [
        l.days === undefined && 'time-box (@7d)',
        !l.deliverable && '"> deliverable" line',
        !l.criteria.length && '"- [ ] success criterion"',
      ].filter((x): x is string => !!x);
      if (missing.length) say(l.line, `no ${list(missing)} yet: defaults will be used`);
      if (l.criteria.length && !l.criteria.some((c) => c.mvp)) {
        say(l.criteria[0].line, 'a level needs one criterion that is not (opt): this one is made a must');
        l.criteria[0].mvp = true;
      }
    }
  }

  for (const w of worlds) {
    if (!w.afterTokens.length) continue;
    if (existing?.worlds[w.id]) {
      say(w.afterLine, `the world "${w.name}" is already there, so after: is left as it is`);
      continue;
    }
    for (const tok of w.afterTokens) {
      const want = worldAlias.get(slugify(tok.text));
      if (want === w.id) say(w.afterLine, 'a world cannot come after itself', tok);
      else if (!want) say(w.afterLine, `after:${tok.text} is not a world in this ${existing ? 'project' : 'plan'}`, tok);
      else if (waitsFor(worlds, want, w.id)) say(w.afterLine, `after:${tok.text} would be a loop: ${want} already waits for ${w.id}`, tok);
      else if (!w.after.includes(want)) w.after.push(want);
    }
  }

  messages.sort((a, b) => a.line - b.line);
  const item = ({ line, id, type, title, after, budget, levelRef, steps }: DraftItem): DraftItem => ({
    line,
    id,
    type,
    title,
    after,
    ...(budget !== undefined ? { budget } : {}),
    ...(levelRef ? { levelRef } : {}),
    steps: steps.map(item),
  });
  return {
    worlds: worlds.map(({ line, id, name, after, levels }) => ({
      line,
      id,
      name,
      after,
      levels: levels.map((l) => ({ ...l, items: l.items.map(item) })),
    })),
    messages,
  };
}

/** What an import will do, for the summary line. */
export interface ImportSummary {
  worlds: number;
  levels: number;
  /** Items and steps. */
  items: number;
  criteria: number;
  /** Items and criteria left out because they are already in the project. */
  skipped: number;
  /** The plan has costs, so the project's cash budgets get turned on. */
  budgetsOn: boolean;
}

export interface ImportTarget {
  projectId: string;
  /** A new project to make first. Leave out to add to the existing project `projectId`. */
  create?: Project;
}

function toItem(d: DraftItem): Item {
  return {
    id: d.id,
    type: d.type,
    title: d.title,
    status: 'todo',
    ...(d.after.length ? { dependsOn: d.after } : {}),
    ...(d.levelRef ? { levelRef: d.levelRef } : {}),
    ...(d.steps.length ? { subtasks: d.steps.map(toItem) as NonNullable<Item['subtasks']> } : {}),
    ...(d.budget !== undefined ? { budget: d.budget } : {}),
  };
}

const toCriterion = (c: DraftCriterion): Criterion => ({ id: c.id, text: c.text, mvp: c.mvp, done: false });

function toLevel(d: DraftLevel): Level {
  const deliverable = d.deliverable?.text ?? d.name;
  return {
    id: d.id,
    name: d.name,
    deliverable,
    timeboxDays: d.days ?? DEFAULT_TIMEBOX_DAYS,
    // A level can't exist without a check: the deliverable itself, until a better one is written.
    successCriteria: d.criteria.length ? d.criteria.map(toCriterion) : [{ id: slugify(deliverable), text: deliverable, mvp: true, done: false }],
    items: d.items.map(toItem),
  };
}

/**
 * The ops that build a draft. With `target.create` they start a new project;
 * without, they add to the project that is there: matching worlds and levels
 * are reused, and items and criteria it already has are skipped.
 */
export function planImport(draft: QuestDraft, target: ImportTarget, existing?: GameState): { ops: OpBody[]; summary: ImportSummary } {
  const { projectId } = target;
  const there = target.create ? undefined : existing;
  const summary: ImportSummary = { worlds: 0, levels: 0, items: 0, criteria: 0, skipped: 0, budgetsOn: false };
  const ops: OpBody[] = [];

  const costed = (i: DraftItem): boolean => i.budget !== undefined || i.steps.some(costed);
  const hasCosts = draft.worlds.some((w) => w.levels.some((l) => l.items.some(costed)));
  const budgets = (target.create ?? there?.overworld)?.budgets;
  summary.budgetsOn = hasCosts && !budgets;
  if (target.create) ops.push({ kind: 'addProject', projectId, project: { ...target.create, ...(summary.budgetsOn ? { budgets: {} } : {}) } });
  else if (summary.budgetsOn) ops.push({ projectId, kind: 'updateProject', patch: { budgets: {} } });

  const goalIds = target.create?.goals.slice(0, 1).map((g) => g.id) ?? [];
  let themeAt = Object.keys(there?.worlds ?? {}).length;
  for (const w of draft.worlds) {
    const world = there?.worlds[w.id];
    if (!world) {
      summary.worlds++;
      const body: World = { id: w.id, name: w.name, theme: THEMES[themeAt++ % THEMES.length], goalIds, ...(w.after.length ? { unlocksAfter: w.after } : {}), levels: [] };
      ops.push({ projectId, kind: 'addWorld', world: body });
    }
    for (const l of w.levels) {
      const level = world?.levels.find((x) => x.id === l.id);
      const count = (i: DraftItem) => 1 + i.steps.length;
      if (!level) {
        summary.levels++;
        summary.criteria += l.criteria.length;
        summary.items += l.items.reduce((n, i) => n + count(i), 0);
        ops.push({ projectId, kind: 'addLevel', worldId: w.id, level: toLevel(l) });
        continue;
      }
      const at = { projectId, worldId: w.id, levelId: l.id };
      for (const c of l.criteria) {
        if (level.successCriteria.some((x) => x.id === c.id)) summary.skipped++;
        else {
          summary.criteria++;
          ops.push({ ...at, kind: 'addCriterion', criterion: toCriterion(c) });
        }
      }
      for (const i of l.items) {
        if (level.items.some((x) => x.id === i.id)) summary.skipped += count(i);
        else {
          summary.items += count(i);
          ops.push({ ...at, kind: 'addItem', item: toItem(i) });
        }
      }
    }
  }
  return { ops, summary };
}
