// Quest Log's share-target add-on, loaded into the Workbox service worker with importScripts
// (plans D16, G6). The installed app's share sheet POSTs the shared photos here as multipart.
// The worker stashes them in the Cache, then sends the page on with the usual share-* params
// plus share-files=N; main.ts picks the photos up and queues them as attachments.
(() => {
  const CACHE = 'quest-share';

  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'POST') return;
    const url = new URL(req.url);
    const scope = new URL(self.registration.scope);
    if (url.origin !== scope.origin || url.pathname !== scope.pathname) return;
    event.respondWith(
      (async () => {
        const form = await req.formData().catch(() => undefined);
        const back = new URL(scope.href);
        let n = 0;
        if (form) {
          for (const key of ['title', 'text', 'url']) {
            const value = form.get(key);
            if (typeof value === 'string' && value) back.searchParams.set(`share-${key}`, value);
          }
          const files = form.getAll('photos').filter((f) => typeof f !== 'string' && f.type.startsWith('image/'));
          const cache = await caches.open(CACHE);
          // A share replaces anything an earlier one left behind.
          for (const old of await cache.keys()) await cache.delete(old);
          for (const file of files) await cache.put(new URL(`share/${n++}`, scope).href, new Response(file, { headers: { 'Content-Type': file.type } }));
        }
        if (n) back.searchParams.set('share-files', String(n));
        back.hash = '#/~inbox';
        return Response.redirect(back.href, 303);
      })(),
    );
  });
})();
