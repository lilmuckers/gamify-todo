import type {
  Workspace,
  MergeMethod,
  PullDetail,
  PullSummary,
  ReviewEvent,
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
  /** Writes (string) / deletes (null) files in one commit on top of `baseVersion`. Throws ConflictError. */
  commit?(changes: Record<string, string | null>, message: string, baseVersion: string): Promise<string>;
  pulls?: PullProvider;
  publish?(): Promise<string>;
  status?(): Promise<LocalStatus>;
}
