import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyOp,
  AUTOMATION_PATH,
  changedFiles,
  classifyPath,
  commitMessage,
  CRONS,
  describeOp,
  diffWorkspaces,
  fromFiles,
  hasScheduledEvent,
  inverseOp,
  makeOp,
  MAX_DEVICES,
  parseStub,
  renderStub,
  replay,
  SCHEDULE_EVERY,
  SECRET_NAMES,
  sha256,
  stubSample,
  toFiles,
  UNDOABLE,
  validateFiles,
  type AutomationConfig,
  type OpBody,
  type Workspace,
} from '../src';
import { automationExample, device, workspace } from './fixtures';

const withAutomation = (automation: AutomationConfig | undefined = automationExample()): Workspace => ({
  ...workspace(),
  ...(automation ? { automation } : {}),
});
const apply = (ws: Workspace, ...bodies: OpBody[]) => bodies.reduce((s, b) => applyOp(s, makeOp(b)), ws);
/** Applies `body`, then its inverse, and expects the workspace to be back where it was. */
const roundTrip = (ws: Workspace, body: OpBody) => {
  const after = apply(ws, body);
  const undo = inverseOp(body, ws);
  expect(undo).toBeDefined();
  expect(apply(after, undo!)).toEqual(ws);
  return after;
};

describe('data/automation.json', () => {
  it('is a data file that round-trips through the workspace, in a fixed key order', () => {
    expect(classifyPath('data/automation.json')).toEqual({ kind: 'automation' });
    const files = toFiles(withAutomation());
    const text = files[AUTOMATION_PATH];
    expect(JSON.parse(text).$schema).toBe('https://tasks.patrick-mckinley.com/schema/automation.schema.json');
    expect(Object.keys(JSON.parse(text))).toEqual(['$schema', 'channel', 'schedule', 'validate', 'notify']);
    expect(Object.keys(JSON.parse(text).notify.devices[0])).toEqual(['id', 'label', 'timezone', 'events', 'subscription', 'addedAt']);
    expect(fromFiles(files).automation).toEqual(automationExample());
    expect(validateFiles(files)).toEqual([]);
  });

  it('is optional, and an empty one is never written', () => {
    expect(toFiles(workspace())).not.toHaveProperty(AUTOMATION_PATH);
    expect(fromFiles(toFiles(workspace()))).not.toHaveProperty('automation');
    expect(toFiles(withAutomation({}))).not.toHaveProperty(AUTOMATION_PATH);
  });

  it('rejects duplicate device ids and unknown timezones', () => {
    const a = automationExample();
    a.notify.devices.push(device({ label: 'Again' }), device({ id: 'mars', timezone: 'Mars/Olympus_Mons' }));
    const issues = validateFiles(toFiles(withAutomation(a)));
    expect(issues.map((i) => `${i.path} ${i.message}`)).toEqual([
      '/notify/devices duplicate device id "pixel-7"',
      '/notify/devices/2/timezone unknown timezone "Mars/Olympus_Mons"',
    ]);
  });
});

