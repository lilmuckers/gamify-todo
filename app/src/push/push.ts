import { deviceEvents, type AutomationConfig, type DeviceEvents, type OpBody, type PushDevice } from '@quest/shared';
import { track } from '../analytics';
import type { App } from '../app';
import type { AutomationProvider } from '../data/source';
import { fromBase64Url, generateVapidKeys } from './vapid';
import { listenToWorker, workerHasPush } from './worker';

/**
 * Web Push on this device (plans G4): subscribe the browser, register it in automation.json's
 * `notify.devices` and keep that entry current. The action in the user's repo does the sending.
 */

/** The secret the action signs pushes with (plans §3.3). */
export const VAPID_SECRET = 'QUEST_VAPID_PRIVATE_KEY';
const DEVICE_KEY = 'quest.push.device';

export type PushSupport = 'unsupported' | 'ios-needs-install' | 'denied' | 'ready';

/** The bits of a push subscription we read (PushSubscription, or a test double). */
export interface SubscriptionLike {
  endpoint: string;
  options?: { applicationServerKey?: ArrayBuffer | null };
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
}

export interface PushManagerLike {
  getSubscription(): Promise<SubscriptionLike | null>;
  subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }): Promise<SubscriptionLike>;
}

/** What the browser gives us, so tests can stand in for it. */
export interface PushEnv {
  hasPush: boolean;
  ios: boolean;
  standalone: boolean;
  userAgent: string;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  pushManager(): Promise<PushManagerLike>;
  timezone(): string;
  /** Whether the active service worker can show pushes (absent: assume it can). */
  pushWorker?(): Promise<boolean>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

export function browserEnv(): PushEnv {
  const ua = navigator.userAgent;
  return {
    hasPush: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    // iPadOS says it's a Mac, but a Mac has no touch screen.
    ios: /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1),
    standalone: matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
    userAgent: ua,
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    pushManager: async () => (await navigator.serviceWorker.ready).pushManager as unknown as PushManagerLike,
    timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    pushWorker: () => workerHasPush(),
    storage: safeStorage(),
  };
}

function safeStorage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

/** Whether this browser can get pushes now, and if not, why. iOS only allows it from the Home Screen. */
export function support(env: PushEnv): PushSupport {
  if (!env.hasPush) return env.ios && !env.standalone ? 'ios-needs-install' : 'unsupported';
  return env.permission() === 'denied' ? 'denied' : 'ready';
}

/** A name for this device until the user picks one, e.g. "Android Chrome". */
export function defaultLabel(ua: string, ios: boolean, standalone: boolean): string {
  const browser = /Firefox\//.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = ios ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux|CrOS/.test(ua) ? 'Linux' : '';
  if (ios && /iPad/.test(ua)) return `iPad${standalone ? ' app' : ''}`;
  return ios ? `iPhone${standalone ? ' app' : ''}` : `${os} ${browser}`.trim();
}

