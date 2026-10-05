/// <reference lib="webworker" />
import { doWork, type WorkRequest } from './history-work';

/** Detailed stats' worker: compares commits and adds up the history, off the main thread. */
self.onmessage = (e: MessageEvent<{ id: number; req: WorkRequest }>) => {
  const { id, req } = e.data;
  try {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, result: doWork(req) });
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, error: (err as Error).message });
  }
};
