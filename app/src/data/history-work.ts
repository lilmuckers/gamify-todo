import { detailedStats, scanChanges, type ChangeEvent, type CommitChanges, type DetailedStats, type HistoryEvent, type Workspace } from '@quest/shared';

/** The heavy lifting for detailed stats, done off the main thread when the browser can. */
export type WorkRequest =
  | { kind: 'scan'; commits: CommitChanges[] }
  | { kind: 'stats'; ws: Workspace; quick: HistoryEvent[]; deep: ChangeEvent[]; now: number };

export type WorkResult<R extends WorkRequest> = R extends { kind: 'scan' } ? ChangeEvent[] : DetailedStats;

/** Pure: what the worker does with each request. */
export function doWork<R extends WorkRequest>(req: R): WorkResult<R> {
  if (req.kind === 'scan') return scanChanges(req.commits) as WorkResult<R>;
  return detailedStats(req.ws, { now: req.now, quick: req.quick, deep: req.deep }) as WorkResult<R>;
}

export interface WorkClient {
  run<R extends WorkRequest>(req: R): Promise<WorkResult<R>>;
}

/**
 * Runs history work on a Web Worker, so parsing hundreds of level files and
 * adding up a year of history never holds up the game or the panels. Where
 * workers aren't available (tests, very old browsers) it runs inline, after
 * yielding to whatever else is waiting.
 */
export function workClient(): WorkClient {
  let worker: Worker | undefined;
  try {
    if (typeof Worker !== 'undefined') worker = new Worker(new URL('./history.worker.ts', import.meta.url), { type: 'module', name: 'quest-history' });
  } catch {
    worker = undefined;
  }
  if (!worker) return inlineWork();
  const waiting = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  let next = 0;
  worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.error !== undefined) w.reject(new Error(e.data.error));
    else w.resolve(e.data.result as never);
  };
  worker.onerror = () => {
    // A worker that can't start (blocked, failed to load): finish the queue inline instead.
    const inline = inlineWork();
    for (const [id, w] of waiting) {
      waiting.delete(id);
      w.reject(new Error('worker failed'));
    }
    client.run = inline.run;
  };
  const client: WorkClient = {
    run: (req) =>
      new Promise((resolve, reject) => {
        const id = next++;
        waiting.set(id, { resolve: resolve as (v: never) => void, reject });
        worker!.postMessage({ id, req });
      }),
  };
  return client;
}

/** The same work on this thread, after letting the page catch up. */
export function inlineWork(): WorkClient {
  return {
    run: async (req) => {
      await new Promise((r) => setTimeout(r, 0));
      return doWork(req);
    },
  };
}
