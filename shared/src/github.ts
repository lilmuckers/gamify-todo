import { classifyPath } from './serialize';
import type { HistoryCommit } from './history';
import type { CommitChanges, HistoryPage } from './scan';
import { isDataPath } from './serialize';
import { STUB_PATH } from './stub';

export interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

/**
 * The sign-in has run out: the refresh token was rejected (or is past its expiry), so no
 * request can succeed until the user signs in again. Queued edits must be kept.
 */
export class SignInExpiredError extends Error {
  constructor(message = 'Your GitHub sign-in has expired. Sign in again to sync.') {
    super(message);
    this.name = 'SignInExpiredError';
  }
}

/**
 * Hands out access tokens that can expire (Sign in with GitHub). `get` refreshes ahead of
 * expiry; `renew` is for a token GitHub rejected with 401. Both throw SignInExpiredError when
 * the session can't be saved, and resolve undefined when there's no token at all.
 */
export interface TokenProvider {
  get(): Promise<string | undefined>;
  renew(rejected: string): Promise<string | undefined>;
}

/** The branch moved since the parent commit was read. Refetch, replay, retry. */
export class ConflictError extends Error {
  constructor(message = 'Remote changed since last load') {
    super(message);
    this.name = 'ConflictError';
  }
}

/** The token may push data but not workflows: the GitHub App or PAT lacks Workflows: read & write. */
export class WorkflowPermissionError extends GitHubError {
  constructor(message: string) {
    super(`${message} (Quest Log needs the "Workflows: read & write" permission on this repo)`, 403);
    this.name = 'WorkflowPermissionError';
  }
}

export interface WorkflowRun {
  id: number;
  event: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  url: string;
}

export interface PullSummary {
  number: number;
  title: string;
  author: string;
  url: string;
  draft: boolean;
  updatedAt: string;
  headSha: string;
  headRef: string;
  headRepo: string;
  baseRef: string;
  dataFiles: string[];
}

export interface PullDetail extends PullSummary {
  body: string;
  mergeable: boolean | null;
  mergeableState: string;
  checks: ChecksSummary;
}

export interface ChecksSummary {
  state: 'success' | 'failure' | 'pending' | 'none';
  runs: { name: string; status: string; conclusion: string | null; url: string }[];
}

export type MergeMethod = 'merge' | 'squash' | 'rebase';
export type ReviewEvent = 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';

export class GitHubClient {
  private blobCache = new Map<string, string>();

