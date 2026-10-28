import { deviceEvents, REVIEW_SLOTS, type PushDevice, type ReviewDay, type StubState } from '@quest/shared';
import type { App } from '../app';
import type { AutomationProvider } from '../data/source';
import { browserEnv, disable, enable, PUSH_CHANGED, refreshThisDevice, removeDevice, support, thisDevice, updateDevice, type PushEnv } from '../push/push';
import { workerLog, type WorkerLogEntry } from '../push/worker';
import { h, relTime } from './dom';
import { confirmDialog } from './modal';
import { toast } from './toast';

/** What the Automation section already knows, read fresh at each render. */
export interface PushContext {
  secrets(): string[] | undefined;
  stub(): StubState | undefined;
  /** Device ids the latest run's quest-status reported as gone (404/410), and that run's id. */
  expired(): { ids: string[]; runId?: number };
  /** Re-reads the workflow, secrets and run (after something changed them). */
  reload(): void;
}

const KEPT_KEY = 'quest.push.kept';

/** Expired devices the user chose to keep, by id, with the run that reported them. */
function kept(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEPT_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function keep(id: string, runId: number | undefined) {
  try {
    localStorage.setItem(KEPT_KEY, JSON.stringify({ ...kept(), [id]: runId ?? 0 }));
  } catch {
    // Private mode: it asks again next time.
  }
}

const REVIEW_OPTIONS: [ReviewDay, string][] = [
  ...(Object.entries(REVIEW_SLOTS) as [ReviewDay, { label: string }][]).map(([v, slot]): [ReviewDay, string] => [v, `Review: ${slot.label}`]),
  ['off', 'Review: no reminder'],
];

function timezones(current: string): string[] {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return all.includes(current) ? all : [current, ...all];
}

/**
 * Push notifications in Settings → Automation: turn them on for this device, then each device's
 * label, timezone and events, removal, and the devices the last run found expired.
 */
export function pushSection(app: App, provider: AutomationProvider, ctx: PushContext, env: PushEnv = browserEnv()) {
  const root = h('div', { class: 'push' });
  let busy = false;
  let log: WorkerLogEntry[] = [];

  const loadLog = async () => {
    log = await workerLog().catch(() => []);
    render();
  };
  const onChanged = () => {
    if (!root.isConnected) return window.removeEventListener(PUSH_CHANGED, onChanged);
    void loadLog();
  };
  window.addEventListener(PUSH_CHANGED, onChanged);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    busy = true;
    render();
    try {
      await fn();
      if (done) toast(done, 'win');
    } catch (err) {
      toast((err as Error).message, 'warn', 6000);
    }
    busy = false;
    render();
    ctx.reload();
  };

  const turnOn = () => run(() => enable(app, provider, env, ctx.secrets()), 'Notifications are on for this device');
  const turnOff = async (device: PushDevice) => {
    if (!(await confirmDialog('Turn off notifications', `Stop notifications on ${device.label} and remove it from the list?`, 'Turn off', true))) return;
    await run(() => disable(app, env, device.id));
  };
  const remove = async (device: PushDevice, expired: boolean) => {
    if (!expired && !(await confirmDialog('Remove device', `Remove ${device.label}? It stops getting notifications.`, 'Remove', true))) return;
    removeDevice(app, device.id, expired);
  };
  const resubscribe = () =>
    run(async () => {
      if ((await refreshThisDevice(app, env, true)) !== 'updated') throw new Error('Couldn’t subscribe again. Turn notifications off and on.');
      await app.store.sync();
    }, 'Subscribed again');

  const deviceView = (device: PushDevice, mine: boolean) => {
    const ro = !app.caps.canEdit || busy;
    const events = deviceEvents(device);
    const set = (patch: Parameters<typeof updateDevice>[2]) => {
      if (!updateDevice(app, device, patch)) render();
    };
    const check = (label: string, on: boolean, key: 'timebox' | 'warpZone') =>
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', checked: on, disabled: ro, onchange: (e: Event) => set({ events: { [key]: (e.target as HTMLInputElement).checked } }) }),
        label,
      );
    return h(
      'fieldset',
      { class: `push-device${mine ? ' mine' : ''}`, 'data-id': device.id },
      h('legend', null, device.label, mine ? h('small', { class: 'chip' }, 'this device') : ''),
      h(
        'label',
        { class: 'field' },
        h('span', null, 'Name'),
        h('input', {
          type: 'text',
          value: device.label,
          maxLength: 60,
          disabled: ro,
          'data-keep': '',
          onchange: (e: Event) => {
            const label = (e.target as HTMLInputElement).value.trim();
            if (label && label !== device.label) set({ label });
          },
        }),
      ),
      h(
        'label',
        { class: 'field' },
        h('span', null, 'Timezone'),
        h(
          'select',
          { disabled: ro, onchange: (e: Event) => set({ timezone: (e.target as HTMLSelectElement).value }) },
          timezones(device.timezone).map((tz) => h('option', { value: tz, selected: tz === device.timezone }, tz.replace(/_/g, ' '))),
        ),
      ),
      check('Time-boxes running out', events.timebox, 'timebox'),
      check('Warp Zone pull requests', events.warpZone, 'warpZone'),
      h(
        'label',
        { class: 'field' },
        h('span', null, 'Weekly review'),
        h(
          'select',
          { disabled: ro, onchange: (e: Event) => set({ events: { review: (e.target as HTMLSelectElement).value as ReviewDay } }) },
          REVIEW_OPTIONS.map(([v, l]) => h('option', { value: v, selected: v === events.review }, l)),
        ),
      ),
      h('small', { class: 'muted' }, `Added ${relTime(device.addedAt)}.`),
      mine && log.length
        ? h(
            'ul',
            { class: 'list compact push-log' },
            log.slice(0, 5).map((e) => h('li', null, h('small', null, `${e.kind === 'push' ? `🔔 ${e.title ?? 'Notification'}` : '↻ Subscription renewed'} · ${relTime(e.at)}`))),
          )
        : '',
      app.caps.canEdit &&
        h(
          'div',
          { class: 'actions' },
          mine
            ? h('button', { class: 'btn sm', type: 'button', disabled: busy, onclick: () => void turnOff(device) }, 'Turn off here')
            : h('button', { class: 'btn sm', type: 'button', disabled: busy, onclick: () => void remove(device, false) }, 'Remove'),
        ),
    );
  };

  const expiredView = (device: PushDevice, mine: boolean, runId: number | undefined) =>
    h(
      'div',
      { class: 'note warn push-expired', 'data-id': device.id },
      h('p', null, `${mine ? 'This device' : device.label} stopped receiving notifications. ${mine ? 'Subscribe again, or remove it?' : 'Remove it?'}`),
      app.caps.canEdit &&
        h(
          'div',
          { class: 'actions' },
          mine && h('button', { class: 'btn sm primary', type: 'button', disabled: busy, onclick: () => void resubscribe() }, 'Subscribe again'),
          h('button', { class: `btn sm${mine ? '' : ' primary'}`, type: 'button', disabled: busy, onclick: () => void remove(device, true) }, 'Remove'),
          h(
            'button',
            {
              class: 'btn sm',
              type: 'button',
              onclick: () => {
                keep(device.id, runId);
                render();
              },
            },
            'Keep',
          ),
        ),
    );

  const render = () => {
    const devices = app.store.state?.automation?.notify?.devices ?? [];
    const mine = thisDevice(app, env);
    const state = support(env);
    const { ids, runId } = ctx.expired();
    const skip = kept();
    const expired = devices.filter((d) => ids.includes(d.id) && skip[d.id] !== (runId ?? 0));
    const stub = ctx.stub();

    root.replaceChildren(
      h('h3', null, 'Push notifications'),
      h('p', { class: 'muted' }, 'Nudges on your phone or computer when a time-box is running out, your weekly review is due, or a pull request needs you. Turn them on in each browser you want them in.'),
      ...expired.map((d) => expiredView(d, d.id === mine?.id, runId)),
      state === 'ios-needs-install'
        ? h('p', { class: 'note push-support', 'data-support': state }, 'On iPhone and iPad, notifications only work in the Home Screen app. Tap Share, then Add to Home Screen, open Quest Log from there and turn them on.')
        : state === 'unsupported'
          ? h('p', { class: 'note push-support', 'data-support': state }, 'This browser can’t get push notifications.')
          : state === 'denied'
            ? h('p', { class: 'note warn push-support', 'data-support': state }, 'Notifications are blocked for this site. Allow them in your browser’s site settings, then come back.')
            : '',
      !mine && state === 'ready' && app.caps.canEdit
        ? h(
            'div',
            { class: 'actions' },
            h('button', { class: 'btn sm primary', type: 'button', disabled: busy, onclick: () => void turnOn() }, busy ? 'Turning on…' : 'Turn on for this device'),
          )
        : '',
      !mine && state === 'ready' && (stub === 'missing' || stub === 'foreign')
        ? h('small', { class: 'muted' }, 'Install the workflow above too: it’s what sends them.')
        : '',
      mine ? deviceView(mine, true) : '',
      ...devices.filter((d) => d !== mine).map((d) => deviceView(d, false)),
      devices.length && provider.isPublic()
        ? h(
            'p',
            { class: 'note warn push-public' },
            'This repo is public, so anyone can see each device’s push address in data/automation.json. Nobody can send to it without the key in your repo’s secrets, and pushes are encrypted, so the risk is low.',
          )
        : '',
    );
  };

  render();
  void loadLog();
  return { root, render };
}
