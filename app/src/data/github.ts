import { fromFiles, GitHubClient, GitHubError, type RepoRef, type TokenProvider } from '@quest/shared';
import type { DataSource, Loaded, PullData } from './source';

/**
 * Browser-only GitHub mode: a token from localStorage (pasted, or a refreshing sign-in), reads and atomic commits
 * via the Git Data API. Works against any repo the token can see, so people can
 * keep their quest data in their own repo without cloning this project.
 */
export class GitHubSource implements DataSource {
  id: string;
  label: string;
  caps = { canEdit: false, canReviewPRs: false, canPublish: false };
  client: GitHubClient;

  constructor(token: string | TokenProvider, repo: RepoRef) {
    this.client = new GitHubClient(token, repo);
    this.id = `gh:${repo.owner}/${repo.repo}`;
    this.label = `${repo.owner}/${repo.repo}`;
  }

  /** Resolves the branch (default branch unless one was chosen) and push rights. */
  async init(branch?: string): Promise<this> {
    try {
      const info = await this.client.whoami();
      this.client.repo.branch = branch || info.defaultBranch;
      this.caps = { canEdit: info.canPush, canReviewPRs: true, canPublish: false };
      if (info.empty) this.empty = true;
    } catch {
      // Offline: assume the saved branch and allow queued edits; sync sorts it out later.
      this.client.repo.branch = branch || this.client.repo.branch;
      this.caps = { canEdit: true, canReviewPRs: true, canPublish: false };
    }
    this.label = `${this.client.repo.owner}/${this.client.repo.repo}@${this.client.repo.branch}`;
    return this;
  }

  /** Repo has no commits yet; the first commit needs a README (see settings). */
  empty = false;

  async load(): Promise<Loaded> {
    if (this.empty) throw new Error(`${this.label} is empty. Create it with a README so it has a first commit.`);
    let sha: string;
    try {
      sha = await this.client.headSha();
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404)
        throw new Error(`Branch ${this.client.repo.branch} not found in ${this.client.repo.owner}/${this.client.repo.repo}`);
      throw err;
    }
    return { state: fromFiles(await this.client.readDataAt(sha)), version: sha };
  }

  /**
   * Right after a commit, reading the branch can briefly return the commit
   * before it. True when `remote` is an ancestor of the `known` head we saw.
   */
  async isBehind(remote: string, known: string): Promise<boolean> {
    return (await this.client.compare(remote, known)) === 'ahead';
  }

  commit(changes: Record<string, string | null>, message: string, baseVersion: string) {
    return this.client.commitFiles(changes, message, baseVersion);
  }

  pulls = {
    list: () => this.client.listDataPulls(),
    load: async (n: number): Promise<PullData> => {
      const detail = await this.client.pull(n);
      const baseSha = await this.client.headSha(detail.baseRef);
      const [base, head] = await Promise.all([
        this.client.readDataAt(baseSha),
        this.client.readDataAt(detail.headSha, detail.headRepo),
      ]);
      return { detail, base: fromFiles(base), head: fromFiles(head) };
    },
    merge: (n: number, method: Parameters<GitHubClient['merge']>[1], sha: string) => this.client.merge(n, method, sha),
    review: (n: number, event: Parameters<GitHubClient['review']>[1], body: string) =>
      this.client.review(n, event, body),
  };
}
