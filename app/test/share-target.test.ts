import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// app/public/share-target.js runs inside the Workbox service worker. Run it against a stand-in `self` and Cache.
const SOURCE = readFileSync(resolve(import.meta.dirname, '../public/share-target.js'), 'utf8');
const SCOPE = 'https://tasks.example.com/';

function worker() {
  let onFetch: (event: unknown) => void = () => undefined;
  const store = new Map<string, Response>([[`${SCOPE}share/7`, new Response('old')]]);
  const cache = {
    keys: async () => [...store.keys()],
    delete: async (k: string) => store.delete(k),
    put: async (k: string, r: Response) => void store.set(k, r),
  };
  const self = { addEventListener: (_: string, fn: (event: unknown) => void) => (onFetch = fn), registration: { scope: SCOPE } };
  new Function('self', 'caches', SOURCE)(self, { open: async () => cache });
  /** Fires a fetch; resolves with the worker's response, or undefined when it let the request through. */
  const fetch = async (request: Request) => {
    let answer: Promise<Response> | undefined;
    onFetch({ request, respondWith: (p: Promise<Response>) => (answer = p) });
    return answer && (await answer);
  };
  return { fetch, store };
}

const share = (form: FormData, url = SCOPE) => new Request(url, { method: 'POST', body: form });

describe('share-target.js', () => {
  it('stashes shared photos, drops older ones, and sends the page to the inbox with the text', async () => {
    const { fetch, store } = worker();
    const form = new FormData();
    form.set('title', 'Boiler');
    form.set('text', 'Receipt for the service');
    form.append('photos', new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' }));
    form.append('photos', new File([new Uint8Array([2])], 'b.png', { type: 'image/png' }));
    form.append('photos', new File(['x'], 'notes.txt', { type: 'text/plain' }));
    const res = (await fetch(share(form)))!;
    expect(res.status).toBe(303);
    const back = new URL(res.headers.get('Location')!);
    expect(back.hash).toBe('#/~inbox');
    expect(Object.fromEntries(back.searchParams)).toEqual({ 'share-title': 'Boiler', 'share-text': 'Receipt for the service', 'share-files': '2' });
    expect([...store.keys()]).toEqual([`${SCOPE}share/0`, `${SCOPE}share/1`]);
    expect(store.get(`${SCOPE}share/1`)!.headers.get('Content-Type')).toBe('image/png');
  });

  it('passes a text-only share through without share-files', async () => {
    const { fetch } = worker();
    const form = new FormData();
    form.set('url', 'https://example.com/');
    const back = new URL((await fetch(share(form)))!.headers.get('Location')!);
    expect(Object.fromEntries(back.searchParams)).toEqual({ 'share-url': 'https://example.com/' });
  });

  it('leaves other requests alone', async () => {
    const { fetch } = worker();
    expect(await fetch(new Request(SCOPE))).toBeUndefined();
    expect(await fetch(share(new FormData(), `${SCOPE}api/x`))).toBeUndefined();
    expect(await fetch(share(new FormData(), 'https://elsewhere.example.com/'))).toBeUndefined();
  });
});
