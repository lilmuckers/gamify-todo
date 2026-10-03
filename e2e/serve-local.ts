/**
 * The local editor for end-to-end tests: the server from server/, in front of
 * a fresh git repo seeded with this repo's data/, serving the e2e build.
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { simpleGit } from 'simple-git';
import { buildServer } from '../server/src/app';
import { E2E_REPO, LOCAL_PORT } from './paths';

const root = resolve(import.meta.dirname, '..');
rmSync(E2E_REPO, { recursive: true, force: true });
mkdirSync(E2E_REPO, { recursive: true });
cpSync(join(root, 'data'), join(E2E_REPO, 'data'), { recursive: true });
const git = simpleGit(E2E_REPO);
await git.init();
await git.addConfig('user.name', 'E2E');
await git.addConfig('user.email', 'e2e@example.com');
await git.add('.');
await git.commit('seed');

const app = await buildServer({ repoDir: E2E_REPO, staticDir: join(root, 'app/dist-e2e-local') });
await app.listen({ port: LOCAL_PORT, host: '127.0.0.1' });
console.log(`e2e editor on :${LOCAL_PORT}, repo ${E2E_REPO}`);
