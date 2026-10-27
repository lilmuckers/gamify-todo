// Quest Log core releases: quest.py + schema/ published as GitHub Releases `core-vX.Y.Z`, and the
// `core/v<major>.json` pointer the Quest Log action resolves on every run (automation plan §3.6).
//   tsx shared/scripts/core-release.mjs plan [--json]           changed since the last core-v* tag? which bump?
//   tsx shared/scripts/core-release.mjs build --version X.Y.Z   write dist/core/ (assets + NOTES.md)
//   tsx shared/scripts/core-release.mjs pointer --out DIR       write DIR/v<major>.json from the released tags
// Run through tsx so `stubSample` can come from shared/src/stub.ts once it exists.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { applyLabels, detectBump, nextVersion } from './core-bump.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = 'skills/quest-log/scripts/quest.py';
const SCHEMA_DIR = 'schema';
const REPO = process.env.GITHUB_REPOSITORY || 'lilmuckers/gamify-todo';
const TAG_RE = /^core-v(\d+)\.(\d+)\.(\d+)$/;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });

/** The core's source files, `{ 'quest.py': Buffer, 'schema/x.json': Buffer }`, now or at a git ref. */
function coreFiles(ref) {
  const read = (p) => (ref ? Buffer.from(git('show', `${ref}:${p}`)) : readFileSync(join(root, p)));
  const schemas = ref
    ? git('ls-tree', '--name-only', ref, `${SCHEMA_DIR}/`).split('\n').filter((p) => p.endsWith('.json'))
    : readdirSync(join(root, SCHEMA_DIR)).filter((f) => f.endsWith('.json')).map((f) => `${SCHEMA_DIR}/${f}`);
  const out = { 'quest.py': read(SCRIPT) };
  for (const p of schemas.sort()) out[p] = read(p);
  return out;
}

/** Hash of what the core does: file names and bytes only, no timestamps or commit ids. */
export function contentHash(files) {
  const h = createHash('sha256');
  for (const name of Object.keys(files).sort()) h.update(name).update('\0').update(files[name]).update('\0');
  return h.digest('hex');
}

const asBumpInput = (files) => ({
  script: files['quest.py'].toString('utf8'),
  schemas: Object.fromEntries(
    Object.entries(files)
      .filter(([n]) => n.startsWith(`${SCHEMA_DIR}/`) && !n.endsWith('/index.json'))
      .map(([n, b]) => [n.slice(SCHEMA_DIR.length + 1), JSON.parse(b.toString('utf8'))]),
  ),
});

function coreTags() {
  return git('tag', '-l', 'core-v*')
    .split('\n')
    .map((t) => [t, TAG_RE.exec(t)])
    .filter(([, m]) => m)
    .map(([tag, m]) => ({ tag, version: m.slice(1).map(Number) }))
    .sort((a, b) => a.version[0] - b.version[0] || a.version[1] - b.version[1] || a.version[2] - b.version[2]);
}

/** `core: …` labels on the pull requests merged since `tag` that touched the core. */
async function labelsSince(tag) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token || !tag) return { labels: [], pulls: [] };
  const range = `${tag}..HEAD`;
  const shas = git('log', '--first-parent', '--format=%H', range, '--', SCRIPT, SCHEMA_DIR).split('\n').filter(Boolean);
  const labels = new Set();
  const pulls = new Map();
  for (const sha of shas) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${sha}/pulls`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GET commits/${sha}/pulls: ${res.status}`);
    for (const pr of await res.json()) {
      pulls.set(pr.number, pr.title);
      for (const l of pr.labels ?? []) if (l.name.startsWith('core:')) labels.add(l.name);
    }
  }
  return { labels: [...labels], pulls: [...pulls].map(([number, title]) => ({ number, title })) };
}

async function plan() {
  const tags = coreTags();
  const last = tags.at(-1);
  const now = coreFiles();
  if (!last) {
    return { changed: true, bump: 'major', previous: null, version: '1.0.0', reasons: ['first core release'], pulls: [], contentHash: contentHash(now) };
  }
  const before = coreFiles(last.tag);
  if (contentHash(before) === contentHash(now)) {
    return { changed: false, bump: 'none', previous: last.version.join('.'), version: last.version.join('.'), reasons: [], pulls: [], contentHash: contentHash(now) };
  }
  const detected = detectBump(asBumpInput(before), asBumpInput(now));
  const { labels, pulls } = await labelsSince(last.tag);
  // Bytes changed but the bump rules saw nothing (e.g. index.json only): still a patch.
  const labelled = applyLabels(detected.bump === 'none' ? { bump: 'patch', reasons: ['core files changed'] } : detected, labels);
  const previous = last.version.join('.');
  return { changed: true, bump: labelled.bump, previous, version: nextVersion(previous, labelled.bump), reasons: labelled.reasons, pulls, contentHash: contentHash(now) };
}

/** A gzipped ustar archive with fixed metadata, so the same files give the same bytes. */
function tarGz(entries) {
  const blocks = [];
  for (const [name, body] of entries) {
    const h = Buffer.alloc(512);
    const field = (s, off, len) => h.write(s, off, len, 'ascii');
    const octal = (n, off, len) => field(n.toString(8).padStart(len - 1, '0') + '\0', off, len);
    field(name, 0, 100);
    octal(0o644, 100, 8);
    octal(0, 108, 8);
    octal(0, 116, 8);
    octal(body.length, 124, 12);
    octal(0, 136, 12);
    field('        ', 148, 8);
    field('0', 156, 1);
    field('ustar\0', 257, 6);
    field('00', 263, 2);
    let sum = 0;
    for (const b of h) sum += b;
    field(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 9 });
}

