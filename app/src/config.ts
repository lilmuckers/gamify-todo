import { parseRepo, type RepoRef } from '@quest/shared';

/** 'local' = Docker editor talking to /api. 'pages' = static site, optional GitHub token. */
export const TARGET: 'local' | 'pages' = import.meta.env.VITE_TARGET === 'local' ? 'local' : 'pages';
export const BASE_URL: string = import.meta.env.BASE_URL;

const DEFAULT_REPO = import.meta.env.VITE_GH_REPO as string | undefined;
const DEFAULT_BRANCH = (import.meta.env.VITE_GH_BRANCH as string | undefined) ?? 'main';

const TOKEN_KEY = 'quest.github.token';
const REPO_KEY = 'quest.github.repo';
const UI_KEY = 'quest.ui';

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

export function repoRef(): RepoRef | undefined {
  const saved = read(REPO_KEY);
  return parseRepo(saved ?? DEFAULT_REPO ?? '', DEFAULT_BRANCH);
}

export function setRepo(value: string | undefined) {
  write(REPO_KEY, value?.trim());
}

export interface UiPrefs {
  mobile?: 'auto' | 'on' | 'off';
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
