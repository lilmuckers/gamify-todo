import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { toFiles, validateFiles } from '../src/index';
import { level, workspace } from './fixtures';

const ROOT = resolve(import.meta.dirname, '../..');
const SCRIPT = join(ROOT, 'skills/quest-log/scripts/quest.py');
const SCHEMAS = join(ROOT, 'schema');
/** Run with the jsonschema package (if installed) and with the built-in validator. */
const ENGINES: Record<string, string>[] = [{}, { QUEST_NO_JSONSCHEMA: '1' }];

function run(
  args: string[],
  env: Record<string, string> = {},
  cwd = ROOT,
  script = SCRIPT,
  schemaArgs = ['--schemas', SCHEMAS],
): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    const p = spawn('python3', [script, ...schemaArgs, ...args], {
      cwd,
      env: { PATH: process.env.PATH!, HOME: tmpdir(), QUEST_SITE: 'http://127.0.0.1:9/', PYTHONDONTWRITEBYTECODE: '1', ...env },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => done({ code: code ?? -1, out }));
  });
}

function writeTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'quest-tree-'));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}

describe('quest.py validate', () => {
  it('accepts the committed example data with both validators', async () => {
    for (const env of ENGINES) {
      const r = await run(['validate', '.'], env);
      expect(r.out).toMatch(/data file\(s\) valid/);
      expect(r.code).toBe(0);
    }
  });

  // Each mutation must be rejected by both the app's validator and the script.
  const good = () => toFiles(workspace());
  const lvl = 'data/p/w/lvl.json';
  const edit = (files: Record<string, string>, path: string, fn: (d: any) => void) => {
    const d = JSON.parse(files[path]);
    fn(d);
    files[path] = JSON.stringify(d, null, 2);
    return files;
  };
  const cases: [string, () => Record<string, string>, RegExp][] = [
    ['unexpected property', () => edit(good(), lvl, (d) => (d.items[0].priority = 'high')), /priority/],
    ['bad id', () => edit(good(), lvl, (d) => (d.items[0].id = 'Bad Id')), /must match|does not match/],
    ['bad item type', () => edit(good(), lvl, (d) => (d.items[0].type = 'bug')), /one of|not valid/],
    ['time-box over 90', () => edit(good(), lvl, (d) => (d.timeboxDays = 100)), /90/],
    ['bad timestamp', () => edit(good(), lvl, (d) => (d.startedAt = 'yesterday')), /date-time/],
    ['dangling dependsOn', () => edit(good(), lvl, (d) => (d.items[0].dependsOn = ['ghost'])), /unknown item "ghost"/],
    ['cycle', () => edit(good(), lvl, (d) => ((d.items[0].dependsOn = ['b']), (d.items[1].dependsOn = ['a']))), /cycle/],
    ['no MVP criterion', () => edit(good(), lvl, (d) => d.successCriteria.forEach((c: any) => (c.mvp = false))), /mvp/],
    ['unknown levelRef', () => edit(good(), lvl, (d) => (d.items[0].levelRef = 'w/missing')), /unknown level/],
    ['id does not match file', () => edit(good(), lvl, (d) => (d.id = 'other')), /must match/],
    ['level missing from levelOrder', () => ({ ...good(), 'data/p/w/extra.json': good()[lvl].replace('"id": "lvl"', '"id": "extra"') }), /missing from levelOrder/],
    ['stray file', () => ({ ...good(), 'data/notes.json': '{}' }), /unexpected file/],
    ['invalid JSON', () => ({ ...good(), [lvl]: '{nope' }), /invalid JSON/],
    ['subtasks on a task', () => edit(good(), lvl, (d) => (d.items[0].subtasks = [{ id: 's', type: 'task', title: 'S', status: 'todo' }])), /only dependency items/],
    ['nested dependency step', () => edit(good(), lvl, (d) => ((d.items[0].type = 'dependency'), (d.items[0].subtasks = [{ id: 's', type: 'dependency', title: 'S', status: 'todo' }]))), /one of|not valid/],
    ['dangling step dependsOn', () => edit(good(), lvl, (d) => ((d.items[0].type = 'dependency'), (d.items[0].subtasks = [{ id: 's', type: 'task', title: 'S', status: 'todo', dependsOn: ['x'] }]))), /unknown subtask "x"/],
    ['level depends on itself', () => edit(good(), lvl, (d) => ((d.items[0].type = 'dependency'), (d.items[0].levelRef = 'w/lvl'))), /cannot depend on itself/],
  ];

  it('accepts the fixture', async () => {
    const r = await run(['validate', writeTree(good())], { QUEST_NO_JSONSCHEMA: '1' });
    expect(r.code).toBe(0);
  });

  for (const [name, make, pattern] of cases)
    it(`rejects: ${name} (agrees with the app)`, async () => {
      const files = make();
      expect(validateFiles(files).length).toBeGreaterThan(0);
      for (const env of ENGINES) {
        const r = await run(['validate', writeTree(files)], env);
        expect(r.code, r.out).toBe(1);
        expect(r.out).toMatch(pattern);
      }
    });
});