  /** A fixed token (a PAT, or none), or a provider of refreshing ones. */
  constructor(
    private token: string | TokenProvider | undefined,
    public repo: RepoRef,
    private fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private get base() {
    return `https://api.github.com/repos/${this.repo.owner}/${this.repo.repo}`;
  }

  async request<T>(
    method: string,
    url: string,
    body?: unknown,
    accept = 'application/vnd.github+json',
  ): Promise<T> {
    const res = await this.send(method, url, body, accept);
    if (res.status === 204) return undefined as T;
    return (accept.includes('raw') ? await res.text() : await res.json()) as T;
  }

  /** A successful response, after one token refresh if GitHub said 401. Throws GitHubError otherwise. */
  private async send(method: string, url: string, body: unknown, accept: string): Promise<Response> {
    const provider = typeof this.token === 'object' ? this.token : undefined;
    let token = provider ? await provider.get() : (this.token as string | undefined);
    const send = (token: string | undefined) => {
      const headers: Record<string, string> = {
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      return this.fetchImpl(url.startsWith('http') ? url : `${this.base}${url}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      } as RequestInit);
    };
    let res = await send(token);
    // An app token GitHub no longer takes (revoked early, clock skew): refresh once and retry.
    if (res.status === 401 && provider && token) {
      const fresh = await provider.renew(token);
      if (fresh && fresh !== token) res = await send((token = fresh));
    }
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = ((await res.json()) as { message?: string }).message ?? message;
      } catch {
        /* non-JSON error body */
      }
      const missing = res.status === 403 && !/rate limit/i.test(message) ? permissionFor(url) : undefined;
      throw new GitHubError(
        `GitHub ${method} ${url}: ${res.status} ${message}${missing ? ` (Quest Log needs the "${missing}" permission on this repo)` : ''}`,
        res.status,
      );
    }
    return res;
  }

  /** Checks the token works and can see the repo. */
  async whoami(): Promise<{ login: string; canPush: boolean; defaultBranch: string; empty: boolean }> {
    const [user, repo, hasCommits] = await Promise.all([
      this.request<{ login: string }>('GET', 'https://api.github.com/user'),
      this.request<{ permissions?: { push?: boolean }; default_branch: string }>('GET', ''),
      this.hasCommits(),
    ]);
    return {
      login: user.login,
      canPush: !!repo.permissions?.push,
      defaultBranch: repo.default_branch,
      empty: !hasCommits,
    };
  }

  /**
   * Whether the repo has a first commit. Asks the commit log rather than the
   * repo's `size`, which GitHub computes lazily and rounds to whole KB, so a
   * fresh repo with just a README can still report 0.
   */
  async hasCommits(): Promise<boolean> {
    try {
      await this.request('GET', '/commits?per_page=1');
      return true;
    } catch (err) {
      // GitHub answers 409 "Git Repository is empty" when there's nothing to list.
      if (err instanceof GitHubError && err.status === 409) return false;
      throw err;
    }
  }

  async headSha(branch = this.repo.branch): Promise<string> {
    const ref = await this.request<{ object: { sha: string } }>(
      'GET',
      `/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    return ref.object.sha;
  }

  /**
   * How `head` relates to `base`: 'ahead', 'behind', 'identical' or 'diverged'.
   * Both are commit shas on this repo.
   */
  async compare(base: string, head: string): Promise<string> {
    const res = await this.request<{ status: string }>('GET', `/compare/${base}...${head}`);
    return res.status;
  }

  /**
   * Commits on the branch that touched data/, newest first, for the stats
   * history. `since` (ISO) limits it to newer ones; `maxPages` of 100 caps a
   * first read of a long history.
   */
  async dataCommits(since?: string, maxPages = 30): Promise<HistoryCommit[]> {
    return (await this.listDataCommits(since, maxPages)).map(({ parents: _, ...c }) => c);
  }

  private async listDataCommits(since: string | undefined, maxPages: number, onPage?: (n: number) => void): Promise<(HistoryCommit & { parents: string[] })[]> {
    const out: (HistoryCommit & { parents: string[] })[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const q = new URLSearchParams({ sha: this.repo.branch, path: 'data', per_page: '100', page: String(page) });
      if (since) q.set('since', since);
      const batch = await this.request<
        { sha: string; parents?: { sha: string }[]; commit: { message: string; author?: { date?: string }; committer?: { date?: string } } }[]
      >('GET', `/commits?${q}`);
      for (const c of batch) {
        const date = c.commit.author?.date ?? c.commit.committer?.date;
        if (date) out.push({ sha: c.sha, date, message: c.commit.message, parents: (c.parents ?? []).map((p) => p.sha) });
      }
      onPage?.(out.length);
      if (batch.length < 100) break;
    }
    return out;
  }

  /**
   * One page of data commits for the detailed stats history: the newest
   * `limit` in the range (`since` < date <= `until`), newest first, each with
   * the level files it changed before and after. Merge commits are skipped:
   * their changes arrive with the commits they merge. Costs one request per
   * commit plus two per changed level file, one at a time, so a background
   * build stays gentle; `requests` says how many it took.
   */
  async dataChangesPage(opts: { since?: string; until?: string; limit: number }): Promise<HistoryPage & { requests: number }> {
    const q = new URLSearchParams({ sha: this.repo.branch, path: 'data', per_page: String(opts.limit), page: '1' });
    if (opts.since) q.set('since', opts.since);
    if (opts.until) q.set('until', opts.until);
    const listed = await this.request<
      { sha: string; parents?: { sha: string }[]; commit: { message: string; author?: { date?: string }; committer?: { date?: string } } }[]
    >('GET', `/commits?${q}`);
    let requests = 1;
    const raw = 'application/vnd.github.raw+json';
    const read = async (url: string) => {
      requests++;
      try {
        return await this.request<string>('GET', url, undefined, raw);
      } catch (err) {
        if (err instanceof GitHubError && err.status === 404) return undefined;
        throw err;
      }
    };
    const commits: CommitChanges[] = [];
    let oldest: string | undefined;
    for (const c of listed) {
      const date = c.commit.committer?.date ?? c.commit.author?.date;
      if (!date) continue;
      if (!oldest || date < oldest) oldest = date;
      const parents = (c.parents ?? []).map((p) => p.sha);
      if (parents.length > 1) continue;
      const detail = await this.request<{ files?: { filename: string; status: string; sha?: string; previous_filename?: string }[] }>('GET', `/commits/${c.sha}`);
      requests++;
      const files = [];
      for (const f of (detail.files ?? []).filter((x) => classifyPath(x.filename)?.kind === 'level')) {
        const path = (f.previous_filename ?? f.filename).split('/').map(encodeURIComponent).join('/');
        const before = f.status === 'added' || !parents[0] ? undefined : await read(`/contents/${path}?ref=${parents[0]}`);
        let after: string | undefined;
        if (f.status !== 'removed' && f.sha) {
          after = this.blobCache.get(f.sha);
          if (after === undefined) {
            after = await read(`/git/blobs/${f.sha}`);
            if (after !== undefined) this.blobCache.set(f.sha, after);
          }
        }
        files.push({ path: f.filename, before, after });
      }
      commits.push({ sha: c.sha, date: c.commit.author?.date ?? date, message: c.commit.message, files });
    }
    return { commits, more: listed.length >= opts.limit, oldest, requests };
  }

  /** All data files at a commit. `repoFullName` lets PR heads live in forks. */
  async readDataAt(sha: string, repoFullName?: string): Promise<Record<string, string>> {
    const base = repoFullName ? `https://api.github.com/repos/${repoFullName}` : this.base;
    const tree = await this.request<{ tree: { path: string; sha: string; type: string }[]; truncated: boolean }>(
      'GET',
      `${base}/git/trees/${sha}?recursive=1`,
    );
    const entries = tree.tree.filter((e) => e.type === 'blob' && isDataPath(e.path));
    const files: Record<string, string> = {};
    await Promise.all(
      entries.map(async (e) => {
        let text = this.blobCache.get(e.sha);
        if (text === undefined) {
          text = await this.request<string>(
            'GET',
            `${base}/git/blobs/${e.sha}`,
            undefined,
            'application/vnd.github.raw+json',
          );
          this.blobCache.set(e.sha, text);
        }
        files[e.path] = text;
      }),
    );
    return files;
  }

  /** One atomic commit on the branch. Throws ConflictError if the branch moved. */
  async commitFiles(
    changes: Record<string, string | null>,
    message: string,
    parentSha: string,
  ): Promise<string> {
    // The app only ever writes data/ and its own workflow (plans §3.1).
    const stray = Object.keys(changes).find((p) => !isDataPath(p) && p !== STUB_PATH);
    if (stray) throw new Error(`Quest Log doesn't write ${stray}`);
    const parent = await this.request<{ tree: { sha: string } }>('GET', `/git/commits/${parentSha}`);
    const tree = await this.request<{ sha: string }>('POST', '/git/trees', {
      base_tree: parent.tree.sha,
      tree: Object.entries(changes).map(([path, content]) =>
        content === null
          ? { path, mode: '100644', type: 'blob', sha: null }
          : { path, mode: '100644', type: 'blob', content },
      ),
    });
    const commit = await this.request<{ sha: string }>('POST', '/git/commits', {
      message,
      tree: tree.sha,
      parents: [parentSha],
    });
    try {
      await this.request('PATCH', `/git/refs/heads/${encodeURIComponent(this.repo.branch)}`, {
        sha: commit.sha,
        force: false,
      });
    } catch (err) {
      // GitHub refuses a commit touching .github/workflows without the Workflows permission, also as a 422.
      if (err instanceof GitHubError && err.status === 422 && /workflow/i.test(err.message))
        throw new WorkflowPermissionError(err.message);
      if (err instanceof GitHubError && err.status === 422) throw new ConflictError();
      throw err;
    }
    return commit.sha;
  }

  /** A file's text at `ref` (default: the branch), or undefined when it isn't there. */
  async readFile(path: string, ref = this.repo.branch): Promise<string | undefined> {
    try {
      const enc = path.split('/').map(encodeURIComponent).join('/');
      return await this.request<string>('GET', `/contents/${enc}?ref=${encodeURIComponent(ref)}`, undefined, 'application/vnd.github.raw+json');
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return undefined;
      throw err;
    }
  }

  /** Writes the Quest Log workflow, alone or beside data/ files, in one commit on `parentSha`. */
  putWorkflow(text: string, message: string, parentSha: string, data: Record<string, string | null> = {}): Promise<string> {
    return this.commitFiles({ ...data, [STUB_PATH]: text }, message, parentSha);
  }

  /** The repo's key for sealing Actions secrets (libsodium sealed box). */
  secretsPublicKey(): Promise<{ key_id: string; key: string }> {
    return this.request('GET', '/actions/secrets/public-key');
  }

  /** Sets an Actions secret. `encrypted` is the base64 sealed box made with `secretsPublicKey`. */
  async putSecret(name: string, encrypted: string, keyId: string): Promise<void> {
    await this.request('PUT', `/actions/secrets/${encodeURIComponent(name)}`, { encrypted_value: encrypted, key_id: keyId });
  }

  /** Names of the repo's Actions secrets. GitHub never hands values back. */
  async listSecrets(): Promise<string[]> {
    const res = await this.request<{ secrets: { name: string }[] }>('GET', '/actions/secrets?per_page=100');
    return res.secrets.map((s) => s.name);
  }

  async deleteSecret(name: string): Promise<void> {
    await this.request('DELETE', `/actions/secrets/${encodeURIComponent(name)}`);
  }

  /** The newest runs of the Quest Log workflow, newest first (none when it isn't installed). */
  async latestRuns(count = 1): Promise<WorkflowRun[]> {
    const file = encodeURIComponent(STUB_PATH.split('/').pop()!);
    try {
      const res = await this.request<{ workflow_runs: any[] }>('GET', `/actions/workflows/${file}/runs?per_page=${count}`);
      return res.workflow_runs.map((r) => ({
        id: r.id as number,
        event: r.event as string,
        status: r.status as string,
        conclusion: (r.conclusion ?? null) as string | null,
        createdAt: (r.run_started_at ?? r.created_at) as string,
        url: r.html_url as string,
      }));
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return [];
      throw err;
    }
  }

  /**
   * A run's artifact as zip bytes, or undefined when it has none by that name (or it expired).
   * The download redirects to Azure blob storage, which the CSP must allow (plans D13).
   */
  async runArtifact(runId: number, name: string): Promise<Uint8Array | undefined> {
    const res = await this.request<{ artifacts: { name: string; expired: boolean; archive_download_url: string }[] }>(
      'GET',
      `/actions/runs/${runId}/artifacts?name=${encodeURIComponent(name)}`,
    );
    const artifact = res.artifacts.find((a) => a.name === name && !a.expired);
    if (!artifact) return undefined;
    return new Uint8Array(await (await this.send('GET', artifact.archive_download_url, undefined, 'application/vnd.github+json')).arrayBuffer());
  }

  async listDataPulls(): Promise<PullSummary[]> {
    const pulls = await this.request<any[]>(
      'GET',
      `/pulls?state=open&base=${encodeURIComponent(this.repo.branch)}&per_page=50&sort=updated&direction=desc`,
    );
    const out = await Promise.all(
      pulls.map(async (p) => {
        const files = await this.request<{ filename: string }[]>(
          'GET',
          `/pulls/${p.number}/files?per_page=100`,
        );
        return { ...summarize(p), dataFiles: files.map((f) => f.filename).filter(isDataPath) };
      }),
    );
    return out.filter((p) => p.dataFiles.length > 0);
  }

  async checks(sha: string): Promise<ChecksSummary> {
    const res = await this.request<{ check_runs: any[] }>('GET', `/commits/${sha}/check-runs?per_page=50`);
    const runs = res.check_runs.map((r) => ({
      name: r.name as string,
      status: r.status as string,
      conclusion: r.conclusion as string | null,
      url: r.html_url as string,
    }));
    const bad = ['failure', 'timed_out', 'cancelled', 'action_required'];
    const state: ChecksSummary['state'] = !runs.length
      ? 'none'
      : runs.some((r) => r.conclusion && bad.includes(r.conclusion))
        ? 'failure'
        : runs.some((r) => r.status !== 'completed')
          ? 'pending'
          : 'success';
    return { state, runs };
  }

  async pull(number: number): Promise<PullDetail> {
    const p = await this.request<any>('GET', `/pulls/${number}`);
    const [files, checks] = await Promise.all([
      this.request<{ filename: string }[]>('GET', `/pulls/${number}/files?per_page=100`),
      this.checks(p.head.sha),
    ]);
    return {
      ...summarize(p),
      dataFiles: files.map((f) => f.filename).filter(isDataPath),
      body: p.body ?? '',
      mergeable: p.mergeable,
      mergeableState: p.mergeable_state,
      checks,
    };
  }

  async merge(number: number, method: MergeMethod, sha: string): Promise<void> {
    await this.request('PUT', `/pulls/${number}/merge`, { merge_method: method, sha });
  }

  async review(number: number, event: ReviewEvent, body: string): Promise<void> {
    await this.request('POST', `/pulls/${number}/reviews`, { event, body: body || undefined });
  }
}

function summarize(p: any): Omit<PullSummary, 'dataFiles'> {
  return {
    number: p.number,
    title: p.title,
    author: p.user?.login ?? 'unknown',
    url: p.html_url,
    draft: !!p.draft,
    updatedAt: p.updated_at,
    headSha: p.head.sha,
    headRef: p.head.ref,
    headRepo: p.head.repo?.full_name ?? '',
    baseRef: p.base.ref,
  };
}

/** The fine-grained permission an endpoint needs, to name it when GitHub says 403. */
function permissionFor(url: string): string | undefined {
  if (url.includes('/actions/secrets')) return 'Secrets: read & write';
  if (url.includes('/actions/')) return 'Actions: read';
  if (url.includes('/check-runs')) return 'Checks: read';
  if (url.includes('/pulls')) return 'Pull requests: read & write';
  if (/\/(git|contents|commits)\b/.test(url)) return 'Contents: read & write';
  return undefined;
}

/** Parses "owner/repo" or a GitHub remote URL. */
export function parseRepo(input: string, branch = 'main'): RepoRef | undefined {
  const m =
    /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(input.trim()) ??
    /^([^/\s]+)\/([^/\s]+)$/.exec(input.trim());
  return m ? { owner: m[1], repo: m[2], branch } : undefined;
}
