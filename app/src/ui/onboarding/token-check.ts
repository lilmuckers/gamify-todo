import { GitHubClient, GitHubError } from '@quest/shared';

// ---- Token check: what a fine-grained token can do, in plain words ----

/** What went wrong with a token, as an analytics-safe enum (never token text). */
export type TokenProblem = 'bad_token' | 'no_access' | 'empty_repo' | 'missing_contents' | 'missing_pulls' | 'missing_checks' | 'network';

/** One probe's outcome: a value, or the HTTP status it failed with (0 = no response). */
export type Probe<T = true> = { ok: true; value: T } | { ok: false; status: number };

export interface TokenProbes {
  user: Probe<{ login: string }>;
  repo: Probe<{ canPush: boolean; empty: boolean }>;
  pulls?: Probe;
  checks?: Probe;
}

export interface TokenCheck {
  label: string;
  /** undefined: couldn't tell (e.g. an empty repo has no commit to check). */
  ok?: boolean;
}

export interface TokenReport {
  ok: boolean;
  login?: string;
  problem?: TokenProblem;
  checks: TokenCheck[];
  advice?: string;
}

/** Turns the probes into ✓/✗ lines and the first problem worth fixing. */
export function tokenReport(p: TokenProbes): TokenReport {
  if (!p.user.ok) {
    const problem: TokenProblem = p.user.status === 0 ? 'network' : 'bad_token';
    return {
      ok: false,
      problem,
      checks: [{ label: 'Token works', ok: false }],
      advice: problem === 'network' ? "Couldn't reach GitHub. Check your connection and try again." : 'GitHub doesn’t accept this token: it may be mistyped, expired or revoked.',
    };
  }
  const login = p.user.value.login;
  if (!p.repo.ok)
    return {
      ok: false,
      login,
      problem: 'no_access',
      checks: [{ label: 'Token works', ok: true }, { label: 'Can see the repo', ok: false }],
      advice: 'The token can’t see this repo. Under Repository access, choose “Only select repositories” and pick it.',
    };
  const { canPush, empty } = p.repo.value;
  const checks: TokenCheck[] = [
    { label: 'Token works', ok: true },
    { label: 'Can see the repo', ok: true },
    { label: 'Can save (Contents: read and write)', ok: canPush },
    { label: 'Can see PRs (Pull requests: read and write)', ok: p.pulls ? p.pulls.ok : undefined },
    { label: 'Can see checks (Checks: read-only)', ok: empty ? undefined : p.checks ? p.checks.ok : undefined },
  ];
  const problem: TokenProblem | undefined = empty
    ? 'empty_repo'
    : !canPush
      ? 'missing_contents'
      : p.pulls && !p.pulls.ok
        ? 'missing_pulls'
        : p.checks && !p.checks.ok
          ? 'missing_checks'
          : undefined;
  const advice: Record<TokenProblem, string> = {
    empty_repo: 'The repo has no commits yet. On GitHub, add a README (or any file), then test again.',
    missing_contents: 'Give the token Contents: Read and write, so Quest Log can save.',
    missing_pulls: 'Optional: add Pull requests: Read and write to review PRs in the Warp Zone.',
    missing_checks: 'Optional: add Checks: Read-only to see CI results on PRs.',
    bad_token: '',
    no_access: '',
    network: '',
  };
  // PRs and checks are nice to have: saving is what matters.
  const ok = !empty && canPush;
  return { ok, login, problem, checks, advice: problem && advice[problem] };
}

const probe = async <T>(run: () => Promise<T>): Promise<Probe<T>> => {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    return { ok: false, status: err instanceof GitHubError ? err.status : 0 };
  }
};

/** Asks GitHub what the token can do with the repo. Sends the token to api.github.com only. */
export async function testToken(token: string, repo: { owner: string; repo: string }): Promise<TokenReport> {
  const client = new GitHubClient(token, { ...repo, branch: 'main' });
  const user = await probe(() => client.request<{ login: string }>('GET', 'https://api.github.com/user'));
  if (!user.ok) return tokenReport({ user, repo: { ok: false, status: 0 } });
  const info = await probe(() => client.request<{ permissions?: { push?: boolean }; default_branch: string }>('GET', ''));
  if (!info.ok) return tokenReport({ user, repo: info });
  const hasCommits = await probe(() => client.hasCommits());
  if (!hasCommits.ok) return tokenReport({ user, repo: hasCommits });
  const value = { canPush: !!info.value.permissions?.push, empty: !hasCommits.value };
  client.repo.branch = info.value.default_branch;
  const pulls = await probe(async () => (await client.request('GET', '/pulls?per_page=1'), true as const));
  const checks = value.empty ? undefined : await probe(async () => (await client.request('GET', `/commits/${await client.headSha()}/check-runs?per_page=1`), true as const));
  return tokenReport({ user, repo: { ok: true, value }, pulls, checks });
}