/** Minimal in-memory GitHub Git Data API, using real git blob SHAs. */
class MockGitHub {
  blobs = new Map<string, string>();
  trees = new Map<string, Record<string, string>>();
  commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  refs = new Map<string, string>();
  pulls: { title: string; head: string; base: string }[] = [];
  server!: Server;
  url = '';

  static blobSha(content: string) {
    const data = Buffer.from(content, 'utf8');
    return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data])).digest('hex');
  }

  addTree(files: Record<string, string>) {
    const tree: Record<string, string> = {};
    for (const [p, c] of Object.entries(files)) {
      const sha = MockGitHub.blobSha(c);
      this.blobs.set(sha, c);
      tree[p] = sha;
    }
    const id = randomUUID().replace(/-/g, '');
    this.trees.set(id, tree);
    return id;
  }

  commitFiles(branch: string, files: Record<string, string>, message = 'seed') {
    const parent = this.refs.get(branch);
    const id = randomUUID().replace(/-/g, '');
    this.commits.set(id, { tree: this.addTree(files), parents: parent ? [parent] : [], message });
    this.refs.set(branch, id);
    return id;
  }

  filesAt(branch: string) {
    const tree = this.trees.get(this.commits.get(this.refs.get(branch)!)!.tree)!;
    return Object.fromEntries(Object.entries(tree).map(([p, s]) => [p, this.blobs.get(s)!]));
  }

  async start() {
    this.server = createServer(async (req, res) => {
      const send = (status: number, body: unknown, raw = false) => {
        res.writeHead(status, { 'Content-Type': raw ? 'text/plain' : 'application/json' });
        res.end(raw ? String(body) : JSON.stringify(body));
      };
      if (req.headers.authorization !== 'Bearer test-token') return send(401, { message: 'Bad credentials' });
      const url = new URL(req.url!, 'http://x');
      const path = url.pathname.replace(/^\/repos\/o\/r/, '');
      const body = await readBody(req);
      let m: RegExpExecArray | null;
      if (req.method === 'GET' && path === '') return send(200, { full_name: 'o/r', default_branch: 'main', permissions: { push: true }, size: 1 });
      if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(path)) && req.method === 'GET') {
        const sha = this.refs.get(decodeURIComponent(m[1]));
        return sha ? send(200, { object: { sha } }) : send(404, { message: 'Not Found' });
      }
      if ((m = /^\/git\/trees\/(\w+)$/.exec(path)) && req.method === 'GET') {
        const tree = this.trees.get(this.commits.get(m[1])?.tree ?? m[1])!;
        return send(200, { tree: Object.entries(tree).map(([p, sha]) => ({ path: p, type: 'blob', sha })) });
      }
      if ((m = /^\/git\/blobs\/(\w+)$/.exec(path))) return send(200, this.blobs.get(m[1]), true);
      if ((m = /^\/git\/commits\/(\w+)$/.exec(path)) && req.method === 'GET') return send(200, { tree: { sha: this.commits.get(m[1])!.tree } });
      if (path === '/git/trees' && req.method === 'POST') {
        const tree = { ...this.trees.get(body.base_tree)! };
        for (const e of body.tree) {
          if (e.sha === null) delete tree[e.path];
          else {
            const sha = MockGitHub.blobSha(e.content);
            this.blobs.set(sha, e.content);
            tree[e.path] = sha;
          }
        }
        const id = randomUUID().replace(/-/g, '');
        this.trees.set(id, tree);
        return send(201, { sha: id });
      }
      if (path === '/git/commits' && req.method === 'POST') {
        const id = randomUUID().replace(/-/g, '');
        this.commits.set(id, { tree: body.tree, parents: body.parents, message: body.message });
        return send(201, { sha: id });
      }
      if ((m = /^\/git\/refs\/heads\/(.+)$/.exec(path)) && req.method === 'PATCH') {
        const branch = decodeURIComponent(m[1]);
        if (this.commits.get(body.sha)!.parents[0] !== this.refs.get(branch)) return send(422, { message: 'Update is not a fast forward' });
        this.refs.set(branch, body.sha);
        return send(200, {});
      }
      if (path === '/git/refs' && req.method === 'POST') {
        this.refs.set(body.ref.replace('refs/heads/', ''), body.sha);
        return send(201, {});
      }
      if (path === '/pulls' && req.method === 'POST') {
        this.pulls.push({ title: body.title, head: body.head, base: body.base });
        return send(201, { number: this.pulls.length, html_url: `https://github.com/o/r/pull/${this.pulls.length}` });
      }
      send(404, { message: `no route ${req.method} ${path}` });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    const addr = this.server.address() as { port: number };
    this.url = `http://127.0.0.1:${addr.port}`;
  }
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((r) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => r(s ? JSON.parse(s) : undefined));
  });
}