describe('automation ops', () => {
  it('updateAutomation patches field by field, keeps devices, and drops emptied blocks', () => {
    const ws = withAutomation();
    const next = apply(ws, { kind: 'updateAutomation', patch: { channel: 'beta', schedule: { every: '1h' }, notify: { enabled: false } } });
    expect(next.automation).toEqual({ ...automationExample(), channel: 'beta', schedule: { every: '1h' }, notify: { ...automationExample().notify, enabled: false } });
    expect(next.projects).toBe(ws.projects);
    expect(Object.keys(changedFiles(ws, next))).toEqual([AUTOMATION_PATH]);
    const reset = apply(next, { kind: 'updateAutomation', patch: { channel: undefined, schedule: { every: undefined } } });
    expect(reset.automation).not.toHaveProperty('channel');
    expect(reset.automation).not.toHaveProperty('schedule');
    // A patch can't touch devices, even if one sneaks in.
    const sneaky = apply(ws, { kind: 'updateAutomation', patch: { notify: { devices: [] } as any } });
    expect(sneaky.automation).toEqual(ws.automation);
  });

  it('creates the file from nothing and removes it once empty', () => {
    const ws = workspace();
    const on = apply(ws, { kind: 'updateAutomation', patch: { validate: { comment: false } } });
    expect(on.automation).toEqual({ validate: { comment: false } });
    expect(Object.keys(changedFiles(ws, on))).toEqual([AUTOMATION_PATH]);
    const off = apply(on, { kind: 'updateAutomation', patch: { validate: { comment: undefined } } });
    expect(off).not.toHaveProperty('automation');
    expect(changedFiles(on, off)).toEqual({ [AUTOMATION_PATH]: null });
  });

  it('addDevice is idempotent by id: a second add replaces the device in place', () => {
    const ws = withAutomation();
    const phone = device({ id: 'phone', label: 'Phone' });
    const once = apply(ws, { kind: 'addDevice', device: phone });
    expect(apply(once, { kind: 'addDevice', device: phone })).toEqual(once);
    const resubscribed = apply(once, { kind: 'addDevice', device: { ...phone, subscription: { ...phone.subscription, endpoint: 'https://push.example.com/new' } } });
    expect(resubscribed.automation!.notify!.devices!.map((d) => d.id)).toEqual(['pixel-7', 'phone']);
    expect(resubscribed.automation!.notify!.devices![1].subscription.endpoint).toBe('https://push.example.com/new');
  });

  it('addDevice starts a notify block, and caps the list', () => {
    const first = apply(workspace(), { kind: 'addDevice', device: device() });
    expect(first.automation).toEqual({ notify: { devices: [device()] } });
    let full = workspace();
    for (let i = 0; i < MAX_DEVICES; i++) full = apply(full, { kind: 'addDevice', device: device({ id: `d${i}` }) });
    expect(() => apply(full, { kind: 'addDevice', device: device({ id: 'one-more' }) })).toThrow(/at most 20/);
    // Replacing one is still fine when full.
    expect(() => apply(full, { kind: 'addDevice', device: device({ id: 'd3', label: 'New' }) })).not.toThrow();
  });

  it('removeDevice drops the device, then the empty block, and ignores one already gone', () => {
    const ws = withAutomation({ notify: { devices: [device()] } });
    const gone = apply(ws, { kind: 'removeDevice', id: 'pixel-7' });
    expect(gone).not.toHaveProperty('automation');
    expect(apply(gone, { kind: 'removeDevice', id: 'pixel-7' })).toBe(gone);
    const kept = apply(withAutomation(), { kind: 'removeDevice', id: 'pixel-7' });
    expect(kept.automation!.notify).toEqual({ enabled: true, vapidPublicKey: automationExample().notify.vapidPublicKey });
  });

  it('undoes every automation op', () => {
    for (const kind of ['updateAutomation', 'addDevice', 'removeDevice'] as const) expect(UNDOABLE.has(kind)).toBe(true);
    const ws = withAutomation();
    roundTrip(ws, { kind: 'updateAutomation', patch: { channel: 'beta', schedule: { every: 'off' }, validate: { enabled: false } } });
    roundTrip(ws, { kind: 'updateAutomation', patch: { channel: undefined, notify: { vapidPublicKey: 'Bnew' } } });
    roundTrip(workspace(), { kind: 'updateAutomation', patch: { schedule: { every: '6h' } } });
    roundTrip(ws, { kind: 'addDevice', device: device({ id: 'tablet', label: 'Tablet' }) });
    roundTrip(ws, { kind: 'addDevice', device: device({ label: 'Renamed' }) });
    roundTrip(workspace(), { kind: 'addDevice', device: device() });
    const two = apply(ws, { kind: 'addDevice', device: device({ id: 'tablet', label: 'Tablet' }) });
    roundTrip(two, { kind: 'removeDevice', id: 'pixel-7' });
    expect(inverseOp({ kind: 'removeDevice', id: 'ghost' }, ws)).toBeUndefined();
  });

  it('merges concurrent addDevice ops from two browsers', () => {
    const base = withAutomation({ notify: { enabled: true } });
    const phone = makeOp({ kind: 'addDevice', device: device({ id: 'phone', label: 'Phone' }) });
    const laptop = makeOp({ kind: 'addDevice', device: device({ id: 'laptop', label: 'Laptop' }) });
    // The laptop synced first; the phone's outbox replays on top of the new remote.
    const remote = applyOp(base, laptop);
    const { state, conflicts } = replay(remote, [phone]);
    expect(conflicts).toEqual([]);
    expect(state.automation!.notify!.devices!.map((d) => d.id)).toEqual(['laptop', 'phone']);
    expect(state.automation!.notify!.enabled).toBe(true);
    // A settings change made meanwhile survives too.
    const changed = applyOp(remote, makeOp({ kind: 'updateAutomation', patch: { schedule: { every: '1h' } } }));
    expect(replay(changed, [phone]).state.automation).toMatchObject({ schedule: { every: '1h' }, notify: { enabled: true } });
    // The same device added twice (two tabs) stays one device.
    expect(replay(remote, [laptop]).state.automation!.notify!.devices).toHaveLength(1);
  });

  it('describes changes as "quest: automation: …" commits, devices by label', () => {
    const ws = withAutomation();
    const msg = (b: OpBody) => commitMessage([makeOp(b)], ws);
    expect(msg({ kind: 'updateAutomation', patch: { channel: 'beta', schedule: { every: '1h' } } })).toBe('quest: automation: channel = beta, schedule.every = 1h');
    expect(msg({ kind: 'updateAutomation', patch: { notify: { enabled: true, vapidPublicKey: 'Bxyz' } } })).toBe('quest: automation: notify.enabled = true, notify.vapidPublicKey = new key');
    expect(msg({ kind: 'updateAutomation', patch: { channel: undefined } })).toBe('quest: automation: channel = default');
    expect(msg({ kind: 'addDevice', device: device({ id: 'ipad', label: 'iPad' }) })).toBe('quest: automation: add device "iPad"');
    expect(msg({ kind: 'removeDevice', id: 'pixel-7' })).toBe('quest: automation: remove device "Pixel"');
    expect(describeOp(makeOp({ kind: 'removeDevice', id: 'pixel-7' }))).toBe('automation: remove device "pixel-7"');
  });

  it('shows in the Warp Zone diff, with devices as labels only', () => {
    const base = withAutomation();
    const head = apply(base, { kind: 'updateAutomation', patch: { schedule: { every: '1h' } } }, { kind: 'addDevice', device: device({ id: 'ipad', label: 'iPad' }) });
    const d = diffWorkspaces(base, head);
    expect(d.projects).toEqual({});
    expect(d.automation).toEqual([
      { field: 'schedule.every', before: '3h', after: '1h' },
      { field: 'notify.devices', before: ['Pixel'], after: ['Pixel', 'iPad'] },
    ]);
    expect(d.count).toBe(2);
    expect(JSON.stringify(d)).not.toContain('fcm.googleapis.com');
    expect(diffWorkspaces(base, base).automation).toBeUndefined();
  });
});

