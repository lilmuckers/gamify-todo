import {
  findLevelAt,
  type LevelAt,
  type Workspace,
  type HistoryCommit,
  type HistoryPage,
  type MergeMethod,
  type PullDetail,
  type PullSummary,
  type ReviewEvent,
  type StubState,
  type WorkflowRun,
} from '@quest/shared';

export interface Capabilities {
  canEdit: boolean;
  canReviewPRs: boolean;
  canPublish: boolean;
  /** Can install the Quest Log workflow and manage its secrets (GitHub repos only). */
  canAutomate: boolean;
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

/** The `quest-status` artifact every run uploads (quest-log-actions src/status.ts, plans D13). */
export interface QuestStatus {
  version: number;
  ranAt: string;
  event: string;
  core: { version: string };
  modules: Record<string, { ran: boolean; reason: string; ok?: boolean }>;
  sent?: Record<string, number>;
  expiredDevices?: string[];
  error?: string;
}

/** The newest workflow run, with its status artifact when it could be read. */
export interface LatestRun {
  run: WorkflowRun;
  status?: QuestStatus;
  /** Why the status couldn't be read (expired, still running, a download error). */
  statusMissing?: string;
}

/** The workflow, its secrets and its runs in the data repo (Settings → Automation). */
export interface AutomationProvider {
  /** How the workflow in the repo compares with what the app would write now. */
  stub(): Promise<{ state: StubState; text?: string }>;
  /**
   * Writes the workflow and automation.json in one commit on the branch's head: installs,
   * replaces a legacy one, upgrades an older one or undoes a hand edit. Returns the commit.
   */
  writeWorkflow(): Promise<string>;
  /** Names of the repo's secrets (never values). */
  secrets(): Promise<string[]>;
  /** Sets a secret, sealed in this browser for the repo's key. */
  setSecret(name: string, value: string): Promise<void>;
  deleteSecret(name: string): Promise<void>;
  latestRun(): Promise<LatestRun | undefined>;
}

/** A slice of history to read: commits after `since` and up to `until` (both ISO). */
export interface HistoryRange {
  since?: string;
  until?: string;
  limit: number;
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
  automation?: AutomationProvider;
  publish?(): Promise<string>;
  /** Commits that touched data/, newest first; only newer than `since` (ISO) when given. */
  history?(since?: string): Promise<HistoryCommit[]>;
/**
   * One page of history for the detailed stats, built up in the background:
   * the newest `limit` data commits with since < date <= until, newest first,
   * each with the level files it changed. `requests` counts API calls spent.
   */
  changesPage?(range: HistoryRange): Promise<HistoryPage & { requests?: number }>;
  status?(): Promise<LocalStatus>;
}