describe('quest.py GitHub sync', () => {
  const gh = new MockGitHub();
  let env: Record<string, string>;
  const dirs: string[] = [];
  const fresh = () => {
    const d = mkdtempSync(join(tmpdir(), 'quest-sync-'));
    dirs.push(d);
    return d;
  };
  const lvlPath = (dir: string) => join(dir, 'data/p/w/lvl.json');
  const tick = (dir: string, itemIdx: number, status = 'done') => {
    const d = JSON.parse(readFileSync(lvlPath(dir), 'utf8'));
    d.items[itemIdx].status = status;
    writeFileSync(lvlPath(dir), JSON.stringify(d, null, 2) + '\n');
  };

  beforeAll(async () => {
    await gh.start();
    env = { QUEST_GITHUB_API: gh.url, GITHUB_TOKEN: 'test-token' };
    gh.commitFiles('main', { 'README.md': '# data\n', ...toFiles(workspace()) });
  });
  afterAll(() => {
    gh.server.close();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('needs a token', async () => {
    const r = await run(['info', '--repo', 'o/r'], { QUEST_GITHUB_API: gh.url });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/GITHUB_TOKEN/);
  });

  it('reports repo info without printing the token', async () => {
    const r = await run(['info', '--repo', 'o/r'], env);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ default_branch: 'main', can_push: true });
    expect(r.out).not.toContain('test-token');
  });

  it('pulls data files only, then pushes one atomic commit with just the changed file', async () => {
    const dir = fresh();
    const pulled = await run(['pull', '--repo', 'o/r', '--dir', dir], env);
    expect(pulled.code, pulled.out).toBe(0);
    expect(existsSync(join(dir, 'README.md'))).toBe(false);
    expect(existsSync(lvlPath(dir))).toBe(true);

    const before = gh.refs.get('main');
    tick(dir, 0);
    const pushed = await run(['push', '--dir', dir, '-m', 'quest: done: A (p/w/lvl)'], env);
    expect(pushed.code, pushed.out).toBe(0);
    const head = gh.refs.get('main')!;
    expect(gh.commits.get(head)).toMatchObject({ parents: [before], message: 'quest: done: A (p/w/lvl)' });
    expect(JSON.parse(gh.filesAt('main')['data/p/w/lvl.json']).items[0].status).toBe('done');
    expect(gh.filesAt('main')['README.md']).toBe('# data\n');

    const again = await run(['push', '--dir', dir, '-m', 'noop'], env);
    expect(again.out).toMatch(/Nothing to push/);
  });

  it('commits on top of unrelated remote changes', async () => {
    const dir = fresh();
    await run(['pull', '--repo', 'o/r', '--dir', dir], env);
    const remote = gh.filesAt('main');
    gh.commitFiles('main', { ...remote, 'data/p/project.json': remote['data/p/project.json'].replace('"title": "T"', '"title": "Renamed"') });
    tick(dir, 1, 'doing');
    const r = await run(['push', '--dir', dir, '-m', 'quest: start B'], env);
    expect(r.code, r.out).toBe(0);
    const files = gh.filesAt('main');
    expect(files['data/p/project.json']).toContain('Renamed');
    expect(JSON.parse(files['data/p/w/lvl.json']).items[1].status).toBe('doing');
  });

  it('refuses to overwrite a file someone else changed', async () => {
    const dir = fresh();
    await run(['pull', '--repo', 'o/r', '--dir', dir], env);
    const remote = gh.filesAt('main');
    const lv = JSON.parse(remote['data/p/w/lvl.json']);
    lv.name = 'Changed elsewhere';
    gh.commitFiles('main', { ...remote, 'data/p/w/lvl.json': JSON.stringify(lv, null, 2) + '\n' });
    const head = gh.refs.get('main');
    tick(dir, 2);
    const r = await run(['push', '--dir', dir, '-m', 'clash'], env);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/Remote changed the same file/);
    expect(gh.refs.get('main')).toBe(head);
  });

  it('refuses to push invalid data', async () => {
    const dir = fresh();
    await run(['pull', '--repo', 'o/r', '--dir', dir], env);
    const d = JSON.parse(readFileSync(lvlPath(dir), 'utf8'));
    d.items[0].dependsOn = ['ghost'];
    writeFileSync(lvlPath(dir), JSON.stringify(d));
    const head = gh.refs.get('main');
    const r = await run(['push', '--dir', dir, '-m', 'bad'], env);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/unknown item "ghost"/);
    expect(gh.refs.get('main')).toBe(head);
  });

  it('opens a pull request instead of committing when asked', async () => {
    const dir = fresh();
    await run(['pull', '--repo', 'o/r', '--dir', dir], env);
    const head = gh.refs.get('main');
    tick(dir, 0, 'dropped');
    const r = await run(['push', '--dir', dir, '-m', 'quest: drop A', '--pr', 'Drop A'], env);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/Opened pull request #1/);
    expect(gh.refs.get('main')).toBe(head);
    expect(gh.pulls[0]).toMatchObject({ title: 'Drop A', base: 'main' });
    expect(JSON.parse(gh.filesAt(gh.pulls[0].head)['data/p/w/lvl.json']).items[0].status).toBe('dropped');
  });

  it('deletes files removed locally', async () => {
    const dir = fresh();
    await run(['pull', '--repo', 'o/r', '--dir', dir], env);
    // Add then remove a second level through two pushes.
    const world = JSON.parse(readFileSync(join(dir, 'data/p/w/world.json'), 'utf8'));
    world.levelOrder.push('two');
    writeFileSync(join(dir, 'data/p/w/world.json'), JSON.stringify(world, null, 2) + '\n');
    writeFileSync(join(dir, 'data/p/w/two.json'), JSON.stringify({ ...level({ id: 'two' }) }, null, 2) + '\n');
    expect((await run(['push', '--dir', dir, '-m', 'add two'], env)).code).toBe(0);
    expect(gh.filesAt('main')['data/p/w/two.json']).toBeDefined();
    world.levelOrder.pop();
    writeFileSync(join(dir, 'data/p/w/world.json'), JSON.stringify(world, null, 2) + '\n');
    rmSync(join(dir, 'data/p/w/two.json'));
    const r = await run(['push', '--dir', dir, '-m', 'remove two'], env);
    expect(r.code, r.out).toBe(0);
    expect(gh.filesAt('main')['data/p/w/two.json']).toBeUndefined();
  });
});