async function stubSample() {
  const path = join(root, 'shared/src/stub.ts');
  if (!existsSync(path)) return null;
  const mod = await import(path);
  return typeof mod.stubSample === 'function' ? mod.stubSample() : null;
}

async function build(version, out, info) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('build needs --version X.Y.Z');
  const files = coreFiles();
  mkdirSync(out, { recursive: true });
  const script = files['quest.py'];
  const schemas = tarGz(Object.entries(files).filter(([n]) => n.startsWith(`${SCHEMA_DIR}/`)));
  writeFileSync(join(out, 'quest.py'), script);
  writeFileSync(join(out, 'schema.tar.gz'), schemas);
  const core = {
    version,
    tag: `core-v${version}`,
    skillVersion: Number(/^SKILL_VERSION = (\d+)$/m.exec(script.toString('utf8'))?.[1]),
    commit: process.env.GITHUB_SHA || git('rev-parse', 'HEAD').trim(),
    released: new Date().toISOString(),
    contentHash: contentHash(files),
    files: { 'quest.py': sha256(script), 'schema.tar.gz': sha256(schemas) },
    stubSample: await stubSample(),
  };
  const coreJson = Buffer.from(JSON.stringify(core, null, 2) + '\n');
  writeFileSync(join(out, 'core.json'), coreJson);
  const sums = { ...core.files, 'core.json': sha256(coreJson) };
  writeFileSync(join(out, 'SHA256SUMS'), Object.entries(sums).map(([n, s]) => `${s}  ${n}`).join('\n') + '\n');
  const notes = [
    `Quest Log core ${version} (skill version ${core.skillVersion}).`,
    '',
    info?.previous ? `**${info.bump}** bump from ${info.previous}.` : 'First core release.',
    ...(info?.reasons?.length ? ['', '### Detected changes', ...info.reasons.map((r) => `- ${r}`)] : []),
    ...(info?.pulls?.length ? ['', '### Pull requests', ...info.pulls.map((p) => `- #${p.number} ${p.title}`)] : []),
    '',
    'Resolved by `lilmuckers/quest-log-actions` through `https://tasks.patrick-mckinley.com/core/v' + version.split('.')[0] + '.json`.',
  ];
  writeFileSync(join(out, 'NOTES.md'), notes.join('\n') + '\n');
  return core;
}

/** Tag for each major: the newest release, unless core-pin.json pins it (`{ "v1": "core-v1.2.0" }`). */
export function pointerTags(tags, pins = {}) {
  const out = {};
  for (const t of tags) out[`v${t.version[0]}`] = t.tag;
  for (const [major, tag] of Object.entries(pins)) {
    if (!TAG_RE.test(tag) || `v${TAG_RE.exec(tag)[1]}` !== major) throw new Error(`core-pin.json: ${major} → ${tag} is not a ${major} tag`);
    if (!tags.some((t) => t.tag === tag)) throw new Error(`core-pin.json: ${tag} doesn't exist`);
    out[major] = tag;
  }
  return out;
}

async function pointer(out) {
  const pinPath = join(root, 'core-pin.json');
  const pins = existsSync(pinPath) ? JSON.parse(readFileSync(pinPath, 'utf8')) : {};
  delete pins.$comment;
  const tags = pointerTags(coreTags(), pins);
  if (!Object.keys(tags).length) {
    console.warn('No core-v* tags yet; no pointer written.');
    return;
  }
  mkdirSync(out, { recursive: true });
  for (const [major, tag] of Object.entries(tags)) {
    const base = `https://github.com/${REPO}/releases/download/${tag}/`;
    const res = await fetch(base + 'core.json');
    if (!res.ok) throw new Error(`GET ${base}core.json: ${res.status}`);
    const core = await res.json();
    const sums = await fetch(base + 'SHA256SUMS').then((r) => (r.ok ? r.text() : Promise.reject(new Error(`GET ${base}SHA256SUMS: ${r.status}`))));
    const assets = {};
    for (const line of sums.trim().split('\n')) {
      const [sum, name] = line.split(/\s+/);
      assets[name] = { url: base + name, sha256: sum };
    }
    const doc = { version: core.version, tag, contentHash: core.contentHash, released: core.released, skillVersion: core.skillVersion, pinned: pins[major] === tag, assets };
    writeFileSync(join(out, `${major}.json`), JSON.stringify(doc, null, 2) + '\n');
    console.log(`${major}.json → ${tag}${doc.pinned ? ' (pinned)' : ''}`);
  }
}

async function main(argv) {
  const [cmd] = argv;
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (cmd === 'plan') {
    const p = await plan();
    if (argv.includes('--json')) console.log(JSON.stringify(p));
    else console.log(p.changed ? `core-v${p.version} (${p.bump} from ${p.previous ?? 'nothing'})\n${p.reasons.map((r) => `  ${r}`).join('\n')}` : `No core change since core-v${p.previous}.`);
  } else if (cmd === 'build') {
    const out = opt('out') ?? join(root, 'dist/core');
    const info = opt('plan') ? JSON.parse(readFileSync(opt('plan'), 'utf8')) : undefined;
    const version = opt('version') ?? info?.version ?? (await plan()).version;
    const core = await build(version, out, info);
    console.log(`Built core-v${core.version} in ${out} (content ${core.contentHash.slice(0, 12)})`);
  } else if (cmd === 'pointer') {
    await pointer(opt('out') ?? join(root, 'app/dist/core'));
  } else {
    console.error('usage: core-release.mjs plan [--json] | build [--version X.Y.Z] [--plan FILE] [--out DIR] | pointer [--out DIR]');
    process.exit(2);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  });
}
