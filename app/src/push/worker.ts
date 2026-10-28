// Talks to the service worker's push add-on (app/public/push-sw.js). On iOS the open app doesn't
// always count as controlled, and it can't see the worker's IndexedDB writes until it restarts,
// so the worker answers on two routes (client.postMessage and a BroadcastChannel) and the page
// asks it for its log rather than reading the store itself (spike "Notes for G4").

/** Something the worker noted: a push that arrived, or a subscription the browser replaced. */
export interface WorkerLogEntry {
  kind: 'push' | 'resubscribed';
  at: string;
  title?: string;
  tag?: string;
  url?: string;
}

type Message =
  | { type: 'quest-push'; entry: WorkerLogEntry; id: string }
  | { type: 'quest-open'; url: string; id: string }
  | { type: 'quest-push-subscription'; id: string }
  | { type: 'quest-push-log'; log: WorkerLogEntry[] };

export interface WorkerHandlers {
  /** A notification was clicked: show this hash route. */
  open(url: string): void;
  /** A push arrived, or the subscription changed: re-read what's shown. */
  changed(kind: WorkerLogEntry['kind']): void;
}

/** Only routes inside the app: a payload can't send the page anywhere else. */
export function safeRoute(url: unknown): string | undefined {
  return typeof url === 'string' && /^#\/[^\s]*$/.test(url) ? url : undefined;
}

/** Listens to the worker on both routes, once per message. Returns a function that stops. */
export function listenToWorker(handlers: WorkerHandlers): () => void {
  if (!('serviceWorker' in navigator)) return () => undefined;
  const seen = new Set<string>();
  const onMessage = (event: MessageEvent) => {
    const msg = event.data as Message | undefined;
    if (!msg || typeof msg !== 'object' || !('id' in msg) || seen.has(msg.id)) return;
    seen.add(msg.id);
    if (msg.type === 'quest-open') {
      const url = safeRoute(msg.url);
      if (url) handlers.open(url);
    } else if (msg.type === 'quest-push') handlers.changed('push');
    else if (msg.type === 'quest-push-subscription') handlers.changed('resubscribed');
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('quest-push') : undefined;
  channel?.addEventListener('message', onMessage);
  return () => {
    navigator.serviceWorker.removeEventListener('message', onMessage);
    channel?.close();
  };
}

/** The worker's recent log, newest first (empty if there's no worker or it doesn't answer). */
export async function workerLog(timeoutMs = 2000): Promise<WorkerLogEntry[]> {
  if (!('serviceWorker' in navigator)) return [];
  const reg = await Promise.race([navigator.serviceWorker.ready, wait(timeoutMs)]);
  const worker = reg?.active;
  if (!worker) return [];
  return new Promise((resolve) => {
    const done = (log: WorkerLogEntry[]) => {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      resolve(log);
    };
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as Message | undefined;
      if (msg?.type === 'quest-push-log') done(Array.isArray(msg.log) ? msg.log.slice().reverse() : []);
    };
    const timer = setTimeout(() => done([]), timeoutMs);
    navigator.serviceWorker.addEventListener('message', onMessage);
    worker.postMessage({ type: 'quest-push-log' });
  });
}

const wait = (ms: number) => new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms));
