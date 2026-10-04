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
export async function installedRepos(get: GitHubGet): Promise<FoundRepo[]> {
  const { installations } = await get<{ installations: { id: number }[] }>(`${API}/user/installations?per_page=100`);
  const lists = await Promise.all(
    installations.map((i) => get<{ repositories: ApiRepo[] }>(`${API}/user/installations/${i.id}/repositories?per_page=100`)),
  );
  const seen = new Map<string, FoundRepo>();
  for (const r of lists.flatMap((l) => l.repositories)) {
    seen.set(r.full_name, { fullName: r.full_name, owner: r.owner.login, name: r.name, private: r.private, pushedAt: r.pushed_at ?? undefined });
  }
  return [...seen.values()].sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
}

/**
 * Whether a repo holds Quest Log data: `data/settings.json` or `data/inbox.json` (the
 * template ships settings.json), or a `data/<project>/project.json`. Doesn't rely on
 * `template_repository`, which misses hand-made and older repos.
 */
export async function isQuestRepo(get: GitHubGet, fullName: string): Promise<boolean> {
  let entries: { name: string; type: string }[];
  try {
    entries = await get(`${API}/repos/${fullName}/contents/data`);
  } catch (err) {
    // 404: no data/ folder. 409: an empty repo. Either way, not ours (yet).
    if (err instanceof GitHubError && (err.status === 404 || err.status === 409)) return false;
    throw err;
  }
  if (!Array.isArray(entries)) return false;
  if (entries.some((e) => e.type === 'file' && (e.name === 'settings.json' || e.name === 'inbox.json'))) return true;
  for (const dir of entries.filter((e) => e.type === 'dir').slice(0, MAX_FOLDERS)) {
    try {
      await get(`${API}/repos/${fullName}/contents/data/${encodeURIComponent(dir.name)}/project.json`);
      return true;
    } catch (err) {
      if (!(err instanceof GitHubError && err.status === 404)) throw err;
    }
  }
  return false;
}

/** The Quest Log repos among the installed ones. A repo that can't be checked is left out. */
export async function discoverRepos(get: GitHubGet): Promise<{ repos: FoundRepo[]; installed: number }> {
  const all = await installedRepos(get);
  const candidates = all.slice(0, MAX_CANDIDATES);
  const found: boolean[] = new Array(candidates.length).fill(false);
  let next = 0;
  const worker = async () => {
    while (next < candidates.length) {
      const i = next++;
      found[i] = await isQuestRepo(get, candidates[i].fullName).catch(() => false);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, candidates.length) }, worker));
  return { repos: candidates.filter((_, i) => found[i]), installed: all.length };
}
