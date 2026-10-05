import type { HistoryEvent } from './history';
import type { Criterion, Item, ItemType, Level } from './model';
import { roundMoney } from './budget';
import { isCleared } from './scoring';
import { classifyPath } from './serialize';

/** One data file a commit touched: its text before and after (absent = didn't exist). */
export interface FileChange {
  path: string;
  before?: string;
  after?: string;
}

/** A commit that touched data/, with the level files it changed. */
export interface CommitChanges {
  sha: string;
  /** Commit time, ISO. */
  date: string;
  message: string;
  files: FileChange[];
}

/**
 * One page of history, newest first. `more` means older commits remain in
 * the range asked for; `oldest` is the commit date to page on from (it can
 * be older than every commit returned, when merges were skipped).
 */
export interface HistoryPage {
  commits: CommitChanges[];
  more: boolean;
  oldest?: string;
}

/** How far a history scan has got, for the progress bar. */
export interface ScanProgress {
  phase: 'reading' | 'comparing' | 'adding';
  done: number;
  total: number;
  /** What it's looking at now, e.g. a level path. */
  detail?: string;
}

export type ChangeKind =
  | 'done'
  | 'reopened'
  | 'dropped'
  | 'added'
  | 'removed'
  | 'edited'
  | 'ticked'
  | 'unticked'
  | 'started'
  | 'cleared'
  | 'uncleared'
  | 'extended'
  | 'spent'
  | 'budgeted';

/**
 * Something a commit changed in a level, worked out by comparing the file
 * before and after it. Unlike the commit message, this sees edits made by
 * hand or by other tools too, and things like scope added after a start.
 */
export interface ChangeEvent {
  /** When: the item's own done stamp when it has one, else the commit time. ISO. */
  at: string;
  sha: string;
  kind: ChangeKind;
  /** "project/world/level". */
  level: string;
  /** Item title ("Step (in Dependency)" for steps), criterion id, or '' for the level itself. */
  subject: string;
  itemType?: ItemType;
  /** The level had already started (scope added or cut mid-flight). */
  afterStart?: boolean;
  /** The level was already cleared: the app counts this as polish (`stats.editsAfterClear`) unless it's a cut. */
  afterClear?: boolean;
  /** Days added, for 'extended'. */
  days?: number;
  /** Money added (or, if negative, taken off) for 'spent' and 'budgeted': an item's, or the level's own budget when the subject is ''. */
  amount?: number;
}

function parse(text: string | undefined): Level | undefined {
  if (!text) return undefined;
  try {
    const v = JSON.parse(text) as Level;
    return v && Array.isArray(v.items) && Array.isArray(v.successCriteria) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Items and dependency steps, keyed so steps can't clash with item ids. */
function flatItems(level: Level | undefined): Map<string, { item: Item; subject: string }> {
  const out = new Map<string, { item: Item; subject: string }>();
  for (const item of level?.items ?? []) {
    out.set(item.id, { item, subject: item.title });
    for (const step of item.subtasks ?? []) out.set(`${item.id}/${step.id}`, { item: step as Item, subject: `${step.title} (in ${item.title})` });
  }
  return out;
}

const SAME_IGNORING = (a: object, b: object, skip: string[]) => {
  const strip = (o: object) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !skip.includes(k)).sort(([x], [y]) => x.localeCompare(y))));
  return strip(a) === strip(b);
};

