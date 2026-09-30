import { GAME_PATH, WORLD_PATH_RE } from './serialize';

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

/** The branch moved since the parent commit was read. Refetch, replay, retry. */
export class ConflictError extends Error {
  constructor(message = 'Remote changed since last load') {
    super(message);
    this.name = 'ConflictError';
  }
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

const isDataPath = (p: string) => p === GAME_PATH || WORLD_PATH_RE.test(p);

export class GitHubClient {
  private blobCache = new Map<string, string>();

  constructor(
    private token: string | undefined,
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
    const headers: Record<string, string> = {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.fetchImpl(url.startsWith('http') ? url : `${this.base}${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    } as RequestInit);
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = ((await res.json()) as { message?: string }).message ?? message;
      } catch {
        /* non-JSON error body */
      }
      throw new GitHubError(`GitHub ${method} ${url}: ${res.status} ${message}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (accept.includes('raw') ? await res.text() : await res.json()) as T;
  }

  /** Checks the token works and can see the repo. Returns the login. */
  async whoami(): Promise<{ login: string; canPush: boolean }> {
    const [user, repo] = await Promise.all([
      this.request<{ login: string }>('GET', 'https://api.github.com/user'),
      this.request<{ permissions?: { push?: boolean } }>('GET', ''),
    ]);
    return { login: user.login, canPush: !!repo.permissions?.push };
  }

  async headSha(branch = this.repo.branch): Promise<string> {
    const ref = await this.request<{ object: { sha: string } }>(
      'GET',
      `/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    return ref.object.sha;
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
      if (err instanceof GitHubError && err.status === 422) throw new ConflictError();
      throw err;
    }
    return commit.sha;
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

/** Parses "owner/repo" or a GitHub remote URL. */
export function parseRepo(input: string, branch = 'main'): RepoRef | undefined {
  const m =
    /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(input.trim()) ??
    /^([^/\s]+)\/([^/\s]+)$/.exec(input.trim());
  return m ? { owner: m[1], repo: m[2], branch } : undefined;
}
