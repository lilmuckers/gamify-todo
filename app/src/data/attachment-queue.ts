import type { AttachmentPull, AttachmentSidecar, AttachmentVia, PhotoReader } from '@quest/shared';
import { track } from '../analytics';
import { exifDate, originalFacts, type CapturedWith, type Original } from './capture';
import type { AttachmentProvider } from './source';
import type { KV } from './store';

/**
 * Photos on their way into the repo (plans G6, D14). Each is shrunk to a JPEG of at most
 * 1600px on its long edge (which also drops EXIF and GPS), kept in IndexedDB so a share made
 * offline survives, then uploaded as its own `quest/attach/<id>` pull request once online.
 * The pull requests wait in the Warp Zone, labelled for whatever reads the repo's photos.
 */

/** Longest edge of an uploaded photo, in pixels. */
export const MAX_EDGE = 1600;
const QUALITY = 0.85;

export interface QueuedPhoto {
  id: string;
  addedAt: string;
  via: AttachmentVia;
  title?: string;
  text?: string;
  /** The day the photo says it was taken (EXIF), when it says. */
  takenOn?: string;
  capturedWith?: CapturedWith;
  original?: Original;
  /** The compressed JPEG. */
  blob: Blob;
  /** Why the last upload failed; it's tried again later. */
  error?: string;
}

/** A row in the inbox: a photo still uploading here, or an open pull request. */
export interface WaitingRow {
  id: string;
  title: string;
  addedAt: string;
  /** Still in this browser's queue. */
  local: boolean;
  error?: string;
  pull?: AttachmentPull;
}

/** A shrunk photo, with the original's pixel size. */
export interface Compressed {
  blob: Blob;
  width: number;
  height: number;
}

export interface QueueDeps {
  online(): boolean;
  compress(file: Blob): Promise<Compressed>;
  /** The device a photo is added on: kind, OS, browser, push name, app build. */
  device(): CapturedWith;
  /** What reads this repo's photos, as of the upload (`photos.reader`). */
  reader(): PhotoReader | undefined;
  now(): Date;
  random(): number;
}

/** The size that fits `width` × `height` within `max` on its long edge, never larger than it was. */
export function fitWithin(width: number, height: number, max = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Redraws a photo as a JPEG within MAX_EDGE. Drawing to a canvas keeps only the pixels, so EXIF and GPS go. */
export async function compressPhoto(file: Blob): Promise<Compressed> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Couldn’t read that image. Try a JPEG or PNG.');
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // JPEG has no transparency: a white page under a PNG's clear parts.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  const original = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t shrink that image.'))), 'image/jpeg', QUALITY));
  return { blob, ...original };
}

/** A new attachment id: `photo-20261101-084100-k3x9`, unique enough per repo and a valid slug. */
export function photoId(now: Date, random: () => number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}`;
  const time = `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  const tag = Array.from({ length: 4 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(random() * 36)]).join('');
  return `photo-${day}-${time}-${tag}`;
}