/** What one commit did to the levels it touched. */
export function changesFromCommit(c: CommitChanges): ChangeEvent[] {
  const out: ChangeEvent[] = [];
  for (const f of c.files) {
    const kind = classifyPath(f.path);
    if (kind?.kind !== 'level') continue;
    const key = `${kind.projectId}/${kind.worldId}/${kind.levelId}`;
    const before = parse(f.before);
    const after = parse(f.after);
    if (!after) continue;
    const started = !!before?.startedAt;
    const wasCleared = !!before && isCleared(before);
    const ev = (kind: ChangeKind, subject: string, extra: Partial<ChangeEvent> = {}, at = c.date) =>
      out.push({ at, sha: c.sha, kind, level: key, subject, ...(wasCleared && kind !== 'uncleared' ? { afterClear: true } : {}), ...extra });

    // A brand-new level file is planning, not progress or scope creep.
    if (!before) continue;

    if (!before.startedAt && after.startedAt) ev('started', '');
    if (after.timeboxDays > before.timeboxDays && before.startedAt) ev('extended', '', { days: after.timeboxDays - before.timeboxDays });
    const levelBudget = roundMoney((after.budget ?? 0) - (before.budget ?? 0));
    if (levelBudget) ev('budgeted', '', { amount: levelBudget });

    const was = flatItems(before);
    const now = flatItems(after);
    for (const [id, { item, subject }] of now) {
      const prev = was.get(id)?.item;
      const type = item.type;
      // Money: what was budgeted or spent, and when. Logging a cost is bookkeeping, never an edit.
      const budgeted = roundMoney((item.budget ?? 0) - (prev?.budget ?? 0));
      const spent = roundMoney((item.spent ?? 0) - (prev?.spent ?? 0));
      if (budgeted) ev('budgeted', subject, { itemType: type, amount: budgeted });
      if (spent) ev('spent', subject, { itemType: type, amount: spent });
      if (!prev) {
        ev('added', subject, { itemType: type, afterStart: started, afterClear: wasCleared });
        continue;
      }
      if (prev.status !== item.status) {
        if (item.status === 'done') {
          // Prefer the click time the app stamped, when it's plausible.
          const stamp = item.doneAt && Date.parse(item.doneAt) <= Date.parse(c.date) + 3_600_000 ? item.doneAt : c.date;
          ev('done', subject, { itemType: type }, stamp);
        } else if (item.status === 'dropped') ev('dropped', subject, { itemType: type, afterStart: started });
        else if (prev.status === 'done') ev('reopened', subject, { itemType: type });
      } else if (!SAME_IGNORING(prev, item, ['doneAt', 'subtasks', 'budget', 'spent'])) ev('edited', subject, { itemType: type, afterClear: wasCleared });
    }
    for (const [id, { item, subject }] of was) if (!now.has(id)) ev('removed', subject, { itemType: item.type, afterStart: started });

    const crit = new Map<string, Criterion>(before.successCriteria.map((x) => [x.id, x]));
    for (const cr of after.successCriteria) {
      const prev = crit.get(cr.id);
      if (!prev) continue;
      if (!prev.done && cr.done) ev('ticked', cr.id, {}, cr.doneAt && Date.parse(cr.doneAt) <= Date.parse(c.date) + 3_600_000 ? cr.doneAt : c.date);
      else if (prev.done && !cr.done) ev('unticked', cr.id);
    }

    const nowCleared = isCleared(after);
    if (!wasCleared && nowCleared) ev('cleared', '', {}, after.clearedAt ?? c.date);
    if (wasCleared && !nowCleared) ev('uncleared', '');
  }
  return out;
}

/** Every change in `commits`, oldest first. */
export function scanChanges(commits: CommitChanges[]): ChangeEvent[] {
  return commits.flatMap(changesFromCommit).sort((a, b) => a.at.localeCompare(b.at));
}

const AS_HISTORY: Partial<Record<ChangeKind, HistoryEvent['kind']>> = {
  done: 'done',
  reopened: 'todo',
  dropped: 'dropped',
  ticked: 'tick',
  unticked: 'untick',
};

/**
 * The completions and take-backs a scan found, in the shape the streak
 * merge (`mergeHistory`) reads, so hand edits count towards streaks too.
 */
export function changesAsHistory(events: ChangeEvent[]): HistoryEvent[] {
  return events.flatMap((e) => {
    const kind = AS_HISTORY[e.kind];
    return kind ? [{ at: e.at, kind, level: e.level, subject: e.subject, sha: e.sha }] : [];
  });
}
