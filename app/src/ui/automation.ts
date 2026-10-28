import {
  AUTOMATION_DEFAULTS,
  CRONS,
  hasScheduledEvent,
  SCHEDULE_EVERY,
  SECRET_NAMES,
  STUB_PATH,
  type AutomationPatch,
  type ScheduleEvery,
  type StubState,
} from '@quest/shared';
import { track } from '../analytics';
import type { App } from '../app';
import type { LatestRun } from '../data/source';
import { h, relTime } from './dom';
import { confirmDialog } from './modal';
import { pushSection } from './push-devices';
import { toast } from './toast';

/** Rough Actions minutes a month for each schedule: one billed minute per run on private repos. */
export function minutesPerMonth(every: ScheduleEvery): number {
  if (every === 'off') return 0;
  return Math.round((30 * 24) / Number.parseInt(every, 10));
}

const STATE_TEXT: Record<StubState, { note: string; tone: 'win' | 'warn' | 'alert' | ''; button?: string }> = {
  missing: { note: 'The workflow isn’t installed yet. Your settings are saved, but nothing runs until it is.', tone: '', button: 'Install workflow' },
  legacy: { note: 'This repo has the old copy-paste workflow. Replace it with the managed one to use these settings.', tone: 'warn', button: 'Replace workflow' },
  older: { note: 'The workflow is from an older Quest Log. Update it to pick up the latest features.', tone: 'warn', button: 'Update workflow' },
  drift: { note: 'The workflow was changed outside Quest Log and no longer matches these settings.', tone: 'warn', button: 'Re-write workflow' },
  foreign: { note: `There’s a different workflow at ${STUB_PATH}. Quest Log leaves it alone unless you replace it.`, tone: 'alert', button: 'Replace it' },
  newer: { note: 'A newer version of Quest Log wrote this workflow. Reload the app to manage it.', tone: 'warn' },
  current: { note: '✓ The workflow is installed and matches these settings.', tone: 'win' },
};

/**
 * Settings → Automation: the Quest Log workflow in the data repo (install, update, drift), its
 * settings in data/automation.json, its secrets and its latest run. GitHub repos only.
 * `onAttention` hears, after each check, whether the workflow needs something done.
 */
