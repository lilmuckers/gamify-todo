import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Page, Route } from '@playwright/test';

/**
 * Stand-ins for GitHub and the sign-in Worker, for Sign in with GitHub tests. The Pages e2e
 * build points at `AUTH_URL` with a made-up App; these routes answer for it, for
 * github.com's authorize page and for the bits of api.github.com the app uses. Repos live in
 * memory, seeded from `data/`, and commits land there so tests can check them.
 */

export const AUTH_URL = 'https://auth.quest.test';
const API = 'https://api.github.com';
const ROOT = resolve(import.meta.dirname, '..');

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

/** Every file under data/, as repo paths. */
function exampleFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (name.endsWith('.json')) files[relative(ROOT, abs).split(sep).join('/')] = readFileSync(abs, 'utf8');
    }
  };
  walk(join(ROOT, 'data'));
  return files;
}

interface Commit {
  tree: string;
  message: string;
  parent?: string;
  /** The Authorization header that made it. */
  auth?: string;
}

class FakeRepo {
  trees = new Map<string, Record<string, string>>();
  commits = new Map<string, Commit>();
  head: string;

  constructor(
    public owner: string,
    public name: string,
    files: Record<string, string>,
  ) {
    const tree = this.addTree(files);
    this.head = sha1(`root:${owner}/${name}`);
    this.commits.set(this.head, { tree, message: 'Initial commit' });
  }

  addTree(files: Record<string, string>) {
    const sha = sha1(JSON.stringify(Object.entries(files).sort()));
    this.trees.set(sha, files);
    return sha;
  }

  files(sha = this.head) {
    return this.trees.get(this.commits.get(sha)!.tree)!;
  }

  /** Commits made by the app, oldest first. */
  appCommits() {
    const out: Commit[] = [];
    for (let c = this.commits.get(this.head); c?.parent; c = this.commits.get(c.parent)) out.unshift(c);
    return out;
  }
}

export interface FakeOptions {
  /** Repos the App is installed on. `quest: false` gives a repo with no Quest Log data. */
  repos: { owner: string; name: string; quest?: boolean }[];
  /** False: the user hasn't installed the App anywhere yet (until `addRepo`). */
  installed?: boolean;
}

export class FakeGitHub {
  repos = new Map<string, FakeRepo>();
  /** Access tokens GitHub accepts right now. */
  valid = new Set<string>();
  /** Refresh tokens the Worker can trade right now. */
  refreshable = new Set<string>();
  refreshes = 0;
  exchanges = 0;
  /** Authorization headers api.github.com saw. */
  seen: string[] = [];
  private n = 0;
  private challenges = new Map<string, string>();
  installed: boolean;

  constructor(opts: FakeOptions) {
    this.installed = opts.installed ?? true;
    for (const r of opts.repos) this.addRepo(r);
  }

  /** Gives the App a repo, as the user would on GitHub (installing it first if need be). */
  addRepo(r: { owner: string; name: string; quest?: boolean }) {
    // A plain repo has a README, so it isn't empty.
    const files = r.quest === false ? { 'README.md': '# Notes\n' } : exampleFiles();
    this.repos.set(`${r.owner}/${r.name}`, new FakeRepo(r.owner, r.name, files));
    this.installed = true;
  }

  repo(full: string) {
    return this.repos.get(full)!;
  }

  /** A session as the app stores it, already accepted (or not) by GitHub and the Worker. */
  session(opts: { expired?: boolean } = {}) {
    const access = `ghu_seed${++this.n}`;
    const refresh = `ghr_seed${this.n}`;
    if (!opts.expired) this.valid.add(access);
    this.refreshable.add(refresh);
    return {
      kind: 'app',
      token: access,
      refresh,
      expiresAt: Date.now() + (opts.expired ? -60_000 : 8 * 3600_000),
      refreshExpiresAt: Date.now() + 180 * 86400_000,
    };
  }

  /** Revokes every token: GitHub answers 401 and the Worker can't refresh. */
  revokeAll() {
    this.valid.clear();
    this.refreshable.clear();
  }

  private issue() {
    const n = ++this.n;
    this.valid.add(`ghu_${n}`);
    this.refreshable.add(`ghr_${n}`);
    return { access_token: `ghu_${n}`, refresh_token: `ghr_${n}`, expires_in: 28800, refresh_token_expires_in: 15897600 };
  }

  async install(page: Page) {
    await page.route('https://github.com/login/oauth/authorize?**', (route) => this.authorize(route));
    await page.route(`${AUTH_URL}/**`, (route) => this.worker(route));
    await page.route(`${API}/**`, (route) => this.api(route));
  }

  /** github.com's authorize page: says yes at once and sends the user back with a code. */
  private authorize(route: Route) {
    const url = new URL(route.request().url());
    const code = `code_${++this.n}`;
    this.challenges.set(code, url.searchParams.get('code_challenge') ?? '');
    const back = new URL(url.searchParams.get('redirect_uri')!);
    back.searchParams.set('code', code);
    back.searchParams.set('state', url.searchParams.get('state') ?? '');
    return route.fulfill({ status: 302, headers: { Location: back.href } });
  }