describe('quest.py schema loading', () => {
  it('uses schemas bundled in an unzipped skill folder, with no network', async () => {
    const skill = mkdtempSync(join(tmpdir(), 'quest-skill-'));
    mkdirSync(join(skill, 'quest-log/scripts'), { recursive: true });
    mkdirSync(join(skill, 'quest-log/schemas'));
    writeFileSync(join(skill, 'quest-log/scripts/quest.py'), readFileSync(SCRIPT));
    for (const f of ['index.json', 'quest.schema.json', 'project.schema.json', 'world.schema.json', 'level.schema.json'])
      writeFileSync(join(skill, 'quest-log/schemas', f), readFileSync(join(SCHEMAS, f)));
    const r = await run(['validate', ROOT], { QUEST_NO_JSONSCHEMA: '1' }, skill, join(skill, 'quest-log/scripts/quest.py'), []);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(join(skill, 'quest-log/schemas'));
  });

  it('downloads schemas through the manifest when run on its own (the CI template)', async () => {
    // Stand-in for the live site; the manifest's baseUrl is pointed back at it.
    const manifest = JSON.parse(readFileSync(join(SCHEMAS, 'index.json'), 'utf8'));
    let port = 0;
    const site = createServer((req, res) => {
      if (req.url === '/schema/index.json')
        return res.end(JSON.stringify({ ...manifest, baseUrl: `http://127.0.0.1:${port}/schema/` }));
      const file = join(SCHEMAS, req.url!.replace(/^\/schema\//, ''));
      if (!req.url!.startsWith('/schema/') || !existsSync(file)) return res.writeHead(404).end();
      res.end(readFileSync(file));
    });
    await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
    port = (site.address() as { port: number }).port;
    const alone = mkdtempSync(join(tmpdir(), 'quest-alone-'));
    writeFileSync(join(alone, 'quest.py'), readFileSync(SCRIPT));
    const home = mkdtempSync(join(tmpdir(), 'quest-home-'));
    const r = await new Promise<{ code: number; out: string }>((done) => {
      const p = spawn('python3', [join(alone, 'quest.py'), 'validate', ROOT], {
        cwd: alone,
        env: { PATH: process.env.PATH!, HOME: home, QUEST_SITE: `http://127.0.0.1:${port}/`, QUEST_NO_JSONSCHEMA: '1', PYTHONDONTWRITEBYTECODE: '1' },
      });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('close', (code) => done({ code: code ?? -1, out }));
    });
    site.close();
    expect(r.code, r.out).toBe(0);
    expect(existsSync(join(home, '.cache/quest-log/schemas/level.schema.json'))).toBe(true);
  });
});

describe('schema manifest', () => {
  it('lists every published schema, and each file exists', () => {
    const manifest = JSON.parse(readFileSync(join(SCHEMAS, 'index.json'), 'utf8'));
    expect(manifest.schemas.map((s: any) => s.name).sort()).toEqual(['level', 'project', 'quest', 'world']);
    for (const s of manifest.schemas) {
      const doc = JSON.parse(readFileSync(join(SCHEMAS, s.file), 'utf8'));
      expect(doc.$id).toBe(s.id);
      expect(s.id).toBe(manifest.baseUrl + s.file);
    }
  });
});
