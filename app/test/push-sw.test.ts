import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// app/public/push-sw.js runs inside the Workbox service worker. Run it against a stand-in `self`.
const SOURCE = readFileSync(resolve(import.meta.dirname, '../public/push-sw.js'), 'utf8');
const SCOPE = 'https://tasks.example.com/';

interface FakeClient {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

function worker(clients: FakeClient[] = []) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const order: string[] = [];
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => (handlers[type] = fn),
    registration: {
      scope: SCOPE,
      showNotification: vi.fn(async () => void order.push('show')),
      pushManager: { subscribe: vi.fn(async () => ({})) },
    },
    clients: {
      matchAll: vi.fn(async () => clients),
      openWindow: vi.fn(async () => undefined),
    },
  };
  // No IndexedDB here: logging fails quietly, which must never stop the notification.
  new Function('self', 'indexedDB', SOURCE)(self, {
    open: () => {
      order.push('log');
      throw new Error('no idb');
    },
  });
  const fire = async (type: string, event: Record<string, unknown>) => {
    let done: Promise<unknown> = Promise.resolve();
    handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  };
  return { self, fire, order };
}

const client = (url = `${SCOPE}#/`): FakeClient => ({ url, focus: vi.fn(async () => undefined), postMessage: vi.fn() });

describe('push-sw.js', () => {
  it('logs, then shows the push, then tells open pages', async () => {
    const page = client();
    const { self, fire, order } = worker([page]);
    const payload = { title: 'New PR #3 in the Warp Zone', body: 'Add tiles', url: '#/pr/3', tag: 'pr:3' };
    await fire('push', { data: { json: () => payload, text: () => JSON.stringify(payload) } });
    expect(order).toEqual(['log', 'show']);
    expect(self.registration.showNotification).toHaveBeenCalledWith('New PR #3 in the Warp Zone', {
      body: 'Add tiles',
      tag: 'pr:3',
      icon: 'icons/icon-192.png',
      data: { url: '#/pr/3' },
    });
    expect(self.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    expect(page.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'quest-push', entry: expect.objectContaining({ kind: 'push', title: payload.title }) }));
  });

  it('still shows something for a push that isn’t JSON, and keeps links inside the app', async () => {
    const { self, fire } = worker();
    await fire('push', { data: { json: () => JSON.parse('nope'), text: () => 'plain words' } });
    expect(self.registration.showNotification).toHaveBeenCalledWith('Quest Log', expect.objectContaining({ body: 'plain words', data: { url: '#/' } }));
    await fire('push', { data: { json: () => ({ title: 'x', url: 'https://evil.example.com' }) } });
    expect(self.registration.showNotification).toHaveBeenLastCalledWith('x', expect.objectContaining({ data: { url: '#/' } }));
  });

  it('a click focuses the open app on the push’s route', async () => {
    const page = client();
    const { self, fire } = worker([page]);
    const close = vi.fn();
    await fire('notificationclick', { notification: { close, data: { url: '#/p/house/kitchen/tiles' } } });
    expect(close).toHaveBeenCalled();
    expect(page.focus).toHaveBeenCalled();
    expect(page.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'quest-open', url: '#/p/house/kitchen/tiles' }));
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('a click with no app open opens one there', async () => {
    const { self, fire } = worker([client('https://elsewhere.example.com/')]);
    await fire('notificationclick', { notification: { close: vi.fn(), data: { url: '#/review' } } });
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${SCOPE}#/review`);
  });

  it('re-subscribes with the same key when the browser drops a subscription', async () => {
    const page = client();
    const { self, fire } = worker([page]);
    const key = new Uint8Array([4, 1, 2]).buffer;
    await fire('pushsubscriptionchange', { oldSubscription: { options: { applicationServerKey: key } }, newSubscription: null });
    expect(self.registration.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: key });
    expect(page.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'quest-push-subscription' }));
  });
});
