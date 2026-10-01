import { parseRepo, type RepoRef } from '@quest/shared';

/** 'local' = Docker editor talking to /api. 'pages' = static site, optional GitHub token. */
export const TARGET: 'local' | 'pages' = import.meta.env.VITE_TARGET === 'local' ? 'local' : 'pages';
export const BASE_URL: string = import.meta.env.BASE_URL;

const DEFAULT_REPO = import.meta.env.VITE_GH_REPO as string | undefined;
const DEFAULT_BRANCH = (import.meta.env.VITE_GH_BRANCH as string | undefined) ?? 'main';

const TOKEN_KEY = 'quest.github.token';
const REPO_KEY = 'quest.github.repo';
const BRANCH_KEY = 'quest.github.branch';
const RESOLVED_BRANCH_KEY = 'quest.github.branch.resolved';
const UI_KEY = 'quest.ui';
const HERO_KEY = 'quest.hero';

function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string | undefined) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage blocked: token only lives for this session */
  }
}

// The token never leaves this browser except as an Authorization header to api.github.com.
export const tokenStore = {
  get: () => read(TOKEN_KEY),
  set: (token: string | undefined) => write(TOKEN_KEY, token?.trim()),
};

/**
 * Repo holding the quest data: the one the user chose in Settings (their own
 * repo works; no need to fork this project), else the repo this site deploys from.
 */
export function repoRef(): RepoRef | undefined {
  const saved = read(REPO_KEY);
  return parseRepo(saved ?? DEFAULT_REPO ?? '', read(BRANCH_KEY) || read(RESOLVED_BRANCH_KEY) || DEFAULT_BRANCH);
}

/** Branch explicitly chosen in Settings; empty = the repo's default branch. */
export function chosenBranch(): string | undefined {
  return read(BRANCH_KEY) || undefined;
}

export function setRepo(value: string | undefined, branch?: string) {
  write(REPO_KEY, value?.trim());
  write(BRANCH_KEY, branch?.trim());
  write(RESOLVED_BRANCH_KEY, undefined);
}

/** Remembers the default branch so offline starts use the right one. */
export function rememberBranch(branch: string) {
  write(RESOLVED_BRANCH_KEY, branch);
}

/** This browser's choice of player character (next to the token, never sent anywhere). */
export const heroStore = {
  get: () => read(HERO_KEY),
  set: (id: string | undefined) => write(HERO_KEY, id),
};

export interface UiPrefs {
  mobile?: 'auto' | 'on' | 'off';
  /** Google Analytics; undefined = default (on, unless Global Privacy Control). */
  analytics?: boolean;
}

export function uiPrefs(): UiPrefs {
  try {
    return JSON.parse(read(UI_KEY) ?? '{}') as UiPrefs;
  } catch {
    return {};
  }
}

export function setUiPrefs(prefs: UiPrefs) {
  write(UI_KEY, JSON.stringify(prefs));
}
