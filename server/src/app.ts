import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  GitHubClient,
  GitHubError,
  parseRepo,
  validateFiles,
  type MergeMethod,
  type ReviewEvent,
} from '@quest/shared';
import { isDataPath, Repo } from './repo';

export interface ServerOptions {
  repoDir: string;
  staticDir?: string;
  githubToken?: string;
  /** Host header values accepted (DNS-rebinding guard). */
  allowedHosts?: string[];
  logger?: boolean;
}

/** Tiny async mutex so concurrent saves can't interleave file writes and commits. */
function mutex() {
  let last = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = last.then(fn, fn);
    last = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024 });
  const repo = new Repo(opts.repoDir);
  const exclusive = mutex();
  const allowed = new Set((opts.allowedHosts ?? ['localhost', '127.0.0.1', '[::1]']).map((h) => h.toLowerCase()));

  const github = async () => {
    if (!opts.githubToken) return undefined;
    const url = await repo.remoteUrl();
    const branch = (await repo.git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    const ref = url ? parseRepo(url, branch) : undefined;
    return ref ? new GitHubClient(opts.githubToken, ref) : undefined;
  };

  // Mutations need our custom header (forces a CORS preflight, which we never
  // answer) and a same-origin Origin. Every request needs an allowed Host.
  app.addHook('onRequest', async (req, reply) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    if (!allowed.has(host)) return reply.code(403).send({ error: `Host ${host} not allowed (set ALLOWED_HOSTS)` });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.headers['x-quest-client'] !== '1') return reply.code(403).send({ error: 'Missing X-Quest-Client header' });
      const origin = req.headers.origin;
      if (origin && new URL(origin).host.toLowerCase() !== (req.headers.host ?? '').toLowerCase())
        return reply.code(403).send({ error: 'Cross-origin request refused' });
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err instanceof GitHubError ? (err.status >= 500 ? 502 : err.status) : (err.statusCode ?? 500);
    reply.code(status).send({ error: err.message });
  });

  app.get('/api/game', async () => {
    const files = await repo.readFiles();
    return { files, version: Repo.version(files) };
  });

  app.post<{ Body: { changes: Record<string, string | null>; message: string; baseVersion: string } }>(
    '/api/commit',
    async (req, reply) => {
      const { changes, message, baseVersion } = req.body ?? ({} as never);
      if (!changes || typeof message !== 'string' || typeof baseVersion !== 'string')
        return reply.code(400).send({ error: 'changes, message and baseVersion required' });
      const paths = Object.keys(changes);
      const bad = paths.find((p) => !isDataPath(p));
      if (bad) return reply.code(400).send({ error: `Refusing to write ${bad}` });
      return exclusive(async () => {
        const current = await repo.readFiles();
        if (Repo.version(current) !== baseVersion) return reply.code(409).send({ error: 'Data changed on disk; reload' });
        const next = { ...current };
        for (const [p, c] of Object.entries(changes)) {
          if (c === null) delete next[p];
          else next[p] = c;
        }
        const issues = validateFiles(next);
        if (issues.length)
          return reply.code(400).send({ error: `Invalid data: ${issues[0].file}${issues[0].path} ${issues[0].message}`, issues });
        await repo.write(changes);
        const sha = await repo.commit(paths, message.slice(0, 5000));
        return { version: Repo.version(next), commit: sha };
      });
    },
  );

  app.get('/api/status', async () => {
    const s = await repo.git.status();
    const log = await repo.git.log({ maxCount: 1 }).catch(() => undefined);
    const last = log?.latest;
    return {
      branch: s.current ?? 'HEAD',
      ahead: s.ahead,
      behind: s.behind,
      remote: s.tracking ?? undefined,
      lastCommit: last ? { sha: last.hash, message: last.message, date: last.date } : undefined,
      canReviewPRs: !!(await github()),
    };
  });

  app.post('/api/publish', async () =>
    exclusive(async () => {
      await repo.git.fetch();
      const before = await repo.git.status();
      if (before.behind > 0) await repo.git.pull(['--rebase', '--autostash']);
      await repo.git.push();
      const after = await repo.git.status();
      return { message: `Published ${before.ahead} commit(s) to ${after.tracking ?? 'remote'}` };
    }),
  );

  app.get('/api/prs', async (_req, reply) => {
    const gh = await github();
    if (!gh) return reply.code(501).send({ error: 'Set GITHUB_TOKEN to review PRs' });
    return gh.listDataPulls();
  });

  app.get<{ Params: { n: string } }>('/api/prs/:n', async (req, reply) => {
    const gh = await github();
    if (!gh) return reply.code(501).send({ error: 'Set GITHUB_TOKEN to review PRs' });
    const detail = await gh.pull(Number(req.params.n));
    const [base, head] = await Promise.all([
      gh.headSha(detail.baseRef).then((sha) => gh.readDataAt(sha)),
      gh.readDataAt(detail.headSha, detail.headRepo),
    ]);
    return { detail, base, head };
  });

  app.post<{ Params: { n: string }; Body: { method: MergeMethod; sha: string } }>('/api/prs/:n/merge', async (req, reply) => {
    const gh = await github();
    if (!gh) return reply.code(501).send({ error: 'Set GITHUB_TOKEN to review PRs' });
    const { method, sha } = req.body ?? ({} as never);
    if (!['merge', 'squash', 'rebase'].includes(method) || !sha) return reply.code(400).send({ error: 'method and sha required' });
    await gh.merge(Number(req.params.n), method, sha);
    // Bring the merged data into the local checkout.
    return exclusive(async () => {
      try {
        await repo.git.pull(['--rebase', '--autostash']);
        return { merged: true };
      } catch (err) {
        return { merged: true, warning: `Merged on GitHub, but local pull failed: ${(err as Error).message}` };
      }
    });
  });

  app.post<{ Params: { n: string }; Body: { event: ReviewEvent; body: string } }>('/api/prs/:n/review', async (req, reply) => {
    const gh = await github();
    if (!gh) return reply.code(501).send({ error: 'Set GITHUB_TOKEN to review PRs' });
    const { event, body } = req.body ?? ({} as never);
    if (!['APPROVE', 'COMMENT', 'REQUEST_CHANGES'].includes(event)) return reply.code(400).send({ error: 'bad event' });
    await gh.review(Number(req.params.n), event, body ?? '');
    return { ok: true };
  });

  if (opts.staticDir && existsSync(join(opts.staticDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: opts.staticDir, prefix: '/' });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html'),
    );
  }

  return app;
}
