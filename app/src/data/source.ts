import {
  findLevelAt,
  type LevelAt,
  type Workspace,
  type HistoryCommit,
  type CommitChanges,
  type ScanProgress,
  type MergeMethod,
  type PullDetail,
  type PullSummary,
  type ReviewEvent,
} from '@quest/shared';

export interface Capabilities {
  canEdit: boolean;
  canReviewPRs: boolean;
  canPublish: boolean;
}

export interface Loaded {
  state: Workspace;
  /** Commit sha (or content hash) the state was read at. */
  version: string;
}

export interface PullData {
  detail: PullDetail;
  base: Workspace;
  head: Workspace;
}

/**
 * Finds things in a PR's data: as the PR leaves them (head), or as they
 * were (base) for things it removes.
 */
export function pullLookup({ head, base }: Pick<PullData, 'head' | 'base'>) {
  return {
    project: (pid: string) => head.projects[pid] ?? base.projects[pid],
    world: (pid: string, wid: string) => head.projects[pid]?.worlds[wid] ?? base.projects[pid]?.worlds[wid],
    level: (at: LevelAt) => findLevelAt(head, at) ?? findLevelAt(base, at),
  };
}

export interface PullProvider {
  list(): Promise<PullSummary[]>;
  load(number: number): Promise<PullData>;
  merge(number: number, method: MergeMethod, sha: string): Promise<void>;
  review(number: number, event: ReviewEvent, body: string): Promise<void>;
}

export interface LocalStatus {
  branch: string;
  ahead: number;
  behind: number;
  lastCommit?: { sha: string; message: string; date: string };
  remote?: string;
  canReviewPRs: boolean;
}

export interface DataSource {
  /** Namespaces the offline cache. */
  id: string;
  label: string;
  caps: Capabilities;
  load(): Promise<Loaded>;
  /** True when `remoteVersion` is older than `knownVersion` (a lagging read). */
  isBehind?(remoteVersion: string, knownVersion: string): Promise<boolean>;
  /** Writes (string) / deletes (null) files in one commit on top of `baseVersion`. Throws ConflictError. */
  commit?(changes: Record<string, string | null>, message: string, baseVersion: string): Promise<string>;
  pulls?: PullProvider;
  publish?(): Promise<string>;
  /** Commits that touched data/, newest first; only newer than `since` (ISO) when given. */
  history?(since?: string): Promise<HistoryCommit[]>;
  /** Level files each data commit changed, oldest first, for the detailed stats scan. */
  changes?(opts: { since?: string; onProgress?: (p: ScanProgress) => void }): Promise<CommitChanges[]>;
  status?(): Promise<LocalStatus>;
}