/** Base64 of a blob's bytes, for GitHub's blob API. */
export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export class AttachmentQueue {
  items: QueuedPhoto[] = [];
  /** Open attachment pull requests, as last read. */
  remote: AttachmentPull[] = [];
  uploading = false;
  private ready: Promise<void>;
  private thumbs = new Map<string, Promise<string | undefined>>();
  private deps: QueueDeps;

  constructor(
    private provider: AttachmentProvider,
    private kv: KV,
    private sourceId: string,
    private onChange: () => void,
    deps: Partial<QueueDeps> = {},
  ) {
    this.deps = { online: () => navigator.onLine, compress: compressPhoto, device: () => ({}), reader: () => undefined, now: () => new Date(), random: Math.random, ...deps };
    this.ready = this.kv.get<QueuedPhoto[]>(this.key).then((saved) => {
      this.items = saved ?? [];
    });
  }

  private get key() {
    return `attachments:${this.sourceId}`;
  }

  /** Reads what's queued, then uploads it and reads the waiting pull requests (when online). */
  async start(): Promise<void> {
    await this.ready;
    this.onChange();
    await this.flush();
    await this.refresh();
  }

  /** Shrinks and queues photos, then uploads them. Returns how many were added. */
  async add(files: Blob[], meta: { via: AttachmentVia; text?: string }): Promise<number> {
    await this.ready;
    let added = 0;
    for (const file of files) {
      const { blob, width, height } = await this.deps.compress(file);
      // Read before it's gone: the redrawn JPEG keeps no EXIF.
      const takenOn = file.type === 'image/jpeg' ? exifDate(await file.slice(0, 256 * 1024).arrayBuffer()) : undefined;
      const capturedWith = this.deps.device();
      const id = photoId(this.deps.now(), this.deps.random);
      this.items.push({
        id,
        addedAt: this.deps.now().toISOString(),
        via: meta.via,
        ...(meta.text ? { text: meta.text } : {}),
        ...(takenOn && { takenOn }),
        ...(Object.keys(capturedWith).length && { capturedWith }),
        original: originalFacts(file, { width, height }),
        blob,
      });
      track('attachment_add', { via: meta.via });
      added++;
    }
    if (added) {
      await this.save();
      this.onChange();
      void this.flush();
    }
    return added;
  }

  /** Uploads queued photos one at a time; a failure stays queued for the next try. Joins an upload already running. */
  flush(): Promise<void> {
    this.flushing ??= this.upload().finally(() => (this.flushing = undefined));
    return this.flushing;
  }

  private flushing?: Promise<void>;

  private async upload(): Promise<void> {
    await this.ready;
    if (!this.items.length || !this.deps.online()) return;
    this.uploading = true;
    this.onChange();
    try {
      for (const item of [...this.items]) {
        try {
          const { blob: _, error: __, ...fields } = item;
          const sidecar: AttachmentSidecar = fields;
          await this.provider.submit({ sidecar, base64: await toBase64(item.blob), reader: this.deps.reader() });
          this.items = this.items.filter((i) => i.id !== item.id);
        } catch (err) {
          item.error = (err as Error).message;
          if (!this.deps.online()) break;
        }
        await this.save();
        this.onChange();
      }
    } finally {
      this.uploading = false;
    }
    await this.refresh();
  }

  /** Re-reads the open attachment pull requests. */
  async refresh(): Promise<void> {
    if (!this.deps.online()) return;
    try {
      this.remote = await this.provider.pending();
    } catch {
      // Keep the last list; the queue still shows what's here.
    }
    this.onChange();
  }

  /** What the inbox shows: this browser's queue first, then the pull requests not already in it. */
  rows(): WaitingRow[] {
    const local = new Set(this.items.map((i) => i.id));
    return [
      ...this.items.map((i) => ({ id: i.id, title: i.title ?? 'Photo', addedAt: i.addedAt, local: true, ...(i.error ? { error: i.error } : {}) })),
      ...this.remote.filter((p) => !local.has(p.id)).map((p) => ({ id: p.id, title: p.title.replace(/^📷\s*/, ''), addedAt: p.createdAt, local: false, pull: p })),
    ];
  }

  /** An object URL for a row's photo: from the queue, or fetched from its branch once and kept in IndexedDB. */
  thumb(row: WaitingRow): Promise<string | undefined> {
    let url = this.thumbs.get(row.id);
    if (!url) {
      url = (async () => {
        const queued = this.items.find((i) => i.id === row.id)?.blob;
        const kept = queued ?? (await this.kv.get<Blob>(`attachment-photo:${row.id}`));
        if (kept) return URL.createObjectURL(kept);
        if (!row.pull) return undefined;
        const blob = await this.provider.file(row.pull);
        await this.kv.set(`attachment-photo:${row.id}`, blob);
        return URL.createObjectURL(blob);
      })().catch(() => {
        this.thumbs.delete(row.id);
        return undefined;
      });
      this.thumbs.set(row.id, url);
    }
    return url;
  }

  private save() {
    return this.kv.set(this.key, this.items);
  }
}
