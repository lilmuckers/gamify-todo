import { resolve } from 'node:path';
import { buildServer } from './app';

const port = Number(process.env.PORT ?? 8787);
const repoDir = resolve(process.env.REPO_DIR ?? resolve(import.meta.dirname, '../..'));
const staticDir = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : undefined;
const allowedHosts = process.env.ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean);

const app = await buildServer({
  repoDir,
  staticDir,
  githubToken: process.env.GITHUB_TOKEN || undefined,
  allowedHosts,
  logger: true,
});
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
app.log.info(`Quest Log editor on :${port}, repo ${repoDir}${process.env.GITHUB_TOKEN ? ', PR review enabled' : ''}`);
