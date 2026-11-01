import { describe, expect, it } from 'vitest';
import type { AttachmentPull } from '@quest/shared';
import { AttachmentQueue, fitWithin, photoId, toBase64, type QueueDeps } from '../src/data/attachment-queue';
import type { AttachmentProvider, AttachmentUpload } from '../src/data/source';
import type { KV } from '../src/data/store';
import { jpegTakenOn } from './exif-fixture';

function memory(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async <T>(k: string) => data.get(k) as T | undefined, set: async (k: string, v: unknown) => void data.set(k, v) };
}

/** A provider that records uploads, and can be told to fail. */
function provider() {
  const sent: AttachmentUpload[] = [];
  const pulls: AttachmentPull[] = [];
  let failWith: string | undefined;
  const p: AttachmentProvider & { sent: AttachmentUpload[]; fail(msg?: string): void } = {
    sent,
    fail: (msg) => void (failWith = msg),
    submit: async (u) => {
      if (failWith) throw new Error(failWith);
      sent.push(u);
      const number = sent.length;
      pulls.unshift({ id: u.sidecar.id, number, title: '📷 New photo', url: `u${number}`, headSha: `s${number}`, createdAt: u.sidecar.addedAt });
      return number;
    },
    pending: async () => [...pulls],
    file: async () => new Blob([new Uint8Array([9])]),
  };
  return p;
}

function deps(over: Partial<QueueDeps> = {}): Partial<QueueDeps> {
  let t = Date.UTC(2026, 10, 1, 8, 41, 0);
  let r = 0;
  return {
    online: () => true,
    compress: async (blob) => ({ blob, width: 4032, height: 3024 }),
    device: () => ({ device: 'Laptop', kind: 'desktop', os: 'macOS', browser: 'Chrome 141', installed: false, app: 'abc1234' }),
    now: () => new Date((t += 1000)),
    random: () => (r = (r + 0.37) % 1),
    ...over,
  };
}

const photo = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

describe('attachment queue helpers', () => {
  it('fits a photo within 1600px on its long edge, and never enlarges it', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('makes ids that are valid attachment slugs', () => {
    const id = photoId(new Date(Date.UTC(2026, 10, 1, 8, 41, 5)), () => 0.5);
    expect(id).toBe('photo-20261101-084105-iiii');
    expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('base64-encodes bytes', async () => {
    expect(await toBase64(new Blob([new Uint8Array([0xff, 0, 0x41])]))).toBe('/wBB');
  });
});

describe('AttachmentQueue', () => {
  it('takes the day a JPEG says it was taken, and the original file’s name', async () => {
    const p = provider();
    const q = new AttachmentQueue(p, memory(), 'gh:o/r', () => undefined, deps());
    await q.start();
    await q.add([new File([jpegTakenOn('2026:10:27 18:04:11')], 'IMG_1234.JPG', { type: 'image/jpeg' })], { via: 'button' });
    await q.flush();
    expect(p.sent[0].sidecar).toMatchObject({ takenOn: '2026-10-27', original: { name: 'IMG_1234.JPG', type: 'image/jpeg' } });
  });

  it('uploads each photo as its own pull request, with how it came in and any shared text', async () => {
    const p = provider();
    const q = new AttachmentQueue(p, memory(), 'gh:o/r', () => undefined, deps());
    await q.start();
    expect(await q.add([photo(), photo()], { via: 'share', text: 'Boiler receipt' })).toBe(2);
    await q.flush();
    expect(p.sent).toHaveLength(2);
    expect(p.sent[0].sidecar).toEqual({
      id: expect.stringMatching(/^photo-/),
      addedAt: expect.any(String),
      via: 'share',
      text: 'Boiler receipt',
      capturedWith: { device: 'Laptop', kind: 'desktop', os: 'macOS', browser: 'Chrome 141', installed: false, app: 'abc1234' },
      original: { type: 'image/jpeg', bytes: 3, width: 4032, height: 3024 },
    });
    expect(p.sent[0].base64).toBe('AQID');
    expect(q.items).toEqual([]);
    expect(q.rows().map((r) => [r.local, r.pull?.number])).toEqual([
      [false, 2],
      [false, 1],
    ]);
  });

  it('keeps photos added offline, across a reload, and sends them once back online', async () => {
    let online = false;
    const kv = memory();
    const p = provider();
    const q = new AttachmentQueue(p, kv, 'gh:o/r', () => undefined, deps({ online: () => online }));
    await q.start();
    await q.add([photo()], { via: 'button' });
    expect(p.sent).toHaveLength(0);
    expect(q.rows()).toEqual([expect.objectContaining({ local: true, title: 'Photo' })]);

    // The tab closes; a new one finds the photo still queued.
    const again = new AttachmentQueue(p, kv, 'gh:o/r', () => undefined, deps({ online: () => online }));
    await again.start();
    expect(again.items).toHaveLength(1);
    online = true;
    await again.flush();
    expect(p.sent).toHaveLength(1);
    expect(again.items).toEqual([]);
    expect(kv.data.get('attachments:gh:o/r')).toEqual([]);
  });

  it('keeps a photo whose upload failed, with the reason, and sends it on the next try', async () => {
    const p = provider();
    const q = new AttachmentQueue(p, memory(), 'gh:o/r', () => undefined, deps());
    await q.start();
    p.fail('GitHub POST /git/blobs: 500');
    await q.add([photo()], { via: 'paste' });
    await q.flush();
    expect(q.items).toHaveLength(1);
    expect(q.rows()[0]).toMatchObject({ local: true, error: 'GitHub POST /git/blobs: 500' });
    p.fail();
    await q.flush();
    expect(q.items).toEqual([]);
    expect(p.sent).toHaveLength(1);
  });

  it('keeps each repo’s queue apart', async () => {
    const kv = memory();
    const offline = deps({ online: () => false });
    const a = new AttachmentQueue(provider(), kv, 'gh:o/a', () => undefined, offline);
    await a.add([photo()], { via: 'button' });
    const b = new AttachmentQueue(provider(), kv, 'gh:o/b', () => undefined, offline);
    await b.start();
    expect(b.items).toEqual([]);
  });

  it('turns a bad image into a message, and queues nothing', async () => {
    const q = new AttachmentQueue(provider(), memory(), 'gh:o/r', () => undefined, deps({ compress: async () => Promise.reject(new Error('Couldn’t read that image. Try a JPEG or PNG.')) }));
    await expect(q.add([photo()], { via: 'button' })).rejects.toThrow(/Couldn’t read that image/);
    expect(q.items).toEqual([]);
  });

  it('uploads each photo for whatever reads the repo’s photos at that moment', async () => {
    const fake = provider();
    let reader: 'agent' | undefined;
    const queue = new AttachmentQueue(fake, memory(), 'r', () => {}, deps({ reader: () => reader }));
    await queue.add([new Blob([new Uint8Array([1])], { type: 'image/png' })], { via: 'button' });
    await queue.flush();
    reader = 'agent';
    await queue.add([new Blob([new Uint8Array([1])], { type: 'image/png' })], { via: 'button' });
    await queue.flush();
    expect(fake.sent.map((u) => u.reader)).toEqual([undefined, 'agent']);
  });
});