describe('renderStub', () => {
  /** Notify on with one device; `events` overrides its switches. */
  const config = (over: AutomationConfig = {}, events = {}): AutomationConfig => ({
    ...over,
    notify: { enabled: true, devices: [device({ events: { timebox: true, review: 'fri', warpZone: true, ...events } })], ...over.notify },
  });
  const schedule = (text: string) => /^ {2}schedule: \[\{ cron: '([^']+)' \}\]$/m.exec(text)?.[1] ?? null;

  it('matches the stub verified live on the spike repo, plus its config line', () => {
    // .github/workflows/quest.yml on lilmuckers/quest-log-spike (quest-stub: 1), on the stable channel.
    const spike = [
      '# quest-stub: 1  (written by Quest Log — change it in Settings → Automation)',
      'name: Quest Log',
      'on:',
      '  pull_request: { types: [opened, synchronize, reopened, labeled] }',
      "  push: { branches: [main], paths: ['data/**'] }",
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
      '      - uses: lilmuckers/quest-log-actions@v1',
      '        env:',
      '          QUEST_VAPID_PRIVATE_KEY: ${{ secrets.QUEST_VAPID_PRIVATE_KEY }}',
      '',
    ].join('\n');
    const { text, configHash } = renderStub(undefined);
    expect(text.replace(`# quest-config: ${configHash}\n`, '')).toBe(spike);
    expect(text.split('\n')[1]).toBe(`# quest-config: ${configHash}`);
  });

  it.each(SCHEDULE_EVERY.map((every) => [every]))('renders schedule.every = %s', (every) => {
    const { text } = renderStub(config({ schedule: { every } }));
    expect(schedule(text)).toBe(every === 'off' ? null : CRONS[every]);
    if (every === 'off') expect(text).not.toContain('schedule');
  });

  it('defaults to every 3 hours', () => {
    expect(schedule(renderStub(config()).text)).toBe('17 */3 * * *');
  });

  it('has no schedule unless a scheduled event is on for some device', () => {
    const cases: [string, AutomationConfig | undefined, boolean][] = [
      ['no automation.json', undefined, false],
      ['notify off', { notify: { enabled: false, devices: [device()] } }, false],
      ['no devices', { notify: { enabled: true } }, false],
      ['only Warp Zone pushes', config({}, { timebox: false, review: 'off' }), false],
      ['events left to their defaults', { notify: { enabled: true, devices: [device({ events: undefined })] } }, true],
      ['time-box only', config({}, { timebox: true, review: 'off' }), true],
      ['review only', config({}, { timebox: false, review: 'sun' }), true],
    ];
    for (const [name, a, scheduled] of cases) {
      expect(hasScheduledEvent(a), name).toBe(scheduled);
      expect(schedule(renderStub(a).text), name).toBe(scheduled ? '17 */3 * * *' : null);
    }
  });

  it('uses @v1 on the stable channel and @main on beta', () => {
    expect(renderStub(config({ channel: 'stable' })).text).toContain('      - uses: lilmuckers/quest-log-actions@v1\n');
    expect(renderStub(config({})).text).toContain('@v1\n');
    expect(renderStub(config({ channel: 'beta' })).text).toContain('      - uses: lilmuckers/quest-log-actions@main\n');
  });

  it('pushes on the default branch, quoting names YAML or globs would misread', () => {
    const branches = (b: string) => /push: \{ branches: \[(.*)\], paths/.exec(renderStub(undefined, b).text)![1];
    expect(branches('master')).toBe('master');
    expect(branches('trunk/v2.x')).toBe('trunk/v2.x');
    expect(branches('yes')).toBe("'yes'");
    expect(branches('2026')).toBe("'2026'");
    expect(branches("it's")).toBe("'it''s'");
    expect(branches('c++')).toBe("'c\\+\\+'");
    expect(() => renderStub(undefined, '${{ secrets.X }}')).toThrow();
  });

  it('names every secret as step env, never toJSON(secrets), and passes no inputs', () => {
    const { text } = renderStub(config());
    for (const name of SECRET_NAMES) expect(text).toContain(`          ${name}: \${{ secrets.${name} }}\n`);
    expect(text).not.toMatch(/toJSON/);
    expect(text).not.toMatch(/^\s+with:/m);
    // ${{ }} only in block style: a flow mapping's `}}` would end the mapping.
    for (const line of text.split('\n')) if (line.includes('${{')) expect(line, line).not.toMatch(/^\s*[\w-]+: \{/);
  });

  it('hashes the rendered inputs, so any change to them changes the hash', () => {
    const hashes = new Set([
      renderStub(undefined).configHash,
      renderStub(undefined, 'master').configHash,
      renderStub(config()).configHash,
      renderStub(config({ schedule: { every: '1h' } })).configHash,
      renderStub(config({ channel: 'beta' })).configHash,
    ]);
    expect(hashes.size).toBe(5);
    // Changes the stub doesn't depend on keep the hash.
    expect(renderStub(config({ validate: { comment: false } })).configHash).toBe(renderStub(config()).configHash);
    expect(renderStub(undefined).configHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stubSample is the default stub with notify on', () => {
    const sample = stubSample();
    expect(schedule(sample)).toBe('17 */3 * * *');
    expect(sample).toContain('@v1\n');
    expect(parseStub(sample)).toEqual({ kind: 'stub', version: 1, configHash: renderStub(config()).configHash });
  });
});

describe('parseStub', () => {
  it('reads the version and config hash of a stub', () => {
    const { text, configHash } = renderStub(undefined);
    expect(parseStub(text)).toEqual({ kind: 'stub', version: 1, configHash });
    // The hand-committed spike stub has no config line: the app sees drift and offers a re-write.
    expect(parseStub(text.replace(/^# quest-config.*\n/m, ''))).toEqual({ kind: 'stub', version: 1 });
  });

  it('spots the legacy copy-paste workflow and anything else', () => {
    const legacy = '# Checks every change to data/ with the same rules as the Quest Log app.\nname: Quest data\non: [push, pull_request]\n';
    expect(parseStub(legacy)).toEqual({ kind: 'legacy' });
    expect(parseStub("name: 'Quest data'\non: push\n")).toEqual({ kind: 'legacy' });
    expect(parseStub('name: CI\non: push\n')).toEqual({ kind: 'foreign' });
    expect(parseStub('')).toEqual({ kind: 'foreign' });
  });
});

describe('sha256', () => {
  it.each(['', 'abc', 'é and ✓', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000)])('matches node:crypto for %j', (s) => {
    expect(sha256(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
  });
});
