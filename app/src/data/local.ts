import {
  ConflictError,
  fromFiles,
  type HistoryCommit,
  type CommitChanges,
  type ScanProgress,
  type MergeMethod,
  type PullDetail,
  type PullSummary,
  type ReviewEvent,
} from '@quest/shared';
import type { DataSource, Loaded, LocalStatus, PullData } from './source';

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    // The server refuses mutations without this header (CSRF guard).
    headers: { 'X-Quest-Client': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 409) throw new ConflictError();
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${method} ${path}: ${res.status}`);
  return data;
}

/** Docker editor: the server writes files into the mounted repo and commits. */
export class LocalApiSource implements DataSource {
  id = 'local';
  label = 'Local repo';
  caps = { canEdit: true, canReviewPRs: false, canPublish: true };

  async init(): Promise<this> {
    try {
      const s = await this.status();
      this.caps.canReviewPRs = s.canReviewPRs;
    } catch {
      /* offline or server down; store falls back to the cached snapshot */
    }
    return this;
  }

  async load(): Promise<Loaded> {
    const r = await api<{ files: Record<string, string>; version: string }>('GET', '/game');
    return { state: fromFiles(r.files), version: r.version };
  }

  async commit(changes: Record<string, string | null>, message: string, baseVersion: string) {
    const r = await api<{ version: string }>('POST', '/commit', { changes, message, baseVersion });
    return r.version;
  }

  publish() {
    return api<{ message: string }>('POST', '/publish').then((r) => r.message);
  }

  status() {
    return api<LocalStatus>('GET', '/status');
  }

  history(since?: string) {
    return api<HistoryCommit[]>('GET', `/history${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  }

  /** Pages through the server's git log so the scan can show progress (up to 5,000 commits). */
  async changes(opts: { since?: string; onProgress?: (p: ScanProgress) => void }) {
    const out: CommitChanges[] = [];
    const q = (skip: number) => `/history/changes?skip=${skip}&limit=50${opts.since ? `&since=${encodeURIComponent(opts.since)}` : ''}`;
    for (let skip = 0; skip < 5000; skip += 50) {
      const page = await api<{ total: number; commits: CommitChanges[] }>('GET', q(skip));
      out.push(...page.commits);
      opts.onProgress?.({ phase: 'comparing', done: out.length, total: Math.min(page.total, 5000), detail: page.commits.at(-1)?.files[0]?.path.replace(/^data\/|\.json$/g, '') });
      if (page.commits.length < 50) break;
    }
    return out.reverse();
  }

  pulls = {
    list: () => api<PullSummary[]>('GET', '/prs'),
    load: async (n: number): Promise<PullData> => {
      const r = await api<{ detail: PullDetail; base: Record<string, string>; head: Record<string, string> }>(
        'GET',
        `/prs/${n}`,
      );
      return { detail: r.detail, base: fromFiles(r.base), head: fromFiles(r.head) };
    },
    merge: (n: number, method: MergeMethod, sha: string) =>
      api<void>('POST', `/prs/${n}/merge`, { method, sha }),
    review: (n: number, event: ReviewEvent, body: string) =>
      api<void>('POST', `/prs/${n}/review`, { event, body }),
  };
}