/** This browser's device id, made once and kept next to the token. */
export function deviceId(env: PushEnv, create = false): string | undefined {
  let id: string | undefined;
  try {
    id = env.storage?.getItem(DEVICE_KEY) ?? undefined;
  } catch {
    id = undefined;
  }
  if (id || !create) return id;
  id = `web-${Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  try {
    env.storage?.setItem(DEVICE_KEY, id);
  } catch {
    // Private mode: the device gets a new id next time, and the old entry expires.
  }
  return id;
}

/**
 * This browser's entry in the device list: by its saved id, or by its push endpoint (the id was
 * lost with the site's storage, but the subscription survived).
 */
export function findThisDevice(devices: PushDevice[], id: string | undefined, endpoint?: string): PushDevice | undefined {
  return devices.find((d) => d.id === id) ?? (endpoint ? devices.find((d) => d.subscription.endpoint === endpoint) : undefined);
}

/** Whether the repo needs a new key pair: no public key yet, or its private half isn't a secret. */
export function needsKeys(automation: AutomationConfig | undefined, secrets: string[]): boolean {
  return !automation?.notify?.vapidPublicKey || !secrets.includes(VAPID_SECRET);
}

/** The subscription as automation.json stores it. */
export function subscriptionEntry(sub: SubscriptionLike): PushDevice['subscription'] {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) throw new Error('The browser’s push subscription has no keys');
  return { endpoint: json.endpoint ?? sub.endpoint, keys: { p256dh, auth } };
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Whether a subscription was made for this VAPID key (a new key needs a new subscription). */
export function subscribedWith(sub: SubscriptionLike, publicKey: string): boolean {
  const key = sub.options?.applicationServerKey;
  // Browsers that don't say which key a subscription uses: trust it.
  return !key || sameBytes(new Uint8Array(key), fromBase64Url(publicKey));
}

/** This browser's subscription for `publicKey`: the current one if it fits, else a fresh one. */
export async function subscription(pm: PushManagerLike, publicKey: string, fresh = false): Promise<SubscriptionLike> {
  const current = await pm.getSubscription();
  if (current && !fresh && subscribedWith(current, publicKey)) return current;
  if (current) await current.unsubscribe().catch(() => false);
  return pm.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) });
}

const sameSubscription = (a: PushDevice['subscription'], b: PushDevice['subscription']) =>
  a.endpoint === b.endpoint && a.keys.p256dh === b.keys.p256dh && a.keys.auth === b.keys.auth;

/** Waits for queued edits to commit; throws if they didn't (they stay queued and retry). */
async function synced(app: App) {
  await app.store.sync();
  if (app.store.outbox.length) throw new Error(app.store.error ?? 'Saved here. It will sync when it can.');
}

/**
 * Refuses to subscribe while an older build's service worker is still in charge: the browser
 * would accept pushes that it then never shows.
 */
export async function checkPushWorker(env: PushEnv): Promise<void> {
  if (env.pushWorker && !(await env.pushWorker())) throw new Error('Quest Log is still updating on this device. Reload the page, then turn notifications on.');
}

/**
 * Turns push on for this device: asks for permission, makes the repo's VAPID keys the first time
 * (private half as a secret, public half in automation.json), subscribes, and adds the device.
 * Key, notify settings and device land in one commit. `secrets` is the repo's secret names, if
 * they're already known.
 */
export async function enable(app: App, provider: AutomationProvider, env: PushEnv, secrets?: string[]): Promise<PushDevice> {
  // First, while we still have the click: iOS only asks from inside a user gesture.
  const permission = await env.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notifications are blocked for this site. Allow them in the browser’s settings.' : 'Notifications weren’t allowed.');
  await checkPushWorker(env);
  // Queued edits go first, so the commit below holds only this.
  if (app.store.outbox.length) await synced(app);
  const automation = app.store.state?.automation;
  const firstKey = needsKeys(automation, secrets ?? (await provider.secrets()));
  const keys = firstKey ? await generateVapidKeys() : undefined;
  const publicKey = keys?.publicKey ?? automation!.notify!.vapidPublicKey!;
  const pm = await env.pushManager();
  const sub = await subscription(pm, publicKey, firstKey);
  if (keys) await provider.setSecret(VAPID_SECRET, keys.privateKey);

  const devices = automation?.notify?.devices ?? [];
  const id = deviceId(env, true)!;
  const prev = findThisDevice(devices, id, sub.endpoint);
  const device: PushDevice = {
    id: prev?.id ?? id,
    label: prev?.label ?? defaultLabel(env.userAgent, env.ios, env.standalone),
    addedAt: prev?.addedAt ?? new Date().toISOString(),
    timezone: prev?.timezone ?? env.timezone(),
    // The review day moves here from this browser's own setting (plans §3.2).
    events: prev?.events ?? { timebox: true, review: app.review.day, warpZone: true },
    subscription: subscriptionEntry(sub),
  };
  if (prev && prev.id !== id) env.storage?.setItem(DEVICE_KEY, prev.id);
  const ops: OpBody[] = [];
  if (keys || !automation?.notify?.enabled) ops.push({ kind: 'updateAutomation', patch: { notify: { enabled: true, ...(keys && { vapidPublicKey: keys.publicKey }) } } });
  ops.push({ kind: 'addDevice', device });
  if (!app.dispatchBatch(ops)) throw new Error('Couldn’t add this device');
  await synced(app);
  track('push_enable', { first_key: firstKey, standalone: env.standalone });
  return device;
}

/** Turns push off for this device: unsubscribes and removes its entry. */
export async function disable(app: App, env: PushEnv, id: string): Promise<void> {
  const pm = await env.pushManager().catch(() => undefined);
  const sub = await pm?.getSubscription().catch(() => null);
  await sub?.unsubscribe().catch(() => false);
  app.dispatch({ kind: 'removeDevice', id });
  try {
    env.storage?.removeItem(DEVICE_KEY);
  } catch {
    // Nothing to forget.
  }
  track('push_disable', { this_device: true, expired: false });
}

/** Removes another device (or an expired one) from the list. */
export function removeDevice(app: App, id: string, expired: boolean) {
  app.dispatch({ kind: 'removeDevice', id });
  track('push_disable', { this_device: false, expired });
}

/** Changes a device's label, timezone or events. `addDevice` replaces by id. */
export function updateDevice(app: App, device: PushDevice, patch: { label?: string; timezone?: string; events?: Partial<DeviceEvents> }): boolean {
  const next: PushDevice = {
    ...device,
    ...(patch.label !== undefined && { label: patch.label }),
    ...(patch.timezone !== undefined && { timezone: patch.timezone }),
    ...(patch.events && { events: { ...deviceEvents(device), ...patch.events } }),
  };
  const r = app.dispatch({ kind: 'addDevice', device: next });
  // This browser's in-app reminder follows the review day it gets pushes for.
  if (r.ok && patch.events?.review && device.id === deviceId(browserEnvCached())) app.setReview({ day: patch.events.review }, false);
  return r.ok;
}

let cachedEnv: PushEnv | undefined;
function browserEnvCached() {
  return (cachedEnv ??= browserEnv());
}

/** This browser's device entry in the open repo, if it has one. */
export function thisDevice(app: App, env: PushEnv = browserEnvCached()): PushDevice | undefined {
  return findThisDevice(app.store.state?.automation?.notify?.devices ?? [], deviceId(env));
}

/**
 * A registered device that opens the app re-checks its subscription: browsers rotate them, and a
 * new VAPID key (another device made one) needs a new one. A changed subscription is saved
 * with `addDevice`. `fresh` throws the current one away first (it was reported expired).
 */
export async function refreshThisDevice(app: App, env: PushEnv = browserEnvCached(), fresh = false): Promise<'unchanged' | 'updated' | 'skipped'> {
  const device = thisDevice(app, env);
  const publicKey = app.store.state?.automation?.notify?.vapidPublicKey;
  if (!device || !publicKey || !app.caps.canEdit || support(env) !== 'ready' || env.permission() !== 'granted') return 'skipped';
  const sub = await subscription(await env.pushManager(), publicKey, fresh);
  const entry = subscriptionEntry(sub);
  if (sameSubscription(entry, device.subscription)) return 'unchanged';
  const r = app.dispatch({ kind: 'addDevice', device: { ...device, subscription: entry } });
  return r.ok ? 'updated' : 'skipped';
}

/** The review day changed in Settings → Game: a registered device gets the same day. */
export function followReviewDay(app: App, day: DeviceEvents['review']) {
  const device = thisDevice(app);
  if (!device || deviceEvents(device).review === day || !app.caps.canEdit) return;
  app.dispatch({ kind: 'addDevice', device: { ...device, events: { ...deviceEvents(device), review: day } } });
}

/** Fired on window when the worker logged something, so an open device list can re-read it. */
export const PUSH_CHANGED = 'quest-push-changed';

/**
 * Boot-time wiring for GitHub repos: notification clicks open their route, and a registered
 * device re-checks its subscription now, when it comes back to the foreground, and when the
 * worker says the browser replaced it.
 */
export function startPush(app: App) {
  if (!app.store.source.automation || !('serviceWorker' in navigator)) return;
  const env = browserEnvCached();
  const refresh = () => void refreshThisDevice(app, env).catch(() => undefined);
  listenToWorker({
    open: (url) => {
      if (location.hash !== url) location.hash = url;
    },
    changed: (kind) => {
      if (kind === 'resubscribed') refresh();
      window.dispatchEvent(new Event(PUSH_CHANGED));
    },
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    refresh();
    window.dispatchEvent(new Event(PUSH_CHANGED));
  });
  refresh();
}
