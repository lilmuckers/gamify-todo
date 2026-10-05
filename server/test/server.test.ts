import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { simpleGit } from 'simple-git';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/app';

const root = resolve(import.meta.dirname, '../..');
let dir: string;
let app: FastifyInstance;
const H = { host: 'localhost', 'x-quest-client': '1' };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'quest-'));
  cpSync(join(root, 'data'), join(dir, 'data'), { recursive: true });
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.name', 'Test');
  await git.addConfig('user.email', 'test@example.com');
  await git.add('.');
  await git.commit('seed');
  app = await buildServer({ repoDir: dir });
});

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

async function game() {
  const r = await app.inject({ method: 'GET', url: '/api/game', headers: { host: 'localhost' } });
  return r.json() as { files: Record<string, string>; version: string };
}

describe('server', () => {
  it('serves data files with a version', async () => {
    const g = await game();
    expect(Object.keys(g.files)).toContain('data/kitchen-renovation/project.json');
    expect(Object.keys(g.files)).toContain('data/kitchen-renovation/plan/budget.json');
    expect(g.version).toMatch(/^[0-9a-f]{40}$/);
  });

  it('writes, validates and commits changes', async () => {
    const g = await game();
    const game_ = JSON.parse(g.files['data/kitchen-renovation/project.json']);
    game_.title = 'Renamed Quest';
    const r = await app.inject({
      method: 'POST',
      url: '/api/commit',
      headers: H,
      payload: { changes: { 'data/kitchen-renovation/project.json': JSON.stringify(game_, null, 2) + '\n' }, message: 'quest: rename', baseVersion: g.version },
    });
    expect(r.statusCode).toBe(200);
    expect(readFileSync(join(dir, 'data/kitchen-renovation/project.json'), 'utf8')).toContain('Renamed Quest');
    const log = await simpleGit(dir).log({ maxCount: 1 });
    expect(log.latest?.message).toBe('quest: rename');
  });

  it('creates and deletes whole project folders', async () => {
    let g = await game();
    const project = { id: 'house', title: 'House', goals: [], worldOrder: [] };
    const add = await app.inject({
      method: 'POST', url: '/api/commit', headers: H,
      payload: { changes: { 'data/house/project.json': JSON.stringify(project) }, message: 'quest: add house', baseVersion: g.version },
    });
    expect(add.statusCode).toBe(200);
    g = await game();
    const del = await app.inject({
      method: 'POST', url: '/api/commit', headers: H,
      payload: { changes: { 'data/house/project.json': null }, message: 'quest: drop house', baseVersion: g.version },
    });
    expect(del.statusCode).toBe(200);
    expect(existsSync(join(dir, 'data/house'))).toBe(false);
  });

  it('rejects stale versions with 409', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/commit',
      headers: H,
      payload: { changes: {}, message: 'x', baseVersion: 'stale' },
    });
    expect(r.statusCode).toBe(409);
  });

  it('rejects invalid data and non-data paths', async () => {
    const g = await game();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/commit',
      headers: H,
      payload: { changes: { 'data/kitchen-renovation/project.json': '{"title":"x"}' }, message: 'x', baseVersion: g.version },
    });
    expect(bad.statusCode).toBe(400);
    const escape = await app.inject({
      method: 'POST',
      url: '/api/commit',
      headers: H,
      payload: { changes: { '../../etc/passwd': 'x' }, message: 'x', baseVersion: g.version },
    });
    expect(escape.statusCode).toBe(400);
  });

  it('blocks CSRF and DNS rebinding', async () => {
    const noHeader = await app.inject({ method: 'POST', url: '/api/publish', headers: { host: 'localhost' } });
    expect(noHeader.statusCode).toBe(403);
    const crossOrigin = await app.inject({
      method: 'POST',
      url: '/api/publish',
      headers: { ...H, origin: 'https://evil.example' },
    });
    expect(crossOrigin.statusCode).toBe(403);
    const rebind = await app.inject({ method: 'GET', url: '/api/game', headers: { host: 'evil.example' } });
    expect(rebind.statusCode).toBe(403);
  });

  it('lists data commits for the stats history', async () => {
    const all = await app.inject({ method: 'GET', url: '/api/history', headers: { host: 'localhost' } });
    expect(all.statusCode).toBe(200);
    const commits = all.json() as { sha: string; date: string; message: string }[];
    expect(commits.map((c) => c.message)).toContain('quest: rename');
    expect(commits.at(-1)?.message).toBe('seed');
    expect(commits[0].sha).toMatch(/^[0-9a-f]{40}$/);
    expect(Number.isNaN(Date.parse(commits[0].date))).toBe(false);
    const none = await app.inject({ method: 'GET', url: '/api/history?since=2099-01-01T00:00:00Z', headers: { host: 'localhost' } });
    expect(none.json()).toEqual([]);
    const bad = await app.inject({ method: 'GET', url: '/api/history?since=yesterday-ish', headers: { host: 'localhost' } });
    expect(bad.statusCode).toBe(400);
  });

  it('reports PR review unavailable without a token', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/prs', headers: { host: 'localhost' } });
    expect(r.statusCode).toBe(501);
    const s = await app.inject({ method: 'GET', url: '/api/status', headers: { host: 'localhost' } });
    expect(s.json().canReviewPRs).toBe(false);
  });
});
