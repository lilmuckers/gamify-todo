import { GitHubError } from '@quest/shared';

/**
 * Finding the user's Quest Log repos after sign-in, so nobody types `owner/repo`. The App's
 * installations already remember which repos the user picked on GitHub, so a new device
 * finds them with no storage of ours (#30, repo discovery).
 */

export interface FoundRepo {
  /** `owner/name`. */
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  /** ISO time of the last push, for the picker. */
  pushedAt?: string;
}

/**
 * What a repo holds: Quest Log data (`quest`), nothing at all yet (`empty`: no first commit,
 * so the app can't save there), or anything else (`other`: fine to start a quest log in).
 */
export type RepoKind = 'quest' | 'empty' | 'other';

export interface ScannedRepo extends FoundRepo {
  kind: RepoKind;
}

/** Where the user's set-up has got to, for the next-steps checklist. */
export interface SetupScan {
  /** Accounts the App is installed on. 0: the App hasn't been added anywhere yet. */
  installations: number;
  /** Repos the App can reach, newest push first. */
  repos: ScannedRepo[];
}

/** A GET against api.github.com with the signed-in user's token. */
export type GitHubGet = <T>(url: string) => Promise<T>;

const API = 'https://api.github.com';
/** Most installations hold a handful of repos; past this, check the most recently pushed. */
const MAX_CANDIDATES = 40;
/** Project folders to look in for a project.json before giving up on a repo. */
const MAX_FOLDERS = 3;
const PARALLEL = 6;

interface ApiRepo {
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  pushed_at?: string | null;
}

/** Every repo the user can reach through the App's installations, newest push first. */
export async function installedRepos(get: GitHubGet): Promise<{ installations: number; repos: FoundRepo[] }> {
  const { installations } = await get<{ installations: { id: number }[] }>(`${API}/user/installations?per_page=100`);
  const lists = await Promise.all(
    installations.map((i) => get<{ repositories: ApiRepo[] }>(`${API}/user/installations/${i.id}/repositories?per_page=100`)),
  );
  const seen = new Map<string, FoundRepo>();
  for (const r of lists.flatMap((l) => l.repositories)) {
    seen.set(r.full_name, { fullName: r.full_name, owner: r.owner.login, name: r.name, private: r.private, pushedAt: r.pushed_at ?? undefined });
  }
  return { installations: installations.length, repos: [...seen.values()].sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? '')) };
}

/**
 * What a repo holds. Quest Log data means `data/settings.json` or `data/inbox.json` (the
 * template ships settings.json), or a `data/<project>/project.json`. Doesn't rely on
 * `template_repository`, which misses hand-made and older repos.
 */
export async function checkRepo(get: GitHubGet, fullName: string): Promise<RepoKind> {
  let entries: { name: string; type: string }[];
  try {
    entries = await get(`${API}/repos/${fullName}/contents/data`);
  } catch (err) {
    // 409: GitHub's "This repository is empty". 404: no data/ folder (yet).
    if (err instanceof GitHubError && err.status === 409) return 'empty';
    if (err instanceof GitHubError && err.status === 404) return 'other';
    throw err;
  }
  if (!Array.isArray(entries)) return 'other';
  if (entries.some((e) => e.type === 'file' && (e.name === 'settings.json' || e.name === 'inbox.json'))) return 'quest';
  for (const dir of entries.filter((e) => e.type === 'dir').slice(0, MAX_FOLDERS)) {
    try {
      await get(`${API}/repos/${fullName}/contents/data/${encodeURIComponent(dir.name)}/project.json`);
      return 'quest';
    } catch (err) {
      if (!(err instanceof GitHubError && err.status === 404)) throw err;
    }
  }
  return 'other';
}

/** Whether a repo holds Quest Log data. */
export async function isQuestRepo(get: GitHubGet, fullName: string): Promise<boolean> {
  return (await checkRepo(get, fullName)) === 'quest';
}

/**
 * Scans the App's repos, again and again if asked (the next-steps checklist polls while the
 * user sets things up on GitHub). Repos it has checked aren't asked about again for a while,
 * so a poll costs a call or two, not one per repo. A Quest Log repo stays one.
 */
export class RepoScanner {
  private known = new Map<string, { kind: RepoKind; at: number }>();

  constructor(
    private get: GitHubGet,
    private opts: { recheckMs?: number; now?: () => number } = {},
  ) {}

  async scan(): Promise<SetupScan> {
    const now = this.opts.now?.() ?? Date.now();
    const recheck = this.opts.recheckMs ?? 30_000;
    const { installations, repos } = await installedRepos(this.get);
    const candidates = repos.slice(0, MAX_CANDIDATES);
    const due = candidates.filter((r) => {
      const k = this.known.get(r.fullName);
      return !k || (k.kind !== 'quest' && now - k.at >= recheck);
    });
    let next = 0;
    const worker = async () => {
      while (next < due.length) {
        const r = due[next++];
        try {
          this.known.set(r.fullName, { kind: await checkRepo(this.get, r.fullName), at: now });
        } catch {
          // Can't tell right now: count it as not ours, and ask again next time.
          if (!this.known.has(r.fullName)) this.known.set(r.fullName, { kind: 'other', at: 0 });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, due.length) }, worker));
    return { installations, repos: candidates.map((r) => ({ ...r, kind: this.known.get(r.fullName)?.kind ?? 'other' })) };
  }
}

/** The Quest Log repos among the installed ones. A repo that can't be checked is left out. */
export async function discoverRepos(get: GitHubGet): Promise<{ repos: FoundRepo[]; installed: number }> {
  const { repos } = await new RepoScanner(get).scan();
  return { repos: repos.filter((r) => r.kind === 'quest').map(({ kind: _, ...r }) => r), installed: repos.length };
}
