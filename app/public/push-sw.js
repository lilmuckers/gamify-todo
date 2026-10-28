// Quest Log's push add-on, loaded into the Workbox service worker with importScripts (plans D16).
// A push is logged first (iOS may stop the worker once the notification is up), then shown (iOS
// revokes a subscription whose pushes show nothing), then the open pages are told. A click
// focuses the app on the push's route, or opens it there. See app/src/push/worker.ts.
(() => {
  const DB = 'quest-push';
  const STORE = 'log';
  const KEEP = 20;
  const channel = 'BroadcastChannel' in self ? new BroadcastChannel('quest-push') : null;
  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const open = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  /** Runs `fn` on the log store and resolves with what it returned once the transaction ends. */
  const withStore = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req && req.result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  };

  const log = (entry) =>
    withStore('readwrite', (store) => {
      store.add(entry);
      const keys = store.getAllKeys();
      keys.onsuccess = () => keys.result.slice(0, Math.max(0, keys.result.length - KEEP)).forEach((k) => store.delete(k));
    });

  const readLog = () => withStore('readonly', (store) => store.getAll());

  /** Tells every open page, controlled or not, on two routes; pages ignore repeats by id. */
  const tell = async (msg) => {
    channel?.postMessage(msg);
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) client.postMessage(msg);
  };

  /** Only routes inside the app. */
  const route = (url) => (typeof url === 'string' && /^#\/\S*$/.test(url) ? url : '#/');

  self.addEventListener('message', (event) => {
    if (event.data?.type !== 'quest-push-log') return;
    event.waitUntil(
      readLog().then(
        (entries) => event.source?.postMessage({ type: 'quest-push-log', log: entries }),
        () => event.source?.postMessage({ type: 'quest-push-log', log: [] }),
      ),
    );
  });

  self.addEventListener('push', (event) => {
    let data = {};
    try {
      data = event.data ? event.data.json() : {};
    } catch {
      data = { body: event.data ? event.data.text() : '' };
    }
    const entry = { kind: 'push', at: new Date().toISOString(), title: String(data.title || 'Quest Log'), tag: data.tag, url: route(data.url) };
    event.waitUntil(
      (async () => {
        await log(entry).catch(() => undefined);
        await self.registration.showNotification(entry.title, {
          body: typeof data.body === 'string' ? data.body : '',
          tag: data.tag,
          icon: 'icons/icon-192.png',
          data: { url: entry.url },
        });
        await tell({ type: 'quest-push', entry, id: uid() });
      })(),
    );
  });

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = route(event.notification.data?.url);
    const target = new URL(self.registration.scope);
    target.hash = url;
    event.waitUntil(
      (async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const client = windows.find((c) => c.url.startsWith(self.registration.scope));
        if (!client) return self.clients.openWindow(target.href);
        await client.focus().catch(() => undefined);
        const msg = { type: 'quest-open', url, id: uid() };
        client.postMessage(msg);
        channel?.postMessage(msg);
      })(),
    );
  });

  // The browser replaced the subscription (it expired or rotated). The worker can't write to the
  // repo, so it re-subscribes with the same key and the app saves the new one when it next opens.
  self.addEventListener('pushsubscriptionchange', (event) => {
    event.waitUntil(
      (async () => {
        const options = event.oldSubscription?.options;
        if (!event.newSubscription && options?.applicationServerKey)
          await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: options.applicationServerKey }).catch(() => undefined);
        await log({ kind: 'resubscribed', at: new Date().toISOString() }).catch(() => undefined);
        await tell({ type: 'quest-push-subscription', id: uid() });
      })(),
    );
  });
})();