  private worker(route: Route) {
    const req = route.request();
    const cors = { 'Access-Control-Allow-Origin': req.headers().origin ?? '*', Vary: 'Origin' };
    if (req.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
    const reply = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const body = JSON.parse(req.postData() ?? '{}') as Record<string, string>;
    const path = new URL(req.url()).pathname;
    if (path === '/exchange') {
      this.exchanges++;
      const challenge = this.challenges.get(body.code);
      this.challenges.delete(body.code);
      const s256 = createHash('sha256').update(body.code_verifier ?? '').digest('base64url');
      if (!challenge || challenge !== s256) return reply(400, { error: 'bad_verification_code' });
      return reply(200, this.issue());
    }
    if (path === '/refresh') {
      this.refreshes++;
      if (!this.refreshable.delete(body.refresh_token)) return reply(401, { error: 'bad_refresh_token' });
      return reply(200, this.issue());
    }
    return reply(404, { error: 'not_found' });
  }

  private api(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const auth = req.headers().authorization ?? '';
    this.seen.push(auth);
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!this.valid.has(auth.replace(/^Bearer /, ''))) return json(401, { message: 'Bad credentials' });

    if (path === '/user') return json(200, { login: 'player' });
    if (path === '/user/installations') return json(200, { installations: this.installed ? [{ id: 1 }] : [] });
    if (path === '/user/installations/1/repositories')
      return json(200, {
        repositories: [...this.repos.values()].map((r, i) => ({
          full_name: `${r.owner}/${r.name}`,
          name: r.name,
          owner: { login: r.owner },
          private: true,
          pushed_at: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(),
        })),
      });

    const m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(path);
    const repo = m && this.repos.get(m[1]);
    if (!repo) return json(404, { message: 'Not Found' });
    const rest = m![2] ?? '';
    const method = req.method();

    if (rest === '') return json(200, { default_branch: 'main', permissions: { push: true } });
    if (rest === '/commits') return json(200, [{ sha: repo.head }]);
    if (rest === '/pulls') return json(200, []);
    if (rest.startsWith('/contents/')) {
      const dir = rest.slice('/contents/'.length);
      const files = Object.keys(repo.files());
      if (files.includes(dir)) return json(200, { name: dir.split('/').pop(), type: 'file' });
      const names = new Map<string, string>();
      for (const f of files.filter((f) => f.startsWith(`${dir}/`))) {
        const [first, ...more] = f.slice(dir.length + 1).split('/');
        names.set(first, more.length ? 'dir' : 'file');
      }
      return names.size ? json(200, [...names].map(([name, type]) => ({ name, type }))) : json(404, { message: 'Not Found' });
    }
    if (rest === '/git/ref/heads/main') return json(200, { object: { sha: repo.head } });
    if (rest.startsWith('/compare/')) return json(200, { status: 'behind' });
    let g = /^\/git\/trees\/(\w+)$/.exec(rest);
    if (g && method === 'GET') {
      const files = repo.files(g[1]);
      return json(200, { truncated: false, tree: Object.entries(files).map(([p, c]) => ({ path: p, sha: sha1(`blob:${c}`), type: 'blob' })) });
    }
    g = /^\/git\/blobs\/(\w+)$/.exec(rest);
    if (g) {
      for (const files of repo.trees.values())
        for (const c of Object.values(files)) if (sha1(`blob:${c}`) === g[1]) return route.fulfill({ status: 200, contentType: 'application/vnd.github.raw+json', body: c });
      return json(404, { message: 'Not Found' });
    }
    g = /^\/git\/commits\/(\w+)$/.exec(rest);
    if (g) {
      const c = repo.commits.get(g[1]);
      return c ? json(200, { sha: g[1], tree: { sha: c.tree } }) : json(404, { message: 'Not Found' });
    }
    const body = JSON.parse(req.postData() ?? '{}');
    if (rest === '/git/trees' && method === 'POST') {
      const files = { ...repo.trees.get(body.base_tree) };
      for (const e of body.tree as { path: string; content?: string; sha?: null }[]) {
        if (e.sha === null) delete files[e.path];
        else files[e.path] = e.content!;
      }
      return json(201, { sha: repo.addTree(files) });
    }
    if (rest === '/git/commits' && method === 'POST') {
      const sha = sha1(`${body.tree}:${body.parents[0]}:${body.message}`);
      repo.commits.set(sha, { tree: body.tree, message: body.message, parent: body.parents[0], auth });
      return json(201, { sha });
    }
    if (rest === '/git/refs/heads/main' && method === 'PATCH') {
      if (repo.commits.get(body.sha)?.parent !== repo.head) return json(422, { message: 'Update is not a fast forward' });
      repo.head = body.sha;
      return json(200, { object: { sha: body.sha } });
    }
    return json(404, { message: `Not Found (fake): ${method} ${path}` });
  }
}
