// The workflow the app writes into a data repo (.github/workflows/quest.yml), rendered from
// data/automation.json. This is the only copy of the template (plans D15, README §3.1).
import { AUTOMATION_DEFAULTS, hasScheduledEvent, type AutomationConfig, type ScheduleEvery } from './automation';

export const STUB_PATH = '.github/workflows/quest.yml';
export const ACTION_REPO = 'lilmuckers/quest-log-actions';

/** Goes up whenever the template changes, including a new name in SECRET_NAMES. */
export const STUB_VERSION = 1;

/**
 * Every secret the action can use, passed one by one as step `env:`. Never
 * `toJSON(secrets)`: GitHub holds such a workflow for approval after every edit (D12).
 * Unset ones arrive empty and are ignored, so only a new name changes the stub.
 */
export const SECRET_NAMES = ['QUEST_VAPID_PRIVATE_KEY'] as const;

/** UTC crons, off the top of the hour when Actions is busiest. */
export const CRONS: Record<Exclude<ScheduleEvery, 'off'>, string> = {
  '6h': '17 */6 * * *',
  '3h': '17 */3 * * *',
  '1h': '17 * * * *',
};

/** What the template is rendered from; its hash is the stub's `quest-config`. */
export interface StubInputs {
  stub: number;
  ref: 'v1' | 'main';
  branch: string;
  cron: string | null;
}

export function stubInputs(automation: AutomationConfig | undefined, defaultBranch = 'main'): StubInputs {
  const channel = automation?.channel ?? AUTOMATION_DEFAULTS.channel;
  const every = automation?.schedule?.every ?? AUTOMATION_DEFAULTS.every;
  return {
    stub: STUB_VERSION,
    ref: channel === 'beta' ? 'main' : 'v1',
    branch: defaultBranch,
    cron: every !== 'off' && hasScheduledEvent(automation) ? CRONS[every] : null,
  };
}

const YAML_WORDS = /^(true|false|yes|no|on|off|y|n|null|~)$/i;

/** A branch as a YAML flow scalar and a literal Actions branch filter. */
function branchFilter(branch: string): string {
  if (!branch || branch.includes('${{')) throw new Error(`can't use "${branch}" as a workflow branch`);
  // Filters are globs: escape what git allows in a name but a glob would read.
  const glob = branch.replace(/[+!]/g, '\\$&');
  return /^[A-Za-z_][\w./-]*$/.test(glob) && !YAML_WORDS.test(glob) ? glob : `'${glob.replace(/'/g, "''")}'`;
}

/**
 * The workflow text for `automation` (undefined = no automation.json) in a repo whose
 * default branch is `defaultBranch`, with the hash the app compares to spot drift.
 * `${{ }}` only appears in block-style YAML: in a flow mapping its `}}` would end the mapping.
 */
export function renderStub(automation: AutomationConfig | undefined, defaultBranch = 'main'): { text: string; configHash: string } {
  const inputs = stubInputs(automation, defaultBranch);
  const configHash = sha256(JSON.stringify(inputs));
  const lines = [
    `# quest-stub: ${STUB_VERSION}  (written by Quest Log — change it in Settings → Automation)`,
    `# quest-config: ${configHash}`,
    'name: Quest Log',
    'on:',
    '  pull_request: { types: [opened, synchronize, reopened, labeled] }',
    `  push: { branches: [${branchFilter(inputs.branch)}], paths: ['data/**'] }`,
    ...(inputs.cron ? [`  schedule: [{ cron: '${inputs.cron}' }]`] : []),
    '  workflow_dispatch:',
    'permissions: { contents: write, pull-requests: write, checks: write }',
    'concurrency:',
    '  group: quest-${{ github.ref }}',
    '  cancel-in-progress: false',
    'jobs:',
    '  quest:',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 15',
    '    steps:',
    `      - uses: ${ACTION_REPO}@${inputs.ref}`,
    '        env:',
    ...SECRET_NAMES.map((name) => `          ${name}: \${{ secrets.${name} }}`),
  ];
  return { text: lines.join('\n') + '\n', configHash };
}

export type ParsedStub =
  | { kind: 'stub'; version: number; configHash?: string }
  /** The old copy-paste workflow ("Quest data", no marker): offer a replacement. */
  | { kind: 'legacy' }
  /** Someone else's file at the same path: never overwrite it without asking. */
  | { kind: 'foreign' };

export function parseStub(text: string): ParsedStub {
  const marker = /^# quest-stub: (\d+)\b/m.exec(text);
  if (marker) {
    const hash = /^# quest-config: ([0-9a-f]{64})\s*$/m.exec(text);
    return { kind: 'stub', version: Number(marker[1]), ...(hash ? { configHash: hash[1] } : {}) };
  }
  if (/^name:\s*(['"]?)Quest data\1\s*$/m.test(text)) return { kind: 'legacy' };
  return { kind: 'foreign' };
}

/**
 * How the workflow in a repo compares with what the app would write now:
 * - `missing`: no workflow yet; `legacy`: the old copy-paste one; `foreign`: someone else's file
 * - `older`: an older `quest-stub` (e.g. it lacks a newer secret name); `newer`: written by a newer app
 * - `drift`: ours, but edited by hand or out of step with automation.json; `current`: as rendered
 */
export type StubState = 'missing' | 'legacy' | 'foreign' | 'older' | 'newer' | 'drift' | 'current';

export function stubState(text: string | undefined, automation: AutomationConfig | undefined, defaultBranch = 'main'): StubState {
  if (text === undefined) return 'missing';
  const parsed = parseStub(text);
  if (parsed.kind !== 'stub') return parsed.kind;
  if (parsed.version < STUB_VERSION) return 'older';
  if (parsed.version > STUB_VERSION) return 'newer';
  // Comparing the whole text also catches a hand edit that left the quest-config line alone.
  return text.replace(/\r\n/g, '\n') === renderStub(automation, defaultBranch).text ? 'current' : 'drift';
}

/** A rendered stub for core.json (notify on, default schedule), so the action's CI can check the contract. */
export function stubSample(): string {
  return renderStub({
    notify: {
      enabled: true,
      devices: [{
        id: 'sample',
        label: 'Sample',
        addedAt: '2026-10-08T09:00:00Z',
        timezone: 'Europe/London',
        subscription: { endpoint: 'https://push.example.com/sample', keys: { p256dh: 'p256dh', auth: 'auth' } },
      }],
    },
  }).text;
}

/** SHA-256 as hex. Synchronous and dependency-free, because `shared/` runs in the browser too. */
export function sha256(text: string): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const bytes = new TextEncoder().encode(text);
  const words = new Uint32Array((((bytes.length + 9 + 63) >> 6) << 4));
  bytes.forEach((b, i) => (words[i >> 2] |= b << (24 - (i % 4) * 8)));
  words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8);
  words[words.length - 1] = bytes.length * 8;
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let block = 0; block < words.length; block += 16) {
    for (let t = 0; t < 64; t++) {
      if (t < 16) w[t] = words[block + t];
      else {
        const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = w[t - 16] + s0 + w[t - 7] + s1;
      }
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const t1 = hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t];
      const t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => (h[i] = (h[i] + v) >>> 0));
  }
  return [...h].map((v) => v.toString(16).padStart(8, '0')).join('');
}
