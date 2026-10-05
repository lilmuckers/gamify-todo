import { levelsOf, type CommitChanges, type Criterion, type HistoryCommit, type Item, type Level, type Workspace } from '@quest/shared';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * A made-up commit history for the demo, which has no repo behind it. It
 * is derived from the example data and never contradicts it:
 * - every done stamp, tick and start gets the commit that recorded it;
 * - a done item was reopened or edited only as often as its level's
 *   `stats.itemEdits` says (that's what the app counts), and polish after
 *   clearing matches `stats.editsAfterClear` (an uncleared level with
 *   polish was cleared once and un-ticked, which is how the app gets there);
 * - time-box extensions add up to `stats.timeboxExtendedDays` and come once
 *   the original box had run out;
 * - dropped items get their drop, and some items arrive after the level
 *   started (which the data doesn't record), always before they're done;
 * - nothing happens after the last moment the data knows about.
 * Each commit carries a real `quest:` message and tiny before/after level
 * snapshots, so the quick history and the deep scan read it exactly as they
 * read a repo. Seeded from ids, so it's the same on every visit.
 */
export function demoCommits(ws: Workspace): CommitChanges[] {
  const out: CommitChanges[] = [];
  const levels = levelsOf(ws);
  const horizon = lastMoment(levels.map((l) => l.level));
  const add = (at: number, message: string, path: string, before: Partial<Level>, after: Partial<Level>) => {
    const date = new Date(Math.min(at, horizon)).toISOString();
    out.push({
      sha: `demo${hash(`${message}${date}${out.length}`).toString(16).padStart(8, '0')}`,
      date,
      message,
      files: [{ path, before: snap(before), after: snap(after) }],
    });
  };

  for (const { level, ref } of levels) {
    if (!level.startedAt) continue;
    const key = `${ref.projectId}/${ref.worldId}/${ref.levelId}`;
    const path = `data/${key}.json`;
    const where = ` (${key})`;
    const r = rand(key);
    const start = Date.parse(level.startedAt);
    const clear = level.clearedAt ? Date.parse(level.clearedAt) : undefined;
    // Pre-clear history happens before the clear, or before the data ends.
    const end = clear ?? horizon;
    const base = { startedAt: level.startedAt, timeboxDays: level.timeboxDays };
    const open: Criterion = { id: 'open', text: 'open', mvp: true, done: false };
    const status = (subject: string, s: string) => `quest: ${s}: ${subject}${where}`;
    const between = (a: number, b: number, lo: number, hi: number) => a + (b - a) * (lo + r() * (hi - lo));

    add(start + 5_000, `quest: start level${where}`, path, { timeboxDays: level.timeboxDays }, base);

    const edits = level.stats?.itemEdits ?? {};
    for (const [index, { item, subject, parent }] of flat(level).entries()) {
      // Just the item a commit touched (a step inside its dependency, so it reads as one).
      const one = (patch: Partial<Item>): Item[] => {
        const self = { id: item.id, type: item.type, title: item.title, status: 'todo', ...patch } as Item;
        return parent ? [{ id: parent.id, type: parent.type, title: parent.title, status: 'todo', subtasks: [self as NonNullable<Item['subtasks']>[number]] } as Item] : [self];
      };
      const commit = (at: number, message: string, from: Partial<Item>, to: Partial<Item>) =>
        add(at, message, path, { ...base, items: one(from) }, { ...base, items: one(to) });
      const stamp = item.status === 'done' && item.doneAt ? Date.parse(item.doneAt) : undefined;
      const times = edits[parent ? `${parent.id}/${item.id}` : item.id] ?? 0;
      // When this item's own story starts: its first finish, or the level's end.
      let first = stamp ?? end;

      if (times > 0 && stamp !== undefined) {
        // Done, reopened, done again (the stamp); any further counted edits came while done.
        const early = between(start, stamp, 0.25, 0.5);
        const back = between(early, stamp, 0.2, 0.5);
        const at = new Date(early).toISOString();
        commit(early + 5_000, status(subject, 'done'), { status: 'doing' }, { status: 'done', doneAt: at });
        commit(back, status(subject, 'doing'), { status: 'done', doneAt: at }, { status: 'doing' });
        for (let n = 1; n < times; n++) {
          const t = stamp + ((end - stamp) * n) / times;
          commit(Math.min(t, end - 60_000), `quest: edit ${subject}${where}`, { status: 'done', doneAt: item.doneAt, notes: `v${n}` }, { status: 'done', doneAt: item.doneAt, notes: `v${n + 1}` });
        }
        first = early;
      } else if (times > 0) {
        // Not done now: each counted edit was a finish that got reopened.
        for (let n = 0; n < times; n++) {
          const done = between(start, end, (n + 0.15) / (times + 0.5), (n + 0.4) / (times + 0.5));
          const at = new Date(done).toISOString();
          commit(done, status(subject, 'done'), { status: 'doing' }, { status: 'done', doneAt: at });
          commit(done + (1 + r() * 20) * HOUR, status(subject, item.status === 'doing' ? 'doing' : 'todo'), { status: 'done', doneAt: at }, { status: item.status === 'doing' ? 'doing' : 'todo' });
          if (n === 0) first = done;
        }
      }

      // Scope added after the start (not recorded in the data): about one item in six, before its first finish.
      if (!parent && index > 2 && r() < 0.17 && first - start > DAY) {
        const at = between(start, first, 0.15, 0.6);
        add(at, `quest: add ${item.type} "${item.title}"${where}`, path, { ...base, items: [] }, { ...base, items: one({}) });
      }
      if (stamp !== undefined) commit(stamp + 5_000, status(subject, 'done'), { status: 'doing' }, { status: 'done', doneAt: item.doneAt });
      if (item.status === 'dropped') commit(between(start, end, 0.6, 0.95), status(subject, 'dropped'), {}, { status: 'dropped' });
    }

    // Ticks: the last MVP tick is the one that clears the level.
    const ticked = level.successCriteria.filter((c) => c.done && c.doneAt);
    const lastMvp = ticked.filter((c) => c.mvp).sort((a, b) => a.doneAt!.localeCompare(b.doneAt!)).at(-1);
    for (const c of ticked) {
      const clears = c === lastMvp && clear !== undefined;
      const before = clears ? [{ ...c, done: false }] : [{ ...c, done: false }, open];
      const after = clears ? [{ ...c, done: true, doneAt: c.doneAt }] : [{ ...c, done: true, doneAt: c.doneAt }, open];
      add(Date.parse(c.doneAt!) + 5_000, `quest: tick criterion ${c.id}${where}`, path, { ...base, successCriteria: before }, { ...base, successCriteria: after, ...(clears ? { clearedAt: level.clearedAt } : {}) });
    }

    // Time-box extensions, once the original box had run out.
    const extended = level.stats?.timeboxExtendedDays ?? 0;
    if (extended) {
      const deadline = start + (level.timeboxDays - extended) * DAY;
      const at = Math.min(deadline + (0.1 + r() * 0.5) * DAY, end - HOUR);
      add(at, `quest: extend time-box by ${extended} day${extended === 1 ? '' : 's'}${where}`, path, { ...base, timeboxDays: level.timeboxDays - extended }, base);
    }

    // Polish after clearing.
    const polish = level.stats?.editsAfterClear ?? 0;
    const allMvp = level.successCriteria.filter((c) => c.mvp);
    if (polish && clear !== undefined) {
      const victim = level.items.find((i) => i.status === 'done') ?? level.items[0];
      const cleared = allMvp.map((c) => ({ ...c, done: true }));
      for (let n = 0; n < polish; n++) {
        const at = clear + ((horizon - clear) * (n + 0.5)) / (polish + 1);
        const items = (v: number) => [{ id: victim.id, type: victim.type, title: victim.title, status: victim.status, notes: `v${v}` } as Item];
        add(at, `quest: edit ${victim.title}${where}`, path, { ...base, successCriteria: cleared, items: items(n) }, { ...base, successCriteria: cleared, items: items(n + 1) });
      }
    } else if (polish && allMvp.length) {
      // Not cleared now, but polished after a clear: it was cleared once, then un-ticked.
      const undone = allMvp.filter((c) => !c.done);
      const state = (off: Criterion[]) => allMvp.map((c) => (off.includes(c) ? { ...c, done: false } : { ...c, done: true, doneAt: c.doneAt ?? new Date(start).toISOString() }));
      const t = between(start, end, 0.45, 0.6);
      add(t, `quest: ${undone.length} updates\n\n${undone.map((c) => `- tick criterion ${c.id}${where}`).join('\n')}`, path, { ...base, successCriteria: state(undone) }, { ...base, successCriteria: state([]) });
      // The first un-tick (and any edits before it) counted as polish; later un-ticks didn't.
      for (let n = 1; n < polish; n++) {
        const at = t + n * HOUR;
        add(at, `quest: edit ${level.name}${where}`, path, { ...base, successCriteria: state([]), items: [{ id: 'note', type: 'task', title: 'Note', status: 'todo', notes: `v${n}` }] }, { ...base, successCriteria: state([]), items: [{ id: 'note', type: 'task', title: 'Note', status: 'todo', notes: `v${n + 1}` }] });
      }
      undone.forEach((c, i) => {
        const off = undone.slice(0, i);
        add(t + (polish + i) * HOUR + DAY, `quest: untick criterion ${c.id}${where}`, path, { ...base, successCriteria: state(off) }, { ...base, successCriteria: state([...off, c]) });
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The demo's commits as the quick history reads them, newest first, like `git log`. */
export function demoHistory(ws: Workspace): HistoryCommit[] {
  return demoCommits(ws)
    .map(({ files: _, ...c }) => c)
    .reverse();
}

/** Items and dependency steps, with the dependency a step sits in. */
function flat(level: Level): { item: Item; subject: string; parent?: Item }[] {
  return level.items.flatMap((item) => [
    { item, subject: item.title },
    ...(item.subtasks ?? []).map((step) => ({ item: step as Item, subject: `${step.title} (in ${item.title})`, parent: item })),
  ]);
}

/** The last moment the data knows about: its newest start, clear or done stamp. */
function lastMoment(levels: Level[]): number {
  let last = 0;
  const see = (at?: string) => {
    const t = at ? Date.parse(at) : NaN;
    if (!Number.isNaN(t) && t > last) last = t;
  };
  for (const l of levels) {
    see(l.startedAt);
    see(l.clearedAt);
    for (const c of l.successCriteria) see(c.doneAt);
    for (const { item } of flat(l)) see(item.doneAt);
  }
  return last;
}

/** A level file cut down to what a commit changed. */
function snap(l: Partial<Level>): string {
  return JSON.stringify({ items: [], successCriteria: [], ...l });
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A small seeded random number generator (mulberry32). */
function rand(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
