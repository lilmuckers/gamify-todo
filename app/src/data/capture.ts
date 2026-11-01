import type { AttachmentSidecar } from '@quest/shared';

/**
 * What the app records about where a photo came from (plans G6): the device as the browser
 * describes itself, and facts about the original file before it was shrunk. Nothing here is
 * looked up elsewhere, and no location or network address is ever kept.
 */
export type CapturedWith = NonNullable<AttachmentSidecar['capturedWith']>;
export type Original = NonNullable<AttachmentSidecar['original']>;

export interface DeviceHints {
  userAgent: string;
  /** navigator.maxTouchPoints: iPadOS says it's a Mac, but a Mac has no touch screen. */
  touchPoints: number;
  /** Running as the installed app. */
  standalone: boolean;
}

/** Device kind, OS and browser (with major versions) from the user agent, as the browser reports them. */
export function describeDevice({ userAgent: ua, touchPoints, standalone }: DeviceHints): Omit<CapturedWith, 'device' | 'app'> {
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  const ios = ipad || /iPhone|iPod/.test(ua);
  const android = /Android/.test(ua);
  const kind = ipad || (android && !/Mobile/.test(ua)) ? 'tablet' : ios || android ? 'phone' : 'desktop';
  const ver = (re: RegExp) => re.exec(ua)?.[1]?.replace(/_/g, '.');
  const os = ios
    ? join(ipad ? 'iPadOS' : 'iOS', ver(/OS (\d+(?:_\d+)?)/))
    : android
      ? join('Android', ver(/Android (\d+(?:\.\d+)?)/))
      : /CrOS/.test(ua)
        ? 'ChromeOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X/.test(ua)
            ? 'macOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : undefined;
  const browser =
    match(ua, /Edg(?:A|iOS)?\/(\d+)/, 'Edge') ??
    match(ua, /SamsungBrowser\/(\d+)/, 'Samsung Internet') ??
    match(ua, /(?:Firefox|FxiOS)\/(\d+)/, 'Firefox') ??
    match(ua, /(?:Chrome|CriOS)\/(\d+)/, 'Chrome') ??
    (/Safari\//.test(ua) ? join('Safari', ver(/Version\/(\d+(?:\.\d+)?)/)) : undefined);
  return { kind, ...(os && { os }), ...(browser && { browser }), installed: standalone };
}

const join = (name: string, version?: string) => (version ? `${name} ${version}` : name);
const match = (ua: string, re: RegExp, name: string) => {
  const m = re.exec(ua);
  return m ? `${name} ${m[1]}` : undefined;
};

/** The original file's name, type and size, plus its pixel size when known. */
export function originalFacts(file: Blob, size?: { width: number; height: number }): Original {
  const name = 'name' in file && typeof file.name === 'string' && file.name ? file.name.slice(0, 255) : undefined;
  return {
    ...(name && { name }),
    ...(file.type && { type: file.type.slice(0, 100) }),
    bytes: file.size,
    ...(size && { width: size.width, height: size.height }),
  };
}

/**
 * The day a JPEG says it was taken (EXIF DateTimeOriginal, else DateTime), as YYYY-MM-DD in the
 * camera's own time. Only the date tags are read; GPS and the rest are never looked at, and the
 * photo is redrawn without them anyway.
 */
export function exifDate(bytes: ArrayBuffer): string | undefined {
  const v = new DataView(bytes);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return undefined;
  let at = 2;
  while (at + 4 <= v.byteLength) {
    const marker = v.getUint16(at);
    const len = v.getUint16(at + 2);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return undefined;
    // APP1 "Exif\0\0", then a TIFF header.
    if (marker === 0xffe1 && at + 10 <= v.byteLength && v.getUint32(at + 4) === 0x45786966) return tiffDate(v, at + 10, Math.min(v.byteLength, at + 2 + len));
    at += 2 + len;
  }
}

function tiffDate(v: DataView, tiff: number, end: number): string | undefined {
  try {
    const le = v.getUint16(tiff) === 0x4949;
    const u16 = (o: number) => v.getUint16(tiff + o, le);
    const u32 = (o: number) => v.getUint32(tiff + o, le);
    const entries = (ifd: number) => Array.from({ length: u16(ifd) }, (_, i) => ifd + 2 + i * 12);
    const ascii = (entry: number) => {
      const count = u32(entry + 4);
      const off = count > 4 ? u32(entry + 8) : entry + 8;
      if (tiff + off + count > end) return undefined;
      return String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + tiff + off, count)).replace(/\0+$/, '');
    };
    const ifd0 = u32(4);
    let dateTime: string | undefined;
    let original: string | undefined;
    for (const e of entries(ifd0)) {
      const tag = u16(e);
      if (tag === 0x0132) dateTime = ascii(e);
      if (tag === 0x8769) for (const x of entries(u32(e + 8))) if (u16(x) === 0x9003) original = ascii(x);
    }
    const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(original || dateTime || '');
    if (!m || m[1] === '0000') return undefined;
    const day = `${m[1]}-${m[2]}-${m[3]}`;
    return Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? undefined : day;
  } catch {
    return undefined;
  }
}

/** "from Laptop · Android 15 phone · Chrome 141 · installed app · build 1a2b3c4". */
export function deviceLine(c: CapturedWith): string {
  const machine = [c.os, c.kind].filter(Boolean).join(' ');
  return [c.device && `from ${c.device}`, machine, c.browser, c.installed && 'installed app', c.app && `build ${c.app}`].filter(Boolean).join(' · ');
}

/** "IMG_1234.HEIC · 4032×3024 · 3.1 MB": the file as it came in, before it was shrunk. */
export function originalLine(o: Original): string {
  const size = o.bytes === undefined ? undefined : o.bytes >= 1e6 ? `${(o.bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(o.bytes / 1e3))} KB`;
  return ['original', o.name, o.width && o.height && `${o.width}×${o.height}`, size].filter(Boolean).join(' · ');
}
