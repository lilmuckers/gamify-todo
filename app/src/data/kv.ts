import { createStore, get, set } from 'idb-keyval';
import type { KV } from './store';

const idb = createStore('quest-log', 'kv');

/** IndexedDB-backed store; falls back to memory if IndexedDB is unavailable. */
export function browserKV(): KV {
  const memory = new Map<string, unknown>();
  let broken = typeof indexedDB === 'undefined';
  return {
    async get<T>(key: string) {
      if (!broken)
        try {
          return await get<T>(key, idb);
        } catch {
          broken = true;
        }
      return memory.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      memory.set(key, value);
      if (!broken)
        try {
          await set(key, value, idb);
        } catch {
          broken = true;
        }
    },
  };
}
