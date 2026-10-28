import {
  AUTOMATION_PATH,
  ConflictError,
  fromFiles,
  GitHubClient,
  GitHubError,
  parseStub,
  renderStub,
  starterAutomation,
  STUB_PATH,
  STUB_VERSION,
  stubState,
  toFiles,
  WorkflowPermissionError,
  type RepoRef,
  type TokenProvider,
} from '@quest/shared';
import { unzipFile } from '../ui/zip';
import type { AutomationProvider, DataSource, HistoryRange, LatestRun, Loaded, PullData, QuestStatus } from './source';

/**
 * Browser-only GitHub mode: a token from localStorage (pasted, or a refreshing sign-in), reads and atomic commits
 * via the Git Data API. Works against any repo the token can see, so people can
 * keep their quest data in their own repo without cloning this project.
 */
export class GitHubSource implements DataSource {
  id: string;
  label: string;
  caps = { canEdit: false, canReviewPRs: false, canPublish: false, canAutomate: false };
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
      this.caps = { canEdit: info.canPush, canReviewPRs: true, canPublish: false, canAutomate: true };
      if (info.empty) this.empty = true;
      this.public = info.private === false;
    } catch {
      // Offline: assume the saved branch and allow queued edits; sync sorts it out later.
      this.client.repo.branch = branch || this.client.repo.branch;
      this.caps = { canEdit: true, canReviewPRs: true, canPublish: false, canAutomate: true };
    }
    this.label = `${this.client.repo.owner}/${this.client.repo.repo}@${this.client.repo.branch}`;
    return this;
  }

  /** Anyone can read the repo, push device endpoints included. */
  public = false;

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

  /**
   * A change to automation.json re-renders the workflow into the same commit (plans §3.1),
   * but only when the workflow there is already ours: Install is the only way in.
   */
  async commit(changes: Record<string, string | null>, message: string, baseVersion: string) {
    if (AUTOMATION_PATH in changes) {
      const stub = await this.restub(changes[AUTOMATION_PATH], baseVersion);
      if (stub !== undefined)
        try {
          return await this.client.putWorkflow(stub, message, baseVersion, changes);
        } catch (err) {
          // Not re-approved for Workflows yet: save the settings anyway; Settings shows the drift.
          if (!(err instanceof WorkflowPermissionError)) throw err;
        }
    }
    return this.client.commitFiles(changes, message, baseVersion);
  }

  /** The workflow for `config` (automation.json's new text; null = deleted), if ours needs it. */
  private async restub(config: string | null, base: string): Promise<string | undefined> {
    const current = await this.client.readFile(STUB_PATH, base);
    const parsed = current === undefined ? undefined : parseStub(current);
    // Never touch a missing, legacy or foreign file, or one a newer app wrote.
    if (parsed?.kind !== 'stub' || parsed.version > STUB_VERSION) return undefined;
    const text = renderStub(config === null ? undefined : fromFiles({ [AUTOMATION_PATH]: config }).automation, this.client.repo.branch).text;
    return text === current ? undefined : text;
  }

  /**
   * The workflow's push filter is the branch the app commits data to (normally the default one).
   * Scheduled runs use the default branch's copy of the workflow, so a data branch other than
   * the default only gets push and PR runs.
   */
  automation: AutomationProvider = {
    stub: async () => {
      const head = await this.client.headSha();
      const [text, config] = await Promise.all([this.client.readFile(STUB_PATH, head), this.client.readFile(AUTOMATION_PATH, head)]);
      const automation = config === undefined ? undefined : fromFiles({ [AUTOMATION_PATH]: config }).automation;
      return { state: stubState(text, automation, this.client.repo.branch), text };
    },
    writeWorkflow: async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const head = await this.client.headSha();
        const [current, config] = await Promise.all([this.client.readFile(STUB_PATH, head), this.client.readFile(AUTOMATION_PATH, head)]);
        const automation = config === undefined ? starterAutomation() : fromFiles({ [AUTOMATION_PATH]: config }).automation;
        const data: Record<string, string> = config === undefined ? { [AUTOMATION_PATH]: toFiles({ projects: {}, automation })[AUTOMATION_PATH] } : {};
        const message = `quest: automation: ${current === undefined ? 'install' : 're-write'} the workflow`;
        try {
          return await this.client.putWorkflow(renderStub(automation, this.client.repo.branch).text, message, head, data);
        } catch (err) {
          if (!(err instanceof ConflictError)) throw err;
        }
      }
      throw new ConflictError('The repo kept changing; try again');
    },
    isPublic: () => this.public,
    secrets: () => this.client.listSecrets(),
    setSecret: async (name: string, value: string) => {
      const [{ sealSecret }, key] = await Promise.all([import('../push/sealed-box'), this.client.secretsPublicKey()]);
      await this.client.putSecret(name, await sealSecret(key.key, value), key.key_id);
    },
    deleteSecret: (name: string) => this.client.deleteSecret(name),
    latestRun: async (): Promise<LatestRun | undefined> => {
      const [run] = await this.client.latestRuns(1);
      if (!run) return undefined;
      if (run.status !== 'completed') return { run, statusMissing: 'Still running.' };
      try {
        const zip = await this.client.runArtifact(run.id, 'quest-status');
        const file = zip && (await unzipFile(zip, 'status.json'));
        if (!file) return { run, statusMissing: 'This run saved no status (or it has expired).' };
        return { run, status: JSON.parse(new TextDecoder().decode(file)) as QuestStatus };
      } catch (err) {
        if (err instanceof GitHubError) return { run, statusMissing: err.message };
        return { run, statusMissing: `Couldn’t read the run’s status: ${(err as Error).message}` };
      }
    },
  };

  history(since?: string) {
    return this.client.dataCommits(since);
  }

  changesPage(range: HistoryRange) {
    return this.client.dataChangesPage(range);
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