export function automationSection(app: App, onAttention?: (on: boolean) => void): Node[] {
  const provider = app.store.source.automation;
  if (!provider || !app.caps.canAutomate) return [];
  const root = h('div', { class: 'automation', 'aria-busy': 'true' });
  let stub: StubState | undefined;
  let stubError: string | undefined;
  let run: LatestRun | undefined | null = null;
  let runError: string | undefined;
  let secrets: string[] | undefined;
  let busy = false;
  /** Set by an edit: look at the workflow again once the edit has synced. */
  let recheck = false;

  const load = async () => {
    root.setAttribute('aria-busy', 'true');
    const [s, r, k] = await Promise.allSettled([provider.stub(), provider.latestRun(), provider.secrets()]);
    stub = s.status === 'fulfilled' ? s.value.state : undefined;
    stubError = s.status === 'rejected' ? (s.reason as Error).message : undefined;
    run = r.status === 'fulfilled' ? r.value : undefined;
    runError = r.status === 'rejected' ? (r.reason as Error).message : undefined;
    secrets = k.status === 'fulfilled' ? k.value : undefined;
    root.removeAttribute('aria-busy');
    render();
    onAttention?.(!!stubError || (!!stub && stub !== 'current'));
  };

  const push = pushSection(app, provider, {
    secrets: () => secrets,
    stub: () => stub,
    expired: () => ({ ids: run?.status?.expiredDevices ?? [], runId: run?.run.id }),
    reload: () => void load(),
  });
  let shown = app.store.state?.automation;

  const unsubscribe = app.store.subscribe(() => {
    if (!root.isConnected) return unsubscribe();
    // Devices change from this tab, another device's sync or a refreshed subscription.
    if (app.store.state?.automation !== shown) {
      shown = app.store.state?.automation;
      push.render();
    }
    if (recheck && app.store.status === 'synced') {
      recheck = false;
      void load();
    }
  });

  const write = async () => {
    const from = stub;
    if (from === 'foreign' && !(await confirmDialog('Replace workflow', `Replace the workflow at ${STUB_PATH} with Quest Log’s? Whatever it did now stops.`, 'Replace', true)))
      return;
    busy = true;
    render();
    try {
      // Queued edits go first, so the workflow is rendered from the settings you see.
      if (app.store.outbox.length) await app.store.sync();
      await provider.writeWorkflow();
      track('automation_install', { from });
      toast(from === 'missing' ? 'Workflow installed' : 'Workflow re-written', 'win');
      await app.store.refresh();
    } catch (err) {
      toast((err as Error).message, 'warn');
    }
    busy = false;
    await load();
  };

  const change = (patch: AutomationPatch) => {
    const r = app.dispatch({ kind: 'updateAutomation', patch });
    if (!r.ok) toast(r.error ?? 'Couldn’t save that', 'warn');
    recheck = true;
    render();
  };

  const render = () => {
    const a = app.store.state?.automation;
    const ro = !app.caps.canEdit || busy;
    const validate = { ...AUTOMATION_DEFAULTS.validate, ...a?.validate };
    const every = a?.schedule?.every ?? AUTOMATION_DEFAULTS.every;
    const scheduled = hasScheduledEvent(a);
    const text = stub && STATE_TEXT[stub];
    const check = (label: string, on: boolean, set: (on: boolean) => void, disabled = false) =>
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', checked: on, disabled: ro || disabled, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }),
        label,
      );
    const select = <V extends string>(label: string, value: V, options: [V, string][], set: (v: V) => void, disabled = false) =>
      h(
        'label',
        { class: 'field' },
        h('span', null, label),
        h(
          'select',
          { disabled: ro || disabled, onchange: (e: Event) => set((e.target as HTMLSelectElement).value as V) },
          options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)),
        ),
      );

    root.replaceChildren(
      h(
        'p',
        { class: 'muted' },
        'A small GitHub Actions workflow in your repo checks every change and comments on pull requests. It runs on your GitHub account’s Actions minutes.',
      ),
      stubError
        ? h('p', { class: 'note alert stub-state' }, `Couldn’t read the workflow: ${stubError}`)
        : text
          ? h(
              'div',
              { class: `note ${text.tone} stub-state`, 'data-state': stub },
              h('p', null, text.note),
              text.button &&
                app.caps.canEdit &&
                h('div', { class: 'actions' }, h('button', { class: 'btn sm primary', type: 'button', disabled: busy, onclick: () => void write() }, busy ? 'Writing…' : text.button)),
            )
          : h('p', { class: 'muted' }, 'Checking the workflow…'),
      check('Check every change', validate.enabled, (on) => change({ validate: { enabled: on } })),
      check('Comment on pull requests', validate.comment, (on) => change({ validate: { comment: on } }), !validate.enabled),
      check('Notifications', !!a?.notify?.enabled, (on) => change({ notify: { enabled: on } })),
      h('small', { class: 'muted' }, 'Each device turns its own notifications on. Time-box and review reminders need the schedule below.'),
      select(
        'Channel',
        a?.channel ?? AUTOMATION_DEFAULTS.channel,
        [
          ['stable', 'Stable (recommended)'],
          ['beta', 'Beta: the newest action, may break'],
        ],
        (channel) => change({ channel }),
      ),
      select(
        'Schedule',
        every,
        SCHEDULE_EVERY.map((e): [ScheduleEvery, string] => [e, e === 'off' ? 'Off' : `Every ${e.replace('h', e === '1h' ? ' hour' : ' hours')} (~${minutesPerMonth(e)} min a month)`]),
        (e) => change({ schedule: { every: e } }),
        !scheduled,
      ),
      h(
        'small',
        { class: 'muted schedule-note' },
        !scheduled
          ? 'No device wants time-box or review notifications, so the workflow has no schedule and spends no minutes on it.'
          : every === 'off'
            ? 'Off: time-box and review notifications won’t be sent.'
            : `Runs at ${CRONS[every].split(' ')[0]} minutes past the hour (UTC). On private repos that’s about ${minutesPerMonth(every)} Actions minutes a month. GitHub often starts scheduled runs late, sometimes by an hour, so reminders can arrive late too.`,
      ),
      secrets && stub && stub !== 'missing' && stub !== 'foreign'
        ? h(
            'div',
            { class: 'secrets' },
            h('span', null, 'Secrets: '),
            SECRET_NAMES.map((name) => h('code', { class: secrets!.includes(name) ? 'set' : 'unset' }, `${name} ${secrets!.includes(name) ? '✓ set' : '· not set'}`)),
          )
        : '',
      runView(run, runError),
      h('div', { class: 'actions' }, h('button', { class: 'btn sm', type: 'button', disabled: busy, onclick: () => void load() }, 'Check again')),
      push.root,
    );
    push.render();
  };

  render();
  void load();
  return [root];
}

/** The latest run: when, why, what ran and on which core. */
function runView(latest: LatestRun | undefined | null, error?: string): Node {
  if (latest === null) return h('p', { class: 'muted last-run' }, 'Looking for the last run…');
  if (error) return h('p', { class: 'muted last-run' }, `Couldn’t read runs: ${error}`);
  if (!latest) return h('p', { class: 'muted last-run' }, 'No runs yet.');
  const { run, status } = latest;
  const result = run.status !== 'completed' ? '⏳ running' : run.conclusion === 'success' ? '✓ passed' : `✗ ${run.conclusion ?? 'failed'}`;
  const modules = status ? Object.entries(status.modules) : [];
  return h(
    'div',
    { class: 'last-run' },
    h(
      'p',
      null,
      'Last run ',
      h('b', null, relTime(status?.ranAt ?? run.createdAt)),
      ` · ${run.event} · ${result}`,
      status && ` · core ${status.core.version}`,
      ' · ',
      h('a', { class: 'link', href: run.url, target: '_blank', rel: 'noopener' }, 'view on GitHub'),
    ),
    modules.length
      ? h(
          'ul',
          { class: 'list compact' },
          modules.map(([name, m]) => h('li', null, h('small', null, `${m.ran ? (m.ok === false ? '✗' : '✓') : '–'} ${name}: ${m.reason}`))),
        )
      : '',
    latest.statusMissing && h('small', { class: 'muted' }, latest.statusMissing),
    status?.error && h('p', { class: 'note alert' }, status.error),
  );
}
