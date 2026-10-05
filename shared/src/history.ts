/** A commit that touched data/, as the GitHub API or `git log` reports it. */
export interface HistoryCommit {
  sha: string;
  /** When it was committed, ISO. */
  date: string;
  /** The full message: subject, blank line, body. */
  message: string;
}

/** What a line of an app commit message says happened. */
export type HistoryKind = 'done' | 'todo' | 'doing' | 'dropped' | 'tick' | 'untick';

/**
 * One thing an app commit recorded: an item or step's status set, or a
 * criterion ticked or un-ticked. Read back from the commit message, so
 * work that was done and later reopened still shows up.
 */
export interface HistoryEvent {
  /** Commit time, ISO: when it synced, which is usually when it happened. */
  at: string;
  kind: HistoryKind;
  /** "project/world/level". */
  level: string;
  /** Item title (steps read "Step (in Dependency)"), or a criterion id. */
  subject: string;
  sha: string;
}

const LEVEL = '([a-z0-9]+(?:-[a-z0-9]+)*/[a-z0-9]+(?:-[a-z0-9]+)*/[a-z0-9]+(?:-[a-z0-9]+)*)';
// The shapes `describeOp` writes; anything else in a commit is ignored.
const STATUS_LINE = new RegExp(`^(done|todo|doing|dropped): (.+) \\(${LEVEL}\\)$`);
const CRITERION_LINE = new RegExp(`^(tick|untick) criterion ([a-z0-9]+(?:-[a-z0-9]+)*) \\(${LEVEL}\\)$`);

/**
 * The status changes and ticks in an app commit (`quest: …`), one per op:
 * the subject line for a single edit, or each "- " bullet of a
 * `quest: N updates` commit. Commits made by hand or by other tools give none.
 */
export function parseCommit(c: HistoryCommit): HistoryEvent[] {
  const [subject, ...body] = c.message.trim().split('\n');
  if (!subject.startsWith('quest: ')) return [];
  const head = subject.slice('quest: '.length).trim();
  const lines = /^\d+ updates$/.test(head)
    ? body.filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim())
    : [head];
  const out: HistoryEvent[] = [];
  for (const line of lines) {
    const s = STATUS_LINE.exec(line);
    if (s) {
      out.push({ at: c.date, kind: s[1] as HistoryKind, level: s[3], subject: s[2], sha: c.sha });
      continue;
    }
    const k = CRITERION_LINE.exec(line);
    if (k) out.push({ at: c.date, kind: k[1] as HistoryKind, level: k[3], subject: k[2], sha: c.sha });
  }
  return out;
}

/** Every event in `commits`, oldest first. */
export function historyEvents(commits: HistoryCommit[]): HistoryEvent[] {
  return commits
    .flatMap(parseCommit)
    .sort((a, b) => a.at.localeCompare(b.at));
}
