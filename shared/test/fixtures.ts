import type { AttachmentSidecar } from '../src/attachments';
import type { Automation, GameState, Level, PushDevice, Workspace } from '../src/model';

export function level(overrides: Partial<Level> = {}): Level {
  return {
    id: 'lvl',
    name: 'Level',
    deliverable: 'A thing',
    timeboxDays: 10,
    successCriteria: [
      { id: 'mvp-1', text: 'Works', mvp: true, done: false },
      { id: 'bonus', text: 'Pretty', mvp: false, done: false },
    ],
    items: [
      { id: 'a', type: 'task', title: 'A', status: 'todo' },
      { id: 'b', type: 'blocker', title: 'B', status: 'todo', dependsOn: ['a'] },
      { id: 'c', type: 'stretch', title: 'C', status: 'todo' },
    ],
    ...overrides,
  };
}

/** One project, id "p", with one world "w" holding `lvl`. */
export function state(lvl: Level = level()): GameState {
  return {
    overworld: { id: 'p', title: 'T', goals: [{ id: 'g', title: 'Goal' }], worldOrder: ['w'] },
    worlds: { w: { id: 'w', name: 'W', theme: 'grass', goalIds: ['g'], levels: [lvl] } },
  };
}

export function workspace(lvl: Level = level()): Workspace {
  return { projects: { p: state(lvl) } };
}

/** Address of the fixture level, for ops. */
export const at = { projectId: 'p', worldId: 'w', levelId: 'lvl' };

export const lvlOf = (ws: Workspace) => ws.projects.p.worlds.w.levels[0];

/** The data/automation.json example from the automation plan (README §3.2): every block set. */
export function automationExample(): Omit<Automation, '$schema'> & { notify: { devices: PushDevice[] } } {
  return {
    channel: 'stable',
    schedule: { every: '3h' },
    validate: { enabled: true, comment: true },
    notify: {
      enabled: true,
      vapidPublicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
      devices: [device()],
    },
  };
}

export function device(overrides: Partial<PushDevice> = {}): PushDevice {
  return {
    id: 'pixel-7',
    label: 'Pixel',
    addedAt: '2026-10-08T09:00:00Z',
    timezone: 'Europe/London',
    events: { timebox: true, review: 'fri', warpZone: true },
    subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'BNcRdreALRFX', auth: 'tBHItJI5svbpez7KI4CCXg' } },
    ...overrides,
  };
}

/** A sidecar for data/attachments/<id>.json, as G6's upload writes it. */
export function sidecar(overrides: Partial<AttachmentSidecar> = {}): AttachmentSidecar {
  return { id: 'receipt-1', addedAt: '2026-10-28T09:00:00Z', title: 'Boiler receipt', via: 'share', ...overrides };
}

/** The start of a JPEG: not UTF-8 and not JSON, so anything that read or parsed it would choke. */
export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
