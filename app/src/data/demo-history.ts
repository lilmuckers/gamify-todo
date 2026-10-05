import { isMvpItem, levelsOf, type CommitChanges, type Criterion, type HistoryCommit, type Item, type Level, type ScanProgress, type Workspace } from '@quest/shared';

/**
 * A made-up commit history for the demo, which has no repo behind it. It is
 * built from the example data itself: every done stamp gets the commit that
 * would have recorded it, and around them it adds the kind of thing only a
 * history shows: work done and then reopened, scope added after a level
 * started, cuts, time-box extensions and polish after clearing. Each commit
 * carries a real `quest:` message and tiny before/after level snapshots, so
 * the quick history and the deep scan read it exactly as they read a repo.
 * Seeded from ids, so it's the same on every visit.
 */
export function demoCommits(ws: Workspace): CommitChanges[] {
  const out: CommitChanges[] = [];
  const add = (at: number, message: string, path: string, before: Partial<Level>, after: Partial<Level>) => {
    const date = new Date(at).toISOString();
    out.push({
      sha: `demo${hash(`${message}${date}`).toString(16).padStart(8, '0')}${out.length.toString(16)}`,
      date,
      message,
      files: [{ path, before: snap(before), after: snap(after) }],
    });
  };

  for (const { level, ref } of levelsOf(ws)) {
    const key = `${ref.projectId}/${ref.worldId}/${ref.levelId}`;
    const path = `data/${key}.json`;
    const where = ` (${key})`;
    const start = level.startedAt ? Date.parse(level.startedAt) : undefined;
    const end = level.clearedAt ? Date.parse(level.clearedAt) : undefined;
    const span = start !== undefined ? Math.max(3_600_000, (end ?? Date.parse(latestStamp(level) ?? level.startedAt!)) - start) : 0;
    const base = { startedAt: level.startedAt, timeboxDays: level.timeboxDays };
    const open: Criterion = { id: 'open', text: 'open', mvp: true, done: false };
    const clearedCrit: Criterion = { id: 'done', text: 'done', mvp: true, done: true };

    if (start !== undefined) add(start + 5_000, `quest: start level${where}`, path, { timeboxDays: level.timeboxDays }, base);

    const items: { item: Item; subject: string; parent?: Item }[] = [];
    for (const item of level.items) {
      items.push({ item, subject: item.title });
      for (const step of item.subtasks ?? []) items.push({ item: step as Item, subject: `${step.title} (in ${item.title})`, parent: item });
    }
    // Just the item a commit touched (a step inside its dependency, so it reads as one).
    const one = (it: Item, patch: Partial<Item>, parent?: Item): Item[] => {
      const self = { id: it.id, type: it.type, title: it.title, status: 'todo', ...patch } as Item;
      return parent ? [{ id: parent.id, type: parent.type, title: parent.title, status: 'todo', subtasks: [self as NonNullable<Item['subtasks']>[number]] } as Item] : [self];
    };
    const status = (subject: string, s: string) => `quest: ${s}: ${subject}${where}`;

    for (const [i, { item, subject, parent }] of items.entries()) {
      const r = rand(`${key}/${item.id}/${i}`);
      // Scope added mid-level: about one item in six, never the first few.
      if (start !== undefined && !parent && i > 2 && r() < 0.17) {
        const at = start + span * (0.15 + r() * 0.35);
        add(at, `quest: add ${item.type} "${item.title}"${where}`, path, { ...base, items: [] }, { ...base, items: one(item, {}) });
      }
      if (item.status === 'done' && item.doneAt) {
        const stamp = Date.parse(item.doneAt);
        // Done, then reopened before the final finish: about one in sixteen.
        if (start !== undefined && r() < 0.065 && stamp - start > 2 * 86_400_000) {
          const first = start + (stamp - start) * (0.2 + r() * 0.4);
          const back = first + (stamp - first) * (0.2 + r() * 0.5);
          const firstAt = new Date(first).toISOString();
          add(first + 5_000, status(subject, 'done'), path, { ...base, items: one(item, {}, parent) }, { ...base, items: one(item, { status: 'done', doneAt: firstAt }, parent) });
          add(back, status(subject, 'doing'), path, { ...base, items: one(item, { status: 'done', doneAt: firstAt }, parent) }, { ...base, items: one(item, { status: 'doing' }, parent) });
        }
        add(stamp + 5_000, status(subject, 'done'), path, { ...base, items: one(item, { status: 'doing' }, parent) }, { ...base, items: one(item, { status: 'done', doneAt: item.doneAt }, parent) });
      }
      if (item.status === 'dropped' && start !== undefined) {
        const at = start + span * (0.55 + r() * 0.4);
        add(at, status(subject, 'dropped'), path, { ...base, items: one(item, {}, parent) }, { ...base, items: one(item, { status: 'dropped' }, parent) });
      }
    }

    // Ticks: the last MVP tick is the one that clears the level.
    const mvps = level.successCriteria.filter((c) => c.mvp && c.done && c.doneAt);
    const lastMvp = mvps.sort((a, b) => a.doneAt!.localeCompare(b.doneAt!)).at(-1);
    for (const c of level.successCriteria) {
      if (!c.done || !c.doneAt) continue;
      const clears = c === lastMvp && !!end;
      const before = clears ? [{ ...c, done: false }] : [{ ...c, done: false }, open];
      const after = clears ? [{ ...c, done: true, doneAt: c.doneAt }] : [{ ...c, done: true, doneAt: c.doneAt }, open];
      add(Date.parse(c.doneAt) + 5_000, `quest: tick criterion ${c.id}${where}`, path, { ...base, successCriteria: before }, { ...base, successCriteria: after, ...(clears ? { clearedAt: level.clearedAt } : {}) });
    }

    // On the record: time-box extensions and polish after clearing.
    const extended = level.stats?.timeboxExtendedDays ?? 0;
    if (extended && start !== undefined) {
      const at = start + (level.timeboxDays - extended) * 86_400_000 * 0.95;
      add(at, `quest: extend time-box by ${extended} day${extended === 1 ? '' : 's'}${where}`, path, { ...base, timeboxDays: level.timeboxDays - extended }, base);
    }
    const polish = level.stats?.editsAfterClear ?? 0;
    const victim = level.items.find((i) => isMvpItem(i) && i.status === 'done') ?? level.items[0];
    if (polish && end !== undefined && victim) {
      const r = rand(`${key}/polish`);
      for (let n = 0; n < polish; n++) {
        const at = end + (1 + n * 2 + r() * 2) * 86_400_000;
        add(at, `quest: edit ${victim.title}${where}`, path, { ...base, successCriteria: [clearedCrit], items: one(victim, { status: 'done', notes: `v${n}` }) }, { ...base, successCriteria: [clearedCrit], items: one(victim, { status: 'done', notes: `v${n + 1}` }) });
      }
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

/** The demo has no repo to read, so its scan just pretends for a moment (about 1.2 s) with real-looking progress. */
export async function fakeScan(ws: Workspace, onProgress?: (p: ScanProgress) => void, ms = 1200): Promise<CommitChanges[]> {
  const commits = demoCommits(ws);
  const steps = 15;
  const sleep = (t: number) => new Promise((r) => setTimeout(r, t));
  onProgress?.({ phase: 'reading', done: 0, total: commits.length });
  await sleep(ms * 0.15);
  for (let i = 1; i <= steps; i++) {
    const done = Math.round((commits.length * i) / steps);
    onProgress?.({ phase: 'comparing', done, total: commits.length, detail: commits[Math.max(0, done - 1)]?.files[0]?.path.replace(/^data\/|\.json$/g, '') });
    await sleep((ms * 0.85) / steps);
  }
  return commits;
}

function latestStamp(level: Level): string | undefined {
  let last: string | undefined;
  for (const i of level.items) if (i.doneAt && (!last || i.doneAt > last)) last = i.doneAt;
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
