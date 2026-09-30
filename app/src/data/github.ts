import { fromFiles, GitHubClient, type RepoRef } from '@quest/shared';
import type { DataSource, Loaded, PullData } from './source';

/** Browser-only GitHub mode: token from localStorage, commits via the Git Data API. */
export class GitHubSource implements DataSource {
  id: string;
  label: string;
  caps = { canEdit: true, canReviewPRs: true, canPublish: false };
  client: GitHubClient;

  constructor(token: string, repo: RepoRef) {
    this.client = new GitHubClient(token, repo);
    this.id = `gh:${repo.owner}/${repo.repo}@${repo.branch}`;
    this.label = `${repo.owner}/${repo.repo}`;
  }

  async load(): Promise<Loaded> {
    const sha = await this.client.headSha();
    return { state: fromFiles(await this.client.readDataAt(sha)), version: sha };
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
    merge: (n: number, method: Parameters<GitHubClient['merge']>[1], sha: string) =>
      this.client.merge(n, method, sha),
    review: (n: number, event: Parameters<GitHubClient['review']>[1], body: string) =>
      this.client.review(n, event, body),
  };
}
